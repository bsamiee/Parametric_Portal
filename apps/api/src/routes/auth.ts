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
import { DatabaseService } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { Auth } from '@parametric-portal/server/domain/auth';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { type DateTime, Effect, Option } from 'effect';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const requireOption = <A, E>(option: Option.Option<A>, onNone: () => E): Effect.Effect<A, E> => Option.match(option, { onNone: () => Effect.fail(onNone()), onSome: Effect.succeed });
const verifyCsrf = (request: HttpServerRequest.HttpServerRequest) =>
	requireOption(
		Option.filter(Headers.get(request.headers, Context.Request.config.csrf.header), (value) => value === Context.Request.config.csrf.expectedValue),
		() => HttpError.Auth.of('Missing or invalid CSRF header'),
	).pipe(Effect.asVoid);
const authResponse = (token: string, expiresAt: DateTime.Utc, refresh: string, mfaPending: boolean, clearOAuth = false) =>
	HttpServerResponse.json({ accessToken: token, expiresAt, mfaPending }).pipe(
		Effect.flatMap((res) => clearOAuth ? Context.Request.cookie.clear('oauth')(res) : Effect.succeed(res)),
		Effect.flatMap(Context.Request.cookie.set('refresh', refresh)),
	);
const logoutResponse = () => HttpServerResponse.json({ success: true }).pipe(Effect.flatMap(Context.Request.cookie.clear('refresh')));
const oauthErr = (provider: Context.OAuthProvider) => (reason: string) => HttpError.OAuth.of(provider, reason);

// --- [OAUTH_HANDLERS] --------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((auth: Auth.Service, provider: Context.OAuthProvider) =>
	auth.oauthStart(provider).pipe(
		Effect.flatMap((result) =>
			result._tag !== 'Initiate'
				? Effect.fail(HttpError.OAuth.of(provider, 'Unexpected response type'))
				: HttpServerResponse.json({ url: result.authUrl }).pipe(
					Effect.flatMap(Context.Request.cookie.set('oauth', result.cookie)),
					Effect.mapError(() => HttpError.OAuth.of(provider, 'Response build failed')),
				),
		),
	),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
	(auth: Auth.Service, provider: Context.OAuthProvider, code: string, state: string) =>
		Effect.gen(function* () {
			const error = oauthErr(provider);
			const request = yield* HttpServerRequest.HttpServerRequest;
			const stateCookie = yield* Context.Request.cookie.get('oauth', request, () => error('Missing OAuth state cookie'));
			const result = yield* auth.oauthCallback(provider, code, state, stateCookie);
			return yield* authResponse(result.accessToken, result.expiresAt, result.refreshToken, result.mfaPending, true).pipe(Effect.mapError(() => error('Response build failed')));
		}),
);

// --- [SESSION_HANDLERS] ------------------------------------------------------

const handleRefresh = Effect.fn('auth.refresh')((auth: Auth.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* Context.Request.cookie.get('refresh', request, () => HttpError.Auth.of('Missing refresh token cookie'));
		const tenantId = yield* Context.Request.currentTenantId;
		const hashIn = yield* Crypto.hmac(tenantId, refreshIn).pipe(Effect.mapError((error) => HttpError.Auth.of('Token hashing failed', error)));
		const { accessToken, expiresAt, mfaPending, refreshToken, userId } = yield* auth.refresh(hashIn);
		yield* audit.log('Auth.refresh', { subjectId: userId });
		return yield* authResponse(accessToken, expiresAt, refreshToken, mfaPending).pipe(Effect.mapError((error) => HttpError.Auth.of('Response build failed', error)));
	}),
);
const handleLogout = Effect.fn('auth.logout')((auth: Auth.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const session = yield* Context.Request.sessionOrFail;
		yield* auth.revoke(session.id, session.userId, 'logout');
		return yield* logoutResponse().pipe(Effect.mapError((error) => HttpError.Internal.of('Response build failed', error)));
	}),
);
const handleMe = (repositories: DatabaseService.Type, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		const user = yield* repositories.users.one([{ field: 'id', value: userId }]).pipe(
			Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)),
			Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('user', userId)), onSome: (user) => Effect.succeed(user) })),
		);
		yield* audit.log('User.read', { subjectId: userId });
		return user;
	}).pipe(Effect.withSpan('auth.me', { kind: 'server' }));

// --- [MFA_HANDLERS] ----------------------------------------------------------

const handleMfaStatus = (auth: Auth.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const { userId } = yield* Context.Request.sessionOrFail;
		const status = yield* auth.mfaStatus(userId);
		yield* audit.log('MfaSecret.status', { subjectId: userId });
		return status;
	}).pipe(Effect.withSpan('auth.mfa.status', { kind: 'server' }));
const handleMfaEnroll = (auth: Auth.Service, repositories: DatabaseService.Type) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const session = yield* Context.Request.sessionOrFail;
		const userOption = yield* repositories.users.one([{ field: 'id', value: session.userId }]).pipe(Effect.mapError((error) => HttpError.Internal.of('User lookup failed', error)));
		const user = yield* Option.match(userOption, { onNone: () => Effect.fail(HttpError.NotFound.of('user', session.userId)), onSome: (u) => Effect.succeed(u) });
		return yield* auth.mfaEnroll(user.id, user.email);
	}));
const handleMfaVerify = (auth: Auth.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const session = yield* Context.Request.sessionOrFail;
		return yield* auth.mfaVerify(session.id, code);
	}));
const handleMfaDisable = (auth: Auth.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		yield* auth.mfaDisable(userId);
		return { success: true as const };
	}).pipe(Effect.withSpan('auth.mfa.disable', { kind: 'server' }));
const handleMfaRecover = (auth: Auth.Service, code: string) =>
	CacheService.rateLimit('mfa', Effect.gen(function* () {
		const session = yield* Context.Request.sessionOrFail;
		return yield* auth.mfaRecover(session.id, code.toUpperCase());
	}));

// --- [APIKEY_HANDLERS] -------------------------------------------------------

const handleListApiKeys = (repositories: DatabaseService.Type, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Context.Request.sessionOrFail;
		const keys = yield* repositories.apiKeys.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('API key list failed', error)));
		yield* audit.log('ApiKey.list', { details: { count: keys.length }, subjectId: userId });
		return { data: keys };
	}).pipe(Effect.withSpan('auth.apiKeys.list', { kind: 'server' }));
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
	(repositories: DatabaseService.Type, audit: typeof AuditService.Service, input: { expiresAt?: Date; name: string }) =>
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			yield* verifyCsrf(request);
			yield* Middleware.requireMfaVerified;
			const pair = yield* Crypto.pair.pipe(Effect.mapError((error) => HttpError.Internal.of('Key generation failed', error)));
			const [{ userId }, metrics] = yield* Effect.all([Context.Request.sessionOrFail, MetricsService]);
			const encrypted = yield* Crypto.encrypt(pair.token).pipe(Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('Key encryption failed', error))),);
			const key = yield* repositories.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash: pair.hash,
				lastUsedAt: Option.none(), name: input.name, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((error) => HttpError.Internal.of('API key insert failed', error)));
			yield* Effect.all([
				MetricsService.inc(metrics.auth.apiKeys, MetricsService.label({ operation: 'create' })),
				audit.log('ApiKey.create', { details: { name: key.name }, subjectId: key.id }),
			], { discard: true });
			return { ...key, apiKey: pair.token };
		}),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repositories: DatabaseService.Type, audit: typeof AuditService.Service, id: string) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		yield* Middleware.requireMfaVerified;
		const [{ userId }, metrics] = yield* Effect.all([Context.Request.sessionOrFail, MetricsService]);
		const keyOption = yield* repositories.apiKeys.one([{ field: 'id', value: id }]).pipe(Effect.mapError((error) => HttpError.Internal.of('API key lookup failed', error)));
		const key = yield* requireOption(keyOption.pipe(Option.filter((apiKey) => apiKey.userId === userId)), () => HttpError.NotFound.of('apikey', id));
		yield* repositories.apiKeys.softDelete(id).pipe(Effect.mapError((error) => HttpError.Internal.of('API key revocation failed', error)));
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
		const [repositories, auth, audit] = yield* Effect.all([DatabaseService, Auth.Service, AuditService]);
		return handlers
			// OAuth
			.handleRaw('oauthStart', ({ path: { provider } }) => CacheService.rateLimit('auth', handleOAuthStart(auth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => CacheService.rateLimit('auth', handleOAuthCallback(auth, provider, code, state)))
			// Session
			.handleRaw('refresh', () => CacheService.rateLimit('auth', handleRefresh(auth, audit)))
			.handleRaw('logout', () => CacheService.rateLimit('api', handleLogout(auth)))
			.handle('me', () => CacheService.rateLimit('api', handleMe(repositories, audit)))
			// MFA
			.handle('mfaStatus', () => handleMfaStatus(auth, audit))
			.handle('mfaEnroll', () => handleMfaEnroll(auth, repositories))
			.handle('mfaVerify', ({ payload }) => handleMfaVerify(auth, payload.code))
			.handle('mfaDisable', () => handleMfaDisable(auth))
			.handle('mfaRecover', ({ payload }) => handleMfaRecover(auth, payload.code))
			// API keys
			.handle('listApiKeys', () => CacheService.rateLimit('api', handleListApiKeys(repositories, audit)))
			.handle('createApiKey', ({ payload }) => CacheService.rateLimit('mutation', handleCreateApiKey(repositories, audit, payload)))
			.handle('deleteApiKey', ({ path: { id } }) => CacheService.rateLimit('mutation', handleDeleteApiKey(repositories, audit, id)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
