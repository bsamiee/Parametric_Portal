import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { AiProviderSchema, AiSettingsSchema } from '@parametric-portal/database/models';
import { Duration, Effect, FiberRef, Layer, Match, Option, Redacted, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const _SessionOverrideSchema = S.Struct({
    embedding: S.optional(S.Struct({
        model:    S.optional(S.String),
        provider: S.optional(S.Literal('openai')),
    })),
    language: S.optional(S.Struct({
        fallback: S.optional(S.Array(AiProviderSchema)),
        model:    S.NonEmptyTrimmedString,
        provider: AiProviderSchema,
    })),
});
const _GeminiDesktopClientSchema = S.parseJson(S.Struct({
    installed: S.Struct({
        auth_uri:      S.String,
        client_id:     S.NonEmptyTrimmedString,
        client_secret: S.NonEmptyTrimmedString,
        project_id:    S.NonEmptyTrimmedString,
        token_uri:     S.String,
    }),
}));

// --- [CONSTANTS] -------------------------------------------------------------

const _ProviderCatalog = {
    anthropic: {
        credential: {
            configKeys: { secret: 'AI_ANTHROPIC_API_SECRET' },
            kind:       'api-secret',
        },
        defaultModel: 'claude-sonnet-4-20250514',
        title:        'Anthropic (Claude)',
    },
    gemini: {
        credential: {
            configKeys: {
                accessToken:  'AI_GEMINI_ACCESS_TOKEN',
                clientPath:   'AI_GEMINI_CLIENT_PATH',
                expiry:       'AI_GEMINI_TOKEN_EXPIRY',
                refreshToken: 'AI_GEMINI_REFRESH_TOKEN',
            },
            kind: 'oauth-desktop',
            scopes: [
                'https://www.googleapis.com/auth/cloud-platform',
                'https://www.googleapis.com/auth/generative-language.retriever',
            ],
            tokenExpiryBufferMs: 60_000,
        },
        defaultModel: 'gemini-2.5-pro',
        title:        'Google (Gemini)',
    },
    openai: {
        credential: {
            configKeys: { secret: 'AI_OPENAI_API_SECRET' },
            kind:       'api-secret',
        },
        defaultModel: 'gpt-4.1',
        title:        'OpenAI',
    },
} as const;
const _OnTokenRefreshRef = FiberRef.unsafeMake<Option.Option<AiRegistry.OnTokenRefresh>>(Option.none());
const _SessionOverrideRef = FiberRef.unsafeMake(Option.none<S.Schema.Type<typeof _SessionOverrideSchema>>());
const _AnthropicToolSearchFlag = 'provider.anthropic.tool_search' as const;
const _GeminiTokenResponse = S.Struct({
    access_token:  S.NonEmptyTrimmedString,
    expires_in:    S.Int.pipe(S.greaterThan(0)),
    refresh_token: S.optional(S.NonEmptyTrimmedString),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _tokenRequest = (tokenUri: string, params: Record<string, string>) =>
    HttpClientRequest.post(tokenUri).pipe(
        HttpClientRequest.bodyUrlParams(params),
        HttpClientRequest.setHeader('content-type', 'application/x-www-form-urlencoded'),
        HttpClient.execute,
        Effect.flatMap((response) => response.json),
        Effect.scoped,
        Effect.provide(FetchHttpClient.layer),
        Effect.flatMap(S.decodeUnknown(_GeminiTokenResponse)),
        Effect.map((decoded) => ({
            accessToken:  decoded.access_token,
            expiresAt:    new Date(Date.now() + decoded.expires_in * 1_000).toISOString(),
            refreshToken: decoded.refresh_token,
        })),
    );
const _clientLayers = {
    anthropic: (credential: AiRegistry.Credential<'anthropic'>) =>
        AnthropicClient.layer({ apiKey: credential.secret }).pipe(Layer.provide(FetchHttpClient.layer)),
    gemini: (credential: AiRegistry.Credential<'gemini'>) =>
        GoogleClient.layer({
            transformClient: (client) =>
                client.pipe(HttpClient.mapRequest((request) =>
                    request.pipe(
                        HttpClientRequest.bearerToken(Redacted.value(credential.accessToken)),
                        HttpClientRequest.setHeader('x-goog-user-project', credential.projectId),
                    ))),
        }).pipe(Layer.provide(FetchHttpClient.layer)),
    openai: (credential: AiRegistry.Credential<'openai'>) =>
        OpenAiClient.layer({ apiKey: credential.secret }).pipe(Layer.provide(FetchHttpClient.layer)),
} as const;
const _credential = <P extends AiRegistry.Provider>(credentials: AiRegistry.Credentials, provider: P) =>
    Option.getOrThrowWith(Option.fromNullable(credentials[provider]), () => new Error(`Missing credential for provider: ${provider}`)) as AiRegistry.Credential<P>;
const _providers = {
    anthropic: {
        language: (settings: typeof AiSettingsSchema.Type['language'], credentials: AiRegistry.Credentials) =>
            AnthropicLanguageModel.modelWithTokenizer(settings.model, {
                max_tokens:  settings.maxTokens,
                temperature: settings.temperature,
                top_k:       settings.topK,
                top_p:       settings.topP,
            }).pipe(Layer.provide(_clientLayers.anthropic(_credential(credentials, 'anthropic')))),
    },
    gemini: {
        language: (settings: typeof AiSettingsSchema.Type['language'], credentials: AiRegistry.Credentials) =>
            GoogleLanguageModel.model(settings.model, {
                generationConfig: {
                    maxOutputTokens: settings.maxTokens,
                    temperature:     settings.temperature,
                    topK:            settings.topK,
                    topP:            settings.topP,
                },
                toolConfig: {},
            }).pipe(Layer.provide(_clientLayers.gemini(_credential(credentials, 'gemini')))),
    },
    openai: {
        embedding: (settings: typeof AiSettingsSchema.Type['embedding'], credentials: AiRegistry.Credentials) =>
            Match.value(settings.mode).pipe(
                Match.when('batched', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        cache:        { capacity: settings.cacheCapacity, timeToLive: Duration.minutes(settings.cacheTtlMinutes) },
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'batched',
                    }).pipe(Layer.provide(_clientLayers.openai(_credential(credentials, 'openai')))),
                ),
                Match.when('data-loader', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'data-loader',
                        window:       Duration.millis(settings.windowMs),
                    }).pipe(Layer.provide(_clientLayers.openai(_credential(credentials, 'openai')))),
                ),
                Match.exhaustive,
            ),
        language: (settings: typeof AiSettingsSchema.Type['language'], credentials: AiRegistry.Credentials) =>
            OpenAiLanguageModel.modelWithTokenizer(settings.model, {
                max_output_tokens: settings.maxTokens,
                temperature:       settings.temperature,
                top_p:             settings.topP,
            }).pipe(Layer.provide(_clientLayers.openai(_credential(credentials, 'openai')))),
    },
} as const;

const AiRegistry = {
    applySessionOverride: (
        settings:        S.Schema.Type<typeof AiSettingsSchema>,
        sessionOverride: S.Schema.Type<typeof _SessionOverrideSchema>,
    ): S.Schema.Type<typeof AiSettingsSchema> => ({
        ...settings,
        embedding: {
            ...settings.embedding,
            model:    sessionOverride.embedding?.model    ?? settings.embedding.model,
            provider: sessionOverride.embedding?.provider ?? settings.embedding.provider,
        },
        language: {
            ...settings.language,
            fallback: sessionOverride.language?.fallback ?? settings.language.fallback,
            model:    sessionOverride.language?.model    ?? settings.language.model,
            provider: sessionOverride.language?.provider ?? settings.language.provider,
        },
    }),
    decodeAppSettings: (raw: unknown) =>
        S.decodeUnknown(S.Struct({ ai: S.optional(AiSettingsSchema) }))(raw).pipe(
            Effect.flatMap(({ ai }) => ai === undefined ? S.decodeUnknown(AiSettingsSchema)({}) : Effect.succeed(ai)),
        ),
    decodeGeminiClient: (raw: unknown) => S.decodeUnknown(_GeminiDesktopClientSchema)(raw).pipe(
        Effect.map(({ installed }) => ({
            authUri:      installed.auth_uri,
            clientId:     installed.client_id,
            clientSecret: installed.client_secret,
            projectId:    installed.project_id,
            tokenUri:     installed.token_uri,
        })),
    ),
    decodeSessionOverrideFromInput: (input: { readonly fallback: ReadonlyArray<string>; readonly model: string; readonly provider: string }) =>
        input.model === '' && input.provider === ''
            ? Effect.succeed(Option.none<AiRegistry.SessionOverride>())
            : S.decodeUnknown(_SessionOverrideSchema)({ language: { fallback: input.fallback, model: input.model, provider: input.provider } }).pipe(Effect.map(Option.some)),
    exchangeGeminiAuthorizationCode: (input: {
        readonly client:       AiRegistry.GeminiDesktopClient;
        readonly code:         string;
        readonly codeVerifier: string;
        readonly redirectUri:  string;
    }) =>
        _tokenRequest(input.client.tokenUri, {
            client_id: input.client.clientId, client_secret: input.client.clientSecret,
            code: input.code, code_verifier: input.codeVerifier,
            grant_type: 'authorization_code', redirect_uri: input.redirectUri,
        }),
    geminiAuthorizationUrl: (input: {
        readonly client:        AiRegistry.GeminiDesktopClient;
        readonly codeChallenge: string;
        readonly redirectUri:   string;
        readonly state:         string;
    }) =>
        new URL(`${input.client.authUri}?${new URLSearchParams({
            access_type: 'offline', client_id: input.client.clientId,
            code_challenge: input.codeChallenge, code_challenge_method: 'S256',
            prompt: 'consent', redirect_uri: input.redirectUri,
            response_type: 'code', scope: _ProviderCatalog.gemini.credential.scopes.join(' '),
            state: input.state,
        })}`),
    layers: (settings: S.Schema.Type<typeof AiSettingsSchema>, credentials: AiRegistry.Credentials) => ({
        embedding:        _providers[settings.embedding.provider].embedding(settings.embedding, credentials),
        fallbackLanguage: settings.language.fallback.map((provider) => _providers[provider].language({ ...settings.language, provider }, credentials)),
        language:         _providers[settings.language.provider].language(settings.language, credentials),
    }),
    OnTokenRefreshRef:   _OnTokenRefreshRef,
    providers:           _ProviderCatalog,
    refreshGeminiAccessToken: (input: { readonly client: AiRegistry.GeminiDesktopClient; readonly refreshToken: string }) =>
        _tokenRequest(input.client.tokenUri, {
            client_id: input.client.clientId, client_secret: input.client.clientSecret,
            grant_type: 'refresh_token', refresh_token: input.refreshToken,
        }),
    requiredProviders: (settings: S.Schema.Type<typeof AiSettingsSchema>) =>
        [...new Set([settings.embedding.provider, settings.language.provider, ...settings.language.fallback])] as ReadonlyArray<AiRegistry.Provider>,
    SessionOverrideRef: _SessionOverrideRef,
    schema:             AiSettingsSchema,
    toolSearchFlag:     _AnthropicToolSearchFlag,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type Credential<P extends Provider = Provider> = ({
        anthropic: { readonly kind: 'api-secret'; readonly secret: Redacted.Redacted<string> };
        gemini:    { readonly accessToken: Redacted.Redacted<string>; readonly kind: 'oauth-desktop'; readonly projectId: string };
        openai:    { readonly kind: 'api-secret'; readonly secret: Redacted.Redacted<string> };
    })[P];
    export type Credentials      = Partial<{ [P in Provider]: Credential<P> }>;
    export type GeminiDesktopClient = {
        readonly authUri:      string;
        readonly clientId:     string;
        readonly clientSecret: string;
        readonly projectId:    string;
        readonly tokenUri:     string;
    };
    export type OnTokenRefresh = (data: {
        readonly accessToken:  string;
        readonly expiresAt:    string;
        readonly refreshToken: string;
    }) => Effect.Effect<void>;
    export type Provider        = typeof AiProviderSchema.Type;
    export type SessionOverride = S.Schema.Type<typeof _SessionOverrideSchema>;
    export type Settings        = S.Schema.Type<typeof AiSettingsSchema>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
