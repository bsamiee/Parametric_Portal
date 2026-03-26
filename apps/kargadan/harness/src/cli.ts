import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlClient } from '@effect/sql';
import * as ProcessCommand from '@effect/platform/Command';
import * as FileSystem from '@effect/platform/FileSystem';
import * as Terminal from '@effect/platform/Terminal';
import { NodeCommandExecutor, NodeContext, NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { CliConfig, Command, HelpDoc, Options, Prompt, Span, ValidationError } from '@effect/cli';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiRuntimeProvider } from '@parametric-portal/ai/runtime-provider';
import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import { MigratorRun } from '@parametric-portal/database/migrator';
import { DatabaseService } from '@parametric-portal/database/repos';
import * as Console from 'effect/Console';
import { Cause, Config, ConfigProvider, Data, Duration, Effect, Exit, Fiber, HashMap, Match, Option, Queue, Redacted, Schedule } from 'effect';
import { ConfigFile, HarnessConfig, HarnessHostError, KargadanDatabaseConfig, type KargadanConfigSchema, KargadanHost, loadConfigProvider } from './config';
import { HarnessRuntime } from './harness';
import { PluginManager, PluginManagerError } from './plugin';
import { KargadanPostgres, shellExec } from './postgres';
import type { kargadanToolCallProjector } from './protocol/schemas';
import { readPortFile } from './socket';

// --- [TYPES] -----------------------------------------------------------------
type _TraceProjection = ReturnType<typeof kargadanToolCallProjector>;
type _AiSelectionState = {
    readonly appId: string;
    readonly settings: Option.Option<AiRegistry.Settings>;
};
type _AiSelectionReadiness = _AiSelectionState & {
    readonly credentialStatus: 'invalid' | 'missing' | 'unselected' | 'valid';
    readonly validationError: Option.Option<string>;
};
type _SelectionSummary = {
    readonly credentialStatus: _AiSelectionReadiness['credentialStatus'];
    readonly embedding: Option.Option<string>;
    readonly model: Option.Option<string>;
    readonly persisted: boolean;
    readonly provider: Option.Option<AiRegistry.Provider>;
    readonly validationError: Option.Option<string>;
};
type _DatabaseReadiness = {
    readonly hasAppTables: boolean;
    readonly hasPersistenceTables: boolean;
    readonly hasSearchProfileHash: boolean;
    readonly hasSearchFunctions: boolean;
    readonly hasSearchTables: boolean;
    readonly hasSupportedProfiles: boolean;
    readonly ready: boolean;
    readonly serverVersion: string;
    readonly serverVersionNum: number;
};
type _DatabaseStatus = {
    readonly issue: Option.Option<string>;
    readonly provider: 'env_override' | 'managed-docker';
    readonly readiness: Option.Option<_DatabaseReadiness>;
    readonly state: 'not_initialized' | 'ready' | 'unreachable';
};

// --- [CONSTANTS] -------------------------------------------------------------
declare const __APP_VERSION__: string;
const _version = typeof __APP_VERSION__ === 'string'
    ? __APP_VERSION__
    : ((metadata) => typeof metadata.version === 'string' && metadata.version.length > 0 ? metadata.version : '0.1.0')(
        JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'release.json'), 'utf8')) as { version?: unknown },
    );
const _csvHeaders = ['sequence','createdAt','operation','status','durationMs','failureClass','workflowExecutionId','workflowCommandId','workflowApproved','params','result'] as const;
const _LIVE_ARTIFACT_DIR = join(ConfigFile.dir, 'live');
const _RHINO_WIP_PATTERNS = [/^RhinoWIP\.app$/i, /^Rhino WIP\.app$/i, /^Rhino 9.*\.app$/i] as const;

// --- [ERRORS] ----------------------------------------------------------------

class CliError extends Data.TaggedError('CliError')<{ readonly detail?: unknown; readonly message: string; readonly reason: keyof typeof CliError.reasons }> {
    static readonly reasons = { io: { advice: 'Retry after transient conditions clear.', failureClass: 'retryable' },
        not_found: { advice: 'Adjust parameters, then retry.', failureClass: 'correctable' }, runtime: { advice: 'Inspect transport/protocol before retry.', failureClass: 'fatal' },
        tty_required: { advice: 'Run in a TTY session.', failureClass: 'correctable' }, validation: { advice: 'Adjust parameters or rerun with flags.', failureClass: 'correctable' } } as const;
    static readonly from = (error: unknown) => Match.value(error).pipe(
        Match.when(Match.instanceOf(CliError), (e) => e),
        Match.when(Match.instanceOf(HarnessHostError), (e) => new CliError({ detail: e.detail, message: e.message,
            reason: ({ auth: 'validation', config: 'validation', keychain: 'runtime', postgres: 'not_found' } as const satisfies Record<HarnessHostError['reason'], CliError['reason']>)[e.reason] })),
        Match.when((e: unknown): e is { readonly _tag: 'ClientCapabilityError'; readonly hasVector: boolean; readonly missingHnsw: ReadonlyArray<string>; readonly serverVersion: string; readonly serverVersionNum: number } =>
            typeof e === 'object'
            && e !== null
            && '_tag' in e
            && e['_tag'] === 'ClientCapabilityError',
        (e) => new CliError({
            detail: e,
            message: `Database capabilities are incomplete for Kargadan. server=${e.serverVersion} (${String(e.serverVersionNum)}) vector=${String(e.hasVector)} missingHnsw=${e.missingHnsw.join(',') || 'none'}. Re-run \`kargadan setup\` against the managed Postgres bootstrap or repair the local database.`,
            reason: 'validation',
        })),
        Match.orElse((e) => new CliError({ detail: e, message: String(e), reason: 'runtime' })));
    get policy() { return CliError.reasons[this.reason]; }
    get doc() { return HelpDoc.blocks([HelpDoc.h1(Span.error(`kargadan ${this.reason}`)), HelpDoc.p(Span.text(`failureClass: ${this.policy.failureClass}`)),
        HelpDoc.p(Span.text(`issue: ${this.message}`)), HelpDoc.p(Span.text(`recovery: ${this.policy.advice}`))]); }
}

// --- [FUNCTIONS] -------------------------------------------------------------
const _compact = (value: unknown) => ((s: string) => s.length <= 140 ? s : `${s.slice(0, 140)}...`)(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));
const _print = (title: string, lines: ReadonlyArray<string>) => Console.log(HelpDoc.toAnsiText(HelpDoc.blocks([HelpDoc.h1(Span.text(title)), ...lines.map((l) => HelpDoc.p(Span.text(l)))])));
const _trimOpt = (opt: Option.Option<string>) => opt.pipe(Option.map((v) => v.trim()), Option.filter((v) => v.length > 0));
const _withAppTenant = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flatMap(HarnessConfig, (config) => Client.tenant.locally(config.appId, effect));
const _withAiLayer = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(
    Effect.locally(AiRegistry.OnTokenRefreshRef, Option.some(KargadanHost.auth.onTokenRefresh)),
    Effect.provide(HarnessConfig.aiLayer),
);
const _requireTty = Terminal.Terminal.pipe(Effect.flatMap((t) => t.isTTY),
    Effect.filterOrFail((v) => v, () => new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' })), Effect.asVoid);
const _enrollProvider = (provider: keyof typeof AiRegistry.providers, config: typeof KargadanConfigSchema.Type, clientPathHint?: Option.Option<string>): Effect.Effect<Option.Option<string>, CliError, unknown> => {
    const providerMeta = AiRegistry.providers[provider];
    const apiSecretEnrollment: Effect.Effect<Option.Option<string>, unknown, unknown> = Prompt.run(Prompt.hidden({ message: `${provider} API secret:`,
        validate: (v) => v.trim().length === 0 ? Effect.fail('Credential cannot be empty') : Effect.succeed(v.trim()) })).pipe(
        Effect.map(Redacted.value),
        Effect.flatMap((secret) => KargadanHost.auth.login({ provider, secret })),
        Effect.as(Option.none<string>()),
    );
    const geminiClientPath = providerMeta.requiresClientPath ? clientPathHint ?? Option.none<string>() : Option.none<string>();
    const geminiEnrollment: Effect.Effect<Option.Option<string>, unknown, unknown> = (geminiClientPath._tag === 'Some'
        ? Effect.succeed(Option.some(geminiClientPath.value))
        : Prompt.run(Prompt.text({ ...(Option.match(Option.fromNullable(config.ai?.geminiClientPath).pipe(Option.map((v) => v.trim()), Option.filter((v) => v.length > 0)), { onNone: () => ({}), onSome: (v) => ({ default: v }) })),
            message: 'Gemini desktop client JSON path:', validate: (v) => v.trim().length === 0 ? Effect.fail('Client JSON path cannot be empty') : Effect.succeed(v.trim()) })).pipe(Effect.map(Option.some))).pipe(
        Effect.flatMap((clientPath) => clientPath._tag === 'Some'
            ? KargadanHost.auth.login({ clientPath: clientPath.value, provider }).pipe(Effect.as(clientPath), Effect.mapError(CliError.from))
            : Effect.fail(new CliError({ message: 'Gemini desktop client JSON path is required.', reason: 'validation' }))),
    );
    return (providerMeta.requiresClientPath ? geminiEnrollment : apiSecretEnrollment).pipe(Effect.mapError(CliError.from));
};
const _runExt = (label: string, cmd: ProcessCommand.Command) =>
    ProcessCommand.exitCode(ProcessCommand.stdout(ProcessCommand.stderr(cmd, 'inherit'), 'inherit')).pipe(Effect.provide(NodeCommandExecutor.layer),
        Effect.flatMap((code) => code === 0 ? Effect.void : Effect.fail(new CliError({ message: `${label} exited with code ${String(code)}.`, reason: 'runtime' }))));
const _promptProvider = (provider: Option.Option<string>, message: string) => provider.pipe(Option.map((v) => v.trim()),
    Option.filter((v): v is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, v)),
    Option.match({
        onNone: () => Prompt.run(Prompt.select({ choices: Object.entries(AiRegistry.providers).map(([v, m]) => ({ title: m.title, value: v as keyof typeof AiRegistry.providers })), message })),
        onSome: Effect.succeed }));
const _promptLiveModel = (models: ReadonlyArray<AiRegistry.LiveModel>) =>
    Match.value(models.length > 0).pipe(
        Match.when(false, () => Effect.fail(new CliError({
            message: 'The selected provider did not return any live language models.',
            reason:  'validation',
        }))),
        Match.orElse(() => Prompt.run(Prompt.select({
            choices: models.map((model) => ({ title: model.title === model.id ? model.id : `${model.title} (${model.id})`, value: model.id })),
            message: 'Language model:',
        }))),
    );
const _completeEnrollment = <A, R>(input: {
    readonly clientPathHint?: Option.Option<string>; readonly config: typeof KargadanConfigSchema.Type;
    readonly lines: (gcp: Option.Option<string>) => ReadonlyArray<string>; readonly provider: keyof typeof AiRegistry.providers;
    readonly title: string; readonly write: (gcp: Option.Option<string>) => Effect.Effect<A, CliError, R>;
}) => _enrollProvider(input.provider, input.config, input.clientPathHint).pipe(
    Effect.flatMap((gcp) => input.write(gcp).pipe(Effect.as(gcp))), Effect.tap((gcp) => _print(input.title, input.lines(gcp))));
const _gcLines = (provider: string, gcp: Option.Option<string>) =>
    [`provider=${provider}`, 'stored=macOS Keychain', ...Option.match(gcp, { onNone: () => [] as ReadonlyArray<string>, onSome: (v) => [`client=${v}`] })];
const _writeGC = (config: typeof KargadanConfigSchema.Type, provider: string, gcp: Option.Option<string>) =>
    Effect.when(ConfigFile.set(config, 'ai.geminiClientPath', Option.getOrUndefined(gcp) ?? '').pipe(Effect.flatMap(ConfigFile.write), Effect.mapError(CliError.from)),
        () => provider === 'gemini' && Option.isSome(gcp));
const _readConfigSafe = ConfigFile.read.pipe(Effect.catchAll((error) => Effect.fail(new CliError({
    detail: error,
    message: `Local config at ${ConfigFile.path} is invalid. Run 'kargadan setup' or repair the file.`,
    reason: 'validation',
}))));
const _databaseReadiness = Effect.gen(function* () {
    const sql: SqlClient.SqlClient = yield* SqlClient.SqlClient;
    const rows = yield* sql.unsafe(`
        SELECT
            current_setting('server_version_num')::int AS server_version_num,
            current_setting('server_version') AS server_version,
            EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apps') AS has_app_tables,
            EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_journal')
                AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'kv_store') AS has_persistence_tables,
            EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_documents')
                AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_embeddings')
                AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_terms') AS has_search_tables,
            EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_search_documents')
                AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_supported_search_embedding_profile') AS has_search_functions,
            EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'search_embedding_profile_hash') AS has_search_profile_hash
    `).pipe(Effect.map((results) => results as Array<{
        hasAppTables: boolean;
        hasPersistenceTables: boolean;
        hasSearchFunctions: boolean;
        hasSearchProfileHash: boolean;
        hasSearchTables: boolean;
        serverVersion: string;
        serverVersionNum: number;
    }>));
    const row = yield* Option.fromNullable(rows[0]).pipe(Option.match({
        onNone: () => Effect.fail(new CliError({ message: 'Database readiness probe returned no rows.', reason: 'runtime' })),
        onSome: Effect.succeed,
    }));
    const hasSupportedProfiles = yield* Match.value(row.hasSearchFunctions).pipe(
        Match.when(true, () => sql<{ hasSupportedProfiles: boolean }>`
            SELECT
                is_supported_search_embedding_profile('openai', 1536)
                AND is_supported_search_embedding_profile('gemini', 1536) AS has_supported_profiles`.pipe(
                Effect.flatMap((supportRows) => Option.fromNullable(supportRows[0]).pipe(Option.match({
                    onNone: () => Effect.fail(new CliError({ message: 'Database embedding profile probe returned no rows.', reason: 'runtime' })),
                    onSome: (supportRow) => Effect.succeed(supportRow.hasSupportedProfiles),
                }))),
            )),
        Match.orElse(() => Effect.succeed(false)),
    );
    return {
        ...row,
        hasSupportedProfiles,
        ready: row.hasAppTables
            && row.hasPersistenceTables
            && row.hasSearchFunctions
            && row.hasSearchProfileHash
            && row.hasSearchTables
            && hasSupportedProfiles,
    } satisfies _DatabaseReadiness;
});
const _databaseReadinessIssue = (readiness: _DatabaseReadiness) =>
    `appTables=${String(readiness.hasAppTables)} persistenceTables=${String(readiness.hasPersistenceTables)} searchTables=${String(readiness.hasSearchTables)} searchFunctions=${String(readiness.hasSearchFunctions)} searchProfileHash=${String(readiness.hasSearchProfileHash)} supportedProfiles=${String(readiness.hasSupportedProfiles)}`;
const _databaseStatus = Effect.gen(function* () {
    const provider = yield* KargadanHost.postgres.provider.pipe(Effect.mapError(CliError.from));
    const exit = yield* Effect.exit(_databaseReadiness.pipe(Effect.provide(HarnessConfig.databaseLayer)));
    return Exit.match(exit, {
        onFailure: (cause) => ({
            issue:     Option.some(_compact(Cause.squash(cause))),
            provider,
            readiness: Option.none<_DatabaseReadiness>(),
            state:     'unreachable',
        } satisfies _DatabaseStatus),
        onSuccess: (readiness) => ({
            issue:     readiness.ready ? Option.none<string>() : Option.some(_databaseReadinessIssue(readiness)),
            provider,
            readiness: Option.some(readiness),
            state:     readiness.ready ? 'ready' : 'not_initialized',
        } satisfies _DatabaseStatus),
    });
});
const _requireDatabaseReady = _databaseReadiness.pipe(
    Effect.filterOrFail(
        (readiness) => readiness.ready,
        (readiness) => new CliError({
            message: `Database schema is not initialized. Run \`kargadan setup\`. ${_databaseReadinessIssue(readiness)}.`,
            reason: 'validation',
        }),
    ),
    Effect.asVoid,
);
const _requireLocalDatabaseReady = KargadanHost.postgres.readyConnection.pipe(
    Effect.mapError(CliError.from),
    Effect.flatMap(Option.match({
        onNone: () => Effect.fail(new CliError({
            message: 'Kargadan PostgreSQL is not running. Run `kargadan setup` to provision the managed Docker database.',
            reason:  'validation',
        })),
        onSome: (connection) => Effect.scoped(_databaseReadiness.pipe(
            Effect.provide(Client.layerFromConfig(KargadanDatabaseConfig(Redacted.make(connection.url), Duration.seconds(10), Duration.seconds(30), 5))),
            Effect.catchAll((error) => error instanceof CliError
                ? Effect.fail(error)
                : Effect.fail(new CliError({
                    detail: error,
                    message: 'Kargadan PostgreSQL is not reachable. Run `kargadan setup` to repair the local environment.',
                    reason:  'validation',
                }))),
            Effect.flatMap((readiness) => readiness.ready
                ? Effect.void
                : Effect.fail(new CliError({
                    message: `Database schema is not initialized. Run \`kargadan setup\`. ${_databaseReadinessIssue(readiness)}.`,
                    reason:  'validation',
                }))),
        )),
    })),
);
const _readAiSelection = _requireDatabaseReady.pipe(
    Effect.zipRight(Effect.gen(function* () {
        const [config, database] = yield* Effect.all([HarnessConfig, DatabaseService]);
        const stored = yield* database.apps.readSettings(config.appId);
        const settings = yield* stored.pipe(
            Option.flatMap(({ settings: appSettings }) => Option.fromNullable(appSettings.ai).pipe(Option.filter((value) => Object.keys(value).length > 0))),
            Option.match({
                onNone: () => Effect.succeed(Option.none<AiRegistry.Settings>()),
                onSome: (ai) => AiRegistry.decodeAppSettings({ ai }).pipe(Effect.map(Option.some)),
            }),
        );
        return { appId: config.appId, settings } satisfies _AiSelectionState;
    })),
);
const _selectionSummary = (selection: _AiSelectionReadiness): _SelectionSummary =>
    Option.match(selection.settings, {
        onNone: () => ({
            credentialStatus: selection.credentialStatus,
            embedding:        Option.none<string>(),
            model:            Option.none<string>(),
            persisted:        false,
            provider:         Option.none<AiRegistry.Provider>(),
            validationError:  selection.validationError,
        }),
        onSome: (settings) => ({
            credentialStatus: selection.credentialStatus,
            embedding:        Option.some(`${settings.embedding.provider}:${settings.embedding.model}:${String(settings.embedding.dimensions)}`),
            model:            Option.some(settings.model),
            persisted:        true,
            provider:         Option.some(settings.provider),
            validationError:  selection.validationError,
        }),
    });
const _aiSelectionReadiness = Effect.gen(function* () {
    const [selection, provider] = yield* Effect.all([_readAiSelection, AiRuntimeProvider]);
    const _state = (
        credentialStatus: _AiSelectionReadiness['credentialStatus'],
        validationError = Option.none<string>(),
    ) => ({
        ...selection,
        credentialStatus,
        validationError,
    }) satisfies _AiSelectionReadiness;
    return yield* Option.match(selection.settings, {
        onNone: () => Effect.succeed(_state('unselected')),
        onSome: (settings) => Effect.gen(function* () {
            const resolvedCredential = yield* provider.resolveCredential(settings.provider).pipe(Effect.option);
            return yield* Option.match(resolvedCredential, {
                onNone: () => Effect.succeed(_state('missing')),
                onSome: (credential) => AiRegistry.validateSelection(settings, {
                    [settings.provider]: credential,
                } as AiRegistry.Credentials).pipe(
                    Effect.as(_state('valid')),
                    Effect.catchAll((error) => Effect.succeed(_state('invalid', Option.some(_compact(error))))),
                ),
            });
        }),
    });
});
const _selectionLines = (selection: _AiSelectionReadiness) => {
    const summary = _selectionSummary(selection);
    return Option.match(summary.provider, {
        onNone: () => [
            'persisted=false',
            'provider=unselected',
            'model=unselected',
            'embedding=unselected',
            'credential=unselected',
        ] as const,
        onSome: (provider) => [
            `persisted=${String(summary.persisted)}`,
            `provider=${provider}`,
            `model=${Option.getOrElse(summary.model, () => 'unselected')}`,
            `embedding=${Option.getOrElse(summary.embedding, () => 'unselected')}`,
            `credential=${summary.credentialStatus}`,
            ...Option.match(summary.validationError, { onNone: () => [] as ReadonlyArray<string>, onSome: (error) => [`validationError=${error}`] }),
        ] as const,
    });
};
const _authSelectionLines = (selection: _AiSelectionReadiness) => {
    const summary = _selectionSummary(selection);
    return Option.match(summary.provider, {
        onNone: () => [
            'selectedProvider=unselected',
            'selectedModel=unselected',
            'selectedCredential=unselected',
        ] as const,
        onSome: (provider) => [
            `selectedProvider=${provider}`,
            `selectedModel=${Option.getOrElse(summary.model, () => 'unselected')}`,
            `selectedCredential=${summary.credentialStatus}`,
            ...Option.match(summary.validationError, { onNone: () => [] as ReadonlyArray<string>, onSome: (error) => [`selectedValidationError=${error}`] }),
        ] as const,
    });
};
const _selectionDatabaseUnavailableLines = (status: _DatabaseStatus) => [
    `databaseProvider=${status.provider}`,
    'persisted=unavailable',
    'provider=unavailable',
    'model=unavailable',
    'embedding=unavailable',
    'credential=unavailable',
    `selectionError=${status.state === 'not_initialized' ? 'database_not_initialized' : 'database_unreachable'}`,
    ...Option.match(status.issue, { onNone: () => [] as ReadonlyArray<string>, onSome: (issue) => [`selectionDetail=${issue}`] }),
] as const;
const _authDatabaseUnavailableLines = (status: _DatabaseStatus) => [
    `databaseProvider=${status.provider}`,
    'selectedProvider=unavailable',
    'selectedModel=unavailable',
    'selectedCredential=unavailable',
    `selectionError=${status.state === 'not_initialized' ? 'database_not_initialized' : 'database_unreachable'}`,
    ...Option.match(status.issue, { onNone: () => [] as ReadonlyArray<string>, onSome: (issue) => [`selectionDetail=${issue}`] }),
] as const;
const _requireSelectionReady = _aiSelectionReadiness.pipe(
    Effect.flatMap((selection) => {
        const summary = _selectionSummary(selection);
        return Match.value(selection.credentialStatus).pipe(
            Match.when('valid', () => Effect.succeed(selection)),
            Match.when('unselected', () => Effect.fail(new CliError({
                message: 'AI selection is not persisted. Run `kargadan ai select --provider <provider> --model <model>` first.',
                reason: 'validation',
            }))),
            Match.when('missing', () => Effect.fail(new CliError({
                message: `Selected provider '${Option.getOrElse(summary.provider, () => 'unknown')}' is missing credentials. Run \`kargadan auth login --provider ${Option.getOrElse(summary.provider, () => 'unknown')}\` first.`,
                reason: 'validation',
            }))),
            Match.orElse(() => Effect.fail(new CliError({
                message: `Selected AI configuration is invalid for provider '${Option.getOrElse(summary.provider, () => 'unknown')}'. ${Option.getOrElse(summary.validationError, () => '')}`.trim(),
                reason: 'validation',
            }))),
        );
    }),
);
const _resolvePath = (fs: FileSystem.FileSystem, input: {
    readonly discover: Effect.Effect<string, CliError, FileSystem.FileSystem>; readonly fallback: Option.Option<string>;
    readonly label: string; readonly override: Option.Option<string>;
}) => Option.match(Option.orElse(input.override, () => input.fallback), {
    onNone: () => input.discover,
    onSome: (path) => fs.exists(path).pipe(Effect.filterOrFail((v) => v, () => new CliError({ message: `${input.label} not found at ${path}.`, reason: 'not_found' })), Effect.as(path)) });
const _resolveRhinoPaths = (input?: { readonly rhinoApp?: Option.Option<string>; readonly yakPath?: Option.Option<string> }) => Effect.gen(function* () {
    const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
    const appPath = yield* _resolvePath(fs, {
        discover: fs.readDirectory('/Applications').pipe(
            Effect.map((entries) => entries
                .filter((entry) => _RHINO_WIP_PATTERNS.some((pattern) => pattern.test(entry)))
                .sort((left, right) => left.localeCompare(right))
                .map((entry) => join('/Applications', entry))),
            Effect.flatMap((apps) => apps.length > 0
                ? Effect.succeed(apps[0] as string)
                : Effect.fail(new CliError({
                    message: 'Rhino 9 WIP was not discovered under /Applications. Install Rhino WIP or pass --rhino-app to the Rhino WIP app bundle.',
                    reason:  'not_found',
                }))),
            Effect.mapError(CliError.from),
        ),
        fallback: _trimOpt(Option.fromNullable(config.rhinoAppPath)),
        label:    'Rhino 9 WIP app',
        override: input?.rhinoApp ?? Option.none(),
    }).pipe(
        Effect.filterOrFail(
            (path) => _RHINO_WIP_PATTERNS.some((pattern) => pattern.test(path.split('/').at(-1) ?? '')),
            (path) => new CliError({
                message: `Rhino 9 WIP is required. '${path}' is not a Rhino WIP app bundle.`,
                reason:  'validation',
            }),
        ),
    );
    const yakPath = yield* _resolvePath(fs, {
        discover: Effect.fail(new CliError({ message: 'Yak path could not be resolved.', reason: 'not_found' })),
        fallback: Option.orElse(_trimOpt(Option.fromNullable(config.rhinoYakPath)), () => Option.some(join(appPath, 'Contents/Resources/bin/yak'))),
        label:    'yak executable',
        override: input?.yakPath ?? Option.none(),
    });
    return { appPath, yakPath } as const;
});
const _isRhinoRunning = (appPath: string) =>
    shellExec('ps', ['-wwAo', 'command=']).pipe(
        Effect.map(({ stdout }) =>
            stdout
                .split('\n')
                .map((line) => line.trim())
                .some((line) => line.startsWith(join(appPath, 'Contents/MacOS/Rhinoceros'))),
        ),
        Effect.catchAll(() => Effect.succeed(false)),
    );
const _installPlugin = (input?: {
    readonly interactive?: boolean;
    readonly launch?: boolean;
    readonly rhinoApp?: Option.Option<string>;
    readonly yakPath?: Option.Option<string>;
}) => Effect.gen(function* () {
    const interactive = input?.interactive ?? false;
    const launch = input?.launch ?? false;
    const { appPath, yakPath } = yield* _resolveRhinoPaths(input);
    const rhinoRunning = yield* _isRhinoRunning(appPath);
    yield* Effect.when(
        Match.value(interactive).pipe(
            Match.when(true, () => Prompt.run(Prompt.confirm({
                initial: false,
                label:   { confirm: 'quit', deny: 'cancel' },
                message: `Rhino is running at ${appPath}. Quit it to continue plugin installation?`,
            })).pipe(
                Effect.flatMap((approved) => approved
                    ? shellExec('osascript', ['-e', `tell application "${appPath}" to quit`]).pipe(Effect.asVoid)
                    : Effect.fail(new CliError({ message: 'Plugin install cancelled while Rhino is running.', reason: 'validation' }))),
            )),
            Match.orElse(() => Effect.fail(new CliError({
                message: `Rhino is running at ${appPath}. Close Rhino before installing or upgrading the plugin.`,
                reason:  'validation',
            }))),
        ),
        () => rhinoRunning,
    );
    const nextStatus = yield* PluginManager.install(yakPath).pipe(Effect.mapError((error) => new CliError({
            detail: error,
            message: error instanceof PluginManagerError ? error.message : String(error),
            reason: 'runtime',
        })));
    yield* Effect.when(
        shellExec('open', [appPath]).pipe(
            Effect.mapError((detail) => new CliError({
                detail,
                message: `Launch Rhino failed for ${appPath}.`,
                reason: 'runtime',
            })),
            Effect.asVoid,
        ),
        () => launch,
    );
    return { appPath, status: nextStatus, yakPath } as const;
});
const _runMigrations = (url: string) => Effect.gen(function* () {
    const databaseConfig = KargadanDatabaseConfig(Redacted.make(url), Duration.seconds(10), Duration.seconds(30), 5);
    const readiness = yield* Effect.scoped(Effect.gen(function* () {
        const databaseLayer = Client.layerFromConfig(databaseConfig);
        yield* MigratorRun(databaseConfig);
        yield* Effect.provide(KargadanPostgres.applyKargadanSchema, databaseLayer);
        return yield* Effect.provide(_databaseReadiness, databaseLayer);
    }));
    yield* Effect.filterOrFail(
        Effect.succeed(readiness.ready),
        (ready) => ready,
        () => new CliError({ message: 'Database bootstrap completed but readiness checks still failed.', reason: 'runtime' }),
    );
    return { databaseConfig, readiness } as const;
});
const _setupWorkflow = (input?: {
    readonly databaseOnly?: boolean;
    readonly interactive?: boolean;
    readonly launchRhino?: boolean;
    readonly model?: Option.Option<string>;
    readonly provider?: Option.Option<string>;
    readonly rhinoApp?: Option.Option<string>;
    readonly yakPath?: Option.Option<string>;
}) => Effect.gen(function* () {
    const interactive = input?.interactive ?? false;
    const databaseConnection = yield* KargadanHost.postgres.bootstrap().pipe(Effect.mapError(CliError.from));
    const { readiness } = yield* _runMigrations(databaseConnection.url);
    yield* Match.value(input?.databaseOnly ?? false).pipe(
        Match.when(true, () => Effect.void),
        Match.orElse(() => Effect.gen(function* () {
            const config = yield* _readConfigSafe;
            const selectedProvider = yield* Match.value(input?.provider ?? Option.none()).pipe(
                Match.when({ _tag: 'Some' }, ({ value }) => _promptProvider(Option.some(value), 'Credential provider:').pipe(Effect.map(Option.some))),
                Match.orElse(() =>
                    Match.value(interactive).pipe(
                        Match.when(true, () => _promptProvider(Option.none(), 'Credential provider:').pipe(Effect.map(Option.some))),
                        Match.orElse(() => Effect.succeed(Option.none<keyof typeof AiRegistry.providers>())),
                    ),
                ),
            );
            yield* Option.match(selectedProvider, {
                onNone: () => Effect.void,
                onSome: (provider) => Effect.gen(function* () {
                    const statuses = yield* KargadanHost.auth.status.pipe(Effect.mapError(CliError.from));
                    const enrolled = statuses.some((status) => status.provider === provider && status.enrolled);
                    yield* Effect.when(
                        Match.value(interactive).pipe(
                            Match.when(true, () => _completeEnrollment({
                                config,
                                lines:    (gcp) => _gcLines(provider, gcp),
                                provider,
                                title:    'auth login',
                                write:    (gcp) => _writeGC(config, provider, gcp),
                            }).pipe(Effect.asVoid)),
                            Match.orElse(() => Effect.fail(new CliError({
                                message: `Credentials for '${provider}' are missing. Enroll them first with \`kargadan auth login --provider ${provider}\` or rerun setup interactively.`,
                                reason:  'validation',
                            }))),
                        ),
                        () => !enrolled,
                    );
                    const model = yield* Match.value(input?.model ?? Option.none()).pipe(
                        Match.when({ _tag: 'Some' }, ({ value }) => Effect.succeed(value.trim())),
                        Match.orElse(() =>
                            Match.value(interactive).pipe(
                                Match.when(true, () => AiRuntimeProvider.pipe(
                                    Effect.flatMap((runtimeProvider) => runtimeProvider.listModels(provider)),
                                    Effect.flatMap(_promptLiveModel),
                                    (effect) => _withAiLayer(effect),
                                )),
                                Match.orElse(() => Effect.succeed('')),
                            ),
                        ),
                    );
                    yield* Effect.when(
                        Effect.gen(function* () {
                            const [runtimeProvider, selection] = yield* _withAiLayer(Effect.all([AiRuntimeProvider, _readAiSelection]));
                            const nextSettings = yield* AiRegistry.decodeAppSettings({
                                ai: {
                                    ...Option.match(selection.settings, { onNone: () => ({}), onSome: AiRegistry.persistable }),
                                    model,
                                    provider,
                                },
                            }).pipe(Effect.mapError((error) => new CliError({
                                detail: error,
                                message: `Invalid model '${model}' for provider '${provider}'.`,
                                reason: 'validation',
                            })));
                            yield* runtimeProvider.validateSettings(nextSettings).pipe(Effect.mapError((error) => new CliError({
                                detail: error,
                                message: `Selected AI configuration is not ready for provider '${nextSettings.provider}'.`,
                                reason: 'validation',
                            })));
                            yield* runtimeProvider.persistSettings(selection.appId, nextSettings);
                        }),
                        () => model.trim().length > 0,
                    );
                }),
            });
        })),
    );
    const plugin = yield* Match.value(input?.databaseOnly ?? false).pipe(
        Match.when(true, () => Effect.succeed(Option.none<{
            readonly appPath: string;
            readonly status: {
                readonly bundlePath: Option.Option<string>;
                readonly bundleSha256: string;
                readonly expectedVersion: string;
                readonly installedVersion: Option.Option<string>;
                readonly packageName: string;
                readonly rhpFileName: string;
            };
            readonly yakPath: string;
        }>())),
        Match.orElse(() => _installPlugin({
            interactive,
            launch: input?.launchRhino ?? false,
            ...(input?.rhinoApp === undefined ? {} : { rhinoApp: input.rhinoApp }),
            ...(input?.yakPath === undefined ? {} : { yakPath: input.yakPath }),
        }).pipe(Effect.map(Option.some))),
    );
    yield* _print('kargadan setup', [
        `databaseProvider=${databaseConnection.mode}`,
        `dbReady=${String(readiness.ready)}`,
        ...Option.match(plugin, {
            onNone: () => [] as ReadonlyArray<string>,
            onSome: ({ status }) => [
                `pluginPackage=${status.packageName}`,
                `pluginInstalled=${Option.getOrElse(status.installedVersion, () => 'missing')}`,
            ],
        }),
    ]);
});
const _ensureRunReady = _requireLocalDatabaseReady.pipe(
    Effect.zipRight(_withAiLayer(_aiSelectionReadiness)),
    Effect.flatMap((selection) => {
        const summary = _selectionSummary(selection);
        return Match.value(selection.credentialStatus).pipe(
            Match.when('unselected', () => Effect.fail(new CliError({
                message: 'AI selection is not persisted. Run `kargadan setup` or `kargadan ai select --provider <provider> --model <model>` before `kargadan run`.',
                reason: 'validation',
            }))),
            Match.when('missing', () => Effect.fail(new CliError({
                message: `Selected provider '${Option.getOrElse(summary.provider, () => 'unknown')}' is missing credentials. Run \`kargadan auth login --provider ${Option.getOrElse(summary.provider, () => 'unknown')}\` first.`,
                reason: 'validation',
            }))),
            Match.when('invalid', () => Effect.fail(new CliError({
                message: `Selected AI configuration is invalid for provider '${Option.getOrElse(summary.provider, () => 'unknown')}'. ${Option.getOrElse(summary.validationError, () => '')}`.trim(),
                reason:  'validation',
            }))),
            Match.orElse(() => Effect.void),
        );
    }),
);
const _runInteractive = (input?: {
    readonly intent?: string; readonly resume?: 'auto' | 'off'; readonly sessionId?: string;
}) => Effect.scoped(Effect.gen(function* () {
    const resolvedIntent = yield* Option.fromNullable(input?.intent).pipe(Option.match({
        onNone: () => HarnessConfig.pipe(Effect.flatMap((c) => Prompt.run(Prompt.text({ default: c.agentIntent, message: 'Intent:',
            validate: (v) => v.trim().length === 0 ? Effect.fail('Intent cannot be empty') : Effect.succeed(v.trim()) })))),
        onSome: Effect.succeed }));
    const signals = yield* Queue.unbounded<Option.Option<HelpDoc.HelpDoc>>();
    const consume: Effect.Effect<void> = Queue.take(signals).pipe(Effect.flatMap(Option.match({
        onNone: () => Effect.void, onSome: (doc) => Console.log(HelpDoc.toAnsiText(doc)).pipe(Effect.zipRight(consume)) })));
    const renderer = yield* Effect.forkScoped(Effect.suspend(() => consume));
    const emit = (kind: 'error' | 'code', tag: string, content: string) =>
        Queue.offer(signals, Option.some(HelpDoc.p(Span.spans([kind === 'error' ? Span.error(tag) : Span.code(tag), Span.space, Span.text(content)])))).pipe(Effect.asVoid);
    const outcome = yield* HarnessRuntime.run({
        hooks: { ...HarnessRuntime.makeInteractiveHooks(emit, _compact),
            onWriteApproval: (e) => Prompt.run(Prompt.confirm({ initial: false, label: { confirm: 'approve', deny: 'reject' },
                message: `Approve write '${e.command.commandId}' (wf=${e.workflowExecutionId}) args=${_compact(e.command.args)} refs=${e.command.objectRefs?.map((r) => `${r.typeTag}:${r.objectId}`).join(',') ?? 'none'}?` })).pipe(
                Effect.catchAll(() => Effect.succeed(false)),
                Effect.tap((approved) => emit('code', '[approval]', `${e.command.commandId} -> ${approved ? 'approved' : 'rejected'} (${e.workflowExecutionId})`)))
        }, ...input, intent: resolvedIntent,
    }).pipe(Effect.ensuring(Queue.offer(signals, Option.none()).pipe(Effect.zipRight(Fiber.join(renderer)))));
    yield* _print('Run complete', [`session: ${outcome.state.identityBase.sessionId}`, `status: ${outcome.state.status}`,
        `sequence: ${String(outcome.state.sequence)}`, `trace entries: ${String(outcome.trace.items.length)}`]);
}));
// --- [COMMANDS] --------------------------------------------------------------

const _runCommand = Command.make('run', {
    configOverride: Options.keyValueMap('config').pipe(Options.withAlias('c'), Options.withDescription('Config overrides'), Options.withDefault(HashMap.empty<string, string>())),
    intent: Options.text('intent').pipe(Options.withAlias('i'), Options.withDescription('Natural language intent'),
        Options.withFallbackConfig(Config.string('KARGADAN_AGENT_INTENT')), Options.withFallbackPrompt(Prompt.text({
        message: 'Intent:', validate: (v) => v.trim().length === 0 ? Effect.fail('Intent cannot be empty') : Effect.succeed(v.trim()) }))),
    resume: Options.choice('resume', ['auto', 'off'] as const).pipe(Options.withAlias('r'), Options.withDefault('auto')),
    sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.optional),
}, (input) => _requireTty.pipe(
    Effect.zipRight(Effect.suspend(() => _ensureRunReady)),
    Effect.zipRight((<A, E, R>(run: Effect.Effect<A, E, R>) =>
    HashMap.size(input.configOverride) > 0
        ? Effect.withConfigProvider(run, ConfigProvider.fromMap(new Map(HashMap.toEntries(input.configOverride).map(([k, v]) => [ConfigFile.runtimeKey(k), v] as const))))
        : run)(_runInteractive({ intent: input.intent, resume: input.resume,
    ...Option.match(input.sessionId, { onNone: () => ({}), onSome: (sessionId) => ({ sessionId }) }) })))
)).pipe(Command.withDescription('Run the interactive agent loop (--resume auto resumes latest session).'));
const _setupCommand = Command.make('setup', {
    launchRhino: Options.boolean('launch-rhino').pipe(Options.withDefault(false)),
    model: Options.text('model').pipe(Options.optional),
    provider: Options.text('provider').pipe(Options.optional),
    yes: Options.boolean('yes').pipe(Options.withDefault(false)),
}, (input) => Effect.gen(function* () {
    yield* Match.value(input.yes).pipe(
        Match.when(true, () => Effect.void),
        Match.orElse(() => _requireTty),
    );
    yield* _setupWorkflow({
        interactive: !input.yes,
        launchRhino: input.launchRhino,
        model:       input.model,
        provider:    input.provider,
    });
})).pipe(Command.withDescription('Provision or repair the local environment, then optionally select AI and launch Rhino.'));
const _sessionsCommand = (() => {
    const _list = Command.make('list', {
        cursor: Options.text('cursor').pipe(Options.optional), limit: Options.integer('limit').pipe(Options.withAlias('l'), Options.withDefault(20)),
        status: Options.choice('status', ['running', 'completed', 'failed', 'interrupted'] as const).pipe(Options.repeated),
    }, (input) => AgentPersistenceService.pipe(Effect.flatMap((p) => p.list({
        limit: input.limit, ...Option.match(input.cursor, { onNone: () => ({}), onSome: (cursor) => ({ cursor }) }),
        ...(input.status.length > 0 ? { status: input.status } : {}),
    }).pipe(Effect.tap((r) => _print('sessions list', [`total=${String(r.total)} hasNext=${String(r.hasNext)} hasPrev=${String(r.hasPrev)}`,
        ...r.items.map((i) => `${i.id} | ${i.status} | started=${i.startedAt.toISOString()} | toolCalls=${String(i.toolCallCount)}`)])))),
    )).pipe(Command.withDescription('List persisted sessions.'));
    const _timeline = Command.make('trace', {
        limit: Options.integer('limit').pipe(Options.withDefault(100)), sessionId: Options.text('session-id'),
    }, (input) => AgentPersistenceService.pipe(Effect.flatMap((p) => p.trace(input.sessionId, { limit: input.limit }).pipe(Effect.tap((pg) =>
        _print(`sessions trace ${input.sessionId}`, [`items=${String(pg.items.length)} hasNext=${String(pg.hasNext)} cursor=${pg.cursor ?? 'null'}`,
            ...(pg.items as ReadonlyArray<(typeof pg.items)[0] & _TraceProjection>).map((i) => [`#${String(i.sequence)}`, i.operation, i.success ? 'ok' : 'error', `${String(i.durationMs)}ms`, i.failureClass ?? '-', i.workflowExecutionId ?? '-'].join(' | '))])))),
    )).pipe(Command.withDescription('Show tool-call timeline for a session.'));
    const _export = Command.make('export', {
        format: Options.choice('format', ['ndjson', 'csv'] as const).pipe(Options.withAlias('f'), Options.withDefault('ndjson')),
        output: Options.text('output').pipe(Options.withAlias('o')), sessionId: Options.text('session-id').pipe(Options.withAlias('s')),
    }, (input) => Effect.gen(function* () {
        const [{ exportLimit }, persistence, fs] = yield* Effect.all([HarnessConfig, AgentPersistenceService, FileSystem.FileSystem]);
        const trace = yield* persistence.trace(input.sessionId, { limit: exportLimit }).pipe(Effect.flatMap((first) => Effect.iterate(first, {
            body: (st) => persistence.trace(input.sessionId, { limit: exportLimit, ...(st.cursor == null ? {} : { cursor: st.cursor }) }).pipe(
                Effect.map((pg) => ({ ...pg, items: [...st.items, ...pg.items] }))),
            while: (st) => st.hasNext && st.cursor != null })));
        const content = input.format === 'ndjson'
            ? `${trace.items.map((i) => JSON.stringify({ ...i, result: Option.getOrUndefined(i.result) })).join('\n')}\n`
            : [_csvHeaders, ...(trace.items as ReadonlyArray<(typeof trace.items)[0] & _TraceProjection>).map((i) => [String(i.sequence), i.createdAt.toISOString(), i.operation, i.success ? 'ok' : 'error', String(i.durationMs),
                i.failureClass ?? '', i.workflowExecutionId ?? '', i.workflowCommandId ?? '', i.workflowApproved === undefined ? '' : String(i.workflowApproved),
                _compact(i.params), Option.getOrElse(Option.map(i.result, _compact), () => '')])].map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(',')).join('\n');
        yield* fs.writeFileString(input.output, content).pipe(Effect.zipRight(
            _print('sessions export', [`session=${input.sessionId}`, `format=${input.format}`, `output=${input.output}`, `rows=${String(trace.items.length)}`])));
    })).pipe(Command.withDescription('Export session trace as NDJSON or CSV.'));
    const _prune = Command.make('prune', { before: Options.text('before').pipe(Options.withDescription('ISO date cutoff')) },
        (input) => Effect.filterOrFail(
            Effect.sync(() => new Date(input.before)),
            (d) => !Number.isNaN(d.getTime()),
            () => new CliError({ detail: input.before, message: `Invalid date '${input.before}'. Provide an ISO 8601 date, e.g. 2026-01-01T00:00:00Z.`, reason: 'validation' }),
        ).pipe(Effect.flatMap((cutoff) => AgentPersistenceService.pipe(Effect.flatMap((p) => Effect.iterate({ continue: true as boolean, pruned: 0 }, {
            body: (st) => p.list({ before: cutoff, limit: 500, status: ['completed', 'failed', 'interrupted'] as const }).pipe(
                Effect.tap((pg) => Effect.forEach(pg.items, (s) => p.deleteSession(s.id), { discard: true })),
                Effect.map((pg) => ({ continue: pg.items.length > 0, pruned: st.pruned + pg.items.length }))),
            while: (st) => st.continue,
        }).pipe(Effect.tap((r) => _print('sessions prune', [`cutoff=${input.before}`, `pruned=${String(r.pruned)}`]))))))))
        .pipe(Command.withDescription('Prune sessions before a date.'));
    return Command.make('sessions').pipe(Command.withSubcommands([_list, _timeline, _export, _prune]), Command.withDescription('Session operator commands.'),
        Command.transformHandler((effect) => _withAppTenant(effect)), Command.provide(HarnessConfig.persistenceLayer));
})();
const _configCommand = Command.make('config', {
    key: Options.text('key').pipe(Options.optional), value: Options.text('value').pipe(Options.optional),
}, (input) => ConfigFile.read.pipe(Effect.flatMap((config) => Option.match(input.key, {
    onNone: () => _print(`config list (${ConfigFile.path})`, ConfigFile.flatten(config)),
    onSome: (key) => Effect.filterOrFail(Effect.succeed(key), (c): c is (typeof ConfigFile.keys)[number] => ConfigFile.keys.includes(c as (typeof ConfigFile.keys)[number]),
        () => new CliError({ message: `Unsupported config key '${key}'.`, reason: 'validation' })).pipe(Effect.flatMap((c) => Option.match(input.value, {
            onNone: () => _print(`config get ${c}`, [((v: unknown) => v === undefined ? `${c} is not set` : `${c} = ${String(v)}`)(ConfigFile.get(config, c))]),
            onSome: (v) => ConfigFile.set(config, c, v).pipe(Effect.flatMap(ConfigFile.write), Effect.zipRight(_print('config set', [`${c} = ${v}`, `written to ${ConfigFile.path}`]))) }))),
})))).pipe(Command.withDescription('Config operations: no args=list, --key=get, --key + --value=set.'));
const _diagnosticsCommand = (() => {
    const _check = Command.make('check', {}, () => Effect.gen(function* () {
        const transport = yield* readPortFile().pipe(
            Effect.map(({ pid, port }) => ({ message: `pid=${pid} port=${port}`, status: 'ok' as const })),
            Effect.catchTag('SocketClientError', (e) => Effect.succeed({ message: e.message, status: ({ port_file_not_found: 'missing', port_file_stale: 'stale' } as Record<string, string>)[e.reason] ?? 'invalid' })));
        const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const [auth, databaseStatus, integrity, dataDir] = yield* Effect.all([
            KargadanHost.auth.status.pipe(Effect.mapError(CliError.from)),
            _databaseStatus,
            fs.readFileString(ConfigFile.path).pipe(Effect.map((raw) => ({ hash: createHash('sha256').update(raw).digest('hex').slice(0, 16), status: 'ok' as const })),
                Effect.catchAll(() => Effect.succeed({ hash: 'n/a', status: 'missing' as const }))),
            fs.exists(ConfigFile.dir).pipe(Effect.map((v) => v ? 'accessible' as const : 'missing' as const), Effect.catchAll(() => Effect.succeed('error' as const))),
        ]);
        const probeLines = yield* Match.value(databaseStatus.state).pipe(
            Match.when('ready', () => AgentPersistenceService.pipe(
                Effect.flatMap((service) => service.list({ limit: 1 })),
                Effect.map((probe) => [`dbReachable=true totalSessions=${String(probe.total)}`] as const),
                Effect.provide(HarnessConfig.persistenceLayer),
            )),
            Match.when('not_initialized', () => Effect.succeed([`dbReachable=true totalSessions=unavailable`] as const)),
            Match.orElse(() => Effect.succeed([`dbReachable=false totalSessions=unavailable`] as const)),
        );
        const selectionLines = yield* Match.value(databaseStatus.state).pipe(
            Match.when('ready', () => _aiSelectionReadiness.pipe(
                Effect.map(_selectionLines),
                (effect) => _withAiLayer(effect),
            )),
            Match.orElse(() => Effect.succeed(_selectionDatabaseUnavailableLines(databaseStatus))),
        );
        const dbLines = Option.match(databaseStatus.readiness, {
            onNone: () => [
                `databaseProvider=${databaseStatus.provider}`,
                'dbReady=false appTables=unavailable persistenceTables=unavailable searchTables=unavailable searchFunctions=unavailable searchProfileHash=unavailable supportedProfiles=unavailable',
                'dbServer=unavailable',
                ...Option.match(databaseStatus.issue, { onNone: () => [] as ReadonlyArray<string>, onSome: (issue) => [`dbIssue=${issue}`] }),
            ] as const,
            onSome: (readiness) => [
                `databaseProvider=${databaseStatus.provider}`,
                `dbReady=${String(readiness.ready)} appTables=${String(readiness.hasAppTables)} persistenceTables=${String(readiness.hasPersistenceTables)} searchTables=${String(readiness.hasSearchTables)} searchFunctions=${String(readiness.hasSearchFunctions)} searchProfileHash=${String(readiness.hasSearchProfileHash)} supportedProfiles=${String(readiness.hasSupportedProfiles)}`,
                `dbServer=${readiness.serverVersion} (${String(readiness.serverVersionNum)})`,
                ...Option.match(databaseStatus.issue, { onNone: () => [] as ReadonlyArray<string>, onSome: (issue) => [`dbIssue=${issue}`] }),
            ] as const,
        });
        yield* _print('diagnostics check', [`appId=${config.appId}`, `protocol=${String(config.protocolVersion.major)}.${String(config.protocolVersion.minor)}`,
            ...probeLines,
            ...dbLines,
            ...selectionLines,
            `auth=${auth.map((entry) => `${entry.provider}:${entry.enrolled ? 'ok' : 'missing'}${Option.isSome(entry.decodeError) ? ':DECODE_ERROR' : ''}`).join(',')}`,
            `transport=${transport.status} (${transport.message})`, `configIntegrity=${integrity.status} hash=${integrity.hash}`, `dataDir=${dataDir} (${ConfigFile.dir})`]);
    })).pipe(
        Command.withDescription('Validate environment, DB, transport, config, and data directory.'),
        Command.provide(HarnessConfig.Default),
    );
    const _live = Command.make('live', {
        launch:   Options.boolean('launch').pipe(Options.withDefault(false)), prepare: Options.boolean('prepare').pipe(Options.withDefault(false)),
        rhinoApp: Options.text('rhino-app').pipe(Options.optional), yakPath: Options.text('yak-path').pipe(Options.optional),
    }, (input) => Effect.gen(function* () {
        yield* Effect.when(Effect.fail(new CliError({
            message: '`diagnostics live --prepare` is deprecated. Use `kargadan plugin install` instead.',
            reason:  'validation',
        })), () => input.prepare);
        const plugin = yield* Effect.when(
            _installPlugin({ interactive: true, launch: true, rhinoApp: _trimOpt(input.rhinoApp), yakPath: _trimOpt(input.yakPath) }),
            () => input.launch,
        );
        const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const transport = yield* (input.launch
            ? readPortFile().pipe(Effect.retry(Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(Duration.millis(config.rhinoLaunchTimeoutMs)))),
                Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: `Transport not ready within ${String(config.rhinoLaunchTimeoutMs)}ms.`, reason: 'not_found' }))))
            : readPortFile().pipe(Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: 'Transport not active. Rerun with --launch after installing the plugin.', reason: 'not_found' })))));
        const live = yield* HarnessRuntime.probeLive.pipe(Effect.mapError((d) => new CliError({ detail: d, message: d instanceof Error ? d.message : 'Live Rhino probe failed.', reason: 'runtime' })));
        const artifactFile = join(_LIVE_ARTIFACT_DIR, `probe-${new Date().toISOString().replaceAll(':', '-')}.json`);
        const artifact = { acceptedCapabilities: live.handshake.acceptedCapabilities, catalog: live.handshake.catalog, catalogCount: live.handshake.catalog.length,
            createdAt: new Date().toISOString(), launch: input.launch, plugin: Option.getOrNull(plugin), sceneSummary: live.summary, server: live.handshake.server ?? null, transport };
        const artifactPath = yield* fs.makeDirectory(_LIVE_ARTIFACT_DIR, { recursive: true }).pipe(Effect.zipRight(fs.writeFileString(artifactFile, JSON.stringify(artifact, null, 2))), Effect.as(artifactFile));
        yield* _print('diagnostics live', [`artifact=${artifactPath}`, `transport=pid:${String(transport.pid)} port:${String(transport.port)}`,
            `server=${live.handshake.server?.rhinoVersion ?? 'unknown'} plugin=${live.handshake.server?.pluginRevision ?? 'unknown'}`,
            `catalog=${String(live.handshake.catalog.length)} capabilities=${live.handshake.acceptedCapabilities.join(',') || 'none'}`,
            `scene.objectCount=${String(live.summary.objectCount)}`, ...Option.match(plugin, { onNone: () => [] as ReadonlyArray<string>,
                onSome: ({ status }) => [`pluginPackage=${status.packageName}`, `pluginInstalled=${Option.getOrElse(status.installedVersion, () => 'missing')}`] })]);
        yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
        yield* Effect.sync(() => process.exit(0));
    })).pipe(Command.withDescription('Probe live Rhino: optionally ensure the release plugin is installed before launch, then handshake and read.scene.summary.'));
    return Command.make('diagnostics').pipe(Command.withSubcommands([_check, _live]), Command.withDescription('Diagnostics commands.'),
        Command.transformHandler((effect) => _withAppTenant(effect)));
})();
const _authCommand = (() => Command.make('auth').pipe(Command.withSubcommands([
    Command.make('login', {
        clientPath: Options.text('client-path').pipe(Options.optional), provider: Options.text('provider').pipe(Options.optional),
    }, (input) => _requireTty.pipe(Effect.zipRight(ConfigFile.read), Effect.flatMap((config) =>
        _promptProvider(input.provider, 'Credential provider:').pipe(Effect.flatMap((provider) => _completeEnrollment({
            clientPathHint: _trimOpt(input.clientPath), config,
            lines: (gcp) => _gcLines(provider, gcp), provider, title: 'auth login',write: (gcp) => _writeGC(config, provider, gcp) })))))).pipe(Command.withDescription('Enroll credentials.')),
    Command.make('status', {}, () => Effect.all([
        _readConfigSafe,
        KargadanHost.auth.status.pipe(Effect.mapError(CliError.from)),
        _databaseStatus,
    ]).pipe(
        Effect.flatMap(([config, statuses, databaseStatus]) => Match.value(databaseStatus.state).pipe(
            Match.when('ready', () => _aiSelectionReadiness.pipe(Effect.flatMap((selection) => _print('auth status', [
                `databaseProvider=${databaseStatus.provider}`,
                ..._authSelectionLines(selection),
                ...statuses.map((status) => `${status.provider} | ${status.kind} | ${status.enrolled ? 'enrolled' : 'missing'}${Option.match(status.decodeError, { onNone: () => '', onSome: (error) => ` | DECODE_ERROR: ${error}` })}${status.provider === 'gemini' ? ` | client=${String(ConfigFile.get(config, 'ai.geminiClientPath') ?? 'unset')}` : ''}`),
            ])), (effect) => _withAiLayer(effect))),
            Match.orElse(() => _print('auth status', [
                ..._authDatabaseUnavailableLines(databaseStatus),
                ...statuses.map((status) => `${status.provider} | ${status.kind} | ${status.enrolled ? 'enrolled' : 'missing'}${Option.match(status.decodeError, { onNone: () => '', onSome: (error) => ` | DECODE_ERROR: ${error}` })}${status.provider === 'gemini' ? ` | client=${String(ConfigFile.get(config, 'ai.geminiClientPath') ?? 'unset')}` : ''}`),
            ])),
        )),
    )).pipe(Command.withDescription('Show credential enrollment status.')),
    Command.make('logout', { provider: Options.text('provider').pipe(Options.optional) },
        (input) => Option.match(input.provider, {
            onNone: () => KargadanHost.auth.logout().pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', ['providers=all', 'status=cleared']))),
            onSome: (raw) => Effect.filterOrFail(Effect.succeed(raw.trim()), (v): v is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, v),
                () => new CliError({ message: `Unknown provider '${raw.trim()}'.`, reason: 'validation' })).pipe(
                    Effect.flatMap((p) => KargadanHost.auth.logout(p).pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', [`provider=${p}`, 'status=cleared']))))),
        })).pipe(Command.withDescription('Clear enrolled credentials.')),
]), Command.withDescription('Credential enrollment and status.'), Command.provide(HarnessConfig.Default)))();
const _aiCommand = (() => {
    const _status = Command.make('status', {}, () => _databaseStatus.pipe(
        Effect.flatMap((databaseStatus) => Match.value(databaseStatus.state).pipe(
            Match.when('ready', () => _aiSelectionReadiness.pipe(Effect.flatMap((selection) => _print('ai status', [
                `databaseProvider=${databaseStatus.provider}`,
                'databaseReady=true',
                ..._selectionLines(selection),
            ])), (effect) => _withAiLayer(effect))),
            Match.orElse(() => _print('ai status', [
                'databaseReady=false',
                ..._selectionDatabaseUnavailableLines(databaseStatus),
            ])),
        )),
    )).pipe(Command.withDescription('Show the selected provider, model, embedding profile, and readiness.'));
    const _select = Command.make('select', {
        model: Options.text('model').pipe(Options.optional),
        provider: Options.text('provider').pipe(Options.optional),
    }, (input) => Effect.gen(function* () {
        yield* Effect.when(_requireTty, () => Option.isNone(input.model) || Option.isNone(input.provider));
        yield* _requireDatabaseReady.pipe(Effect.provide(HarnessConfig.databaseLayer));
        const [runtimeProvider, selection] = yield* _withAiLayer(Effect.all([AiRuntimeProvider, _readAiSelection]));
        const provider = yield* _promptProvider(input.provider, 'Runtime provider:');
        const models = yield* runtimeProvider.listModels(provider).pipe(
            Effect.mapError((error) => new CliError({
                detail: error,
                message: `Could not load live models for provider '${provider}'. Enroll credentials first, then retry.`,
                reason: 'validation',
            })),
        );
        const model = yield* Option.match(input.model, {
            onNone: () => _promptLiveModel(models),
            onSome: (value) => Effect.succeed(value.trim()),
        });
        const nextSettings = yield* AiRegistry.decodeAppSettings({
            ai: {
                ...Option.match(selection.settings, { onNone: () => ({}), onSome: AiRegistry.persistable }),
                model,
                provider,
            },
        }).pipe(
            Effect.mapError((error) => new CliError({
                detail: error,
                message: `Invalid model '${model}' for provider '${provider}'.`,
                reason: 'validation',
            })),
        );
        yield* runtimeProvider.validateSettings(nextSettings).pipe(
            Effect.mapError((error) => new CliError({
                detail: error,
                message: `Selected AI configuration is not ready for provider '${nextSettings.provider}'. Enroll credentials first, then retry.`,
                reason: 'validation',
            })),
        );
        yield* runtimeProvider.persistSettings(selection.appId, nextSettings);
        const reindexed = yield* AiService.pipe(Effect.flatMap((service) => service.searchRefreshEmbeddings({ includeGlobal: true })));
        yield* _print('ai select', [
            `provider=${nextSettings.provider}`,
            `model=${nextSettings.model}`,
            `embedding=${nextSettings.embedding.provider}:${nextSettings.embedding.model}:${String(nextSettings.embedding.dimensions)}`,
            `pruned=${String(reindexed.pruned)}`,
            `reindexed=${String(reindexed.count)}`,
        ]);
    }).pipe((effect) => _withAiLayer(effect))).pipe(Command.withDescription('Persist the active provider/model in apps.settings.ai and reindex generic embeddings.'));
    const _reindex = Command.make('reindex', {}, () => _requireSelectionReady.pipe(Effect.zipRight(AiService.pipe(
        Effect.flatMap((service) => service.searchRefreshEmbeddings({ includeGlobal: true })),
        Effect.flatMap((result) => _print('ai reindex', [`pruned=${String(result.pruned)}`, `reindexed=${String(result.count)}`])),
    ))).pipe((effect) => _withAiLayer(effect))).pipe(Command.withDescription('Rebuild search embeddings for the current provider-derived profile.'));
    return Command.make('ai').pipe(
        Command.withSubcommands([_status, _select, _reindex]),
        Command.withDescription('AI provider selection and reindex operations.'),
        Command.transformHandler((effect) => _withAppTenant(effect)),
        Command.provide(HarnessConfig.Default),
    );
})();
const _pluginCommand = (() => Command.make('plugin').pipe(Command.withSubcommands([
    Command.make('status', {
        rhinoApp: Options.text('rhino-app').pipe(Options.optional),
        yakPath:  Options.text('yak-path').pipe(Options.optional),
    }, (input) => _resolveRhinoPaths({ rhinoApp: _trimOpt(input.rhinoApp), yakPath: _trimOpt(input.yakPath) }).pipe(
        Effect.flatMap(({ appPath, yakPath }) => PluginManager.status(yakPath).pipe(
            Effect.mapError((error) => new CliError({
                detail: error,
                message: error instanceof PluginManagerError ? error.message : String(error),
                reason: 'runtime',
            })),
            Effect.flatMap((status) => _print('plugin status', [
                `rhinoApp=${appPath}`,
                `yakPath=${yakPath}`,
                `package=${status.packageName}`,
                `expectedVersion=${status.expectedVersion}`,
                `installedVersion=${Option.getOrElse(status.installedVersion, () => 'missing')}`,
                `bundle=${Option.getOrElse(status.bundlePath, () => 'missing')}`,
            ])),
        )),
    )).pipe(Command.withDescription('Show Rhino plugin install state.')),
    Command.make('install', {
        launch:   Options.boolean('launch').pipe(Options.withDefault(false)),
        rhinoApp: Options.text('rhino-app').pipe(Options.optional),
        yakPath:  Options.text('yak-path').pipe(Options.optional),
    }, (input) => Terminal.Terminal.pipe(
        Effect.flatMap((terminal) => terminal.isTTY),
        Effect.flatMap((interactive) => _installPlugin({
            interactive,
            launch:   input.launch,
            rhinoApp: _trimOpt(input.rhinoApp),
            yakPath:  _trimOpt(input.yakPath),
        })),
        Effect.flatMap(({ appPath, status, yakPath }) => _print('plugin install', [
            `rhinoApp=${appPath}`,
            `yakPath=${yakPath}`,
            `package=${status.packageName}`,
            `installedVersion=${Option.getOrElse(status.installedVersion, () => 'missing')}`,
        ])),
    )).pipe(Command.withDescription('Install the release Rhino plugin.')),
    Command.make('upgrade', {
        launch:   Options.boolean('launch').pipe(Options.withDefault(false)),
        rhinoApp: Options.text('rhino-app').pipe(Options.optional),
        yakPath:  Options.text('yak-path').pipe(Options.optional),
    }, (input) => Terminal.Terminal.pipe(
        Effect.flatMap((terminal) => terminal.isTTY),
        Effect.flatMap((interactive) => _installPlugin({
            interactive,
            launch:   input.launch,
            rhinoApp: _trimOpt(input.rhinoApp),
            yakPath:  _trimOpt(input.yakPath),
        })),
        Effect.flatMap(({ appPath, status, yakPath }) => _print('plugin upgrade', [
            `rhinoApp=${appPath}`,
            `yakPath=${yakPath}`,
            `package=${status.packageName}`,
            `installedVersion=${Option.getOrElse(status.installedVersion, () => 'missing')}`,
        ])),
    )).pipe(Command.withDescription('Upgrade the release Rhino plugin to the expected version.')),
]), Command.withDescription('Rhino plugin installation and status.'), Command.provide(HarnessConfig.Default)))();
const _rootCommand = Command.make('kargadan', {}, () => Terminal.Terminal.pipe(
    Effect.flatMap((terminal) => terminal.isTTY),
    Effect.flatMap((isTTY) => Effect.suspend(() => _ensureRunReady).pipe(
        Effect.matchEffect({
            onFailure: (error) => Match.value(CliError.from(error)).pipe(
                Match.when((cliError: CliError) => isTTY && (cliError.reason === 'not_found' || cliError.reason === 'validation'),
                    () => _setupWorkflow({ interactive: true })),
                Match.orElse((cliError) => isTTY
                    ? Effect.fail(cliError)
                    : _print('kargadan readiness', ['action=kargadan setup', `issue=${cliError.message}`]).pipe(Effect.zipRight(Effect.fail(cliError)))),
            ),
            onSuccess: () => isTTY
                ? _runInteractive()
                : Effect.fail(new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' })),
        }),
    )),
)).pipe(
    Command.withSubcommands([_runCommand, _setupCommand, _authCommand, _aiCommand, _pluginCommand, _sessionsCommand, _configCommand, _diagnosticsCommand]),
    Command.transformHandler((h) => h.pipe(Effect.withSpan('kargadan.cli.command'), Effect.mapError(CliError.from))), Command.provide(HarnessConfig.Default));

// --- [ENTRY] -----------------------------------------------------------------

NodeRuntime.runMain(loadConfigProvider.pipe(
    Effect.flatMap((provider) => Command.run({ name: 'kargadan', version: _version })(_rootCommand)(process.argv).pipe(
        Effect.provide(CliConfig.layer({ finalCheckBuiltIn: false })),
        Effect.provide(provider.decodeFailuresLayer),
        Effect.withConfigProvider(provider.provider))),
    Effect.provide(NodeFileSystem.layer), Effect.provide(NodeContext.layer),
    Effect.catchAllCause((cause) => Cause.failureOption(cause).pipe(Option.match({
        onNone: () => Match.value(CliError.from(Cause.squash(cause))).pipe(
            Match.when(Match.instanceOf(CliError), (cliError) =>
                Console.error(HelpDoc.toAnsiText(cliError.doc)).pipe(
                    Effect.zipRight(Console.error(Cause.pretty(cause))),
                    Effect.zipRight(Effect.failCause(cause)),
                )),
            Match.orElse(() => Console.error(Cause.pretty(cause)).pipe(Effect.zipRight(Effect.failCause(cause))))),
        onSome: (error) => Match.value(error).pipe(
            Match.when(Match.instanceOf(CliError), (cliError) => Console.error(HelpDoc.toAnsiText(cliError.doc)).pipe(Effect.zipRight(Effect.fail(cliError)))),
            Match.when(ValidationError.isValidationError, (validationError) => Console.error(_compact(validationError)).pipe(Effect.zipRight(Effect.fail(validationError)))),
            Match.orElse((unknownError) => Console.error(_compact(unknownError)).pipe(Effect.zipRight(Effect.fail(unknownError)))),
        ),
    }))),
) as Effect.Effect<void, unknown, never>, { disableErrorReporting: true });
