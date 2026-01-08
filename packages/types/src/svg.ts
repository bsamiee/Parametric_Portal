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
import { Hex8, Uuidv7 } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type Svg = S.Schema.Type<typeof SvgSchema>
type SvgAsset = S.Schema.Type<typeof SvgAssetSchema>

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
const SvgAssetSchema = S.Struct({ id: Uuidv7.schema, name: S.NonEmptyTrimmedString, svg: SvgSchema });
const SvgAssetInputSchema = S.Struct({ name: S.NonEmptyTrimmedString, svg: S.String });

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
	node.tagName?.toLowerCase() === 'style' && node.textContent?.includes('url(#') && (() => {
		// biome-ignore lint/style/noParameterAssign: DOMPurify hooks require in-place DOM mutation
		node.textContent = replaceUrlRefs(node.textContent, idMap);
	})();
};
const sanitize = (raw: string, seed?: string): Option.Option<Svg> => { 	/** Sanitize SVG and scope all IDs to prevent collisions. Pure when seed provided, uses generateSync otherwise. */
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
const make = <A, I>(schema: S.Schema<A, I, never>) => Object.freeze({ 	/** Create schema utilities object with common encode/decode/is helpers. */
	decode: S.decodeUnknown(schema),
	decodeSync: S.decodeUnknownSync(schema),
	encode: S.encode(schema),
	encodeSync: S.encodeSync(schema),
	is: S.is(schema),
	schema,
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const Svg = Object.freeze({
	...make(SvgSchema),
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
	...make(SvgAssetSchema),
	/** Create new asset with generated ID. Returns None if SVG sanitization fails. */
	create: (name: string, svg: string): Option.Option<SvgAsset> => Option.map(Svg.sanitize(svg), (sanitized) => ({ id: Uuidv7.generateSync(), name, svg: sanitized })),
	inputSchema: SvgAssetInputSchema,
});

// --- [EXPORT] ----------------------------------------------------------------

export { Svg, SvgAsset };
