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
import { Array as A, Cause, Config, Duration, Effect, Layer, Match, Metric, Option, pipe, Redacted } from 'effect';
import { Context } from './context.ts';
import { AuditService } from './observe/audit.ts';
import { HttpError } from './errors.ts';
import { MetricsService } from './observe/metrics.ts';
import { Crypto } from './security/crypto.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	cors: {
		allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-App-Id', 'X-Requested-With'],
		allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedOrigins: ['*'],
		credentials: true,
		maxAge: 86400,
	},
	proxy: {
		cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'],
	},
	security: {
		base: {'referrer-policy': 'strict-origin-when-cross-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',} satisfies Record<string, string>,
		hsts: { includeSubDomains: true, maxAge: 31536000 },
	},
} as const;
const _PROXY_CONFIG = Config.all({
	enabled: Config.string('TRUST_PROXY').pipe(Config.withDefault('false'), Config.map((v) => v === 'true' || v === '1')),
	hops: Config.integer('PROXY_HOPS').pipe(Config.withDefault(1)),
});
const _trustedCidrs = A.filterMap(_CONFIG.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR));
const _mapSessionError = (error: unknown): HttpError.Auth | HttpError.Internal => Match.value(error).pipe(
	Match.when(Cause.isNoSuchElementException, () => HttpError.Auth.of('Missing session')),
	Match.when((e: unknown): e is HttpError.Auth => e instanceof HttpError.Auth, (e) => e),
	Match.orElse((e: unknown) => HttpError.Internal.of('Session lookup failed', e)),
);
const requireMfaVerified = Context.Request.sessionOrFail.pipe(
	Effect.mapError(_mapSessionError),
	Effect.filterOrFail((session) => !session.mfaEnabled || Option.isSome(session.verifiedAt), () => HttpError.Forbidden.of('MFA verification required')),
	Effect.asVoid,
);

// --- [GLOBAL_MIDDLEWARE] -----------------------------------------------------

const _extractClientIp = (proxy: { readonly enabled: boolean; readonly hops: number }, headers: Headers.Headers, directIp: Option.Option<string>): Option.Option<string> => {
	const isTrustedProxy = proxy.enabled && pipe(
		directIp,
		Option.flatMap(Option.liftThrowable(ipaddr.process)),
		Option.map((addr) => ipaddr.subnetMatch(addr, { trusted: _trustedCidrs }, 'untrusted') === 'trusted'),
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
const trace = HttpMiddleware.make((app) => Effect.gen(function* () {
	const req = yield* HttpServerRequest.HttpServerRequest;
	const parent = HttpTraceContext.fromHeaders(req.headers);
	const response = yield* (Option.isSome(parent) ? Effect.withParentSpan(app, parent.value) : Effect.withSpan(app, 'http.request', { attributes: { 'http.method': req.method, 'http.target': req.url } }));
	yield* Effect.annotateCurrentSpan('http.status_code', response.status);
	return Option.match(yield* Effect.optionFromOptional(Effect.currentSpan), { onNone: () => response, onSome: (span) => HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(span)) });
}));
const security = (hsts: typeof _CONFIG.security.hsts | false = _CONFIG.security.hsts) =>
	HttpMiddleware.make((app) => app.pipe(Effect.map((res) =>
		HttpServerResponse.setHeaders(res, hsts
			? { ..._CONFIG.security.base, 'strict-transport-security': `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}` }
			: _CONFIG.security.base))));
const serverTiming = HttpMiddleware.make((app) =>
	Effect.timed(app).pipe(Effect.map(([duration, response]) =>
		HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${Duration.toMillis(duration)}`))));

// --- [AUTH_MIDDLEWARE] -------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('server/SessionAuth', {
	failure: HttpError.Auth,
	security: { bearer: HttpApiSecurity.bearer },
}) {
	static readonly makeLayer = (lookup: (hash: Hex64) => Effect.Effect<Option.Option<Context.Request.Session>>) =>
		Layer.effect(this, Effect.gen(function* () {
			const metrics = yield* MetricsService;
			const audit = yield* AuditService;
	return SessionAuth.of({
		bearer: (token: Redacted.Redacted<string>) => Context.Request.currentTenantId.pipe(
			Effect.flatMap((tenantId) => Crypto.hmac(tenantId, Redacted.value(token))),
			Effect.tap(() => Metric.increment(metrics.auth.session.lookups)),
			Effect.flatMap(lookup), // NOSONAR S3358
			Effect.flatMap(Option.match({
				onNone: () => Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid session')))),
				onSome: (session) => Context.Request.update({ session: Option.some(session) }).pipe(Effect.tap(() => Metric.increment(metrics.auth.session.hits))), // NOSONAR S3358
			})),
		),
	});
		}));
}
const makeRequireRole = (findById: (userId: string) => Effect.Effect<Option.Option<{ readonly role: string }>, unknown>) => (min: Context.UserRole) => Context.Request.sessionOrFail.pipe(
	Effect.mapError(_mapSessionError),
	Effect.flatMap(({ userId }) => findById(userId)),
	Effect.mapError((error) => Match.value(error).pipe(
		Match.when((e: unknown): e is HttpError.Auth => e instanceof HttpError.Auth, (e) => e),
		Match.orElse((e) => HttpError.Internal.of('User lookup failed', e)),
	)),
	Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Forbidden.of('User not found')), onSome: Effect.succeed })),
	Effect.filterOrFail((user) => Context.UserRole.hasAtLeast(user.role, min), () => HttpError.Forbidden.of('Insufficient permissions')),
	Effect.asVoid,
);

// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------

const makeAppLookup =
	(database: { readonly apps: { readonly byNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> } }) =>
	(namespace: string): Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> => database.apps.byNamespace(namespace).pipe(Effect.map(Option.map((app) => ({ id: app.id, namespace: app.namespace }))));
const makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown>) =>
	HttpMiddleware.make((app) => Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const proxy = yield* Effect.orDie(_PROXY_CONFIG);
		const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
		const namespaceOpt = Headers.get(req.headers, 'x-app-id');
		const found = yield* Option.match(namespaceOpt, {
			onNone: () => Effect.succeed(Option.none<{ readonly id: string; readonly namespace: string }>()),
			onSome: (namespace) => findByNamespace(namespace).pipe(Effect.orElseSucceed(Option.none)),
		});
		const tenantId = Option.match(namespaceOpt, {							// Tenant resolution: no header → default app, header + found → app id, header + not found → unspecified (prevents cross-tenant data mixing)
			onNone: () => Context.Request.Id.default,
			onSome: () => Option.getOrElse(Option.map(found, (item) => item.id), () => Context.Request.Id.unspecified), // NOSONAR S3358
		});
		const cluster = yield* Effect.serviceOption(Sharding.Sharding).pipe(	// Cluster context: graceful degradation via serviceOption (avoids startup failures)
			Effect.flatMap(Option.match({
				onNone: () => Effect.succeedNone,
				onSome: (sharding) => Effect.map(sharding.getSnowflake, (sf): Option.Option<Context.Request.ClusterState> => Option.some({ // NOSONAR S3358
					entityId: null,
					entityType: null,
					isLeader: false,
					runnerId: Context.Request.makeRunnerId(sf),
					shardId: null,
				})),
			})),
		);
		const ctx: Context.Request.Data = {
			circuit: Option.none(),
			cluster,
			ipAddress: _extractClientIp(proxy, req.headers, req.remoteAddress),
			rateLimit: Option.none(),
			requestId,
			session: Option.none(),
			tenantId,
			userAgent: Headers.get(req.headers, 'user-agent'),
		};
		const logAnnotations = { 'request.id': requestId, 'tenant.id': tenantId, ...Option.match(namespaceOpt, { onNone: () => ({}), onSome: (ns) => ({ 'app.namespace': ns }) }) };
		yield* pipe(	// Annotate span with runner ID for cross-pod trace correlation
			Option.flatMapNullable(cluster, (c) => c.runnerId),
			Option.match({ onNone: () => Effect.void, onSome: (id) => Effect.annotateCurrentSpan('cluster.runner_id', id) }),
		);
		const runApp = app.pipe(
			Effect.provideService(Context.Request, ctx),
			Effect.tap(Effect.all([
				Effect.annotateCurrentSpan('tenant.id', tenantId),
				Effect.annotateCurrentSpan('request.id', requestId),
				...A.map(A.fromOption(namespaceOpt), (namespace) => Effect.annotateCurrentSpan('app.namespace', namespace)),
			], { discard: true })),
			Effect.annotateLogs(logAnnotations),
			Effect.flatMap((response) => Effect.gen(function* () {
				const context = yield* Context.Request.current;
				const circuitHeader = context.circuit.pipe(Option.map((circuit) => circuit.state));
				return HttpServerResponse.setHeaders(response, Option.match(circuitHeader, {
					onNone: () => ({ 'x-request-id': requestId }),
					onSome: (state) => ({ 'x-request-id': requestId, 'x-circuit-state': state }),
				}));
			})),
		);
		const withTenantDb = Effect.orDie(Client.tenant.with(tenantId, runApp));
		// FiberRef (fiber-local context) + Tag (DI) — both required for complete context scoping
		return yield* Context.Request.within(tenantId, withTenantDb, ctx);
	}));
const cors = (origins?: ReadonlyArray<string>) => {
	const list = (origins ?? _CONFIG.cors.allowedOrigins).map((origin) => origin.trim()).filter(Boolean);
	return HttpApiBuilder.middlewareCors({ ..._CONFIG.cors, allowedOrigins: list, credentials: !list.includes('*') && _CONFIG.cors.credentials });
};

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
	makeRequireRole,
	requireMfaVerified,
	// Context
	cors,
	makeAppLookup,
	makeRequestContext,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Middleware {
	export type SessionLookup = Parameters<typeof SessionAuth.makeLayer>[0];
	export type RoleLookup = Parameters<typeof makeRequireRole>[0];
	export type RequireRoleCheck = ReturnType<typeof makeRequireRole>;
	export type RequestContextLookup = Parameters<typeof makeRequestContext>[0];
	export type AppLookupDb = Parameters<typeof makeAppLookup>[0];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware };
