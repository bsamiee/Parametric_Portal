import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, Duration, Effect, Layer, Match, Schema as S } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------

const _anthropicClient = AnthropicClient.layerConfig({ apiKey: Config.redacted('ANTHROPIC_API_KEY') }).pipe(Layer.provide(FetchHttpClient.layer));
const _geminiClient =    GoogleClient.layerConfig({    apiKey: Config.redacted('GEMINI_API_KEY')    }).pipe(Layer.provide(FetchHttpClient.layer));
const _openAiClient =    OpenAiClient.layerConfig({    apiKey: Config.redacted('OPENAI_API_KEY')    }).pipe(Layer.provide(FetchHttpClient.layer));

// --- [SCHEMA] ----------------------------------------------------------------

const _LanguageProviderSchema =  S.Literal('anthropic', 'gemini', 'openai');
const _EmbeddingSettingsSchema = S.Struct({
    cacheCapacity:   S.optionalWith(S.Int, { default: () => 1000 }),
    cacheTtlMinutes: S.optionalWith(S.Int, { default: () => 30   }),
    dimensions:      S.optionalWith(S.Int, { default: () => 1536 }),
    maxBatchSize:    S.optionalWith(S.Int, { default: () => 256  }),
    mode:            S.optionalWith(S.Literal('batched', 'data-loader'), { default: () => 'batched' as const }),
    model:           S.optionalWith(S.String, { default: () => 'text-embedding-3-small' }),
    provider:        S.optionalWith(S.Literal('openai'), { default: () => 'openai' as const }),
    windowMs:        S.optionalWith(S.Int, { default: () => 200  }),
});
const _LanguageSettingsSchema = S.Struct({
    fallback:    S.optionalWith(S.Array(_LanguageProviderSchema), { default: () => [] as Array<'anthropic' | 'gemini' | 'openai'> }),
    maxTokens:   S.optionalWith(S.Int,    { default: () => 4096 }),
    model:       S.optionalWith(S.String, { default: () => 'gpt-4o' }),
    provider:    S.optionalWith(_LanguageProviderSchema, { default: () => 'openai' as const }),
    temperature: S.optionalWith(S.Number, { default: () => 1  }),
    topK:        S.optionalWith(S.Number, { default: () => 40 }),
    topP:        S.optionalWith(S.Number, { default: () => 1  }),
});
const _PolicySettingsSchema = S.Struct({
    maxRequestsPerMinute: S.optionalWith(S.Int, { default: () => 60        }),
    maxTokensPerDay:      S.optionalWith(S.Int, { default: () => 1_000_000 }),
    maxTokensPerRequest:  S.optionalWith(S.Int, { default: () => 16384     }),
    tools: S.optionalWith(S.Struct({
        mode:  S.Literal('allow', 'deny'),
        names: S.Array(S.String),
    }), { default: () => ({ mode: 'allow' as const, names: [] as Array<string> }) }),
});
const _embeddingDefaults = S.decodeUnknownSync(_EmbeddingSettingsSchema)({});
const _languageDefaults  = S.decodeUnknownSync(_LanguageSettingsSchema)({});
const _policyDefaults    = S.decodeUnknownSync(_PolicySettingsSchema)({});
const _SettingsSchema = S.Struct({
    embedding: S.optionalWith(_EmbeddingSettingsSchema, { default: () => _embeddingDefaults }),
    language:  S.optionalWith(_LanguageSettingsSchema,  { default: () => _languageDefaults  }),
    policy:    S.optionalWith(_PolicySettingsSchema,    { default: () => _policyDefaults    }),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _providerFactories = {
    anthropic: {
        language: (settings: typeof _LanguageSettingsSchema.Type) =>
            AnthropicLanguageModel.modelWithTokenizer(settings.model, {
                max_tokens:  settings.maxTokens,
                temperature: settings.temperature,
                top_k:       settings.topK,
                top_p:       settings.topP,
            }).pipe(Layer.provide(_anthropicClient)),
    },
    gemini: {
        language: (settings: typeof _LanguageSettingsSchema.Type) =>
            GoogleLanguageModel.model(settings.model, {
                generationConfig: {
                    maxOutputTokens: settings.maxTokens,
                    temperature:     settings.temperature,
                    topK:            settings.topK,
                    topP:            settings.topP,
                },
                toolConfig: {},
            }).pipe(Layer.provide(_geminiClient)),
    },
    openai: {
        embedding: (settings: typeof _EmbeddingSettingsSchema.Type) =>
            Match.value(settings.mode).pipe(
                Match.when('batched', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        cache:        { capacity: settings.cacheCapacity, timeToLive: Duration.minutes(settings.cacheTtlMinutes) },
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'batched',
                    }).pipe(Layer.provide(_openAiClient)),
                ),
                Match.when('data-loader', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'data-loader',
                        window:       Duration.millis(settings.windowMs),
                    }).pipe(Layer.provide(_openAiClient)),
                ),
                Match.exhaustive,
            ),
        language: (settings: typeof _LanguageSettingsSchema.Type) =>
            OpenAiLanguageModel.modelWithTokenizer(settings.model, {
                max_output_tokens: settings.maxTokens,
                temperature:       settings.temperature,
                top_p:             settings.topP,
            }).pipe(Layer.provide(_openAiClient)),
    },
} as const;

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const AiRegistry = {
    decodeAppSettings: (raw: unknown) =>
        S.decodeUnknown(S.Struct({ ai: S.optional(_SettingsSchema) }))(raw).pipe(
            Effect.flatMap(({ ai }) => ai === undefined ? S.decodeUnknown(_SettingsSchema)({}) : Effect.succeed(ai)),
        ),
    layers: (settings: S.Schema.Type<typeof _SettingsSchema>) => ({
        embedding:        _providerFactories[settings.embedding.provider].embedding(settings.embedding),
        fallbackLanguage: settings.language.fallback.map((provider) => _providerFactories[provider].language({ ...settings.language, provider })),
        language:         _providerFactories[settings.language.provider].language(settings.language),
    }),
    schema: _SettingsSchema,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type Settings = S.Schema.Type<typeof _SettingsSchema>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
