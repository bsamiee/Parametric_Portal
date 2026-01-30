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
import { MfaService } from '@parametric-portal/server/domain/mfa';
import { OAuthService } from '@parametric-portal/server/domain/oauth';
import { SessionService } from '@parametric-portal/server/domain/session';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { CacheService } from '@parametric-portal/server/platform/cache';
import type { Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Effect, Option } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const requireOption = <A, E>(opt: Option.Option<A>, onNone: () => E): Effect.Effect<A, E> => Option.match(opt, { onNone: () => Effect.fail(onNone()), onSome: Effect.succeed });
const verifyCsrf = (req: HttpServerRequest.HttpServerRequest) =>
	requireOption(
		Option.filter(Headers.get(req.headers, Context.Request.config.csrf.header), (v) => v === Context.Request.config.csrf.expectedValue),
		() => HttpError.Auth.of('Missing or invalid CSRF header'),
	).pipe(Effect.asVoid);
const authResponse = (token: Uuidv7, expiresAt: Date, refresh: Uuidv7, mfaPending: boolean, clearOAuth = false) =>
	HttpServerResponse.json({ accessToken: token, expiresAt: DateTime.unsafeFromDate(expiresAt), mfaPending }).pipe(
		Effect.map((res) => clearOAuth ? Context.Request.cookie.clear('oauth')(res) : res),
		Effect.flatMap(Context.Request.cookie.set('refresh', refresh)),
	);
const logoutResponse = () => HttpServerResponse.json({ success: true }).pipe(Effect.map(Context.Request.cookie.clear('refresh')));
const oauthErr = (provider: Context.OAuthProvider) => (reason: string) => HttpError.OAuth.of(provider, reason);

// --- [OAUTH_HANDLERS] --------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: typeof OAuthService.Service, provider: Context.OAuthProvider) =>
	oauth.authorize(provider).pipe(
		Effect.flatMap(({ stateCookie, url }) => HttpServerResponse.json({ url: url.toString() }).pipe(Effect.flatMap(Context.Request.cookie.set('oauth', stateCookie))),
		),
		Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.OAuth.of(provider, e instanceof Error ? e.message : 'Authorization URL creation failed')),
	),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
	(oauth: typeof OAuthService.Service, repos: DatabaseServiceShape, session: typeof SessionService.Service, audit: typeof AuditService.Service, provider: Context.OAuthProvider, code: string, state: string) =>
		Effect.gen(function* () {
			const err = oauthErr(provider);
			const [request, appId] = yield* Effect.all([HttpServerRequest.HttpServerRequest, Context.Request.tenantId]);
			const stateCookie = yield* Context.Request.cookie.get('oauth', request, () => err('Missing OAuth state cookie'));
			const result = yield* oauth.authenticate(provider, code, state, stateCookie);
			const email = yield* requireOption(result.email, () => err('Email not provided by provider'));
			const { isNewUser, userId } = yield* repos.withTransaction(
				Effect.gen(function* () {
					const existingOpt = yield* repos.users.byEmail(appId, email).pipe(Effect.mapError(() => err('User lookup failed')));
					const { isNewUser, user } = yield* Option.match(existingOpt, {
						onNone: () => repos.users.insert({ appId, deletedAt: Option.none(), email, role: 'member', status: 'active', updatedAt: undefined }).pipe(
							Effect.mapError(() => err('User creation failed')),
							Effect.map((u) => ({ isNewUser: true, user: u })),
						),
						onSome: (existing) => Effect.succeed({ isNewUser: false, user: existing }),
					});
					const encAccess = yield* Crypto.encrypt(result.access).pipe(
						Effect.map((e) => Buffer.from(e)),
						Effect.catchAll(() => Effect.fail(err('Access token encryption failed'))),
					);
					const encRefresh = yield* Option.match(result.refresh, {
						onNone: () => Effect.succeed(Option.none<Buffer>()),
						onSome: (refresh) => Crypto.encrypt(refresh).pipe(Effect.map((e) => Option.some(Buffer.from(e))), Effect.catchAll(() => Effect.fail(err('Refresh token encryption failed')))),
					});
					yield* repos.oauthAccounts.upsert({
						accessEncrypted: encAccess, deletedAt: Option.none(), expiresAt: result.expiresAt,
						externalId: result.externalId, provider, refreshEncrypted: encRefresh,
						scope: Option.none(), updatedAt: undefined, userId: user.id,
					}).pipe(Effect.asVoid, Effect.mapError(() => err('OAuth account upsert failed')));
					return { isNewUser, userId: user.id };
				}),
			).pipe(Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.Internal.of('User creation transaction failed', e)));
			const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* session.login(userId, { isNewUser, provider }).pipe(Effect.mapError(() => err('Session creation failed')));
			yield* audit.log(isNewUser ? 'User.create' : 'User.login', { details: { email, provider }, subjectId: userId });
			return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending, true).pipe(Effect.mapError(() => err('Response build failed')));
		}),
);

// --- [SESSION_HANDLERS] ------------------------------------------------------

const handleRefresh = Effect.fn('auth.refresh')((session: typeof SessionService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* Context.Request.cookie.get('refresh', request, () => HttpError.Auth.of('Missing refresh token cookie'));
		const hashIn = yield* Crypto.hash(refreshIn).pipe(Effect.mapError((e) => HttpError.Auth.of('Token hashing failed', e)));
		const { mfaPending, refreshToken, sessionExpiresAt, sessionToken, userId } = yield* session.refresh(hashIn);
		yield* audit.log('RefreshToken.refresh', { subjectId: userId });
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
		yield* audit.log('Session.logout', { subjectId: sess.userId });
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
		yield* audit.log('User.read', { subjectId: userId });
		return user;
	}).pipe(Effect.withSpan('auth.me', { kind: 'server' }));

// --- [MFA_HANDLERS] ----------------------------------------------------------

const handleMfaStatus = (mfa: typeof MfaService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const { userId } = yield* Context.Request.session;
		const status = yield* mfa.getStatus(userId);
		yield* audit.log('MfaSecret.status', { subjectId: userId });
		return status;
	}).pipe(Effect.withSpan('auth.mfa.status', { kind: 'server' }));
const handleMfaEnroll = (mfa: typeof MfaService.Service, repos: DatabaseServiceShape, audit: typeof AuditService.Service) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const userOpt = yield* repos.users.one([{ field: 'id', value: sess.userId }]).pipe(Effect.mapError((e) => HttpError.Internal.of('User lookup failed', e)));
		const user = yield* Option.match(userOpt, { onNone: () => Effect.fail(HttpError.NotFound.of('user', sess.userId)), onSome: Effect.succeed });
		const result = yield* mfa.enroll(user.id, user.email);
		yield* audit.log('MfaSecret.enroll', { subjectId: sess.userId });
		return result;
	}));
const handleMfaVerify = (session: typeof SessionService.Service, audit: typeof AuditService.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const result = yield* session.verifyMfa(sess.id, sess.userId, code);
		yield* audit.log('MfaSecret.verify', { subjectId: sess.userId });
		return result;
	}));
const handleMfaDisable = (mfa: typeof MfaService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.session;
		yield* mfa.disable(userId);
		yield* audit.log('MfaSecret.disable', { subjectId: userId });
		return { success: true as const };
	}).pipe(Effect.withSpan('auth.mfa.disable', { kind: 'server' }));
const handleMfaRecover = (session: typeof SessionService.Service, audit: typeof AuditService.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const sess = yield* Context.Request.session;
		const { remainingCodes } = yield* session.recoverMfa(sess.id, sess.userId, code.toUpperCase());
		yield* audit.log('MfaSecret.recover', { subjectId: sess.userId });
		return { remainingCodes, success: true as const };
	}));

// --- [APIKEY_HANDLERS] -------------------------------------------------------

const handleListApiKeys = (repos: DatabaseServiceShape, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.session;
		const keys = yield* repos.apiKeys.byUser(userId).pipe(Effect.mapError((e) => HttpError.Internal.of('API key list failed', e)));
		yield* audit.log('ApiKey.list', { details: { count: keys.length }, subjectId: userId });
		return { data: keys };
	}).pipe(Effect.withSpan('auth.apiKeys.list', { kind: 'server' }));
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
	(repos: DatabaseServiceShape, audit: typeof AuditService.Service, input: { expiresAt?: Date; name: string }) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			yield* verifyCsrf(request);
			yield* Middleware.requireMfaVerified;
			const pair = yield* Crypto.pair.pipe(Effect.mapError((e) => HttpError.Internal.of('Key generation failed', e)));
			const [{ userId }, metrics] = yield* Effect.all([Context.Request.session, MetricsService]);
			const encrypted = yield* Crypto.encrypt(pair.token).pipe(Effect.catchAll((e) => Effect.fail(HttpError.Internal.of('Key encryption failed', e))),);
			const key = yield* repos.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash: pair.hash,
				lastUsedAt: Option.none(), name: input.name, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((e) => HttpError.Internal.of('API key insert failed', e)));
			yield* Effect.all([
				MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'create' })),
				audit.log('ApiKey.create', { details: { name: key.name }, subjectId: key.id }),
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
		const key = yield* requireOption(keyOpt.pipe(Option.filter((k) => k.userId === userId)), () => HttpError.NotFound.of('apikey', id));
		yield* repos.apiKeys.softDelete(id).pipe(Effect.mapError((e) => HttpError.Internal.of('API key revocation failed', e)));
		yield* Effect.all([
			audit.log('ApiKey.revoke', { details: { keyId: id, name: key.name }, subjectId: userId }),
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
			.handleRaw('oauthStart', ({ path: { provider } }) => CacheService.rateLimit('auth', handleOAuthStart(oauth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => CacheService.rateLimit('auth', handleOAuthCallback(oauth, repos, session, audit, provider, code, state)))
			// Session
			.handleRaw('refresh', () => CacheService.rateLimit('auth', handleRefresh(session, audit)))
			.handleRaw('logout', () => CacheService.rateLimit('api', handleLogout(session, audit)))
			.handle('me', () => CacheService.rateLimit('api', handleMe(repos, audit)))
			// MFA
			.handle('mfaStatus', () => handleMfaStatus(mfa, audit))
			.handle('mfaEnroll', () => handleMfaEnroll(mfa, repos, audit))
			.handle('mfaVerify', ({ payload }) => handleMfaVerify(session, audit, payload.code))
			.handle('mfaDisable', () => handleMfaDisable(mfa, audit))
			.handle('mfaRecover', ({ payload }) => handleMfaRecover(session, audit, payload.code))
			// API keys
			.handle('listApiKeys', () => CacheService.rateLimit('api', handleListApiKeys(repos, audit)))
			.handle('createApiKey', ({ payload }) => CacheService.rateLimit('mutation', handleCreateApiKey(repos, audit, payload)))
			.handle('deleteApiKey', ({ path: { id } }) => CacheService.rateLimit('mutation', handleDeleteApiKey(repos, audit, id)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
