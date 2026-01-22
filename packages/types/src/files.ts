/**
 * Define file codec registry with format detection, validation, dispatch.
 * Single source for MIME/ext mapping, parser selection, binary vs text handling.
 */
/** biome-ignore-all assist/source/useSortedKeys: <needed> */
import type { Object as O } from 'ts-toolbelt'; 							// DO NOT REMOVE DO NOT REMOVE
import type { LiteralUnion, Simplify, ValueOf } from 'type-fest';
import { Schema as S, Stream } from 'effect';

// --- [PRIMITIVES] ------------------------------------------------------------

type _Input = ArrayBuffer | string;
type _Parser = 'archive' | 'delimited' | 'none' | 'stream' | 'tree'; 		// none: Equivalent to `blob` - for formats that don't parse into rows — single-asset content
type _Raw = Readonly<{		// Raw: registry entry (binary DERIVED from typeof has, not declared)
	category: 'archive' | 'code' | 'document' | 'image' | 'model';
	mime: string;
	parser: _Parser;
	transfer: boolean;
	has: number | string;	// - has: number → binary format (magic bytes)
	start?: true; 			// - has: string → text format (pattern match, start toggles startsWith vs includes)
	match?: string;			// - match: secondary includes check (used with start for combined patterns)
	exclude?: string;
	priority?: number;		// - priority: lower = higher priority in detection order (formats w/o priority or has='' excluded)
	[k: string]: unknown;
}>;
type _Def = _Raw | Readonly<{ aliasOf: string }>;

// --- [REGISTRY] --------------------------------------------------------------

const _Registry = (<const T extends Record<string, _Def>>(t: T & {[K in keyof T]: T[K] extends { aliasOf: infer A } ? (A extends keyof T ? T[K] : never) : T[K];}) => t)({
	zip:    { category: 'archive',  parser: 'archive',   transfer: true,  mime: 'application/zip',                                                   has: 0x04034B50, lib: 'jszip', priority: 180 },
	css:    { category: 'code',     parser: 'none',      transfer: false, mime: 'text/css',                                                          has: '' },
	js:     { category: 'code',     parser: 'none',      transfer: false, mime: 'text/javascript',                                                   has: '' },
	ts:     { category: 'code',     parser: 'none',      transfer: false, mime: 'text/typescript',                                                   has: '' },
	csv:    { category: 'document', parser: 'delimited', transfer: true,  mime: 'text/csv',                                                          has: ',',        exclude: '{',       sep: ',', priority: 40 },
	ndjson: { category: 'document', parser: 'stream',    transfer: true,  mime: 'application/x-ndjson',                                              has: '{',        exclude: '"nodes"', sep: '\n', start: true, priority: 60 },
	yaml:   { category: 'document', parser: 'stream',    transfer: true,  mime: 'application/x-yaml',                                                has: '---',      lib: 'yaml',        sep: '\n---\n', start: true, priority: 30 },
	tsv:    { category: 'document', parser: 'delimited', transfer: false, mime: 'text/tab-separated-values',                                         has: '\t',                           sep: '\t', priority: 50 },
	xlsx:   { category: 'document', parser: 'archive',   transfer: true,  mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', has: 0x04034B50, lib: 'exceljs', priority: 170 },
	xml:    { category: 'document', parser: 'tree',      transfer: false, mime: 'text/xml',                                                          has: '<',        exclude: '<svg',    nodes: ['item', 'entry', 'row', 'record'] as const, start: true, priority: 70 },
	html:   { category: 'document', parser: 'none',      transfer: false, mime: 'text/html',                                                         has: '<',        start: true, 		  match: '<html', priority: 80 },
	json:   { category: 'document', parser: 'none',      transfer: false, mime: 'application/json',                                                  has: '{',        start: true, priority: 90 },
	md:     { category: 'document', parser: 'none',      transfer: false, mime: 'text/markdown',                                                     has: '' },
	pdf:    { category: 'document', parser: 'none',      transfer: false, mime: 'application/pdf',                                                   has: 0x25504446, priority: 160 },
	txt:    { category: 'document', parser: 'none',      transfer: false, mime: 'text/plain',                                                        has: '' },
	avif:   { category: 'image',    parser: 'none',      transfer: false, mime: 'image/avif',                                                        has: 0 },
	bmp:    { category: 'image',    parser: 'none',      transfer: false, mime: 'image/bmp',                                                         has: 0 },
	gif:    { category: 'image',    parser: 'none',      transfer: false, mime: 'image/gif',                                                         has: 0x47494638, priority: 130 },
	ico:    { category: 'image',    parser: 'none',      transfer: false, mime: 'image/x-icon',                                                      has: 0 },
	jpeg:   { category: 'image',    parser: 'none',      transfer: false, mime: 'image/jpeg',                                                        has: 0xFFD8FFE0, priority: 120 },
	png:    { category: 'image',    parser: 'none',      transfer: false, mime: 'image/png',                                                         has: 0x89504E47, priority: 110 },
	tiff:   { category: 'image',    parser: 'none',      transfer: false, mime: 'image/tiff',                                                        has: 0x49492A00, priority: 150 },
	webp:   { category: 'image',    parser: 'none',      transfer: false, mime: 'image/webp',                                                        has: 0x52494646, priority: 140 },
	svg:    { category: 'image',    parser: 'none',      transfer: false, mime: 'image/svg+xml',                                                     has: '<svg', priority: 10 },
	glb:    { category: 'model',    parser: 'none',      transfer: false, mime: 'model/gltf-binary',                                                 has: 0x46546C67, priority: 100 },
	gltf:   { category: 'model',    parser: 'none',      transfer: false, mime: 'model/gltf+json',                                                   has: '"nodes"', priority: 20 },
	jpg:    { aliasOf: 'jpeg' },
});

// --- [DERIVED_TYPES] ---------------------------------------------------------

type _Reg = typeof _Registry;
type _Ext = keyof _Reg;
type _Canonical<E extends _Ext> = _Reg[E] extends { aliasOf: infer A extends _Ext } ? _Canonical<A> : E;
type _Canon = Simplify<{ [K in _Ext as _Reg[K] extends _Raw ? K : never]: _Reg[K] & _Raw }>;
type _CanonExt = keyof _Canon;
type _RawOf<E extends _Ext> = _Canon[Extract<_Canonical<E>, _CanonExt>];
type _Has<C extends Partial<_Raw>> = O.SelectKeys<_Canon, C, 'extends->'>;
type _ExtToMime = { [K in _CanonExt]: _Canon[K]['mime'] };
type _MimeToExt = O.Invert<_ExtToMime>;
type _Mime = ValueOf<_ExtToMime>;
type _Caps = {
	binary: _Has<{ has: number }>;
	text: _Has<{ has: string }>;
	transfer: _Has<{ transfer: true }>;
	delimited: _Has<{ parser: 'delimited' }>;
	stream: _Has<{ parser: 'stream' }>;
	tree: _Has<{ parser: 'tree' }>;
	archive: _Has<{ parser: 'archive' }>;
};
type _Derived = {
	parseable: Exclude<_CanonExt, _Has<{ parser: 'none' }>>;
	textTransfer: Extract<_Caps['transfer'], _Caps['text']>;
	binaryTransfer: Extract<_Caps['transfer'], _Caps['binary']>;
};
type _CapAll = keyof _Caps | keyof _Derived;
type _Query = Simplify<_Caps & _Derived & {
	ext: _CanonExt;
	mime: _Mime;
	entries: { [C in _CapAll]: _Canon[(_Caps & _Derived)[C]] };
	resolved: { [P in Exclude<_Parser, 'none'>]: _Resolved<_Has<{ parser: P }>> };
	map: { extToMime: _ExtToMime; mimeToExt: _MimeToExt };
}>;
type _ResolvedBase<E extends _CanonExt> = Simplify<_RawOf<E> & Readonly<{
	ext: E;
	canonical: E;
	binary: _RawOf<E>['has'] extends number ? true : false;
	_tag: _RawOf<E>['parser'];
	is(input: _Input): boolean;
	content(input: _Input): string;
	buf(input: _Input): Buffer;
	bytes(input: _Input): Stream.Stream<Uint8Array>;
}>>;
type _Resolved<E extends _Ext = _Ext> = E extends _CanonExt ? _ResolvedBase<E> : _ResolvedBase<_Canonical<E> & _CanonExt>;
type _Handlers<R> = Simplify<{ [P in _Parser]: (codec: _Resolved<_Has<{ parser: P }>>, input: _Input) => R }>;

// --- [INTERNAL] --------------------------------------------------------------

const DETECT_HEAD_SIZE = 512;
const _order = (Object.entries(_Registry) as [_CanonExt, _Def][])
	.filter((entry): entry is [_CanonExt, _Raw & { priority: number }] => !('aliasOf' in entry[1]) && (entry[1]).priority != null)
	.sort((first, second) => first[1].priority - second[1].priority)
	.map((entry) => entry[0]);
const _cache = (() => {		// [DESIGN] Entry IS config. Codec('csv').sep works via spread. Dispatch on parser, not ext.
	const make = <E extends _CanonExt>(ext: E): _Resolved<E> => {
		const raw = _Registry[ext] as _Raw, isBinary = typeof raw.has === 'number', pattern = raw.has as string, head = (input: string) => input.slice(0, DETECT_HEAD_SIZE);
		const is = isBinary
			? (input: _Input) => typeof input !== 'string' && input.byteLength >= 4 && new DataView(input).getUint32(0, true) === raw.has
			: (input: _Input) => typeof input === 'string' && (raw.start ? head(input).trim().startsWith(pattern) : pattern === '' || head(input).includes(pattern)) && (!raw.match || head(input).includes(raw.match)) && (!raw.exclude || !head(input).includes(raw.exclude));
		const content = isBinary
			? (input: _Input) => typeof input === 'string' ? input : Buffer.from(input).toString('base64')
			: (input: _Input) => typeof input === 'string' ? input : new TextDecoder().decode(input);
		const buf = isBinary
			? (input: _Input) => typeof input === 'string' ? Buffer.from(input, 'base64') : Buffer.from(new Uint8Array(input))
			: (input: _Input) => typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(new Uint8Array(input));
		const bytes = (input: _Input) => Stream.make(typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input));
		return { ...raw, ext, canonical: ext, binary: isBinary, _tag: raw.parser, is, content, buf, bytes } as _Resolved<E>;
	};
	const keys = (Object.keys(_Registry) as _Ext[]).filter((key): key is _CanonExt => !('aliasOf' in _Registry[key]));
	const byExt = Object.fromEntries(keys.map((ext) => [ext, make(ext)])) as { [K in _CanonExt]: _Resolved<K> };
	const byMime = Object.fromEntries(keys.map((ext) => [byExt[ext].mime, byExt[ext]])) as { [M in _Mime]: _Resolved<_MimeToExt[M]> };
	return Object.freeze({ ...byExt, ...byMime, keys });
})();
const _detect = (input: _Input): _CanonExt => _order.find((ext) => _cache[ext].is(input)) ?? 'txt';
const _size = (input: _Input): number => typeof input === 'string' ? Buffer.byteLength(input) : input.byteLength;

// --- [CODEC] -----------------------------------------------------------------

const _pred: { [C in _CapAll]: (codec: _Resolved<_CanonExt>) => boolean } = {
	binary:         (codec) => codec.binary,
	text:           (codec) => !codec.binary,
	transfer:       (codec) => codec.transfer,
	delimited:      (codec) => codec.parser === 'delimited',
	stream:         (codec) => codec.parser === 'stream',
	tree:           (codec) => codec.parser === 'tree',
	archive:        (codec) => codec.parser === 'archive',
	parseable:      (codec) => codec.parser !== 'none',
	textTransfer:   (codec) => !codec.binary && codec.transfer,
	binaryTransfer: (codec) => codec.binary && codec.transfer,
};
const _query = Object.fromEntries((Object.keys(_pred) as _CapAll[]).map((cap) => [cap, _cache.keys.filter((key) => _pred[cap](_cache[key]))])) as unknown as { readonly [C in _CapAll]: readonly _Query[C][] };
const _dispatch = <R>(format: _Ext | _Mime, input: _Input, handlers: _Handlers<R>): R => {
	const codec = _cache[format as _CanonExt] ?? _cache[_detect(typeof format === 'string' ? format : input)];
	switch (codec._tag) {
		case 'delimited': return handlers.delimited(codec, input);
		case 'stream': return handlers.stream(codec, input);
		case 'archive': return handlers.archive(codec, input);
		case 'tree': return handlers.tree(codec, input);
		case 'none': return handlers.none(codec, input);
	}
};
function _codec<E extends _Ext>(ext: E): _Resolved<E>;
function _codec<M extends _Mime>(mime: M): _Resolved<_MimeToExt[M]>;
function _codec(input: ArrayBuffer): _Resolved<_CanonExt>;
function _codec(input: LiteralUnion<_Ext | _Mime, string>): _Resolved<_CanonExt>;
function _codec(extOrInput: _Ext | _Input | _Mime): _Resolved<_Ext> {return typeof extOrInput === 'string' ? (_cache[extOrInput as _CanonExt] ?? _cache[_detect(extOrInput)]) : _cache[_detect(extOrInput)];}

// --- [SCHEMAS] ---------------------------------------------------------------

class Metadata extends S.Class<Metadata>('Metadata')({
	content: S.optional(S.String),
	hash: S.optional(S.String),
	id: S.optional(S.UUID),
	kind: S.optional(S.NonEmptyTrimmedString),
	mime: S.String,
	name: S.NonEmptyTrimmedString,
	size: S.NonNegativeInt,
	updatedAt: S.optional(S.Number),
}) {
	#codec?: _Resolved;
	get codec() {
		this.#codec = this.#codec ?? _codec(this.mime);
		return this.#codec;
	}
	get ext() { return this.codec.ext; }
	get binary() { return this.codec.binary; }
	get category() { return this.codec.category; }
	get mode(): 'archive' | 'code' | 'document' | 'image' | 'model' | 'svg' { return this.mime === 'image/svg+xml' ? 'svg' : this.category; }
	static from(content: string, opts: { kind: string; name: string; mime?: string; hash?: string; id?: string }) {
		return new Metadata({ content, hash: opts.hash, id: opts.id, kind: opts.kind, mime: opts.mime ?? 'text/plain', name: opts.name, size: _size(content) });
	}
}

// --- [CODEC_OBJECT] ----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Codec = Object.assign(_codec, _query, {
	detect: _detect,
	dispatch: _dispatch,
	entries: Object.fromEntries((Object.keys(_query) as _CapAll[]).map((cap) => [cap, _query[cap].map((key) => _cache[key])])) as unknown as { readonly [C in _CapAll]: readonly _Resolved<_Query[C]>[] },
	Manifest: S.Struct({ entries: S.Array(Metadata), version: S.Literal(1) }),
	Parseable: S.Literal(..._query.parseable),
	size: _size,
	Transfer: S.Literal(..._query.transfer),
});

// --- [NAMESPACE] -------------------------------------------------------------

namespace Codec {
	// Interface(s)
	export interface Limits { entryBytes?: number; totalBytes?: number; maxItems?: number; batchSize?: number; compressionRatio?: number }
	// Type(s)
	export type BinaryExport = _Query['binaryTransfer'];
	export type Ext<E extends _CanonExt = _CanonExt> = E;
	export type Handlers<R> = _Handlers<R>;
	export type Input<I extends _Input = _Input> = I;
	export type Mime<M extends _Mime = _Mime> = M;
	export type Of<P extends 'archive' | 'delimited' | 'stream' | 'tree'> = _Query['resolved'][P];
	export type Resolved<E extends _CanonExt = _CanonExt> = _Resolved<E>;
	export type TextExport = _Query['textTransfer'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Codec, Metadata };
