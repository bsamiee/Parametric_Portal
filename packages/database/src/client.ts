/**
 * PostgreSQL client layer with schema-aware Drizzle via Effect.Service pattern.
 * Enables relational query API (findFirst/findMany) with full type inference.
 */
import type { SqlClient } from '@effect/sql/SqlClient';
import type { SqlError } from '@effect/sql/SqlError';
import { make as makeDrizzle } from '@effect/sql-drizzle/Pg';
import { PgClient } from '@effect/sql-pg';
import { DurationMs, NonNegativeInt } from '@parametric-portal/types/types';
import type { ConfigError, Layer } from 'effect';
import { Config, Duration, Effect, Option, String as S } from 'effect';
import * as schema from './schema.ts';

// --- [TYPES] -----------------------------------------------------------------

type PoolConfig = {
    readonly connectTimeoutMs: DurationMs;
    readonly connectionTtlMs: DurationMs;
    readonly idleTimeoutMs: DurationMs;
    readonly max: NonNegativeInt;
    readonly min: NonNegativeInt;
};
type SslConfig = {
    readonly enabled: boolean;
    readonly rejectUnauthorized: boolean;
};
type TransformConfig = {
    readonly enabled: boolean;
    readonly json: boolean;
};
type PgClientLayer = Layer.Layer<SqlClient | PgClient.PgClient, SqlError | ConfigError.ConfigError, never>;

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
        connectionTtlMs: DurationMs.fromMillis(900000),
        connectTimeoutMs: DurationMs.fromMillis(5000),
        idleTimeoutMs: DurationMs.fromMillis(30000),
        max: NonNegativeInt.decodeSync(10),
        min: NonNegativeInt.decodeSync(2),
    } satisfies PoolConfig,
    spanAttributes: [
        ['service.name', 'database'],
        ['db.system', 'postgresql'],
    ] as const,
    ssl: {
        enabled: false,
        rejectUnauthorized: true,
    } satisfies SslConfig,
    transforms: {
        enabled: true,
        json: true,
    } satisfies TransformConfig,
} as const);

// --- [SERVICES] --------------------------------------------------------------

class Drizzle extends Effect.Service<Drizzle>()('database/Drizzle', {
    dependencies: [],
    effect: makeDrizzle({ schema }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const PgLive: PgClientLayer = PgClient.layerConfig({
    applicationName: Config.string('POSTGRES_APP_NAME').pipe(Config.withDefault(B.app.name)),
    connectionTTL: Config.integer('POSTGRES_CONNECTION_TTL_MS').pipe(
        Config.withDefault(B.pool.connectionTtlMs),
        Config.map(Duration.millis),
    ),
    connectTimeout: Config.integer('POSTGRES_CONNECT_TIMEOUT_MS').pipe(
        Config.withDefault(B.pool.connectTimeoutMs),
        Config.map(Duration.millis),
    ),
    database: Config.string('POSTGRES_DB').pipe(Config.withDefault(B.defaults.database)),
    host: Config.string('POSTGRES_HOST').pipe(Config.withDefault(B.defaults.host)),
    idleTimeout: Config.integer('POSTGRES_IDLE_TIMEOUT_MS').pipe(
        Config.withDefault(B.pool.idleTimeoutMs),
        Config.map(Duration.millis),
    ),
    maxConnections: Config.integer('POSTGRES_POOL_MAX').pipe(Config.withDefault(B.pool.max)),
    minConnections: Config.integer('POSTGRES_POOL_MIN').pipe(Config.withDefault(B.pool.min)),
    password: Config.redacted('POSTGRES_PASSWORD'),
    port: Config.integer('POSTGRES_PORT').pipe(Config.withDefault(B.defaults.port)),
    spanAttributes: Config.succeed(Object.fromEntries(B.spanAttributes)),
    ssl: Config.boolean('POSTGRES_SSL').pipe(
        Config.withDefault(B.ssl.enabled),
        Config.map((enabled) => (enabled ? { rejectUnauthorized: B.ssl.rejectUnauthorized } : undefined)),
    ),
    transformJson: Config.succeed(B.transforms.json),
    transformQueryNames: Config.boolean('POSTGRES_TRANSFORM_NAMES').pipe(
        Config.withDefault(B.transforms.enabled),
        Config.map((enabled) => (enabled ? S.camelToSnake : undefined)),
    ),
    transformResultNames: Config.boolean('POSTGRES_TRANSFORM_NAMES').pipe(
        Config.withDefault(B.transforms.enabled),
        Config.map((enabled) => (enabled ? S.snakeToCamel : undefined)),
    ),
    url: Config.redacted('DATABASE_URL').pipe(Config.option, Config.map(Option.getOrUndefined)),
    username: Config.string('POSTGRES_USER').pipe(Config.withDefault(B.defaults.username)),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as DATABASE_TUNING, Drizzle, PgLive };
export type { PgClientLayer, PoolConfig, SslConfig, TransformConfig };
