/**
 * Auth group handlers for OAuth flows and session management.
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
import { Audit } from '@parametric-portal/server/audit';
import { Auth } from '@parametric-portal/server/auth';
import { RequestContext } from '@parametric-portal/server/context';
import { Crypto, TokenPair } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { Email, Timestamp, type Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Match, Metric, Option, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

const _OAuthProvider = { apple: 'apple', github: 'github', google: 'google', microsoft: 'microsoft' } as const;
type _OAuthProviderType = typeof _OAuthProvider[keyof typeof _OAuthProvider];
type _RoleType = 'admin' | 'guest' | 'member' | 'owner' | 'viewer';
type CookieKey = keyof typeof Auth.cookie;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const setCookie = (key: CookieKey, value: string, clear = false) => {
	const cfg = Auth.cookie[key];
	return (res: HttpServerResponse.HttpServerResponse) =>
		HttpServerResponse.setCookie(res, cfg.name, value, {
			httpOnly: true,
			maxAge: clear ? Duration.seconds(0) : Duration.seconds(cfg.maxAge),
			path: cfg.path,
			sameSite: cfg.sameSite,
			secure: cfg.secure,
		});
};
/** Returns Some(now) if MFA not enabled (auto-verified), None if MFA enabled (needs verification). */
const initialMfaVerifiedAt = (mfa: Option.Option<{ readonly enabledAt: Option.Option<Date> }>) =>
	Option.isNone(Option.flatMap(mfa, (m) => m.enabledAt)) ? Option.some(new Date()) : Option.none();
const dateJson = (opt: Option.Option<Date>) => Option.getOrNull(Option.map(opt, DateTime.unsafeFromDate));
const createTokens = () =>
	Effect.all([TokenPair.create, TokenPair.create]).pipe(
		Effect.map(([session, refresh]) => ({ refreshHash: refresh.hash, refreshToken: refresh.token, sessionHash: session.hash, sessionToken: session.token })),
	);
const requireOption = <A, E>(opt: Option.Option<A>, onNone: () => E): Effect.Effect<A, E> =>
	Option.match(opt, { onNone: () => Effect.fail(onNone()), onSome: Effect.succeed });
const verifyCsrf = (req: HttpServerRequest.HttpServerRequest) =>
	requireOption(
		Option.filter(Headers.get(req.headers, Auth.csrf.header), (v) => v === Auth.csrf.expectedValue),
		() => HttpError.auth('Missing or invalid CSRF header'),
	).pipe(Effect.asVoid);
const authResponse = (token: Uuidv7, expiresAt: Date, refresh: Uuidv7, mfaPending: boolean, clearOAuth = false) =>
	HttpServerResponse.json({ accessToken: token, expiresAt: DateTime.unsafeFromDate(expiresAt), mfaPending }).pipe(
		Effect.flatMap((res) => clearOAuth ? setCookie('oauth', '', true)(res) : Effect.succeed(res)),
		Effect.flatMap(setCookie('refresh', refresh)),
	);
const logoutResponse = () => HttpServerResponse.json({ success: true }).pipe(Effect.flatMap(setCookie('refresh', '', true)));
const rotateTokens = (repos: DatabaseServiceShape, userId: string, opts: {
	readonly mfaVerifiedAt: Option.Option<Date>;
	readonly revokeTokenId?: string;
}) =>
	Effect.gen(function* () {
		const ctx = yield* RequestContext.client;
		const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createTokens();
		const [sessionExpiresAt, refreshExpiresAt] = [Timestamp.expiresAtDate(Duration.toMillis(Auth.durations.session)), Timestamp.expiresAtDate(Duration.toMillis(Auth.durations.refresh))];
		yield* repos.withTransaction(Effect.all([
			repos.sessions.insert({
				deletedAt: Option.none(), expiresAt: sessionExpiresAt, hash: sessionHash,
				ipAddress: Option.fromNullable(ctx.ipAddress), updatedAt: undefined,
				userAgent: Option.fromNullable(ctx.userAgent), userId, verifiedAt: opts.mfaVerifiedAt,
			}).pipe(Effect.asVoid),
			repos.refreshTokens.insert({ deletedAt: Option.none(), expiresAt: refreshExpiresAt, hash: refreshHash, sessionId: Option.none(), userId }).pipe(Effect.asVoid),
			opts.revokeTokenId ? repos.refreshTokens.softDelete(opts.revokeTokenId) : Effect.void,
		], { discard: true }));
		return { mfaPending: Option.isNone(opts.mfaVerifiedAt), refreshToken, sessionExpiresAt, sessionToken };
	});

const oauthErr = (provider: _OAuthProviderType) => (reason: string) => HttpError.oauth(provider, reason);

// --- [FUNCTIONS] -------------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: typeof Middleware.OAuth.Service, provider: _OAuthProviderType) =>
	oauth.createAuthorizationUrl(provider).pipe(
		Effect.flatMap(({ stateCookie, url }) =>
			HttpServerResponse.json({ url: url.toString() }).pipe(Effect.flatMap(setCookie('oauth', stateCookie))),
		),
		Effect.mapError((e) => Match.value(e).pipe(Match.when((x: unknown): x is HttpError.OAuth => x instanceof HttpError.OAuth, (x) => x), Match.orElse((x) => HttpError.oauth(provider, x instanceof Error ? x.message : 'Authorization URL creation failed')))),
	),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
	(oauth: typeof Middleware.OAuth.Service, repos: DatabaseServiceShape, provider: _OAuthProviderType, code: string, state: string) =>
		Effect.gen(function* () {
			const err = oauthErr(provider);
			const request = yield* HttpServerRequest.HttpServerRequest;
			const stateCookie = yield* requireOption(Option.fromNullable(request.cookies[Auth.cookie.oauth.name]), () => err('Missing OAuth state cookie'));
			const [appId, result] = yield* Effect.all([RequestContext.app, oauth.authenticate(provider, code, state, stateCookie)]);
			const emailRaw = yield* requireOption(result.email, () => err('Email not provided by provider'));
			const email = yield* S.decodeUnknown(Email)(emailRaw).pipe(Effect.mapError(() => err('Invalid email format from provider')));
			const { isNewUser, userId } = yield* repos.withTransaction(
				Effect.gen(function* () {
					const existingOpt = yield* repos.users.byEmail(appId, email).pipe(Effect.mapError(() => err('User lookup failed')));
					const existing = Option.getOrNull(existingOpt);
					const user = yield* existing === null
						? repos.users.insert({ appId, deletedAt: Option.none(), email, role: 'member', state: 'active', updatedAt: undefined }).pipe(Effect.mapError(() => err('User creation failed')))
						: Effect.succeed(existing);
					const encAccess = yield* Crypto.Key.encrypt(result.access).pipe(Effect.map((e) => Buffer.from(e.toBytes())), Effect.mapError(() => err('Access token encryption failed')));
					const encRefresh = yield* Option.match(result.refresh, {
						onNone: () => Effect.succeed(Option.none<Buffer>()),
						onSome: (rt) => Crypto.Key.encrypt(rt).pipe(Effect.map((e) => Option.some(Buffer.from(e.toBytes()))), Effect.mapError(() => err('Refresh token encryption failed'))),
					});
					yield* repos.oauthAccounts.upsert({
						accessEncrypted: encAccess, deletedAt: Option.none(), expiresAt: result.expiresAt,
						externalId: result.externalId, provider, refreshEncrypted: encRefresh,
						scope: Option.none(), updatedAt: undefined, userId: user.id,
					}).pipe(Effect.mapError(() => err('OAuth account upsert failed')));
					return { isNewUser: existing === null, userId: user.id };
				}),
			).pipe(Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.internal('User creation transaction failed', e)));
			const metrics = yield* MetricsService;
			yield* Effect.all([
				Audit.log(repos.audit, 'User', userId, isNewUser ? 'create' : 'login', { actorEmail: email, after: { email, provider } }),
				Metric.update(metrics.auth.logins.pipe(Metric.tagged('provider', provider), Metric.tagged('is_new_user', String(isNewUser))), 1),
			], { discard: true });
			const mfaVerifiedAt = initialMfaVerifiedAt(yield* repos.mfaSecrets.byUser(userId).pipe(Effect.mapError(() => err('MFA status check failed'))));
			const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* rotateTokens(repos, userId, { mfaVerifiedAt }).pipe(Effect.mapError(() => err('Token generation failed')));
			return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending, true).pipe(Effect.mapError(() => err('Response build failed')));
		}),
);
const handleRefresh = Effect.fn('auth.refresh')((repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* requireOption(Option.fromNullable(request.cookies[Auth.cookie.refresh.name]), () => HttpError.auth('Missing refresh token cookie'));
		const hashIn = yield* Crypto.Token.hash(refreshIn).pipe(Effect.mapError((e) => HttpError.auth('Token hashing failed', e)));
		const { mfaPending, refreshToken, sessionExpiresAt, sessionToken, userId } = yield* repos.withTransaction(
			Effect.gen(function* () {
				const token = yield* repos.refreshTokens.byHashForUpdate(hashIn).pipe(
					Effect.flatMap((opt) => requireOption(opt, () => HttpError.auth('Invalid refresh token'))),
					Effect.mapError((e) => e instanceof HttpError.Auth ? e : HttpError.auth('Token lookup failed', e)),
				);
				const mfaVerifiedAt = initialMfaVerifiedAt(yield* repos.mfaSecrets.byUser(token.userId).pipe(Effect.mapError((e) => HttpError.auth('MFA status check failed', e))));
				const rotated = yield* rotateTokens(repos, token.userId, { mfaVerifiedAt, revokeTokenId: token.id }).pipe(Effect.mapError((e) => HttpError.auth('Token generation failed', e)));
				return { ...rotated, userId: token.userId };
			}),
		).pipe(Effect.mapError((e) => e instanceof HttpError.Auth ? e : HttpError.auth('Transaction failed', e)));
		const metrics = yield* MetricsService;
		yield* Effect.all([
			Audit.log(repos.audit, 'RefreshToken', userId, 'refresh'),
			Metric.update(metrics.auth.refreshes, 1),
		], { discard: true });
		return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending).pipe(Effect.mapError((e) => HttpError.auth('Response build failed', e)));
	}),
);
const handleLogout = Effect.fn('auth.logout')((repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		const [session, metrics] = yield* Effect.all([Middleware.Session, MetricsService]);
		yield* Effect.all([
			repos.sessions.softDelete(session.sessionId).pipe(Effect.mapError((e) => HttpError.internal('Session revocation failed', e))),
			repos.refreshTokens.softDeleteByUser(session.userId).pipe(Effect.mapError((e) => HttpError.internal('Token revocation failed', e))),
		], { discard: true });
		yield* Effect.all([
			Audit.log(repos.audit, 'Session', session.sessionId, 'logout'),
			Metric.update(metrics.auth.logouts, 1),
		], { discard: true });
		return yield* logoutResponse().pipe(Effect.mapError((e) => HttpError.internal('Response build failed', e)));
	}),
);
const handleMe = Effect.fn('auth.me')((repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const session = yield* Middleware.Session;
		const user = yield* repos.users.findById(session.userId).pipe(
			Effect.mapError((e) => HttpError.internal('User lookup failed', e)),
			Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.notFound('user', session.userId)), onSome: Effect.succeed })),
		);
		return { appId: user.appId, email: user.email, id: user.id, role: user.role, state: user.state } as { appId: string; email: string; id: string; role: _RoleType; state: string };
	}),
);
const handleListApiKeys = Effect.fn('auth.apiKeys.list')((repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Middleware.Session;
		const keys = yield* repos.apiKeys.byUser(userId).pipe(Effect.mapError((e) => HttpError.internal('API key list failed', e)));
		return { data: keys.map((k) => ({ expiresAt: dateJson(k.expiresAt), id: k.id, name: k.name, prefix: k.prefix })) };
	}),
);
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
	(repos: DatabaseServiceShape, input: { apiKey?: string; name: string }) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const apiKey = yield* input.apiKey ? Effect.succeed(input.apiKey) : Effect.fail(HttpError.validation('apiKey', 'API key is required'));
			const [{ userId }, metrics] = yield* Effect.all([Middleware.Session, MetricsService]);
			const [keyHash, encrypted] = yield* Effect.all([
				Crypto.Token.hash(apiKey).pipe(Effect.mapError((e) => HttpError.internal('Key hashing failed', e))),
				Crypto.Key.encrypt(apiKey).pipe(Effect.mapError((e) => HttpError.internal('Key encryption failed', e))),
			]);
			const keyEncrypted = Buffer.from(encrypted.toBytes());
			const key = yield* repos.apiKeys.insert({
				deletedAt: Option.none(), encrypted: keyEncrypted, expiresAt: Option.none(), hash: keyHash,
				lastUsedAt: Option.none(), name: input.name, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((e) => HttpError.internal('API key insert failed', e)));
			yield* Metric.update(metrics.auth.apiKeys.pipe(Metric.tagged('operation', 'create')), 1);
			return { expiresAt: dateJson(key.expiresAt), id: key.id, name: key.name, prefix: key.prefix };
		}),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repos: DatabaseServiceShape, id: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [{ userId }, metrics] = yield* Effect.all([Middleware.Session, MetricsService]);
		const keyOpt = yield* repos.apiKeys.findById(id).pipe(Effect.mapError((e) => HttpError.internal('API key lookup failed', e)));
		const key = yield* requireOption(Option.filter(keyOpt, (k) => k.userId === userId), () => HttpError.notFound('apikey', id));
		yield* repos.apiKeys.delete(id).pipe(Effect.mapError((e) => HttpError.internal('API key revocation failed', e)));
		yield* Effect.all([
			Audit.log(repos.audit, 'ApiKey', id, 'revoke', { after: { name: key.name } }),
			Metric.update(metrics.auth.apiKeys.pipe(Metric.tagged('operation', 'delete')), 1),
		], { discard: true });
		return { success: true } as const;
	}),
);

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
	Effect.gen(function* () {
		const [repos, oauth] = yield* Effect.all([DatabaseService, Middleware.OAuth]);
		return handlers
			.handleRaw('oauthStart', ({ path: { provider } }) => RateLimit.apply('auth', handleOAuthStart(oauth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => RateLimit.apply('auth', handleOAuthCallback(oauth, repos, provider, code, state)))
			.handleRaw('refresh', () => RateLimit.apply('auth', handleRefresh(repos)))
			.handleRaw('logout', () => handleLogout(repos))
			.handle('me', () => handleMe(repos))
			.handle('listApiKeys', () => handleListApiKeys(repos))
			.handle('createApiKey', ({ payload }) => handleCreateApiKey(repos, payload))
			.handle('deleteApiKey', ({ path: { id } }) => handleDeleteApiKey(repos, id));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
