/**
 * AnthropicService Layer for SVG icon generation via Claude API.
 * Reuses client instance across requests for performance.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { ContentBlock } from '@anthropic-ai/sdk/resources/messages';
import { InternalError } from '@parametric-portal/server/errors';
import { Config, Context, Effect, Layer, Option, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type AnthropicServiceInterface = {
    readonly generateSvg: (prompt: string) => Effect.Effect<string, InternalError>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    fallbackSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/></svg>',
    maxTokens: 4096,
    model: 'claude-sonnet-4-20250514',
    svgPattern: /<svg[\s\S]*?<\/svg>/i,
    systemPrompt: `You are an expert SVG icon designer. Generate clean, minimal, scalable SVG icons.
Rules:
- Output ONLY the SVG code, no explanation
- Use viewBox="0 0 24 24" for consistency
- Use currentColor for fill/stroke to support theming
- Keep paths simple and optimized
- No external dependencies or embedded images`,
} as const);

// --- [CONTEXT] ---------------------------------------------------------------

class AnthropicService extends Context.Tag('AnthropicService')<AnthropicService, AnthropicServiceInterface>() {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const extractSvg = (content: string): string =>
    pipe(
        B.svgPattern.exec(content),
        Option.fromNullable,
        Option.map((match) => match[0]),
        Option.getOrElse(() => B.fallbackSvg),
    );

const extractTextContent = (content: ReadonlyArray<ContentBlock>): string =>
    pipe(
        content.find((c): c is ContentBlock & { type: 'text' } => c.type === 'text'),
        Option.fromNullable,
        Option.map((c) => c.text),
        Option.getOrElse(() => ''),
    );

// --- [LAYERS] ----------------------------------------------------------------

const AnthropicServiceLive = Layer.effect(
    AnthropicService,
    Effect.gen(function* () {
        const apiKey = yield* Config.string('ANTHROPIC_API_KEY').pipe(Config.withDefault(''));
        const client = new Anthropic({ apiKey });

        return AnthropicService.of({
            generateSvg: (prompt) =>
                pipe(
                    Effect.tryPromise({
                        catch: (e) => new InternalError({ cause: `Anthropic API error: ${String(e)}` }),
                        try: () =>
                            client.messages.create({
                                // biome-ignore lint/style/useNamingConvention: Anthropic SDK API contract
                                max_tokens: B.maxTokens,
                                messages: [{ content: `Generate an SVG icon for: ${prompt}`, role: 'user' }],
                                model: B.model,
                                system: B.systemPrompt,
                            }),
                    }),
                    Effect.map((response) => extractSvg(extractTextContent(response.content))),
                ),
        });
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { AnthropicService, AnthropicServiceLive, B as ANTHROPIC_TUNING };
