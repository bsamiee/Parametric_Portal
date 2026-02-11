/**
 * Polymorphic purge handlers for all soft-deletable entities.
 * Single config, single dispatch, unified cron+handler registration.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { SqlClient } from '@effect/sql';
import { Array as A, Config, Cron, Effect, Layer, Match, Metric, Option, Record as R } from 'effect';
import { AuditService } from '../../observe/audit.ts';
import { MetricsService } from '../../observe/metrics.ts';
import { Telemetry } from '../../observe/telemetry.ts';
import { StorageService } from '../../domain/storage.ts';
import { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';
import { ClusterService } from '../cluster.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _JOBS = {
	'purge-api-keys': 		{ cron: '0 3 * * 0', 	days: 365, 	repo: 'apiKeys' as const, 		scope: 'tenant' as const, strategy: 'db-only' as const },
	'purge-assets': 		{ cron: '0 */6 * * *', 	days: 30, 	repo: 'assets' as const, 		scope: 'tenant' as const, strategy: 'db-and-s3' as const },
	'purge-event-journal': 	{ cron: '0 2 * * *', 	days: 30, 	repo: 'eventJournal' as const, 	scope: 'global' as const, strategy: 'db-only' as const },
	'purge-job-dlq': 		{ cron: '0 2 * * *', 	days: 30, 	repo: 'jobDlq' as const, 		scope: 'tenant' as const, strategy: 'db-only' as const },
	'purge-kv-store': 		{ cron: '0 0 * * 0', 	days: 90, 	repo: 'kvStore' as const, 		scope: 'global' as const, strategy: 'db-only' as const },
	'purge-mfa-secrets': 	{ cron: '0 4 * * 0', 	days: 90, 	repo: 'mfaSecrets' as const, 	scope: 'tenant' as const, strategy: 'db-only' as const },
	'purge-oauth-accounts': { cron: '0 5 * * 0', 	days: 90, 	repo: 'oauthAccounts' as const, scope: 'tenant' as const, strategy: 'db-only' as const },
	'purge-sessions': 		{ cron: '0 1 * * *', 	days: 30, 	repo: 'sessions' as const, 		scope: 'tenant' as const, strategy: 'db-only' as const },
	'purge-tenant-data': 	{ cron: null as unknown as string, days: 0, repo: 'apps' as const, scope: 'manual' as const, strategy: 'cascade-tenant' as const },
} as const;
const _envKey = (name: string) => `PURGE_${name.replace('purge-', '').replaceAll('-', '_').toUpperCase()}`;
const _config = Config.all({
	jobs: Config.all(R.map(_JOBS, (defaults, name) => Config.all({
		cron: Config.string(`${_envKey(name as string)}_CRON`),
		days: Config.integer(`${_envKey(name as string)}_DAYS`),
	}).pipe(Config.withDefault({ cron: defaults.cron, days: defaults.days })))),
	s3: Config.all({ batchSize: Config.integer('PURGE_S3_BATCH_SIZE').pipe(Config.withDefault(100)), concurrency: Config.integer('PURGE_S3_CONCURRENCY').pipe(Config.withDefault(2)) }),
});
const _purgeDbOnly = (database: DatabaseService.Type, repo: typeof _JOBS[keyof typeof _JOBS]['repo'], days: number) =>
	Match.value(repo).pipe(
		Match.when('apiKeys', () => database.apiKeys.purge(days)),
		Match.when('apps', () => Effect.succeed(0)),
		Match.when('assets', () => database.assets.purge(days)),
		Match.when('eventJournal', () => database.eventJournal.purge(days)),
		Match.when('jobDlq', () => database.jobDlq.purge(days)),
		Match.when('kvStore', () => database.kvStore.purge(days)),
		Match.when('mfaSecrets', () => database.mfaSecrets.purge(days)),
		Match.when('oauthAccounts', () => database.oauthAccounts.purge(days)),
		Match.when('sessions', () => database.sessions.purge(days)),
		Match.exhaustive,
	);

// --- [SERVICES] --------------------------------------------------------------

class PurgeService extends Effect.Service<PurgeService>()('server/Purge', {
	effect: Effect.gen(function* () {
		const [database, storage, audit, metrics, sql] = yield* Effect.all([DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient]);
		return { execute: (name: keyof typeof _JOBS) => PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql)) };
	}),
}) {
	static readonly _strategies = {
		'cascade-tenant': (database: DatabaseService.Type, storage: typeof StorageService.Service, _days: number, _repo: PurgeService.PurgeableRepo, s3Config: { readonly batchSize: number; readonly concurrency: number }) => Effect.gen(function* () {
			const tenantId = yield* Context.Request.currentTenantId;
			const assets = yield* database.assets.find([]);
			const chunks = A.chunksOf(A.filterMap(assets, (asset) => Option.fromNullable(asset.storageRef)), s3Config.batchSize);
			const batchRemove = (batch: ReadonlyArray<string>) => storage.remove(batch).pipe(
				Effect.as({ deleted: batch.length, failed: 0 }),
				Effect.tapError((error) => Effect.logWarning('S3 batch delete failed (cascade)', { error: String(error), keys: batch.length })),
				Effect.orElseSucceed(() => ({ deleted: 0, failed: batch.length })),
			);
			const results = yield* Effect.forEach(chunks, batchRemove, { concurrency: s3Config.concurrency });
			const s3 = A.reduce(results, { deleted: 0, failed: 0 }, (accumulator, result) => ({ deleted: accumulator.deleted + result.deleted, failed: accumulator.failed + result.failed }));
			const dbPurged = yield* database.system.purgeTenantCascade(tenantId).pipe(Effect.orElseSucceed(() => 0));
			return { dbPurged, s3Deleted: s3.deleted, s3Failed: s3.failed };
		}),
		'db-and-s3': (database: DatabaseService.Type, storage: typeof StorageService.Service, days: number, _repo: PurgeService.PurgeableRepo, s3Config: { readonly batchSize: number; readonly concurrency: number }) => Effect.gen(function* () {
			const assets = yield* database.assets.findStaleForPurge(days);
			const chunks = A.chunksOf(A.filterMap(assets, (asset) => Option.fromNullable(asset.storageRef)), s3Config.batchSize);
			const batchRemove = (batch: ReadonlyArray<string>) => storage.remove(batch).pipe(
				Effect.as({ deleted: batch.length, failed: 0 }),
				Effect.tapError((error) => Effect.logWarning('S3 batch delete failed', { error: String(error), keys: batch.length })),
				Effect.orElseSucceed(() => ({ deleted: 0, failed: batch.length }))
			);
			const results = yield* Effect.forEach(chunks, batchRemove, { concurrency: s3Config.concurrency });
			const s3 = A.reduce(results, { deleted: 0, failed: 0 }, (accumulator, result) => ({ deleted: accumulator.deleted + result.deleted, failed: accumulator.failed + result.failed }));
			const dbPurged = yield* database.assets.purge(days).pipe(Effect.orElseSucceed(() => 0));
			return { dbPurged, s3Deleted: s3.deleted, s3Failed: s3.failed };
		}),
		'db-only': (database: DatabaseService.Type, _storage: typeof StorageService.Service, days: number, repo: PurgeService.PurgeableRepo, _s3Config: { readonly batchSize: number; readonly concurrency: number }) =>
			_purgeDbOnly(database, repo, days).pipe(Effect.catchAll(() => Effect.succeed(0)), Effect.map((dbPurged) => ({ dbPurged, s3Deleted: 0, s3Failed: 0 }))),
	} as const;
	static readonly _execute = (name: keyof typeof _JOBS, database: DatabaseService.Type, storage: typeof StorageService.Service, audit: typeof AuditService.Service, metrics: MetricsService) =>
		Effect.orDie(_config).pipe(Effect.flatMap((resolvedConfig) => {
			const jobDef = _JOBS[name], jobCfg = resolvedConfig.jobs[name], labels = MetricsService.label({ job_name: name });
			const logPurgeResult = (details: { readonly dbPurged: number; readonly s3Deleted: number; readonly s3Failed: number }) => Match.value(details.dbPurged + details.s3Deleted).pipe(
				Match.when(0, () => Effect.logInfo('No records to purge', { job: name })),
				Match.orElse(() => Effect.all([audit.log(`Job.${name}`, { details: { ...details, retentionDays: jobCfg.days }, subjectId: name }), Effect.logInfo('Purge completed', { job: name, ...details, retentionDays: jobCfg.days })], { discard: true }))
			);
			return PurgeService._strategies[jobDef.strategy](database, storage, jobCfg.days, jobDef.repo, resolvedConfig.s3).pipe(
				Effect.tap(logPurgeResult),
				Effect.tap(() => Metric.increment(Metric.taggedWithLabels(metrics.jobs.completions, labels))),
				Effect.tapError((error) => Effect.all([Effect.logError('Purge failed', { error: String(error), job: name }), Metric.increment(Metric.taggedWithLabels(metrics.jobs.failures, labels))], { discard: true })),
				Effect.asVoid, Telemetry.span(`jobs.${name}`, { metrics: false }),
			);
		}));
		static readonly _scheduledJobs = R.keys(_JOBS).filter((name) => _JOBS[name].cron !== null);
		static readonly Crons = Layer.unwrapEffect(
			Effect.orDie(_config).pipe(Effect.map((resolvedConfig) => Layer.mergeAll(
				...(PurgeService._scheduledJobs.map((name) => ClusterService.Schedule.cron({
					cron: Cron.unsafeParse(resolvedConfig.jobs[name].cron),
					execute: Effect.gen(function* () {
						const [jobs, database] = yield* Effect.all([JobService, DatabaseService]);
						const submitTenant = (tenantId: string) => Context.Request.withinSync(
							tenantId,
							jobs.submit(name, null),
							Context.Request.system(),
						).pipe(Effect.asVoid);
						const submitAllApps = database.apps.find([]).pipe(
							Effect.map(A.map((app) => app.id)),
							Effect.andThen(Effect.forEach(submitTenant, { discard: true }))
						);
						return yield* Match.value(_JOBS[name].scope).pipe(
							Match.when('global', () => submitTenant(Context.Request.Id.system)),
							Match.when('manual', () => Effect.void),
							Match.orElse(() => Context.Request.withinSync(Context.Request.Id.system, submitAllApps, Context.Request.system())),
						);
					}),
					name,
				})) as [Layer.Layer<never>, ...Layer.Layer<never>[]]),
			))),
		);
		static readonly SweepCron = ClusterService.Schedule.cron({
			cron: Cron.unsafeParse('0 3 * * *'),
			execute: Effect.gen(function* () {
				const [jobs, database, sql] = yield* Effect.all([JobService, DatabaseService, SqlClient.SqlClient]);
				const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
				const apps = yield* Context.Request.withinSync(Context.Request.Id.system, database.apps.find([]), Context.Request.system()).pipe(Effect.provideService(SqlClient.SqlClient, sql));
				const archived = A.filter(apps, (app) => app.status === 'archived' && app.updatedAt < thirtyDaysAgo);
				yield* Effect.forEach(archived, (app) => Context.Request.withinSync(
					app.id,
					jobs.submit('purge-tenant-data', null),
					Context.Request.system(),
				).pipe(Effect.asVoid), { discard: true });
			}),
			name: 'sweep-archived-tenants',
		});
	static readonly Handlers = Layer.effectDiscard(Effect.gen(function* () {
		const [jobs, database, storage, audit, metrics, sql] = yield* Effect.all([JobService, DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient]);
		const registerHandler = (name: keyof typeof _JOBS) => jobs.registerHandler(
			name,
			() => PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql))
		).pipe(Effect.andThen(Effect.logInfo(`Handler registered: ${name}`)));
		yield* Effect.forEach(R.keys(_JOBS), registerHandler, { discard: true });
	}));
	static readonly Layer = Layer.mergeAll(PurgeService.Crons, PurgeService.SweepCron, PurgeService.Handlers);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PurgeService {
	export type PurgeableRepo = typeof _JOBS[keyof typeof _JOBS]['repo'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { PurgeService };
