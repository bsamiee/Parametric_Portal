/**
 * Provide PostgreSQL 18.1 connection pooling via @effect/sql-pg.
 * Layer configuration, health check, statement statistics, tenant context for RLS.
 */
import { PgClient } from '@effect/sql-pg';
import { SqlClient } from '@effect/sql';
import { Config, Duration, Effect, Option, String as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	app: 		{ name: 'parametric-portal' },
	defaults: 	{ database: 'parametric', host: 'localhost', port: 5432, username: 'postgres' },
	durations: 	{ health: Duration.seconds(5) },
	pool: 		{ connectionTtlMs: 900_000, connectTimeoutMs: 5_000, idleTimeoutMs: 30_000, max: 10, min: 2 },
	spanAttributes: { 'db.system': 'postgresql', 'service.name': 'database' },
	ssl: 		{ enabled: false, rejectUnauthorized: true },
	stats: 		{ limit: 100 },
} as const;

// --- [LAYERS] ----------------------------------------------------------------

const _layer = PgClient.layerConfig({
	applicationName: Config.string('POSTGRES_APP_NAME').pipe(Config.withDefault(_CONFIG.app.name)),
	connectionTTL: Config.integer('POSTGRES_CONNECTION_TTL_MS').pipe(Config.withDefault(_CONFIG.pool.connectionTtlMs), Config.map(Duration.millis)),
	connectTimeout: Config.integer('POSTGRES_CONNECT_TIMEOUT_MS').pipe(Config.withDefault(_CONFIG.pool.connectTimeoutMs), Config.map(Duration.millis)),
	database: Config.string('POSTGRES_DB').pipe(Config.withDefault(_CONFIG.defaults.database)),
	host: Config.string('POSTGRES_HOST').pipe(Config.withDefault(_CONFIG.defaults.host)),
	idleTimeout: Config.integer('POSTGRES_IDLE_TIMEOUT_MS').pipe(Config.withDefault(_CONFIG.pool.idleTimeoutMs), Config.map(Duration.millis)),
	maxConnections: Config.integer('POSTGRES_POOL_MAX').pipe(Config.withDefault(_CONFIG.pool.max)),
	minConnections: Config.integer('POSTGRES_POOL_MIN').pipe(Config.withDefault(_CONFIG.pool.min)),
	password: Config.redacted('POSTGRES_PASSWORD'),
	port: Config.integer('POSTGRES_PORT').pipe(Config.withDefault(_CONFIG.defaults.port)),
	spanAttributes: Config.succeed(_CONFIG.spanAttributes),
	ssl: Config.boolean('POSTGRES_SSL').pipe(
		Config.withDefault(_CONFIG.ssl.enabled),
		Config.map((sslEnabled) => (sslEnabled ? { rejectUnauthorized: _CONFIG.ssl.rejectUnauthorized } : undefined)),
	),
	transformJson: Config.succeed(true),
	transformQueryNames: Config.succeed(S.camelToSnake),
	transformResultNames: Config.succeed(S.snakeToCamel),
	url: Config.redacted('DATABASE_URL').pipe(Config.option, Config.map(Option.getOrUndefined)),
	username: Config.string('POSTGRES_USER').pipe(Config.withDefault(_CONFIG.defaults.username)),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _setTenant = (appId: string) => Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient;
	yield* sql`SELECT set_config('app.current_tenant', ${appId}, true)`;
});

// --- [OBJECT] ----------------------------------------------------------------

const Client = (<const T>(t: T) => t)({
	config: _CONFIG,
	health: Effect.fn('db.checkHealth')(function* () {			// Quick health check: tests connection availability. Use for liveness probes. Does not test transaction capability.
		const sql = yield* SqlClient.SqlClient;
		const [duration, healthy] = yield* sql`SELECT 1`.pipe(
			Effect.as(true),
			Effect.timeout(_CONFIG.durations.health),
			Effect.catchAll(() => Effect.succeed(false)),
			Effect.timed,
		);
		return { healthy, latencyMs: Duration.toMillis(duration) };
	}),
	healthDeep: Effect.fn('db.checkHealthDeep')(function* () {	// Deep health check: tests transaction capability. Use for readiness probes. Catches connection pool exhaustion.
		const sql = yield* SqlClient.SqlClient;
		const [duration, healthy] = yield* sql.withTransaction(sql`SELECT 1`).pipe(
			Effect.as(true),
			Effect.timeout(_CONFIG.durations.health),
			Effect.catchAll(() => Effect.succeed(false)),
			Effect.timed,
		);
		return { healthy, latencyMs: Duration.toMillis(duration) };
	}),
	layer: _layer,
	lock: {					/** Advisory locks for distributed coordination. Use xact variants with connection pooling. */
		acquire: (key: bigint) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; yield* sql`SELECT pg_advisory_xact_lock(${key})`; }),
		session: { 			/** Session-scoped locks (requires explicit release, use with caution in pooled connections) */
			acquire: (key: bigint) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; yield* sql`SELECT pg_advisory_lock(${key})`; }),
			release: (key: bigint) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; const [r] = yield* sql<{ released: boolean }>`SELECT pg_advisory_unlock(${key}) AS released`; return r?.released ?? false; }),
			try: (key: bigint) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; const [r] = yield* sql<{ acquired: boolean }>`SELECT pg_try_advisory_lock(${key}) AS acquired`; return r?.acquired ?? false; }),
		},
		try: (key: bigint) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; const [r] = yield* sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(${key}) AS acquired`; return r?.acquired ?? false; }),
	},
	monitoring: {			/** PG18.1 pg_stat_io observability functions. */
		cacheHitRatio: Effect.fn('db.cacheHitRatio')(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ cacheHitRatio: number; hits: bigint; ioContext: string; ioObject: string; reads: bigint }>`SELECT * FROM get_io_cache_hit_ratio()`;
		}),
		ioConfig: Effect.fn('db.ioConfig')(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ name: string; setting: string }>`SELECT name, setting FROM pg_settings WHERE name IN ('io_method', 'io_workers', 'effective_io_concurrency', 'io_combine_limit')`;
		}),
		ioStats: Effect.fn('db.ioStats')(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ backendType: string; blksExtended: bigint; blksHit: bigint; blksRead: bigint; blksWritten: bigint; ioContext: string; ioObject: string; statsReset: Date | null }>`SELECT * FROM get_io_stats_by_backend()`;
		}),
	},
	notify: (channel: string, payload?: string) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; yield* payload ? sql`SELECT pg_notify(${channel}, ${payload})` : sql`NOTIFY ${sql.literal(channel)}`; }),
	statements: Effect.fn('db.listStatStatements')((limit: number = _CONFIG.stats.limit) =>
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql`SELECT * FROM pg_stat_statements LIMIT ${limit}`;
		}),
	),
	tenant: { 				/** RLS policy - SET LOCAL (3rd param = true) for transaction-scoped isolation with connection pooling. */
		set: _setTenant,	/** Set tenant context for current transaction. RLS policies read this via current_setting(). */
		with: <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) => Effect.gen(function* () { /** Execute effect within tenant context. Wraps in transaction with SET LOCAL. */
			const sql = yield* SqlClient.SqlClient;
			return yield* sql.withTransaction(_setTenant(appId).pipe(Effect.andThen(effect)));
		}),
	},
	vector: {				/** pgvector 0.8+ HNSW configuration for filtered vector queries. */
		configureIterativeScan: (mode: 'relaxed_order' | 'strict_order' | 'off' = 'relaxed_order') => Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			yield* sql`SET hnsw.iterative_scan = ${mode}`;
		}),
		getConfig: Effect.fn('db.vectorConfig')(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ name: string; setting: string }>`SELECT name, setting FROM pg_settings WHERE name LIKE 'hnsw.%'`;
		}),
		indexStats: (tableName: string, indexName: string) => Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ idxScan: bigint; idxTupFetch: bigint; idxTupRead: bigint }>`SELECT idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE relname = ${tableName} AND indexrelname = ${indexName}`;
		}),
	},
});

// --- [EXPORT] ----------------------------------------------------------------

export { Client };
