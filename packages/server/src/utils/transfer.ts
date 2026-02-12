/**
 * Stream file parsing and serialization for bulk import/export.
 * Codec-driven dispatch; Either accumulates parse errors, Fatal halts stream.
 */
import { Codec, Metadata } from '@parametric-portal/types/files';
import { Array as A, Chunk, Clock, Effect, Either, Match, MutableRef, Option, Schema as S, Stream, Tuple } from 'effect';
import type JSZip from 'jszip';
import { PassThrough, Readable } from 'node:stream';
import { Telemetry } from '../observe/telemetry.ts';
import { Crypto } from '../security/crypto.ts';

// --- [DRIVERS] ---------------------------------------------------------------

const _drivers = {
    excel: () => Effect.promise(() => import('exceljs')),
    papa:  () => Effect.promise(() => import('papaparse')),
    sax:   () => Effect.promise(() => import('sax')),
    yaml:  () => Effect.promise(() => import('yaml')),
    zip:   () => Effect.promise(() => import('jszip').then((module) => module.default)),
} as const;

// --- [TYPES] -----------------------------------------------------------------

type _Asset = { readonly content: string; readonly hash?: string; readonly type: string; readonly name?: string; readonly mime?: string; readonly ordinal: number };
type _Row = Either.Either<_Asset, TransferError.Parse>;
type _Stream = Stream.Stream<_Row, TransferError.Fatal>;

// --- [ERRORS] ----------------------------------------------------------------

class Parse extends S.TaggedError<Parse>()('Parse', {
    code: S.Literal('DECOMPRESS', 'HASH_MISMATCH', 'INVALID_PATH', 'INVALID_RECORD', 'MISSING_TYPE', 'SCHEMA_MISMATCH', 'TOO_LARGE'),
    detail: S.optional(S.String),
    ordinal: S.optional(S.Number),
}) { override get message() { return this.detail ? `Parse[${this.code}]@${this.ordinal}: ${this.detail}` : `Parse[${this.code}]@${this.ordinal}`; }}
class Fatal extends S.TaggedError<Fatal>()('Fatal', {
    code: S.Literal('ARCHIVE_LIMIT', 'COMPRESSION_RATIO', 'INVALID_FORMAT', 'INVALID_MANIFEST', 'PARSER_ERROR', 'ROW_LIMIT', 'UNSUPPORTED'),
    detail: S.optional(S.String),
}) { override get message() { return this.detail ? `Fatal[${this.code}]: ${this.detail}` : `Fatal[${this.code}]`; }}
class Import extends S.TaggedError<Import>()('Import', {
    cause: S.optional(S.Unknown),
    code: S.Literal('BATCH_FAILED'),
    rows: S.Array(S.Number),
}) { override get message() { return `Import[${this.code}] rows: ${this.rows.join(', ')}`; }}

// --- [CONSTANTS] -------------------------------------------------------------

const limits = { batchSize: 500, compressionRatio: 100, entryBytes: 1 * 1024 * 1024, maxItems: 10_000, totalBytes: 50 * 1024 * 1024 } as const satisfies Codec.Limits;
const _parserError = (err: unknown): Fatal => {
    const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : String(err);
    return new Fatal({ code: 'PARSER_ERROR', detail: msg });
};

// --- [PARSERS] ---------------------------------------------------------------

const _parseRecord = (line: string, ordinal: number, assetType: string, parse: (str: string) => unknown = JSON.parse): _Row =>
    Either.try({ catch: () => new Parse({ code: 'INVALID_RECORD', ordinal }), try: () => parse(line) }).pipe(
        Either.flatMap((obj) => {
            const parsed = obj as Record<string, unknown>;
            const parsedType = (parsed['type'] as string) ?? assetType;
            const content = String(parsed['content'] ?? line);
            const hash = typeof parsed['hash'] === 'string' ? parsed['hash'] : undefined;
            const name = typeof parsed['name'] === 'string' ? parsed['name'] : undefined;
            const mime = typeof parsed['mime'] === 'string' ? parsed['mime'] : undefined;
            return parsedType
                ? Either.right<_Asset>({ content, ordinal, type: parsedType, ...(hash && { hash }), ...(name && { name }), ...(mime && { mime }) })
                : Either.left(new Parse({ code: 'MISSING_TYPE', ordinal }));
        }),
    );
const _delimited = (codec: Codec.Of<'delimited'>, input: Codec.Input, assetType: string): _Stream =>
    Stream.unwrap(_drivers.papa().pipe(Effect.map((Papa) => ((result) =>
        result.errors.length > 0
            ? Stream.fail(_parserError(result.errors[0]))
            : Stream.fromIterable(result.data).pipe(
                Stream.zipWithIndex,
                Stream.map(([data, idx]) => {
                    const ordinal = idx + 1, parsedType = data['type'] ?? assetType;
                    return parsedType
                        ? Either.right({ content: data['content'] ?? '', ordinal, type: parsedType, ...(data['hash'] && { hash: data['hash'] }), ...(data['name'] && { name: data['name'] }), ...(data['mime'] && { mime: data['mime'] }) })
                        : Either.left(new Parse({ code: 'MISSING_TYPE', ordinal }));
                }),
            )
    )(Papa.parse<Record<string, string>>(codec.content(input), { delimiter: codec.sep, header: true, skipEmptyLines: 'greedy', transformHeader: (header) => header.trim().toLowerCase().replaceAll('_', '') })))));
const _streamed = (codec: Codec.Of<'stream'>, input: Codec.Input, assetType: string): _Stream =>
    Stream.unwrap((codec.lib ? _drivers[codec.lib as 'yaml']() : Effect.succeed({ parse: JSON.parse })).pipe(Effect.map((mod) =>
        (codec.sep === '\n'
            ? codec.bytes(input).pipe(Stream.decodeText(), Stream.splitLines)
            : Stream.fromIterable(codec.content(input).split(codec.sep))
        ).pipe(Stream.zipWithIndex, Stream.filterMap(([line, idx]) => Option.liftPredicate(line.trim(), (t): t is string => t !== '').pipe(
            Option.map((trimmed) => {
                const ordinal = idx + 1;
                return Codec.size(trimmed) > limits.entryBytes ? Either.left(new Parse({ code: 'TOO_LARGE', ordinal })) : _parseRecord(trimmed, ordinal, assetType, mod.parse);
            }),
        ))),
    )));
const _tree = (codec: Codec.Of<'tree'>, input: Codec.Input, assetType: string): _Stream =>
    Stream.unwrap(_drivers.sax().pipe(Effect.map((sax) =>
        Stream.async<_Row, Fatal>((emit) => {
            const parser = sax.parser(true, { trim: true });
            const tags = new Set<string>(codec.nodes);
            const current = MutableRef.make<Option.Option<{ content: string; type: string }>>(Option.none());
            const idx = MutableRef.make(0);
            const _appendText = (text: string) => Option.map(MutableRef.get(current), (c) => {
                const next = { ...c, content: `${c.content}${text}` };
                MutableRef.set(current, Option.some(next));
                return next;
            });
            parser.onopentag = (tag) => Option.liftPredicate(tag, (t) => tags.has(t.name.toLowerCase())).pipe(Option.map((t) => {
                const attr = t.attributes['type'];
                const next = { content: '', type: (typeof attr === 'string' ? attr : attr?.value) ?? assetType };
                MutableRef.set(current, Option.some(next));
                return next;
            }));
            parser.ontext = (text: string) => _appendText(text);
            parser.oncdata = (text: string) => _appendText(text);
            parser.onclosetag = (name: string) => Option.flatMap(MutableRef.get(current), (c) =>
                Option.liftPredicate(name, (n) => tags.has(n.toLowerCase())).pipe(Option.map(() => {
                    const ordinal = MutableRef.incrementAndGet(idx);
                    emit.single(c.type ? Either.right({ ...c, ordinal }) : Either.left(new Parse({ code: 'MISSING_TYPE', ordinal })));
                    MutableRef.set(current, Option.none());
                    return c;
                })),
            );
            parser.onerror = (err: Error) => void emit.fail(_parserError(err));
            parser.onend = () => void emit.end();
            parser.write(codec.content(input)).close();
        }),
    )));
const _xlsx = (codec: Codec.Of<'archive'>, input: Codec.Input, assetType: string): _Stream =>
    Stream.unwrap(_drivers.excel().pipe(Effect.map((ExcelJS) => {
        const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(codec.buf(input)), { hyperlinks: 'ignore', sharedStrings: 'cache', styles: 'ignore', worksheets: 'emit' });
        return Stream.fromAsyncIterable(reader as AsyncIterable<AsyncIterable<{ values: unknown[] }>>, _parserError).pipe(
            Stream.take(1),
            Stream.flatMap((worksheet) => Stream.fromAsyncIterable(worksheet, _parserError)),
            Stream.drop(1),
            Stream.zipWithIndex,
            Stream.map(([row, idx]) => {
                const parsedType = String(row.values?.[1] ?? assetType);
                return parsedType ? Either.right({ content: String(row.values?.[3] ?? ''), ordinal: idx + 2, type: parsedType }) : Either.left(new Parse({ code: 'MISSING_TYPE', ordinal: idx + 2 }));
            }),
        );
    })));
const _zipNoManifest = (zip: JSZip, assetType: string): _Stream =>
    Stream.fromIterable(Object.values(zip.files).filter((file) => !file.dir)).pipe(
        Stream.zipWithIndex,
        Stream.map(([file, idx]) => ({ file, name: file.name, ordinal: idx + 1 })),
        Stream.mapEffect(({ file, name, ordinal }) => {
            const detected = Codec(name.split('.').pop() ?? assetType);
            return Effect.tryPromise({ catch: () => new Parse({ code: 'DECOMPRESS', ordinal }), try: () => file.async('arraybuffer') }).pipe(
                Effect.map((raw) => Either.right({ content: detected.content(raw), mime: detected.mime, name, ordinal, type: detected.ext })),
                Effect.catchAll((err) => Effect.succeed(Either.left(err))),
            );
        }),
    );
const _zipWithManifest = (zip: JSZip, manifest: { entries: readonly Metadata[]; version: 1 }, buf: Buffer): _Stream =>
    Stream.fromIterable(manifest.entries).pipe(
        Stream.filter((entry) => entry.name !== 'manifest.json'),
        Stream.zipWithIndex,
        Stream.map(([entry, idx]) => ({ entry, name: entry.name, ordinal: idx + 1 })),
        Stream.mapAccumEffect(0, (size, { entry, name, ordinal }): Effect.Effect<readonly [number, _Row], Fatal> => Effect.gen(function* () {
            const zipFile = zip.file(name);
            yield* zipFile == null || zipFile.dir || name.includes('..') || name.startsWith('/') ? Effect.fail(new Parse({ code: 'INVALID_PATH', detail: name, ordinal })) : Effect.void;
            yield* entry.size > limits.totalBytes ? Effect.fail(new Fatal({ code: 'ARCHIVE_LIMIT' })) : entry.codec.binary || entry.size <= limits.entryBytes ? Effect.void : Effect.fail(new Parse({ code: 'TOO_LARGE', detail: name, ordinal }));
            const raw = yield* Effect.tryPromise({ catch: () => new Parse({ code: 'DECOMPRESS', detail: name, ordinal }), try: () => (zipFile as JSZip.JSZipObject).async('arraybuffer') });
            const cur = size + raw.byteLength;
            yield* cur > limits.totalBytes ? Effect.fail(new Fatal({ code: 'ARCHIVE_LIMIT' })) : Effect.void;
            yield* buf.byteLength && cur / buf.byteLength > limits.compressionRatio ? Effect.fail(new Fatal({ code: 'COMPRESSION_RATIO' })) : Effect.void;
            const content = entry.codec.content(raw);
            yield* entry.hash ? Crypto.hash(content).pipe(Effect.orDie, Effect.flatMap((h) => h === entry.hash ? Effect.void : Effect.fail(new Parse({ code: 'HASH_MISMATCH', detail: name, ordinal })))) : Effect.void;
            yield* entry.type == null ? Effect.fail(new Parse({ code: 'MISSING_TYPE', detail: name, ordinal })) : Effect.void;
            const row: _Row = Either.right({ content, mime: entry.mime, name, ordinal, type: entry.type as string, ...(entry.hash && { hash: entry.hash }) });
            return [cur, row] as const;
        }).pipe(Effect.catchTag('Parse', (err): Effect.Effect<readonly [number, _Row]> => Effect.succeed([size, Either.left(err)] as const)))),
    );
const _zip = (codec: Codec.Of<'archive'>, input: Codec.Input, assetType: string): _Stream =>
    Stream.unwrap(Effect.gen(function* () {
        const JSZip = yield* _drivers.zip();
        const buf = codec.buf(input);
        const zip = yield* Effect.tryPromise({ catch: (err) => new Fatal({ code: 'INVALID_FORMAT', detail: String(err) }), try: () => JSZip.loadAsync(buf) });
        return yield* Option.match(Option.fromNullable(zip.file('manifest.json')), {
            onNone: () => Effect.succeed(_zipNoManifest(zip, assetType)),
            onSome: (manifestFile) =>
                Effect.tryPromise({ catch: (err) => new Fatal({ code: 'INVALID_MANIFEST', detail: String(err) }), try: () => manifestFile.async('text') }).pipe(
                    Effect.flatMap((text) => S.decodeUnknown(S.parseJson(Codec.Manifest))(text)),
                    Effect.mapError((err) => new Fatal({ code: 'INVALID_MANIFEST', detail: String(err) })),
                    Effect.map((manifest) => _zipWithManifest(zip, manifest, buf)),
                ),
        });
    }).pipe(Telemetry.span('transfer.parse.archive', { metrics: false })));
const _archive = (codec: Codec.Of<'archive'>, input: Codec.Input, assetType: string): _Stream => codec.lib === 'exceljs' ? _xlsx(codec, input, assetType) : _zip(codec, input, assetType);

// --- [IMPORT] ----------------------------------------------------------------

const import_ = (input: Codec.Input | readonly Codec.Input[], opts: {
    readonly mode?: 'file' | 'rows';
    readonly type?: string;
    readonly format?: Codec.Ext;} = {}): _Stream => {
    const inputs = Array.isArray(input) ? input : [input];
    const assetType = opts.type ?? 'unknown';
    return Stream.unwrap(Effect.succeed(
        Stream.fromIterable(inputs).pipe(
            Stream.flatMap((item): Stream.Stream<_Row, Fatal> => {
                const codec = Codec(opts.format ?? Codec.detect(item));
                const result: _Stream = opts.mode === 'file'
                    ? Stream.make(Either.right({ content: codec.content(item), ordinal: 1, type: assetType }))
                    : Codec.dispatch<_Stream>(codec.ext, item, {
                        archive:    (detected, raw) => _archive(detected, raw, assetType),
                        delimited:  (detected, raw) => _delimited(detected, raw, assetType),
                        none:       (detected, raw) => {
                            const content = detected.content(raw);
                            const type = assetType === 'unknown' ? detected.ext : assetType;
                            const tooLarge = !detected.binary && Codec.size(content) > limits.entryBytes;
                            return Stream.make(tooLarge
                                ? Either.left(new Parse({ code: 'TOO_LARGE', ordinal: 1 }))
                                : Either.right({ content, mime: detected.mime, ordinal: 1, type }));
                        },
                        stream:     (detected, raw) => _streamed(detected, raw, assetType),
                        tree:       (detected, raw) => _tree(detected, raw, assetType),
                    });
                return opts.format
                    ? result : Stream.fromEffect(Effect.logDebug('Transfer: auto-detected', { format: codec.ext })).pipe(Stream.flatMap(() => result));
            }),
            Stream.zipWithIndex,
            Stream.mapEffect(([row, idx]) => idx >= limits.maxItems ? Effect.fail(new Fatal({ code: 'ROW_LIMIT' })) : Effect.succeed(row)),
        ),
    ).pipe(Telemetry.span('transfer.import', { metrics: false, 'transfer.inputs': inputs.length })));
};

// --- [SERIALIZERS] -----------------------------------------------------------

type _Out<E, R> = Stream.Stream<_Asset & { id: string; updatedAt: number }, E, R>;
const _serializeExport = (asset: _Asset & { id: string; updatedAt: number }) => ({ content: asset.content, id: asset.id, type: asset.type, updatedAt: new Date(asset.updatedAt).toISOString() });
const _text = {
    csv: <E, R>(s: _Out<E, R>) => Stream.unwrap(_drivers.papa().pipe(Effect.map((papa) => Stream.grouped(s, limits.batchSize).pipe(Stream.zipWithIndex, Stream.map(([chunk, idx]) => `${papa.unparse(Chunk.toArray(chunk).map((a) => _serializeExport(a)), { header: idx === 0, quotes: true })}\n`))))),
    ndjson: <E, R>(s: _Out<E, R>) => Stream.grouped(s, limits.batchSize).pipe(Stream.map((chunk) => `${Chunk.toArray(chunk).map((asset) => JSON.stringify(_serializeExport(asset))).join('\n')}\n`)),
    xml: <E, R>(s: _Out<E, R>) => Stream.make('<?xml version="1.0" encoding="UTF-8"?>\n<assets>\n').pipe(
        Stream.concat(s.pipe(Stream.map((asset) => `  <asset type="${asset.type}" id="${asset.id}"><![CDATA[${asset.content}]]></asset>\n`))),
        Stream.concat(Stream.make('</assets>\n')),
    ),
    yaml: <E, R>(s: _Out<E, R>) => Stream.unwrap(_drivers.yaml().pipe(Effect.map((yaml) => s.pipe(Stream.map((asset) => `---\n${yaml.stringify(_serializeExport(asset))}`))))),
} as const;
const _binary = {
    xlsx: <E, R>(stream: _Out<E, R>, name?: string): Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R> => Effect.gen(function* () {
        const ts = yield* Clock.currentTimeMillis;
        const excel = yield* _drivers.excel();
        const chunks = MutableRef.make<readonly Buffer[]>([]);
        const pt = new PassThrough();
        pt.on('data', (buf: Buffer) => MutableRef.update(chunks, A.append(buf)));
        const wb = new excel.stream.xlsx.WorkbookWriter({ stream: pt, useSharedStrings: false, useStyles: false });
        const sheet = wb.addWorksheet('Assets');
        sheet.columns = [{ header: 'Type', key: 'type', width: 20 }, { header: 'Id', key: 'id', width: 40 }, { header: 'Content', key: 'content', width: 60 }, { header: 'UpdatedAt', key: 'updatedAt', width: 24 }];
        const count = yield* Stream.runFoldEffect(stream, 0, (rowCount, asset) => Effect.sync(() => { sheet.addRow(_serializeExport(asset)).commit(); }).pipe(Effect.as(rowCount + 1)));
        sheet.commit();
        yield* Effect.promise(() => wb.commit());
        return { count, data: Buffer.concat(MutableRef.get(chunks)).toString('base64'), name: name ?? `export-${ts}.xlsx` };
    }),
    zip: <E, R>(stream: _Out<E, R>, name?: string): Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R> => Effect.gen(function* () {
        const ts = yield* Clock.currentTimeMillis;
        const ZipClass = yield* _drivers.zip();
        const zip = new ZipClass();
        const [count, entries] = yield* Stream.runFoldEffect(stream, Tuple.make(0, [] as readonly Metadata[]), ([entryCount, acc], asset) =>
            (asset.hash == null ? Crypto.hash(asset.content).pipe(Effect.orDie) : Effect.succeed(asset.hash)).pipe(Effect.map((hash) => {
                const entryName = asset.name ?? `${String(entryCount).padStart(5, '0')}_${hash.slice(0, 8)}.txt`;
                zip.file(entryName, asset.content, { compression: 'DEFLATE' });
                return Tuple.make(entryCount + 1, A.append(acc, Metadata.from(asset.content, { hash, name: entryName, type: asset.type })));
            })),
        );
        zip.file('manifest.json', JSON.stringify({ entries, version: 1 }, null, 2));
        const data = yield* Effect.promise(() => zip.generateAsync({ compression: 'DEFLATE', type: 'base64' }));
        return { count, data, name: name ?? `export-${ts}.zip` };
    }),
} as const;
const _formats = {
    csv:    { kind: 'text' },
    ndjson: { kind: 'text' },
    xlsx:   { kind: 'binary' },
    xml:    { kind: 'text' },
    yaml:   { kind: 'text' },
    zip:    { kind: 'binary' },
} as const satisfies Record<keyof typeof _text | keyof typeof _binary, { readonly kind: 'binary' | 'text' }>;
type _BinaryFormat = keyof typeof _binary;
type _TextFormat = keyof typeof _text;
function export_<E, R>(stream: _Out<E, R>, fmt: _TextFormat): Stream.Stream<Uint8Array, E, R>;
function export_<E, R>(stream: _Out<E, R>, fmt: _BinaryFormat, opts?: { readonly name?: string }): Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R>;
function export_<E, R>(stream: _Out<E, R>, fmt: keyof typeof _formats, opts?: { readonly name?: string }): Stream.Stream<Uint8Array, E, R> | Effect.Effect<{ readonly data: string; readonly name: string; readonly count: number }, E, R> {
    return Match.value(fmt).pipe(
        Match.when((f): f is _TextFormat => _formats[f].kind === 'text', (f) =>
            Stream.unwrap(Effect.succeed(Stream.map(_text[f](stream), (s) => new TextEncoder().encode(s))).pipe(
                Telemetry.span('transfer.export.text', { metrics: false, 'transfer.format': f }),
            )),
        ),
        Match.when((f): f is _BinaryFormat => _formats[f].kind === 'binary', (f) =>
            _binary[f](stream, opts?.name).pipe(Telemetry.span('transfer.export.binary', { metrics: false, 'transfer.format': f })),
        ),
        Match.exhaustive,
    );
}

// --- [PARTITION] -------------------------------------------------------------

const partition = <T extends _Asset>(rows: readonly Either.Either<T, Parse>[]) => {
    const [failures, parsed] = A.separate(rows);
    return { failures, items: parsed, ordinalMap: parsed.map((row) => row.ordinal) };
};

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Transfer = { export: export_, formats: _formats, import: import_, limits, partition } as const;
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const TransferError = { Fatal, Import, Parse } as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Transfer {
    export type BinaryFormat = keyof typeof _binary;
    export type BinaryResult = Effect.Effect.Success<ReturnType<(typeof _binary)[BinaryFormat]>>;
    export type Format = keyof typeof Transfer.formats;
    export type ImportOpts = NonNullable<Parameters<typeof Transfer.import>[1]>;
    export type TextFormat = keyof typeof _text;
}
namespace TransferError {
    export type Any = Fatal | Import | Parse;
    export type Fatal = InstanceType<typeof TransferError.Fatal>;
    export type Import = InstanceType<typeof TransferError.Import>;
    export type Parse = InstanceType<typeof TransferError.Parse>;
}

// --- [EXPORT] ----------------------------------------------------------------

export { Transfer, TransferError };
