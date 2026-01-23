/**
 * Stream file parsing and serialization for bulk import/export.
 * Codec-driven dispatch; Either accumulates parse errors, Fatal halts stream.
 */
import { Codec, Metadata } from '@parametric-portal/types/files';
import { Array as A, Chunk, Data, Effect, Either, Option, Ref, Schema as S, Stream } from 'effect';
import type JSZip from 'jszip';
import { PassThrough, Readable } from 'node:stream';
import { Crypto } from '../security/crypto.ts';

// --- [DRIVERS] ---------------------------------------------------------------

const _drivers = {
	excel: () => Effect.promise(() => import('exceljs')),
	papa:  () => Effect.promise(() => import('papaparse')),
	sax:   () => Effect.promise(() => import('sax')),
	yaml:  () => Effect.promise(() => import('yaml')),
	zip:   () => Effect.promise(async () => (await import('jszip')).default),
} as const;

// --- [TYPES] -----------------------------------------------------------------

type _Asset = { readonly content: string; readonly hash?: string; readonly kind: string; readonly name?: string; readonly ordinal: number };
type _Row = Either.Either<_Asset, TransferError.Parse>;
type _Stream = Stream.Stream<_Row, TransferError.Fatal>;

// --- [ERRORS] ----------------------------------------------------------------

class Parse extends Data.TaggedError('Parse')<{
	readonly code: 'DECOMPRESS' | 'HASH_MISMATCH' | 'INVALID_PATH' | 'INVALID_RECORD' | 'MISSING_KIND' | 'SCHEMA_MISMATCH' | 'TOO_LARGE';
	readonly ordinal?: number;
	readonly detail?: string;
}> { override get message() { return this.detail ? `Parse[${this.code}]@${this.ordinal}: ${this.detail}` : `Parse[${this.code}]@${this.ordinal}`; }}

class Fatal extends Data.TaggedError('Fatal')<{
	readonly code: 'ARCHIVE_LIMIT' | 'COMPRESSION_RATIO' | 'INVALID_FORMAT' | 'INVALID_MANIFEST' | 'PARSER_ERROR' | 'ROW_LIMIT' | 'UNSUPPORTED';
	readonly detail?: string;
}> { override get message() { return this.detail ? `Fatal[${this.code}]: ${this.detail}` : `Fatal[${this.code}]`; }}

class Import extends Data.TaggedError('Import')<{
	readonly code: 'BATCH_FAILED';
	readonly rows: readonly number[];
	readonly cause?: unknown;
}> { override get message() { return `Import[${this.code}] rows: ${this.rows.join(', ')}`; }}

// --- [CONSTANTS] -------------------------------------------------------------

const limits = { batchSize: 500, compressionRatio: 100, entryBytes: 5 * 1024 * 1024, maxItems: 10_000, totalBytes: 50 * 1024 * 1024 } as const satisfies Codec.Limits;
const _parserError = (err: unknown): Fatal => {
	const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
	return new Fatal({ code: 'PARSER_ERROR', detail: msg });
};
const _validPath = (name: string) => !name.includes('..') && !name.startsWith('/');

// --- [PARSERS] ---------------------------------------------------------------

const _parseRecord = (line: string, ordinal: number, kind: string, parse: (str: string) => unknown = JSON.parse): _Row =>
	Either.try({ catch: () => new Parse({ code: 'INVALID_RECORD', ordinal }), try: () => parse(line) }).pipe(
		Either.flatMap((obj) => {
			const parsed = obj as Record<string, unknown>;
			const assetKind = (parsed['kind'] as string) ?? kind;
			const content = String(parsed['content'] ?? line);
			return assetKind ? Either.right<_Asset>({ content, kind: assetKind, ordinal }) : Either.left(new Parse({ code: 'MISSING_KIND', ordinal }));
		}),
	);
const _delimited = (codec: Codec.Of<'delimited'>, input: Codec.Input, kind: string): _Stream =>
	Stream.unwrap(_drivers.papa().pipe(Effect.map((Papa) => ((result) =>
		result.errors.length > 0
			? Stream.fail(_parserError(result.errors[0]))
			: Stream.fromIterable(result.data).pipe(
				Stream.zipWithIndex,
				Stream.map(([data, idx]) => ((ordinal, assetKind) =>
					assetKind ? Either.right({ content: data['content'] ?? '', kind: assetKind, ordinal }) : Either.left(new Parse({ code: 'MISSING_KIND', ordinal }))
				)(idx + 1, data['kind'] ?? kind)),
			)
	)(Papa.parse<Record<string, string>>(codec.content(input), { delimiter: codec.sep, header: true, skipEmptyLines: 'greedy', transformHeader: (header) => header.trim().toLowerCase().replaceAll('_', '') })))));
const _streamed = (codec: Codec.Of<'stream'>, input: Codec.Input, kind: string): _Stream =>
	Stream.unwrap((codec.lib ? _drivers[codec.lib as 'yaml']() : Effect.succeed({ parse: JSON.parse })).pipe(Effect.map((mod) =>
		(codec.sep === '\n'
			? codec.bytes(input).pipe(Stream.decodeText(), Stream.splitLines)
			: Stream.fromIterable(codec.content(input).split(codec.sep))
		).pipe(Stream.zipWithIndex, Stream.filterMap(([line, idx]) => ((trimmed, ordinal) =>
			trimmed ? Codec.size(trimmed) > limits.entryBytes ? Option.some(Either.left(new Parse({ code: 'TOO_LARGE', ordinal })))
			: Option.some(_parseRecord(trimmed, ordinal, kind, mod.parse)) : Option.none()
		)(line.trim(), idx + 1))),
	)));
const _tree = (codec: Codec.Of<'tree'>, input: Codec.Input, kind: string): _Stream =>
	Stream.unwrap(_drivers.sax().pipe(Effect.map((sax) =>
		Stream.async<_Row, Fatal>((emit) => {
			const parser = sax.parser(true, { trim: true });
			const tags = new Set<string>(codec.nodes);
			let current: { content: string; kind: string } | null = null;
			let idx = 0;
			parser.onopentag = (tag) => { if (tags.has(tag.name.toLowerCase())) { const attr = tag.attributes['kind']; current = { content: '', kind: (typeof attr === 'string' ? attr : attr?.value) ?? kind }; } };
			parser.ontext = (text: string) => { if (current) current.content += text; };
			parser.oncdata = (text: string) => { if (current) current.content += text; };
			parser.onclosetag = (name: string) => { if (current && tags.has(name.toLowerCase())) { idx += 1; emit.single(current.kind ? Either.right({ ...current, ordinal: idx }) : Either.left(new Parse({ code: 'MISSING_KIND', ordinal: idx }))); current = null; } };
			parser.onerror = (err: Error) => void emit.fail(_parserError(err));
			parser.onend = () => void emit.end();
			parser.write(codec.content(input)).close();
		}),
	)));
const _xlsx = (codec: Codec.Of<'archive'>, input: Codec.Input, kind: string): _Stream =>
	Stream.unwrap(_drivers.excel().pipe(Effect.map((ExcelJS) => {
		const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(codec.buf(input)), { hyperlinks: 'ignore', sharedStrings: 'cache', styles: 'ignore', worksheets: 'emit' });
		return Stream.fromAsyncIterable(reader as AsyncIterable<AsyncIterable<{ values: unknown[] }>>, _parserError).pipe(
			Stream.take(1),
			Stream.flatMap((worksheet) => Stream.fromAsyncIterable(worksheet, _parserError)),
			Stream.drop(1),
			Stream.zipWithIndex,
			Stream.map(([row, idx]) => {
				const assetKind = String(row.values?.[1] ?? kind);
				return assetKind ? Either.right({ content: String(row.values?.[2] ?? ''), kind: assetKind, ordinal: idx + 2 }) : Either.left(new Parse({ code: 'MISSING_KIND', ordinal: idx + 2 }));
			}),
		);
	})));
const _zipNoManifest = (zip: JSZip, kind: string): _Stream =>
	Stream.fromIterable(Object.values(zip.files).filter((file) => !file.dir)).pipe(
		Stream.zipWithIndex,
		Stream.map(([file, idx]) => ({ file, name: file.name, ordinal: idx + 1 })),
		Stream.mapEffect(({ file, name, ordinal }) =>
			Effect.tryPromise({ catch: () => new Parse({ code: 'DECOMPRESS', ordinal }), try: () => file.async('text') }).pipe(
				Effect.map((content) => Either.right({ content, kind: Codec(name.split('.').pop() ?? kind).ext, ordinal })),
				Effect.catchAll((err) => Effect.succeed(Either.left(err))),
			),
		),
	);
const _zipWithManifest = (zip: JSZip, manifest: { entries: readonly Metadata[]; version: 1 }, buf: Buffer): _Stream =>
	Stream.unwrap(Ref.make(0).pipe(Effect.map((sizeRef) =>
		Stream.fromIterable(manifest.entries).pipe(
			Stream.filter((entry) => entry.name !== 'manifest.json'),
			Stream.zipWithIndex,
			Stream.map(([entry, idx]) => ({ entry, name: entry.name, ordinal: idx + 1 })),
			Stream.mapEffect(({ entry, name, ordinal }) => Effect.gen(function* () {
				const file = yield* Effect.filterOrFail(Effect.succeed(zip.file(name)), (zipFile): zipFile is JSZip.JSZipObject => zipFile != null && !zipFile.dir && _validPath(name), () => new Parse({ code: 'INVALID_PATH', detail: name, ordinal }));
				yield* Effect.filterOrFail(Effect.succeed(entry.size), (size) => size <= limits.entryBytes, () => new Parse({ code: 'TOO_LARGE', detail: name, ordinal }));
				const raw = yield* Effect.tryPromise({ catch: () => new Parse({ code: 'DECOMPRESS', detail: name, ordinal }), try: () => file.async('arraybuffer') });
				const cur = yield* Ref.updateAndGet(sizeRef, (count) => count + raw.byteLength);
				yield* Effect.filterOrFail(Effect.succeed(cur), (cumulative) => cumulative <= limits.totalBytes, () => new Fatal({ code: 'ARCHIVE_LIMIT' }));
				yield* Effect.filterOrFail(Effect.succeed(cur), (cumulative) => !buf.byteLength || cumulative / buf.byteLength <= limits.compressionRatio, () => new Fatal({ code: 'COMPRESSION_RATIO' }));
				const content = entry.codec.content(raw);
				yield* entry.hash ? Crypto.token.hash(content).pipe(Effect.orDie, Effect.filterOrFail((hash) => hash === entry.hash, () => new Parse({ code: 'HASH_MISMATCH', detail: name, ordinal }))) : Effect.void;
				const kind = yield* Effect.filterOrFail(Effect.succeed(entry.kind), (assetKind): assetKind is string => assetKind != null, () => new Parse({ code: 'MISSING_KIND', detail: name, ordinal }));
				return Either.right({ content, kind, name, ordinal, ...(entry.hash && { hash: entry.hash }) });
			}).pipe(Effect.catchTag('Parse', (err) => Effect.succeed(Either.left(err))))),
		),
	)));
const _zip = (codec: Codec.Of<'archive'>, input: Codec.Input, kind: string): _Stream =>
	Stream.unwrap(Effect.gen(function* () {
		const JSZip = yield* _drivers.zip();
		const buf = codec.buf(input);
		const zip = yield* Effect.tryPromise({ catch: (err) => new Fatal({ code: 'INVALID_FORMAT', detail: String(err) }), try: () => JSZip.loadAsync(buf) });
		return yield* Option.match(Option.fromNullable(zip.file('manifest.json')), {
			onNone: () => Effect.succeed(_zipNoManifest(zip, kind)),
			onSome: (manifestFile) => Effect.gen(function* () {
				const text = yield* Effect.tryPromise({ catch: (err) => new Fatal({ code: 'INVALID_MANIFEST', detail: String(err) }), try: () => manifestFile.async('text') });
				const manifest = yield* S.decodeUnknown(S.parseJson(Codec.Manifest))(text).pipe(Effect.mapError((err) => new Fatal({ code: 'INVALID_MANIFEST', detail: String(err) })));
				return _zipWithManifest(zip, manifest, buf);
			}),
		});
	}));
const _archive = (codec: Codec.Of<'archive'>, input: Codec.Input, kind: string): _Stream =>
	codec.lib === 'exceljs' ? _xlsx(codec, input, kind) : _zip(codec, input, kind);

// --- [IMPORT] ----------------------------------------------------------------

const import_ = (input: Codec.Input | readonly Codec.Input[], opts: {
	readonly mode?: 'file' | 'rows';
	readonly kind?: string;
	readonly format?: Codec.Ext;
} = {}): _Stream => {
	const inputs = Array.isArray(input) ? input : [input];
	const kind = opts.kind ?? 'unknown';
	return Stream.fromIterable(inputs).pipe(
		Stream.flatMap((item): Stream.Stream<_Row, Fatal> => {
			const codec = Codec(opts.format ?? Codec.detect(item));
			const result = opts.mode === 'file'
				? Stream.make(Either.right({ content: codec.content(item), kind, ordinal: 1 }))
				: Codec.dispatch(codec.ext, item, {
						archive: (detected, raw) => _archive(detected, raw, kind),
						delimited: (detected, raw) => _delimited(detected, raw, kind),
						none: (detected, raw) => Stream.make(Either.right({ content: detected.content(raw), kind: kind === 'unknown' ? detected.ext : kind, ordinal: 1 })),
						stream: (detected, raw) => _streamed(detected, raw, kind),
						tree: (detected, raw) => _tree(detected, raw, kind),
					});
			return opts.format
				? result : Stream.fromEffect(Effect.logDebug('Transfer: auto-detected', { format: codec.ext })).pipe(Stream.flatMap(() => result));
		}),
		Stream.zipWithIndex,
		Stream.mapEffect(([row, idx]) => idx >= limits.maxItems ? Effect.fail(new Fatal({ code: 'ROW_LIMIT' })) : Effect.succeed(row)),
	);
};

// --- [SERIALIZERS] -----------------------------------------------------------

type _Out<E, R> = Stream.Stream<_Asset & { id: string; updatedAt: number }, E, R>;
const _serializeExport = (asset: _Asset & { id: string; updatedAt: number }) => ({ content: asset.content, id: asset.id, kind: asset.kind, updatedAt: new Date(asset.updatedAt).toISOString() });

const _text = {
	csv: <E, R>(stream: _Out<E, R>) => Stream.unwrap(_drivers.papa().pipe(Effect.map((papa) => Stream.grouped(stream, limits.batchSize).pipe(Stream.zipWithIndex, Stream.map(([chunk, idx]) => `${papa.unparse(Chunk.toArray(chunk).map(_serializeExport), { header: idx === 0, quotes: true })}\n`))))),
	ndjson: <E, R>(stream: _Out<E, R>) => Stream.grouped(stream, limits.batchSize).pipe(Stream.map((chunk) => `${Chunk.toArray(chunk).map((asset) => JSON.stringify(_serializeExport(asset))).join('\n')}\n`)),
	xml: <E, R>(stream: _Out<E, R>) => Stream.make('<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n').pipe(
		Stream.concat(Stream.map(stream, (asset) => `  <asset kind="${asset.kind}" id="${asset.id}"><![CDATA[${asset.content}]]></asset>\n`)),
		Stream.concat(Stream.make('</assets>\n')),
	),
	yaml: <E, R>(stream: _Out<E, R>) => Stream.unwrap(_drivers.yaml().pipe(Effect.map((yaml) => Stream.map(stream, (asset) => `---\n${yaml.stringify(_serializeExport(asset))}`)))),
} as const;
const _binary = {
	xlsx: <E, R>(stream: _Out<E, R>, name?: string): Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R> => Effect.gen(function* () {
		const excel = yield* _drivers.excel();
		const chunks: Buffer[] = [];
		const pt = new PassThrough();
		pt.on('data', (buf: Buffer) => chunks.push(buf));
		const wb = new excel.stream.xlsx.WorkbookWriter({ stream: pt, useSharedStrings: false, useStyles: false });
		const sheet = wb.addWorksheet('Assets');
		sheet.columns = [{ header: 'Kind', key: 'kind', width: 20 }, { header: 'Id', key: 'id', width: 40 }, { header: 'Content', key: 'content', width: 60 }, { header: 'UpdatedAt', key: 'updatedAt', width: 24 }];
		const count = yield* Stream.runFold(stream, 0, (rowCount, asset) => { sheet.addRow(_serializeExport(asset)).commit(); return rowCount + 1; });
		sheet.commit();
		yield* Effect.promise(() => wb.commit());
		return { count, data: Buffer.concat(chunks).toString('base64'), name: name ?? `export-${Date.now()}.xlsx` };
	}),
	zip: <E, R>(stream: _Out<E, R>, name?: string): Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R> => Effect.gen(function* () {
		const ZipClass = yield* _drivers.zip();
		const zip = new ZipClass();
		const entries: Metadata[] = [];
		const count = yield* Stream.runFoldEffect(stream, 0, (entryCount, asset) =>
			(asset.hash == null ? Crypto.token.hash(asset.content).pipe(Effect.orDie) : Effect.succeed(asset.hash)).pipe(Effect.map((hash) => {
				const entryName = asset.name ?? `${String(entryCount).padStart(5, '0')}_${hash.slice(0, 8)}.txt`;
				zip.file(entryName, asset.content, { compression: 'DEFLATE' });
				entries.push(Metadata.from(asset.content, { hash, kind: asset.kind, name: entryName }));
				return entryCount + 1;
			})),
		);
		zip.file('manifest.json', JSON.stringify({ entries, version: 1 }, null, 2));
		const data = yield* Effect.promise(() => zip.generateAsync({ compression: 'DEFLATE', type: 'base64' }));
		return { count, data, name: name ?? `export-${Date.now()}.zip` };
	}),
} as const;
const exportText = <E, R>(stream: _Out<E, R>, fmt: keyof typeof _text): Stream.Stream<Uint8Array, E, R> => Stream.map(_text[fmt](stream), new TextEncoder().encode);
const exportBinary = <E, R>(stream: _Out<E, R>, fmt: keyof typeof _binary, opts?: { readonly name?: string }) => _binary[fmt](stream, opts?.name);

// --- [PARTITION] -------------------------------------------------------------

const partition = <T extends _Asset>(rows: readonly Either.Either<T, Parse>[]) => {
	const [failures, rights] = A.separate(rows);
	return { failures, items: rights, ordinalMap: A.map(rights, (row) => row.ordinal) };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Transfer = {
	exportBinary,
	exportText,
	formats: {
		binary: { xlsx: 'xlsx', zip: 'zip' } as const,
		text: { csv: 'csv', ndjson: 'ndjson', xml: 'xml', yaml: 'yaml' } as const,
	},
	import: import_,
	limits,
	partition,
} as const;
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const TransferError = {
	Fatal,
	Import,
	Parse
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Transfer {
	export type BinaryFormat = keyof typeof Transfer.formats.binary;
	export type BinaryResult = Effect.Effect.Success<ReturnType<typeof Transfer.exportBinary>>;
	export type ImportOpts = NonNullable<Parameters<typeof Transfer.import>[1]>;
	export type TextFormat = keyof typeof Transfer.formats.text;
}
namespace TransferError {
	export type Any = Fatal | Import | Parse;
	export type Fatal = InstanceType<typeof TransferError.Fatal>;
	export type Import = InstanceType<typeof TransferError.Import>;
	export type Parse = InstanceType<typeof TransferError.Parse>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Transfer, TransferError };
