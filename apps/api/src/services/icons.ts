/**
 * Icon generation service: Rhino/Grasshopper/CAD SVG icons via multi-provider AI.
 * Contains prompt engineering, palette management, and provider-agnostic AI integration.
 */
import { LanguageModel } from '@effect/ai';
import { type AiProviderType, buildPrompt, getModel } from '@parametric-portal/ai/registry';
import { HttpError } from '@parametric-portal/server/http-errors';
import { IconServiceInput, Icons } from '@parametric-portal/types/icons';
import { Svg, SvgAsset } from '@parametric-portal/types/svg';
import { Array as A, Context, Effect, Layer, Option, pipe, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ServiceInputSchema = S.extend(IconServiceInput, S.Struct({ signal: S.optional(S.instanceOf(AbortSignal)) }));
const AiResponseSchema = S.Struct({ variants: S.Array(SvgAsset.inputSchema).pipe(S.minItems(1)) });

// --- [TYPES] -----------------------------------------------------------------

type ServiceInput = S.Schema.Type<typeof ServiceInputSchema>;
type ServiceOutput = { readonly variants: ReadonlyArray<SvgAsset> };
type PromptContext = {
    readonly attachments?: ReadonlyArray<SvgAsset>;
    readonly colorMode: 'dark' | 'light';
    readonly intent: 'create' | 'refine';
    readonly prompt: string;
    readonly referenceSvg?: string;
    readonly variantCount: number;
};
type IconGenerationServiceInterface = {
    readonly generate: (input: ServiceInput) => Effect.Effect<ServiceOutput, InstanceType<typeof HttpError.Internal>>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        colorMode: 'dark' as const,
        intent: 'create' as const,
        provider: 'anthropic' as AiProviderType,
        variantCount: 1,
    },
    errors: { aiGeneration: (provider: string, e: unknown) => `AI generation failed (${provider}): ${String(e)}` },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

type Palette = (typeof Icons.design.palettes)['dark'];
const getPalette = (mode: 'dark' | 'light'): Palette => Icons.design.palettes[mode];
const minifySvgForPrompt = (svgContent: string): string =>
    Option.match(Svg.sanitize(svgContent), {
        onNone: () => '',
        onSome: (svg) => svg.replaceAll(/\s+/g, ' ').replaceAll(/>\s+</g, '><').trim(),
    });
const buildSystemPrompt = (ctx: PromptContext): string => {
    const palette = getPalette(ctx.colorMode);
    const { layers } = Icons.design;
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
{"variants":[{"name":"Tool Name","svg":"<svg>...</svg>"}]}
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

const buildContext = (input: ServiceInput): PromptContext => ({
    ...(input.attachments !== undefined && { attachments: input.attachments }),
    colorMode: input.colorMode ?? B.defaults.colorMode,
    intent: input.intent ?? B.defaults.intent,
    prompt: input.prompt,
    ...(input.referenceSvg !== undefined && { referenceSvg: input.referenceSvg }),
    variantCount: input.variantCount ?? B.defaults.variantCount,
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const generateWithAi = Effect.fn('icons.ai')((validInput: ServiceInput) => {
    const provider = validInput.provider ?? B.defaults.provider;
    const ctx = buildContext(validInput);
    return pipe(
        LanguageModel.generateObject({
            prompt: buildPrompt(buildUserMessage(ctx), buildSystemPrompt(ctx)),
            schema: AiResponseSchema,
        }),
        Effect.map((response) => response.value),
        Effect.provide(getModel(provider, validInput.apiKey === undefined ? {} : { apiKey: validInput.apiKey })),
        Effect.mapError((e) => new HttpError.Internal({ message: B.errors.aiGeneration(provider, e) })),
    );
});

// --- [CLASSES] ---------------------------------------------------------------

class IconGenerationService extends Context.Tag('IconGenerationService')<
    IconGenerationService,
    IconGenerationServiceInterface
>() {}
const IconGenerationServiceLive = Layer.succeed(
    IconGenerationService,
    IconGenerationService.of({
        generate: Effect.fn('icons.generate')((input: ServiceInput) =>
            Effect.gen(function* () {
                const response = yield* generateWithAi(input);
                return {
                    variants: A.filterMap(response.variants, (v) => SvgAsset.create(v.name, v.svg)),
                } satisfies ServiceOutput;
            }),
        ),
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as ICON_GENERATION_TUNING, IconGenerationService, IconGenerationServiceLive };
export type { ServiceInput, ServiceOutput };
