/**
 * Sanitize SVG markup with scoped ID rewriting.
 * Prevents ID collisions across multiple SVG assets via DOMPurify hooks.
 *
 * - Pure constructors (*At) require explicit IDs/scopes for referential transparency
 * - Option-returning variants (*Option) for strict FP composition
 * - Convenience variants use generateSync() internally (pragmatic for React)
 */
import { Option, ParseResult, pipe, Schema as S } from 'effect';
import DOMPurify from 'isomorphic-dompurify';
import { companion, Hex8, Uuidv7 } from './types.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	purify: {
		ADD_ATTR: ['href', 'xlink:href'],
		ADD_TAGS: ['use'],
		USE_PROFILES: { svg: true },
	},
	xlinkNs: 'http://www.w3.org/1999/xlink',
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const SvgSchema = pipe(
	S.String,
	S.filter((s) => s.includes('<svg') && s.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
	S.brand('Svg'),
);
type Svg = typeof SvgSchema.Type;

const SvgAssetSchema = S.Struct({ id: Uuidv7.schema, name: S.NonEmptyTrimmedString, svg: SvgSchema });
type SvgAsset = typeof SvgAssetSchema.Type;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

/** Rewrite url(#id) references using scoped ID map to prevent collisions. */
const replaceUrlRefs = (val: string, idMap: Map<string, string>): string => val.replaceAll(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${idMap.get(id) ?? id})`);
/** Mutate DOM node IDs and references in-place during sanitization. */
const rewriteNode = (node: Element, idMap: Map<string, string>, scope: string): void => {
	const oldId = node.getAttribute?.('id');
	oldId && (() => { idMap.set(oldId, `${oldId}_${scope}`); node.setAttribute('id', `${oldId}_${scope}`); })();
	['href', 'xlink:href'].forEach((attr) => {
		const val = attr === 'xlink:href' ? node.getAttributeNS?.(B.xlinkNs, 'href') : node.getAttribute?.(attr);
		const refId = val?.startsWith('#') ? val.slice(1) : undefined;
		refId && idMap.has(refId) && (attr === 'xlink:href'
			? node.setAttributeNS?.(B.xlinkNs, 'xlink:href', `#${idMap.get(refId)}`)
			: node.setAttribute?.(attr, `#${idMap.get(refId)}`));
	});
	['fill', 'stroke', 'clip-path', 'mask', 'filter'].forEach((attr) => {
		const val = node.getAttribute?.(attr);
		val?.includes('url(#') && node.setAttribute?.(attr, replaceUrlRefs(val, idMap));
	});
	// biome-ignore lint/style/noParameterAssign: DOMPurify hooks require in-place DOM mutation
	node.tagName?.toLowerCase() === 'style' && node.textContent?.includes('url(#') && (() => { node.textContent = replaceUrlRefs(node.textContent, idMap);})();
};
/** Sanitize SVG and scope all IDs to prevent collisions. Pure when seed provided, uses generateSync otherwise. */
const sanitize = (raw: string, seed?: string): Option.Option<Svg> => {
	const scope = seed === undefined ? Hex8.generateSync() : Hex8.derive(seed);
	const idMap = new Map<string, string>();
	DOMPurify.addHook('afterSanitizeAttributes', (node) => rewriteNode(node, idMap, scope));
	const result = DOMPurify.sanitize(raw, {
		ADD_ATTR: [...B.purify.ADD_ATTR],
		ADD_TAGS: [...B.purify.ADD_TAGS],
		USE_PROFILES: B.purify.USE_PROFILES,
	});
	DOMPurify.removeAllHooks();
	return result.includes('<svg') && result.includes('</svg>') ? Option.some(result as Svg) : Option.none();
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const Svg = Object.freeze({
	...companion(SvgSchema),
	sanitize,
	sanitizedSchema: S.transformOrFail(S.String, SvgSchema, {
		decode: (raw, _, ast) => Option.match(sanitize(raw), {
			onNone: () => ParseResult.fail(new ParseResult.Type(ast, raw, 'Invalid SVG')),
			onSome: ParseResult.succeed,
		}),
		encode: ParseResult.succeed,
		strict: true,
	}),
});
const SvgAsset = Object.freeze({
	...companion(SvgAssetSchema),
	/** Create new asset with generated ID. Returns None if SVG sanitization fails. */
	create: (name: string, svg: string): Option.Option<SvgAsset> => Option.map(Svg.sanitize(svg), (sanitized) => ({ id: Uuidv7.generateSync(), name, svg: sanitized })),
	inputSchema: S.Struct({ name: S.NonEmptyTrimmedString, svg: S.String }),
});

// --- [EXPORT] ----------------------------------------------------------------

export { Svg, SvgAsset };
