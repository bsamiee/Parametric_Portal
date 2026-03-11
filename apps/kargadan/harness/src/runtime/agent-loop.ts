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
import { Envelope, Loop } from '../protocol/schemas';
import type { LoopState } from '../protocol/schemas';

// --- [CONSTANTS] -------------------------------------------------------------

const _Aux = {
    objectMetadata: 'read.object.metadata', sceneSummary: 'read.scene.summary', scriptRun: 'script.run',
    undoScript:     '_Undo _Enter',         viewCapture:  'view.capture',
} as const;
const _OpTag = {
    compensate:       (commandId: string) => `workflow.compensate.${commandId}` as const,
    planExecute:      (commandId: string) => `plan.execute.${commandId}` as const,
    planScene:        'plan.scene.summary',
    transportEvent:   (eventType: string) => `transport.event.${eventType}` as const,
    verifyCapture:    'verify.view.capture',
    verifyMetadata:   'verify.object.metadata',
    verifyScene:      'verify.scene.summary',
    workflowExecute:  (commandId: string) => `workflow.execute.${commandId}` as const,
} as const;
const _Limits = { maxCandidates: 8, truncationLength: 280 } as const;
const _ParamNormSchema = S.transform(
    S.Struct({
        detail:        S.optional(S.Union(S.Literal('compact', 'standard', 'full'), S.Undefined)),
        includeHidden: S.optional(S.Union(S.Boolean, S.Undefined)),
        limit:         S.optional(S.Union(S.Number.pipe(S.finite()), S.Undefined)),
    }),
    S.Struct({ detail: S.Literal('compact', 'standard', 'full'), includeHidden: S.Boolean, limit: S.Int }),
    { decode: ({ detail, includeHidden, limit }) => ({
        detail:        detail ?? 'standard' as const,
        includeHidden: includeHidden ?? false,
        limit:         Math.max(1, Math.min(200, Math.trunc(limit ?? 25))),
    }), encode: ({ detail, includeHidden, limit }) => ({ detail, includeHidden, limit }) },
);
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
} as const satisfies typeof Loop.scene.Type;
const _ApprovalRejected = S.parseJson(S.Struct({ _tag: S.Literal('APPROVAL_REJECTED'), workflowExecutionId: S.String }));
const _WorkflowPolicy = {
    approval_rejected: { code: 'WORKFLOW_APPROVAL_REJECTED',    failureClass: 'correctable' as const,   message: 'Write rejected by operator.'    },
    decode_failed:     { code: 'WORKFLOW_RESULT_DECODE_FAILED', failureClass: 'retryable' as const,     message: 'Workflow result decode failed.' },
    execution_failed:  { code: 'WORKFLOW_EXECUTION_FAILED',     failureClass: 'compensatable' as const, message: 'Workflow execution failed.'     } } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

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
        const [ai, dispatch, persistence, config, wfEngine] = yield* Effect.all([AiService, CommandDispatch, AgentPersistenceService, HarnessConfig, WorkflowEngine.WorkflowEngine]);
        const eventSeqRef = yield* Ref.make<number>(config.initialSequence);
        const _persist = (chatRef: Ref.Ref<Parameters<typeof ai.model.serializeChat>[0]>, identity: Envelope.IdentityBase, loopState: unknown, call: {
            readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string;
            readonly params:     Record<string, unknown>; readonly result: Option.Option<unknown>;
            readonly sequence:   number; readonly status: 'ok' | 'error';
        }) => Ref.get(chatRef).pipe(Effect.flatMap(ai.model.serializeChat),
            Effect.catchAll((e) => Telemetry.emit('kargadan.harness.chat.serialize.failed', { error: String(e) }).pipe(Effect.as(''))),
            Effect.flatMap((chatJson) => persistence.persistCall(identity, loopState, { ...call, chatJson })));
        const run = Effect.fn('AgentLoop.handle')((input: {
            readonly architectOverride: Option.Option<AiRegistry.SessionOverride>;
            readonly capabilities: ReadonlyArray<string>; readonly catalog: ReadonlyArray<Envelope.CatalogEntry>;
            readonly hooks?: {
                readonly onFailure?: (i: { readonly advice:  string; readonly commandId: string; readonly failureClass: Envelope.FailureClass; readonly message: string }) => Effect.Effect<void>;
                readonly onStage?:   (i: { readonly attempt: number; readonly phase: 'start' | 'end'; readonly sequence: number; readonly stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist'; readonly status: LoopState['status'] }) => Effect.Effect<void>;
                readonly onTool?:    (i: { readonly command: Envelope.Command; readonly durationMs: number; readonly phase: 'start' | 'end'; readonly result: Option.Option<Envelope.Result>; readonly source: 'direct' | 'workflow' | 'compensation' }) => Effect.Effect<void>;
                readonly onWriteApproval?: (i: { readonly command: Envelope.Command; readonly sequence: number; readonly workflowExecutionId: string }) => Effect.Effect<boolean, never, FileSystem | Path | Terminal>; };
            readonly identityBase: Envelope.IdentityBase; readonly intent: string;
            readonly resume: Option.Option<{ readonly chatJson: string; readonly sequence: number; readonly state: unknown }>;
        }) => Effect.gen(function* () {
            const hooks = { onFailure: input.hooks?.onFailure ?? (() => Effect.void), onStage: input.hooks?.onStage ?? (() => Effect.void),
                onTool: input.hooks?.onTool ?? (() => Effect.void), onWriteApproval: input.hooks?.onWriteApproval ?? (() => Effect.succeed(false)) } as const;
            const catalogByOp = HashMap.fromIterable(A.map(input.catalog, (e) => [e.id, e] as const));
            const negotiatedCaps = HashSet.fromIterable(input.capabilities);
            // why: script-mode entries participate in planning — templates provide structured invocation
            const filtered = A.map(input.catalog, (e) => e.id);
            const operations = filtered.length === 0 ? config.resolveLoopOperations : filtered;
            const chatRef = yield* Option.match(input.resume, {
                onNone: ()  => ai.model.chat(),
                onSome: (r) => ai.model.deserializeChat(r.chatJson),
            }).pipe(Effect.catchAll((e) => Telemetry.emit('kargadan.harness.resume.chat.decode.failed', { error: String(e) }).pipe(Effect.zipRight(ai.model.chat()))),
                Effect.flatMap(Ref.make));
            const _dispatch = (command: Envelope.Command, source: 'direct' | 'workflow' | 'compensation' = 'direct') =>
                Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
                    Effect.tap(() => hooks.onTool({ command, durationMs: 0, phase: 'start', result: Option.none(), source })),
                    Effect.flatMap((t0) => dispatch.execute(command).pipe(Effect.catchTag('CommandDispatchError', (e) => Effect.succeed(dispatch.buildErrorResult(command, e.errorPayload))),
                        Effect.map((r) => r as Envelope.Result), Effect.exit,
                        Effect.tap((exit) => Effect.clockWith((c) => c.currentTimeMillis).pipe(Effect.flatMap((t1) => hooks.onTool({ command, durationMs: Math.max(0, Number(t1 - t0)),
                            phase: 'end', result: Exit.match(exit, { onFailure: () => Option.none<Envelope.Result>(), onSuccess: Option.some }), source })))),
                        Effect.flatten)));
            const _aux = (state: LoopState, commandId: string, args: Record<string, unknown>,
                operationTag: string, objectRefs?: Envelope.Command['objectRefs']) =>
                _dispatch(dispatch.buildCommand(state.identityBase, commandId, args, { attempt: state.attempt, deadlineMs: config.commandDeadlineMs, objectRefs, operationTag }));
            const _wf = Workflow.make({ annotations: Context.make(Workflow.SuspendOnFailure, true), error: S.String,idempotencyKey: (p: { readonly workflowExecutionId: string }) => p.workflowExecutionId,
                name: 'kargadan.write.execution',
                payload: Loop.workflowPayload.fields, success: Loop.workflowResult });
            yield* wfEngine.register(_wf, (payload) => Effect.gen(function* () {
                const command = yield* _decodeEnv('command')(payload.command).pipe(Effect.mapError((e) => `write_workflow.decode.command: ${e}`));
                const gate = DurableDeferred.make(`kargadan.write.approval.${payload.workflowExecutionId}`, { error: S.String, success: S.Boolean });
                const approved = yield* hooks.onWriteApproval({ command, sequence: payload.sequence, workflowExecutionId: payload.workflowExecutionId,
                }).pipe(Effect.flatMap((decision) => DurableDeferred.token(gate).pipe(
                    Effect.tap((token) => DurableDeferred.succeed(gate, { token, value: decision })), Effect.zipRight(DurableDeferred.await(gate)))));
                yield* approved ? Effect.void : Effect.fail(JSON.stringify({ _tag: 'APPROVAL_REJECTED', workflowExecutionId: payload.workflowExecutionId }));
                const result = yield* Activity.make({ error: S.String,
                    execute: _dispatch(dispatch.buildCommand(command, command.commandId, command.args, {
                        attempt: (yield* Activity.CurrentAttempt), deadlineMs: command.deadlineMs,
                        idempotency: persistence.idempotency(command.correlationId, command.args, payload.sequence),
                        operationTag: _OpTag.workflowExecute(command.commandId) }), 'workflow').pipe(
                        Effect.mapError((error) => `write_workflow.dispatch: ${String(error)}`),
                        Effect.flatMap((r) => r.status === 'ok' ? Effect.succeed(r) : Effect.fail(`write_workflow.result: ${r.error?.message ?? 'unknown'}`))),name: `kargadan.write.execution.${command.commandId}`, success: S.Unknown,
                }).pipe(Activity.retry({ times: 2 }), _wf.withCompensation((_v, cause) =>
                    _dispatch(dispatch.buildCommand({ appId: command.appId, correlationId: command.correlationId, sessionId: command.sessionId },
                        _Aux.scriptRun, { script: _Aux.undoScript }, { attempt: command.telemetryContext.attempt, deadlineMs: command.deadlineMs,
                            operationTag: _OpTag.compensate(command.commandId) }), 'compensation').pipe(
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
                        const rejected = S.decodeUnknownOption(_ApprovalRejected)(s).pipe(Option.isSome);
                        return Effect.succeed(rejected
                            ? { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.approval_rejected, details: { wfId } }) }
                            : { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.execution_failed,  details: { error: s } }) }); }));
            const _probeScene = (state: LoopState, operationTag: string) => HashMap.get(catalogByOp, _Aux.sceneSummary).pipe(Option.match({
                onNone: () => Effect.succeed({ decoded: Option.none<typeof Loop.scene.Type>(), probe: Option.none<Envelope.Result>() }),
                onSome: () => _aux(state, _Aux.sceneSummary, {}, operationTag).pipe(Effect.flatMap((probe) =>
                    (probe.status === 'ok' ? S.decodeUnknown(Loop.scene)(probe.result).pipe(Effect.option) : Effect.succeed(Option.none()))
                        .pipe(Effect.map((decoded) => ({ decoded, probe: Option.some(probe) }))))) }));
            const plan = (state: LoopState) => Effect.gen(function* () {
                const maxTok = yield* ai.model.settings().pipe(Effect.map((s) => Math.max(1, s.language.maxTokens)), Effect.catchAll(() => Effect.succeed(8_192)));
                const trigger = Math.max(1, Math.floor((maxTok * config.compactionTriggerPercent) / 100));
                const target = Math.max(1, Math.floor((maxTok * Math.min(config.compactionTriggerPercent - 1, config.compactionTargetPercent)) / 100));
                const _buildPrompt = ({ before, serialized }: { readonly before: number; readonly serialized: string }) => {
                    const window = Math.max(target * 4, 1_200);
                    return JSON.stringify({ compaction: { estimatedTokensBefore: before, targetTokens: target, triggerTokens: trigger },
                        context: { failureState: state.status === 'Failed' ? 'failed' : state.attempt > 1 ? 'retrying' : 'steady',
                            goal: input.intent, latestSceneSummary: Option.getOrNull(state.sceneSummary),
                            recentObservation: Option.getOrNull(state.recentObservation), sequence: state.sequence },
                        history: { olderTurnsSummarized: serialized.length > window, recentTurns: serialized.slice(Math.max(0, serialized.length - window)) },
                        kind: 'kargadan.context.compaction' }); };
                const compaction = yield* Ref.get(chatRef).pipe(
                    Effect.flatMap((currentChat) => ai.model.compactChat(currentChat, { buildPrompt: _buildPrompt, target, trigger })),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.succeed(Option.none<typeof Loop.compaction.Type>()),
                        onSome: (r) => Ref.set(chatRef, r.compacted).pipe(Effect.as(Option.some({ estimatedTokensAfter: r.after, estimatedTokensBefore: r.before,
                            mode: 'history_reset' as const, sequence: state.sequence, targetTokens: target, triggerTokens: trigger } satisfies typeof Loop.compaction.Type))) })));
                const sceneProbe = yield* _probeScene(state, _OpTag.planScene);
                yield* Option.filter(sceneProbe.probe, (p) => p.status === 'error').pipe(Option.match({
                    onNone: () => Effect.void, onSome: (p) => Telemetry.emit('kargadan.harness.plan.scene.summary.failed', { error: p.error?.message ?? 'probe failed' }) }));
                const sceneSummary = Option.match(sceneProbe.decoded, { onNone: () => state.sceneSummary, onSome: (d) => Option.some(_maskDeep(d, config.maskedKeys, config.truncation)) });
                const { candidates, fallbackId } = yield* ai.searchQuery({ entityTypes: ['command'], includeSnippets: false, term: input.intent },
                    { limit: Math.max(1, Math.min(_Limits.maxCandidates, input.catalog.length)) }).pipe(Effect.flatMap((raw) => S.decodeUnknown(Loop.searchResult)(raw)),
                    Effect.map((r) => A.dedupe(r.items.map((i) => i.metadata?.['id']).filter(S.is(S.NonEmptyTrimmedString)).filter((id) => HashMap.has(catalogByOp, id)))),
                    Effect.catchAll((e) => Telemetry.emit('kargadan.harness.plan.search.failed', { error: String(e) }).pipe(Effect.as([] as ReadonlyArray<string>))),
                    Effect.map((ranked) => ranked.length === 0 ? state.operations : ranked),
                    Effect.flatMap((ids) => Option.match(A.head(ids), {
                        onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })),
                        onSome: (fId) => Effect.succeed({ candidates: A.filterMap(ids, (id) => HashMap.get(catalogByOp, id)), fallbackId: fId }) })));
                const prompt = JSON.stringify({ attempt: state.attempt, candidates: candidates.map((e) => ({ commandId: e.id, description: e.description,
                    params: e.params, requiresObjectRefs: e.requirements.requiresObjectRefs })), compaction: Option.getOrUndefined(compaction), intent: input.intent,
                    recentObservation: Option.getOrUndefined(state.recentObservation), sceneSummary: Option.getOrUndefined(sceneSummary), sequence: state.sequence });
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
                const _normKeys = ['detail', 'includeHidden', 'limit'] as const;
                const normFields = Object.fromEntries(_normKeys
                    .filter((name) => HashSet.has(paramSet, name)).map((name) => [name, planned.args[name]]));
                const normalized = yield* S.decodeUnknown(_ParamNormSchema)(normFields);
                const args = { ...planned.args, ...normalized };
                yield* Effect.filterOrFail(Effect.succeed(entry.params.filter((p) => p.required && !Object.hasOwn(args, p.name))), (m) => m.length === 0,
                    (m) => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Missing required: ${m.map((p) => p.name).join(', ')}` }, reason: 'protocol' }));
                const kind = Match.value(entry.dispatch.mode).pipe(Match.when('script', () => 'script' as const),
                    Match.orElse(() => entry.isDestructive ? 'write' as const : 'read' as const));
                const objectRefs = entry.requirements.requiresObjectRefs ? A.replicate(config.resolveWriteObjectRef, Math.max(1, entry.requirements.minimumObjectRefCount)) : undefined;
                yield* Effect.filterOrFail(Effect.succeed(objectRefs?.length ?? 0), (c) => c >= entry.requirements.minimumObjectRefCount,
                    () => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Requires ${String(entry.requirements.minimumObjectRefCount)}+ objectRefs` }, reason: 'protocol' }));
                const command = dispatch.buildCommand(state.identityBase, planned.commandId, args, { attempt: state.attempt, deadlineMs: config.commandDeadlineMs,
                    objectRefs, operationTag: _OpTag.planExecute(planned.commandId),
                    ...(kind === 'write' ? { idempotency: persistence.idempotency(state.identityBase.correlationId, args, state.sequence), undoScope: 'kargadan.phase7' } : {}) });
                const startedAt = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
                return { command, compaction, operationKind: kind, sceneSummary, startedAt } as const;
            });
            const execute = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>) =>
                Match.value(planned.operationKind).pipe(Match.when('write', () => _execWrite(planned.command, state.sequence).pipe(Effect.map((wf) => ({ command: planned.command,
                    result: wf.result, startedAt: planned.startedAt, workflow: Option.some({ approved: wf.approved, commandId: planned.command.commandId, executionId: wf.executionId }) })))),
                Match.orElse(() => _dispatch(planned.command).pipe(Effect.map((r) => ({ command: planned.command, result: r, startedAt: planned.startedAt, workflow: Option.none() })))));
            const verify = (state: LoopState, _p: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>) => Effect.gen(function* () {
                const { decoded: sceneDecoded, probe: sceneProbe } = yield* _probeScene(state, _OpTag.verifyScene);
                const objectProbe = yield* A.head(exec.command.objectRefs ?? []).pipe(
                    Option.filter(() => HashMap.has(catalogByOp, _Aux.objectMetadata)), Option.match({
                        onNone: () => Effect.succeed(Option.none<Envelope.Result>()),
                        onSome: (ref) => _aux(state, _Aux.objectMetadata, { detail: 'compact' }, _OpTag.verifyMetadata, [ref]).pipe(Effect.map(Option.some)) }));
                const sig = { cmdErr: exec.result.status === 'error', objErr: Option.exists(objectProbe, (p) => p.status === 'error'),
                    sceneBad: Option.exists(sceneProbe, (p) => p.status === 'ok') && Option.isNone(sceneDecoded),
                    sceneErr: Option.exists(sceneProbe, (p) => p.status === 'error') };
                const failureClassification: Option.Option<Envelope.FailureClass> = Match.value(sig).pipe(
                    Match.when  ({ cmdErr:   true }, () => Option.some(exec.result.error?.failureClass ?? ('fatal' as Envelope.FailureClass))),
                    Match.whenOr({ sceneErr: true }, { objErr: true }, () => Option.some('retryable' as Envelope.FailureClass)),
                    Match.when  ({ sceneBad: true }, () => Option.some('correctable' as Envelope.FailureClass)), Match.orElse(() => Option.none()));
                yield* Option.match(failureClassification, { onNone: () => Effect.void, onSome: (f) => hooks.onFailure({ advice: _FailureGuidance[f],
                    commandId: exec.command.commandId, failureClass: f, message: exec.result.error?.message ?? 'Verification detected non-success.' }) });
                const detStatus = Option.isSome(failureClassification) ? 'error' as const : 'ok' as const;
                const visual = yield* (HashSet.has(negotiatedCaps, _Aux.viewCapture) ? _aux(state, _Aux.viewCapture, config.viewCapture, _OpTag.verifyCapture).pipe(
                    Effect.filterOrFail((r): r is Envelope.Result & { readonly result: unknown } => r.status === 'ok' && r.result != null,
                        (r) => r.status === 'ok' ? 'Capture payload missing.' : (r.error?.message ?? 'Capture failed.')),
                    Effect.flatMap((r) => S.decodeUnknown(Loop.viewCapture)(r.result)),
                    Effect.map((cap) => ({ cap, summary: { ...cap, imageBase64: undefined, preview: `${cap.imageBase64.slice(0, 64)}...` } })),
                    Effect.flatMap(({ cap, summary }) => ai.model.generateObject({ prompt: [
                        { content: 'Assess the attached Rhino viewport capture and return concise visual verification hints.', role: 'system' },
                        { content: [{ text: JSON.stringify({ deterministicStatus: detStatus, metadata: { activeView: cap.activeView, byteLength: cap.byteLength, dpi: cap.dpi, height: cap.height, width: cap.width } }), type: 'text' },
                            { data: `data:${cap.mimeType};base64,${cap.imageBase64}`, fileName: `${cap.activeView}.png`, mediaType: cap.mimeType, type: 'file' }], role: 'user' }],
                        schema: Loop.vision }).pipe(Effect.map((v) => ({ status: 'captured' as const, summary, vision: v.value })),
                        Effect.catchAll(() => Effect.succeed({ status: 'captured' as const, summary, vision: undefined })))),
                    Effect.catchAll((reason) => Effect.succeed({ reason: String(reason), status: 'capture_failed' as const })))
                    : Effect.succeed({ status: 'capability_missing' as const }));
                const obs = Option.fromNullable(exec.result.result).pipe(Option.map((v) => _maskDeep(v, config.maskedKeys, config.truncation)));
                const evidence: typeof Loop.evidence.Type = { deterministicFailureClass: Option.getOrNull(failureClassification), deterministicStatus: detStatus, visualStatus: visual.status };
                return { command: exec.command, evidence, failureClass: failureClassification, observation: obs, operation: detStatus === 'ok' ? 'command.completed' : 'command.failed',
                    params: { commandId: exec.command.commandId, dedupe: exec.result.dedupe, deterministicStatus: detStatus, observationCaptured: Option.isSome(obs),
                        status: exec.result.status, visualStatus: visual.status, workflow: Option.getOrUndefined(exec.workflow) },
                    result: Option.some({ dedupe: exec.result.dedupe, deterministic: { objectMetadataProbe: Option.getOrUndefined(objectProbe), sceneSummary: Option.getOrUndefined(sceneDecoded),
                        sceneSummaryProbe: Option.getOrUndefined(sceneProbe), status: detStatus }, observation: Option.getOrUndefined(obs), status: detStatus, verified: detStatus === 'ok', visual,
                        workflow: Option.getOrUndefined(exec.workflow) }), startedAt: exec.startedAt, status: detStatus } as const;
            });
            const decide = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>, vf: Effect.Effect.Success<ReturnType<typeof verify>>) => {
                const fault: Envelope.FailureClass = Option.getOrElse(vf.failureClass, () => 'fatal' as const);
                const next = Match.value({ fault, ok: vf.status === 'ok' }).pipe(Match.when({ ok: true }, () => 'Completed' as const),
                    Match.when({ fault: 'correctable' }, () => state.correctionCycles < config.correctionCycles ? 'Planning' as const : 'Failed' as const),
                    Match.when({ fault: 'retryable'   }, () => state.attempt < config.retryMaxAttempts ? 'Planning' as const : 'Failed' as const), Match.orElse(() => 'Failed' as const));
                const cont = next === 'Planning';
                const nextState: LoopState = { ...state,
                    attempt: cont ? state.attempt + 1 : state.attempt, correctionCycles: cont && fault === 'correctable' ? state.correctionCycles + 1 : state.correctionCycles,
                    lastCompaction:    Option.orElse(planned.compaction,   () => state.lastCompaction), recentObservation: Option.orElse(vf.observation, () => state.recentObservation),
                    sceneSummary:      Option.orElse(planned.sceneSummary, () => state.sceneSummary), sequence: state.sequence + 1, status: next, verificationEvidence: Option.some(vf.evidence),
                    workflowExecution: Option.orElse(exec.workflow,        () => state.workflowExecution) };
                return Match.value(fault).pipe(Match.when('compensatable', () => Telemetry.emit('kargadan.compensation.required', { commandId: vf.command.commandId })),
                    Match.when('fatal', () => Effect.logError('kargadan.fatal').pipe(Effect.annotateLogs({ commandId: vf.command.commandId, failureClass: fault }))),
                    Match.orElse(       () => Effect.void)).pipe(Effect.as(nextState));
            };
            const persistPhase = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>, exec: Effect.Effect.Success<ReturnType<typeof execute>>,
                vf: Effect.Effect.Success<ReturnType<typeof verify>>, decision: LoopState) => {
                const snap = { attempt: decision.attempt, correctionCycles: decision.correctionCycles,
                    lastCompaction:       Option.getOrUndefined(decision.lastCompaction), operations: decision.operations, recentObservation: Option.getOrUndefined(decision.recentObservation),
                    sceneSummary:         Option.getOrUndefined(decision.sceneSummary), sequence: decision.sequence, status: decision.status,
                    verificationEvidence: Option.getOrUndefined(decision.verificationEvidence), workflowExecution: Option.getOrUndefined(decision.workflowExecution) };
                return Effect.clockWith((clock) => clock.currentTimeMillis).pipe(Effect.flatMap((now) => _persist(chatRef, state.identityBase, snap, { durationMs: Math.max(0, Number(now - vf.startedAt)),
                    error: vf.status === 'ok' ? Option.none() : Option.some(exec.result.error?.message ?? 'Result error payload missing'),
                    operation: vf.operation, params: { ...vf.params, compaction: Option.getOrUndefined(planned.compaction),
                        sceneSummary: snap.sceneSummary, verificationEvidence: snap.verificationEvidence, workflowExecution: snap.workflowExecution },
                    result: vf.result, sequence: decision.sequence, status: vf.status }))).pipe(Effect.asVoid); };
            const baseline: LoopState = { attempt: 1, correctionCycles: 0, identityBase: input.identityBase, lastCompaction: Option.none(),
                operations, recentObservation: Option.none(), sceneSummary: Option.some(_DefaultScene), sequence: 0, status: 'Planning',
                verificationEvidence: Option.none(), workflowExecution: Option.none() };
            const initialState: LoopState = yield* Option.match(input.resume, { onNone: () => Effect.succeed(baseline),
                onSome: (r) => S.decodeUnknown(Loop.state)(r.state).pipe(Effect.map((s): LoopState => ({ ...s, identityBase: input.identityBase,
                    lastCompaction:    Option.fromNullable(s.lastCompaction).pipe(Option.filter(S.is(Loop.compaction))),
                    operations:        s.operations.length === 0 ? operations : s.operations, recentObservation: Option.fromNullable(s.recentObservation),
                    sceneSummary:      Option.fromNullable(s.sceneSummary).pipe(Option.filter(S.is(Loop.scene)), Option.orElse(() => Option.some(_DefaultScene))),
                    sequence:          Math.max(s.sequence, r.sequence), verificationEvidence: Option.fromNullable(s.verificationEvidence).pipe(Option.filter(S.is(Loop.evidence))),
                    workflowExecution: Option.fromNullable(s.workflowExecution).pipe(
                        Option.filter(S.is(S.Struct({ approved: S.Boolean, commandId: S.NonEmptyTrimmedString, executionId: S.NonEmptyTrimmedString })))) })),
                Effect.tap(     (s) => Effect.log('kargadan.harness.resume.restored').pipe(Effect.annotateLogs({ operations: s.operations.length, sequence: s.sequence, status: s.status }))),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.resume.decode.failed', { error: String(e) }).pipe(Effect.as({ ...baseline, sequence: r.sequence })))) });
            yield* Ref.set(eventSeqRef, Math.max(config.initialSequence, initialState.sequence + 1));
            const fibers = yield* Effect.all([Effect.fork(dispatch.takeEvent().pipe(
                Effect.flatMap((evt) => Effect.sync(() => performance.now()).pipe(Effect.flatMap((t0) => Ref.modify(eventSeqRef, (counter) => [counter, counter + 1] as const).pipe(
                    Effect.tap((seq) => _persist(chatRef, evt, { eventType: evt.eventType, sequence: seq }, { durationMs: Math.max(0, Math.round(performance.now() - t0)),
                        error: Option.none(), operation: _OpTag.transportEvent(evt.eventType), params: { causationRequestId: evt.causationRequestId, delta: evt.delta,
                            eventType: evt.eventType, sourceRevision: evt.sourceRevision, ...(evt.eventType === 'stream.compacted' ? { batchSummary: evt.delta } : {}) },
                        result: Option.some({ eventId: evt.eventId }), sequence: seq, status: 'ok' })))))),
                Effect.tap(     ()  => Effect.logDebug('kargadan.harness.transport.event')),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.transport.event.failed', { error: String(e) })), Effect.forever)),
            Effect.fork(dispatch.heartbeat(input.identityBase).pipe(Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                Effect.catchAll((e) => Telemetry.emit('kargadan.harness.heartbeat.failed', { error: String(e) })),
                Effect.zipRight(Effect.sleep(Duration.millis(config.heartbeatIntervalMs))), Effect.forever)) ]);
            const _stage = <A, E, R>(s: LoopState, stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist', fx: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
                hooks.onStage({ attempt: s.attempt, phase: 'start', sequence: s.sequence, stage, status: s.status }).pipe(Effect.zipRight(Effect.exit(fx)),
                    Effect.tap((exit) => hooks.onStage({ attempt: s.attempt, phase: 'end', sequence: s.sequence, stage,
                        status: Exit.match(exit, { onFailure: () => 'Failed' as const, onSuccess: (v) => stage === 'decide' ? (v as LoopState).status : s.status }) })),
                    Effect.flatten);
            // why: 1:1 mapping to AiService.runAgentCore — all 14 type params resolve
            const finalState = yield* ai.runAgentCore({
                decide:  (s, p: Parameters<typeof decide>[1], e: Parameters<typeof decide>[2], v: Parameters<typeof decide>[3]) => _stage(s, 'decide', decide(s, p, e, v)),
                execute: (s, p: Parameters<typeof execute>[1]) => _stage(s, 'execute', execute(s, p)),initialState, isTerminal: (s) => s.status !== 'Planning',
                persist: (s, p: Parameters<typeof persistPhase>[1], e: Parameters<typeof persistPhase>[2], v: Parameters<typeof persistPhase>[3], d: Parameters<typeof persistPhase>[4]) => _stage(s, 'persist', persistPhase(s, p, e, v, d)),
                plan:    (s) => _stage(s, 'plan', plan(s)), verify: (s, p: Parameters<typeof verify>[1], e: Parameters<typeof verify>[2]) => _stage(s, 'verify', verify(s, p, e)),
            }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
            return { state: finalState, trace: yield* persistence.trace(finalState.identityBase.sessionId) } as const;
        }));
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
