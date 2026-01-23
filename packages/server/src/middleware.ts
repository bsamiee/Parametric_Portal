/**
 * HTTP middleware composition: global filters, auth, and context factories.
 * Organized into 3 blocks: global, auth, context.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import type { Hex64 } from '@parametric-portal/types/types';
import * as ipaddr from 'ipaddr.js';
import { Array as A, Effect, Layer, Option, pipe, Redacted } from 'effect';
import { Context } from './context.ts';
import { Tenant } from './tenant.ts';
import { HttpError } from './errors.ts';
import { MetricsService } from './infra/metrics.ts';
import { Crypto } from './security/crypto.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
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
const _trustedCidrs = A.filterMap(_config.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR));
const requireMfaVerified = Context.Session.pipe(Effect.filterOrFail((session) => !session.mfaEnabled || Option.isSome(session.verifiedAt), () => HttpError.forbidden('MFA verification required')), Effect.asVoid);

// --- [GLOBAL_MIDDLEWARE] -----------------------------------------------------

const _extractClientIp = (headers: Headers.Headers, directIp: Option.Option<string>): Option.Option<string> => {
	const isTrustedProxy = _config.proxy.enabled && pipe(
		directIp,
		Option.flatMap(Option.liftThrowable(ipaddr.process)),
		Option.map((addr) => ipaddr.subnetMatch(addr, { trusted: _trustedCidrs }, 'untrusted') === 'trusted'),
		Option.getOrElse(() => false),
	);
	return isTrustedProxy
		? Option.firstSomeOf([
				pipe(Headers.get(headers, 'x-forwarded-for'), Option.map((raw) => A.filter(raw.split(',').map((segment) => segment.trim()), (segment) => segment !== '' && ipaddr.isValid(segment))), Option.flatMap((xff) => A.get(xff, Math.max(0, xff.length - _config.proxy.hops - 1)))),
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
const security = (hsts: typeof _config.security.hsts | false = _config.security.hsts) => HttpMiddleware.make((app) => Effect.map(app, (res) =>
	[..._config.security.base, ...(hsts ? [['strict-transport-security', `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}`] as const] : [])].reduce((acc, [key, value]) => HttpServerResponse.setHeader(acc, key, value), res)));

// --- [AUTH_MIDDLEWARE] -------------------------------------------------------

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('server/SessionAuth', {
	failure: HttpError.Auth,
	provides: Context.Session,
	security: { bearer: HttpApiSecurity.bearer },
}) {
	static readonly makeLayer = (lookup: (hash: Hex64) => Effect.Effect<Option.Option<{
		readonly id: string;
		readonly mfaEnabled: boolean;
		readonly userId: string;
		readonly verifiedAt: Option.Option<Date>;
	}>>) =>
		Layer.effect(this, Effect.map(MetricsService, (metrics) => SessionAuth.of({
			bearer: (token: Redacted.Redacted<string>) => Crypto.token.hash(Redacted.value(token)).pipe(
				Effect.mapError((err) => HttpError.auth('Token hashing failed', err)),
				Effect.flatMap(lookup),
				Effect.andThen(Option.match({ onNone: () => Effect.fail(HttpError.auth('Invalid session')), onSome: Effect.succeed })),
				Effect.provideService(MetricsService, metrics),
			),
		})));
}
const makeRequireRole = (findById: (userId: string) => Effect.Effect<Option.Option<{ readonly role: string }>, unknown>) => (min: keyof typeof Context.UserRole.order) => Context.Session.pipe(
	Effect.flatMap(({ userId }) => findById(userId)),
	Effect.mapError((err) => HttpError.internal('User lookup failed', err)),
	Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.forbidden('User not found')), onSome: Effect.succeed })),
	Effect.filterOrFail((user) => (Context.UserRole.order[user.role as keyof typeof Context.UserRole.order] ?? 0) >= Context.UserRole.order[min], () => HttpError.forbidden('Insufficient permissions')),
	Effect.asVoid,
);

// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------

/** Build RequestContext from headers, session, and app lookup. Sets tenant via FiberRef. */
const makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>>) =>
	HttpMiddleware.make((app) => Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
		const sessionOpt = yield* Effect.serviceOption(Context.Session);
		const namespaceOpt = Headers.get(req.headers, 'x-app-id');
		const found = yield* (Option.isNone(namespaceOpt)
			? Effect.succeed(Option.none<{ readonly id: string; readonly namespace: string }>())
			: findByNamespace(namespaceOpt.value).pipe(Effect.orElseSucceed(Option.none)));
		const tenantId = Option.match(found, { onNone: () => Tenant.Context.Id.system, onSome: (item) => item.id });
		return yield* Tenant.within(tenantId, app.pipe(
			Effect.provideService(Tenant.Context, {
				ipAddress: _extractClientIp(req.headers, req.remoteAddress),
				requestId,
				sessionId: Option.map(sessionOpt, (session) => session.id),
				tenantId,
				userAgent: Headers.get(req.headers, 'user-agent'),
				userId: Option.map(sessionOpt, (session) => session.userId),
			}),
			Effect.tap(() => Effect.all([
				Effect.annotateCurrentSpan('tenant.id', tenantId),
				Effect.annotateCurrentSpan('request.id', requestId),
				Option.isSome(namespaceOpt) ? Effect.annotateCurrentSpan('app.namespace', namespaceOpt.value) : Effect.void,
			], { discard: true })),
			Effect.map((response) => HttpServerResponse.setHeader(response, 'x-request-id', requestId)),
		));
	}));
const cors = (origins?: ReadonlyArray<string>) => {
	const list = (origins ?? _config.cors.allowedOrigins).map((origin) => origin.trim()).filter(Boolean);
	return HttpApiBuilder.middlewareCors({ ..._config.cors, allowedOrigins: list, credentials: !list.includes('*') && _config.cors.credentials });
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Middleware = {
	// Global
	metrics: MetricsService.middleware,
	security,
	trace,
	xForwardedHeaders: HttpMiddleware.xForwardedHeaders,
	// Auth
	Auth: SessionAuth,
	makeRequireRole,
	requireMfaVerified,
	Session: Context.Session,
	// Context
	cors,
	makeRequestContext,
	OAuth: Context.OAuth,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Middleware {
	export type Session = Context.Session;
	export type SessionLookup = Parameters<typeof SessionAuth.makeLayer>[0];
	export type RoleLookup = Parameters<typeof makeRequireRole>[0];
	export type RequestContextLookup = Parameters<typeof makeRequestContext>[0];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Middleware };
