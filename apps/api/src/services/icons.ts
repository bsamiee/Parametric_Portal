/**
 * Icon generation service: CAD-style SVG icons via Claude API.
 * Contains prompt engineering, palette management, and AI integration.
 */
import { Prompt } from '@effect/ai';
import { createProvider } from '@parametric-portal/ai/anthropic';
import { InternalError } from '@parametric-portal/server/errors';
import type { ColorMode } from '@parametric-portal/types/database';
import { type SvgAsset, svg } from '@parametric-portal/types/svg';
import { Context, Effect, Layer, pipe, Schema as S } from 'effect';
import { GenerateRequestSchema, ICON_DESIGN, type Palette } from '../contracts/icons.ts';

const svgApi = svg();

// --- [SCHEMA] ----------------------------------------------------------------

const ServiceInputSchema = S.extend(
    GenerateRequestSchema,
    S.Struct({
        apiKey: S.optional(S.String),
        signal: S.optional(S.instanceOf(AbortSignal)),
    }),
);

// --- [TYPES] -----------------------------------------------------------------

type ServiceInput = S.Schema.Type<typeof ServiceInputSchema>;
type ServiceOutput = { readonly variants: ReadonlyArray<SvgAsset> };
type PromptContext = {
    readonly attachments?: ReadonlyArray<SvgAsset>;
    readonly colorMode: ColorMode;
    readonly intent: 'create' | 'refine';
    readonly prompt: string;
    readonly referenceSvg?: string;
    readonly variantCount: number;
};
type IconGenerationServiceInterface = {
    readonly generate: (input: ServiceInput) => Effect.Effect<ServiceOutput, InternalError>;
};
/** AI response wrapper: validates array of SvgAssetInput before transformation. */
const AiResponseSchema = S.Struct({
    variants: S.Array(svgApi.schemas.SvgAssetInput).pipe(S.minItems(1)),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    ai: {
        defaults: {
            colorMode: 'dark' as ColorMode,
            intent: 'create' as const,
            variantCount: 1,
        },
        maxTokens: 6000,
        model: 'claude-sonnet-4-20250514',
        prefill: '{"variants":[',
    },
    errors: {
        invalidInput: { code: 'INVALID_INPUT', message: 'Invalid generation input' },
        parseFailure: { cause: 'Failed to parse response' },
    },
    regex: {
        jsonExtract: /\{[\s\S]*"variants"[\s\S]*\}/,
    },
} as const);
const ai = createProvider({ maxTokens: B.ai.maxTokens, model: B.ai.model });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getPalette = (mode: ColorMode): Palette => ICON_DESIGN.palettes[mode];
const minifySvgForPrompt = (svgContent: string): string =>
    svgApi.sanitizeSvg(svgContent).replaceAll(/\s+/g, ' ').replaceAll(/>\s+</g, '><').trim();
const buildSystemPrompt = (ctx: PromptContext): string => {
    const palette = getPalette(ctx.colorMode);
    const { layers } = ICON_DESIGN;
    return `You generate professional Rhino/Grasshopper-style CAD toolbar icons as SVG.

<canvas>
32×32 viewBox. Bounds: x∈[4,28], y∈[4,28]. Center: (16,16).
CONSTRAINT: All coordinates must be within [4,28]. Guide layer included — use it, within bounds.
Primary shapes fill the bounds appropriately for geometry type.
</canvas>

<layers>
Render order (back to front):
1. Guide: dashed reference lines (baselines, axes, symmetry) — stroke="${palette.structural.guide}" stroke-width="${layers.guide.strokeWidth}" stroke-dasharray="${layers.guide.dasharray}"
2. Context: source geometry being analyzed/modified — stroke="${palette.structural.context}" stroke-width="${layers.context.strokeWidth}"
3. Primary: OUTPUT geometry the tool creates — stroke="${palette.structural.primary}" stroke-width="${layers.primary.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"
4. Grips: 2×2 white squares ONLY — fill="${palette.semantic.grip}" stroke="${palette.semantic.gripStroke}" stroke-width="${layers.grips.strokeWidth}"

Tool types — REQUIRED layers:
• DRAWING: Guide + Primary + Grips — symmetry/baseline in Guide, shape in Primary, input points as Grips
• ANALYSIS: Context + Grips — source shape in Context, result points as Grips
• MODIFICATION: Context + Primary + Grips — original in Context, result in Primary, control points as Grips
</layers>

<grips>
Grips are ONLY 2×2 white <rect> with thin black stroke. Nothing else.
Position: <rect x="X-1" y="Y-1" width="2" height="2"/> to center on point (X,Y).

Rules:
• Grips lie ON visible geometry — curves MUST pass through grip points
• NO circles, NO backgrounds, NO decorations around grips
</grips>

<semantics>
Layer assignment by tool type:
• User input points → Grips
• Tool output shape → Primary (DRAWING/MODIFICATION) or Context (ANALYSIS source)
• Construction reference → Guide (symmetry axis, baseline, alignment)

Guide layer: REQUIRED for DRAWING tools. Shows structural context — vertical/horizontal axes, baselines, symmetry lines. Coordinates within [4,28].

ANALYSIS tools: grip IS the result. No shapes in Primary at grip locations.
</semantics>

<curves>
CRITICAL: Curves MUST pass through ALL grip points. Grips mark user input — the curve touches them.

Bezier geometry:
• Single Q bezier (M P1 Q C P2) does NOT pass through control point C
• For 3-point curves (start, apex, end): use TWO quadratic segments joined AT the apex
• Pattern: M x1,y1 Q cx1,cy1 apex_x,apex_y Q cx2,cy2 x2,y2
• The apex grip is WHERE the curve reaches — not a floating control point

Grip placement for curves:
• Endpoints at safe area edges: x=4 or x=28, y=4 or y=28
• Apex/middle points: curve MUST reach the grip, not float below/above it
• For arcs/arches: apex at y=4 (top), base points at y=28 (bottom)
</curves>

<quality>
• Stroke weights are thin and precise (${layers.primary.strokeWidth}px primary)
• Clean, minimal geometry — only elements that explain the tool's function
</quality>

<example>
Arch tool — 3 input points (base left, apex, base right):
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <g id="Guide" stroke="${palette.structural.guide}" stroke-width="${layers.guide.strokeWidth}" stroke-dasharray="${layers.guide.dasharray}" fill="none">
    <line x1="4" y1="28" x2="28" y2="28"/>
    <line x1="16" y1="4" x2="16" y2="28"/>
  </g>
  <g id="Primary" stroke="${palette.structural.primary}" stroke-width="${layers.primary.strokeWidth}" fill="none" stroke-linecap="round">
    <path d="M 4,28 Q 4,4 16,4 Q 28,4 28,28"/>
  </g>
  <g id="Grips" fill="${palette.semantic.grip}" stroke="${palette.semantic.gripStroke}" stroke-width="${layers.grips.strokeWidth}">
    <rect x="3" y="27" width="2" height="2"/>
    <rect x="15" y="3" width="2" height="2"/>
    <rect x="27" y="27" width="2" height="2"/>
  </g>
</svg>
Guide: baseline + symmetry axis. Primary: arch curve. Grips: ON curve at input points.
</example>

<output>
{"variants":[{"id":"v1","name":"Tool Name","svg":"<svg>...</svg>"}]}
Generate ${ctx.variantCount} variant(s).
</output>`;
};

const buildUserMessage = (ctx: PromptContext): string => {
    const parts: string[] = [];
    ctx.intent === 'refine' && ctx.referenceSvg
        ? parts.push(
              `<task>REFINE this existing icon according to the instructions below.</task>`,
              `<current_design>\n${minifySvgForPrompt(ctx.referenceSvg)}\n</current_design>`,
              `<refinement_instructions>${ctx.prompt}</refinement_instructions>`,
              `<refine_rules>
- Preserve the core geometric structure unless explicitly asked to change it
- Maintain consistent stroke weights and style
- Apply the requested modifications while keeping the icon recognizable
- Keep grip positions semantically correct for the tool type
</refine_rules>`,
          )
        : parts.push(`<task>Create icon for: "${ctx.prompt}"</task>`);

    ctx.attachments?.length &&
        parts.push(
            `<style_references>
Learn from these reference icons. Match their visual language, stroke weights, grip placement patterns, and overall design quality:
${ctx.attachments.map((att, i) => `Reference ${i + 1}:\n${minifySvgForPrompt(att.svg)}`).join('\n\n')}
</style_references>`,
        );

    parts.push(`
<requirements>
1. ANALYZE: What TOOL_TYPE is this? Count the USER INPUT points.
2. CANVAS: Primary shape MUST span x=4 to x=28 (fill the safe area, not float small in center)
3. GRIPS: Place exactly N grips for N input points — at (x-1, y-1) for each input (x,y)
4. FORBIDDEN: No grips at bezier Q control points, curve midpoints, or derived locations
5. VERIFY: Check grip count matches tool type before outputting
</requirements>`);

    return parts.join('\n\n');
};

const extractJsonFromText = (text: string): string => B.regex.jsonExtract.exec(text)?.[0] ?? text;
const parseAiResponse = (text: string): Effect.Effect<S.Schema.Type<typeof AiResponseSchema>, InternalError> =>
    pipe(
        Effect.try({
            catch: () => new InternalError({ cause: B.errors.parseFailure.cause }),
            try: () => JSON.parse(extractJsonFromText(B.ai.prefill + text)) as unknown,
        }),
        Effect.flatMap((parsed) =>
            S.decodeUnknown(AiResponseSchema)(parsed).pipe(
                Effect.mapError(() => new InternalError({ cause: B.errors.parseFailure.cause })),
            ),
        ),
    );
const buildContext = (input: ServiceInput): PromptContext => ({
    ...(input.attachments !== undefined && { attachments: input.attachments }),
    colorMode: input.colorMode ?? B.ai.defaults.colorMode,
    intent: input.intent ?? B.ai.defaults.intent,
    prompt: input.prompt,
    ...(input.referenceSvg !== undefined && { referenceSvg: input.referenceSvg }),
    variantCount: input.variantCount ?? B.ai.defaults.variantCount,
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const buildPromptWithPrefill = (ctx: PromptContext): readonly Prompt.Message[] => [
    Prompt.userMessage({ content: [Prompt.textPart({ text: buildUserMessage(ctx) })] }),
    Prompt.assistantMessage({ content: [Prompt.textPart({ text: B.ai.prefill })] }),
];
class IconGenerationService extends Context.Tag('IconGenerationService')<
    IconGenerationService,
    IconGenerationServiceInterface
>() {}
const IconGenerationServiceLive = Layer.succeed(
    IconGenerationService,
    IconGenerationService.of({
        generate: (input) =>
            pipe(
                S.decodeUnknown(ServiceInputSchema)(input),
                Effect.mapError(() => new InternalError({ cause: B.errors.invalidInput.message })),
                Effect.map(buildContext),
                Effect.flatMap((ctx) =>
                    pipe(
                        ai.generateText({
                            prompt: buildPromptWithPrefill(ctx),
                            system: buildSystemPrompt(ctx),
                        }),
                        Effect.mapError((e) => new InternalError({ cause: `AI generation failed: ${e._tag}` })),
                        Effect.map((text) => B.ai.prefill + text),
                    ),
                ),
                Effect.flatMap(parseAiResponse),
                Effect.map((response): ServiceOutput => ({ variants: response.variants.map(svgApi.createSvgAsset) })),
            ),
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as ICON_GENERATION_TUNING, IconGenerationService, IconGenerationServiceLive };
export type { ServiceInput, ServiceOutput };
