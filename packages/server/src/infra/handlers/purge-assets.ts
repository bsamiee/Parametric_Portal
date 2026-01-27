/**
 * Background job: purge stale S3 assets and hard-delete DB records.
 * Runs periodically to clean up soft-deleted assets older than retention period.
 */
import type { DatabaseServiceShape } from '@parametric-portal/database/repos';
import { Array as A, Duration, Effect, pipe } from 'effect';
import type { AuditService } from '../../observe/audit.ts';
import type { StorageService } from '../../domain/storage.ts';
import type { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _PurgeConfig = {
	retention: { days: 30 },
	s3: { batchSize: 100, concurrency: 2 },
	schedule: { interval: Duration.hours(6) },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _deleteBatch = (storage: typeof StorageService.Service, batch: ReadonlyArray<string>) =>
	storage.remove(batch).pipe(
		Effect.as({ deleted: batch.length, failed: 0 }),
		Effect.catchAll((err) =>
			Effect.logWarning('S3 batch delete failed', { error: String(err), keys: batch.length }).pipe(
				Effect.as({ deleted: 0, failed: batch.length }),
			),
		),
	);

// --- [ENTRY_POINT] -----------------------------------------------------------

const PurgeAssets = {
	enqueue: (jobService: typeof JobService.Service) =>
		Context.Request.withinSync(
			Context.Request.Id.system,
			jobService.enqueue('purge-assets', null, { delay: _PurgeConfig.schedule.interval }),
			Context.Request.system(),
		),
	handler: (db: DatabaseServiceShape, storage: typeof StorageService.Service, audit: typeof AuditService.Service) =>
		Effect.fn('jobs.purge-assets')((_payload: unknown) =>
			db.assets.findStaleForPurge(_PurgeConfig.retention.days).pipe(
				Effect.flatMap(A.match({
					onEmpty: () => Effect.logInfo('No stale assets found'),
					onNonEmpty: (staleAssets) => Effect.gen(function* () {
						const keysToDelete = pipe(staleAssets, A.filterMap((a) => a.storageRef), A.filter((k): k is string => k !== null));
						yield* Effect.logInfo('Processing stale assets', { assetCount: staleAssets.length, s3KeyCount: keysToDelete.length });
						const s3Batches = A.chunksOf(keysToDelete, _PurgeConfig.s3.batchSize);
						const s3Results = yield* Effect.forEach(s3Batches, (batch) => _deleteBatch(storage, batch), { concurrency: _PurgeConfig.s3.concurrency });
						const s3Deleted = A.reduce(s3Results, 0, (acc, r) => acc + r.deleted);
						const s3Failed = A.reduce(s3Results, 0, (acc, r) => acc + r.failed);
						const dbPurged = yield* (db.assets.purge(_PurgeConfig.retention.days) as Effect.Effect<number, unknown>).pipe(
							Effect.catchAll((err) => Effect.logError('DB purge failed', { error: String(err) }).pipe(Effect.as(0))),
						);
						const details = { dbPurged, retentionDays: _PurgeConfig.retention.days, s3Deleted, s3Failed };
						yield* Effect.all([
							audit.log('Job.purge_assets', { details, subjectId: 'purge-assets' }),
							Effect.logInfo('Completed', details),
						], { discard: true });
					}),
				})),
			),
		),
	register: (jobService: typeof JobService.Service, db: DatabaseServiceShape, storage: typeof StorageService.Service, audit: typeof AuditService.Service) =>
		Effect.gen(function* () {
			yield* jobService.registerHandler('purge-assets', PurgeAssets.handler(db, storage, audit));
			yield* Effect.logInfo('Handler registered');
		}),
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace PurgeAssets {
    export type Services = {
        readonly db: DatabaseServiceShape;
        readonly storage: typeof StorageService.Service;
        readonly audit: typeof AuditService.Service;
    };
}

// --- [EXPORT] ----------------------------------------------------------------

export { PurgeAssets };
