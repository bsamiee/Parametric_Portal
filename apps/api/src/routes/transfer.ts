/**
 * Handle bulk asset import/export HTTP endpoints.
 * [GROUNDING] Transactional batches with rollback; supports dry-run validation mode.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Asset } from '@parametric-portal/database/models';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { ParametricApi, type TransferQuery } from '@parametric-portal/server/api';
import { Context } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/errors';
import { Middleware } from '@parametric-portal/server/middleware';
import { StorageService } from '@parametric-portal/server/domain/storage';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { RateLimit } from '@parametric-portal/server/security/rate-limit';
import { Crypto } from '@parametric-portal/server/security/crypto';
import { Transfer, TransferError } from '@parametric-portal/server/utils/transfer';
import { Codec } from '@parametric-portal/types/files';
import { Array as A, Chunk, DateTime, Effect, Metric, Option, Stream } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleExport = Effect.fn('transfer.export')((repos: DatabaseServiceShape, audit: typeof AuditService.Service, storage: typeof StorageService.Service, params: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, ctx] = yield* Effect.all([MetricsService, Context.Request.current]);
		const session = yield* Context.Request.session;
		const appId = ctx.tenantId;
		const codec = Codec(params.format);
		const baseStream = Stream.fromIterableEffect(repos.assets.byFilter(session.userId, appId, {
			...(Option.isSome(params.after) && { after: params.after.value }),
			...(Option.isSome(params.before) && { before: params.before.value }),
			...(Option.isSome(params.typeSlug) && { types: [params.typeSlug.value] }),
		}));
		const mapAsset = (asset: Asset, idx: number) => ({	// Map asset to export format
			content: asset.content,
			id: asset.id,
			ordinal: idx + 1,
			type: asset.type,
			updatedAt: DateTime.toEpochMillis(asset.updatedAt),
			...(Option.isSome(asset.hash) && { hash: asset.hash.value }),
			...(Option.isSome(asset.name) && { name: asset.name.value }),
		});
		const textStream = baseStream.pipe(Stream.zipWithIndex, Stream.map(([asset, idx]) => mapAsset(asset, idx)));	// Text export: use DB content directly (text assets don't have storageRef)
		const binaryStream = baseStream.pipe(																			// Binary export: hydrate from S3 when storageRef is present
			Stream.mapEffect((asset) =>
				Option.match(asset.storageRef, {
					onNone: () => Effect.succeed(asset),
					onSome: (s3Key: string) => storage.get(s3Key).pipe(
						Effect.map((s3Obj) => ({ ...asset, content: Buffer.from(s3Obj.body).toString('base64') })),
						Effect.catchAll(() => Effect.succeed(asset)), 													// Fallback to DB content if S3 fetch fails
					),
				}),
			),
			Stream.zipWithIndex,
			Stream.map(([asset, idx]) => mapAsset(asset, idx)),
		);
		const auditExport = (name: string, count?: number) =>
			audit.log('Asset.export', { details: { count: count ?? null, format: codec.ext, name, userId: session.userId }, subjectId: appId });
		return yield* codec.binary
			? Telemetry.withSpan(`transfer.serialize.${codec.ext}`, Transfer.exportBinary(binaryStream, codec.ext)).pipe(
				Effect.tap((result) => Effect.all([
					Effect.annotateCurrentSpan('transfer.format', codec.ext),
					Effect.annotateCurrentSpan('transfer.rows', result.count),
					MetricsService.inc(metrics.transfer.exports, MetricsService.label({ app: appId, format: codec.ext })),
					MetricsService.inc(metrics.transfer.rows, MetricsService.label({ app: appId, outcome: 'exported' }), result.count),
				], { discard: true })),
				Effect.mapError((err) => HttpError.Internal.of(`${codec.ext.toUpperCase()} generation failed`, err)),
				Effect.tap((result) => auditExport(result.name, result.count)),
				Effect.map((result) => ({ ...result, format: codec.ext })),
			)
			: (() => {
				const filename = `assets-${DateTime.formatIso(DateTime.unsafeNow()).replaceAll(/[:.]/g, '-')}.${codec.ext}`;
				const tracked = MetricsService.trackStream(textStream, metrics.transfer.rows, { app: appId, outcome: 'exported' });
				const body = Transfer.exportText(tracked, codec.ext).pipe(
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
	}),
);
const handleImport = Effect.fn('transfer.import')((repos: DatabaseServiceShape, search: typeof SearchRepo.Service, audit: typeof AuditService.Service, storage: typeof StorageService.Service, params: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, ctx] = yield* Effect.all([MetricsService, Context.Request.current]);
		const session = yield* Context.Request.session;
		const appId = ctx.tenantId;
		const codec = Codec(params.format);
		const dryRun = Option.getOrElse(params.dryRun, () => false);
		const body = yield* HttpServerRequest.HttpServerRequest.pipe(
			Effect.flatMap((req) => req.arrayBuffer),
			Effect.mapError((err) => HttpError.Internal.of('Failed to read request body', err)),
			Effect.filterOrFail(
				(buf) => buf.byteLength > 0 && buf.byteLength <= Transfer.limits.totalBytes,
				(buf) => HttpError.Validation.of('body', buf.byteLength === 0 ? 'Empty request body' : `Max import size: ${Transfer.limits.totalBytes} bytes`),
			),
		);
		const parsed = yield* Telemetry.withSpan('transfer.parse', Stream.runCollect(Transfer.import(codec.binary ? body : codec.content(body), { format: codec.ext })).pipe(
			Effect.map(Chunk.toArray),
			Effect.tap((rows) => Effect.annotateCurrentSpan('transfer.rows.raw', rows.length)),
			Effect.catchTag('Fatal', (err) => Effect.fail(HttpError.Validation.of('body', err.detail ?? err.code))),
		));
		const { failures, items } = Transfer.partition(parsed);
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
		const prepareItem = (item: typeof items[number]) =>	// Prepare items: binary → S3 upload + metadata JSON, text → direct DB content
			codec.binary
				? Effect.gen(function* () {
					const rawBuf = codec.buf(item.content);
					const hash = item.hash ?? (yield* Crypto.token.hash(item.content).pipe(Effect.orDie));
					const s3Key = `assets/${appId}/${hash}.${codec.ext}`;
					const originalName = item.name ?? `${hash.slice(0, 8)}.${codec.ext}`;
					yield* storage.put({ body: rawBuf, contentType: codec.mime, key: s3Key, metadata: { type: item.type } });
					const metadata = JSON.stringify({ hash, mime: codec.mime, originalName, size: rawBuf.byteLength, storageRef: s3Key });
					return {
						appId, content: metadata, deletedAt: Option.none(), hash: Option.some(hash),
						name: Option.some(originalName), status: 'active' as const, storageRef: Option.some(s3Key),
						type: item.type, updatedAt: undefined, userId: Option.some(session.userId),
					};
				})
				: Effect.succeed({
					appId, content: item.content, deletedAt: Option.none(), hash: Option.fromNullable(item.hash),
					name: Option.fromNullable(item.name), status: 'active' as const, storageRef: Option.none<string>(),
					type: item.type, updatedAt: undefined, userId: Option.some(session.userId),
				});
		const processBatch = (acc: BatchResult, batchItems: typeof items) => {
			const ordinals = A.map(batchItems, (row) => row.ordinal);
			const prepareAll = Effect.forEach(batchItems, prepareItem, { concurrency: 10 });	// Prepare all items (binary → S3 + metadata, text → direct content)
			return prepareAll.pipe(
				Effect.flatMap((prepared) => repos.assets.insertMany(prepared) as Effect.Effect<readonly Asset[], unknown>),
				Effect.map((created): BatchResult => ({ assets: A.appendAll(acc.assets, created), dbFailures: acc.dbFailures })),
				Effect.catchAll((err) =>
					Effect.logError('Batch insert failed', { error: String(err), ordinals }).pipe(
						Effect.as({ assets: acc.assets, dbFailures: A.append(acc.dbFailures, new TransferError.Import({ cause: err, code: 'BATCH_FAILED', rows: ordinals })) } as BatchResult),
					),
				),
			);
		};
		const init: BatchResult = { assets: [], dbFailures: [] };
		const { assets, dbFailures } = dryRun
			? init
			: yield* Telemetry.withSpan('transfer.insert', Stream.runFoldEffect(Stream.grouped(Stream.fromIterable(items), Transfer.limits.batchSize), init, (acc, chunk) => processBatch(acc, Chunk.toArray(chunk))).pipe(
					Effect.tap(({ assets: inserted, dbFailures: failed }) => Effect.all([
						Effect.annotateCurrentSpan('transfer.inserted', inserted.length),
						Effect.annotateCurrentSpan('transfer.db_failures', failed.length),
					], { discard: true })),
					Effect.mapError((err) => HttpError.Internal.of('Import processing failed', err)),
				));
		yield* !dryRun && A.isNonEmptyReadonlyArray(assets)
			? search.refresh(appId).pipe(Effect.tapError((err) => Effect.logWarning('Search refresh failed', { error: String(err) })), Effect.catchAll(() => Effect.void))
			: Effect.void;
		const totalFailures = failures.length + A.reduce(dbFailures, 0, (count, err) => count + err.rows.length);
		yield* Effect.all([
			MetricsService.inc(metrics.transfer.imports, MetricsService.label({ app: appId, dryRun: String(dryRun), format: codec.ext })),
			audit.log(dryRun ? 'Asset.validate' : 'Asset.import', {
				details: { dryRun, failedCount: totalFailures, format: codec.ext, importedCount: dryRun ? 0 : assets.length, userId: session.userId, validCount: items.length },
				subjectId: appId,
			}),
		], { discard: true });
		return {
			failed: A.appendAll(A.map(failures, (err) => ({ error: err.detail ?? err.code, ordinal: err.ordinal ?? null })), A.flatMap(dbFailures, (err) => A.map(err.rows, (ordinal) => ({ error: 'Database insert failed' as const, ordinal })))),
			imported: dryRun ? items.length : assets.length,
		};
	}),
);

// --- [LAYERS] ----------------------------------------------------------------

const TransferLive = HttpApiBuilder.group(ParametricApi, 'transfer', (handlers) =>
	Effect.gen(function* () {
		const [repos, search, audit, storage] = yield* Effect.all([DatabaseService, SearchRepo, AuditService, StorageService]);
		return handlers
			.handleRaw('export', ({ urlParams }) => RateLimit.apply('api', handleExport(repos, audit, storage, urlParams)))
			.handle('import', ({ urlParams }) => RateLimit.apply('mutation', handleImport(repos, search, audit, storage, urlParams)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TransferLive };
