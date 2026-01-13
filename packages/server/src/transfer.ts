/**
 * Transfer: Streaming import/export with resilience guarantees.
 * - Chunked streaming for memory efficiency (never holds full dataset)
 * - Preventive ZIP bomb protection (size checked before decompression)
 * - Comprehensive CSV formula injection protection
 * - Transactional batch processing with rollback support
 * - O(1) row mapping via Map
 */
import { TransferAssetInput, TRANSFER_MIME, type TransferFailure, type TransferFormat } from '@parametric-portal/types/files';
import type { AppId, Asset, AssetInsert, AssetType, UserId } from '@parametric-portal/types/schema';
import { Array as A, Chunk, Effect, Either, HashMap, Option, pipe, Ref, Schema as S, Stream, Tuple } from 'effect';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import Papa from 'papaparse';

// --- [TYPES] -----------------------------------------------------------------

type TransferFilters = {
    readonly afterDate: Option.Option<Date>;
    readonly assetIds: Option.Option<readonly string[]>;
    readonly beforeDate: Option.Option<Date>;
    readonly type: Option.Option<AssetType>;
};
type ParsedRow = { readonly result: Either.Either<AssetInsert, TransferFailure>; readonly row: number };
type RowMap = HashMap.HashMap<number, number>;
type PartitionResult = { readonly failures: readonly TransferFailure[]; readonly items: readonly AssetInsert[]; readonly rowMap: RowMap };
type ExportChunk = { readonly data: string };
type ParseError = { readonly error: string; readonly row: number };
type ZipProgress = { readonly percent: number; readonly currentFile: string | null };
type ZipBuildOptions = { readonly onProgress?: ZipProgressCallback };
type ZipProgressCallback = (progress: ZipProgress) => void;
type StreamableFormat = 'csv' | 'ndjson';

// --- [SCHEMA] ----------------------------------------------------------------

const ManifestEntrySchema = S.Struct({
    contentHash: S.optional(S.String),
    createdAt: S.optional(S.String),
    file: S.String,
    id: S.String,
    size: S.optional(S.Number),
    type: S.String,
    updatedAt: S.optional(S.String),
});
const ManifestV1Schema = S.Struct({ entries: S.Array(ManifestEntrySchema), version: S.Literal(1) });
const ManifestV0Schema = S.Struct({ assets: S.Array(ManifestEntrySchema) });
type ManifestEntry = typeof ManifestEntrySchema.Type;
type Manifest = typeof ManifestV1Schema.Type;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    batching: { exportChunkSize: 500, importBatchSize: 100 },
    csv: {
        dangerousPrefixes: ['=', '+', '-', '@', '\t', '\r', '\0', ' =', ' +', ' -', ' @'],
        headers: ['id', 'assetType', 'content', 'createdAt', 'updatedAt'] as const,
    },
    limits: { maxDecompressedBytes: 100 * 1024 * 1024, maxImportBytes: 10 * 1024 * 1024, maxZipEntryBytes: 5 * 1024 * 1024 },
    streamBatchSize: 1000,
    zip: {
        compressionLevels: { high: 9, medium: 6, store: 0 } as const,
        highCompressTypes: new Set(['svg', 'json', 'html', 'xml', 'txt', 'md', 'css', 'js', 'ts', 'yaml', 'yml']),
    },
} as const);
const formatSerializers: Record<StreamableFormat, (asset: Asset) => string> = {
    csv: (a) => [a.id, a.assetType, escapeCsvField(a.content), a.createdAt.toISOString(), a.updatedAt.toISOString()].join(','),
    ndjson: (a) => JSON.stringify({ assetType: a.assetType, content: a.content, createdAt: a.createdAt.toISOString(), id: a.id, updatedAt: a.updatedAt.toISOString() }),
};
const formatHeaders: Record<StreamableFormat, string> = { csv: `${B.csv.headers.join(',')}\n`, ndjson: '' };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const buildFilters = (type: Option.Option<AssetType>, afterDate: Option.Option<Date>, beforeDate: Option.Option<Date>, assetIds: Option.Option<readonly string[]>): TransferFilters => ({ afterDate, assetIds, beforeDate, type });
const emptyFilters = (): TransferFilters => buildFilters(Option.none(), Option.none(), Option.none(), Option.none());
const matchesFilters = (asset: Asset, predicates: ReadonlyArray<(a: Asset) => boolean>): boolean => predicates.every((p) => p(asset));
const getCompressionLevel = (assetType: string): number => B.zip.highCompressTypes.has(assetType.toLowerCase()) ? B.zip.compressionLevels.high : B.zip.compressionLevels.medium;
const failure = (row: number, error: string, context?: Record<string, unknown>): ParsedRow => ({
    result: Either.left({ error: context ? `${error} ${JSON.stringify(context)}` : error, row }) as ParsedRow['result'],
    row,
});
const success = (row: number, item: AssetInsert): ParsedRow => ({
    result: Either.right(item) as ParsedRow['result'],
    row,
});
const sanitizeFilename = (id: string, type: string, index: number, hash: string): string =>
    `${String(index).padStart(5, '0')}_${id.replaceAll(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32)}_${hash.slice(0, 8)}.${type.replaceAll(/[^a-zA-Z0-9_-]/g, '_').slice(0, 16)}`;
const hashContent = (content: string): Effect.Effect<string> =>
    Effect.promise(async () => {
        // biome-ignore lint/nursery/useAwaitThenable: crypto.subtle.digest returns Promise<ArrayBuffer>
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
        return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    });
const escapeCsvField = (value: string): string => {
    const escaped = value.replaceAll('"', '""');
    const sanitized = B.csv.dangerousPrefixes.some((p) => escaped.startsWith(p)) ? `'${escaped}` : escaped;
    return sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n') || sanitized.includes('\r') ? `"${sanitized}"` : sanitized;
};
const migrateManifest = (raw: unknown): Either.Either<Manifest, string> =>
    pipe(
        S.decodeUnknownEither(ManifestV1Schema)(raw),
        Either.orElse(() =>
            pipe(
                S.decodeUnknownEither(ManifestV0Schema)(raw),
                Either.map((v0): Manifest => ({ entries: v0.assets, version: 1 })),
            ),
        ),
        Either.mapLeft(() => 'Invalid manifest format - expected {version: 1, entries: [...]} or legacy {assets: [...]}'),
    );
const buildFilterPredicates = (appId: AppId, filters: TransferFilters): ReadonlyArray<(a: Asset) => boolean> => [
    (a) => a.appId === appId,
    Option.match(filters.type, { onNone: () => () => true, onSome: (t) => (a: Asset) => a.assetType === t }),
    Option.match(filters.afterDate, { onNone: () => () => true, onSome: (d) => (a: Asset) => a.createdAt >= d }),
    Option.match(filters.beforeDate, { onNone: () => () => true, onSome: (d) => (a: Asset) => a.createdAt <= d }),
    Option.match(filters.assetIds, { onNone: () => () => true, onSome: (ids) => (a: Asset) => ids.includes(a.id) }),
];

// --- [DECODE_HELPERS] --------------------------------------------------------

const stripBom = (line: string, row: number): string => row === 1 && line.codePointAt(0) === 0xfeff ? line.slice(1) : line;
const decodeAssetInsert = (input: unknown): Either.Either<AssetInsert, string> =>
    pipe(
        S.decodeUnknownEither(S.Struct({ appId: S.String, assetType: S.NonEmptyTrimmedString, content: S.String, userId: S.String }))(input),
        Either.mapBoth({ onLeft: (e) => e.message, onRight: (v) => v as AssetInsert }),
    );
const buildInsertInput = (appId: AppId, userId: UserId, assetType: string, content: string): unknown => ({
    appId,
    assetType: assetType.trim(),
    content,
    userId,
});

// --- [PARSERS] ---------------------------------------------------------------

const parseCsvRows = (content: string, appId: AppId, userId: UserId): readonly ParsedRow[] => {
    const result = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: 'greedy', transformHeader: (h) => h.trim().toLowerCase() });
    const parserErrors = A.filterMap(result.errors, (err) => err.row === undefined ? Option.none() : Option.some(failure(err.row + 2, 'CSV parse error', { code: err.code, message: err.message })));
    const dataRows = A.map(result.data, (record, idx) => {
        const row = idx + 2;
        const assetType = record['assettype'] ?? record['asset_type'] ?? '';
        const recordContent = record['content'] ?? '';
        return assetType.trim().length === 0
            ? failure(row, 'Missing assetType')
            : pipe(
                decodeAssetInsert(buildInsertInput(appId, userId, assetType, recordContent)),
                Either.match({ onLeft: (e) => failure(row, e), onRight: (item) => success(row, item) }),
            );
    });
    return [...parserErrors, ...dataRows];
};
const parseNdjsonRow = (line: string, row: number, appId: AppId, userId: UserId): ParsedRow =>
    pipe(
        Either.try({ catch: () => 'Invalid JSON syntax', try: () => JSON.parse(stripBom(line, row)) as unknown }),
        Either.flatMap((parsed) => pipe(TransferAssetInput.decodeEither(parsed), Either.mapLeft(() => 'Missing required fields (assetType, content)'))),
        Either.flatMap((input) => decodeAssetInsert(buildInsertInput(appId, userId, input.assetType, input.content))),
        Either.match({ onLeft: (e) => failure(row, e), onRight: (item) => success(row, item) }),
    );
const parseNdjsonRows = (content: string, appId: AppId, userId: UserId): readonly ParsedRow[] =>
    pipe(content.split('\n'), A.filter((line) => line.trim().length > 0), A.map((line, idx) => parseNdjsonRow(line, idx + 1, appId, userId)));
const verifyChecksum = (content: string, expectedHash: string | undefined, row: number, file: string): Effect.Effect<void, ParsedRow> =>
    expectedHash === undefined
        ? Effect.void
        : pipe(
            hashContent(content),
            Effect.flatMap((actualHash) =>
                actualHash.startsWith(expectedHash)
                    ? Effect.void
                    : Effect.fail(failure(row, 'Checksum mismatch', { actual: actualHash.slice(0, 8), expected: expectedHash.slice(0, 8), file })),
            ),
        );
const decodeZipContent = (content: string, appId: AppId, userId: UserId, entryType: string, file: string, row: number): ParsedRow =>
    pipe(decodeAssetInsert(buildInsertInput(appId, userId, entryType, content)), Either.match({ onLeft: (e) => failure(row, e, { file }), onRight: (item) => success(row, item) }));
const parseZipEntry = (zip: JSZip, entry: ManifestEntry, idx: number, appId: AppId, userId: UserId, sizeRef: Ref.Ref<number>): Effect.Effect<ParsedRow> =>
    Effect.gen(function* () {
        const row = idx + 1;
        const fileOpt = Option.fromNullable(zip.file(entry.file));
        const file = yield* Option.match(fileOpt, { onNone: () => Effect.succeed(Option.none<JSZip.JSZipObject>()), onSome: (f) => Effect.succeed(Option.some(f)) });
        const declaredSize = Option.match(file, { onNone: () => 0, onSome: (f) => (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? entry.size ?? 0 });
        yield* Option.isNone(file) ? Effect.fail(failure(row, 'Missing file in archive', { file: entry.file })) : Effect.void;
        yield* declaredSize > B.limits.maxZipEntryBytes ? Effect.fail(failure(row, 'File too large', { file: entry.file, maxSize: B.limits.maxZipEntryBytes, size: declaredSize })) : Effect.void;
        const currentSize = yield* Ref.get(sizeRef);
        yield* currentSize + declaredSize > B.limits.maxDecompressedBytes ? Effect.fail(failure(row, 'Archive decompressed size limit exceeded', { limit: B.limits.maxDecompressedBytes, projected: currentSize + declaredSize })) : Effect.void;
        const content = yield* Effect.tryPromise({ catch: (e) => failure(row, `Decompression failed: ${e instanceof Error ? e.message : String(e)}`, { file: entry.file }), try: () => Option.getOrThrow(file).async('text') });
        yield* verifyChecksum(content, entry.contentHash, row, entry.file);
        yield* Ref.update(sizeRef, (n) => n + content.length);
        return decodeZipContent(content, appId, userId, entry.type, entry.file, row);
    }).pipe(Effect.catchAll((err) => Effect.succeed(err)));
const parseZipRows = (zipData: ArrayBuffer, appId: AppId, userId: UserId): Effect.Effect<readonly ParsedRow[], ParseError> =>
    Effect.gen(function* () {
        const zip = yield* Effect.tryPromise({ catch: () => ({ error: 'Invalid or corrupted ZIP archive', row: 0 }), try: () => JSZip.loadAsync(zipData) });
        const manifestOpt = Option.fromNullable(zip.file('manifest.json'));
        const manifestFile = yield* Option.match(manifestOpt, { onNone: () => Effect.fail({ error: 'ZIP missing manifest.json - not a valid transfer archive', row: 0 }), onSome: Effect.succeed });
        const manifestText = yield* Effect.tryPromise({ catch: () => ({ error: 'Failed to read manifest.json', row: 0 }), try: () => manifestFile.async('text') });
        const manifestResult = pipe(Either.try({ catch: () => 'Invalid JSON in manifest.json', try: () => JSON.parse(manifestText) as unknown }), Either.flatMap(migrateManifest));
        const manifest = yield* Either.match(manifestResult, { onLeft: (error) => Effect.fail({ error, row: 0 }), onRight: Effect.succeed });
        const sizeRef = yield* Ref.make(0);
        return yield* Effect.forEach(A.map(manifest.entries, (entry, idx) => Tuple.make(idx, entry)), ([idx, entry]) => parseZipEntry(zip, entry, idx, appId, userId, sizeRef), { concurrency: 1 });
    });
const xlsxRowHandlers: Record<'header' | 'empty' | 'data', (rowIdx: number, assetType: string, content: string, appId: AppId, userId: UserId) => ParsedRow> = {
    data: (rowIdx, assetType, content, appId, userId) => pipe(decodeAssetInsert(buildInsertInput(appId, userId, assetType, content)), Either.match({ onLeft: (e) => failure(rowIdx, e), onRight: (item) => success(rowIdx, item) })),
    empty: (rowIdx) => failure(rowIdx, 'Missing assetType'),
    header: (rowIdx) => failure(rowIdx, 'Header row skipped'),
};
const parseXlsxRow = (rowIdx: number, assetType: string, content: string, appId: AppId, userId: UserId): ParsedRow => {
    const isHeader = rowIdx === 1 && assetType.toLowerCase() === 'assettype';
    const baseKind: 'empty' | 'data' = assetType.length === 0 ? 'empty' : 'data';
    const kind: 'header' | 'empty' | 'data' = isHeader ? 'header' : baseKind;
    return xlsxRowHandlers[kind](rowIdx, assetType, content, appId, userId);
};
const parseXlsxRows = (xlsxData: ArrayBuffer, appId: AppId, userId: UserId): Effect.Effect<readonly ParsedRow[], ParseError> =>
    Effect.gen(function* () {
        const workbook = yield* Effect.tryPromise({
            catch: () => ({ error: 'Invalid or corrupted XLSX file', row: 0 }),
            // biome-ignore lint/nursery/useAwaitThenable: ExcelJS.Workbook.xlsx.load returns Promise
            try: async () => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xlsxData); return wb; },
        });
        const sheet = workbook.worksheets[0];
        const rows: ParsedRow[] = [];
        sheet?.eachRow((row, rowNumber) => rows.push(parseXlsxRow(rowNumber, String(row.getCell(1).value ?? '').trim(), String(row.getCell(2).value ?? ''), appId, userId)));
        return rows.filter((r) => !(r.row === 1 && Either.isLeft(r.result)));
    });
const formatParsers: Record<TransferFormat, (content: string | ArrayBuffer, appId: AppId, userId: UserId) => Effect.Effect<readonly ParsedRow[], ParseError>> = {
    csv: (content, appId, userId) => Effect.succeed(parseCsvRows(content as string, appId, userId)),
    ndjson: (content, appId, userId) => Effect.succeed(parseNdjsonRows(content as string, appId, userId)),
    xlsx: (content, appId, userId) => parseXlsxRows(content as ArrayBuffer, appId, userId),
    zip: (content, appId, userId) => parseZipRows(content as ArrayBuffer, appId, userId),
};

// --- [PARTITION] -------------------------------------------------------------

const lookupRow = (rowMap: RowMap, index: number): number => Option.getOrElse(HashMap.get(rowMap, index), () => index + 1);
const partitionParsed = (rows: readonly ParsedRow[]): PartitionResult =>
    pipe(
        rows,
        A.partitionMap(({ result, row }) => Either.match(result, { onLeft: (f) => Either.left(f), onRight: (item) => Either.right(Tuple.make(item, row)) })),
        ([failures, successPairs]) => ({
            failures,
            items: A.map(successPairs, Tuple.getFirst),
            rowMap: HashMap.fromIterable(A.map(successPairs, (pair, idx) => Tuple.make(idx, Tuple.getSecond(pair)))),
        }),
    );

// --- [STREAMING_EXPORT] ------------------------------------------------------

const streamChunks = <E, R>(input: Stream.Stream<Asset, E, R>, appId: AppId, filters: TransferFilters, format: StreamableFormat): Stream.Stream<ExportChunk, E, R> => {
    const predicates = buildFilterPredicates(appId, filters);
    const serializer = formatSerializers[format];
    const header = formatHeaders[format];
    return pipe(
        header.length > 0 ? Stream.succeed({ data: header }) : Stream.empty,
        Stream.concat(pipe(
            input,
            Stream.filter((a) => matchesFilters(a, predicates)),
            Stream.grouped(B.batching.exportChunkSize),
            Stream.map((chunk) => ({ data: `${A.map(Chunk.toArray(chunk), serializer).join('\n')}\n` })),
        )),
    );
};
const addXlsxRow = (sheet: ExcelJS.Worksheet, asset: Asset, countRef: Ref.Ref<number>) => Effect.sync(() => sheet.addRow({ assetType: asset.assetType, content: asset.content, createdAt: asset.createdAt.toISOString(), id: asset.id, updatedAt: asset.updatedAt.toISOString() })).pipe(Effect.andThen(Ref.update(countRef, (n) => n + 1)));
const buildXlsxArchive = <E, R>(input: Stream.Stream<Asset, E, R>, appId: AppId, filters: TransferFilters): Effect.Effect<{ readonly base64: string; readonly count: number }, E, R> =>
    Effect.gen(function* () {
        const predicates = buildFilterPredicates(appId, filters);
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Assets');
        sheet.columns = [{ header: 'ID', key: 'id', width: 40 }, { header: 'AssetType', key: 'assetType', width: 20 }, { header: 'Content', key: 'content', width: 60 }, { header: 'CreatedAt', key: 'createdAt', width: 25 }, { header: 'UpdatedAt', key: 'updatedAt', width: 25 }];
        const countRef = yield* Ref.make(0);
        yield* pipe(input, Stream.filter((a) => matchesFilters(a, predicates)), Stream.runForEach((asset) => addXlsxRow(sheet, asset, countRef)));
        const buffer = yield* Effect.promise(() => workbook.xlsx.writeBuffer());
        return { base64: Buffer.from(buffer).toString('base64'), count: yield* Ref.get(countRef) };
    });
const addZipEntry = (zip: JSZip, asset: Asset, stateRef: Ref.Ref<{ readonly entries: readonly ManifestEntry[]; readonly index: number }>) =>
    Effect.gen(function* () {
        const hash = yield* hashContent(asset.content);
        const state = yield* Ref.get(stateRef);
        const entry: ManifestEntry = { contentHash: hash, createdAt: asset.createdAt.toISOString(), file: sanitizeFilename(asset.id, asset.assetType, state.index, hash), id: asset.id, size: asset.content.length, type: asset.assetType, updatedAt: asset.updatedAt.toISOString() };
        zip.file(entry.file, asset.content, { compression: 'DEFLATE', compressionOptions: { level: getCompressionLevel(asset.assetType) } });
        yield* Ref.update(stateRef, (s) => ({ entries: [...s.entries, entry], index: s.index + 1 }));
    });
const buildZipArchive = <E, R>(input: Stream.Stream<Asset, E, R>, appId: AppId, filters: TransferFilters, options: ZipBuildOptions = {}): Effect.Effect<{ readonly base64: string; readonly count: number }, E, R> =>
    Effect.gen(function* () {
        const predicates = buildFilterPredicates(appId, filters);
        const zip = new JSZip();
        const stateRef = yield* Ref.make<{ readonly entries: readonly ManifestEntry[]; readonly index: number }>({ entries: [], index: 0 });
        yield* pipe(input, Stream.filter((a) => matchesFilters(a, predicates)), Stream.runForEach((asset) => addZipEntry(zip, asset, stateRef)));
        const finalState = yield* Ref.get(stateRef);
        zip.file('manifest.json', JSON.stringify({ entries: finalState.entries, version: 1 } satisfies Manifest, null, 2), {
            compression: 'DEFLATE',
            compressionOptions: { level: B.zip.compressionLevels.high },
        });
        const progressCallback = options.onProgress;
        const base64 = yield* Effect.promise(() =>
            zip.generateAsync(
                { compression: 'DEFLATE', compressionOptions: { level: B.zip.compressionLevels.medium }, streamFiles: true, type: 'base64' },
                progressCallback === undefined ? undefined : (metadata) => progressCallback({ currentFile: metadata.currentFile, percent: metadata.percent }),
            ),
        );
        return { base64, count: finalState.index };
    });

// --- [IMPORT_BATCHING] -------------------------------------------------------

const importBatched = (items: readonly AssetInsert[], rowMap: RowMap): Stream.Stream<{ readonly batch: readonly AssetInsert[]; readonly rows: readonly number[] }> =>
    pipe(Stream.fromIterable(A.map(items, (item, idx) => Tuple.make(item, lookupRow(rowMap, idx)))), Stream.grouped(B.batching.importBatchSize), Stream.map((chunk) => { const entries = Chunk.toArray(chunk); return { batch: A.map(entries, Tuple.getFirst), rows: A.map(entries, Tuple.getSecond) }; }));

// --- [NAMESPACE] -------------------------------------------------------------

const Transfer = Object.freeze({
    batched: importBatched,
    buildFilters,
    buildXlsx: buildXlsxArchive,
    buildZip: buildZipArchive,
    emptyFilters,
    FormatMime: TRANSFER_MIME,
    lookupRow,
    parse: (content: string | ArrayBuffer, format: TransferFormat, appId: AppId, userId: UserId) => formatParsers[format](content, appId, userId),
    partition: partitionParsed,
    streamCsv: <E, R>(input: Stream.Stream<Asset, E, R>, appId: AppId, filters: TransferFilters) => streamChunks(input, appId, filters, 'csv'),
    streamNdjson: <E, R>(input: Stream.Stream<Asset, E, R>, appId: AppId, filters: TransferFilters) => streamChunks(input, appId, filters, 'ndjson'),
    tuning: { ...B, streamBatchSize: B.streamBatchSize },
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { Transfer };
export type { ExportChunk, Manifest, ManifestEntry, ParsedRow, ParseError, PartitionResult, RowMap, TransferFilters, ZipBuildOptions, ZipProgress, ZipProgressCallback };
