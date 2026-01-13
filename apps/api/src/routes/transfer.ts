/**
 * Transfer handlers: Streaming export, transactional import.
 * - Unified export handler with format dispatch (CSV/NDJSON stream, ZIP base64)
 * - Transactional batch inserts with rollback on failure
 * - Dry-run validation mode
 * - Audit logging via unified Audit.log interface
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { ParametricApi, type TransferExportQuery, type TransferImportQuery } from '@parametric-portal/server/api';
import { Audit, type AuditInput } from '@parametric-portal/server/audit';
import { getAppId } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { type ParseError, type RowMap, Transfer, type TransferFilters } from '@parametric-portal/server/transfer';
import type { ImportResult, TransferFailure, TransferFormat } from '@parametric-portal/types/files';
import type { AppId, Asset, AssetInsert, UserId } from '@parametric-portal/types/schema';
import { Array as A, Effect, Option, pipe, Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type BinaryFormat = 'xlsx' | 'zip';
type ExportQuery = typeof TransferExportQuery.Type;
type ImportQuery = typeof TransferImportQuery.Type;
type BatchResult = { readonly assets: readonly Asset[]; readonly dbFailures: readonly TransferFailure[] };

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const buildFilters = (query: ExportQuery): TransferFilters => Transfer.buildFilters(query.type, query.after, query.before, Option.none());
const createBatchFailures = (rows: readonly number[], error: string): readonly TransferFailure[] => A.map(rows, (row) => ({ error, row }));
const buildTimestamp = (): string => new Date().toISOString().replaceAll(/[:.]/g, '-');
const buildExportAuditInput = (
    userId: UserId, appId: AppId, filename: string,
    format: TransferFormat, count?: number, ): AuditInput => ({
    actorId: userId,
    appId,
    changes: count === undefined ? { filename, format } : { count, filename, format },
    entityId: userId,
    entityType: 'user',
    operation: 'export',
});

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const extractExportContext = (repos: DatabaseServiceShape, params: ExportQuery) =>
    Effect.gen(function* () {
        const session = yield* Middleware.Session;
        const appId = yield* getAppId;
        return {
            appId,
            assetStream: repos.assets.streamByUserId(session.userId, Transfer.tuning.streamBatchSize),
            filters: buildFilters(params),
            userId: session.userId,
        };
    });

// --- [EXPORT_HANDLERS] -------------------------------------------------------

const handleStreamExport = Effect.fn('transfer.export.stream')(
    (repos: DatabaseServiceShape, params: ExportQuery & { format: 'csv' | 'ndjson' }) =>
        pipe(
            extractExportContext(repos, params),
            Effect.flatMap(({ appId, assetStream, filters, userId }) => {
                const format = params.format;
                const filename = `assets-${buildTimestamp()}.${format}`;
                const chunkStream = format === 'csv'
                    ? Transfer.streamCsv(assetStream, appId, filters)
                    : Transfer.streamNdjson(assetStream, appId, filters);
                const body = pipe(chunkStream, Stream.map((chunk) => new TextEncoder().encode(chunk.data)));
                return pipe(
                    HttpServerResponse.stream(body, { contentType: Transfer.FormatMime[format] }),
                    Effect.flatMap((res) => HttpServerResponse.setHeader(res, 'Content-Disposition', `attachment; filename="${filename}"`)),
                    Effect.tap(() => Audit.log(repos.audit, buildExportAuditInput(userId, appId, filename, format))),
                );
            }),
        ),
);
const handleXlsxExport = Effect.fn('transfer.export.xlsx')(
    (repos: DatabaseServiceShape, params: ExportQuery) =>
        pipe(
            extractExportContext(repos, params),
            Effect.flatMap(({ appId, assetStream, filters, userId }) =>
                pipe(
                    Transfer.buildXlsx(assetStream, appId, filters),
                    HttpError.chain(HttpError.Internal, { message: 'XLSX generation failed' }),
                    Effect.flatMap((result) => {
                        const filename = `assets-${buildTimestamp()}-${result.count}.xlsx`;
                        return pipe(
                            Audit.log(repos.audit, buildExportAuditInput(userId, appId, filename, 'xlsx', result.count)),
                            Effect.as({ data: result.base64, meta: { encoding: 'base64' as const, filename, format: 'xlsx' as const, mimeType: Transfer.FormatMime.xlsx } }),
                        );
                    }),
                ),
            ),
        ),
);
const handleZipExport = Effect.fn('transfer.export.zip')(
    (repos: DatabaseServiceShape, params: ExportQuery) =>
        pipe(
            extractExportContext(repos, params),
            Effect.flatMap(({ appId, assetStream, filters, userId }) =>
                pipe(
                    Transfer.buildZip(assetStream, appId, filters),
                    HttpError.chain(HttpError.Internal, { message: 'ZIP generation failed' }),
                    Effect.flatMap((result) => {
                        const filename = `assets-${buildTimestamp()}-${result.count}.zip`;
                        return pipe(
                            Audit.log(repos.audit, buildExportAuditInput(userId, appId, filename, 'zip', result.count)),
                            Effect.as({ data: result.base64, meta: { encoding: 'base64' as const, filename, format: 'zip' as const, mimeType: 'application/zip' } }),
                        );
                    }),
                ),
            ),
        ),
);
const binaryFormatHandlers = {
    xlsx: handleXlsxExport,
    zip: handleZipExport,
} as const;
const isBinaryFormat = (format: TransferFormat): format is BinaryFormat => format === 'xlsx' || format === 'zip';
const handleExport = Effect.fn('transfer.export')(
    (repos: DatabaseServiceShape, params: ExportQuery) =>
        isBinaryFormat(params.format)
            ? binaryFormatHandlers[params.format](repos, params)
            : handleStreamExport(repos, { ...params, format: params.format }),
);

// --- [TRANSACTIONAL_IMPORT] --------------------------------------------------

const processBatchInTransaction = (
    repos: DatabaseServiceShape, batch: readonly AssetInsert[],
    rows: readonly number[], ) =>
    pipe(
        repos.withTransaction(repos.assets.insertMany([...batch])),
        Effect.map((created): BatchResult => ({ assets: created, dbFailures: [] })),
        Effect.catchAll((e) =>
            pipe(
                Effect.logError('Batch insert failed, rolled back', { error: String(e), rowCount: rows.length }),
                Effect.as({ assets: [] as readonly Asset[], dbFailures: createBatchFailures(rows, 'Database insert failed - batch rolled back') }),
            ),
        ),
    );
const processAllBatches = (
    repos: DatabaseServiceShape, items: readonly AssetInsert[],
    rowMap: RowMap, ) =>
    Stream.runFoldEffect(
        Transfer.batched(items, rowMap),
        { assets: [] as readonly Asset[], dbFailures: [] as readonly TransferFailure[] },
        (acc, { batch, rows }) =>
            pipe(
                processBatchInTransaction(repos, batch, rows),
                Effect.map((result) => ({
                    assets: [...acc.assets, ...result.assets],
                    dbFailures: [...acc.dbFailures, ...result.dbFailures],
                })),
            ),
    );
const handleImport = Effect.fn('transfer.import')(
    (repos: DatabaseServiceShape, params: ImportQuery) =>
        Effect.gen(function* () {
            const session = yield* Middleware.Session;
            const appId = yield* getAppId;
            const format = params.format;
            const dryRun = Option.getOrElse(params.dryRun, () => false);
            const request = yield* HttpServerRequest.HttpServerRequest;
            const bodyArrayBuffer = yield* pipe(
                request.arrayBuffer,
                HttpError.chain(HttpError.Internal, { message: 'Failed to read request body' }),
                Effect.filterOrFail(
                    (buf) => buf.byteLength <= Transfer.tuning.limits.maxImportBytes,
                    () => new HttpError.Validation({ field: 'body', message: `Max import size: ${Transfer.tuning.limits.maxImportBytes} bytes` }),
                ),
                Effect.filterOrFail(
                    (buf) => buf.byteLength > 0,
                    () => new HttpError.Validation({ field: 'body', message: 'Empty request body' }),
                ),
            );
            const content = isBinaryFormat(format) ? bodyArrayBuffer : new TextDecoder().decode(new Uint8Array(bodyArrayBuffer));
            const parsedRows = yield* pipe(
                Transfer.parse(content, format, appId, session.userId),
                Effect.mapError((e: ParseError) => new HttpError.Validation({ field: 'body', message: `Row ${e.row}: ${e.error}` })),
            );
            const { failures, items, rowMap } = Transfer.partition(parsedRows);
            yield* items.length === 0 && failures.length > 0
                ? Effect.fail(new HttpError.Validation({ field: 'body', message: `All ${failures.length} rows failed validation` }))
                : Effect.void;
            const result: BatchResult = dryRun
                ? { assets: [], dbFailures: [] }
                : yield* pipe(
                      processAllBatches(repos, items, rowMap),
                      HttpError.chain(HttpError.Internal, { message: 'Import processing failed' }),
                  );
            yield* dryRun
                ? Effect.void
                : Audit.log(repos.audit, { actorId: session.userId, assets: result.assets, operation: 'create' });
            const importResult: ImportResult = {
                failed: [...failures, ...result.dbFailures],
                imported: dryRun ? items.length : result.assets.length,
            };
            return importResult;
        }),
);

// --- [LAYER] -----------------------------------------------------------------

const TransferLive = HttpApiBuilder.group(ParametricApi, 'transfer', (handlers) =>
    Effect.gen(function* () {
        const repos = yield* DatabaseService;
        return handlers
            .handleRaw('export', ({ urlParams }) => RateLimit.middleware.api(handleExport(repos, urlParams)))
            .handle('import', ({ urlParams }) => RateLimit.middleware.mutation(handleImport(repos, urlParams)));
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TransferLive };
