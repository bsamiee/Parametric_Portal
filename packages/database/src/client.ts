/**
 * Provide PostgreSQL 18.1 connection pooling via @effect/sql-pg.
 * Layer configuration, health check, statement statistics, tenant context for RLS.
 */
import { PgClient } from '@effect/sql-pg';
import { SqlClient } from '@effect/sql';
import { readFileSync } from 'node:fs';
import type { SecureVersion } from 'node:tls';
import { Config, Duration, Effect, Layer, Option, Schema as Sch, Stream, String as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _HEALTH_TIMEOUT = Duration.seconds(5);
const _mergePgOptions = (raw: string | undefined, next: ReadonlyArray<readonly [string, number]>) => [
	...new Map<string, string>([
		...(((raw ?? '').match(/-c\s+[^ ]+/g) ?? [])
			.map((token) => token.replace(/^-c\s+/, '').split('=', 2))
			.filter((parts): parts is [string, string] => (parts[0] ?? '') !== '' && (parts[1] ?? '') !== '')
			.map(([key, value]) => [key, value] as const)),
		...next.map(([key, value]) => [key, String(value)] as const),
	]).entries(),
].map(([key, value]) => `-c ${key}=${value}`).join(' ');

// --- [LAYERS] ----------------------------------------------------------------

const _sslConfig = Config.all({
	caPath: 					Config.string('POSTGRES_SSL_CA').pipe(Config.option),
	certPath: 					Config.string('POSTGRES_SSL_CERT').pipe(Config.option),
	enabled: 					Config.boolean('POSTGRES_SSL').pipe(Config.withDefault(false)),
	keyPath: 					Config.string('POSTGRES_SSL_KEY').pipe(Config.option),
	minVersion: 				Config.string('POSTGRES_SSL_MIN_VERSION').pipe(Config.withDefault('TLSv1.2')),
	rejectUnauthorized: 		Config.boolean('POSTGRES_SSL_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
	servername: 				Config.string('POSTGRES_SSL_SERVERNAME').pipe(Config.option),
}).pipe(Config.mapAttempt(({ caPath, certPath, enabled, keyPath, minVersion, rejectUnauthorized, servername }) =>
	enabled ? {
		ca: 					Option.getOrUndefined(Option.map(caPath, (path) => readFileSync(path, 'utf8'))),
		cert: 					Option.getOrUndefined(Option.map(certPath, (path) => readFileSync(path, 'utf8'))),
		key: 					Option.getOrUndefined(Option.map(keyPath, (path) => readFileSync(path, 'utf8'))),
		minVersion: 			minVersion as SecureVersion,
		rejectUnauthorized,
		servername: 			Option.getOrUndefined(servername),
	} : undefined,
));
const _layer = Layer.unwrapEffect(Effect.gen(function* () {
	const timeouts = yield* Config.all({
		idleInTransactionMs: 	Config.integer('POSTGRES_IDLE_IN_TXN_TIMEOUT_MS').pipe(Config.withDefault(60_000)),
		lockMs: 				Config.integer('POSTGRES_LOCK_TIMEOUT_MS').pipe(Config.withDefault(10_000)),
		statementMs: 			Config.integer('POSTGRES_STATEMENT_TIMEOUT_MS').pipe(Config.withDefault(30_000)),
		transactionMs: 			Config.integer('POSTGRES_TRANSACTION_TIMEOUT_MS').pipe(Config.withDefault(120_000)),
	});
	process.env['PGOPTIONS'] = _mergePgOptions(process.env['PGOPTIONS'], [
		['statement_timeout', timeouts.statementMs],
		['lock_timeout', timeouts.lockMs],
		['idle_in_transaction_session_timeout', timeouts.idleInTransactionMs],
		['transaction_timeout', timeouts.transactionMs],
	]);
	return PgClient.layerConfig({
		applicationName: 		Config.string('POSTGRES_APP_NAME').pipe(Config.withDefault('parametric-portal')),
		connectionTTL: 			Config.integer('POSTGRES_CONNECTION_TTL_MS').pipe(Config.withDefault(900_000), Config.map(Duration.millis)),
		connectTimeout: 		Config.integer('POSTGRES_CONNECT_TIMEOUT_MS').pipe(Config.withDefault(5_000), Config.map(Duration.millis)),
		database: 				Config.string('POSTGRES_DB').pipe(Config.withDefault('parametric')),
		host: 					Config.string('POSTGRES_HOST').pipe(Config.withDefault('localhost')),
		idleTimeout: 			Config.integer('POSTGRES_IDLE_TIMEOUT_MS').pipe(Config.withDefault(30_000), Config.map(Duration.millis)),
		maxConnections: 		Config.integer('POSTGRES_POOL_MAX').pipe(Config.withDefault(10)),
		minConnections: 		Config.integer('POSTGRES_POOL_MIN').pipe(Config.withDefault(2)),
		password: 				Config.redacted('POSTGRES_PASSWORD').pipe(Config.option, Config.map(Option.getOrUndefined)),
		port: 					Config.integer('POSTGRES_PORT').pipe(Config.withDefault(5432)),
		spanAttributes: 		Config.succeed({ 'service.name': 'database' }),
		ssl: 					_sslConfig,
		transformJson: 			Config.succeed(true),
		transformQueryNames: 	Config.succeed(S.camelToSnake),
		transformResultNames: 	Config.succeed(S.snakeToCamel),
		url: 					Config.redacted('DATABASE_URL').pipe(Config.option, Config.map(Option.getOrUndefined)),
		username: 				Config.string('POSTGRES_USER').pipe(Config.withDefault('postgres')),
	});
}));
const _sqlFn = <A, E>(query: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) => Effect.gen(function* () { const sql = yield* SqlClient.SqlClient; return yield* query(sql); });

// --- [OBJECT] ----------------------------------------------------------------

const Client = {
	health: Effect.fn('db.checkHealth')(function* () {
		const sql = yield* SqlClient.SqlClient;
		const [duration, healthy] = yield* sql`SELECT 1`.pipe(Effect.as(true), Effect.timeout(_HEALTH_TIMEOUT), Effect.catchAll(() => Effect.succeed(false)), Effect.timed);
		return { healthy, latencyMs: Duration.toMillis(duration) };
	}),
	healthDeep: Effect.fn('db.checkHealthDeep')(function* () {
		const sql = yield* SqlClient.SqlClient;
		const [duration, healthy] = yield* sql.withTransaction(sql`SELECT 1`).pipe(Effect.as(true), Effect.timeout(_HEALTH_TIMEOUT), Effect.catchAll(() => Effect.succeed(false)), Effect.timed);
		return { healthy, latencyMs: Duration.toMillis(duration) };
	}),
	layer: _layer,
	listen: {
		raw: (channel: string) => Stream.unwrap(Effect.map(PgClient.PgClient, (pgClient) => pgClient.listen(channel))),
		typed: <A, I>(channel: string, schema: Sch.Schema<A, I, never>) =>
			Stream.unwrap(Effect.map(PgClient.PgClient, (pgClient) => pgClient.listen(channel).pipe(
				Stream.mapEffect((payload) => Sch.decode(Sch.parseJson(schema))(payload).pipe(Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY decode failed', { channel, error: String(error) })), Effect.option)),
				Stream.filterMap((decoded) => decoded),
			))),
	},
	lock: {
		acquire: (key: bigint) => _sqlFn((sql) => sql`SELECT pg_advisory_xact_lock(${key})`),
		session: {
			acquire: (key: bigint) => _sqlFn((sql) => sql`SELECT pg_advisory_lock(${key})`),
			release: (key: bigint) => _sqlFn((sql) => sql<{ released: boolean }>`SELECT pg_advisory_unlock(${key}) AS released`.pipe(Effect.map(([r]) => r?.released ?? false))),
			try: (key: bigint) => _sqlFn((sql) => sql<{ acquired: boolean }>`SELECT pg_try_advisory_lock(${key}) AS acquired`.pipe(Effect.map(([r]) => r?.acquired ?? false))),
		},
		try: (key: bigint) => _sqlFn((sql) => sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(${key}) AS acquired`.pipe(Effect.map(([r]) => r?.acquired ?? false))),
	},
		notify: (channel: string, payload: string) => _sqlFn((sql) => sql`SELECT pg_notify(${channel}, ${payload})`),
	statements: Effect.fn('db.listStatStatements')((limit = 100) => _sqlFn((sql) => sql`SELECT * FROM pg_stat_statements LIMIT ${limit}`)),
		tenant: {
			with: <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) => Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				return yield* sql.withTransaction(sql`SELECT set_config('app.current_tenant', ${appId}, true)`.pipe(Effect.andThen(effect), Effect.provideService(SqlClient.SqlClient, sql)));
			}),
	},
	vector: {
		configureIterativeScan: (mode: 'relaxed_order' | 'strict_order' | 'off' = 'relaxed_order') => _sqlFn((sql) => sql`SET hnsw.iterative_scan = ${mode}`),
		getConfig: Effect.fn('db.vectorConfig')(function* () {
			const sql = yield* SqlClient.SqlClient;
			return yield* sql<{ name: string; setting: string }>`SELECT name, setting FROM pg_settings WHERE name LIKE 'hnsw.%'`;
		}),
		indexStats: (tableName: string, indexName: string) => _sqlFn((sql) => sql<{ idxScan: bigint; idxTupFetch: bigint; idxTupRead: bigint }>`SELECT idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE relname = ${tableName} AND indexrelname = ${indexName}`),
	},
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export { Client };
