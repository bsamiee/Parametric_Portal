/**
 * Provide PostgreSQL client layer with connection pooling via @effect/sql-pg.
 */
import type { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { PgClient } from '@effect/sql-pg';
import { Config, type ConfigError, Duration, type Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type PoolConfig = {
    readonly connectTimeoutMs: number;
    readonly connectionTtlMs: number;
    readonly idleTimeoutMs: number;
    readonly max: number;
    readonly min: number;
};

type SslConfig = {
    readonly enabled: boolean;
    readonly rejectUnauthorized: boolean;
};

type TransformConfig = {
    readonly enabled: boolean;
};

type PgClientLayer = Layer.Layer<SqlClient, SqlError | ConfigError.ConfigError, never>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    app: {
        name: 'parametric-portal',
    },
    defaults: {
        database: 'parametric',
        host: 'localhost',
        port: 5432,
        username: 'postgres',
    },
    pool: {
        connectionTtlMs: 900000,
        connectTimeoutMs: 5000,
        idleTimeoutMs: 30000,
        max: 10,
        min: 2,
    } satisfies PoolConfig,
    ssl: {
        enabled: false,
        rejectUnauthorized: true,
    } satisfies SslConfig,
    transforms: {
        enabled: true,
    } satisfies TransformConfig,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const snakeToCamel = (s: string): string => s.replaceAll(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const camelToSnake = (s: string): string => s.replaceAll(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// --- [LAYERS] ----------------------------------------------------------------

const PgLive: PgClientLayer = PgClient.layerConfig({
    applicationName: pipe(Config.string('POSTGRES_APP_NAME'), Config.withDefault(B.app.name)),
    connectionTTL: pipe(
        Config.integer('POSTGRES_CONNECTION_TTL_MS'),
        Config.withDefault(B.pool.connectionTtlMs),
        Config.map(Duration.millis),
    ),
    connectTimeout: pipe(
        Config.integer('POSTGRES_CONNECT_TIMEOUT_MS'),
        Config.withDefault(B.pool.connectTimeoutMs),
        Config.map(Duration.millis),
    ),
    database: pipe(Config.string('POSTGRES_DB'), Config.withDefault(B.defaults.database)),
    host: pipe(Config.string('POSTGRES_HOST'), Config.withDefault(B.defaults.host)),
    idleTimeout: pipe(
        Config.integer('POSTGRES_IDLE_TIMEOUT_MS'),
        Config.withDefault(B.pool.idleTimeoutMs),
        Config.map(Duration.millis),
    ),
    maxConnections: pipe(Config.integer('POSTGRES_POOL_MAX'), Config.withDefault(B.pool.max)),
    minConnections: pipe(Config.integer('POSTGRES_POOL_MIN'), Config.withDefault(B.pool.min)),
    password: Config.redacted('POSTGRES_PASSWORD'),
    port: pipe(Config.integer('POSTGRES_PORT'), Config.withDefault(B.defaults.port)),
    ssl: pipe(
        Config.boolean('POSTGRES_SSL'),
        Config.withDefault(B.ssl.enabled),
        Config.map((enabled) => (enabled ? { rejectUnauthorized: B.ssl.rejectUnauthorized } : undefined)),
    ),
    transformQueryNames: pipe(
        Config.boolean('POSTGRES_TRANSFORM_NAMES'),
        Config.withDefault(B.transforms.enabled),
        Config.map((enabled) => (enabled ? camelToSnake : undefined)),
    ),
    transformResultNames: pipe(
        Config.boolean('POSTGRES_TRANSFORM_NAMES'),
        Config.withDefault(B.transforms.enabled),
        Config.map((enabled) => (enabled ? snakeToCamel : undefined)),
    ),
    username: pipe(Config.string('POSTGRES_USER'), Config.withDefault(B.defaults.username)),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as DATABASE_TUNING, camelToSnake, PgLive, snakeToCamel };
export type { PgClientLayer, PoolConfig, SslConfig, TransformConfig };
