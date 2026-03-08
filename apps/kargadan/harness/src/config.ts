import { execFile as _execFileCallback } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as FileSystem from '@effect/platform/FileSystem';
import { SqlClient } from '@effect/sql';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { AgentPersistenceLayer } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { Config, ConfigProvider, Context as Ctx, Data, Duration, Effect, Layer, Match, Option, Redacted, Schema as S, pipe } from 'effect';
import * as KargadanMigration from '../migrations/0001_kargadan';
import { DEFAULT_LOOP_OPERATIONS, NonNegInt, ObjectTypeTag, Operation } from './protocol/schemas';

// --- [SCHEMA] ----------------------------------------------------------------

const KargadanConfigSchema = S.Struct({
    agent:        S.optional(S.partial(S.Struct({ correctionMaxCycles: S.Number, intent: S.String, loopOperations: S.String,
                    retryMaxAttempts: S.Number, writeObjectId: S.String, writeObjectSourceRevision: S.Number, writeObjectTypeTag: S.String }))),
    ai:           S.optional(S.partial(S.Struct({ architectFallback: S.String, architectModel: S.String, architectProvider: S.String,
                    geminiClientPath: S.String, languageFallback: S.String, languageModel: S.String, languageProvider: S.String }))),
    capabilities: S.optional(S.partial(S.Struct({ optional: S.String, required: S.String }))),
    context:      S.optional(S.partial(S.Struct({ compactionTargetPercent: S.Number, compactionTriggerPercent: S.Number }))),
    database:     S.optional(S.partial(S.Struct({ connectTimeout: S.String, idleTimeout: S.String, maxConnections: S.Number, url: S.String }))),
    manifest:     S.optional(S.partial(S.Struct({ entityType: S.String, json: S.String, namespace: S.String, scopeId: S.String, version: S.String }))),
    protocol:     S.optional(S.partial(S.Struct({ tokenExpiryMinutes: S.Number, version: S.String }))),
    rhino:        S.optional(S.partial(S.Struct({ appPath: S.String, launchTimeoutMs: S.Number, yakPath: S.String }))),
    transport:    S.optional(S.partial(S.Struct({ heartbeatIntervalMs: S.Number, heartbeatTimeoutMs: S.Number,
                    reconnectBackoffBaseMs: S.Number, reconnectBackoffMaxMs: S.Number, reconnectMaxAttempts: S.Number, wsHost: S.String }))),
});
const _GeminiSessionSchema = S.parseJson(S.Struct({
    accessToken:  S.NonEmptyTrimmedString,
    expiresAt:    S.String,
    refreshToken: S.NonEmptyTrimmedString,
}));

// --- [CONSTANTS] -------------------------------------------------------------

const _execFile = promisify(_execFileCallback);
const KARGADAN_DIR =   join(homedir(), '.kargadan');
const CONFIG_PATH =    join(KARGADAN_DIR, 'config.json');
const PORT_FILE_PATH = join(KARGADAN_DIR, 'port');
const _KEYCHAIN = {
    accounts: { anthropic: 'ai.anthropic', gemini: 'ai.gemini', openai: 'ai.openai' },
    service:  'com.parametricportal.kargadan',
} as const;
const _POSTGRES = {
    appPath:    '/Applications/Postgres.app',
    appPathKey: 'KARGADAN_POSTGRES_APP_PATH',
    database:   'kargadan',
    root:       join(KARGADAN_DIR, 'postgres', '18'),
} as const;
const _POSTGRES_PATHS = {
    data:    join(_POSTGRES.root, 'data'),
    log:     join(_POSTGRES.root, 'log'),
    logFile: join(_POSTGRES.root, 'log', 'postgresql.log'),
    run:     join(_POSTGRES.root, 'run'),
} as const;
const PROVIDER_VOCABULARY = AiRegistry.providerVocabulary;
const _CONFIG_TREE = {
    agent:        { correctionMaxCycles:       'KARGADAN_CORRECTION_MAX_CYCLES',        intent:             'KARGADAN_AGENT_INTENT',
                    loopOperations:            'KARGADAN_LOOP_OPERATIONS',              retryMaxAttempts:   'KARGADAN_RETRY_MAX_ATTEMPTS', writeObjectId: 'KARGADAN_WRITE_OBJECT_ID',
                    writeObjectSourceRevision: 'KARGADAN_WRITE_OBJECT_SOURCE_REVISION', writeObjectTypeTag: 'KARGADAN_WRITE_OBJECT_TYPE_TAG' },
    ai:           { architectFallback: 'KARGADAN_AI_ARCHITECT_FALLBACK', architectModel:   'KARGADAN_AI_ARCHITECT_MODEL',
                    architectProvider: 'KARGADAN_AI_ARCHITECT_PROVIDER', geminiClientPath: AiRegistry.providerVocabulary.gemini.credential.clientPathKey,
                    languageFallback:  'KARGADAN_AI_LANGUAGE_FALLBACK',  languageModel:    'KARGADAN_AI_LANGUAGE_MODEL',
                    languageProvider:  'KARGADAN_AI_LANGUAGE_PROVIDER' },
    capabilities: { optional: 'KARGADAN_CAP_OPTIONAL', required: 'KARGADAN_CAP_REQUIRED' },
    context:      { compactionTargetPercent: 'KARGADAN_CONTEXT_COMPACTION_TARGET_PERCENT', compactionTriggerPercent: 'KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT' },
    database:     { connectTimeout: 'KARGADAN_PG_CONNECT_TIMEOUT', idleTimeout: 'KARGADAN_PG_IDLE_TIMEOUT', maxConnections: 'KARGADAN_PG_MAX_CONNECTIONS',
                    url:            'KARGADAN_CHECKPOINT_DATABASE_URL' },
    manifest:     { entityType: 'KARGADAN_COMMAND_MANIFEST_ENTITY_TYPE', json:    'KARGADAN_COMMAND_MANIFEST_JSON', namespace: 'KARGADAN_COMMAND_MANIFEST_NAMESPACE',
                    scopeId:    'KARGADAN_COMMAND_MANIFEST_SCOPE_ID',    version: 'KARGADAN_COMMAND_MANIFEST_VERSION' },
    protocol:     { tokenExpiryMinutes: 'KARGADAN_TOKEN_EXPIRY_MINUTES', version: 'KARGADAN_PROTOCOL_VERSION' },
    rhino:        { appPath: 'KARGADAN_RHINO_APP_PATH', launchTimeoutMs: 'KARGADAN_RHINO_LAUNCH_TIMEOUT_MS', yakPath: 'KARGADAN_YAK_PATH' },
    transport:    { heartbeatIntervalMs:    'KARGADAN_HEARTBEAT_INTERVAL_MS',     heartbeatTimeoutMs:    'KARGADAN_HEARTBEAT_TIMEOUT_MS',
                    reconnectBackoffBaseMs: 'KARGADAN_RECONNECT_BACKOFF_BASE_MS', reconnectBackoffMaxMs: 'KARGADAN_RECONNECT_BACKOFF_MAX_MS',
                    reconnectMaxAttempts:   'KARGADAN_RECONNECT_MAX_ATTEMPTS',    wsHost:                'KARGADAN_WS_HOST' },
} as const satisfies Record<string, Record<string, string>>;

// --- [ERRORS] ----------------------------------------------------------------

class HarnessHostError extends Data.TaggedError('HarnessHostError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  'auth' | 'config' | 'keychain' | 'postgres';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _csvConfig = (config: Config.Config<string>) => config.pipe(Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean)));
const _readConfigFile = pipe(
    FileSystem.FileSystem,
    Effect.flatMap((fs) => fs.makeDirectory(KARGADAN_DIR, { recursive: true }).pipe(Effect.zipRight(fs.readFileString(CONFIG_PATH)))),
    Effect.flatMap(S.decode(S.parseJson(KargadanConfigSchema))),
);
const _configPairs = (config: typeof KargadanConfigSchema.Type) =>
    Object.entries(_CONFIG_TREE).flatMap(([group, fields]) =>
        Object.entries(fields).flatMap(([field, envKey]) =>
            Option.fromNullable((config as Record<string, Record<string, unknown> | undefined>)[group]?.[field]).pipe(
                Option.match({ onNone: () => [] as ReadonlyArray<readonly [string, string]>, onSome: (value) => [[envKey, String(value)] as const] })),
        ));
const _exec = (command: string, args: ReadonlyArray<string>, options?: { readonly input?: string }) =>
    Effect.tryPromise({
        catch: (cause) => cause,
        try:   () => _execFile(command, [...args], { encoding: 'utf8', ...(options?.input === undefined ? {} : { input: options.input }) }),
    }).pipe(Effect.map(({ stderr, stdout }) => ({ stderr: stderr.trim(), stdout: stdout.trim() })));
const _keychainValue = (provider: AiRegistry.Provider) =>
    _exec('security', ['find-generic-password', '-a', _KEYCHAIN.accounts[provider], '-s', _KEYCHAIN.service, '-w']).pipe(
        Effect.map(({ stdout }) => Option.some(stdout)),
        Effect.catchAll(() => Effect.succeed(Option.none<string>())),
    );
const _keychainPairs = Effect.forEach(Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
    _keychainValue(provider).pipe(Effect.flatMap(Option.match({
        onNone: () => Effect.succeed([] as ReadonlyArray<readonly [string, string]>),
        onSome: (value) => Match.value(provider).pipe(
            Match.when('gemini', () => S.decodeUnknown(_GeminiSessionSchema)(value).pipe(
                Effect.map((session) => [
                    [AiRegistry.providerVocabulary.gemini.credential.accessTokenKey,  session.accessToken]  as const,
                    [AiRegistry.providerVocabulary.gemini.credential.refreshTokenKey, session.refreshToken] as const,
                    [AiRegistry.providerVocabulary.gemini.credential.expiryKey,       session.expiresAt]    as const,
                ]),
            )),
            Match.orElse((name) => Effect.succeed([[AiRegistry.providerVocabulary[name].credential.key, value] as const])),
        ).pipe(Effect.mapError((detail) => new HarnessHostError({ detail, message: `Keychain entry for ${provider} is invalid.`, reason: 'keychain' }))),
    }))), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
const loadConfigProvider = Effect.all([
    _readConfigFile.pipe(Effect.map(_configPairs), Effect.option, Effect.map(Option.getOrElse(() => [] as ReadonlyArray<readonly [string, string]>))),
    _keychainPairs,
]).pipe(Effect.map(([filePairs, keychainPairs]) =>
    ConfigProvider.orElse(ConfigProvider.fromEnv(), () => ConfigProvider.fromMap(new Map([...filePairs, ...keychainPairs])))));
const readConfig = _readConfigFile.pipe(Effect.option, Effect.map(Option.getOrElse(() => ({} as typeof KargadanConfigSchema.Type))));
const writeConfig = (config: typeof KargadanConfigSchema.Type) =>
    Effect.gen(function* () {
        const [fs, normalized] = yield* Effect.all([
            FileSystem.FileSystem,
            S.decodeUnknown(KargadanConfigSchema)(config).pipe(
                Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Config write rejected invalid or secret fields.', reason: 'config' })),
            ),
        ]);
        yield* fs.makeDirectory(KARGADAN_DIR, { recursive: true });
        yield* fs.writeFileString(CONFIG_PATH, JSON.stringify(normalized, null, 2));
    });
const _configAt = (node: unknown, key: string) =>
    key.split('.').reduce(
        (current, segment) => Option.flatMap(current, (value) =>
            value !== null && typeof value === 'object'
                ? Option.fromNullable((value as Record<string, unknown>)[segment])
                : Option.none()),
        Option.some(node),
    );
const _configEntries = (node: unknown, prefix = ''): ReadonlyArray<string> =>
    node !== null && typeof node === 'object'
        ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
            _configEntries(value, prefix === '' ? key : `${prefix}.${key}`))
        : [`${prefix} = ${String(node)}`];
const _configPatch = (target: Record<string, unknown>, path: ReadonlyArray<string>, value: unknown): Record<string, unknown> =>
    ((key: string) => path.length === 1
        ? { ...target, [key]: value }
        : { ...target, [key]: _configPatch(
            typeof target[key] === 'object' && target[key] !== null ? target[key] as Record<string, unknown> : {},
            path.slice(1),
            value,
        ) })(path[0] as string);
const _geminiClient = (clientPath: string) =>
    Effect.try({
        catch: (detail) => new HarnessHostError({ detail, message: `Gemini OAuth client file is unreadable: ${clientPath}`, reason: 'auth' }),
        try:   () => readFileSync(clientPath, 'utf8'),
    }).pipe(Effect.flatMap(AiRegistry.decodeGeminiClient), Effect.mapError((detail) =>
        detail instanceof HarnessHostError ? detail : new HarnessHostError({ detail, message: `Gemini OAuth client file is invalid: ${clientPath}`, reason: 'auth' })));
const _geminiCallback = Effect.tryPromise({
    catch: (detail) => new HarnessHostError({ detail, message: 'Gemini desktop OAuth listener could not start.', reason: 'auth' }),
    try:   () => new Promise<{ readonly redirectUri: string; readonly wait: Promise<{ readonly code: string; readonly state: string }> }>((resolve, reject) => {
        const server = createServer((req, res) => {
            const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(req.socket.localPort ?? 0)}`);
            const code = url.searchParams.get('code');
            const state = url.searchParams.get('state');
            const finish = (statusCode: number, body: string, settle: () => void) => {
                res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
                res.end(body, () => {
                    server.close();
                    settle();
                });
            };
            code !== null && state !== null
                ? finish(200, 'Kargadan authorization complete. You can close this window.',      () => pending.resolve({ code, state }))
                : finish(400, 'Kargadan authorization failed. Return to Kargadan and try again.', () => pending.reject(new Error('oauth_callback_missing_code_or_state')));
        });
        const pending = {
            reject:  (_detail: unknown): void => undefined,
            resolve: (_value: { readonly code: string; readonly state: string }): void => undefined,
        };
        const wait = new Promise<{ readonly code: string; readonly state: string }>((nextResolve, nextReject) => {
            pending.resolve = nextResolve;
            pending.reject  = nextReject;
        });
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            address !== null && typeof address !== 'string'
                ? resolve({ redirectUri: `http://127.0.0.1:${String(address.port)}/oauth/callback`, wait })
                : reject(new Error('oauth_listener_address_invalid'));
        });
    }),
});
const _postgresRuntime = Config.string(_POSTGRES.appPathKey).pipe(
    Config.withDefault(_POSTGRES.appPath),
    Config.map((appPath) => {
        const bin = join(appPath, 'Contents', 'Versions', 'latest', 'bin');
        const user = (process.env['USER'] ?? userInfo().username).trim();
        return {
            appPath,
            bin: {
                createdb:  join(bin, 'createdb'),
                initdb:    join(bin, 'initdb'),
                pgCtl:     join(bin, 'pg_ctl'),
                pgIsready: join(bin, 'pg_isready'),
                psql:      join(bin, 'psql'),
            },
            database: _POSTGRES.database,
            url:      `postgresql:///${_POSTGRES.database}?host=${encodeURIComponent(_POSTGRES_PATHS.run)}&user=${encodeURIComponent(user)}`,
            user,
        } as const;
    }),
);
const _bootstrapPostgres = Effect.gen(function* () {
    const [fs, runtime] = yield* Effect.all([FileSystem.FileSystem, _postgresRuntime]);
    yield* fs.exists(runtime.bin.initdb).pipe(
        Effect.filterOrFail(
            (exists) => exists,
            () => new HarnessHostError({
                message: `Postgres.app was not found at ${runtime.appPath}. Install Postgres.app or set ${_POSTGRES.appPathKey}.`,
                reason:  'postgres',
            }),
        ),
    );
    yield* Effect.forEach([KARGADAN_DIR, _POSTGRES.root, _POSTGRES_PATHS.log, _POSTGRES_PATHS.run], (path) => fs.makeDirectory(path, { recursive: true }), { discard: true });
    const initialized = yield* fs.exists(_POSTGRES_PATHS.data);
    yield* Effect.when(
        _exec(runtime.bin.initdb, ['-D', _POSTGRES_PATHS.data, '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--username', runtime.user]).pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Postgres cluster initialization failed.', reason: 'postgres' }))),
        () => !initialized,
    );
    const ready = yield* _exec(runtime.bin.pgIsready, ['-h', _POSTGRES_PATHS.run, '-d', 'postgres', '-U', runtime.user]).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
    );
    yield* Effect.when(
        _exec(runtime.bin.pgCtl, ['-D', _POSTGRES_PATHS.data, '-l', _POSTGRES_PATHS.logFile, '-w', 'start', '-o', `-h '' -k ${_POSTGRES_PATHS.run} -c unix_socket_permissions=0700`]).pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Postgres cluster start failed.', reason: 'postgres' }))),
        () => !ready,
    );
    const databaseExists = yield* _exec(runtime.bin.psql, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, '-d', 'postgres', '-Atqc', `SELECT 1 FROM pg_database WHERE datname='${runtime.database}'`]).pipe(
        Effect.map(({ stdout })  => stdout === '1'),
        Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Postgres database probe failed.', reason: 'postgres' })),
    );
    yield* Effect.when(
        _exec(runtime.bin.createdb, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, runtime.database]).pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Postgres database creation failed.', reason: 'postgres' }))),
        () => !databaseExists,
    );
    yield* _exec(runtime.bin.psql, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, '-d', runtime.database, '-v', 'ON_ERROR_STOP=1', '-c', 'CREATE EXTENSION IF NOT EXISTS vector;']).pipe(
        Effect.mapError((detail) => new HarnessHostError({ detail, message: 'pgvector extension enablement failed.', reason: 'postgres' })),
    );
    return runtime.url;
});
const decodeOverride = (selection: {
    readonly fallback: ReadonlyArray<string>;
    readonly model:    string;
    readonly provider: string;
}) =>
    selection.model === '' && selection.provider === ''
        ? Effect.succeed(Option.none<AiRegistry.SessionOverride>())
        : AiRegistry.decodeSessionOverride({
            language: { fallback: selection.fallback, model: selection.model, provider: selection.provider },
        }).pipe(Effect.map(Option.some));
const ConfigFile = {
    dir:     KARGADAN_DIR,
    flatten: (config: typeof KargadanConfigSchema.Type) => ((entries: ReadonlyArray<string>) => entries.length === 0 ? ['(empty)'] : entries)(_configEntries(config)),
    get:     (config: typeof KargadanConfigSchema.Type, key: string) => Option.getOrUndefined(_configAt(config, key)),
    keys:    Object.entries(_CONFIG_TREE).flatMap(([group, fields]) => Object.keys(fields).map((field) => `${group}.${field}`)),
    path:    CONFIG_PATH,
    read:    readConfig,
    runtime: { postgres: _POSTGRES_PATHS },
    set:     (config: typeof KargadanConfigSchema.Type, key: string, value: unknown) => _configPatch(config as Record<string, unknown>, key.split('.'), value) as typeof KargadanConfigSchema.Type,
    write:   writeConfig,
} as const;
const KargadanHost = {
    auth: {
        login: (input: { readonly clientPath?: string; readonly provider: AiRegistry.Provider; readonly secret?: string }) =>
            Match.value(AiRegistry.providerVocabulary[input.provider].credential.kind).pipe(
                Match.when('api-secret', () =>
                    Option.fromNullable(input.secret).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0), Option.match({
                        onNone: () => Effect.fail(new HarnessHostError({ message: `Credential value required for ${input.provider}.`, reason: 'auth' })),
                        onSome: (secret) => _exec('security', ['add-generic-password', '-U', '-a', _KEYCHAIN.accounts[input.provider], '-s', _KEYCHAIN.service, '-w', secret]).pipe(
                            Effect.as({ provider: input.provider } as const),
                            Effect.mapError((detail) => new HarnessHostError({ detail, message: `Keychain write failed for ${input.provider}.`, reason: 'keychain' }))),
                    }))),
                Match.orElse(() =>
                    Option.fromNullable(input.clientPath).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0), Option.match({
                        onNone: () => Effect.fail(new HarnessHostError({ message: 'Gemini desktop OAuth requires a client JSON path.', reason: 'auth' })),
                        onSome: (clientPath) => Effect.gen(function* () {
                            const [client, listener] = yield* Effect.all([_geminiClient(clientPath), _geminiCallback]);
                            const state = randomBytes(24).toString('hex');
                            const verifier = randomBytes(32).toString('base64url');
                            const authUrl = AiRegistry.geminiAuthorizationUrl({
                                client,
                                codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
                                redirectUri:   listener.redirectUri,
                                state,
                            });
                            yield* _exec('open', [authUrl.toString()]).pipe(
                                Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Browser launch failed for Gemini OAuth.', reason: 'auth' })),
                            );
                            const callback = yield* Effect.tryPromise({
                                catch: (detail) => new HarnessHostError({ detail, message: 'Gemini OAuth callback failed.', reason: 'auth' }),
                                try:   () => listener.wait,
                            }).pipe(
                                Effect.filterOrFail(
                                    (value) => value.state === state,
                                    () => new HarnessHostError({ message: 'Gemini OAuth state mismatch.', reason: 'auth' }),
                                ),
                                Effect.timeoutFail({
                                    duration: Duration.minutes(5),
                                    onTimeout: () => new HarnessHostError({ message: 'Gemini OAuth timed out after 5 minutes.', reason: 'auth' }),
                                }),
                            );
                            const session = yield* AiRegistry.exchangeGeminiAuthorizationCode({
                                client,
                                code:         callback.code,
                                codeVerifier: verifier,
                                redirectUri:  listener.redirectUri,
                            }).pipe(
                                Effect.filterOrFail(
                                    (value): value is typeof value & { readonly refreshToken: string } => value.refreshToken !== undefined && value.refreshToken.trim().length > 0,
                                    () => new HarnessHostError({ message: 'Gemini OAuth did not return a refresh token. Re-consent and try again.', reason: 'auth' }),
                                ),
                                Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Gemini OAuth token exchange failed.', reason: 'auth' })),
                            );
                            yield* _exec('security', ['add-generic-password', '-U', '-a', _KEYCHAIN.accounts.gemini, '-s', _KEYCHAIN.service, '-w',
                                JSON.stringify({ accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken })]).pipe(
                                Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Keychain write failed for Gemini OAuth.', reason: 'keychain' })),
                            );
                            return { provider: input.provider } as const;
                        }),
                    }))),
            ),
        logout: (provider?: AiRegistry.Provider) =>
            Effect.forEach(provider === undefined ? Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider> : [provider], (name) =>
                _exec('security', ['delete-generic-password', '-a', _KEYCHAIN.accounts[name], '-s', _KEYCHAIN.service]).pipe(Effect.catchAll(() => Effect.void)), { discard: true }),
        status: Effect.forEach(Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
            _keychainValue(provider).pipe(Effect.map((value) => ({
                enrolled: Option.isSome(value),
                kind:     AiRegistry.providerVocabulary[provider].credential.kind,
                provider,
            }))), { concurrency: 'unbounded' }),
    },
    postgres: {
        bootstrap:     _bootstrapPostgres,
        connectionUrl: _postgresRuntime.pipe(Effect.map((runtime) => runtime.url)),
    },
} as const;

class HarnessConfig extends Effect.Service<HarnessConfig>()('kargadan/HarnessConfig', {
    scoped: Effect.gen(function* () {
        const agentIntent               = yield* Config.string(_CONFIG_TREE.agent.intent).pipe(Config.withDefault('Summarize the active scene and apply the requested change.'));
        const appId                     = yield* Config.string('KARGADAN_APP_ID').pipe(Config.withDefault(Client.tenant.Id.system), Effect.flatMap(S.decodeUnknown(S.UUID)));
        const commandDeadlineMs         = yield* Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000));
        const commandManifestEntityType = yield* Config.string(_CONFIG_TREE.manifest.entityType).pipe(Config.withDefault('command'));
        const commandManifestJson       = yield* Config.string(_CONFIG_TREE.manifest.json).pipe(Config.withDefault(''));
        const commandManifestNamespace  = yield* Config.string(_CONFIG_TREE.manifest.namespace).pipe(Config.withDefault('kargadan'));
        const commandManifestScopeId    = yield* Config.string(_CONFIG_TREE.manifest.scopeId).pipe(
            Config.withDefault(''), Config.map((v) => v.trim()),
            Effect.flatMap((v) => v === '' ? Effect.succeed(Option.none()) : S.decodeUnknown(S.UUID)(v).pipe(Effect.map(Option.some))),
        );
        const commandManifestVersion    = yield* Config.string(_CONFIG_TREE.manifest.version).pipe(Config.withDefault(''));
        const compactionTargetPercent   = yield* Config.integer(_CONFIG_TREE.context.compactionTargetPercent).pipe(
            Config.withDefault(40),
            Effect.filterOrFail((n) => n >= 1 && n <= 95, () => new Error('compactionTargetPercent must be in [1, 95]')));
        const compactionTriggerPercent  = yield* Config.integer(_CONFIG_TREE.context.compactionTriggerPercent).pipe(
            Config.withDefault(75),
            Effect.filterOrFail((n) => n >= 5 && n <= 99, () => new Error('compactionTriggerPercent must be in [5, 99]')));
        const correctionCycles          = yield* Config.integer(_CONFIG_TREE.agent.correctionMaxCycles).pipe(Config.withDefault(1));
        const exportLimit               = yield* Config.integer('KARGADAN_SESSION_EXPORT_LIMIT').pipe(Config.withDefault(10_000));
        const heartbeatIntervalMs       = yield* Config.integer(_CONFIG_TREE.transport.heartbeatIntervalMs).pipe(Config.withDefault(5_000));
        const heartbeatTimeoutMs        = yield* Config.integer(_CONFIG_TREE.transport.heartbeatTimeoutMs).pipe(Config.withDefault(15_000));
        const protocolVersion           = yield* Config.string(_CONFIG_TREE.protocol.version).pipe(
            Config.withDefault('1.0'),
            Effect.map((v) => v.trim().split('.')),
            Effect.filterOrFail(
                (parts): parts is [string, string] => parts.length === 2 && parts.every((p) => /^\d+$/.test(p)),
                (parts) => new Error(`HarnessConfig/invalid_protocol_version: '${parts.join('.')}'`)),
            Effect.map(([major, minor]) => ({ major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) })));
        const reconnectBackoffBaseMs    = yield* Config.integer(_CONFIG_TREE.transport.reconnectBackoffBaseMs).pipe(Config.withDefault(500));
        const reconnectBackoffMaxMs     = yield* Config.integer(_CONFIG_TREE.transport.reconnectBackoffMaxMs).pipe(Config.withDefault(30_000));
        const reconnectMaxAttempts      = yield* Config.integer(_CONFIG_TREE.transport.reconnectMaxAttempts).pipe(Config.withDefault(50));
        const rhinoAppPath              = yield* Config.string(_CONFIG_TREE.rhino.appPath).pipe(Config.withDefault(''), Config.map((v) => v.trim()));
        const rhinoLaunchTimeoutMs      = yield* Config.integer(_CONFIG_TREE.rhino.launchTimeoutMs).pipe(Config.withDefault(45_000));
        const rhinoYakPath              = yield* Config.string(_CONFIG_TREE.rhino.yakPath).pipe(Config.withDefault(''), Config.map((v) => v.trim()));
        const resolveArchitectOverride  = yield* Effect.all({
            fallback: _csvConfig(Config.string(_CONFIG_TREE.ai.architectFallback).pipe(Config.withDefault(''))),
            model:    Config.string(_CONFIG_TREE.ai.architectModel).pipe(Config.withDefault(''),    Config.map((v) => v.trim())),
            provider: Config.string(_CONFIG_TREE.ai.architectProvider).pipe(Config.withDefault(''), Config.map((v) => v.trim())),
        }).pipe(Effect.flatMap(decodeOverride));
        const resolveCapabilities       = yield* Effect.all({
            optional: _csvConfig(Config.string(_CONFIG_TREE.capabilities.optional).pipe(Config.withDefault('view.capture'))),
            required: _csvConfig(Config.string(_CONFIG_TREE.capabilities.required).pipe(Config.withDefault('read.scene.summary,write.object.create'))),
        });
        const resolveLoopOperations     = yield* _csvConfig(Config.string(_CONFIG_TREE.agent.loopOperations).pipe(
            Config.withDefault(DEFAULT_LOOP_OPERATIONS.join(',')))).pipe(
            Effect.flatMap(S.decodeUnknown(S.Array(Operation))));
        const resolveSessionOverride    = yield* Effect.all({
            fallback: _csvConfig(Config.string(_CONFIG_TREE.ai.languageFallback).pipe(Config.withDefault(''))),
            model:    Config.string(_CONFIG_TREE.ai.languageModel).pipe(Config.withDefault(''),    Config.map((v) => v.trim())),
            provider: Config.string(_CONFIG_TREE.ai.languageProvider).pipe(Config.withDefault(''), Config.map((v) => v.trim())),
        }).pipe(Effect.flatMap(decodeOverride));
        const resolveWriteObjectRef     = yield* Effect.all({
            objectId:       Config.string(_CONFIG_TREE.agent.writeObjectId).pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
            sourceRevision: Config.integer(_CONFIG_TREE.agent.writeObjectSourceRevision).pipe(Config.withDefault(0)),
            typeTag:        Config.string(_CONFIG_TREE.agent.writeObjectTypeTag).pipe(Config.withDefault('Brep')),
        }).pipe(Effect.flatMap(S.decodeUnknown(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag }))));
        const retryMaxAttempts          = yield* Config.integer(_CONFIG_TREE.agent.retryMaxAttempts).pipe(Config.withDefault(5));
        const tokenExpiryMinutes        = yield* Config.integer(_CONFIG_TREE.protocol.tokenExpiryMinutes).pipe(Config.withDefault(15));
        const wsHost                    = yield* Config.string(_CONFIG_TREE.transport.wsHost).pipe(Config.withDefault('127.0.0.1'));
        return {
            agentIntent, appId, commandDeadlineMs, commandManifestEntityType, commandManifestJson, commandManifestNamespace, commandManifestScopeId,
            commandManifestVersion, compactionTargetPercent, compactionTriggerPercent, correctionCycles, exportLimit,
            heartbeatIntervalMs, heartbeatTimeoutMs, initialSequence: 1_000_000,
            maskedKeys: new Set(['brep', 'breps', 'edges', 'faces', 'geometry', 'mesh', 'meshes', 'nurbs', 'points', 'vertices']),
            protocolVersion, reconnectBackoffBaseMs, reconnectBackoffMaxMs, reconnectMaxAttempts, resolveArchitectOverride, resolveCapabilities,
            resolveLoopOperations, resolveSessionOverride, resolveWriteObjectRef, retryMaxAttempts, rhinoAppPath, rhinoLaunchTimeoutMs, rhinoYakPath,
            sessionToken: randomBytes(24).toString('hex'), tokenExpiryMinutes,
            truncation:  { arrayDepth: 2, arrayItems: 12, maxLength: 280, objectDepth: 3, objectFields: 24, summaryLength: 140 } as const,
            viewCapture: { dpi: 144, height: 900, realtimePasses: 2, transparentBackground: false, width: 1600 } as const,
            wsHost,
        } as const;
    }),
}) {
    static readonly persistenceLayer = Layer.unwrapEffect(Effect.gen(function* () {
        const [connectTimeout, idleTimeout, maxConnections, overrideUrl] = yield* Effect.all([
            Config.duration(_CONFIG_TREE.database.connectTimeout).pipe(Config.withDefault(Duration.seconds(10))),
            Config.duration(_CONFIG_TREE.database.idleTimeout).pipe(Config.withDefault(Duration.seconds(30))),
            Config.integer(_CONFIG_TREE.database.maxConnections).pipe(Config.withDefault(5)),
            Config.redacted(_CONFIG_TREE.database.url).pipe(Config.option),
        ]);
        const url = yield* Option.match(overrideUrl, {
            onNone: () => KargadanHost.postgres.bootstrap.pipe(Effect.map(Redacted.make)),
            onSome: Effect.succeed,
        });
        return AgentPersistenceLayer({
            connectTimeout: Config.succeed(connectTimeout),
            idleTimeout:    Config.succeed(idleTimeout),
            maxConnections: Config.succeed(maxConnections),
            url:            Config.succeed(url),
        }).pipe(Layer.tap((ctx) => KargadanMigration.run().pipe(
            Effect.provideService(SqlClient.SqlClient, Ctx.get(ctx, SqlClient.SqlClient)),
        )));
    }));
}

// --- [EXPORT] ----------------------------------------------------------------

export {
    ConfigFile, decodeOverride, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanHost,
    loadConfigProvider, PORT_FILE_PATH, PROVIDER_VOCABULARY,
};
