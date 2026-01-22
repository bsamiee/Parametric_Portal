/**
 * Compose HTTP middleware: auth, CORS, logging, request ID, security headers.
 * Effect.Tag + HttpApiMiddleware.Tag pattern for type-safe composition.
 */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import type { Hex64 } from '@parametric-portal/types/types';
import * as ipaddr from 'ipaddr.js';
import { Array as A, Effect, Layer, Option, pipe, Redacted } from 'effect';
import { RequestContext } from './context.ts';
import { Crypto } from './crypto.ts';
import { HttpError } from './http-errors.ts';
import { metricsMiddleware, MetricsService } from './metrics.ts';

// --- [PRIVATE_SCHEMAS] -------------------------------------------------------

const _OAuthProvider = { apple: 'apple', github: 'github', google: 'google', microsoft: 'microsoft' } as const;
type _OAuthProviderType = typeof _OAuthProvider[keyof typeof _OAuthProvider];
const _Role = { admin: 'admin', guest: 'guest', member: 'member', owner: 'owner', viewer: 'viewer' } as const;
type _RoleType = typeof _Role[keyof typeof _Role];
const _roles = { admin: 3, guest: 0, member: 2, owner: 4, viewer: 1 } as const;

// --- [CONSTANTS] -------------------------------------------------------------

const config = {
	cors: {
		allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-App-Id', 'X-Requested-With'],
		allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
		allowedOrigins: ['*'],
		credentials: true,
		maxAge: 86400,
	},
	proxy: {
		cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'],
		enabled: false,
		hops: 1,
	},
	security: {
		base: [['x-content-type-options', 'nosniff'], ['x-frame-options', 'DENY'], ['referrer-policy', 'strict-origin-when-cross-origin']] as const,
		hsts: { includeSubDomains: true, maxAge: 31536000 },
	},
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const extractClientIp = (headers: Headers.Headers, directIp: Option.Option<string>): Option.Option<string> => {
	const isTrustedProxy = config.proxy.enabled && pipe(
		directIp,
		Option.flatMap(Option.liftThrowable(ipaddr.process)),
		Option.map((addr) => ipaddr.subnetMatch(addr, { trusted: A.filterMap(config.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR)) }, 'untrusted') === 'trusted'),
		Option.getOrElse(() => false),
	);
	return isTrustedProxy
		? Option.firstSomeOf([
				pipe(Headers.get(headers, 'x-forwarded-for'), Option.map((raw) => A.filter(raw.split(',').map((segment) => segment.trim()), (segment) => segment !== '' && ipaddr.isValid(segment))), Option.flatMap((xff) => A.get(xff, Math.max(0, xff.length - config.proxy.hops - 1)))),
				Option.filter(Headers.get(headers, 'cf-connecting-ip'), ipaddr.isValid),
				Option.filter(Headers.get(headers, 'x-real-ip'), ipaddr.isValid),
		  ])
		: directIp;
};

// --- [TAGS] ------------------------------------------------------------------

class OAuth extends Effect.Tag('server/OAuth')<OAuth, {
	readonly authenticate: (provider: _OAuthProviderType, code: string, state: string, stateCookie: string) => Effect.Effect<{
		readonly access: string;
		readonly email: Option.Option<string>;
		readonly expiresAt: Option.Option<Date>;
		readonly externalId: string;
		readonly refresh: Option.Option<string>;
	}, HttpError.OAuth>;
	readonly createAuthorizationUrl: (provider: _OAuthProviderType) => Effect.Effect<{ readonly stateCookie: string; readonly url: URL }, HttpError.OAuth>;
}>() {}
class RequestId extends Effect.Tag('server/RequestId')<RequestId, string>() {}
class Session extends Effect.Tag('server/Session')<Session, {
	readonly mfaEnabled: boolean;
	readonly mfaVerified: boolean;
	readonly sessionId: string;
	readonly userId: string;
}>() {}

// --- [MIDDLEWARE] ------------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('SessionAuth', {
	failure: HttpError.Auth,
	provides: Session,
	security: { bearer: HttpApiSecurity.bearer },
}) {
	static readonly makeLayer = (lookup: (hash: Hex64) => Effect.Effect<Option.Option<{
		readonly mfaEnabled: boolean;
		readonly mfaVerified: boolean;
		readonly sessionId: string;
		readonly userId: string;
	}>>) =>
		Layer.effect(this, Effect.map(MetricsService, (metrics) => SessionAuth.of({
			bearer: (token: Redacted.Redacted<string>) => Crypto.Token.hash(Redacted.value(token)).pipe(
				Effect.mapError((err) => HttpError.auth('Token hashing failed', err)),
				Effect.flatMap(lookup),
				Effect.andThen(Option.match({ onNone: () => Effect.fail(HttpError.auth('Invalid session')), onSome: Effect.succeed })),
				Effect.provideService(MetricsService, metrics),
			),
		})));
}
const security = (hsts: typeof config.security.hsts | false = config.security.hsts) => HttpMiddleware.make((app) => Effect.map(app, (res) =>
	[...config.security.base, ...(hsts ? [['strict-transport-security', `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}`] as const] : [])].reduce((acc, [key, value]) => HttpServerResponse.setHeader(acc, key, value), res)));
const requestId = HttpMiddleware.make((app) => HttpServerRequest.HttpServerRequest.pipe(
	Effect.flatMap((req) => {
		const id = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
		return Effect.provideService(app, RequestId, id).pipe(Effect.map((response) => HttpServerResponse.setHeader(response, 'x-request-id', id)));
	}),
));
const makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>>) =>
	HttpMiddleware.make((app) => Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const [reqId, sessionOpt] = yield* Effect.all([Effect.serviceOption(RequestId), Effect.serviceOption(Session)]);
		const namespaceOpt = Headers.get(req.headers, 'x-app-id');
		const found = yield* (Option.isNone(namespaceOpt)
			? Effect.succeed(Option.none<{ readonly id: string; readonly namespace: string }>())
			: findByNamespace(namespaceOpt.value).pipe(Effect.orElseSucceed(Option.none)));
		const appId = Option.match(found, { onNone: () => '00000000-0000-7000-8000-000000000000', onSome: (item) => item.id });
		return yield* app.pipe(
			Effect.provideService(RequestContext, {
				appId,
				ipAddress: extractClientIp(req.headers, req.remoteAddress),
				requestId: Option.getOrElse(reqId, crypto.randomUUID),
				sessionId: Option.map(sessionOpt, (session) => session.sessionId),
				userAgent: Headers.get(req.headers, 'user-agent'),
				userId: Option.map(sessionOpt, (session) => session.userId),
			}),
			Effect.tap(() => Effect.all([
				Effect.annotateCurrentSpan('app.id', appId),
				Option.isSome(namespaceOpt) ? Effect.annotateCurrentSpan('app.namespace', namespaceOpt.value) : Effect.void,
			], { discard: true })),
		);
	}));
const trace = HttpMiddleware.make((app) => Effect.gen(function* () {
	const req = yield* HttpServerRequest.HttpServerRequest;
	const parent = HttpTraceContext.fromHeaders(req.headers);
	const response = yield* (Option.isSome(parent) ? Effect.withParentSpan(app, parent.value) : Effect.withSpan(app, 'http.request', { attributes: { 'http.method': req.method, 'http.target': req.url } }));
	yield* Effect.annotateCurrentSpan('http.status_code', response.status);
	return Option.match(yield* Effect.optionFromOptional(Effect.currentSpan), { onNone: () => response, onSome: (span) => HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(span)) });
}));

// --- [ENFORCEMENT] -----------------------------------------------------------

const makeRequireRole = (findById: (userId: string) => Effect.Effect<Option.Option<{ readonly role: _RoleType }>, unknown>) => (min: _RoleType) => Session.pipe(
	Effect.flatMap(({ userId }) => findById(userId)),
	Effect.mapError((err) => HttpError.internal('User lookup failed', err)),
	Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.forbidden('User not found')), onSome: Effect.succeed })),
	Effect.filterOrFail((user) => _roles[user.role] >= _roles[min], () => HttpError.forbidden('Insufficient permissions')),
	Effect.asVoid,
);
const requireMfaVerified = Session.pipe(Effect.filterOrFail((session) => !session.mfaEnabled || session.mfaVerified, () => HttpError.forbidden('MFA verification required')), Effect.asVoid);

/**
 * Set PostgreSQL tenant context for RLS policy enforcement.
 * MUST run after makeRequestContext extracts appId into RequestContext.
 * Uses SET LOCAL for transaction-scoped isolation (safe with connection pooling).
 */
const makeTenantContext = <R>(setTenant: (appId: string) => Effect.Effect<void, unknown, R>) =>
	HttpMiddleware.make((app) => Effect.gen(function* () {
		const ctx = yield* Effect.serviceOption(RequestContext);
		yield* Option.match(ctx, { onNone: () => Effect.void, onSome: (c) => setTenant(c.appId).pipe(Effect.catchAll(() => Effect.void)) });
		return yield* app;
	}));

// --- [NAMESPACE] -------------------------------------------------------------

const Middleware = {
	Auth: SessionAuth,
	cors: (origins?: ReadonlyArray<string>) => {
		const list = (origins ?? config.cors.allowedOrigins).map((origin) => origin.trim()).filter(Boolean);
		return HttpApiBuilder.middlewareCors({ ...config.cors, allowedOrigins: list, credentials: !list.includes('*') && config.cors.credentials });
	},
	makeRequestContext,
	makeRequireRole,
	makeTenantContext,
	metrics: metricsMiddleware,
	OAuth,
	requestId,
	requireMfaVerified,
	Session,
	security,
	trace,
	xForwardedHeaders: HttpMiddleware.xForwardedHeaders,
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware, OAuth, requireMfaVerified };
