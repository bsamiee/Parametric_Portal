/**
 * Effect AI Google Gemini integration layer.
 * Factory-based provider with consumer-defined model selection.
 */
import { LanguageModel, type Prompt } from '@effect/ai';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { FetchHttpClient } from '@effect/platform';
import { Config, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ProviderConfig = {
    readonly model: string;
};

type GenerateTextOptions = {
    readonly prompt: Prompt.RawInput;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {},
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createLayers = (config: ProviderConfig) => {
    const HttpLive = FetchHttpClient.layer;
    const ClientLive = GoogleClient.layerConfig({
        apiKey: Config.redacted('GEMINI_API_KEY'),
    }).pipe(Layer.provide(HttpLive));
    const ModelLive = GoogleLanguageModel.model(config.model).pipe(Layer.provide(ClientLive));
    return { ClientLive, ModelLive };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createProvider = (config: ProviderConfig) => {
    const { ModelLive } = createLayers(config);
    return {
        generateText: (options: GenerateTextOptions) =>
            pipe(
                LanguageModel.generateText({ prompt: options.prompt }),
                Effect.map((response) => response.text),
                Effect.provide(ModelLive),
            ),
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as GEMINI_DEFAULTS, createProvider };
export type { GenerateTextOptions, ProviderConfig };
