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

import type { Uuidv7 } from '@parametric-portal/types/types';
import { type Context, DateTime, Duration, Effect, Option, pipe } from 'effect';
import { AppApi } from '../api.ts';

const db = database();

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

type OAuthServiceType = Context.Tag.Service<typeof OAuthService>;

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
    pipe(
        Effect.gen(function* () {
            const tokens = yield* oauth.validateCallback(provider, code, state);
            const userInfo = yield* oauth.getUserInfo(provider, tokens.accessToken);
            const email = yield* Option.match(userInfo.email, {
                onNone: () => Effect.fail(new OAuthError({ provider, reason: 'Email not provided' })),
                onSome: Effect.succeed,
            });
            const existingUser = yield* repos.users.findByEmail(email);
            const user = yield* Option.match(existingUser, {
                onNone: () =>
                    pipe(
                        repos.users.insert({ email }),
                        Effect.mapError(() => new OAuthError({ provider, reason: 'User insert failed' })),
                    ),
                onSome: Effect.succeed,
            });
            yield* repos.oauthAccounts.upsert({
                accessToken: tokens.accessToken,
                expiresAt: Option.getOrNull(tokens.expiresAt),
                provider,
                providerAccountId: userInfo.providerAccountId,
                refreshToken: Option.getOrNull(tokens.refreshToken),
                userId: user.id,
            });
            const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createAuthTokenPairs();
            const sessionExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.session);
            const refreshExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.refreshToken);
            yield* repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId: user.id });
            yield* repos.refreshTokens.insert({
                expiresAt: refreshExpiresAt,
                tokenHash: refreshHash,
                userId: user.id,
            });
            return yield* buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchTags({
            CookieError: () => Effect.fail(new OAuthError({ provider, reason: 'Cookie setting failed' })),
            HashingError: () => Effect.fail(new OAuthError({ provider, reason: 'Token hashing failed' })),
            HttpBodyError: () => Effect.fail(new OAuthError({ provider, reason: 'Response body error' })),
            OAuthError: (err) => Effect.fail(err),
            ParseError: () => Effect.fail(new OAuthError({ provider, reason: 'Data parse failed' })),
            SqlError: () => Effect.fail(new OAuthError({ provider, reason: 'Database error' })),
        }),
    );

const handleRefresh = (repos: Repositories) =>
    pipe(
        Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const refreshTokenInput = yield* pipe(
                Option.fromNullable(request.cookies[B.cookie.name]),
                Option.match({
                    onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Missing refresh token cookie' })),
                    onSome: Effect.succeed,
                }),
            );
            const hashInput = yield* hashString(refreshTokenInput);
            const tokenOpt = yield* repos.refreshTokens.findValidByTokenHash(hashInput);
            const token = yield* Option.match(tokenOpt, {
                onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid refresh token' })),
                onSome: Effect.succeed,
            });
            const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createAuthTokenPairs();
            const sessionExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.session);
            const refreshExpiresAt = db.expiry.computeFrom(DATABASE_TUNING.durations.refreshToken);
            yield* repos.sessions.insert({
                expiresAt: sessionExpiresAt,
                tokenHash: sessionHash,
                userId: token.userId,
            });
            yield* repos.refreshTokens.insert({
                expiresAt: refreshExpiresAt,
                tokenHash: refreshHash,
                userId: token.userId,
            });
            yield* repos.refreshTokens.revoke(token.id);
            return yield* buildAuthResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchTags({
            CookieError: () => Effect.fail(new UnauthorizedError({ reason: 'Cookie setting failed' })),
            HashingError: () => Effect.fail(new UnauthorizedError({ reason: 'Token hashing failed' })),
            HttpBodyError: () => Effect.fail(new UnauthorizedError({ reason: 'Response body error' })),
            ParseError: () => Effect.fail(new UnauthorizedError({ reason: 'Token parse failed' })),
            SqlError: () => Effect.fail(new UnauthorizedError({ reason: 'Token refresh failed' })),
            UnauthorizedError: (err) => Effect.fail(err),
        }),
    );

const handleLogout = (repos: Repositories) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            yield* repos.sessions.revoke(session.sessionId);
            yield* repos.refreshTokens.revokeAllByUserId(session.userId);
            return yield* buildLogoutResponse();
        }),
        Effect.catchTags({
            CookieError: () => Effect.fail(new InternalError({ cause: 'Cookie clearing failed' })),
            HttpBodyError: () => Effect.fail(new InternalError({ cause: 'Response body error' })),
            ParseError: () => Effect.fail(new InternalError({ cause: 'Session context parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'Session revocation failed' })),
        }),
    );

const handleMe = (repos: Repositories) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const userOpt = yield* repos.users.findById(session.userId);
            return yield* Option.match(userOpt, {
                onNone: () => Effect.fail(new NotFoundError({ id: session.userId, resource: 'user' })),
                onSome: (user) => Effect.succeed({ email: user.email, id: user.id }),
            });
        }),
        Effect.catchTags({
            NotFoundError: (err) => Effect.fail(err),
            ParseError: () => Effect.fail(new InternalError({ cause: 'User data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'User lookup failed' })),
        }),
    );

const handleListApiKeys = (repos: Repositories) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const keys = yield* repos.apiKeys.findAllByUserId(session.userId);
            return { data: keys };
        }),
        Effect.catchTags({
            ParseError: () => Effect.fail(new InternalError({ cause: 'API key data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'API key list failed' })),
        }),
    );

const handleCreateApiKey = (repos: Repositories, input: { key: string; name: string; provider: AiProvider }) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const keyHash = yield* hashString(input.key);
            const encrypted = yield* encryptApiKey(input.key);
            const keyEncrypted = new Uint8Array([...encrypted.iv, ...encrypted.ciphertext]);
            const apiKey = yield* repos.apiKeys.insert({
                expiresAt: null,
                keyEncrypted,
                keyHash,
                name: input.name,
                provider: input.provider,
                userId: session.userId,
            });
            return {
                createdAt: apiKey.createdAt,
                id: apiKey.id,
                lastUsedAt: apiKey.lastUsedAt,
                name: apiKey.name,
                provider: apiKey.provider,
            };
        }),
        Effect.catchTags({
            EncryptionError: () => Effect.fail(new InternalError({ cause: 'API key encryption failed' })),
            HashingError: () => Effect.fail(new InternalError({ cause: 'API key hashing failed' })),
            NoSuchElementException: () => Effect.fail(new InternalError({ cause: 'API key insert returned no row' })),
            ParseError: () => Effect.fail(new InternalError({ cause: 'API key data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'API key insert failed' })),
        }),
    );

const handleDeleteApiKey = (repos: Repositories, id: ApiKeyId) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const userKeys = yield* repos.apiKeys.findAllByUserId(session.userId);
            const keyBelongsToUser = userKeys.some((k) => k.id === id);
            yield* keyBelongsToUser
                ? repos.apiKeys.delete(id)
                : Effect.fail(new NotFoundError({ id, resource: 'apikey' }));
            return { success: true };
        }),
        Effect.catchTags({
            NotFoundError: (err) => Effect.fail(err),
            ParseError: () => Effect.fail(new InternalError({ cause: 'API key data parse failed' })),
            SqlError: () => Effect.fail(new InternalError({ cause: 'API key deletion failed' })),
        }),
    );

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
