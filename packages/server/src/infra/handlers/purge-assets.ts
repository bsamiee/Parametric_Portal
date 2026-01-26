/**
 * Background job to purge stale S3 assets and hard-delete DB records.
 * Runs periodically to clean up soft-deleted assets older than retention period.
 */
import type { DatabaseServiceShape } from '@parametric-portal/database/repos';
import { Array as A, Duration, Effect, Option } from 'effect';
import type { AuditService } from '../../observe/audit.ts';
import type { StorageService } from '../../domain/storage.ts';
import type { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = {
	retention: { days: 30 },
	s3: { batchSize: 100, concurrency: 2 },
	schedule: { interval: Duration.hours(6) },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const makePurgeAssetsHandler = (		// Create handler with services curried in. JobService provides Tenant context via withinSync at runtime.
	db: DatabaseServiceShape,
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service,) => (_payload: unknown) =>
		Effect.gen(function* () {
			const staleAssets = yield* db.assets.findStaleForPurge(B.retention.days);
			yield* Effect.when(
				Effect.logInfo('purge-assets: no stale assets found'),
				() => staleAssets.length === 0,
			);
			yield* Effect.unless(
				Effect.gen(function* () {
					const keysToDelete = A.filterMap(staleAssets, (a) => Option.flatMap(a.storageRef, (k) => typeof k === 'string' ? Option.some(k) : Option.none()));
					yield* Effect.logInfo('purge-assets: processing stale assets', {
						assetCount: staleAssets.length,
						s3KeyCount: keysToDelete.length,
					});
					const s3Batches = A.chunksOf(keysToDelete, B.s3.batchSize);
					const s3Results = yield* Effect.forEach(
						s3Batches,
						(batch) =>
							storage.remove(batch).pipe(
								Effect.map(() => ({ deleted: batch.length, failed: 0 })),
								Effect.catchAll((err) =>
									Effect.logWarning('purge-assets: S3 batch delete failed', { error: String(err), keys: batch.length }).pipe(
										Effect.as({ deleted: 0, failed: batch.length }),
									),
								),
							),
						{ concurrency: B.s3.concurrency },
					);
					const s3Deleted = A.reduce(s3Results, 0, (acc, r) => acc + r.deleted);
					const s3Failed = A.reduce(s3Results, 0, (acc, r) => acc + r.failed);
					const dbPurged = yield* (db.assets.purge(B.retention.days) as Effect.Effect<number, unknown>).pipe(
						Effect.catchAll((err) =>
							Effect.logError('purge-assets: DB purge failed', { error: String(err) }).pipe(Effect.as(0)),
						),
					);
					yield* audit.log('Job.purge_assets', {
						details: { dbPurged, retentionDays: B.retention.days, s3Deleted, s3Failed },
						subjectId: 'purge-assets',
					});
					yield* Effect.logInfo('purge-assets: completed', {
						dbPurged,
						retentionDays: B.retention.days,
						s3Deleted,
						s3Failed,
					});
				}),
				() => staleAssets.length === 0,
			);
		}).pipe(Effect.withSpan('jobs.purge-assets'));

// --- [REGISTRATION] ----------------------------------------------------------

const registerPurgeAssetsJob = (											/** Register the purge-assets handler with JobService. Call during app initialization with services. */
	jobService: typeof JobService.Service,
	db: DatabaseServiceShape,
	storage: typeof StorageService.Service,
	audit: typeof AuditService.Service, ) =>
	Effect.gen(function* () {
		yield* jobService.registerHandler('purge-assets', makePurgeAssetsHandler(db, storage, audit));
		yield* Effect.logInfo('purge-assets: handler registered');
	});
const enqueuePurgeAssetsJob = (jobService: typeof JobService.Service) =>	/** Enqueue the purge-assets job to run periodically. */
	Context.Request.withinSync(
		Context.Request.Id.system,
		jobService.enqueue('purge-assets', null, { delay: B.schedule.interval }),
		Context.Request.system(),
	);

// --- [EXPORT] ----------------------------------------------------------------

export { enqueuePurgeAssetsJob, makePurgeAssetsHandler, registerPurgeAssetsJob };
