/**
 * Effect AI Anthropic integration layer.
 * Native Effect-based client with cached Layer and type-safe model selection.
 */
import { LanguageModel, type Prompt } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { FetchHttpClient } from '@effect/platform';
import { Config, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type GenerateTextOptions = {
    readonly maxTokens?: number;
    readonly prompt: Prompt.RawInput;
    readonly system?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { maxTokens: 4096 },
    model: 'claude-sonnet-4-20250514',
} as const);

// --- [LAYERS] ----------------------------------------------------------------

const HttpLive = FetchHttpClient.layer;
const AnthropicLive = AnthropicClient.layerConfig({ apiKey: Config.redacted('ANTHROPIC_API_KEY') }).pipe(
    Layer.provide(HttpLive),
);
const ModelLive = AnthropicLanguageModel.model(
    B.model,
    // biome-ignore lint/style/useNamingConvention: Anthropic SDK requires snake_case
    { max_tokens: B.defaults.maxTokens },
).pipe(Layer.provide(AnthropicLive));

// --- [ENTRY_POINT] -----------------------------------------------------------

const generateText = (options: GenerateTextOptions) =>
    pipe(
        LanguageModel.generateText({ prompt: options.prompt }),
        AnthropicLanguageModel.withConfigOverride({
            // biome-ignore lint/style/useNamingConvention: Anthropic SDK requires snake_case
            max_tokens: options.maxTokens ?? B.defaults.maxTokens,
            system: options.system,
        }),
        Effect.map((response) => response.text),
        Effect.provide(ModelLive),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { AnthropicLive, B as AI_TUNING, generateText, ModelLive };
export type { GenerateTextOptions };
