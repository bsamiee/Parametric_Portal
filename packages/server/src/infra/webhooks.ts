/**
 * Outbound webhook delivery via @effect/cluster durable execution.
 * HMAC signatures, idempotent delivery, dead-letter integration.
 */
import { ClusterWorkflowEngine } from '@effect/cluster';
import { Activity, Workflow } from '@effect/workflow';
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Cause, Clock, Config, Duration, Effect, Function as F, Layer, Match, Metric, Option, PrimaryKey, Array as Arr, Schema as S, STM, Stream, TMap } from 'effect';
import type { JobDlq } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';
import { Crypto } from '../security/crypto.ts';
import { EventBus } from './events.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    concurrency: { perEndpoint: 5 },
    delivery: { statusTtl: Duration.days(7) },
    retry: { maxAttempts: 5 },
    settings: { cacheTtl: Duration.minutes(5) },
    signature: { format: (digest: string) => `sha256=${digest}`, header: 'X-Webhook-Signature' },
    verification: Config.all({
        maxRetries: Config.integer('WEBHOOK_VERIFY_MAX_RETRIES').pipe(Config.withDefault(3)),
        timeoutMs:  Config.integer('WEBHOOK_VERIFY_TIMEOUT_MS').pipe(Config.withDefault(10_000))
    }),
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
    DeliveryRecord:  S.Struct({ deliveredAt: S.optional(S.Number), deliveryId: S.String, durationMs: S.optional(S.Number), endpointUrl: S.String, error: S.optional(S.String), status: S.Literal('delivered', 'failed'), statusCode: S.optional(S.Number), tenantId: S.String, timestamp: S.Number, type: S.String }),
    DeliveryResult:  S.Struct({ deliveredAt: S.Number, durationMs: S.Number, statusCode: S.Number }),
    ErrorReason:     S.Literal('InvalidResponse', 'MaxRetries', 'NetworkError', 'NotFound', 'SignatureError', 'Timeout', 'VerificationFailed'),
    RetryPayload:    S.Struct({ data: S.Unknown, endpoint: S.optional(S.suspend(() => WebhookEndpoint)) }),
    WebhookSettings: S.Struct({ webhooks: S.optionalWith(S.Array(S.Struct({ active: S.Boolean, endpoint: S.suspend(() => WebhookEndpoint), eventTypes: S.Array(S.String) })), { default: () => [] }) }),
} as const;

// --- [CLASSES] ---------------------------------------------------------------

class WebhookPayload extends S.Class<WebhookPayload>('WebhookPayload')({ data: S.Unknown, id: S.String, schemaVersion: S.optionalWith(S.Int.pipe(S.between(1, 255)), { default: () => 1 }), timestamp: S.Number, type: S.String }) {}
class WebhookEndpoint extends S.Class<WebhookEndpoint>('WebhookEndpoint')({ secret: S.String.pipe(S.minLength(32)), timeout: S.optionalWith(S.Number, { default: () => 5000 }), url: S.String.pipe(S.pattern(/^https:\/\/[a-zA-Z0-9]/), S.brand('WebhookUrl')) }) {}
class WebhookError extends S.TaggedError<WebhookError>()('WebhookError', { cause: S.optional(S.Unknown), deliveryId: S.optional(S.String), reason: _SCHEMA.ErrorReason, statusCode: S.optional(S.Number) }) {
    static readonly _props = {
        InvalidResponse: { retryable: false, terminal: true }, MaxRetries:      { retryable: false, terminal: true },
        NetworkError:   { retryable: true,  terminal: false }, NotFound:        { retryable: false, terminal: true }, SignatureError:   { retryable: false, terminal: true }, Timeout: { retryable: true, terminal: false }, VerificationFailed: { retryable: false, terminal: true },
    } as const satisfies Record<typeof _SCHEMA.ErrorReason.Type, { retryable: boolean; terminal: boolean }>;
    static readonly from = (reason: typeof _SCHEMA.ErrorReason.Type, deliveryId?: string, opts?: { cause?: unknown; statusCode?: number }) => new WebhookError({ deliveryId, reason, ...opts });
    static readonly mapHttp = (deliveryId: string) => (error: unknown): WebhookError => error instanceof WebhookError ? error : Match.value(error).pipe(
        Match.when((candidate: unknown): candidate is HttpClientError.ResponseError => candidate instanceof HttpClientError.ResponseError, (responseError) => WebhookError.from(responseError.response.status >= 400 && responseError.response.status < 500 ? 'InvalidResponse' : 'NetworkError', deliveryId, { cause: error, statusCode: responseError.response.status })),
        Match.orElse(() => WebhookError.from('NetworkError', deliveryId, { cause: error })),
    );
    get isRetryable(): boolean { return WebhookError._props[this.reason].retryable; }
    get isTerminal(): boolean { return WebhookError._props[this.reason].terminal; }
}
class WebhookSettingsKey extends S.TaggedRequest<WebhookSettingsKey>()('WebhookSettingsKey', { failure: WebhookError, payload: { tenantId: S.String }, success: _SCHEMA.WebhookSettings }) { [PrimaryKey.symbol]() { return `webhook:settings:${this.tenantId}`; } }

// --- [FUNCTIONS] -------------------------------------------------------------

const _WebhookWorkflow = Workflow.make({ error: WebhookError, idempotencyKey: ({ endpoint, payload }) => `${payload.id}:${endpoint.url}`, name: 'webhook', payload: { endpoint: WebhookEndpoint, payload: WebhookPayload }, success: _SCHEMA.DeliveryResult });
const _httpDeliver = (endpoint: WebhookEndpoint, payload: WebhookPayload, deliveryId: string, options?: { readonly extraHeaders?: Record<string, string> }) => Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient;
    const payloadJson = yield* S.encode(S.parseJson(WebhookPayload))(payload).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)));
    const signature = yield* Crypto.hmac(endpoint.secret, payloadJson).pipe(Effect.mapError(() => WebhookError.from('SignatureError', deliveryId)));
    const request = HttpClientRequest.post(endpoint.url).pipe(
        HttpClientRequest.bodyText(payloadJson, 'application/json'),
        HttpClientRequest.setHeaders({ 'X-Delivery-Id': deliveryId, [_CONFIG.signature.header]: _CONFIG.signature.format(signature), ...options?.extraHeaders }),
    );
    const client = baseClient.pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true));
    const [duration, response] = yield* Effect.timed(client.execute(request).pipe(Effect.scoped, Effect.timeoutFail({ duration: Duration.millis(endpoint.timeout), onTimeout: () => WebhookError.from('Timeout', deliveryId) }), Effect.mapError(WebhookError.mapHttp(deliveryId))));
    const deliveredAt = yield* Clock.currentTimeMillis;
    return { deliveredAt, durationMs: Duration.toMillis(duration), statusCode: response.status };
});
const _verifyOwnership = (endpoint: WebhookEndpoint) => Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient;
    const { maxRetries, timeoutMs } = yield* _CONFIG.verification;
    const challenge = crypto.randomUUID();
    const request = HttpClientRequest.post(endpoint.url).pipe(HttpClientRequest.bodyUnsafeJson({ challenge, type: 'webhook.verification' }), HttpClientRequest.setHeaders({ 'Content-Type': 'application/json' }));
    const response = yield* baseClient.pipe(HttpClient.filterStatusOk, HttpClient.withTracerPropagation(true)).execute(request).pipe(
        Effect.flatMap((raw) => raw.json), Effect.flatMap(S.decodeUnknown(S.Struct({ challenge: S.String }))), Effect.scoped,
        Effect.timeoutFail({ duration: Duration.millis(timeoutMs), onTimeout: () => WebhookError.from('Timeout', undefined, { cause: 'Verification timed out' }) }),
        Effect.mapError((error) => error instanceof WebhookError ? error : Match.value(error).pipe(
            Match.when((candidate: unknown): candidate is HttpClientError.ResponseError => candidate instanceof HttpClientError.ResponseError, (responseError) =>
                WebhookError.from(responseError.response.status >= 400 && responseError.response.status < 500 ? 'InvalidResponse' : 'NetworkError', undefined, { cause: error, statusCode: responseError.response.status })),
            Match.orElse(() => WebhookError.from('InvalidResponse', undefined, { cause: error })),
        )),
        Effect.retry({
            times: maxRetries,
            while: (error) => !(error instanceof WebhookError)
                || error.reason === 'Timeout'
                || error.reason === 'NetworkError',
        }),
        Effect.mapError((error) => error instanceof WebhookError ? error : WebhookError.from('VerificationFailed', undefined, { cause: error })),
    );
    return response.challenge === challenge ? true : yield* Effect.fail(WebhookError.from('VerificationFailed', undefined, { cause: `Challenge mismatch: expected ${challenge}, got ${response.challenge}` }));
}).pipe(Telemetry.span('webhook.verify_ownership', { metrics: false, 'webhook.url': endpoint.url }));
const _makeDeliveryEngine = (deps: { readonly cache: typeof CacheService.Service; readonly eventBus: typeof EventBus.Service; readonly metrics: typeof MetricsService.Service; readonly throttles: TMap.TMap<string, Effect.Semaphore> }) => {
    const statusKey = (tenantId: string, endpointUrl: string) => `webhook:delivery:${tenantId}:${encodeURIComponent(endpointUrl)}`;
    const throttle = (hostname: string) => STM.commit(TMap.get(deps.throttles, hostname)).pipe(
        Effect.flatMap(Option.match({
            onNone: () => Effect.makeSemaphore(_CONFIG.concurrency.perEndpoint).pipe(Effect.tap((sem) => STM.commit(TMap.set(deps.throttles, hostname, sem))),),
            onSome: Effect.succeed,
        })),
    );
    const record = (tenantId: string, deliveryId: string, endpointUrl: string, type: string, result: { status: 'delivered'; deliveredAt: number; durationMs: number; statusCode: number } | { status: 'failed'; error: string }) =>
        Clock.currentTimeMillis.pipe(
            Effect.map((timestamp) => ({ ...result, deliveryId, endpointUrl, tenantId, timestamp, type } satisfies typeof _SCHEMA.DeliveryRecord.Type)),
            Effect.flatMap((entry) => deps.cache.kv.set(statusKey(tenantId, endpointUrl), entry, _CONFIG.delivery.statusTtl)),
            Effect.ignore,
        );
    const execute = (mode: 'deliver' | 'test', tenantId: string, endpoint: WebhookEndpoint, payload: WebhookPayload, deliveryId: string = payload.id) => {
        const endpointHost = new URL(endpoint.url).hostname;
        const labels = MetricsService.label({ endpoint_host: endpointHost, operation: `webhook.${mode}`, tenant: tenantId });
        const spanAttrs = { metrics: false as const, 'webhook.endpoint_host': endpointHost, 'webhook.type': payload.type, 'webhook.url': endpoint.url };
        const wrap = <A, E, R>(eff: Effect.Effect<A, E, R>) => MetricsService.trackEffect(eff, { duration: deps.metrics.events.deliveryLatency, errors: deps.metrics.errors, labels });
        return Match.value(mode).pipe(
            Match.when('deliver', () => {
                const recordSuccess = (result: typeof _SCHEMA.DeliveryResult.Type) => Effect.all([deps.eventBus.publish({ aggregateId: payload.id, payload: { _tag: 'webhook', action: 'delivered', durationMs: result.durationMs, endpoint: endpoint.url, statusCode: result.statusCode }, tenantId }).pipe(Effect.ignore), record(tenantId, deliveryId, endpoint.url, payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode })], { discard: true });
                const recordError = (error: unknown) => Effect.all([deps.eventBus.publish({ aggregateId: payload.id, payload: { _tag: 'webhook', action: 'failed', endpoint: endpoint.url, reason: error instanceof WebhookError ? error.reason : String(error) }, tenantId }).pipe(Effect.ignore), Metric.increment(Metric.taggedWithLabels(deps.metrics.events.deadLettered, labels)), record(tenantId, deliveryId, endpoint.url, payload.type, { error: error instanceof WebhookError ? error.reason : String(error), status: 'failed' })], { discard: true });
                return wrap(throttle(endpointHost).pipe(Effect.flatMap((semaphore) => semaphore.withPermits(1)(Context.Request.within(tenantId, _WebhookWorkflow.execute({ endpoint, payload }), Context.Request.system(crypto.randomUUID()))))).pipe(Effect.tap(recordSuccess), Effect.tapError(recordError))).pipe(Telemetry.span('webhook.deliver', spanAttrs));
            }),
            Match.orElse(() => {
                const recordResult = (result: typeof _SCHEMA.DeliveryResult.Type) => record(tenantId, deliveryId, endpoint.url, payload.type, { deliveredAt: result.deliveredAt, durationMs: result.durationMs, status: 'delivered', statusCode: result.statusCode });
                return wrap(Context.Request.within(tenantId, _httpDeliver(endpoint, payload, deliveryId)).pipe(Effect.tap(recordResult), Effect.tapError((error) => record(tenantId, deliveryId, endpoint.url, payload.type, { error: error instanceof WebhookError ? error.reason : String(error), status: 'failed' })))).pipe(Telemetry.span('webhook.test', spanAttrs));
            }),
        );
    };
    const status = (tenantId: string, endpointUrls: readonly string[]) => Effect.forEach(
        endpointUrls,
        (url) => deps.cache.kv.get(statusKey(tenantId, url), _SCHEMA.DeliveryRecord).pipe(Effect.map(Option.toArray)),
        { concurrency: 'unbounded' },
    ).pipe(Effect.map(Arr.flatten));
    return { execute, status } as const;
};

// --- [SERVICES] --------------------------------------------------------------

class WebhookService extends Effect.Service<WebhookService>()('server/Webhooks', {
    dependencies: [
            CacheService.Persistence, DatabaseService.Default, EventBus.Default,
            FetchHttpClient.layer, MetricsService.Default, ClusterWorkflowEngine.layer,
            _WebhookWorkflow.toLayer(({ endpoint, payload }) => Telemetry.span(Effect.gen(function* () {
            const database = yield* DatabaseService;
            const requestId = (yield* Context.Request.current).requestId;
            const deliverActivity = Activity.make({ error: WebhookError, execute: _httpDeliver(endpoint, payload, payload.id, { extraHeaders: { [Context.Request.Headers.requestId]: requestId } }), name: 'webhook.deliver', success: _SCHEMA.DeliveryResult });
            return yield* deliverActivity.pipe(
                Activity.retry({ times: _CONFIG.retry.maxAttempts, while: (error) => error.isRetryable }),
                _WebhookWorkflow.withCompensation((_value, cause) => Effect.gen(function* () {
                    const tenantId = yield* Context.Request.currentTenantId;
                    const timestamp = yield* Clock.currentTimeMillis;
                    yield* Context.Request.withinSync(tenantId, database.jobDlq.insert({
                        appId: tenantId, attempts: _CONFIG.retry.maxAttempts, contextRequestId: Option.none(), contextUserId: Option.none(), errorReason: 'MaxRetries', errors: [{ error: Cause.pretty(cause), timestamp }],
                        payload: { data: payload.data, endpoint }, replayedAt: Option.none(), source: 'event', sourceId: payload.id, type: `webhook:${payload.type}`,
                    }));
                }).pipe(Effect.ignore)),
            );
            }), 'webhook.workflow.execute', { metrics: false, 'webhook.type': payload.type, 'webhook.url': endpoint.url })).pipe(Layer.provide(DatabaseService.Default)),
    ],
    scoped: Effect.gen(function* () {
        const [cache, database, eventBus, metrics, sql] = yield* Effect.all([CacheService, DatabaseService, EventBus, MetricsService, SqlClient.SqlClient]);
        const throttles = yield* STM.commit(TMap.empty<string, Effect.Semaphore>());
        const settingsCache = yield* CacheService.cache<WebhookSettingsKey, never, never>({
            lookup: (key) => Context.Request.withinSync(key.tenantId, database.apps.readSettings(key.tenantId)).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.succeed({ webhooks: [] }),
                    onSome: ({ settings }) => Effect.succeed(settings).pipe(
                        Effect.flatMap((settings) => S.decodeUnknown(_SCHEMA.WebhookSettings)(
                            { webhooks: settings.webhooks },
                            { errors: 'all', onExcessProperty: 'ignore' },
                        )),
                        Effect.mapError((cause) => WebhookError.from('VerificationFailed', undefined, { cause })),
                    ),
                })),
                Effect.mapError((error) => error instanceof WebhookError ? error : WebhookError.from('NetworkError', undefined, { cause: error })),
                Effect.provideService(SqlClient.SqlClient, sql),
            ),
            storeId: 'webhook-settings', timeToLive: _CONFIG.settings.cacheTtl,
        });
        const delivery = _makeDeliveryEngine({ cache, eventBus, metrics, throttles });
        const get = (tenantId: string) => settingsCache.get(new WebhookSettingsKey({ tenantId }));
        const invalidate = (tenantId: string) => settingsCache.invalidate(new WebhookSettingsKey({ tenantId }));
        const update = (tenantId: string, transform: (webhooks: typeof _SCHEMA.WebhookSettings.Type['webhooks']) => typeof _SCHEMA.WebhookSettings.Type['webhooks']) => Effect.gen(function* () {
            const appOption = yield* Context.Request.withinSync(tenantId, database.apps.readSettings(tenantId, 'update')).pipe(
                Effect.provideService(SqlClient.SqlClient, sql),
            );
            const app = yield* Option.match(appOption, {
                onNone: F.constant(Effect.fail(WebhookError.from('NotFound', undefined, { cause: `App not found: ${tenantId}` }))),
                onSome: Effect.succeed,
            });
            const current = yield* S.decodeUnknown(_SCHEMA.WebhookSettings)(
                { webhooks: app.settings.webhooks },
                { errors: 'all', onExcessProperty: 'ignore' },
            ).pipe(Effect.mapError((cause) => WebhookError.from('VerificationFailed', undefined, { cause })));
            yield* Context.Request.withinSync(tenantId, database.apps.updateSettings(tenantId, {
                ...app.settings,
                webhooks: transform(current.webhooks),
            })).pipe(Effect.provideService(SqlClient.SqlClient, sql));
            yield* invalidate(tenantId);
            yield* eventBus.publish({
                aggregateId: tenantId,
                payload: { _tag: 'app', action: 'settings.updated' },
                tenantId,
            }).pipe(Effect.ignore);
        }).pipe(Effect.mapError((error) => error instanceof WebhookError ? error : WebhookError.from('NetworkError', undefined, { cause: error })));
        const list = (tenantId: string) => get(tenantId).pipe(Effect.map((current) => current.webhooks));
        const register = (tenantId: string, input: { active: boolean; endpoint: WebhookEndpoint; eventTypes: readonly string[] }) => {
            const targetUrl = input.endpoint.url;
            const nextWebhook = {
                active: input.active,
                endpoint: input.endpoint,
                eventTypes: [...input.eventTypes],
            };
            return _verifyOwnership(input.endpoint).pipe(
                Effect.andThen(update(tenantId, (webhooks) => {
                    const replaced = Arr.map(webhooks, (webhook) => webhook.endpoint.url === targetUrl ? nextWebhook : webhook);
                    return Arr.some(webhooks, (webhook) => webhook.endpoint.url === targetUrl) ? replaced : Arr.append(replaced, nextWebhook);
                })),
            );
        };
        const remove = (tenantId: string, endpointUrl: string) => update(tenantId, (webhooks) => webhooks.filter((webhook) => webhook.endpoint.url !== endpointUrl));
        const settings = { get, invalidate, list, register, remove } as const;
        const retry = (dlqId: string) => database.jobDlq.one([{ field: 'id', value: dlqId }]).pipe(
            Effect.provideService(SqlClient.SqlClient, sql),
            Effect.flatMap(Option.match({
                onNone: F.constant(Effect.fail(WebhookError.from('NotFound', dlqId))),
                onSome: (entry: typeof JobDlq.Type) => Effect.gen(function* () {
                    const parsed = yield* S.decodeUnknown(_SCHEMA.RetryPayload)(entry.payload).pipe(
                        Effect.map((payload) => ({ data: payload.data, endpoint: Option.fromNullable(payload.endpoint) })),
                        Effect.orElseSucceed(() => ({ data: entry.payload, endpoint: Option.none<WebhookEndpoint>() })),
                    );
                    const dlqType = yield* Match.value(entry.type.startsWith('webhook:')).pipe(
                        Match.when(true, () => Effect.succeed(entry.type.replace(/^webhook:/, ''))),
                        Match.orElse(() => Effect.fail(WebhookError.from('NotFound', dlqId, { cause: `DLQ entry ${dlqId} is not a webhook delivery` }))),
                    );
                    const endpoint = yield* Option.match(parsed.endpoint, {
                        onNone: F.constant(Effect.fail(WebhookError.from('NotFound', dlqId, { cause: 'Endpoint snapshot missing' }))),
                        onSome: Effect.succeed,
                    });
                    const timestamp = yield* Clock.currentTimeMillis;
                    yield* delivery.execute('deliver', entry.appId, endpoint, new WebhookPayload({ data: parsed.data, id: crypto.randomUUID(), timestamp, type: dlqType }));
                    yield* database.jobDlq.markReplayed(dlqId).pipe(Effect.provideService(SqlClient.SqlClient, sql));
                }),
            })),
            Telemetry.span('webhook.retry', { 'dlq.id': dlqId, metrics: false }),
        );
        const status = (tenantId: string, endpointUrl?: string) => settings.get(tenantId).pipe(Effect.flatMap((current) => delivery.status(tenantId, endpointUrl ? [endpointUrl] : current.webhooks.map((webhook) => webhook.endpoint.url))));
        const test = (tenantId: string, endpoint: WebhookEndpoint) => Clock.currentTimeMillis.pipe(Effect.flatMap((timestamp) => delivery.execute('test', tenantId, endpoint, new WebhookPayload({ data: { test: true }, id: crypto.randomUUID(), timestamp, type: 'webhook.test' }))));
        const deliverEvent = (tenantId: string, eventType: string, payload: unknown, eventId?: string) => Clock.currentTimeMillis.pipe(
            Effect.flatMap((timestamp) => settings.get(tenantId).pipe(
                Effect.flatMap((current) => {
                    const webhookPayload = new WebhookPayload({ data: payload, id: eventId ?? crypto.randomUUID(), timestamp, type: eventType });
                    const matching = current.webhooks.filter((webhook) => webhook.active && webhook.eventTypes.includes(eventType));
                    return Effect.forEach(matching, (webhook) => delivery.execute('deliver', tenantId, webhook.endpoint, webhookPayload).pipe(Effect.ignore), { concurrency: 'unbounded', discard: true });
                }),
            )),
            Telemetry.span('webhook.deliverEvent', { metrics: false, 'webhook.tenant_id': tenantId, 'webhook.type': eventType }),
        );
        yield* Effect.forkScoped(eventBus.subscribe('app.settings.updated', { 1: S.Struct({ _tag: S.Literal('app'), action: S.Literal('settings.updated') }) }, (event) => settings.invalidate(event.tenantId).pipe(Effect.ignore)).pipe(Stream.catchAll(() => Stream.empty), Stream.runDrain));
        yield* Effect.logInfo('WebhookService initialized');
        return { deliverEvent, list: settings.list, register: settings.register, remove: settings.remove, retry, status, test };
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
    export type DeliveryRecord = typeof _SCHEMA.DeliveryRecord.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { WebhookService };
