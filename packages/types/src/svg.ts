/**
 * Sanitize SVG markup with scoped ID rewriting via DOMPurify.
 * Companion bundles schema + sanitize operation returning Option<Svg>.
 */
import { Option, ParseResult, pipe, Schema as S } from 'effect';
import DOMPurify from 'isomorphic-dompurify';
import { Hex8 } from './types.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const XLINK_NS = 'http://www.w3.org/1999/xlink';
const PURIFY_CONFIG = {
	ADD_ATTR: ['href', 'xlink:href'],
	ADD_TAGS: ['use'],
	USE_PROFILES: { svg: true },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const replaceUrlRefs = (val: string, idMap: Map<string, string>): string =>
	val.replaceAll(/url\(#([^)]+)\)/g, (_, id: string) => `url(#${idMap.get(id) ?? id})`);
const rewriteNode = (node: Element, idMap: Map<string, string>, scope: string): void => {
	Option.fromNullable(node.getAttribute?.('id')).pipe(
		Option.map((id) => {
			idMap.set(id, `${id}_${scope}`);
			return node.setAttribute('id', `${id}_${scope}`);
		}),
	);
	(['href', 'xlink:href'] as const).forEach((attr) => {
		Option.fromNullable( attr === 'href' ? node.getAttribute?.('href') : node.getAttributeNS?.(XLINK_NS, 'href'),
		).pipe(
			Option.filter((value) => value.startsWith('#')),
			Option.map((value) => value.slice(1)),
			Option.filter((id) => idMap.has(id)),
			Option.map((id) =>
				attr === 'href'
					? node.setAttribute('href', `#${id}`)
					: node.setAttributeNS?.(XLINK_NS, 'xlink:href', `#${id}`),
			),
		);
	});
	(['fill', 'stroke', 'clip-path', 'mask', 'filter'] as const).forEach((attr) => {
		Option.fromNullable(node.getAttribute?.(attr)).pipe(
			Option.filter((value) => value.includes('url(#')),
			Option.map((value) => node.setAttribute(attr, replaceUrlRefs(value, idMap))),
		);
	});
	Option.fromNullable(node.textContent).pipe(
		Option.filter(() => node.tagName?.toLowerCase() === 'style'),
		Option.filter((value) => value.includes('url(#')),
		Option.map((text) => {
			// biome-ignore lint/style/noParameterAssign: DOMPurify hooks require in-place DOM mutation
			node.textContent = replaceUrlRefs(text, idMap);
			return undefined;
		}),
	);
};

// --- [COMPANIONS] ------------------------------------------------------------

const Svg = (() => {
	const schema = pipe(
		S.String,
		S.filter((markup) => markup.includes('<svg') && markup.includes('</svg>'), { message: () => 'Invalid SVG markup' }),
		S.brand('Svg'),
	);
	type T = typeof schema.Type;
	const sanitize = (raw: string, seed?: string): Option.Option<T> => {
		const scope = seed === undefined ? Hex8.generateSync() : Hex8.derive(seed);
		const idMap = new Map<string, string>();
		DOMPurify.addHook('afterSanitizeAttributes', (node) => rewriteNode(node, idMap, scope));
		const result = DOMPurify.sanitize(raw, {
			ADD_ATTR: [...PURIFY_CONFIG.ADD_ATTR],
			ADD_TAGS: [...PURIFY_CONFIG.ADD_TAGS],
			USE_PROFILES: PURIFY_CONFIG.USE_PROFILES,
		});
		DOMPurify.removeAllHooks();
		return result.includes('<svg') && result.includes('</svg>') ? Option.some(result as T) : Option.none();
	};
	const sanitizedSchema = S.transformOrFail(S.String, schema, {
		decode: (raw, _, ast) => Option.match(sanitize(raw), {
			onNone: () => ParseResult.fail(new ParseResult.Type(ast, raw, 'Invalid SVG')),
			onSome: ParseResult.succeed,
		}),
		encode: ParseResult.succeed,
		strict: true,
	});
	return { sanitize, sanitizedSchema, schema } as const;
})();
type Svg = typeof Svg.schema.Type;

// --- [EXPORT] ----------------------------------------------------------------

export { Svg };
