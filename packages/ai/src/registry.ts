/**
 * AI provider registry: Thin abstraction over @effect/ai library.
 * Exposes configurable Model factories with proper Layer composition.
 *
 * Pattern: Consumers use `LanguageModel.generateObject()` directly,
 * then `Effect.provide(getModel(provider))` or `Effect.provide(createModelLayer(provider, config))`.
 */
import { AiError, LanguageModel, Prompt } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, Layer } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AiProviderType = 'anthropic' | 'gemini' | 'openai';
type AiModelConfig = {
    readonly maxTokens?: number;
    readonly model?: string;
    readonly temperature?: number;
    readonly topK?: number;
    readonly topP?: number;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        anthropic: { maxTokens: 6000, model: 'claude-sonnet-4-20250514', temperature: 1 },
        gemini: { maxTokens: 4096, model: 'gemini-2.0-flash', temperature: 1 },
        openai: { maxTokens: 4096, model: 'gpt-4o', temperature: 1 },
    },
    envKeys: {
        anthropic: 'ANTHROPIC_API_KEY',
        gemini: 'GEMINI_API_KEY',
        openai: 'OPENAI_API_KEY',
    },
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const HttpLayer = FetchHttpClient.layer;
const clientFactories = {
    anthropic: () =>
        AnthropicClient.layerConfig({ apiKey: Config.redacted(B.envKeys.anthropic) }).pipe(Layer.provide(HttpLayer)),
    gemini: () =>
        GoogleClient.layerConfig({ apiKey: Config.redacted(B.envKeys.gemini) }).pipe(Layer.provide(HttpLayer)),
    openai: () =>
        OpenAiClient.layerConfig({ apiKey: Config.redacted(B.envKeys.openai) }).pipe(Layer.provide(HttpLayer)),
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createAnthropicModel = (config?: AiModelConfig) => {
    const d = B.defaults.anthropic;
    return AnthropicLanguageModel.model(config?.model ?? d.model, {
        max_tokens: config?.maxTokens ?? d.maxTokens,
        ...(config?.temperature !== undefined && { temperature: config.temperature }),
        ...(config?.topK !== undefined && { top_k: config.topK }),
        ...(config?.topP !== undefined && { top_p: config.topP }),
    }).pipe(Layer.provide(clientFactories.anthropic()));
};
const createOpenAiModel = (config?: AiModelConfig) => {
    const d = B.defaults.openai;
    return OpenAiLanguageModel.model(config?.model ?? d.model, {
        max_output_tokens: config?.maxTokens ?? d.maxTokens,
        ...(config?.temperature !== undefined && { temperature: config.temperature }),
        ...(config?.topP !== undefined && { top_p: config.topP }),
    }).pipe(Layer.provide(clientFactories.openai()));
};
const createGeminiModel = (config?: AiModelConfig) => {
    const d = B.defaults.gemini;
    return GoogleLanguageModel.model(config?.model ?? d.model, {
        generationConfig: {
            maxOutputTokens: config?.maxTokens ?? d.maxTokens,
            ...(config?.temperature !== undefined && { temperature: config.temperature }),
            ...(config?.topK !== undefined && { topK: config.topK }),
            ...(config?.topP !== undefined && { topP: config.topP }),
        },
        toolConfig: {},
    }).pipe(Layer.provide(clientFactories.gemini()));
};
const modelCreators = {
    anthropic: createAnthropicModel,
    gemini: createGeminiModel,
    openai: createOpenAiModel,
} as const;
/** Build prompt with optional system message using library combinator. */
const buildPrompt = (userPrompt: Prompt.RawInput, system?: string): Prompt.Prompt =>
    system === undefined ? Prompt.make(userPrompt) : Prompt.make(userPrompt).pipe(Prompt.setSystem(system));
/** Model Layer type inferred from factory functions. Provides LanguageModel, may fail with ConfigError. */
type AiModelLayer = ReturnType<typeof createAnthropicModel>;

// --- [ENTRY_POINT] -----------------------------------------------------------

/** Create model Layer with optional config override. */
const createModelLayer = (provider: AiProviderType, config?: AiModelConfig): AiModelLayer =>
    modelCreators[provider](config);
/** Default model Layer for provider (uses B.defaults). */
const getModel = (provider: AiProviderType): AiModelLayer => createModelLayer(provider);

// --- [EXPORT] ----------------------------------------------------------------

export { AiError, B as AI_TUNING, buildPrompt, createModelLayer, getModel, LanguageModel, Prompt };
export type { AiModelConfig, AiModelLayer, AiProviderType };
