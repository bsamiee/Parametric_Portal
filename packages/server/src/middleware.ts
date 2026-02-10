/**
 * HTTP middleware: single class export consolidating auth, global pipeline, and CORS.
 * Middleware IS the HttpApiMiddleware.Tag class with pipeline() and layer() statics.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, type HttpApp, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import type { Hex64 } from '@parametric-portal/types/types';
import { isIP } from 'node:net';
import { Array as A, Data, Duration, Effect, Function as F, Layer, Metric, Option, pipe, Redacted, Schema as S } from 'effect';
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
		allowedHeaders: ['content-type', 'authorization', 'x-api-key', Context.Request.Headers.appId, Context.Request.Headers.requestId, Context.Request.Headers.requestedWith, ...Context.Request.Headers.trace],
		allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
		allowedOrigins: ['*'],
		credentials: false,
		exposedHeaders: [
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
		tenantAsyncContextPrefixes: ['/api/admin/events', '/api/jobs/subscribe', '/api/users/me/notifications/subscribe', '/api/ws'] as ReadonlyArray<string>,
		tenantExemptPrefixes: ['/api/health', '/api/v1/traces', '/api/v1/metrics', '/api/v1/logs', '/docs'] as ReadonlyArray<string>,
	} as const;
const _proxyConfig = (() => {
	const enabledRaw = process.env['TRUST_PROXY'] ?? 'false';
	const hopsRaw = Number(process.env['PROXY_HOPS'] ?? '1');
	return { enabled: enabledRaw === 'true' || enabledRaw === '1', hops: Number.isFinite(hopsRaw) && hopsRaw > 0 ? Math.floor(hopsRaw) : 1 } as const;
})();

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
const _serverTiming = HttpMiddleware.make((app) => Effect.timed(app).pipe(Effect.map(([duration, response]) => HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${Duration.toMillis(duration)}`))));

// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------

const _makeRequestContext = (database: { readonly apps: { readonly byNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string; readonly status: 'active' | 'suspended' | 'archived' }>, unknown> } }) =>
	HttpMiddleware.make((app) => pipe(Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
			const req = pipe(
				_proxyConfig.enabled
					? Option.firstSomeOf([
					pipe(
						Headers.get(request.headers, Context.Request.Headers.forwardedFor),
						Option.map((raw) => raw.split(',').map((segment) => segment.trim()).filter((segment): segment is string => segment !== '' && isIP(segment) !== 0)),
						Option.flatMap((segments) => A.get(segments, Math.max(0, segments.length - _proxyConfig.hops - 1))),
					),
					Option.filter(Headers.get(request.headers, Context.Request.Headers.cfConnectingIp), (value) => isIP(value) !== 0),
					Option.filter(Headers.get(request.headers, Context.Request.Headers.realIp), (value) => isIP(value) !== 0),
				])
					: Option.none<string>(),
				Option.match({ onNone: () => request, onSome: (remoteAddress) => request.modify({ remoteAddress }) }),
			);
			const requestIdHeader = Headers.get(req.headers, Context.Request.Headers.requestId);
			const requestId = Option.match(requestIdHeader, {
				onNone: crypto.randomUUID,
				onSome: (value) => S.is(S.UUID)(value) ? value : crypto.randomUUID(),
			});
			const namespaceOpt = Headers.get(req.headers, Context.Request.Headers.appId);
			const path = req.url.split('?', 2)[0] ?? '/';
			const isExemptPath = A.some(_CONFIG.tenantExemptPrefixes, (prefix) => path === prefix || path.startsWith(`${prefix}/`));
		const exemptEffect = Effect.succeed(Context.Request.Id.system);
		const missingHeaderEffect = Effect.fail(new (class extends Data.TaggedError('MissingTenantHeader')<Record<string, never>> {})({}));
		const exemptOrMissing = Effect.if(isExemptPath, { onTrue: F.constant(exemptEffect), onFalse: F.constant(missingHeaderEffect) });
		const tenantId = yield* Option.match(namespaceOpt, {
			onNone: F.constant(exemptOrMissing),
			onSome: (namespace) => database.apps.byNamespace(namespace).pipe(
				Effect.flatMap(Option.match({
					onNone: () => Effect.fail(new (class extends Data.TaggedError('UnknownTenantHeader')<{ readonly namespace: string }> {})({ namespace })),
					onSome: Effect.succeed,
				})),
				Effect.filterOrFail(
					(tenant) => tenant.status !== 'suspended',
					(tenant) => new (class extends Data.TaggedError('TenantSuspended')<{ readonly tenantId: string }> {})({ tenantId: tenant.id }),
				),
				Effect.filterOrFail(
					(tenant) => tenant.status !== 'archived',
					(tenant) => new (class extends Data.TaggedError('TenantArchived')<{ readonly tenantId: string }> {})({ tenantId: tenant.id }),
				),
				Effect.map((tenant) => tenant.id),
			),
			});
			const ipAddress: Option.Option<string> = req.remoteAddress;
			const isAsyncTenantContextPath = A.some(_CONFIG.tenantAsyncContextPrefixes, (prefix) => path === prefix || path.startsWith(`${prefix}/`));
			const withTenantContext = isAsyncTenantContextPath
				? Context.Request.within
				: Context.Request.within;
		const appWithRequest = Effect.provideService(app, HttpServerRequest.HttpServerRequest, req);
		const ctx: Context.Request.Data = { appNamespace: namespaceOpt, circuit: Option.none(), cluster: Option.none(), ipAddress, rateLimit: Option.none(), requestId, session: Option.none(), tenantId, userAgent: Headers.get(req.headers, 'user-agent') };
		const resultEffect = Effect.all([appWithRequest, Context.Request.current]).pipe(Effect.map(([response, requestContext]) => ({ circuit: requestContext.circuit, response })));
		const { circuit, response } = yield* withTenantContext(tenantId, resultEffect, ctx);
		const circuitState = Option.getOrUndefined(Option.map(circuit, (c) => c.state));
		return HttpServerResponse.setHeaders(response, { [Context.Request.Headers.requestId]: requestId, ...(circuitState ? { [Context.Request.Headers.circuitState]: circuitState } : {}) });
	}), Effect.catchTags({
		MissingTenantHeader: () => Effect.succeed(HttpServerResponse.unsafeJson({ details: 'X-App-Id header is required', error: 'MissingTenantHeader' }, { status: 400 })),
		TenantArchived: ({ tenantId }: { readonly tenantId: string }) => Effect.succeed(HttpServerResponse.unsafeJson({ details: 'Tenant is archived', error: 'TenantArchived', tenantId }, { status: 410 })),
		TenantSuspended: ({ tenantId }: { readonly tenantId: string }) => Effect.succeed(HttpServerResponse.unsafeJson({ details: 'Tenant is suspended', error: 'TenantSuspended', tenantId }, { status: 503 })),
		UnknownTenantHeader: ({ namespace }: { readonly namespace: string }) =>
			Effect.succeed(HttpServerResponse.unsafeJson({ details: `Unknown X-App-Id: ${namespace}`, error: 'UnknownTenantHeader' }, { status: 400 })),
		}), Effect.catchAll((error) =>
			Effect.logError('Request context middleware failed', { error: String(error) }).pipe(Effect.andThen(Effect.succeed(HttpServerResponse.unsafeJson({ details: 'Internal server error', error: 'RequestContextFailed' }, { status: 500 }))),)
		)));
const _cors = (origins?: ReadonlyArray<string>) => pipe(
	(origins ?? _CONFIG.cors.allowedOrigins).map((o) => o.trim()).filter(Boolean),
	(list) => HttpApiBuilder.middlewareCors({ ..._CONFIG.cors, allowedOrigins: list, credentials: !list.includes('*') && _CONFIG.cors.credentials }),
);

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
	static readonly feature = <K extends keyof typeof FeatureService.FlagRegistry.Type>(flagName: K) =>
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
	) => CacheService.rateLimit(preset, Middleware.permission(resource, action).pipe(Effect.andThen(effect)));
	static readonly _makeAuthLayer = (
		sessionLookup: (hash: Hex64) => Effect.Effect<Option.Option<Context.Request.Session>, unknown>,
		apiKeyLookup: (hash: Hex64) => Effect.Effect<Option.Option<{ readonly id: string; readonly userId: string }>, unknown>,) =>
				Layer.effect(this, Effect.map(Effect.all([MetricsService, AuditService, SqlClient.SqlClient]), ([metrics, audit, sqlClient]) => Middleware.of({
					bearer: (token: Redacted.Redacted<string>) => Effect.gen(function* () {
							const tenantId = yield* Context.Request.currentTenantId;
							const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
							const missingSessionEffect = Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true });
							yield* Metric.increment(metrics.auth.session.lookups);
								const sessionOpt = yield* Context.Request.within(tenantId, sessionLookup(hash)).pipe(
									Effect.provideService(SqlClient.SqlClient, sqlClient),
									Effect.catchAll((error) =>
										Effect.logError('Session lookup failed', { error: String(error) }).pipe(
											Effect.andThen(Effect.fail(HttpError.Internal.of('Session lookup failed', error))),
										)),
								);
							const session = yield* Effect.fromNullable(Option.getOrUndefined(sessionOpt)).pipe(
								Effect.tapError(F.constant(missingSessionEffect)),
								Effect.mapError(F.constant(HttpError.Auth.of('Invalid session'))),
							);
						yield* Context.Request.update({ session: Option.some(session) }).pipe(
							Effect.tap(F.constant(Metric.increment(metrics.auth.session.hits))),
						);
					}),
					apiKey: (token: Redacted.Redacted<string>) => Effect.gen(function* () {
							const tenantId = yield* Context.Request.currentTenantId;
							const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
							const missingKeyEffect = Effect.all([Metric.increment(metrics.auth.apiKey.misses), audit.log('auth_failure', { details: { reason: 'invalid_api_key' } })], { discard: true });
							yield* Metric.increment(metrics.auth.apiKey.lookups);
								const keyOpt = yield* Context.Request.within(tenantId, apiKeyLookup(hash)).pipe(
									Effect.provideService(SqlClient.SqlClient, sqlClient),
									Effect.catchAll((error) =>
										Effect.logError('API key lookup failed', { error: String(error) }).pipe(
											Effect.andThen(Effect.fail(HttpError.Internal.of('API key lookup failed', error))),
										)),
								);
								const key = yield* Effect.fromNullable(Option.getOrUndefined(keyOpt)).pipe(
									Effect.tapError(F.constant(missingKeyEffect)),
									Effect.mapError(F.constant(HttpError.Auth.of('Invalid API key'))),
								);
							const validKeyEffect = Context.Request.update({ session: Option.some({ appId: tenantId, id: key.id, kind: 'apiKey', mfaEnabled: false, userId: key.userId, verifiedAt: Option.none() }) }).pipe(Effect.tap(F.constant(Metric.increment(metrics.auth.apiKey.hits))));
							yield* validKeyEffect;
						}),
				})));
	static readonly pipeline = (database: Parameters<typeof _makeRequestContext>[0], options?: { readonly hsts?: typeof _CONFIG.security.hsts | false }) =>
		(app: HttpApp.Default) => app.pipe(
			_makeRequestContext(database),
			_trace,
			_security(options?.hsts),
			_serverTiming,
			MetricsService.middleware,
		);
	static readonly layer = (config: {
		readonly sessionLookup: Middleware.SessionLookup;
		readonly apiKeyLookup: Middleware.ApiKeyLookup;
		readonly cors?: ReadonlyArray<string>;
	}) => Layer.merge(
		Middleware._makeAuthLayer(config.sessionLookup, config.apiKeyLookup),
		_cors(config.cors),
	);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace Middleware {
	export type SessionLookup = Parameters<typeof Middleware._makeAuthLayer>[0];
	export type ApiKeyLookup = Parameters<typeof Middleware._makeAuthLayer>[1];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware };
