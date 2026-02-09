import { Machine } from '@effect/experimental';
import { HttpTraceContext } from '@effect/platform';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Hex64 } from '@parametric-portal/types/types';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticatorTransportFuture } from '@simplewebauthn/server';
import { Apple, decodeIdToken, generateCodeVerifier, generateState, GitHub, Google, MicrosoftEntraId, type OAuth2Tokens } from 'arctic';
import { Array as A, Clock, Config, DateTime, Duration, Effect, Encoding, Match, Option, Order, pipe, PrimaryKey, Redacted, Schema as S } from 'effect';
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

// --- [TYPES] -----------------------------------------------------------------

type _MachineDeps = {
    readonly invalidate: (tenantId: string, hashOrToken: string | Redacted.Redacted<string>) => Effect.Effect<void>;
    readonly maxSessions: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
    oauthRateLimit: { baseMs: 60000, keyPrefix: 'oauth:fail:', maxAttempts: 5, maxMs: 900000, ttl: Duration.minutes(15) },
    salt: { length: 16 },
    sessionCache: Config.all({
        capacity: Config.integer('SESSION_CACHE_CAPACITY').pipe(Config.withDefault(5000)),
        ttl: Config.map(Config.integer('SESSION_CACHE_TTL_SECONDS').pipe(Config.withDefault(300)), Duration.seconds),
    }),
    totp: { algorithm: 'sha256', digits: 6, epochTolerance: [30, 30] as [number,number], periodMs: 30000, periodSec: 30 },
    webauthn: { challengeKeyPrefix: 'webauthn:challenge:', challengeTtl: Duration.minutes(5), maxCredentialsPerUser: 10 },
} as const;
const _SCHEMA = (() => {
    const tokens = S.Struct({ expiresAt: S.DateTimeUtc, refresh: S.Redacted(S.String), session: S.Redacted(S.String) });
    const base = S.Struct({ requestId: S.String, tenantId: S.String });
    const auth = S.extend(base)(S.Struct({ provider: Context.OAuthProvider, sessionId: S.String, tokens, userId: S.String }));
    const req = S.Union(S.Struct({ _tag: S.Literal('Initiate'), provider: Context.OAuthProvider }), S.Struct({ _tag: S.Literal('Callback'), code: S.String, cookie: S.String, state: S.String }), S.Struct({ _tag: S.Literal('Verify'), code: S.String, isBackup: S.Boolean }), S.Struct({ _tag: S.Literal('Refresh'), hash: Hex64.schema }), S.Struct({ _tag: S.Literal('Revoke'), reason: S.Literal('logout', 'timeout', 'security') }));
    const res = S.Union(S.Struct({ _tag: S.Literal('Initiate'), authUrl: S.String, cookie: S.String }), S.Struct({ _tag: S.Literal('Callback'), mfaPending: S.Boolean, tokens, userId: S.String }), S.Struct({ _tag: S.Literal('Verify'), remainingCodes: S.Int, verifiedAt: S.DateTimeUtc }), S.Struct({ _tag: S.Literal('Refresh'), mfaPending: S.Boolean, tokens }), S.Struct({ _tag: S.Literal('Revoke'), revokedAt: S.DateTimeUtc }));
    const sessionCache = S.Struct({ accessExpiresAt: S.DateFromSelf, appId: S.String, id: S.String, userId: S.String, verifiedAt: S.NullOr(S.DateFromSelf) });
    const state = S.Union(S.extend(base)(S.Struct({ _tag: S.Literal('idle') })), S.extend(base)(S.Struct({ _tag: S.Literal('oauth'), provider: Context.OAuthProvider })), S.extend(auth)(S.Struct({ _tag: S.Literal('mfa') })), S.extend(auth)(S.Struct({ _tag: S.Literal('active'), verifiedAt: S.DateTimeUtc })), S.extend(base)(S.Struct({ _tag: S.Literal('revoked'), provider: Context.OAuthProvider, revokedAt: S.DateTimeUtc, userId: S.String })));
    return {
        oauthLockout: S.Struct({ count: S.Number, lastFailure: S.Number, lockedUntil: S.Number }),
        req,
        res,
        sessionCache,
        snapshot: S.Tuple(S.Unknown, state),
        snapshotScope: S.Literal('oauth', 'session'),
        state,
        tokens,
    } as const;
})();
const _RPC = {
    Callback: 	(payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: 'Callback' }>, '_tag'>) => new AuthRpc({ req: { _tag: 'Callback', ...payload } }),
    Initiate: 	(payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: 'Initiate' }>, '_tag'>) => new AuthRpc({ req: { _tag: 'Initiate', ...payload } }),
    Refresh: 	(payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: 'Refresh' }>, '_tag'>) => new AuthRpc({ req: { _tag: 'Refresh', ...payload } }),
    Revoke: 	(payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: 'Revoke' }>, '_tag'>) => new AuthRpc({ req: { _tag: 'Revoke', ...payload } }),
    Verify: 	(payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: 'Verify' }>, '_tag'>) => new AuthRpc({ req: { _tag: 'Verify', ...payload } }),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _machine = (tenantId: string, requestId: string, deps: _MachineDeps) => Machine.makeSerializable({ state: _SCHEMA.state }, (_, previous) => Effect.succeed(Machine.serializable.make<typeof _SCHEMA.state.Type>(previous ?? { _tag: 'idle', requestId, tenantId }, { identifier: `auth:${tenantId}:${requestId}` }).pipe(Machine.serializable.add(AuthRpc, ({ request, state }) =>
    ((state._tag === 'idle' || state._tag === 'oauth' ? _handleOAuth(state, request.req as Extract<typeof _SCHEMA.req.Type, { _tag: 'Initiate' | 'Callback' }>, deps) : _handlePostAuth(state as Extract<typeof _SCHEMA.state.Type, { _tag: 'mfa' | 'active' }>, request.req as Extract<typeof _SCHEMA.req.Type, { _tag: 'Verify' | 'Refresh' | 'Revoke' }>, deps)) as Effect.Effect<readonly [typeof _SCHEMA.res.Type, typeof _SCHEMA.state.Type], unknown, unknown>).pipe(
        Effect.catchAll((error: unknown) => Effect.fail(typeof error === 'object' && error !== null && '_tag' in error && error._tag === 'AuthError' ? error as AuthError : AuthError.from('internal', { op: `${state._tag}:${request.req._tag}` }, error)))
    )
))));
const _createTokens = (db: DatabaseService.Type, tenantId: string, userId: string, mfaPending: boolean) => Effect.gen(function* () {
    const [session, refresh, requestContext] = yield* Effect.all([Crypto.pair, Crypto.pair, Context.Request.current]);
    const [sessionHash, refreshHash] = yield* Effect.all([Crypto.hmac(tenantId, Redacted.value(session.token)), Crypto.hmac(tenantId, Redacted.value(refresh.token))]);
    const now = DateTime.unsafeNow();
    const sessionRow = yield* db.sessions.insert({
        accessExpiresAt: DateTime.toDateUtc(DateTime.addDuration(now, Context.Request.config.durations.session)),
        appId: tenantId,
        deletedAt: Option.none(),
        hash: sessionHash,
        ipAddress: requestContext.ipAddress,
        refreshExpiresAt: DateTime.toDateUtc(DateTime.addDuration(now, Context.Request.config.durations.refresh)),
        refreshHash,
        updatedAt: undefined,
        userAgent: requestContext.userAgent,
        userId,
        verifiedAt: mfaPending ? Option.none() : Option.some(new Date()),
    });
    return { expiresAt: DateTime.addDuration(now, Context.Request.config.durations.session), refresh: refresh.token, session: session.token, sessionId: sessionRow.id };
});
const _handleOAuth = (
    state: Extract<typeof _SCHEMA.state.Type, { _tag: 'idle' | 'oauth' }>,
    request: Extract<typeof _SCHEMA.req.Type, { _tag: 'Initiate' | 'Callback' }>,
    deps: _MachineDeps,) => {
    const pkce = S.parseJson(S.Struct({ exp: S.Number, provider: Context.OAuthProvider, state: S.String, verifier: S.optional(S.String) }));
    return Match.value(request).pipe(
        Match.tag('Initiate', (req) => Effect.gen(function* () {
            const [metrics, oauth] = yield* Effect.all([MetricsService, OAuthClientService]);
            const oauthState = generateState();
            const verifier = Context.Request.config.oauth.capabilities[req.provider].pkce ? generateCodeVerifier() : undefined;
            const cookie = yield* Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => S.encode(pkce)({ exp: now + Duration.toMillis(Context.Request.config.durations.pkce), provider: req.provider, state: oauthState, verifier })),
                Effect.flatMap(Crypto.encrypt),
                Effect.map(Encoding.encodeBase64Url),
                Effect.mapError(() => AuthError.from('config_failed', { op: 'encrypt_state' }))
            );
            yield* MetricsService.inc(metrics.oauth.authorizations, MetricsService.label({ provider: req.provider }));
            return [
                { _tag: 'Initiate', authUrl: oauth.authUrl(req.provider, oauthState, verifier).toString(), cookie } as const,
                { _tag: 'oauth', provider: req.provider, requestId: state.requestId, tenantId: state.tenantId } as const,
            ] as const;
        })),
        Match.tag('Callback', (req) => Effect.gen(function* () {
            const [db, metrics, audit, oauth] = yield* Effect.all([DatabaseService, MetricsService, AuditService, OAuthClientService]);
            const provider = (state as Extract<typeof _SCHEMA.state.Type, { _tag: 'oauth' }>).provider;
            const verifier = yield* Effect.andThen(Encoding.decodeBase64Url(req.cookie), Crypto.decrypt).pipe(
                Effect.flatMap(S.decodeUnknown(pkce)),
                Effect.flatMap((decoded) => Clock.currentTimeMillis.pipe(
                    Effect.filterOrFail((now) => decoded.provider === provider && decoded.state === req.state && decoded.exp > now, () => AuthError.from('oauth_state_mismatch', { provider })),
                    Effect.as(decoded.verifier)
                )),
                Effect.mapError((error) => error instanceof AuthError ? error : AuthError.from('oauth_encoding', { provider }, error))
            );
            const rlKey = `${_CONFIG.oauthRateLimit.keyPrefix}${provider}:${req.state}`;
            yield* CacheService.kv.get(rlKey, _SCHEMA.oauthLockout).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: (s) => Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => s.lockedUntil <= now, (now) => AuthError.from('oauth_rate_limited', { identifier: `${provider}:${req.state}`, lockedUntilMs: s.lockedUntil - now, provider }))) })));
            const recordFailure = Clock.currentTimeMillis.pipe(Effect.flatMap((now) => CacheService.kv.get(rlKey, _SCHEMA.oauthLockout).pipe(Effect.map(Option.getOrElse(() => ({ count: 0, lastFailure: now, lockedUntil: 0 }))), Effect.flatMap((prev) => { const excess = prev.count + 1 - _CONFIG.oauthRateLimit.maxAttempts; return CacheService.kv.set(rlKey, { count: prev.count + 1, lastFailure: now, lockedUntil: excess >= 0 ? now + Math.min(_CONFIG.oauthRateLimit.baseMs * (2 ** excess), _CONFIG.oauthRateLimit.maxMs) : 0 }, _CONFIG.oauthRateLimit.ttl); }))), Effect.ignore);
            const oauthTokens = yield* Effect.tryPromise({ catch: (error) => AuthError.from('oauth_exchange_failed', { provider }, error), try: () => oauth.exchange(provider, req.code, verifier) }).pipe(Effect.tapError(() => recordFailure));
            const userInfo = yield* oauth.extractUser(provider, oauthTokens).pipe(Effect.tapError(() => recordFailure));
            yield* CacheService.kv.del(rlKey).pipe(Effect.ignore);
            const { isNew, userId } = yield* db.oauthAccounts.byExternal(provider, userInfo.externalId).pipe(Effect.flatMap(Option.match({
                onNone: () => Option.match(userInfo.email, { onNone: () => Effect.fail(AuthError.from('user_no_email', { provider })), onSome: (emailValue) => db.users.insert({ appId: state.tenantId, deletedAt: Option.none(), email: emailValue, role: 'member', status: 'active', updatedAt: undefined }).pipe(Effect.map((user) => ({ isNew: true, userId: user.id })), Effect.mapError((error) => AuthError.from('internal', { op: 'resolve_user', provider }, error))) }),
                onSome: (existing) => db.users.one([{ field: 'id', value: existing.userId }]).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('user_not_found', { userId: existing.userId })), onSome: () => Effect.succeed({ isNew: false, userId: existing.userId }) })), Effect.mapError((error) => error instanceof AuthError ? error : AuthError.from('internal', { op: 'user_lookup', userId: existing.userId }, error))),
            })));
            yield* db.sessions.byUser(userId).pipe(
                Effect.map((sessions) => pipe(sessions.filter((s) => Option.isNone(s.deletedAt)), A.sortBy(Order.mapInput(Order.string, (s: typeof sessions[number]) => s.id)))),
                Effect.flatMap((active) => active.length < deps.maxSessions ? Effect.void : Effect.forEach(active.slice(0, active.length - deps.maxSessions + 1), (s) => db.sessions.softDelete(s.id).pipe(Effect.tap(() => deps.invalidate(s.appId, s.hash))), { discard: true })),
                Effect.catchAll((error) => Effect.logWarning('Session limit enforcement failed', { error: String(error), userId })));
            const accessEncrypted = yield* Crypto.encrypt(oauthTokens.accessToken());
            const refreshToken = oauthTokens.refreshToken();
            const refreshEncrypted = refreshToken == null ? Option.none<Uint8Array>() : yield* Crypto.encrypt(refreshToken).pipe(Effect.map(Option.some));
            yield* db.oauthAccounts.upsert({ accessEncrypted, deletedAt: Option.none(), expiresAt: Option.fromNullable(oauthTokens.accessTokenExpiresAt()), externalId: userInfo.externalId, provider, refreshEncrypted, scope: Option.none(), updatedAt: undefined, userId });
            const mfaEnabled = yield* db.mfaSecrets.byUser(userId).pipe(Effect.map((opt) => opt.pipe(Option.flatMap((s) => s.enabledAt), Option.isSome)));
            const { sessionId, ...nextTokens } = yield* _createTokens(db, state.tenantId, userId, mfaEnabled);
            yield* Effect.all([MetricsService.inc(metrics.auth.logins, MetricsService.label({ isNewUser: String(isNew), provider })), audit.log('Auth.login', { details: { isNew, mfaEnabled, provider }, subjectId: userId })], { discard: true });
            const base = { provider, requestId: state.requestId, sessionId, tenantId: state.tenantId, tokens: nextTokens, userId };
            return [
                { _tag: 'Callback', mfaPending: mfaEnabled, tokens: nextTokens, userId } as const,
                mfaEnabled ? { _tag: 'mfa', ...base } as const : { _tag: 'active', ...base, verifiedAt: DateTime.unsafeNow() } as const,
            ] as const;
        })),
        Match.exhaustive,
    );
};
const _handlePostAuth = (
    state: Extract<typeof _SCHEMA.state.Type, { _tag: 'mfa' | 'active' }>,
    request: Extract<typeof _SCHEMA.req.Type, { _tag: 'Verify' | 'Refresh' | 'Revoke' }>,
    deps: _MachineDeps,) => Effect.gen(function* () {
    const [db, metrics, audit] = yield* Effect.all([DatabaseService, MetricsService, AuditService]);
    const [res, next, observe] = yield* Match.value(request).pipe(
        Match.tag('Verify', (req) => Effect.gen(function* () {
            const replayGuard = yield* ReplayGuardService;
            yield* replayGuard.checkLockout(state.userId);
            const mfaSecret = yield* db.mfaSecrets.byUser(state.userId).pipe(Effect.mapError((error) => AuthError.from('internal', { op: 'mfa_lookup', userId: state.userId }, error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('mfa_not_enrolled', { userId: state.userId })), onSome: Effect.succeed })));
            const now = yield* Clock.currentTimeMillis;
            const remainingCodes = yield* req.isBackup
                ? Effect.all(mfaSecret.backupHashes.map((entry, index) => {
                    const sep = entry.indexOf('$');
                    return sep <= 0 || sep >= entry.length - 1 ? Effect.succeed(Option.none<number>()) : Crypto.hash(`${entry.slice(0, sep)}${req.code.toUpperCase()}`).pipe(Effect.flatMap((computed) => Crypto.compare(computed, entry.slice(sep + 1))), Effect.map((isMatch) => isMatch ? Option.some(index) : Option.none()));
                }), { concurrency: 1 }).pipe(Effect.map(Option.firstSomeOf), Effect.flatMap(Option.match({
                    onNone: () => replayGuard.recordFailure(state.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_backup', { remaining: mfaSecret.backupHashes.length })))),
                    onSome: (index) => db.mfaSecrets.upsert({ backupHashes: mfaSecret.backupHashes.filter((_, idx) => idx !== index), enabledAt: mfaSecret.enabledAt, encrypted: mfaSecret.encrypted, userId: state.userId }).pipe(Effect.tap(() => replayGuard.recordSuccess(state.userId)), Effect.as(mfaSecret.backupHashes.length - 1), Effect.mapError((error) => AuthError.from('mfa_invalid_backup', { userId: state.userId }, error))),
                })))
                : Crypto.decrypt(mfaSecret.encrypted).pipe(Effect.mapError((error) => AuthError.from('mfa_invalid_code', { userId: state.userId }, error)), Effect.flatMap((secret) => Effect.try({ catch: () => AuthError.from('mfa_invalid_code', { userId: state.userId }), try: () => verifySync({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, epochTolerance: _CONFIG.totp.epochTolerance, period: _CONFIG.totp.periodSec, secret, token: req.code }) })), Effect.filterOrElse((result) => result.valid, () => replayGuard.recordFailure(state.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_code', { userId: state.userId }))))), Effect.flatMap((result) => replayGuard.checkAndMark(state.userId, Math.floor(now / _CONFIG.totp.periodMs) + ((result as { delta?: number }).delta ?? 0), req.code)), Effect.filterOrElse(({ alreadyUsed }) => !alreadyUsed, () => replayGuard.recordFailure(state.userId).pipe(Effect.andThen(Effect.fail(AuthError.from('mfa_invalid_code', { userId: state.userId }))))), Effect.tap(() => replayGuard.recordSuccess(state.userId)), Effect.tap(() => Option.isNone(mfaSecret.enabledAt) ? db.mfaSecrets.upsert({ backupHashes: mfaSecret.backupHashes, enabledAt: Option.some(new Date()), encrypted: mfaSecret.encrypted, userId: state.userId }) : Effect.void), Effect.as(mfaSecret.backupHashes.length));
            const verifiedAt = DateTime.unsafeNow();
            yield* db.sessions.verify(state.sessionId).pipe(Effect.ignore);
            return [
                { _tag: 'Verify' as const, remainingCodes, verifiedAt },
                { ...state, _tag: 'active' as const, verifiedAt },
                Effect.all([MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ tenant: state.tenantId })), audit.log('Auth.verifyMfa', { subjectId: state.userId })], { discard: true }),
            ] as const;
        })),
        Match.tag('Refresh', (req) => db.withTransaction(Effect.gen(function* () {
            const sessionRow = yield* db.sessions.byRefreshHashForUpdate(req.hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('token_invalid')), onSome: Effect.succeed })));
            yield* Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => now <= sessionRow.refreshExpiresAt.getTime(), () => AuthError.from('token_expired')));
            yield* db.sessions.softDelete(sessionRow.id);
            const mfaPending = state._tag === 'mfa' && (yield* db.mfaSecrets.byUser(sessionRow.userId).pipe(Effect.map((opt) => opt.pipe(Option.flatMap((s) => s.enabledAt), Option.isSome))));
            const { sessionId, ...nextTokens } = yield* _createTokens(db, state.tenantId, sessionRow.userId, mfaPending);
            return [
                { _tag: 'Refresh' as const, mfaPending, tokens: nextTokens },
                { ...state, sessionId, tokens: nextTokens },
                MetricsService.inc(metrics.auth.refreshes, MetricsService.label({ tenant: state.tenantId })),
            ] as const;
        }))),
        Match.tag('Revoke', (req) => db.sessions.softDelete(state.sessionId).pipe(Effect.map(() => {
            const revokedAt = DateTime.unsafeNow();
            return [
                { _tag: 'Revoke' as const, revokedAt },
                { _tag: 'revoked' as const, provider: state.provider, requestId: state.requestId, revokedAt, tenantId: state.tenantId, userId: state.userId },
                Effect.all([MetricsService.inc(metrics.auth.logouts, MetricsService.label({ reason: req.reason, tenant: state.tenantId })), audit.log('Auth.revoke', { details: { reason: req.reason }, subjectId: state.userId })], { discard: true }),
            ] as const;
        }))),
        Match.exhaustive,
    );
    yield* deps.invalidate(state.tenantId, state.tokens.session);
    yield* observe;
    return [res, next] as const;
});

// --- [ERRORS] ----------------------------------------------------------------

class AuthError extends S.TaggedError<AuthError>()('AuthError', {
    cause: S.optional(S.Unknown),
    context: S.optional(S.Record({ key: S.String, value: S.Unknown })),
    reason: S.Literal('phase_invalid', 'config_failed', 'oauth_encoding', 'oauth_state_mismatch', 'oauth_exchange_failed', 'oauth_user_fetch', 'oauth_rate_limited', 'mfa_not_enrolled', 'mfa_invalid_code', 'mfa_invalid_backup', 'token_invalid', 'token_expired', 'user_not_found', 'user_no_email', 'snapshot_missing', 'internal'),
}) {
    static readonly from = (reason: AuthError['reason'], context?: Record<string, unknown>, cause?: unknown) => new AuthError({ cause, context, reason });
    static readonly phase = (actual: string, allowed: ReadonlyArray<string>) => new AuthError({ context: { actual, allowed }, reason: 'phase_invalid' });
}

// --- [CLASSES] ---------------------------------------------------------------

class AuthRpc extends S.TaggedRequest<AuthRpc>()('AuthRpc', {
	failure: AuthError,
	payload: { req: _SCHEMA.req },
	success: _SCHEMA.res
}) {}
class CacheKey extends S.TaggedRequest<CacheKey>()('CacheKey', {
    failure: AuthError,
    payload: { id: S.String, scope: S.String, snapshot: S.optional(_SCHEMA.snapshot), tenantId: S.String },
    success: S.Unknown,
}) {[PrimaryKey.symbol]() { return `auth:${this.scope}:${this.tenantId}:${this.id}`; }}

// --- [SERVICES] --------------------------------------------------------------

class OAuthClientService extends Effect.Service<OAuthClientService>()('server/OAuthClients', {
    effect: Effect.gen(function* () {
        const _caps = (provider: Context.OAuthProvider) => Context.Request.config.oauth.capabilities[provider];
        const _scopes = (provider: Context.OAuthProvider) => _caps(provider).oidc ? Context.Request.config.oauth.scopes.oidc : Context.Request.config.oauth.scopes.github;
        const _creds = (key: string) => Config.all({ id: Config.string(`OAUTH_${key}_CLIENT_ID`).pipe(Config.withDefault('')), secret: Config.redacted(`OAUTH_${key}_CLIENT_SECRET`).pipe(Config.withDefault(Redacted.make(''))) });
        const configuration = yield* Config.all({
            apple: Config.all({ clientId: Config.string('OAUTH_APPLE_CLIENT_ID').pipe(Config.withDefault('')), keyId: Config.string('OAUTH_APPLE_KEY_ID').pipe(Config.withDefault('')), privateKey: Config.redacted('OAUTH_APPLE_PRIVATE_KEY').pipe(Config.withDefault(Redacted.make(''))), teamId: Config.string('OAUTH_APPLE_TEAM_ID').pipe(Config.withDefault('')) }),
            baseUrl: Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000')),
            creds: Config.all({ github: _creds('GITHUB'), google: _creds('GOOGLE'), microsoft: _creds('MICROSOFT') }),
            tenant: Config.string('OAUTH_MICROSOFT_TENANT_ID').pipe(Config.withDefault('common')),
        });
        const _redirect = (provider: Context.OAuthProvider) => `${configuration.baseUrl}/api/auth/oauth/${provider}/callback`;
        const clients = {
            apple: new Apple(configuration.apple.clientId, configuration.apple.teamId, configuration.apple.keyId, new TextEncoder().encode(Redacted.value(configuration.apple.privateKey)), _redirect('apple')),
            github: new GitHub(configuration.creds.github.id, Redacted.value(configuration.creds.github.secret), _redirect('github')),
            google: new Google(configuration.creds.google.id, Redacted.value(configuration.creds.google.secret), _redirect('google')),
            microsoft: new MicrosoftEntraId(configuration.tenant, configuration.creds.microsoft.id, Redacted.value(configuration.creds.microsoft.secret), _redirect('microsoft')),
        };
        const _extractGithubUser = (tokens: OAuth2Tokens, provider: Context.OAuthProvider) => Effect.all([Context.Request.current, Effect.optionFromOptional(Effect.currentSpan)], { concurrency: 'unbounded' }).pipe(Effect.flatMap(([ctx, span]) => Effect.tryPromise({
            catch: (error) => AuthError.from('oauth_user_fetch', { provider }, error),
            try: async () => {
				const response = await fetch(Context.Request.config.endpoints.githubApi, { headers: { ...Option.match(span, { onNone: () => ({}), onSome: HttpTraceContext.toHeaders }), Authorization: `Bearer ${tokens.accessToken()}`, 'User-Agent': 'ParametricPortal/1.0', [Context.Request.Headers.requestId]: ctx.requestId } });
                return (response.ok ? response.json() : Promise.reject(new Error(`github_user_fetch_${response.status}`))) as Promise<{ id: number; email?: string | null }>;
            },
        })), Effect.map((decoded) => ({ email: Option.fromNullable(decoded.email), externalId: String(decoded.id) })));
        return {
            authUrl: (provider: Context.OAuthProvider, state: string, verifier?: string) => _caps(provider).pkce
                ? (clients[provider] as Google | MicrosoftEntraId).createAuthorizationURL(state, verifier as string, [..._scopes(provider)])
                : (clients[provider] as GitHub | Apple).createAuthorizationURL(state, [..._scopes(provider)]),
            exchange: (provider: Context.OAuthProvider, code: string, verifier?: string): Promise<OAuth2Tokens> => _caps(provider).pkce
                ? (clients[provider] as Google | MicrosoftEntraId).validateAuthorizationCode(code, verifier as string)
                : (clients[provider] as GitHub | Apple).validateAuthorizationCode(code),
            extractUser: (provider: Context.OAuthProvider, tokens: OAuth2Tokens): Effect.Effect<{ externalId: string; email: Option.Option<string> }, AuthError> => _caps(provider).oidc
                ? Effect.try({ catch: (error) => AuthError.from('oauth_user_fetch', { provider }, error), try: () => decodeIdToken(tokens.idToken()) as { sub: string; email?: string } }).pipe(Effect.map((decoded) => ({ email: Option.fromNullable(decoded.email), externalId: decoded.sub })))
                : _extractGithubUser(tokens, provider),
        };
    }),
}) {
}
class AuthService extends Effect.Service<AuthService>()('server/Auth', {
    effect: Effect.gen(function* () {
        const [db, metrics, audit, issuer, maxSessions, sessionCacheConfig] = yield* Effect.all([
            DatabaseService,
            MetricsService,
            AuditService,
            Config.string('APP_NAME').pipe(Config.withDefault('Parametric Portal')),
            Config.integer('MAX_SESSIONS_PER_USER').pipe(Config.withDefault(5)),
            _CONFIG.sessionCache,
        ]);
        const cache = yield* CacheService.cache<CacheKey, unknown, never>({
            inMemoryCapacity: sessionCacheConfig.capacity,
            lookup: (key) => Match.value(key.scope).pipe(
                Match.when('mfa', () => db.mfaSecrets.byUser(key.id).pipe(Effect.map((opt) => opt.pipe(Option.flatMap((s) => s.enabledAt), Option.isSome)), Effect.mapError((error) => AuthError.from('internal', { op: 'mfa_status', tenantId: key.tenantId, userId: key.id }, error)))),
                Match.when('session', () => db.sessions.byHash(key.id as Hex64).pipe(Effect.tap(Option.match({ onNone: () => Effect.void, onSome: (s) => db.sessions.touch(s.id).pipe(Effect.catchAll((error) => Effect.logWarning('Session activity update failed', { error: String(error), sessionId: s.id }))) })), Effect.map(Option.map((s) => ({ accessExpiresAt: s.accessExpiresAt, appId: s.appId, id: s.id, userId: s.userId, verifiedAt: Option.getOrNull(s.verifiedAt) }))), Effect.mapError((error) => AuthError.from('internal', { op: 'session_cache' }, error)))),
                Match.orElse(() => Option.fromNullable(key.snapshot).pipe(Option.match({ onNone: () => Effect.fail(AuthError.from('snapshot_missing', { key: key.id, scope: key.scope })), onSome: Effect.succeed }))),
            ),
            storeId: 'auth',
            timeToLive: sessionCacheConfig.ttl,
        });
        const _snapshot = (scope: typeof _SCHEMA.snapshotScope.Type, tenantId: string, id: string, snapshot?: typeof _SCHEMA.snapshot.Type) => ({
            drop: () => cache.invalidate(new CacheKey({ id, scope: `snap:${scope}`, tenantId })),
            load: () => cache.get(new CacheKey({ id, scope: `snap:${scope}`, tenantId })) as Effect.Effect<typeof _SCHEMA.snapshot.Type>,
            save: () => cache.invalidate(new CacheKey({ id, scope: `snap:${scope}`, tenantId })).pipe(Effect.andThen(cache.get(new CacheKey({ id, scope: `snap:${scope}`, snapshot, tenantId })))),
        });
        const _expectResponse = <T extends typeof _SCHEMA.res.Type['_tag']>(tag: T, response: typeof _SCHEMA.res.Type): Effect.Effect<Extract<typeof _SCHEMA.res.Type, { _tag: T }>, AuthError> => response._tag === tag ? Effect.succeed(response as Extract<typeof _SCHEMA.res.Type, { _tag: T }>) : Effect.fail(AuthError.from('internal', { expected: tag, got: response._tag, op: 'response_tag' }));
        const invalidateSession = (tenantId: string, hashOrToken: string | Redacted.Redacted<string>) => (typeof hashOrToken === 'string' ? Effect.succeed(hashOrToken) : Crypto.hmac(tenantId, Redacted.value(hashOrToken))).pipe(Effect.flatMap((hash) => cache.invalidate(new CacheKey({ id: hash, scope: 'session', tenantId }))), Effect.catchAll((error) => Effect.logWarning('Session cache invalidation failed', { error: String(error), tenantId })), Effect.asVoid);
        const _machineDeps = { invalidate: invalidateSession, maxSessions } as const;
        const snapshotOf = (actor: Machine.Actor<ReturnType<typeof _machine>>) => Machine.snapshot(actor as Machine.SerializableActor<ReturnType<typeof _machine>>).pipe(Effect.flatMap(S.decodeUnknown(_SCHEMA.snapshot)), Effect.mapError((error) => AuthError.from('internal', { op: 'snapshot' }, error)));
        const _sendFromSnapshot = <T extends typeof _SCHEMA.res.Type['_tag']>(scope: typeof _SCHEMA.snapshotScope.Type, id: string, request: AuthRpc, tag: T) => Context.Request.currentTenantId.pipe(Effect.flatMap((tenantId) => _snapshot(scope, tenantId, id).load().pipe(Effect.flatMap((snapshot) => Machine.restore(_machine(snapshot[1].tenantId, snapshot[1].requestId, _machineDeps), snapshot)), Effect.flatMap((actor) => actor.send(request).pipe(Effect.flatMap((response) => snapshotOf(actor).pipe(Effect.map((nextSnapshot) => ({ nextSnapshot, response, tenantId })))))))), Effect.mapError((error) => error instanceof AuthError ? error : AuthError.from('internal', { op: 'run_snapshot' }, error)), Effect.flatMap(({ response, nextSnapshot, tenantId }) => _expectResponse(tag, response).pipe(Effect.map((typedResponse) => ({ nextSnapshot, response: typedResponse, tenantId })))));
        const _activeCredentials = (userId: string) => db.webauthnCredentials.byUser(userId).pipe(Effect.map((credentials) => credentials.filter((credential) => Option.isNone(credential.deletedAt))), Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential lookup failed', error)));
        const [rpId, rpName, expectedOrigin] = yield* Effect.all([
            Config.string('WEBAUTHN_RP_ID').pipe(Config.withDefault('localhost')),
            Config.string('WEBAUTHN_RP_NAME').pipe(Config.withDefault('Parametric Portal')),
            Config.string('WEBAUTHN_ORIGIN').pipe(Config.withDefault('http://localhost:3000')),
        ]);
        const _challenge = {
            clear: (userId: string) => CacheService.kv.del(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`).pipe(Effect.ignore),
            save: (userId: string, challenge: string) => Clock.currentTimeMillis.pipe(Effect.flatMap((now) => CacheService.kv.set(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, { challenge, exp: now + Duration.toMillis(_CONFIG.webauthn.challengeTtl), userId }, _CONFIG.webauthn.challengeTtl)), Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge store failed', error))),
            valid: (userId: string) => CacheService.kv.get(`${_CONFIG.webauthn.challengeKeyPrefix}${userId}`, S.Struct({ challenge: S.String, exp: S.Number, userId: S.String })).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn challenge lookup failed', error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Auth.of('WebAuthn challenge expired or not found')), onSome: Effect.succeed })), Effect.flatMap((stored) => Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => stored.exp >= now, () => HttpError.Auth.of('WebAuthn challenge expired')), Effect.as(stored)))),
        };
        const oauth = {
            callback: (provider: Context.OAuthProvider, code: string, state: string, cookie: string) => _sendFromSnapshot('oauth', cookie, Auth.Callback({ code, cookie, state }), 'Callback').pipe(Effect.flatMap(({ response, nextSnapshot, tenantId }) => Effect.suspend(() => 'sessionId' in nextSnapshot[1] ? Effect.succeed(nextSnapshot[1].sessionId) : Effect.fail(AuthError.phase(nextSnapshot[1]._tag, ['mfa', 'active']))).pipe(Effect.tap((sessionId) => Effect.all([_snapshot('oauth', tenantId, cookie).drop(), _snapshot('session', tenantId, sessionId, nextSnapshot).save()], { discard: true })), Effect.map((sessionId) => ({ accessToken: Redacted.value(response.tokens.session), expiresAt: response.tokens.expiresAt, mfaPending: response.mfaPending, refreshToken: Redacted.value(response.tokens.refresh), sessionId, userId: response.userId })))), Effect.mapError((error) => error instanceof AuthError ? HttpError.OAuth.of(provider, error.reason, error) : HttpError.Internal.of('OAuth callback failed', error)), Telemetry.span('auth.oauth.callback', { 'oauth.provider': provider })),
            start: (provider: Context.OAuthProvider) => Context.Request.current.pipe(Effect.flatMap(({ requestId, tenantId }) => Machine.boot(_machine(tenantId, requestId, _machineDeps)).pipe(Effect.flatMap((actor) => actor.send(Auth.Initiate({ provider })).pipe(Effect.flatMap((response) => _expectResponse('Initiate', response)), Effect.tap((response) => snapshotOf(actor).pipe(Effect.flatMap((snapshot) => _snapshot('oauth', tenantId, response.cookie, snapshot).save()))))))), Effect.mapError((error) => HttpError.OAuth.of(provider, error instanceof AuthError ? error.reason : 'internal', error)), Telemetry.span('auth.oauth.start', { 'oauth.provider': provider })),
        };
        const session = {
            lookup: (hash: Hex64) => Context.Request.current.pipe(Effect.flatMap((context) => (cache.get(new CacheKey({ id: hash, scope: 'session', tenantId: context.tenantId })) as Effect.Effect<Option.Option<typeof _SCHEMA.sessionCache.Type>>).pipe(Effect.flatMap(Option.match({
                onNone: () => Effect.succeed(Option.none<Context.Request.Session>()),
                onSome: (sessionRow) => sessionRow.appId === context.tenantId
                    ? Clock.currentTimeMillis.pipe(Effect.flatMap((now) => now > sessionRow.accessExpiresAt.getTime()
                        ? Effect.logWarning('Session expired', { accessExpiresAt: sessionRow.accessExpiresAt, sessionId: sessionRow.id }).pipe(Effect.as(Option.none()))
                        : (cache.get(new CacheKey({ id: sessionRow.userId, scope: 'mfa', tenantId: context.tenantId })) as Effect.Effect<boolean>).pipe(Effect.map((mfaEnabled) => Option.some({ appId: sessionRow.appId, id: sessionRow.id, kind: 'session' as const, mfaEnabled, userId: sessionRow.userId, verifiedAt: Option.fromNullable(sessionRow.verifiedAt) })))))
                    : Effect.logWarning('Session tenant mismatch', { expected: context.tenantId, got: sessionRow.appId }).pipe(Effect.as(Option.none())),
            })))), Effect.catchAll((error) => Effect.logError('Session lookup failed', { error: String(error) }).pipe(Effect.as(Option.none()))), Telemetry.span('auth.session.lookup', { metrics: false })),
            refresh: (hash: Hex64) => Effect.all([
                Context.Request.currentTenantId,
                db.sessions.byRefreshHash(hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(AuthError.from('token_invalid')), onSome: Effect.succeed }))),
            ]).pipe(Effect.flatMap(([tenantId, found]) => Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => now <= found.refreshExpiresAt.getTime(), () => AuthError.from('token_expired')), Effect.as(found), Effect.flatMap((valid) => _sendFromSnapshot('session', valid.id, Auth.Refresh({ hash }), 'Refresh').pipe(Effect.flatMap(({ response, nextSnapshot }) => Effect.suspend(() => 'sessionId' in nextSnapshot[1] ? Effect.succeed(nextSnapshot[1].sessionId) : Effect.fail(AuthError.phase(nextSnapshot[1]._tag, ['mfa', 'active']))).pipe(Effect.tap((nextSessionId) => Effect.all([_snapshot('session', tenantId, valid.id).drop(), _snapshot('session', tenantId, nextSessionId, nextSnapshot).save()], { discard: true })), Effect.map(() => ({ accessToken: Redacted.value(response.tokens.session), expiresAt: response.tokens.expiresAt, mfaPending: response.mfaPending, refreshToken: Redacted.value(response.tokens.refresh), userId: valid.userId })))))))), Effect.mapError((error) => error instanceof AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of('Token refresh failed', error)), Telemetry.span('auth.refresh')),
            revoke: (sessionId: string, reason: Extract<typeof _SCHEMA.req.Type, { _tag: 'Revoke' }>['reason']) => _sendFromSnapshot('session', sessionId, Auth.Revoke({ reason }), 'Revoke').pipe(Effect.tap(({ tenantId }) => _snapshot('session', tenantId, sessionId).drop()), Effect.map(({ response }) => response), Effect.catchAll((error) => error instanceof AuthError && error.reason === 'snapshot_missing'
                ? Effect.gen(function* () {
                    const sessionOption = yield* db.sessions.one([{ field: 'id', value: sessionId }]).pipe(Effect.orElseSucceed(() => Option.none()));
                    yield* db.sessions.softDelete(sessionId).pipe(Effect.ignore);
                    yield* Option.match(sessionOption, { onNone: () => Effect.void, onSome: (existing) => invalidateSession(existing.appId, existing.hash) });
                    return { _tag: 'Revoke', revokedAt: DateTime.unsafeNow() } as const;
                })
                : Effect.fail(HttpError.Internal.of('Session revocation failed', error))), Telemetry.span('auth.revoke', { 'auth.reason': reason })),
        };
        function _verifyMfaMode(sessionId: string, code: string, mode: 'backup' | 'totp') {
            return _sendFromSnapshot('session', sessionId, Auth.Verify({ code, isBackup: mode === 'backup' }), 'Verify').pipe(Effect.flatMap(({ response, nextSnapshot, tenantId }) => _snapshot('session', tenantId, sessionId, nextSnapshot).save().pipe(Effect.as(response))), Effect.map((verifyResponse) => mode === 'backup' ? { remainingCodes: verifyResponse.remainingCodes, success: true as const } : { success: true as const }), Effect.mapError((error) => error instanceof AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of(`MFA ${mode} failed`, error)), Telemetry.span(mode === 'backup' ? 'auth.mfa.recover' : 'auth.mfa.verify', { 'mfa.method': mode === 'backup' ? 'backup' : 'totp' }));
        }
        const mfa = {
            disable: (userId: string) => Telemetry.span(Effect.gen(function* () {
                const requestContext = yield* Context.Request.current;
                const option = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)));
                yield* Option.isNone(option) ? Effect.fail(HttpError.NotFound.of('mfa')) : Effect.void;
                yield* db.mfaSecrets.softDelete(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA soft delete failed', error)));
                yield* cache.invalidate(new CacheKey({ id: userId, scope: 'mfa', tenantId: requestContext.tenantId })).pipe(Effect.ignore);
                yield* Effect.all([MetricsService.inc(metrics.mfa.disabled, MetricsService.label({ tenant: requestContext.tenantId }), 1), audit.log('MfaSecret.disable', { subjectId: userId })], { discard: true });
                return { success: true as const };
            }), 'mfa.disable'),
            enroll: (userId: string, email: string) => Telemetry.span(Effect.gen(function* () {
                const requestContext = yield* Context.Request.current;
                const existing = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA enrollment check failed', error)));
                yield* Option.isSome(existing) && Option.isSome(existing.value.enabledAt) ? Effect.fail(HttpError.Conflict.of('mfa', 'MFA already enabled')) : Effect.void;
                const secret = yield* Effect.sync(generateSecret);
                const encrypted = yield* Crypto.encrypt(secret).pipe(Effect.mapError((error) => HttpError.Internal.of('TOTP secret encryption failed', error)));
                const _makeBackup = customAlphabet(_CONFIG.backup.alphabet, _CONFIG.backup.length);
                const backupCodes = Array.from({ length: _CONFIG.backup.count }, () => _makeBackup());
                const salt = Encoding.encodeHex(randomBytes(_CONFIG.salt.length));
                const backupHashes = yield* Effect.all(backupCodes.map((backupCode) => Crypto.hash(`${salt}${backupCode.toUpperCase()}`).pipe(Effect.map((hash) => `${salt}$${hash}`))), { concurrency: 'unbounded' });
                yield* Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes, encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('MFA upsert failed', error))));
                yield* cache.invalidate(new CacheKey({ id: userId, scope: 'mfa', tenantId: requestContext.tenantId })).pipe(Effect.ignore);
                yield* Effect.all([MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ tenant: requestContext.tenantId }), 1), audit.log('MfaSecret.enroll', { details: { backupCodesGenerated: _CONFIG.backup.count }, subjectId: userId })], { discard: true });
                return { backupCodes, qrDataUrl: generateURI({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, issuer, label: email, period: _CONFIG.totp.periodSec, secret }), secret };
            }), 'mfa.enroll'),
            status: (userId: string) => db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)), Effect.map(Option.match({ onNone: () => ({ enabled: false, enrolled: false }) as const, onSome: (mfaSecret) => ({ enabled: Option.isSome(mfaSecret.enabledAt), enrolled: true, remainingBackupCodes: mfaSecret.backupHashes.length }) as const }))),
            verify: _verifyMfaMode,
        };
        const webauthn = {
            authentication: {
                start: (userId: string) => Telemetry.span(Effect.gen(function* () {
                    const credentials = yield* _activeCredentials(userId);
                    yield* credentials.length === 0 ? Effect.fail(HttpError.NotFound.of('webauthn_credentials', undefined, 'No passkeys registered')) : Effect.void;
                    const options = yield* Effect.tryPromise({ catch: (error) => HttpError.Internal.of('WebAuthn authentication options generation failed', error), try: () => generateAuthenticationOptions({ allowCredentials: credentials.map((credential) => ({ id: credential.credentialId, transports: credential.transports as AuthenticatorTransportFuture[] })), rpID: rpId }) });
                    yield* _challenge.save(userId, options.challenge);
                    return options;
                }), 'webauthn.authentication.start'),
                verify: (userId: string, response: unknown) => Telemetry.span(Effect.gen(function* () {
                    const requestContext = yield* Context.Request.current;
                    const stored = yield* _challenge.valid(userId);
                    const credentialId = (response as { id?: string })?.id ?? '';
                    const credential = yield* db.webauthnCredentials.byCredentialId(credentialId).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential lookup failed', error)), Effect.flatMap(Option.match({ onNone: () => Effect.fail(HttpError.Auth.of('WebAuthn credential not found')), onSome: Effect.succeed })));
                    const verification = yield* Effect.tryPromise({ catch: (error) => HttpError.Auth.of('WebAuthn authentication verification failed', error), try: () => verifyAuthenticationResponse({ credential: { counter: credential.counter, id: credential.credentialId, publicKey: credential.publicKey as Uint8Array<ArrayBuffer>, transports: credential.transports as AuthenticatorTransportFuture[] }, expectedChallenge: stored.challenge, expectedOrigin, expectedRPID: rpId, response: response as Parameters<typeof verifyAuthenticationResponse>[0]['response'] }) });
                    yield* verification.verified ? Effect.void : Effect.fail(HttpError.Auth.of('WebAuthn authentication verification rejected'));
                    yield* db.webauthnCredentials.updateCounter(credential.id, verification.authenticationInfo.newCounter).pipe(Effect.ignore);
                    yield* _challenge.clear(userId);
                    yield* Effect.all([MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ method: 'webauthn', tenant: requestContext.tenantId })), audit.log('WebauthnCredential.authenticate', { details: { credentialId: credential.credentialId }, subjectId: userId })], { discard: true });
                    return { credentialId: credential.credentialId, verified: true as const };
                }), 'webauthn.authentication.verify'),
            },
            credentials: {
                delete: (userId: string, credentialId: string) => Telemetry.span(Effect.gen(function* () {
                    const all = yield* _activeCredentials(userId);
                    const target = yield* Option.fromNullable(all.find((credential) => credential.id === credentialId)).pipe(Option.match({ onNone: () => Effect.fail(HttpError.NotFound.of('webauthn_credential', credentialId)), onSome: Effect.succeed }));
                    yield* db.webauthnCredentials.softDelete(credentialId).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential delete failed', error)));
                    yield* audit.log('WebauthnCredential.delete', { details: { credentialId: target.credentialId, name: target.name }, subjectId: userId });
                    return { deleted: true as const };
                }), 'webauthn.credential.delete'),
                list: (userId: string) => _activeCredentials(userId).pipe(Effect.map((credentials) => credentials.map((credential) => ({ backedUp: credential.backedUp, counter: credential.counter, credentialId: credential.credentialId, deviceType: credential.deviceType, id: credential.id, lastUsedAt: Option.getOrNull(credential.lastUsedAt), name: credential.name, transports: credential.transports }))), Telemetry.span('webauthn.credentials.list')),
            },
            registration: {
                start: (userId: string, email: string) => Telemetry.span(Effect.gen(function* () {
                    const existingCredentials = yield* _activeCredentials(userId);
                    yield* existingCredentials.length >= _CONFIG.webauthn.maxCredentialsPerUser ? Effect.fail(HttpError.Conflict.of('webauthn', `Maximum ${_CONFIG.webauthn.maxCredentialsPerUser} passkeys allowed`)) : Effect.void;
                    const options = yield* Effect.tryPromise({ catch: (error) => HttpError.Internal.of('WebAuthn registration options generation failed', error), try: () => generateRegistrationOptions({ attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' }, excludeCredentials: existingCredentials.map((credential) => ({ id: credential.credentialId, transports: credential.transports as AuthenticatorTransportFuture[] })), rpID: rpId, rpName, userName: email }) });
                    yield* _challenge.save(userId, options.challenge);
                    yield* audit.log('WebauthnCredential.registrationStart', { details: { existingCount: existingCredentials.length }, subjectId: userId });
                    return options;
                }), 'webauthn.registration.start'),
                verify: (userId: string, credentialName: string, response: unknown) => Telemetry.span(Effect.gen(function* () {
                    const requestContext = yield* Context.Request.current;
                    const stored = yield* _challenge.valid(userId);
                    const verification = yield* Effect.tryPromise({ catch: (error) => HttpError.Auth.of('WebAuthn registration verification failed', error), try: () => verifyRegistrationResponse({ expectedChallenge: stored.challenge, expectedOrigin, expectedRPID: rpId, response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'] }) });
                    const registrationInfo = yield* verification.verified && verification.registrationInfo ? Effect.succeed(verification.registrationInfo) : Effect.fail(HttpError.Auth.of('WebAuthn registration verification rejected'));
                    yield* db.webauthnCredentials.insert({ backedUp: registrationInfo.credentialBackedUp, counter: registrationInfo.credential.counter, credentialId: registrationInfo.credential.id, deletedAt: Option.none(), deviceType: registrationInfo.credentialDeviceType, lastUsedAt: Option.none(), name: credentialName, publicKey: registrationInfo.credential.publicKey, transports: registrationInfo.credential.transports ?? [], updatedAt: undefined, userId }).pipe(Effect.mapError((error) => HttpError.Internal.of('WebAuthn credential store failed', error)));
                    yield* _challenge.clear(userId);
                    yield* Effect.all([MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ method: 'webauthn', tenant: requestContext.tenantId }), 1), audit.log('WebauthnCredential.register', { details: { credentialId: registrationInfo.credential.id, deviceType: registrationInfo.credentialDeviceType, name: credentialName }, subjectId: userId })], { discard: true });
                    return { credentialId: registrationInfo.credential.id, verified: true as const };
                }), 'webauthn.registration.verify'),
            },
        };
        return { mfa, oauth, session, webauthn };
    }),
}) {
}

// --- [ENTRY] -----------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Auth = {
	..._RPC,
	Service: AuthService
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Auth {
    export type Service = typeof AuthService.Service;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Auth };
