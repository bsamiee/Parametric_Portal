/**
 * Unified authentication: OAuth flows, session lifecycle, MFA enrollment, WebAuthn credentials.
 * Rate-limited callbacks, TOTP/backup codes, passkey support, tenant-scoped token rotation.
 */
import { HttpTraceContext } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { OAuthProviderSchema, Session } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { Hex64 } from '@parametric-portal/types/types';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { Apple, decodeIdToken, generateCodeVerifier, generateState, GitHub, Google, MicrosoftEntraId, type OAuth2Tokens } from 'arctic';
import { Array as A, Clock, Config, DateTime, Duration, Effect, Encoding, Match, Option, Order, pipe, PrimaryKey, Redacted, Schema as S } from 'effect';
import { constant, flow, identity } from 'effect/Function';
import { customAlphabet } from 'nanoid';
import { randomBytes } from 'node:crypto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';
import { Crypto } from '../security/crypto.ts';
import { ReplayGuardService } from '../security/totp-replay.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _OauthLockout = S.Struct({ count: S.Number, lastFailure: S.Number, lockedUntil: S.Number });
const _Pkce = S.parseJson(S.Struct({ exp: S.Number, provider: OAuthProviderSchema, state: S.String, verifier: S.optional(S.String) }));
const _Tokens = S.Struct({ expiresAt: S.DateTimeUtc, refresh: S.Redacted(S.String), session: S.Redacted(S.String) });
const _AuthState = S.Union(
	S.Struct({ _tag: S.Literal('oauth'), provider: OAuthProviderSchema, requestId: S.String, tenantId: S.String }),
	S.Struct({ _tag: S.Literal('session'), provider: OAuthProviderSchema, requestId: S.String, sessionId: S.String, tenantId: S.String, tokens: _Tokens, userId: S.String, verifiedAt: S.OptionFromSelf(S.DateTimeUtc) }),
);
const _SessionCache = Session.pipe(S.pick('accessExpiresAt', 'appId', 'id', 'userId', 'verifiedAt'));

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
	oauthRateLimit: { baseMs: 60000, keyPrefix: 'oauth:fail:', maxAttempts: 5, maxMs: 900000, ttl: Duration.minutes(15) },
	sessionCache:   Config.all({
		capacity:   Config.integer('SESSION_CACHE_CAPACITY').pipe(Config.withDefault(5000)),
		ttl:        Config.map(Config.integer('SESSION_CACHE_TTL_SECONDS').pipe(Config.withDefault(300)), Duration.seconds),
	}),
	totp: { algorithm: 'sha256', digits: 6, epochTolerance: [30, 30] as [number,number], periodMs: 30000, periodSec: 30 },
	webauthn: { challengeKeyPrefix: 'webauthn:challenge:', challengeTtl: Duration.minutes(5), maxCredentialsPerUser: 10 },
} as const;
const _STATE_KEY = (scope: 'oauth' | 'session', tenantId: string, id: string) => `auth:state:${scope}:${tenantId}:${id}` as const;

// --- [ERRORS] ----------------------------------------------------------------

class AuthError extends S.TaggedError<AuthError>()('AuthError', {
	cause: S.optional(S.Unknown),
	context: S.optional(S.Record({ key: S.String, value: S.Unknown })),
	reason: S.Literal('phase_invalid', 'config_failed', 'oauth_encoding', 'oauth_state_mismatch', 'oauth_exchange_failed', 'oauth_user_fetch', 'oauth_rate_limited', 'mfa_not_enrolled', 'mfa_invalid_code', 'mfa_invalid_backup', 'token_invalid', 'token_expired', 'user_not_found', 'user_no_email', 'internal'),
}) {static readonly from = (reason: AuthError['reason'], context?: Record<string, unknown>, cause?: unknown) => new AuthError({ cause, context, reason });}

// --- [CLASSES] ---------------------------------------------------------------

class CacheKey extends S.TaggedRequest<CacheKey>()('CacheKey', {
	failure: AuthError,
	payload: { id: S.String, scope: S.String, tenantId: S.String },
	success: S.Unknown,
}) {[PrimaryKey.symbol]() { return `auth:${this.scope}:${this.tenantId}:${this.id}`; }}

// --- [SERVICES] --------------------------------------------------------------

class AuthService extends Effect.Service<AuthService>()('server/Auth', {
	effect: Effect.gen(function* () {
		const [db, metrics, audit, issuer, maxSessions, sessionCacheConfig, sqlClient] = yield* Effect.all([
			DatabaseService,
			MetricsService,
			AuditService,
			Config.string('APP_NAME').pipe(Config.withDefault('Parametric Portal')),
			Config.integer('MAX_SESSIONS_PER_USER').pipe(Config.withDefault(5)),
			_CONFIG.sessionCache,
			SqlClient.SqlClient,
		]);
			const oauth = yield* Effect.gen(function* () {
				const _caps = (provider: typeof OAuthProviderSchema.Type) => Context.Request.config.oauth.capabilities[provider];
				const _scopes = (provider: typeof OAuthProviderSchema.Type) => _caps(provider).oidc ? Context.Request.config.oauth.scopes.oidc : Context.Request.config.oauth.scopes.github;
				const configuration = yield* Config.all({
					baseUrl: Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000')),
				});
				const _redirect = (provider: typeof OAuthProviderSchema.Type) => `${configuration.baseUrl}/api/auth/oauth/${provider}/callback`;
					const _providerConfig = (provider: typeof OAuthProviderSchema.Type) => Effect.gen(function* () {
						const tenantId = yield* Context.Request.currentTenantId;
						const loaded = yield* db.apps.readSettings(tenantId).pipe(
							Effect.mapError((error) => AuthError.from('config_failed', { op: 'oauth_tenant_lookup', provider, tenantId }, error)),
							Effect.flatMap(Option.match({
								onNone: () => Effect.fail(AuthError.from('config_failed', { op: 'oauth_tenant_missing', provider, tenantId })),
								onSome: Effect.succeed,
							})),
						);
						const providerSettings = yield* Option.fromNullable(loaded.settings.oauthProviders.find((candidate) => candidate.provider === provider && candidate.enabled)).pipe(Option.match({
							onNone: () => Effect.fail(AuthError.from('config_failed', { op: 'oauth_provider_missing', provider, tenantId })),
							onSome: Effect.succeed,
						}));
					const clientSecret = yield* Encoding.decodeBase64(providerSettings.clientSecretEncrypted).pipe(
						Effect.mapError((error) => AuthError.from('config_failed', { op: 'oauth_secret_decode', provider, tenantId }, error)),
						Effect.flatMap(Crypto.decrypt),
						Effect.mapError((error) => AuthError.from('config_failed', { op: 'oauth_secret_decrypt', provider, tenantId }, error)),
					);
					return { clientSecret, providerSettings };
				});
				const _extractGithubUser = Effect.fn(function* (tokens: OAuth2Tokens, provider: typeof OAuthProviderSchema.Type) {
					const [requestContext, span] = yield* Effect.all([Context.Request.current, Effect.optionFromOptional(Effect.currentSpan)], { concurrency: 'unbounded' });
					const traceHeaders = Option.match(span, { onNone: () => ({}), onSome: HttpTraceContext.toHeaders });
					const response = yield* Effect.tryPromise({
					catch: (error) => AuthError.from('oauth_user_fetch', { provider }, error),
					try: () => fetch(Context.Request.config.endpoints.githubApi, { headers: { ...traceHeaders, Authorization: `Bearer ${tokens.accessToken()}`, 'User-Agent': 'ParametricPortal/1.0', [Context.Request.Headers.requestId]: requestContext.requestId } }),
				});
				yield* Effect.liftPredicate(response, (r) => r.ok, (r) => AuthError.from('oauth_user_fetch', { provider }, new Error(`github_user_fetch_${r.status}`)));
				const decoded = yield* Effect.tryPromise({
					catch: (error) => AuthError.from('oauth_user_fetch', { provider }, error),
					try: () => response.json() as Promise<{ id: number; email?: string | null }>,
				});
				return { email: Option.fromNullable(decoded.email), externalId: String(decoded.id) };
				});
				return {
					authUrl: (provider: typeof OAuthProviderSchema.Type, state: string, verifier?: string) => Effect.gen(function* () {
						const { clientSecret, providerSettings } = yield* _providerConfig(provider);
						const scopes = providerSettings.scopes && providerSettings.scopes.length > 0 ? providerSettings.scopes : _scopes(provider);
						const client = yield* Match.value(provider).pipe(
							Match.when('apple', () => providerSettings.teamId && providerSettings.keyId
								? Effect.succeed(new Apple(providerSettings.clientId, providerSettings.teamId, providerSettings.keyId, new TextEncoder().encode(clientSecret), _redirect('apple')))
								: Effect.fail(AuthError.from('config_failed', { op: 'oauth_apple_fields', provider }))),
							Match.when('github', () => Effect.succeed(new GitHub(providerSettings.clientId, clientSecret, _redirect('github')))),
							Match.when('google', () => Effect.succeed(new Google(providerSettings.clientId, clientSecret, _redirect('google')))),
							Match.orElse(() => Effect.succeed(new MicrosoftEntraId(providerSettings.tenant ?? 'common', providerSettings.clientId, clientSecret, _redirect('microsoft')))),
						);
						return _caps(provider).pkce
							? (client as Google | MicrosoftEntraId).createAuthorizationURL(state, verifier as string, [...scopes])
							: (client as GitHub | Apple).createAuthorizationURL(state, [...scopes]);
					}),
					exchange: (provider: typeof OAuthProviderSchema.Type, code: string, verifier?: string) => Effect.gen(function* () {
						const { clientSecret, providerSettings } = yield* _providerConfig(provider);
						const client = yield* Match.value(provider).pipe(
							Match.when('apple', () => providerSettings.teamId && providerSettings.keyId
								? Effect.succeed(new Apple(providerSettings.clientId, providerSettings.teamId, providerSettings.keyId, new TextEncoder().encode(clientSecret), _redirect('apple')))
								: Effect.fail(AuthError.from('config_failed', { op: 'oauth_apple_fields', provider }))),
							Match.when('github', () => Effect.succeed(new GitHub(providerSettings.clientId, clientSecret, _redirect('github')))),
							Match.when('google', () => Effect.succeed(new Google(providerSettings.clientId, clientSecret, _redirect('google')))),
							Match.orElse(() => Effect.succeed(new MicrosoftEntraId(providerSettings.tenant ?? 'common', providerSettings.clientId, clientSecret, _redirect('microsoft')))),
						);
						return yield* Effect.tryPromise({
							catch: (error) => AuthError.from('oauth_exchange_failed', { provider }, error),
							try: () => _caps(provider).pkce
								? (client as Google | MicrosoftEntraId).validateAuthorizationCode(code, verifier as string)
								: (client as GitHub | Apple).validateAuthorizationCode(code),
						});
					}),
					extractUser: (provider: typeof OAuthProviderSchema.Type, tokens: OAuth2Tokens): Effect.Effect<{ externalId: string; email: Option.Option<string> }, AuthError> => _caps(provider).oidc
						? Effect.try({ catch: (error) => AuthError.from('oauth_user_fetch', { provider }, error), try: () => decodeIdToken(tokens.idToken()) as { sub: string; email?: string } }).pipe(Effect.map((decoded) => ({ email: Option.fromNullable(decoded.email), externalId: decoded.sub })))
						: _extractGithubUser(tokens, provider),
				};
		});
		const cache = yield* CacheService.cache<CacheKey, unknown, never>({
			inMemoryCapacity: sessionCacheConfig.capacity,
			lookup: (key) => Match.value(key.scope).pipe(
				Match.when('mfa', () => Context.Request.withinSync(key.tenantId, db.mfaSecrets.byUser(key.id).pipe(
					Effect.map(flow(Option.flatMap((s) => s.enabledAt), Option.isSome)),
				)).pipe(Effect.mapError((error) => AuthError.from('internal', { op: 'mfa_status', tenantId: key.tenantId, userId: key.id }, error)))),
				Match.when('session', () => Context.Request.withinSync(key.tenantId, db.sessions.byHash(key.id as Hex64).pipe(
					Effect.tap(Option.match({ onNone: constant(Effect.void), onSome: (s) => db.sessions.touch(s.id).pipe(Effect.annotateLogs('sessionId', s.id), Effect.ignoreLogged) })),
					Effect.map(Option.map((s) => ({ accessExpiresAt: s.accessExpiresAt, appId: s.appId, id: s.id, userId: s.userId, verifiedAt: s.verifiedAt }))),
				)).pipe(Effect.mapError((error) => AuthError.from('internal', { op: 'session_cache' }, error)))),
				Match.orElse(() => Effect.fail(AuthError.from('internal', { key: key.id, op: 'cache_lookup', scope: key.scope }))),
			).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
			storeId: 'auth',
			timeToLive: sessionCacheConfig.ttl,
		});
		const invalidateSession = (tenantId: string, hashOrToken: string | Redacted.Redacted<string>) => (typeof hashOrToken === 'string' ? Effect.succeed(hashOrToken) : Crypto.hmac(tenantId, Redacted.value(hashOrToken))).pipe(Effect.flatMap((hash) => cache.invalidate(new CacheKey({ id: hash, scope: 'session', tenantId }))), Effect.catchAll((error) => Effect.logWarning('Session cache invalidation failed', { error: String(error), tenantId })), Effect.asVoid);
		const _activeCredentials = (userId: string) => db.webauthnCredentials.byUser(userId).pipe(Effect.map((credentials) => credentials.filter((credential) => Option.isNone(credential.deletedAt))), Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential lookup failed', error)));
		const [rpId, rpName, expectedOrigin] = yield* Effect.all([
			Config.string('WEBAUTHN_RP_ID').pipe(Config.withDefault('localhost')),
			Config.string('WEBAUTHN_RP_NAME').pipe(Config.withDefault('Parametric Portal')),
			Config.string('WEBAUTHN_ORIGIN').pipe(Config.withDefault('http://localhost:3000')),
		]);
		const oauthEndpoints = {
			callback: (provider: typeof OAuthProviderSchema.Type, code: string, state: string, cookie: string) => Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				const loaded = yield* CacheService.kv.get(_STATE_KEY('oauth', tenantId, cookie), _AuthState).pipe(
					Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('phase_invalid', { id: cookie, scope: 'oauth' })), onSome: Effect.succeed })),
				);
				const oauthLoaded = yield* Effect.succeed(loaded).pipe(
					Effect.filterOrFail(
						(s): s is Extract<typeof _AuthState.Type, { _tag: 'oauth' }> => s._tag === 'oauth',
						() => AuthError.from('phase_invalid', { actual: loaded._tag, allowed: ['oauth'] })
					)
				);
				const decoded = yield* Effect.andThen(Encoding.decodeBase64Url(cookie), Crypto.decrypt).pipe(
					Effect.flatMap(S.decodeUnknown(_Pkce)),
					Effect.mapError(flow(Match.value, Match.when(Match.instanceOf(AuthError), identity), Match.orElse(AuthError.from.bind(null, 'oauth_encoding', { provider })))),
				);
				const verifier = yield* Clock.currentTimeMillis.pipe(
					Effect.filterOrFail((now) => decoded.provider === provider && decoded.state === state && decoded.exp > now, constant(AuthError.from('oauth_state_mismatch', { provider }))),
					Effect.as(decoded.verifier),
				);
				const rlKey = `${_CONFIG.oauthRateLimit.keyPrefix}${provider}:${state}`;
				const lockout = yield* CacheService.kv.get(rlKey, _OauthLockout);
				const now = yield* Clock.currentTimeMillis;
				yield* pipe(lockout, Option.filter((s) => s.lockedUntil > now), Option.match({ onNone: constant(Effect.void), onSome: (s) => Effect.fail(AuthError.from('oauth_rate_limited', { identifier: `${provider}:${state}`, lockedUntilMs: s.lockedUntil - now, provider })) }));
				const recordFailure = Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const prev = yield* CacheService.kv.get(rlKey, _OauthLockout).pipe(Effect.map(Option.getOrElse(constant({ count: 0, lastFailure: now, lockedUntil: 0 }))));
					const count = prev.count + 1;
					const excess = count - _CONFIG.oauthRateLimit.maxAttempts;
					yield* CacheService.kv.set(rlKey, { count, lastFailure: now, lockedUntil: excess >= 0 ? now + Math.min(_CONFIG.oauthRateLimit.baseMs * (2 ** excess), _CONFIG.oauthRateLimit.maxMs) : 0 }, _CONFIG.oauthRateLimit.ttl);
				}).pipe(Effect.ignore);
					const oauthTokens = yield* oauth.exchange(provider, code, verifier).pipe(Effect.tapError(() => recordFailure));
				const userInfo = yield* oauth.extractUser(provider, oauthTokens).pipe(Effect.tapError(() => recordFailure));
				yield* CacheService.kv.del(rlKey).pipe(Effect.ignore);
				const externalAccountOpt = yield* db.oauthAccounts.byExternal(provider, userInfo.externalId);
				const { isNew, userId } = yield* pipe(externalAccountOpt, Option.match({
					onNone: constant(Effect.gen(function* () {
						const email = yield* pipe(userInfo.email, Option.match({ onNone: constant(Effect.fail(AuthError.from('user_no_email', { provider }))), onSome: Effect.succeed }));
						const user = yield* db.users.insert({ appId: oauthLoaded.tenantId, deletedAt: Option.none(), email, role: 'member', status: 'active', updatedAt: undefined }).pipe(Effect.mapError(AuthError.from.bind(null, 'internal', { op: 'resolve_user', provider })));
						return { isNew: true as const, userId: user.id };
					})),
					onSome: (existing) => db.users.one([{ field: 'id', value: existing.userId }]).pipe(Effect.flatMap(Option.match({ onNone: constant(Effect.fail(AuthError.from('user_not_found', { userId: existing.userId }))), onSome: constant(Effect.succeed({ isNew: false, userId: existing.userId })) })), Effect.mapError(flow(Match.value, Match.when(Match.instanceOf(AuthError), identity), Match.orElse(AuthError.from.bind(null, 'internal', { op: 'user_lookup', userId: existing.userId }))))),
				}));
				const allSessions = yield* db.sessions.byUser(userId).pipe(Effect.catchAll((error) => Effect.logWarning('Session limit enforcement failed', { error: String(error), userId }).pipe(Effect.as([]))));
				const activeSessions = pipe(allSessions.filter((s) => Option.isNone(s.deletedAt)), A.sortBy(Order.mapInput(Order.string, (s) => s.id)));
				yield* Effect.when(
					Effect.forEach(activeSessions.slice(0, activeSessions.length - maxSessions + 1), (s) => db.sessions.softDelete(s.id).pipe(Effect.tap(constant(invalidateSession(s.appId, s.hash)))), { discard: true }),
					constant(activeSessions.length >= maxSessions),
				).pipe(Effect.catchAll((error) => Effect.logWarning('Session limit enforcement failed', { error: String(error), userId })));
				const accessEncrypted = yield* Crypto.encrypt(oauthTokens.accessToken());
				const refreshToken = oauthTokens.refreshToken();
				const refreshEncrypted = refreshToken == null ? Option.none<Uint8Array>() : yield* Crypto.encrypt(refreshToken).pipe(Effect.map(Option.some));
				yield* db.oauthAccounts.upsert({ accessEncrypted, deletedAt: Option.none(), expiresAt: Option.fromNullable(oauthTokens.accessTokenExpiresAt()), externalId: userInfo.externalId, provider, refreshEncrypted, updatedAt: undefined, userId });
				const mfaEnabled = yield* db.mfaSecrets.byUser(userId).pipe(Effect.map((opt) => opt.pipe(Option.flatMap((s) => s.enabledAt), Option.isSome)));
				const [sessionPair, refreshPair, tokenRequestContext] = yield* Effect.all([Crypto.pair, Crypto.pair, Context.Request.current]);
				const [sessionHash, refreshHash] = yield* Effect.all([Crypto.hmac(oauthLoaded.tenantId, Redacted.value(sessionPair.token)), Crypto.hmac(oauthLoaded.tenantId, Redacted.value(refreshPair.token))]);
				const tokenNow = DateTime.unsafeNow();
				const sessionRow = yield* db.sessions.insert({
					accessExpiresAt: DateTime.toDateUtc(DateTime.addDuration(tokenNow, Context.Request.config.durations.session)),
					appId: oauthLoaded.tenantId,
					deletedAt: Option.none(),
					hash: sessionHash,
					ipAddress: tokenRequestContext.ipAddress,
					refreshExpiresAt: DateTime.toDateUtc(DateTime.addDuration(tokenNow, Context.Request.config.durations.refresh)),
					refreshHash,
					updatedAt: undefined,
					userAgent: tokenRequestContext.userAgent,
					userId,
					verifiedAt: mfaEnabled ? Option.none() : Option.some(new Date()),
				});
				const sessionId = sessionRow.id;
				const nextTokens = { expiresAt: DateTime.addDuration(tokenNow, Context.Request.config.durations.session), refresh: refreshPair.token, session: sessionPair.token };
				yield* Effect.all([MetricsService.inc(metrics.auth.logins, MetricsService.label({ isNewUser: String(isNew), provider })), audit.log('Auth.login', { details: { isNew, mfaEnabled, provider }, subjectId: userId })], { discard: true });
				const authenticated = { provider, requestId: oauthLoaded.requestId, sessionId, tenantId: oauthLoaded.tenantId, tokens: nextTokens, userId };
				const verifiedAt = mfaEnabled ? Option.none() : Option.some(DateTime.unsafeNow());
				const sessionState: typeof _AuthState.Type = { _tag: 'session', provider: authenticated.provider, requestId: authenticated.requestId, sessionId: authenticated.sessionId, tenantId: authenticated.tenantId, tokens: authenticated.tokens, userId: authenticated.userId, verifiedAt };
				yield* Effect.all([CacheService.kv.del(_STATE_KEY('oauth', tenantId, cookie)).pipe(Effect.ignore), CacheService.kv.set(_STATE_KEY('session', tenantId, authenticated.sessionId), sessionState, Context.Request.config.durations.session)], { discard: true });
				return { accessToken: Redacted.value(nextTokens.session), expiresAt: nextTokens.expiresAt, mfaPending: mfaEnabled, refreshToken: Redacted.value(nextTokens.refresh), sessionId: authenticated.sessionId, userId };
			}).pipe(Effect.mapError((error) => error instanceof AuthError ? HttpError.OAuth.of(provider, error.reason, error) : HttpError.Internal.of('OAuth callback failed', error)), Telemetry.span('auth.oauth.callback', { metrics: false, 'oauth.provider': provider })),
			start: (provider: typeof OAuthProviderSchema.Type) => Effect.gen(function* () {
				const { requestId, tenantId } = yield* Context.Request.current;
				const oauthState = generateState();
				const verifier = Context.Request.config.oauth.capabilities[provider].pkce ? generateCodeVerifier() : undefined;
				const cookie = yield* Clock.currentTimeMillis.pipe(
					Effect.flatMap((now) => S.encode(_Pkce)({ exp: now + Duration.toMillis(Context.Request.config.durations.pkce), provider, state: oauthState, verifier })),
					Effect.flatMap(Crypto.encrypt),
					Effect.map(Encoding.encodeBase64Url),
					Effect.mapError(() => AuthError.from('config_failed', { op: 'encrypt_state' }))
				);
				yield* MetricsService.inc((yield* MetricsService).oauth.authorizations, MetricsService.label({ provider }));
				yield* CacheService.kv.set(_STATE_KEY('oauth', tenantId, cookie), { _tag: 'oauth', provider, requestId, tenantId }, Context.Request.config.durations.pkce);
					const authUrl = yield* oauth.authUrl(provider, oauthState, verifier);
					return { _tag: 'Initiate' as const, authUrl: authUrl.toString(), cookie };
			}).pipe(Effect.mapError((error) => HttpError.OAuth.of(provider, error instanceof AuthError ? error.reason : 'internal', error)), Telemetry.span('auth.oauth.start', { metrics: false, 'oauth.provider': provider })),
		};
		const session = {
			lookup: (hash: Hex64) => Context.Request.current.pipe(Effect.flatMap((context) => (cache.get(new CacheKey({ id: hash, scope: 'session', tenantId: context.tenantId })) as Effect.Effect<Option.Option<typeof _SessionCache.Type>>).pipe(Effect.flatMap(Option.match({
				onNone: () => Effect.succeed(Option.none()),
				onSome: (sessionRow) => sessionRow.appId === context.tenantId
					? Clock.currentTimeMillis.pipe(Effect.flatMap((now) => now > sessionRow.accessExpiresAt.getTime()
						? Effect.logWarning('Session expired', { accessExpiresAt: sessionRow.accessExpiresAt, sessionId: sessionRow.id }).pipe(Effect.as(Option.none()))
						: (cache.get(new CacheKey({ id: sessionRow.userId, scope: 'mfa', tenantId: context.tenantId })) as Effect.Effect<boolean>).pipe(Effect.map((mfaEnabled) => Option.some({ appId: sessionRow.appId, id: sessionRow.id, kind: 'session' as const, mfaEnabled, userId: sessionRow.userId, verifiedAt: sessionRow.verifiedAt })))))
					: Effect.logWarning('Session tenant mismatch', { expected: context.tenantId, got: sessionRow.appId }).pipe(Effect.as(Option.none())),
			})))), Effect.mapError((error) => AuthError.from('internal', { op: 'session.lookup' }, error)), Telemetry.span('auth.session.lookup', { metrics: false })),
			refresh: (hash: Hex64) => Effect.gen(function* () {
				const [tenantId, found] = yield* Effect.all([
					Context.Request.currentTenantId,
					db.sessions.byRefreshHash(hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('token_invalid')), onSome: Effect.succeed }))),
				]);
				yield* Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => now <= found.refreshExpiresAt.getTime(), () => AuthError.from('token_expired')));
				const loaded = yield* CacheService.kv.get(_STATE_KEY('session', tenantId, found.id), _AuthState).pipe(
					Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('phase_invalid', { id: found.id, scope: 'session' })), onSome: Effect.succeed })),
				);
				const sessionLoaded = yield* Effect.succeed(loaded).pipe(
					Effect.filterOrFail(
						(s): s is Extract<typeof _AuthState.Type, { _tag: 'session' }> => s._tag === 'session',
						() => AuthError.from('phase_invalid', { actual: loaded._tag, allowed: ['session'] })
					)
				);
				const stateTag = sessionLoaded.verifiedAt.pipe(Option.match({ onNone: () => 'mfa' as const, onSome: () => 'active' as const }));
				const { nextSessionId, nextSessionVerifiedAt, nextTokens, mfaPending } = yield* db.withTransaction(Effect.gen(function* () {
					const sessionRow = yield* db.sessions.byRefreshHashForUpdate(hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('token_invalid')), onSome: Effect.succeed })));
					yield* Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => now <= sessionRow.refreshExpiresAt.getTime(), () => AuthError.from('token_expired')));
					yield* db.sessions.softDelete(sessionRow.id);
					const mfaPending = stateTag === 'mfa' && (yield* db.mfaSecrets.byUser(sessionRow.userId).pipe(Effect.map((opt) => opt.pipe(Option.flatMap((s) => s.enabledAt), Option.isSome))));
					const [sessionPair, refreshPair, tokenRequestContext] = yield* Effect.all([Crypto.pair, Crypto.pair, Context.Request.current]);
					const [txSessionHash, txRefreshHash] = yield* Effect.all([Crypto.hmac(sessionLoaded.tenantId, Redacted.value(sessionPair.token)), Crypto.hmac(sessionLoaded.tenantId, Redacted.value(refreshPair.token))]);
					const tokenNow = DateTime.unsafeNow();
					const nextSessionVerifiedAt = mfaPending ? Option.none<DateTime.Utc>() : Option.some(DateTime.unsafeNow());
					const newSessionRow = yield* db.sessions.insert({
						accessExpiresAt: DateTime.toDateUtc(DateTime.addDuration(tokenNow, Context.Request.config.durations.session)),
						appId: sessionLoaded.tenantId,
						deletedAt: Option.none(),
						hash: txSessionHash,
						ipAddress: tokenRequestContext.ipAddress,
						refreshExpiresAt: DateTime.toDateUtc(DateTime.addDuration(tokenNow, Context.Request.config.durations.refresh)),
						refreshHash: txRefreshHash,
						updatedAt: undefined,
						userAgent: tokenRequestContext.userAgent,
						userId: sessionRow.userId,
						verifiedAt: Option.map(nextSessionVerifiedAt, DateTime.toDateUtc),
					});
					const nextSessionId = newSessionRow.id;
					const nextTokens = { expiresAt: DateTime.addDuration(tokenNow, Context.Request.config.durations.session), refresh: refreshPair.token, session: sessionPair.token };
					return { mfaPending, nextSessionId, nextSessionVerifiedAt, nextTokens };
				}));
				yield* invalidateSession(sessionLoaded.tenantId, sessionLoaded.tokens.session);
				yield* MetricsService.inc(metrics.auth.refreshes, MetricsService.label({ tenant: sessionLoaded.tenantId }));
				const nextSessionState: typeof _AuthState.Type = { _tag: 'session', provider: sessionLoaded.provider, requestId: sessionLoaded.requestId, sessionId: nextSessionId, tenantId, tokens: nextTokens, userId: found.userId, verifiedAt: nextSessionVerifiedAt };
				yield* Effect.all([CacheService.kv.del(_STATE_KEY('session', tenantId, found.id)).pipe(Effect.ignore), CacheService.kv.set(_STATE_KEY('session', tenantId, nextSessionId), nextSessionState, Context.Request.config.durations.session)], { discard: true });
				return { accessToken: Redacted.value(nextTokens.session), expiresAt: nextTokens.expiresAt, mfaPending, refreshToken: Redacted.value(nextTokens.refresh), userId: found.userId };
			}).pipe(Effect.mapError((error) => error instanceof AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of('Token refresh failed', error)), Telemetry.span('auth.refresh', { metrics: false })),
			revoke: (sessionId: string, reason: 'logout' | 'timeout' | 'security') => Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				const loaded = yield* CacheService.kv.get(_STATE_KEY('session', tenantId, sessionId), _AuthState).pipe(
					Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('phase_invalid', { id: sessionId, scope: 'session' })), onSome: Effect.succeed })),
				);
				const sessionLoaded = yield* Effect.succeed(loaded).pipe(
					Effect.filterOrFail(
						(s): s is Extract<typeof _AuthState.Type, { _tag: 'session' }> => s._tag === 'session',
						() => AuthError.from('phase_invalid', { actual: loaded._tag, allowed: ['session'] })
					)
				);
				yield* db.sessions.softDelete(sessionLoaded.sessionId);
				const revokedAt = DateTime.unsafeNow();
				yield* invalidateSession(sessionLoaded.tenantId, sessionLoaded.tokens.session);
				yield* Effect.all([MetricsService.inc(metrics.auth.logouts, MetricsService.label({ reason, tenant: sessionLoaded.tenantId })), audit.log('Auth.revoke', { details: { reason }, subjectId: sessionLoaded.userId })], { discard: true });
				yield* CacheService.kv.del(_STATE_KEY('session', tenantId, sessionId)).pipe(Effect.ignore);
				return { _tag: 'Revoke' as const, revokedAt };
			}).pipe(Effect.catchAll((error) => error instanceof AuthError && error.reason === 'phase_invalid'
				? Effect.gen(function* () {
					const tenantId = yield* Context.Request.currentTenantId;
					const sessionOption = yield* db.sessions.one([{ field: 'id', value: sessionId }]).pipe(Effect.orElseSucceed(() => Option.none()));
					yield* db.sessions.softDelete(sessionId).pipe(Effect.ignore);
					yield* Option.match(sessionOption, { onNone: () => Effect.void, onSome: (existing) => invalidateSession(existing.appId, existing.hash) });
					yield* CacheService.kv.del(_STATE_KEY('session', tenantId, sessionId)).pipe(Effect.ignore);
					return { _tag: 'Revoke', revokedAt: DateTime.unsafeNow() } as const;
				})
				: Effect.fail(HttpError.Internal.of('Session revocation failed', error))),
			Telemetry.span('auth.revoke', { 'auth.reason': reason, metrics: false })),
		};
		const mfa = {
			disable: (userId: string) => Telemetry.span(Effect.gen(function* () {
				const requestContext = yield* Context.Request.current;
				const option = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)));
				yield* Effect.filterOrFail(Effect.succeed(option), Option.isSome, () => HttpError.NotFound.of('mfa'));
				yield* db.mfaSecrets.softDelete(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA soft delete failed', error)));
				yield* cache.invalidate(new CacheKey({ id: userId, scope: 'mfa', tenantId: requestContext.tenantId })).pipe(Effect.ignore);
				yield* Effect.all([MetricsService.inc(metrics.mfa.disabled, MetricsService.label({ tenant: requestContext.tenantId }), 1), audit.log('MfaSecret.disable', { subjectId: userId })], { discard: true });
				return { success: true as const };
			}), 'mfa.disable', { metrics: false }),
			enroll: (userId: string, email: string) => Telemetry.span(Effect.gen(function* () {
				const requestContext = yield* Context.Request.current;
				const existing = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA enrollment check failed', error)));
				yield* Effect.filterOrFail(Effect.succeed(existing), (e) => !(Option.isSome(e) && Option.isSome(e.value.enabledAt)), () => HttpError.Conflict.of('mfa', 'MFA already enabled'));
				const secret = yield* Effect.sync(generateSecret);
				const encrypted = yield* Crypto.encrypt(secret).pipe(Effect.mapError((error) => HttpError.Internal.of('TOTP secret encryption failed', error)));
				const _makeBackup = customAlphabet(_CONFIG.backup.alphabet, _CONFIG.backup.length);
				const backupCodes = Array.from({ length: _CONFIG.backup.count }, () => _makeBackup());
				const salt = Encoding.encodeHex(randomBytes(16));
				const backupHashes = yield* Effect.all(backupCodes.map((backupCode) => Crypto.hash(`${salt}${backupCode.toUpperCase()}`).pipe(Effect.map((hash) => `${salt}$${hash}`))), { concurrency: 'unbounded' });
				yield* Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes, encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('MFA upsert failed', error))));
				yield* cache.invalidate(new CacheKey({ id: userId, scope: 'mfa', tenantId: requestContext.tenantId })).pipe(Effect.ignore);
				yield* Effect.all([MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ tenant: requestContext.tenantId }), 1), audit.log('MfaSecret.enroll', { details: { backupCodesGenerated: _CONFIG.backup.count }, subjectId: userId })], { discard: true });
				return { backupCodes, qrDataUrl: generateURI({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, issuer, label: email, period: _CONFIG.totp.periodSec, secret }), secret };
			}), 'mfa.enroll', { metrics: false }),
			status: (userId: string) => db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)), Effect.map(Option.match({ onNone: () => ({ enabled: false, enrolled: false }) as const, onSome: (mfaSecret) => ({ enabled: Option.isSome(mfaSecret.enabledAt), enrolled: true, remainingBackupCodes: mfaSecret.backupHashes.length }) as const }))),
			verify: (sessionId: string, code: string, mode: 'backup' | 'totp') => Effect.gen(function* () {
				const tenantId = yield* Context.Request.currentTenantId;
				const loaded = yield* CacheService.kv.get(_STATE_KEY('session', tenantId, sessionId), _AuthState).pipe(
					Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('phase_invalid', { id: sessionId, scope: 'session' })), onSome: Effect.succeed })),
				);
				const sessionLoaded = yield* Effect.succeed(loaded).pipe(
					Effect.filterOrFail(
						(s): s is Extract<typeof _AuthState.Type, { _tag: 'session' }> => s._tag === 'session',
						() => AuthError.from('phase_invalid', { actual: loaded._tag, allowed: ['session'] })
					)
				);
				const isBackup = mode === 'backup';
				const replayGuard = yield* ReplayGuardService;
				yield* replayGuard.checkLockout(sessionLoaded.userId);
				const mfaSecret = yield* db.mfaSecrets.byUser(sessionLoaded.userId).pipe(Effect.mapError((error) => AuthError.from('internal', { op: 'mfa_lookup', userId: sessionLoaded.userId }, error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('mfa_not_enrolled', { userId: sessionLoaded.userId })), onSome: Effect.succeed })));
				const now = yield* Clock.currentTimeMillis;
				const remainingCodes = yield* isBackup
					? Effect.all(mfaSecret.backupHashes.map((entry, index) => {
						const sep = entry.indexOf('$');
						return sep <= 0 || sep >= entry.length - 1 ? Effect.succeed(Option.none<number>()) : Crypto.hash(`${entry.slice(0, sep)}${code.toUpperCase()}`).pipe(Effect.flatMap((computed) => Crypto.compare(computed, entry.slice(sep + 1))), Effect.map((isMatch) => isMatch ? Option.some(index) : Option.none()));
					}), { concurrency: 1 }).pipe(Effect.map(Option.firstSomeOf), Effect.flatMap(Option.match({
						onNone: () => replayGuard.recordFailure(sessionLoaded.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_backup', { remaining: mfaSecret.backupHashes.length })))),
						onSome: (index) => db.mfaSecrets.upsert({ backupHashes: mfaSecret.backupHashes.filter((_, idx) => idx !== index), enabledAt: mfaSecret.enabledAt, encrypted: mfaSecret.encrypted, userId: sessionLoaded.userId }).pipe(Effect.tap(() => replayGuard.recordSuccess(sessionLoaded.userId)), Effect.as(mfaSecret.backupHashes.length - 1), Effect.mapError((error) => AuthError.from('mfa_invalid_backup', { userId: sessionLoaded.userId }, error))),
					})))
					: Crypto.decrypt(mfaSecret.encrypted).pipe(Effect.mapError((error) => AuthError.from('mfa_invalid_code', { userId: sessionLoaded.userId }, error)), Effect.flatMap((secret) => Effect.try({ catch: () => AuthError.from('mfa_invalid_code', { userId: sessionLoaded.userId }), try: () => verifySync({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, epochTolerance: _CONFIG.totp.epochTolerance, period: _CONFIG.totp.periodSec, secret, token: code }) })), Effect.filterOrElse((result) => result.valid, () => replayGuard.recordFailure(sessionLoaded.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_code', { userId: sessionLoaded.userId }))))), Effect.flatMap((result) => replayGuard.checkAndMark(sessionLoaded.userId, Math.floor(now / _CONFIG.totp.periodMs) + ((result as { delta?: number }).delta ?? 0), code)), Effect.filterOrElse(({ alreadyUsed }) => !alreadyUsed, () => replayGuard.recordFailure(sessionLoaded.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_code', { userId: sessionLoaded.userId }))))), Effect.tap(() => replayGuard.recordSuccess(sessionLoaded.userId)), Effect.tap(() => Option.isNone(mfaSecret.enabledAt) ? db.mfaSecrets.upsert({ backupHashes: mfaSecret.backupHashes, enabledAt: Option.some(new Date()), encrypted: mfaSecret.encrypted, userId: sessionLoaded.userId }) : Effect.void), Effect.as(mfaSecret.backupHashes.length));
				const verifiedAt = DateTime.unsafeNow();
				yield* db.sessions.verify(sessionLoaded.sessionId).pipe(Effect.ignore);
				yield* invalidateSession(sessionLoaded.tenantId, sessionLoaded.tokens.session);
				yield* Effect.all([MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ tenant: sessionLoaded.tenantId })), audit.log('Auth.verifyMfa', { subjectId: sessionLoaded.userId })], { discard: true });
				const nextSessionState: typeof _AuthState.Type = { _tag: 'session', provider: sessionLoaded.provider, requestId: sessionLoaded.requestId, sessionId: sessionLoaded.sessionId, tenantId, tokens: sessionLoaded.tokens, userId: sessionLoaded.userId, verifiedAt: Option.some(verifiedAt) };
				yield* CacheService.kv.set(_STATE_KEY('session', tenantId, sessionId), nextSessionState, Context.Request.config.durations.session);
				return mode === 'backup' ? { remainingCodes, success: true as const } : { success: true as const };
			}).pipe(Effect.mapError((error) => error instanceof AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of(`MFA ${mode} failed`, error)), Telemetry.span(mode === 'backup' ? 'auth.mfa.recover' : 'auth.mfa.verify', { metrics: false, 'mfa.method': mode === 'backup' ? 'backup' : 'totp' })),
		};
		const webauthn = {
			authentication: {
				start: (userId: string) => Telemetry.span(Effect.gen(function* () {
					const credentials = yield* _activeCredentials(userId);
					yield* Effect.filterOrFail(Effect.succeed(credentials), (c) => c.length > 0, () => HttpError.NotFound.of('webauthn_credentials', undefined, 'No passkeys registered'));
					const options = yield* Effect.tryPromise({ catch: (error) => HttpError.Internal.of('WebAuthn authentication options generation failed', error), try: () => generateAuthenticationOptions({ allowCredentials: credentials.map((credential) => ({ id: credential.credentialId, transports: credential.transports as AuthenticatorTransportFuture[] })), rpID: rpId }) });
					yield* Clock.currentTimeMillis.pipe(Effect.flatMap((now) => CacheService.kv.set(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, { challenge: options.challenge, exp: now + Duration.toMillis(_CONFIG.webauthn.challengeTtl), userId }, _CONFIG.webauthn.challengeTtl)), Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge store failed', error)));
					return options;
				}), 'webauthn.authentication.start', { metrics: false }),
				verify: (userId: string, response: unknown) => Telemetry.span(Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
					const stored = yield* CacheService.kv.get(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, S.Struct({ challenge: S.String, exp: S.Number, userId: S.String })).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge lookup failed', error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Auth.of('WebAuthn challenge expired or not found')), onSome: Effect.succeed })), Effect.flatMap((stored) => Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => stored.exp >= now, () => HttpError.Auth.of('WebAuthn challenge expired')), Effect.as(stored))));
					const credentialId = (response as { id?: string })?.id ?? '';
					const credential = yield* db.webauthnCredentials.byCredentialId(credentialId).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential lookup failed', error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Auth.of('WebAuthn credential not found')), onSome: Effect.succeed })));
					const verification = yield* Effect.tryPromise({ catch: (error) => HttpError.Auth.of('WebAuthn authentication verification failed', error), try: () => verifyAuthenticationResponse({ credential: { counter: credential.counter, id: credential.credentialId, publicKey: credential.publicKey as Uint8Array<ArrayBuffer>, transports: credential.transports as AuthenticatorTransportFuture[] }, expectedChallenge: stored.challenge, expectedOrigin, expectedRPID: rpId, response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'] }) });
					yield* Effect.filterOrFail(Effect.succeed(verification), (v) => v.verified, () => HttpError.Auth.of('WebAuthn authentication verification rejected'));
					yield* db.webauthnCredentials.updateCounter(credential.id, verification.authenticationInfo.newCounter).pipe(Effect.ignore);
					yield* CacheService.kv.del(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`).pipe(Effect.ignore);
					yield* Effect.all([MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ method: 'webauthn', tenant: requestContext.tenantId })), audit.log('WebauthnCredential.verify', { details: { credentialId: credential.credentialId }, subjectId: userId })], { discard: true });
					return { credentialId: credential.credentialId, verified: true as const };
				}), 'webauthn.authentication.verify', { metrics: false }),
			},
			credentials: {
				delete: (userId: string, credentialId: string) => Telemetry.span(Effect.gen(function* () {
					const all = yield* _activeCredentials(userId);
					const target = yield* Option.fromNullable(all.find((credential) => credential.id === credentialId)).pipe(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('webauthn_credential', credentialId)), onSome: Effect.succeed }));
					yield* db.webauthnCredentials.softDelete(credentialId).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential delete failed', error)));
					yield* audit.log('WebauthnCredential.delete', { details: { credentialId: target.credentialId, name: target.name }, subjectId: userId });
					return { deleted: true as const };
				}), 'webauthn.credential.delete', { metrics: false }),
				list: (userId: string) => _activeCredentials(userId).pipe(Effect.map((credentials) => credentials.map((credential) => ({ backedUp: credential.backedUp, counter: credential.counter, credentialId: credential.credentialId, deviceType: credential.deviceType, id: credential.id, lastUsedAt: Option.getOrNull(credential.lastUsedAt), name: credential.name, transports: credential.transports }))), Telemetry.span('webauthn.credentials.list', { metrics: false })),
			},
			registration: {
				start: (userId: string, email: string) => Telemetry.span(Effect.gen(function* () {
					const existingCredentials = yield* _activeCredentials(userId);
					yield* Effect.filterOrFail(Effect.succeed(existingCredentials), (c) => c.length < _CONFIG.webauthn.maxCredentialsPerUser, () => HttpError.Conflict.of('webauthn', `Maximum ${_CONFIG.webauthn.maxCredentialsPerUser} passkeys allowed`));
					const options = yield* Effect.tryPromise({ catch: (error) => HttpError.Internal.of('WebAuthn registration options generation failed', error), try: () => generateRegistrationOptions({ attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }, excludeCredentials: existingCredentials.map((credential) => ({ id: credential.credentialId, transports: credential.transports as AuthenticatorTransportFuture[] })), rpID: rpId, rpName, userName: email }) });
					yield* Clock.currentTimeMillis.pipe(Effect.flatMap((now) => CacheService.kv.set(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, { challenge: options.challenge, exp: now + Duration.toMillis(_CONFIG.webauthn.challengeTtl), userId }, _CONFIG.webauthn.challengeTtl)), Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge store failed', error)));
					yield* audit.log('WebauthnCredential.register', { details: { existingCount: existingCredentials.length }, subjectId: userId });
					return options;
				}), 'webauthn.registration.start', { metrics: false }),
				verify: (userId: string, credentialName: string, response: unknown) => Telemetry.span(Effect.gen(function* () {
					const requestContext = yield* Context.Request.current;
					const stored = yield* CacheService.kv.get(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, S.Struct({ challenge: S.String, exp: S.Number, userId: S.String })).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge lookup failed', error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Auth.of('WebAuthn challenge expired or not found')), onSome: Effect.succeed })), Effect.flatMap((stored) => Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => stored.exp >= now, () => HttpError.Auth.of('WebAuthn challenge expired')), Effect.as(stored))));
					const verification = yield* Effect.tryPromise({ catch: (error) => HttpError.Auth.of('WebAuthn registration verification failed', error), try: () => verifyRegistrationResponse({ expectedChallenge: stored.challenge, expectedOrigin, expectedRPID: rpId, response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'] }) });
					const registrationInfo = yield* verification.verified && verification.registrationInfo ? Effect.succeed(verification.registrationInfo) : Effect.fail(HttpError.Auth.of('WebAuthn registration verification rejected'));
					yield* db.webauthnCredentials.insert({ backedUp: registrationInfo.credentialBackedUp, counter: registrationInfo.credential.counter, credentialId: registrationInfo.credential.id, deletedAt: Option.none(), deviceType: registrationInfo.credentialDeviceType, lastUsedAt: Option.none(), name: credentialName, publicKey: registrationInfo.credential.publicKey, transports: registrationInfo.credential.transports ?? [], updatedAt: undefined, userId }).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential store failed', error)));
					yield* CacheService.kv.del(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`).pipe(Effect.ignore);
					yield* Effect.all([MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ method: 'webauthn', tenant: requestContext.tenantId }), 1), audit.log('WebauthnCredential.register', { details: { credentialId: registrationInfo.credential.id, deviceType: registrationInfo.credentialDeviceType, name: credentialName }, subjectId: userId })], { discard: true });
					return { credentialId: registrationInfo.credential.id, verified: true as const };
				}), 'webauthn.registration.verify', { metrics: false }),
			},
		};
		return { mfa, oauth: oauthEndpoints, session, webauthn };
	}),
}) {
}

// --- [ENTRY] -----------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Auth = {
	Service: AuthService
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Auth {
	export type Service = typeof AuthService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Auth };
