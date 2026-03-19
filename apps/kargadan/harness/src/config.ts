import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as FileSystem from '@effect/platform/FileSystem';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { GeminiOAuth, SessionOverride } from '@parametric-portal/ai/runtime-provider';
import { AgentPersistenceLayer } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { Config, ConfigProvider, Context as Ctx, Data, Duration, Effect, HashMap, Layer, Match, Option, Redacted, Ref, Schema as S, pipe } from 'effect';
import { MigratorLive } from './migrator';
import { KargadanPostgres, shellExec } from './postgres';
import { DEFAULT_LOOP_OPERATIONS, kargadanToolCallProjector, NonNegInt, ObjectTypeTag, Operation } from './protocol/schemas';

// --- [SCHEMA] ----------------------------------------------------------------

const _ConfigLanguageRefSchema = AiRegistry.LanguageModelRefSchema.pipe(S.pick('model', 'provider'));
const _ConfigOverrideSchema = S.Struct({
    fallback: S.optionalWith(S.Array(_ConfigLanguageRefSchema), { default: () => [] as Array<typeof _ConfigLanguageRefSchema.Type> }),
    primary:  _ConfigLanguageRefSchema,
});
const KargadanConfigSchema = S.Struct({
    ai: S.optional(S.Struct({
        architect:        S.optional(_ConfigOverrideSchema),
        geminiClientPath: S.optional(S.String),
        language:         S.optional(_ConfigOverrideSchema),
    })),
    postgres: S.optional(S.Struct({
        url: S.optional(S.String),
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
const _KEYCHAIN = { accounts: { anthropic: 'ai.anthropic', dockerPg: 'db.docker', gemini: 'ai.gemini', openai: 'ai.openai' }, service: 'com.parametricportal.kargadan' } as const;
const _POSTGRES_ROOT = join(_KARGADAN_DIR, 'postgres', '18');
const _INTERNALS = {
    commandDeadlineMs:     5_000,  compactionTargetPercent: 40,    compactionTriggerPercent: 75,     correctionCycles:       1,
    exportLimit:           10_000, heartbeatIntervalMs:     5_000, heartbeatTimeoutMs:       15_000, reconnectBackoffBaseMs: 500,
    reconnectBackoffMaxMs: 30_000, reconnectMaxAttempts:    50,    retryMaxAttempts:         5,      tokenExpiryMinutes:     15,
    writeApprovalTimeoutMs: 300_000,
} as const;
const _CAPABILITIES = {
    optional: ['view.capture'],
    required: ['read.scene.summary', 'write.object.create'],
} as const;
const _DEFAULT_WRITE_REF = {
    objectId:       '00000000-0000-0000-0000-000000000100',
    sourceRevision: 0,
    typeTag:        'Brep',
} as const;
const _AI_RUNTIME_ENV = {
    anthropic: { secret: 'KARGADAN_AI_ANTHROPIC_API_SECRET' },
    gemini:    {
        accessToken:  'KARGADAN_AI_GEMINI_ACCESS_TOKEN',
        clientPath:   'KARGADAN_AI_GEMINI_CLIENT_PATH',
        expiry:       'KARGADAN_AI_GEMINI_TOKEN_EXPIRY',
        refreshToken: 'KARGADAN_AI_GEMINI_REFRESH_TOKEN',
    },
    openai: { secret: 'KARGADAN_AI_OPENAI_API_SECRET' },
} as const;
const _CONFIG_TREE = {
    ai:       { architectFallback: 'KARGADAN_AI_ARCHITECT_FALLBACK',  architectPrimary: 'KARGADAN_AI_ARCHITECT_PRIMARY',
                geminiClientPath:  _AI_RUNTIME_ENV.gemini.clientPath, languageFallback: 'KARGADAN_AI_LANGUAGE_FALLBACK',
                languagePrimary:   'KARGADAN_AI_LANGUAGE_PRIMARY' },
    postgres: { connectTimeout:    'KARGADAN_PG_CONNECT_TIMEOUT',     idleTimeout:     'KARGADAN_PG_IDLE_TIMEOUT',
                maxConnections:    'KARGADAN_PG_MAX_CONNECTIONS',     url:             'KARGADAN_DATABASE_URL' },
    rhino:    { appPath:           'KARGADAN_RHINO_APP_PATH',         launchTimeoutMs: 'KARGADAN_RHINO_LAUNCH_TIMEOUT_MS',
                yakPath:           'KARGADAN_YAK_PATH' },
} as const satisfies Record<string, Record<string, string>>;
const _supportedKeys = Object.fromEntries(
    Object.entries(_CONFIG_TREE).flatMap(([group, fields]) =>
        Object.entries(fields).map(([field, envKey]) => [`${group}.${field}`, envKey] as const)
    )) as Record<string, string>;

// --- [ERRORS] ----------------------------------------------------------------

class KeychainDecodeFailures extends Ctx.Tag('kargadan/KeychainDecodeFailures')<KeychainDecodeFailures, Ref.Ref<ReadonlyArray<_DecodeFailure>>>() {}
class HarnessHostError extends Data.TaggedError('HarnessHostError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  'auth' | 'config' | 'keychain' | 'postgres';
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _csvConfig = (config: Config.Config<string>, fallback = '') => config.pipe(Config.withDefault(fallback), Config.map((v) => v.split(',').map((e) => e.trim()).filter(Boolean)));
const _trimmed = (key: string, fallback = '') => Config.string(key).pipe(Config.withDefault(fallback), Config.map((v) => v.trim()));
const _serializeLanguageRef = (ref: typeof _ConfigLanguageRefSchema.Type) => `${ref.provider}:${ref.model}`;
const _decodeLanguageRef = (value: string) =>
    Effect.gen(function* () {
        const match = yield* Option.fromNullable(/^([a-z]+):(.+)$/.exec(value.trim())).pipe(
            Option.match({
                onNone: () => Effect.fail(new HarnessHostError({ message: `Invalid model ref '${value}'. Expected 'provider:model'.`, reason: 'config' })),
                onSome: Effect.succeed,
            }),
        );
        return yield* S.decodeUnknown(_ConfigLanguageRefSchema)({ model: match[2] ?? '', provider: match[1] ?? '' }).pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: `Invalid model ref '${value}'. Expected 'provider:model'.`, reason: 'config' })),
        );
    });
const _decodeLanguageRefs = (value: string) => Effect.forEach(value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0), (entry) => _decodeLanguageRef(entry));
const _knownConfigKeys = new Set(Object.keys(KargadanConfigSchema.fields));
const _readConfigFile = pipe(
    FileSystem.FileSystem,
    Effect.flatMap((fs) => fs.makeDirectory(_KARGADAN_DIR, { recursive: true }).pipe(Effect.zipRight(fs.readFileString(_CONFIG_PATH)))),
    Effect.flatMap(S.decode(S.parseJson(S.Record({ key: S.String, value: S.Unknown })))),
    Effect.tap((raw) => {
        const unknown = Object.keys(raw).filter((k) => !_knownConfigKeys.has(k));
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
        [_CONFIG_TREE.ai.languagePrimary,   config.ai?.language?.primary === undefined  ? undefined : _serializeLanguageRef(config.ai.language.primary)],
        [_CONFIG_TREE.ai.languageFallback,  config.ai?.language?.fallback.length === 0  ? undefined : config.ai?.language?.fallback.map(_serializeLanguageRef).join(',')],
        [_CONFIG_TREE.ai.architectPrimary,  config.ai?.architect?.primary === undefined ? undefined : _serializeLanguageRef(config.ai.architect.primary)],
        [_CONFIG_TREE.ai.architectFallback, config.ai?.architect?.fallback.length === 0 ? undefined : config.ai?.architect?.fallback.map(_serializeLanguageRef).join(',')],
        [AiRegistry.providers.gemini.credential.configKeys.clientPath, config.ai?.geminiClientPath],
        [_CONFIG_TREE.postgres.url, config.postgres?.url],
    ] as ReadonlyArray<readonly [string, string | undefined]>).filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
const _runtimeAliasPairs = (): ReadonlyArray<readonly [string, string]> =>
    ([
        [AiRegistry.providers.anthropic.credential.configKeys.secret, process.env[_AI_RUNTIME_ENV.anthropic.secret]],
        [AiRegistry.providers.gemini.credential.configKeys.accessToken, process.env[_AI_RUNTIME_ENV.gemini.accessToken]],
        [AiRegistry.providers.gemini.credential.configKeys.clientPath, process.env[_AI_RUNTIME_ENV.gemini.clientPath]],
        [AiRegistry.providers.gemini.credential.configKeys.expiry, process.env[_AI_RUNTIME_ENV.gemini.expiry]],
        [AiRegistry.providers.gemini.credential.configKeys.refreshToken, process.env[_AI_RUNTIME_ENV.gemini.refreshToken]],
        [AiRegistry.providers.openai.credential.configKeys.secret, process.env[_AI_RUNTIME_ENV.openai.secret]],
    ] as ReadonlyArray<readonly [string, string | undefined]>).filter((pair): pair is readonly [string, string] => pair[1] !== undefined);
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
const _isModelRefKey = (key: string) => key.endsWith('.primary') || key.endsWith('.fallback');
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
    get:     (config: _Cfg, key: string) => Match.value(_isModelRefKey(key)).pipe(
        Match.when(true, () => {
            const segments = key.split('.');
            const group = segments[0] as 'ai';
            const field = segments.slice(1).join('.');
            const node = _configAt(config, `${group}.${field}`);
            return Option.flatMap(node, (value) =>
                Array.isArray(value) ? Option.some((value as ReadonlyArray<typeof _ConfigLanguageRefSchema.Type>).map(_serializeLanguageRef).join(','))
                : typeof value === 'object' && value !== null && 'model' in (value as Record<string, unknown>)
                    ? Option.some(_serializeLanguageRef(value as typeof _ConfigLanguageRefSchema.Type))
                    : Option.none()).pipe(Option.getOrUndefined);
        }),
        Match.when(false, () => Match.value(key).pipe(
            Match.when('ai.geminiClientPath', () => config.ai?.geminiClientPath),
            Match.orElse(() => Option.getOrUndefined(_configAt(config, key))),
        )),
        Match.exhaustive,
    ),
    keys:    Object.keys(_supportedKeys),
    path:    _CONFIG_PATH,
    read:    _readConfig,
    runtimeKey: (key: string) => _supportedKeys[key] ?? key,
    set:     (config: _Cfg, key: string, value: string) => Match.value(_isModelRefKey(key)).pipe(
        Match.when(true, () =>
            (key.endsWith('.fallback')
                ? _decodeLanguageRefs(value).pipe(Effect.map((decoded) => _configPatch(config as Record<string, unknown>, key.split('.'), decoded) as _Cfg))
                : _decodeLanguageRef(value).pipe(Effect.map((decoded) => _configPatch(config as Record<string, unknown>, key.split('.'), decoded) as _Cfg)))),
        Match.when(false, () => Effect.succeed(_configPatch(config as Record<string, unknown>, key.split('.'), value) as _Cfg)),
        Match.exhaustive,
    ),
    write: _writeConfig,
} as const;
const KargadanHost = {
    auth: {
        login: (input: { readonly clientPath?: string; readonly provider: AiRegistry.Provider; readonly secret?: string }) =>
            Match.value(AiRegistry.providers[input.provider].credential.kind).pipe(
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
                                    Effect.tap((session) => _writeKeychain('gemini', JSON.stringify({
                                        accessToken: session.accessToken, expiresAt: session.expiresAt, refreshToken: session.refreshToken }))),
                                    Effect.as({ provider: input.provider } as const));
                            }))),
                    }))),
            ),
        logout: (provider?: AiRegistry.Provider) => {
            const _deleteAccount = (account: string) =>
                shellExec('security', ['delete-generic-password', '-a', account, '-s', _KEYCHAIN.service]).pipe(Effect.catchAll(() => Effect.void));
            const aiCleanup = Effect.forEach(
                provider === undefined ? Object.keys(AiRegistry.providers) as ReadonlyArray<AiRegistry.Provider> : [provider],
                (name) => _deleteAccount(_KEYCHAIN.accounts[name]), { discard: true });
            return provider === undefined
                ? aiCleanup.pipe(Effect.zipRight(_deleteAccount(_KEYCHAIN.accounts.dockerPg)))
                : aiCleanup;
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
                    _keychainValue(provider).pipe(Effect.map((value) => ({
                        decodeError: HashMap.get(failuresByProvider, provider),
                        enrolled:    Option.isSome(value),
                        kind:        AiRegistry.providers[provider].credential.kind,
                        provider,
                    }))), { concurrency: 'unbounded' });
            })),
    },
    postgres: {
        bootstrap:     KargadanPostgres.resolveUrl(_KARGADAN_DIR, _POSTGRES_ROOT, { readSecret: _readKeychainSecret, writeSecret: _writeKeychainSecret }).pipe(
            Effect.mapError((detail) => new HarnessHostError({ detail, message: detail instanceof Error ? detail.message : String(detail), reason: 'postgres' })),
        ),
        connectionUrl: KargadanPostgres.connectionUrl(_POSTGRES_ROOT),
        reset:         shellExec('security', ['delete-generic-password', '-a', _KEYCHAIN.accounts.dockerPg, '-s', _KEYCHAIN.service]).pipe(Effect.catchAll(() => Effect.void)),
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
        const _overrideInput = (fallbackKey: string, primaryKey: string) => Effect.all({
            fallback: _csvConfig(Config.string(fallbackKey)),
            primary:  _trimmed(primaryKey),
        }).pipe(Effect.flatMap(SessionOverride.decodeFromInput));
        const resolveArchitectOverride = yield* _overrideInput(_CONFIG_TREE.ai.architectFallback, _CONFIG_TREE.ai.architectPrimary);
        const resolveLoopOperations = yield* S.decodeUnknown(S.Array(Operation))(DEFAULT_LOOP_OPERATIONS);
        const resolveSessionOverride = yield* _overrideInput(_CONFIG_TREE.ai.languageFallback, _CONFIG_TREE.ai.languagePrimary);
        const resolveWriteObjectRef = yield* S.decodeUnknown(S.Struct({ objectId: S.UUID, sourceRevision: NonNegInt, typeTag: ObjectTypeTag }))(_DEFAULT_WRITE_REF);
        yield* Effect.filterOrFail(
            Effect.succeed({ target: _INTERNALS.compactionTargetPercent, trigger: _INTERNALS.compactionTriggerPercent }),
            ({ target, trigger }) => trigger > target,
            ({ target, trigger }) => new Error(`HarnessConfig/invalid_compaction: trigger=${String(trigger)} must exceed target=${String(target)}`));
        return { ..._INTERNALS, agentIntent, appId, initialSequence: 1_000_000,
            maskedKeys: new Set(['brep', 'breps', 'edges', 'faces', 'geometry', 'mesh', 'meshes', 'nurbs', 'points', 'vertices']),
            protocolVersion, resolveArchitectOverride, resolveCapabilities: _CAPABILITIES,
            resolveLoopOperations, resolveSessionOverride, resolveWriteObjectRef,
            rhinoAppPath, rhinoLaunchTimeoutMs, rhinoYakPath, sessionToken: randomBytes(24).toString('hex'),
            truncation:  { arrayDepth: 2, arrayItems: 12, maxLength: 280, objectDepth: 3, objectFields: 24, summaryLength: 140 } as const,
            viewCapture: { dpi: 144, height: 900, realtimePasses: 2, transparentBackground: false, width: 1600 } as const,
            wsHost: '127.0.0.1' } as const;
    }),
}) {
    static readonly persistenceLayer = Layer.unwrapEffect(Effect.all([
        Config.duration(_CONFIG_TREE.postgres.connectTimeout).pipe(Config.withDefault(Duration.seconds(10))),
        Config.duration(_CONFIG_TREE.postgres.idleTimeout).pipe(Config.withDefault(Duration.seconds(30))),
        Config.integer(_CONFIG_TREE.postgres.maxConnections).pipe(Config.withDefault(5)),
        Config.redacted(_CONFIG_TREE.postgres.url).pipe(Config.option),
    ]).pipe(Effect.flatMap(([connectTimeout, idleTimeout, maxConnections, overrideUrl]) =>
        Option.match(overrideUrl, {
            onNone: () => KargadanHost.postgres.bootstrap.pipe(Effect.map(Redacted.make)),
            onSome: Effect.succeed,
        }).pipe(
            Effect.map((url) => AgentPersistenceLayer({
                connectTimeout: Config.succeed(connectTimeout), idleTimeout: Config.succeed(idleTimeout),
                maxConnections: Config.succeed(maxConnections), url: Config.succeed(url),
            }, { projector: kargadanToolCallProjector }).pipe(Layer.provideMerge(MigratorLive)))))));
}

// --- [EXPORT] ----------------------------------------------------------------

export { ConfigFile, HarnessConfig, HarnessHostError, KargadanConfigSchema, KargadanHost, loadConfigProvider, PORT_FILE_PATH };
