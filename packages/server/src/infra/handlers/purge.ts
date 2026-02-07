/**
 * Polymorphic purge handlers for all soft-deletable entities.
 * Single config, single dispatch, unified cron+handler registration.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { SqlClient } from '@effect/sql';
import { Array as A, Config, Cron, Effect, Layer, Metric, Option, Record as R } from 'effect';
import { AuditService } from '../../observe/audit.ts';
import { MetricsService } from '../../observe/metrics.ts';
import { Telemetry } from '../../observe/telemetry.ts';
import { StorageService } from '../../domain/storage.ts';
import { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';
import { ClusterService } from '../cluster.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _JOBS = {
	'purge-api-keys': 		{ repo: 'apiKeys' as const, 		strategy: 'db-only' as const },
	'purge-assets': 		{ repo: 'assets' as const, 			strategy: 'db-and-s3' as const },
	'purge-event-journal': 	{ repo: 'eventJournal' as const, 	strategy: 'db-only' as const },
	'purge-job-dlq': 		{ repo: 'jobDlq' as const, 			strategy: 'db-only' as const },
	'purge-kv-store': 		{ repo: 'kvStore' as const, 		strategy: 'db-only' as const },
	'purge-mfa-secrets': 	{ repo: 'mfaSecrets' as const, 		strategy: 'db-only' as const },
	'purge-oauth-accounts': { repo: 'oauthAccounts' as const, 	strategy: 'db-only' as const },
	'purge-sessions': 		{ repo: 'sessions' as const, 		strategy: 'db-only' as const },
} as const;
const _DEFAULTS = {
	'purge-api-keys': 		{ cron: '0 3 * * 0', 	days: 365 },
	'purge-assets': 		{ cron: '0 */6 * * *', 	days: 30 },
	'purge-event-journal': 	{ cron: '0 2 * * *', 	days: 30 },
	'purge-job-dlq': 		{ cron: '0 2 * * *', 	days: 30 },
	'purge-kv-store': 		{ cron: '0 0 * * 0', 	days: 90 },
	'purge-mfa-secrets': 	{ cron: '0 4 * * 0', 	days: 90 },
	'purge-oauth-accounts': { cron: '0 5 * * 0', 	days: 90 },
	'purge-sessions': 		{ cron: '0 1 * * *', 	days: 30 },
} as const;
const _config = Config.all({
	jobs: Config.all(R.map(_JOBS, (_, name) => Config.all({
		cron: Config.string(`PURGE_${(name as string).replace('purge-', '').replaceAll('-', '_').toUpperCase()}_CRON`),
		days: Config.integer(`PURGE_${(name as string).replace('purge-', '').replaceAll('-', '_').toUpperCase()}_DAYS`),
	}).pipe(Config.withDefault(_DEFAULTS[name]),))),
	s3: Config.all({
		batchSize: Config.integer('PURGE_S3_BATCH_SIZE').pipe(Config.withDefault(100)),
		concurrency: Config.integer('PURGE_S3_CONCURRENCY').pipe(Config.withDefault(2)),
	}),
});

// --- [SERVICE] ---------------------------------------------------------------

class PurgeService extends Effect.Service<PurgeService>()('server/Purge', {
	effect: Effect.gen(function* () {
		const [database, storage, audit, metrics, sql] = yield* Effect.all([DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient]);
		return { execute: (name: keyof typeof _JOBS) => PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql)) };
	}),
}) {
	static readonly _strategies = {
		'db-and-s3': (database: DatabaseService.Type, storage: typeof StorageService.Service, days: number, _repo: PurgeService.PurgeableRepo, s3Config: { readonly batchSize: number; readonly concurrency: number }) =>
			database.assets.findStaleForPurge(days).pipe(
				Effect.flatMap((assets) => Effect.forEach(
					A.chunksOf(A.filterMap(assets, (asset) => Option.fromNullable(asset.storageRef)), s3Config.batchSize),
					(batch) => storage.remove(batch).pipe(
						Effect.as({ deleted: batch.length, failed: 0 }),
						Effect.tapError((error) => Effect.logWarning('S3 batch delete failed', { error: String(error), keys: batch.length })),
						Effect.orElseSucceed(() => ({ deleted: 0, failed: batch.length })),
					),
					{ concurrency: s3Config.concurrency },
				)),
				Effect.map((results) => A.reduce(results, { deleted: 0, failed: 0 }, (accumulator, result) => ({ deleted: accumulator.deleted + result.deleted, failed: accumulator.failed + result.failed }))),
				Effect.flatMap((s3) => database.assets.purge(days).pipe(
					Effect.orElseSucceed(() => 0),
					Effect.map((dbPurged) => ({ dbPurged, s3Deleted: s3.deleted, s3Failed: s3.failed })),
				)),
			),
		'db-only': (database: DatabaseService.Type, _storage: typeof StorageService.Service, days: number, repo: PurgeService.PurgeableRepo, _s3Config: { readonly batchSize: number; readonly concurrency: number }) =>
			database[repo].purge(days).pipe(
				Effect.orElseSucceed(() => 0),
				Effect.map((dbPurged) => ({ dbPurged, s3Deleted: 0, s3Failed: 0 })),
			),
	} as const;
	static readonly _execute = (name: keyof typeof _JOBS, database: DatabaseService.Type, storage: typeof StorageService.Service, audit: typeof AuditService.Service, metrics: MetricsService) =>
		Effect.orDie(_config).pipe(
			Effect.flatMap((resolvedConfig) => {
				const jobDef = _JOBS[name];
				const jobCfg = resolvedConfig.jobs[name];
				const labels = MetricsService.label({ job_name: name });
				const purgeEffect = PurgeService._strategies[jobDef.strategy](database, storage, jobCfg.days, jobDef.repo, resolvedConfig.s3);
				return purgeEffect.pipe(
					Effect.tap((details) => details.dbPurged + details.s3Deleted === 0
						? Effect.logInfo('No records to purge', { job: name })
						: Effect.all([
							audit.log(`Job.${name}`, { details: { ...details, retentionDays: jobCfg.days }, subjectId: name }),
							Effect.logInfo('Purge completed', { job: name, ...details, retentionDays: jobCfg.days }),
						], { discard: true })),
					Effect.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.jobs.completions, labels))),
					Effect.tapError((error) => Effect.all([
						Effect.logError('Purge failed', { error: String(error), job: name }),
						Metric.increment(Metric.taggedWithLabels(metrics.jobs.failures, labels)),
					], { discard: true })),
					Effect.orElseSucceed(() => 0),
					Effect.asVoid,
					Telemetry.span(`jobs.${name}`, { metrics: false }),
				);
			}),
		);
	static readonly Crons = Layer.unwrapEffect(
		Effect.orDie(_config).pipe(
			Effect.map((resolvedConfig) => Layer.mergeAll(
				...(R.keys(_JOBS).map((name) =>
					ClusterService.Schedule.cron({
						cron: Cron.unsafeParse(resolvedConfig.jobs[name].cron),
						execute: JobService.pipe(Effect.flatMap((jobs) => Context.Request.withinSync(Context.Request.Id.system, jobs.submit(name, null), Context.Request.system()))),
						name,
					}),
				) as [Layer.Layer<never>, ...Layer.Layer<never>[]]),
			)),
		),
	);
	static readonly Handlers = Layer.effectDiscard(Effect.gen(function* () {
		const [jobs, database, storage, audit, metrics, sql] = yield* Effect.all([JobService, DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient]);
		yield* Effect.forEach(R.keys(_JOBS), (name) =>
			jobs.registerHandler(name, () => PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql))).pipe(Effect.tap(() => Effect.logInfo(`Handler registered: ${name}`)),),
			{ discard: true },
		);
	}));
	static readonly Layer = Layer.mergeAll(PurgeService.Crons, PurgeService.Handlers);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PurgeService {
	export type PurgeableRepo = typeof _JOBS[keyof typeof _JOBS]['repo'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { PurgeService };
