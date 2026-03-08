import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { ConfigFile, HarnessConfig, HarnessHostError, KargadanHost, loadConfigProvider, PROVIDER_VOCABULARY } from './config';
import { HarnessRuntime } from './harness';
import { readPortFile } from './socket';

// --- [CONSTANTS] -------------------------------------------------------------

const _version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }).version;
const _Plugin = {
    artifactDir:      join(ConfigFile.dir, 'live'),
    buildDir:         join(process.cwd(), 'apps/kargadan/plugin/bin/Release/net9.0'),
    fileName:         'ParametricPortal.Kargadan.Plugin.rhp',
    manifestFileName: 'manifest.yml',
    nxProject:        'ParametricPortal.Kargadan.Plugin',
    stageDir:         join(ConfigFile.dir, 'plugin'),
    targetFramework:  'net9.0',
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class CliError extends Data.TaggedError('CliError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  keyof typeof CliError.reasons;
}> {
    static readonly reasons = {
        io:           { advice: 'Retry with same intent after transient conditions clear.', failureClass: 'retryable'   },
        not_found:    { advice: 'Adjust parameters or scene constraints, then retry.',      failureClass: 'correctable' },
        runtime:      { advice: 'Inspect transport/protocol assumptions before retry.',     failureClass: 'fatal'       },
        tty_required: { advice: 'Run kargadan commands in a TTY session.',                  failureClass: 'correctable' },
        validation:   { advice: 'Adjust parameters or rerun with explicit flags.',          failureClass: 'correctable' },
    } as const;
    get policy() { return CliError.reasons[this.reason]; }
    get doc() {
        return HelpDoc.blocks([
            HelpDoc.h1(Span.error(`kargadan ${this.reason}`)),
            HelpDoc.p(Span.text(`failureClass: ${this.policy.failureClass}`)),
            HelpDoc.p(Span.text(`issue: ${this.message}`)),
            HelpDoc.p(Span.text(`recovery: ${this.policy.advice}`)),
        ]);
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _compact = (value: unknown) =>
    ((s: string) => s.length <= 140 ? s : `${s.slice(0, 140)}...`)(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));
const _print = (title: string, lines: ReadonlyArray<string>) =>
    Console.log(HelpDoc.toAnsiText(HelpDoc.blocks([HelpDoc.h1(Span.text(title)), ...lines.map((l) => HelpDoc.p(Span.text(l)))])));
const _withAppTenant = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(HarnessConfig, (cfg) => Context.Request.within(cfg.appId, effect));
const _nonBlank = (value: string | null | undefined) =>
    Option.fromNullable(value).pipe(Option.map((entry) => entry.trim()), Option.filter((entry) => entry.length > 0));
const _requireTty = Terminal.Terminal.pipe(
    Effect.flatMap((terminal) => terminal.isTTY),
    Effect.filterOrFail((isTTY) => isTTY, () => new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' })),
    Effect.asVoid,
);
const _toCliError = (error: unknown) =>
    error instanceof CliError
        ? error
        : error instanceof HarnessHostError
            ? new CliError({
                detail:  error.detail,
                message: error.message,
                reason:  ({ auth: 'validation', config: 'validation', keychain: 'runtime', postgres: 'not_found' } as const)[error.reason],
            })
            : new CliError({ detail: error, message: String(error), reason: 'runtime' });
const _providerChoices = () =>
    Object.entries(PROVIDER_VOCABULARY).map(([value, meta]) => ({ title: meta.title, value: value as keyof typeof PROVIDER_VOCABULARY }));
const _selectProvider = (message: string) =>
    Prompt.run(Prompt.select({ choices: _providerChoices(), message }));
const _promptGeminiClientPath = (initial: Option.Option<string>) =>
    Prompt.run(Prompt.text({
        ...(Option.match(initial, { onNone: () => ({}), onSome: (value) => ({ default: value }) })),
        message: 'Gemini desktop client JSON path:',
        validate: (value) => value.trim().length === 0 ? Effect.fail('Client JSON path cannot be empty') : Effect.succeed(value.trim()),
    }));
const _promptSecret = (provider: keyof typeof PROVIDER_VOCABULARY) =>
    Prompt.run(Prompt.hidden({
        message: `${provider} API secret:`,
        validate: (value) => value.trim().length === 0 ? Effect.fail('Credential cannot be empty') : Effect.succeed(value.trim()),
    })).pipe(Effect.map(Redacted.value));
const _runExternal = (label: string, command: ProcessCommand.Command) =>
    ProcessCommand.exitCode(ProcessCommand.stdout(ProcessCommand.stderr(command, 'inherit'), 'inherit')).pipe(
        Effect.provide(NodeCommandExecutor.layer),
        Effect.flatMap((code) => code === 0
            ? Effect.void
            : Effect.fail(new CliError({ message: `${label} exited with code ${String(code)}.`, reason: 'runtime' }))),
    );
const _rankRhinoApp = (entry: string) =>
    [/^Rhino 9/i, /^Rhino WIP/i, /^Rhino/i, /^Rhinoceros/i].findIndex((pattern) => pattern.test(entry));
const _resolveRhinoApp = (override: Option.Option<string>) =>
    Effect.gen(function* () {
        const [cfg, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const explicit = Option.orElse(override, () => _nonBlank(cfg.rhinoAppPath));
        return yield* Option.match(explicit, {
            onNone: () => fs.readDirectory('/Applications').pipe(
                Effect.map((entries) => entries
                    .filter((entry) => entry.endsWith('.app') && /(Rhino|Rhinoceros)/i.test(entry))
                    .sort((left, right) => {
                        const delta = _rankRhinoApp(left) - _rankRhinoApp(right);
                        return delta === 0 ? left.localeCompare(right) : delta;
                    })
                    .map((entry) => join('/Applications', entry))),
                Effect.flatMap((apps) => apps.length > 0
                    ? Effect.succeed(apps[0] as string)
                    : Effect.fail(new CliError({
                        message: 'Rhino.app was not discovered under /Applications. Set rhino.appPath or pass --rhino-app.',
                        reason:  'not_found',
                    }))),
            ),
            onSome: (path) => fs.exists(path).pipe(
                Effect.filterOrFail((exists) => exists, () => new CliError({ message: `Rhino.app not found at ${path}.`, reason: 'not_found' })),
                Effect.as(path),
            ),
        });
    });
const _resolveYakPath = (appPath: string, override: Option.Option<string>) =>
    Effect.gen(function* () {
        const [cfg, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const resolved = Option.orElse(override, () => Option.orElse(_nonBlank(cfg.rhinoYakPath), () => Option.some(join(appPath, 'Contents/Resources/bin/yak'))));
        return yield* Option.match(resolved, {
            onNone: () => Effect.fail(new CliError({ message: 'Yak path could not be resolved.', reason: 'not_found' })),
            onSome: (path) => fs.exists(path).pipe(
                Effect.filterOrFail((exists) => exists, () => new CliError({ message: `yak executable not found at ${path}.`, reason: 'not_found' })),
                Effect.as(path),
            ),
        });
    });
const _assertPrepareSafe = readPortFile().pipe(
    Effect.map((port) => Option.some(port)),
    Effect.catchTag('SocketClientError', () => Effect.succeed(Option.none<{ readonly pid: number; readonly port: number; readonly startedAt: string }>())),
    Effect.flatMap(Option.match({
        onNone: () => Effect.void,
        onSome: ({ port, pid }) => Effect.fail(new CliError({
            message: `Rhino transport is already active on pid=${pid} port=${port}. Close Rhino before --prepare so the installed package is the build that starts.`,
            reason:  'validation',
        })),
    })),
);
const _writeLiveArtifact = (artifact: unknown) =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const file = join(_Plugin.artifactDir, `probe-${new Date().toISOString().replaceAll(':', '-')}.json`);
        yield* fs.makeDirectory(_Plugin.artifactDir, { recursive: true });
        yield* fs.writeFileString(file, JSON.stringify(artifact, null, 2));
        return file;
    });
const _waitForTransport = (timeoutMs: number) =>
    readPortFile().pipe(
        Effect.retry(Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(Duration.millis(timeoutMs)))),
        Effect.catchTag('SocketClientError', (error) => Effect.fail(new CliError({
            detail:  error,
            message: `Rhino transport was not ready within ${String(timeoutMs)}ms.`,
            reason:  'not_found',
        }))),
    );
const _preparePlugin = (yakPath: string) =>
    Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const stageRoot = join(_Plugin.stageDir, `package-${Date.now().toString()}`);
        const pluginPath = join(_Plugin.buildDir, _Plugin.fileName);
        yield* _runExternal('Restore Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_Plugin.nxProject}:restore`));
        yield* _runExternal('Build Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_Plugin.nxProject}:build:release`));
        yield* fs.exists(pluginPath).pipe(
            Effect.filterOrFail((exists) => exists, () => new CliError({
                message: `Expected plugin artifact ${pluginPath} was not produced. The Rhino build is not packageable yet.`,
                reason:  'runtime',
            })),
        );
        yield* fs.makeDirectory(stageRoot, { recursive: true });
        yield* fs.copy(_Plugin.buildDir, join(stageRoot, _Plugin.targetFramework), { overwrite: true });
        yield* _runExternal('Generate Yak manifest', ProcessCommand.make(yakPath, 'spec', '--input', join(stageRoot, _Plugin.targetFramework, _Plugin.fileName), '--output', stageRoot));
        yield* fs.readFileString(join(stageRoot, _Plugin.manifestFileName)).pipe(Effect.flatMap((manifest) =>
            fs.writeFileString(join(stageRoot, _Plugin.manifestFileName), manifest.replace('url: <url>', 'url: https://github.com/bardiasamiee/Parametric_Portal'))));
        yield* _runExternal('Build Yak package', ProcessCommand.workingDirectory(ProcessCommand.make(yakPath, 'build', '--platform', 'mac'), stageRoot));
        const packagePath = yield* fs.readDirectory(stageRoot).pipe(
            Effect.map((entries) => entries.filter((entry) => entry.endsWith('.yak')).sort((a, b) => a.localeCompare(b)).map((entry) => join(stageRoot, entry))),
            Effect.flatMap((packages) => packages.length > 0
                ? Effect.succeed(packages.at(-1) as string)
                : Effect.fail(new CliError({ message: `yak build did not emit a .yak package in ${stageRoot}.`, reason: 'runtime' }))),
        );
        yield* _runExternal('Install Yak package', ProcessCommand.make(yakPath, 'install', packagePath));
        return { packagePath, pluginPath, stageRoot } as const;
    });
const _launchRhino = (appPath: string) =>
    Match.value(process.platform).pipe(
        Match.when('darwin', () => _runExternal('Launch Rhino', ProcessCommand.make('open', '-a', appPath))),
        Match.orElse((platform) => Effect.fail(new CliError({
            message: `diagnostics live --launch currently supports macOS only; detected ${platform}.`,
            reason:  'validation',
        }))),
    );
const _runInteractive = (input?: {
    readonly architectFallback?: ReadonlyArray<string>; readonly architectModel?: string;
    readonly architectProvider?: string; readonly intent?: string;
    readonly resume?: 'auto' | 'off'; readonly sessionId?: string;
}) =>
    Effect.gen(function* () {
        yield* _requireTty;
        const signals = yield* Queue.unbounded<Option.Option<HelpDoc.HelpDoc>>();
        const consume: Effect.Effect<void> = Queue.take(signals).pipe(Effect.flatMap(Option.match({
            onNone: () => Effect.void, onSome: (doc) => Console.log(HelpDoc.toAnsiText(doc)).pipe(Effect.zipRight(consume)) })));
        const renderer = yield* Effect.forkScoped(Effect.suspend(() => consume));
        const emit = (kind: 'error' | 'code', tag: string, content: string) =>
            Queue.offer(signals, Option.some(HelpDoc.p(Span.spans([
                kind === 'error' ? Span.error(tag) : Span.code(tag), Span.space, Span.text(content)])))).pipe(Effect.asVoid);
        const outcome = yield* HarnessRuntime.run({
            hooks: {
                ...HarnessRuntime.makeInteractiveHooks(emit, _compact),
                onWriteApproval: (e) => {
                    const refs = e.command.objectRefs?.map((ref) => `${ref.typeTag}:${ref.objectId}`).join(',') ?? 'none';
                    return Prompt.run(Prompt.confirm({ initial: false, label: { confirm: 'approve', deny: 'reject' },
                        message: `Approve write '${e.command.commandId}' (wf=${e.workflowExecutionId}) args=${_compact(e.command.args)} refs=${refs}?` })).pipe(
                        Effect.catchAll(() => Effect.succeed(false)),
                        Effect.tap((approved) => emit('code', '[approval]', `${e.command.commandId} -> ${approved ? 'approved' : 'rejected'} (${e.workflowExecutionId})`)));
                },
            },
            ...input,
        }).pipe(
            Effect.ensuring(Queue.offer(signals, Option.none()).pipe(Effect.zipRight(Fiber.join(renderer)))),
        );
        yield* _print('Run complete', [`session: ${outcome.state.identityBase.sessionId}`, `status: ${outcome.state.status}`,
            `sequence: ${String(outcome.state.sequence)}`, `trace entries: ${String(outcome.trace.items.length)}`]);
    });
const _runCommand = Command.make('run', {
    architectFallback: Options.text('architect-fallback').pipe(Options.withDescription('Architect fallback model list'), Options.repeated),
    architectModel:    Options.text('architect-model').pipe(Options.withAlias('m'), Options.withDescription('Architect model override'),
        Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_MODEL')), Options.optional),
    architectProvider: Options.text('architect-provider').pipe(Options.withAlias('p'), Options.withDescription('Architect provider override'),
        Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_PROVIDER')), Options.optional),
    configOverride: Options.keyValueMap('config').pipe(
        Options.withAlias('c'),
        Options.withDescription('Config overrides (e.g. --config ai.languageModel=gpt-4.1)'),
        Options.withDefault(HashMap.empty<string, string>()),
    ),
    intent: Options.text('intent').pipe(Options.withAlias('i'), Options.withDescription('Natural language intent for the agent'),
        Options.withFallbackConfig(Config.string('KARGADAN_AGENT_INTENT')), Options.withFallbackPrompt(Prompt.text({
        message: 'Intent:', validate: (v) => v.trim().length === 0 ? Effect.fail('Intent cannot be empty') : Effect.succeed(v.trim()) }))),
    resume:    Options.choice('resume', ['auto', 'off'] as const).pipe(Options.withAlias('r'), Options.withDescription('Resume mode (auto/off)'), Options.withDefault('auto')),
    sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID'), Options.optional),
}, (input) => {
    const run = _runInteractive({ architectFallback: input.architectFallback, intent: input.intent, resume: input.resume,
        ...Option.match(input.architectModel,    { onNone: () => ({}), onSome: (v) => ({ architectModel: v })    }),
        ...Option.match(input.architectProvider, { onNone: () => ({}), onSome: (v) => ({ architectProvider: v }) }),
        ...Option.match(input.sessionId,         { onNone: () => ({}), onSome: (v) => ({ sessionId: v }) })      });
    return HashMap.size(input.configOverride) > 0
        ? Effect.withConfigProvider(run, ConfigProvider.fromMap(new Map(HashMap.toEntries(input.configOverride))))
        : run;
}).pipe(Command.withDescription('Run the interactive agent loop (--resume auto resumes latest session).'));
const _sessionsListCommand = Command.make('list', {
    cursor: Options.text('cursor').pipe(Options.optional),
    limit:  Options.integer('limit').pipe(Options.withAlias('l'), Options.withDescription('Maximum results to return'), Options.withDefault(20)),
    status: Options.choice('status', ['running', 'completed', 'failed', 'interrupted'] as const).pipe(Options.repeated),
}, (input) => _withAppTenant(Effect.gen(function* () {
    const persistence = yield* AgentPersistenceService;
    const result = yield* persistence.list({
        limit: input.limit, ...Option.match(input.cursor, { onNone: () => ({}), onSome: (v) => ({ cursor: v }) }),
        ...(input.status.length > 0 ? { status: input.status } : {}),
    });
    yield* _print('sessions list', [`total=${String(result.total)} hasNext=${String(result.hasNext)} hasPrev=${String(result.hasPrev)}`,
        ...result.items.map((i) => `${i.id} | ${i.status} | started=${i.startedAt.toISOString()} | toolCalls=${String(i.toolCallCount)}`)]);
}))).pipe(Command.withDescription('List persisted sessions.'));
const _sessionsTraceCommand = Command.make('trace', {
    limit:     Options.integer('limit').pipe(Options.withDefault(100)),
    sessionId: Options.text('session-id'),
}, (input) => _withAppTenant(Effect.gen(function* () {
    const persistence = yield* AgentPersistenceService;
    const page = yield* persistence.trace(input.sessionId, { limit: input.limit });
    const rows = page.items.map((i) => [`#${String(i.sequence)}`, i.operation, i.success ? 'ok' : 'error',
        `${String(i.durationMs)}ms`, i.failureClass ?? '-', i.workflowExecutionId ?? '-'].join(' | '));
    yield* _print(`sessions trace ${input.sessionId}`, [
        `items=${String(page.items.length)} hasNext=${String(page.hasNext)} cursor=${page.cursor ?? 'null'}`, ...rows]);
}))).pipe(Command.withDescription('Show tool-call timeline for a session.'));
const _sessionsExportCommand = Command.make('export', {
    format:    Options.choice('format', ['ndjson', 'csv'] as const).pipe(Options.withAlias('f'), Options.withDescription('Export format (ndjson/csv)'), Options.withDefault('ndjson')),
    output:    Options.text('output').pipe(Options.withAlias('o'), Options.withDescription('Export output file path')),
    sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID')),
}, (input) => _withAppTenant(Effect.gen(function* () {
    const cfg = yield* HarnessConfig;
    const persistence = yield* AgentPersistenceService;
    const fs = yield* FileSystem.FileSystem;
    const first = yield* persistence.trace(input.sessionId, { limit: cfg.exportLimit });
    const trace = yield* Effect.iterate(first, {
        body: (s) => persistence.trace(input.sessionId, { limit: cfg.exportLimit, ...(s.cursor == null ? {} : { cursor: s.cursor }) }).pipe(
            Effect.map((p) => ({ ...p, items: [...s.items, ...p.items] }))),
        while: (s) => s.hasNext && s.cursor !== null });
    const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
    const content = input.format === 'ndjson'
        ? `${trace.items.map((i) => JSON.stringify({ ...i, result: Option.getOrUndefined(i.result) })).join('\n')}\n`
        : [['sequence','createdAt','operation','status','durationMs','failureClass','workflowExecutionId','workflowCommandId','workflowApproved','params','result'],
            ...trace.items.map((i) => [String(i.sequence), i.createdAt.toISOString(), i.operation, i.success ? 'ok' : 'error', String(i.durationMs),
                i.failureClass ?? '', i.workflowExecutionId ?? '', i.workflowCommandId ?? '',
                i.workflowApproved === undefined ? '' : String(i.workflowApproved), _compact(i.params),
                Option.match(i.result, { onNone: () => '', onSome: _compact })])].map((r) => r.map(esc).join(',')).join('\n');
    yield* fs.writeFileString(input.output, content);
    yield* _print('sessions export', [`session=${input.sessionId}`, `format=${input.format}`, `output=${input.output}`, `rows=${String(trace.items.length)}`]);
}))).pipe(Command.withDescription('Export session trace projection as NDJSON or CSV.'));
const _sessionsPruneCommand = Command.make('prune', {
    before: Options.text('before').pipe(Options.withDescription('ISO date cutoff — sessions completed before this date will be pruned (e.g. 2025-12-01)')),
}, (input) => _withAppTenant(Effect.gen(function* () {
    const persistence = yield* AgentPersistenceService;
    const cutoff = new Date(input.before);
    const result = yield* Effect.iterate({ continue: true as boolean, pruned: 0 }, {
        body: (state) => persistence.list({ before: cutoff, limit: 500, status: ['completed', 'failed'] as const }).pipe(
            Effect.tap((page) => Effect.forEach(page.items, (session) =>
                persistence.completeSession({ appId: session.appId, correlationId: session.correlationId ?? session.id,
                    error: 'Pruned by operator', sequence: session.toolCallCount, sessionId: session.id, status: 'interrupted',
                    toolCallCount: session.toolCallCount }), { discard: true })),
            Effect.map((page) => ({ continue: page.items.length > 0, pruned: state.pruned + page.items.length }))),
        while: (state) => state.continue,
    });
    yield* _print('sessions prune', [`cutoff=${input.before}`, `pruned=${String(result.pruned)} sessions`]);
}))).pipe(Command.withDescription('Prune sessions completed before a given date.'));
const _sessionsCommand = Command.make('sessions', {}, () => Effect.void).pipe(
    Command.withSubcommands([_sessionsListCommand, _sessionsTraceCommand, _sessionsExportCommand, _sessionsPruneCommand]),
    Command.withDescription('Session operator commands.'),
    Command.provide(HarnessConfig.persistenceLayer));
const _configCommand = Command.make('config', {
    key:   Options.text('key').pipe(Options.withDescription('Dotted config key (e.g. ai.languageModel)'), Options.optional),
    value: Options.text('value').pipe(Options.withDescription('Value to set'), Options.optional),
}, (input) => ConfigFile.read.pipe(Effect.flatMap((config) =>
    Option.match(input.key, {
        onNone: () => _print(`config list (${ConfigFile.path})`, ConfigFile.flatten(config)),
        onSome: (key) => Effect.filterOrFail(
            Effect.succeed(key),
            (candidate) => ConfigFile.keys.includes(candidate),
            () => new CliError({ message: `Unsupported config key '${key}'.`, reason: 'validation' }),
        ).pipe(Effect.flatMap((candidate) => Option.match(input.value, {
            onNone: () => _print(`config get ${candidate}`, [((value: unknown) =>
                value === undefined ? `${candidate} is not set` : `${candidate} = ${String(value)}`)(ConfigFile.get(config, candidate))]),
            onSome: (value) => ConfigFile.write(ConfigFile.set(config, candidate, value)).pipe(
                Effect.zipRight(_print('config set', [`${candidate} = ${value}`, `written to ${ConfigFile.path}`]))),
        }))),
    }),
))).pipe(Command.withDescription('Config operations: no args=list, --key=get, --key + --value=set.'));
const _diagnosticsCheckCommand = Command.make('check', {}, () =>
    _withAppTenant(Effect.gen(function* () {
        const transport = yield* readPortFile().pipe(
            Effect.map(({ pid, port }) => ({ message: `Port file valid; pid=${pid} port=${port}`, status: 'ok' as const })),
            Effect.catchTag('SocketClientError', (error) =>
                Effect.succeed({ message: error.message, status:
                    ({ port_file_not_found: 'missing', port_file_stale: 'stale' } as Record<string, string>)[error.reason] ?? 'invalid' })));
        const cfg = yield* HarnessConfig;
        const fs = yield* FileSystem.FileSystem;
        const auth = yield* KargadanHost.auth.status.pipe(Effect.mapError(_toCliError));
        const persistenceProbe = yield* AgentPersistenceService.pipe(Effect.flatMap((svc) => svc.list({ limit: 1 })));
        const fmtOvr = (opt: typeof cfg.resolveSessionOverride) => Option.match(opt, { onNone: () => 'none',
            onSome: (o) => `${o.language?.provider ?? 'unknown'}:${o.language?.model ?? 'unknown'}` });
        const configIntegrity = yield* fs.readFileString(ConfigFile.path).pipe(
            Effect.map((raw) => ({ hash: createHash('sha256').update(raw).digest('hex').slice(0, 16), status: 'ok' as const })),
            Effect.catchAll(() => Effect.succeed({ hash: 'n/a', status: 'missing' as const })));
        const dataDirProbe = yield* fs.exists(ConfigFile.dir).pipe(
            Effect.map((exists) => exists ? 'accessible' as const : 'missing' as const),
            Effect.catchAll(() => Effect.succeed('error' as const)));
        yield* _print('diagnostics check', [
            `appId=${cfg.appId}`, `protocol=${String(cfg.protocolVersion.major)}.${String(cfg.protocolVersion.minor)}`,
            `dbReachable=true totalSessions=${String(persistenceProbe.total)}`,
            `languageOverride=${fmtOvr(cfg.resolveSessionOverride)}`, `architectOverride=${fmtOvr(cfg.resolveArchitectOverride)}`,
            `auth=${auth.map((entry) => `${entry.provider}:${entry.enrolled ? 'ok' : 'missing'}`).join(',')}`,
            `transport=${transport.status} (${transport.message})`,
            `configIntegrity=${configIntegrity.status} hash=${configIntegrity.hash}`,
            `dataDir=${dataDirProbe} (${ConfigFile.dir})`]);
    }))).pipe(
    Command.withDescription('Validate environment, DB connectivity, transport, config integrity, and data directory.'),
    Command.provide(HarnessConfig.persistenceLayer));
const _diagnosticsLiveCommand = Command.make('live', {
    launch:   Options.boolean('launch').pipe(Options.withDescription('Launch Rhino before probing the live socket'), Options.withDefault(false)),
    prepare:  Options.boolean('prepare').pipe(Options.withDescription('Build the Rhino plugin, package it with yak, install it, then launch and probe'), Options.withDefault(false)),
    rhinoApp: Options.text('rhino-app').pipe(Options.withDescription('Override Rhino.app bundle path'), Options.optional),
    yakPath:  Options.text('yak-path').pipe(Options.withDescription('Override yak executable path'), Options.optional),
}, (input) => _withAppTenant(Effect.gen(function* () {
    const cfg = yield* HarnessConfig;
    const shouldLaunch = input.launch || input.prepare;
    const rhinoApp = input.rhinoApp.pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0));
    const yakPath = input.yakPath.pipe(Option.map((value) => value.trim()), Option.filter((value) => value.length > 0));
    const appPath = yield* (shouldLaunch ? _resolveRhinoApp(rhinoApp) : Effect.succeed(''));
    const resolvedYakPath = yield* (input.prepare ? _resolveYakPath(appPath, yakPath) : Effect.succeed(''));
    yield* Effect.when(_assertPrepareSafe, () => input.prepare);
    const prepared = yield* (input.prepare
        ? _preparePlugin(resolvedYakPath).pipe(Effect.map(Option.some))
        : Effect.succeed(Option.none<{ readonly packagePath: string; readonly pluginPath: string; readonly stageRoot: string }>()));
    yield* Effect.when(_launchRhino(appPath), () => shouldLaunch);
    const transport = yield* (shouldLaunch
        ? _waitForTransport(cfg.rhinoLaunchTimeoutMs)
        : readPortFile().pipe(
            Effect.catchTag('SocketClientError', (error) => Effect.fail(new CliError({
                detail:  error,
                message: 'Rhino transport is not active. Start Rhino or rerun with --launch / --prepare.',
                reason:  'not_found',
            }))),
        ));
    const live = yield* HarnessRuntime.probeLive.pipe(
        Effect.mapError((detail) => new CliError({
            detail,
            message: detail instanceof Error ? detail.message : 'Live Rhino probe failed.',
            reason:  'runtime',
        })),
    );
    const artifact = {
        acceptedCapabilities:  live.handshake.acceptedCapabilities,
        catalog:               live.handshake.catalog,
        catalogCount:          live.handshake.catalog.length,
        createdAt:             new Date().toISOString(),
        launch:                shouldLaunch,
        package:               Option.match(prepared, { onNone: () => null, onSome: (value) => value }),
        prepare:               input.prepare,
        rhino:                 shouldLaunch ? { appPath, yakPath: input.prepare ? resolvedYakPath : null } : null,
        sceneSummary:          live.summary,
        server:                live.handshake.server ?? null,
        transport,
    };
    const artifactPath = yield* _writeLiveArtifact(artifact);
    yield* _print('diagnostics live', [
        `artifact=${artifactPath}`,
        `transport=pid:${String(transport.pid)} port:${String(transport.port)}`,
        `server=${live.handshake.server?.rhinoVersion ?? 'unknown'} plugin=${live.handshake.server?.pluginRevision ?? 'unknown'}`,
        `catalog=${String(live.handshake.catalog.length)} capabilities=${live.handshake.acceptedCapabilities.join(',') || 'none'}`,
        `scene.objectCount=${String(live.summary.objectCount)}`,
        ...Option.match(prepared, {
            onNone: () => [] as ReadonlyArray<string>,
            onSome: (value) => [`package=${value.packagePath}`, `stage=${value.stageRoot}`],
        }),
    ]);
}))).pipe(Command.withDescription('Run a real live Rhino probe: optional package install + launch, then handshake and read.scene.summary.'));
const _diagnosticsCommand = Command.make('diagnostics', {}, () => Effect.void).pipe(
    Command.withSubcommands([_diagnosticsCheckCommand, _diagnosticsLiveCommand]),
    Command.withDescription('Diagnostics commands.'));
const _initWizard = Effect.gen(function* () {
    yield* _requireTty;
    const [config, fs] = yield* Effect.all([ConfigFile.read, FileSystem.FileSystem]);
    const exists = yield* fs.exists(ConfigFile.path);
    yield* Effect.when(
        Prompt.run(Prompt.confirm({ initial: false, label: { confirm: 'overwrite', deny: 'cancel' },
            message: `Config already exists at ${ConfigFile.path}. Overwrite?` })).pipe(
            Effect.filterOrFail((confirmed) => confirmed, () => new CliError({ message: 'Init cancelled.', reason: 'validation' }))),
        () => exists,
    );
    const provider = yield* _selectProvider('AI provider:');
    const model = yield* Prompt.run(Prompt.text({ default: PROVIDER_VOCABULARY[provider].defaultModel, message: 'Language model:' }));
    const geminiClientPath = yield* Match.value(PROVIDER_VOCABULARY[provider].credential.kind).pipe(
        Match.when('api-secret', () => Effect.succeed(Option.none<string>())),
        Match.orElse(() => _promptGeminiClientPath(_nonBlank(ConfigFile.get(config, 'ai.geminiClientPath') as string | undefined)).pipe(Effect.map(Option.some))),
    );
    const databaseUrl = yield* KargadanHost.postgres.bootstrap.pipe(Effect.mapError(_toCliError));
    yield* Match.value(PROVIDER_VOCABULARY[provider].credential.kind).pipe(
        Match.when('api-secret', () => _promptSecret(provider).pipe(
            Effect.flatMap((secret) => KargadanHost.auth.login({ provider, secret })),
            Effect.mapError(_toCliError),
        )),
        Match.orElse(() => KargadanHost.auth.login({
            provider,
            ...Option.match(geminiClientPath, { onNone: () => ({}), onSome: (value) => ({ clientPath: value }) }),
        }).pipe(Effect.mapError(_toCliError))),
    );
    yield* ConfigFile.write({
        ...config,
        ai: { ...(config.ai ?? {}), geminiClientPath: Option.getOrUndefined(geminiClientPath), languageModel: model, languageProvider: provider },
        database: { ...(config.database ?? {}), url: databaseUrl },
    }).pipe(Effect.mapError(_toCliError));
    yield* _print('Kargadan initialized', [`provider: ${provider}`, `model: ${model}`, `config: ${ConfigFile.path}`,
        `database: ${databaseUrl}`, `auth: enrolled in macOS Keychain`]);
});
const _authStatusCommand = Command.make('status', {}, () => Effect.gen(function* () {
    const [config, statuses] = yield* Effect.all([ConfigFile.read, KargadanHost.auth.status.pipe(Effect.mapError(_toCliError))]);
    const selectedProvider = ConfigFile.get(config, 'ai.languageProvider');
    const selectedModel = ConfigFile.get(config, 'ai.languageModel');
    const geminiClientPath = ConfigFile.get(config, 'ai.geminiClientPath');
    yield* _print('auth status', [
        `selected=${selectedProvider === undefined ? 'unset' : `${String(selectedProvider)}:${String(selectedModel ?? 'unset')}`}`,
        ...statuses.map((status) => `${status.provider} | ${status.kind} | ${status.enrolled ? 'enrolled' : 'missing'}${status.provider === 'gemini' ? ` | client=${String(geminiClientPath ?? 'unset')}` : ''}`),
    ]);
}));
const _authLoginCommand = Command.make('login', {
    clientPath: Options.text('client-path').pipe(Options.withDescription('Gemini desktop client JSON path'), Options.optional),
    provider:   Options.text('provider').pipe(Options.withDescription('Provider name (anthropic|gemini|openai)'), Options.optional),
}, (input) => Effect.gen(function* () {
    yield* _requireTty;
    const config = yield* ConfigFile.read;
    const provider = yield* input.provider.pipe(
        Option.map((value) => value.trim()),
        Option.filter((value): value is keyof typeof PROVIDER_VOCABULARY => Object.hasOwn(PROVIDER_VOCABULARY, value)),
        Option.match({ onNone: () => _selectProvider('Credential provider:'), onSome: Effect.succeed }),
    );
    const geminiClientPath = yield* Match.value(PROVIDER_VOCABULARY[provider].credential.kind).pipe(
        Match.when('api-secret', () => Effect.succeed(Option.none<string>())),
        Match.orElse(() => input.clientPath.pipe(
            Option.map((value) => value.trim()),
            Option.filter((value) => value.length > 0),
            Option.match({
                onNone: () => _promptGeminiClientPath(_nonBlank(ConfigFile.get(config, 'ai.geminiClientPath') as string | undefined)).pipe(Effect.map(Option.some)),
                onSome: (value) => Effect.succeed(Option.some(value)),
            }),
        )),
    );
    yield* Match.value(PROVIDER_VOCABULARY[provider].credential.kind).pipe(
        Match.when('api-secret', () => _promptSecret(provider).pipe(Effect.flatMap((secret) => KargadanHost.auth.login({ provider, secret })))),
        Match.orElse(() => KargadanHost.auth.login({
            provider,
            ...Option.match(geminiClientPath, { onNone: () => ({}), onSome: (value) => ({ clientPath: value }) }),
        })),
    ).pipe(Effect.mapError(_toCliError));
    yield* Effect.when(
        ConfigFile.write(ConfigFile.set(config, 'ai.geminiClientPath', Option.getOrUndefined(geminiClientPath))).pipe(Effect.mapError(_toCliError)),
        () => Option.isSome(geminiClientPath),
    );
    yield* _print('auth login', [`provider=${provider}`, `stored=macOS Keychain`, ...Option.match(geminiClientPath, {
        onNone: () => [] as ReadonlyArray<string>, onSome: (value) => [`client=${value}`],
    })]);
}));
const _authLogoutCommand = Command.make('logout', {
    provider: Options.text('provider').pipe(Options.withDescription('Provider name (anthropic|gemini|openai); omit to clear all'), Options.optional),
}, (input) => input.provider.pipe(
    Option.map((value) => value.trim()),
    Option.filter((value): value is keyof typeof PROVIDER_VOCABULARY => Object.hasOwn(PROVIDER_VOCABULARY, value)),
    Option.match({
        onNone: () => KargadanHost.auth.logout().pipe(
            Effect.mapError(_toCliError),
            Effect.zipRight(_print('auth logout', ['providers=all', 'status=cleared'])),
        ),
        onSome: (provider) => KargadanHost.auth.logout(provider).pipe(
            Effect.mapError(_toCliError),
            Effect.zipRight(_print('auth logout', [`provider=${provider}`, 'status=cleared'])),
        ),
    }),
));
const _authCommand = Command.make('auth', {}, () => Effect.void).pipe(
    Command.withSubcommands([_authLoginCommand, _authStatusCommand, _authLogoutCommand]),
    Command.withDescription('Credential enrollment and status commands.'),
);
const _initCommand = Command.make('init', {}, () => _initWizard).pipe(
    Command.withDescription('Initialize Kargadan configuration.'));
const _rootCommand = Command.make('kargadan', {}, () => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const exists = yield* fs.exists(ConfigFile.path);
    yield* Match.value(exists).pipe(
        Match.when(true, () => _runInteractive()),
        Match.orElse(() => _initWizard.pipe(Effect.zipRight(
            loadConfigProvider.pipe(Effect.flatMap((provider) => _runInteractive().pipe(
                Effect.withConfigProvider(provider),
                Effect.provide(HarnessConfig.Default),
            ))),
        ))),
    );
})).pipe(
    Command.withSubcommands([_runCommand, _initCommand, _authCommand, _sessionsCommand, _configCommand, _diagnosticsCommand]),
    Command.transformHandler((handler) => handler.pipe(
        Effect.withSpan('kargadan.cli.command'),
        Effect.mapError(_toCliError))),
    Command.provide(HarnessConfig.Default));

// --- [ENTRY] -----------------------------------------------------------------

NodeRuntime.runMain(loadConfigProvider.pipe(
    Effect.flatMap((provider) => Command.run({ name: 'kargadan', version: _version })(_rootCommand)(process.argv).pipe(
        Effect.provide(CliConfig.layer({ finalCheckBuiltIn: false })),
        Effect.withConfigProvider(provider))),
    Effect.provide(NodeFileSystem.layer),
    Effect.provide(NodeContext.layer),
    Effect.catchAll((error) =>
        error instanceof CliError
            ? Console.error(HelpDoc.toAnsiText(error.doc)).pipe(Effect.zipRight(Effect.fail(error)))
            : ValidationError.isValidationError(error)
                ? Effect.fail(error)
                : Console.error(_compact(error)).pipe(Effect.zipRight(Effect.fail(error)))),
) as Effect.Effect<void, unknown, never>, { disableErrorReporting: true });
