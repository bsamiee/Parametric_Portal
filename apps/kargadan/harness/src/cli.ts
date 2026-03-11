import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as ProcessCommand from '@effect/platform/Command';
import * as FileSystem from '@effect/platform/FileSystem';
import * as Terminal from '@effect/platform/Terminal';
import { NodeCommandExecutor, NodeContext, NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { CliConfig, Command, HelpDoc, Options, Prompt, Span, ValidationError } from '@effect/cli';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Context } from '@parametric-portal/server/context';
import * as Console from 'effect/Console';
import { Config, ConfigProvider, Data, Duration, Effect, Fiber, HashMap, Match, Option, Queue, Redacted, Schedule } from 'effect';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { ConfigFile, HarnessConfig, HarnessHostError, type KargadanConfigSchema, KargadanHost, loadConfigProvider } from './config';
import { HarnessRuntime } from './harness';
import { readPortFile } from './socket';

// --- [TYPES] -----------------------------------------------------------------

type _TraceItem = { readonly failureClass?: string; readonly workflowApproved?: boolean; readonly workflowCommandId?: string; readonly workflowExecutionId?: string };

// --- [CONSTANTS] -------------------------------------------------------------

declare const __APP_VERSION__: string; const _version = __APP_VERSION__;
const _csvHeaders = ['sequence','createdAt','operation','status','durationMs','failureClass','workflowExecutionId','workflowCommandId','workflowApproved','params','result'] as const;
const _Plugin = {
    artifactDir: join(ConfigFile.dir, 'live'),           buildDir:         join(import.meta.dirname, '../../plugin/bin/Release/net9.0'),
    fileName:    'ParametricPortal.Kargadan.Plugin.rhp', manifestFileName: 'manifest.yml',
    nxProject:   'ParametricPortal.Kargadan.Plugin',     stageDir:         join(ConfigFile.dir, 'plugin'), targetFramework: 'net9.0',
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class CliError extends Data.TaggedError('CliError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  keyof typeof CliError.reasons;
}> {
    static readonly reasons = {
        io:           { advice: 'Retry after transient conditions clear.',  failureClass: 'retryable'   },
        not_found:    { advice: 'Adjust parameters, then retry.',           failureClass: 'correctable' },
        runtime:      { advice: 'Inspect transport/protocol before retry.', failureClass: 'fatal'       },
        tty_required: { advice: 'Run in a TTY session.',                    failureClass: 'correctable' },
        validation:   { advice: 'Adjust parameters or rerun with flags.',   failureClass: 'correctable' },
    } as const;
    static readonly from = (error: unknown) => Match.value(error).pipe(
        Match.when(Match.instanceOf(CliError), (e) => e),
        Match.when(Match.instanceOf(HarnessHostError), (e) => new CliError({ detail: e.detail, message: e.message,
            reason: ({ auth: 'validation', config: 'validation', keychain: 'runtime', postgres: 'not_found' } as const satisfies Record<HarnessHostError['reason'], CliError['reason']>)[e.reason] })),
        Match.orElse((e) => new CliError({ detail: e, message: String(e), reason: 'runtime' })));
    get policy() { return CliError.reasons[this.reason]; }
    get doc() {
        return HelpDoc.blocks([HelpDoc.h1(Span.error(`kargadan ${this.reason}`)), HelpDoc.p(Span.text(`failureClass: ${this.policy.failureClass}`)),
            HelpDoc.p(Span.text(`issue: ${this.message}`)), HelpDoc.p(Span.text(`recovery: ${this.policy.advice}`))]);
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _compact = (value: unknown) => ((s: string) => s.length <= 140 ? s : `${s.slice(0, 140)}...`)(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));
const _print = (title: string, lines: ReadonlyArray<string>) => Console.log(HelpDoc.toAnsiText(HelpDoc.blocks([HelpDoc.h1(Span.text(title)), ...lines.map((l) => HelpDoc.p(Span.text(l)))])));
const _trimOpt = (opt: Option.Option<string>) => opt.pipe(Option.map((v) => v.trim()), Option.filter((v) => v.length > 0));
const _withAppTenant = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flatMap(HarnessConfig, (config) => Context.Request.within(config.appId, effect));
const _requireTty = Terminal.Terminal.pipe(Effect.flatMap((terminal) => terminal.isTTY),
    Effect.filterOrFail((isTTY) => isTTY, () => new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' })), Effect.asVoid);
const _enrollProvider = (provider: keyof typeof AiRegistry.providers, config: typeof KargadanConfigSchema.Type, clientPathHint?: Option.Option<string>) =>
    Match.value(AiRegistry.providers[provider].credential.kind).pipe(
        Match.when('api-secret', () => Prompt.run(Prompt.hidden({ message: `${provider} API secret:`,
            validate: (value) => value.trim().length === 0 ? Effect.fail('Credential cannot be empty') : Effect.succeed(value.trim()) })).pipe(
            Effect.map(Redacted.value), Effect.flatMap((secret) => KargadanHost.auth.login({ provider, secret })), Effect.as(Option.none<string>()))),
        Match.orElse(() => Option.match(clientPathHint ?? Option.none<string>(), {
            onNone: () => Prompt.run(Prompt.text({ ...(Option.match(_trimOpt(Option.fromNullable(config.geminiClientPath)), { onNone: () => ({}), onSome: (value) => ({ default: value }) })),
                message: 'Gemini desktop client JSON path:', validate: (value) => value.trim().length === 0 ? Effect.fail('Client JSON path cannot be empty') : Effect.succeed(value.trim()) })).pipe(Effect.map(Option.some)),
            onSome: (value) => Effect.succeed(Option.some(value)),
        }).pipe(Effect.flatMap((clientPath) => KargadanHost.auth.login({
            provider, ...Option.match(clientPath, { onNone: () => ({}), onSome: (value) => ({ clientPath: value }) }),
        }).pipe(Effect.as(clientPath))))),
    ).pipe(Effect.mapError(CliError.from));
const _runExternal = (label: string, command: ProcessCommand.Command) =>
    ProcessCommand.exitCode(ProcessCommand.stdout(ProcessCommand.stderr(command, 'inherit'), 'inherit')).pipe(Effect.provide(NodeCommandExecutor.layer),
        Effect.flatMap((code) => code === 0 ? Effect.void : Effect.fail(new CliError({ message: `${label} exited with code ${String(code)}.`, reason: 'runtime' }))));
const _promptProvider = (provider: Option.Option<string>, message: string) => provider.pipe(
    Option.map((value) => value.trim()),
    Option.filter((value): value is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, value)),
    Option.match({
        onNone: () => Prompt.run(Prompt.select({
            choices: Object.entries(AiRegistry.providers).map(([value, meta]) => ({ title: meta.title, value: value as keyof typeof AiRegistry.providers })),
            message,
        })),
        onSome: Effect.succeed,
    }));
const _completeEnrollment = <A, R>(input: {
    readonly clientPathHint?: Option.Option<string>;
    readonly config:          typeof KargadanConfigSchema.Type;
    readonly lines:           (geminiClientPath: Option.Option<string>) => ReadonlyArray<string>;
    readonly provider:        keyof typeof AiRegistry.providers;
    readonly title:           string;
    readonly write:           (geminiClientPath: Option.Option<string>) => Effect.Effect<A, CliError, R>;
}) => _enrollProvider(input.provider, input.config, input.clientPathHint).pipe(
    Effect.flatMap((geminiClientPath) => input.write(geminiClientPath).pipe(Effect.as(geminiClientPath))),
    Effect.tap((geminiClientPath) => _print(input.title, input.lines(geminiClientPath))));
const _runInteractive = (input?: { readonly architectFallback?: ReadonlyArray<string>; readonly architectModel?: string;
    readonly architectProvider?: string; readonly intent?: string; readonly resume?: 'auto' | 'off'; readonly sessionId?: string;
}) => Effect.gen(function* () {
    yield* _requireTty;
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
        }, ...input,
    }).pipe(Effect.ensuring(Queue.offer(signals, Option.none()).pipe(Effect.zipRight(Fiber.join(renderer)))));
    yield* _print('Run complete', [`session: ${outcome.state.identityBase.sessionId}`, `status: ${outcome.state.status}`,
        `sequence: ${String(outcome.state.sequence)}`, `trace entries: ${String(outcome.trace.items.length)}`]);
});
const _runCommand = Command.make('run', {
    architectFallback: Options.text('architect-fallback').pipe(Options.withDescription('Architect fallback model list'), Options.repeated),
    architectModel:    Options.text('architect-model').pipe(Options.withAlias('m'), Options.withDescription('Architect model override'),
        Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_MODEL')), Options.optional),
    architectProvider: Options.text('architect-provider').pipe(Options.withAlias('p'), Options.withDescription('Architect provider override'),
        Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_PROVIDER')), Options.optional),
    configOverride: Options.keyValueMap('config').pipe(Options.withAlias('c'),
        Options.withDescription('Config overrides (e.g. --config ai.languageModel=gpt-4.1)'), Options.withDefault(HashMap.empty<string, string>())),
    intent: Options.text('intent').pipe(Options.withAlias('i'), Options.withDescription('Natural language intent for the agent'),
        Options.withFallbackConfig(Config.string('KARGADAN_AGENT_INTENT')), Options.withFallbackPrompt(Prompt.text({
        message: 'Intent:', validate: (v) => v.trim().length === 0 ? Effect.fail('Intent cannot be empty') : Effect.succeed(v.trim()) }))),
    resume:    Options.choice('resume', ['auto', 'off'] as const).pipe(Options.withAlias('r'), Options.withDescription('Resume mode (auto/off)'), Options.withDefault('auto')),
    sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID'), Options.optional),
}, (input) => {
    const run = _runInteractive({ architectFallback: input.architectFallback, intent: input.intent, resume: input.resume,
        ...Option.match(input.architectModel, { onNone: () => ({}), onSome: (architectModel) => ({ architectModel }) }),
        ...Option.match(input.architectProvider, { onNone: () => ({}), onSome: (architectProvider) => ({ architectProvider }) }),
        ...Option.match(input.sessionId, { onNone: () => ({}), onSome: (sessionId) => ({ sessionId }) }) });
    return HashMap.size(input.configOverride) > 0
        ? Effect.withConfigProvider(run, ConfigProvider.fromMap(new Map(HashMap.toEntries(input.configOverride)))) : run;
}).pipe(Command.withDescription('Run the interactive agent loop (--resume auto resumes latest session).'));
const _sessionsCommand = (() => {
    const _list = Command.make('list', {
        cursor: Options.text('cursor').pipe(Options.optional), limit: Options.integer('limit').pipe(Options.withAlias('l'), Options.withDefault(20)),
        status: Options.choice('status', ['running', 'completed', 'failed', 'interrupted'] as const).pipe(Options.repeated),
    }, (input) => AgentPersistenceService.pipe(
        Effect.flatMap((persistence) => persistence.list({
            limit: input.limit,
            ...Option.match(input.cursor, { onNone: () => ({}), onSome: (cursor) => ({ cursor }) }),
            ...(input.status.length > 0 ? { status: input.status } : {}),
        }).pipe(Effect.tap((result) => _print('sessions list', [`total=${String(result.total)} hasNext=${String(result.hasNext)} hasPrev=${String(result.hasPrev)}`,
            ...result.items.map((item) => `${item.id} | ${item.status} | started=${item.startedAt.toISOString()} | toolCalls=${String(item.toolCallCount)}`)])))),
    )).pipe(Command.withDescription('List persisted sessions.'));
    const _timeline = Command.make('trace', {
        limit: Options.integer('limit').pipe(Options.withDefault(100)), sessionId: Options.text('session-id'),
    }, (input) => AgentPersistenceService.pipe(
        Effect.flatMap((persistence) => persistence.trace(input.sessionId, { limit: input.limit }).pipe(Effect.tap((page) =>
            _print(`sessions trace ${input.sessionId}`, [`items=${String(page.items.length)} hasNext=${String(page.hasNext)} cursor=${page.cursor ?? 'null'}`,
                ...(page.items as ReadonlyArray<(typeof page.items)[0] & _TraceItem>).map((item) => [`#${String(item.sequence)}`, item.operation, item.success ? 'ok' : 'error', `${String(item.durationMs)}ms`, item.failureClass ?? '-', item.workflowExecutionId ?? '-'].join(' | '))])))),
    )).pipe(Command.withDescription('Show tool-call timeline for a session.'));
    const _export = Command.make('export', {
        format:    Options.choice('format', ['ndjson', 'csv'] as const).pipe(Options.withAlias('f'), Options.withDescription('Export format (ndjson/csv)'), Options.withDefault('ndjson')),
        output:    Options.text('output').pipe(Options.withAlias('o'), Options.withDescription('Export output file path')),
        sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID')),
    }, (input) => Effect.gen(function* () {
        const [{ exportLimit }, persistence, fs] = yield* Effect.all([HarnessConfig, AgentPersistenceService, FileSystem.FileSystem]);
        const trace = yield* persistence.trace(input.sessionId, { limit: exportLimit }).pipe(Effect.flatMap((first) => Effect.iterate(first, {
            body: (state) => persistence.trace(input.sessionId, { limit: exportLimit, ...(state.cursor == null ? {} : { cursor: state.cursor }) }).pipe(
                Effect.map((page) => ({ ...page, items: [...state.items, ...page.items] }))),
            while: (state) => state.hasNext && state.cursor != null,
        })));
        const content = input.format === 'ndjson'
            ? `${trace.items.map((item) => JSON.stringify({ ...item, result: Option.getOrUndefined(item.result) })).join('\n')}\n`
            : [_csvHeaders, ...(trace.items as ReadonlyArray<(typeof trace.items)[0] & _TraceItem>).map((item) => [String(item.sequence), item.createdAt.toISOString(), item.operation, item.success ? 'ok' : 'error', String(item.durationMs),
                item.failureClass ?? '', item.workflowExecutionId ?? '', item.workflowCommandId ?? '',
                item.workflowApproved === undefined ? '' : String(item.workflowApproved), _compact(item.params), Option.getOrElse(Option.map(item.result, _compact), () => '')])].map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n');
        yield* fs.writeFileString(input.output, content).pipe(Effect.zipRight(
            _print('sessions export', [`session=${input.sessionId}`, `format=${input.format}`, `output=${input.output}`, `rows=${String(trace.items.length)}`])));
    })).pipe(Command.withDescription('Export session trace as NDJSON or CSV.'));
    const _prune = Command.make('prune', {
        before: Options.text('before').pipe(Options.withDescription('ISO date cutoff (e.g. 2025-12-01)')),
    }, (input) => AgentPersistenceService.pipe(
        Effect.flatMap((persistence) => Effect.iterate({ continue: true as boolean, pruned: 0 }, {
            body: (state) => persistence.list({ before: new Date(input.before), limit: 500, status: ['completed', 'failed'] as const }).pipe(
                Effect.tap((page) => Effect.forEach(page.items, (session) =>
                    persistence.completeSession({ appId: session.appId, correlationId: session.correlationId ?? session.id,
                        error: 'Pruned by operator', sequence: session.toolCallCount, sessionId: session.id, status: 'interrupted',
                        toolCallCount: session.toolCallCount }), { discard: true })),
                Effect.map((page) => ({ continue: page.items.length > 0, pruned: state.pruned + page.items.length }))),
            while: (state) => state.continue,
        }).pipe(Effect.tap((result) => _print('sessions prune', [`cutoff=${input.before}`, `pruned=${String(result.pruned)}`])))),
    )).pipe(Command.withDescription('Prune sessions completed before a given date.'));
    return Command.make('sessions').pipe(
        Command.withSubcommands([_list, _timeline, _export, _prune]),
        Command.withDescription('Session operator commands.'),
        Command.transformHandler((effect) => _withAppTenant(effect)),
        Command.provide(HarnessConfig.persistenceLayer),
    );
})();
    const _configCommand = Command.make('config', {
    key:   Options.text('key').pipe(Options.withDescription('Dotted config key (e.g. ai.languageModel)'), Options.optional),
    value: Options.text('value').pipe(Options.withDescription('Value to set'), Options.optional),
}, (input) => ConfigFile.read.pipe(Effect.flatMap((config) => Option.match(input.key, {
    onNone: () => _print(`config list (${ConfigFile.path})`, ConfigFile.flatten(config)),
    onSome: (key) => Effect.filterOrFail(Effect.succeed(key), (c) => ConfigFile.keys.includes(c), () => new CliError({ message: `Unsupported config key '${key}'.`, reason: 'validation' })).pipe(
        Effect.flatMap((candidate) => Option.match(input.value, {
            onNone: () => _print(`config get ${candidate}`, [((v: unknown) => v === undefined ? `${candidate} is not set` : `${candidate} = ${String(v)}`)(ConfigFile.get(config, candidate))]),
            onSome: (value) => ConfigFile.write(ConfigFile.set(config, candidate, value)).pipe(
                Effect.zipRight(_print('config set', [`${candidate} = ${value}`, `written to ${ConfigFile.path}`]))),
        }))),
})))).pipe(Command.withDescription('Config operations: no args=list, --key=get, --key + --value=set.'));
const _diagnosticsCommand = (() => {
    const _fmtOverride = (override: Option.Option<AiRegistry.SessionOverride>) => Option.match(override, {
        onNone: () => 'none',
        onSome: (value) => `${value.language?.provider ?? 'unknown'}:${value.language?.model ?? 'unknown'}`,
    });
    const _check = Command.make('check', {}, () => Effect.gen(function* () {
        const transport = yield* readPortFile().pipe(
            Effect.map(({ pid, port }) => ({ message: `pid=${pid} port=${port}`, status: 'ok' as const })),
            Effect.catchTag('SocketClientError', (e) => Effect.succeed({ message: e.message, status: ({ port_file_not_found: 'missing', port_file_stale: 'stale' } as Record<string, string>)[e.reason] ?? 'invalid' })));
        const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const [auth, persistenceProbe, configIntegrity, dataDirProbe] = yield* Effect.all([
            KargadanHost.auth.status.pipe(Effect.mapError(CliError.from)),
            AgentPersistenceService.pipe(Effect.flatMap((svc) => svc.list({ limit: 1 }))),
            fs.readFileString(ConfigFile.path).pipe(Effect.map((raw) => ({ hash: createHash('sha256').update(raw).digest('hex').slice(0, 16), status: 'ok' as const })),
                Effect.catchAll(() => Effect.succeed({ hash: 'n/a', status: 'missing' as const }))),
            fs.exists(ConfigFile.dir).pipe(Effect.map((exists) => exists ? 'accessible' as const : 'missing' as const), Effect.catchAll(() => Effect.succeed('error' as const)))]);
        yield* _print('diagnostics check', [
            `appId=${config.appId}`, `protocol=${String(config.protocolVersion.major)}.${String(config.protocolVersion.minor)}`,
            `dbReachable=true totalSessions=${String(persistenceProbe.total)}`,
            `languageOverride=${_fmtOverride(config.resolveSessionOverride)}`, `architectOverride=${_fmtOverride(config.resolveArchitectOverride)}`,
            `auth=${auth.map((entry) => `${entry.provider}:${entry.enrolled ? 'ok' : 'missing'}${Option.isSome(entry.decodeError) ? ':DECODE_ERROR' : ''}`).join(',')}`,
            `transport=${transport.status} (${transport.message})`, `configIntegrity=${configIntegrity.status} hash=${configIntegrity.hash}`,
            `dataDir=${dataDirProbe} (${ConfigFile.dir})`]);
    })).pipe(Command.withDescription('Validate environment, DB, transport, config, and data directory.'));
    const _live = Command.make('live', {
        launch:   Options.boolean('launch').pipe(Options.withDescription('Launch Rhino before probing'), Options.withDefault(false)),
        prepare:  Options.boolean('prepare').pipe(Options.withDescription('Build, package, install plugin, then launch'), Options.withDefault(false)),
        rhinoApp: Options.text('rhino-app').pipe(Options.withDescription('Override Rhino.app path'), Options.optional),
        yakPath:  Options.text('yak-path').pipe(Options.withDescription('Override yak path'), Options.optional),
    }, (input) => Effect.gen(function* () {
        const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const shouldLaunch = input.launch || input.prepare;
        const _resolvePath = (resolveInput: {
            readonly discover: Effect.Effect<string, CliError, FileSystem.FileSystem>;
            readonly fallback: Option.Option<string>;
            readonly label:    string;
            readonly override: Option.Option<string>;
        }) => Option.match(Option.orElse(resolveInput.override, () => resolveInput.fallback), {
            onNone: () => resolveInput.discover,
            onSome: (path) => fs.exists(path).pipe(
                Effect.filterOrFail((exists) => exists, () => new CliError({ message: `${resolveInput.label} not found at ${path}.`, reason: 'not_found' })),
                Effect.as(path)),
        });
        const appPath = yield* (shouldLaunch
            ? _resolvePath({
                discover: fs.readDirectory('/Applications').pipe(
                    Effect.map((entries) => entries.filter((entry) => entry.endsWith('.app') && /(Rhino|Rhinoceros)/i.test(entry))
                        .sort((left, right) => {
                            const _rank = (entry: string) => {
                                const index = [/^Rhino 9/i, /^Rhino WIP/i, /^Rhino/i, /^Rhinoceros/i].findIndex((pattern) => pattern.test(entry));
                                return index === -1 ? Number.MAX_SAFE_INTEGER : index;
                            };
                            const delta = _rank(left) - _rank(right);
                            return delta === 0 ? left.localeCompare(right) : delta;
                        })
                        .map((entry) => join('/Applications', entry))),
                    Effect.flatMap((apps) => apps.length > 0 ? Effect.succeed(apps[0] as string)
                        : Effect.fail(new CliError({ message: 'Rhino.app was not discovered under /Applications. Set rhino.appPath or pass --rhino-app.', reason: 'not_found' }))),
                    Effect.mapError(CliError.from)),
                fallback: _trimOpt(Option.fromNullable(config.rhinoAppPath)),
                label:    'Rhino.app',
                override: _trimOpt(input.rhinoApp),
            })
            : Effect.succeed(''));
        const resolvedYakPath = yield* (input.prepare
            ? _resolvePath({
                discover: Effect.fail(new CliError({ message: 'Yak path could not be resolved.', reason: 'not_found' })),
                fallback: Option.orElse(_trimOpt(Option.fromNullable(config.rhinoYakPath)), () => Option.some(join(appPath, 'Contents/Resources/bin/yak'))),
                label:    'yak executable',
                override: _trimOpt(input.yakPath),
            })
            : Effect.succeed(''));
        yield* Effect.when(readPortFile().pipe(
            Effect.map(Option.some),
            Effect.catchTag('SocketClientError', () => Effect.succeed(Option.none<{ readonly pid: number; readonly port: number; readonly startedAt: string }>())),
            Effect.flatMap(Option.match({
                onNone: () => Effect.void,
                onSome: ({ pid, port }) => Effect.fail(new CliError({
                    message: `Rhino transport is already active on pid=${pid} port=${port}. Close Rhino before --prepare so the installed package is the build that starts.`,
                    reason: 'validation',
                })),
            })),
        ), () => input.prepare);
        const prepared = yield* (input.prepare ? Effect.gen(function* () {
            const [stageRoot, pluginPath] = [join(_Plugin.stageDir, `package-${Date.now().toString()}`), join(_Plugin.buildDir, _Plugin.fileName)];
            yield* _runExternal('Restore Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_Plugin.nxProject}:restore`)).pipe(
                Effect.zipRight(_runExternal('Build Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_Plugin.nxProject}:build:release`))));
            yield* fs.exists(pluginPath).pipe(
                Effect.filterOrFail((exists) => exists, () => new CliError({ message: `Plugin artifact ${pluginPath} not produced.`, reason: 'runtime' })));
            yield* fs.makeDirectory(stageRoot, { recursive: true }).pipe(
                Effect.zipRight(fs.copy(_Plugin.buildDir, join(stageRoot, _Plugin.targetFramework), { overwrite: true })));
            yield* _runExternal('Generate Yak manifest', ProcessCommand.make(resolvedYakPath, 'spec', '--input', join(stageRoot, _Plugin.targetFramework, _Plugin.fileName), '--output', stageRoot));
            yield* fs.readFileString(join(stageRoot, _Plugin.manifestFileName)).pipe(Effect.flatMap((manifest) =>
                fs.writeFileString(join(stageRoot, _Plugin.manifestFileName), manifest.replace('url: <url>', 'url: https://github.com/bardiasamiee/Parametric_Portal'))));
            yield* _runExternal('Build Yak package', ProcessCommand.workingDirectory(ProcessCommand.make(resolvedYakPath, 'build', '--platform', 'mac'), stageRoot));
            const packagePath = yield* fs.readDirectory(stageRoot).pipe(
                Effect.map((entries) => entries.filter((entry) => entry.endsWith('.yak')).sort((left, right) => left.localeCompare(right)).map((entry) => join(stageRoot, entry))),
                Effect.flatMap((packages) => packages.length > 0 ? Effect.succeed(packages.at(-1) as string)
                    : Effect.fail(new CliError({ message: `No .yak package emitted in ${stageRoot}.`, reason: 'runtime' }))));
            yield* _runExternal('Install Yak package', ProcessCommand.make(resolvedYakPath, 'install', packagePath));
            return { packagePath, pluginPath, stageRoot } as const;
        }).pipe(Effect.map(Option.some))
            : Effect.succeed(Option.none<{ readonly packagePath: string; readonly pluginPath: string; readonly stageRoot: string }>()));
        yield* Effect.when(
            Match.value(process.platform).pipe(
                Match.when('darwin', () => _runExternal('Launch Rhino', ProcessCommand.make('open', '-a', appPath))),
                Match.orElse((platform) => Effect.fail(new CliError({ message: `--launch supports macOS only; detected ${platform}.`, reason: 'validation' }))),
            ),
            () => shouldLaunch,
        );
        const transport = yield* (shouldLaunch
            ? readPortFile().pipe(Effect.retry(Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(Duration.millis(config.rhinoLaunchTimeoutMs)))),
                Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: `Transport not ready within ${String(config.rhinoLaunchTimeoutMs)}ms.`, reason: 'not_found' }))))
            : readPortFile().pipe(Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: 'Transport not active. Rerun with --launch / --prepare.', reason: 'not_found' })))));
        const live = yield* HarnessRuntime.probeLive.pipe(Effect.mapError((detail) => new CliError({
            detail, message: detail instanceof Error ? detail.message : 'Live Rhino probe failed.', reason: 'runtime' })));
        const artifactFile = join(_Plugin.artifactDir, `probe-${new Date().toISOString().replaceAll(':', '-')}.json`);
        const artifact = { acceptedCapabilities: live.handshake.acceptedCapabilities, catalog: live.handshake.catalog,
            catalogCount: live.handshake.catalog.length, createdAt: new Date().toISOString(), launch: shouldLaunch,
            package: Option.getOrNull(prepared), prepare: input.prepare, rhino: shouldLaunch ? { appPath, yakPath: input.prepare ? resolvedYakPath : null } : null,
            sceneSummary: live.summary, server: live.handshake.server ?? null, transport };
        const artifactPath = yield* fs.makeDirectory(_Plugin.artifactDir, { recursive: true }).pipe(
            Effect.zipRight(fs.writeFileString(artifactFile, JSON.stringify(artifact, null, 2))),
            Effect.as(artifactFile));
        yield* _print('diagnostics live', [`artifact=${artifactPath}`, `transport=pid:${String(transport.pid)} port:${String(transport.port)}`,
            `server=${live.handshake.server?.rhinoVersion ?? 'unknown'} plugin=${live.handshake.server?.pluginRevision ?? 'unknown'}`,
            `catalog=${String(live.handshake.catalog.length)} capabilities=${live.handshake.acceptedCapabilities.join(',') || 'none'}`,
            `scene.objectCount=${String(live.summary.objectCount)}`, ...Option.match(prepared, { onNone: () => [] as ReadonlyArray<string>,
                onSome: (value) => [`package=${value.packagePath}`, `stage=${value.stageRoot}`] })]);
    })).pipe(Command.withDescription('Probe live Rhino: optional package install + launch, then handshake and read.scene.summary.'));
    return Command.make('diagnostics').pipe(
        Command.withSubcommands([_check, _live]),
        Command.withDescription('Diagnostics commands.'),
        Command.transformHandler((effect) => _withAppTenant(effect)),
        Command.provide(HarnessConfig.persistenceLayer),
    );
})();
const _initWizard = _requireTty.pipe(
    Effect.zipRight(Effect.all([ConfigFile.read, FileSystem.FileSystem])),
    Effect.flatMap(([config, fs]) =>
        fs.exists(ConfigFile.path).pipe(
            Effect.flatMap((exists) => Effect.when(Prompt.run(Prompt.confirm({ initial: false, label: { confirm: 'overwrite', deny: 'cancel' },
                message: `Config already exists at ${ConfigFile.path}. Overwrite?` })).pipe(
                Effect.filterOrFail((confirmed) => confirmed, () => new CliError({ message: 'Init cancelled.', reason: 'validation' }))), () => exists)),
            Effect.zipRight(_promptProvider(Option.none(), 'AI provider:')),
            Effect.flatMap((provider) =>
                Prompt.run(Prompt.text({ default: AiRegistry.providers[provider].defaultModel, message: 'Language model:' })).pipe(
                    Effect.flatMap((model) =>
                        KargadanHost.postgres.bootstrap.pipe(
                            Effect.mapError(CliError.from),
                            Effect.flatMap((databaseUrl) =>
                                _completeEnrollment({
                                    config,
                                    lines: () => [`provider: ${provider}`, `model: ${model}`, `config: ${ConfigFile.path}`, `database: ${databaseUrl}`, `auth: enrolled in macOS Keychain`],
                                    provider,
                                    title: 'Kargadan initialized',
                                    write: (geminiClientPath) => ConfigFile.write({
                                        ...config,
                                        geminiClientPath: Option.getOrUndefined(geminiClientPath),
                                        model,
                                        provider,
                                    }).pipe(Effect.mapError(CliError.from)),
                                }),
                            ),
                        ),
                    ),
                ),
            ),
        ),
    ),
);
const _authCommand = (() => Command.make('auth').pipe(Command.withSubcommands([
    Command.make('login', {
        clientPath: Options.text('client-path').pipe(Options.withDescription('Gemini desktop client JSON path'), Options.optional),
        provider:   Options.text('provider').pipe(Options.withDescription('Provider name (anthropic|gemini|openai)'), Options.optional),
    }, (input) => _requireTty.pipe(Effect.zipRight(ConfigFile.read), Effect.flatMap((config) =>
        _promptProvider(input.provider, 'Credential provider:').pipe(Effect.flatMap((provider) => _completeEnrollment({
            clientPathHint: _trimOpt(input.clientPath),
            config,
            lines: (geminiClientPath) => [`provider=${provider}`, `stored=macOS Keychain`,
                ...Option.match(geminiClientPath, { onNone: () => [] as ReadonlyArray<string>, onSome: (value) => [`client=${value}`] })],
            provider,
            title: 'auth login',
            write: (geminiClientPath) => Effect.when(ConfigFile.write(ConfigFile.set(config, 'ai.geminiClientPath', Option.getOrUndefined(geminiClientPath))).pipe(
                Effect.mapError(CliError.from)), () => Option.isSome(geminiClientPath)),
        })))))).pipe(Command.withDescription('Enroll credentials in the local keychain.')),
    Command.make('status', {}, () => Effect.all([ConfigFile.read, KargadanHost.auth.status.pipe(Effect.mapError(CliError.from))]).pipe(
        Effect.flatMap(([config, statuses]) => ((sel: (key: string) => string) => _print('auth status', [`selected=${sel('ai.languageProvider')}:${sel('ai.languageModel')}`,
            ...statuses.map((status) => `${status.provider} | ${status.kind} | ${status.enrolled ? 'enrolled' : 'missing'}${Option.match(status.decodeError, { onNone: () => '', onSome: (error) => ` | DECODE_ERROR: ${error}` })}${status.provider === 'gemini' ? ` | client=${sel('ai.geminiClientPath')}` : ''}`)])
        )((key) => String(ConfigFile.get(config, key) ?? 'unset'))))).pipe(Command.withDescription('Show credential enrollment status.')),
    Command.make('logout', {
        provider: Options.text('provider').pipe(Options.withDescription('Provider (anthropic|gemini|openai); omit to clear all'), Options.optional),
    }, (input) => Option.match(input.provider, {
        onNone: () => KargadanHost.auth.logout().pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', ['providers=all', 'status=cleared']))),
        onSome: (raw) => Effect.filterOrFail(Effect.succeed(raw.trim()), (value): value is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, value),
            () => new CliError({ message: `Unknown provider '${raw.trim()}'.`, reason: 'validation' })).pipe(
            Effect.flatMap((provider) => KargadanHost.auth.logout(provider).pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', [`provider=${provider}`, 'status=cleared']))))),
    })).pipe(Command.withDescription('Clear enrolled credentials.')),
]), Command.withDescription('Credential enrollment and status.')))();
const _rootCommand = Command.make('kargadan', {}, () => Effect.gen(function* () {
    const exists = yield* Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(ConfigFile.path));
    yield* Match.value(exists).pipe(Match.when(true, () => _runInteractive()),
        Match.orElse(() => _initWizard.pipe(Effect.zipRight(loadConfigProvider.pipe(Effect.flatMap((provider) =>
            _runInteractive().pipe(Effect.withConfigProvider(provider.provider), Effect.provide(HarnessConfig.Default))))))));
})).pipe(Command.withSubcommands([_runCommand, Command.make('init', {}, () => _initWizard).pipe(Command.withDescription('Initialize Kargadan configuration.')),
    _authCommand, _sessionsCommand, _configCommand, _diagnosticsCommand]),
    Command.transformHandler((handler) => handler.pipe(Effect.withSpan('kargadan.cli.command'), Effect.mapError(CliError.from))), Command.provide(HarnessConfig.Default));

// --- [ENTRY] -----------------------------------------------------------------

NodeRuntime.runMain(loadConfigProvider.pipe(
    Effect.flatMap((provider) => Command.run({ name: 'kargadan', version: _version })(_rootCommand)(process.argv).pipe(
        Effect.provide(CliConfig.layer({ finalCheckBuiltIn: false })), Effect.withConfigProvider(provider.provider))),
    Effect.provide(NodeFileSystem.layer), Effect.provide(NodeContext.layer),
    Effect.catchAll((error) => error instanceof CliError ? Console.error(HelpDoc.toAnsiText(error.doc)).pipe(Effect.zipRight(Effect.fail(error)))
        : ValidationError.isValidationError(error) ? Effect.fail(error) : Console.error(_compact(error)).pipe(Effect.zipRight(Effect.fail(error)))),
) as Effect.Effect<void, unknown, never>, { disableErrorReporting: true });
