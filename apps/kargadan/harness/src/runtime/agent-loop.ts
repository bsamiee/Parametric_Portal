import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService } from '@parametric-portal/ai/service';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from '@effect/workflow';
import type { FileSystem } from '@effect/platform/FileSystem';
import type { Path } from '@effect/platform/Path';
import type { Terminal } from '@effect/platform/Terminal';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Context, Duration, Effect, Exit, Fiber, HashMap, HashSet, Match, Option, Ref, Schema as S } from 'effect';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { Envelope, FailureClass, NonNegInt, Operation, ResultStatus, WorkflowExecutionId } from '../protocol/schemas';

// --- [SCHEMA] ----------------------------------------------------------------

const _Loop = {
    compaction: S.Struct({ estimatedTokensAfter: NonNegInt, estimatedTokensBefore: NonNegInt, mode: S.Literal('history_reset'), sequence: NonNegInt, targetTokens: NonNegInt, triggerTokens: NonNegInt }),
    evidence:   S.Struct({ deterministicFailureClass: S.NullOr(FailureClass), deterministicStatus: ResultStatus, visualStatus: S.Literal('captured', 'capture_failed', 'capability_missing') }),
    scene:      S.Struct({ activeLayer: S.Struct({ index: S.Int, name: S.String }), activeView: S.String, layerCount: NonNegInt, objectCount: NonNegInt,
        objectCountsByType: S.Record({ key: S.String, value: NonNegInt }),
        tolerances:         S.Struct({ absoluteTolerance: S.Number, angleToleranceRadians: S.Number, unitSystem: S.String }),
        worldBoundingBox:   S.Struct({ max: S.Tuple(S.Number, S.Number, S.Number), min: S.Tuple(S.Number, S.Number, S.Number) }) }),
    searchResult:    S.Struct({ items: S.Array(S.Struct({ metadata: S.NullOr(S.Record({ key: S.String, value: S.Unknown })) })) }),
    state: S.Struct({ attempt: S.Int.pipe(S.greaterThanOrEqualTo(1)), correctionCycles: NonNegInt, identityBase: S.optional(S.Unknown),
        lastCompaction: S.optional(S.Unknown), operations: S.Array(Operation), recentObservation: S.optional(S.Unknown),
        sceneSummary:   S.optional(S.Unknown), sequence: NonNegInt, status: S.Literal('Planning', 'Completed', 'Failed'),
        verificationEvidence: S.optional(S.Unknown), workflowExecution: S.optional(S.Unknown) }),
    viewCapture:     S.Struct({ activeView: S.String, byteLength:     NonNegInt, dpi: S.Number, height: NonNegInt,
        imageBase64: S.String, mimeType:    S.String, realtimePasses: NonNegInt, transparentBackground: S.Boolean, width: NonNegInt }),
    vision:          S.Struct({ confidence: S.Number.pipe(S.between(0, 1)), hints: S.Array(S.String) }),
    workflowPayload: S.Struct({ command:    S.Unknown, sequence: NonNegInt, workflowExecutionId: WorkflowExecutionId }),
    workflowResult:  S.Struct({ approved:   S.Boolean, result:   S.Unknown, workflowExecutionId: WorkflowExecutionId }),
} as const;
type _LoopState = {
    readonly attempt:              number; readonly correctionCycles: number; readonly identityBase: Envelope.IdentityBase;
    readonly lastCompaction:       Option.Option<typeof _Loop.compaction.Type>; readonly operations: ReadonlyArray<string>;
    readonly recentObservation:    Option.Option<unknown>; readonly sceneSummary: Option.Option<unknown>;
    readonly sequence:             number; readonly status: 'Planning' | 'Completed' | 'Failed';
    readonly verificationEvidence: Option.Option<typeof _Loop.evidence.Type>;
    readonly workflowExecution:    Option.Option<{ readonly approved: boolean; readonly commandId: string; readonly executionId: string }> };

// --- [CONSTANTS] -------------------------------------------------------------

const _Aux = {
    objectMetadata: 'read.object.metadata', sceneSummary: 'read.scene.summary', scriptRun: 'script.run',
    undoScript:     '_Undo _Enter',         viewCapture:  'view.capture'
} as const;
const _ParamNorm = [
    ['detail',        (v: unknown) => Option.fromNullable(v).pipe(Option.filter((x): x is string => typeof x === 'string' && ['compact', 'standard', 'full'].includes(x)), Option.getOrElse(() => 'standard'))],
    ['includeHidden', (v: unknown) => Option.fromNullable(v).pipe(Option.filter(S.is(S.Boolean)), Option.getOrElse(() => false))],
    ['limit',         (v: unknown) => Option.fromNullable(v).pipe(Option.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)), Option.map((x) => Math.max(1, Math.min(200, Math.trunc(x)))), Option.getOrElse(() => 25))],
] as const satisfies ReadonlyArray<readonly [string, (v: unknown) => unknown]>;
const _FailureGuidance = {
    compensatable: 'Workflow compensation is available; inspect undo scope and rerun after validation.',
    correctable:   'Adjust parameters or scene constraints, then retry planning.',
    fatal:         'Stop execution and inspect transport/protocol assumptions before retry.',
    retryable:     'Retry operation with the same intent after transient conditions clear.'
} as const satisfies Record<Envelope.FailureClass, string>;
const _DefaultScene = {
    activeLayer:      { index: -1, name: '' }, activeView: '', layerCount: 0, objectCount: 0, objectCountsByType: {},
    tolerances:       { absoluteTolerance: 0, angleToleranceRadians: 0, unitSystem: '' },
    worldBoundingBox: { max: [0, 0, 0], min: [0, 0, 0] }
} as const satisfies typeof _Loop.scene.Type;
const _WorkflowPolicy = { approval_rejected: { code: 'WORKFLOW_APPROVAL_REJECTED', failureClass: 'correctable' as const, message: 'Write rejected by operator.' },
    decode_failed:    { code: 'WORKFLOW_RESULT_DECODE_FAILED', failureClass: 'retryable' as const,     message: 'Workflow result decode failed.' },
    execution_failed: { code: 'WORKFLOW_EXECUTION_FAILED',     failureClass: 'compensatable' as const, message: 'Workflow execution failed.' } } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _ou = <T>(o: Option.Option<T>) => Option.getOrUndefined(o);
const _wfExecId = (cmd: Envelope.Command, seq: number) => `${cmd.sessionId}:${String(seq).padStart(8, '0')}:${cmd.requestId}`;
const _decodeEnv = <T extends 'command' | 'result'>(tag: T) => (payload: unknown) =>
    S.decodeUnknown(Envelope)(payload).pipe(Effect.mapError((e) => `Failed to decode envelope: ${String(e)}`),
        Effect.filterOrFail((d): d is Extract<typeof Envelope.Type, { readonly _tag: T }> => d._tag === tag,
            (d) => `Expected envelope '${tag}' but received '${d._tag}'`));
const _maskDeep = (value: unknown, masked: ReadonlySet<string>, t: HarnessConfig['truncation'], depth = 0): unknown =>
    Match.value(value).pipe(
        Match.when(Match.string, (s: string) => s.length <= t.maxLength ? s : `${s.slice(0, t.maxLength)}...`),
        Match.when((x: unknown): x is ReadonlyArray<unknown> => Array.isArray(x),
            (a) => depth >= t.arrayDepth ? [`<truncated:${String(a.length)}>`] : a.slice(0, t.arrayItems).map((i) => _maskDeep(i, masked, t, depth + 1))),
        Match.when((x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object',
            (o) => depth >= t.objectDepth ? { _tag: 'truncated.object', keys: Object.keys(o).length }
                : Object.fromEntries(Object.entries(o).filter(([k]) => !masked.has(k)).slice(0, t.objectFields)
                    .map(([k, v]) => [k, _maskDeep(v, masked, t, depth + 1)]))),
        Match.orElse((x) => x));

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [ai, dispatch, persistence, cfg, wfEngine] = yield* Effect.all([AiService, CommandDispatch, AgentPersistenceService, HarnessConfig, WorkflowEngine.WorkflowEngine]);
        const eventSeqRef = yield* Ref.make<number>(cfg.initialSequence);
        const run = Effect.fn('AgentLoop.handle')((input: {
            readonly architectOverride: Option.Option<AiRegistry.SessionOverride>;
            readonly capabilities: ReadonlyArray<string>; readonly catalog: ReadonlyArray<Envelope.CatalogEntry>;
            readonly hooks?: {
                readonly onFailure?: (i: { readonly advice: string; readonly commandId: string; readonly failureClass: Envelope.FailureClass; readonly message: string }) => Effect.Effect<void>;
                readonly onStage?:   (i: { readonly attempt: number; readonly phase: 'start' | 'end'; readonly sequence: number; readonly stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist'; readonly status: _LoopState['status'] }) => Effect.Effect<void>;
                readonly onTool?:    (i: { readonly command: Envelope.Command; readonly durationMs: number; readonly phase: 'start' | 'end'; readonly result: Option.Option<Envelope.Result>; readonly source: 'direct' | 'workflow' | 'compensation' }) => Effect.Effect<void>;
                readonly onWriteApproval?: (i: { readonly command: Envelope.Command; readonly sequence: number; readonly workflowExecutionId: string }) => Effect.Effect<boolean, never, FileSystem | Path | Terminal>; };
            readonly identityBase: Envelope.IdentityBase; readonly intent: string;
            readonly resume: Option.Option<{ readonly chatJson: string; readonly sequence: number; readonly state: unknown }>;
        }) => Effect.gen(function* () {
            const h = { onFailure: input.hooks?.onFailure ?? (() => Effect.void), onStage: input.hooks?.onStage ?? (() => Effect.void),
                onTool: input.hooks?.onTool ?? (() => Effect.void), onWriteApproval: input.hooks?.onWriteApproval ?? (() => Effect.succeed(false)) } as const;
            const catalogByOp = HashMap.fromIterable(A.map(input.catalog, (e) => [e.id, e] as const));
            const negotiatedCaps = HashSet.fromIterable(input.capabilities);
            const filtered = A.filterMap(input.catalog, (e) => e.dispatch.mode === 'script' ? Option.none() : Option.some(e.id));
            const operations = filtered.length === 0 ? cfg.resolveLoopOperations : filtered;
            const chatRef = yield* Option.match(input.resume, {
                onNone: () => ai.model.chat(),
                onSome: (r) => ai.model.deserializeChat(r.chatJson).pipe(Effect.catchAll((e) =>
                    Telemetry.emit('kargadan.harness.resume.chat.decode.failed', { error: String(e) }).pipe(Effect.zipRight(ai.model.chat())))),
            }).pipe(Effect.flatMap(Ref.make));
            const _persist = (identity: Envelope.IdentityBase, loopState: unknown, call: {
                readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string;
                readonly params: Record<string, unknown>; readonly result: Option.Option<unknown>;
                readonly sequence: number; readonly status: 'ok' | 'error';
            }) => Ref.get(chatRef).pipe(Effect.flatMap((c) => ai.model.serializeChat(c)),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.chat.serialize.failed', { error: String(e) }).pipe(Effect.as(''))),
                Effect.flatMap((chatJson) => persistence.persistCall(identity, loopState, { ...call, chatJson })));
            const _dispatch = (command: Envelope.Command, source: 'direct' | 'workflow' | 'compensation' = 'direct') =>
                Effect.sync(() => performance.now()).pipe(Effect.tap(() => h.onTool({ command, durationMs: 0, phase: 'start', result: Option.none(), source })),
                    Effect.flatMap((t0) => dispatch.execute(command).pipe(Effect.catchTag('CommandDispatchError', (e) => Effect.succeed(dispatch.buildErrorResult(command, e.errorPayload))),
                        Effect.map((r) => r as Envelope.Result), Effect.exit, Effect.tap((exit) => h.onTool({ command, durationMs: Math.max(0, Math.round(performance.now() - t0)),
                            phase: 'end', result: Exit.match(exit, { onFailure: () => Option.none<Envelope.Result>(), onSuccess: Option.some }), source })), Effect.flatten)));
            const _aux = (state: _LoopState, commandId: string, args: Record<string, unknown>,
                opTag: string, objectRefs?: Envelope.Command['objectRefs']) =>
                _dispatch(dispatch.buildCommand(state.identityBase, commandId, args, {
                    attempt: state.attempt, deadlineMs: cfg.commandDeadlineMs, objectRefs, operationTag: opTag }));
            const _wf = Workflow.make({ annotations: Context.make(Workflow.SuspendOnFailure, true), error: S.String,idempotencyKey: (p: { readonly workflowExecutionId: string }) => p.workflowExecutionId,
                name: 'kargadan.write.execution',
                payload: _Loop.workflowPayload.fields, success: _Loop.workflowResult });
            yield* wfEngine.register(_wf, (payload) => Effect.gen(function* () {
                const command = yield* _decodeEnv('command')(payload.command).pipe(Effect.mapError((e) => `write_workflow.decode.command: ${e}`));
                const gate = DurableDeferred.make(`kargadan.write.approval.${payload.workflowExecutionId}`, { error: S.String, success: S.Boolean });
                const approved = yield* h.onWriteApproval({ command, sequence: payload.sequence, workflowExecutionId: payload.workflowExecutionId,
                }).pipe(Effect.flatMap((decision) => DurableDeferred.token(gate).pipe(
                    Effect.tap((token) => DurableDeferred.succeed(gate, { token, value: decision })), Effect.zipRight(DurableDeferred.await(gate)))));
                yield* approved ? Effect.void : Effect.fail(`APPROVAL_REJECTED:${payload.workflowExecutionId}`);
                const result = yield* Activity.make({ error: S.String,
                    execute: _dispatch(dispatch.buildCommand(command, command.commandId, command.args, {
                        attempt: (yield* Activity.CurrentAttempt), deadlineMs: command.deadlineMs,
                        idempotency: persistence.idempotency(command.correlationId, command.args, payload.sequence),
                        operationTag: `workflow.execute.${command.commandId}` }), 'workflow').pipe(
                        Effect.mapError((error) => `write_workflow.dispatch: ${String(error)}`),
                        Effect.flatMap((r) => r.status === 'ok' ? Effect.succeed(r) : Effect.fail(`write_workflow.result: ${r.error?.message ?? 'unknown'}`))),name: `kargadan.write.execution.${command.commandId}`, success: S.Unknown,
                }).pipe(Activity.retry({ times: 2 }), _wf.withCompensation((_v, cause) =>
                    _dispatch(dispatch.buildCommand({ appId: command.appId, correlationId: command.correlationId, sessionId: command.sessionId },
                        _Aux.scriptRun, { script: _Aux.undoScript }, { attempt: command.telemetryContext.attempt, deadlineMs: command.deadlineMs,
                            operationTag: `workflow.compensate.${command.commandId}` }), 'compensation').pipe(
                        Effect.tap((r) => Telemetry.emit('kargadan.workflow.compensation.executed', { cause: String(cause), commandId: command.commandId,
                            compensationStatus: r.status, workflowExecutionId: payload.workflowExecutionId })),
                        Effect.catchAll((e) => Telemetry.emit('kargadan.workflow.compensation.failed', { commandId: command.commandId,
                            error: String(e), workflowExecutionId: payload.workflowExecutionId })), Effect.asVoid)));
                return { approved, result, workflowExecutionId: payload.workflowExecutionId };
            }));
            const _execWrite = (cmd: Envelope.Command, seq: number) =>
                _wf.execute({ command: cmd, sequence: seq, workflowExecutionId: _wfExecId(cmd, seq) }).pipe(
                    Effect.flatMap((ws) => _decodeEnv('result')(ws.result).pipe(
                        Effect.map((result) => ({ approved: ws.approved, executionId: ws.workflowExecutionId, result })),
                        Effect.catchAll((e) => Effect.succeed({ approved: ws.approved, executionId: ws.workflowExecutionId,
                            result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.decode_failed, details: { error: String(e) } }) })))),
                    Effect.catchAll((e) => { const s = String(e); const wfId = _wfExecId(cmd, seq);
                        return Effect.succeed(s.startsWith('APPROVAL_REJECTED:')
                            ? { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.approval_rejected, details: { wfId } }) }
                            : { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.execution_failed, details: { error: s } }) }); }));
            const _probeScene = (state: _LoopState, opTag: string) => HashMap.get(catalogByOp, _Aux.sceneSummary).pipe(Option.match({
                onNone: () => Effect.succeed({ decoded: Option.none<typeof _Loop.scene.Type>(), probe: Option.none<Envelope.Result>() }),
                onSome: () => _aux(state, _Aux.sceneSummary, {}, opTag).pipe(Effect.flatMap((probe) =>
                    (probe.status === 'ok' ? S.decodeUnknown(_Loop.scene)(probe.result).pipe(Effect.option) : Effect.succeed(Option.none()))
                        .pipe(Effect.map((decoded) => ({ decoded, probe: Option.some(probe) }))))) }));
            const plan = (state: _LoopState) => Effect.gen(function* () {
                const maxTok = yield* ai.model.settings().pipe(Effect.map((s) => Math.max(1, s.language.maxTokens)), Effect.catchAll(() => Effect.succeed(8_192)));
                const trigger = Math.max(1, Math.floor((maxTok * cfg.compactionTriggerPercent) / 100));
                const target = Math.max(1, Math.floor((maxTok * Math.min(cfg.compactionTriggerPercent - 1, cfg.compactionTargetPercent)) / 100));
                const compaction = yield* Ref.get(chatRef).pipe(
                    Effect.flatMap((chat) => ai.model.serializeChat(chat).pipe(Effect.catchAll(() => Effect.succeed('')))),
                    Effect.flatMap((serialized) => ai.model.countTokens(serialized).pipe(Effect.option, Effect.flatMap(Option.match({
                        onNone: () => Telemetry.emit('kargadan.harness.compaction.tokens.unavailable.before').pipe(Effect.as(Option.none())),
                        onSome: (before) => before < trigger ? Effect.succeed(Option.none()) : Effect.gen(function* () {
                            const window = Math.max(target * 4, 1_200);
                            const seed = JSON.stringify({ compaction: { estimatedTokensBefore: before, targetTokens: target, triggerTokens: trigger },
                                context: { failureState: state.status === 'Failed' ? 'failed' : state.attempt > 1 ? 'retrying' : 'steady',
                                    goal: input.intent, latestSceneSummary: Option.getOrNull(state.sceneSummary),
                                    recentObservation: Option.getOrNull(state.recentObservation), sequence: state.sequence },
                                history: { olderTurnsSummarized: serialized.length > window, recentTurns: serialized.slice(Math.max(0, serialized.length - window)) },
                                kind: 'kargadan.context.compaction' });
                            const compact = yield* ai.model.chat({ prompt: seed });
                            const json = yield* ai.model.serializeChat(compact).pipe(Effect.catchAll(() => Effect.succeed(seed)));
                            const after = yield* ai.model.countTokens(json).pipe(Effect.option);
                            return yield* Option.match(after, {
                                onNone: () => Telemetry.emit('kargadan.harness.compaction.tokens.unavailable.after').pipe(Effect.as(Option.none())),
                                onSome: (n) => n <= target
                                    ? Ref.set(chatRef, compact).pipe(Effect.as(Option.some({ estimatedTokensAfter: n, estimatedTokensBefore: before,
                                        mode: 'history_reset' as const, sequence: state.sequence, targetTokens: target, triggerTokens: trigger } satisfies typeof _Loop.compaction.Type)))
                                    : Telemetry.emit('kargadan.harness.compaction.target_not_met', { estimatedTokensAfter: n, targetTokens: target }).pipe(Effect.as(Option.none())) });
                        }) })))));
                const sp = yield* _probeScene(state, 'plan.scene.summary');
                yield* Option.filter(sp.probe, (p) => p.status === 'error').pipe(Option.match({
                    onNone: () => Effect.void, onSome: (p) => Telemetry.emit('kargadan.harness.plan.scene.summary.failed', { error: p.error?.message ?? 'probe failed' }) }));
                const sceneSummary = Option.match(sp.decoded, { onNone: () => state.sceneSummary, onSome: (d) => Option.some(_maskDeep(d, cfg.maskedKeys, cfg.truncation)) });
                const ranked = yield* ai.searchQuery({ entityTypes: ['command'], includeSnippets: false, term: input.intent },
                    { limit: Math.max(1, Math.min(8, input.catalog.length)) }).pipe(Effect.flatMap((raw) => S.decodeUnknown(_Loop.searchResult)(raw)),
                    Effect.map((r) => A.dedupe(r.items.map((i) => i.metadata?.['id']).filter(S.is(S.NonEmptyTrimmedString)).filter((id) => HashMap.has(catalogByOp, id)))),
                    Effect.catchAll((e) => Telemetry.emit('kargadan.harness.plan.search.failed', { error: String(e) }).pipe(Effect.as([] as ReadonlyArray<string>))));
                const cIds = ranked.length === 0 ? state.operations : ranked;
                const candidates = A.filterMap(cIds, (id) => HashMap.get(catalogByOp, id));
                const fallbackId = yield* Option.match(A.head(cIds), {
                    onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })),
                    onSome: Effect.succeed });
                const prompt = JSON.stringify({ attempt: state.attempt, candidates: candidates.map((e) => ({ commandId: e.id, description: e.description,
                    params: e.params, requiresObjectRefs: e.requirements.requiresObjectRefs })), compaction: _ou(compaction), intent: input.intent,
                    recentObservation: _ou(state.recentObservation), sceneSummary: _ou(sceneSummary), sequence: state.sequence });
                const generation = Ref.get(chatRef).pipe(Effect.flatMap((chat) => chat.generateObject({ prompt,
                    schema: S.Struct({ args: S.Record({ key: S.String, value: S.Unknown }), commandId: S.NonEmptyTrimmedString }) })), Effect.map((r) => r.value));
                const planned = yield* Option.match(input.architectOverride, { onNone: () => generation,
                    onSome: (override) => Effect.locally(generation, AiRegistry.SessionOverrideRef, Option.some(override)),
                }).pipe(Effect.catchAll((e) => Telemetry.emit('kargadan.harness.plan.generate.failed', { error: String(e) }).pipe(
                    Effect.as({ args: {} as Record<string, unknown>, commandId: fallbackId }))));
                const entry = yield* HashMap.get(catalogByOp, planned.commandId).pipe(Option.match({
                    onNone: () => Effect.fail(new CommandDispatchError({ details: { commandId: planned.commandId, message: 'Operation missing from session catalog' }, reason: 'protocol' })),
                    onSome: Effect.succeed }));
                const paramSet = HashSet.fromIterable(A.map(entry.params, (p) => p.name));
                const args = Object.fromEntries([...Object.entries(planned.args),
                    ..._ParamNorm.filter(([name]) => HashSet.has(paramSet, name)).map(([name, norm]) => [name, norm(planned.args[name])])]);
                yield* Effect.filterOrFail(Effect.succeed(entry.params.filter((p) => p.required && !Object.hasOwn(args, p.name))), (m) => m.length === 0,
                    (m) => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Missing required: ${m.map((p) => p.name).join(', ')}` }, reason: 'protocol' }));
                const kind = Match.value(entry.dispatch.mode).pipe(Match.when('script', () => 'script' as const),
                    Match.orElse(() => entry.isDestructive ? 'write' as const : 'read' as const));
                const objectRefs = entry.requirements.requiresObjectRefs ? A.replicate(cfg.resolveWriteObjectRef, Math.max(1, entry.requirements.minimumObjectRefCount)) : undefined;
                yield* Effect.filterOrFail(Effect.succeed(objectRefs?.length ?? 0), (c) => c >= entry.requirements.minimumObjectRefCount,
                    () => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Requires ${String(entry.requirements.minimumObjectRefCount)}+ objectRefs` }, reason: 'protocol' }));
                const command = dispatch.buildCommand(state.identityBase, planned.commandId, args, { attempt: state.attempt, deadlineMs: cfg.commandDeadlineMs,
                    objectRefs, operationTag: `plan.execute.${planned.commandId}`,
                    ...(kind === 'write' ? { idempotency: persistence.idempotency(state.identityBase.correlationId, args, state.sequence), undoScope: 'kargadan.phase7' } : {}) });
                return { command, compaction, operationKind: kind, sceneSummary, startedAt: performance.now() } as const;
            });
            const execute = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>) =>
                Match.value(planned.operationKind).pipe(Match.when('write', () => _execWrite(planned.command, state.sequence).pipe(Effect.map((wf) => ({ command: planned.command,
                    result: wf.result, startedAt: planned.startedAt, workflow: Option.some({ approved: wf.approved, commandId: planned.command.commandId, executionId: wf.executionId }) })))),
                Match.orElse(() => _dispatch(planned.command).pipe(Effect.map((r) => ({ command: planned.command, result: r, startedAt: planned.startedAt, workflow: Option.none() })))));
            const verify = (state: _LoopState, _p: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>) => Effect.gen(function* () {
                const { decoded: sceneDecoded, probe: sceneProbe } = yield* _probeScene(state, 'verify.scene.summary');
                const objectProbe = yield* A.head(exec.command.objectRefs ?? []).pipe(
                    Option.filter(() => HashMap.has(catalogByOp, _Aux.objectMetadata)), Option.match({
                        onNone: () => Effect.succeed(Option.none<Envelope.Result>()),
                        onSome: (ref) => _aux(state, _Aux.objectMetadata, { detail: 'compact' }, 'verify.object.metadata', [ref]).pipe(Effect.map(Option.some)) }));
                const sig = { cmdErr: exec.result.status === 'error', objErr: Option.exists(objectProbe, (p) => p.status === 'error'),
                    sceneBad: Option.exists(sceneProbe, (p) => p.status === 'ok') && Option.isNone(sceneDecoded),
                    sceneErr: Option.exists(sceneProbe, (p) => p.status === 'error') };
                const fc: Option.Option<Envelope.FailureClass> = Match.value(sig).pipe(
                    Match.when({ cmdErr: true }, () => Option.some(exec.result.error?.failureClass ?? ('fatal' as Envelope.FailureClass))),
                    Match.whenOr({ sceneErr: true }, { objErr: true }, () => Option.some('retryable' as Envelope.FailureClass)),
                    Match.when({ sceneBad: true }, () => Option.some('correctable' as Envelope.FailureClass)), Match.orElse(() => Option.none()));
                yield* Option.match(fc, { onNone: () => Effect.void, onSome: (f) => h.onFailure({ advice: _FailureGuidance[f],
                    commandId: exec.command.commandId, failureClass: f, message: exec.result.error?.message ?? 'Verification detected non-success.' }) });
                const detStatus = Option.isSome(fc) ? 'error' as const : 'ok' as const;
                const visual = yield* (HashSet.has(negotiatedCaps, _Aux.viewCapture) ? _aux(state, _Aux.viewCapture, cfg.viewCapture, 'verify.view.capture').pipe(
                    Effect.filterOrFail((r): r is Envelope.Result & { readonly result: unknown } => r.status === 'ok' && r.result != null,
                        (r) => r.status === 'ok' ? 'Capture payload missing.' : (r.error?.message ?? 'Capture failed.')),
                    Effect.flatMap((r) => S.decodeUnknown(_Loop.viewCapture)(r.result)),
                    Effect.flatMap((cap) => { const sm = { ...cap, imageBase64: undefined, preview: `${cap.imageBase64.slice(0, 64)}...` };
                        return ai.model.generateObject({ prompt: [{ content: 'Assess the attached Rhino viewport capture and return concise visual verification hints.', role: 'system' }, { content: [{ text: JSON.stringify({ deterministicStatus: detStatus, metadata: { activeView: cap.activeView, byteLength: cap.byteLength, dpi: cap.dpi, height: cap.height, width: cap.width } }), type: 'text' }, { data: `data:${cap.mimeType};base64,${cap.imageBase64}`, fileName: `${cap.activeView}.png`, mediaType: cap.mimeType, type: 'file' }], role: 'user' }],
                            schema: _Loop.vision }).pipe(Effect.map((v) => ({ status: 'captured' as const, summary: sm, vision: v.value })),
                            Effect.catchAll(() => Effect.succeed({ status: 'captured' as const, summary: sm, vision: undefined }))); }),
                    Effect.catchAll((reason) => Effect.succeed({ reason: String(reason), status: 'capture_failed' as const })))
                    : Effect.succeed({ status: 'capability_missing' as const }));
                const obs = Option.fromNullable(exec.result.result).pipe(Option.map((v) => _maskDeep(v, cfg.maskedKeys, cfg.truncation)));
                const evidence: typeof _Loop.evidence.Type = { deterministicFailureClass: Option.getOrNull(fc), deterministicStatus: detStatus, visualStatus: visual.status };
                return { command: exec.command, evidence, failureClass: fc, observation: obs, operation: detStatus === 'ok' ? 'command.completed' : 'command.failed',
                    params: { commandId: exec.command.commandId, dedupe: exec.result.dedupe, deterministicStatus: detStatus, observationCaptured: Option.isSome(obs),
                        status: exec.result.status, visualStatus: visual.status, workflow: _ou(exec.workflow) },
                    result: Option.some({ dedupe: exec.result.dedupe, deterministic: { objectMetadataProbe: _ou(objectProbe), sceneSummary: _ou(sceneDecoded),
                        sceneSummaryProbe: _ou(sceneProbe), status: detStatus }, observation: _ou(obs), status: detStatus, verified: detStatus === 'ok', visual,
                        workflow: _ou(exec.workflow) }), startedAt: exec.startedAt, status: detStatus } as const;
            });
            const decide = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>, vf: Effect.Effect.Success<ReturnType<typeof verify>>) => {
                const fault: Envelope.FailureClass = Option.getOrElse(vf.failureClass, () => 'fatal' as const);
                const next = Match.value({ fault, ok: vf.status === 'ok' }).pipe(Match.when({ ok: true }, () => 'Completed' as const),
                    Match.when({ fault: 'correctable' }, () => state.correctionCycles < cfg.correctionCycles ? 'Planning' as const : 'Failed' as const),
                    Match.when({ fault: 'retryable' }, () => state.attempt < cfg.retryMaxAttempts ? 'Planning' as const : 'Failed' as const), Match.orElse(() => 'Failed' as const));
                const ns: _LoopState = { ...state, attempt: next === 'Planning' ? state.attempt + 1 : state.attempt, correctionCycles: next === 'Planning' && fault === 'correctable' ? state.correctionCycles + 1 : state.correctionCycles,
                    lastCompaction: Option.orElse(planned.compaction, () => state.lastCompaction), recentObservation: vf.observation.pipe(Option.orElse(() => state.recentObservation)),
                    sceneSummary: Option.orElse(planned.sceneSummary, () => state.sceneSummary), sequence: state.sequence + 1, status: next, verificationEvidence: Option.some(vf.evidence),
                    workflowExecution: Option.orElse(exec.workflow, () => state.workflowExecution) };
                return Match.value(fault).pipe(Match.when('compensatable', () => Telemetry.emit('kargadan.compensation.required', { commandId: vf.command.commandId })),
                    Match.when('fatal', () => Effect.logError('kargadan.fatal').pipe(Effect.annotateLogs({ commandId: vf.command.commandId, failureClass: fault }))),
                    Match.orElse(() => Effect.void)).pipe(Effect.as(ns));
            };
            const persistPhase = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>, exec: Effect.Effect.Success<ReturnType<typeof execute>>,
                vf: Effect.Effect.Success<ReturnType<typeof verify>>, decision: _LoopState) => _persist(state.identityBase, { attempt: decision.attempt, correctionCycles: decision.correctionCycles,
                    lastCompaction: _ou(decision.lastCompaction), operations: decision.operations, recentObservation: _ou(decision.recentObservation),
                    sceneSummary: _ou(decision.sceneSummary), sequence: decision.sequence, status: decision.status,
                    verificationEvidence: _ou(decision.verificationEvidence), workflowExecution: _ou(decision.workflowExecution) }, {
                    durationMs: Math.max(0, Math.round(performance.now() - vf.startedAt)),
                    error: vf.status === 'ok' ? Option.none() : Option.some(exec.result.error?.message ?? 'Result error payload missing'),
                    operation: vf.operation, params: { ...vf.params, compaction: _ou(planned.compaction), sceneSummary: _ou(decision.sceneSummary),
                        verificationEvidence: _ou(decision.verificationEvidence), workflowExecution: _ou(decision.workflowExecution) },
                    result: vf.result, sequence: decision.sequence, status: vf.status }).pipe(Effect.asVoid);
            const baseline: _LoopState = { attempt: 1, correctionCycles: 0, identityBase: input.identityBase, lastCompaction: Option.none(),
                operations, recentObservation: Option.none(), sceneSummary: Option.some(_DefaultScene), sequence: 0, status: 'Planning',
                verificationEvidence: Option.none(), workflowExecution: Option.none() };
            const initialState: _LoopState = yield* Option.match(input.resume, { onNone: () => Effect.succeed(baseline),
                onSome: (r) => S.decodeUnknown(_Loop.state)(r.state).pipe(Effect.map((s): _LoopState => ({ ...s, identityBase: input.identityBase,
                    lastCompaction: Option.fromNullable(s.lastCompaction).pipe(Option.filter(S.is(_Loop.compaction))),
                    operations: s.operations.length === 0 ? operations : s.operations, recentObservation: Option.fromNullable(s.recentObservation),
                    sceneSummary: Option.fromNullable(s.sceneSummary).pipe(Option.filter(S.is(_Loop.scene)), Option.orElse(() => Option.some(_DefaultScene))),
                    sequence: Math.max(s.sequence, r.sequence), verificationEvidence: Option.fromNullable(s.verificationEvidence).pipe(Option.filter(S.is(_Loop.evidence))),
                    workflowExecution: Option.fromNullable(s.workflowExecution).pipe(
                        Option.filter(S.is(S.Struct({ approved: S.Boolean, commandId: S.NonEmptyTrimmedString, executionId: S.NonEmptyTrimmedString })))) })),
                Effect.tap((s) => Effect.log('kargadan.harness.resume.restored').pipe(Effect.annotateLogs({ operations: s.operations.length, sequence: s.sequence, status: s.status }))),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.resume.decode.failed', { error: String(e) }).pipe(Effect.as({ ...baseline, sequence: r.sequence })))) });
            yield* Ref.set(eventSeqRef, Math.max(cfg.initialSequence, initialState.sequence + 1));
            const fibers = yield* Effect.all([Effect.fork(dispatch.takeEvent().pipe(
                Effect.flatMap((evt) => Effect.sync(() => performance.now()).pipe(Effect.flatMap((t0) => Ref.modify(eventSeqRef, (c) => [c, c + 1] as const).pipe(
                    Effect.tap((seq) => _persist(evt, { eventType: evt.eventType, sequence: seq }, { durationMs: Math.max(0, Math.round(performance.now() - t0)),
                        error: Option.none(), operation: `transport.event.${evt.eventType}`, params: { causationRequestId: evt.causationRequestId, delta: evt.delta,
                            eventType: evt.eventType, sourceRevision: evt.sourceRevision, ...(evt.eventType === 'stream.compacted' ? { batchSummary: evt.delta } : {}) },
                        result: Option.some({ eventId: evt.eventId }), sequence: seq, status: 'ok' })))))),
                Effect.tap(() => Effect.logDebug('kargadan.harness.transport.event')),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.transport.event.failed', { error: String(e) })), Effect.forever)),
            Effect.fork(dispatch.heartbeat(input.identityBase).pipe(Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.heartbeat.failed', { error: String(e) })),
                Effect.zipRight(Effect.sleep(Duration.millis(cfg.heartbeatIntervalMs))), Effect.forever)) ]);
            const _stage = <A, E, R>(s: _LoopState, stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist', fx: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
                h.onStage({ attempt: s.attempt, phase: 'start', sequence: s.sequence, stage, status: s.status }).pipe(Effect.zipRight(Effect.exit(fx)),
                    Effect.tap((exit) => h.onStage({ attempt: s.attempt, phase: 'end', sequence: s.sequence, stage,
                        status: Exit.match(exit, { onFailure: () => 'Failed' as const, onSuccess: (v) => stage === 'decide' ? (v as _LoopState).status : s.status }) })),
                    Effect.flatten);
            // why: 1:1 mapping to AiService.runAgentCore — all 14 type params resolve
            const finalState = yield* ai.runAgentCore({
                decide:  (s, p: Parameters<typeof decide>[1], e: Parameters<typeof decide>[2], v: Parameters<typeof decide>[3]) => _stage(s, 'decide', decide(s, p, e, v)),
                execute: (s, p: Parameters<typeof execute>[1]) => _stage(s, 'execute', execute(s, p)),initialState, isTerminal: (s) => s.status !== 'Planning',
                persist: (s, p: Parameters<typeof persistPhase>[1], e: Parameters<typeof persistPhase>[2], v: Parameters<typeof persistPhase>[3], d: Parameters<typeof persistPhase>[4]) => _stage(s, 'persist', persistPhase(s, p, e, v, d)),
                plan: (s) => _stage(s, 'plan', plan(s)), verify: (s, p: Parameters<typeof verify>[1], e: Parameters<typeof verify>[2]) => _stage(s, 'verify', verify(s, p, e)),
            }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
            return { state: finalState, trace: yield* persistence.trace(finalState.identityBase.sessionId) } as const;
        }));
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
