/**
 * OAuth implementation using Arctic library with @effect/platform HttpClient.
 * [PATTERN] Schema.Class for PKCE state, Match for error mapping, HttpClient for GitHub API.
 */
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { Timestamp } from '@parametric-portal/types/types';
import { Apple, decodeIdToken, generateCodeVerifier, generateState, GitHub, Google, MicrosoftEntraId, OAuth2RequestError, type OAuth2Tokens } from 'arctic';
import { Config, Duration, Effect, Encoding, Match, Metric, Option as O, Redacted, Schema as S } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { MetricsService } from '../infra/metrics.ts';
import { Crypto } from '../security/crypto.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const GitHubUserSchema = S.Struct({ email: S.NullishOr(S.String), id: S.Number });

// --- [CLASSES] ---------------------------------------------------------------

class OAuthState extends S.Class<OAuthState>('OAuthState')({
	exp: Timestamp.schema,
	provider: S.String,
	state: S.String,
	verifier: S.optional(S.String),
}) {
	static readonly encrypt = Effect.fn('oauth.state.encrypt')(
		(provider: Context.OAuthProvider, state: string, verifier?: string) =>
			Crypto.encrypt(
				JSON.stringify({
					exp: Timestamp.add(Timestamp.nowSync(), Duration.toMillis(Context.Request.config.durations.pkce)),
					provider,
					state,
					...(verifier === undefined ? {} : { verifier }),
				}),
			).pipe(
				Effect.map((enc) => Encoding.encodeBase64Url(enc)),
				Effect.mapError((e) => HttpError.OAuth.of(provider, 'State encryption failed', e)),
			),
	);
	static readonly decrypt = Effect.fn('oauth.state.decrypt')(
		(provider: Context.OAuthProvider, encrypted: string) =>
			((decoded) => decoded._tag === 'Left'
				? Effect.fail(HttpError.OAuth.of(provider, 'Invalid state encoding'))
				: Crypto.decrypt(decoded.right).pipe(
					Effect.flatMap((json) => Effect.try({ catch: (e) => HttpError.OAuth.of(provider, 'Invalid state JSON', e), try: () => JSON.parse(json) as unknown })),
					Effect.flatMap((parsed) => S.decodeUnknown(OAuthState)(parsed)),
				)
			)(Encoding.decodeBase64Url(encrypted)).pipe(
				Effect.filterOrFail((p) => Timestamp.nowSync() <= p.exp, () => HttpError.OAuth.of(provider, 'State expired')),
				Effect.filterOrFail((p) => p.provider === provider, () => HttpError.OAuth.of(provider, 'State provider mismatch')),
				Effect.mapError((e) => (e instanceof HttpError.OAuth ? e : HttpError.OAuth.of(provider, 'Invalid state', e))),
			),
	);
}

// --- [FUNCTIONS] -------------------------------------------------------------

const mapOAuthError =
	(provider: Context.OAuthProvider) =>
	(e: unknown): HttpError.OAuth =>
		Match.value(e).pipe(
			Match.when(
				(x: unknown): x is OAuth2RequestError => x instanceof OAuth2RequestError,
				(x) => HttpError.OAuth.of(provider, `OAuth2: ${x.code}`, x.description),
			),
			Match.when(
				(x: unknown): x is HttpClientError.HttpClientError => HttpClientError.isHttpClientError(x),
				(x) => HttpError.OAuth.of(provider, `HTTP error: ${x.message}`, x),
			),
			Match.orElse((x: unknown) => HttpError.OAuth.of(provider, x instanceof Error ? x.message : 'Unknown error', x)),
		);
const extractResult = (tokens: OAuth2Tokens, user: { readonly id: string; readonly email?: string | null }) =>
	({
		access: tokens.accessToken(),
		email: O.fromNullable(user.email),
		expiresAt: O.fromNullable('expires_in' in tokens.data ? tokens.accessTokenExpiresAt() : undefined),
		externalId: user.id,
		refresh: O.fromNullable(tokens.hasRefreshToken() ? tokens.refreshToken() : undefined),
	}) as const;
const oidcResult = (provider: Context.OAuthProvider, tokens: OAuth2Tokens) =>
	Effect.try({ catch: () => HttpError.OAuth.of(provider, 'idToken() not available'), try: () => decodeIdToken(tokens.idToken()) }).pipe(
		Effect.flatMap((claims) =>
			S.decodeUnknown(S.Struct({ email: S.optional(S.String), sub: S.String }))(claims).pipe(Effect.mapError(() => HttpError.OAuth.of(provider, 'Invalid token claims'))),
		),
		Effect.map((d) => extractResult(tokens, { email: d.email ?? null, id: d.sub })),
	);
const githubResult = (tokens: OAuth2Tokens): Effect.Effect<ReturnType<typeof extractResult>, HttpError.OAuth> =>
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;
		const request = HttpClientRequest.get(Context.Request.config.endpoints.githubApi).pipe(
			HttpClientRequest.setHeader('Authorization', `Bearer ${tokens.accessToken()}`),
			HttpClientRequest.setHeader('User-Agent', 'ParametricPortal/1.0'),
		);
		const response = yield* client.execute(request).pipe(Effect.scoped);
		const data = yield* HttpClientResponse.schemaBodyJson(GitHubUserSchema)(response);
		return extractResult(tokens, { email: data.email ?? null, id: String(data.id) });
	}).pipe(
		Effect.provide(FetchHttpClient.layer),
		Effect.mapError(mapOAuthError('github')),
		Effect.retry(Context.Request.config.oauth.retry),
		Effect.timeoutFail({ duration: Context.Request.config.oauth.timeout, onTimeout: () => HttpError.OAuth.of('github', 'Request timeout') }),
	);
const validateState = (provider: Context.OAuthProvider, state: string, stateCookie: string) =>
	OAuthState.decrypt(provider, stateCookie).pipe(
		Effect.filterOrFail(
			(p) => Crypto.token.compare(p.state, state),
			() => HttpError.OAuth.of(provider, 'State mismatch'),
		),
	);

// --- [SERVICE] ---------------------------------------------------------------

class OAuthService extends Effect.Service<OAuthService>()('server/OAuth', {
	effect: Effect.gen(function* () {
		const cryptoService = yield* Crypto.Service;
		const metrics = yield* MetricsService;
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
		const redirect = (p: Context.OAuthProvider) => `${baseUrl}/api/auth/oauth/${p}/callback`;
		const applePrivateKey = new TextEncoder().encode(Redacted.value(appleCreds.privateKey));
		const clients = {
			apple: new Apple(appleCreds.clientId, appleCreds.teamId, appleCreds.keyId, applePrivateKey, redirect('apple')),
			github: new GitHub(creds.github.id, Redacted.value(creds.github.secret), redirect('github')),
			google: new Google(creds.google.id, Redacted.value(creds.google.secret), redirect('google')),
			microsoft: new MicrosoftEntraId(tenant, creds.microsoft.id, Redacted.value(creds.microsoft.secret), redirect('microsoft')),
		} as const;
		const extractAuth = {
			apple: (t: OAuth2Tokens) => oidcResult('apple', t),
			github: (t: OAuth2Tokens) => githubResult(t),
			google: (t: OAuth2Tokens) => oidcResult('google', t),
			microsoft: (t: OAuth2Tokens) => oidcResult('microsoft', t),
		} as const;
		const exchange = (provider: Context.OAuthProvider, fn: () => Promise<OAuth2Tokens>): Effect.Effect<OAuth2Tokens, HttpError.OAuth> =>
			Effect.tryPromise({ catch: mapOAuthError(provider), try: fn }).pipe(
				Effect.retry(Context.Request.config.oauth.retry),
				Effect.timeoutFail({ duration: Context.Request.config.oauth.timeout, onTimeout: () => HttpError.OAuth.of(provider, 'Token exchange timeout') }),
			);
		// Apple: OIDC with internal PKCE (no verifier params in Arctic API)
		// GitHub: OAuth2 without PKCE
		// Google/Microsoft: OIDC with explicit PKCE verifier
		const createAuthUrl = (provider: Context.OAuthProvider, state: string, verifier: string | undefined, scopes: string[]): URL =>
			Match.value(provider).pipe(
				Match.when('github', () => clients.github.createAuthorizationURL(state, scopes)),
				Match.when('apple', () => clients.apple.createAuthorizationURL(state, scopes)),
				Match.when('google', () => clients.google.createAuthorizationURL(state, verifier as string, scopes)),
				Match.when('microsoft', () => clients.microsoft.createAuthorizationURL(state, verifier as string, scopes)),
				Match.exhaustive,
			);
		const validateCode = (provider: Context.OAuthProvider, code: string, verifier: string | undefined): Promise<OAuth2Tokens> =>
			Match.value(provider).pipe(
				Match.when('github', () => clients.github.validateAuthorizationCode(code)),
				Match.when('apple', () => clients.apple.validateAuthorizationCode(code)),
				Match.when('google', () => clients.google.validateAuthorizationCode(code, verifier as string)),
				Match.when('microsoft', () => clients.microsoft.validateAuthorizationCode(code, verifier as string)),
				Match.exhaustive,
			);
		return {
			authenticate: (provider: Context.OAuthProvider, code: string, state: string, stateCookie: string) =>
				Effect.gen(function* () {
					const { verifier } = yield* validateState(provider, state, stateCookie);
					yield* Context.Request.config.oauth.capabilities[provider].pkce && verifier === undefined
						? Effect.fail(HttpError.OAuth.of(provider, 'Missing PKCE verifier'))
						: Effect.void;
					const rawTokens = yield* exchange(provider, () => validateCode(provider, code, verifier));
					return yield* extractAuth[provider](rawTokens);
				}).pipe(
					Effect.provideService(Crypto.Service, cryptoService),
					Metric.trackDuration(Metric.taggedWithLabels(metrics.oauth.duration, MetricsService.label({ provider }))),
					Effect.tap(() => MetricsService.inc(metrics.oauth.authentications, MetricsService.label({ provider, status: 'success' }))),
					Effect.tapError(() => MetricsService.inc(metrics.oauth.authentications, MetricsService.label({ provider, status: 'failure' }))),
				),
			createAuthorizationUrl: (provider: Context.OAuthProvider) =>
				Effect.gen(function* () {
					const state = generateState();
					const scopes = Context.Request.config.oauth.capabilities[provider].oidc
						? [...Context.Request.config.oauth.scopes.oidc]
						: [...Context.Request.config.oauth.scopes.github];
					const verifier = Context.Request.config.oauth.capabilities[provider].pkce ? generateCodeVerifier() : undefined;
					const stateCookie = yield* OAuthState.encrypt(provider, state, verifier);
					const url = createAuthUrl(provider, state, verifier, scopes);
					yield* MetricsService.inc(metrics.oauth.authorizations, MetricsService.label({ provider }));
					return { stateCookie, url };
				}).pipe(Effect.provideService(Crypto.Service, cryptoService)),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { OAuthService };
