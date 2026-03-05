import * as FileSystem from '@effect/platform/FileSystem';
import * as Terminal from '@effect/platform/Terminal';
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { CliConfig, Command, HelpDoc, Options, Prompt, Span } from '@effect/cli';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Context } from '@parametric-portal/server/context';
import * as Console from 'effect/Console';
import { Config, Data, Effect, Fiber, Option, Queue } from 'effect';
import { HarnessConfig } from './config';
import { runHarness } from './harness';
import { readPortFile } from './socket';

// --- [CONSTANTS] -------------------------------------------------------------

const _CliApp = { name: 'kargadan', version: '0.1.0' } as const;

// --- [ERRORS] ----------------------------------------------------------------

const _CliReasons = {
    io:           { advice: 'Retry with same intent after transient conditions clear.', failureClass: 'retryable'   },
    not_found:    { advice: 'Adjust parameters or scene constraints, then retry.',      failureClass: 'correctable' },
    runtime:      { advice: 'Inspect transport/protocol assumptions before retry.',     failureClass: 'fatal'       },
    tty_required: { advice: 'Run kargadan commands in a TTY session.',                  failureClass: 'correctable' },
    validation:   { advice: 'Adjust parameters or rerun with explicit flags.',          failureClass: 'correctable' },
} as const;
class CliError extends Data.TaggedError('CliError')<{
    readonly detail?: unknown;
    readonly message: string;
    readonly reason:  keyof typeof _CliReasons;
}> {
    get policy() { return _CliReasons[this.reason]; }
    get doc() {
        return HelpDoc.sequence(
            HelpDoc.h1(Span.error(`kargadan ${this.reason}`)),
            HelpDoc.descriptionList([
                [Span.code('class'),    HelpDoc.p(Span.strong(this.policy.failureClass))],
                [Span.code('issue'),    HelpDoc.p(Span.text(this.message))],
                [Span.code('recovery'), HelpDoc.p(Span.weak(this.policy.advice))],
            ]),
        );
    }
}

// --- [FUNCTIONS] -------------------------------------------------------------

const _csvEscape = (value: string) => `"${value.replaceAll('"', '""')}"`;
const _signal    = (prefix: Span.Span, content: string) => HelpDoc.p(Span.spans([prefix, Span.space, Span.text(content)]));
const _compact   = (value: unknown) =>
    ((s: string) => s.length <= 140 ? s : `${s.slice(0, 140)}...`)(
        typeof value === 'string' ? value : JSON.stringify(value) ?? String(value),
    );
const _requireTTY = Terminal.Terminal.pipe(
    Effect.flatMap((t) => t.isTTY),
    Effect.filterOrFail(
        (b) => b,
        () => new CliError({ message: 'Interactive terminal required.', reason: 'tty_required' }),
    ),
    Effect.asVoid,
);
const _withAppTenant = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    HarnessConfig.appId.pipe(
        Effect.flatMap((appId) => Context.Request.withinSync(appId, effect)),
    );
const _toCliError = (error: unknown): CliError =>
    error instanceof CliError ? error : new CliError({ detail: error, message: String(error), reason: 'runtime' });
const _summaryDoc = (title: string, lines: ReadonlyArray<string>) =>
    HelpDoc.blocks([
        HelpDoc.h1(Span.text(title)),
        ...lines.map((line) => HelpDoc.p(Span.text(line))),
    ]);
const _transportPreconditions = readPortFile().pipe(
    Effect.map(({ pid, port }) => ({ message: `Port file valid; pid=${pid} port=${port}`, status: 'ok' as const })),
    Effect.catchTag('SocketClientError', (error) =>
        Effect.succeed({
            message: error.message,
            status: error.reason === 'port_file_not_found' ? 'missing' as const
                : error.reason === 'port_file_stale' ? 'stale' as const
                : 'invalid' as const,
        })),
);
const _runInteractive = (input?: {
    readonly architectFallback?: ReadonlyArray<string>;
    readonly architectModel?:    string;
    readonly architectProvider?: string;
    readonly intent?:            string;
    readonly resume?:            'auto' | 'off';
    readonly sessionId?:         string;
}) =>
    Effect.gen(function* () {
        const signals = yield* Queue.unbounded<Option.Option<HelpDoc.HelpDoc>>();
        const renderer = yield* Effect.forkScoped(Effect.suspend(() => {
            const consume: Effect.Effect<void> = Queue.take(signals).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.void,
                    onSome: (doc) => Console.log(HelpDoc.toAnsiText(doc)).pipe(Effect.zipRight(consume)),
                })),
            );
            return consume;
        }));
        const _emit = (prefix: Span.Span, content: string) =>
            Queue.offer(signals, Option.some(_signal(prefix, content))).pipe(Effect.asVoid);
        const outcome = yield* runHarness({
            hooks: {
                onFailure: (e) => _emit(Span.error(`[${e.failureClass}]`), `${e.commandId}: ${e.message} | ${e.advice}`),
                onStage:   (e) => _emit(Span.code(`[${e.stage}]`), `${e.phase} seq=${e.sequence} attempt=${e.attempt} status=${e.status}`),
                onTool:    (e) => _emit(Span.code(`[tool:${e.source}]`), `${e.phase} ${e.command.commandId} (${e.durationMs}ms) ${
                    e.phase === 'start' ? _compact(e.command.args) : Option.match(e.result, {
                        onNone: () => 'result:missing',
                        onSome: (r) => r.status === 'ok' ? _compact(r.result) : `${r.error?.failureClass ?? 'fatal'}: ${r.error?.message ?? 'unknown error'}`,
                    })
                }`),
                onWriteApproval: (e) => {
                    const refs = e.command.objectRefs?.map((ref) => `${ref.typeTag}:${ref.objectId}`).join(',') || 'none';
                    return Prompt.run(Prompt.confirm({
                        initial: false,
                        label:   { confirm: 'approve', deny: 'reject' },
                        message: `Approve write '${e.command.commandId}' (wf=${e.workflowExecutionId}) args=${_compact(e.command.args)} refs=${refs}?`,
                    })).pipe(
                        Effect.catchAll(() => Effect.succeed(false)),
                        Effect.tap((approved) => _emit(Span.code('[approval]'), `${e.command.commandId} -> ${approved ? 'approved' : 'rejected'} (${e.workflowExecutionId})`)),
                    );
                },
            },
            ...Object.fromEntries(Object.entries(input ?? {}).filter(([, v]) => v !== undefined)),
        }).pipe(
            Effect.ensuring(
                Queue.offer(signals, Option.none()).pipe(Effect.zipRight(Fiber.join(renderer))),
            ),
        );
        yield* Console.log(HelpDoc.toAnsiText(_summaryDoc('Run complete', [`session: ${outcome.state.identityBase.sessionId}`,
            `status: ${outcome.state.status}`, `sequence: ${String(outcome.state.sequence)}`, `trace entries: ${String(outcome.trace.items.length)}`])));
    });

const _runCommand = Command.make(
    'run',
    {
        architectFallback: Options.text('architect-fallback').pipe(Options.withDescription('Architect fallback model list'), Options.repeated),
        architectModel:    Options.text('architect-model').pipe(Options.withAlias('m'), Options.withDescription('Architect model override'),
            Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_MODEL')), Options.optional),
        architectProvider: Options.text('architect-provider').pipe(Options.withAlias('p'), Options.withDescription('Architect provider override'),
            Options.withFallbackConfig(Config.string('KARGADAN_AI_ARCHITECT_PROVIDER')), Options.optional),
        intent: Options.text('intent').pipe(Options.withAlias('i'), Options.withDescription('Natural language intent for the agent'),
            Options.withFallbackConfig(Config.string('KARGADAN_AGENT_INTENT')), Options.withFallbackPrompt(Prompt.text({
            message: 'Intent:',
            validate: (value) =>
                value.trim().length === 0
                    ? Effect.fail('Intent cannot be empty')
                    : Effect.succeed(value.trim()),
        }))),
        resume:    Options.choice('resume', ['auto', 'off'] as const).pipe(Options.withAlias('r'), Options.withDescription('Resume mode (auto/off)'), Options.withDefault('auto')),
        sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID'), Options.optional),
    },
    (input) =>
        _runInteractive({
            architectFallback: input.architectFallback, intent: input.intent, resume: input.resume,
            ...Option.match(input.architectModel,    { onNone: () => ({}), onSome: (architectModel) => ({ architectModel }) }),
            ...Option.match(input.architectProvider, { onNone: () => ({}), onSome: (architectProvider) => ({ architectProvider }) }),
            ...Option.match(input.sessionId,         { onNone: () => ({}), onSome: (sessionId) => ({ sessionId }) }),
        }),
).pipe(Command.withDescription('Run the interactive agent loop.'));
const _sessionsListCommand = Command.make(
    'list',
    {
        cursor: Options.text('cursor').pipe(Options.optional),
        limit:  Options.integer('limit').pipe(Options.withAlias('l'), Options.withDescription('Maximum results to return'), Options.withDefault(20)),
        status: Options.choice('status', ['running', 'completed', 'failed', 'interrupted'] as const).pipe(Options.repeated),
    },
    (input) =>
        _withAppTenant(Effect.gen(function* () {
            const persistence = yield* AgentPersistenceService;
            const result = yield* persistence.list({
                limit: input.limit,
                ...Option.match(input.cursor, { onNone: () => ({}), onSome: (cursor) => ({ cursor }) }),
                ...(input.status.length > 0 ? { status: input.status } : {}),
            });
            yield* Console.log(HelpDoc.toAnsiText(_summaryDoc('sessions list', [
                `total=${String(result.total)} hasNext=${String(result.hasNext)} hasPrev=${String(result.hasPrev)}`,
                ...result.items.map((item) => `${item.id} | ${item.status} | started=${item.startedAt.toISOString()} | toolCalls=${String(item.toolCallCount)}`),
            ])));
        })),
).pipe(Command.withDescription('List persisted sessions.'));
const _sessionsTraceCommand = Command.make(
    'trace',
    {
        limit:     Options.integer('limit').pipe(Options.withDefault(100)),
        sessionId: Options.text('session-id'),
    },
    (input) =>
        _withAppTenant(Effect.gen(function* () {
            const persistence = yield* AgentPersistenceService;
            const page = yield* persistence.trace(input.sessionId, { limit: input.limit });
            const rows = page.items.map((item) =>
                [
                    `#${String(item.sequence)}`,
                    item.operation,
                    item.success ? 'ok' : 'error',
                    `${String(item.durationMs)}ms`,
                    item.failureClass ?? '-',
                    item.workflowExecutionId ?? '-',
                ].join(' | '));
            yield* Console.log(HelpDoc.toAnsiText(_summaryDoc(`sessions trace ${input.sessionId}`, [
                `items=${String(page.items.length)} hasNext=${String(page.hasNext)} cursor=${page.cursor ?? 'null'}`,
                ...rows,
            ])));
        })),
).pipe(Command.withDescription('Show tool-call timeline for a session.'));
const _sessionsResumeCommand = Command.make(
    'resume',
    { sessionId: Options.text('session-id').pipe(Options.optional) },
    (input) =>
        _withAppTenant(Effect.gen(function* () {
            const appId = yield* HarnessConfig.appId;
            const persistence = yield* AgentPersistenceService;
            const sessionId = yield* Option.match(input.sessionId, {
                onNone: () =>
                    persistence.findResumable(appId).pipe(
                        Effect.flatMap(Option.match({
                            onNone: () => Effect.fail(new CliError({ message: 'No resumable session found.', reason: 'not_found' })),
                            onSome: Effect.succeed,
                        }))),
                onSome: Effect.succeed,
            });
            return yield* _runInteractive({
                resume: 'auto',
                sessionId,
            });
        })),
).pipe(Command.withDescription('Resume a session by id or latest resumable candidate.'));
const _sessionsExportCommand = Command.make(
    'export',
    {
        format:    Options.choice('format', ['ndjson', 'csv'] as const).pipe(Options.withAlias('f'), Options.withDescription('Export format (ndjson/csv)'), Options.withDefault('ndjson')),
        output:    Options.text('output').pipe(Options.withAlias('o'), Options.withDescription('Export output file path')),
        sessionId: Options.text('session-id').pipe(Options.withAlias('s'), Options.withDescription('Target session UUID')),
    },
    (input) =>
        _withAppTenant(Effect.gen(function* () {
            const persistence = yield* AgentPersistenceService;
            const fs = yield* FileSystem.FileSystem;
            const first = yield* persistence.trace(input.sessionId, { limit: 10_000 });
            const trace = yield* Effect.iterate(
                { cursor: first.cursor, hasNext: first.hasNext, items: first.items },
                {
                    body: (state) =>
                        persistence.trace(input.sessionId, {
                            limit: 10_000,
                            ...(state.cursor == null ? {} : { cursor: state.cursor }),
                        }).pipe(
                            Effect.map((page) => ({
                                cursor:  page.cursor,
                                hasNext: page.hasNext,
                                items: [...state.items, ...page.items],
                            })),
                        ),
                    while: (state) => state.hasNext && state.cursor !== null,
                },
            );
            const content = input.format === 'ndjson'
                ? `${trace.items.map((item) => JSON.stringify({
                    ...item,
                    result: Option.getOrUndefined(item.result),
                })).join('\n')}\n`
                : [
                    'sequence,createdAt,operation,status,durationMs,failureClass,workflowExecutionId,workflowCommandId,workflowApproved,params,result',
                    ...trace.items.map((item) => [
                        String(item.sequence),
                        item.createdAt.toISOString(),
                        item.operation,
                        item.success ? 'ok' : 'error',
                        String(item.durationMs),
                        item.failureClass ?? '',
                        item.workflowExecutionId ?? '',
                        item.workflowCommandId ?? '',
                        item.workflowApproved === undefined ? '' : String(item.workflowApproved),
                        _compact(item.params),
                        Option.match(item.result, { onNone: () => '', onSome: _compact }),
                    ].map(_csvEscape).join(',')),
                ].join('\n');
            yield* fs.writeFileString(input.output, content);
            yield* Console.log(HelpDoc.toAnsiText(_summaryDoc('sessions export', [
                `session=${input.sessionId}`,
                `format=${input.format}`,
                `output=${input.output}`,
                `rows=${String(trace.items.length)}`,
            ])));
        })),
).pipe(Command.withDescription('Export session trace projection as NDJSON or CSV.'));
const _sessionsCommand = Command.make('sessions', {}, () => Effect.void).pipe(
    Command.withSubcommands([
        _sessionsListCommand,   _sessionsTraceCommand,
        _sessionsResumeCommand, _sessionsExportCommand,
    ]),
    Command.withDescription('Session operator commands.'),
    Command.provide(HarnessConfig.persistenceLayer),
);
const _diagnosticsCheckCommand = Command.make(
    'check',
    {},
    () =>
        _withAppTenant(Effect.gen(function* () {
            const [appId, protocolVersion, sessionOverride, architectOverride, persistenceProbe, transport] = yield* Effect.all([
                HarnessConfig.appId,
                HarnessConfig.protocolVersion,
                HarnessConfig.resolveSessionOverride,
                HarnessConfig.resolveArchitectOverride,
                AgentPersistenceService.pipe(Effect.flatMap((service) => service.list({ limit: 1 }))),
                _transportPreconditions,
            ]);
            const _fmtOvr = (opt: typeof sessionOverride) => Option.match(opt, { onNone: () => 'none',
                onSome: (o) => `${o.language?.provider ?? 'unknown'}:${o.language?.model ?? 'unknown'}` });
            const summary = [`appId=${appId}`, `protocol=${String(protocolVersion.major)}.${String(protocolVersion.minor)}`,
                `dbReachable=true totalSessions=${String(persistenceProbe.total)}`,
                `languageOverride=${_fmtOvr(sessionOverride)}`, `architectOverride=${_fmtOvr(architectOverride)}`,
                `transport=${transport.status} (${transport.message})`];
            yield* Console.log(HelpDoc.toAnsiText(_summaryDoc('diagnostics check', summary)));
        })),
).pipe(Command.withDescription('Validate environment, DB connectivity, and transport preconditions.'));
const _diagnosticsCommand = Command.make('diagnostics', {}, () => Effect.void).pipe(
    Command.withSubcommands([_diagnosticsCheckCommand]),
    Command.withDescription('Diagnostics commands.'),
    Command.provide(HarnessConfig.persistenceLayer),
);
const _rootCommand = Command.make(_CliApp.name, {}, () => Console.log('Use --help to view commands.')).pipe(
    Command.withSubcommands([_runCommand, _sessionsCommand, _diagnosticsCommand]),
    Command.transformHandler((effect) =>
        effect.pipe(
            Effect.withSpan('kargadan.cli.command', {
                attributes: { command: _CliApp.name, },
            }),
            Effect.mapError(_toCliError),
        )),
);
const _program = _requireTTY.pipe(
    Effect.zipRight(Command.run(_CliApp)(_rootCommand)(process.argv)),
    Effect.provide(CliConfig.layer({ finalCheckBuiltIn: true })),
);
const _main = _program.pipe(
    Effect.catchAll((error) =>
        (error instanceof CliError
            ? Console.error(HelpDoc.toAnsiText(error.doc))
            : Effect.void
        ).pipe(Effect.zipRight(Effect.sync(() => { process.exitCode = 1; })))),
);

// --- [ENTRY] -----------------------------------------------------------------

NodeRuntime.runMain(_main.pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<void, never, never>);
