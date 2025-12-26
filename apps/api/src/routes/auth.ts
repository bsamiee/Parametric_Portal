/**
 * Auth group handlers for OAuth flows and session management.
 * Uses HttpOnly cookies for refresh tokens (XSS-safe) and JSON for access tokens.
 */
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { makeRepositories, type Repositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder } from '@parametric-portal/server/api';
import { createTokenPair, encryptApiKey, hashString } from '@parametric-portal/server/crypto';
import { InternalError, NotFoundError, OAuthError, UnauthorizedError } from '@parametric-portal/server/errors';
import { OAuthService, SessionContext } from '@parametric-portal/server/middleware';
import {
    type AiProvider,
    type ApiKeyId,
    DATABASE_TUNING,
    database,
    type OAuthProvider,
} from '@parametric-portal/types/database';
import { types, type Uuidv7 } from '@parametric-portal/types/types';
import { type Context, DateTime, Duration, Effect, Option, pipe, Schema as S } from 'effect';
import { AppApi } from '../api.ts';

const db = database();
const typesApi = types();

// --- [TYPES] -----------------------------------------------------------------

type OAuthServiceType = Context.Tag.Service<typeof OAuthService>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cookie: {
        maxAge: Duration.toSeconds(DATABASE_TUNING.durations.refreshToken),
        name: 'refreshToken',
        path: '/api/auth',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

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
        const session = yield* createTokenPair();
        const refresh = yield* createTokenPair();
        return {
            refreshHash: refresh.hash,
            refreshToken: refresh.token,
            sessionHash: session.hash,
            sessionToken: session.token,
        };
    });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleOAuthStart = (oauth: OAuthServiceType, provider: OAuthProvider) =>
    Effect.gen(function* () {
        const state = crypto.randomUUID();
        const url = yield* oauth.createAuthorizationUrl(provider, state);
        return { url: url.toString() };
    });
const handleOAuthCallback = (
    oauth: OAuthServiceType,
    repos: Repositories,
    provider: OAuthProvider,
    code: string,
    state: string,
) =>
    Effect.gen(function* () {
        const tokens = yield* oauth.validateCallback(provider, code, state);
        const userInfo = yield* oauth.getUserInfo(provider, tokens.accessToken);
        const emailRaw = yield* Option.match(userInfo.email, {
            onNone: () => Effect.fail(new OAuthError({ provider, reason: 'Email not provided' })),
            onSome: Effect.succeed,
        });
        const email = yield* pipe(
            S.decodeUnknown(typesApi.schemas.Email)(emailRaw),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Invalid email format from provider' })),
        );
        const existingUserOpt = yield* pipe(
            repos.users.findByEmail(email),
            Effect.mapError(() => new OAuthError({ provider, reason: 'User lookup failed' })),
        );
        const user = yield* Option.match(existingUserOpt, {
            onNone: () =>
                pipe(
                    repos.users.insert({ email }),
                    Effect.mapError(() => new OAuthError({ provider, reason: 'User insert failed' })),
                ),
            onSome: Effect.succeed,
        });
        const userId = yield* pipe(
            S.decodeUnknown(db.schemas.ids.UserId)(user.id),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Invalid user ID format' })),
        );
        yield* pipe(
            repos.oauthAccounts.upsert({
                accessToken: tokens.accessToken,
                expiresAt: Option.getOrNull(tokens.expiresAt),
                provider,
                providerAccountId: userInfo.providerAccountId,
                refreshToken: Option.getOrNull(tokens.refreshToken),
                userId,
            }),
            Effect.mapError(() => new OAuthError({ provider, reason: 'OAuth account upsert failed' })),
        );
        const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* pipe(
            createAuthTokenPairs(),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Token generation failed' })),
        );
        const sessionExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.session);
        const refreshExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.refreshToken);
        yield* pipe(
            repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId }),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Session insert failed' })),
        );
        yield* pipe(
            repos.refreshTokens.insert({ expiresAt: refreshExpiresAt, tokenHash: refreshHash, userId }),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Refresh token insert failed' })),
        );
        return yield* pipe(
            buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken),
            Effect.mapError(() => new OAuthError({ provider, reason: 'Response build failed' })),
        );
    });
const handleRefresh = (repos: Repositories) =>
    Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const refreshTokenInput = yield* pipe(
            Option.fromNullable(request.cookies[B.cookie.name]),
            Option.match({
                onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Missing refresh token cookie' })),
                onSome: Effect.succeed,
            }),
        );
        const hashInput = yield* pipe(
            hashString(refreshTokenInput),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Token hashing failed' })),
        );
        const tokenOpt = yield* pipe(
            repos.refreshTokens.findValidByTokenHash(hashInput),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Token lookup failed' })),
        );
        const token = yield* Option.match(tokenOpt, {
            onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid refresh token' })),
            onSome: Effect.succeed,
        });
        const userId = yield* pipe(
            S.decodeUnknown(db.schemas.ids.UserId)(token.userId),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Invalid user ID format' })),
        );
        const tokenId = yield* pipe(
            S.decodeUnknown(db.schemas.ids.RefreshTokenId)(token.id),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Invalid token ID format' })),
        );
        const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* pipe(
            createAuthTokenPairs(),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Token generation failed' })),
        );
        const sessionExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.session);
        const refreshExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.refreshToken);
        yield* pipe(
            repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId }),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Session insert failed' })),
        );
        yield* pipe(
            repos.refreshTokens.insert({ expiresAt: refreshExpiresAt, tokenHash: refreshHash, userId }),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Refresh token insert failed' })),
        );
        yield* pipe(
            repos.refreshTokens.revoke(tokenId),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Token revocation failed' })),
        );
        return yield* pipe(
            buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken),
            Effect.mapError(() => new UnauthorizedError({ reason: 'Response build failed' })),
        );
    });
const handleLogout = (repos: Repositories) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        yield* pipe(
            repos.sessions.revoke(session.sessionId),
            Effect.mapError(() => new InternalError({ cause: 'Session revocation failed' })),
        );
        yield* pipe(
            repos.refreshTokens.revokeAllByUserId(session.userId),
            Effect.mapError(() => new InternalError({ cause: 'Refresh token revocation failed' })),
        );
        return yield* pipe(
            buildLogoutResponse(),
            Effect.mapError(() => new InternalError({ cause: 'Response build failed' })),
        );
    });
const handleMe = (repos: Repositories) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const userOpt = yield* pipe(
            repos.users.findById(session.userId),
            Effect.mapError(() => new InternalError({ cause: 'User lookup failed' })),
        );
        return yield* Option.match(userOpt, {
            onNone: () => Effect.fail(new NotFoundError({ id: session.userId, resource: 'user' })),
            onSome: (user) =>
                pipe(
                    S.decodeUnknown(db.schemas.ids.UserId)(user.id),
                    Effect.map((id) => ({ email: user.email, id })),
                    Effect.mapError(() => new InternalError({ cause: 'Invalid user ID format' })),
                ),
        });
    });
const handleListApiKeys = (repos: Repositories) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const keys = yield* pipe(
            repos.apiKeys.findAllByUserId(session.userId),
            Effect.mapError(() => new InternalError({ cause: 'API key list failed' })),
        );
        return { data: keys };
    });
const handleCreateApiKey = (repos: Repositories, input: { key: string; name: string; provider: AiProvider }) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const keyHash = yield* pipe(
            hashString(input.key),
            Effect.mapError(() => new InternalError({ cause: 'API key hashing failed' })),
        );
        const encrypted = yield* pipe(
            encryptApiKey(input.key),
            Effect.mapError(() => new InternalError({ cause: 'API key encryption failed' })),
        );
        const keyEncrypted = new Uint8Array([...encrypted.iv, ...encrypted.ciphertext]);
        const apiKey = yield* pipe(
            repos.apiKeys.insert({
                expiresAt: null,
                keyEncrypted,
                keyHash,
                name: input.name,
                provider: input.provider,
                userId: session.userId,
            }),
            Effect.mapError(() => new InternalError({ cause: 'API key insert failed' })),
        );
        return {
            createdAt: DateTime.toDateUtc(apiKey.createdAt),
            id: apiKey.id,
            lastUsedAt: Option.map(apiKey.lastUsedAt, DateTime.toDateUtc),
            name: apiKey.name,
            provider: apiKey.provider,
        };
    });
const handleDeleteApiKey = (repos: Repositories, id: ApiKeyId) =>
    Effect.gen(function* () {
        const session = yield* SessionContext;
        const userKeys = yield* pipe(
            repos.apiKeys.findAllByUserId(session.userId),
            Effect.mapError(() => new InternalError({ cause: 'API key list failed' })),
        );
        const keyBelongsToUser = userKeys.some((k) => k.id === id);
        yield* keyBelongsToUser
            ? pipe(
                  repos.apiKeys.delete(id),
                  Effect.mapError(() => new InternalError({ cause: 'API key deletion failed' })),
              )
            : Effect.fail(new NotFoundError({ id, resource: 'apikey' }));
        return { success: true };
    });

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(AppApi, 'auth', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* makeRepositories;
        const oauth = yield* OAuthService;
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
