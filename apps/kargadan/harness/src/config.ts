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
import { Config, ConfigProvider, Context as Ctx, Data, Duration, Effect, Layer, Match, Option, Redacted, Ref, Schema as S, pipe } from 'effect';
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
const _KARGADAN_DIR = join(homedir(), '.kargadan');
const [_CONFIG_PATH, PORT_FILE_PATH] = [join(_KARGADAN_DIR, 'config.json'), join(_KARGADAN_DIR, 'port')];
const _KEYCHAIN = { accounts: { anthropic: 'ai.anthropic', gemini: 'ai.gemini', openai: 'ai.openai' }, service: 'com.parametricportal.kargadan' } as const;
const _POSTGRES = { appPath: '/Applications/Postgres.app', appPathKey: 'KARGADAN_POSTGRES_APP_PATH', database: 'kargadan', root: join(_KARGADAN_DIR, 'postgres', '18') } as const;
const _POSTGRES_PATHS = { data: join(_POSTGRES.root, 'data'), log: join(_POSTGRES.root, 'log'), logFile: join(_POSTGRES.root, 'log', 'postgresql.log'), run: join(_POSTGRES.root, 'run') } as const;
const _CONFIG_TREE = {
    agent:        { correctionMaxCycles:       'KARGADAN_CORRECTION_MAX_CYCLES',        intent:             'KARGADAN_AGENT_INTENT',
                    loopOperations:            'KARGADAN_LOOP_OPERATIONS',              retryMaxAttempts:   'KARGADAN_RETRY_MAX_ATTEMPTS',
                    writeObjectId:             'KARGADAN_WRITE_OBJECT_ID',
                    writeObjectSourceRevision: 'KARGADAN_WRITE_OBJECT_SOURCE_REVISION', writeObjectTypeTag: 'KARGADAN_WRITE_OBJECT_TYPE_TAG' },
    ai:           { architectFallback:         'KARGADAN_AI_ARCHITECT_FALLBACK',        architectModel:     'KARGADAN_AI_ARCHITECT_MODEL',
                    architectProvider:         'KARGADAN_AI_ARCHITECT_PROVIDER',        geminiClientPath:   AiRegistry.providerVocabulary.gemini.credential.clientPathKey,
                    languageFallback:          'KARGADAN_AI_LANGUAGE_FALLBACK',         languageModel:      'KARGADAN_AI_LANGUAGE_MODEL',
                    languageProvider:          'KARGADAN_AI_LANGUAGE_PROVIDER' },
    capabilities: { optional:                  'KARGADAN_CAP_OPTIONAL',                 required:           'KARGADAN_CAP_REQUIRED' },
    context:      { compactionTargetPercent:   'KARGADAN_CONTEXT_COMPACTION_TARGET_PERCENT', compactionTriggerPercent: 'KARGADAN_CONTEXT_COMPACTION_TRIGGER_PERCENT' },
    database:     { connectTimeout:            'KARGADAN_PG_CONNECT_TIMEOUT',           idleTimeout:        'KARGADAN_PG_IDLE_TIMEOUT',
                    maxConnections:            'KARGADAN_PG_MAX_CONNECTIONS',           url:                'KARGADAN_CHECKPOINT_DATABASE_URL' },
    manifest:     { entityType:                'KARGADAN_COMMAND_MANIFEST_ENTITY_TYPE', json:               'KARGADAN_COMMAND_MANIFEST_JSON',
                    namespace:                 'KARGADAN_COMMAND_MANIFEST_NAMESPACE',   scopeId:            'KARGADAN_COMMAND_MANIFEST_SCOPE_ID',
                    version:                   'KARGADAN_COMMAND_MANIFEST_VERSION' },
    protocol:     { tokenExpiryMinutes:        'KARGADAN_TOKEN_EXPIRY_MINUTES',         version:            'KARGADAN_PROTOCOL_VERSION' },
    rhino:        { appPath:                   'KARGADAN_RHINO_APP_PATH',               launchTimeoutMs:    'KARGADAN_RHINO_LAUNCH_TIMEOUT_MS',
                    yakPath:                   'KARGADAN_YAK_PATH' },
    transport:    { heartbeatIntervalMs:       'KARGADAN_HEARTBEAT_INTERVAL_MS',        heartbeatTimeoutMs:    'KARGADAN_HEARTBEAT_TIMEOUT_MS',
                    reconnectBackoffBaseMs:    'KARGADAN_RECONNECT_BACKOFF_BASE_MS',    reconnectBackoffMaxMs: 'KARGADAN_RECONNECT_BACKOFF_MAX_MS',
                    reconnectMaxAttempts:      'KARGADAN_RECONNECT_MAX_ATTEMPTS',       wsHost:                'KARGADAN_WS_HOST' },
} as const satisfies Record<string, Record<string, string>>;

// --- [ERRORS] ----------------------------------------------------------------

class HarnessHostError extends Data.TaggedError('HarnessHostError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  'auth' | 'config' | 'keychain' | 'postgres';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _csvConfig = (config: Config.Config<string>, fallback = '') =>
    config.pipe(Config.withDefault(fallback), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean)));
const _trimmed = (key: string, fallback = '') => Config.string(key).pipe(Config.withDefault(fallback), Config.map((v) => v.trim()));
const _readConfigFile = pipe(
    FileSystem.FileSystem,
    Effect.flatMap((fs) => fs.makeDirectory(_KARGADAN_DIR, { recursive: true }).pipe(Effect.zipRight(fs.readFileString(_CONFIG_PATH)))),
    Effect.flatMap(S.decode(S.parseJson(KargadanConfigSchema))),
);
const _exec = (command: string, args: ReadonlyArray<string>, options?: { readonly input?: string }) => Effect.tryPromise({
    catch: (cause) => cause,
    try:   () => _execFile(command, [...args], { encoding: 'utf8', ...(options?.input === undefined ? {} : { input: options.input }) }),
}).pipe(Effect.map(({ stderr, stdout }) => ({ stderr: stderr.trim(), stdout: stdout.trim() })));
const _keychainValue = (provider: AiRegistry.Provider) =>
    _exec('security', ['find-generic-password', '-a', _KEYCHAIN.accounts[provider], '-s', _KEYCHAIN.service, '-w']).pipe(
        Effect.map(({ stdout }) => Option.some(stdout)), Effect.catchAll(() => Effect.succeed(Option.none<string>())));
const _writeKeychain = (provider: AiRegistry.Provider, value: string) =>
    _exec('security', ['add-generic-password', '-U', '-a', _KEYCHAIN.accounts[provider], '-s', _KEYCHAIN.service, '-w', value]).pipe(
        Effect.mapError((detail) => new HarnessHostError({ detail, message: `Keychain write failed for ${provider}.`, reason: 'keychain' })));
const _keychainDecodeFailures = Ref.unsafeMake<ReadonlyArray<{ readonly error: string; readonly provider: AiRegistry.Provider }>>([] as const);
const _keychainPairs = Effect.forEach(Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
    _keychainValue(provider).pipe(Effect.flatMap(Option.match({
        onNone: () => Effect.succeed([] as ReadonlyArray<readonly [string, string]>),
        onSome: (value) => Match.value(provider).pipe(
            Match.when('gemini', () => { const _c = AiRegistry.providerVocabulary.gemini.credential; return S.decodeUnknown(_GeminiSessionSchema)(value).pipe(Effect.map((s) =>
                [[_c.accessTokenKey, s.accessToken], [_c.refreshTokenKey, s.refreshToken], [_c.expiryKey, s.expiresAt]] as ReadonlyArray<readonly [string, string]>)); }),
            Match.orElse((name) => Effect.succeed([[AiRegistry.providerVocabulary[name].credential.key, value]] as ReadonlyArray<readonly [string, string]>)),
        ).pipe(Effect.catchAll((detail) => Ref.update(_keychainDecodeFailures, (prev) => [...prev, { error: String(detail), provider }]).pipe(
            Effect.as([] as ReadonlyArray<readonly [string, string]>)))),
    }))), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
const loadConfigProvider = Effect.all([
    _readConfigFile.pipe(
        Effect.map((config) => Object.entries(_CONFIG_TREE).flatMap(([group, fields]) =>
            Object.entries(fields).flatMap(([field, envKey]) =>
                Option.fromNullable((config as Record<string, Record<string, unknown> | undefined>)[group]?.[field]).pipe(
                    Option.match({ onNone: () => [] as ReadonlyArray<readonly [string, string]>, onSome: (value) => [[envKey, String(value)] as const] }))))),
        Effect.option, Effect.map(Option.getOrElse(() => [] as ReadonlyArray<readonly [string, string]>))),
    _keychainPairs,
]).pipe(Effect.map(([filePairs, keychainPairs]) =>
    ConfigProvider.orElse(ConfigProvider.fromEnv(), () => ConfigProvider.fromMap(new Map([...filePairs, ...keychainPairs])))));
const _readConfig = _readConfigFile.pipe(Effect.option, Effect.map(Option.getOrElse(() => ({} as typeof KargadanConfigSchema.Type))));
const _writeConfig = (config: typeof KargadanConfigSchema.Type) =>
    Effect.all([FileSystem.FileSystem, S.decodeUnknown(KargadanConfigSchema)(config).pipe(
        Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Config write rejected invalid or secret fields.', reason: 'config' })))]).pipe(
        Effect.flatMap(([fs, normalized]) => fs.makeDirectory(_KARGADAN_DIR, { recursive: true }).pipe(
            Effect.zipRight(fs.writeFileString(_CONFIG_PATH, JSON.stringify(normalized, null, 2))))));
const _configAt = (node: unknown, key: string) => key.split('.').reduce((current, segment) => Option.flatMap(current, (value) =>
    value !== null && typeof value === 'object' ? Option.fromNullable((value as Record<string, unknown>)[segment]) : Option.none()), Option.some(node));
const _configEntries = (node: unknown, prefix = ''): ReadonlyArray<string> => node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => _configEntries(value, prefix === '' ? key : `${prefix}.${key}`))
    : [`${prefix} = ${String(node)}`];
const _configPatch = (target: Record<string, unknown>, path: ReadonlyArray<string>, value: unknown): Record<string, unknown> =>
    ((key: string) => path.length === 1 ? { ...target, [key]: value } : { ...target, [key]: _configPatch(
        typeof target[key] === 'object' && target[key] !== null ? target[key] as Record<string, unknown> : {}, path.slice(1), value) })(path[0] as string);
const _authErr = (message: string) => (detail: unknown) => new HarnessHostError({ detail, message, reason: 'auth' as const });
const _pgExec = (bin: string, args: ReadonlyArray<string>, label: string) =>
    _exec(bin, args).pipe(Effect.mapError((detail) => new HarnessHostError({ detail, message: label, reason: 'postgres' })));
const _geminiClient = (clientPath: string) =>
    Effect.try({
        catch: _authErr(`Gemini OAuth client file is unreadable: ${clientPath}`),
        try:   () => readFileSync(clientPath, 'utf8'),
    }).pipe(Effect.flatMap(AiRegistry.decodeGeminiClient), Effect.mapError((detail) =>
        detail instanceof HarnessHostError ? detail : _authErr(`Gemini OAuth client file is invalid: ${clientPath}`)(detail)));
const _geminiCallback = Effect.acquireRelease(
    Effect.tryPromise({
        catch: _authErr('Gemini desktop OAuth listener could not start.'),
        try:   () => new Promise<{ readonly close: () => void; readonly redirectUri: string; readonly wait: Promise<{ readonly code: string; readonly state: string }> }>((resolve, reject) => {
            const deferred = Promise.withResolvers<{ readonly code: string; readonly state: string }>();
            const server = createServer((req, res) => {
                const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(req.socket.localPort ?? 0)}`);
                const [code, state] = [url.searchParams.get('code'), url.searchParams.get('state')];
                const [statusCode, body, settle] = code !== null && state !== null
                    ? [200, 'Kargadan authorization complete. You can close this window.',      () => deferred.resolve({ code, state })] as const
                    : [400, 'Kargadan authorization failed. Return to Kargadan and try again.', () => deferred.reject(new Error('oauth_callback_missing_code_or_state'))] as const;
                res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' }).end(body, settle);
            });
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                address !== null && typeof address !== 'string'
                    ? resolve({ close: () => server.close(), redirectUri: `http://127.0.0.1:${String(address.port)}/oauth/callback`, wait: deferred.promise })
                    : reject(new Error('oauth_listener_address_invalid'));
            });
        }),
    }), (listener) => Effect.sync(listener.close));
const _postgresRuntime = Config.string(_POSTGRES.appPathKey).pipe(Config.withDefault(_POSTGRES.appPath), Config.map((appPath) => {
    const bin = join(appPath, 'Contents', 'Versions', 'latest', 'bin');
    const user = (process.env['USER'] ?? userInfo().username).trim();
    return { appPath,
        bin: { createdb: join(bin, 'createdb'), initdb: join(bin, 'initdb'), pgCtl: join(bin, 'pg_ctl'), pgIsready: join(bin, 'pg_isready'), psql: join(bin, 'psql') },database: _POSTGRES.database,
        url: `postgresql:///${_POSTGRES.database}?host=${encodeURIComponent(_POSTGRES_PATHS.run)}&user=${encodeURIComponent(user)}`, user} as const;
}));
const _bootstrapPostgres = Effect.gen(function* () {
    const [fs, runtime] = yield* Effect.all([FileSystem.FileSystem, _postgresRuntime]);
    yield* fs.exists(runtime.bin.initdb).pipe(Effect.filterOrFail((exists) => exists, () =>
        new HarnessHostError({ message: `Postgres.app was not found at ${runtime.appPath}. Install Postgres.app or set ${_POSTGRES.appPathKey}.`, reason: 'postgres' })));
    yield* Effect.forEach([_KARGADAN_DIR, _POSTGRES.root, _POSTGRES_PATHS.log, _POSTGRES_PATHS.run], (path) => fs.makeDirectory(path, { recursive: true }), { discard: true });
    const initialized = yield* fs.exists(_POSTGRES_PATHS.data);
    yield* Effect.when(_pgExec(runtime.bin.initdb, ['-D', _POSTGRES_PATHS.data, '--auth-local=trust', '--auth-host=scram-sha-256', '--encoding=UTF8', '--username', runtime.user],
        'Postgres cluster initialization failed.'), () => !initialized);
    const ready = yield* _exec(runtime.bin.pgIsready, ['-h', _POSTGRES_PATHS.run, '-d', 'postgres', '-U', runtime.user]).pipe(Effect.as(true), Effect.catchAll(() => Effect.succeed(false)));
    yield* Effect.when(_pgExec(runtime.bin.pgCtl, ['-D', _POSTGRES_PATHS.data, '-l', _POSTGRES_PATHS.logFile, '-w', 'start', '-o',
        `-h '' -k ${_POSTGRES_PATHS.run} -c unix_socket_permissions=0700`], 'Postgres cluster start failed.'), () => !ready);
    const databaseExists = yield* _pgExec(runtime.bin.psql, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, '-d', 'postgres', '-Atqc',
        `SELECT 1 FROM pg_database WHERE datname='${runtime.database}'`], 'Postgres database probe failed.').pipe(Effect.map(({ stdout }) => stdout === '1'));
    yield* Effect.when(_pgExec(runtime.bin.createdb, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, runtime.database], 'Postgres database creation failed.'), () => !databaseExists);
    yield* _pgExec(runtime.bin.psql, ['-h', _POSTGRES_PATHS.run, '-U', runtime.user, '-d', runtime.database, '-v', 'ON_ERROR_STOP=1', '-c',
        'CREATE EXTENSION IF NOT EXISTS vector;'], 'pgvector extension enablement failed.');
    return runtime.url;
});
type _Cfg = typeof KargadanConfigSchema.Type;
const ConfigFile = {
    dir: _KARGADAN_DIR, 
    flatten: (config: _Cfg) => ((entries: ReadonlyArray<string>) => entries.length === 0 ? ['(empty)'] : entries)(_configEntries(config)),
    get:     (config: _Cfg, key: string) => Option.getOrUndefined(_configAt(config, key)),
    keys:    Object.entries(_CONFIG_TREE).flatMap(([group, fields]) => Object.keys(fields).map((field) => `${group}.${field}`)),path: _CONFIG_PATH, read: _readConfig, runtime: { postgres: _POSTGRES_PATHS },
    set:     (config: _Cfg, key: string, value: unknown) => _configPatch(config as Record<string, unknown>, key.split('.'), value) as _Cfg,write: _writeConfig,
} as const;
const KargadanHost = {
    auth: {
        login: (input: { readonly clientPath?: string; readonly provider: AiRegistry.Provider; readonly secret?: string }) =>
            Match.value(AiRegistry.providerVocabulary[input.provider].credential.kind).pipe(
                Match.when('api-secret', () =>
                    Option.fromNullable(input.secret).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0), Option.match({
                        onNone: () => Effect.fail(new HarnessHostError({ message: `Credential value required for ${input.provider}.`, reason: 'auth' })),
                        onSome: (secret) => _writeKeychain(input.provider, secret).pipe(Effect.as({ provider: input.provider } as const)),
                    }))),
                Match.orElse(() =>
                    Option.fromNullable(input.clientPath).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0), Option.match({
                        onNone: () => Effect.fail(new HarnessHostError({ message: 'Gemini desktop OAuth requires a client JSON path.', reason: 'auth' })),
                        onSome: (clientPath) => Effect.scoped(Effect.all([_geminiClient(clientPath), _geminiCallback]).pipe(
                            Effect.flatMap(([client, listener]) => {
                                const [state, verifier] = [randomBytes(24).toString('hex'), randomBytes(32).toString('base64url')];
                                const authUrl = AiRegistry.geminiAuthorizationUrl({
                                    client, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: listener.redirectUri, state });
                                return _exec('open', [authUrl.toString()]).pipe(
                                    Effect.mapError(_authErr('Browser launch failed for Gemini OAuth.')),
                                    Effect.zipRight(Effect.tryPromise({ catch: _authErr('Gemini OAuth callback failed.'), try: () => listener.wait }).pipe(
                                        Effect.filterOrFail((value) => value.state === state,
                                            () => new HarnessHostError({ message: 'Gemini OAuth state mismatch.', reason: 'auth' })),
                                        Effect.timeoutFail({ duration: Duration.minutes(5),
                                            onTimeout: () => new HarnessHostError({ message: 'Gemini OAuth timed out after 5 minutes.', reason: 'auth' }) }))),
                                    Effect.flatMap((callback) => AiRegistry.exchangeGeminiAuthorizationCode({
                                        client, code: callback.code, codeVerifier: verifier, redirectUri: listener.redirectUri }).pipe(
                                        Effect.filterOrFail(
                                            (value): value is typeof value & { readonly refreshToken: string } => value.refreshToken !== undefined && value.refreshToken.trim().length > 0,
                                            () => new HarnessHostError({ message: 'Gemini OAuth did not return a refresh token. Re-consent and try again.', reason: 'auth' })),
                                        Effect.mapError(_authErr('Gemini OAuth token exchange failed.')))),
                                    Effect.tap((session) => _writeKeychain('gemini', JSON.stringify({
                                        accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken }))),
                                    Effect.as({ provider: input.provider } as const));
                            }))),
                    }))),
            ),
        logout: (provider?: AiRegistry.Provider) =>
            Effect.forEach(provider === undefined ? Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider> : [provider], (name) =>
                _exec('security', ['delete-generic-password', '-a', _KEYCHAIN.accounts[name], '-s', _KEYCHAIN.service]).pipe(Effect.catchAll(() => Effect.void)), { discard: true }),
        onTokenRefresh: (data: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken: string }) =>
            _writeKeychain('gemini', JSON.stringify(data)).pipe(Effect.ignore),
        status: Ref.get(_keychainDecodeFailures).pipe(Effect.flatMap((failures) => {
            const failuresByProvider = new Map(failures.map((f) => [f.provider, f.error]));
            return Effect.forEach(Object.keys(AiRegistry.providerVocabulary) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
                _keychainValue(provider).pipe(Effect.map((value) => ({
                    decodeError: Option.fromNullable(failuresByProvider.get(provider)),
                    enrolled:    Option.isSome(value),
                    kind:        AiRegistry.providerVocabulary[provider].credential.kind,
                    provider,
                }))), { concurrency: 'unbounded' }); })),
    },
    postgres: {
        bootstrap:     _bootstrapPostgres,
        connectionUrl: _postgresRuntime.pipe(Effect.map((runtime) => runtime.url)),
    },
} as const;

class HarnessConfig extends Effect.Service<HarnessConfig>()('kargadan/HarnessConfig', {
    scoped: Effect.gen(function* () {
        const {
            commandDeadlineMs,         compactionTargetPercent, compactionTriggerPercent, correctionCycles,      exportLimit,
            heartbeatIntervalMs,       heartbeatTimeoutMs,      reconnectBackoffBaseMs,   reconnectBackoffMaxMs, reconnectMaxAttempts,
            retryMaxAttempts,          rhinoLaunchTimeoutMs,    tokenExpiryMinutes } = yield* Effect.all({
            commandDeadlineMs:         Config.integer('KARGADAN_COMMAND_DEADLINE_MS').pipe(Config.withDefault(5_000)),
            compactionTargetPercent:   Config.integer(_CONFIG_TREE.context.compactionTargetPercent).pipe(Config.withDefault(40)),
            compactionTriggerPercent:  Config.integer(_CONFIG_TREE.context.compactionTriggerPercent).pipe(Config.withDefault(75)),
            correctionCycles:          Config.integer(_CONFIG_TREE.agent.correctionMaxCycles).pipe(Config.withDefault(1)),
            exportLimit:               Config.integer('KARGADAN_SESSION_EXPORT_LIMIT').pipe(Config.withDefault(10_000)),
            heartbeatIntervalMs:       Config.integer(_CONFIG_TREE.transport.heartbeatIntervalMs).pipe(Config.withDefault(5_000)),
            heartbeatTimeoutMs:        Config.integer(_CONFIG_TREE.transport.heartbeatTimeoutMs).pipe(Config.withDefault(15_000)),
            reconnectBackoffBaseMs:    Config.integer(_CONFIG_TREE.transport.reconnectBackoffBaseMs).pipe(Config.withDefault(500)),
            reconnectBackoffMaxMs:     Config.integer(_CONFIG_TREE.transport.reconnectBackoffMaxMs).pipe(Config.withDefault(30_000)),
            reconnectMaxAttempts:      Config.integer(_CONFIG_TREE.transport.reconnectMaxAttempts).pipe(Config.withDefault(50)),
            retryMaxAttempts:          Config.integer(_CONFIG_TREE.agent.retryMaxAttempts).pipe(Config.withDefault(5)),
            rhinoLaunchTimeoutMs:      Config.integer(_CONFIG_TREE.rhino.launchTimeoutMs).pipe(Config.withDefault(45_000)),
            tokenExpiryMinutes:        Config.integer(_CONFIG_TREE.protocol.tokenExpiryMinutes).pipe(Config.withDefault(15)),
        });
        const {
            agentIntent,               commandManifestEntityType, commandManifestJson, commandManifestNamespace,
            commandManifestVersion,    rhinoAppPath,              rhinoYakPath,        wsHost } = yield* Effect.all({
            agentIntent:               Config.string(_CONFIG_TREE.agent.intent).pipe(Config.withDefault('Summarize the active scene and apply the requested change.')),
            commandManifestEntityType: Config.string(_CONFIG_TREE.manifest.entityType).pipe(Config.withDefault('command')),
            commandManifestJson:       Config.string(_CONFIG_TREE.manifest.json).pipe(Config.withDefault('')),
            commandManifestNamespace:  Config.string(_CONFIG_TREE.manifest.namespace).pipe(Config.withDefault('kargadan')),
            commandManifestVersion:    Config.string(_CONFIG_TREE.manifest.version).pipe(Config.withDefault('')),
            rhinoAppPath:              _trimmed(_CONFIG_TREE.rhino.appPath),
            rhinoYakPath:              _trimmed(_CONFIG_TREE.rhino.yakPath),
            wsHost:                    Config.string(_CONFIG_TREE.transport.wsHost).pipe(Config.withDefault('127.0.0.1')),
        });
        yield* Effect.all([
            Effect.filterOrFail(Effect.succeed(compactionTargetPercent), (n) => n >= 1 && n <= 95, () => new Error('compactionTargetPercent must be in [1, 95]')),
            Effect.filterOrFail(Effect.succeed(compactionTriggerPercent), (n) => n >= 5 && n <= 99, () => new Error('compactionTriggerPercent must be in [5, 99]'))]);
        const appId = yield* Config.string('KARGADAN_APP_ID').pipe(Config.withDefault(Client.tenant.Id.system), Effect.flatMap(S.decodeUnknown(S.UUID)));
        const commandManifestScopeId = yield* _trimmed(_CONFIG_TREE.manifest.scopeId).pipe(
            Effect.flatMap((v) => v === '' ? Effect.succeed(Option.none()) : S.decodeUnknown(S.UUID)(v).pipe(Effect.map(Option.some))));
        const protocolVersion = yield* Config.string(_CONFIG_TREE.protocol.version).pipe(Config.withDefault('1.0'), Effect.map((v) => v.trim().split('.')),
            Effect.filterOrFail((parts): parts is [string, string] => parts.length === 2 && parts.every((p) => /^\d+$/.test(p)),
                (parts) => new Error(`HarnessConfig/invalid_protocol_version: '${parts.join('.')}'`)),
            Effect.map(([major, minor]) => ({ major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) })));
        const _overrideInput = (fb: string, mod: string, prov: string) => Effect.all({
            fallback: _csvConfig(Config.string(fb)), model: _trimmed(mod), provider: _trimmed(prov),
        }).pipe(Effect.flatMap(AiRegistry.decodeSessionOverrideFromInput));
        const resolveArchitectOverride = yield* _overrideInput(_CONFIG_TREE.ai.architectFallback, _CONFIG_TREE.ai.architectModel, _CONFIG_TREE.ai.architectProvider);
        const resolveCapabilities = yield* Effect.all({
            optional: _csvConfig(Config.string(_CONFIG_TREE.capabilities.optional), 'view.capture'),
            required: _csvConfig(Config.string(_CONFIG_TREE.capabilities.required), 'read.scene.summary,write.object.create') });
        const resolveLoopOperations = yield* _csvConfig(Config.string(_CONFIG_TREE.agent.loopOperations),
            DEFAULT_LOOP_OPERATIONS.join(',')).pipe(Effect.flatMap(S.decodeUnknown(S.Array(Operation))));
        const resolveSessionOverride = yield* _overrideInput(_CONFIG_TREE.ai.languageFallback, _CONFIG_TREE.ai.languageModel, _CONFIG_TREE.ai.languageProvider);
        const resolveWriteObjectRef = yield* Effect.all({
            objectId: Config.string(_CONFIG_TREE.agent.writeObjectId).pipe(Config.withDefault('00000000-0000-0000-0000-000000000100')),
            sourceRevision: Config.integer(_CONFIG_TREE.agent.writeObjectSourceRevision).pipe(Config.withDefault(0)),
            typeTag: Config.string(_CONFIG_TREE.agent.writeObjectTypeTag).pipe(Config.withDefault('Brep')),
        }).pipe(Effect.flatMap(S.decodeUnknown(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag }))));
        return { agentIntent, appId, commandDeadlineMs, commandManifestEntityType, commandManifestJson, commandManifestNamespace,
            commandManifestScopeId, commandManifestVersion, compactionTargetPercent, compactionTriggerPercent, correctionCycles, exportLimit,
            heartbeatIntervalMs, heartbeatTimeoutMs, initialSequence: 1_000_000, 
            maskedKeys: new Set(['brep', 'breps', 'edges', 'faces', 'geometry', 'mesh', 'meshes', 'nurbs', 'points', 'vertices']),protocolVersion, reconnectBackoffBaseMs, reconnectBackoffMaxMs,
            reconnectMaxAttempts, resolveArchitectOverride, resolveCapabilities, resolveLoopOperations, resolveSessionOverride, resolveWriteObjectRef,
            retryMaxAttempts, rhinoAppPath, rhinoLaunchTimeoutMs, rhinoYakPath, sessionToken: randomBytes(24).toString('hex'), tokenExpiryMinutes,
            truncation: { arrayDepth: 2, arrayItems: 12, maxLength: 280, objectDepth: 3, objectFields: 24, summaryLength: 140 } as const,
            viewCapture: { dpi: 144, height: 900, realtimePasses: 2, transparentBackground: false, width: 1600 } as const, wsHost} as const;
    }),
}) {
    static readonly persistenceLayer = Layer.unwrapEffect(Effect.all([
        Config.duration(_CONFIG_TREE.database.connectTimeout).pipe(Config.withDefault(Duration.seconds(10))),
        Config.duration(_CONFIG_TREE.database.idleTimeout).pipe(Config.withDefault(Duration.seconds(30))),
        Config.integer(_CONFIG_TREE.database.maxConnections).pipe(Config.withDefault(5)),
        Config.redacted(_CONFIG_TREE.database.url).pipe(Config.option),
    ]).pipe(Effect.flatMap(([connectTimeout, idleTimeout, maxConnections, overrideUrl]) =>
        Option.match(overrideUrl, { onNone: () => KargadanHost.postgres.bootstrap.pipe(Effect.map((url): string => url), Effect.map(Redacted.make)), onSome: Effect.succeed }).pipe(
            Effect.map((url) => AgentPersistenceLayer({
                connectTimeout: Config.succeed(connectTimeout), idleTimeout: Config.succeed(idleTimeout),
                maxConnections: Config.succeed(maxConnections), url: Config.succeed(url),
            }).pipe(Layer.tap((ctx) => KargadanMigration.run().pipe(
                Effect.provideService(SqlClient.SqlClient, Ctx.get(ctx, SqlClient.SqlClient))))))))));
}

// --- [EXPORT] ----------------------------------------------------------------

export { ConfigFile, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanHost, loadConfigProvider, PORT_FILE_PATH };
