import { execFile as _execFileCallback } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as FileSystem from '@effect/platform/FileSystem';
import { SqlClient } from '@effect/sql';
import { randomBytes } from 'node:crypto';
import { Config, Data, Effect, Option, Redacted } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type _KeychainOps = {
    readonly readSecret:  (account: string)                => Effect.Effect<Option.Option<string>>;
    readonly writeSecret: (account: string, value: string) => Effect.Effect<unknown, unknown>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _execFile                = promisify(_execFileCallback);
const _APP_PATH_DEFAULT        = '/Applications/Postgres.app';
const _APP_PATH_KEY            = 'KARGADAN_POSTGRES_APP_PATH';
const _DATABASE                = 'kargadan';
const _DOCKER_PORT             = 5434;
const _DOCKER_KEYCHAIN_ACCOUNT = 'db.docker';

// --- [ERRORS] ----------------------------------------------------------------

class PostgresProviderError extends Data.TaggedError('PostgresProviderError')<{
    readonly detail?: unknown;
    readonly message: string;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _exec = (command: string, args: ReadonlyArray<string>, options?: { readonly env?: Record<string, string | undefined>; readonly input?: string }) => Effect.tryPromise({
    catch: (cause) => cause,
    try:   () => _execFile(command, [...args], { encoding: 'utf8', ...(options?.env === undefined ? {} : { env: options.env }), ...(options?.input === undefined ? {} : { input: options.input }) }),
}).pipe(Effect.map(({ stderr, stdout }) => ({ stderr: stderr.trim(), stdout: stdout.trim() })));
const _pgExec = (bin: string, args: ReadonlyArray<string>, label: string) =>
    _exec(bin, args).pipe(Effect.mapError((detail) => new PostgresProviderError({ detail, message: label })));
const _appRuntime = (rootDir: string, appPath: string) => {
    const bin = join(appPath, 'Contents', 'Versions', 'latest', 'bin');
    const user = (process.env['USER'] ?? userInfo().username).trim();
    const paths = {
        data:    join(rootDir, 'data'), log: join(rootDir, 'log'),
        logFile: join(rootDir, 'log', 'postgresql.log'), run: join(rootDir, 'run'),
    } as const;
    const url = `postgresql:///${_DATABASE}?host=${encodeURIComponent(paths.run)}&user=${encodeURIComponent(user)}`;
    return {
        appPath, bin: { createdb: join(bin, 'createdb'), initdb: join(bin, 'initdb'), pgCtl: join(bin, 'pg_ctl'), pgIsready: join(bin, 'pg_isready'), psql: join(bin, 'psql') },
        database: _DATABASE, paths, url, user,
    } as const;
};
const _bootstrapApp = (kargadanDir: string, rootDir: string) => Effect.gen(function* () {
    const [fs, appPath] = yield* Effect.all([FileSystem.FileSystem, Config.string(_APP_PATH_KEY).pipe(Config.withDefault(_APP_PATH_DEFAULT))]);
    const runtime = _appRuntime(rootDir, appPath);
    yield* fs.exists(runtime.bin.initdb).pipe(Effect.filterOrFail((exists) => exists, () =>
        new PostgresProviderError({ message: `Postgres.app not found at ${runtime.appPath}. Install Postgres.app or set ${_APP_PATH_KEY}.` })));
    yield* Effect.forEach([kargadanDir, rootDir, runtime.paths.log, runtime.paths.run], (path) => fs.makeDirectory(path, { recursive: true }), { discard: true });
    const initialized = yield* fs.exists(runtime.paths.data);
    yield* Effect.when(_pgExec(runtime.bin.initdb, ['-D', runtime.paths.data, '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--username', runtime.user],
        'Postgres cluster initialization failed.'), () => !initialized);
    const ready = yield* _exec(runtime.bin.pgIsready, ['-h', runtime.paths.run, '-d', 'postgres', '-U', runtime.user]).pipe(Effect.as(true), Effect.catchAll(() => Effect.succeed(false)));
    yield* Effect.when(_pgExec(runtime.bin.pgCtl, ['-D', runtime.paths.data, '-l', runtime.paths.logFile, '-w', 'start', '-o',
        `-h '' -k ${runtime.paths.run} -c unix_socket_permissions=0700`], 'Postgres cluster start failed.'), () => !ready);
    const databaseExists = yield* _pgExec(runtime.bin.psql, ['-h', runtime.paths.run, '-U', runtime.user, '-d', 'postgres', '-Atqc',
        `SELECT 1 FROM pg_database WHERE datname='${runtime.database}'`], 'Postgres database probe failed.').pipe(Effect.map(({ stdout }) => stdout === '1'));
    yield* Effect.when(_pgExec(runtime.bin.createdb, ['-h', runtime.paths.run, '-U', runtime.user, runtime.database], 'Postgres database creation failed.'), () => !databaseExists);
    yield* _pgExec(runtime.bin.psql, ['-h', runtime.paths.run, '-U', runtime.user, '-d', runtime.database, '-v', 'ON_ERROR_STOP=1', '-c',
        'CREATE EXTENSION IF NOT EXISTS vector;'], 'pgvector extension enablement failed.');
    return runtime;
});
const _bootstrapDocker = (kargadanDir: string, keychain: _KeychainOps) => Effect.gen(function* () {
    const composePath = join(import.meta.dirname, '../../docker-compose.pg.yml');
    const fs = yield* FileSystem.FileSystem;
    yield* fs.exists(composePath).pipe(Effect.filterOrFail((exists) => exists, () =>
        new PostgresProviderError({ message: `Docker Compose file not found at ${composePath}. Run from the harness project root.` })));
    yield* fs.makeDirectory(join(kargadanDir, 'postgres', 'docker'), { recursive: true });
    const existing = yield* keychain.readSecret(_DOCKER_KEYCHAIN_ACCOUNT).pipe(Effect.catchAll(() => Effect.succeed(Option.none<string>())));
    const password = yield* Option.match(existing, {
        onNone: () => Effect.gen(function* () {
            const generated = randomBytes(24).toString('base64url');
            yield* keychain.writeSecret(_DOCKER_KEYCHAIN_ACCOUNT, generated);
            return generated;
        }),
        onSome: Effect.succeed,
    });
    yield* _exec('docker', ['compose', '-f', composePath, 'up', '-d', '--wait'], { env: { ...process.env, KARGADAN_PG_PASSWORD: password } }).pipe(
        Effect.mapError((detail) => new PostgresProviderError({ detail, message: 'Docker Compose up failed. Ensure Docker is running.' })));
    return `postgresql://kargadan:${encodeURIComponent(password)}@127.0.0.1:${String(_DOCKER_PORT)}/${_DATABASE}`;
});
const _detectProvider = (kargadanDir: string, rootDir: string, keychain: _KeychainOps) =>
    Effect.flatMap(FileSystem.FileSystem, (fs) =>
        fs.exists(join(_APP_PATH_DEFAULT, 'Contents')).pipe(
            Effect.flatMap((hasApp) => hasApp
                ? _bootstrapApp(kargadanDir, rootDir).pipe(
                    Effect.tap((runtime) => Effect.logInfo('kargadan.postgres.provider.resolved').pipe(
                        Effect.annotateLogs({ provider: 'postgres.app', url: runtime.url.replace(/\/\/.*@/, '//***@') }))),
                    Effect.map((runtime) => runtime.url))
                : _exec('docker', ['--version']).pipe(
                    Effect.flatMap(() => _bootstrapDocker(kargadanDir, keychain)),
                    Effect.tap((url) => Effect.logInfo('kargadan.postgres.provider.resolved').pipe(
                        Effect.annotateLogs({ provider: 'docker', url: url.replace(/\/\/.*@/, '//***@') }))),
                    Effect.catchAll(() => Effect.fail(new PostgresProviderError({
                        message: 'No Postgres provider found. Install Postgres.app, Docker, or set KARGADAN_DATABASE_URL.' })))))));
const _resolveUrl = (kargadanDir: string, rootDir: string, keychain: _KeychainOps) =>
    Config.redacted('KARGADAN_DATABASE_URL').pipe(Config.option, Effect.flatMap(Option.match({
        onNone: () => _detectProvider(kargadanDir, rootDir, keychain),
        onSome: (redacted) => Effect.logInfo('kargadan.postgres.provider.resolved').pipe(
            Effect.annotateLogs({ provider: 'env_override' }),
            Effect.as(Redacted.value(redacted))),
    })));
const _connectionUrl = (rootDir: string) =>
    Config.string(_APP_PATH_KEY).pipe(Config.withDefault(_APP_PATH_DEFAULT), Effect.map((appPath) => _appRuntime(rootDir, appPath).url));

// --- [MAINTENANCE] -----------------------------------------------------------

const _vacuumPersistence = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    sql.unsafe(`VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') agent_journal, kv_store, effect_event_journal`).pipe(
        Effect.tap(() => Effect.logInfo('postgres.vacuumPersistence.completed')))));
const _indexHealth = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    sql.unsafe(`SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch, pg_size_pretty(pg_relation_size(indexrelid)) AS size
        FROM pg_stat_user_indexes WHERE relname IN ('agent_journal', 'apps', 'effect_event_journal', 'effect_event_remotes', 'kv_store')
        ORDER BY idx_scan DESC`).pipe(
        Effect.map((rows) => rows as ReadonlyArray<{
            readonly idx_scan:     string; readonly idx_tup_fetch: string; readonly idx_tup_read: string;
            readonly indexrelname: string; readonly relname:       string; readonly schemaname:   string; readonly size: string;
        }>))));

// --- [EXPORT] ----------------------------------------------------------------

const shellExec = (command: string, args: ReadonlyArray<string>) => _exec(command, args);
const KargadanPostgres = {
    connectionUrl:     _connectionUrl,
    indexHealth:       _indexHealth,
    resolveUrl:        _resolveUrl,
    vacuumPersistence: _vacuumPersistence,
} as const;

export { KargadanPostgres, shellExec };
