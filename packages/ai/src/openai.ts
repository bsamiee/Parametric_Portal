/**
 * Effect AI OpenAI integration layer.
 * Factory-based provider with consumer-defined model selection.
 */
import { LanguageModel, type Prompt } from '@effect/ai';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ProviderConfig = {
    readonly model: string;
};

type GenerateTextOptions = {
    readonly prompt: Prompt.RawInput;
    readonly system?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {},
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createLayers = (config: ProviderConfig) => {
    const HttpLive = FetchHttpClient.layer;
    const ClientLive = OpenAiClient.layerConfig({
        apiKey: Config.redacted('OPENAI_API_KEY'),
    }).pipe(Layer.provide(HttpLive));
    const ModelLive = OpenAiLanguageModel.model(config.model).pipe(Layer.provide(ClientLive));
    return { ClientLive, ModelLive };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createProvider = (config: ProviderConfig) => {
    const { ModelLive } = createLayers(config);
    return {
        generateText: (options: GenerateTextOptions) =>
            pipe(
                LanguageModel.generateText({ prompt: options.prompt }),
                options.system
                    ? OpenAiLanguageModel.withConfigOverride({ instructions: options.system })
                    : (effect) => effect,
                Effect.map((response) => response.text),
                Effect.provide(ModelLive),
            ),
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as OPENAI_DEFAULTS, createProvider };
export type { GenerateTextOptions, ProviderConfig };
