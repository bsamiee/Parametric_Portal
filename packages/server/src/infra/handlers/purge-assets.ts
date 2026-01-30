/**
 * Background job: purge stale S3 assets and hard-delete DB records.
 * Runs periodically to clean up soft-deleted assets older than retention period.
 */
import type { DatabaseServiceShape } from '@parametric-portal/database/repos';
import { Array as A, Duration, Effect } from 'effect';
import type { AuditService } from '../../observe/audit.ts';
import { Telemetry } from '../../observe/telemetry.ts';
import type { StorageService } from '../../domain/storage.ts';
import type { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	retention: { days: 30 },
	s3: { batchSize: 100, concurrency: 2 },
	schedule: { interval: Duration.hours(6) },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _sumResults = (rs: ReadonlyArray<{ deleted: number; failed: number }>) => rs.reduce((a, r) => ({ deleted: a.deleted + r.deleted, failed: a.failed + r.failed }), { deleted: 0, failed: 0 });
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
			jobService.enqueue('purge-assets', null),
			Context.Request.system(),
		),
	handler: (db: DatabaseServiceShape, storage: typeof StorageService.Service, audit: typeof AuditService.Service) =>
		(_payload: unknown) =>
			db.assets.findStaleForPurge(_config.retention.days).pipe(
				Effect.flatMap(A.match({
					onEmpty: () => Effect.logInfo('No stale assets found'),
					onNonEmpty: (staleAssets) => {
						const keysToDelete = A.filter(A.filterMap(staleAssets, (a) => a.storageRef), (k): k is string => k !== null);
						const s3Batches = A.chunksOf(keysToDelete, _config.s3.batchSize);
						const dbPurge = (db.assets.purge(_config.retention.days) as Effect.Effect<number, unknown>).pipe(Effect.orElse(() => Effect.succeed(0)));
						const s3Work = Effect.forEach(s3Batches, (batch) => _deleteBatch(storage, batch), { concurrency: _config.s3.concurrency });
						return Effect.logInfo('Processing stale assets', { assetCount: staleAssets.length, s3KeyCount: keysToDelete.length }).pipe(
							Effect.andThen(Effect.all([s3Work, dbPurge])),
							Effect.map(([s3Results, dbPurged]) => ({ ...(_sumResults(s3Results)), dbPurged, retentionDays: _config.retention.days })),
							Effect.map(({ deleted, failed, ...rest }) => ({ ...rest, s3Deleted: deleted, s3Failed: failed })),
							Effect.tap((details) => Effect.all([audit.log('Job.purge_assets', { details, subjectId: 'purge-assets' }), Effect.logInfo('Completed', details)], { discard: true })),
						);
					},
				})),
				Telemetry.span('jobs.purge-assets'),
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
