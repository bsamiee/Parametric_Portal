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
import { Context } from '@parametric-portal/server/context';
import { Tenant } from '@parametric-portal/server/tenant';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { AuditService } from '@parametric-portal/server/domain/audit';
import { SessionService } from '@parametric-portal/server/domain/session';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { MetricsService } from '@parametric-portal/server/infra/metrics';
import { RateLimit } from '@parametric-portal/server/infra/rate-limit';
import type { Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Match, Metric, Option } from 'effect';

type OAuthProvider = Context.OAuthProvider;
const Auth = Context.Session.config;

// --- [TYPES] -----------------------------------------------------------------

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
const oauthErr = (provider: OAuthProvider) => (reason: string) => HttpError.oauth(provider, reason);

// --- [FUNCTIONS] -------------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: typeof Middleware.OAuth.Service, provider: OAuthProvider) =>
	oauth.createAuthorizationUrl(provider).pipe(
		Effect.flatMap(({ stateCookie, url }) =>
			HttpServerResponse.json({ url: url.toString() }).pipe(Effect.flatMap(setCookie('oauth', stateCookie))),
		),
		Effect.mapError((e) => Match.value(e).pipe(
			Match.when((x: unknown): x is HttpError.OAuth => x instanceof HttpError.OAuth, (x) => x),
			Match.orElse((x) => HttpError.oauth(provider, x instanceof Error ? x.message : 'Authorization URL creation failed')),
		)),
	),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
	(oauth: typeof Middleware.OAuth.Service, repos: DatabaseServiceShape, session: typeof SessionService.Service, audit: typeof AuditService.Service, provider: OAuthProvider, code: string, state: string) =>
		Effect.gen(function* () {
			const err = oauthErr(provider);
			const [request, ctx] = yield* Effect.all([HttpServerRequest.HttpServerRequest, Tenant.Context]);
			const appId = ctx.tenantId;
			// Validate OAuth state
			const stateCookie = yield* requireOption(Option.fromNullable(request.cookies[Auth.cookie.oauth.name]), () => err('Missing OAuth state cookie'));
			const result = yield* oauth.authenticate(provider, code, state, stateCookie);
			const email = yield* requireOption(result.email, () => err('Email not provided by provider'));
			// User creation/lookup + OAuth account upsert
			const { isNewUser, userId } = yield* repos.withTransaction(
				Effect.gen(function* () {
					const existingOpt = yield* repos.users.byEmail(appId, email).pipe(Effect.mapError(() => err('User lookup failed')));
					const existing = Option.getOrNull(existingOpt);
					const user = yield* existing === null
						? repos.users.insert({ appId, deletedAt: Option.none(), email, role: 'member', state: 'active', updatedAt: undefined }).pipe(Effect.mapError(() => err('User creation failed')))
						: Effect.succeed(existing);
					const encAccess = yield* Crypto.encrypt(result.access).pipe(Effect.map((e) => Buffer.from(e)), Effect.mapError(() => err('Access token encryption failed')));
					const encRefresh = yield* Option.match(result.refresh, {
						onNone: () => Effect.succeed(Option.none<Buffer>()),
						onSome: (rt) => Crypto.encrypt(rt).pipe(Effect.map((e) => Option.some(Buffer.from(e))), Effect.mapError(() => err('Refresh token encryption failed'))),
					});
					yield* repos.oauthAccounts.upsert({
						accessEncrypted: encAccess, deletedAt: Option.none(), expiresAt: result.expiresAt,
						externalId: result.externalId, provider, refreshEncrypted: encRefresh,
						scope: Option.none(), updatedAt: undefined, userId: user.id,
					}).pipe(Effect.asVoid, Effect.mapError(() => err('OAuth account upsert failed')));
					return { isNewUser: existing === null, userId: user.id };
				}),
			).pipe(Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.internal('User creation transaction failed', e)));
			// Create session (checks MFA internally, emits login metrics)
			const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* session.createForLogin(userId, { isNewUser, provider }).pipe(Effect.mapError(() => err('Session creation failed')));
			yield* audit.log('User', userId, isNewUser ? 'create' : 'login', { after: { email, provider } });
			return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending, true).pipe(Effect.mapError(() => err('Response build failed')));
		}),
);
const handleRefresh = Effect.fn('auth.refresh')((session: typeof SessionService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest;
		yield* verifyCsrf(request);
		const refreshIn = yield* requireOption(Option.fromNullable(request.cookies[Auth.cookie.refresh.name]), () => HttpError.auth('Missing refresh token cookie'));
		const hashIn = yield* Crypto.token.hash(refreshIn).pipe(Effect.mapError((e) => HttpError.auth('Token hashing failed', e)));
		// SessionService handles: token validation, MFA check, rotation, metrics
		const { mfaPending, refreshToken, sessionExpiresAt, sessionToken, userId } = yield* session.refresh(hashIn);
		yield* audit.log('RefreshToken', userId, 'refresh');
		return yield* authResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending).pipe(Effect.mapError((e) => HttpError.auth('Response build failed', e)));
	}),
);
const handleLogout = Effect.fn('auth.logout')((session: typeof SessionService.Service, audit: typeof AuditService.Service) =>
	Effect.gen(function* () {
		const ctx = yield* Middleware.Session;
		// SessionService handles: soft delete + metrics
		yield* session.revoke(ctx.id);
		yield* session.revokeAll(ctx.userId); // Also revoke refresh tokens
		yield* audit.log('Session', ctx.id, 'logout');
		return yield* logoutResponse().pipe(Effect.mapError((e) => HttpError.internal('Response build failed', e)));
	}),
);
const handleMe = (repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Middleware.Session;
		return yield* repos.users.one([{ field: 'id', value: userId }]).pipe(
			Effect.mapError((e) => HttpError.internal('User lookup failed', e)),
			Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.notFound('user', userId)), onSome: Effect.succeed })),
		);
	}).pipe(Effect.withSpan('auth.me'));
const handleListApiKeys = (repos: DatabaseServiceShape) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const { userId } = yield* Middleware.Session;
		const keys = yield* repos.apiKeys.byUser(userId).pipe(Effect.mapError((e) => HttpError.internal('API key list failed', e)));
		return { data: keys };
	}).pipe(Effect.withSpan('auth.apiKeys.list'));
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
	(repos: DatabaseServiceShape, input: { expiresAt?: Date; name: string }) =>
		Effect.gen(function* () {
			yield* Middleware.requireMfaVerified;
			const pair = yield* Crypto.token.pair.pipe(Effect.mapError((e) => HttpError.internal('Key generation failed', e)));
			const [{ userId }, metrics] = yield* Effect.all([Middleware.Session, MetricsService]);
			const encrypted = yield* Crypto.encrypt(pair.token).pipe(Effect.mapError((e) => HttpError.internal('Key encryption failed', e)));
			const key = yield* repos.apiKeys.insert({
				deletedAt: Option.none(), encrypted: Buffer.from(encrypted), expiresAt: Option.fromNullable(input.expiresAt), hash: pair.hash,
				lastUsedAt: Option.none(), name: input.name, updatedAt: undefined, userId,
			}).pipe(Effect.mapError((e) => HttpError.internal('API key insert failed', e)));
			yield* Metric.update(metrics.auth.apiKeys.pipe(Metric.tagged('operation', 'create')), 1);
			return { ...key, apiKey: pair.token };
		}),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repos: DatabaseServiceShape, audit: typeof AuditService.Service, id: string) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [{ userId }, metrics] = yield* Effect.all([Middleware.Session, MetricsService]);
		const keyOpt = yield* repos.apiKeys.one([{ field: 'id', value: id }]).pipe(Effect.mapError((e) => HttpError.internal('API key lookup failed', e)));
		const key = yield* requireOption(Option.filter(keyOpt, (k) => k.userId === userId), () => HttpError.notFound('apikey', id));
		yield* repos.apiKeys.softDelete(id).pipe(Effect.mapError((e) => HttpError.internal('API key revocation failed', e)));
		yield* Effect.all([
			audit.log('ApiKey', id, 'revoke', { after: { name: key.name } }),
			Metric.update(metrics.auth.apiKeys.pipe(Metric.tagged('operation', 'delete')), 1),
		], { discard: true });
		return { success: true } as const;
	}),
);

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
	Effect.gen(function* () {
		const [repos, oauth, session, audit] = yield* Effect.all([DatabaseService, Middleware.OAuth, SessionService, AuditService]);
		return handlers
			.handleRaw('oauthStart', ({ path: { provider } }) => RateLimit.apply('auth', handleOAuthStart(oauth, provider)))
			.handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => RateLimit.apply('auth', handleOAuthCallback(oauth, repos, session, audit, provider, code, state)))
			.handleRaw('refresh', () => RateLimit.apply('auth', handleRefresh(session, audit)))
			.handleRaw('logout', () => handleLogout(session, audit))
			.handle('me', () => handleMe(repos))
			.handle('listApiKeys', () => handleListApiKeys(repos))
			.handle('createApiKey', ({ payload }) => handleCreateApiKey(repos, payload))
			.handle('deleteApiKey', ({ path: { id } }) => handleDeleteApiKey(repos, audit, id));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
