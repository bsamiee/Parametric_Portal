/**
 * Outbound webhook delivery via @effect/cluster durable execution.
 * HMAC signatures, idempotent delivery, dead-letter integration.
 */
import { ClusterWorkflowEngine } from '@effect/cluster';
import { Activity, Workflow, WorkflowEngine } from '@effect/workflow';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Cause, Clock, Config, Duration, Effect, type Either, HashMap, Layer, Match, Metric, Option, PrimaryKey, Ref, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { JobDlq } from '@parametric-portal/database/models';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { CacheService } from '../platform/cache.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';
import { Crypto } from '../security/crypto.ts';
import { EventBus } from './events.ts';
import { ClusterService } from './cluster.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _ErrorReason = S.Literal('CircuitOpen', 'InvalidResponse', 'MaxRetries', 'NetworkError', 'SignatureError', 'Timeout');
const _DeliveryResult = S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number });
const _DeliveryRecord = S.Struct({
	deliveredAt: S.optional(S.Number), deliveryId: S.String, durationMs: S.optional(S.Number), endpointUrl: S.String,
	error: S.optional(S.String), status: S.Literal('delivered', 'failed'), statusCode: S.optional(S.Number),
	tenantId: S.String, timestamp: S.Number, type: S.String,
});
const _WebhookSettings = S.Struct({ webhooks: S.optionalWith(S.Array(S.Struct({
	active: S.Boolean,
	endpoint: S.suspend(() => WebhookEndpoint),
	eventTypes: S.Array(S.String),
})), { default: () => [] }) });
const _CONFIG = {
	concurrency: { batch: 10, perEndpoint: 5 },
	retry: { base: Duration.millis(500), cap: Duration.seconds(30), maxAttempts: 5 },
	signature: { format: (digest: string) => `sha256=${digest}`, header: 'X-Webhook-Signature' },
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class WebhookEndpoint extends S.Class<WebhookEndpoint>('WebhookEndpoint')({
	secret: S.String.pipe(S.minLength(32)),
	timeout: S.optionalWith(S.Number, { default: () => 5000 }),
	url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')),
}) {}
class WebhookPayload extends S.Class<WebhookPayload>('WebhookPayload')({ data: S.Unknown, id: S.String, timestamp: S.Number, type: S.String }) {}

// --- [ERRORS] ----------------------------------------------------------------

class WebhookError extends S.TaggedError<WebhookError>()('WebhookError', {
	cause: S.optional(S.Unknown),
	deliveryId: S.optional(S.String),
	reason: _ErrorReason,
	statusCode: S.optional(S.Number),
}) {
	static readonly _props = {
		CircuitOpen:     { retryable: false, terminal: false },
		InvalidResponse: { retryable: true,  terminal: false },
		MaxRetries:      { retryable: false, terminal: true  },
		NetworkError:    { retryable: true,  terminal: false },
		SignatureError:  { retryable: false, terminal: true  },
		Timeout:         { retryable: true,  terminal: false },
	} as const satisfies Record<typeof _ErrorReason.Type, { retryable: boolean; terminal: boolean }>;
	static readonly from = (reason: typeof _ErrorReason.Type, deliveryId?: string, opts?: { cause?: unknown; statusCode?: number }) => new WebhookError({ deliveryId, reason, ...opts });
	static readonly mapHttp = (deliveryId: string) => (error: unknown): WebhookError =>
		error instanceof WebhookError
			? error
			: Match.value(error).pipe(
				Match.when((candidate: unknown): candidate is HttpClientError.ResponseError => candidate instanceof HttpClientError.ResponseError, (responseError) =>
					WebhookError.from(responseError.response.status >= 400 && responseError.response.status < 500 ? 'InvalidResponse' : 'NetworkError', deliveryId, { cause: error, statusCode: responseError.response.status }),
				),
				Match.orElse(() => WebhookError.from('NetworkError', deliveryId, { cause: error })),
			);
	get isRetryable(): boolean { return WebhookError._props[this.reason].retryable; }
	get isTerminal(): boolean { return WebhookError._props[this.reason].terminal; }
}
class _WebhookSettingsKey extends S.TaggedRequest<_WebhookSettingsKey>()('WebhookSettingsKey', {
	failure: WebhookError,
	payload: { tenantId: S.String },
	success: _WebhookSettings,
}) {[PrimaryKey.symbol]() { return `webhook:settings:${this.tenantId}`; }}

// --- [WORKFLOW] --------------------------------------------------------------

const _WebhookWorkflow = Workflow.make({
	error: WebhookError,
	idempotencyKey: ({ payload }) => payload.id,
	name: 'webhook',
	payload: { endpoint: WebhookEndpoint, payload: WebhookPayload },
	success: _DeliveryResult,
});

// --- [LAYERS] ----------------------------------------------------------------

const _Engine = Layer.unwrapEffect(Config.string('NODE_ENV').pipe(
	Config.withDefault('development'),
	Effect.map((environment) => Match.value(environment).pipe(
		Match.when('production', () => ClusterWorkflowEngine.layer.pipe(Layer.provide(ClusterService.Layers.runner))),
		Match.orElse(() => WorkflowEngine.layerMemory),
	)),
));

// --- [FUNCTIONS] -------------------------------------------------------------

const _httpDeliver = (endpoint: WebhookEndpoint, payload: WebhookPayload, deliveryId: string, options?: { readonly extraHeaders?: Record<string, string>; readonly retryTransient?: boolean }) =>
	Effect.gen(function* () {
		const baseClient = yield* HttpClient.HttpClient;
		const signature = yield* Crypto.hmac(endpoint.secret, JSON.stringify(payload)).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)));
		const request = HttpClientRequest.post(endpoint.url).pipe(
			HttpClientRequest.bodyUnsafeJson(payload),
			HttpClientRequest.setHeaders({
				'Content-Type': 'application/json', 'X-Delivery-Id': deliveryId,
				[_CONFIG.signature.header]: _CONFIG.signature.format(signature), ...options?.extraHeaders,
			}),
		);
		const client = options?.retryTransient
			? baseClient.pipe(HttpClient.filterStatusOk, HttpClient.retryTransient({ schedule: Resilience.schedule({ base: _CONFIG.retry.base, cap: _CONFIG.retry.cap, maxAttempts: _CONFIG.retry.maxAttempts }) }), HttpClient.withTracerPropagation(true))
			: baseClient.pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true));
		const [duration, response] = yield* Effect.timed(client.execute(request).pipe(
			Effect.scoped,
			Effect.timeoutFail({ duration: Duration.millis(endpoint.timeout), onTimeout: () => WebhookError.from('Timeout', deliveryId) }),
			Effect.mapError(WebhookError.mapHttp(deliveryId)),
		));
		const deliveredAt = yield* Clock.currentTimeMillis;
		return { deliveredAt, durationMs: Duration.toMillis(duration), statusCode: response.status };
	});
const _errorReason = (error: unknown) => Match.value(error).pipe(
	Match.when((candidate: unknown): candidate is WebhookError => candidate instanceof WebhookError, (webhookError) => webhookError.reason),
	Match.orElse(String),
);
const _dlqPayload = (entry: typeof JobDlq.Type) => Match.value(entry.payload).pipe(
	Match.when(
		(candidate: unknown): candidate is { readonly data: unknown; readonly endpoint?: string } => typeof candidate === 'object' && candidate !== null && 'data' in candidate,
		(candidate) => ({ data: candidate.data, endpoint: Option.fromNullable(candidate.endpoint) }),
	),
	Match.orElse((payload) => ({ data: payload, endpoint: Option.none<string>() })),
);
const _normalizeDlqType = (type: string) => type.startsWith('webhook:') ? type.slice('webhook:'.length) : type;

// --- [SERVICE] ---------------------------------------------------------------

class WebhookService extends Effect.Service<WebhookService>()('server/Webhooks', {
	dependencies: [
		CacheService.Persistence, DatabaseService.Default, EventBus.Default,
		FetchHttpClient.layer, MetricsService.Default, _Engine,
		_WebhookWorkflow.toLayer(({ endpoint, payload }) => Telemetry.span(
			Effect.gen(function* () {
				const database = yield* DatabaseService;
				const requestId = (yield* Context.Request.current).requestId;
				const deliverActivity = Activity.make({
					error: WebhookError,
					execute: _httpDeliver(endpoint, payload, payload.id, { extraHeaders: { 'x-request-id': requestId }, retryTransient: true }),
					name: 'webhook.deliver',
					success: _DeliveryResult,
				});
				return yield* deliverActivity.pipe(
					Activity.retry({ times: _CONFIG.retry.maxAttempts, while: (error) => error.isRetryable }),
					_WebhookWorkflow.withCompensation((_value, cause) => Context.Request.currentTenantId.pipe(
						Effect.flatMap((tenantId) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => database.jobDlq.insert({
							appId: tenantId, attempts: _CONFIG.retry.maxAttempts,
							errorHistory: [{ error: Cause.pretty(cause), timestamp }], errorReason: 'MaxRetries',
							originalJobId: payload.id, payload: { data: payload.data, endpoint: endpoint.url },
							replayedAt: Option.none(), requestId: Option.none(), source: 'webhook', type: `webhook:${payload.type}`, userId: Option.none(),
						})))),
						Effect.ignore,
					)),
				);
			}),
			'webhook.workflow.execute',
			{ metrics: false, 'webhook.type': payload.type, 'webhook.url': endpoint.url },
		)).pipe(Layer.provide(DatabaseService.Default)),
	],
	scoped: Effect.gen(function* () {
		const [cache, database, eventBus, metrics, sql] = yield* Effect.all([CacheService, DatabaseService, EventBus, MetricsService, SqlClient.SqlClient]);
		const throttles = yield* Ref.make(HashMap.empty<string, Effect.Semaphore>());
		const settingsCache = yield* CacheService.cache<_WebhookSettingsKey, never>({
			lookup: (key) => Context.Request.withinSync(key.tenantId, database.apps.one([{ field: 'id', value: key.tenantId }])).pipe(
				Effect.flatMap(Option.match({ onNone: () => Effect.succeed({ webhooks: [] }), onSome: (app) => S.decodeUnknown(_WebhookSettings)(Option.getOrElse(app.settings, () => ({})), { errors: 'all', onExcessProperty: 'ignore' }) })),
				Effect.catchAll(() => Effect.succeed({ webhooks: [] })),
				Effect.provideService(SqlClient.SqlClient, sql),
			),
			storeId: 'webhook-settings',
			timeToLive: Duration.minutes(5),
		});
			const _getThrottle = (hostname: string) => Ref.get(throttles).pipe(Effect.flatMap((map) =>
				Option.match(HashMap.get(map, hostname), {
					onNone: () => Effect.makeSemaphore(_CONFIG.concurrency.perEndpoint).pipe(Effect.tap((sem) => Ref.update(throttles, HashMap.set(hostname, sem)))),
					onSome: Effect.succeed,
				}),
			));
				const _legacyStatusKey = (tenantId: string, endpointUrl: string) => `webhook:delivery:${tenantId}:${new URL(endpointUrl).hostname}`;
				const _statusKey = (tenantId: string, endpointUrl: string) => `webhook:delivery:${tenantId}:${encodeURIComponent(endpointUrl)}`;
				const _recordDelivery = (tenantId: string, deliveryId: string, endpointUrl: string, type: string, result: { status: 'delivered'; deliveredAt: number; durationMs: number; statusCode: number } | { status: 'failed'; error: string }) =>
					Clock.currentTimeMillis.pipe(
						Effect.flatMap((timestamp) => Effect.all([
							cache.kv.set(_statusKey(tenantId, endpointUrl), { ...result, deliveryId, endpointUrl, tenantId, timestamp, type } satisfies typeof _DeliveryRecord.Type, Duration.days(7)),
							cache.kv.set(_legacyStatusKey(tenantId, endpointUrl), { ...result, deliveryId, endpointUrl, tenantId, timestamp, type } satisfies typeof _DeliveryRecord.Type, Duration.days(7)),
						], { discard: true })),
						Effect.ignore,
					);
			const _deliveryContext = (tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload, operation: 'webhook.deliver' | 'webhook.test') => {
				const endpointHost = new URL(endpoint.url).hostname;
				return {
					endpoint,
					endpointHost,
					labels: MetricsService.label({ endpoint_host: endpointHost, operation, tenant: tenantId }),
					payload,
					tenantId,
				} as const;
			};
			const _updateSettings = (tenantId: string, transform: (webhooks: typeof _WebhookSettings.Type['webhooks']) => typeof _WebhookSettings.Type['webhooks']) =>
				settingsCache.get(new _WebhookSettingsKey({ tenantId })).pipe(
					Effect.flatMap((settings) => Context.Request.withinSync(tenantId, database.apps.updateSettings(tenantId, { webhooks: transform(settings.webhooks) })).pipe(
						Effect.provideService(SqlClient.SqlClient, sql),
						Effect.andThen(invalidateSettings(tenantId)),
					)),
					Effect.mapError((error) => WebhookError.from('NetworkError', undefined, { cause: error })),
				);
			const _deliverSingle = (tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload) => {
				const context = _deliveryContext(tenantId, endpoint, payload, 'webhook.deliver');
				const requestContext = Context.Request.system(crypto.randomUUID());
				return _getThrottle(context.endpointHost).pipe(
					Effect.flatMap((semaphore) => semaphore.withPermits(1)(Context.Request.within(context.tenantId, _WebhookWorkflow.execute({
						endpoint: context.endpoint,
						payload: context.payload,
					}).pipe(
						Effect.tap((result) => Effect.all([
							eventBus.publish({
								aggregateId: context.payload.id,
								payload: { _tag: 'webhook', action: 'delivered', durationMs: result.durationMs, endpoint: context.endpoint.url, statusCode: result.statusCode },
								tenantId: context.tenantId,
							}).pipe(Effect.ignore),
							_recordDelivery(context.tenantId, context.payload.id, context.endpoint.url, context.payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode }),
						], { discard: true })),
						Effect.tapError((error) => Effect.all([
							eventBus.publish({
								aggregateId: context.payload.id,
								payload: { _tag: 'webhook', action: 'failed', endpoint: context.endpoint.url, reason: _errorReason(error) },
								tenantId: context.tenantId,
							}).pipe(Effect.ignore),
							Metric.increment(Metric.taggedWithLabels(metrics.events.deadLettered, context.labels)),
							_recordDelivery(context.tenantId, context.payload.id, context.endpoint.url, context.payload.type, { error: _errorReason(error), status: 'failed' }),
						], { discard: true })),
						(effect) => MetricsService.trackEffect(effect, { duration: metrics.events.deliveryLatency, errors: metrics.errors, labels: context.labels }),
						Telemetry.span('webhook.deliver', { metrics: false, 'webhook.endpoint_host': context.endpointHost, 'webhook.type': context.payload.type, 'webhook.url': context.endpoint.url }),
					), requestContext))),
				);
			};
			const deliver = (endpoint: WebhookEndpoint, payloads: WebhookPayload | readonly WebhookPayload[]) =>
				Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) =>
					Effect.forEach(Array.isArray(payloads) ? payloads : [payloads], (payload) => _deliverSingle(tenantId, endpoint, payload).pipe(Effect.either), { concurrency: _CONFIG.concurrency.batch }),
				));
			const invalidateSettings = (tenantId: string) => settingsCache.invalidate(new _WebhookSettingsKey({ tenantId }));
			const list = (tenantId: string) => settingsCache.get(new _WebhookSettingsKey({ tenantId })).pipe(
				Effect.map((settings) => settings.webhooks),
				Effect.catchAll(() => Effect.succeed([] as typeof _WebhookSettings.Type['webhooks'])),
			);
			const register = (tenantId: string, input: { active: boolean; endpoint: WebhookEndpoint; eventTypes: readonly string[] }) =>
				_updateSettings(tenantId, (webhooks) => [...webhooks, { active: input.active, endpoint: input.endpoint, eventTypes: [...input.eventTypes] }]);
			const remove = (tenantId: string, endpointUrl: string) =>
				_updateSettings(tenantId, (webhooks) => webhooks.filter((webhook) => webhook.endpoint.url !== endpointUrl));
			const retry = (dlqId: string) => database.jobDlq.one([{ field: 'id', value: dlqId }]).pipe(
				Effect.provideService(SqlClient.SqlClient, sql),
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(WebhookError.from('NetworkError', dlqId)),
					onSome: (entry: typeof JobDlq.Type) => {
						const tenantId = entry.appId;
						const retryPayload = _dlqPayload(entry);
						return settingsCache.get(new _WebhookSettingsKey({ tenantId })).pipe(Effect.flatMap((settings) =>
							Option.match(Option.flatMap(retryPayload.endpoint, (endpointUrl) =>
								Option.fromNullable(settings.webhooks.find((webhook) => webhook.endpoint.url === endpointUrl)),
							), {
								onNone: () => Effect.fail(WebhookError.from('NetworkError', dlqId, { cause: 'Endpoint not found' })),
								onSome: (registration) => Clock.currentTimeMillis.pipe(
									Effect.flatMap((timestamp) => _deliverSingle(tenantId, registration.endpoint, new WebhookPayload({
										data: retryPayload.data,
										id: crypto.randomUUID(),
										timestamp,
										type: _normalizeDlqType(entry.type),
									}))),
									Effect.andThen(database.jobDlq.markReplayed(dlqId).pipe(Effect.provideService(SqlClient.SqlClient, sql))),
								),
							}),
						));
					},
				})),
					Telemetry.span('webhook.retry', { 'dlq.id': dlqId, metrics: false }),
			);
				const status = (tenantId: string, endpointUrl?: string) => settingsCache.get(new _WebhookSettingsKey({ tenantId })).pipe(
					Effect.flatMap((settings) => Effect.forEach(
						endpointUrl ? [endpointUrl] : settings.webhooks.map((webhook) => webhook.endpoint.url),
						(url) => cache.kv.get(_statusKey(tenantId, url), _DeliveryRecord).pipe(
							Effect.flatMap(Option.match({
								onNone: () => cache.kv.get(_legacyStatusKey(tenantId, url), _DeliveryRecord),
								onSome: (value) => Effect.succeed(Option.some(value)),
							})),
							Effect.map(Option.toArray),
							Effect.catchAll(() => Effect.succeed([])),
						),
						{ concurrency: 'unbounded' },
					)),
				Effect.map((results) => results.flat()),
				Effect.catchAll(() => Effect.succeed([])),
			);
			const test = (tenantId: string, endpoint: WebhookEndpoint) => Clock.currentTimeMillis.pipe(
				Effect.flatMap((timestamp) => {
					const deliveryId = crypto.randomUUID();
					const payload = new WebhookPayload({ data: { test: true }, id: deliveryId, timestamp, type: 'webhook.test' });
					const context = _deliveryContext(tenantId, endpoint, payload, 'webhook.test');
					return Context.Request.within(context.tenantId, _httpDeliver(context.endpoint, context.payload, deliveryId).pipe(
						Effect.tap((result) => _recordDelivery(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode })),
						Effect.tapError((error) => _recordDelivery(context.tenantId, deliveryId, context.endpoint.url, context.payload.type, { error: _errorReason(error), status: 'failed' })),
						(effect) => MetricsService.trackEffect(effect, { duration: metrics.events.deliveryLatency, errors: metrics.errors, labels: context.labels }),
						Telemetry.span('webhook.test', { metrics: false, 'webhook.endpoint_host': context.endpointHost, 'webhook.url': context.endpoint.url }),
					));
					}),
				);
		yield* Effect.forkScoped(eventBus.subscribe('app.settings.updated', S.Struct({ _tag: S.Literal('app'), action: S.Literal('settings.updated') }), (event) => invalidateSettings(event.tenantId).pipe(Effect.ignore)).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain),);
		yield* Effect.forkScoped(eventBus.stream().pipe(
			Stream.mapEffect((envelope) => settingsCache.get(new _WebhookSettingsKey({ tenantId: envelope.event.tenantId })).pipe(
				Effect.flatMap((settings) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => {
					const matching = settings.webhooks.filter((webhook) => webhook.active && webhook.eventTypes.includes(envelope.event.eventType));
					const payload = new WebhookPayload({ data: envelope.event.payload, id: envelope.event.eventId, timestamp, type: envelope.event.eventType });
					return Effect.forEach(matching, (webhook) => _deliverSingle(envelope.event.tenantId, webhook.endpoint, payload).pipe(Effect.ignore), { concurrency: 'unbounded', discard: true });
				}))),
				Effect.catchAll(() => Effect.void),
			)),
			Stream.runDrain,
			));
			yield* Effect.logInfo('WebhookService initialized');
			return { deliver, invalidateSettings, list, register, remove, retry, status, test };
		}),
	}) {
	static readonly Config = _CONFIG;
	static readonly DeliveryRecord = _DeliveryRecord;
	static readonly DeliveryResult = _DeliveryResult;
	static readonly httpDeliver = _httpDeliver;
	static readonly Endpoint = WebhookEndpoint;
	static readonly Error = WebhookError;
	static readonly Payload = WebhookPayload;
	static readonly Settings = _WebhookSettings;
	static readonly Workflow = _WebhookWorkflow;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebhookService {
	export type ErrorReason = WebhookError['reason'];
	export type DeliveryOutcome = Either.Either<typeof _DeliveryResult.Type, WebhookError>;
	export type DeliveryRecord = typeof _DeliveryRecord.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebhookService };
