/**
 * Handle bulk asset import/export HTTP endpoints.
 * [GROUNDING] Transactional batches with rollback; supports dry-run validation mode.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Asset } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { ParametricApi, type TransferQuery } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Transfer, TransferError } from '@parametric-portal/server/utils/transfer';
import { Codec } from '@parametric-portal/types/files';
import { Array as A, Chunk, DateTime, Effect, Function as F, Metric, Option, pipe, Stream } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleExport = (repositories: DatabaseService.Type, audit: typeof AuditService.Service, storage: typeof StorageService.Service, parameters: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, context] = yield* Effect.all([MetricsService, Context.Request.current]);
		const session = yield* Context.Request.sessionOrFail;
		const appId = context.tenantId;
		const format = parameters.format;
		const codec = yield* pipe(
			Option.fromNullable(Codec.resolve(format)),
			Option.match({
				onNone: () => Effect.fail(HttpError.Validation.of('format', `Unsupported format: ${format}`)),
				onSome: Effect.succeed,
			}),
		);
		const exportFormat = yield* Effect.filterOrFail(
			Effect.succeed(codec.ext),
			(ext): ext is Transfer.Format => Object.hasOwn(Transfer.formats, ext),
			() => HttpError.Validation.of('format', `Unsupported export format: ${format}`),
		);
		const isBinaryFormat = (value: Transfer.Format): value is Transfer.BinaryFormat => Transfer.formats[value].kind === 'binary';
		const baseStream = Stream.fromIterableEffect(repositories.assets.byFilter(session.userId, appId, {
			...(Option.isSome(parameters.after) && { after: parameters.after.value }),
			...(Option.isSome(parameters.before) && { before: parameters.before.value }),
			...(Option.isSome(parameters.typeSlug) && { types: [parameters.typeSlug.value] }),
		}));
		const mapAsset = (asset: Asset, index: number) => ({	// Map asset to export format
			content: asset.content,
			id: asset.id,
			ordinal: index + 1,
			type: asset.type,
			updatedAt: DateTime.toEpochMillis(asset.updatedAt),
			...(Option.isSome(asset.hash) && { hash: asset.hash.value }),
			...(Option.isSome(asset.name) && { name: asset.name.value }),
		});
		const textStream = baseStream.pipe(Stream.zipWithIndex, Stream.map(([asset, index]) => mapAsset(asset, index)));	// Text export: use DB content directly (text assets don't have storageRef)
		const hydrateAsset = (asset: Asset) => Option.match(asset.storageRef, {	// Binary export: hydrate from S3 when storageRef is present
			onNone: () => Effect.succeed(asset),
			onSome: (storageKey) => storage.get(storageKey).pipe(
				Effect.option,
				Effect.map(Option.match({
					onNone: () => asset,
					onSome: (storageResult) => ({ ...asset, content: Buffer.from(storageResult.body).toString('base64') }),
				})),
			),
		});
		const binaryStream = baseStream.pipe(
			Stream.mapEffect(hydrateAsset),
			Stream.zipWithIndex,
			Stream.map(([asset, index]) => mapAsset(asset, index)),
		);
		const auditExport = (name: string, count?: number) =>
			audit.log('Asset.export', { details: { count: count ?? null, format: codec.ext, name, userId: session.userId }, subjectId: appId });
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
				const body = Transfer.export(tracked, exportFormat as Transfer.TextFormat).pipe(
					Stream.tapError((err) => Effect.all([
						Effect.logError(`${codec.ext.toUpperCase()} export stream error`, { error: String(err) }),
						Metric.update(Metric.taggedWithLabels(metrics.errors, MetricsService.label({ app: appId, operation: 'export' })), 'StreamError'),
					], { discard: true })),
				);
				return HttpServerResponse.stream(body, { contentType: codec.mime }).pipe(
					Effect.flatMap((res) => HttpServerResponse.setHeader(res, 'Content-Disposition', `attachment; filename="${filename}"`)),
					Effect.tap(() => Effect.all([
						Effect.annotateCurrentSpan('transfer.format', codec.ext),
						MetricsService.inc(metrics.transfer.exports, MetricsService.label({ app: appId, format: codec.ext })),
					], { discard: true })),
					Effect.tap(() => auditExport(filename)),
				);
			})();
	}).pipe(Telemetry.span('transfer.export', { kind: 'server', metrics: false }));
const handleImport = (repositories: DatabaseService.Type, search: typeof SearchRepo.Service, audit: typeof AuditService.Service, storage: typeof StorageService.Service, parameters: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, context] = yield* Effect.all([MetricsService, Context.Request.current]);
		const session = yield* Context.Request.sessionOrFail;
		const appId = context.tenantId;
		const format = parameters.format;
		const codec = yield* pipe(
			Option.fromNullable(Codec.resolve(format)),
			Option.match({
				onNone: () => Effect.fail(HttpError.Validation.of('format', `Unsupported format: ${format}`)),
				onSome: Effect.succeed,
			}),
		);
		const dryRun = Option.getOrElse(parameters.dryRun, F.constant(false));
		const body = yield* HttpServerRequest.HttpServerRequest.pipe(
			Effect.flatMap((req) => req.arrayBuffer),
			Effect.mapError((err) => HttpError.Internal.of('Failed to read request body', err)),
			Effect.filterOrFail(
				(buffer) => buffer.byteLength > 0 && buffer.byteLength <= Transfer.limits.totalBytes,
				(buffer) => HttpError.Validation.of('body', buffer.byteLength === 0 ? 'Empty request body' : `Max import size: ${Transfer.limits.totalBytes} bytes`),
			),
		);
		const parsed = yield* Stream.runCollect(Transfer.import(codec.binary ? body : codec.content(body), { format: codec.ext })).pipe(
			Effect.map((c) => Chunk.toArray(c)),
			Effect.tap((rows) => Effect.annotateCurrentSpan('transfer.rows.raw', rows.length)),
			Effect.catchTag('Fatal', (err) => Effect.fail(HttpError.Validation.of('body', err.detail ?? err.code))),
			Telemetry.span('transfer.parse'),
		);
		const { failures: rawFailures, items: rawItems } = Transfer.partition(parsed);
		const maxContentBytes = Transfer.limits.entryBytes;
		const sizeFailures = codec.binary
			? []
			: pipe(
				rawItems,
				A.filter((item) => Codec.size(item.content) > maxContentBytes),
				A.map((item) => new TransferError.Parse({ code: 'TOO_LARGE', detail: `Max content size: ${maxContentBytes} bytes`, ordinal: item.ordinal })),
			);
		const items = codec.binary
			? rawItems
			: pipe(rawItems, A.filter((item) => Codec.size(item.content) <= maxContentBytes));
		const failures = A.appendAll(rawFailures, sizeFailures);
		yield* Effect.all([
			Effect.annotateCurrentSpan('transfer.format', codec.ext),
			Effect.annotateCurrentSpan('transfer.rows.valid', items.length),
			Effect.annotateCurrentSpan('transfer.rows.failed', failures.length),
			MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'parsed' }), items.length),
			MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'failed' }), failures.length),
		], { discard: true });
		yield* Effect.filterOrFail(
			Effect.succeed(items),
			A.isNonEmptyReadonlyArray,
			() => HttpError.Validation.of('body', failures.length > 0 ? `All ${failures.length} rows failed validation` : 'Empty file - no data to import'),
		);
		type BatchResult = { readonly assets: readonly Asset[]; readonly dbFailures: readonly TransferError.Import[] };
		const hashError = new TransferError.Fatal({ code: 'PARSER_ERROR', detail: 'Failed to compute content hash' });
		const toHashError = () => hashError;
		const prepareItem = (item: typeof items[number]) =>	// Prepare items: binary → S3 upload + metadata JSON, text → direct DB content
			codec.binary
				? Effect.gen(function* () {
					const byMime = pipe(
						Option.fromNullable(item.mime),
						Option.flatMap((mime) => Option.fromNullable(Codec.resolve(mime))),
					);
					const byName = pipe(
						Option.fromNullable(item.name),
						Option.flatMap((name) => Option.fromNullable(name.split('.').pop())),
						Option.flatMap((ext) => Option.fromNullable(Codec.resolve(ext))),
					);
					const itemCodec = pipe(byMime, Option.orElse(() => byName), Option.getOrElse(() => codec));
					const rawBuffer = itemCodec.buf(item.content);
					const computedHash = yield* (item.hash === undefined ? Crypto.hash(item.content) : Effect.succeed(item.hash)).pipe(Effect.mapError(toHashError));
					const storageKey = `assets/${appId}/${computedHash}.${itemCodec.ext}`;
					const originalName = item.name ?? `${computedHash.slice(0, 8)}.${itemCodec.ext}`;
					yield* storage.put({ body: rawBuffer, contentType: itemCodec.mime, key: storageKey, metadata: { type: item.type } });
					const metadata = JSON.stringify({ hash: computedHash, mime: itemCodec.mime, originalName, size: rawBuffer.byteLength, storageRef: storageKey });
					return {
						appId, content: metadata, deletedAt: Option.none(), hash: pipe(computedHash, Option.some),
						name: pipe(originalName, Option.some), status: 'active' as const, storageRef: pipe(storageKey, Option.some),
						type: item.type, updatedAt: undefined, userId: pipe(session.userId, Option.some),
					};
				})
				: Effect.succeed({
					appId, content: item.content, deletedAt: Option.none(), hash: Option.fromNullable(item.hash),
					name: Option.fromNullable(item.name), status: 'active' as const, storageRef: Option.none<string>(),
					type: item.type, updatedAt: undefined, userId: pipe(session.userId, Option.some),
				});
		const processBatch = (accumulator: BatchResult, batchItems: typeof items) => {
			const ordinals = batchItems.map((batchItem) => batchItem.ordinal);
			const prepareAll = Effect.forEach(batchItems, prepareItem, { concurrency: 10 });	// Prepare all items (binary → S3 + metadata, text → direct content)
			return prepareAll.pipe(
				Effect.flatMap((prepared) => repositories.assets.insertMany(prepared) as Effect.Effect<readonly Asset[], unknown>),
				Effect.map((created): BatchResult => ({ assets: A.appendAll(accumulator.assets, created), dbFailures: accumulator.dbFailures })),
				Effect.catchAll((error) =>
					Effect.logError('Batch insert failed', { error: String(error), ordinals }).pipe(
						Effect.as({ assets: accumulator.assets, dbFailures: A.append(accumulator.dbFailures, new TransferError.Import({ cause: error, code: 'BATCH_FAILED', rows: ordinals })) } as BatchResult),
					),
				),
			);
		};
		const initial: BatchResult = { assets: [], dbFailures: [] };
		const { assets, dbFailures } = dryRun
			? initial
			: yield* repositories.withTransaction(Stream.runFoldEffect(Stream.grouped(Stream.fromIterable(items), Transfer.limits.batchSize), initial, (accumulator, chunk) => processBatch(accumulator, Chunk.toArray(chunk)))).pipe(
					Effect.tap(({ assets: inserted, dbFailures: failed }) => Effect.all([
						Effect.annotateCurrentSpan('transfer.inserted', inserted.length),
						Effect.annotateCurrentSpan('transfer.db_failures', failed.length),
					], { discard: true })),
					Effect.mapError((err) => HttpError.Internal.of('Import processing failed', err)),
					Telemetry.span('transfer.insert'),
				);
		yield* Effect.when(
			search.refresh(appId).pipe(Effect.tapError((error) => Effect.logWarning('Search refresh failed', { error: String(error) })), Effect.catchAll(() => Effect.void)),
			() => !dryRun && A.isNonEmptyReadonlyArray(assets),
		);
		const totalFailures = failures.length + A.reduce(dbFailures, 0, (count, err) => count + err.rows.length);
		yield* Effect.all([
			MetricsService.inc(metrics.transfer.imports, MetricsService.label({ app: appId, dryRun: String(dryRun), format: codec.ext })),
			audit.log(dryRun ? 'Asset.validate' : 'Asset.import', {
				details: { dryRun, failedCount: totalFailures, format: codec.ext, importedCount: dryRun ? 0 : assets.length, userId: session.userId, validCount: items.length },
				subjectId: appId,
			}),
		], { discard: true });
		return {
			failed: A.appendAll(failures.map((err) => ({ error: err.detail ?? err.code, ordinal: err.ordinal ?? null })), dbFailures.flatMap((err) => err.rows.map((ordinal) => ({ error: 'Database insert failed' as const, ordinal })))),
			imported: dryRun ? items.length : assets.length,
		};
	}).pipe(Telemetry.span('transfer.import', { kind: 'server', metrics: false }));

// --- [LAYERS] ----------------------------------------------------------------

const TransferLive = HttpApiBuilder.group(ParametricApi, 'transfer', (handlers) =>
	Effect.gen(function* () {
		const [repositories, search, audit, storage] = yield* Effect.all([DatabaseService, SearchRepo, AuditService, StorageService]);
		return handlers
			.handleRaw('export', ({ urlParams }) => CacheService.rateLimit('api', handleExport(repositories, audit, storage, urlParams)))
			.handle('import', ({ urlParams }) => CacheService.rateLimit('mutation', handleImport(repositories, search, audit, storage, urlParams)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TransferLive };
