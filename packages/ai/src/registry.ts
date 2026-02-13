import { AnthropicClient, AnthropicLanguageModel, AnthropicTokenizer } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel, OpenAiTokenizer } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, Duration, Effect, Layer, Match, Option, Redacted, Schema as S } from 'effect';
import { pipe } from 'effect/Function';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    defaults: {
        embedding: {
            cacheCapacity: 1000,
            cacheTtlMinutes: 30,
            dimensions: 1536,
            maxBatchSize: 256,
            mode: 'batched',
            model: 'text-embedding-3-small',
            provider: 'openai',
            windowMs: 200,
        },
        language: { fallback: [], maxTokens: 4096, model: 'gpt-4o', provider: 'openai', temperature: 1, topK: 40, topP: 1 },
        policy: {
            maxRequestsPerMinute: 60,
            maxTokensPerDay: 1_000_000,
            maxTokensPerRequest: 16384,
            tools: { mode: 'allow' as const, names: [] as Array<string> },
        },
    },
    embeddingDimensions: {
        'text-embedding-3-large': 3072,
        'text-embedding-3-small': 1536,
        'text-embedding-ada-002': 1536,
    },
    envKeys: { anthropic: 'ANTHROPIC_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' },
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const AiRegistry = (() => {
    // --- [SCHEMA] -----------------------------------------------------------
    const SettingsSchema = S.Struct({
        embedding: S.optionalWith(
            S.Struct({
                cacheCapacity:   S.optionalWith(S.Int, { default: () => _CONFIG.defaults.embedding.cacheCapacity }),
                cacheTtlMinutes: S.optionalWith(S.Int, { default: () => _CONFIG.defaults.embedding.cacheTtlMinutes }),
                dimensions:      S.optionalWith(S.Int, { default: () => _CONFIG.defaults.embedding.dimensions }),
                maxBatchSize:    S.optionalWith(S.Int, { default: () => _CONFIG.defaults.embedding.maxBatchSize }),
                mode:            S.optionalWith(S.Literal('batched', 'data-loader'), {default: () => _CONFIG.defaults.embedding.mode,}),
                model:           S.optionalWith(S.String, { default: () => _CONFIG.defaults.embedding.model }),
                provider:        S.optionalWith(S.Literal('openai'), { default: () => _CONFIG.defaults.embedding.provider }),
                windowMs:        S.optionalWith(S.Int, { default: () => _CONFIG.defaults.embedding.windowMs }),
            }),
            { default: () =>    _CONFIG.defaults.embedding },
        ),
        language: S.optionalWith(
            S.Struct({
                fallback:        S.optionalWith(S.Array(S.Literal('anthropic', 'gemini', 'openai')), { default: () => _CONFIG.defaults.language.fallback }),
                maxTokens:       S.optionalWith(S.Int, { default: () => _CONFIG.defaults.language.maxTokens }),
                model:           S.optionalWith(S.String, { default: () => _CONFIG.defaults.language.model }),
                provider:        S.optionalWith(S.Literal('anthropic', 'gemini', 'openai'), {default: () => _CONFIG.defaults.language.provider,}),
                temperature:     S.optionalWith(S.Number, { default: () => _CONFIG.defaults.language.temperature }),
                topK:            S.optionalWith(S.Number, { default: () => _CONFIG.defaults.language.topK }),
                topP:            S.optionalWith(S.Number, { default: () => _CONFIG.defaults.language.topP }),
            }),
            { default: () =>    _CONFIG.defaults.language },
        ),
        policy: S.optionalWith(
            S.Struct({
                maxRequestsPerMinute: S.optionalWith(S.Int, { default: () => _CONFIG.defaults.policy.maxRequestsPerMinute }),
                maxTokensPerDay:      S.optionalWith(S.Int, { default: () => _CONFIG.defaults.policy.maxTokensPerDay }),
                maxTokensPerRequest:  S.optionalWith(S.Int, { default: () => _CONFIG.defaults.policy.maxTokensPerRequest }),
                tools: S.optionalWith(S.Struct({
                    mode:  S.Literal('allow', 'deny'),
                    names: S.Array(S.String),
                }), { default: () => _CONFIG.defaults.policy.tools }),
            }),
            { default: () => _CONFIG.defaults.policy },
        ),
    });
    const AppSettingsSchema =    S.Struct({ ai: S.optional(SettingsSchema) });
    // --- [LAYERS] ------------------------------------------------------------
    const httpLayer = FetchHttpClient.layer;
    const apiKeyConfig = (envKey: string, apiKey?: string) => apiKey === undefined ? Config.redacted(envKey) : Config.succeed(Redacted.make(apiKey));
    const clientLayers = {
        anthropic: (apiKey?: string) => AnthropicClient.layerConfig({ apiKey: apiKeyConfig(_CONFIG.envKeys.anthropic, apiKey) }).pipe(Layer.provide(httpLayer),),
        gemini: (apiKey?: string) => GoogleClient.layerConfig({ apiKey: apiKeyConfig(_CONFIG.envKeys.gemini, apiKey) }).pipe(Layer.provide(httpLayer),),
        openai: (apiKey?: string) => OpenAiClient.layerConfig({ apiKey: apiKeyConfig(_CONFIG.envKeys.openai, apiKey) }).pipe(Layer.provide(httpLayer),),
    } as const;
    const languageLayer = (settings: S.Schema.Type<typeof SettingsSchema>['language']) =>
        Match.value(settings.provider).pipe(
            Match.when('anthropic', () =>
                AnthropicLanguageModel.layerWithTokenizer({
                    config: {
                        max_tokens: settings.maxTokens,
                        temperature: settings.temperature,
                        top_k: settings.topK,
                        top_p: settings.topP,
                    },
                    model: settings.model,
                }).pipe(Layer.provide(clientLayers.anthropic())),
            ),
            Match.when('gemini', () =>
                GoogleLanguageModel.layer({
                    config: {
                        generationConfig: {
                            maxOutputTokens: settings.maxTokens,
                            temperature: settings.temperature,
                            topK: settings.topK,
                            topP: settings.topP,
                        },
                        toolConfig: {},
                    },
                    model: settings.model,
                }).pipe(Layer.provide(clientLayers.gemini())),
            ),
            Match.when('openai', () =>
                OpenAiLanguageModel.layerWithTokenizer({
                    config: {
                        max_output_tokens: settings.maxTokens,
                        temperature: settings.temperature,
                        top_p: settings.topP,
                    },
                    model: settings.model,
                }).pipe(Layer.provide(clientLayers.openai())),
            ),
            Match.exhaustive,
        );
    const embeddingLayer = (settings: S.Schema.Type<typeof SettingsSchema>['embedding']) =>
        Match.value(settings.mode).pipe(
            Match.when('batched', () =>
                OpenAiEmbeddingModel.layerBatched({
                    config: {
                        cache: {
                            capacity: settings.cacheCapacity,
                            timeToLive: Duration.minutes(settings.cacheTtlMinutes),
                        },
                        dimensions: settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                    },
                    model: settings.model,
                }).pipe(Layer.provide(clientLayers.openai())),
            ),
            Match.when('data-loader', () =>
                OpenAiEmbeddingModel.layerDataLoader({
                    config: {
                        dimensions: settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        window: Duration.millis(settings.windowMs),
                    },
                    model: settings.model,
                }).pipe(Layer.provide(clientLayers.openai())),
            ),
            Match.exhaustive,
        );
    const tokenizerLayer = (settings: S.Schema.Type<typeof SettingsSchema>['language']) =>
        Match.value(settings.provider).pipe(
            Match.when('anthropic', () => AnthropicTokenizer.layer),
            Match.when('openai', () => OpenAiTokenizer.layer({ model: settings.model })),
            Match.when('gemini', () => Layer.empty),
            Match.exhaustive,
        );
    // --- [PURE_FUNCTIONS] ----------------------------------------------------
    const resolveEmbeddingDimensions = (model: string, dimensions?: number): number =>
        pipe(
            Option.fromNullable(dimensions),
            Option.orElse(() =>
                pipe(
                    model,
                    Option.liftPredicate((key): key is keyof typeof _CONFIG.embeddingDimensions => Object.hasOwn(_CONFIG.embeddingDimensions, key),),
                    Option.map((key) => _CONFIG.embeddingDimensions[key]),
                ),
            ),
            Option.getOrElse(() => _CONFIG.defaults.embedding.dimensions),
        );
    const normalizeEmbedding = (settings: S.Schema.Type<typeof SettingsSchema>['embedding']) => ({
        ...settings,
        dimensions: resolveEmbeddingDimensions(settings.model, settings.dimensions),
    });
    const decodeSettings = (raw: unknown) =>
        S.decodeUnknown(SettingsSchema)(raw).pipe(
            Effect.map((settings) => ({
                ...settings,
                embedding: normalizeEmbedding(settings.embedding),
            })),
        );
    const decodeAppSettings = (raw: unknown) =>
        S.decodeUnknown(AppSettingsSchema)(raw).pipe(
            Effect.map((settings) => settings.ai ?? _CONFIG.defaults),
            Effect.flatMap(decodeSettings),
        );
    const fallbackLanguageLayers = (settings: S.Schema.Type<typeof SettingsSchema>) =>
        settings.language.fallback.map((provider) => languageLayer({ ...settings.language, provider }));
    const layers = (settings: S.Schema.Type<typeof SettingsSchema>) => {
        const embedding = normalizeEmbedding(settings.embedding);
        return {
            embedding: embeddingLayer(embedding),
            fallbackLanguage: fallbackLanguageLayers(settings),
            language: languageLayer(settings.language),
            policy: settings.policy,
            tokenizer: tokenizerLayer(settings.language),
        } as const;
    };
    return {
        decodeAppSettings,
        layers,
        schema: SettingsSchema,
    } as const;
})();

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
