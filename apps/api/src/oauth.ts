/**
 * OAuth implementation using Arctic library.
 * Schema.Class for PKCE state, unified error factory, Arctic-native integration.
 */

import { AUTH_TUNING, OAuthResult } from '@parametric-portal/server/auth';
import { Crypto, EncryptedKey, EncryptionKeyService } from '@parametric-portal/server/crypto';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { OAuth } from '@parametric-portal/server/middleware';
import type { OAuthProvider } from '@parametric-portal/types/schema';
import { Timestamp } from '@parametric-portal/types/types';
import { Apple, ArcticFetchError, decodeIdToken, GitHub, Google, generateCodeVerifier, generateState, MicrosoftEntraId, OAuth2RequestError, type OAuth2Tokens, UnexpectedErrorResponseBodyError, UnexpectedResponseError, } from 'arctic';
import { Config, type ConfigError, Effect, Layer, Redacted, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const GitHubUser = S.Struct({
    avatarUrl: S.optional(S.String).pipe(S.fromKey('avatar_url')),
    email: S.NullishOr(S.String),
    id: S.Number,
    name: S.NullishOr(S.String),
});
const OIDCClaims = S.Struct({
    email: S.optional(S.String),
    name: S.optional(S.String),
    picture: S.optional(S.String),
    sub: S.String,
});

// --- [CLASSES] ---------------------------------------------------------------

class PkceState extends S.Class<PkceState>('PkceState')({
    exp: Timestamp.schema,
    state: S.String,
    verifier: S.String,
}) {
    static readonly encrypt = Effect.fn('pkce.encrypt')(
        (provider: typeof OAuthProvider.Type, state: string, verifier: string) =>
            Crypto.Key.encrypt(
                JSON.stringify({
                    exp: Timestamp.addDuration(Timestamp.nowSync(), AUTH_TUNING.durations.pkce),
                    state,
                    verifier,
                }),
            ).pipe(
                Effect.flatMap((enc) => S.encode(EncryptedKey.fromBytes)(enc)),
                Effect.map((bytes) => Buffer.from(bytes).toString('base64url')),
                Effect.mapError(() => mkErr(provider, 'PKCE encryption failed', 'PKCE_ENCRYPT_FAILED')),
            ),
    );
    static readonly decrypt = Effect.fn('pkce.decrypt')((provider: typeof OAuthProvider.Type, encrypted: string) =>
        EncryptedKey.decryptBytes(new Uint8Array(Buffer.from(encrypted, 'base64url'))).pipe(
            Effect.flatMap((json) => S.decodeUnknown(PkceState)(JSON.parse(json))),
            Effect.filterOrFail(
                (p) => Timestamp.nowSync() <= p.exp,
                () => mkErr(provider, 'PKCE expired', 'PKCE_EXPIRED'),
            ),
            Effect.mapError(() => mkErr(provider, 'PKCE invalid', 'PKCE_INVALID')),
        ),
    );
}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mkErr = (provider: typeof OAuthProvider.Type, reason: string, _code: string, _cause?: unknown) =>
    new HttpError.OAuth({ provider, reason });
const handler = <T>(
    guard: (e: unknown) => e is T,
    fn: (p: typeof OAuthProvider.Type, e: T) => InstanceType<typeof HttpError.OAuth>,
) => [guard, fn] as const;
const arcticHandlers = [
    handler(
        (e): e is OAuth2RequestError => e instanceof OAuth2RequestError,
        (p, e) => mkErr(p, `OAuth2: ${e.code}`, e.code, e.description),
    ),
    handler(
        (e): e is ArcticFetchError => e instanceof ArcticFetchError,
        (p, e) => mkErr(p, 'Fetch failed', 'FETCH_ERROR', e.cause instanceof Error ? e.cause.message : String(e.cause)),
    ),
    handler(
        (e): e is UnexpectedResponseError => e instanceof UnexpectedResponseError,
        (p, e) => mkErr(p, 'Unexpected response', 'UNEXPECTED_RESPONSE', `HTTP ${e.status}`),
    ),
    handler(
        (e): e is UnexpectedErrorResponseBodyError => e instanceof UnexpectedErrorResponseBodyError,
        (p, e) => mkErr(p, `Unexpected error: HTTP ${e.status}`, 'UNEXPECTED_ERROR_BODY'),
    ),
] as const;
const mapArctic = (p: typeof OAuthProvider.Type, e: unknown) =>
    arcticHandlers.find(([guard]) => guard(e))?.[1](p, e as never) ??
    new HttpError.OAuth({ provider: p, reason: e instanceof Error ? e.message : 'Unknown error' });
const extractResult = (t: OAuth2Tokens, user: { readonly id: string; readonly email?: string | null }) =>
    OAuthResult.fromProvider(
        {
            accessToken: t.accessToken(),
            expiresAt: 'expires_in' in t.data ? t.accessTokenExpiresAt() : undefined,
            refreshToken: t.hasRefreshToken() ? t.refreshToken() : undefined,
        },
        { email: user.email, providerAccountId: user.id },
    );

// --- [DISPATCH_TABLES] -------------------------------------------------------

const oidcResult = (provider: typeof OAuthProvider.Type, tokens: OAuth2Tokens) =>
    Effect.try({
        catch: () => mkErr(provider, 'idToken() not available', 'NO_ID_TOKEN'),
        try: () => decodeIdToken(tokens.idToken()),
    }).pipe(
        Effect.flatMap((claims) =>
            S.decodeUnknown(OIDCClaims)(claims).pipe(
                Effect.mapError(() => mkErr(provider, 'Invalid token claims', 'INVALID_CLAIMS')),
            ),
        ),
        Effect.map((d) => extractResult(tokens, { email: d.email ?? null, id: d.sub })),
    );
const githubResult = (tokens: OAuth2Tokens) =>
    Effect.tryPromise({
        catch: (e) => mapArctic('github', e),
        try: () =>
            fetch(AUTH_TUNING.endpoints.githubApi, {
                headers: { Authorization: `Bearer ${tokens.accessToken()}`, 'User-Agent': 'ParametricPortal/1.0' },
            }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    }).pipe(
        Effect.retry(AUTH_TUNING.oauth.retry),
        Effect.timeoutFail({
            duration: AUTH_TUNING.oauth.timeout,
            onTimeout: () => mkErr('github', 'Request timeout', 'TIMEOUT'),
        }),
        Effect.flatMap((r) =>
            S.decodeUnknown(GitHubUser)(r).pipe(
                Effect.mapError(() => mkErr('github', 'Invalid response', 'INVALID_RESPONSE')),
            ),
        ),
        Effect.map((d) => extractResult(tokens, { email: d.email ?? null, id: String(d.id) })),
    );
const extractAuth = Object.freeze({
    apple: (t: OAuth2Tokens) => oidcResult('apple', t),
    github: githubResult,
    google: (t: OAuth2Tokens) => oidcResult('google', t),
    microsoft: (t: OAuth2Tokens) => oidcResult('microsoft', t),
} satisfies Record<
    typeof OAuthProvider.Type,
    (t: OAuth2Tokens) => Effect.Effect<OAuthResult, InstanceType<typeof HttpError.OAuth>>
>);

// --- [LAYER] -----------------------------------------------------------------

const OAuthLive: Layer.Layer<OAuth, ConfigError.ConfigError> = Layer.effect(
    OAuth,
    Effect.gen(function* () {
        const baseUrl = yield* Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000'));
        const loadCreds = (k: string) =>
            Effect.all({
                id: Config.string(`OAUTH_${k}_CLIENT_ID`).pipe(Config.withDefault('')),
                secret: Config.redacted(`OAUTH_${k}_CLIENT_SECRET`).pipe(Config.withDefault(Redacted.make(''))),
            });
        const loadAppleCreds = Effect.all({
            clientId: Config.string('OAUTH_APPLE_CLIENT_ID').pipe(Config.withDefault('')),
            keyId: Config.string('OAUTH_APPLE_KEY_ID').pipe(Config.withDefault('')),
            privateKey: Config.redacted('OAUTH_APPLE_PRIVATE_KEY').pipe(Config.withDefault(Redacted.make(''))),
            teamId: Config.string('OAUTH_APPLE_TEAM_ID').pipe(Config.withDefault('')),
        });
        const [creds, appleCreds, tenant] = yield* Effect.all([
            Effect.all({ github: loadCreds('GITHUB'), google: loadCreds('GOOGLE'), microsoft: loadCreds('MICROSOFT') }),
            loadAppleCreds,
            Config.string('OAUTH_MICROSOFT_TENANT_ID').pipe(Config.withDefault('common')),
        ]);
        const redirect = (p: typeof OAuthProvider.Type) => `${baseUrl}/api/auth/oauth/${p}/callback`;
        const applePrivateKey = new TextEncoder().encode(Redacted.value(appleCreds.privateKey));
        const clients = Object.freeze({
            apple: new Apple(appleCreds.clientId, appleCreds.teamId, appleCreds.keyId, applePrivateKey, redirect('apple')),
            github: new GitHub(creds.github.id, Redacted.value(creds.github.secret), redirect('github')),
            google: new Google(creds.google.id, Redacted.value(creds.google.secret), redirect('google')),
            microsoft: new MicrosoftEntraId(
                tenant,
                creds.microsoft.id,
                Redacted.value(creds.microsoft.secret),
                redirect('microsoft'),
            ),
        });
        const exchange = (provider: typeof OAuthProvider.Type, fn: () => Promise<OAuth2Tokens>) =>
            Effect.tryPromise({ catch: (e) => mapArctic(provider, e), try: fn }).pipe(
                Effect.retry(AUTH_TUNING.oauth.retry),
                Effect.timeoutFail({
                    duration: AUTH_TUNING.oauth.timeout,
                    onTimeout: () => mkErr(provider, 'Token exchange timeout', 'TIMEOUT'),
                }),
            );
        const refreshHandlers = Object.freeze({
            apple: (_token: string) => Promise.reject(new Error('Apple does not support refresh tokens')),
            github: (token: string) => clients.github.refreshAccessToken(token),
            google: (token: string) => clients.google.refreshAccessToken(token),
            microsoft: (token: string) =>
                clients.microsoft.refreshAccessToken(token, [...AUTH_TUNING.oauth.scopes.oidc]),
        } satisfies Record<typeof OAuthProvider.Type, (token: string) => Promise<OAuth2Tokens>>);
        return OAuth.of({
            authenticate: (provider, code, state) =>
                Effect.gen(function* () {
                    const verifier = provider === 'github' ? '' : (yield* PkceState.decrypt(provider, state)).verifier;
                    const rawTokens = yield* provider === 'github'
                        ? exchange(provider, () => clients.github.validateAuthorizationCode(code))
                        : exchange(provider, () => clients[provider].validateAuthorizationCode(code, verifier));
                    return yield* extractAuth[provider](rawTokens);
                }).pipe(Effect.provide(EncryptionKeyService.layer), Effect.provide(MetricsService.layer)),
            createAuthorizationUrl: (provider) =>
                Effect.gen(function* () {
                    const state = generateState();
                    const verifier = generateCodeVerifier();
                    return provider === 'github'
                        ? clients.github.createAuthorizationURL(state, [...AUTH_TUNING.oauth.scopes.github])
                        : clients[provider].createAuthorizationURL(
                              yield* PkceState.encrypt(provider, state, verifier),
                              verifier,
                              [...AUTH_TUNING.oauth.scopes.oidc],
                          );
                }).pipe(Effect.provide(EncryptionKeyService.layer), Effect.provide(MetricsService.layer)),
            refreshToken: (provider, token) =>
                exchange(provider, () => refreshHandlers[provider](token)).pipe(
                    Effect.map((t) => extractResult(t, { email: null, id: '' })),
                ),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { OAuthLive };
