/** biome-ignore-all assist/source/useSortedKeys: <Provider registry is grouped intentionally> */
import { EmbeddingModel } from '@effect/ai';
import * as AiSdkError from '@effect/ai/AiError';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { type Generated as GoogleGenerated, GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import { Array as A, Effect, FiberRef, Layer, Match, Option, Redacted, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const AiProviderSchema = S.Literal('anthropic', 'gemini', 'openai');
const _ModelRefBase = { model: S.NonEmptyTrimmedString, provider: AiProviderSchema };
const _LanguageModelRefSchema = S.Struct({
    ..._ModelRefBase,
    modality: S.Literal('language'),
});
const _EmbeddingModelRefSchema = S.Struct({
    ..._ModelRefBase,
    dimensions: S.Int.pipe(S.greaterThan(0), S.lessThanOrEqualTo(4_000)),
    modality:   S.Literal('embedding'),
});
const _KnowledgeSettingsSchema = S.Struct({
    maxCandidates: S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(1), S.lessThanOrEqualTo(64)), { default: () => 12 }),
    mode:          S.optionalWith(S.Literal('provider-native'), { default: () => 'provider-native' as const }),
    persistHosted: S.optionalWith(S.Boolean, { default: () => true }),
    preselect:     S.optionalWith(S.Int.pipe(S.greaterThanOrEqualTo(1), S.lessThanOrEqualTo(96)), { default: () => 24 }),
});
const _LanguageSettingsSchema = S.Struct({
    fallback:    S.optionalWith(S.Array(_LanguageModelRefSchema), { default: () => [] as Array<typeof _LanguageModelRefSchema.Type> }),
    maxTokens:   S.optionalWith(S.Int.pipe(S.greaterThan(0)), { default: () => 8_192 }),
    primary:     _LanguageModelRefSchema,
    temperature: S.optionalWith(S.Number, { default: () => 1 }),
    topK:        S.optionalWith(S.Number, { default: () => 40 }),
    topP:        S.optionalWith(S.Number, { default: () => 1 }),
});
const _EmbeddingSettingsSchema = S.Struct({ primary: _EmbeddingModelRefSchema });
const _PolicySettingsSchema = S.Struct({
    maxRequestsPerMinute: S.optionalWith(S.Int.pipe(S.greaterThan(0)), { default: () => 60 }),
    maxTokensPerDay:      S.optionalWith(S.Int.pipe(S.greaterThan(0)), { default: () => 1_000_000 }),
    maxTokensPerRequest:  S.optionalWith(S.Int.pipe(S.greaterThan(0)), { default: () => 16_384 }),
    tools:                S.optionalWith(S.Struct({
        mode:  S.Literal('allow', 'deny'),
        names: S.Array(S.String),
    }), { default: () => ({ mode: 'allow' as const, names: [] as Array<string> }) }),
});

// --- [CONSTANTS] -------------------------------------------------------------

const _ProviderCatalog = {
    anthropic: {
        capabilities: { embeddings: false, knowledge: 'web_search_or_fetch', multimodal: true, structured: 'adapter_emulated', tools: true },
        credential: { configKeys: { secret: 'AI_ANTHROPIC_API_SECRET' }, kind: 'api-secret' },
        defaultEmbeddingModel: null, defaultModel: 'claude-sonnet-4-6',
        embeddingModels: {}, languageModels: ['claude-sonnet-4-6'] as const, title: 'Anthropic (Claude)',
    },
    gemini: {
        capabilities: { embeddings: true, knowledge: 'files_or_url_context', multimodal: true, structured: 'native', tools: true },
        credential: {
            configKeys: { accessToken: 'AI_GEMINI_ACCESS_TOKEN', clientPath: 'AI_GEMINI_CLIENT_PATH', expiry: 'AI_GEMINI_TOKEN_EXPIRY', refreshToken: 'AI_GEMINI_REFRESH_TOKEN' },
            kind: 'oauth-desktop',
            scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/generative-language.retriever'],
            tokenExpiryBufferMs: 60_000,
        },
        defaultEmbeddingModel: 'gemini-embedding-001', defaultModel: 'gemini-2.5-pro',
        embeddingModels: {
            'gemini-embedding-001':       { defaultDimensions: 3_072, supportsOutputDimensionality: true },
            'gemini-embedding-2-preview': { defaultDimensions: 3_072, supportsOutputDimensionality: true },
        },
        languageModels: ['gemini-2.5-flash', 'gemini-2.5-pro'] as const, title: 'Google (Gemini)',
    },
    openai: {
        capabilities: { embeddings: true, knowledge: 'file_search', multimodal: true, structured: 'native', tools: true },
        credential: { configKeys: { secret: 'AI_OPENAI_API_SECRET' }, kind: 'api-secret' },
        defaultEmbeddingModel: 'text-embedding-3-large', defaultModel: 'gpt-5.4',
        embeddingModels: {
            'text-embedding-3-large': { defaultDimensions: 3_072, supportsOutputDimensionality: true },
            'text-embedding-3-small': { defaultDimensions: 1_536, supportsOutputDimensionality: true },
        },
        languageModels: ['gpt-4.1', 'gpt-5.4', 'gpt-5.4-mini'] as const, title: 'OpenAI',
    },
} as const;
const _DefaultSettings = {
    embedding: { primary: { dimensions: 3_072, modality: 'embedding', model: 'text-embedding-3-large', provider: 'openai' } },
    knowledge: S.decodeSync(_KnowledgeSettingsSchema)({}),
    language: {
        fallback:    [{ modality: 'language', model: 'gemini-2.5-pro', provider: 'gemini' }, { modality: 'language', model: 'claude-sonnet-4-6', provider: 'anthropic' }],
        maxTokens: 8_192, primary: { modality: 'language', model: 'gpt-5.4', provider: 'openai' }, temperature: 1, topK: 40, topP: 1,
    },
    policy: S.decodeSync(_PolicySettingsSchema)({}),
} as const satisfies { readonly embedding: typeof _EmbeddingSettingsSchema.Type; readonly knowledge: typeof _KnowledgeSettingsSchema.Type; readonly language: typeof _LanguageSettingsSchema.Type; readonly policy: typeof _PolicySettingsSchema.Type };
const AiSettingsSchema = S.Struct({
    embedding: S.optionalWith(_EmbeddingSettingsSchema, { default: () => ({ ..._DefaultSettings.embedding }) }),
    knowledge: S.optionalWith(_KnowledgeSettingsSchema, { default: () => ({ ..._DefaultSettings.knowledge }) }),
    language:  S.optionalWith(_LanguageSettingsSchema,  { default: () => ({ ..._DefaultSettings.language, fallback: [..._DefaultSettings.language.fallback], primary: { ..._DefaultSettings.language.primary } }) }),
    policy:    S.optionalWith(_PolicySettingsSchema,    { default: () => ({ ..._DefaultSettings.policy, tools: { ..._DefaultSettings.policy.tools, names: [..._DefaultSettings.policy.tools.names] } }) }),
});
const _OnTokenRefreshRef  = FiberRef.unsafeMake<Option.Option<AiRegistry.OnTokenRefresh>>(Option.none());
const _SessionOverrideRef = FiberRef.unsafeMake(Option.none<AiRegistry.SessionOverride>());
type _LanguageModelRef  = typeof _LanguageModelRefSchema.Type;
type _EmbeddingModelRef = typeof _EmbeddingModelRefSchema.Type;
type _LanguageSettings  = typeof _LanguageSettingsSchema.Type;
type _Settings          = typeof AiSettingsSchema.Type;

// --- [FUNCTIONS] -------------------------------------------------------------

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
const _normalizeLanguageRef = (ref: _LanguageModelRef) =>
    Effect.filterOrFail(
        Effect.succeed(ref),
        (value) => A.contains(_ProviderCatalog[value.provider].languageModels as ReadonlyArray<string>, value.model),
        (value) => new Error(`Unknown ${value.provider} language model id: ${value.model}`),
    ).pipe(Effect.flatMap((value) => S.decodeUnknown(_LanguageModelRefSchema)({ ...value, modality: 'language' })));
const _normalizeEmbeddingRef = (ref: _EmbeddingModelRef) => Match.value(ref.provider).pipe(
    Match.when('anthropic', () => Effect.fail(new Error('Anthropic does not expose a shared embedding model in this runtime'))),
    Match.orElse((provider: 'gemini' | 'openai') =>
        Option.fromNullable((_ProviderCatalog[provider].embeddingModels as Record<string, { readonly defaultDimensions: number; readonly supportsOutputDimensionality: boolean }>)[ref.model]).pipe(
            Option.match({
                onNone: () => Effect.fail(new Error(`Unknown ${provider} embedding model id: ${ref.model}`)),
                onSome: (model) => S.decodeUnknown(_EmbeddingModelRefSchema)({ ...ref, modality: 'embedding' }).pipe(
                    Effect.filterOrFail(
                        (decoded) => model.supportsOutputDimensionality || decoded.dimensions === model.defaultDimensions,
                        (decoded) => new Error(`Embedding model ${provider}:${decoded.model} requires ${String(model.defaultDimensions)} dimensions`),
                    )),
            }),
        )),
);
const _decodeLanguageRefText = (value: string) =>
    Effect.gen(function* () {
        const match = yield* Option.fromNullable(/^([a-z]+):(.+)$/.exec(value.trim())).pipe(
            Option.match({
                onNone: () => Effect.fail(new Error(`Invalid language model ref '${value}'. Expected 'provider:model'.`)),
                onSome: Effect.succeed,
            }),
        );
        const provider = yield* S.decodeUnknown(AiProviderSchema)(match[1] ?? '');
        return yield* _normalizeLanguageRef({
            modality: 'language',
            model:    match[2] ?? '',
            provider,
        });
    });
const _normalizeSettings = (settings: _Settings) =>
    Effect.all({
        embeddingPrimary: _normalizeEmbeddingRef(settings.embedding.primary),
        fallback:         Effect.forEach(settings.language.fallback, _normalizeLanguageRef),
        primary:          _normalizeLanguageRef(settings.language.primary),
    }).pipe(
        Effect.map(({ embeddingPrimary, fallback, primary }) => ({
            embedding: { primary: embeddingPrimary },
            knowledge: settings.knowledge,
            language:  {
                ...settings.language,
                fallback: A.reduce(fallback, [] as Array<_LanguageModelRef>, (acc, current) =>
                    A.some(acc, (existing) => existing.provider === current.provider && existing.model === current.model) || (current.provider === primary.provider && current.model === primary.model)
                        ? acc : [...acc, current]),
                primary,
            },
            policy: settings.policy,
        }) satisfies _Settings),
    );
const _embeddingTaskType = (usage: AiRegistry.EmbeddingUsage) =>
    ({ document: 'RETRIEVAL_DOCUMENT', query: 'RETRIEVAL_QUERY', similarity: 'SEMANTIC_SIMILARITY' } as const)[usage];
const _providers = {
    anthropic: {
        makeEmbeddingLayer: (_ref: _EmbeddingModelRef, _credentials: AiRegistry.Credentials, _usage: AiRegistry.EmbeddingUsage) =>
            Layer.fail(new Error('Anthropic does not expose a shared embedding adapter in this runtime')),
        makeLanguageLayer: (ref: _LanguageModelRef, settings: _LanguageSettings, credentials: AiRegistry.Credentials) =>
            AnthropicLanguageModel.modelWithTokenizer(ref.model, {
                max_tokens:  settings.maxTokens,
                temperature: settings.temperature,
                top_k:       settings.topK,
                top_p:       settings.topP,
            }).pipe(Layer.provide(_clientLayers.anthropic(_credential(credentials, 'anthropic')))),
    },
    gemini: {
        makeEmbeddingLayer: (ref: _EmbeddingModelRef, credentials: AiRegistry.Credentials, usage: AiRegistry.EmbeddingUsage) =>
            Layer.effect(EmbeddingModel.EmbeddingModel, Effect.gen(function* () {
                const client = yield* GoogleClient.GoogleClient;
                return yield* EmbeddingModel.make({
                    embedMany: (input) =>
                        client.client.BatchEmbedContents(`models/${ref.model}`, {
                            requests: A.map(input, (value) => ({
                                content: { parts: [{ text: value }], role: 'user' },
                                model:   `models/${ref.model}`,
                                outputDimensionality: ref.dimensions,
                                taskType: _embeddingTaskType(usage),
                            })),
                        }).pipe(
                            Effect.map((response: typeof GoogleGenerated.BatchEmbedContentsResponse.Type) => response.embeddings ?? []),
                            Effect.filterOrFail(
                                (embeddings) => embeddings.length === input.length,
                                () => new Error(`Gemini batch shape mismatch: ${ref.model}`),
                            ),
                            // biome-ignore lint/suspicious/useIterableCallbackReturn: Effect.forEach collects returned Effects
                            Effect.flatMap(Effect.forEach((embedding, index) =>
                                Effect.succeed(embedding.values ?? []).pipe(
                                    Effect.filterOrFail(
                                        (values) => values.length === ref.dimensions,
                                        () => new Error(`Gemini embedding dimension mismatch: ${ref.model}`),
                                    ),
                                    Effect.map((values) => ({ embeddings: [...values], index })),
                                ), { concurrency: 'unbounded' })),
                            Effect.mapError((cause) => new AiSdkError.UnknownError({ description: String(cause), method: 'BatchEmbedContents', module: 'Google' })),
                        ),
                    maxBatchSize: 96,
                });
            }).pipe(Effect.provide(_clientLayers.gemini(_credential(credentials, 'gemini'))))),
        makeLanguageLayer: (ref: _LanguageModelRef, settings: _LanguageSettings, credentials: AiRegistry.Credentials) =>
            GoogleLanguageModel.model(ref.model, {
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
        makeEmbeddingLayer: (ref: _EmbeddingModelRef, credentials: AiRegistry.Credentials, _usage: AiRegistry.EmbeddingUsage) =>
            OpenAiEmbeddingModel.layerBatched({
                config: { dimensions: ref.dimensions },
                model:  ref.model,
            }).pipe(Layer.provide(_clientLayers.openai(_credential(credentials, 'openai')))),
        makeLanguageLayer: (ref: _LanguageModelRef, settings: _LanguageSettings, credentials: AiRegistry.Credentials) =>
            OpenAiLanguageModel.modelWithTokenizer(ref.model, {
                max_output_tokens: settings.maxTokens,
                temperature:       settings.temperature,
                top_p:             settings.topP,
            }).pipe(Layer.provide(_clientLayers.openai(_credential(credentials, 'openai')))),
    },
} as const;
const AiRegistry = {
    decodeAppSettings:  (raw: unknown) => {
        const _decode = (value: unknown) => S.decodeUnknown(AiSettingsSchema)(value).pipe(
            Effect.flatMap(_normalizeSettings),
            Effect.orElse(() => _normalizeSettings(S.decodeSync(AiSettingsSchema)({}))));
        return S.decodeUnknown(S.Struct({ ai: S.optional(S.Unknown) }))(raw).pipe(
            Effect.flatMap(({ ai }) => _decode(ai ?? {})));
    },
    decodeLanguageRefText: _decodeLanguageRefText,
    embeddingIdentity: (ref: _EmbeddingModelRef) => ({ dimensions: ref.dimensions, model: ref.model, provider: ref.provider }) as const,
    embeddingLayer: (ref: _EmbeddingModelRef, credentials: AiRegistry.Credentials, usage: AiRegistry.EmbeddingUsage = 'document') =>
        _providers[ref.provider].makeEmbeddingLayer(ref, credentials, usage),
    languageLayer: (settings: _LanguageSettings, credentials: AiRegistry.Credentials) =>
        _providers[settings.primary.provider].makeLanguageLayer(settings.primary, settings, credentials),
    LanguageModelRefSchema: _LanguageModelRefSchema,
    layers: (settings: _Settings, credentials: AiRegistry.Credentials, usage: AiRegistry.EmbeddingUsage = 'document') => ({
        embedding:        AiRegistry.embeddingLayer(settings.embedding.primary, credentials, usage),
        fallbackLanguage: A.map(settings.language.fallback, (ref) => _providers[ref.provider].makeLanguageLayer(ref, settings.language, credentials)),
        language:         AiRegistry.languageLayer(settings.language, credentials),
    }),
    normalizeSettings: (settings: _Settings) => _normalizeSettings(settings),
    OnTokenRefreshRef: _OnTokenRefreshRef,
    providers:         _ProviderCatalog,
    requiredProviders: (settings: AiRegistry.Settings) =>
        A.dedupe([settings.language.primary.provider, ...settings.language.fallback.map((ref) => ref.provider), settings.embedding.primary.provider]),
    schema:             AiSettingsSchema,
    SessionOverrideRef: _SessionOverrideRef,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type Provider = keyof typeof _ProviderCatalog;
    export type EmbeddingUsage = 'document' | 'query' | 'similarity';
    export type Credential<P extends Provider = Provider> = ({
        anthropic: { readonly kind: 'api-secret'; readonly secret: Redacted.Redacted<string> };
        gemini:    { readonly accessToken: Redacted.Redacted<string>; readonly kind: 'oauth-desktop'; readonly projectId: string };
        openai:    { readonly kind: 'api-secret'; readonly secret: Redacted.Redacted<string> };
    })[P];
    export type Credentials     = Partial<{ [P in Provider]: Credential<P> }>;
    export type LanguageModelRef  = typeof _LanguageModelRefSchema.Type;
    export type EmbeddingModelRef = typeof _EmbeddingModelRefSchema.Type;
    export type OnTokenRefresh = (data: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken: string }) => Effect.Effect<void>;
    export type SessionOverride = { readonly language?: { readonly fallback: ReadonlyArray<LanguageModelRef>; readonly primary: LanguageModelRef } };
    export type Settings = typeof AiSettingsSchema.Type;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiProviderSchema, AiRegistry, AiSettingsSchema };
