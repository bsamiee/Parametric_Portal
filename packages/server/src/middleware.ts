/**
 * HTTP middleware composition: global filters, auth, and context factories.
 * Organized into 3 blocks: global, auth, context.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Sharding } from '@effect/cluster';
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import type { Hex64 } from '@parametric-portal/types/types';
import { Client } from '@parametric-portal/database/client';
import * as ipaddr from 'ipaddr.js';
import { Array as A, Cause, Config, Data, Duration, Effect, Layer, Match, Metric, Option, pipe, Redacted } from 'effect';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from './context.ts';
import { AuditService } from './observe/audit.ts';
import { HttpError } from './errors.ts';
import { MetricsService } from './observe/metrics.ts';
import { Telemetry } from './observe/telemetry.ts';
import { Crypto } from './security/crypto.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cors: {
		allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-App-Id', 'X-Request-Id', 'X-Requested-With', 'Traceparent', 'Tracestate', 'Baggage'],
		allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedOrigins: ['*'],
		credentials: false,
		exposedHeaders: ['X-Request-Id', 'X-Circuit-State', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After', 'Server-Timing', 'Traceparent', 'Tracestate', 'Baggage', 'Content-Disposition'],
		maxAge: 86400,
	},
	proxy: {
		cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'],
		hopsDefault: 1,
	},
	security: {
		base: {'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',} satisfies Record<string, string>,
		hsts: { includeSubDomains: true, maxAge: 31536000 },
	},
	tenantExemptPrefixes: ['/api/health', '/api/v1', '/docs'] as ReadonlyArray<string>,
} as const;
class _MissingTenantHeader extends Data.TaggedError('MissingTenantHeader')<Record<string, never>> {}
const _mapLookupError = (fallback: string) => (error: unknown): HttpError.Auth | HttpError.Internal => Match.value(error).pipe(
	Match.when(Cause.isNoSuchElementException, () => HttpError.Auth.of('Missing session')),
	Match.when((e: unknown): e is HttpError.Auth => e instanceof HttpError.Auth, (e) => e),
	Match.orElse((e: unknown) => HttpError.Internal.of(fallback, e)),
);
const requireMfaVerified = Context.Request.sessionOrFail.pipe(
	Effect.mapError(_mapLookupError('Session lookup failed')),
	Effect.filterOrFail((session) => !session.mfaEnabled || Option.isSome(session.verifiedAt), () => HttpError.Forbidden.of('MFA verification required')),
	Effect.asVoid,
);
const requireInteractiveSession = Context.Request.sessionOrFail.pipe(
	Effect.mapError(_mapLookupError('Session lookup failed')),
	Effect.filterOrFail((session) => session.kind === 'session', () => HttpError.Forbidden.of('Interactive session required')),
	Effect.asVoid,
);

// --- [GLOBAL_MIDDLEWARE] -----------------------------------------------------

const _extractClientIp = (proxy: { readonly enabled: boolean; readonly hops: number }, headers: Headers.Headers, directIp: Option.Option<string>): Option.Option<string> => {
	const trustedCidrs = A.filterMap(_CONFIG.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR));
	const isTrustedProxy = proxy.enabled && pipe(
		directIp,
		Option.flatMap(Option.liftThrowable(ipaddr.process)),
		Option.map((addr) => ipaddr.subnetMatch(addr, { trusted: trustedCidrs }, 'untrusted') === 'trusted'),
		Option.getOrElse(() => false),
	);
	return isTrustedProxy
		? Option.firstSomeOf([
				pipe(Headers.get(headers, 'x-forwarded-for'), Option.map((raw) => A.filter(raw.split(',').map((segment) => segment.trim()), (segment) => segment !== '' && ipaddr.isValid(segment))), Option.flatMap((xff) => A.get(xff, Math.max(0, xff.length - proxy.hops)))),
				Option.filter(Headers.get(headers, 'cf-connecting-ip'), ipaddr.isValid),
				Option.filter(Headers.get(headers, 'x-real-ip'), ipaddr.isValid),
			])
		: directIp;
};
const trace = HttpMiddleware.make((app) => HttpServerRequest.HttpServerRequest.pipe(
	Effect.flatMap((req) => pipe(
		Telemetry.span(app, 'http.request', { kind: 'server', metrics: false, 'http.method': req.method, 'http.target': req.url }),
		Effect.tap((res) => Effect.annotateCurrentSpan('http.status_code', res.status)),
		Effect.flatMap((response) => Effect.map(Effect.optionFromOptional(Effect.currentSpan), (span) => ({ response, span }))),
		(traced) => Option.match(HttpTraceContext.fromHeaders(req.headers), { onNone: () => traced, onSome: (parent) => Effect.withParentSpan(traced, parent) }),
	)),
	Effect.map(({ response, span }) => Option.match(span, { onNone: () => response, onSome: (s) => HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(s)) })),
));
const security = (hsts: typeof _CONFIG.security.hsts | false = _CONFIG.security.hsts) =>
	HttpMiddleware.make((app) => app.pipe(Effect.map((res) =>
		HttpServerResponse.setHeaders(res, hsts
			? { ..._CONFIG.security.base, 'strict-transport-security': `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}` }
			: _CONFIG.security.base))));
const serverTiming = HttpMiddleware.make((app) => Effect.timed(app).pipe(Effect.map(([duration, response]) => HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${Duration.toMillis(duration)}`))));

// --- [AUTH_MIDDLEWARE] -------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('server/SessionAuth', {
	failure: HttpError.Auth,
	security: {
		bearer: HttpApiSecurity.bearer,
		apiKey: HttpApiSecurity.apiKey({ key: 'X-API-Key', in: 'header' }),
	},
}) {
	static readonly makeLayer = (
		sessionLookup: (hash: Hex64) => Effect.Effect<Option.Option<Context.Request.Session>>,
		apiKeyLookup: (hash: Hex64) => Effect.Effect<Option.Option<{ readonly id: string; readonly userId: string; readonly expiresAt: Option.Option<Date> }>>,
	) =>
		Layer.effect(this, Effect.map(Effect.all([MetricsService, AuditService]), ([metrics, audit]) => SessionAuth.of({
				bearer: (token: Redacted.Redacted<string>) => Context.Request.currentTenantId.pipe(
					Effect.flatMap((tenantId) => Crypto.hmac(tenantId, Redacted.value(token))),
					Effect.tap(() => Metric.increment(metrics.auth.session.lookups)),
					Effect.flatMap(sessionLookup), // NOSONAR S3358
					Effect.flatMap(Option.match({
						onNone: () => Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid session')))),
						onSome: (session) => Context.Request.update({ session: Option.some({ ...session, kind: 'session' }) }).pipe(Effect.tap(() => Metric.increment(metrics.auth.session.hits))), // NOSONAR S3358
					})),
				),
				apiKey: (token: Redacted.Redacted<string>) => Context.Request.currentTenantId.pipe(
					Effect.flatMap((tenantId) => Crypto.hmac(tenantId, Redacted.value(token)).pipe(Effect.map((hash) => ({ hash, tenantId })))),
					Effect.tap(() => Metric.increment(metrics.auth.apiKey.lookups)),
					Effect.flatMap(({ hash, tenantId }) => apiKeyLookup(hash).pipe(Effect.map(Option.map((key) => ({ key, tenantId }))))),
					Effect.flatMap(Option.match({
						onNone: () => Effect.all([
							Metric.increment(metrics.auth.apiKey.misses),
							audit.log('auth_failure', { details: { reason: 'invalid_api_key' } }),
						], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid API key')))),
						onSome: ({ key, tenantId }) => {
							const expired = Option.match(key.expiresAt, { onNone: () => false, onSome: (expiry) => expiry < new Date() });
							return expired
								? Effect.fail(HttpError.Auth.of('API key expired'))
								: Context.Request.update({ session: Option.some({
									appId: tenantId,
									id: key.id,
									kind: 'apiKey',
									mfaEnabled: false,
									userId: key.userId,
									verifiedAt: Option.none(),
								}) }).pipe(Effect.tap(() => Metric.increment(metrics.auth.apiKey.hits)));
						},
				})),
			),
		})));
}
const requireRole = (min: Context.UserRole) => Context.Request.sessionOrFail.pipe(
	Effect.mapError(_mapLookupError('Session lookup failed')),
	Effect.flatMap(({ userId }) => DatabaseService.pipe(
		Effect.flatMap((repositories) => repositories.users.one([{ field: 'id', value: userId }])),
		Effect.map(Option.map((user) => ({ role: user.role }))),
	)),
	Effect.mapError(_mapLookupError('User lookup failed')),
	Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Forbidden.of('User not found')), onSome: Effect.succeed })),
	Effect.filterOrFail((user) => Context.UserRole.hasAtLeast(user.role, min), () => HttpError.Forbidden.of('Insufficient permissions')),
	Effect.asVoid,
);

// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------

const makeAppLookup =
	(database: { readonly apps: { readonly byNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> } }) =>
	(namespace: string): Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> => database.apps.byNamespace(namespace).pipe(Effect.map(Option.map((app) => ({ id: app.id, namespace: app.namespace }))));
const makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown>) =>
	HttpMiddleware.make((app) => pipe(Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const proxy = yield* Effect.orDie(Config.all({
			enabled: Config.string('TRUST_PROXY').pipe(Config.withDefault('false'), Config.map((v) => v === 'true' || v === '1')),
			hops: Config.integer('PROXY_HOPS').pipe(Config.withDefault(_CONFIG.proxy.hopsDefault)),
		}));
		const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
		const namespaceOpt = Headers.get(req.headers, 'x-app-id');
		const tenantId = yield* pipe(namespaceOpt, Option.match({	// No header → 400 (unless exempt path), found → app id, not found → unspecified (prevents cross-tenant mixing)
			onNone: () => A.some(_CONFIG.tenantExemptPrefixes, (prefix) => req.url.startsWith(prefix))
				? Effect.succeed(Context.Request.Id.default)
				: Effect.fail(new _MissingTenantHeader({})),
			onSome: (ns) => findByNamespace(ns).pipe(Effect.map(Option.match({ onNone: () => Context.Request.Id.unspecified, onSome: (a) => a.id })), Effect.catchAll(() => Effect.succeed(Context.Request.Id.unspecified))), // NOSONAR S3358
		}));
		const cluster = yield* Effect.serviceOption(Sharding.Sharding).pipe(		// Graceful degradation via serviceOption (avoids startup failures)
			Effect.flatMap(Option.match({
				onNone: () => Effect.succeedNone,
				onSome: (s) => Effect.map(s.getSnowflake, (sf): Option.Option<Context.Request.ClusterState> => Option.some({ // NOSONAR S3358
					entityId: null, entityType: null, isLeader: false, runnerId: Context.Request.makeRunnerId(sf), shardId: null,
				})),
			})),
		);
		const ctx: Context.Request.Data = {
			appNamespace: namespaceOpt,
			circuit: Option.none(),
			cluster,
			ipAddress: _extractClientIp(proxy, req.headers, req.remoteAddress),
			rateLimit: Option.none(),
			requestId,
			session: Option.none(),
			tenantId,
			userAgent: Headers.get(req.headers, 'user-agent'),
		};
		const { circuitState, response } = yield* Context.Request.within(
			tenantId,
			Effect.orDie(Client.tenant.with(tenantId, app.pipe(
				Effect.provideService(Context.Request, ctx),
				Effect.flatMap((response) => Context.Request.current.pipe(
					Effect.map((requestContext) => ({
						circuitState: pipe(requestContext.circuit, Option.map((c) => c.state), Option.getOrUndefined),
						response,
					})),
				)),
			))),
			ctx,
		);
		const headers = Option.fromNullable(circuitState).pipe(Option.match({
			onNone: () => ({ 'x-request-id': requestId }),
			onSome: (state) => ({ 'x-circuit-state': state, 'x-request-id': requestId }),
		}));
		return HttpServerResponse.setHeaders(response, headers);
	}), Effect.catchTag('MissingTenantHeader', () => HttpServerResponse.json({ details: 'X-App-Id header is required', error: 'MissingTenantHeader' }, { status: 400 }))));
const cors = (origins?: ReadonlyArray<string>) => pipe(
	(origins ?? _CONFIG.cors.allowedOrigins).map((o) => o.trim()).filter(Boolean),
	(list) => HttpApiBuilder.middlewareCors({ ..._CONFIG.cors, allowedOrigins: list, credentials: !list.includes('*') && _CONFIG.cors.credentials }),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Middleware = {
	// Global
	metrics: MetricsService.middleware,
	security,
	serverTiming,
	trace,
	xForwardedHeaders: HttpMiddleware.xForwardedHeaders,
	// Auth
	Auth: SessionAuth,
	requireInteractiveSession,
	requireMfaVerified,
	requireRole,
	// Context
	cors,
	makeAppLookup,
	makeRequestContext,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Middleware {
	export type SessionLookup = Parameters<typeof SessionAuth.makeLayer>[0];
	export type ApiKeyLookup = Parameters<typeof SessionAuth.makeLayer>[1];
	export type RequestContextLookup = Parameters<typeof makeRequestContext>[0];
	export type AppLookupDb = Parameters<typeof makeAppLookup>[0];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware };
