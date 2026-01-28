/**
 * AI provider registry: Thin abstraction over @effect/ai library.
 * Exposes configurable Model factories with proper Layer composition.
 *
 * Pattern: Consumers use `LanguageModel.generateObject()` directly,
 * then `Effect.provide(getModel(provider))` or `Effect.provide(createModelLayer(provider, config))`.
 *
 * Tool/Toolkit: Structured function calling with typed handlers.
 * - Tool.make() defines callable functions with Schema-validated parameters
 * - Toolkit.make() composes tools for LanguageModel.generateText({ toolkit })
 */
import { Prompt, Tool, Toolkit } from '@effect/ai';
import { AnthropicClient, AnthropicLanguageModel } from '@effect/ai-anthropic';
import { GoogleClient, GoogleLanguageModel } from '@effect/ai-google';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { FetchHttpClient } from '@effect/platform';
import { Config, type Effect, Layer, Redacted, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AiModelConfig = {
    readonly apiKey?: string;
    readonly maxTokens?: number;
    readonly model?: string;
    readonly temperature?: number;
    readonly topK?: number;
    readonly topP?: number;
};

// --- [PRIVATE_SCHEMAS] -------------------------------------------------------

const _AiProvider = S.Literal('anthropic', 'gemini', 'openai');
type _AiProvider = typeof _AiProvider.Type;

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
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
} as const;

// --- [DISPATCH_TABLES] -------------------------------------------------------

const HttpLayer = FetchHttpClient.layer;
const makeApiKeyConfig = (envKey: string, apiKey?: string) =>
    apiKey === undefined ? Config.redacted(envKey) : Config.succeed(Redacted.make(apiKey));
const clientFactories = {
    anthropic: (apiKey?: string) =>
        AnthropicClient.layerConfig({ apiKey: makeApiKeyConfig(B.envKeys.anthropic, apiKey) }).pipe(
            Layer.provide(HttpLayer),
        ),
    gemini: (apiKey?: string) =>
        GoogleClient.layerConfig({ apiKey: makeApiKeyConfig(B.envKeys.gemini, apiKey) }).pipe(Layer.provide(HttpLayer)),
    openai: (apiKey?: string) =>
        OpenAiClient.layerConfig({ apiKey: makeApiKeyConfig(B.envKeys.openai, apiKey) }).pipe(Layer.provide(HttpLayer)),
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createAnthropicModel = (config?: AiModelConfig) => {
    const d = B.defaults.anthropic;
    return AnthropicLanguageModel.model(config?.model ?? d.model, {
        max_tokens: config?.maxTokens ?? d.maxTokens,
        ...(config?.temperature !== undefined && { temperature: config.temperature }),
        ...(config?.topK !== undefined && { top_k: config.topK }),
        ...(config?.topP !== undefined && { top_p: config.topP }),
    }).pipe(Layer.provide(clientFactories.anthropic(config?.apiKey)));
};
const createOpenAiModel = (config?: AiModelConfig) => {
    const d = B.defaults.openai;
    return OpenAiLanguageModel.model(config?.model ?? d.model, {
        max_output_tokens: config?.maxTokens ?? d.maxTokens,
        ...(config?.temperature !== undefined && { temperature: config.temperature }),
        ...(config?.topP !== undefined && { top_p: config.topP }),
    }).pipe(Layer.provide(clientFactories.openai(config?.apiKey)));
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
    }).pipe(Layer.provide(clientFactories.gemini(config?.apiKey)));
};
const modelCreators = {
    anthropic: createAnthropicModel,
    gemini: createGeminiModel,
    openai: createOpenAiModel,
} as const;
/** Build prompt with optional system message using library combinator. */
const buildPrompt = (userPrompt: Prompt.RawInput, system?: string): Prompt.Prompt =>
    system === undefined ? Prompt.make(userPrompt) : Prompt.make(userPrompt).pipe(Prompt.setSystem(system));
/** #TODO: FIX NAMNG OF THIS TO NOT BE CONFUSING. Model Layer type inferred from factory functions. Provides LanguageModel, may fail with ConfigError. */
type AiModelLayer = ReturnType<typeof createAnthropicModel>;

// --- [TOOL_BUILDERS] ---------------------------------------------------------

const createTool = <
    N extends string,
    P extends Record<string, S.Schema.Any>,
    Success extends S.Schema.Any = typeof S.Void,
    Failure extends S.Schema.All = typeof S.Never,
>(
    name: N,
    options: {
        readonly description: string;
        readonly failure?: Failure;
        readonly parameters?: P;
        readonly success?: Success;
    },
) =>
    Tool.make(name, {
        description: options.description,
        failure: options.failure ?? S.Never,
        parameters: options.parameters ?? {},
        success: options.success ?? S.Void,
    });
/** Compose multiple tools into a Toolkit for use with LanguageModel.generateText(). The model can call any tool in the toolkit based on the prompt. */
const composeToolkit = <T extends ReadonlyArray<Tool.Any>>(...tools: T) => Toolkit.make(...tools);
/** Create a tool handler Layer for a single tool. Handlers define the actual implementation that runs when the model calls a tool. */
const createToolHandlers = <Tools extends Record<string, Tool.Any>>(
    toolkit: Toolkit.Toolkit<Tools>,
    build: Effect.Effect<Toolkit.HandlersFrom<Tools>, never, never> | Toolkit.HandlersFrom<Tools>,
) => toolkit.toLayer(build);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createModelLayer = (provider: _AiProvider, config?: AiModelConfig): AiModelLayer =>
    modelCreators[provider](config);
const getModel = (provider: _AiProvider, config?: AiModelConfig): AiModelLayer => createModelLayer(provider, config);

// --- [EXPORT] ----------------------------------------------------------------

export { B as AI_TUNING, buildPrompt, composeToolkit, createModelLayer, createTool, createToolHandlers, getModel };
export type { AiModelConfig, AiModelLayer };
