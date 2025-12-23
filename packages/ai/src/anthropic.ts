/**
 * Generic Anthropic client layer for reusable AI infrastructure.
 * Provider-agnostic interface: packages export mechanisms, apps define prompts.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { InternalError } from '@parametric-portal/server/errors';
import { Config, Context, Effect, Layer, Option, pipe, Redacted } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type SendOptions = {
    readonly apiKey?: string;
    readonly maxTokens?: number;
    readonly model: string;
    readonly prefill?: string;
    readonly signal?: AbortSignal;
};

type AnthropicClientInterface = {
    readonly send: (
        system: string,
        messages: ReadonlyArray<MessageParam>,
        options: SendOptions,
    ) => Effect.Effect<string, InternalError>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        maxTokens: 4096,
    },
} as const);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

class AnthropicClient extends Context.Tag('AnthropicClient')<AnthropicClient, AnthropicClientInterface>() {}

const sendRequest = (
    apiKey: string,
    system: string,
    messages: ReadonlyArray<MessageParam>,
    options: SendOptions,
): Effect.Effect<string, InternalError> => {
    const client = new Anthropic({ apiKey });
    return pipe(
        Effect.tryPromise({
            catch: (e) =>
                e instanceof Error && e.name === 'AbortError'
                    ? new InternalError({ cause: 'Request cancelled' })
                    : new InternalError({ cause: `Anthropic API: ${String(e)}` }),
            try: () =>
                client.messages.create(
                    {
                        // biome-ignore lint/style/useNamingConvention: Anthropic SDK uses snake_case
                        max_tokens: options.maxTokens ?? B.defaults.maxTokens,
                        messages: [
                            ...messages,
                            ...(options.prefill ? [{ content: options.prefill, role: 'assistant' as const }] : []),
                        ],
                        model: options.model,
                        system,
                    },
                    { signal: options.signal },
                ),
        }),
        Effect.flatMap((response) =>
            pipe(
                Option.fromNullable(response.content[0]),
                Option.flatMap((c) => (c.type === 'text' ? Option.some(c.text) : Option.none())),
                Option.map((text) => (options.prefill ?? '') + text),
                Option.match({
                    onNone: () => Effect.fail(new InternalError({ cause: 'No text in response' })),
                    onSome: Effect.succeed,
                }),
            ),
        ),
    );
};

const AnthropicClientLive = Layer.effect(
    AnthropicClient,
    Effect.gen(function* () {
        const envApiKey = yield* Config.redacted('ANTHROPIC_API_KEY');
        const defaultKey = Redacted.value(envApiKey);

        return AnthropicClient.of({
            send: (system, messages, options) => sendRequest(options.apiKey ?? defaultKey, system, messages, options),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AnthropicClient, AnthropicClientLive, B as AI_CLIENT_TUNING };
export type { AnthropicClientInterface, SendOptions };
