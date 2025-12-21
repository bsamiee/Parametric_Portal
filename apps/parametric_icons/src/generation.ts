/**
 * Icon generation system: AI service, SVG protocol, and sanitization.
 * Combines Claude API integration, production SVG specs, and secure rendering.
 */
import Anthropic from '@anthropic-ai/sdk';
import { type ApiError, type ApiResponse, api, type HttpStatusError } from '@parametric-portal/types/api';
import { asyncState } from '@parametric-portal/types/async';
import DOMPurify from 'dompurify';
import { Effect, pipe, Schema as S } from 'effect';
import type { ColorMode, ParametricIntent, ReferenceAttachment } from './stores.ts';

// --- [TYPES] -----------------------------------------------------------------

type Scope = S.Schema.Type<typeof ScopeSchema>;
type Svg = S.Schema.Type<typeof SvgSchema>;
type SvgId = S.Schema.Type<typeof SvgIdSchema>;
type GenerateInput = S.Schema.Type<typeof GenerateInputSchema>;
type GenerateOutput = S.Schema.Type<typeof GenerateOutputSchema>;
type SanitizeOptions = { readonly scope?: Scope };

type Palette = {
    readonly structural: {
        readonly guide: string;
        readonly context: string;
        readonly secondary: string;
        readonly primary: string;
    };
    readonly semantic: {
        readonly grip: string;
        readonly gripStroke: string;
    };
};

type PromptContext = {
    readonly attachments?: ReadonlyArray<ReferenceAttachment>;
    readonly colorMode: ColorMode;
    readonly intent: 'create' | 'refine';
    readonly prompt: string;
    readonly referenceSvg?: string;
    readonly variantCount: number;
};

// --- [SCHEMA] ----------------------------------------------------------------

const ScopeSchema = pipe(S.String, S.pattern(/^[0-9a-f]{8}$/), S.brand('Scope'));
const SvgSchema = pipe(
    S.String,
    S.filter((s) => s.includes('<svg') && s.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
    S.brand('Svg'),
);
const SvgIdSchema = pipe(S.String, S.pattern(/^[a-zA-Z_][a-zA-Z0-9_-]*$/), S.brand('SvgId'));

const ReferenceInputSchema = S.Struct({
    id: S.String,
    name: S.String,
    svg: S.String,
});

const GenerateInputSchema = S.Struct({
    attachments: S.optional(S.Array(ReferenceInputSchema)),
    colorMode: S.optional(S.Literal('dark', 'light')),
    intent: S.optional(S.Literal('create', 'refine')),
    prompt: pipe(S.String, S.minLength(1)),
    referenceSvg: S.optional(S.String),
    signal: S.optional(S.instanceOf(AbortSignal)),
    variantCount: S.optional(pipe(S.Number, S.between(1, 3))),
});

const SvgVariantOutputSchema = S.Struct({
    id: S.String,
    name: S.String,
    svg: S.String,
});

const GenerateOutputSchema = S.Struct({
    variants: S.Array(SvgVariantOutputSchema),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    ai: {
        defaults: {
            colorMode: 'dark' as ColorMode,
            intent: 'create' as ParametricIntent,
            variantCount: 1,
        },
        detail: 'balanced',
        maxTokens: 6000,
        model: 'claude-sonnet-4-20250514',
    },
    canvas: {
        center: { x: 16, y: 16 },
        gridSize: 32,
        safeArea: 2,
        viewBox: '0 0 32 32',
    },
    errors: {
        invalidInput: {
            code: 'INVALID_INPUT',
            message: 'Invalid generation input',
        },
    },
    layers: {
        // Thin, professional stroke weights for 32x32 canvas
        context: { dasharray: 'none', fill: 'none', id: 'Context', strokeWidth: 0.5 },
        detail: { dasharray: 'none', fill: 'none', id: 'Detail', strokeWidth: 0.5 },
        grips: { dasharray: 'none', fill: '#FFFFFF', id: 'Grips', strokeWidth: 0.5 },
        guide: { dasharray: '2 1', fill: 'none', id: 'Guide', strokeWidth: 0.25 },
        primary: { dasharray: 'none', fill: 'none', id: 'Primary', strokeWidth: 1 },
    },
    palettes: {
        dark: {
            semantic: { grip: '#FFFFFF', gripStroke: '#000000' },
            structural: { context: '#52525b', guide: '#71717a', primary: '#000000', secondary: '#52525b' },
        },
        light: {
            semantic: { grip: '#FFFFFF', gripStroke: '#000000' },
            structural: { context: '#52525b', guide: '#71717a', primary: '#000000', secondary: '#52525b' },
        },
    } satisfies Record<ColorMode, Palette>,
    patterns: {
        idAttr: /\bid=['"]([^'"]+)['"]/g,
        svgTag: /<svg[^>]*>/i,
    },
    purify: {
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ADD_TAGS: ['use'],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ALLOWED_ATTR: [
            'class',
            'clip-path',
            'clip-rule',
            'cx',
            'cy',
            'd',
            'fill',
            'fill-opacity',
            'fill-rule',
            'height',
            'href',
            'id',
            'opacity',
            'paint-order',
            'r',
            'rx',
            'ry',
            'shape-rendering',
            'stroke',
            'stroke-dasharray',
            'stroke-dashoffset',
            'stroke-linecap',
            'stroke-linejoin',
            'stroke-miterlimit',
            'stroke-opacity',
            'stroke-width',
            'style',
            'transform',
            'viewBox',
            'width',
            'x',
            'x1',
            'x2',
            'xlink:href',
            'xmlns',
            'xmlns:xlink',
            'y',
            'y1',
            'y2',
        ],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ALLOWED_TAGS: [
            'circle',
            'clipPath',
            'defs',
            'ellipse',
            'g',
            'line',
            'linearGradient',
            'path',
            'polygon',
            'polyline',
            'radialGradient',
            'rect',
            'stop',
            'svg',
            'use',
        ],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        USE_PROFILES: { svg: true },
    },
    scope: {
        charIndex: 0,
        hashMultiplier: 31,
        hashSeed: 0,
        length: 8,
        padChar: '0',
        radix: 16,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const scopeModulo = B.scope.radix ** B.scope.length;

const generateScope = (): Scope =>
    Array.from({ length: B.scope.length }, () =>
        Math.trunc(Math.random() * B.scope.radix).toString(B.scope.radix),
    ).join('') as Scope;

const deriveScope = (seed: string): Scope => {
    const hash = Array.from(seed).reduce<number>(
        (acc, char) => (acc * B.scope.hashMultiplier + (char.codePointAt(B.scope.charIndex) ?? 0)) % scopeModulo,
        B.scope.hashSeed,
    );
    const hex = hash.toString(B.scope.radix).padStart(B.scope.length, B.scope.padChar);
    return hex.slice(-B.scope.length) as Scope;
};

const escapeRegExp = (str: string): string => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

const scopeIds = (svg: string, scope: Scope): string => {
    const idMap = new Map<SvgId, SvgId>();

    const withScopedIds = svg.replaceAll(B.patterns.idAttr, (_match, oldId: string) => {
        const newId = `${oldId}_${scope}` as SvgId;
        idMap.set(oldId as SvgId, newId);
        return `id="${newId}"`;
    });

    return idMap.size === 0
        ? withScopedIds
        : [...idMap.entries()].reduce((result, [oldId, newId]) => {
              const escaped = escapeRegExp(oldId);
              return result
                  .replaceAll(new RegExp(String.raw`url\(#${escaped}\)`, 'g'), `url(#${newId})`)
                  .replaceAll(new RegExp(String.raw`href=['"]#${escaped}['"]`, 'g'), `href="#${newId}"`)
                  .replaceAll(new RegExp(String.raw`xlink:href=['"]#${escaped}['"]`, 'g'), `xlink:href="#${newId}"`);
          }, withScopedIds);
};

const purify = (svg: string): string =>
    DOMPurify.sanitize(svg, {
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ADD_TAGS: [...B.purify.ADD_TAGS],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ALLOWED_ATTR: [...B.purify.ALLOWED_ATTR],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        ALLOWED_TAGS: [...B.purify.ALLOWED_TAGS],
        // biome-ignore lint/style/useNamingConvention: DOMPurify API requires SCREAMING_SNAKE_CASE
        USE_PROFILES: B.purify.USE_PROFILES,
    });

const sanitizeSvg = (svg: string, options?: SanitizeOptions): string => {
    const sanitized = purify(svg);
    return sanitized ? scopeIds(sanitized, options?.scope ?? generateScope()) : '';
};

const isSvgValid = (svg: string): boolean => {
    const sanitized = purify(svg);
    return B.patterns.svgTag.test(sanitized) && sanitized.includes('</svg>');
};

const minifySvgForPrompt = (svg: string): string =>
    svg
        .replaceAll(/<!--[\s\S]*?-->/g, '')
        .replaceAll(/<(metadata|desc|title)>[\s\S]*?<\/\1>/gi, '')
        .replaceAll(/\s+/g, ' ')
        .replaceAll(/>\s+</g, '><')
        .trim();

const getPalette = (mode: ColorMode): Palette => B.palettes[mode];

const buildLayerManifest = (palette: Palette): string => {
    const { structural, semantic } = palette;
    const { layers } = B;

    const l1 = `<g id="${layers.guide.id}" stroke="${structural.guide}" stroke-width="${layers.guide.strokeWidth}" fill="none" stroke-dasharray="${layers.guide.dasharray}"/>`;
    const l2 = `<g id="${layers.context.id}" stroke="${structural.context}" stroke-width="${layers.context.strokeWidth}" fill="none"/>`;
    const l3 = `<g id="${layers.detail.id}" stroke="${structural.secondary}" stroke-width="${layers.detail.strokeWidth}" fill="none"/>`;
    const l4 = `<g id="${layers.primary.id}" stroke="${structural.primary}" stroke-width="${layers.primary.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    const l5 = `<g id="${layers.grips.id}" stroke="${semantic.gripStroke}" stroke-width="${layers.grips.strokeWidth}" fill="${semantic.grip}"/>`;

    return [l1, l2, l3, l4, l5].join('\n  ');
};

const buildSystemPrompt = (ctx: PromptContext): string => {
    const palette = getPalette(ctx.colorMode);
    const { layers } = B;

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

const extractJsonFromText = (text: string): string => {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    return start !== -1 && end !== -1 ? text.slice(start, end + 1) : text;
};

const PREFILL = '{"variants":[';

const parseVariantsResponse = (text: string): GenerateOutput => {
    // Prepend the prefill that was used in the API call
    const fullJson = PREFILL + text;
    const json = extractJsonFromText(fullJson);
    const parsed: unknown = JSON.parse(json);
    return S.decodeUnknownSync(GenerateOutputSchema)(parsed);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const apiFactory = api<GenerateOutput>();
const asyncApi = asyncState<ApiResponse<GenerateOutput>, ApiError>();

const decodeGenerateInput = (input: GenerateInput): Effect.Effect<GenerateInput, ApiError> =>
    S.decodeUnknown(GenerateInputSchema)(input).pipe(
        Effect.mapError(() =>
            apiFactory.error(400 as HttpStatusError, B.errors.invalidInput.code, B.errors.invalidInput.message),
        ),
    );

const buildContext = (input: GenerateInput): PromptContext => ({
    ...(input.attachments !== undefined && { attachments: input.attachments }),
    colorMode: input.colorMode ?? B.ai.defaults.colorMode,
    intent: input.intent ?? B.ai.defaults.intent,
    prompt: input.prompt,
    ...(input.referenceSvg !== undefined && { referenceSvg: input.referenceSvg }),
    variantCount: input.variantCount ?? B.ai.defaults.variantCount,
});

const buildUserMessage = (ctx: PromptContext): string => {
    const parts: string[] = [];

    // Mode-specific framing
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

    // Style references from attachments
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

const generateIcon = (input: GenerateInput): Effect.Effect<ApiResponse<GenerateOutput>, ApiError, never> =>
    pipe(
        decodeGenerateInput(input),
        Effect.map(buildContext),
        Effect.flatMap((ctx) => {
            const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
            if (!apiKey?.startsWith('sk-ant-')) {
                return Effect.succeed(
                    apiFactory.error(
                        401 as HttpStatusError,
                        'MISSING_API_KEY',
                        'VITE_ANTHROPIC_API_KEY is missing or invalid. Create .env file with your Anthropic API key.',
                    ),
                );
            }

            return pipe(
                Effect.tryPromise({
                    catch: (e) => {
                        // Handle abort specifically
                        if (e instanceof Error && e.name === 'AbortError') {
                            return apiFactory.error(
                                499 as HttpStatusError,
                                'REQUEST_CANCELLED',
                                'Request was cancelled',
                            );
                        }
                        return apiFactory.error(
                            500 as HttpStatusError,
                            'AI_SERVICE_ERROR',
                            e instanceof Error ? e.message : String(e),
                        );
                    },
                    try: async () => {
                        const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
                        const result = await client.messages.create(
                            {
                                // biome-ignore lint/style/useNamingConvention: Anthropic SDK uses snake_case
                                max_tokens: B.ai.maxTokens,
                                messages: [
                                    { content: buildUserMessage(ctx), role: 'user' },
                                    { content: '{"variants":[', role: 'assistant' },
                                ],
                                model: B.ai.model,
                                system: buildSystemPrompt(ctx),
                            },
                            { signal: input.signal },
                        );
                        return result;
                    },
                }),
                Effect.flatMap((response) => {
                    const content = response.content[0];
                    if (content?.type !== 'text') {
                        return Effect.succeed(
                            apiFactory.error(500 as HttpStatusError, 'EMPTY_RESPONSE', 'No text content in response'),
                        );
                    }
                    return Effect.try({
                        catch: () =>
                            apiFactory.error(
                                500 as HttpStatusError,
                                'PARSE_ERROR',
                                'Failed to parse variants response',
                            ),
                        try: () => parseVariantsResponse(content.text),
                    }).pipe(
                        Effect.map((output) =>
                            output.variants.length > 0
                                ? apiFactory.success(output)
                                : apiFactory.error(
                                      500 as HttpStatusError,
                                      'NO_VARIANTS',
                                      'No valid SVG variants in response',
                                  ),
                        ),
                    );
                }),
            );
        }),
        Effect.catchAll((err) => Effect.succeed(err)),
    );

// --- [EXPORT] ----------------------------------------------------------------

export {
    apiFactory,
    asyncApi,
    B as GENERATION_CONFIG,
    buildLayerManifest,
    buildSystemPrompt,
    deriveScope,
    generateIcon,
    GenerateInputSchema,
    GenerateOutputSchema,
    getPalette,
    isSvgValid,
    minifySvgForPrompt,
    sanitizeSvg,
    ScopeSchema,
    SvgIdSchema,
    SvgSchema,
};
export type { GenerateInput, GenerateOutput, Palette, PromptContext, SanitizeOptions, Scope, Svg, SvgId };
