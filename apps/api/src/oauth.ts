/**
 * OAuthService implementation using Arctic OAuth library.
 * Implements the OAuthService interface from @parametric-portal/server/middleware.
 */

import { OAuthError } from '@parametric-portal/server/errors';
import { OAuthService, type OAuthTokens, type OAuthUserInfo } from '@parametric-portal/server/middleware';
import type { OAuthProvider } from '@parametric-portal/types/database';
import { GitHub, Google, MicrosoftEntraId } from 'arctic';
import { Config, Effect, Layer, Option, Redacted } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ProviderConfig = {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly redirectUri: string;
    readonly tenantId?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    scopes: {
        github: ['user:email'],
        google: ['openid', 'profile', 'email'],
        microsoft: ['openid', 'profile', 'email'],
    },
    userInfoUrls: {
        github: 'https://api.github.com/user',
        google: 'https://openidconnect.googleapis.com/v1/userinfo',
        microsoft: 'https://graph.microsoft.com/oidc/userinfo',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const fetchUserInfo = (provider: OAuthProvider, accessToken: string): Effect.Effect<OAuthUserInfo, OAuthError> =>
    Effect.gen(function* () {
        const url = B.userInfoUrls[provider];
        const response = yield* Effect.tryPromise({
            catch: (e) => new OAuthError({ provider, reason: `Failed to fetch user info: ${String(e)}` }),
            try: () =>
                fetch(url, {
                    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'ParametricPortal/1.0' },
                }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        });

        const data = response as Record<string, unknown>;
        return {
            avatarUrl: Option.fromNullable((data['avatar_url'] ?? data['picture']) as string | undefined),
            email: Option.fromNullable(data['email'] as string | undefined),
            name: Option.fromNullable(data['name'] as string | undefined),
            providerAccountId: String(data['id'] ?? data['sub']),
        };
    });

// --- [LAYER] -----------------------------------------------------------------

const OAuthServiceLive = Layer.effect(
    OAuthService,
    Effect.gen(function* () {
        const baseUrl = yield* Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000'));
        const githubClientId = yield* Config.string('OAUTH_GITHUB_CLIENT_ID').pipe(Config.withDefault(''));
        const githubClientSecret = yield* Config.redacted('OAUTH_GITHUB_CLIENT_SECRET').pipe(
            Config.withDefault(Redacted.make('')),
        );
        const googleClientId = yield* Config.string('OAUTH_GOOGLE_CLIENT_ID').pipe(Config.withDefault(''));
        const googleClientSecret = yield* Config.redacted('OAUTH_GOOGLE_CLIENT_SECRET').pipe(
            Config.withDefault(Redacted.make('')),
        );
        const microsoftClientId = yield* Config.string('OAUTH_MICROSOFT_CLIENT_ID').pipe(Config.withDefault(''));
        const microsoftClientSecret = yield* Config.redacted('OAUTH_MICROSOFT_CLIENT_SECRET').pipe(
            Config.withDefault(Redacted.make('')),
        );
        const microsoftTenantId = yield* Config.string('OAUTH_MICROSOFT_TENANT_ID').pipe(Config.withDefault('common'));
        const githubConfig: ProviderConfig = {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            redirectUri: `${baseUrl}/api/auth/oauth/github/callback`,
        };
        const googleConfig: ProviderConfig = {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            redirectUri: `${baseUrl}/api/auth/oauth/google/callback`,
        };
        const microsoftConfig: ProviderConfig = {
            clientId: microsoftClientId,
            clientSecret: microsoftClientSecret,
            redirectUri: `${baseUrl}/api/auth/oauth/microsoft/callback`,
            tenantId: microsoftTenantId,
        };
        const github = new GitHub(
            githubConfig.clientId,
            Redacted.value(githubConfig.clientSecret),
            githubConfig.redirectUri,
        );
        const google = new Google(
            googleConfig.clientId,
            Redacted.value(googleConfig.clientSecret),
            googleConfig.redirectUri,
        );
        const microsoft = new MicrosoftEntraId(
            microsoftConfig.tenantId ?? 'common',
            microsoftConfig.clientId,
            Redacted.value(microsoftConfig.clientSecret),
            microsoftConfig.redirectUri,
        );
        const codeVerifiers = new Map<string, string>();
        const createAuthUrl = {
            github: (state: string, scopes: ReadonlyArray<string>) => github.createAuthorizationURL(state, [...scopes]),
            google: (state: string, scopes: ReadonlyArray<string>) => {
                const codeVerifier = crypto.randomUUID();
                codeVerifiers.set(state, codeVerifier);
                return google.createAuthorizationURL(state, codeVerifier, [...scopes]);
            },
            microsoft: (state: string, scopes: ReadonlyArray<string>) => {
                const codeVerifier = crypto.randomUUID();
                codeVerifiers.set(state, codeVerifier);
                return microsoft.createAuthorizationURL(state, codeVerifier, [...scopes]);
            },
        } as const satisfies Record<OAuthProvider, (state: string, scopes: ReadonlyArray<string>) => URL>;
        const validateToken = {
            github: (code: string, _state: string) => github.validateAuthorizationCode(code),
            google: (code: string, state: string) => {
                const verifier = codeVerifiers.get(state) ?? '';
                codeVerifiers.delete(state);
                return google.validateAuthorizationCode(code, verifier);
            },
            microsoft: (code: string, state: string) => {
                const verifier = codeVerifiers.get(state) ?? '';
                codeVerifiers.delete(state);
                return microsoft.validateAuthorizationCode(code, verifier);
            },
        } as const satisfies Record<OAuthProvider, (code: string, state: string) => Promise<unknown>>;

        return OAuthService.of({
            createAuthorizationUrl: (provider, state) =>
                Effect.sync(() => createAuthUrl[provider](state, B.scopes[provider])),
            getUserInfo: fetchUserInfo,
            validateCallback: (provider, code, state) =>
                Effect.gen(function* () {
                    const tokens = yield* Effect.tryPromise({
                        catch: (e) => new OAuthError({ provider, reason: `Token exchange failed: ${String(e)}` }),
                        try: () => validateToken[provider](code, state),
                    });

                    const t = tokens as {
                        accessToken: () => string;
                        accessTokenExpiresAt?: () => Date;
                        refreshToken?: () => string;
                    };
                    return {
                        accessToken: t.accessToken(),
                        expiresAt: Option.fromNullable(t.accessTokenExpiresAt?.()),
                        refreshToken: Option.fromNullable(t.refreshToken?.()),
                        scope: Option.none(),
                    } satisfies OAuthTokens;
                }),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { OAuthServiceLive };
