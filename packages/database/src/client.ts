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

// --- [FUNCTIONS] -------------------------------------------------------------

const _readSslFile = (pathOpt: Option.Option<string>) =>
    Option.match(pathOpt, {
        onNone: () => Effect.succeed<string | undefined>(undefined),
        onSome: (path) => Effect.try(() => readFileSync(path, 'utf8')),
    });
const _parsePgOptions = (options: string) =>
    Array.from(options.matchAll(_CONFIG.pgOptions.extractPattern), (m) => m[0])
        .map((token) => token.replace(_CONFIG.pgOptions.replacePattern, '').split('=', 2))
        .filter((parts): parts is [string, string] => (parts[0] ?? '') !== '' && (parts[1] ?? '') !== '');
const _isValidTrigramThreshold = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const _isValidTrigramThresholds = (values: {
    readonly similarity: unknown;
    readonly strictWordSimilarity: unknown;
    readonly wordSimilarity: unknown;
}): values is {
    readonly similarity: number;
    readonly strictWordSimilarity: number;
    readonly wordSimilarity: number;
} =>
    _isValidTrigramThreshold(values['similarity'])
    && _isValidTrigramThreshold(values['wordSimilarity'])
    && _isValidTrigramThreshold(values['strictWordSimilarity']);

// --- [LAYERS] ----------------------------------------------------------------

const layerFromConfig = (cfg: Record<string, unknown>) =>
    Layer.unwrapEffect(
        Effect.gen(function* () {
            const sslConfig = cfg['ssl'] as Record<string, unknown>;
            const timeouts = cfg['timeouts'] as Record<string, unknown>;
            const trigramThresholds = cfg['trigramThresholds'] as Record<string, unknown>;
            const ssl = (sslConfig['enabled'] as boolean)
                ? yield* Effect.map(
                    Effect.all({
                        ca:   _readSslFile(sslConfig['caPath'] as Option.Option<string>),
                        cert: _readSslFile(sslConfig['certPath'] as Option.Option<string>),
                        key:  _readSslFile(sslConfig['keyPath'] as Option.Option<string>),
                    }),
                    (certs) => ({
                        ...certs,
                        minVersion:         sslConfig['minVersion'] as SecureVersion,
                        rejectUnauthorized: sslConfig['rejectUnauthorized'] as boolean,
                        servername:         Option.getOrUndefined(sslConfig['servername'] as Option.Option<string>),
                    }),
                )
                : undefined;
            const parsedUrl = new URL(Redacted.value(cfg['connectionUrl'] as Redacted.Redacted<string>));
            const normalizedPgOptions = [
                ..._parsePgOptions(parsedUrl.searchParams.get('options') ?? ''),
                ..._parsePgOptions(cfg['options'] as string),
            ];
            const timeoutPgOptions = _CONFIG.pgOptions.timeouts.map(([key, timeoutKey]) => [key, String(timeouts[timeoutKey] as number)] as const);
            const trigramValues = yield* Effect.filterOrFail(
                Effect.succeed({
                    similarity: trigramThresholds['similarity'],
                    strictWordSimilarity: trigramThresholds['strictWordSimilarity'],
                    wordSimilarity: trigramThresholds['wordSimilarity'],
                } as const),
                _isValidTrigramThresholds,
                (values) =>
                    new Error(
                        `Invalid trigram thresholds: expected similarity, wordSimilarity, and strictWordSimilarity to be numbers in [0,1], got ${JSON.stringify(values)}`,
                    ),
            );
            const trigramThresholdValues = [trigramValues.similarity, trigramValues.wordSimilarity, trigramValues.strictWordSimilarity] as const;
            const trigramPgOptions = _CONFIG.pgOptions.trigramThresholds.map(([, optionName], index) => [
                optionName,
                String(trigramThresholdValues[index]),
            ] as const);
            parsedUrl.searchParams.set(
                'options',
                Array.from(
                    new Map<string, string>([...normalizedPgOptions, ...timeoutPgOptions, ...trigramPgOptions]),
                    ([key, value]) => `-c ${key}=${value}`,
                ).join(' '),
            );
            return PgClient.layerConfig({
                applicationName:      Config.succeed(cfg['appName'] as string),
                connectionTTL:        Config.succeed(Duration.millis(cfg['connectionTtlMs'] as number)),
                connectTimeout:       Config.succeed(Duration.millis(cfg['connectTimeoutMs'] as number)),
                idleTimeout:          Config.succeed(Duration.millis(cfg['idleTimeoutMs'] as number)),
                maxConnections:       Config.succeed(cfg['poolMax'] as number),
                minConnections:       Config.succeed(cfg['poolMin'] as number),
                spanAttributes:       Config.succeed({ 'service.name': 'database' }),
                ssl:                  Config.succeed(ssl),
                transformJson:        Config.succeed(true),
                transformQueryNames:  Config.succeed(S.camelToSnake),
                transformResultNames: Config.succeed(S.snakeToCamel),
                url:                  Config.succeed(Redacted.make(parsedUrl.toString())),
            });
        }),
    );

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
        acquire:        { fn: 'pg_advisory_xact_lock',      yields: false      },
        sessionAcquire: { fn: 'pg_advisory_lock',           yields: false      },
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
        health:     _health('db.checkHealth', (db) => db`SELECT 1`),
        healthDeep: _health('db.checkHealthDeep', (db) => db.withTransaction(db`SELECT 1`)),
        layerFromConfig,
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
