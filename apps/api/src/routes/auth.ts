/**
 * Auth group handlers for OAuth flows and session management.
 * Uses HttpOnly cookies for refresh tokens (XSS-safe) and JSON for access tokens.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { AUTH_TUNING } from '@parametric-portal/server/auth';
import { getAppId, getClientInfo } from '@parametric-portal/server/context';
import { Crypto, EncryptedKey, TokenPair } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import type { AiProvider, ApiKey, ApiKeyId, OAuthProvider, RefreshTokenId, User, UserId } from '@parametric-portal/types/schema';
import { Email, Timestamp, Url, type Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Effect, Option, pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type OAuthService = typeof Middleware.OAuth.Service;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toUserResponse = (u: User) => Object.freeze({ createdAt: u.createdAt, email: Email.decodeSync(u.email), id: u.id, role: u.role });
const toApiKeyResponse = (k: ApiKey) => Object.freeze({ createdAt: k.createdAt, id: k.id, name: k.name, provider: k.provider });
/** MFA not configured OR enrolled but not enabled (enabledAt: null) → verified; MFA enabled → pending */
const deriveMfaVerifiedAt = (mfaOpt: Option.Option<{ readonly enabledAt: Date | null }>): Date | null =>
    pipe(mfaOpt, Option.filter((m) => m.enabledAt !== null), Option.match({ onNone: () => new Date(), onSome: () => null }));
const buildAuthResponse = (accessToken: Uuidv7, expiresAt: Date, refreshToken: Uuidv7, mfaPending: boolean) =>
    pipe(
        HttpServerResponse.json({ accessToken, expiresAt: DateTime.unsafeFromDate(expiresAt), mfaPending }),
        Effect.flatMap((response) =>
            HttpServerResponse.setCookie(response, AUTH_TUNING.cookie.name, refreshToken, {
                httpOnly: true,
                maxAge: `${AUTH_TUNING.cookie.maxAge} seconds`,
                path: AUTH_TUNING.cookie.path,
                sameSite: 'lax',
                secure: AUTH_TUNING.cookie.secure,
            }),
        ),
    );
const buildLogoutResponse = () =>
    pipe(
        HttpServerResponse.json({ success: true }),
        Effect.flatMap((response) =>
            HttpServerResponse.setCookie(response, AUTH_TUNING.cookie.name, '', {
                httpOnly: true,
                maxAge: '0 seconds',
                path: AUTH_TUNING.cookie.path,
                sameSite: 'lax',
                secure: AUTH_TUNING.cookie.secure,
            }),
        ),
    );
const createAuthTokenPairs = () =>
    Effect.gen(function* () {
        const session = yield* TokenPair.create;
        const refresh = yield* TokenPair.create;
        return {
            refreshHash: refresh.hash,
            refreshToken: refresh.token,
            sessionHash: session.hash,
            sessionToken: session.token,
        };
    });
const rotateTokens = (
    repos: DatabaseServiceShape,
    userId: UserId,
    opts: {
        readonly ctx?: { readonly ipAddress: string | null; readonly userAgent: string | null };
        readonly mfaVerifiedAt: Date | null;
        readonly revokeTokenId?: RefreshTokenId;
    },
) =>
    Effect.gen(function* () {
        const ipAddress = opts.ctx?.ipAddress ?? null;
        const userAgent = opts.ctx?.userAgent ?? null;
        const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createAuthTokenPairs();
        const sessionExpiresAt = Timestamp.expiresAtDate(AUTH_TUNING.durations.sessionMs);
        const refreshExpiresAt = Timestamp.expiresAtDate(AUTH_TUNING.durations.refreshTokenMs);
        yield* repos.withTransaction(
            Effect.gen(function* () {
                yield* repos.sessions
                    .insert({
                        expiresAt: sessionExpiresAt,
                        ipAddress,
                        mfaVerifiedAt: opts.mfaVerifiedAt,
                        revokedAt: null,
                        tokenHash: sessionHash,
                        userAgent,
                        userId,
                    })
                    .pipe(Effect.asVoid);
                yield* repos.refreshTokens
                    .insert({ expiresAt: refreshExpiresAt, revokedAt: null, tokenHash: refreshHash, userId })
                    .pipe(Effect.asVoid);
                yield* opts.revokeTokenId === undefined ? Effect.void : repos.refreshTokens.revoke(opts.revokeTokenId);
            }),
        );
        return { mfaPending: opts.mfaVerifiedAt === null, refreshToken, sessionExpiresAt, sessionToken };
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: OAuthService, provider: OAuthProvider) =>
    Effect.gen(function* () {
        const { stateCookie, url } = yield* oauth.createAuthorizationUrl(provider);
        const response = yield* HttpServerResponse.json({ url: Url.decodeSync(url.toString()) });
        return yield* HttpServerResponse.setCookie(response, AUTH_TUNING.oauth.stateCookie.name, stateCookie, {
            httpOnly: true,
            maxAge: `${AUTH_TUNING.oauth.stateCookie.maxAge} seconds`,
            path: AUTH_TUNING.oauth.stateCookie.path,
            sameSite: 'lax',
            secure: AUTH_TUNING.oauth.stateCookie.secure,
        });
    }).pipe(
        Effect.mapError((e) => {
            const provider = 'provider' in e ? e.provider : 'unknown';
            const isReason = 'reason' in e && typeof e.reason === 'string';
            const fallback = e instanceof Error ? e.message : String(e);
            const reason = isReason ? e.reason : fallback;
            return new HttpError.OAuth({ provider, reason });
        }),
    ),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
    ( oauth: OAuthService, repos: DatabaseServiceShape, provider: OAuthProvider, code: string, state: string, ) =>
        Effect.gen(function* () {
            const httpErr = (reason: string) => new HttpError.OAuth({ provider, reason });
            const request = yield* HttpServerRequest.HttpServerRequest;
            const stateCookie = yield* pipe(
                Option.fromNullable(request.cookies[AUTH_TUNING.oauth.stateCookie.name]),
                Option.match({
                    onNone: () => Effect.fail(httpErr('Missing OAuth state cookie')),
                    onSome: Effect.succeed,
                }),
            );
            const ctx = yield* getClientInfo;
            const appId = yield* getAppId;
            const result = yield* oauth.authenticate(provider, code, state, stateCookie);
            const emailRaw = yield* Option.match(result.email, {
                onNone: () => Effect.fail(httpErr('Email not provided by provider')),
                onSome: Effect.succeed,
            });
            const email = yield* pipe(
                S.decodeUnknown(Email.schema)(emailRaw),
                Effect.mapError(() => httpErr('Invalid email format from provider')),
            );
            const { isNewUser, userId } = yield* repos
                .withTransaction(
                    Effect.gen(function* () {
                        const existingUserOpt = yield* pipe(
                            repos.users.findByAppAndEmail(appId, email),
                            Effect.mapError(() => httpErr('User lookup failed')),
                        );
                        const isNew = Option.isNone(existingUserOpt);
                        const user = yield* isNew
                            ? pipe(
                                  repos.users.insert({ appId, deletedAt: null, email, role: 'member' }),
                                  Effect.mapError(() => httpErr('User creation failed')),
                              )
                            : Effect.succeed(existingUserOpt.value);
                        const encryptedAccess = yield* pipe(
                            Crypto.Key.encrypt(result.toNullableFields.accessToken),
                            Effect.map((e) => Buffer.from(e.toBytes())),
                            Effect.mapError(() => httpErr('Access token encryption failed')),
                        );
                        const encryptedRefresh = yield* (result.toNullableFields.refreshToken
                            ? pipe(
                                  Crypto.Key.encrypt(result.toNullableFields.refreshToken),
                                  Effect.map((e) => Buffer.from(e.toBytes()) as Buffer | null),
                                  Effect.mapError(() => httpErr('Refresh token encryption failed')),
                              )
                            : Effect.succeed(null as Buffer | null));
                        yield* pipe(
                            repos.oauthAccounts.upsert({
                                accessTokenEncrypted: encryptedAccess,
                                accessTokenExpiresAt: result.toNullableFields.expiresAt,
                                provider,
                                providerAccountId: result.toNullableFields.providerAccountId,
                                refreshTokenEncrypted: encryptedRefresh,
                                scope: null,
                                userId: user.id,
                            }),
                            Effect.mapError(() => httpErr('OAuth account upsert failed')),
                        );
                        return { isNewUser: isNew, userId: user.id };
                    }),
                )
                .pipe(HttpError.chain(HttpError.Internal, { message: 'User creation transaction failed' }));
            yield* Audit.log(repos.audit, {
                actorId: userId,
                appId,
                changes: { email, provider },
                entityId: userId,
                entityType: 'user',
                operation: isNewUser ? 'create' : 'update',
            });
            yield* Audit.log(repos.audit, {
                actorEmail: email,
                actorId: userId,
                appId,
                changes: { provider },
                entityId: userId,
                entityType: 'session',
                ipAddress: ctx.ipAddress,
                operation: 'login',
                userAgent: ctx.userAgent,
            });
            // Check MFA status: mfaVerifiedAt = null means pending, new Date() means implicitly verified
            const mfaOpt = yield* pipe(repos.mfaSecrets.findByUserId(userId), Effect.mapError(() => httpErr('MFA status check failed')));
            const mfaVerifiedAt = deriveMfaVerifiedAt(mfaOpt);
            const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* pipe(
                rotateTokens(repos, userId, { ctx, mfaVerifiedAt }),
                Effect.mapError(() => httpErr('Token generation failed')),
            );
            const response = yield* pipe(
                buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending),
                Effect.mapError(() => httpErr('Response build failed')),
            );
            return yield* pipe(
                HttpServerResponse.setCookie(response, AUTH_TUNING.oauth.stateCookie.name, '', {
                    httpOnly: true,
                    maxAge: '0 seconds',
                    path: AUTH_TUNING.oauth.stateCookie.path,
                    sameSite: 'lax',
                    secure: AUTH_TUNING.oauth.stateCookie.secure,
                }),
                Effect.mapError(() => httpErr('Cookie clear failed')),
            );
        }),
);
const handleRefresh = Effect.fn('auth.refresh')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const ctx = yield* getClientInfo;
        const appId = yield* getAppId;
        const refreshTokenInput = yield* pipe(
            Option.fromNullable(request.cookies[AUTH_TUNING.cookie.name]),
            Option.match({
                onNone: () => Effect.fail(new HttpError.Auth({ reason: 'Missing refresh token cookie' })),
                onSome: Effect.succeed,
            }),
        );
        const hashInput = yield* pipe(
            Crypto.Token.hash(refreshTokenInput),
            HttpError.chain(HttpError.Auth, { reason: 'Token hashing failed' }),
        );
        const tokenOpt = yield* pipe(
            repos.refreshTokens.findValidByTokenHash(hashInput),
            HttpError.chain(HttpError.Auth, { reason: 'Token lookup failed' }),
        );
        const token = yield* Option.match(tokenOpt, {
            onNone: () => Effect.fail(new HttpError.Auth({ reason: 'Invalid refresh token' })),
            onSome: Effect.succeed,
        });
        // Check MFA status: mfaVerifiedAt = null means pending, new Date() means implicitly verified
        const mfaOpt = yield* pipe(repos.mfaSecrets.findByUserId(token.userId), HttpError.chain(HttpError.Auth, { reason: 'MFA status check failed' }));
        const mfaVerifiedAt = deriveMfaVerifiedAt(mfaOpt);
        const { mfaPending, refreshToken, sessionExpiresAt, sessionToken } = yield* pipe(
            rotateTokens(repos, token.userId, { ctx, mfaVerifiedAt, revokeTokenId: token.id }),
            HttpError.chain(HttpError.Auth, { reason: 'Token generation failed' }),
        );
        yield* Audit.log(repos.audit, {
            actorId: token.userId,
            appId,
            changes: null,
            entityId: token.userId,
            entityType: 'refreshtoken',
            ipAddress: ctx.ipAddress,
            operation: 'token_refresh',
            userAgent: ctx.userAgent,
        });
        return yield* pipe(
            buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken, mfaPending),
            HttpError.chain(HttpError.Auth, { reason: 'Response build failed' }),
        );
    }),
);
const handleLogout = Effect.fn('auth.logout')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const ctx = yield* getClientInfo;
        const appId = yield* getAppId;
        yield* pipe(
            repos.sessions.revoke(session.sessionId),
            HttpError.chain(HttpError.Internal, { message: 'Session revocation failed' }),
        );
        yield* pipe(
            repos.refreshTokens.revokeAllByUserId(session.userId),
            HttpError.chain(HttpError.Internal, { message: 'Token revocation failed' }),
        );
        yield* Audit.log(repos.audit, {
            actorId: session.userId,
            appId,
            changes: { sessionId: session.sessionId },
            entityId: session.userId,
            entityType: 'session',
            ipAddress: ctx.ipAddress,
            operation: 'logout',
            userAgent: ctx.userAgent,
        });
        return yield* pipe(
            buildLogoutResponse(),
            HttpError.chain(HttpError.Internal, { message: 'Response build failed' }),
        );
    }),
);
const handleMe = Effect.fn('auth.me')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const userOpt = yield* pipe(
            repos.users.findById(session.userId),
            HttpError.chain(HttpError.Internal, { message: 'User lookup failed' }),
        );
        return yield* Option.match(userOpt, {
            onNone: () => Effect.fail(new HttpError.NotFound({ id: session.userId, resource: 'user' })),
            onSome: (user) => Effect.succeed(toUserResponse(user)),
        });
    }),
);
const handleListApiKeys = Effect.fn('auth.apiKeys.list')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const keys = yield* pipe(
            repos.apiKeys.findAllByUserId(session.userId),
            HttpError.chain(HttpError.Internal, { message: 'API key list failed' }),
        );
        return { data: keys.map(toApiKeyResponse) };
    }),
);
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
    (repos: DatabaseServiceShape, input: { key: string; name: string; provider: AiProvider }) =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            const keyHash = yield* pipe(
                Crypto.Token.hash(input.key),
                HttpError.chain(HttpError.Internal, { message: 'Key hashing failed' }),
            );
            const encrypted = yield* pipe(
                Crypto.Key.encrypt(input.key),
                HttpError.chain(HttpError.Internal, { message: 'Key encryption failed' }),
            );
            const keyEncrypted = yield* pipe(
                S.encode(EncryptedKey.fromBytes)(encrypted),
                Effect.map((bytes) => Buffer.from(bytes)),
                HttpError.chain(HttpError.Internal, { message: 'Key encoding failed' }),
            );
            const apiKey = yield* pipe(
                repos.apiKeys.insert({
                    expiresAt: null,
                    keyEncrypted,
                    keyHash,
                    lastUsedAt: null,
                    name: input.name,
                    provider: input.provider,
                    userId: session.userId,
                }),
                HttpError.chain(HttpError.Internal, { message: 'API key insert failed' }),
            );
            return toApiKeyResponse(apiKey);
        }),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repos: DatabaseServiceShape, id: ApiKeyId) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const appId = yield* getAppId;
        const key = yield* pipe(
            repos.apiKeys.findByIdAndUserId(id, session.userId),
            HttpError.chain(HttpError.Internal, { message: 'API key lookup failed' }),
            Effect.flatMap(
                Option.match({
                    onNone: () => Effect.fail(new HttpError.NotFound({ id, resource: 'apikey' })),
                    onSome: Effect.succeed,
                }),
            ),
        );
        yield* pipe(
            repos.apiKeys.delete(id),
            HttpError.chain(HttpError.Internal, { message: 'API key deletion failed' }),
        );
        yield* Audit.log(repos.audit, {
            actorId: session.userId,
            appId,
            changes: { name: key.name, provider: key.provider },
            entityId: id,
            entityType: 'apikey',
            operation: 'revoke',
        });
        return { success: true } as const;
    }),
);

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(ParametricApi, 'auth', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        const oauth = yield* Middleware.OAuth;
        return handlers
            .handleRaw('oauthStart', ({ path: { provider } }) => handleOAuthStart(oauth, provider).pipe(RateLimit.middleware.auth))
            .handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) => handleOAuthCallback(oauth, repos, provider, code, state).pipe(RateLimit.middleware.auth))
            .handleRaw('refresh', () => handleRefresh(repos).pipe(RateLimit.middleware.auth))
            .handleRaw('logout', () => handleLogout(repos))
            .handle('me', () => handleMe(repos))
            .handle('listApiKeys', () => handleListApiKeys(repos))
            .handle('createApiKey', ({ payload }) => handleCreateApiKey(repos, payload))
            .handle('deleteApiKey', ({ path: { id } }) => handleDeleteApiKey(repos, id));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
