/**
 * Effect AI Anthropic integration layer.
 * Factory-based provider with consumer-defined model selection.
 */
import { LanguageModel, type Prompt } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { FetchHttpClient } from '@effect/platform';
import { Config, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ProviderConfig = {
    readonly model: string;
    readonly maxTokens?: number;
};
type GenerateTextOptions = {
    readonly maxTokens?: number;
    readonly prompt: Prompt.RawInput;
    readonly system?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { maxTokens: 4096 },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createLayers = (config: ProviderConfig) => {
    const HttpLive = FetchHttpClient.layer;
    const ClientLive = AnthropicClient.layerConfig({
        apiKey: Config.redacted('ANTHROPIC_API_KEY'),
    }).pipe(Layer.provide(HttpLive));
    const ModelLive = AnthropicLanguageModel.model(config.model, {
        // biome-ignore lint/style/useNamingConvention: Anthropic SDK requires snake_case
        max_tokens: config.maxTokens ?? B.defaults.maxTokens,
    }).pipe(Layer.provide(ClientLive));
    return { ClientLive, ModelLive };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createProvider = (config: ProviderConfig) => {
    const { ModelLive } = createLayers(config);
    return {
        generateText: (options: GenerateTextOptions) =>
            pipe(
                LanguageModel.generateText({ prompt: options.prompt }),
                AnthropicLanguageModel.withConfigOverride({
                    // biome-ignore lint/style/useNamingConvention: Anthropic SDK requires snake_case
                    max_tokens: options.maxTokens ?? config.maxTokens ?? B.defaults.maxTokens,
                    system: options.system,
                }),
                Effect.map((response) => response.text),
                Effect.provide(ModelLive),
            ),
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as ANTHROPIC_DEFAULTS, createProvider };
export type { GenerateTextOptions, ProviderConfig };
