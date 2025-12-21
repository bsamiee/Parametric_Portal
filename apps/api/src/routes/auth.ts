/**
 * Auth group handlers for OAuth flows and session management.
 */
import { makeRepositories } from '@parametric-portal/database/repositories';
import { type OAuthProvider, SCHEMA_TUNING } from '@parametric-portal/database/schema';
import { HttpApiBuilder } from '@parametric-portal/server/api';
import { OAuthError, UnauthorizedError } from '@parametric-portal/server/errors';
import { hashToken, OAuthService, SessionContext } from '@parametric-portal/server/middleware';
import { DateTime, Duration, Effect, Option, pipe } from 'effect';

import { AppApi } from '../api.ts';

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createSessionTokens = () =>
    Effect.gen(function* () {
        const sessionToken = crypto.randomUUID();
        const refreshToken = crypto.randomUUID();
        const sessionHash = yield* hashToken(sessionToken);
        const refreshHash = yield* hashToken(refreshToken);
        return { refreshHash, refreshToken, sessionHash, sessionToken };
    });
const computeExpiry = (duration: Duration.Duration) => new Date(Date.now() + Duration.toMillis(duration));
const toSessionResponse = (sessionToken: string, expiresAt: Date, refreshToken: string) => ({
    accessToken: sessionToken,
    expiresAt: DateTime.unsafeFromDate(expiresAt),
    refreshToken,
});

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleOAuthStart = (provider: OAuthProvider) =>
    Effect.gen(function* () {
        const oauth = yield* OAuthService;
        const state = crypto.randomUUID();
        const url = yield* oauth.createAuthorizationUrl(provider, state);
        return { url: url.toString() };
    });

const handleOAuthCallback = (provider: OAuthProvider, code: string, state: string) =>
    pipe(
        Effect.gen(function* () {
            const oauth = yield* OAuthService;
            const repos = yield* makeRepositories;
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

            const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createSessionTokens();
            const sessionExpiresAt = computeExpiry(SCHEMA_TUNING.durations.session);
            const refreshExpiresAt = computeExpiry(SCHEMA_TUNING.durations.refreshToken);

            yield* repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId: user.id });
            yield* repos.refreshTokens.insert({ expiresAt: refreshExpiresAt, tokenHash: refreshHash, userId: user.id });
            return toSessionResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchAll((cause) =>
            Effect.fail(new OAuthError({ provider, reason: `Database error: ${String(cause)}` })),
        ),
    );

const handleRefresh = (refreshTokenInput: string) =>
    pipe(
        Effect.gen(function* () {
            const repos = yield* makeRepositories;
            const hash = yield* hashToken(refreshTokenInput);
            const tokenOpt = yield* repos.refreshTokens.findValidByTokenHash(hash);
            const token = yield* Option.match(tokenOpt, {
                onNone: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid refresh token' })),
                onSome: Effect.succeed,
            });

            yield* repos.refreshTokens.revoke(token.id);

            const { refreshHash, refreshToken, sessionHash, sessionToken } = yield* createSessionTokens();
            const sessionExpiresAt = computeExpiry(SCHEMA_TUNING.durations.session);
            const refreshExpiresAt = computeExpiry(SCHEMA_TUNING.durations.refreshToken);

            yield* repos.sessions.insert({ expiresAt: sessionExpiresAt, tokenHash: sessionHash, userId: token.userId });
            yield* repos.refreshTokens.insert({
                expiresAt: refreshExpiresAt,
                tokenHash: refreshHash,
                userId: token.userId,
            });
            return toSessionResponse(sessionToken, sessionExpiresAt, refreshToken);
        }),
        Effect.catchTags({
            ParseError: () => Effect.fail(new UnauthorizedError({ reason: 'Invalid token format' })),
            SqlError: () => Effect.fail(new UnauthorizedError({ reason: 'Database error' })),
        }),
    );

const handleLogout = () =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const repos = yield* makeRepositories;
            yield* repos.sessions.delete(session.sessionId);
            return { success: true };
        }),
        Effect.orDie,
    );

const handleMe = () =>
    pipe(
        Effect.gen(function* () {
            const session = yield* SessionContext;
            const repos = yield* makeRepositories;
            const userOpt = yield* repos.users.findById(session.userId);

            return yield* Option.match(userOpt, {
                onNone: () => Effect.die(new Error('User not found')),
                onSome: (user) => Effect.succeed({ email: user.email, id: user.id }),
            });
        }),
        Effect.orDie,
    );

// --- [LAYER] -----------------------------------------------------------------

const AuthLive = HttpApiBuilder.group(AppApi, 'auth', (handlers) =>
    handlers
        .handle('oauthStart', ({ path: { provider } }) => handleOAuthStart(provider))
        .handle('oauthCallback', ({ path: { provider }, urlParams: { code, state } }) =>
            handleOAuthCallback(provider, code, state),
        )
        .handle('refresh', ({ payload: { refreshToken } }) => handleRefresh(refreshToken))
        .handle('logout', () => handleLogout())
        .handle('me', () => handleMe()),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AuthLive };
