/**
 * Auth group handlers for OAuth flows and session management.
 */
import { makeRepositories, type Repositories } from '@parametric-portal/database/repositories';
import { HttpApiBuilder } from '@parametric-portal/server/api';
import { createTokenPair, hashString } from '@parametric-portal/server/crypto';
import { InternalError, NotFoundError, OAuthError, UnauthorizedError } from '@parametric-portal/server/errors';
import { OAuthService, SessionContext } from '@parametric-portal/server/middleware';
import { type OAuthProvider, SCHEMA_TUNING } from '@parametric-portal/types/database';
import type { Uuidv7 } from '@parametric-portal/types/types';
import { type Context, DateTime, Duration, Effect, Option, pipe } from 'effect';

import { AppApi } from '../api.ts';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const computeExpiry = (duration: Duration.Duration) => new Date(Date.now() + Duration.toMillis(duration));
const toSessionResponse = (sessionToken: Uuidv7, expiresAt: Date, refreshToken: Uuidv7) => ({
    accessToken: sessionToken,
    expiresAt: DateTime.unsafeFromDate(expiresAt),
    refreshToken: refreshToken,
});

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
            const sessionExpiresAt = computeExpiry(SCHEMA_TUNING.durations.session);
            const refreshExpiresAt = computeExpiry(SCHEMA_TUNING.durations.refreshToken);

            yield* repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId: user.id });
            yield* repos.refreshTokens.insert({
                expiresAt: refreshExpiresAt,
                tokenHash: refreshHash,
                userId: user.id,
            });
            return toSessionResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchAll((cause) =>
            Effect.fail(new OAuthError({ provider, reason: `Database error: ${String(cause)}` })),
        ),
    );

const handleRefresh = (repos: Repositories, refreshTokenInput: string) =>
    pipe(
        Effect.gen(function* () {
            const hashInput = yield* hashString(refreshTokenInput);
            const tokenOpt = yield* repos.refreshTokens.findValidByTokenHash(hashInput);
            const token = yield* Option.match(tokenOpt, {
                onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid refresh token' })),
                onSome: Effect.succeed,
            });

            yield* repos.refreshTokens.revoke(token.id);

            const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createAuthTokenPairs();
            const sessionExpiresAt = computeExpiry(SCHEMA_TUNING.durations.session);
            const refreshExpiresAt = computeExpiry(SCHEMA_TUNING.durations.refreshToken);

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
            return toSessionResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchTags({
            HashingError: () => Effect.fail(new UnauthorizedError({ reason: 'Token hashing failed' })),
            ParseError: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid token format' })),
            SqlError: () => Effect.fail(new UnauthorizedError({ reason: 'Database error' })),
        }),
    );

const handleLogout = (repos: Repositories) =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            yield* repos.sessions.delete(session.sessionId);
            return { success: true };
        }),
        Effect.catchAll((cause) =>
            Effect.fail(new InternalError({ cause: `Session deletion failed: ${String(cause)}` })),
        ),
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

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(AppApi, 'auth', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* makeRepositories;
        const oauth = yield* OAuthService;
        return handlers
            .handle('oauthStart', ({ path: { provider } }) => handleOAuthStart(oauth, provider))
            .handle('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) =>
                handleOAuthCallback(oauth, repos, provider, code, state),
            )
            .handle('refresh', ({ payload: { refreshToken } }) => handleRefresh(repos, refreshToken))
            .handle('logout', () => handleLogout(repos))
            .handle('me', () => handleMe(repos));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
