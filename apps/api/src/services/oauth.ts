/**
 * OAuth implementation using Arctic library.
 * [PATTERN] Schema.Class for PKCE state, Match for error mapping, single circuit for GitHub.
 */
import { Context } from '@parametric-portal/server/context';

const Auth = Context.Session.config;
const OAuth = Context.OAuth;
import { HttpError } from '@parametric-portal/server/errors';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { Timestamp } from '@parametric-portal/types/types';
import { Apple, ArcticFetchError, decodeIdToken, GitHub, Google, MicrosoftEntraId, OAuth2RequestError, type OAuth2Tokens, UnexpectedErrorResponseBodyError, UnexpectedResponseError, generateCodeVerifier, generateState } from 'arctic';
import { Config, Duration, Effect, Layer, Match, Option as O, Redacted, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

/** Provider-specific OAuth capabilities - keys define valid providers */
const _oauth = {
	apple:     { oidc: true,  pkce: true  },
	github:    { oidc: false, pkce: false },
	google:    { oidc: true,  pkce: true  },
	microsoft: { oidc: true,  pkce: true  },
} as const;
type _Provider = keyof typeof _oauth;

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

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
	http: {
		bodyPreviewMax: 200,
		status: { rateLimit: 429, serverErrorMin: 500 },
	},
} as const;
const GitHubCircuitPolicy = Circuit.handleType(ArcticFetchError)
	.orType(UnexpectedResponseError, (e: UnexpectedResponseError) => e.status >= B.http.status.serverErrorMin || e.status === B.http.status.rateLimit)
	.orType(UnexpectedErrorResponseBodyError, (e: UnexpectedErrorResponseBodyError) => e.status >= B.http.status.serverErrorMin || e.status === B.http.status.rateLimit);

// --- [CLASSES] ---------------------------------------------------------------

class OAuthState extends S.Class<OAuthState>('OAuthState')({
	exp: Timestamp.schema,
	provider: S.String,
	state: S.String,
	verifier: S.optional(S.String),
}) {
	static readonly encrypt = Effect.fn('oauth.state.encrypt')(
		(provider: _Provider, state: string, verifier?: string) =>
			Crypto.encrypt(
				JSON.stringify({
					exp: Timestamp.add(Timestamp.nowSync(), Duration.toMillis(Auth.durations.pkce)),
					provider,
					state,
					...(verifier === undefined ? {} : { verifier }),
				}),
			).pipe(
				Effect.map((enc) => Buffer.from(enc).toString('base64url')),
				Effect.mapError((e) => HttpError.oauth(provider, 'State encryption failed', e)),
			),
	);
	static readonly decrypt = Effect.fn('oauth.state.decrypt')(
		(provider: _Provider, encrypted: string) =>
			Crypto.decrypt(new Uint8Array(Buffer.from(encrypted, 'base64url'))).pipe(
				Effect.flatMap(({ value: json }) =>
					Effect.try({ catch: (e) => HttpError.oauth(provider, 'Invalid state JSON', e), try: () => JSON.parse(json) as unknown }).pipe(
						Effect.flatMap((parsed) => S.decodeUnknown(OAuthState)(parsed)),
					),
				),
				Effect.filterOrFail(
					(p) => Timestamp.nowSync() <= p.exp,
					() => HttpError.oauth(provider, 'State expired'),
				),
				Effect.filterOrFail(
					(p) => p.provider === provider,
					() => HttpError.oauth(provider, 'State provider mismatch'),
				),
				Effect.mapError((e) => e instanceof HttpError.OAuth ? e : HttpError.oauth(provider, 'Invalid state', e)),
			),
	);
}

// --- [FUNCTIONS] -------------------------------------------------------------

const mapOAuthError = (provider: _Provider) => {
	const handlers: ReadonlyArray<readonly [(e: unknown) => boolean, (e: unknown) => HttpError.OAuth]> = [
		[Circuit.isOpen, () => HttpError.oauth(provider, 'Service unavailable')],
		[Circuit.isCancelled, () => HttpError.oauth(provider, 'Request cancelled')],
		[(e): e is OAuth2RequestError => e instanceof OAuth2RequestError, (e) => HttpError.oauth(provider, `OAuth2: ${(e as OAuth2RequestError).code}`, (e as OAuth2RequestError).description)],
		[(e): e is ArcticFetchError => e instanceof ArcticFetchError, (e) => HttpError.oauth(provider, 'Fetch failed', (e as ArcticFetchError).cause)],
		[(e): e is UnexpectedResponseError => e instanceof UnexpectedResponseError, (e) => HttpError.oauth(provider, `Unexpected response: HTTP ${(e as UnexpectedResponseError).status}`, e)],
		[(e): e is UnexpectedErrorResponseBodyError => e instanceof UnexpectedErrorResponseBodyError, (e) => HttpError.oauth(provider, `Unexpected error: HTTP ${(e as UnexpectedErrorResponseBodyError).status}`, e)],
	];
	return (e: unknown): HttpError.OAuth => handlers.find(([pred]) => pred(e))?.[1](e) ?? HttpError.oauth(provider, e instanceof Error ? e.message : 'Unknown error', e);
};
const extractResult = (tokens: OAuth2Tokens, user: { readonly id: string; readonly email?: string | null }) => ({
	access: tokens.accessToken(),
	email: O.fromNullable(user.email),
	expiresAt: O.fromNullable('expires_in' in tokens.data ? tokens.accessTokenExpiresAt() : undefined),
	externalId: user.id,
	refresh: O.fromNullable(tokens.hasRefreshToken() ? tokens.refreshToken() : undefined),
}) as const;
const oidcResult = (provider: _Provider, tokens: OAuth2Tokens) =>
	Effect.try({ catch: () => HttpError.oauth(provider, 'idToken() not available'), try: () => decodeIdToken(tokens.idToken()) }).pipe(
		Effect.flatMap((claims) => S.decodeUnknown(OIDCClaims)(claims).pipe(Effect.mapError(() => HttpError.oauth(provider, 'Invalid token claims')))),
		Effect.map((d) => extractResult(tokens, { email: d.email ?? null, id: d.sub })),
	);
const githubResult = (tokens: OAuth2Tokens, circuit: Circuit.Instance) =>
	circuit
		.execute(({ signal }) =>
			fetch(Auth.endpoints.githubApi, {
				headers: { Authorization: `Bearer ${tokens.accessToken()}`, 'User-Agent': 'ParametricPortal/1.0' },
				signal,
			})
				.catch((err) => Promise.reject(new ArcticFetchError(err)))
				.then((r) => r.ok
					? r.json()
					: r.text().catch(() => '').then((body) => Promise.reject(body
						? new UnexpectedErrorResponseBodyError(r.status, body.slice(0, B.http.bodyPreviewMax))
						: new UnexpectedResponseError(r.status)))
				)
		)
		.pipe(
			Effect.mapError(mapOAuthError('github')),
			Effect.retry(Auth.oauth.retry),
			Effect.timeoutFail({ duration: Auth.oauth.timeout, onTimeout: () => HttpError.oauth('github', 'Request timeout') }),
			Effect.flatMap((r) => S.decodeUnknown(GitHubUser)(r).pipe(Effect.mapError(() => HttpError.oauth('github', 'Invalid response')))),
			Effect.map((d) => extractResult(tokens, { email: d.email ?? null, id: String(d.id) })),
		);
const validateState = (provider: _Provider, state: string, stateCookie: string) =>
	OAuthState.decrypt(provider, stateCookie).pipe(
		Effect.filterOrFail(
			(p) => Crypto.token.compare(p.state, state),
			() => HttpError.oauth(provider, 'State mismatch'),
		),
	);

// --- [LAYER] -----------------------------------------------------------------

const _OAuthLayer = Layer.effect(
	OAuth,
	Effect.gen(function* () {
		const cryptoService = yield* Crypto.Service;
		const baseUrl = yield* Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:4000'));
		const loadCreds = (k: string) =>
			Effect.all({
				id: Config.string(`OAUTH_${k}_CLIENT_ID`).pipe(Config.withDefault('')),
				secret: Config.redacted(`OAUTH_${k}_CLIENT_SECRET`).pipe(Config.withDefault(Redacted.make(''))),
			});
		const [creds, appleCreds, tenant] = yield* Effect.all([
			Effect.all({ github: loadCreds('GITHUB'), google: loadCreds('GOOGLE'), microsoft: loadCreds('MICROSOFT') }),
			Effect.all({
				clientId: Config.string('OAUTH_APPLE_CLIENT_ID').pipe(Config.withDefault('')),
				keyId: Config.string('OAUTH_APPLE_KEY_ID').pipe(Config.withDefault('')),
				privateKey: Config.redacted('OAUTH_APPLE_PRIVATE_KEY').pipe(Config.withDefault(Redacted.make(''))),
				teamId: Config.string('OAUTH_APPLE_TEAM_ID').pipe(Config.withDefault('')),
			}),
			Config.string('OAUTH_MICROSOFT_TENANT_ID').pipe(Config.withDefault('common')),
		]);
		const redirect = (p: _Provider) => `${baseUrl}/api/auth/oauth/${p}/callback`;
		const applePrivateKey = new TextEncoder().encode(Redacted.value(appleCreds.privateKey));
		const clients = {
			apple: new Apple(appleCreds.clientId, appleCreds.teamId, appleCreds.keyId, applePrivateKey, redirect('apple')),
			github: new GitHub(creds.github.id, Redacted.value(creds.github.secret), redirect('github')),
			google: new Google(creds.google.id, Redacted.value(creds.google.secret), redirect('google')),
			microsoft: new MicrosoftEntraId(tenant, creds.microsoft.id, Redacted.value(creds.microsoft.secret), redirect('microsoft')),
		} as const;
		// Only GitHub needs circuit breaker (makes external API call for user profile)
		const githubCircuit = Circuit.make('oauth.github', { policy: GitHubCircuitPolicy });
		const extractAuth = {
			apple: (t: OAuth2Tokens) => oidcResult('apple', t),
			github: (t: OAuth2Tokens) => githubResult(t, githubCircuit),
			google: (t: OAuth2Tokens) => oidcResult('google', t),
			microsoft: (t: OAuth2Tokens) => oidcResult('microsoft', t),
		} satisfies Record<_Provider, (t: OAuth2Tokens) => Effect.Effect<ReturnType<typeof extractResult>, HttpError.OAuth>>;
		const exchange = (provider: _Provider, fn: () => Promise<OAuth2Tokens>): Effect.Effect<OAuth2Tokens, HttpError.OAuth> =>
			provider === 'github'
				? githubCircuit.execute(fn).pipe(
						Effect.mapError(mapOAuthError(provider)),
						Effect.retry(Auth.oauth.retry),
						Effect.timeoutFail({ duration: Auth.oauth.timeout, onTimeout: () => HttpError.oauth(provider, 'Token exchange timeout') }),
					)
				: Effect.tryPromise({ catch: mapOAuthError(provider), try: fn }).pipe(
						Effect.retry(Auth.oauth.retry),
						Effect.timeoutFail({ duration: Auth.oauth.timeout, onTimeout: () => HttpError.oauth(provider, 'Token exchange timeout') }),
					);
		// Apple: OIDC with internal PKCE (no verifier params in Arctic API)
		// GitHub: OAuth2 without PKCE
		// Google/Microsoft: OIDC with explicit PKCE verifier
		const createAuthUrl = (provider: _Provider, state: string, verifier: string | undefined, scopes: string[]): URL =>
			Match.value(provider).pipe(
				Match.when('github', () => clients.github.createAuthorizationURL(state, scopes)),
				Match.when('apple', () => clients.apple.createAuthorizationURL(state, scopes)),
				Match.when('google', () => clients.google.createAuthorizationURL(state, verifier as string, scopes)),
				Match.when('microsoft', () => clients.microsoft.createAuthorizationURL(state, verifier as string, scopes)),
				Match.exhaustive,
			);
		const validateCode = (provider: _Provider, code: string, verifier: string | undefined): Promise<OAuth2Tokens> =>
			Match.value(provider).pipe(
				Match.when('github', () => clients.github.validateAuthorizationCode(code)),
				Match.when('apple', () => clients.apple.validateAuthorizationCode(code)),
				Match.when('google', () => clients.google.validateAuthorizationCode(code, verifier as string)),
				Match.when('microsoft', () => clients.microsoft.validateAuthorizationCode(code, verifier as string)),
				Match.exhaustive,
			);
		return OAuth.of({
			authenticate: (provider, code, state, stateCookie) =>
				Effect.gen(function* () {
					const { verifier } = yield* validateState(provider, state, stateCookie);
					yield* _oauth[provider].pkce && verifier === undefined ? Effect.fail(HttpError.oauth(provider, 'Missing PKCE verifier')) : Effect.void;
					const rawTokens = yield* exchange(provider, () => validateCode(provider, code, verifier));
					return yield* extractAuth[provider](rawTokens);
				}).pipe(Effect.provideService(Crypto.Service, cryptoService)),
			createAuthorizationUrl: (provider) =>
				Effect.gen(function* () {
					const state = generateState();
					const scopes = _oauth[provider].oidc ? [...Auth.oauth.scopes.oidc] : [...Auth.oauth.scopes.github];
					const verifier = _oauth[provider].pkce ? generateCodeVerifier() : undefined;
					const stateCookie = yield* OAuthState.encrypt(provider, state, verifier);
					const url = createAuthUrl(provider, state, verifier, scopes);
					return { stateCookie, url };
				}).pipe(Effect.provideService(Crypto.Service, cryptoService)),
		});
	}),
);
const OAuthLive = _OAuthLayer.pipe(Layer.provide(Crypto.Service.Default));

// --- [EXPORT] ----------------------------------------------------------------

export { OAuthLive };
