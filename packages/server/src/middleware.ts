/**
 * HTTP middleware: single class export consolidating auth, global pipeline, and CORS.
 * Middleware IS the HttpApiMiddleware.Tag class with pipeline() and layer() statics.
 */
/** biome-ignore-all assist/source/useSortedKeys: <Organization> */
import { Sharding } from '@effect/cluster';
import { Headers, HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity, type HttpApp, HttpMiddleware, HttpServerRequest, HttpServerResponse, HttpTraceContext } from '@effect/platform';
import { Client } from '@parametric-portal/database/client';
import type { Hex64 } from '@parametric-portal/types/types';
import * as ipaddr from 'ipaddr.js';
import { Array as A, Cause, Data, Duration, Effect, Function as F, Layer, Match, Metric, Option, pipe, Redacted } from 'effect';
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
	proxy: { cidrs: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10'] },
	security: {
		base: {'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'", 'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin', 'permissions-policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'} satisfies Record<string, string>,
		hsts: { includeSubDomains: true, maxAge: 31536000 }
	},
		tenantExemptPrefixes: ['/api/health', '/api/v1/traces', '/docs'] as ReadonlyArray<string>,
} as const;
const _proxyConfig = (() => {
	const enabledRaw = process.env['TRUST_PROXY'] ?? 'false';
	const hopsRaw = Number(process.env['PROXY_HOPS'] ?? '1');
	return { enabled: enabledRaw === 'true' || enabledRaw === '1', hops: Number.isFinite(hopsRaw) && hopsRaw > 0 ? Math.floor(hopsRaw) : 1 } as const;
})();
const _isLongLived = (headers: Headers.Headers) =>
	Headers.get(headers, 'accept').pipe(
		Option.exists((value) => value.toLowerCase().includes('text/event-stream')),
		(value) => value || Headers.get(headers, 'upgrade').pipe(Option.exists((upgrade) => upgrade.toLowerCase() === 'websocket')),
	);

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

const _makeAppLookup =
	(database: { readonly apps: { readonly byNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> } }) =>
	(namespace: string): Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown> => database.apps.byNamespace(namespace).pipe(Effect.map(Option.map((app) => ({ id: app.id, namespace: app.namespace }))));
const _makeRequestContext = (findByNamespace: (namespace: string) => Effect.Effect<Option.Option<{ readonly id: string; readonly namespace: string }>, unknown>) =>
	HttpMiddleware.make((app) => pipe(Effect.gen(function* () {
		const req = yield* HttpServerRequest.HttpServerRequest;
		const proxy = _proxyConfig;
		const requestId = Option.getOrElse(Headers.get(req.headers, Context.Request.Headers.requestId), crypto.randomUUID);
		const namespaceOpt = Headers.get(req.headers, Context.Request.Headers.appId);
		const isExemptPath = A.some(_CONFIG.tenantExemptPrefixes, (prefix) => req.url.startsWith(prefix));
		const exemptEffect = Effect.succeed(Context.Request.Id.system);
		const missingHeaderEffect = Effect.fail(new (class extends Data.TaggedError('MissingTenantHeader')<Record<string, never>> {})({}));
		const exemptOrMissing = Effect.if(isExemptPath, { onTrue: F.constant(exemptEffect), onFalse: F.constant(missingHeaderEffect) });
		const extractId = (app: { readonly id: string }) => app.id;
		const lookupTenant = (ns: string) => {
			const unknownError = new (class extends Data.TaggedError('UnknownTenantHeader')<{ readonly namespace: string }> {})({ namespace: ns });
			const handleResult = Option.match({ onNone: F.constant(Effect.fail(unknownError)), onSome: F.flow(extractId, Effect.succeed) });
			return pipe(findByNamespace(ns), Effect.flatMap(handleResult));
		};
		const tenantId = yield* Option.match(namespaceOpt, { onNone: F.constant(exemptOrMissing), onSome: lookupTenant });
		const cluster = yield* Effect.serviceOption(Sharding.Sharding).pipe(		// Graceful degradation via serviceOption (avoids startup failures)
			Effect.map(Option.map((): Context.Request.ClusterState => ({
				entityId: null, entityType: null, isLeader: false, runnerId: null, shardId: null,
			}))),
		);
		const parsedRemote = pipe(req.remoteAddress, Option.flatMap(Option.liftThrowable(ipaddr.process)));
		const isTrustedProxy = proxy.enabled && Option.match(parsedRemote, {
			onNone: F.constFalse,
			onSome: (addr) => ipaddr.subnetMatch(addr, { trusted: A.filterMap(_CONFIG.proxy.cidrs, Option.liftThrowable(ipaddr.parseCIDR)) }, 'untrusted') === 'trusted',
		});
		const xffHeader = Headers.get(req.headers, Context.Request.Headers.forwardedFor);
		const xffSplit = pipe(xffHeader, Option.map((raw) => raw.split(',')));
		const xffTrimmed = pipe(xffSplit, Option.map(A.map((s) => s.trim())));
		const xffSegments: Option.Option<ReadonlyArray<string>> = pipe(xffTrimmed, Option.map(A.filter((s): s is string => s !== '' && ipaddr.isValid(s))));
		const xffIp = pipe(xffSegments, Option.flatMap((xff) => A.get(xff, Math.max(0, xff.length - proxy.hops - 1))));
		const ipAddress: Option.Option<string> = Option.match(Option.liftPredicate(isTrustedProxy, F.identity<boolean>), {
			onNone: () => req.remoteAddress,
			onSome: () => Option.firstSomeOf([
				xffIp,
				Option.filter(Headers.get(req.headers, Context.Request.Headers.cfConnectingIp), ipaddr.isValid),
				Option.filter(Headers.get(req.headers, Context.Request.Headers.realIp), ipaddr.isValid),
			]),
		});
		const isLongLived = _isLongLived(req.headers);
		const ctx: Context.Request.Data = { appNamespace: namespaceOpt, circuit: Option.none(), cluster, ipAddress, rateLimit: Option.none(), requestId, session: Option.none(), tenantId, userAgent: Headers.get(req.headers, 'user-agent') };
		const resultEffect = Effect.all([app, Context.Request.current]).pipe(Effect.map(([response, requestContext]) => ({ circuit: requestContext.circuit, response })));
		const { circuit, response } = yield* Effect.orDie(Match.value(isLongLived).pipe(
			Match.when(true, () => Context.Request.within(tenantId, resultEffect, ctx)),
			Match.orElse(() => Context.Request.withinSync(tenantId, resultEffect, ctx)),
		));
		const circuitState = Option.getOrUndefined(Option.map(circuit, (c) => c.state));
		return HttpServerResponse.setHeaders(response, { [Context.Request.Headers.requestId]: requestId, ...(circuitState ? { [Context.Request.Headers.circuitState]: circuitState } : {}) });
	}), Effect.catchTags({
		MissingTenantHeader: () => Effect.succeed(HttpServerResponse.unsafeJson({ details: 'X-App-Id header is required', error: 'MissingTenantHeader' }, { status: 400 })),
		UnknownTenantHeader: ({ namespace }: { readonly namespace: string }) =>
			Effect.succeed(HttpServerResponse.unsafeJson({ details: `Unknown X-App-Id: ${namespace}`, error: 'UnknownTenantHeader' }, { status: 400 })),
	}), Effect.orDie));
const _cors = (origins?: ReadonlyArray<string>) => pipe(
	(origins ?? _CONFIG.cors.allowedOrigins).map((o) => o.trim()).filter(Boolean),
	(list) => HttpApiBuilder.middlewareCors({ ..._CONFIG.cors, allowedOrigins: list, credentials: !list.includes('*') && _CONFIG.cors.credentials }),
);

// --- [SERVICES] --------------------------------------------------------------

class Middleware extends HttpApiMiddleware.Tag<Middleware>()('server/Middleware', {
	failure: HttpError.Auth,
	security: {
		bearer: HttpApiSecurity.bearer,
		apiKey: HttpApiSecurity.apiKey({ key: 'X-API-Key', in: 'header' }),
	},
}) {
	static readonly _session = Context.Request.sessionOrFail.pipe(
		Effect.mapError((error): HttpError.Auth | HttpError.Internal =>
			Match.value(error).pipe(
				Match.when(Cause.isNoSuchElementException, () => HttpError.Auth.of('Missing session')),
				Match.when((e): e is HttpError.Auth => e instanceof HttpError.Auth, F.identity),
				Match.orElse((e) => HttpError.Internal.of('Session lookup failed', e)),
			),
		),
	);
	static readonly mfaVerified = Middleware._session.pipe(
		Effect.filterOrFail((session) => !session.mfaEnabled || Option.isSome(session.verifiedAt), () => HttpError.Forbidden.of('MFA verification required')),
		Effect.asVoid,
	);
	static readonly interactiveSession = Middleware._session.pipe(
		Effect.filterOrFail((session) => session.kind === 'session', () => HttpError.Forbidden.of('Interactive session required')),
		Effect.asVoid,
	);
	static readonly role = (min: Context.UserRole) => Middleware._session.pipe(
		Effect.flatMap(({ userId }) => Context.Request.currentTenantId.pipe(
			Effect.flatMap((tenantId) => Context.Request.withinSync(tenantId, DatabaseService.pipe(
				Effect.flatMap((repositories) => repositories.users.one([{ field: 'id', value: userId }])),
				Effect.map(Option.map((user) => ({ role: user.role }))),
			)).pipe(Effect.provide(Client.layer))),
		)),
		Effect.mapError((error): HttpError.Auth | HttpError.Internal =>
			error instanceof HttpError.Auth || error instanceof HttpError.Internal ? error
			: HttpError.Internal.of('User lookup failed', error),
		),
		Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Forbidden.of('User not found')), onSome: Effect.succeed })),
		Effect.filterOrFail((user) => Context.UserRole.hasAtLeast(user.role, min), () => HttpError.Forbidden.of('Insufficient permissions')),
		Effect.asVoid,
	);
	static readonly _makeAuthLayer = (
		sessionLookup: (hash: Hex64) => Effect.Effect<Option.Option<Context.Request.Session>>,
		apiKeyLookup: (hash: Hex64) => Effect.Effect<Option.Option<{ readonly id: string; readonly userId: string; readonly expiresAt: Option.Option<Date> }>>,) =>
		Layer.effect(this, Effect.map(Effect.all([MetricsService, AuditService]), ([metrics, audit]) => Middleware.of({
				bearer: (token: Redacted.Redacted<string>) => Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const tenantId = yield* Context.Request.currentTenantId;
						const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
						yield* Metric.increment(metrics.auth.session.lookups);
						const sessionOpt = yield* Match.value(_isLongLived(req.headers)).pipe(
							Match.when(true, () => Context.Request.withinSync(tenantId, sessionLookup(hash)).pipe(Effect.provide(Client.layer))),
							Match.orElse(() => sessionLookup(hash)),
							Effect.catchAll((error) =>
								Effect.logError('Session lookup failed', { error: String(error) }).pipe(
									Effect.andThen(Effect.die(HttpError.Internal.of('Session lookup failed', error))),
								)),
						);
						yield* Option.match(sessionOpt, {
							onNone: () => Effect.all([Metric.increment(metrics.auth.session.misses), audit.log('auth_failure', { details: { reason: 'invalid_session' } })], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid session')))),
						onSome: (session) => Context.Request.update({ session: Option.some({ ...session, kind: 'session' }) }).pipe(Effect.tap(() => Metric.increment(metrics.auth.session.hits))),
					});
				}),
				apiKey: (token: Redacted.Redacted<string>) => Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const tenantId = yield* Context.Request.currentTenantId;
						const hash = yield* Crypto.hmac(tenantId, Redacted.value(token));
						yield* Metric.increment(metrics.auth.apiKey.lookups);
						const keyOpt = yield* Match.value(_isLongLived(req.headers)).pipe(
							Match.when(true, () => Context.Request.withinSync(tenantId, apiKeyLookup(hash)).pipe(Effect.provide(Client.layer))),
							Match.orElse(() => apiKeyLookup(hash)),
							Effect.catchAll((error) =>
								Effect.logError('API key lookup failed', { error: String(error) }).pipe(
									Effect.andThen(Effect.die(HttpError.Internal.of('API key lookup failed', error))),
								)),
						);
					const missingKeyEffect = Effect.all([Metric.increment(metrics.auth.apiKey.misses), audit.log('auth_failure', { details: { reason: 'invalid_api_key' } })], { discard: true }).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid API key'))));
					const key = yield* Option.match(keyOpt, { onNone: F.constant(missingKeyEffect), onSome: Effect.succeed });
					const expiry = Option.getOrNull(key.expiresAt);
					const isExpired = expiry !== null && expiry < new Date();
					const validKeyEffect = Context.Request.update({ session: Option.some({ appId: tenantId, id: key.id, kind: 'apiKey', mfaEnabled: false, userId: key.userId, verifiedAt: Option.none() }) }).pipe(Effect.tap(F.constant(Metric.increment(metrics.auth.apiKey.hits))));
					yield* Effect.if(isExpired, { onTrue: F.constant(Effect.fail(HttpError.Auth.of('API key expired'))), onFalse: F.constant(validKeyEffect) });
				}),
			})));
	static readonly pipeline = (database: typeof DatabaseService.Service, options?: { readonly hsts?: typeof _CONFIG.security.hsts | false }) =>
		(app: HttpApp.Default) => app.pipe(
			_makeRequestContext(_makeAppLookup(database)),
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
