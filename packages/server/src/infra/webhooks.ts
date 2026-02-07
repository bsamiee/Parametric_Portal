/**
 * Outbound webhook delivery via @effect/cluster durable execution.
 * HMAC signatures, idempotent delivery, dead-letter integration.
 */
import { ClusterWorkflowEngine } from '@effect/cluster';
import { Activity, Workflow, WorkflowEngine } from '@effect/workflow';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Cause, Clock, Config, Duration, Effect, type Either, HashMap, Layer, Match, Metric, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
import type { JobDlq } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';
import { Crypto } from '../security/crypto.ts';
import { Resilience } from '../utils/resilience.ts';
import { ClusterService } from './cluster.ts';
import { EventBus } from './events.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _verificationConfig = Config.all({ maxRetries: Config.integer('WEBHOOK_VERIFY_MAX_RETRIES').pipe(Config.withDefault(3)), timeoutMs: Config.integer('WEBHOOK_VERIFY_TIMEOUT_MS').pipe(Config.withDefault(10_000)) });
const _Engine = Layer.unwrapEffect(Config.string('NODE_ENV').pipe(Config.withDefault('development'), Effect.map((environment) => Match.value(environment).pipe(Match.when('production', () => ClusterWorkflowEngine.layer.pipe(Layer.provide(ClusterService.Layers.runner))), Match.orElse(() => WorkflowEngine.layerMemory)))));
const _CONFIG = {
	concurrency: { batch: 10, perEndpoint: 5 },
	delivery: { statusTtl: Duration.days(7) },
	retry: { base: Duration.millis(500), cap: Duration.seconds(30), maxAttempts: 5 },
	settings: { cacheTtl: Duration.minutes(5) },
	signature: { format: (digest: string) => `sha256=${digest}`, header: 'X-Webhook-Signature' },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
	DeliveryRecord: S.Struct({ deliveredAt: S.optional(S.Number), deliveryId: S.String, durationMs: S.optional(S.Number), endpointUrl: S.String, error: S.optional(S.String), status: S.Literal('delivered', 'failed'), statusCode: S.optional(S.Number), tenantId: S.String, timestamp: S.Number, type: S.String }),
	DeliveryResult: S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number }),
	ErrorReason: S.Literal('CircuitOpen', 'InvalidResponse', 'MaxRetries', 'NetworkError', 'SignatureError', 'Timeout', 'VerificationFailed'),
	WebhookSettings: S.Struct({ webhooks: S.optionalWith(S.Array(S.Struct({ active: S.Boolean, endpoint: S.suspend(() => WebhookEndpoint), eventTypes: S.Array(S.String) })), { default: () => [] }) }),
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class WebhookPayload extends S.Class<WebhookPayload>('WebhookPayload')({ data: S.Unknown, id: S.String, timestamp: S.Number, type: S.String }) {}
class WebhookEndpoint extends S.Class<WebhookEndpoint>('WebhookEndpoint')({ secret: S.String.pipe(S.minLength(32)), timeout: S.optionalWith(S.Number, { default: () => 5000 }), url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')) }) {}
class WebhookError extends S.TaggedError<WebhookError>()('WebhookError', { cause: S.optional(S.Unknown), deliveryId: S.optional(S.String), reason: _SCHEMA.ErrorReason, statusCode: S.optional(S.Number) }) {
	static readonly _props = {
		CircuitOpen: { retryable: false, terminal: false }, InvalidResponse: { retryable: true, terminal: false }, MaxRetries: { retryable: false, terminal: true },
		NetworkError: { retryable: true, terminal: false }, SignatureError: { retryable: false, terminal: true }, Timeout: { retryable: true, terminal: false }, VerificationFailed: { retryable: false, terminal: true },
	} as const satisfies Record<typeof _SCHEMA.ErrorReason.Type, { retryable: boolean; terminal: boolean }>;
	static readonly from = (reason: typeof _SCHEMA.ErrorReason.Type, deliveryId?: string, opts?: { cause?: unknown; statusCode?: number }) => new WebhookError({ deliveryId, reason, ...opts });
	static readonly mapHttp = (deliveryId: string) => (error: unknown): WebhookError => error instanceof WebhookError ? error : Match.value(error).pipe(
		Match.when((candidate: unknown): candidate is HttpClientError.ResponseError => candidate instanceof HttpClientError.ResponseError, (responseError) => WebhookError.from(responseError.response.status >= 400 && responseError.response.status < 500 ? 'InvalidResponse' : 'NetworkError', deliveryId, { cause: error, statusCode: responseError.response.status })),
		Match.orElse(() => WebhookError.from('NetworkError', deliveryId, { cause: error })),
	);
	get isRetryable(): boolean { return WebhookError._props[this.reason].retryable; }
	get isTerminal(): boolean { return WebhookError._props[this.reason].terminal; }
}
class _WebhookSettingsKey extends S.TaggedRequest<_WebhookSettingsKey>()('WebhookSettingsKey', { failure: WebhookError, payload: { tenantId: S.String }, success: _SCHEMA.WebhookSettings }) { [PrimaryKey.symbol]() { return `webhook:settings:${this.tenantId}`; }}
class _DeliveryEngine {
	private readonly _deps: {
		readonly cache: typeof CacheService.Service;
		readonly eventBus: typeof EventBus.Service;
		readonly metrics: typeof MetricsService.Service;
		readonly throttles: Ref.Ref<HashMap.HashMap<string, Effect.Semaphore>>;
	};
	constructor(deps: _DeliveryEngine['_deps']) { this._deps = deps; }
	private readonly _context = (tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload, operation: 'webhook.deliver' | 'webhook.test') => {
		const endpointHost = new URL(endpoint.url).hostname;
		return { endpoint, endpointHost, labels: MetricsService.label({ endpoint_host: endpointHost, operation, tenant: tenantId }), payload, tenantId } as const;
	};
	private readonly _operation = { deliver: { operation: 'webhook.deliver' as const, span: 'webhook.deliver' as const }, test: { operation: 'webhook.test' as const, span: 'webhook.test' as const } } as const;
	private readonly _statusKey = (tenantId: string, endpointUrl: string) => `webhook:delivery:${tenantId}:${encodeURIComponent(endpointUrl)}`;
	private readonly _legacyStatusKey = (tenantId: string, endpointUrl: string) => `webhook:delivery:${tenantId}:${new URL(endpointUrl).hostname}`;
	private readonly _throttle = (hostname: string) => Ref.get(this._deps.throttles).pipe(Effect.flatMap((map) => Option.match(HashMap.get(map, hostname), { onNone: () => Effect.makeSemaphore(_CONFIG.concurrency.perEndpoint).pipe(Effect.tap((sem) => Ref.update(this._deps.throttles, HashMap.set(hostname, sem)))), onSome: Effect.succeed })));
	private readonly _record = (tenantId: string, deliveryId: string, endpointUrl: string, type: string, result: { status: 'delivered'; deliveredAt: number; durationMs: number; statusCode: number } | { status: 'failed'; error: string }) =>
		Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => Effect.all([
			this._deps.cache.kv.set(this._statusKey(tenantId, endpointUrl), { ...result, deliveryId, endpointUrl, tenantId, timestamp, type } satisfies typeof _SCHEMA.DeliveryRecord.Type, _CONFIG.delivery.statusTtl),
			this._deps.cache.kv.set(this._legacyStatusKey(tenantId, endpointUrl), { ...result, deliveryId, endpointUrl, tenantId, timestamp, type } satisfies typeof _SCHEMA.DeliveryRecord.Type, _CONFIG.delivery.statusTtl),
		], { discard: true })), Effect.ignore);
	private readonly _runDeliver = (context: ReturnType<_DeliveryEngine['_context']>) => this._throttle(context.endpointHost).pipe(Effect.flatMap((semaphore) => semaphore.withPermits(1)(Context.Request.within(context.tenantId, _WebhookWorkflow.execute({ endpoint: context.endpoint, payload: context.payload }), Context.Request.system(crypto.randomUUID())))));
	private readonly _runTest = (context: ReturnType<_DeliveryEngine['_context']>, deliveryId: string) => Context.Request.within(context.tenantId, _httpDeliver(context.endpoint, context.payload, deliveryId));
	private readonly _onDeliverSuccess = (context: ReturnType<_DeliveryEngine['_context']>, result: typeof _SCHEMA.DeliveryResult.Type, deliveryId: string) => Effect.all([
		this._deps.eventBus.publish({ aggregateId: context.payload.id, payload: { _tag: 'webhook', action: 'delivered', durationMs: result.durationMs, endpoint: context.endpoint.url, statusCode: result.statusCode }, tenantId: context.tenantId }).pipe(Effect.ignore),
		this._record(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode }),
	], { discard: true });
	private readonly _onDeliverError = (context: ReturnType<_DeliveryEngine['_context']>, error: unknown, deliveryId: string) => {
		const reason = _UTIL.errorReason(error);
		return Effect.all([
			this._deps.eventBus.publish({ aggregateId: context.payload.id, payload: { _tag: 'webhook', action: 'failed', endpoint: context.endpoint.url, reason }, tenantId: context.tenantId }).pipe(Effect.ignore),
			Metric.increment(Metric.taggedWithLabels(this._deps.metrics.events.deadLettered, context.labels)),
			this._record(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { error: reason, status: 'failed' }),
		], { discard: true });
	};
	private readonly _onTestSuccess = (context: ReturnType<_DeliveryEngine['_context']>, result: typeof _SCHEMA.DeliveryResult.Type, deliveryId: string) => this._record(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode });
	private readonly _onTestError = (context: ReturnType<_DeliveryEngine['_context']>, error: unknown, deliveryId: string) => this._record(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { error: _UTIL.errorReason(error), status: 'failed' });
	readonly execute = (mode: keyof _DeliveryEngine['_operation'], tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload, deliveryId: string = payload.id) => Match.value(mode).pipe(
		Match.when('deliver', () => {
			const operation = this._operation.deliver, context = this._context(tenantId, endpoint, payload, operation.operation);
			return this._runDeliver(context).pipe(
				Effect.tap((result) => this._onDeliverSuccess(context, result, deliveryId)),
				Effect.tapError((error) => this._onDeliverError(context, error, deliveryId)),
				(effect) => MetricsService.trackEffect(effect, { duration: this._deps.metrics.events.deliveryLatency, errors: this._deps.metrics.errors, labels: context.labels }),
				Telemetry.span(operation.span, { metrics: false, 'webhook.endpoint_host': context.endpointHost, 'webhook.type': context.payload.type, 'webhook.url': context.endpoint.url }),
			);
		}),
		Match.orElse(() => {
			const operation = this._operation.test, context = this._context(tenantId, endpoint, payload, operation.operation);
			return this._runTest(context, deliveryId).pipe(
				Effect.tap((result) => this._onTestSuccess(context, result, deliveryId)),
				Effect.tapError((error) => this._onTestError(context, error, deliveryId)),
				(effect) => MetricsService.trackEffect(effect, { duration: this._deps.metrics.events.deliveryLatency, errors: this._deps.metrics.errors, labels: context.labels }),
				Telemetry.span(operation.span, { metrics: false, 'webhook.endpoint_host': context.endpointHost, 'webhook.type': context.payload.type, 'webhook.url': context.endpoint.url }),
			);
		}),
	);
	readonly status = (tenantId: string, endpointUrls: readonly string[]) => Effect.forEach(endpointUrls, (url) => this._deps.cache.kv.get(this._statusKey(tenantId, url), _SCHEMA.DeliveryRecord).pipe(
		Effect.flatMap(Option.match({ onNone: () => this._deps.cache.kv.get(this._legacyStatusKey(tenantId, url), _SCHEMA.DeliveryRecord), onSome: (value) => Effect.succeed(Option.some(value)) })),
		Effect.map(Option.toArray),
		Effect.catchAll(() => Effect.succeed([])),
	), { concurrency: 'unbounded' }).pipe(Effect.map((results) => results.flat()), Effect.catchAll(() => Effect.succeed([])));
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _WebhookWorkflow = Workflow.make({ error: WebhookError, idempotencyKey: ({ payload }) => payload.id, name: 'webhook', payload: { endpoint: WebhookEndpoint, payload: WebhookPayload }, success: _SCHEMA.DeliveryResult });
const _UTIL = {
	dlqPayload: (entry: typeof JobDlq.Type) => Match.value(entry.payload).pipe(
		Match.when((candidate: unknown): candidate is { readonly data: unknown; readonly endpoint?: string } => typeof candidate === 'object' && candidate !== null && 'data' in candidate, (candidate) => ({ data: candidate.data, endpoint: Option.fromNullable(candidate.endpoint) })),
		Match.orElse((payload) => ({ data: payload, endpoint: Option.none<string>() })),
	),
	errorReason: (error: unknown) => Match.value(error).pipe(Match.when((candidate: unknown): candidate is WebhookError => candidate instanceof WebhookError, (webhookError) => webhookError.reason), Match.orElse(String)),
	normalizeDlqType: (type: string) => type.startsWith('webhook:') ? type.slice('webhook:'.length) : type,
} as const;
const _httpDeliver = (endpoint: WebhookEndpoint, payload: WebhookPayload, deliveryId: string, options?: { readonly extraHeaders?: Record<string, string>; readonly retryTransient?: boolean }) => Effect.gen(function* () {
	const baseClient = yield* HttpClient.HttpClient;
	const payloadJson = yield* S.encode(S.parseJson(WebhookPayload))(payload).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)));
	const signature = yield* Crypto.hmac(endpoint.secret, payloadJson).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)));
	const request = HttpClientRequest.post(endpoint.url).pipe(HttpClientRequest.bodyUnsafeJson(payload), HttpClientRequest.setHeaders({ 'Content-Type': 'application/json', 'X-Delivery-Id': deliveryId, [_CONFIG.signature.header]: _CONFIG.signature.format(signature), ...options?.extraHeaders }));
	const client = options?.retryTransient ? baseClient.pipe(HttpClient.filterStatusOk, HttpClient.retryTransient({ schedule: Resilience.schedule({ base: _CONFIG.retry.base, cap: _CONFIG.retry.cap, maxAttempts: _CONFIG.retry.maxAttempts }) }), HttpClient.withTracerPropagation(true)) : baseClient.pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true));
	const [duration, response] = yield* Effect.timed(client.execute(request).pipe(Effect.scoped, Effect.timeoutFail({ duration: Duration.millis(endpoint.timeout), onTimeout: () => WebhookError.from('Timeout', deliveryId) }), Effect.mapError(WebhookError.mapHttp(deliveryId))));
	const deliveredAt = yield* Clock.currentTimeMillis;
	return { deliveredAt, durationMs: Duration.toMillis(duration), statusCode: response.status };
});
const _verifyOwnership = (endpoint: WebhookEndpoint) => Effect.gen(function* () {
	const baseClient = yield* HttpClient.HttpClient;
	const { maxRetries, timeoutMs } = yield* _verificationConfig;
	const challenge = crypto.randomUUID();
	const request = HttpClientRequest.post(endpoint.url).pipe(HttpClientRequest.bodyUnsafeJson({ challenge, type: 'webhook.verification' }), HttpClientRequest.setHeaders({ 'Content-Type': 'application/json' }));
	const response = yield* baseClient.pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true)).execute(request).pipe(
		Effect.flatMap((raw) => raw.json),
		Effect.flatMap(S.decodeUnknown(S.Struct({ challenge: S.String }))),
		Effect.scoped,
		Effect.timeoutFail({ duration: Duration.millis(timeoutMs), onTimeout: () => WebhookError.from('VerificationFailed', undefined, { cause: 'Verification timed out' }) }),
		Effect.retry({ times: maxRetries, while: (error) => !(error instanceof WebhookError) }),
		Effect.mapError((error) => error instanceof WebhookError ? error : WebhookError.from('VerificationFailed', undefined, { cause: error })),
	);
	return response.challenge === challenge ? true : yield* Effect.fail(WebhookError.from('VerificationFailed', undefined, { cause: `Challenge mismatch: expected ${challenge}, got ${response.challenge}` }));
}).pipe(Telemetry.span('webhook.verify_ownership', { metrics: false, 'webhook.url': endpoint.url }));

// --- [SERVICES] --------------------------------------------------------------

class WebhookService extends Effect.Service<WebhookService>()('server/Webhooks', {
	dependencies: [
		CacheService.Persistence, DatabaseService.Default, EventBus.Default,
		FetchHttpClient.layer, MetricsService.Default, _Engine,
		_WebhookWorkflow.toLayer(({ endpoint, payload }) => Telemetry.span(Effect.gen(function* () {
			const database = yield* DatabaseService;
			const requestId = (yield* Context.Request.current).requestId;
			const deliverActivity = Activity.make({ error: WebhookError, execute: _httpDeliver(endpoint, payload, payload.id, { extraHeaders: { 'x-request-id': requestId }, retryTransient: true }), name: 'webhook.deliver', success: _SCHEMA.DeliveryResult });
			return yield* deliverActivity.pipe(
				Activity.retry({ times: _CONFIG.retry.maxAttempts, while: (error) => error.isRetryable }),
				_WebhookWorkflow.withCompensation((_value, cause) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => database.jobDlq.insert({
					appId: tenantId, attempts: _CONFIG.retry.maxAttempts, errorHistory: [{ error: Cause.pretty(cause), timestamp }], errorReason: 'MaxRetries',
					originalJobId: payload.id, payload: { data: payload.data, endpoint: endpoint.url }, replayedAt: Option.none(), requestId: Option.none(), source: 'event', type: `webhook:${payload.type}`, userId: Option.none(),
				})))), Effect.ignore)),
			);
		}), 'webhook.workflow.execute', { metrics: false, 'webhook.type': payload.type, 'webhook.url': endpoint.url })).pipe(Layer.provide(DatabaseService.Default)),
	],
	scoped: Effect.gen(function* () {
		const [cache, database, eventBus, metrics, sql] = yield* Effect.all([CacheService, DatabaseService, EventBus, MetricsService, SqlClient.SqlClient]);
		const throttles = yield* Ref.make(HashMap.empty<string, Effect.Semaphore>());
		const settingsCache = yield* CacheService.cache<_WebhookSettingsKey, never>({
			lookup: (key) => Context.Request.withinSync(key.tenantId, database.apps.one([{ field: 'id', value: key.tenantId }])).pipe(
				Effect.flatMap(Option.match({ onNone: () => Effect.succeed({ webhooks: [] }), onSome: (app) => S.decodeUnknown(_SCHEMA.WebhookSettings)(Option.getOrElse(app.settings, () => ({})), { errors: 'all', onExcessProperty: 'ignore' }) })),
				Effect.catchAll(() => Effect.succeed({ webhooks: [] })),
				Effect.provideService(SqlClient.SqlClient, sql),
			),
			storeId: 'webhook-settings',
			timeToLive: _CONFIG.settings.cacheTtl,
		});
		const delivery = new _DeliveryEngine({ cache, eventBus, metrics, throttles });
		const settings = (() => {
			const key = (tenantId: string) => new _WebhookSettingsKey({ tenantId });
			const get = (tenantId: string) => settingsCache.get(key(tenantId));
			const invalidate = (tenantId: string) => settingsCache.invalidate(key(tenantId));
			const update = (tenantId: string, transform: (webhooks: typeof _SCHEMA.WebhookSettings.Type['webhooks']) => typeof _SCHEMA.WebhookSettings.Type['webhooks']) => get(tenantId).pipe(
				Effect.flatMap((current) => Context.Request.withinSync(tenantId, database.apps.updateSettings(tenantId, { webhooks: transform(current.webhooks) })).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.andThen(invalidate(tenantId)))),
				Effect.mapError((error) => WebhookError.from('NetworkError', undefined, { cause: error })),
			);
			const list = (tenantId: string) => get(tenantId).pipe(Effect.map((current) => current.webhooks), Effect.catchAll(() => Effect.succeed([] as typeof _SCHEMA.WebhookSettings.Type['webhooks'])));
			const register = (tenantId: string, input: { active: boolean; endpoint: WebhookEndpoint; eventTypes: readonly string[] }) => update(tenantId, (webhooks) => [...webhooks, { active: false, endpoint: input.endpoint, eventTypes: [...input.eventTypes] }]).pipe(
				Effect.andThen(_verifyOwnership(input.endpoint)),
				Effect.andThen(update(tenantId, (webhooks) => webhooks.map((webhook) => webhook.endpoint.url === input.endpoint.url ? { ...webhook, active: input.active } : webhook))),
				Effect.catchTag('WebhookError', (error) => error.reason === 'VerificationFailed' ? update(tenantId, (webhooks) => webhooks.filter((webhook) => webhook.endpoint.url !== input.endpoint.url)).pipe(Effect.andThen(Effect.fail(error))) : Effect.fail(error)),
			);
			const remove = (tenantId: string, endpointUrl: string) => update(tenantId, (webhooks) => webhooks.filter((webhook) => webhook.endpoint.url !== endpointUrl));
			return { get, invalidate, list, register, remove } as const;
		})();
		const deliver = (endpoint: WebhookEndpoint, payloads: WebhookPayload | readonly WebhookPayload[]) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => Effect.forEach(Array.isArray(payloads) ? payloads : [payloads], (payload) => delivery.execute('deliver', tenantId, endpoint, payload).pipe(Effect.either), { concurrency: _CONFIG.concurrency.batch })));
		const retry = (dlqId: string) => database.jobDlq.one([{ field: 'id', value: dlqId }]).pipe(
			Effect.provideService(SqlClient.SqlClient, sql),
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(WebhookError.from('NetworkError', dlqId)),
					onSome: (entry: typeof JobDlq.Type) => {
						const retryPayload = _UTIL.dlqPayload(entry);
						return settings.get(entry.appId).pipe(Effect.flatMap((current) => Option.match(Option.flatMap(retryPayload.endpoint, (endpointUrl) => Option.fromNullable(current.webhooks.find((webhook) => webhook.endpoint.url === endpointUrl))), {
							onNone: () => Effect.fail(WebhookError.from('NetworkError', dlqId, { cause: 'Endpoint not found' })),
							onSome: (registration) => Clock.currentTimeMillis.pipe(
								Effect.flatMap((timestamp) => delivery.execute('deliver', entry.appId, registration.endpoint, new WebhookPayload({ data: retryPayload.data, id: crypto.randomUUID(), timestamp, type: _UTIL.normalizeDlqType(entry.type) }))),
								Effect.andThen(database.jobDlq.markReplayed(dlqId).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
							),
						})));
					},
				})),
			Telemetry.span('webhook.retry', { 'dlq.id': dlqId, metrics: false }),
		);
		const status = (tenantId: string, endpointUrl?: string) => settings.get(tenantId).pipe(Effect.flatMap((current) => delivery.status(tenantId, endpointUrl ? [endpointUrl] : current.webhooks.map((webhook) => webhook.endpoint.url))), Effect.catchAll(() => Effect.succeed([])));
		const test = (tenantId: string, endpoint: WebhookEndpoint) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => {
			const deliveryId = crypto.randomUUID();
			return delivery.execute('test', tenantId, endpoint, new WebhookPayload({ data: { test: true }, id: deliveryId, timestamp, type: 'webhook.test' }), deliveryId);
		}));
		yield* Effect.forkScoped(eventBus.subscribe('app.settings.updated', S.Struct({ _tag: S.Literal('app'), action: S.Literal('settings.updated') }), (event) => settings.invalidate(event.tenantId).pipe(Effect.ignore)).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain));
		yield* Effect.forkScoped(eventBus.stream().pipe(Stream.mapEffect((envelope) => settings.get(envelope.event.tenantId).pipe(
			Effect.flatMap((current) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => {
				const payload = new WebhookPayload({ data: envelope.event.payload, id: envelope.event.eventId, timestamp, type: envelope.event.eventType });
				const matching = current.webhooks.filter((webhook) => webhook.active && webhook.eventTypes.includes(envelope.event.eventType));
				return Effect.forEach(matching, (webhook) => delivery.execute('deliver', envelope.event.tenantId, webhook.endpoint, payload).pipe(Effect.ignore), { concurrency: 'unbounded', discard: true });
			}))),
			Effect.catchAll(() => Effect.void),
		)), Stream.runDrain));
		yield* Effect.logInfo('WebhookService initialized');
		return { deliver, invalidateSettings: settings.invalidate, list: settings.list, register: settings.register, remove: settings.remove, retry, status, test, verifyOwnership: _verifyOwnership };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly DeliveryRecord = _SCHEMA.DeliveryRecord;
	static readonly DeliveryResult = _SCHEMA.DeliveryResult;
	static readonly httpDeliver = _httpDeliver;
	static readonly Endpoint = WebhookEndpoint;
	static readonly Error = WebhookError;
	static readonly Payload = WebhookPayload;
	static readonly Settings = _SCHEMA.WebhookSettings;
	static readonly Workflow = _WebhookWorkflow;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebhookService {
	export type ErrorReason = WebhookError['reason'];
	export type DeliveryOutcome = Either.Either<typeof _SCHEMA.DeliveryResult.Type, WebhookError>;
	export type DeliveryRecord = typeof _SCHEMA.DeliveryRecord.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebhookService };
