/**
 * Auth group handlers for OAuth flows, session management, MFA, and API keys.
 *
 * [SECURITY_DESIGN] Token Storage Architecture:
 * - Access tokens: Returned in JSON body for SPA consumption via Authorization header.
 *   Trade-off: XSS can extract tokens, but enables stateless API authentication and
 *   cross-origin requests. Mitigated by short expiry (7 days) and refresh rotation.
 * - Refresh tokens: HttpOnly cookie only (never in response body). XSS-immune, used
 *   solely for silent token refresh. 30-day expiry with automatic rotation.
 * - Session tokens: Server-side only (hash stored in DB). Never exposed to client.
 */
import { Headers, HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { MfaService } from '@parametric-portal/server/domain/mfa';
import { OAuthService } from '@parametric-portal/server/domain/oauth';
import { SessionService } from '@parametric-portal/server/domain/session';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { MetricsService } from '@parametric-portal/server/infra/metrics';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import type { Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Match, Option } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const setCookie = (key: keyof typeof Context.Request.config.cookie, value: string, clear = false) => {
	const cfg = Context.Request.config.cookie[key];
	return (res: HttpServerResponse.HttpServerResponse) =>
		HttpServerResponse.setCookie(res, cfg.name, value, {
			httpOnly: cfg.httpOnly,
			maxAge: clear ? Duration.zero : cfg.maxAge,
			path: cfg.path,
			sameSite: cfg.sameSite,
			secure: cfg.secure,
		});
};
const requireOption = <A, E>(opt: Option.Option<A>, onNone: () => E): Effect.Effect<A, E> =>
	Option.match(opt, { onNone: () => Effect.fail(onNone()), onSome: Effect.succeed });
const verifyCsrf = (req: HttpServerRequest.HttpServerRequest) =>
	requireOption(
		Option.filter(Headers.get(req.headers, Context.Request.config.csrf.header), (v) => v === Context.Request.config.csrf.expectedValue),
		() => HttpError.Auth.of('Missing or invalid CSRF header'),
	).pipe(Effect.asVoid);
const authResponse = (token: Uuidv7, expiresAt: Date, refresh: Uuidv7, mfaPending: boolean, clearOAuth = false) =>
	HttpServerResponse.json({ accessToken: token, expiresAt: DateTime.unsafeFromDate(expiresAt), mfaPending }).pipe(
		Effect.flatMap((res) => clearOAuth ? setCookie('oauth', '', true)(res) : Effect.succeed(res)),
		Effect.flatMap(setCookie('refresh', refresh)),
	);
const logoutResponse = () => HttpServerResponse.json({ success: true }).pipe(Effect.flatMap(setCookie('refresh', '', true)));
const oauthErr = (provider: Context.OAuthProvider) => (reason: string) => HttpError.OAuth.of(provider, reason);

// --- [OAUTH_HANDLERS] --------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: typeof OAuthService.Service, provider: Context.OAuthProvider) =>
	oauth.createAuthorizationUrl(provider).pipe(
		Effect.flatMap(({ stateCookie, url }) =>
			HttpServerResponse.json({ url: url.toString() }).pipe(Effect.flatMap(setCookie('oauth', stateCookie))),
		),
		Effect.mapError((e) => Match.value(e).pipe(
			Match.when((x: unknown): x is HttpError.OAuth => x instanceof HttpError.OAuth, (x) => x),
			Match.orElse((x) => HttpError.OAuth.of(provider, x instanceof Error ? x.message : 'Authorization URL creation failed')),
		)),
	),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
	(oauth: typeof OAuthService.Service, repos: DatabaseServiceShape, session: typeof SessionService.Service, audit: typeof AuditService.Service, provider: Context.OAuthProvider, code: string, state: string) =>
		Effect.gen(function* () {
			const err = oauthErr(provider);
			const [request, appId] = yield* Effect.all([HttpServerRequest.HttpServerRequest, Context.Request.tenantId]);
			const stateCookie = yield* requireOption(Option.fromNullable(request.cookies[Context.Request.config.cookie.oauth.name]), () => err('Missing OAuth state cookie'));
			const result = yield* oauth.authenticate(provider, code, state, stateCookie);
			const email = yield* requireOption(result.email, () => err('Email not provided by provider'));
			const { isNewUser, userId } = yield* repos.withTransaction(
				Effect.gen(function* () {
					const existingOpt = yield* repos.users.byEmail(appId, email).pipe(Effect.mapError(() => err('User lookup failed')));
					const existing = Option.getOrNull(existingOpt);
					const user = yield* existing === null
						? repos.users.insert({ appId, deletedAt: Option.none(), email, role: 'member', status: 'active', updatedAt: undefined }).pipe(Effect.mapError(() => err('User creation failed')))
						: Effect.succeed(existing);
					const encAccess = yield* Crypto.encrypt(result.access).pipe(
						Effect.map((e) => Buffer.from(e)),
						Effect.catchAll(() => Effect.fail(err('Access token encryption failed'))),
					);
					const encRefresh = yield* Option.match(result.refresh, {
						onNone: () => Effect.succeed(Option.none<Buffer>()),
						onSome: (rt) => Crypto.encrypt(rt).pipe(
							Effect.map((e) => Option.some(Buffer.from(e))),
							Effect.catchAll(() => Effect.fail(err('Refresh token encryption failed'))),
						),
					});
					yield* repos.oauthAccounts.upsert({
						accessEncrypted: encAccess, deletedAt: Option.none(), expiresAt: result.expiresAt,
						externalId: result.externalId, provider, refreshEncrypted: encRefresh,
						scope: Option.none(), updatedAt: undefined, userId: user.id,
					}).pipe(Effect.asVoid, Effect.mapError(() => err('OAuth account upsert failed')));
					return { isNewUser: existing === null, userId: user.id };
				}),
			).pipe(Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.Internal.of('User creation transaction failed', e)));
			const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* session.createForLogin(userId, { isNewUser, provider }).pipe(Effect.mapError(() => err('Session creation failed')));
			yield* audit.log('User', userId, isNewUser ? 'create' : 'login', { after: { email, provider } });
			return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending, true).pipe(Effect.mapError(() => err('Response build failed')));
		}),
);

// --- [SESSION_HANDLERS] ------------------------------------------------------

const handleRefresh = Effect.fn('auth.refresh')((session: typeof SessionService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* requireOption(Option.fromNullable(request.cookies[Context.Request.config.cookie.refresh.name]), () => HttpError.Auth.of('Missing refresh token cookie'));
		const hashIn = yield* Crypto.token.hash(refreshIn).pipe(Effect.mapError((e) => HttpError.Auth.of('Token hashing failed', e)));
		const { mfaPending, refreshToken, sessionExpiresAt, sessionToken, userId } = yield* session.refresh(hashIn);
		yield* audit.log('RefreshToken', userId, 'refresh');
		return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending).pipe(Effect.mapError((e) => HttpError.Auth.of('Response build failed', e)));
	}),
);
const handleLogout = Effect.fn('auth.logout')((session: typeof SessionService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const sess = yield* Context.Request.session;
		yield* session.revoke(sess.id);
		yield* session.revokeAll(sess.userId);
		yield* audit.log('Session', sess.id, 'logout');
		return yield* logoutResponse().pipe(Effect.mapError((e) => HttpError.Internal.of('Response build failed', e)));
	}),
);
const handleMe = (repos: DatabaseServiceShape, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.session;
		const user = yield* repos.users.one([{ field: 'id', value: userId }]).pipe(
			Effect.mapError((e) => HttpError.Internal.of('User lookup failed', e)),
			Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('user', userId)), onSome: Effect.succeed })),
		);
		yield* audit.log('User', userId, 'read');
		return user;
	}).pipe(Effect.withSpan('auth.me', { kind: 'server' }));

// --- [MFA_HANDLERS] ----------------------------------------------------------

const handleMfaStatus = (mfa: typeof MfaService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const { userId } = yield* Context.Request.session;
		const status = yield* mfa.getStatus(userId);
		yield* audit.log('MfaSecret', userId, 'status');
		return status;
	}).pipe(Effect.withSpan('auth.mfa.status', { kind: 'server' }));
const handleMfaEnroll = (mfa: typeof MfaService.Service, repos: DatabaseServiceShape, audit: typeof AuditService.Service) =>
	RateLimit.apply('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const userOpt = yield* repos.users.one([{ field: 'id', value: sess.userId }]).pipe(Effect.mapError((e) => HttpError.Internal.of('User lookup failed', e)));
		const user = yield* Option.match(userOpt, { onNone: () => Effect.fail(HttpError.NotFound.of('user', sess.userId)), onSome: Effect.succeed });
		const result = yield* mfa.enroll(user.id, user.email);
		yield* audit.log('MfaSecret', sess.userId, 'enroll');
		return result;
	}));
const handleMfaVerify = (session: typeof SessionService.Service, audit: typeof AuditService.Service, code: string) =>
	RateLimit.apply('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const result = yield* session.verifyMfa(sess.id, sess.userId, code);
		yield* audit.log('MfaSecret', sess.userId, 'verify');
		return result;
	}));
const handleMfaDisable = (mfa: typeof MfaService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.session;
		yield* mfa.disable(userId);
		yield* audit.log('MfaSecret', userId, 'disable');
		return { success: true as const };
	}).pipe(Effect.withSpan('auth.mfa.disable', { kind: 'server' }));
const handleMfaRecover = (session: typeof SessionService.Service, audit: typeof AuditService.Service, code: string) =>
	RateLimit.apply('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const { remainingCodes } = yield* session.recoverMfa(sess.id, sess.userId, code.toUpperCase());
		yield* audit.log('MfaSecret', sess.userId, 'recover');
		return { remainingCodes, success: true as const };
	}));

// --- [APIKEY_HANDLERS] -------------------------------------------------------

const handleListApiKeys = (repos: DatabaseServiceShape, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.session;
		const keys = yield* repos.apiKeys.byUser(userId).pipe(Effect.mapError((e) => HttpError.Internal.of('API key list failed', e)));
		yield* audit.log('ApiKey', userId, 'list', { after: { count: keys.length } });
		return { data: keys };
	}).pipe(Effect.withSpan('auth.apiKeys.list', { kind: 'server' }));
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
	(repos: DatabaseServiceShape, audit: typeof AuditService.Service, input: { expiresAt?: Date; name: string }) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			yield* verifyCsrf(request);
			yield* Middleware.requireMfaVerified;
			const pair = yield* Crypto.token.pair.pipe(Effect.mapError((e) => HttpError.Internal.of('Key generation failed', e)));
			const [{ userId }, metrics] = yield* Effect.all([Context.Request.session, MetricsService]);
			const encrypted = yield* Crypto.encrypt(pair.token).pipe(
				Effect.catchAll((e) => Effect.fail(HttpError.Internal.of('Key encryption failed', e))),
			);
			const key = yield* repos.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash: pair.hash,
				lastUsedAt: Option.none(), name: input.name, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((e) => HttpError.Internal.of('API key insert failed', e)));
			yield* Effect.all([
				MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'create' })),
				audit.log('ApiKey', key.id, 'create', { after: { name: key.name } }),
			], { discard: true });
			return { ...key, apiKey: pair.token };
		}),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repos: DatabaseServiceShape, audit: typeof AuditService.Service, id: string) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		yield* Middleware.requireMfaVerified;
		const [{ userId }, metrics] = yield* Effect.all([Context.Request.session, MetricsService]);
		const keyOpt = yield* repos.apiKeys.one([{ field: 'id', value: id }]).pipe(Effect.mapError((e) => HttpError.Internal.of('API key lookup failed', e)));
		const key = yield* requireOption(Option.filter(keyOpt, (k) => k.userId === userId), () => HttpError.NotFound.of('apikey', id));
		yield* repos.apiKeys.softDelete(id).pipe(Effect.mapError((e) => HttpError.Internal.of('API key revocation failed', e)));
		yield* Effect.all([
			audit.log('ApiKey', id, 'revoke', { after: { name: key.name } }),
			MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'delete' })),
		], { discard: true });
		return { success: true } as const;
	}),
);

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
	Effect.gen(function* () {
		const [repos, oauth, session, audit, mfa] = yield* Effect.all([DatabaseService, OAuthService, SessionService, AuditService, MfaService]);
		return handlers
			// OAuth
			.handleRaw('oauthStart', ({ path: { provider } }) => RateLimit.apply('auth', handleOAuthStart(oauth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => RateLimit.apply('auth', handleOAuthCallback(oauth, repos, session, audit, provider, code, state)))
			// Session
			.handleRaw('refresh', () => RateLimit.apply('auth', handleRefresh(session, audit)))
			.handleRaw('logout', () => RateLimit.apply('api', handleLogout(session, audit)))
			.handle('me', () => RateLimit.apply('api', handleMe(repos, audit)))
			// MFA
			.handle('mfaStatus', () => handleMfaStatus(mfa, audit))
			.handle('mfaEnroll', () => handleMfaEnroll(mfa, repos, audit))
			.handle('mfaVerify', ({ payload }) => handleMfaVerify(session, audit, payload.code))
			.handle('mfaDisable', () => handleMfaDisable(mfa, audit))
			.handle('mfaRecover', ({ payload }) => handleMfaRecover(session, audit, payload.code))
			// API keys
			.handle('listApiKeys', () => RateLimit.apply('api', handleListApiKeys(repos, audit)))
			.handle('createApiKey', ({ payload }) => RateLimit.apply('mutation', handleCreateApiKey(repos, audit, payload)))
			.handle('deleteApiKey', ({ path: { id } }) => RateLimit.apply('mutation', handleDeleteApiKey(repos, audit, id)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
