/**
 * Handle bulk asset import/export HTTP endpoints.
 * [GROUNDING] Transactional batches with rollback; supports dry-run validation mode.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import type { Asset } from '@parametric-portal/database/models';
import { DatabaseService, type DatabaseServiceShape } from '@parametric-portal/database/repos';
import { SearchService } from '@parametric-portal/database/search';
import { ParametricApi, type TransferQuery } from '@parametric-portal/server/api';
import { Audit } from '@parametric-portal/server/audit';
import { RequestContext } from '@parametric-portal/server/context';
import { HttpError } from '@parametric-portal/server/http-errors';
import { MetricsService } from '@parametric-portal/server/metrics';
import { Middleware } from '@parametric-portal/server/middleware';
import { RateLimit } from '@parametric-portal/server/rate-limit';
import { withAppSpan } from '@parametric-portal/server/telemetry';
import { Transfer, TransferError } from '@parametric-portal/server/transfer';
import { Codec } from '@parametric-portal/types/files';
import { Array as A, Chunk, DateTime, Effect, Metric, Option, Stream } from 'effect';

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const handleExport = Effect.fn('transfer.export')((repos: DatabaseServiceShape, params: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, session, appId] = yield* Effect.all([MetricsService, Middleware.Session, RequestContext.app]);
		const codec = Codec(params.format);
		const baseStream = Stream.fromIterableEffect(repos.assets.byFilter(session.userId, appId, {
			...(Option.isSome(params.after) && { after: params.after.value }),
			...(Option.isSome(params.before) && { before: params.before.value }),
			...(Option.isSome(params.typeSlug) && { kind: params.typeSlug.value }),
		}));
		const stream = baseStream.pipe(Stream.zipWithIndex, Stream.map(([asset, idx]) => ({
			content: asset.content,
			id: asset.id,
			kind: asset.kind,
			ordinal: idx + 1,
			updatedAt: DateTime.toEpochMillis(asset.updatedAt),
			...(Option.isSome(asset.hash) && { hash: asset.hash.value }),
			...(Option.isSome(asset.name) && { name: asset.name.value }),
		})));
		const auditExport = (name: string, count?: number) =>
			Audit.log(repos.audit, 'Asset', appId, 'export', { after: { count: count ?? null, format: codec.ext, name, userId: session.userId } });
		return yield* codec.binary
			? withAppSpan(`transfer.serialize.${codec.ext}`, Transfer.exportBinary(stream, codec.ext)).pipe(
				Effect.tap((result) => Effect.all([
					Effect.annotateCurrentSpan('transfer.format', codec.ext),
					Effect.annotateCurrentSpan('transfer.rows', result.count),
					Metric.update(metrics.transfer.exports.pipe(Metric.tagged('format', codec.ext), Metric.tagged('app', appId)), 1),
					Metric.update(metrics.transfer.rows.pipe(Metric.tagged('outcome', 'exported'), Metric.tagged('app', appId)), result.count),
				], { discard: true })),
				Effect.mapError((err) => HttpError.internal(`${codec.ext.toUpperCase()} generation failed`, err)),
				Effect.tap((result) => auditExport(result.name, result.count)),
				Effect.map((result) => ({ ...result, format: codec.ext })),
			)
			: (() => {
				const filename = `assets-${DateTime.formatIso(DateTime.unsafeNow()).replaceAll(/[:.]/g, '-')}.${codec.ext}`;
				const tracked = MetricsService.trackStream(stream, metrics.transfer.rows, { app: appId, outcome: 'exported' });
				const body = Transfer.exportText(tracked, codec.ext).pipe(
					Stream.tapError((err) => Effect.all([
						Effect.logError(`${codec.ext.toUpperCase()} export stream error`, { error: String(err) }),
						Metric.update(metrics.errors.pipe(Metric.tagged('app', appId), Metric.tagged('operation', 'export')), 'StreamError'),
					], { discard: true })),
				);
				return HttpServerResponse.stream(body, { contentType: codec.mime }).pipe(
					Effect.flatMap((res) => HttpServerResponse.setHeader(res, 'Content-Disposition', `attachment; filename="${filename}"`)),
					Effect.tap(() => Effect.all([
						Effect.annotateCurrentSpan('transfer.format', codec.ext),
						Metric.update(metrics.transfer.exports.pipe(Metric.tagged('format', codec.ext), Metric.tagged('app', appId)), 1),
					], { discard: true })),
					Effect.tap(() => auditExport(filename)),
				);
			})();
	}),
);
const handleImport = Effect.fn('transfer.import')((repos: DatabaseServiceShape, search: typeof SearchService.Service, params: typeof TransferQuery.Type) =>
	Effect.gen(function* () {
		yield* Middleware.requireMfaVerified;
		const [metrics, session, appId] = yield* Effect.all([MetricsService, Middleware.Session, RequestContext.app]);
		const codec = Codec(params.format);
		const dryRun = Option.getOrElse(params.dryRun, () => false);
		const body = yield* HttpServerRequest.HttpServerRequest.pipe(
			Effect.flatMap((req) => req.arrayBuffer),
			Effect.mapError((err) => HttpError.internal('Failed to read request body', err)),
			Effect.filterOrFail(
				(buf) => buf.byteLength > 0 && buf.byteLength <= Transfer.limits.totalBytes,
				(buf) => HttpError.validation('body', buf.byteLength === 0 ? 'Empty request body' : `Max import size: ${Transfer.limits.totalBytes} bytes`),
			),
		);
		const parsed = yield* withAppSpan('transfer.parse', Stream.runCollect(Transfer.import(codec.binary ? body : codec.content(body), { format: codec.ext })).pipe(
			Effect.map(Chunk.toArray),
			Effect.tap((rows) => Effect.annotateCurrentSpan('transfer.rows.raw', rows.length)),
			Effect.catchTag('Fatal', (err) => Effect.fail(HttpError.validation('body', err.detail ?? err.code))),
		));
		const { failures, items } = Transfer.partition(parsed);
		yield* Effect.all([
			Effect.annotateCurrentSpan('transfer.format', codec.ext),
			Effect.annotateCurrentSpan('transfer.rows.valid', items.length),
			Effect.annotateCurrentSpan('transfer.rows.failed', failures.length),
			Metric.update(metrics.transfer.rows.pipe(Metric.tagged('outcome', 'parsed'), Metric.tagged('app', appId)), items.length),
			Metric.update(metrics.transfer.rows.pipe(Metric.tagged('outcome', 'failed'), Metric.tagged('app', appId)), failures.length),
		], { discard: true });
		yield* Effect.filterOrFail(
			Effect.succeed(items),
			A.isNonEmptyReadonlyArray,
			() => HttpError.validation('body', failures.length > 0 ? `All ${failures.length} rows failed validation` : 'Empty file - no data to import'),
		);
		const processBatch = (acc: { readonly assets: readonly Asset[]; readonly dbFailures: readonly TransferError.Import[] }, batchItems: typeof items) => {
			const ordinals = A.map(batchItems, (row) => row.ordinal);
			return repos.withTransaction(repos.assets.insertMany(A.map(batchItems, (item) => ({
				appId,
				content: item.content,
				deletedAt: Option.none(),
				hash: Option.fromNullable(item.hash),
				kind: item.kind,
				name: Option.fromNullable(item.name),
				state: 'active',
				updatedAt: undefined,
				userId: Option.some(session.userId),
			})))).pipe(
				Effect.tapError((err) => Effect.logError('Batch insert failed', { error: String(err), ordinals })),
				Effect.map((created) => ({ assets: A.appendAll(acc.assets, created), dbFailures: acc.dbFailures })),
				Effect.catchAll((err) => Effect.succeed({ assets: acc.assets, dbFailures: A.append(acc.dbFailures, new TransferError.Import({ cause: err, code: 'BATCH_FAILED', rows: ordinals })) })),
			);
		};
		const init = { assets: [] as readonly Asset[], dbFailures: [] as readonly TransferError.Import[] };
		const { assets, dbFailures } = dryRun
			? init
			: yield* withAppSpan('transfer.insert', Stream.runFoldEffect(Stream.grouped(Stream.fromIterable(items), Transfer.limits.batchSize), init, (acc, chunk) => processBatch(acc, Chunk.toArray(chunk))).pipe(
					Effect.tap(({ assets: inserted, dbFailures: failed }) => Effect.all([
						Effect.annotateCurrentSpan('transfer.inserted', inserted.length),
						Effect.annotateCurrentSpan('transfer.db_failures', failed.length),
					], { discard: true })),
					Effect.mapError((err) => HttpError.internal('Import processing failed', err)),
				));
		yield* !dryRun && A.isNonEmptyReadonlyArray(assets)
			? search.refresh(appId).pipe(Effect.tapError((err) => Effect.logWarning('Search refresh failed', { error: String(err) })), Effect.catchAll(() => Effect.void))
			: Effect.void;
		const totalFailures = failures.length + A.reduce(dbFailures, 0, (count, err) => count + err.rows.length);
		yield* Effect.all([
			Metric.update(metrics.transfer.imports.pipe(Metric.tagged('format', codec.ext), Metric.tagged('app', appId), Metric.tagged('dryRun', String(dryRun))), 1),
			Audit.log(repos.audit, 'Asset', appId, dryRun ? 'validate' : 'create', {
				after: { dryRun, failedCount: totalFailures, format: codec.ext, importedCount: dryRun ? 0 : assets.length, userId: session.userId, validCount: items.length },
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
		const repos = yield* DatabaseService;
		const search = yield* SearchService;
		return handlers.handleRaw('export', ({ urlParams }) => RateLimit.apply('api', handleExport(repos, urlParams))).handle('import', ({ urlParams }) => RateLimit.apply('mutation', handleImport(repos, search, urlParams)));
	}),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TransferLive };
