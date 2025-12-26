/**
 * OAuthService implementation using Arctic OAuth library.
 * Implements the OAuthService interface from @parametric-portal/server/middleware.
 * PKCE code_verifier stored in encrypted state (RFC 7636 §7.2) - stateless, no in-memory Map.
 */

import { Crypto } from '@parametric-portal/server/crypto';
import { OAuthError } from '@parametric-portal/server/errors';
import { OAuthService } from '@parametric-portal/server/middleware';
import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from '@parametric-portal/types/database';
import { GitHub, Google, generateCodeVerifier, MicrosoftEntraId } from 'arctic';
import { Config, Effect, Layer, Option, pipe, Redacted, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';

// --- [TYPES] -----------------------------------------------------------------

type GitHubUserInfo = S.Schema.Type<typeof GitHubUserInfoSchema>;
type OIDCUserInfo = S.Schema.Type<typeof OIDCUserInfoSchema>;
/** Arctic-library-specific provider config (internal to OAuthServiceLive) */
type ArcticProviderConfig = {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted<string>;
    readonly redirectUri: string;
    readonly tenantId?: string;
};

// --- [SCHEMA] ----------------------------------------------------------------

const GitHubUserInfoSchema = S.Struct({
    // biome-ignore lint/style/useNamingConvention: Matches GitHub API response shape
    avatar_url: S.optional(S.String),
    email: S.optional(S.NullOr(S.String)),
    id: S.Number,
    name: S.optional(S.NullOr(S.String)),
});
const OIDCUserInfoSchema = S.Struct({
    email: S.optional(S.String),
    name: S.optional(S.String),
    picture: S.optional(S.String),
    sub: S.String,
});
/** Arctic library returns token objects with method accessors, not properties */
const ArcticTokenMethodsSchema = S.Struct({
    accessToken: S.Unknown,
    accessTokenExpiresAt: S.optional(S.Unknown),
    refreshToken: S.optional(S.Unknown),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    pkce: {
        expiryMs: 600_000, // 10 minutes TTL for PKCE state
    },
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

// --- [PKCE_CRYPTO] -----------------------------------------------------------

/** Encrypt PKCE state: {state, verifier, exp} → base64url string (RFC 7636 §7.2) */
const encryptPkceState = (state: string, verifier: string): Effect.Effect<string, OAuthError> =>
    pipe(
        Crypto.encrypt(JSON.stringify({ exp: Date.now() + B.pkce.expiryMs, state, verifier })),
        Effect.map(({ ciphertext, iv }) => Buffer.from(new Uint8Array([...iv, ...ciphertext])).toString('base64url')),
        Effect.mapError(() => new OAuthError({ provider: 'google', reason: 'PKCE state encryption failed' })),
    );

/** Decrypt base64url → {state, verifier}, validates expiry */
const decryptPkceState = (
    encrypted: string,
    provider: OAuthProvider,
): Effect.Effect<{ state: string; verifier: string }, OAuthError> =>
    pipe(
        Effect.try(() => new Uint8Array(Buffer.from(encrypted, 'base64url'))),
        Effect.flatMap((bytes) =>
            pipe(
                Crypto.decryptFromBytes(bytes),
                Effect.mapError(() => new OAuthError({ provider, reason: 'PKCE decryption failed' })),
            ),
        ),
        Effect.flatMap((json) =>
            Effect.try(() => JSON.parse(json) as { exp: number; state: string; verifier: string }),
        ),
        Effect.flatMap((payload) =>
            Date.now() > payload.exp
                ? Effect.fail(new OAuthError({ provider, reason: 'PKCE state expired' }))
                : Effect.succeed({ state: payload.state, verifier: payload.verifier }),
        ),
        Effect.mapError((e) =>
            e instanceof OAuthError ? e : new OAuthError({ provider, reason: 'PKCE state invalid' }),
        ),
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const normalizeUserInfo = {
    github: (data: GitHubUserInfo): OAuthUserInfo => ({
        avatarUrl: Option.fromNullable(data.avatar_url),
        email: Option.fromNullable(data.email),
        name: Option.fromNullable(data.name),
        providerAccountId: String(data.id),
    }),
    google: (data: OIDCUserInfo): OAuthUserInfo => ({
        avatarUrl: Option.fromNullable(data.picture),
        email: Option.fromNullable(data.email),
        name: Option.fromNullable(data.name),
        providerAccountId: data.sub,
    }),
    microsoft: (data: OIDCUserInfo): OAuthUserInfo => ({
        avatarUrl: Option.fromNullable(data.picture),
        email: Option.fromNullable(data.email),
        name: Option.fromNullable(data.name),
        providerAccountId: data.sub,
    }),
} as const satisfies Record<OAuthProvider, (data: never) => OAuthUserInfo>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const decodeAndNormalize = {
    github: (response: unknown) =>
        S.decodeUnknown(GitHubUserInfoSchema)(response).pipe(Effect.map(normalizeUserInfo.github)),
    google: (response: unknown) =>
        S.decodeUnknown(OIDCUserInfoSchema)(response).pipe(Effect.map(normalizeUserInfo.google)),
    microsoft: (response: unknown) =>
        S.decodeUnknown(OIDCUserInfoSchema)(response).pipe(Effect.map(normalizeUserInfo.microsoft)),
} as const satisfies Record<OAuthProvider, (response: unknown) => Effect.Effect<OAuthUserInfo, ParseError>>;
/** Validate Arctic token response shape, then safely invoke method accessors */
const extractArcticTokens = (tokens: unknown, provider: OAuthProvider): Effect.Effect<OAuthTokens, OAuthError> =>
    pipe(
        S.decodeUnknown(ArcticTokenMethodsSchema)(tokens),
        Effect.mapError(() => new OAuthError({ provider, reason: 'Invalid token response shape' })),
        Effect.flatMap((validated) =>
            Effect.try({
                catch: () => new OAuthError({ provider, reason: 'Token method invocation failed' }),
                try: () => {
                    const accessTokenFn = validated.accessToken as unknown;
                    const expiresAtFn = validated.accessTokenExpiresAt as unknown;
                    const refreshTokenFn = validated.refreshToken as unknown;
                    return {
                        accessToken: typeof accessTokenFn === 'function' ? (accessTokenFn as () => string)() : '',
                        expiresAt: Option.fromNullable(
                            typeof expiresAtFn === 'function' ? (expiresAtFn as () => Date)() : undefined,
                        ),
                        refreshToken: Option.fromNullable(
                            typeof refreshTokenFn === 'function' ? (refreshTokenFn as () => string)() : undefined,
                        ),
                        scope: Option.none(),
                    } satisfies OAuthTokens;
                },
            }),
        ),
    );
const fetchUserInfo = (provider: OAuthProvider, accessToken: string): Effect.Effect<OAuthUserInfo, OAuthError> =>
    pipe(
        Effect.tryPromise({
            catch: (e) => new OAuthError({ provider, reason: `Failed to fetch user info: ${String(e)}` }),
            try: () =>
                fetch(B.userInfoUrls[provider], {
                    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'ParametricPortal/1.0' },
                }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
        }),
        Effect.flatMap((response) =>
            decodeAndNormalize[provider](response).pipe(
                Effect.mapError(() => new OAuthError({ provider, reason: 'Invalid userinfo response shape' })),
            ),
        ),
    );

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
        const githubConfig: ArcticProviderConfig = {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
            redirectUri: `${baseUrl}/api/auth/oauth/github/callback`,
        };
        const googleConfig: ArcticProviderConfig = {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            redirectUri: `${baseUrl}/api/auth/oauth/google/callback`,
        };
        const microsoftConfig: ArcticProviderConfig = {
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
        // PKCE: Encrypted state replaces in-memory Map (RFC 7636 §7.2 - stateless servers)
        const createAuthUrl = {
            github: (state: string, scopes: ReadonlyArray<string>) =>
                Effect.succeed(github.createAuthorizationURL(state, [...scopes])),
            google: (state: string, scopes: ReadonlyArray<string>) =>
                pipe(
                    Effect.sync(generateCodeVerifier),
                    Effect.flatMap((verifier) =>
                        pipe(
                            encryptPkceState(state, verifier),
                            Effect.map((encryptedState) =>
                                google.createAuthorizationURL(encryptedState, verifier, [...scopes]),
                            ),
                        ),
                    ),
                ),
            microsoft: (state: string, scopes: ReadonlyArray<string>) =>
                pipe(
                    Effect.sync(generateCodeVerifier),
                    Effect.flatMap((verifier) =>
                        pipe(
                            encryptPkceState(state, verifier),
                            Effect.map((encryptedState) =>
                                microsoft.createAuthorizationURL(encryptedState, verifier, [...scopes]),
                            ),
                        ),
                    ),
                ),
        } as const satisfies Record<
            OAuthProvider,
            (state: string, scopes: ReadonlyArray<string>) => Effect.Effect<URL, OAuthError>
        >;
        const validateToken = {
            github: (code: string, _state: string) =>
                Effect.tryPromise({
                    catch: (e) => new OAuthError({ provider: 'github', reason: `Token exchange failed: ${String(e)}` }),
                    try: () => github.validateAuthorizationCode(code),
                }),
            google: (code: string, encryptedState: string) =>
                pipe(
                    decryptPkceState(encryptedState, 'google'),
                    Effect.flatMap(({ verifier }) =>
                        Effect.tryPromise({
                            catch: (e) =>
                                new OAuthError({ provider: 'google', reason: `Token exchange failed: ${String(e)}` }),
                            try: () => google.validateAuthorizationCode(code, verifier),
                        }),
                    ),
                ),
            microsoft: (code: string, encryptedState: string) =>
                pipe(
                    decryptPkceState(encryptedState, 'microsoft'),
                    Effect.flatMap(({ verifier }) =>
                        Effect.tryPromise({
                            catch: (e) =>
                                new OAuthError({
                                    provider: 'microsoft',
                                    reason: `Token exchange failed: ${String(e)}`,
                                }),
                            try: () => microsoft.validateAuthorizationCode(code, verifier),
                        }),
                    ),
                ),
        } as const satisfies Record<OAuthProvider, (code: string, state: string) => Effect.Effect<unknown, OAuthError>>;
        return OAuthService.of({
            createAuthorizationUrl: (provider, state) => createAuthUrl[provider](state, B.scopes[provider]),
            getUserInfo: fetchUserInfo,
            validateCallback: (provider, code, state) =>
                pipe(
                    validateToken[provider](code, state),
                    Effect.flatMap((tokens) => extractArcticTokens(tokens, provider)),
                ),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { OAuthServiceLive };
