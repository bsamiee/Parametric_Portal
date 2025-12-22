/**
 * Generic SVG infrastructure: branded types, sanitization, and ID scoping.
 * Reusable by ANY app that works with SVG content.
 */

import { pipe, Schema as S } from 'effect';
import DOMPurify from 'isomorphic-dompurify';

// --- [TYPES] -----------------------------------------------------------------

type Scope = S.Schema.Type<typeof ScopeSchema>;
type Svg = S.Schema.Type<typeof SvgSchema>;
type SvgId = S.Schema.Type<typeof SvgIdSchema>;
type SanitizeOptions = { readonly scope?: Scope };

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
    scope: {
        charIndex: 0,
        hashMultiplier: 31,
        hashSeed: 0,
        length: 8,
        padChar: '0',
        radix: 16,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const ScopeSchema = pipe(S.String, S.pattern(/^[0-9a-f]{8}$/), S.brand('Scope'));

const SvgSchema = pipe(
    S.String,
    S.filter((s) => s.includes('<svg') && s.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
    S.brand('Svg'),
);

const SvgIdSchema = pipe(S.String, S.pattern(/^[a-zA-Z_][a-zA-Z0-9_-]*$/), S.brand('SvgId'));

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const scopeModulo = B.scope.radix ** B.scope.length;

const generateScope = (): Scope =>
    S.decodeSync(ScopeSchema)(
        Array.from({ length: B.scope.length }, () =>
            Math.trunc(Math.random() * B.scope.radix).toString(B.scope.radix),
        ).join(''),
    );

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
        // Sync decode: pure function context; throws on malformed SVG IDs (expected for invalid input)
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

const sanitizeSvg = (svg: string, options?: SanitizeOptions): string => {
    const sanitized = purify(svg);
    return sanitized ? scopeIds(sanitized, options?.scope ?? generateScope()) : '';
};

const isSvgValid = (svg: string): boolean => {
    const sanitized = purify(svg);
    return B.patterns.svgTag.test(sanitized) && sanitized.includes('</svg>');
};

// --- [EXPORT] ----------------------------------------------------------------

export { B as SVG_TUNING, deriveScope, generateScope, isSvgValid, sanitizeSvg, ScopeSchema, SvgIdSchema, SvgSchema };
export type { SanitizeOptions, Scope, Svg, SvgId };
