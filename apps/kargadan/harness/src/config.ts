import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { GeminiOAuth } from '@parametric-portal/ai/runtime-provider';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceLayer } from '@parametric-portal/database/agent-persistence';
import { Client, type ClientConfig } from '@parametric-portal/database/client';
import { Config, ConfigProvider, Context as Ctx, Data, Duration, Effect, HashMap, Layer, Match, Option, Redacted, Ref, Schema as S, pipe } from 'effect';
import { KargadanPostgres, shellExec } from './postgres';
import { DEFAULT_LOOP_OPERATIONS, kargadanToolCallProjector, Operation } from './protocol/schemas';

// --- [SCHEMA] ----------------------------------------------------------------

const KargadanConfigSchema = S.Struct({
    ai:       S.optional(S.Struct({geminiClientPath: S.optional(S.String),})),
    rhino:    S.optional(S.Struct({
        appPath: S.optional(S.String),
        yakPath: S.optional(S.String),
    })),
});
const _PersistedKargadanConfigSchema = S.Struct({
    ai:       S.optional(S.Struct({geminiClientPath: S.optional(S.String),})),
    rhino:    S.optional(S.Struct({
        appPath: S.optional(S.String),
        yakPath: S.optional(S.String),
    })),
});
const _GeminiSessionSchema = S.parseJson(S.Struct({
    accessToken:  S.NonEmptyTrimmedString,
    expiresAt:    S.String,
    refreshToken: S.NonEmptyTrimmedString,
}));

type _DecodeFailure = { readonly error: string; readonly provider: AiRegistry.Provider };
type _Cfg = typeof KargadanConfigSchema.Type;

// --- [CONSTANTS] -------------------------------------------------------------

const _KARGADAN_DIR = join(homedir(), '.kargadan');
const [_CONFIG_PATH, PORT_FILE_PATH] = [join(_KARGADAN_DIR, 'config.json'), join(_KARGADAN_DIR, 'port')];
const _KEYCHAIN = {
    accounts: {
        gemini: 'ai.gemini',
        openai: 'ai.openai',
    },
    service: 'com.parametricportal.kargadan',
} as const;
const _POSTGRES_ROOT = join(_KARGADAN_DIR, 'postgres', '18');
const _INTERNALS = {
    commandDeadlineMs:      5_000,  compactionTargetPercent: 40,    compactionTriggerPercent: 75,     correctionCycles:       1,
    exportLimit:            10_000, heartbeatIntervalMs:     5_000, heartbeatTimeoutMs:       15_000, reconnectBackoffBaseMs: 500,
    reconnectBackoffMaxMs:  30_000, reconnectMaxAttempts:    50,    retryMaxAttempts:         5,
    writeApprovalTimeoutMs: 300_000,
} as const;
const _CAPABILITIES = {
    optional: ['view.capture'],
    required: [
        'read.scene.summary',   'read.object.list',    'read.object.metadata', 'read.object.geometry', 'read.layer.state', 'read.view.state',
        'read.tolerance.units', 'write.object.create', 'write.object.update',  'write.object.delete',  'write.selection'
    ],
} as const;
const _CONFIG_VOCABULARY = {
    postgres: {
        connectTimeout: { runtime: 'KARGADAN_PG_CONNECT_TIMEOUT' },
        idleTimeout:    { runtime: 'KARGADAN_PG_IDLE_TIMEOUT' },
        maxConnections: { runtime: 'KARGADAN_PG_MAX_CONNECTIONS' },
    },
    rhino: {
        launchTimeoutMs: { runtime: 'KARGADAN_RHINO_LAUNCH_TIMEOUT_MS' },
    },
} as const;
const _CONFIG_TREE = {
    ai: {
        geminiClientPath: AiRegistry.providers.gemini.credential.configKeys.clientPath,
    },
    postgres: {
        connectTimeout: _CONFIG_VOCABULARY.postgres.connectTimeout.runtime,
        idleTimeout:    _CONFIG_VOCABULARY.postgres.idleTimeout.runtime,
        maxConnections: _CONFIG_VOCABULARY.postgres.maxConnections.runtime,
    },
    rhino: {
        appPath:         'KARGADAN_RHINO_APP_PATH',
        launchTimeoutMs: _CONFIG_VOCABULARY.rhino.launchTimeoutMs.runtime,
        yakPath:         'KARGADAN_YAK_PATH',
    },
} as const;
const _supportedKeys = {
    'ai.geminiClientPath': _CONFIG_TREE.ai.geminiClientPath,
    'rhino.appPath':       _CONFIG_TREE.rhino.appPath,
    'rhino.yakPath':       _CONFIG_TREE.rhino.yakPath,
} as const;
const _supportedConfigKeys = ['ai.geminiClientPath', 'rhino.appPath', 'rhino.yakPath'] as const;
const _supportedConfigKeySet = new Set<string>(_supportedConfigKeys);
const _supportedConfigRootSet = new Set<string>(Object.keys(KargadanConfigSchema.fields));

// --- [ERRORS] ----------------------------------------------------------------

class KeychainDecodeFailures extends Ctx.Tag('kargadan/KeychainDecodeFailures')<KeychainDecodeFailures, Ref.Ref<ReadonlyArray<_DecodeFailure>>>() {}
class HarnessHostError extends Data.TaggedError('HarnessHostError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  'auth' | 'config' | 'keychain' | 'postgres';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _trimmed = (key: string, fallback = '') => Config.string(key).pipe(Config.withDefault(fallback), Config.map((v) => v.trim()));
const _trimmedOption = (value: string | undefined) =>
    Option.fromNullable(value).pipe(Option.map((item) => item.trim()), Option.filter((item) => item.length > 0));
const _readConfigFile = pipe(
    FileSystem.FileSystem,
    Effect.flatMap((fs) => fs.makeDirectory(_KARGADAN_DIR, { recursive: true }).pipe(Effect.zipRight(fs.readFileString(_CONFIG_PATH)))),
    Effect.flatMap(S.decode(S.parseJson(S.Record({ key: S.String, value: S.Unknown })))),
    Effect.tap((raw) => {
        const unknown = _configPaths(raw).filter((path) => !_supportedConfigKeySet.has(path) && !_supportedConfigRootSet.has(path));
        return unknown.length > 0
            ? Effect.logWarning('kargadan.config.unrecognized_keys').pipe(Effect.annotateLogs({ keys: unknown.join(',') }))
            : Effect.void;
    }),
    Effect.flatMap(S.decodeUnknown(KargadanConfigSchema)),
);
const _readKeychainSecret = (account: string) =>
    shellExec('security', ['find-generic-password', '-a', account, '-s', _KEYCHAIN.service, '-w']).pipe(
        Effect.map(({ stdout }) => Option.some(stdout)), Effect.catchAll(() => Effect.succeed(Option.none<string>())));
const _writeKeychainSecret = (account: string, value: string) =>
    shellExec('security', ['add-generic-password', '-U', '-a', account, '-s', _KEYCHAIN.service, '-w', value]).pipe(
        Effect.mapError((detail) => new HarnessHostError({ detail, message: `Keychain write failed for account ${account}.`, reason: 'keychain' })));
const _keychainValue = (provider: AiRegistry.Provider) => _readKeychainSecret(_KEYCHAIN.accounts[provider]);
const _writeKeychain = (provider: AiRegistry.Provider, value: string) => _writeKeychainSecret(_KEYCHAIN.accounts[provider], value);
const _keychainPairs = (decodeFailures: Ref.Ref<ReadonlyArray<_DecodeFailure>>) =>
    Effect.forEach(Object.keys(AiRegistry.providers) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
        _keychainValue(provider).pipe(Effect.flatMap(Option.match({
            onNone: () => Effect.succeed([] as ReadonlyArray<readonly [string, string]>),
            onSome: (value) => Match.value(provider).pipe(
                Match.when('gemini', () => { const _c = AiRegistry.providers.gemini.credential.configKeys; return S.decodeUnknown(_GeminiSessionSchema)(value).pipe(Effect.map((s) =>
                    [[_c.accessToken, s.accessToken], [_c.refreshToken, s.refreshToken], [_c.expiry, s.expiresAt]] as ReadonlyArray<readonly [string, string]>)); }),
                Match.orElse((name) => Effect.succeed([[AiRegistry.providers[name].credential.configKeys.secret, value]] as ReadonlyArray<readonly [string, string]>)),
            ).pipe(Effect.catchAll((detail) => Ref.update(decodeFailures, (prev) => [...prev, { error: String(detail), provider }]).pipe(
                Effect.as([] as ReadonlyArray<readonly [string, string]>)))),
        }))), { concurrency: 'unbounded' }).pipe(Effect.map((entries) => entries.flat()));
const _configFilePairs = (config: typeof KargadanConfigSchema.Type): ReadonlyArray<readonly [string, string]> =>
    ([
        [_CONFIG_TREE.ai.geminiClientPath, config.ai?.geminiClientPath],
        [_CONFIG_TREE.rhino.appPath, config.rhino?.appPath],
        [_CONFIG_TREE.rhino.yakPath, config.rhino?.yakPath],
    ] as ReadonlyArray<readonly [string, string | undefined]>).filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
const _runtimeAliasPairs = (): ReadonlyArray<readonly [string, string]> =>
    ([
        [AiRegistry.providers.gemini.credential.configKeys.accessToken, process.env['KARGADAN_AI_GEMINI_ACCESS_TOKEN']],
        [AiRegistry.providers.gemini.credential.configKeys.clientPath, process.env[_CONFIG_TREE.ai.geminiClientPath]],
        [AiRegistry.providers.gemini.credential.configKeys.expiry, process.env['KARGADAN_AI_GEMINI_TOKEN_EXPIRY']],
        [AiRegistry.providers.gemini.credential.configKeys.refreshToken, process.env['KARGADAN_AI_GEMINI_REFRESH_TOKEN']],
        [AiRegistry.providers.openai.credential.configKeys.secret, process.env['KARGADAN_AI_OPENAI_API_SECRET']],
    ] as ReadonlyArray<readonly [string, string | undefined]>).filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
const _configuredCredential = (provider: AiRegistry.Provider) =>
    Match.value(provider).pipe(
        Match.when('gemini', () => Effect.all([
            Config.string(AiRegistry.providers.gemini.credential.configKeys.clientPath).pipe(Config.option),
            Config.redacted(AiRegistry.providers.gemini.credential.configKeys.accessToken).pipe(Config.option),
            Config.redacted(AiRegistry.providers.gemini.credential.configKeys.refreshToken).pipe(Config.option),
        ]).pipe(Effect.map(([clientPath, accessToken, refreshToken]) =>
            Option.isSome(clientPath) && (Option.isSome(accessToken) || Option.isSome(refreshToken))))),
        Match.orElse(() => Config.redacted(AiRegistry.providers.openai.credential.configKeys.secret).pipe(
            Config.option,
            Effect.map(Option.isSome),
        )),
    );
const KargadanDatabaseConfig = (url: Redacted.Redacted<string>, connectTimeout: Duration.Duration, idleTimeout: Duration.Duration, maxConnections: number): ClientConfig => ({
    appName:          'kargadan-harness',
    connectionTtlMs:  900_000,
    connectionUrl:    url,
    connectTimeoutMs: Duration.toMillis(connectTimeout),
    idleTimeoutMs:    Duration.toMillis(idleTimeout),
    options:          '',
    poolMax:          maxConnections,
    poolMin:          1,
    ssl: {
        caPath:             Option.none(),
        certPath:           Option.none(),
        enabled:            false,
        keyPath:            Option.none(),
        minVersion:         'TLSv1.2',
        rejectUnauthorized: true,
        servername:         Option.none(),
    },
    timeouts: {
        idleInTransactionMs: 60_000,
        lockMs:              10_000,
        statementMs:         30_000,
        transactionMs:       120_000,
    },
    trigramThresholds: {
        similarity:           0.3,
        strictWordSimilarity: 0.5,
        wordSimilarity:       0.6,
    },
});
const loadConfigProvider = Effect.gen(function* () {
    const decodeFailures = yield* Ref.make<ReadonlyArray<_DecodeFailure>>([] as const);
    const [runtimeAliasPairs, filePairs, keychainPairs] = yield* Effect.all([
        Effect.succeed(_runtimeAliasPairs()),
        _readConfigFile.pipe(Effect.map(_configFilePairs), Effect.option, Effect.map(Option.getOrElse(() => [] as ReadonlyArray<readonly [string, string]>))),
        _keychainPairs(decodeFailures),
    ]);
    return {
        decodeFailuresLayer: Layer.succeed(KeychainDecodeFailures, decodeFailures),
        provider:            ConfigProvider.orElse(ConfigProvider.fromEnv(), () => ConfigProvider.fromMap(new Map([...runtimeAliasPairs, ...filePairs, ...keychainPairs]))),
    } as const;
});
const _readConfig = FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.exists(_CONFIG_PATH).pipe(
        Effect.flatMap((exists) => exists ? _readConfigFile : Effect.succeed({} as typeof KargadanConfigSchema.Type)),
    )),
);
const _canonicalConfig = (config: _Cfg) => ({
    ...(config.ai === undefined ? {} : { ai: { geminiClientPath: Option.getOrUndefined(_trimmedOption(config.ai.geminiClientPath)) } }),
    ...(config.rhino === undefined
        ? {}
        : {
            rhino: {
                appPath: Option.getOrUndefined(_trimmedOption(config.rhino.appPath)),
                yakPath: Option.getOrUndefined(_trimmedOption(config.rhino.yakPath)),
            },
        }),
}) satisfies typeof _PersistedKargadanConfigSchema.Type;
const _writeConfig = (config: typeof KargadanConfigSchema.Type) =>
    Effect.all([FileSystem.FileSystem, S.decodeUnknown(_PersistedKargadanConfigSchema)(_canonicalConfig(config)).pipe(
        Effect.mapError((detail) => new HarnessHostError({ detail, message: 'Config write rejected invalid or secret fields.', reason: 'config' })))]).pipe(
        Effect.flatMap(([fs, normalized]) => fs.makeDirectory(_KARGADAN_DIR, { recursive: true }).pipe(
            Effect.zipRight(fs.writeFileString(_CONFIG_PATH, JSON.stringify(normalized, null, 2))))));
const _configAt = (node: unknown, key: string) => key.split('.').reduce((current, segment) => Option.flatMap(current, (value) =>
    value !== null && typeof value === 'object' ? Option.fromNullable((value as Record<string, unknown>)[segment]) : Option.none()), Option.some(node));
const _configEntries = (node: unknown, prefix = ''): ReadonlyArray<string> => node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => _configEntries(value, prefix === '' ? key : `${prefix}.${key}`))
    : [`${prefix} = ${String(node)}`];
const _configPaths = (node: unknown, prefix = ''): ReadonlyArray<string> =>
    node !== null && typeof node === 'object'
        ? ((entries: ReadonlyArray<readonly [string, unknown]>) =>
            entries.length === 0
                ? (prefix === '' ? [] : [prefix])
                : entries.flatMap(([key, value]) => _configPaths(value, prefix === '' ? key : `${prefix}.${key}`)))(
            Object.entries(node as Record<string, unknown>),
        )
        : (prefix === '' ? [] : [prefix]);
const _configPatch = (target: Record<string, unknown>, path: ReadonlyArray<string>, value: unknown): Record<string, unknown> =>
    ((key: string) => path.length === 1 ? { ...target, [key]: value } : { ...target, [key]: _configPatch(
        typeof target[key] === 'object' && target[key] !== null ? target[key] as Record<string, unknown> : {}, path.slice(1), value) })(path[0] as string);
const _authErr = (message: string) => (detail: unknown) => new HarnessHostError({ detail, message, reason: 'auth' as const });
const _geminiClient = (clientPath: string) =>
    FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.readFileString(clientPath)),
        Effect.mapError(_authErr(`Gemini OAuth client file is unreadable: ${clientPath}`)),
    ).pipe(Effect.flatMap(GeminiOAuth.decodeGeminiClient), Effect.mapError((detail) =>
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
const ConfigFile = {
    dir:     _KARGADAN_DIR,
    flatten: (config: _Cfg) => ((entries: ReadonlyArray<string>) => entries.length === 0 ? ['(empty)'] : entries)(_configEntries(config)),
    get:     (config: _Cfg, key: string) => Option.getOrUndefined(_configAt(config, key)),
    keys:    _supportedConfigKeys,
    path:    _CONFIG_PATH,
    read:    _readConfig,
    runtimeKey: (key: string) => _supportedKeys[key as keyof typeof _supportedKeys] ?? key,
    set:     (config: _Cfg, key: string, value: string) => Effect.succeed(_configPatch(config as Record<string, unknown>, key.split('.'), value) as _Cfg),
    write: _writeConfig,
} as const;
const _noopKeychainOps = {
    readSecret:  () => Effect.succeed(Option.none<string>()),
    writeSecret: () => Effect.void,
} as const;
const _postgresTarget = Config.redacted('KARGADAN_DATABASE_URL').pipe(
    Config.option,
    Effect.map(Option.map(Redacted.value)),
    Effect.flatMap((envOverride) => KargadanPostgres.resolveTarget({ envOverride })),
);
const _postgresReadyConnection = _postgresTarget.pipe(
    Effect.flatMap((target) => KargadanPostgres.resolveReadyConnection(_KARGADAN_DIR, _POSTGRES_ROOT, _noopKeychainOps)(target)),
);
const KargadanHost = {
    auth: {
        login: (input: { readonly clientPath?: string; readonly provider: AiRegistry.Provider; readonly secret?: string }): Effect.Effect<{ readonly provider: AiRegistry.Provider }, HarnessHostError, unknown> => {
            const credentialKind = AiRegistry.providers[input.provider].credential.kind;
            return Match.value(credentialKind).pipe(
                Match.when('api-secret', () => {
                    const secret = Option.fromNullable(input.secret).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0));
                    return Option.match(secret, {
                        onNone: () => Effect.fail(new HarnessHostError({ message: `Credential value required for ${input.provider}.`, reason: 'auth' })),
                        onSome: (normalizedSecret) => AiRegistry.validateCredential('openai', {
                            kind: 'api-secret',
                            secret: Redacted.make(normalizedSecret),
                        }).pipe(
                            Effect.mapError(_authErr(`Credential validation failed for ${input.provider}.`)),
                            Effect.zipRight(_writeKeychain('openai', normalizedSecret)),
                        ),
                    });
                }),
                Match.orElse(() => {
                    const clientPath = Option.fromNullable(input.clientPath).pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0));
                    return Option.match(clientPath, {
                        onNone: () => Effect.fail(new HarnessHostError({ message: 'Gemini desktop OAuth requires a client JSON path.', reason: 'auth' })),
                        onSome: (normalizedClientPath) => Effect.scoped(Effect.all([_geminiClient(normalizedClientPath), _geminiCallback]).pipe(
                    Effect.flatMap(([client, listener]) => {
                        const [state, verifier] = [randomBytes(24).toString('hex'), randomBytes(32).toString('base64url')];
                        const authUrl = GeminiOAuth.geminiAuthorizationUrl({
                                    client, codeChallenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: listener.redirectUri, state });
                                return shellExec('open', [authUrl.toString()]).pipe(
                                    Effect.mapError(_authErr('Browser launch failed for Gemini OAuth.')),
                                    Effect.zipRight(Effect.tryPromise({ catch: _authErr('Gemini OAuth callback failed.'), try: () => listener.wait }).pipe(
                                        Effect.filterOrFail((value) => value.state === state,
                                            () => new HarnessHostError({ message: 'Gemini OAuth state mismatch.', reason: 'auth' })),
                                        Effect.timeoutFail({ duration: Duration.minutes(5),
                                            onTimeout: () => new HarnessHostError({ message: 'Gemini OAuth timed out after 5 minutes.', reason: 'auth' }) }))),
                                    Effect.flatMap((callback) => GeminiOAuth.exchangeGeminiAuthorizationCode({
                                        client, code: callback.code, codeVerifier: verifier, redirectUri: listener.redirectUri }).pipe(
                                        Effect.filterOrFail(
                                            (value): value is typeof value & { readonly refreshToken: string } => value.refreshToken !== undefined && value.refreshToken.trim().length > 0,
                                            () => new HarnessHostError({ message: 'Gemini OAuth did not return a refresh token. Re-consent and try again.', reason: 'auth' })),
                                        Effect.mapError(_authErr('Gemini OAuth token exchange failed.')))),
                                    Effect.tap((session) => AiRegistry.validateCredential('gemini', {
                                        accessToken: Redacted.make(session.accessToken),
                                        kind: 'oauth-desktop',
                                        projectId: client.projectId,
                                    }).pipe(Effect.mapError(_authErr('Gemini credential validation failed.')))),
                                    Effect.tap((session) => _writeKeychain('gemini', JSON.stringify({
                                        accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken }))),
                                    Effect.asVoid);
                            }))),
                    });
                }),
            ).pipe(Effect.as({ provider: input.provider } as const));
        },
        logout: (provider?: AiRegistry.Provider) => {
            const _deleteAccount = (account: string) =>
                shellExec('security', ['delete-generic-password', '-a', account, '-s', _KEYCHAIN.service]).pipe(Effect.catchAll(() => Effect.void));
            const aiCleanup = Effect.forEach(
                provider === undefined ? Object.keys(AiRegistry.providers) as ReadonlyArray<AiRegistry.Provider> : [provider],
                (name) => _deleteAccount(_KEYCHAIN.accounts[name]), { discard: true });
            return aiCleanup;
        },
        onTokenRefresh: (data: { readonly accessToken: string; readonly expiresAt: string; readonly refreshToken: string }) =>
            _writeKeychain('gemini', JSON.stringify(data)).pipe(Effect.ignore),
        status: Effect.serviceOption(KeychainDecodeFailures).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.succeed([] as ReadonlyArray<_DecodeFailure>),
                onSome: Ref.get,
            })),
            Effect.flatMap((failures) => {
                const failuresByProvider = HashMap.fromIterable(failures.map((f) => [f.provider, f.error] as const));
                return Effect.forEach(Object.keys(AiRegistry.providers) as ReadonlyArray<AiRegistry.Provider>, (provider) =>
                    _configuredCredential(provider).pipe(Effect.map((enrolled) => ({
                        decodeError: HashMap.get(failuresByProvider, provider),
                        enrolled,
                        kind: AiRegistry.providers[provider].credential.kind,
                        provider,
                    }))), { concurrency: 'unbounded' });
            })),
    },
    postgres: {
        bootstrap: () =>
            _postgresTarget.pipe(
                Effect.flatMap((target) => KargadanPostgres.ensureAvailable(_KARGADAN_DIR, _POSTGRES_ROOT, _noopKeychainOps)(target)),
                Effect.mapError((detail) => new HarnessHostError({ detail, message: detail instanceof Error ? detail.message : String(detail), reason: 'postgres' })),
            ),
        provider: _postgresTarget.pipe(
            Effect.map((target) => Match.value(target).pipe(
                Match.when({ _tag: 'env_override' }, () => 'env_override' as const),
                Match.orElse(() => 'managed-docker' as const),
            )),
            Effect.mapError((detail) => new HarnessHostError({ detail, message: detail instanceof Error ? detail.message : String(detail), reason: 'postgres' })),
        ),
        readyConnection: _postgresReadyConnection.pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: detail instanceof Error ? detail.message : String(detail), reason: 'postgres' })),
        ),
        readyConnectionUrl: _postgresReadyConnection.pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new HarnessHostError({
                    message: 'Kargadan PostgreSQL is not running. Run `kargadan setup` to start the managed Docker database.',
                    reason:  'postgres',
                })),
                onSome: (connection) => Effect.succeed(Redacted.make(connection.url)),
            })),
            Effect.mapError((detail) => detail instanceof HarnessHostError
                ? detail
                : new HarnessHostError({ detail, message: detail instanceof Error ? detail.message : String(detail), reason: 'postgres' })),
        ),
        reset: Effect.void,
    },
} as const;

// --- [SERVICE] ---------------------------------------------------------------

class HarnessConfig extends Effect.Service<HarnessConfig>()('kargadan/HarnessConfig', {
    scoped: Effect.gen(function* () {
        const rhinoLaunchTimeoutMs = yield* Config.integer(_CONFIG_TREE.rhino.launchTimeoutMs).pipe(Config.withDefault(45_000));
        const { agentIntent, rhinoAppPath, rhinoYakPath } = yield* Effect.all({
            agentIntent:  Config.string('KARGADAN_AGENT_INTENT').pipe(Config.withDefault('Summarize the active scene and apply the requested change.')),
            rhinoAppPath: _trimmed(_CONFIG_TREE.rhino.appPath),
            rhinoYakPath: _trimmed(_CONFIG_TREE.rhino.yakPath),
        });
        const appId = yield* Config.string('KARGADAN_APP_ID').pipe(Config.withDefault(Client.tenant.Id.system), Effect.flatMap(S.decodeUnknown(S.UUID)));
        const protocolVersion = yield* Config.string('KARGADAN_PROTOCOL_VERSION').pipe(Config.withDefault('1.0'), Effect.map((v) => v.trim().split('.')),
            Effect.filterOrFail((parts): parts is [string, string] => parts.length === 2 && parts.every((p) => /^\d+$/.test(p)),
                (parts) => new Error(`HarnessConfig/invalid_protocol_version: '${parts.join('.')}'`)),
            Effect.map(([major, minor]) => ({ major: Number.parseInt(major, 10), minor: Number.parseInt(minor, 10) })));
        const resolveLoopOperations = yield* S.decodeUnknown(S.Array(Operation))(DEFAULT_LOOP_OPERATIONS);
        yield* Effect.filterOrFail(
            Effect.succeed({ target: _INTERNALS.compactionTargetPercent, trigger: _INTERNALS.compactionTriggerPercent }),
            ({ target, trigger }) => trigger > target,
            ({ target, trigger }) => new Error(`HarnessConfig/invalid_compaction: trigger=${String(trigger)} must exceed target=${String(target)}`));
        return { ..._INTERNALS, agentIntent, appId, initialSequence: 1_000_000,
            maskedKeys: new Set(['brep', 'breps', 'edges', 'faces', 'geometry', 'mesh', 'meshes', 'nurbs', 'points', 'vertices']),
            protocolVersion, resolveCapabilities: _CAPABILITIES,
            resolveLoopOperations,
            rhinoAppPath, rhinoLaunchTimeoutMs, rhinoYakPath,
            truncation:  { arrayDepth: 2, arrayItems: 12, maxLength: 280, objectDepth: 3, objectFields: 24, summaryLength: 140 } as const,
            viewCapture: { dpi: 144, height: 900, realtimePasses: 2, transparentBackground: false, width: 1600 } as const,
            wsHost: '127.0.0.1' } as const;
    }),
}) {
    static readonly databaseLayer = Layer.unwrapEffect(Effect.gen(function* () {
        const [connectTimeout, idleTimeout, maxConnections, url] = yield* Effect.all([
            Config.duration(_CONFIG_TREE.postgres.connectTimeout).pipe(Config.withDefault(Duration.seconds(10))),
            Config.duration(_CONFIG_TREE.postgres.idleTimeout).pipe(Config.withDefault(Duration.seconds(30))),
            Config.integer(_CONFIG_TREE.postgres.maxConnections).pipe(Config.withDefault(5)),
            KargadanHost.postgres.readyConnectionUrl,
        ]);
        return Client.layerFromConfig(KargadanDatabaseConfig(url, connectTimeout, idleTimeout, maxConnections));
    }));
    static readonly aiLayer = AiService.Live.pipe(Layer.provideMerge(HarnessConfig.databaseLayer));
    static readonly persistenceLayer = AgentPersistenceLayer({ projector: kargadanToolCallProjector }).pipe(Layer.provide(HarnessConfig.databaseLayer));
}

// --- [EXPORT] ----------------------------------------------------------------

export { ConfigFile, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanDatabaseConfig, KargadanHost, loadConfigProvider, PORT_FILE_PATH };
