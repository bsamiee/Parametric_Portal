/**
 * HTTP middleware composition: global filters, auth, and context factories.
 * Organized into 3 blocks: global, auth, context.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import type { Hex64 } from '@parametric-portal/types/types';
import * as ipaddr from 'ipaddr.js';
import { Array as A, Effect, Layer, Metric, Option, pipe, Redacted } from 'effect';
import { Context } from './context.ts';
import { AuditService } from './observe/audit.ts';
import { HttpError } from './errors.ts';
import { MetricsService } from './observe/metrics.ts';
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
		base: {'referrer-policy': 'strict-origin-when-cross-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',} satisfies Record<string, string>,
		hsts: { includeSubDomains: true, maxAge: 31536000 },
	},
} as const;
const _trustedCidrs = A.filterMap(_config.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR));
const requireMfaVerified = Context.Request.session.pipe(Effect.filterOrFail((session) => !session.mfaEnabled || Option.isSome(session.verifiedAt), () => HttpError.Forbidden.of('MFA verification required')), Effect.asVoid);

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
				pipe(Headers.get(headers, 'x-forwarded-for'), Option.map((raw) => A.filter(raw.split(',').map((segment) => segment.trim()), (segment) => segment !== '' && ipaddr.isValid(segment))), Option.flatMap((xff) => A.get(xff, Math.max(0, xff.length - _config.proxy.hops)))),
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
const security = (hsts: typeof _config.security.hsts | false = _config.security.hsts) =>
	HttpMiddleware.make((app) => app.pipe(Effect.map((res) =>
		HttpServerResponse.setHeaders(res, hsts
			? { ..._config.security.base, 'strict-transport-security': `max-age=${hsts.maxAge}${hsts.includeSubDomains ? '; includeSubDomains' : ''}` }
			: _config.security.base))));
const serverTiming = HttpMiddleware.make((app) =>
	Effect.gen(function* () {
		const start = Date.now();
		const response = yield* app;
		return HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${Date.now() - start}`);
	}));

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
				bearer: (token: Redacted.Redacted<string>) => Crypto.hash(Redacted.value(token)).pipe(
					Effect.tap(() => Metric.increment(metrics.auth.session.lookups)),
					Effect.flatMap(lookup),
					Effect.flatMap(Option.match({
						onNone: () => Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid session')))),
						onSome: (s) => Context.Request.update({ session: Option.some(s) }).pipe(Effect.tap(() => Metric.increment(metrics.auth.session.hits))),
					})),
				),
			});
		}));
}
const makeRequireRole = (findById: (userId: string) => Effect.Effect<Option.Option<{ readonly role: string }>, unknown>) => (min: Context.UserRole) => Context.Request.session.pipe(
	Effect.flatMap(({ userId }) => findById(userId)),
	Effect.mapError((err) => HttpError.Internal.of('User lookup failed', err)),
	Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Forbidden.of('User not found')), onSome: Effect.succeed })),
	Effect.filterOrFail((user) => Context.UserRole.hasAtLeast(user.role, min), () => HttpError.Forbidden.of('Insufficient permissions')),
	Effect.asVoid,
);

// --- [CONTEXT_MIDDLEWARE] ----------------------------------------------------

const makeAppLookup =
	(db: { readonly apps: { readonly byNamespace: (ns: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> } }) =>
	(namespace: string): Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> =>
		db.apps.byNamespace(namespace).pipe(Effect.map(Option.map((app) => ({ id: app.id, namespace: app.namespace }))));
const makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown>) =>
	HttpMiddleware.make((app) => Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
		const namespaceOpt = Headers.get(req.headers, 'x-app-id');
		const found = yield* Option.match(namespaceOpt, {
			onNone: () => Effect.succeed(Option.none<{ readonly id: string; readonly namespace: string }>()),
			onSome: (ns) => findByNamespace(ns).pipe(Effect.orElseSucceed(Option.none)),
		});
		const tenantId = Option.match(found, { onNone: () => Context.Request.Id.system, onSome: (item) => item.id });
		const ctx: Context.Request.Data = {
			circuit: Option.none(),
			ipAddress: _extractClientIp(req.headers, req.remoteAddress),
			rateLimit: Option.none(),
			requestId,
			session: Option.none(),
			tenantId,
			userAgent: Headers.get(req.headers, 'user-agent'),
		};
		const logAnnotations = { 'request.id': requestId, 'tenant.id': tenantId, ...Option.match(namespaceOpt, { onNone: () => ({}), onSome: (ns) => ({ 'app.namespace': ns }) }) };
		return yield* Context.Request.within(tenantId, app.pipe(
			Effect.provideService(Context.Request, ctx),
			Effect.tap(() => Effect.all([
				Effect.annotateCurrentSpan('tenant.id', tenantId),
				Effect.annotateCurrentSpan('request.id', requestId),
				...Option.match(namespaceOpt, { onNone: () => [], onSome: (ns) => [Effect.annotateCurrentSpan('app.namespace', ns)] }),
			], { discard: true })),
			Effect.annotateLogs(logAnnotations),
			Effect.flatMap((response) => Context.Request.current.pipe(
				Effect.map((c) => HttpServerResponse.setHeaders(response, {
					'x-request-id': requestId,
					...Option.match(c.circuit, { onNone: () => ({}), onSome: (circuit) => ({ 'x-circuit-state': circuit.state }) }),
				})),
			)),
		), ctx);
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
