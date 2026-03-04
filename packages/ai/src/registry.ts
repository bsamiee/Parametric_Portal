import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiEmbeddingModel, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { AiProviderSchema, AiSettingsSchema } from '@parametric-portal/database/models';
import { Config, Duration, Effect, FiberRef, Layer, Match, Option, Schema as S } from 'effect';

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

// --- [CONSTANTS] -------------------------------------------------------------

const _clients = {
    anthropic: AnthropicClient.layerConfig({ apiKey: Config.redacted('ANTHROPIC_API_KEY') }).pipe(Layer.provide(FetchHttpClient.layer)),
    gemini:    GoogleClient.layerConfig({    apiKey: Config.redacted('GEMINI_API_KEY')    }).pipe(Layer.provide(FetchHttpClient.layer)),
    openai:    OpenAiClient.layerConfig({    apiKey: Config.redacted('OPENAI_API_KEY')    }).pipe(Layer.provide(FetchHttpClient.layer)),
} as const;
const _SessionOverrideRef = FiberRef.unsafeMake(Option.none<S.Schema.Type<typeof _SessionOverrideSchema>>());
const _AnthropicToolSearchFlag = 'provider.anthropic.tool_search' as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _providers = {
    anthropic: {
        language: (settings: typeof AiSettingsSchema.Type['language']) =>
            AnthropicLanguageModel.modelWithTokenizer(settings.model, {
                max_tokens:  settings.maxTokens,
                temperature: settings.temperature,
                top_k:       settings.topK,
                top_p:       settings.topP,
            }).pipe(Layer.provide(_clients.anthropic)),
    },
    gemini: {
        language: (settings: typeof AiSettingsSchema.Type['language']) =>
            GoogleLanguageModel.model(settings.model, {
                generationConfig: {
                    maxOutputTokens: settings.maxTokens,
                    temperature:     settings.temperature,
                    topK:            settings.topK,
                    topP:            settings.topP,
                },
                toolConfig: {},
            }).pipe(Layer.provide(_clients.gemini)),
    },
    openai: {
        embedding: (settings: typeof AiSettingsSchema.Type['embedding']) =>
            Match.value(settings.mode).pipe(
                Match.when('batched', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        cache:        { capacity: settings.cacheCapacity, timeToLive: Duration.minutes(settings.cacheTtlMinutes) },
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'batched',
                    }).pipe(Layer.provide(_clients.openai)),
                ),
                Match.when('data-loader', () =>
                    OpenAiEmbeddingModel.model(settings.model, {
                        dimensions:   settings.dimensions,
                        maxBatchSize: settings.maxBatchSize,
                        mode:         'data-loader',
                        window:       Duration.millis(settings.windowMs),
                    }).pipe(Layer.provide(_clients.openai)),
                ),
                Match.exhaustive,
            ),
        language: (settings: typeof AiSettingsSchema.Type['language']) =>
            OpenAiLanguageModel.modelWithTokenizer(settings.model, {
                max_output_tokens: settings.maxTokens,
                temperature:       settings.temperature,
                top_p:             settings.topP,
            }).pipe(Layer.provide(_clients.openai)),
    },
} as const;

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const AiRegistry = {
    applySessionOverride: (
        settings:        S.Schema.Type<typeof AiSettingsSchema>,
        sessionOverride: S.Schema.Type<typeof _SessionOverrideSchema>,
    ): S.Schema.Type<typeof AiSettingsSchema> => ({
        ...settings,
        embedding: {
            ...settings.embedding,
            model:    sessionOverride.embedding?.model ?? settings.embedding.model,
            provider: sessionOverride.embedding?.provider ?? settings.embedding.provider,
        },
        language: {
            ...settings.language,
            fallback: sessionOverride.language?.fallback ?? settings.language.fallback,
            model:    sessionOverride.language?.model ?? settings.language.model,
            provider: sessionOverride.language?.provider ?? settings.language.provider,
        },
    }),
    decodeAppSettings: (raw: unknown) =>
        S.decodeUnknown(S.Struct({ ai: S.optional(AiSettingsSchema) }))(raw).pipe(
            Effect.flatMap(({ ai }) => ai === undefined ? S.decodeUnknown(AiSettingsSchema)({}) : Effect.succeed(ai)),
        ),
    decodeSessionOverride: (raw: unknown) => S.decodeUnknown(_SessionOverrideSchema)(raw),
    layers: (settings: S.Schema.Type<typeof AiSettingsSchema>) => ({
        embedding:        _providers[settings.embedding.provider].embedding(settings.embedding),
        fallbackLanguage: settings.language.fallback.map((provider) => _providers[provider].language({ ...settings.language, provider })),
        language:         _providers[settings.language.provider].language(settings.language),
    }),
    resolveDiscovery: (settings: S.Schema.Type<typeof AiSettingsSchema>) => ({
        anthropicToolSearchEnabled: settings.language.provider === 'anthropic'
            && settings.policy.tools.mode === 'allow'
            && settings.policy.tools.names.includes(_AnthropicToolSearchFlag),
        provider: settings.language.provider,
    }),
    SessionOverrideRef: _SessionOverrideRef,
    schema:             AiSettingsSchema,
    toolSearchFlag:     _AnthropicToolSearchFlag,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace AiRegistry {
    export type SessionOverride = S.Schema.Type<typeof _SessionOverrideSchema>;
    export type Settings        = S.Schema.Type<typeof AiSettingsSchema>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiRegistry };
