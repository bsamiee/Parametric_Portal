/**
 * Generic Anthropic client layer for reusable AI infrastructure.
 * Provider-agnostic interface: packages export mechanisms, apps define prompts.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { InternalError } from '@parametric-portal/server/errors';
import { Config, Context, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type SendOptions = {
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

// --- [CONTEXT] ---------------------------------------------------------------

class AnthropicClient extends Context.Tag('AnthropicClient')<AnthropicClient, AnthropicClientInterface>() {}

// --- [LAYER] -----------------------------------------------------------------

const AnthropicClientLive = Layer.effect(
    AnthropicClient,
    Effect.gen(function* () {
        const apiKey = yield* Config.redacted('ANTHROPIC_API_KEY');
        const client = new Anthropic({ apiKey: String(apiKey) });

        return AnthropicClient.of({
            send: (system, messages, options) =>
                pipe(
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
                                        ...(options.prefill
                                            ? [{ content: options.prefill, role: 'assistant' as const }]
                                            : []),
                                    ],
                                    model: options.model,
                                    system,
                                },
                                { signal: options.signal },
                            ),
                    }),
                    Effect.flatMap((response) => {
                        const content = response.content[0];
                        const text = (content?.type === 'text' ? content.text : null) ?? '';
                        return text
                            ? Effect.succeed((options.prefill ?? '') + text)
                            : Effect.fail(new InternalError({ cause: 'No text in response' }));
                    }),
                ),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AnthropicClient, AnthropicClientLive, B as AI_CLIENT_TUNING };
export type { AnthropicClientInterface, SendOptions };
