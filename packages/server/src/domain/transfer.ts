/**
 * Transfer domain service: bulk asset import/export orchestration.
 * Route delegates all business logic here; only HTTP concerns remain in the route.
 */
import type { Asset } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { TransferQuery } from '@parametric-portal/server/api';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
import { StorageAdapter } from '../infra/storage.ts';
import { Middleware } from '../middleware.ts';
import { AuditService } from '../observe/audit.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { CacheService } from '../platform/cache.ts';
import { Crypto } from '../security/crypto.ts';
import { StorageService } from './storage.ts';
import { Transfer, TransferError } from '../utils/transfer.ts';
import { Codec } from '@parametric-portal/types/files';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Array as A, Chunk, DateTime, Effect, Option, pipe, Stream } from 'effect';
import { constant } from 'effect/Function';

// --- [FUNCTIONS] -------------------------------------------------------------

const _resolveCodec = (format: string) => Option.match(Option.fromNullable(Codec.resolve(format)), {
	onNone: () => Effect.fail(HttpError.Validation.of('format', `Unsupported format: ${format}`)),
	onSome: Effect.succeed,
});
const _mapAsset = (asset: Asset, index: number) => ({
	content: asset.content, id: asset.id, ordinal: index + 1, type: asset.type,
	updatedAt: DateTime.toEpochMillis(asset.updatedAt),
	...(Option.isSome(asset.hash) && { hash: asset.hash.value }),
	...(Option.isSome(asset.name) && { name: asset.name.value }),
});
const _resolveItemCodec = (item: { mime?: string | null; name?: string | null }, fallback: NonNullable<ReturnType<typeof Codec.resolve>>) => pipe(
	Option.fromNullable(item.mime),
	Option.flatMap((mime) => Option.fromNullable(Codec.resolve(mime))),
	Option.orElse(() => pipe(Option.fromNullable(item.name), Option.flatMap((name) => Option.fromNullable(name.split('.').pop())), Option.flatMap((ext) => Option.fromNullable(Codec.resolve(ext))))),
	Option.getOrElse(() => fallback),
);
const _exportAssets = (parameters: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.permission('transfer', 'export');
		yield* Middleware.feature('enableExport');
		const [metrics, context, repositories, audit, adapter] = yield* Effect.all([MetricsService, Context.Request.current, DatabaseService, AuditService, StorageAdapter]);
		const session = yield* Context.Request.sessionOrFail;
		const appId = context.tenantId;
		const codec = yield* _resolveCodec(parameters.format);
		const exportFormat = yield* Effect.filterOrFail(Effect.succeed(codec.ext), (ext): ext is Transfer.Format => Object.hasOwn(Transfer.formats, ext), () => HttpError.Validation.of('format', `Unsupported export format: ${parameters.format}`));
		const isBinaryFormat = (value: Transfer.Format): value is Transfer.BinaryFormat => Transfer.formats[value].kind === 'binary';
		const baseStream = Stream.fromIterableEffect(repositories.assets.byFilter(session.userId, {
			...(Option.isSome(parameters.after) && { after: parameters.after.value }),
			...(Option.isSome(parameters.before) && { before: parameters.before.value }),
			...(Option.isSome(parameters.typeSlug) && { types: [parameters.typeSlug.value] }),
		}));
		const textStream = baseStream.pipe(Stream.zipWithIndex, Stream.map(([asset, index]) => _mapAsset(asset, index)));
		const binaryStream = baseStream.pipe(
			Stream.mapEffect((asset) => pipe(
				asset.storageRef,
				Option.map(adapter.get as (storageKey: string) => Effect.Effect<StorageAdapter.GetResult, unknown>),
				Option.map(Effect.map((storageResult) => ({ ...asset, content: Buffer.from(storageResult.body).toString('base64') }))),
				Option.map(Effect.orElseSucceed(constant(asset))),
				Option.getOrElse(constant(Effect.succeed(asset))),
			)),
			Stream.zipWithIndex,
			Stream.map(([asset, index]) => _mapAsset(asset, index)),
		);
		const auditExport = (name: string, count?: number) => audit.log('Asset.export', { details: { count: count ?? null, format: codec.ext, name, userId: session.userId }, subjectId: appId });
		return yield* isBinaryFormat(exportFormat)
			? Transfer.export(binaryStream, exportFormat).pipe(
				Effect.tap((result: Transfer.BinaryResult) => Effect.all([
					Effect.annotateCurrentSpan('transfer.format', codec.ext),
					Effect.annotateCurrentSpan('transfer.rows', result.count),
					MetricsService.inc(metrics.transfer.exports, MetricsService.label({ app: appId, format: codec.ext })),
					MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'exported' }), result.count),
				], { discard: true })),
				Effect.mapError((err) => HttpError.Internal.of(`${codec.ext.toUpperCase()} generation failed`, err)),
				Effect.tap((result: Transfer.BinaryResult) => auditExport(result.name, result.count)),
				Effect.map((result: Transfer.BinaryResult) => ({ ...result, format: codec.ext })),
				Telemetry.span(`transfer.serialize.${codec.ext}`),
			)
			: (() => {
				const filename = `assets-${DateTime.formatIso(DateTime.unsafeNow()).replaceAll(/[:.]/g, '-')}.${codec.ext}`;
				const tracked = MetricsService.trackStream(textStream, metrics.transfer.rows, { app: appId, outcome: 'exported' });
				const body = Transfer.export(tracked, exportFormat);
				return HttpServerResponse.stream(body, { contentType: codec.mime }).pipe(
					Effect.flatMap((response) => HttpServerResponse.setHeader(response, 'Content-Disposition', `attachment; filename="${filename}"`)),
					Effect.tap(() => Effect.all([
						Effect.annotateCurrentSpan('transfer.format', codec.ext),
						MetricsService.inc(metrics.transfer.exports, MetricsService.label({ app: appId, format: codec.ext })),],
						{ discard: true })),
					Effect.tap(() => auditExport(filename)),
				);
			})();
	}).pipe(Telemetry.span('transfer.export', { kind: 'server', metrics: false }));
const _importAssets = (parameters: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.permission('transfer', 'import');
		const [metrics, context, repositories, audit, storage] = yield* Effect.all([MetricsService, Context.Request.current, DatabaseService, AuditService, StorageService]);
		const session = yield* Context.Request.sessionOrFail;
		const appId = context.tenantId;
		const codec = yield* _resolveCodec(parameters.format);
		const dryRun = Option.getOrElse(parameters.dryRun, constant(false));
		const body = yield* HttpServerRequest.HttpServerRequest.pipe(
			Effect.flatMap((req) => req.arrayBuffer),
			Effect.mapError((err) => HttpError.Internal.of('Failed to read request body', err)),
			Effect.filterOrFail((buffer) => buffer.byteLength > 0 && buffer.byteLength <= Transfer.limits.totalBytes, (buffer) => HttpError.Validation.of('body', buffer.byteLength === 0 ? 'Empty request body' : `Max import size: ${Transfer.limits.totalBytes} bytes`)),
		);
		const parsed = yield* Stream.runCollect(Transfer.import(codec.binary ? body : codec.content(body), { format: codec.ext })).pipe(
			Effect.map((chunk) => Chunk.toArray(chunk)),
			Effect.tap((rows) => Effect.annotateCurrentSpan('transfer.rows.raw', rows.length)),
			Effect.catchTag('Fatal', (err) => Effect.fail(HttpError.Validation.of('body', err.detail ?? err.code))),
			Telemetry.span('transfer.parse'),
		);
		const { failures: rawFailures, items: rawItems } = Transfer.partition(parsed);
		const maxContentBytes = Transfer.limits.entryBytes;
		const binaryValidation = codec.binary
			? pipe(rawItems, A.map((item) => ({
				item,
				parseError: Option.match(Option.liftThrowable(() => _resolveItemCodec(item, codec).buf(item.content).byteLength)(), {
					onNone: () => Option.some(new TransferError.Parse({ code: 'INVALID_RECORD', detail: 'Invalid binary entry content', ordinal: item.ordinal })),
					onSome: (sizeBytes) => sizeBytes > maxContentBytes
						? Option.some(new TransferError.Parse({ code: 'TOO_LARGE', detail: `Max content size: ${maxContentBytes} bytes`, ordinal: item.ordinal }))
						: Option.none(),
				}),
			})))
			: [];
		const sizeFailures = codec.binary
			? A.filterMap(binaryValidation, ({ parseError }) => parseError)
			: pipe(rawItems, A.filter((item) => Codec.size(item.content) > maxContentBytes), A.map((item) => new TransferError.Parse({ code: 'TOO_LARGE', detail: `Max content size: ${maxContentBytes} bytes`, ordinal: item.ordinal })));
		const items = codec.binary
			? A.filterMap(binaryValidation, ({ item, parseError }) => Option.match(parseError, { onNone: () => Option.some(item), onSome: () => Option.none() }))
			: pipe(rawItems, A.filter((item) => Codec.size(item.content) <= maxContentBytes));
		const failures = A.appendAll(rawFailures, sizeFailures);
		yield* Effect.all([
			Effect.annotateCurrentSpan('transfer.format', codec.ext),
			Effect.annotateCurrentSpan('transfer.rows.valid', items.length),
			Effect.annotateCurrentSpan('transfer.rows.failed', failures.length),
			MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'parsed' }), items.length),
			MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'failed' }), failures.length),
		], { discard: true });
		yield* Effect.filterOrFail(Effect.succeed(items), A.isNonEmptyReadonlyArray, () => HttpError.Validation.of('body', failures.length > 0 ? `All ${failures.length} rows failed validation` : 'Empty file - no data to import'));
		const toHashError = () => new TransferError.Fatal({ code: 'PARSER_ERROR', detail: 'Failed to compute content hash' });
		const prepareItem = (item: typeof items[number]) =>
			codec.binary
				? Effect.gen(function* () {
					const itemCodec = _resolveItemCodec(item, codec);
					const rawBuffer = itemCodec.buf(item.content);
					const computedHash = yield* (item.hash === undefined ? Crypto.hash(item.content) : Effect.succeed(item.hash)).pipe(Effect.mapError(toHashError));
					const storageKey = `assets/${appId}/${computedHash}.${itemCodec.ext}`;
					const originalName = item.name ?? `${computedHash.slice(0, 8)}.${itemCodec.ext}`;
					yield* storage.put({ body: rawBuffer, contentType: itemCodec.mime, key: storageKey, metadata: { type: item.type } });
					const metadata = JSON.stringify({ hash: computedHash, mime: itemCodec.mime, originalName, size: rawBuffer.byteLength, storageRef: storageKey });
					return { appId, content: metadata, deletedAt: Option.none(), hash: Option.some(computedHash), name: Option.some(originalName), status: 'active' as const, storageRef: Option.some(storageKey), type: item.type, updatedAt: undefined, userId: Option.some(session.userId) };
				})
				: Effect.succeed({ appId, content: item.content, deletedAt: Option.none(), hash: Option.fromNullable(item.hash), name: Option.fromNullable(item.name), status: 'active' as const, storageRef: Option.none<string>(), type: item.type, updatedAt: undefined, userId: Option.some(session.userId) });
			const processBatch = (accumulator: { readonly assets: readonly Asset[]; readonly dbFailures: readonly TransferError.Import[] }, batchItems: typeof items) => {
				const ordinals = batchItems.map((batchItem) => batchItem.ordinal);
				return Effect.forEach(batchItems, prepareItem, { concurrency: 10 }).pipe(
					Effect.flatMap((prepared) => repositories.assets.insertMany(prepared) as Effect.Effect<readonly Asset[], unknown>),
					Effect.map((created): typeof accumulator => ({ assets: A.appendAll(accumulator.assets, created), dbFailures: accumulator.dbFailures })),
					Effect.catchAll((error) => Effect.as(
						Effect.logError('Batch insert failed', { error: String(error), ordinals }),
						{ assets: accumulator.assets, dbFailures: A.append(accumulator.dbFailures, new TransferError.Import({ cause: error, code: 'BATCH_FAILED', rows: ordinals })) } as typeof accumulator,
					)),
				);
			};
		const initial = { assets: [] as readonly Asset[], dbFailures: [] as readonly TransferError.Import[] };
		const { assets, dbFailures } = dryRun
			? initial
			: yield* repositories.withTransaction(Stream.runFoldEffect(Stream.grouped(Stream.fromIterable(items), Transfer.limits.batchSize), initial, (accumulator, chunk) => processBatch(accumulator, Chunk.toArray(chunk)))).pipe(
				Effect.tap(({ assets: inserted, dbFailures: failed }) => Effect.all([
					Effect.annotateCurrentSpan('transfer.inserted', inserted.length),
					Effect.annotateCurrentSpan('transfer.db_failures', failed.length),],
					{ discard: true })),
				Effect.mapError((err) => HttpError.Internal.of('Import processing failed', err)),
				Telemetry.span('transfer.insert'),
			);
			yield* Effect.when(
				repositories.search.refresh(appId).pipe(Effect.tapError((error) => Effect.logWarning('Search refresh failed', { error: String(error) })), Effect.catchAll(() => Effect.void)),
				() => !dryRun && A.isNonEmptyReadonlyArray(assets),
			);
		const totalFailures = failures.length + A.reduce(dbFailures, 0, (count, err) => count + err.rows.length);
		yield* Effect.all([
			MetricsService.inc(metrics.transfer.imports, MetricsService.label({ app: appId, dryRun: String(dryRun), format: codec.ext })),
			audit.log(dryRun ? 'Asset.validate' : 'Asset.import', {
				details: { dryRun, failedCount: totalFailures, format: codec.ext, importedCount: dryRun ? 0 : assets.length, userId: session.userId, validCount: items.length },
				subjectId: appId,
			}),],
			{ discard: true });
		return {
			failed: A.appendAll(failures.map((err) => ({ error: err.detail ?? err.code, ordinal: err.ordinal ?? null })), dbFailures.flatMap((err) => err.rows.map((ordinal) => ({ error: 'Database insert failed' as const, ordinal })))),
			imported: dryRun ? items.length : assets.length,
		};
	}).pipe(Telemetry.span('transfer.import', { kind: 'server', metrics: false }));

// --- [SERVICES] --------------------------------------------------------------

class TransferService extends Effect.Service<TransferService>()('server/Transfer', {
	effect: Effect.succeed({
		exportAssets: (parameters: typeof TransferQuery.Type) => CacheService.rateLimit('api', _exportAssets(parameters)),
		importAssets: (parameters: typeof TransferQuery.Type) => CacheService.rateLimit('mutation', _importAssets(parameters)),
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { TransferService };
