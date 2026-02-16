/**
 * Provide PostgreSQL 18.2 connection pooling via @effect/sql-pg.
 * Layer configuration, health check, statement statistics, tenant context for RLS.
 */
import { PgClient } from '@effect/sql-pg';
import { SqlClient } from '@effect/sql';
import { readFileSync } from 'node:fs';
import type { SecureVersion } from 'node:tls';
import { Config, Duration, Effect, FiberRef, Function as F, Layer, Match, Option, Redacted, Schema as Sch, Stream, String as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    health: { timeout: Duration.seconds(5) },
    pgOptions: {
        extractPattern: /-c\s+[^ ]+/g,
        replacePattern: /^-c\s+/,
        timeouts: [
            ['statement_timeout', 'statementMs'],
            ['lock_timeout', 'lockMs'],
            ['idle_in_transaction_session_timeout', 'idleInTransactionMs'],
            ['transaction_timeout', 'transactionMs'],
        ] as const,
        trigramThresholds: [
            ['POSTGRES_TRGM_SIMILARITY_THRESHOLD', 'pg_trgm.similarity_threshold', 0.3],
            ['POSTGRES_TRGM_WORD_SIMILARITY_THRESHOLD', 'pg_trgm.word_similarity_threshold', 0.6],
            ['POSTGRES_TRGM_STRICT_WORD_SIMILARITY_THRESHOLD', 'pg_trgm.strict_word_similarity_threshold', 0.5],
        ] as const,
    },
    tenant: {id: {system: '00000000-0000-7000-8000-000000000000', unspecified: '00000000-0000-7000-8000-ffffffffffff',} as const,},
} as const;

// --- [LAYERS] ----------------------------------------------------------------

const _sslConfig = Config.all({
    caPath:                     Config.string('POSTGRES_SSL_CA').pipe(Config.option),
    certPath:                   Config.string('POSTGRES_SSL_CERT').pipe(Config.option),
    enabled:                    Config.boolean('POSTGRES_SSL').pipe(Config.withDefault(false)),
    keyPath:                    Config.string('POSTGRES_SSL_KEY').pipe(Config.option),
    minVersion:                 Config.string('POSTGRES_SSL_MIN_VERSION').pipe(Config.withDefault('TLSv1.2')),
    rejectUnauthorized:         Config.boolean('POSTGRES_SSL_REJECT_UNAUTHORIZED').pipe(Config.withDefault(true)),
    servername:                 Config.string('POSTGRES_SSL_SERVERNAME').pipe(Config.option),
}).pipe(Config.mapAttempt(({ caPath, certPath, enabled, keyPath, minVersion, rejectUnauthorized, servername }) =>
    enabled ? {
        ca:                     Option.getOrUndefined(Option.map(caPath, (path) => readFileSync(path, 'utf8'))),
        cert:                   Option.getOrUndefined(Option.map(certPath, (path) => readFileSync(path, 'utf8'))),
        key:                    Option.getOrUndefined(Option.map(keyPath, (path) => readFileSync(path, 'utf8'))),
        minVersion:             minVersion as SecureVersion,
        rejectUnauthorized,
        servername:             Option.getOrUndefined(servername),
    } : undefined,
));
const _layer = Layer.unwrapEffect(Effect.gen(function* () {
    const timeouts = yield* Config.all({
        idleInTransactionMs:    Config.integer('POSTGRES_IDLE_IN_TXN_TIMEOUT_MS').pipe(Config.withDefault(60_000)),
        lockMs:                 Config.integer('POSTGRES_LOCK_TIMEOUT_MS').pipe(Config.withDefault(10_000)),
        statementMs:            Config.integer('POSTGRES_STATEMENT_TIMEOUT_MS').pipe(Config.withDefault(30_000)),
        transactionMs:          Config.integer('POSTGRES_TRANSACTION_TIMEOUT_MS').pipe(Config.withDefault(120_000)),
    });
    const timeoutPgOptions = _CONFIG.pgOptions.timeouts.map(([key, timeoutKey]) => [key, String(timeouts[timeoutKey])] as const);
    const trigramPgOptions = yield* Effect.forEach(_CONFIG.pgOptions.trigramThresholds, ([envName, optionName, defaultValue]) =>
        Config.number(envName).pipe(
            Config.withDefault(defaultValue),
            Config.validate({ message: `${envName} must be between 0 and 1`, validation: (value) => value >= 0 && value <= 1 }),
            Config.map((value) => [optionName, String(value)] as const),
        )
    );
    const connectionUrl = yield* Config.redacted('DATABASE_URL').pipe(
        Config.mapAttempt((databaseUrl) => {
            const parsedUrl = new URL(Redacted.value(databaseUrl));
            const normalizedPgOptions = [
                ...((parsedUrl.searchParams.get('options') ?? '').match(_CONFIG.pgOptions.extractPattern) ?? []), // NOSONAR S3358
                ...((process.env['PGOPTIONS'] ?? '').match(_CONFIG.pgOptions.extractPattern) ?? []), // NOSONAR S3358
            ]
                .map((token) => token.replace(_CONFIG.pgOptions.replacePattern, '').split('=', 2))
                .filter((parts): parts is [string, string] => (parts[0] ?? '') !== '' && (parts[1] ?? '') !== '')
                .map(([key, value]) => [key, value] as const);
            parsedUrl.searchParams.set(
                'options',
                Array.from(
                    new Map<string, string>([...normalizedPgOptions, ...timeoutPgOptions, ...trigramPgOptions]),
                    ([key, value]) => `-c ${key}=${value}`,
                ).join(' '),
            );
            return Redacted.make(parsedUrl.toString());
        }),
    );
    return PgClient.layerConfig({
        applicationName:        Config.string('POSTGRES_APP_NAME').pipe(Config.withDefault('parametric-portal')),
        connectionTTL:          Config.integer('POSTGRES_CONNECTION_TTL_MS').pipe(Config.withDefault(900_000), Config.map(Duration.millis)),
        connectTimeout:         Config.integer('POSTGRES_CONNECT_TIMEOUT_MS').pipe(Config.withDefault(5_000), Config.map(Duration.millis)),
        idleTimeout:            Config.integer('POSTGRES_IDLE_TIMEOUT_MS').pipe(Config.withDefault(30_000), Config.map(Duration.millis)),
        maxConnections:         Config.integer('POSTGRES_POOL_MAX').pipe(Config.withDefault(10)),
        minConnections:         Config.integer('POSTGRES_POOL_MIN').pipe(Config.withDefault(2)),
        spanAttributes:         Config.succeed({ 'service.name': 'database' }),
        ssl:                    _sslConfig,
        transformJson:          Config.succeed(true),
        transformQueryNames:    Config.succeed(S.camelToSnake),
        transformResultNames:   Config.succeed(S.snakeToCamel),
        url:                    Config.succeed(connectionUrl),
    });
}));

// --- [OBJECT] ----------------------------------------------------------------

const Client = (() => {
    const sql = SqlClient.SqlClient;
    const _health = (name: string, queryFn: (db: SqlClient.SqlClient) => Effect.Effect<unknown, unknown>) =>
        Effect.fn(name)(function* () {
            const db = yield* sql;
            const [duration, healthy] = yield* queryFn(db).pipe(
                Effect.as(true),
                Effect.timeout(_CONFIG.health.timeout),
                Effect.orElseSucceed(() => false),
                Effect.timed,
            );
            return { healthy, latencyMs: Duration.toMillis(duration) };
        });
    const _LOCK_OPS = {
        acquire:        { fn: 'pg_advisory_xact_lock',     yields: false },
        sessionAcquire: { fn: 'pg_advisory_lock',          yields: false },
        sessionRelease: { fn: 'pg_advisory_unlock',         yields: 'released' },
        sessionTry:     { fn: 'pg_try_advisory_lock',       yields: 'acquired' },
        try:            { fn: 'pg_try_advisory_xact_lock',  yields: 'acquired' },
    } as const;
    const _lockOp = (spec: { readonly fn: string; readonly yields: string | false }) => {
        const suffix = Match.value(spec.yields).pipe(Match.when(false, () => ''), Match.orElse((alias) => ` AS ${alias}`));
        return Effect.fn(`db.lock.${spec.fn}`)(function* (key: bigint) {
            const db = yield* sql;
            const rows = yield* db.unsafe(`SELECT ${spec.fn}($1)${suffix}`, [key]);
            return Match.value(spec.yields).pipe(Match.when(false, () => undefined), Match.orElse((alias) => (rows[0] as Record<string, boolean>)?.[alias] ?? false));
        });
    };
    return {
        health: _health('db.checkHealth', (db) => db`SELECT 1`),
        healthDeep: _health('db.checkHealthDeep', (db) => db.withTransaction(db`SELECT 1`)),
        layer: _layer,
        listen: {
            raw: (channel: string) => Stream.unwrap(Effect.map(PgClient.PgClient, (pgClient) => pgClient.listen(channel))),
            typed: <A, I>(channel: string, schema: Sch.Schema<A, I, never>) =>
                Stream.unwrap(Effect.map(PgClient.PgClient, (pgClient) => pgClient.listen(channel).pipe(
                    Stream.mapEffect(F.flow(Sch.decode(Sch.parseJson(schema)), Effect.tapError((error) => Effect.logWarning('LISTEN/NOTIFY decode failed', { channel, error: String(error) })), Effect.option)),
                    Stream.filterMap(F.identity),
                ))),
        },
        lock: {
            acquire:     _lockOp(_LOCK_OPS.acquire),
            session: {
                acquire: _lockOp(_LOCK_OPS.sessionAcquire),
                release: _lockOp(_LOCK_OPS.sessionRelease),
                try:     _lockOp(_LOCK_OPS.sessionTry),
            },
            try:         _lockOp(_LOCK_OPS.try),
        },
        notify: (channel: string, payload: string) => sql.pipe(Effect.flatMap((db) => db`SELECT pg_notify(${channel}, ${payload})`)),
        tenant: (() => {
            const Id = _CONFIG.tenant.id;
            const ref = FiberRef.unsafeMake<string>(Id.unspecified);
            const sqlContextRef = FiberRef.unsafeMake(false, { fork: () => false });
            const tenant = {
                current: FiberRef.get(ref),
                Id,
                inSqlContext: FiberRef.get(sqlContextRef),
                locally: <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.locallyWith(effect, ref, () => tenantId),
                set: (tenantId: string) => FiberRef.set(ref, tenantId),
                with: <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) => tenant.locally(appId, Effect.gen(function* () {
                    const inSqlContext = yield* FiberRef.get(sqlContextRef);
                    const db = yield* sql;
                    return yield* inSqlContext
                        ? effect
                        : Effect.locallyWith(
                            db.withTransaction(
                                db`SELECT set_config('app.current_tenant', ${appId}, true)`.pipe(
                                    Effect.andThen(effect),
                                    Effect.provideService(SqlClient.SqlClient, db),
                                ),
                            ),
                            sqlContextRef,
                            F.constTrue,
                        );
                })),
            } as const;
            return tenant;
        })(),
        vector: {
            getConfig: Effect.fn('db.vectorConfig')(function* () {
                const db = yield* sql;
                return yield* db<{ name: string; setting: string }>`SELECT name, setting FROM pg_settings WHERE name LIKE 'hnsw.%' OR name LIKE 'diskann.%' OR name LIKE 'vectorscale.%'`;
            }),
            indexStats: (tableName: string, indexName: string) => sql.pipe(Effect.flatMap((db) => db<{ idxScan: bigint; idxTupFetch: bigint; idxTupRead: bigint }>`SELECT idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes WHERE relname = ${tableName} AND indexrelname = ${indexName}`)),
            withIterativeScan: <A, E, R>(
                config: { mode: 'relaxed_order' | 'strict_order' | 'off'; efSearch?: number; maxScanTuples?: number; scanMemMultiplier?: number },
                effect: Effect.Effect<A, E, R>,
            ) => sql.pipe(
                Effect.flatMap((db) => db.withTransaction(
                    db`SET LOCAL hnsw.iterative_scan = ${config.mode}`.pipe(
                        Effect.andThen(db`SET LOCAL hnsw.ef_search = ${config.efSearch ?? 120}`),
                        Effect.andThen(db`SET LOCAL hnsw.max_scan_tuples = ${config.maxScanTuples ?? 40_000}`),
                        Effect.andThen(db`SET LOCAL hnsw.scan_mem_multiplier = ${config.scanMemMultiplier ?? 2}`),
                        Effect.andThen(effect),
                        Effect.provideService(SqlClient.SqlClient, db),
                    ),
                )),
            ),
        },
        } as const;
    })();

// --- [EXPORT] ----------------------------------------------------------------

export { Client };
