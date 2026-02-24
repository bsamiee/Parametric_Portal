import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, Duration, Effect, Layer, Option, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _LanguageFactoryInput = {
    readonly maxTokens: number;
    readonly model: string;
    readonly temperature: number;
    readonly topK: number;
    readonly topP: number;
};

type _EmbeddingFactoryInput = {
    readonly cacheCapacity: number;
    readonly cacheTtlMinutes: number;
    readonly dimensions: number;
    readonly maxBatchSize: number;
    readonly model: string;
    readonly windowMs: number;
};

// --- [LAYERS] ----------------------------------------------------------------

const _anthropicClient = AnthropicClient.layerConfig({ apiKey: Config.redacted('ANTHROPIC_API_KEY') }).pipe(Layer.provide(FetchHttpClient.layer));
const _geminiClient =    GoogleClient.layerConfig({ apiKey: Config.redacted('GEMINI_API_KEY') }).pipe(Layer.provide(FetchHttpClient.layer));
const _openAiClient =    OpenAiClient.layerConfig({ apiKey: Config.redacted('OPENAI_API_KEY') }).pipe(Layer.provide(FetchHttpClient.layer));

// --- [SCHEMA] ----------------------------------------------------------------

const _openAiEmbeddingModeFactories = {
    batched: (settings: _EmbeddingFactoryInput) =>
        OpenAiEmbeddingModel.model(settings.model, {
            cache: {
                capacity:   settings.cacheCapacity,
                timeToLive: Duration.minutes(settings.cacheTtlMinutes),
            },
            dimensions:   settings.dimensions,
            maxBatchSize: settings.maxBatchSize,
            mode:         'batched',
        }).pipe(Layer.provide(_openAiClient)),
    'data-loader': (settings: _EmbeddingFactoryInput) =>
        OpenAiEmbeddingModel.model(settings.model, {
            dimensions:   settings.dimensions,
            maxBatchSize: settings.maxBatchSize,
            mode:         'data-loader',
            window:       Duration.millis(settings.windowMs),
        }).pipe(Layer.provide(_openAiClient)),
} as const;
const _providerFactories = {
    anthropic: {
        language: (settings: _LanguageFactoryInput) =>
            AnthropicLanguageModel.modelWithTokenizer(settings.model, {
                max_tokens:  settings.maxTokens,
                temperature: settings.temperature,
                top_k:       settings.topK,
                top_p:       settings.topP,
            }).pipe(Layer.provide(_anthropicClient)),
    },
    gemini: {
        language: (settings: _LanguageFactoryInput) =>
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
        embedding: _openAiEmbeddingModeFactories,
        language: (settings: _LanguageFactoryInput) =>
            OpenAiLanguageModel.modelWithTokenizer(settings.model, {
                max_output_tokens: settings.maxTokens,
                temperature: settings.temperature,
                top_p: settings.topP,
            }).pipe(Layer.provide(_openAiClient)),
    },
} as const;
const _languageProviderFactories = Object.fromEntries(
    (Object.keys(_providerFactories) as ReadonlyArray<keyof typeof _providerFactories>).map((provider) => [provider, _providerFactories[provider].language] as const),
) as {readonly [K in keyof typeof _providerFactories]: (typeof _providerFactories)[K]['language'];};
const _embeddingProviderFactories = Object.fromEntries(
    (Object.keys(_providerFactories) as ReadonlyArray<keyof typeof _providerFactories>)
        .flatMap((provider) =>
            'embedding' in _providerFactories[provider]
                ? [[provider, _providerFactories[provider].embedding] as const]
                : []),
) as {
    readonly [K in keyof typeof _providerFactories as (typeof _providerFactories)[K] extends { readonly embedding: unknown } ? K : never]:
    (typeof _providerFactories)[K] extends { readonly embedding: infer E } ? E : never;
};
const _languageProviders = Object.fromEntries(
    (Object.keys(_languageProviderFactories) as ReadonlyArray<keyof typeof _languageProviderFactories>).map((provider) => [provider, provider] as const),
) as { readonly [K in keyof typeof _languageProviderFactories]: K };
const _embeddingModes = Object.fromEntries(
    (Object.keys(_openAiEmbeddingModeFactories) as ReadonlyArray<keyof typeof _openAiEmbeddingModeFactories>).map((mode) => [mode, mode] as const),
) as { readonly [K in keyof typeof _openAiEmbeddingModeFactories]: K };
const _embeddingProviders = Object.fromEntries(
    (Object.keys(_embeddingProviderFactories) as ReadonlyArray<keyof typeof _embeddingProviderFactories>).map((provider) => [provider, provider] as const),
) as { readonly [K in keyof typeof _embeddingProviderFactories]: K };
const _SettingsSchema = S.Struct({
    embedding: S.optionalWith(
        S.Struct({
            cacheCapacity:   S.optionalWith(S.Int, { default: () => 1000 }),
            cacheTtlMinutes: S.optionalWith(S.Int, { default: () => 30 }),
            dimensions:      S.optionalWith(S.Int, { default: () => 1536 }),
            maxBatchSize:    S.optionalWith(S.Int, { default: () => 256 }),
            mode:            S.optionalWith(S.Enums(_embeddingModes), { default: () => 'batched' as const }),
            model:           S.optionalWith(S.String, { default: () => 'text-embedding-3-small' }),
            provider:        S.optionalWith(S.Enums(_embeddingProviders), { default: () => 'openai' as const }),
            windowMs:        S.optionalWith(S.Int, { default: () => 200 }),
        }),
        { default: () => ({ cacheCapacity: 1000, cacheTtlMinutes: 30, dimensions: 1536, maxBatchSize: 256, mode: 'batched' as const, model: 'text-embedding-3-small', provider: 'openai' as const, windowMs: 200 }) },
    ),
    language: S.optionalWith(
        S.Struct({
            fallback:    S.optionalWith(S.Array(S.Enums(_languageProviders)), { default: () => [] as Array<keyof typeof _languageProviderFactories> }),
            maxTokens:   S.optionalWith(S.Int, { default: () => 4096 }),
            model:       S.optionalWith(S.String, { default: () => 'gpt-4o' }),
            provider:    S.optionalWith(S.Enums(_languageProviders), { default: () => 'openai' as const }),
            temperature: S.optionalWith(S.Number, { default: () => 1 }),
            topK:        S.optionalWith(S.Number, { default: () => 40 }),
            topP:        S.optionalWith(S.Number, { default: () => 1 }),
        }),
        { default: () => ({ fallback: [] as Array<keyof typeof _languageProviderFactories>, maxTokens: 4096, model: 'gpt-4o', provider: 'openai' as const, temperature: 1, topK: 40, topP: 1 }) },
    ),
    policy: S.optionalWith(
        S.Struct({
            maxRequestsPerMinute: S.optionalWith(S.Int, { default: () => 60 }),
            maxTokensPerDay:      S.optionalWith(S.Int, { default: () => 1_000_000 }),
            maxTokensPerRequest:  S.optionalWith(S.Int, { default: () => 16384 }),
            tools:     S.optionalWith(S.Struct({
                mode:  S.Literal('allow', 'deny'),
                names: S.Array(S.String),
            }), { default: () => ({ mode: 'allow' as const, names: [] as Array<string> }) }),
        }),
        { default: () => ({ maxRequestsPerMinute: 60, maxTokensPerDay: 1_000_000, maxTokensPerRequest: 16384, tools: { mode: 'allow' as const, names: [] as Array<string> } }) },
    ),
});
const _AppSettingsSchema = S.Struct({ ai: S.optional(_SettingsSchema) });
const _languageModel = (settings: S.Schema.Type<typeof _SettingsSchema>['language']) => _languageProviderFactories[settings.provider](settings);
const _embeddingModel = (settings: S.Schema.Type<typeof _SettingsSchema>['embedding']) => _embeddingProviderFactories[settings.provider][settings.mode](settings);

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const AiRegistry = {
    decodeAppSettings: (raw: unknown) =>
        S.decodeUnknown(_AppSettingsSchema)(raw).pipe(
            Effect.flatMap((settings) =>
                Option.fromNullable(settings.ai).pipe(
                    Option.match({
                        onNone: () => S.decodeUnknown(_SettingsSchema)({}),
                        onSome: Effect.succeed,
                    }),
                ),
            ),
        ),
    layers: (settings: S.Schema.Type<typeof _SettingsSchema>) => ({
        embedding:        _embeddingModel(settings.embedding),
        fallbackLanguage: settings.language.fallback.map((provider) => _languageModel({ ...settings.language, provider }),),
        language:         _languageModel(settings.language),
        policy:           settings.policy,
    }),
    schema:               _SettingsSchema,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type Settings = S.Schema.Type<typeof _SettingsSchema>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
