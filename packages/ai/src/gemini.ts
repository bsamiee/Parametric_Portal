/**
 * Effect AI Google Gemini integration layer.
 * Factory-based provider with consumer-defined model selection.
 *
 * Limitation: @effect/ai-google does not support withConfigOverride.
 * - maxTokens: Set at provider creation only (not per-request)
 * - system: Prepended to prompt content as workaround
 */
import { LanguageModel, Prompt } from '@effect/ai';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { FetchHttpClient } from '@effect/platform';
import { Config, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ProviderConfig = {
    readonly model: string;
    readonly maxTokens?: number;
};

type GenerateTextOptions = {
    readonly prompt: Prompt.RawInput;
    readonly system?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { maxOutputTokens: 4096 },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createLayers = (config: ProviderConfig) => {
    const HttpLive = FetchHttpClient.layer;
    const ClientLive = GoogleClient.layerConfig({
        apiKey: Config.redacted('GEMINI_API_KEY'),
    }).pipe(Layer.provide(HttpLive));
    const ModelLive = GoogleLanguageModel.model(config.model, {
        generationConfig: {
            maxOutputTokens: config.maxTokens ?? B.defaults.maxOutputTokens,
        },
        toolConfig: {},
    }).pipe(Layer.provide(ClientLive));
    return { ClientLive, ModelLive };
};

const buildPrompt = (options: GenerateTextOptions): Prompt.Prompt =>
    options.system !== undefined
        ? Prompt.make([Prompt.systemMessage({ content: options.system }), ...Prompt.make(options.prompt).content])
        : Prompt.make(options.prompt);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createProvider = (config: ProviderConfig) => {
    const { ModelLive } = createLayers(config);
    return {
        generateText: (options: GenerateTextOptions) =>
            pipe(
                LanguageModel.generateText({ prompt: buildPrompt(options) }),
                Effect.map((response) => response.text),
                Effect.provide(ModelLive),
            ),
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as GEMINI_DEFAULTS, createProvider };
export type { GenerateTextOptions, ProviderConfig };
