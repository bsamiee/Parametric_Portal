/**
 * PostgreSQL 18.1 client layer with schema-aware Drizzle via Effect.Service pattern.
 * Enables relational query API (findFirst/findMany) with full type inference.
 *
 * Session timeouts (statement_timeout, idle_in_transaction_session_timeout) are
 * configured via DATABASE_URL options parameter or PostgreSQL server config:
 * - URL: postgres://...?options=-c statement_timeout=30000 -c idle_in_transaction_session_timeout=300000
 * - Server: ALTER SYSTEM SET statement_timeout = '30s';
 */
import { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { make as makeDrizzle } from '@effect/sql-drizzle/Pg';
import { PgClient } from '@effect/sql-pg';
import * as schema from '@parametric-portal/types/schema';
import { DurationMs, NonNegativeInt } from '@parametric-portal/types/types';
import { MetricsService, type PoolStats } from '@parametric-portal/server/metrics';
import { Config, type ConfigError, Duration, Effect, type Fiber, Layer, Option, pipe, Schedule, String as S, type Stream } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type PoolConfig = { readonly connectTimeoutMs: DurationMs; readonly connectionTtlMs: DurationMs; readonly idleTimeoutMs: DurationMs; readonly max: NonNegativeInt; readonly min: NonNegativeInt };
type SslConfig = { readonly enabled: boolean; readonly rejectUnauthorized: boolean };
type TransformConfig = { readonly enabled: boolean; readonly json: boolean };
type PgClientLayer = Layer.Layer<SqlClient | PgClient.PgClient, SqlError | ConfigError.ConfigError, never>;
type HealthStatus = { readonly database: boolean; readonly pool: boolean; readonly ready: boolean };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    app: { name: 'parametric-portal' },
    defaults: { database: 'parametric', host: 'localhost', port: 5432, username: 'postgres' },
    durations: { healthTimeout: Duration.seconds(5), poolReserveTimeout: Duration.millis(100), queryTimeout: Duration.seconds(30) },
    monitoring: {
        enabled: process.env['POOL_MONITORING_ENABLED'] !== 'false',
        intervalMs: Number.parseInt(process.env['POOL_MONITORING_INTERVAL_MS'] ?? '60000', 10),
        minIntervalMs: 10000,
    },
    pool: { connectionTtlMs: DurationMs.fromMillis(900000), connectTimeoutMs: DurationMs.fromMillis(5000), idleTimeoutMs: DurationMs.fromMillis(30000), max: NonNegativeInt.decodeSync(10), min: NonNegativeInt.decodeSync(2) } satisfies PoolConfig,
    retry: {
        query: Schedule.exponential(Duration.millis(50)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))),
        startup: Schedule.exponential(Duration.seconds(1)).pipe(Schedule.jittered, Schedule.upTo(Duration.minutes(2))),
    },
    spanAttributes: [['service.name', 'database'], ['db.system', 'postgresql']] as const,
    ssl: { enabled: false, rejectUnauthorized: true } satisfies SslConfig,
    transforms: { enabled: true, json: true } satisfies TransformConfig,
} as const);

// --- [SERVICES] --------------------------------------------------------------

class Drizzle extends Effect.Service<Drizzle>()('database/Drizzle', { dependencies: [], effect: makeDrizzle({ schema }) }) {}
class Database extends Effect.Service<Database>()('database/Database', {
    dependencies: [],
    effect: Effect.gen(function* () {
        const drizzle = yield* Drizzle, pgClient = yield* PgClient.PgClient, sqlClient = yield* SqlClient;
        return { drizzle, listen: (ch: string): Stream.Stream<string, SqlError> => pgClient.listen(ch), notify: (ch: string, p: string): Effect.Effect<void, SqlError> => pgClient.notify(ch, p), pgClient, sqlClient };
    }),
}) {}

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const configBuilders = Object.freeze({
    bool: (k: string, f: boolean) => Config.boolean(k).pipe(Config.withDefault(f)),
    boolXform: (k: string, f: boolean, fn: ((s: string) => string) | undefined) => Config.boolean(k).pipe(Config.withDefault(f), Config.map((e) => (e ? fn : undefined))),
    int: (k: string, f: number) => Config.integer(k).pipe(Config.withDefault(f)),
    intMs: (k: string, f: number) => Config.integer(k).pipe(Config.withDefault(f), Config.map(Duration.millis)),
    ssl: (k: string, defaults: SslConfig) => Config.boolean(k).pipe(Config.withDefault(defaults.enabled), Config.map((e) => (e ? { rejectUnauthorized: defaults.rejectUnauthorized } : undefined))),
    str: (k: string, f: string) => Config.string(k).pipe(Config.withDefault(f)),
} as const);
const checkHealth: Effect.Effect<HealthStatus, never, SqlClient> = Effect.gen(function* () {
    const sql = yield* SqlClient;
    const database = yield* sql`SELECT 1`.pipe(Effect.as(true), Effect.timeout(B.durations.healthTimeout), Effect.catchAll(() => Effect.succeed(false)));
    const pool = yield* sql.reserve.pipe(Effect.flatMap((c) => c.execute('SELECT 1', [], undefined)), Effect.scoped, Effect.as(true), Effect.timeout(B.durations.poolReserveTimeout), Effect.catchAll(() => Effect.succeed(false)));
    return { database, pool, ready: database && pool };
});
const queryPoolStats: Effect.Effect<PoolStats, SqlError, SqlClient> = pipe(
    SqlClient,
    Effect.flatMap((sql) =>
        sql<{ active: number; idle: number; total: number; waiting: number }>`
            SELECT
                COALESCE(SUM(CASE WHEN state != 'idle' AND state IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS active,
                COALESCE(SUM(CASE WHEN state = 'idle' THEN 1 ELSE 0 END), 0)::int AS idle,
                COUNT(*)::int AS total,
                COALESCE(SUM(CASE WHEN wait_event_type IS NOT NULL OR state = 'idle in transaction' THEN 1 ELSE 0 END), 0)::int AS waiting
            FROM pg_stat_activity
            WHERE application_name = ${B.app.name}
              AND pid != pg_backend_pid()
        `.pipe(Effect.map((rows) => rows[0] ?? { active: 0, idle: 0, total: 0, waiting: 0 })),
    ),
);
const startPoolMonitoring: Effect.Effect<Fiber.RuntimeFiber<void, never>, never, MetricsService | SqlClient> =
    B.monitoring.enabled
        ? pipe(
              Effect.logInfo('Pool monitoring started', { intervalMs: Math.max(B.monitoring.intervalMs, B.monitoring.minIntervalMs) }),
              Effect.andThen(
                  pipe(
                      queryPoolStats,
                      Effect.flatMap(MetricsService.trackPoolStats),
                      Effect.catchAll(() => Effect.void),
                      Effect.repeat(Schedule.spaced(Duration.millis(Math.max(B.monitoring.intervalMs, B.monitoring.minIntervalMs)))),
                      Effect.asVoid,
                      Effect.forkDaemon,
                  ),
              ),
          )
        : pipe(
              Effect.logInfo('Pool monitoring disabled'),
              Effect.andThen(Effect.forkDaemon(Effect.void)),
          );

// --- [LAYERS] ----------------------------------------------------------------

const PgLive: PgClientLayer = PgClient.layerConfig({
    applicationName: configBuilders.str('POSTGRES_APP_NAME', B.app.name),
    connectionTTL: configBuilders.intMs('POSTGRES_CONNECTION_TTL_MS', B.pool.connectionTtlMs),
    connectTimeout: configBuilders.intMs('POSTGRES_CONNECT_TIMEOUT_MS', B.pool.connectTimeoutMs),
    database: configBuilders.str('POSTGRES_DB', B.defaults.database),
    host: configBuilders.str('POSTGRES_HOST', B.defaults.host),
    idleTimeout: configBuilders.intMs('POSTGRES_IDLE_TIMEOUT_MS', B.pool.idleTimeoutMs),
    maxConnections: configBuilders.int('POSTGRES_POOL_MAX', B.pool.max),
    minConnections: configBuilders.int('POSTGRES_POOL_MIN', B.pool.min),
    password: Config.redacted('POSTGRES_PASSWORD'),
    port: configBuilders.int('POSTGRES_PORT', B.defaults.port),
    spanAttributes: Config.succeed(Object.fromEntries(B.spanAttributes)),
    ssl: configBuilders.ssl('POSTGRES_SSL', B.ssl),
    transformJson: Config.succeed(B.transforms.json),
    transformQueryNames: configBuilders.boolXform('POSTGRES_TRANSFORM_NAMES', B.transforms.enabled, S.camelToSnake),
    transformResultNames: configBuilders.boolXform('POSTGRES_TRANSFORM_NAMES', B.transforms.enabled, S.snakeToCamel),
    url: Config.redacted('DATABASE_URL').pipe(Config.option, Config.map(Option.getOrUndefined)),
    username: configBuilders.str('POSTGRES_USER', B.defaults.username),
});
const PgLiveWithRetry: PgClientLayer = PgLive.pipe(Layer.retry(B.retry.startup));

// --- [EXPORT] ----------------------------------------------------------------

export { B as DATABASE_TUNING, checkHealth, Database, Drizzle, PgLive, PgLiveWithRetry, queryPoolStats, startPoolMonitoring };
export type { HealthStatus, PgClientLayer, PoolConfig, SslConfig, TransformConfig };
