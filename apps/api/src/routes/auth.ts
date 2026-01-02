/**
 * Auth group handlers for OAuth flows and session management.
 * Uses HttpOnly cookies for refresh tokens (XSS-safe) and JSON for access tokens.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { Crypto, EncryptedKey, TokenPair } from '@parametric-portal/server/crypto';
import { AuthError, InternalError, NotFound, OAuthError } from '@parametric-portal/server/domain-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import {
    AiProvider,
    ApiKeyId,
    OAuthProvider,
    RefreshTokenId,
    User,
    UserId,
} from '@parametric-portal/types/database';
import { DurationMs, Email, Timestamp, type Uuidv7 } from '@parametric-portal/types/types';
import { DateTime, Duration, Effect, Option, pipe, Schema as S } from 'effect';
import { ParametricApi } from '@parametric-portal/server/api';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cookie: {
        maxAge: Duration.toSeconds(Duration.days(30)),
        name: 'refreshToken',
        path: '/api/auth',
    },
    durations: {
        refreshToken: DurationMs.fromMillis(Duration.toMillis(Duration.days(30))),
        session: DurationMs.fromMillis(Duration.toMillis(Duration.days(7))),
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const internal = (msg: string) => new InternalError({ message: msg });
const authError = (reason: string) => new AuthError({ reason });
const buildAuthResponse = (accessToken: Uuidv7, expiresAt: Date, refreshToken: Uuidv7) =>
    pipe(
        HttpServerResponse.json({ accessToken, expiresAt: DateTime.unsafeFromDate(expiresAt) }),
        Effect.flatMap((response) =>
            HttpServerResponse.setCookie(response, B.cookie.name, refreshToken, {
                httpOnly: true,
                maxAge: `${B.cookie.maxAge} seconds`,
                path: B.cookie.path,
                sameSite: 'lax',
                secure: true,
            }),
        ),
    );
const buildLogoutResponse = () =>
    pipe(
        HttpServerResponse.json({ success: true }),
        Effect.flatMap((response) =>
            HttpServerResponse.setCookie(response, B.cookie.name, '', {
                httpOnly: true,
                maxAge: '0 seconds',
                path: B.cookie.path,
                sameSite: 'lax',
                secure: true,
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
const rotateTokens = (repos: DatabaseServiceShape, userId: typeof UserId.Type, revokeTokenId?: typeof RefreshTokenId.Type) =>
    Effect.gen(function* () {
        const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createAuthTokenPairs();
        const sessionExpiresAt = new Date(Timestamp.addDuration(Timestamp.nowSync(), B.durations.session));
        const refreshExpiresAt = new Date(Timestamp.addDuration(Timestamp.nowSync(), B.durations.refreshToken));
        yield* repos.withTransaction(
            Effect.gen(function* () {
                yield* repos.sessions.insertVoid({
                    createdAt: undefined,
                    expiresAt: DateTime.unsafeFromDate(sessionExpiresAt),
                    ipAddress: Option.none(),
                    lastActivityAt: undefined,
                    revokedAt: Option.none(),
                    tokenHash: sessionHash,
                    userAgent: Option.none(),
                    userId,
                });
                yield* repos.refreshTokens.insertVoid({
                    createdAt: undefined,
                    expiresAt: DateTime.unsafeFromDate(refreshExpiresAt),
                    revokedAt: Option.none(),
                    tokenHash: refreshHash,
                    userId,
                });
                yield* revokeTokenId !== undefined
                    ? repos.refreshTokens.revoke(revokeTokenId)
                    : Effect.void;
            }),
        );
        return { refreshToken, sessionExpiresAt, sessionToken };
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

type OAuthService = typeof Middleware.OAuth.Service;

const handleOAuthStart = Effect.fn('auth.oauth.start')((oauth: OAuthService, provider: typeof OAuthProvider.Type) =>
    Effect.gen(function* () {
        const url = yield* oauth.createAuthorizationUrl(provider);
        return { url: url.toString() };
    }).pipe(
        Effect.mapError(
            (e) =>
                new OAuthError({
                    provider: 'provider' in e ? e.provider : 'unknown',
                    reason: 'reason' in e ? e.reason : String(e),
                }),
        ),
    ),
);
const handleOAuthCallback = Effect.fn('auth.oauth.callback')(
    (oauth: OAuthService, repos: DatabaseServiceShape, provider: typeof OAuthProvider.Type, code: string, state: string) =>
        Effect.gen(function* () {
            const httpErr = (reason: string) => new OAuthError({ provider, reason });
            const result = yield* oauth.authenticate(provider, code, state);
            const emailRaw = yield* Option.match(result.email, {
                onNone: () => Effect.fail(httpErr('Email not provided by provider')),
                onSome: Effect.succeed,
            });
            const email = yield* pipe(
                S.decodeUnknown(Email.schema)(emailRaw),
                Effect.mapError(() => httpErr('Invalid email format from provider')),
            );
            const userId = yield* repos
                .withTransaction(
                    Effect.gen(function* () {
                        const existingUserOpt = yield* pipe(
                            repos.users.findByEmail(email),
                            Effect.mapError(() => httpErr('User lookup failed')),
                        );
                        const user = yield* Option.isSome(existingUserOpt)
                            ? Effect.succeed(existingUserOpt.value)
                            : pipe(
                                  repos.users.insert({
                                      createdAt: undefined,
                                      deletedAt: Option.none(),
                                      email,
                                      role: 'member',
                                  }),
                                  Effect.mapError(() => httpErr('User creation failed')),
                              );
                        const uid = user.id;
                        yield* pipe(
                            repos.oauthAccounts.upsert({
                                ...result.toNullableFields,
                                provider,
                                userId: uid,
                            }),
                            Effect.mapError(() => httpErr('OAuth account upsert failed')),
                        );
                        return uid;
                    }),
                )
                .pipe(Effect.mapError(() => internal('User creation transaction failed')));
            const { refreshToken, sessionExpiresAt, sessionToken } = yield* pipe(
                rotateTokens(repos, userId),
                Effect.mapError(() => httpErr('Token generation failed')),
            );
            return yield* pipe(
                buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken),
                Effect.mapError(() => httpErr('Response build failed')),
            );
        }),
);
const handleRefresh = Effect.fn('auth.refresh')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const refreshTokenInput = yield* pipe(
            Option.fromNullable(request.cookies[B.cookie.name]),
            Option.match({
                onNone: () => Effect.fail(authError('Missing refresh token cookie')),
                onSome: Effect.succeed,
            }),
        );
        const hashInput = yield* pipe(
            Crypto.Token.hash(refreshTokenInput),
            Effect.mapError(() => authError('Token hashing failed')),
        );
        const tokenOpt = yield* pipe(
            repos.refreshTokens.findValidByTokenHash(hashInput),
            Effect.mapError(() => authError('Token lookup failed')),
        );
        const token = yield* Option.match(tokenOpt, {
            onNone: () => Effect.fail(authError('Invalid refresh token')),
            onSome: Effect.succeed,
        });
        const { refreshToken, sessionExpiresAt, sessionToken } = yield* pipe(
            rotateTokens(repos, token.userId, token.id),
            Effect.mapError(() => authError('Token generation failed')),
        );
        return yield* pipe(
            buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken),
            Effect.mapError(() => authError('Response build failed')),
        );
    }),
);
const handleLogout = Effect.fn('auth.logout')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        yield* pipe(
            repos.sessions.revoke(session.sessionId),
            Effect.mapError(() => internal('Session revocation failed')),
        );
        yield* pipe(
            repos.refreshTokens.revokeAllByUserId(session.userId),
            Effect.mapError(() => internal('Token revocation failed')),
        );
        return yield* pipe(
            buildLogoutResponse(),
            Effect.mapError(() => internal('Response build failed')),
        );
    }),
);
const handleMe = Effect.fn('auth.me')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const userOpt = yield* pipe(
            repos.users.findById(session.userId),
            Effect.mapError(() => internal('User lookup failed')),
        );
        return yield* Option.match(userOpt, {
            onNone: () => Effect.fail(new NotFound({ id: session.userId, resource: 'user' })),
            onSome: (user) => Effect.succeed(User.toResponse(user)),
        });
    }),
);
const handleListApiKeys = Effect.fn('auth.apiKeys.list')((repos: DatabaseServiceShape) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const keys = yield* pipe(
            repos.apiKeys.findAllByUserId(session.userId),
            Effect.mapError(() => new InternalError({ message: 'API key list failed' })),
        );
        return { data: keys.map((k) => k.response) };
    }),
);
const handleCreateApiKey = Effect.fn('auth.apiKeys.create')(
    (repos: DatabaseServiceShape, input: { key: string; name: string; provider: typeof AiProvider.Type }) =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            const keyHash = yield* pipe(
                Crypto.Token.hash(input.key),
                Effect.mapError(() => internal('Key hashing failed')),
            );
            const encrypted = yield* pipe(
                Crypto.Key.encrypt(input.key),
                Effect.mapError(() => internal('Key encryption failed')),
            );
            const keyEncrypted = yield* pipe(
                S.encode(EncryptedKey.fromBytes)(encrypted),
                Effect.mapError(() => internal('Key encoding failed')),
            );
            const apiKey = yield* pipe(
                repos.apiKeys.insert({
                    createdAt: undefined,
                    expiresAt: Option.none(),
                    keyEncrypted,
                    keyHash,
                    lastUsedAt: Option.none(),
                    name: input.name,
                    provider: input.provider,
                    userId: session.userId,
                }),
                Effect.mapError(() => internal('API key insert failed')),
            );
            return apiKey.response;
        }),
);
const handleDeleteApiKey = Effect.fn('auth.apiKeys.delete')((repos: DatabaseServiceShape, id: typeof ApiKeyId.Type) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const keyOpt = yield* pipe(
            repos.apiKeys.findByIdAndUserId({ id, userId: session.userId }),
            Effect.mapError(() => internal('API key lookup failed')),
        );
        yield* Option.match(keyOpt, {
            onNone: () => Effect.fail(new NotFound({ id, resource: 'apikey' })),
            onSome: () =>
                pipe(
                    repos.apiKeys.delete(id),
                    Effect.mapError(() => internal('API key deletion failed')),
                ),
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
            .handle('oauthStart', ({ path: { provider } }) => handleOAuthStart(oauth, provider))
            .handleRaw('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) =>
                handleOAuthCallback(oauth, repos, provider, code, state),
            )
            .handleRaw('refresh', () => handleRefresh(repos))
            .handleRaw('logout', () => handleLogout(repos))
            .handle('me', () => handleMe(repos))
            .handle('listApiKeys', () => handleListApiKeys(repos))
            .handle('createApiKey', ({ payload }) => handleCreateApiKey(repos, payload))
            .handle('deleteApiKey', ({ path: { id } }) => handleDeleteApiKey(repos, id));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
