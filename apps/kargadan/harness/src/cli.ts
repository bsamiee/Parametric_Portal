import { createHash } from 'node:crypto';
import { join } from 'node:path';
import * as ProcessCommand from '@effect/platform/Command';
import * as FileSystem from '@effect/platform/FileSystem';
import * as Terminal from '@effect/platform/Terminal';
import { NodeCommandExecutor, NodeContext, NodeFileSystem, NodeRuntime } from '@effect/platform-node';
import { CliConfig, Command, HelpDoc, Options, Prompt, Span, ValidationError } from '@effect/cli';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Client } from '@parametric-portal/database/client';
import * as Console from 'effect/Console';
import { Config, ConfigProvider, Data, Duration, Effect, Fiber, HashMap, Match, Option, Queue, Redacted, Schedule } from 'effect';
import { AiRegistry } from '@parametric-portal/ai/registry';
import { ConfigFile, HarnessConfig, HarnessHostError, type KargadanConfigSchema, KargadanHost, loadConfigProvider } from './config';
import { HarnessRuntime } from './harness';
import type { kargadanToolCallProjector } from './protocol/schemas';
import { readPortFile } from './socket';

// --- [TYPES] -----------------------------------------------------------------
type _TraceProjection = ReturnType<typeof kargadanToolCallProjector>;
type _ConfigAssessment =
    | { readonly config: typeof KargadanConfigSchema.Type; readonly detail: string; readonly reason: 'incomplete' | 'ready' }
    | { readonly detail: string; readonly reason: 'invalid' | 'missing' };

// --- [CONSTANTS] -------------------------------------------------------------
declare const __APP_VERSION__: string;
const _version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env['npm_package_version'] ?? '0.1.0');
const _csvHeaders = ['sequence','createdAt','operation','status','durationMs','failureClass','workflowExecutionId','workflowCommandId','workflowApproved','params','result'] as const;
const _P = {
    artifactDir: join(ConfigFile.dir, 'live'), buildDir: join(import.meta.dirname, '../../plugin/bin/Release/net9.0'),
    fileName: 'ParametricPortal.Kargadan.Plugin.rhp', manifestFileName: 'manifest.yml',
    nxProject: 'ParametricPortal.Kargadan.Plugin', stageDir: join(ConfigFile.dir, 'plugin'), tf: 'net9.0',
} as const;
const _rhinoPatterns = [/^Rhino 9/i, /^Rhino WIP/i, /^Rhino/i, /^Rhinoceros/i] as const;

// --- [ERRORS] ----------------------------------------------------------------

class CliError extends Data.TaggedError('CliError')<{ readonly detail?: unknown; readonly message: string; readonly reason: keyof typeof CliError.reasons }> {
    static readonly reasons = { io: { advice: 'Retry after transient conditions clear.', failureClass: 'retryable' },
        not_found: { advice: 'Adjust parameters, then retry.', failureClass: 'correctable' }, runtime: { advice: 'Inspect transport/protocol before retry.', failureClass: 'fatal' },
        tty_required: { advice: 'Run in a TTY session.', failureClass: 'correctable' }, validation: { advice: 'Adjust parameters or rerun with flags.', failureClass: 'correctable' } } as const;
    static readonly from = (error: unknown) => Match.value(error).pipe(
        Match.when(Match.instanceOf(CliError), (e) => e),
        Match.when(Match.instanceOf(HarnessHostError), (e) => new CliError({ detail: e.detail, message: e.message,
            reason: ({ auth: 'validation', config: 'validation', keychain: 'runtime', postgres: 'not_found' } as const satisfies Record<HarnessHostError['reason'], CliError['reason']>)[e.reason] })),
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
const _requireTty = Terminal.Terminal.pipe(Effect.flatMap((t) => t.isTTY),
    Effect.filterOrFail((v) => v, () => new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' })), Effect.asVoid);
const _configAssessment = Effect.gen(function* () {
    const exists = yield* (yield* FileSystem.FileSystem).exists(ConfigFile.path);
    return yield* Match.value(exists).pipe(
        Match.when(false, () => Effect.succeed({ detail: '', reason: 'missing' } satisfies _ConfigAssessment)),
        Match.orElse(() => ConfigFile.read.pipe(
            Effect.map((config) => Option.fromNullable(config.ai?.language?.primary).pipe(Option.match({
                onNone: () => ({ config, detail: 'Missing ai.language.primary.', reason: 'incomplete' } satisfies _ConfigAssessment),
                onSome: () => ({ config, detail: '', reason: 'ready' } satisfies _ConfigAssessment) }))),
            Effect.catchAll((e) => Effect.succeed({ detail: _compact(e), reason: 'invalid' } satisfies _ConfigAssessment)))));
}).pipe(Effect.catchAll((e) => Effect.succeed({ detail: _compact(e), reason: 'invalid' } satisfies _ConfigAssessment)));
const _enrollProvider = (provider: keyof typeof AiRegistry.providers, config: typeof KargadanConfigSchema.Type, clientPathHint?: Option.Option<string>) =>
    Match.value(AiRegistry.providers[provider].credential.kind).pipe(
        Match.when('api-secret', () => Prompt.run(Prompt.hidden({ message: `${provider} API secret:`,
            validate: (v) => v.trim().length === 0 ? Effect.fail('Credential cannot be empty') : Effect.succeed(v.trim()) })).pipe(
            Effect.map(Redacted.value), Effect.flatMap((secret) => KargadanHost.auth.login({ provider, secret })), Effect.as(Option.none<string>()))),
        Match.orElse(() => Option.match(clientPathHint ?? Option.none<string>(), {
            onNone: () => Prompt.run(Prompt.text({ ...(Option.match(_trimOpt(Option.fromNullable(config.ai?.geminiClientPath)), { onNone: () => ({}), onSome: (v) => ({ default: v }) })),
                message: 'Gemini desktop client JSON path:', validate: (v) => v.trim().length === 0 ? Effect.fail('Client JSON path cannot be empty') : Effect.succeed(v.trim()) })).pipe(Effect.map(Option.some)),
            onSome: (v) => Effect.succeed(Option.some(v)),
        }).pipe(Effect.flatMap((cp) => KargadanHost.auth.login({ provider, ...Option.match(cp, { onNone: () => ({}), onSome: (v) => ({ clientPath: v }) }) }).pipe(Effect.as(cp))))),
    ).pipe(Effect.mapError(CliError.from));
const _runExt = (label: string, cmd: ProcessCommand.Command) =>
    ProcessCommand.exitCode(ProcessCommand.stdout(ProcessCommand.stderr(cmd, 'inherit'), 'inherit')).pipe(Effect.provide(NodeCommandExecutor.layer),
        Effect.flatMap((code) => code === 0 ? Effect.void : Effect.fail(new CliError({ message: `${label} exited with code ${String(code)}.`, reason: 'runtime' }))));
const _promptProvider = (provider: Option.Option<string>, message: string) => provider.pipe(Option.map((v) => v.trim()),
    Option.filter((v): v is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, v)),
    Option.match({
        onNone: () => Prompt.run(Prompt.select({ choices: Object.entries(AiRegistry.providers).map(([v, m]) => ({ title: m.title, value: v as keyof typeof AiRegistry.providers })), message })),
        onSome: Effect.succeed }));
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
const _resolvePath = (fs: FileSystem.FileSystem, input: {
    readonly discover: Effect.Effect<string, CliError, FileSystem.FileSystem>; readonly fallback: Option.Option<string>;
    readonly label: string; readonly override: Option.Option<string>;
}) => Option.match(Option.orElse(input.override, () => input.fallback), {
    onNone: () => input.discover,
    onSome: (path) => fs.exists(path).pipe(Effect.filterOrFail((v) => v, () => new CliError({ message: `${input.label} not found at ${path}.`, reason: 'not_found' })), Effect.as(path)) });
const _ensureRunReady = _requireTty.pipe(
    Effect.zipRight(_configAssessment),
    Effect.flatMap((a) => Match.value(a).pipe(
        Match.when({ reason: 'ready' }, (a) => Effect.succeed(a.config)),
        Match.orElse((a) => _print('kargadan bootstrap', [`config=${a.reason}`, `path=${ConfigFile.path}`,
            ...(a.detail ? [`detail=${a.detail}`] : []), `action=${a.reason === 'missing' ? 'initialize' : 'repair'}`]).pipe(
            Effect.zipRight(_initWizard), Effect.zipRight(ConfigFile.read))))),

    Effect.flatMap((config) => KargadanHost.auth.status.pipe(Effect.mapError(CliError.from),
        Effect.flatMap((statuses) => Option.fromNullable(config.ai?.language?.primary?.provider).pipe(Option.match({
            onNone: () => Effect.succeed(config),
            onSome: (provider) => Option.fromNullable(statuses.find((s) => s.provider === provider)).pipe(Option.filter((s) => !s.enrolled), Option.match({
                onNone: () => Effect.succeed(config),
                onSome: () => _print('kargadan bootstrap', ['auth=missing', `provider=${provider}`, 'action=enroll']).pipe(
                    Effect.zipRight(_completeEnrollment({ config, lines: (gcp) => _gcLines(provider, gcp), provider, title: 'auth repair', write: (gcp) => _writeGC(config, provider, gcp) })),
                    Effect.zipRight(ConfigFile.read)) })) }))))));
const _runInteractive = (input?: { readonly architectFallback?: ReadonlyArray<string>; readonly architectPrimary?: string;
    readonly intent?: string; readonly resume?: 'auto' | 'off'; readonly sessionId?: string;
}) => Effect.gen(function* () {
    yield* _requireTty;
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
});
const _fmtOverride = (o: Option.Option<AiRegistry.SessionOverride>) => Option.match(o, {
    onNone: () => 'none', onSome: (v) => `${v.language?.primary.provider ?? 'unknown'}:${v.language?.primary.model ?? 'unknown'}` });

// --- [COMMANDS] --------------------------------------------------------------

const _runCommand = Command.make('run', {
    architectFallback: Options.text('architect-fallback').pipe(Options.withDescription('Architect fallback model refs (provider:model)'), Options.repeated),
    architectPrimary: Options.text('architect').pipe(Options.withAlias('m'), Options.withDescription('Architect primary model ref (provider:model)'),
        Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_PRIMARY')), Options.optional),
    configOverride: Options.keyValueMap('config').pipe(Options.withAlias('c'), Options.withDescription('Config overrides'), Options.withDefault(HashMap.empty<string, string>())),
    intent: Options.text('intent').pipe(Options.withAlias('i'), Options.withDescription('Natural language intent'),
        Options.withFallbackConfig(Config.string('KARGADAN_AGENT_INTENT')), Options.withFallbackPrompt(Prompt.text({
        message: 'Intent:', validate: (v) => v.trim().length === 0 ? Effect.fail('Intent cannot be empty') : Effect.succeed(v.trim()) }))),
    resume: Options.choice('resume', ['auto', 'off'] as const).pipe(Options.withAlias('r'), Options.withDefault('auto')),
    sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.optional),
}, (input) => _ensureRunReady.pipe(Effect.zipRight((<A, E, R>(run: Effect.Effect<A, E, R>) =>
    HashMap.size(input.configOverride) > 0
        ? Effect.withConfigProvider(run, ConfigProvider.fromMap(new Map(HashMap.toEntries(input.configOverride).map(([k, v]) => [ConfigFile.runtimeKey(k), v] as const))))
        : run)(_runInteractive({ architectFallback: input.architectFallback, intent: input.intent, resume: input.resume,
    ...Option.match(input.architectPrimary, { onNone: () => ({}), onSome: (architectPrimary) => ({ architectPrimary }) }),
    ...Option.match(input.sessionId, { onNone: () => ({}), onSome: (sessionId) => ({ sessionId }) }) })))
)).pipe(Command.withDescription('Run the interactive agent loop (--resume auto resumes latest session).'));
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
            body: (st) => p.list({ before: cutoff, limit: 500, status: ['completed', 'failed'] as const }).pipe(
                Effect.tap((pg) => Effect.forEach(pg.items, (s) => p.completeSession({ appId: s.appId, correlationId: s.correlationId ?? s.id,
                    error: 'Pruned by operator', sequence: s.toolCallCount, sessionId: s.id, status: 'interrupted', toolCallCount: s.toolCallCount }), { discard: true })),
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
    onSome: (key) => Effect.filterOrFail(Effect.succeed(key), (c): c is (typeof ConfigFile.keys)[number] => ConfigFile.keys.includes(c),
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
        const [auth, probe, integrity, dataDir] = yield* Effect.all([
            KargadanHost.auth.status.pipe(Effect.mapError(CliError.from)),
            AgentPersistenceService.pipe(Effect.flatMap((s) => s.list({ limit: 1 }))),
            fs.readFileString(ConfigFile.path).pipe(Effect.map((raw) => ({ hash: createHash('sha256').update(raw).digest('hex').slice(0, 16), status: 'ok' as const })),
                Effect.catchAll(() => Effect.succeed({ hash: 'n/a', status: 'missing' as const }))),
            fs.exists(ConfigFile.dir).pipe(Effect.map((v) => v ? 'accessible' as const : 'missing' as const), Effect.catchAll(() => Effect.succeed('error' as const)))]);
        yield* _print('diagnostics check', [`appId=${config.appId}`, `protocol=${String(config.protocolVersion.major)}.${String(config.protocolVersion.minor)}`,
            `dbReachable=true totalSessions=${String(probe.total)}`, `languageOverride=${_fmtOverride(config.resolveSessionOverride)}`, `architectOverride=${_fmtOverride(config.resolveArchitectOverride)}`,
            `auth=${auth.map((e) => `${e.provider}:${e.enrolled ? 'ok' : 'missing'}${Option.isSome(e.decodeError) ? ':DECODE_ERROR' : ''}`).join(',')}`,
            `transport=${transport.status} (${transport.message})`, `configIntegrity=${integrity.status} hash=${integrity.hash}`, `dataDir=${dataDir} (${ConfigFile.dir})`]);
    })).pipe(Command.withDescription('Validate environment, DB, transport, config, and data directory.'));
    const _live = Command.make('live', {
        launch: Options.boolean('launch').pipe(Options.withDefault(false)), prepare: Options.boolean('prepare').pipe(Options.withDefault(false)),
        rhinoApp: Options.text('rhino-app').pipe(Options.optional), yakPath: Options.text('yak-path').pipe(Options.optional),
    }, (input) => Effect.gen(function* () {
        const [config, fs] = yield* Effect.all([HarnessConfig, FileSystem.FileSystem]);
        const shouldLaunch = input.launch || input.prepare;
        const appPath = yield* (shouldLaunch ? _resolvePath(fs, {
            discover: fs.readDirectory('/Applications').pipe(
                Effect.map((entries) => entries.filter((e) => e.endsWith('.app') && /(Rhino|Rhinoceros)/i.test(e))
                    .sort((l, r) => ((_d) => _d === 0 ? l.localeCompare(r) : _d)(
                        ((_rk) => _rk(l) - _rk(r))((e: string) => { const idx = _rhinoPatterns.findIndex((p) => p.test(e)); return idx === -1 ? Number.MAX_SAFE_INTEGER : idx; })))
                    .map((e) => join('/Applications', e))),
                Effect.flatMap((apps) => apps.length > 0 ? Effect.succeed(apps[0] as string)
                    : Effect.fail(new CliError({ message: 'Rhino.app was not discovered under /Applications. Set rhino.appPath or pass --rhino-app.', reason: 'not_found' }))),
                Effect.mapError(CliError.from)),
            fallback: _trimOpt(Option.fromNullable(config.rhinoAppPath)), label: 'Rhino.app', override: _trimOpt(input.rhinoApp) }) : Effect.succeed(''));
        const yakResolved = yield* (input.prepare ? _resolvePath(fs, {
            discover: Effect.fail(new CliError({ message: 'Yak path could not be resolved.', reason: 'not_found' })),
            fallback: Option.orElse(_trimOpt(Option.fromNullable(config.rhinoYakPath)), () => Option.some(join(appPath, 'Contents/Resources/bin/yak'))),
            label: 'yak executable', override: _trimOpt(input.yakPath) }) : Effect.succeed(''));
        yield* Effect.when(readPortFile().pipe(Effect.map(Option.some),
            Effect.catchTag('SocketClientError', () => Effect.succeed(Option.none<{ readonly pid: number; readonly port: number; readonly startedAt: string }>())),
            Effect.flatMap(Option.match({ onNone: () => Effect.void,
                onSome: ({ pid, port }) => Effect.fail(new CliError({ message: `Rhino transport already active pid=${pid} port=${port}. Close Rhino before --prepare.`, reason: 'validation' })) }))),
            () => input.prepare);
        const prepared = yield* (input.prepare ? Effect.gen(function* () {
            const [stageRoot, pluginPath] = [join(_P.stageDir, `package-${Date.now().toString()}`), join(_P.buildDir, _P.fileName)];
            yield* _runExt('Restore Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_P.nxProject}:restore`)).pipe(
                Effect.zipRight(_runExt('Build Rhino plugin', ProcessCommand.make('pnpm', 'exec', 'nx', 'run', `${_P.nxProject}:build:release`))));
            yield* fs.exists(pluginPath).pipe(Effect.filterOrFail((v) => v, () => new CliError({ message: `Plugin artifact ${pluginPath} not produced.`, reason: 'runtime' })));
            yield* fs.makeDirectory(stageRoot, { recursive: true }).pipe(Effect.zipRight(fs.copy(_P.buildDir, join(stageRoot, _P.tf), { overwrite: true })));
            yield* _runExt('Generate Yak manifest', ProcessCommand.make(yakResolved, 'spec', '--input', join(stageRoot, _P.tf, _P.fileName), '--output', stageRoot));
            yield* fs.readFileString(join(stageRoot, _P.manifestFileName)).pipe(Effect.flatMap((m) =>
                fs.writeFileString(join(stageRoot, _P.manifestFileName), m.replace('url: <url>', 'url: https://github.com/bardiasamiee/Parametric_Portal'))));
            yield* _runExt('Build Yak package', ProcessCommand.workingDirectory(ProcessCommand.make(yakResolved, 'build', '--platform', 'mac'), stageRoot));
            const packagePath = yield* fs.readDirectory(stageRoot).pipe(
                Effect.map((entries) => entries.filter((e) => e.endsWith('.yak')).sort((l, r) => l.localeCompare(r)).map((e) => join(stageRoot, e))),
                Effect.flatMap((pkgs) => pkgs.length > 0 ? Effect.succeed(pkgs.at(-1) as string)
                    : Effect.fail(new CliError({ message: `No .yak package emitted in ${stageRoot}.`, reason: 'runtime' }))));
            yield* _runExt('Install Yak package', ProcessCommand.make(yakResolved, 'install', packagePath));
            return { packagePath, pluginPath, stageRoot } as const;
        }).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none<{ readonly packagePath: string; readonly pluginPath: string; readonly stageRoot: string }>()));
        yield* Effect.when(Match.value(process.platform).pipe(
            Match.when('darwin', () => _runExt('Launch Rhino', ProcessCommand.make('open', '-a', appPath))),
            Match.orElse((p) => Effect.fail(new CliError({ message: `--launch supports macOS only; detected ${p}.`, reason: 'validation' })))), () => shouldLaunch);
        const transport = yield* (shouldLaunch
            ? readPortFile().pipe(Effect.retry(Schedule.spaced(Duration.seconds(1)).pipe(Schedule.upTo(Duration.millis(config.rhinoLaunchTimeoutMs)))),
                Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: `Transport not ready within ${String(config.rhinoLaunchTimeoutMs)}ms.`, reason: 'not_found' }))))
            : readPortFile().pipe(Effect.catchTag('SocketClientError', (e) => Effect.fail(new CliError({ detail: e, message: 'Transport not active. Rerun with --launch / --prepare.', reason: 'not_found' })))));
        const live = yield* HarnessRuntime.probeLive.pipe(Effect.mapError((d) => new CliError({ detail: d, message: d instanceof Error ? d.message : 'Live Rhino probe failed.', reason: 'runtime' })));
        const artifactFile = join(_P.artifactDir, `probe-${new Date().toISOString().replaceAll(':', '-')}.json`);
        const artifact = { acceptedCapabilities: live.handshake.acceptedCapabilities, catalog: live.handshake.catalog, catalogCount: live.handshake.catalog.length,
            createdAt: new Date().toISOString(), launch: shouldLaunch, package: Option.getOrNull(prepared), prepare: input.prepare,
            rhino: shouldLaunch ? { appPath, yakPath: input.prepare ? yakResolved : null } : null, sceneSummary: live.summary, server: live.handshake.server ?? null, transport };
        const artifactPath = yield* fs.makeDirectory(_P.artifactDir, { recursive: true }).pipe(Effect.zipRight(fs.writeFileString(artifactFile, JSON.stringify(artifact, null, 2))), Effect.as(artifactFile));
        yield* _print('diagnostics live', [`artifact=${artifactPath}`, `transport=pid:${String(transport.pid)} port:${String(transport.port)}`,
            `server=${live.handshake.server?.rhinoVersion ?? 'unknown'} plugin=${live.handshake.server?.pluginRevision ?? 'unknown'}`,
            `catalog=${String(live.handshake.catalog.length)} capabilities=${live.handshake.acceptedCapabilities.join(',') || 'none'}`,
            `scene.objectCount=${String(live.summary.objectCount)}`, ...Option.match(prepared, { onNone: () => [] as ReadonlyArray<string>,
                onSome: (v) => [`package=${v.packagePath}`, `stage=${v.stageRoot}`] })]);
    })).pipe(Command.withDescription('Probe live Rhino: optional package install + launch, then handshake and read.scene.summary.'));
    return Command.make('diagnostics').pipe(Command.withSubcommands([_check, _live]), Command.withDescription('Diagnostics commands.'),
        Command.transformHandler((effect) => _withAppTenant(effect)), Command.provide(HarnessConfig.persistenceLayer));
})();
const _initWizard = _requireTty.pipe(
    Effect.zipRight(Effect.all([ConfigFile.read.pipe(Effect.catchAll(() => Effect.succeed({} as typeof KargadanConfigSchema.Type))), FileSystem.FileSystem])),
    Effect.flatMap(([config, fs]) => fs.exists(ConfigFile.path).pipe(
        Effect.flatMap((exists) => Effect.when(Prompt.run(Prompt.confirm({ initial: false, label: { confirm: 'overwrite', deny: 'cancel' },
            message: `Config already exists at ${ConfigFile.path}. Overwrite?` })).pipe(
            Effect.filterOrFail((v) => v, () => new CliError({ message: 'Init cancelled.', reason: 'validation' }))), () => exists)),
        Effect.zipRight(_promptProvider(Option.none(), 'AI provider:')),
        Effect.flatMap((provider) => Prompt.run(Prompt.text({ default: AiRegistry.providers[provider].defaultModel, message: 'Language model:' })).pipe(
            Effect.flatMap((model) => KargadanHost.postgres.bootstrap.pipe(Effect.mapError(CliError.from),
                Effect.flatMap((dbUrl) => _completeEnrollment({ config, 
                    lines: () => [`provider: ${provider}`, `model: ${model}`, `config: ${ConfigFile.path}`, `database: ${dbUrl}`, 'auth: enrolled in macOS Keychain'],provider, title: 'Kargadan initialized',
                    write: (gcp) => ConfigFile.write({ ...config,
                        ai: { ...config.ai, geminiClientPath: Option.getOrUndefined(gcp), language: { fallback: config.ai?.language?.fallback ?? [], primary: { model, provider } } },
                        postgres: Option.match(dbUrl.includes('@') ? Option.none<string>() : Option.some(dbUrl), {
                            onNone: () => config.postgres, onSome: (url) => ({ ...config.postgres, url }) }),
                    }).pipe(Effect.mapError(CliError.from)) })))))))));
const _authCommand = (() => Command.make('auth').pipe(Command.withSubcommands([
    Command.make('login', {
        clientPath: Options.text('client-path').pipe(Options.optional), provider: Options.text('provider').pipe(Options.optional),
    }, (input) => _requireTty.pipe(Effect.zipRight(ConfigFile.read), Effect.flatMap((config) =>
        _promptProvider(input.provider, 'Credential provider:').pipe(Effect.flatMap((provider) => _completeEnrollment({
            clientPathHint: _trimOpt(input.clientPath), config, 
            lines: (gcp) => _gcLines(provider, gcp), provider, title: 'auth login',write: (gcp) => _writeGC(config, provider, gcp) })))))).pipe(Command.withDescription('Enroll credentials.')),
    Command.make('status', {}, () => Effect.all([ConfigFile.read, KargadanHost.auth.status.pipe(Effect.mapError(CliError.from))]).pipe(
        Effect.flatMap(([config, statuses]) => ((sel: (k: string) => string) => _print('auth status', [`selected=${sel('ai.language.primary')}`,
            ...statuses.map((s) => `${s.provider} | ${s.kind} | ${s.enrolled ? 'enrolled' : 'missing'}${Option.match(s.decodeError, { onNone: () => '', onSome: (e) => ` | DECODE_ERROR: ${e}` })}${s.provider === 'gemini' ? ` | client=${sel('ai.geminiClientPath')}` : ''}`)])
        )((k) => String(ConfigFile.get(config, k) ?? 'unset'))))).pipe(Command.withDescription('Show credential enrollment status.')),
    Command.make('logout', { provider: Options.text('provider').pipe(Options.optional) },
        (input) => Option.match(input.provider, {
            onNone: () => KargadanHost.auth.logout().pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', ['providers=all', 'status=cleared']))),
            onSome: (raw) => Effect.filterOrFail(Effect.succeed(raw.trim()), (v): v is keyof typeof AiRegistry.providers => Object.hasOwn(AiRegistry.providers, v),
                () => new CliError({ message: `Unknown provider '${raw.trim()}'.`, reason: 'validation' })).pipe(
                Effect.flatMap((p) => KargadanHost.auth.logout(p).pipe(Effect.mapError(CliError.from), Effect.zipRight(_print('auth logout', [`provider=${p}`, 'status=cleared']))))),
        })).pipe(Command.withDescription('Clear enrolled credentials.')),
]), Command.withDescription('Credential enrollment and status.')))();
const _rootCommand = Command.make('kargadan', {}, () => _ensureRunReady.pipe(Effect.zipRight(_runInteractive()))).pipe(
    Command.withSubcommands([_runCommand, Command.make('init', {}, () => _initWizard).pipe(Command.withDescription('Initialize Kargadan configuration.')),
        _authCommand, _sessionsCommand, _configCommand, _diagnosticsCommand]),
    Command.transformHandler((h) => h.pipe(Effect.withSpan('kargadan.cli.command'), Effect.mapError(CliError.from))), Command.provide(HarnessConfig.Default));

// --- [ENTRY] -----------------------------------------------------------------

NodeRuntime.runMain(loadConfigProvider.pipe(
    Effect.flatMap((provider) => Command.run({ name: 'kargadan', version: _version })(_rootCommand)(process.argv).pipe(
        Effect.provide(CliConfig.layer({ finalCheckBuiltIn: false })), Effect.withConfigProvider(provider.provider))),
    Effect.provide(NodeFileSystem.layer), Effect.provide(NodeContext.layer),
    Effect.catchAll((error) => error instanceof CliError ? Console.error(HelpDoc.toAnsiText(error.doc)).pipe(Effect.zipRight(Effect.fail(error)))
        : ValidationError.isValidationError(error) ? Effect.fail(error) : Console.error(_compact(error)).pipe(Effect.zipRight(Effect.fail(error)))),
) as Effect.Effect<void, unknown, never>, { disableErrorReporting: true });
