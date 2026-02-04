/**
 * Outbound webhook delivery via @effect/cluster durable execution.
 * HMAC signatures, idempotent delivery, dead-letter integration.
 */
import { ClusterWorkflowEngine } from '@effect/cluster';
import { Activity, Workflow, WorkflowEngine } from '@effect/workflow';
import { FetchHttpClient, HttpClient, HttpClientRequest } from '@effect/platform';
import { Cause, Chunk, Clock, Config, Duration, Effect, type Either, Layer, Metric, Option, Schedule, Schema as S, Stream } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Crypto } from '../security/crypto.ts';
import { ClusterService } from './cluster.ts';
import { EventBus } from './events.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	concurrency: { batch: 10 },
	retry: { base: Duration.millis(500), cap: Duration.seconds(30), maxAttempts: 5 },
	signature: { format: (d: string) => `sha256=${d}`, header: 'X-Webhook-Signature' },
} as const;
const _ErrorProps = {
	CircuitOpen: 	{ retryable: false, terminal: false },
	InvalidResponse:{ retryable: true,  terminal: false },
	MaxRetries: 	{ retryable: false, terminal: true  },
	NetworkError: 	{ retryable: true,  terminal: false },
	SignatureError: { retryable: false, terminal: true  },
	Timeout: 		{ retryable: true,  terminal: false },
} as const satisfies Record<typeof _ErrorReason.Type, { retryable: boolean; terminal: boolean }>;

// --- [SCHEMAS] ---------------------------------------------------------------

const _WebhookSubscription = S.Struct({
	active: S.Boolean,
	endpoint: S.suspend(() => WebhookEndpoint),
	eventTypes: S.Array(S.String),
});
const WebhookSettings = S.Struct({webhooks: S.optionalWith(S.Array(_WebhookSubscription), { default: () => [] }),});
const _ErrorReason = S.Literal('CircuitOpen', 'InvalidResponse', 'MaxRetries', 'NetworkError', 'SignatureError', 'Timeout');
const _DeliveryResult = S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number });

// --- [CLASSES] ---------------------------------------------------------------

class WebhookEndpoint extends S.Class<WebhookEndpoint>('WebhookEndpoint')({
	secret: S.String.pipe(S.minLength(32)),
	timeout: S.optionalWith(S.Number, { default: () => 5000 }),
	url: S.String.pipe(S.pattern(/^https:\/\//), S.brand('WebhookUrl')),
}) {}
class WebhookPayload extends S.Class<WebhookPayload>('WebhookPayload')({
	data: S.Unknown,
	id: S.String,
	timestamp: S.Number,
	type: S.String,
}) {}
class WebhookError extends S.TaggedError<WebhookError>()('WebhookError', {
	cause: S.optional(S.Unknown),
	deliveryId: S.optional(S.String),
	reason: _ErrorReason,
	statusCode: S.optional(S.Number),
}) {
	static readonly from = (reason: typeof _ErrorReason.Type, deliveryId?: string, opts?: { cause?: unknown; statusCode?: number }) => new WebhookError({ deliveryId, reason, ...opts });
	get isRetryable(): boolean { return _ErrorProps[this.reason].retryable; }
	get isTerminal(): boolean { return _ErrorProps[this.reason].terminal; }
}
class DeliverActivityInput extends Effect.Tag('DeliverActivityInput')<DeliverActivityInput, {
	readonly endpoint: WebhookEndpoint;
	readonly payload: WebhookPayload;
}>() {}

// --- [ACTIVITY] --------------------------------------------------------------

const DeliverActivity = Activity.make({
	error: WebhookError,
	execute: Effect.gen(function* () {
		const { endpoint, payload } = yield* DeliverActivityInput;
		const baseClient = yield* HttpClient.HttpClient;
		const requestId = (yield* Context.Request.current).requestId;
		const deliveryId = payload.id;
		const signature = yield* Crypto.hmac(endpoint.secret, JSON.stringify(payload)).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)),);
		const request = HttpClientRequest.post(endpoint.url).pipe(
			HttpClientRequest.bodyUnsafeJson(payload),
			HttpClientRequest.setHeaders({
				'Content-Type': 'application/json',
				'X-Delivery-Id': deliveryId,
				'x-request-id': requestId,
				[_CONFIG.signature.header]: _CONFIG.signature.format(signature),
			}),
		);
		const client = baseClient.pipe(
			HttpClient.filterStatusOk,
			HttpClient.retryTransient({ schedule: Schedule.exponential(_CONFIG.retry.base).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(_CONFIG.retry.maxAttempts)), Schedule.upTo(_CONFIG.retry.cap)) }),
			HttpClient.withTracerPropagation(true),
		);
		const timeout = Duration.millis(endpoint.timeout);
		const [duration, response] = yield* Effect.timed(
			client.execute(request).pipe(
				Effect.scoped,
				Effect.timeoutFail({ duration: timeout, onTimeout: () => WebhookError.from('Timeout', deliveryId) }),
				Effect.mapError((error): WebhookError => {
					const typed = error as { _tag?: string; response?: { status?: number } } | null;
					const status = typed?._tag === 'ResponseError' ? typed.response?.status : undefined;
					return status === undefined
						? WebhookError.from('NetworkError', deliveryId, { cause: error })
						: WebhookError.from(status >= 400 && status < 500 ? 'InvalidResponse' : 'NetworkError', deliveryId, { cause: error, statusCode: status });
				}),
			),
		);
		const deliveredAt = yield* Clock.currentTimeMillis;
		return { deliveredAt, durationMs: Duration.toMillis(duration), statusCode: response.status };
	}),
	name: 'webhook.deliver',
	success: _DeliveryResult,
});

// --- [WORKFLOW] --------------------------------------------------------------

const WebhookWorkflow = Workflow.make({
	error: WebhookError,
	idempotencyKey: ({ payload }) => payload.id,
	name: 'webhook',
	payload: { endpoint: WebhookEndpoint, payload: WebhookPayload },
	success: _DeliveryResult,
});

// --- [SERVICES] --------------------------------------------------------------

class WebhookService extends Effect.Service<WebhookService>()('server/Webhooks', {
	dependencies: [
		DatabaseService.Default,
		EventBus.Default,
		FetchHttpClient.layer,
		MetricsService.Default,
		WebhookWorkflow.toLayer(Effect.fn(function* ({ endpoint, payload }, _executionId) {
			const database = yield* DatabaseService;
			return yield* DeliverActivity.pipe(
				Activity.retry({ times: _CONFIG.retry.maxAttempts, while: (error) => error.isRetryable }),
				Effect.provideService(DeliverActivityInput, { endpoint, payload }),
				WebhookWorkflow.withCompensation((_value, cause) => Context.Request.currentTenantId.pipe(
					Effect.flatMap((tenantId) => database.jobDlq.insert({
						appId: tenantId, attempts: _CONFIG.retry.maxAttempts,
						errorHistory: [{ error: Cause.pretty(cause), timestamp: Date.now() }], errorReason: 'MaxRetries',
						originalJobId: payload.id, payload: { data: payload.data, endpoint: endpoint.url },
						replayedAt: Option.none(), requestId: Option.none(), source: 'webhook', type: `webhook:${payload.type}`, userId: Option.none(),
					})), Effect.ignore)),
			);
		})).pipe(Layer.provide(DatabaseService.Default)),
		Layer.unwrapEffect(Config.string('NODE_ENV').pipe(Config.withDefault('development'), Effect.map((env) => env === 'production' ? ClusterWorkflowEngine.layer.pipe(Layer.provide(ClusterService.Layer)) : WorkflowEngine.layerMemory))),
	],
	scoped: Effect.gen(function* () {
		const database = yield* DatabaseService;
		const eventBus = yield* EventBus;
		const metrics = yield* MetricsService;
		const _deliverSingle = (tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload) => {	// Internal single-payload delivery with metrics/telemetry
			const labels = MetricsService.label({ endpoint: new URL(endpoint.url).host, operation: 'webhook.deliver' });
			return Context.Request.within(tenantId, WebhookWorkflow.execute({ endpoint, payload }).pipe(
				Effect.tap((result) => eventBus.emit({
					aggregateId: payload.id,
					payload: { _tag: 'webhook', action: 'delivered', durationMs: result.durationMs, endpoint: endpoint.url, statusCode: result.statusCode },
					tenantId,
				}).pipe(Effect.ignore)),
				Effect.tapError((error) => eventBus.emit({
					aggregateId: payload.id,
					payload: { _tag: 'webhook', action: 'failed', endpoint: endpoint.url, reason: 'reason' in error ? error.reason : String(error) },
					tenantId,
				}).pipe(Effect.ignore)),
				Effect.tapError(() => Metric.increment(Metric.taggedWithLabels(metrics.events.deadLettered, labels))),
				(eff) => MetricsService.trackEffect(eff, { duration: metrics.events.deliveryLatency, errors: metrics.errors, labels }),
				Telemetry.span('webhook.deliver', { 'webhook.type': payload.type, 'webhook.url': endpoint.url }),
			));
		};
		function deliver(endpoint: WebhookEndpoint, payload: WebhookPayload): Effect.Effect<WebhookService.DeliveryOutcome | undefined>;
		function deliver(endpoint: WebhookEndpoint, payloads: readonly WebhookPayload[]): Effect.Effect<readonly WebhookService.DeliveryOutcome[]>;
		function deliver(endpoint: WebhookEndpoint, payloads: WebhookPayload | readonly WebhookPayload[]) {
			const isBatch = Array.isArray(payloads);
			const items = isBatch ? Chunk.fromIterable(payloads) : Chunk.of(payloads);
			const results = Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) =>
				Stream.fromIterable(items).pipe(
					Stream.mapEffect((payload) => _deliverSingle(tenantId, endpoint, payload).pipe(Effect.either), { concurrency: _CONFIG.concurrency.batch }),
					Stream.runCollect,
					Effect.map(Chunk.toReadonlyArray),
				),
			));
			return isBatch ? results : results.pipe(Effect.map((r) => r[0]));
		}
		yield* Effect.forkScoped(	// EventWebhookBridge: Subscribe to domain events and trigger configured webhooks
			eventBus.onEvent().pipe(
				Stream.mapEffect((envelope) => database.apps.one([{ field: 'id', value: envelope.event.tenantId }]).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Effect.void,
						onSome: (app) => Effect.gen(function* () {
							const rawSettings = Option.getOrElse(app.settings, () => ({}));
							const settings = yield* S.decodeUnknown(WebhookSettings)(rawSettings).pipe(Effect.orElseSucceed(() => ({ webhooks: [] })));
							const matching = settings.webhooks.filter((webhook) => webhook.active && webhook.eventTypes.includes(envelope.event.eventType));
							const payload = new WebhookPayload({
								data: envelope.event.payload,
								id: envelope.event.eventId,
								timestamp: Date.now(),
								type: envelope.event.eventType,
							});
							yield* Effect.forEach(
								matching,
								(webhook) => _deliverSingle(envelope.event.tenantId, webhook.endpoint, payload).pipe(Effect.ignore),
								{ concurrency: 'unbounded', discard: true },
							);
						}),
					})),
				)),
				Stream.runDrain,
			),
		);
		yield* Effect.logInfo('WebhookService initialized');
		return { deliver };
	}),
}) {
	static readonly Config = _CONFIG;
	static readonly Endpoint = WebhookEndpoint;
	static readonly Error = WebhookError;
	static readonly Payload = WebhookPayload;
	static readonly Workflow = WebhookWorkflow;
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace WebhookService {
	export type ErrorReason = WebhookError['reason'];
	export type DeliveryOutcome = Either.Either<typeof _DeliveryResult.Type, WebhookError>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebhookService };
