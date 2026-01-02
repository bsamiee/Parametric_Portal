/** SVG sanitization with DOMPurify and ID scoping for collision prevention. */
import { ParseResult, pipe, Schema as S } from 'effect';
import DOMPurify from 'isomorphic-dompurify';
import { Hex8, HtmlId, Uuidv7 } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type Svg = S.Schema.Type<typeof SvgSchema>
type SvgAssetInput = S.Schema.Type<typeof SvgAssetInputSchema>
type SvgAssetData = S.Schema.Type<typeof SvgAssetSchema>

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	patterns: {
		idAttr: /\bid=['"]([^'"]+)['"]/g,
		svgTag: /<svg[^>]*>/i,
	},
	purify: {
		ADD_ATTR: ['xlink:href'],
		ADD_TAGS: ['use'],
		USE_PROFILES: { svg: true },
	},
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const SvgSchema = pipe(
	S.String,
	S.filter((s) => s.includes('<svg') && s.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
	S.brand('Svg'),
);
const SvgSanitizedSchema = S.transformOrFail(S.String, SvgSchema, {
	decode: (raw, _, ast) => {
		const sanitized = purifyInternal(raw);
		return sanitized.includes('<svg') && sanitized.includes('</svg>')
			? ParseResult.succeed(sanitized as typeof SvgSchema.Type)
			: ParseResult.fail(new ParseResult.Type(ast, raw, 'SVG sanitization produced invalid output'));
	},
	encode: (svg) => ParseResult.succeed(svg),
	strict: true,
});
const SvgAssetInputSchema = S.Struct({ name: S.NonEmptyTrimmedString, svg: S.String });
const SvgAssetFields = {
	id: Uuidv7.schema,
	name: S.NonEmptyTrimmedString,
	svg: SvgSchema,
} as const;
const SvgAssetSchema = S.Struct(SvgAssetFields);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const purifyInternal = (svg: string): string =>
	DOMPurify.sanitize(svg, {
		ADD_ATTR: [...B.purify.ADD_ATTR],
		ADD_TAGS: [...B.purify.ADD_TAGS],
		USE_PROFILES: B.purify.USE_PROFILES,
	});
const escapeRegExp = (str: string): string => str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
const scopeIds = (svg: string, scope: Hex8): string => {
	const idMap = new Map<HtmlId, HtmlId>();
	const withScopedIds = svg.replaceAll(B.patterns.idAttr, (_match, oldId: string) => {
		const validatedId = S.decodeSync(HtmlId.schema)(oldId);
		const newId = `${validatedId}_${scope}` as HtmlId;
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
const sanitizeSvg = (svg: string, options?: { readonly scope?: Hex8 | undefined }): string =>
	pipe(purifyInternal(svg), (sanitized) =>
		sanitized ? scopeIds(sanitized, options?.scope ?? Hex8.generateSync()) : '',
	);
const sanitizeSvgScoped = (svg: string, seed: string): string =>
	sanitizeSvg(svg, { scope: Hex8.derive(seed) });

// --- [CLASSES] ---------------------------------------------------------------

class SvgAsset extends S.Class<SvgAsset>('SvgAsset')(SvgAssetFields) {
	static create(input: SvgAssetInput): SvgAssetData {
		return {
			id: Uuidv7.generateSync(),
			name: input.name,
			svg: sanitizeSvg(input.svg) as Svg,
		};
	}
	static sanitizeWithScope(asset: SvgAssetData, seed: string): string {
		return sanitizeSvgScoped(asset.svg, seed);
	}
	sanitizeWithScope(seed: string): string {
		return sanitizeSvgScoped(this.svg, seed);
	}
}

// --- [EXPORT] ----------------------------------------------------------------

export { sanitizeSvg, sanitizeSvgScoped, SvgAsset, SvgAssetInputSchema, SvgAssetSchema, SvgSchema, SvgSanitizedSchema };
export type { Svg, SvgAssetData, SvgAssetInput };
