/**
 * HTTP middleware: single class export consolidating auth, global pipeline, and CORS.
 * Middleware IS the HttpApiMiddleware.Tag class with pipeline() and layer() statics.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, type HttpApp, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import type { Hex64 } from '@parametric-portal/types/types';
import { isIP } from 'node:net';
import { Array as A, Config, Data, Duration, Effect, FiberRef, Layer, Match, Metric, Option, pipe, Redacted, Schema as S } from 'effect';
import { constant } from 'effect/Function';
import { Context } from './context.ts';
import { AuditService } from './observe/audit.ts';
import { HttpError } from './errors.ts';
import { MetricsService } from './observe/metrics.ts';
import { Telemetry } from './observe/telemetry.ts';
import { CacheService } from './platform/cache.ts';
import { Crypto } from './security/crypto.ts';
import { PolicyService } from './security/policy.ts';
import { FeatureService } from './domain/features.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cors: {
        allowedHeaders: ['content-type', 'authorization', 'x-api-key', Context.Request.Headers.appId, Context.Request.Headers.idempotencyKey, Context.Request.Headers.requestId, Context.Request.Headers.requestedWith, ...Context.Request.Headers.trace],
        allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
        allowedOrigins: ['*'],
        credentials:    false,
        exposedHeaders: [
            Context.Request.Headers.idempotencyOutcome,
            Context.Request.Headers.requestId,
            Context.Request.Headers.circuitState,
            Context.Request.Headers.rateLimit.limit,
            Context.Request.Headers.rateLimit.remaining,
            Context.Request.Headers.rateLimit.reset,
            Context.Request.Headers.rateLimit.retryAfter,
            'server-timing',
            ...Context.Request.Headers.trace,
            'content-disposition',
        ],
        maxAge: 7200
    },
    security: {
        base: {'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'} satisfies Record<string, string>,
        hsts: { includeSubDomains: true, maxAge: 31536000 }
    },
    tenantAsyncContextPrefixes: ['/api/v1/admin/events', '/api/v1/jobs/subscribe', '/api/v1/users/me/notifications/subscribe', '/api/v1/ws'] as ReadonlyArray<string>,
    tenantExemptPrefixes:       ['/api/health', '/api/v1/traces', '/api/v1/metrics', '/api/v1/logs', '/docs'] as ReadonlyArray<string>,
} as const;
const _IDEMPOTENCY = {
    completedTtl: Duration.hours(24),
    pendingTtl:   Duration.minutes(2),
} as const;
const _proxyConfig = Config.all({
    enabled: Config.map(
        Config.string('TRUST_PROXY').pipe(Config.withDefault('false')),
        (raw) => raw === 'true' || raw === '1',
    ),
    hops: Config.map(
        Config.integer('PROXY_HOPS').pipe(Config.withDefault(1)),
        (raw) => Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1,
    ),
});

// --- [SCHEMA] ----------------------------------------------------------------

const _IdempotencyRecord = S.Struct({
    bodyHash:     S.String,
    completedAt:  S.Number,
    key:          S.String,
    operationKey: S.String,
    result:       S.Unknown,
    status:       S.Literal('completed', 'pending'),
    tenantId:     S.String,
});

// --- [CLASSES] ---------------------------------------------------------------

class TenantResolution extends Data.TaggedError('TenantResolution')<{ readonly details: string; readonly error: string; readonly status: number; readonly tenantId?: string }> {}

// --- [GLOBAL_MIDDLEWARE] -----------------------------------------------------

const _trace = HttpMiddleware.make((app) => HttpServerRequest.HttpServerRequest.pipe(
    Effect.flatMap((req) => {
        const [urlPath, urlQuery] = req.url.split('?', 2) as [string, string | undefined];
        const queryAttrs = urlQuery === undefined ? {} : { 'url.query.length': String(urlQuery.length), 'url.query.present': true };
        return pipe(
            Telemetry.span(app, `HTTP ${req.method}`, { 'http.request.method': req.method, 'url.path': urlPath, 'url.scheme': Option.getOrElse(Headers.get(req.headers, Context.Request.Headers.forwardedProto), () => 'http'), kind: 'server', metrics: false, ...queryAttrs }),
            Effect.tap((res) => Effect.annotateCurrentSpan('http.response.status_code', res.status)),
            Effect.flatMap((response) => Effect.map(Effect.optionFromOptional(Effect.currentSpan), (span) => ({ response, span }))),
            (traced) => Option.match(HttpTraceContext.fromHeaders(req.headers), { onNone: () => traced, onSome: (parent) => Effect.withParentSpan(traced, parent) }),
        );
    }),
    Effect.map(({ response, span }) => Option.match(span, { onNone: () => response, onSome: (s) => HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(s)) })),
));
const _security = (hsts: typeof _CONFIG.security.hsts | false = _CONFIG.security.hsts) =>
    HttpMiddleware.make((app) => app.pipe(Effect.map((res) =>
        HttpServerResponse.setHeaders(res, hsts
            ? { ..._CONFIG.security.base, 'strict-transport-security': `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}` }
            : _CONFIG.security.base))));
// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------
const _makeRequestContext = (database: { readonly apps: { readonly byNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string; readonly status: 'active' | 'suspended' | 'archived' | 'purging' }>, unknown> } }) =>
    HttpMiddleware.make((app) => pipe(Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const proxyConfig = yield* _proxyConfig;
        const req = pipe(
            proxyConfig.enabled
                ? Option.firstSomeOf([
                pipe(
                    Headers.get(request.headers, Context.Request.Headers.forwardedFor),
                    Option.map((raw) => raw.split(',')),
                    Option.map(A.map((s: string) => s.trim())),
                    Option.map(A.filter((s): s is string => s !== '' && isIP(s) !== 0)),
                    Option.flatMap((segments) => A.get(segments, Math.max(0, segments.length - proxyConfig.hops - 1))),
                ),
                Option.filter(Headers.get(request.headers, Context.Request.Headers.cfConnectingIp), (value) => isIP(value) !== 0),
                Option.filter(Headers.get(request.headers, Context.Request.Headers.realIp), (value) => isIP(value) !== 0),
            ])
                : Option.none<string>(),
            Option.match({ onNone: () => request, onSome: (remoteAddress) => request.modify({ remoteAddress }) }),
        );
        const requestId = Option.match(Headers.get(req.headers, Context.Request.Headers.requestId), {
            onNone: crypto.randomUUID,
            onSome: (value) => S.is(S.UUID)(value) ? value : crypto.randomUUID(),
        });
        const namespaceOpt = Headers.get(req.headers, Context.Request.Headers.appId);
        const path = req.url.split('?', 2)[0] ?? '/';
        const tenant = yield* pipe(
            Option.match<string, ReturnType<typeof database.apps.byNamespace>>(namespaceOpt, {
                onNone: constant(Effect.if(A.some(_CONFIG.tenantExemptPrefixes, (prefix) => path === prefix || path.startsWith(`${prefix}/`)), { onTrue: constant(Effect.succeed(Option.some({ id: Context.Request.Id.system, namespace: '', status: 'active' as const }))), onFalse: constant(Effect.fail(new TenantResolution({ details: 'X-App-Id header is required', error: 'MissingTenantHeader', status: 400 }))) })),
                onSome: (namespace) => database.apps.byNamespace(namespace),
            }),
            Effect.flatMap(Option.match({
                onNone: constant(Effect.fail(new TenantResolution({ details: `Unknown X-App-Id: ${Option.getOrElse(namespaceOpt, constant(''))}`, error: 'UnknownTenantHeader', status: 400 }))),
                onSome: Effect.succeed,
            })),
        );
        const tenantId = yield* Match.value(tenant.status).pipe(
            Match.when('active', () => Effect.succeed(tenant.id)),
            Match.when('archived', () => Effect.fail(new TenantResolution({ details: 'Tenant is archived', error: 'TenantArchived', status: 410, tenantId: tenant.id }))),
            Match.when('suspended', () => Effect.fail(new TenantResolution({ details: 'Tenant is suspended', error: 'TenantSuspended', status: 503, tenantId: tenant.id }))),
            Match.when('purging', () => Effect.fail(new TenantResolution({ details: 'Tenant is being purged', error: 'TenantPurging', status: 503, tenantId: tenant.id }))),
            Match.exhaustive,
        );
        const { circuit, response } = yield* (A.some(_CONFIG.tenantAsyncContextPrefixes, (prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? Context.Request.within : Context.Request.withinSync)(
            tenantId,
            Effect.all([Effect.provideService(app, HttpServerRequest.HttpServerRequest, req), Context.Request.current]).pipe(
                Effect.map(([response, requestContext]) => ({ circuit: requestContext.circuit, response })),
                Effect.annotateSpans('tenant.id', tenantId),
                Effect.annotateSpans('request.id', requestId),
            ),
            { appNamespace: namespaceOpt, circuit: Option.none(), cluster: Option.none(), ipAddress: req.remoteAddress, rateLimit: Option.none(), requestId, session: Option.none(), tenantId, userAgent: Headers.get(req.headers, 'user-agent') },
        );
        const outcome = yield* FiberRef.get(_idempotencyOutcome);
        return HttpServerResponse.setHeaders(response, { [Context.Request.Headers.requestId]: requestId, ...pipe(circuit, Option.map((c) => ({ [Context.Request.Headers.circuitState]: c.state })), Option.getOrElse(constant({}))), ...pipe(outcome, Option.map((value) => ({ [Context.Request.Headers.idempotencyOutcome]: value })), Option.getOrElse(constant({}))) });
    }), Effect.catchAll((error) =>
        error instanceof TenantResolution
            ? Effect.succeed(HttpServerResponse.unsafeJson({ details: error.details, error: error.error, ...(error.tenantId ? { tenantId: error.tenantId } : {}) }, { status: error.status }))
            : Effect.logError('Request context middleware failed', { error: String(error) }).pipe(
                Effect.andThen(Effect.succeed(HttpServerResponse.unsafeJson({ details: 'Internal server error', error: 'RequestContextFailed' }, { status: 500 }))),
            ),
    )));
const _idempotencyOutcome = FiberRef.unsafeMake<Option.Option<string>>(Option.none());

// --- [FUNCTIONS] -------------------------------------------------------------
const _idempotent = <R extends string, A extends string, B, E, Deps>(
    key: string,
    resource: R,
    action: A,
    effect: Effect.Effect<B, E, Deps>,
) => Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const tenantId = yield* Context.Request.currentTenantId;
    const operationKey = `${resource}:${action}`;
    const cacheKey = `idem:${tenantId}:${resource}:${action}:${key}`;
    // [WHY] `request.text` is safe here — @effect/platform memoizes body via Effect.cached per-instance
    const bodyText = yield* request.text.pipe(Effect.catchAll(() => Effect.succeed('')));
    const bodyHash = yield* Crypto.hash(`${operationKey}:${bodyText}`);
    const pendingJson = JSON.stringify({ bodyHash, completedAt: 0, key, operationKey, result: null, status: 'pending' as const, tenantId } satisfies typeof _IdempotencyRecord.Type);
    const { alreadyExists } = yield* CacheService.setNX(cacheKey, pendingJson, _IDEMPOTENCY.pendingTtl);
    return yield* alreadyExists
        ? CacheService.kv.get(cacheKey, _IdempotencyRecord).pipe(
            Effect.flatMap(Option.match({
                onNone: () => pipe(
                    FiberRef.set(_idempotencyOutcome, Option.some('expired')),
                    Effect.andThen(Effect.fail(HttpError.Conflict.of('idempotency', `expired: ${key}`))),
                ),
                onSome: (record) => Match.value(record).pipe(
                    Match.when({ status: 'pending' }, () => pipe(
                        FiberRef.set(_idempotencyOutcome, Option.some('conflict')),
                        Effect.andThen(Effect.fail(HttpError.Conflict.of('idempotency', `in-flight: ${key} [retry-after: ${Duration.toSeconds(_IDEMPOTENCY.pendingTtl)}]`))),
                    )),
                    Match.when({ bodyHash: (h: string) => h === bodyHash }, (matched) => pipe( // [WHY] Cast to B: no response schema available in generic middleware. TTL bounds staleness; callers version idempotency keys across schema changes.
                        FiberRef.set(_idempotencyOutcome, Option.some('replayed')),
                        Effect.as(matched.result as B),
                        Effect.provideService(HttpServerRequest.HttpServerRequest, request),
                    )),
                    Match.orElse(() => pipe(
                        FiberRef.set(_idempotencyOutcome, Option.some('conflict')),
                        Effect.andThen(Effect.fail(HttpError.Conflict.of('idempotency', `conflict: ${key}`))),
                    )),
                ),
            })),
        )
        : pipe(
            Effect.sync(() => Date.now()),
            Effect.flatMap((startedAt) => effect.pipe(
                Effect.tap((result) => CacheService.kv.set(cacheKey, {
                    bodyHash, completedAt: startedAt, key, operationKey, result, status: 'completed' as const, tenantId,
                } satisfies typeof _IdempotencyRecord.Type, _IDEMPOTENCY.completedTtl)),
                Effect.tap(() => FiberRef.set(_idempotencyOutcome, Option.some('new'))),
                Effect.onError(() => CacheService.kv.del(cacheKey).pipe(Effect.ignore)),
            )),
        );
}).pipe(Effect.annotateLogs({ operation: 'Middleware.idempotency' }));

// --- [SERVICES] --------------------------------------------------------------

class Middleware extends HttpApiMiddleware.Tag<Middleware>()('server/Middleware', {
    failure: S.Union(HttpError.Auth, HttpError.Forbidden, HttpError.Internal),
    security: {bearer: HttpApiSecurity.bearer, apiKey: HttpApiSecurity.apiKey({ key: 'X-API-Key', in: 'header' }),},
    }) {
    static readonly permission = <
        R extends keyof typeof PolicyService.Catalog,
        A extends (typeof PolicyService.Catalog)[R][number],
    >(resource: R, action: A) =>
        PolicyService.pipe(
            Effect.flatMap((policy) => policy.require(resource, action)),
            Effect.mapError((error) =>
                error instanceof HttpError.Auth || error instanceof HttpError.Forbidden || error instanceof HttpError.Internal
                    ? error
                    : HttpError.Internal.of('Permission check failed', error),
            ),
        );
    static readonly feature = <K extends keyof typeof FeatureService.FeatureFlagsSchema.Type>(flagName: K) =>
        FeatureService.pipe(
            Effect.flatMap((features) => features.require(flagName)),
            Effect.mapError((error) =>
                error instanceof HttpError.Auth || error instanceof HttpError.Forbidden || error instanceof HttpError.Internal
                    ? error
                    : HttpError.Internal.of('Feature check failed', error),
            ),
        );
    static readonly guarded = <R extends keyof typeof PolicyService.Catalog, A extends (typeof PolicyService.Catalog)[R][number], B, E, Deps>(
        resource: R, action: A, preset: 'api' | 'mutation' | 'realtime', effect: Effect.Effect<B, E, Deps>,
    ) => CacheService.rateLimit(preset, Middleware.permission(resource, action).pipe(
        Effect.andThen(preset === 'mutation'
            ? HttpServerRequest.HttpServerRequest.pipe(
                Effect.flatMap((req) => pipe(
                    Headers.get(req.headers, Context.Request.Headers.idempotencyKey),
                    Option.match({
                        onNone: () => effect,
                        onSome: (key) => _idempotent(key, resource, action, effect),
                    }),
                )),
            )
            : effect
        ),
    ));
    static readonly _makeAuthLayer = (
        sessionLookup: (hash: Hex64) => Effect.Effect<Option.Option<Context.Request.Session>, unknown>,
        apiKeyLookup: (hash: Hex64) => Effect.Effect<Option.Option<{ readonly id: string; readonly userId: string }>, unknown>,) =>
        Layer.effect(this, Effect.map(Effect.all([MetricsService, AuditService, SqlClient.SqlClient]), ([metrics, audit, sqlClient]) => Middleware.of({
            bearer: Effect.fn(function* (token: Redacted.Redacted<string>) {
                const tenantId = yield* Context.Request.currentTenantId;
                const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
                yield* Metric.increment(metrics.auth.session.lookups);
                const sessionOpt = yield* Context.Request.within(tenantId, sessionLookup(hash)).pipe(
                    Effect.provideService(SqlClient.SqlClient, sqlClient),
                    Effect.catchAll((error) =>
                        Effect.logError('Session lookup failed', { error: String(error) }).pipe(
                            Effect.andThen(Effect.fail(HttpError.Internal.of('Session lookup failed', error))),
                        )),
                );
                const session = yield* Effect.fromNullable(Option.getOrUndefined(sessionOpt)).pipe(
                    Effect.tapError(constant(Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true }))),
                    Effect.mapError(constant(HttpError.Auth.of('Invalid session'))),
                );
                yield* Context.Request.update({ session: Option.some(session) }).pipe(
                    Effect.tap(constant(Metric.increment(metrics.auth.session.hits))),
                );
            }),
            apiKey: Effect.fn(function* (token: Redacted.Redacted<string>) {
                const tenantId = yield* Context.Request.currentTenantId;
                const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
                yield* Metric.increment(metrics.auth.apiKey.lookups);
                const keyOpt = yield* Context.Request.within(tenantId, apiKeyLookup(hash)).pipe(
                    Effect.provideService(SqlClient.SqlClient, sqlClient),
                    Effect.catchAll((error) =>
                        Effect.logError('API key lookup failed', { error: String(error) }).pipe(
                            Effect.andThen(Effect.fail(HttpError.Internal.of('API key lookup failed', error))),
                        )),
                );
                const key = yield* Effect.fromNullable(Option.getOrUndefined(keyOpt)).pipe(
                    Effect.tapError(constant(Effect.all([Metric.increment(metrics.auth.apiKey.misses), audit.log('auth_failure', { details: { reason: 'invalid_api_key' } })], { discard: true }))),
                    Effect.mapError(constant(HttpError.Auth.of('Invalid API key'))),
                );
                yield* Context.Request.update({ session: Option.some({ appId: tenantId, id: key.id, kind: 'apiKey', mfaEnabled: false, userId: key.userId, verifiedAt: Option.none() }) }).pipe(Effect.tap(constant(Metric.increment(metrics.auth.apiKey.hits))));
            }),
        })));
    static readonly pipeline = (database: Parameters<typeof _makeRequestContext>[0], options?: { readonly hsts?: Parameters<typeof _security>[0] }) =>
        (app: HttpApp.Default) => app.pipe(
            _trace,
            _makeRequestContext(database),
            _security(options?.hsts),
            HttpMiddleware.make((app) => Effect.timed(app).pipe(Effect.map(([duration, response]) => HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${Duration.toMillis(duration)}`)))),
            MetricsService.middleware,
        );
    static readonly layer = (config: {
        readonly sessionLookup: Middleware.SessionLookup;
        readonly apiKeyLookup: Middleware.ApiKeyLookup;
        readonly cors?: ReadonlyArray<string>;
    }) => Layer.merge(
        Middleware._makeAuthLayer(config.sessionLookup, config.apiKeyLookup),
        pipe((config.cors ?? _CONFIG.cors.allowedOrigins).map((o) => o.trim()).filter(Boolean), (list) => HttpApiBuilder.middlewareCors({ ..._CONFIG.cors, allowedOrigins: list, credentials: !list.includes('*') && _CONFIG.cors.credentials })),
    );
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace Middleware {
    export type SessionLookup = Parameters<typeof Middleware._makeAuthLayer>[0];
    export type ApiKeyLookup =  Parameters<typeof Middleware._makeAuthLayer>[1];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware };
