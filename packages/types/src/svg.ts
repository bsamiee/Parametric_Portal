/**
 * Define SVG sanitization, scoping, and asset creation with DOMPurify.
 * DOMPurify whitelist with ID collision prevention via scope prefixing.
 */
import { pipe, Schema as S } from 'effect';
import DOMPurify from 'isomorphic-dompurify';
import { type Hex8, type HtmlId, types } from './types.ts';

const typesApi = types();

// --- [TYPES] -----------------------------------------------------------------

type Scope = Hex8;
type SvgId = HtmlId;
type Svg = S.Schema.Type<typeof SvgSchema>;
type SvgAssetInput = S.Schema.Type<typeof SvgAssetInputSchema>;
type SvgAsset = S.Schema.Type<typeof SvgAssetSchema>;
type SanitizeOptions = { readonly scope?: Scope | undefined };
type SvgConfig = {
    readonly defaultScope?: Scope;
};
type SvgApi = {
    readonly createSvgAsset: typeof createSvgAsset;
    readonly deriveScope: typeof deriveScope;
    readonly generateScope: typeof generateScope;
    readonly isSvgValid: typeof isSvgValid;
    readonly sanitizeSvg: (svg: string, options?: SanitizeOptions) => string;
    readonly schemas: {
        readonly Scope: typeof ScopeSchema;
        readonly Svg: typeof SvgSchema;
        readonly SvgAsset: typeof SvgAssetSchema;
        readonly SvgAssetInput: typeof SvgAssetInputSchema;
        readonly SvgId: typeof SvgIdSchema;
    };
    readonly validate: {
        readonly isSvgValid: typeof isSvgValid;
    };
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    patterns: {
        idAttr: /\bid=['"]([^'"]+)['"]/g,
        svgTag: /<svg[^>]*>/i,
    },
    purify: {
        ADD_TAGS: ['use'],
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
        USE_PROFILES: { svg: true },
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const ScopeSchema = typesApi.schemas.Hex8;
const SvgIdSchema = typesApi.schemas.HtmlId;
const SvgSchema = pipe(
    S.String,
    S.filter((s) => s.includes('<svg') && s.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
    S.brand('Svg'),
);
const SvgAssetInputSchema = S.Struct({
    name: S.NonEmptyTrimmedString,
    svg: S.String,
});
const SvgAssetSchema = S.Struct({
    id: typesApi.schemas.Uuidv7,
    name: S.NonEmptyTrimmedString,
    svg: SvgSchema,
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const generateScope = (): Scope => typesApi.generate.hex8();
const deriveScope = (seed: string): Scope => typesApi.derive.hex8(seed);
const escapeRegExp = (str: string): string => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const scopeIds = (svg: string, scope: Scope): string => {
    const idMap = new Map<SvgId, SvgId>();
    const withScopedIds = svg.replaceAll(B.patterns.idAttr, (_match, oldId: string) => {
        const validatedId = S.decodeSync(SvgIdSchema)(oldId);
        const newId = `${validatedId}_${scope}` as SvgId;
        idMap.set(validatedId, newId);
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
        ADD_TAGS: [...B.purify.ADD_TAGS],
        ALLOWED_ATTR: [...B.purify.ALLOWED_ATTR],
        ALLOWED_TAGS: [...B.purify.ALLOWED_TAGS],
        USE_PROFILES: B.purify.USE_PROFILES,
    });
const applySanitization = (svg: string, options?: SanitizeOptions): string => {
    const sanitized = purify(svg);
    return sanitized ? scopeIds(sanitized, options?.scope ?? generateScope()) : '';
};
const isSvgValid = (svg: string): boolean => {
    const sanitized = purify(svg);
    return B.patterns.svgTag.test(sanitized) && sanitized.includes('</svg>');
};
const createSvgAsset = (input: SvgAssetInput): SvgAsset => ({
    id: typesApi.generate.uuidv7Sync(),
    name: input.name.trim(),
    svg: applySanitization(input.svg) as Svg,
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const svg = (config: SvgConfig = {}): SvgApi =>
    Object.freeze({
        createSvgAsset,
        deriveScope,
        generateScope,
        isSvgValid,
        sanitizeSvg: (svgContent: string, options?: SanitizeOptions) =>
            applySanitization(svgContent, { scope: options?.scope ?? config.defaultScope }),
        schemas: Object.freeze({
            Scope: ScopeSchema,
            Svg: SvgSchema,
            SvgAsset: SvgAssetSchema,
            SvgAssetInput: SvgAssetInputSchema,
            SvgId: SvgIdSchema,
        }),
        validate: Object.freeze({
            isSvgValid,
        }),
    });

// --- [EXPORT] ----------------------------------------------------------------

export { B as SVG_TUNING, svg };
export type { SanitizeOptions, Scope, Svg, SvgApi, SvgAsset, SvgAssetInput, SvgConfig, SvgId };
