/**
 * Unify OAuth, MFA, and session flows via @effect/experimental Machine.
 * State persistence enables cross-pod handoff and audit replay.
 */
import { Machine } from '@effect/experimental';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Hex64 } from '@parametric-portal/types/types';
import { Apple, decodeIdToken, generateCodeVerifier, generateState, GitHub, Google, MicrosoftEntraId, type OAuth2Tokens } from 'arctic';
import { Cache, Clock, Config, DateTime, Duration, Effect, Encoding, Match, Option, PrimaryKey, Redacted, Schema as S } from 'effect';
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

type _StateOf<T extends Auth.Phase> = Extract<typeof _SCHEMA.state.Type, { _tag: T }>;
type _ReqOf<T extends typeof _SCHEMA.req.Type['_tag']> = Extract<typeof _SCHEMA.req.Type, { _tag: T }>;

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	backup: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', count: 10, length: 8 },
	cache: { capacity: 5000, ttl: Duration.minutes(5) },
	salt: { length: 16 },
	session: { storeId: 'auth.session' },
	snapshot: { storeId: 'auth.snapshot' },
	totp: { algorithm: 'sha256', digits: 6, epochTolerance: [30, 30] as [number, number], periodMs: 30000, periodSec: 30 },
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = (() => {
	const tokens = S.Struct({ expiresAt: S.DateTimeUtc, refresh: S.Redacted(S.String), session: S.Redacted(S.String) });
	const base = S.Struct({ mfaAttempts: S.optionalWith(S.Number, { default: () => 0 }), requestId: S.String, tenantId: S.String });
	const auth = S.extend(base)(S.Struct({ provider: Context.OAuthProvider, sessionId: S.String, tokens, userId: S.String }));
	const req = S.Union(
		S.Struct({ _tag: S.Literal('Initiate'), provider: Context.OAuthProvider }),
		S.Struct({ _tag: S.Literal('Callback'), code: S.String, cookie: S.String, state: S.String }),
		S.Struct({ _tag: S.Literal('Verify'), code: S.String, isBackup: S.Boolean }),
		S.Struct({ _tag: S.Literal('Refresh'), hash: Hex64.schema }),
		S.Struct({ _tag: S.Literal('Revoke'), reason: S.Literal('logout', 'timeout', 'security') }),
	);
	const res = S.Union(
		S.Struct({ _tag: S.Literal('Initiate'), authUrl: S.String, cookie: S.String }),
		S.Struct({ _tag: S.Literal('Callback'), mfaPending: S.Boolean, tokens, userId: S.String }),
		S.Struct({ _tag: S.Literal('Verify'), remainingCodes: S.Int, verifiedAt: S.DateTimeUtc }),
		S.Struct({ _tag: S.Literal('Refresh'), mfaPending: S.Boolean, tokens }),
		S.Struct({ _tag: S.Literal('Revoke'), revokedAt: S.DateTimeUtc }),
	);
	const sessionCache = S.Struct({
		accessExpiresAt: S.DateFromSelf,
		appId: S.String,
		id: S.String,
		userId: S.String,
		verifiedAt: S.NullOr(S.DateFromSelf),
	});
	const sessionCacheOption = S.OptionFromNullOr(sessionCache);
	const state = S.Union(
		S.extend(base)(S.Struct({ _tag: S.Literal('idle') })),
		S.extend(base)(S.Struct({ _tag: S.Literal('oauth'), codeVerifier: S.OptionFromNullOr(S.String), oauthState: S.String, provider: Context.OAuthProvider })),
		S.extend(auth)(S.Struct({ _tag: S.Literal('mfa') })),
		S.extend(auth)(S.Struct({ _tag: S.Literal('active'), verifiedAt: S.DateTimeUtc })),
		S.extend(base)(S.Struct({ _tag: S.Literal('revoked'), provider: Context.OAuthProvider, revokedAt: S.DateTimeUtc, userId: S.String })),
	);
	const snapshot = S.Tuple(S.Unknown, state);
	const snapshotScope = S.Literal('oauth', 'session');
	return { req, res, sessionCache, sessionCacheOption, snapshot, snapshotScope, state, tokens } as const;
})();
const _PkceState = S.Struct({ exp: S.Number, provider: Context.OAuthProvider, state: S.String, verifier: S.optional(S.String) });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _isMfaEnabled = (mfaOption: Option.Option<{ enabledAt: Option.Option<Date> }>) => mfaOption.pipe(Option.flatMap((mfaSecrets) => mfaSecrets.enabledAt), Option.isSome);
const _mfaEnabled = (db: DatabaseService.Type, userId: string) => db.mfaSecrets.byUser(userId).pipe(Effect.map(_isMfaEnabled));
const _wrapOp = <A, E, R>(op: string, eff: Effect.Effect<A, E, R>): Effect.Effect<A, _AuthError, R> => eff.pipe(Effect.mapError((error) => error instanceof _AuthError ? error : _AuthError.from('internal', { op }, error)));

// --- [CLASSES] ---------------------------------------------------------------

class _AuthError extends S.TaggedError<_AuthError>()('AuthError', { // NOSONAR S3358
	cause: S.optional(S.Unknown),
	context: S.optional(S.Record({ key: S.String, value: S.Unknown })),
	reason: S.Literal('phase_invalid', 'config_failed', 'oauth_encoding', 'oauth_state_mismatch', 'oauth_exchange_failed', 'oauth_user_fetch', 'mfa_not_enrolled', 'mfa_invalid_code', 'mfa_invalid_backup', 'token_invalid', 'token_expired', 'token_revoked', 'user_not_found', 'user_disabled', 'user_no_email', 'snapshot_missing', 'internal') }) {
	static readonly from = (reason: _AuthError['reason'], context?: Record<string, unknown>, cause?: unknown) => new _AuthError({ cause, context, reason });
	static readonly phase = (actual: string, allowed: readonly string[]) => new _AuthError({ context: { actual, allowed }, reason: 'phase_invalid' });
}
class _AuthRpc extends S.TaggedRequest<_AuthRpc>()('AuthRpc', { // NOSONAR S3358
	failure: _AuthError, payload: { req: _SCHEMA.req },
	success: _SCHEMA.res }) {}
class _AuthSnapshotKey extends S.TaggedRequest<_AuthSnapshotKey>()('AuthSnapshotKey', { // NOSONAR S3358
	failure: _AuthError,
	payload: { id: S.String, scope: _SCHEMA.snapshotScope, snapshot: S.optional(_SCHEMA.snapshot), tenantId: S.String },
	success: _SCHEMA.snapshot })
	{[PrimaryKey.symbol]() { return `auth:${this.scope}:${this.tenantId}:${this.id}`; }}
class _SessionCacheKey extends S.TaggedRequest<_SessionCacheKey>()('SessionCacheKey', { // NOSONAR S3358
	failure: _AuthError,
	payload: { hash: Hex64.schema, tenantId: S.String },
	success: _SCHEMA.sessionCacheOption })
	{[PrimaryKey.symbol]() { return `auth:session:${this.tenantId}:${this.hash}`; }}

// --- [SERVICES] --------------------------------------------------------------

class OAuthClientService extends Effect.Service<OAuthClientService>()('server/OAuthClients', {
	effect: Effect.gen(function* () {
		type Clients = { apple: Apple; github: GitHub; google: Google; microsoft: MicrosoftEntraId };
		const cap = (provider: Context.OAuthProvider) => Context.Request.config.oauth.capabilities[provider];
		const scopes = (provider: Context.OAuthProvider) => [...(cap(provider).oidc ? Context.Request.config.oauth.scopes.oidc : Context.Request.config.oauth.scopes.github)];
		const _creds = (key: string) => Config.all({ id: Config.string(`OAUTH_${key}_CLIENT_ID`).pipe(Config.withDefault('')), secret: Config.redacted(`OAUTH_${key}_CLIENT_SECRET`).pipe(Config.withDefault(Redacted.make(''))) });
		const configuration = yield* Config.all({
			apple: Config.all({ clientId: Config.string('OAUTH_APPLE_CLIENT_ID').pipe(Config.withDefault('')), keyId: Config.string('OAUTH_APPLE_KEY_ID').pipe(Config.withDefault('')), privateKey: Config.redacted('OAUTH_APPLE_PRIVATE_KEY').pipe(Config.withDefault(Redacted.make(''))), teamId: Config.string('OAUTH_APPLE_TEAM_ID').pipe(Config.withDefault('')) }),
			baseUrl: Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000')),
			creds: Config.all({ github: _creds('GITHUB'), google: _creds('GOOGLE'), microsoft: _creds('MICROSOFT') }),
			tenant: Config.string('OAUTH_MICROSOFT_TENANT_ID').pipe(Config.withDefault('common')),
		});
		const redirect = (provider: Context.OAuthProvider) => `${configuration.baseUrl}/api/auth/oauth/${provider}/callback`;
		const clients: Clients = {
			apple: new Apple(configuration.apple.clientId, configuration.apple.teamId, configuration.apple.keyId, new TextEncoder().encode(Redacted.value(configuration.apple.privateKey)), redirect('apple')),
			github: new GitHub(configuration.creds.github.id, Redacted.value(configuration.creds.github.secret), redirect('github')),
			google: new Google(configuration.creds.google.id, Redacted.value(configuration.creds.google.secret), redirect('google')),
			microsoft: new MicrosoftEntraId(configuration.tenant, configuration.creds.microsoft.id, Redacted.value(configuration.creds.microsoft.secret), redirect('microsoft')),
		};
		return {
			authUrl: (provider: Context.OAuthProvider, state: string, verifier?: string) => cap(provider).pkce ? (clients[provider] as Google | MicrosoftEntraId).createAuthorizationURL(state, verifier as string, scopes(provider)) : (clients[provider] as GitHub | Apple).createAuthorizationURL(state, scopes(provider)),
			exchange: (provider: Context.OAuthProvider, code: string, verifier?: string): Promise<OAuth2Tokens> => cap(provider).pkce ? (clients[provider] as Google | MicrosoftEntraId).validateAuthorizationCode(code, verifier as string) : (clients[provider] as GitHub | Apple).validateAuthorizationCode(code),
			extractUser: (provider: Context.OAuthProvider, tokens: OAuth2Tokens): Effect.Effect<{ externalId: string; email: Option.Option<string> }, _AuthError> => cap(provider).oidc
				? Effect.try({ catch: (error) => _AuthError.from('oauth_user_fetch', { provider }, error), try: () => decodeIdToken(tokens.idToken()) as { sub: string; email?: string } }).pipe(Effect.map((decoded) => ({ email: Option.fromNullable(decoded.email), externalId: decoded.sub })))
				: Effect.tryPromise({
					catch: (error) => _AuthError.from('oauth_user_fetch', { provider }, error),
					try: () => fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${tokens.accessToken()}`, 'User-Agent': 'ParametricPortal/1.0' } }),
				}).pipe(
					Effect.flatMap((response) => Effect.tryPromise({
						catch: (error) => _AuthError.from('oauth_user_fetch', { provider }, error),
						try: () => response.json() as Promise<{ id: number; email?: string | null }>,
					})),
					Effect.map((decoded) => ({ email: Option.fromNullable(decoded.email), externalId: String(decoded.id) })),
				),
		};
	}),
}) {}
class AuthService extends Effect.Service<AuthService>()('server/Auth', {
	effect: Effect.gen(function* () {
		const [db, metrics, audit, issuer] = yield* Effect.all([
			DatabaseService,
			MetricsService,
			AuditService,
			Config.string('APP_NAME').pipe(Config.withDefault('Parametric Portal')),
		]);
		const mfaEnabledCache = yield* Cache.make({ capacity: _CONFIG.cache.capacity,
			lookup: (userId: string) => db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)), Effect.map(_isMfaEnabled)),timeToLive: _CONFIG.cache.ttl,
		});
		const snapshotCache = yield* CacheService.cache<_AuthSnapshotKey, never>({
			lookup: (key: _AuthSnapshotKey) => Option.fromNullable(key.snapshot).pipe(Option.match({ onNone: () => Effect.fail(_AuthError.from('snapshot_missing', { key: key.id, scope: key.scope })), onSome: Effect.succeed })),
			storeId: _CONFIG.snapshot.storeId,
			timeToLive: Context.Request.config.durations.refresh,
		});
		type SessionRow = Effect.Effect.Success<ReturnType<typeof db.sessions.byHash>> extends Option.Option<infer T> ? T : never;
		const sessionCache = yield* CacheService.cache<_SessionCacheKey, SessionRow, never>({
			lookup: (key: _SessionCacheKey) => db.sessions.byHash(key.hash).pipe(Effect.mapError((error) => _AuthError.from('internal', { op: 'session_cache' }, error))),
			map: (session) => ({ accessExpiresAt: session.accessExpiresAt, appId: session.appId, id: session.id, userId: session.userId, verifiedAt: Option.match(session.verifiedAt, { onNone: () => null, onSome: (value) => value }) }),
			onSome: (session) => db.sessions.touch(session.id).pipe(Effect.catchAll((error) => Effect.logWarning('Session activity update failed', { error: String(error), sessionId: session.id }))),
			storeId: _CONFIG.session.storeId,
			timeToLive: _CONFIG.cache.ttl,
		});
		const _snap = (scope: typeof _SCHEMA.snapshotScope.Type, tenantId: string, id: string, snapshot?: typeof _SCHEMA.snapshot.Type) => ({
			drop: () => snapshotCache.invalidate(new _AuthSnapshotKey({ id, scope, tenantId })),
			load: () => snapshotCache.get(new _AuthSnapshotKey({ id, scope, tenantId })),
			save: () => snapshotCache.invalidate(new _AuthSnapshotKey({ id, scope, tenantId })).pipe(Effect.andThen(snapshotCache.get(new _AuthSnapshotKey({ id, scope, snapshot, tenantId })))),
		});
		const invalidateSessionToken = (tenantId: string, token: Redacted.Redacted<string>) =>
			Crypto.hmac(tenantId, Redacted.value(token)).pipe(
				Effect.flatMap((hash) => sessionCache.invalidate(new _SessionCacheKey({ hash, tenantId }))),
				Effect.catchAll((error) => Effect.logWarning('Session cache invalidation failed', { error: String(error), tenantId })),
				Effect.asVoid,
			);
		const snapshotOf = (actor: Machine.Actor<ReturnType<typeof _machine>>) => Machine.snapshot(actor as Machine.SerializableActor<ReturnType<typeof _machine>>).pipe(Effect.flatMap(S.decodeUnknown(_SCHEMA.snapshot)), Effect.mapError((error) => _AuthError.from('internal', { op: 'snapshot' }, error)));
		const restoreActor = (snapshot: typeof _SCHEMA.snapshot.Type) => {
			const state = snapshot[1];
			return Machine.restore(_machine(state.tenantId, state.requestId, invalidateSessionToken), snapshot).pipe(Effect.map((actor) => ({ actor, state })));
		};
		const sessionIdFrom = (state: typeof _SCHEMA.state.Type): Effect.Effect<string, _AuthError> => 'sessionId' in state ? Effect.succeed((state).sessionId) : Effect.fail(_AuthError.phase(state._tag, ['mfa', 'active']));
		const mfaStatus = (userId: string) =>
			db.mfaSecrets.byUser(userId).pipe(
				Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)),
				Effect.map(Option.match({
					onNone: () => ({ enabled: false, enrolled: false }) as const,
					onSome: (mfaSecrets) => ({ enabled: Option.isSome(mfaSecrets.enabledAt), enrolled: true, remainingBackupCodes: mfaSecrets.backupHashes.length }) as const,
				})),
			);
		const mfaEnroll = (userId: string, email: string) =>
			Telemetry.span(Effect.gen(function* () {
				const requestContext = yield* Context.Request.current;
				const existing = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA enrollment check failed', error)));
				yield* Option.isSome(existing) && Option.isSome(existing.value.enabledAt) ? Effect.fail(HttpError.Conflict.of('mfa', 'MFA already enabled')) : Effect.void;
				const secret = yield* Effect.sync(generateSecret);
				const encrypted = yield* Crypto.encrypt(secret).pipe(Effect.mapError((error) => HttpError.Internal.of('TOTP secret encryption failed', error)));
				const backupCodes = Array.from({ length: _CONFIG.backup.count }, customAlphabet(_CONFIG.backup.alphabet, _CONFIG.backup.length));
				const salt = Encoding.encodeHex(randomBytes(_CONFIG.salt.length));
				const backupHashes = yield* Effect.all(backupCodes.map((code) => Crypto.hash(`${salt}${code.toUpperCase()}`).pipe(Effect.map((hash) => `${salt}$${hash}`))), { concurrency: 'unbounded' });
				yield* Effect.suspend(() => db.mfaSecrets.upsert({ backupHashes, encrypted, userId })).pipe(Effect.asVoid, Effect.catchAll((error) => Effect.fail(HttpError.Internal.of('MFA upsert failed', error))));
				yield* mfaEnabledCache.invalidate(userId);
				yield* Effect.all([
					MetricsService.inc(metrics.mfa.enrollments, MetricsService.label({ tenant: requestContext.tenantId }), 1),
					audit.log('MfaSecret.enroll', { details: { backupCodesGenerated: _CONFIG.backup.count }, subjectId: userId }),
				], { discard: true });
				return { backupCodes, qrDataUrl: generateURI({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, issuer, label: email, period: _CONFIG.totp.periodSec, secret }), secret };
			}), 'mfa.enroll');
		const mfaDisable = (userId: string) =>
			Telemetry.span(Effect.gen(function* () {
				const requestContext = yield* Context.Request.current;
				const option = yield* db.mfaSecrets.byUser(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA status check failed', error)));
				yield* Option.isNone(option) ? Effect.fail(HttpError.NotFound.of('mfa')) : Effect.void;
				yield* db.mfaSecrets.softDelete(userId).pipe(Effect.mapError((error) => HttpError.Internal.of('MFA soft delete failed', error)));
				yield* mfaEnabledCache.invalidate(userId);
				yield* Effect.all([
					MetricsService.inc(metrics.mfa.disabled, MetricsService.label({ tenant: requestContext.tenantId }), 1),
					audit.log('MfaSecret.disable', { subjectId: userId }),
				], { discard: true });
				return { success: true as const };
			}), 'mfa.disable');
		const oauthStart = (provider: Context.OAuthProvider) =>
			Context.Request.current.pipe(
				Effect.flatMap(({ requestId, tenantId }) => Machine.boot(_machine(tenantId, requestId, invalidateSessionToken)).pipe(
					Effect.flatMap((actor) => actor.send(Auth.Initiate({ provider })).pipe(
						Effect.tap((response) => snapshotOf(actor).pipe(Effect.flatMap((snapshot) => _snap('oauth', tenantId, (response as Extract<typeof response, { _tag: 'Initiate' }>).cookie, snapshot).save()))),
					)),
				)),
				Effect.mapError((error) => HttpError.OAuth.of(provider, error instanceof _AuthError ? error.reason : 'internal', error)),
			);
		const oauthCallback = (provider: Context.OAuthProvider, code: string, state: string, cookie: string) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => _snap('oauth', tenantId, cookie).load().pipe(
					Effect.flatMap(restoreActor),
					Effect.flatMap(({ actor }) => actor.send(Auth.Callback({ code, cookie, state })).pipe(
						Effect.flatMap((callbackResponse) => snapshotOf(actor).pipe(Effect.map((snapshot) => [callbackResponse as Extract<typeof callbackResponse, { _tag: 'Callback' }>, snapshot] as const))),
						Effect.flatMap(([callbackResult, nextSnapshot]) => sessionIdFrom(nextSnapshot[1]).pipe(
							Effect.tap((sessionId) => Effect.all([_snap('oauth', tenantId, cookie).drop(), _snap('session', tenantId, sessionId, nextSnapshot).save()], { discard: true })),
							Effect.map((sessionId) => ({ accessToken: Redacted.value(callbackResult.tokens.session), expiresAt: callbackResult.tokens.expiresAt, mfaPending: callbackResult.mfaPending, refreshToken: Redacted.value(callbackResult.tokens.refresh), sessionId, userId: callbackResult.userId })),
						)),
					)),
				)),
				Effect.mapError((error) => error instanceof _AuthError ? HttpError.OAuth.of(provider, error.reason, error) : HttpError.Internal.of('OAuth callback failed', error)),
			);
		const refresh = (hash: Hex64) =>
			Effect.all([Context.Request.currentTenantId, db.sessions.byRefreshHash(hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(_AuthError.from('token_invalid')), onSome: Effect.succeed })))]).pipe(
				Effect.flatMap(([tenantId, session]) => Clock.currentTimeMillis.pipe(
					Effect.filterOrFail((now) => now <= session.refreshExpiresAt.getTime(), () => _AuthError.from('token_expired')),
					Effect.as(session),
					Effect.flatMap((valid) => _snap('session', tenantId, valid.id).load().pipe(
						Effect.flatMap(restoreActor),
						Effect.flatMap(({ actor }) => actor.send(Auth.Refresh({ hash })).pipe(
							Effect.flatMap((refreshResponse) => snapshotOf(actor).pipe(Effect.map((snapshot) => [refreshResponse as Extract<typeof refreshResponse, { _tag: 'Refresh' }>, snapshot] as const))),
							Effect.flatMap(([refreshResult, nextSnapshot]) => sessionIdFrom(nextSnapshot[1]).pipe(
								Effect.tap((nextSessionId) => Effect.all([_snap('session', tenantId, valid.id).drop(), _snap('session', tenantId, nextSessionId, nextSnapshot).save()], { discard: true })),
								Effect.map(() => ({ accessToken: Redacted.value(refreshResult.tokens.session), expiresAt: refreshResult.tokens.expiresAt, mfaPending: refreshResult.mfaPending, refreshToken: Redacted.value(refreshResult.tokens.refresh), userId: valid.userId })),
							)),
						)),
					)),
				)),
				Effect.mapError((error) => error instanceof _AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of('Token refresh failed', error)),
			);
		const revoke = (sessionId: string, userId: string, reason: Extract<typeof _SCHEMA.req.Type, { _tag: 'Revoke' }>['reason']) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => _snap('session', tenantId, sessionId).load().pipe(
					Effect.flatMap(restoreActor),
					Effect.flatMap(({ actor }) => actor.send(Auth.Revoke({ reason })).pipe(Effect.tap(() => _snap('session', tenantId, sessionId).drop()))),
				)),
				Effect.catchAll((error) => {
					const isSnapshotMissing = error instanceof _AuthError && error.reason === 'snapshot_missing';
					return isSnapshotMissing
						? db.sessions.softDeleteByUser(userId).pipe(Effect.ignore, Effect.as({ _tag: 'Revoke', revokedAt: DateTime.unsafeNow() } as const))
						: Effect.fail(HttpError.Internal.of('Session revocation failed', error));
				}),
			);
		const mfaVerify = (sessionId: string, code: string) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => _snap('session', tenantId, sessionId).load().pipe(
					Effect.flatMap(restoreActor),
					Effect.flatMap(({ actor }) => actor.send(Auth.Verify({ code, isBackup: false })).pipe(Effect.flatMap(() => snapshotOf(actor).pipe(Effect.tap((snapshot) => _snap('session', tenantId, sessionId, snapshot).save()))))),
				)),
				Effect.as({ success: true as const }),
				Effect.mapError((error) => error instanceof _AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of('MFA verification failed', error)),
			);
		const mfaRecover = (sessionId: string, code: string) =>
			Context.Request.currentTenantId.pipe(
				Effect.flatMap((tenantId) => _snap('session', tenantId, sessionId).load().pipe(
					Effect.flatMap(restoreActor),
					Effect.flatMap(({ actor }) => actor.send(Auth.Verify({ code, isBackup: true })).pipe(
						Effect.flatMap((verifyResponse) => snapshotOf(actor).pipe(Effect.tap((snapshot) => _snap('session', tenantId, sessionId, snapshot).save()), Effect.as({ remainingCodes: (verifyResponse as Extract<typeof verifyResponse, { _tag: 'Verify' }>).remainingCodes, success: true as const }))),
					)),
				)),
				Effect.mapError((error) => error instanceof _AuthError ? HttpError.Auth.of(error.reason, error) : HttpError.Auth.of('MFA recovery failed', error)),
			);
		const sessionLookup = (hash: Hex64) =>
			Context.Request.current.pipe(
				Effect.flatMap((context) => (sessionCache.get(new _SessionCacheKey({ hash, tenantId: context.tenantId })) as Effect.Effect<Option.Option<typeof _SCHEMA.sessionCache.Type>>).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Effect.succeed(Option.none<Context.Request.Session>()),
						onSome: (session) => session.appId === context.tenantId
							? Clock.currentTimeMillis.pipe(Effect.flatMap((now) => now > session.accessExpiresAt.getTime()
								? Effect.logWarning('Session expired', { accessExpiresAt: session.accessExpiresAt, sessionId: session.id }).pipe(Effect.as(Option.none()))
								: mfaEnabledCache.get(session.userId).pipe(Effect.map((mfaEnabled) => Option.some({ appId: session.appId, id: session.id, mfaEnabled, userId: session.userId, verifiedAt: Option.fromNullable(session.verifiedAt) })))))
							: Effect.logWarning('Session tenant mismatch', { expected: context.tenantId, got: session.appId }).pipe(Effect.as(Option.none())),
					})),
				)),
				Effect.catchAll((error) => Effect.logError('Session lookup failed', { error: String(error) }).pipe(Effect.as(Option.none()))),
			);
		return { mfaDisable, mfaEnroll, mfaRecover, mfaStatus, mfaVerify, oauthCallback, oauthStart, refresh, revoke, sessionLookup };
	}),
}) {}

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const _createTokens = (db: DatabaseService.Type, tenantId: string, userId: string, mfaPending: boolean) =>
	Effect.gen(function* () {
		const [session, refresh, requestContext] = yield* Effect.all([Crypto.pair, Crypto.pair, Context.Request.current]);
		const [sessionHash, refreshHash] = yield* Effect.all([Crypto.hmac(tenantId, session.token), Crypto.hmac(tenantId, refresh.token)]);
		const now = DateTime.unsafeNow();
		const sessionRow = yield* db.sessions.insert({
			accessExpiresAt: DateTime.toDateUtc(DateTime.addDuration(now, Context.Request.config.durations.session)),
			appId: tenantId, deletedAt: Option.none(), hash: sessionHash, ipAddress: requestContext.ipAddress,
			refreshExpiresAt: DateTime.toDateUtc(DateTime.addDuration(now, Context.Request.config.durations.refresh)),
			refreshHash, updatedAt: undefined, userAgent: requestContext.userAgent, userId, verifiedAt: mfaPending ? Option.none() : Option.some(new Date()),
		});
		return { expiresAt: DateTime.addDuration(now, Context.Request.config.durations.session), refresh: refresh.token, session: session.token, sessionId: sessionRow.id };
	});
const _encryptState = (provider: Context.OAuthProvider, state: string, verifier?: string) =>
	Clock.currentTimeMillis.pipe(
		Effect.flatMap((now) => S.encode(_PkceState)({ exp: now + Duration.toMillis(Context.Request.config.durations.pkce), provider, state, verifier })),
		Effect.flatMap((obj) => Crypto.encrypt(JSON.stringify(obj))),
		Effect.map(Encoding.encodeBase64Url), // NOSONAR S3358
		Effect.mapError(() => _AuthError.from('config_failed', { op: 'encrypt_state' })),
	);
const _decryptState = (provider: Context.OAuthProvider, cookie: string, expectedState: string) =>
	Effect.andThen(Encoding.decodeBase64Url(cookie), Crypto.decrypt).pipe(
		Effect.flatMap((json) => S.decode(_PkceState)(JSON.parse(json))),
		Effect.flatMap((decoded) =>
			Clock.currentTimeMillis.pipe(
				Effect.filterOrFail((now) => decoded.provider === provider && decoded.state === expectedState && decoded.exp > now, () => _AuthError.from('oauth_state_mismatch', { provider })),
				Effect.as(decoded),
			)),
		Effect.map((decoded) => decoded.verifier),
		Effect.mapError((error) => error instanceof _AuthError ? error : _AuthError.from('oauth_encoding', { provider }, error)),
	);
const _resolveUser = (db: DatabaseService.Type, tenantId: string, provider: Context.OAuthProvider, externalId: string, email: Option.Option<string>) =>
	db.oauthAccounts.byExternal(provider, externalId).pipe(
		Effect.flatMap(Option.match({
			onNone: () => Option.match(email, {
				onNone: () => Effect.fail(_AuthError.from('user_no_email', { provider })),
				onSome: (emailValue) => db.users.insert({ appId: tenantId, deletedAt: Option.none(), email: emailValue, role: 'member', status: 'active', updatedAt: undefined }).pipe(
					Effect.map((user) => ({ isNew: true, userId: user.id })),
					Effect.mapError((error) => _AuthError.from('internal', { op: 'resolve_user', provider }, error)),
				),
			}),
			onSome: (oauth) => db.users.one([{ field: 'id', value: oauth.userId }]).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(_AuthError.from('user_not_found', { userId: oauth.userId })), onSome: (user) => Effect.succeed({ isNew: false, userId: user.id }) })), Effect.mapError((error) => error instanceof _AuthError ? error : _AuthError.from('internal', { op: 'user_lookup', userId: oauth.userId }, error))),
		})),
	);
const _matchBackup = (codes: readonly string[], code: string): Effect.Effect<Option.Option<number>, never, Crypto.Service> =>
	Effect.all(codes.map((entry, index) => {
		const sep = entry.indexOf('$');
		return sep <= 0 || sep >= entry.length - 1 ? Effect.succeed(Option.none<number>()) : Crypto.hash(`${entry.slice(0, sep)}${code.toUpperCase()}`).pipe(Effect.flatMap((computed) => Crypto.compare(computed, entry.slice(sep + 1))), Effect.map((isMatch) => isMatch ? Option.some(index) : Option.none()));
	}), { concurrency: 1 }).pipe(Effect.map(Option.firstSomeOf));
const _verifyTotp = (mfa: { backupHashes: readonly string[]; enabledAt: Option.Option<Date>; encrypted: Uint8Array }, code: string, now: number, userId: string, replayGuard: typeof ReplayGuardService.Service, db: DatabaseService.Type) =>
	Crypto.decrypt(mfa.encrypted).pipe(
		Effect.mapError((error) => _AuthError.from('mfa_invalid_code', { userId }, error)),
		Effect.flatMap((secret) => Effect.try({ catch: () => _AuthError.from('mfa_invalid_code', { userId }), try: () => verifySync({ algorithm: _CONFIG.totp.algorithm, digits: _CONFIG.totp.digits, epochTolerance: _CONFIG.totp.epochTolerance, period: _CONFIG.totp.periodSec, secret, token: code }) })),
		Effect.filterOrElse((result) => result.valid, () => replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(_AuthError.from('mfa_invalid_code', { userId }))))),
		Effect.flatMap((result) => replayGuard.checkAndMark(userId, Math.floor(now / _CONFIG.totp.periodMs) + ((result as { delta?: number }).delta ?? 0), code)),
		Effect.filterOrElse(({ alreadyUsed }) => !alreadyUsed, () => replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(_AuthError.from('mfa_invalid_code', { userId }))))),
		Effect.tap(() => replayGuard.recordSuccess(userId)),
		Effect.flatMap(() => Option.isSome(mfa.enabledAt) ? Effect.succeed(mfa.backupHashes.length) : db.mfaSecrets.upsert({ backupHashes: mfa.backupHashes, enabledAt: Option.some(new Date()), encrypted: mfa.encrypted, userId }).pipe(Effect.as(mfa.backupHashes.length))),
	);
const _verifyMfa = (db: DatabaseService.Type, replayGuard: typeof ReplayGuardService.Service, userId: string, code: string, isBackup: boolean) =>
	Effect.gen(function* () {
		yield* replayGuard.checkLockout(userId);
		const mfa = yield* db.mfaSecrets.byUser(userId).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(_AuthError.from('mfa_not_enrolled', { userId })), onSome: Effect.succeed })), Effect.mapError((error) => error instanceof _AuthError ? error : _AuthError.from('internal', { op: 'mfa_lookup', userId }, error)));
		const now = yield* Clock.currentTimeMillis;
		return yield* isBackup
			? _matchBackup(mfa.backupHashes, code).pipe(Effect.flatMap(Option.match({
				onNone: () => replayGuard.recordFailure(userId).pipe(Effect.andThen(Effect.fail(_AuthError.from('mfa_invalid_backup', { remaining: mfa.backupHashes.length })))),
				onSome: (index) => db.mfaSecrets.upsert({ backupHashes: mfa.backupHashes.filter((_, idx) => idx !== index), enabledAt: mfa.enabledAt, encrypted: mfa.encrypted, userId }).pipe(Effect.tap(() => replayGuard.recordSuccess(userId)), Effect.as(mfa.backupHashes.length - 1), Effect.mapError((error) => _AuthError.from('mfa_invalid_backup', { userId }, error))),
			})))
			: _verifyTotp(mfa, code, now, userId, replayGuard, db);
	});

// --- [HANDLERS] --------------------------------------------------------------

const _handleInitiate = (currentState: _StateOf<'idle'>, request: _ReqOf<'Initiate'>) => _wrapOp('initiate', Effect.gen(function* () {
		const [metrics, oauth] = yield* Effect.all([MetricsService, OAuthClientService]);
		const state = generateState();
		const verifier = Context.Request.config.oauth.capabilities[request.provider].pkce ? generateCodeVerifier() : undefined;
		const cookie = yield* _encryptState(request.provider, state, verifier);
		yield* MetricsService.inc(metrics.oauth.authorizations, MetricsService.label({ provider: request.provider }));
		return [
			{ _tag: 'Initiate', authUrl: oauth.authUrl(request.provider, state, verifier).toString(), cookie } as const,
			{ _tag: 'oauth', codeVerifier: Option.fromNullable(verifier), mfaAttempts: currentState.mfaAttempts, oauthState: state, provider: request.provider, requestId: currentState.requestId, tenantId: currentState.tenantId } as const,
		] as const;
	}));
const _handleCallback = (currentState: _StateOf<'oauth'>, request: _ReqOf<'Callback'>) => _wrapOp('callback', Effect.gen(function* () {
		const [db, metrics, audit, oauth] = yield* Effect.all([DatabaseService, MetricsService, AuditService, OAuthClientService]);
		const verifier = yield* _decryptState(currentState.provider, request.cookie, request.state);
		const oauthTokens = yield* Effect.tryPromise({ catch: (error) => _AuthError.from('oauth_exchange_failed', { provider: currentState.provider }, error), try: () => oauth.exchange(currentState.provider, request.code, verifier) });
		const userInfo = yield* oauth.extractUser(currentState.provider, oauthTokens);
		const { userId, isNew } = yield* _resolveUser(db, currentState.tenantId, currentState.provider, userInfo.externalId, userInfo.email);
		const accessEncrypted = yield* Crypto.encrypt(oauthTokens.accessToken());
		const refreshEncrypted = yield* Option.match(Option.fromNullable(oauthTokens.refreshToken()), {
			onNone: () => Effect.succeed(Option.none<Uint8Array>()),
			onSome: (token) => Crypto.encrypt(token).pipe(Effect.map(Option.some)),
		});
		yield* db.oauthAccounts.upsert({
			accessEncrypted,
			deletedAt: Option.none(),
			expiresAt: Option.fromNullable(oauthTokens.accessTokenExpiresAt()),
			externalId: userInfo.externalId,
			provider: currentState.provider,
			refreshEncrypted,
			scope: Option.none(),
			updatedAt: undefined,
			userId,
		});
		const mfaEnabled = yield* _mfaEnabled(db, userId);
		const tokens = yield* _createTokens(db, currentState.tenantId, userId, mfaEnabled).pipe(Effect.mapError((error) => _AuthError.from('internal', { op: 'callback' }, error)));
		yield* Effect.all([
			MetricsService.inc(metrics.auth.logins, MetricsService.label({ isNewUser: String(isNew), provider: currentState.provider })),
			audit.log('Auth.login', { details: { isNew, mfaEnabled, provider: currentState.provider }, subjectId: userId }),
		], { discard: true });
		const toks = { expiresAt: tokens.expiresAt, refresh: Redacted.make(tokens.refresh), session: Redacted.make(tokens.session) };
		const base = { mfaAttempts: currentState.mfaAttempts, provider: currentState.provider, requestId: currentState.requestId, sessionId: tokens.sessionId, tenantId: currentState.tenantId, tokens: toks, userId };
		return [
			{ _tag: 'Callback', mfaPending: mfaEnabled, tokens: toks, userId } as const,
			mfaEnabled ? { _tag: 'mfa', ...base } as const : { _tag: 'active', ...base, verifiedAt: DateTime.unsafeNow() } as const,
		] as const;
	}));
const _handleVerify = (invalidateSessionToken: (tenantId: string, token: Redacted.Redacted<string>) => Effect.Effect<void>, currentState: _StateOf<'mfa'>, request: _ReqOf<'Verify'>) => _wrapOp('verify', Effect.gen(function* () {
		const [db, metrics, audit, replayGuard] = yield* Effect.all([DatabaseService, MetricsService, AuditService, ReplayGuardService]);
		const remainingCodes = yield* _verifyMfa(db, replayGuard, currentState.userId, request.code, request.isBackup);
		const now = DateTime.unsafeNow();
		yield* db.sessions.verify(currentState.sessionId).pipe(Effect.ignore);
		yield* invalidateSessionToken(currentState.tenantId, currentState.tokens.session);
		yield* Effect.all([
			MetricsService.inc(metrics.mfa.verifications, MetricsService.label({ tenant: currentState.tenantId })),
			audit.log('Auth.verifyMfa', { subjectId: currentState.userId }),
		], { discard: true });
			return [
				{ _tag: 'Verify', remainingCodes, verifiedAt: now } as const,
				{ _tag: 'active', mfaAttempts: currentState.mfaAttempts, provider: currentState.provider, requestId: currentState.requestId, sessionId: currentState.sessionId, tenantId: currentState.tenantId, tokens: currentState.tokens, userId: currentState.userId, verifiedAt: now } as const,
			] as const;
		}));
const _handleRefresh = (invalidateSessionToken: (tenantId: string, token: Redacted.Redacted<string>) => Effect.Effect<void>, currentState: _StateOf<'mfa'> | _StateOf<'active'>, request: _ReqOf<'Refresh'>) => _wrapOp('refresh', Effect.gen(function* () {
	const [db, metrics] = yield* Effect.all([DatabaseService, MetricsService]);
	return yield* db.withTransaction(Effect.gen(function* () {
		const sessionRow = yield* db.sessions.byRefreshHashForUpdate(request.hash).pipe(Effect.flatMap(Option.match({ onNone: () => Effect.fail(_AuthError.from('token_invalid')), onSome: Effect.succeed })));
		yield* Clock.currentTimeMillis.pipe(Effect.filterOrFail((now) => now <= sessionRow.refreshExpiresAt.getTime(), () => _AuthError.from('token_expired')));
		yield* db.sessions.softDelete(sessionRow.id);
		const mfaEnabled = yield* _mfaEnabled(db, sessionRow.userId);
		const tokens = yield* _createTokens(db, currentState.tenantId, sessionRow.userId, mfaEnabled && currentState._tag === 'mfa');
			const toks = { expiresAt: tokens.expiresAt, refresh: Redacted.make(tokens.refresh), session: Redacted.make(tokens.session) };
			yield* invalidateSessionToken(currentState.tenantId, currentState.tokens.session);
			yield* MetricsService.inc(metrics.auth.refreshes, MetricsService.label({ tenant: currentState.tenantId }));
			return [
				{ _tag: 'Refresh', mfaPending: mfaEnabled && currentState._tag === 'mfa', tokens: toks } as const,
				{ ...currentState, sessionId: tokens.sessionId, tokens: toks },
			] as const;
		}));
	}));
const _handleRevoke = (invalidateSessionToken: (tenantId: string, token: Redacted.Redacted<string>) => Effect.Effect<void>, currentState: _StateOf<'mfa'> | _StateOf<'active'>, request: _ReqOf<'Revoke'>) => _wrapOp('revoke', Effect.gen(function* () {
		const [db, metrics, audit] = yield* Effect.all([DatabaseService, MetricsService, AuditService]);
		yield* db.sessions.softDeleteByUser(currentState.userId);
		const now = DateTime.unsafeNow();
		yield* invalidateSessionToken(currentState.tenantId, currentState.tokens.session);
		yield* Effect.all([
			MetricsService.inc(metrics.auth.logouts, MetricsService.label({ reason: request.reason, tenant: currentState.tenantId })),
			audit.log('Auth.revoke', { details: { reason: request.reason }, subjectId: currentState.userId }),
		], { discard: true });
		return [
			{ _tag: 'Revoke', revokedAt: now } as const,
			{ _tag: 'revoked', mfaAttempts: currentState.mfaAttempts, provider: currentState.provider, requestId: currentState.requestId, revokedAt: now, tenantId: currentState.tenantId, userId: currentState.userId } as const,
		] as const;
	}));

// --- [ENTRY_POINT] -----------------------------------------------------------

const _machine = (tenantId: string, requestId: string, invalidateSessionToken: (tenantId: string, token: Redacted.Redacted<string>) => Effect.Effect<void>) => Machine.makeSerializable(
	{ state: _SCHEMA.state },
	(_, previous) => Effect.succeed(
		Machine.serializable.make<typeof _SCHEMA.state.Type>(previous ?? { _tag: 'idle', mfaAttempts: 0, requestId, tenantId }, { identifier: `auth:${tenantId}:${requestId}` }).pipe(
			Machine.serializable.add(_AuthRpc, ({ request, state }) => Match.value(request.req).pipe(
				Match.tag('Initiate', (payload) => state._tag === 'idle' ? _handleInitiate(state, payload) : Effect.fail(_AuthError.phase(state._tag, ['idle']))),
				Match.tag('Callback', (payload) => state._tag === 'oauth' ? _handleCallback(state, payload) : Effect.fail(_AuthError.phase(state._tag, ['oauth']))),
				Match.tag('Verify', (payload) => state._tag === 'mfa' ? _handleVerify(invalidateSessionToken, state, payload) : Effect.fail(_AuthError.phase(state._tag, ['mfa']))),
				Match.tag('Refresh', (payload) => state._tag === 'mfa' || state._tag === 'active' ? _handleRefresh(invalidateSessionToken, state, payload) : Effect.fail(_AuthError.phase(state._tag, ['mfa', 'active']))),
				Match.tag('Revoke', (payload) => state._tag === 'mfa' || state._tag === 'active' ? _handleRevoke(invalidateSessionToken, state, payload) : Effect.fail(_AuthError.phase(state._tag, ['mfa', 'active']))),
				Match.exhaustive,
			)),
		),
	),
);
const _rpc = <T extends typeof _SCHEMA.req.Type['_tag']>(tag: T) => (payload: Omit<Extract<typeof _SCHEMA.req.Type, { _tag: T }>, '_tag'>) => new _AuthRpc({ req: { _tag: tag, ...payload } as unknown as typeof _SCHEMA.req.Type });

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Auth = {
	Callback: _rpc('Callback'),
	Initiate: _rpc('Initiate'),
	Refresh: _rpc('Refresh'),
	Revoke: _rpc('Revoke'),
	Service: AuthService,
	Verify: _rpc('Verify')
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Auth {
	export type Service = typeof AuthService.Service;
	export type Request = _AuthRpc;
	export type ReqPayload = typeof _SCHEMA.req.Type;
	export type ResPayload = typeof _SCHEMA.res.Type;
	export type State = typeof _SCHEMA.state.Type;
	export type Phase = State['_tag'];
	export type Error = _AuthError;
	export type ErrorReason = Error['reason'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Auth };
