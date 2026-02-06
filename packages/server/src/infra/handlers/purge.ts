/**
 * Polymorphic purge handlers for all soft-deletable entities.
 * Single config, single dispatch, unified cron+handler registration.
 */
import { DatabaseService } from '@parametric-portal/database/repos';
import { SqlClient } from '@effect/sql';
import { Array as A, Cron, Effect, Layer, Metric, Option, Record as R } from 'effect';
import { AuditService } from '../../observe/audit.ts';
import { MetricsService } from '../../observe/metrics.ts';
import { Telemetry } from '../../observe/telemetry.ts';
import { StorageService } from '../../domain/storage.ts';
import { JobService } from '../jobs.ts';
import { Context } from '../../context.ts';
import { ClusterService } from '../cluster.ts';

// --- [SERVICE] ---------------------------------------------------------------

class PurgeService extends Effect.Service<PurgeService>()('server/Purge', {
	effect: Effect.gen(function* () {
		const [database, storage, audit, metrics, sql] = yield* Effect.all([
			DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient,
		]);
		return {
			execute: (name: keyof typeof PurgeService._Config.jobs) =>
				PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql),),
		};
	}),
}) {
	static readonly _Config = {
		jobs: {
			'purge-api-keys': 		{ cron: '0 3 * * 0', 	days: 365, 	repo: 'apiKeys' as const, 		strategy: 'db-only' as const 	},
			'purge-assets': 		{ cron: '0 */6 * * *', 	days: 30, 	repo: 'assets' as const, 		strategy: 'db-and-s3' as const 	},
			'purge-event-journal': 	{ cron: '0 2 * * *', 	days: 30, 	repo: 'eventJournal' as const, 	strategy: 'db-only' as const 	},
			'purge-job-dlq': 		{ cron: '0 2 * * *', 	days: 30, 	repo: 'jobDlq' as const, 		strategy: 'db-only' as const 	},
			'purge-kv-store': 		{ cron: '0 0 * * 0', 	days: 90, 	repo: 'kvStore' as const, 		strategy: 'db-only' as const 	},
			'purge-mfa-secrets': 	{ cron: '0 4 * * 0', 	days: 90, 	repo: 'mfaSecrets' as const, 	strategy: 'db-only' as const 	},
			'purge-oauth-accounts': { cron: '0 5 * * 0', 	days: 90, 	repo: 'oauthAccounts' as const, strategy: 'db-only' as const 	},
			'purge-sessions': 		{ cron: '0 1 * * *', 	days: 30, 	repo: 'sessions' as const, 		strategy: 'db-only' as const 	},
		},
		s3: { batchSize: 100, concurrency: 2 },
	} as const;
	static readonly _strategies = {
		'db-and-s3': (database: DatabaseService.Type, storage: typeof StorageService.Service, days: number, _repo: PurgeService.PurgeableRepo) =>
			database.assets.findStaleForPurge(days).pipe(
				Effect.flatMap((assets) => Effect.forEach(
					A.chunksOf(A.filterMap(assets, (asset) => Option.fromNullable(asset.storageRef)), PurgeService._Config.s3.batchSize),
					(batch) => storage.remove(batch).pipe(
						Effect.as({ deleted: batch.length, failed: 0 }),
						Effect.tapError((error) => Effect.logWarning('S3 batch delete failed', { error: String(error), keys: batch.length })),
						Effect.orElseSucceed(() => ({ deleted: 0, failed: batch.length })),
					),
					{ concurrency: PurgeService._Config.s3.concurrency },
				)),
				Effect.map((results) => A.reduce(results, { deleted: 0, failed: 0 }, (acc, result) => ({ deleted: acc.deleted + result.deleted, failed: acc.failed + result.failed }))),
				Effect.flatMap((s3) => database.assets.purge(days).pipe(
					Effect.orElseSucceed(() => 0),
					Effect.map((dbPurged) => ({ dbPurged, s3Deleted: s3.deleted, s3Failed: s3.failed })),
				)),
			),
		'db-only': (database: DatabaseService.Type, _storage: typeof StorageService.Service, days: number, repo: PurgeService.PurgeableRepo) =>
			database[repo].purge(days).pipe(
				Effect.orElseSucceed(() => 0),
				Effect.map((dbPurged) => ({ dbPurged, s3Deleted: 0, s3Failed: 0 })),
			),
	} as const;
	static readonly _execute = (name: keyof typeof PurgeService._Config.jobs, database: DatabaseService.Type, storage: typeof StorageService.Service, audit: typeof AuditService.Service, metrics: MetricsService) => {
		const config = PurgeService._Config.jobs[name];
		const labels = MetricsService.label({ job_name: name });
		const purgeEffect = PurgeService._strategies[config.strategy](database, storage, config.days, config.repo);
		return purgeEffect.pipe(
			Effect.tap((details) => details.dbPurged + details.s3Deleted === 0
				? Effect.logInfo('No records to purge', { job: name })
				: Effect.all([
					audit.log(`Job.${name}`, { details: { ...details, retentionDays: config.days }, subjectId: name }),
					Effect.logInfo('Purge completed', { job: name, ...details, retentionDays: config.days }),
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
		};
	static readonly Crons = Layer.mergeAll(
		...(R.keys(PurgeService._Config.jobs).map((name) =>
			ClusterService.cron({
				cron: Cron.unsafeParse(PurgeService._Config.jobs[name].cron),
				execute: JobService.pipe(Effect.flatMap((jobs) => Context.Request.withinSync(Context.Request.Id.system, jobs.submit(name, null), Context.Request.system()),)),
				name,
			}),
		) as [Layer.Layer<never>, ...Layer.Layer<never>[]]),
	);
	static readonly Handlers = Layer.effectDiscard(Effect.gen(function* () {
		const [jobs, database, storage, audit, metrics, sql] = yield* Effect.all([JobService, DatabaseService, StorageService, AuditService, MetricsService, SqlClient.SqlClient]);
		yield* Effect.forEach(R.keys(PurgeService._Config.jobs), (name) =>
			jobs.registerHandler(name, () => PurgeService._execute(name, database, storage, audit, metrics).pipe(Effect.provideService(SqlClient.SqlClient, sql))).pipe(
				Effect.tap(() => Effect.logInfo(`Handler registered: ${name}`)),
			),
			{ discard: true },
		);
	}));
	static readonly Layer = Layer.mergeAll(PurgeService.Crons, PurgeService.Handlers);
}

// --- [NAMESPACE] -------------------------------------------------------------

namespace PurgeService {
	export type PurgeableRepo = typeof PurgeService._Config.jobs[keyof typeof PurgeService._Config.jobs]['repo'];
}

// --- [EXPORT] ----------------------------------------------------------------

export { PurgeService };
