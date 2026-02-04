/**
 * Polymorphic purge handlers for all soft-deletable entities.
 * Single config, single dispatch, unified cron+handler registration.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, Cron, Effect, Layer, Match, Record as R } from 'effect';
import { AuditService } from '../../observe/audit.ts';
import { Telemetry } from '../../observe/telemetry.ts';
import { StorageService } from '../../domain/storage.ts';
import { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';
import { ClusterService } from '../cluster.ts';

// --- [TYPES] -----------------------------------------------------------------

type PurgeJobName = keyof typeof _CONFIG.jobs;
type PurgeRepo = 'apiKeys' | 'assets' | 'eventJournal' | 'jobDlq' | 'kvStore' | 'mfaSecrets' | 'oauthAccounts' | 'sessions';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	jobs: {
		'purge-api-keys': 		{ cron: '0 3 * * 0', 	days: 365, 	repo: 'apiKeys' as const },
		'purge-assets': 		{ cron: '0 */6 * * *', 	days: 30, 	repo: 'assets' as const },
		'purge-event-journal': 	{ cron: '0 2 * * *', 	days: 30, 	repo: 'eventJournal' as const },
		'purge-job-dlq': 		{ cron: '0 2 * * *', 	days: 30, 	repo: 'jobDlq' as const },
		'purge-kv-store': 		{ cron: '0 0 * * 0', 	days: 90, 	repo: 'kvStore' as const },
		'purge-mfa-secrets': 	{ cron: '0 4 * * 0', 	days: 90, 	repo: 'mfaSecrets' as const },
		'purge-oauth-accounts': { cron: '0 5 * * 0', 	days: 90, 	repo: 'oauthAccounts' as const },
		'purge-sessions': 		{ cron: '0 1 * * *', 	days: 30, 	repo: 'sessions' as const },
	},
	s3: { batchSize: 100, concurrency: 2 },
} as const satisfies { jobs: Record<string, { cron: string; days: number; repo: PurgeRepo }>; s3: { batchSize: number; concurrency: number } };

// --- [FUNCTIONS] -------------------------------------------------------------

const _sumResults = (results: ReadonlyArray<{ deleted: number; failed: number }>) => results.reduce((acc, r) => ({ deleted: acc.deleted + r.deleted, failed: acc.failed + r.failed }), { deleted: 0, failed: 0 });
const _deleteBatch = (storage: typeof StorageService.Service, batch: ReadonlyArray<string>) =>
	storage.remove(batch).pipe(
		Effect.as({ deleted: batch.length, failed: 0 }),
		Effect.catchAll((err) => Effect.logWarning('S3 batch delete failed', { error: String(err), keys: batch.length }).pipe(Effect.as({ deleted: 0, failed: batch.length }))),
	);
const _purgeAssets = (db: DatabaseService.Type, storage: typeof StorageService.Service, days: number) =>
	db.assets.findStaleForPurge(days).pipe(
		Effect.flatMap(A.match({
			onEmpty: () => Effect.succeed({ dbPurged: 0, s3Deleted: 0, s3Failed: 0 }),
			onNonEmpty: (staleAssets) => {
				const keysToDelete = A.filter(A.filterMap(staleAssets, (a) => a.storageRef), (k): k is string => k !== null);
				const s3Batches = A.chunksOf(keysToDelete, _CONFIG.s3.batchSize);
				return Effect.all([
					Effect.forEach(s3Batches, (batch) => _deleteBatch(storage, batch), { concurrency: _CONFIG.s3.concurrency }),
					(db.assets.purge(days) as Effect.Effect<number, unknown>).pipe(Effect.orElse(() => Effect.succeed(0))),
				]).pipe(Effect.map(([s3Results, dbPurged]) => ({ dbPurged, s3Deleted: _sumResults(s3Results).deleted, s3Failed: _sumResults(s3Results).failed })));
			},
		})),
	);
const _purgeSimple = (db: DatabaseService.Type, repo: Exclude<PurgeRepo, 'assets'>, days: number) =>
	(db[repo].purge(days) as Effect.Effect<number, unknown>).pipe(
		Effect.orElse(() => Effect.succeed(0)),
		Effect.map((dbPurged) => ({ dbPurged })),
	);
const _handler = (name: PurgeJobName, db: DatabaseService.Type, storage: typeof StorageService.Service, audit: typeof AuditService.Service) => {
	const cfg = _CONFIG.jobs[name];
	return (_payload: unknown) =>
		Match.value(cfg.repo).pipe(
			Match.when('assets', () => _purgeAssets(db, storage, cfg.days)),
			Match.orElse((repo) => _purgeSimple(db, repo, cfg.days)),
		).pipe(
			Effect.tap((details) =>
				Match.value(details).pipe(
					Match.when({ dbPurged: 0, s3Deleted: (n: number) => n === 0 || n === undefined }, () => Effect.logInfo('No records to purge', { job: name })),
					Match.orElse((d) => Effect.all([
						audit.log(`Job.${name}`, { details: { ...d, retentionDays: cfg.days }, subjectId: name }),
						Effect.logInfo('Purge completed', { job: name, ...d, retentionDays: cfg.days }),
					], { discard: true })),
				),
			),
			Telemetry.span(`jobs.${name}`),
		);
};
const _enqueue = (name: PurgeJobName) => (jobs: typeof JobService.Service) => Context.Request.withinSync(Context.Request.Id.system, jobs.submit(name, null), Context.Request.system());

// --- [LAYERS] ----------------------------------------------------------------

const _Crons = Layer.mergeAll(
	...(R.keys(_CONFIG.jobs).map((name) =>
		ClusterService.cron({
			cron: Cron.unsafeParse(_CONFIG.jobs[name].cron),
			execute: JobService.pipe(Effect.flatMap(_enqueue(name))),
			name,
		}),
	) as [Layer.Layer<never>, ...Layer.Layer<never>[]]),
);
const _Handlers = Layer.effectDiscard(Effect.gen(function* () {
	const [jobs, db, storage, audit] = yield* Effect.all([JobService, DatabaseService, StorageService, AuditService]);
	yield* Effect.forEach(R.keys(_CONFIG.jobs), (name) =>
		jobs.registerHandler(name, _handler(name, db, storage, audit)).pipe(Effect.tap(() => Effect.logInfo(`Handler registered: ${name}`))),
		{ discard: true },
	);
}));

// --- [ENTRY_POINT] -----------------------------------------------------------

const Purge = {
	Crons: _Crons,
	config: _CONFIG,
	enqueue: _enqueue,
	Handlers: _Handlers,
	handler: _handler,
	Layer: Layer.mergeAll(_Crons, _Handlers),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Purge };
