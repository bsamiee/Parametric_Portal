import { execFile as _execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import * as FileSystem from '@effect/platform/FileSystem';
import { SqlClient } from '@effect/sql';
import { ClientCapabilities } from '@parametric-portal/database/client';
import { Array as A, Data, Effect, Match, Option } from 'effect';
import { RuntimeAssets } from './release.ts';

// --- [TYPES] -----------------------------------------------------------------

type PostgresMode = 'managed-docker';
type PostgresTarget =
    | { readonly _tag: 'env_override'; readonly url: string }
    | { readonly _tag: 'managed-docker' };
type PostgresResolvedConnection = {
    readonly mode: 'env_override' | PostgresMode;
    readonly source: 'env' | 'managed';
    readonly url: string;
};
type _KeychainOps = {
    readonly readSecret:  (account: string)                => Effect.Effect<Option.Option<string>>;
    readonly writeSecret: (account: string, value: string) => Effect.Effect<unknown, unknown>;
};
type _ResolveTargetInput = {
    readonly envOverride: Option.Option<string>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _execFile = promisify(_execFileCallback);
const _DATABASE = 'kargadan';
const _DOCKER_CONTAINER = 'kargadan-pg';
const _DOCKER_PASSWORD = 'kargadan-local';
const _DOCKER_PORT = 5434;
const _BOOTSTRAP_CAPABILITY_QUERY = `
    SELECT
        current_setting('server_version_num')::int,
        current_setting('server_version'),
        COALESCE((
            SELECT string_agg(extension_name, ',')
            FROM (
                SELECT extension_name
                FROM (
                    VALUES
                        (
                            '${ClientCapabilities.bootstrapExtensions.vector.extension}',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extension_versions
                                WHERE name = '${ClientCapabilities.bootstrapExtensions.vector.extension}'
                                  AND string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::int[] >= ARRAY[0, 8, 2]
                            )
                        ),
                        (
                            '${ClientCapabilities.bootstrapExtensions.partman.extension}',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extensions
                                WHERE name = '${ClientCapabilities.bootstrapExtensions.partman.extension}'
                            )
                        ),
                        (
                            'pg_trgm',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extensions
                                WHERE name = 'pg_trgm'
                            )
                        ),
                        (
                            'btree_gin',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extensions
                                WHERE name = 'btree_gin'
                            )
                        ),
                        (
                            'fuzzystrmatch',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extensions
                                WHERE name = 'fuzzystrmatch'
                            )
                        ),
                        (
                            'unaccent',
                            EXISTS (
                                SELECT 1
                                FROM pg_available_extensions
                                WHERE name = 'unaccent'
                            )
                        )
                ) AS required(extension_name, available)
                WHERE NOT available
            ) AS missing_extensions
        ), '')`;

// --- [ERRORS] ----------------------------------------------------------------

class PostgresProviderError extends Data.TaggedError('PostgresProviderError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason: 'compatibility' | 'not_found' | 'runtime' | 'validation';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _exec = (
    command: string,
    args: ReadonlyArray<string>,
    options?: { readonly env?: Record<string, string | undefined>; readonly input?: string },
) =>
    Effect.tryPromise({
        catch: (cause) => cause,
        try:   () => _execFile(command, [...args], {
            encoding: 'utf8',
            ...(options?.env === undefined ? {} : { env: options.env }),
            ...(options?.input === undefined ? {} : { input: options.input }),
        }),
    }).pipe(Effect.map(({ stderr, stdout }) => ({ stderr: stderr.trim(), stdout: stdout.trim() })));
const _dockerExec = (
    args: ReadonlyArray<string>,
    label: string,
    options?: { readonly env?: Record<string, string | undefined> },
) =>
    _exec('docker', args, options).pipe(Effect.mapError((detail) => new PostgresProviderError({ detail, message: label, reason: 'runtime' })));
const _dockerUrl = () => `postgresql://kargadan:${encodeURIComponent(_DOCKER_PASSWORD)}@127.0.0.1:${String(_DOCKER_PORT)}/${_DATABASE}`;
const _managedDockerConnection = {
    mode: 'managed-docker' as const,
    source: 'managed' as const,
    url: _dockerUrl(),
};
const _parseBootstrapCapabilities = (stdout: string) => {
    const [serverVersionNumRaw, serverVersion = '', missingExtensionsRaw = ''] = stdout.split('\t', 3);
    const serverVersionNum = Number.parseInt(serverVersionNumRaw ?? '', 10);
    return Number.isFinite(serverVersionNum)
        ? Option.some({
            missingExtensions: missingExtensionsRaw.length === 0
                ? []
                : A.filter(missingExtensionsRaw.split(','), (extension) => extension.length > 0),
            serverVersion,
            serverVersionNum,
        })
        : Option.none();
};
const _ensureBootstrapCapabilities = (
    label: string,
    effect: Effect.Effect<{ readonly stderr: string; readonly stdout: string }, PostgresProviderError>,
) =>
    effect.pipe(
        Effect.flatMap(({ stdout }) => Option.match(_parseBootstrapCapabilities(stdout), {
            onNone: () => Effect.fail(new PostgresProviderError({
                message: `${label} returned an unreadable bootstrap capability probe.`,
                reason:  'compatibility',
            })),
            onSome: (capability) =>
                capability.serverVersionNum >= ClientCapabilities.serverVersionMin
                && capability.missingExtensions.length === 0
                    ? Effect.void
                    : Effect.fail(new PostgresProviderError({
                        detail: capability,
                        message: `${label} resolved PostgreSQL ${capability.serverVersion} (${String(capability.serverVersionNum)}), missingExtensions=${capability.missingExtensions.join(',') || 'none'}. Kargadan requires PostgreSQL ${ClientCapabilities.serverVersionLabel}+ with installable ${ClientCapabilities.bootstrapExtensions.vector.extension} ${ClientCapabilities.bootstrapExtensions.vector.versionLabel}, ${ClientCapabilities.bootstrapExtensions.partman.extension}, pg_trgm, btree_gin, fuzzystrmatch, and unaccent.`,
                        reason:  'compatibility',
                    })),
        })),
    );
const _inspectDockerRunning = _dockerExec(
    ['container', 'inspect', '-f', '{{.State.Running}}', _DOCKER_CONTAINER],
    'Docker container inspection failed.',
).pipe(
    Effect.map(({ stdout }) => stdout === 'true'),
    Effect.catchAll(() => Effect.succeed(false)),
);
const _probeManagedDocker = _ensureBootstrapCapabilities(
    'Docker bootstrap',
    _dockerExec(
        ['exec', '-e', `PGPASSWORD=${_DOCKER_PASSWORD}`, _DOCKER_CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'kargadan', '-At', '-F', '\t', '-d', _DATABASE, '-c', _BOOTSTRAP_CAPABILITY_QUERY],
        'Docker bootstrap capability probe failed.',
    ),
);
const _ensureDockerAvailable = (kargadanDir: string) =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const composePath = yield* RuntimeAssets.composePath;
        yield* fs.exists(composePath).pipe(
            Effect.filterOrFail(
                (exists) => exists,
                () => new PostgresProviderError({ message: `Docker Compose file not found at ${composePath}.`, reason: 'not_found' }),
            ),
        );
        yield* fs.makeDirectory(kargadanDir, { recursive: true });
        const composeEnv = { ...process.env, KARGADAN_PG_PASSWORD: _DOCKER_PASSWORD };
        yield* _dockerExec(['compose', '-f', composePath, 'up', '-d', '--wait'], 'Docker Compose up failed. Ensure Docker is running and the managed image is available.', {
            env: composeEnv,
        });
        yield* _probeManagedDocker.pipe(
            Effect.catchAll(() => _dockerExec(['compose', '-f', composePath, 'down', '-v', '--remove-orphans'], 'Docker Compose reset failed.', {
                env: composeEnv,
            }).pipe(
                Effect.catchAll(() => Effect.succeed({ stderr: '', stdout: '' })),
                Effect.zipRight(_dockerExec(['compose', '-f', composePath, 'up', '-d', '--wait'], 'Docker Compose up failed. Ensure Docker is running and the managed image is available.', {
                    env: composeEnv,
                })),
                Effect.zipRight(_probeManagedDocker),
            )),
        );
        return _managedDockerConnection;
    });

const _resolveManagedDockerReadyConnection = _inspectDockerRunning.pipe(
    Effect.flatMap((running) => running
        ? _probeManagedDocker.pipe(
            Effect.as(Option.some(_managedDockerConnection)),
            Effect.catchAll(() => Effect.succeed(Option.none<PostgresResolvedConnection>())),
        )
        : Effect.succeed(Option.none<PostgresResolvedConnection>())),
);

// --- [STATE_MACHINE] ---------------------------------------------------------

const _resolveTarget = (input: _ResolveTargetInput): Effect.Effect<PostgresTarget> =>
    Match.value(input.envOverride).pipe(
        Match.when({ _tag: 'Some' }, ({ value }) => Effect.succeed({ _tag: 'env_override', url: value } as const)),
        Match.orElse(() => Effect.succeed({ _tag: 'managed-docker' } as const)),
    );
const _resolveReadyConnection = (
    _kargadanDir: string,
    _rootDir: string,
    _keychain: _KeychainOps,
) =>
    (target: PostgresTarget): Effect.Effect<Option.Option<PostgresResolvedConnection>, unknown, FileSystem.FileSystem> =>
        Match.value(target).pipe(
            Match.when({ _tag: 'env_override' }, ({ url }) => Effect.succeed(Option.some({ mode: 'env_override', source: 'env', url } as const))),
            Match.orElse(() => _resolveManagedDockerReadyConnection),
        );
const _ensureAvailable = (
    kargadanDir: string,
    rootDir: string,
    keychain: _KeychainOps,
) =>
    (target: PostgresTarget): Effect.Effect<PostgresResolvedConnection, unknown, FileSystem.FileSystem> =>
        Match.value(target).pipe(
            Match.when({ _tag: 'env_override' }, ({ url }) => Effect.succeed({ mode: 'env_override', source: 'env', url } as const)),
            Match.orElse(() =>
                _resolveReadyConnection(kargadanDir, rootDir, keychain)(target).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => _ensureDockerAvailable(kargadanDir),
                        onSome: Effect.succeed,
                    })),
                ),
            ),
        );
// --- [SCHEMA_EXTENSION] ------------------------------------------------------

const _applyKargadanSchema = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    sql.unsafe(`
        CREATE OR REPLACE FUNCTION is_valid_kargadan_ai_settings(p_ai jsonb)
            RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
            SELECT CASE
                WHEN p_ai IS NULL THEN TRUE
                WHEN jsonb_typeof(p_ai) <> 'object' THEN FALSE
                WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(p_ai) AS key WHERE key NOT IN ('provider', 'model', 'temperature', 'topP', 'maxOutputTokens')) THEN FALSE
                WHEN COALESCE(p_ai #>> '{provider}', '') NOT IN ('gemini', 'openai') THEN FALSE
                WHEN COALESCE(btrim(p_ai #>> '{model}'), '') = '' THEN FALSE
                WHEN (p_ai ? 'maxOutputTokens')
                    AND ((p_ai #>> '{maxOutputTokens}') !~ '^[0-9]+$' OR (p_ai #>> '{maxOutputTokens}')::int <= 0) THEN FALSE
                WHEN (p_ai ? 'temperature')
                    AND jsonb_typeof(p_ai->'temperature') <> 'number' THEN FALSE
                WHEN (p_ai ? 'topP')
                    AND jsonb_typeof(p_ai->'topP') <> 'number' THEN FALSE
                ELSE TRUE
            END $$;
        UPDATE apps
        SET settings = jsonb_set(
                settings,
                '{ai}',
                jsonb_strip_nulls(jsonb_build_object(
                    'provider', COALESCE(settings #>> '{ai,provider}', settings #>> '{ai,language,primary,provider}', settings #>> '{ai,language,provider}'),
                    'model', COALESCE(settings #>> '{ai,model}', settings #>> '{ai,language,primary,model}', settings #>> '{ai,language,model}'),
                    'temperature', COALESCE(settings #> '{ai,temperature}', settings #> '{ai,language,temperature}'),
                    'topP', COALESCE(settings #> '{ai,topP}', settings #> '{ai,language,topP}'),
                    'maxOutputTokens', COALESCE(settings #> '{ai,maxOutputTokens}', settings #> '{ai,language,maxTokens}')
                ), true),
                true
            )
        WHERE settings ? 'ai'
          AND jsonb_typeof(settings->'ai') = 'object'
          AND EXISTS (
                SELECT 1
                FROM jsonb_object_keys(settings->'ai') AS key
                WHERE key IN ('embedding', 'knowledge', 'language', 'policy')
            );
        ALTER TABLE apps DROP CONSTRAINT IF EXISTS apps_settings_shape;
        ALTER TABLE apps
            ADD CONSTRAINT apps_settings_shape
            CHECK (settings IS NULL OR (jsonb_typeof(settings) = 'object' AND is_valid_kargadan_ai_settings(settings->'ai')))
            NOT VALID;
        ALTER TABLE apps VALIDATE CONSTRAINT apps_settings_shape`).pipe(
    Effect.tap(() => Effect.logInfo('postgres.kargadanSchema.applied')))));

// --- [MAINTENANCE] -----------------------------------------------------------

const _vacuumPersistence = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    sql.unsafe(`VACUUM (ANALYZE, BUFFER_USAGE_LIMIT '256MB') agent_journal, kv_store, effect_event_journal`).pipe(
        Effect.tap(() => Effect.logInfo('postgres.vacuumPersistence.completed')))));
const _indexHealth = SqlClient.SqlClient.pipe(Effect.flatMap((sql) =>
    sql.unsafe(`SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch, pg_size_pretty(pg_relation_size(indexrelid)) AS size
        FROM pg_stat_user_indexes WHERE relname IN ('agent_journal', 'apps', 'effect_event_journal', 'effect_event_remotes', 'kv_store')
        ORDER BY idx_scan DESC`).pipe(
        Effect.map((rows) => rows as ReadonlyArray<{
            readonly idx_scan: string;
            readonly idx_tup_fetch: string;
            readonly idx_tup_read: string;
            readonly indexrelname: string;
            readonly relname: string;
            readonly schemaname: string;
            readonly size: string;
        }>))));

// --- [EXPORT] ----------------------------------------------------------------

const shellExec = (command: string, args: ReadonlyArray<string>) => _exec(command, args);
const KargadanPostgres = {
    applyKargadanSchema: _applyKargadanSchema,
    ensureAvailable: _ensureAvailable,
    indexHealth: _indexHealth,
    resolveReadyConnection: _resolveReadyConnection,
    resolveTarget: _resolveTarget,
    vacuumPersistence: _vacuumPersistence,
} as const;

export { KargadanPostgres, shellExec };
