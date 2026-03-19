import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService } from '@parametric-portal/ai/service';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from '@effect/workflow';
import type { FileSystem } from '@effect/platform/FileSystem';
import type { Path } from '@effect/platform/Path';
import type { Terminal } from '@effect/platform/Terminal';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Array as A, Context, Duration, Effect, Exit, Fiber, HashMap, HashSet, Match, Option, Ref, Schema as S } from 'effect';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { Envelope, Loop } from '../protocol/schemas';
import type { LoopState } from '../protocol/schemas';

// --- [CONSTANTS] -------------------------------------------------------------
const _K = { aux: { objectMetadata: 'read.object.metadata', sceneSummary: 'read.scene.summary', scriptRun: 'script.run', undoScript: '_Undo _Enter', viewCapture: 'view.capture' },
    limits: {
        executionHistoryCap: 5,
        maxCandidates: 8,
        truncationLength: 280,
    },
    op: { compensate: (id: string) => `workflow.compensate.${id}`, planExecute: (id: string) => `plan.execute.${id}`, planScene: 'plan.scene.summary',
        transportEvent: (t: string) => `transport.event.${t}`, verifyCapture: 'verify.view.capture', verifyMetadata: 'verify.object.metadata',
        verifyScene: 'verify.scene.summary', workflowExecute: (id: string) => `workflow.execute.${id}` } } as const;
const _SCENE_TYPE_BOOSTS: Readonly<Record<string, string>> = { curve: 'Curve', mesh: 'Mesh', solid: 'Brep', surface: 'Surface' };
const _SemanticVerifySchema = S.Struct({ confidence: S.Number.pipe(S.between(0, 1)), discrepancy: S.optional(S.String), intentSatisfied: S.Boolean });
const _DecomposeSchema = S.Struct({ steps: S.Array(S.Struct({ dependsOnPrevious: S.Boolean, step: S.String })) });
const _DECOMPOSITION_SIGNALS = /\b(then|after that|next|finally)\b/i;
const _ParamNormSchema = S.transform(S.Struct({ detail: S.optional(S.Union(S.Literal('compact', 'standard', 'full'), S.Undefined)),
    includeHidden: S.optional(S.Union(S.Boolean, S.Undefined)), limit: S.optional(S.Union(S.Number.pipe(S.finite()), S.Undefined)) }),
    S.Struct({ detail: S.Literal('compact', 'standard', 'full'), includeHidden: S.Boolean, limit: S.Int }),
    { decode: ({ detail, includeHidden, limit }) => ({ detail: detail ?? 'standard' as const, includeHidden: includeHidden ?? false,
        limit: Math.max(1, Math.min(200, Math.trunc(limit ?? 25))) }), encode: ({ detail, includeHidden, limit }) => ({ detail, includeHidden, limit }) });
const _ApprovalRejected = S.parseJson(S.Struct({ _tag: S.Literal('APPROVAL_REJECTED'), workflowExecutionId: S.String }));
const _WorkflowPolicy = { approval_rejected: { code: 'WORKFLOW_APPROVAL_REJECTED', failureClass: 'fatal' as const, message: 'Write rejected by operator.' },
    decode_failed: { code: 'WORKFLOW_RESULT_DECODE_FAILED', failureClass: 'retryable' as const, message: 'Workflow result decode failed.' },
    execution_failed: { code: 'WORKFLOW_EXECUTION_FAILED', failureClass: 'compensatable' as const, message: 'Workflow execution failed.' } } as const;
// --- [FUNCTIONS] -------------------------------------------------------------
const _maskDeep = (value: unknown, masked: ReadonlySet<string>, t: HarnessConfig['truncation'], depth = 0): unknown =>
    Array.isArray(value) ? (depth >= t.arrayDepth ? [`<truncated:${String(value.length)}>`] : value.slice(0, t.arrayItems).map((i) => _maskDeep(i, masked, t, depth + 1)))
    : typeof value === 'string' ? (value.length <= t.maxLength ? value : `${value.slice(0, t.maxLength)}...`)
    : value !== null && typeof value === 'object' ? (depth >= t.objectDepth ? { _tag: 'truncated.object', keys: Object.keys(value as Record<string, unknown>).length }
        : Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([k]) => !masked.has(k)).slice(0, t.objectFields)
            .map(([k, v]) => [k, _maskDeep(v, masked, t, depth + 1)]))) : value;
const _emit = (key: string, attrs: Record<string, unknown> = {}) => Effect.logWarning(key).pipe(Effect.annotateLogs(attrs));
const _sceneAffinity = (e: Envelope.CatalogEntry, s: typeof Loop.scene.Type): number => { const m = _SCENE_TYPE_BOOSTS[e.category]; return Math.max(0.5, Math.min(1.5,
    (m === undefined ? 1 : ((s.objectCountsByType[m] ?? 0) > 0 ? 1.3 : .7)) * (e.category === 'edit' && s.objectCount > 0 ? 1.2 : 1)
    * (e.requirements.requiresObjectRefs && s.objectCount < e.requirements.minimumObjectRefCount ? 0.5 : 1))); };
const _rerank = (cs: ReadonlyArray<Envelope.CatalogEntry>, scene: Option.Option<typeof Loop.scene.Type>): ReadonlyArray<Envelope.CatalogEntry> =>
    Option.match(scene, { onNone: () => cs, onSome: (s) => cs.map((e, i) => ({ e, s: (1 / (i + 1)) * _sceneAffinity(e, s) })).sort((a, b) => b.s - a.s).map(({ e }) => e) });

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [ai, dispatch, persistence, config, wfEngine] = yield* Effect.all([AiService, CommandDispatch, AgentPersistenceService, HarnessConfig, WorkflowEngine.WorkflowEngine]);
        const eventSeqRef = yield* Ref.make<number>(config.initialSequence);
        const lastGoodChatRef = yield* Ref.make('');
        const _persist = (chatRef: Ref.Ref<Parameters<typeof ai.model.serializeChat>[0]>, identity: Envelope.IdentityBase, loopState: unknown, call: {
            readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string;
            readonly params: Record<string, unknown>; readonly result: Option.Option<unknown>; readonly sequence: number; readonly status: 'ok' | 'error';
        }) => Ref.get(chatRef).pipe(Effect.flatMap(ai.model.serializeChat), Effect.tap((json) => Ref.set(lastGoodChatRef, json)),
            Effect.catchAll((e) => _emit('kargadan.harness.chat.serialize.failed', { error: String(e) }).pipe(Effect.zipRight(Ref.get(lastGoodChatRef)))),
            Effect.flatMap((chatJson) => persistence.persistCall(identity, loopState, { ...call, chatJson })));
        const run = Effect.fn('AgentLoop.handle')((input: {
            readonly architectOverride: Option.Option<AiRegistry.SessionOverride>;
            readonly capabilities: ReadonlyArray<string>; readonly catalog: ReadonlyArray<Envelope.CatalogEntry>;
            readonly hooks?: {
                readonly onFailure?: (i: { readonly advice: string; readonly commandId: string; readonly failureClass: Envelope.FailureClass; readonly message: string }) => Effect.Effect<void>;
                readonly onStage?: (i: { readonly attempt: number; readonly phase: 'start' | 'end'; readonly sequence: number; readonly stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist'; readonly status: LoopState['status'] }) => Effect.Effect<void>;
                readonly onTool?: (i: { readonly command: Envelope.Command; readonly durationMs: number; readonly phase: 'start' | 'end'; readonly result: Option.Option<Envelope.Result>; readonly source: 'direct' | 'workflow' | 'compensation' }) => Effect.Effect<void>;
                readonly onWriteApproval?: (i: { readonly command: Envelope.Command; readonly sequence: number; readonly workflowExecutionId: string }) => Effect.Effect<boolean, never, FileSystem | Path | Terminal>; };
            readonly identityBase: Envelope.IdentityBase; readonly intent: string;
            readonly resume: Option.Option<{ readonly chatJson: string; readonly sequence: number; readonly state: unknown }>;
        }) => Effect.gen(function* () {
            const hooks = { onFailure: input.hooks?.onFailure ?? (() => Effect.void), onStage: input.hooks?.onStage ?? (() => Effect.void),
                onTool: input.hooks?.onTool ?? (() => Effect.void), onWriteApproval: input.hooks?.onWriteApproval ?? (() => Effect.succeed(false)) } as const;
            const catalogByOp = HashMap.fromIterable(A.map(input.catalog, (e) => [e.id, e] as const));
            const negotiatedCaps = HashSet.fromIterable(input.capabilities);
            const operations = ((ids) => ids.length === 0 ? config.resolveLoopOperations : ids)(A.map(input.catalog, (e) => e.id));
            const [lastDispatchRef, circuitRef] = yield* Effect.all([Ref.make(0), Ref.make(HashMap.empty<string, { failures: number; suspendedUntil: number }>())]);
            const _checkCircuit = (opId: string) => Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
                Effect.flatMap((now) => Ref.get(circuitRef).pipe(Effect.flatMap((cs) => HashMap.get(cs, opId).pipe(
                    Option.filter((c) => c.failures >= 3 && c.suspendedUntil > Number(now)),
                    Option.match({ onNone: () => Effect.void, onSome: (c) => Effect.fail(new CommandDispatchError({ details: { opId, suspendedUntil: c.suspendedUntil }, reason: 'protocol' })) }))))));
            const _recordCircuit = (opId: string, ok: boolean) => Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
                Effect.flatMap((now) => Ref.update(circuitRef, (cs) => ok ? HashMap.remove(cs, opId)
                    : HashMap.set(cs, opId, HashMap.get(cs, opId).pipe(Option.match({ onNone: () => ({ failures: 1, suspendedUntil: 0 }),
                        onSome: (c) => ({ failures: c.failures + 1, suspendedUntil: Number(now) + Math.min(30_000, 1_000 * 2 ** c.failures) }) }))))));
            const chatRef = yield* Option.match(input.resume, { onNone: () => ai.model.chat(), onSome: (r) => ai.model.deserializeChat(r.chatJson) }).pipe(
                Effect.catchAll((e) => _emit('kargadan.harness.resume.chat.decode.failed', { error: String(e) }).pipe(Effect.zipRight(ai.model.chat()))), Effect.flatMap(Ref.make));
            const _dispatch = (command: Envelope.Command, source: 'direct' | 'workflow' | 'compensation' = 'direct') =>
                _checkCircuit(command.commandId).pipe(Effect.zipRight(Effect.clockWith((clock) => clock.currentTimeMillis)),
                    Effect.tap((t0) => Ref.set(lastDispatchRef, Number(t0))), Effect.tap(() => hooks.onTool({ command, durationMs: 0, phase: 'start', result: Option.none(), source })),
                    Effect.flatMap((t0) => dispatch.execute(command).pipe(Effect.catchTag('CommandDispatchError', (e) => Effect.succeed(dispatch.buildErrorResult(command, e.errorPayload))),
                        Effect.map((r) => r as Envelope.Result), Effect.exit, Effect.tap((exit) => Effect.clockWith((c) => c.currentTimeMillis).pipe(Effect.flatMap((t1) => hooks.onTool({ command,
                            durationMs: Math.max(0, Number(t1 - t0)), phase: 'end', result: Exit.match(exit, { onFailure: () => Option.none<Envelope.Result>(), onSuccess: Option.some }), source })))),
                        Effect.flatMap((exit) => Exit.match(exit, { onFailure: (cause) => _recordCircuit(command.commandId, false).pipe(Effect.zipRight(Effect.failCause(cause))),
                            onSuccess: (r) => _recordCircuit(command.commandId, true).pipe(Effect.as(r)) })))));
            const _aux = (state: LoopState, commandId: string, args: Record<string, unknown>, operationTag: string, objectRefs?: Envelope.Command['objectRefs']) =>
                _dispatch(dispatch.buildCommand(state.identityBase, commandId, args, { attempt: state.attempt, deadlineMs: config.commandDeadlineMs, objectRefs, operationTag }));
            const _wf = Workflow.make({ annotations: Context.make(Workflow.SuspendOnFailure, true), error: S.String, idempotencyKey: (p: { readonly workflowExecutionId: string }) => p.workflowExecutionId,
                name: 'kargadan.write.execution', payload: Loop.workflowPayload.fields, success: Loop.workflowResult });
            yield* wfEngine.register(_wf, (payload) => Effect.gen(function* () {
                const command = yield* S.decodeUnknown(Envelope)(payload.command).pipe(
                    Effect.mapError((e) => `Failed to decode envelope: ${String(e)}`),
                    Effect.filterOrFail((d): d is Envelope.Command => d._tag === 'command', (d) => `Expected envelope 'command' but received '${d._tag}'`),
                    Effect.mapError((e) => `write_workflow.decode.command: ${e}`));
                const gate = DurableDeferred.make(`kargadan.write.approval.${payload.workflowExecutionId}`, { error: S.String, success: S.Boolean });
                const approved = yield* hooks.onWriteApproval({ command, sequence: payload.sequence, workflowExecutionId: payload.workflowExecutionId,
                }).pipe(Effect.flatMap((decision) => DurableDeferred.token(gate).pipe(
                    Effect.tap((token) => DurableDeferred.succeed(gate, { token, value: decision })), Effect.zipRight(DurableDeferred.await(gate)))),
                    Effect.timeoutFail({ duration: Duration.millis(config.writeApprovalTimeoutMs),
                        onTimeout: () => JSON.stringify({ _tag: 'APPROVAL_REJECTED', workflowExecutionId: payload.workflowExecutionId }) }));
                yield* approved ? Effect.void : Effect.fail(JSON.stringify({ _tag: 'APPROVAL_REJECTED', workflowExecutionId: payload.workflowExecutionId }));
                const result = yield* Activity.make({ error: S.String,
                    execute: _dispatch(dispatch.buildCommand(command, command.commandId, command.args, {
                        attempt: (yield* Activity.CurrentAttempt), deadlineMs: command.deadlineMs,
                        idempotency: persistence.idempotency(command.correlationId, command.args, payload.sequence),
                        operationTag: _K.op.workflowExecute(command.commandId) }), 'workflow').pipe(
                        Effect.mapError((error) => `write_workflow.dispatch: ${String(error)}`),
                        Effect.flatMap((r) => r.status === 'ok' ? Effect.succeed(r) : Effect.fail(`write_workflow.result: ${r.error?.message ?? 'unknown'}`))), name: `kargadan.write.execution.${command.commandId}`, success: S.Unknown,
                }).pipe(Activity.retry({ times: 2 }), _wf.withCompensation((_v, cause) =>
                    _dispatch(dispatch.buildCommand({ appId: command.appId, correlationId: command.correlationId, sessionId: command.sessionId },
                        _K.aux.scriptRun, { script: _K.aux.undoScript }, { attempt: command.telemetryContext.attempt, deadlineMs: command.deadlineMs,
                            operationTag: _K.op.compensate(command.commandId) }), 'compensation').pipe(
                        Effect.tap((r) => _emit('kargadan.workflow.compensation.executed', { cause: String(cause), commandId: command.commandId,
                            compensationStatus: r.status, workflowExecutionId: payload.workflowExecutionId })),
                        Effect.catchAll((e) => _emit('kargadan.workflow.compensation.failed', { commandId: command.commandId,
                            error: String(e), workflowExecutionId: payload.workflowExecutionId })), Effect.asVoid)));
                return { approved, result, workflowExecutionId: payload.workflowExecutionId };
            }));
            const _execWrite = (cmd: Envelope.Command, seq: number) =>
                _wf.execute({ command: cmd, sequence: seq, workflowExecutionId: `${cmd.sessionId}:${String(seq).padStart(8, '0')}:${cmd.requestId}` }).pipe(
                    Effect.flatMap((ws) => S.decodeUnknown(Envelope)(ws.result).pipe(
                        Effect.mapError((e) => `Failed to decode envelope: ${String(e)}`),
                        Effect.filterOrFail((d): d is Envelope.Result => d._tag === 'result', (d) => `Expected envelope 'result' but received '${d._tag}'`),
                        Effect.map((result) => ({ approved: ws.approved, executionId: ws.workflowExecutionId, result })),
                        Effect.catchAll((e) => Effect.succeed({ approved: ws.approved, executionId: ws.workflowExecutionId,
                            result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.decode_failed, details: { error: String(e) } }) })))),
                    Effect.catchAll((e) => { const s = String(e); const wfId = `${cmd.sessionId}:${String(seq).padStart(8, '0')}:${cmd.requestId}`;
                        return Effect.succeed(S.decodeUnknownOption(_ApprovalRejected)(s).pipe(Option.isSome)
                            ? { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.approval_rejected, details: { wfId } }) }
                            : { approved: false, executionId: wfId, result: dispatch.buildErrorResult(cmd, { ..._WorkflowPolicy.execution_failed, details: { error: s } }) }); }));
            const _probeScene = (state: LoopState, operationTag: string) => HashMap.get(catalogByOp, _K.aux.sceneSummary).pipe(Option.match({
                onNone: () => Effect.succeed({ decoded: Option.none<typeof Loop.scene.Type>(), probe: Option.none<Envelope.Result>() }),
                onSome: () => _aux(state, _K.aux.sceneSummary, {}, operationTag).pipe(Effect.flatMap((probe) =>
                    (probe.status === 'ok' ? S.decodeUnknown(Loop.scene)(probe.result).pipe(Effect.option) : Effect.succeed(Option.none()))
                        .pipe(Effect.map((decoded) => ({ decoded, probe: Option.some(probe) }))))) }));
            const plan = (state: LoopState) => Effect.gen(function* () {
                const maxTok = yield* ai.model.settings().pipe(Effect.map((s) => Math.max(1, s.language.maxTokens)), Effect.catchAll(() => Effect.succeed(8_192)));
                const trigger = Math.max(1, Math.floor((maxTok * config.compactionTriggerPercent) / 100));
                const target = Math.max(1, Math.floor((maxTok * Math.min(config.compactionTriggerPercent - 1, config.compactionTargetPercent)) / 100));
                const _buildPrompt = ({ before, serialized }: { readonly before: number; readonly serialized: string }) => { const w = Math.max(target * 4, 1_200);
                    return JSON.stringify({ compaction: { estimatedTokensBefore: before, targetTokens: target, triggerTokens: trigger },
                        context: { failureState: state.status === 'Failed' ? 'failed' : state.attempt > 1 ? 'retrying' : 'steady', goal: input.intent,
                            latestSceneSummary: Option.getOrNull(state.sceneSummary), recentObservation: Option.getOrNull(state.recentObservation), sequence: state.sequence },
                        history: { olderTurnsSummarized: serialized.length > w, recentTurns: serialized.slice(Math.max(0, serialized.length - w)) }, kind: 'kargadan.context.compaction' }); };
                const compaction = yield* Ref.get(chatRef).pipe(
                    Effect.flatMap((currentChat) => ai.model.compactChat(currentChat, { buildPrompt: _buildPrompt, target, trigger })),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.succeed(Option.none<typeof Loop.compaction.Type>()),
                        onSome: (r) => Ref.set(chatRef, r.compacted).pipe(Effect.as(Option.some({ estimatedTokensAfter: r.after, estimatedTokensBefore: r.before,
                            mode: 'history_reset' as const, sequence: state.sequence, targetTokens: target, triggerTokens: trigger } satisfies typeof Loop.compaction.Type))) })));
                const sceneProbe = yield* _probeScene(state, _K.op.planScene);
                yield* Option.filter(sceneProbe.probe, (p) => p.status === 'error').pipe(Option.match({
                    onNone: () => Effect.void, onSome: (p) => _emit('kargadan.harness.plan.scene.summary.failed', { error: p.error?.message ?? 'probe failed' }) }));
                const sceneSummary = Option.match(sceneProbe.decoded, { onNone: () => state.sceneSummary, onSome: (d) => Option.some(_maskDeep(d, config.maskedKeys, config.truncation)) });
                const effectiveIntent = Option.flatMap(state.pendingSteps, (steps) => Option.fromNullable(steps[state.currentStepIndex])).pipe(Option.getOrElse(() => input.intent));
                const { candidates, fallbackId } = yield* ai.queryKnowledge({
                    limit: Math.max(1, Math.min(_K.limits.maxCandidates, input.catalog.length)), manifest: input.catalog, term: effectiveIntent,
                }).pipe(Effect.map((result) => A.dedupe(result.items.map((item) => item.id).filter((id) => HashMap.has(catalogByOp, id)))),
                    Effect.catchAll((e) => _emit('kargadan.harness.plan.knowledge.failed', { error: String(e) }).pipe(Effect.as([] as ReadonlyArray<string>))),
                    Effect.map((ranked) => ranked.length === 0 ? state.operations : ranked),
                    Effect.flatMap((ids) => Option.match(A.head(ids), {
                        onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })),
                        onSome: (firstId) => Effect.succeed({ candidates: A.filterMap(ids, (id) => HashMap.get(catalogByOp, id)), fallbackId: firstId }) })));
                const prompt = JSON.stringify({ attempt: state.attempt, candidates: _rerank(candidates, sceneProbe.decoded).map((e) => ({ commandId: e.id, description: e.description,
                    params: e.params, requiresObjectRefs: e.requirements.requiresObjectRefs })), compaction: Option.getOrUndefined(compaction), currentStepIndex: Option.isSome(state.pendingSteps) ? state.currentStepIndex : undefined,
                    executionHistory: state.executionHistory.length > 0 ? state.executionHistory : undefined, intent: effectiveIntent,
                    originalIntent: Option.isSome(state.pendingSteps) ? input.intent : undefined, pendingSteps: Option.getOrUndefined(state.pendingSteps),
                    recentObservation: Option.getOrUndefined(state.recentObservation), sceneSummary: Option.getOrUndefined(sceneSummary), sequence: state.sequence });
                const generation = Ref.get(chatRef).pipe(Effect.flatMap((chat) => chat.generateObject({ prompt,
                    schema: S.Struct({ args: S.Record({ key: S.String, value: S.Unknown }), commandId: S.NonEmptyTrimmedString }) })), Effect.map((r) => r.value));
                const planned = yield* Option.match(input.architectOverride, { onNone: () => generation,
                    onSome: (override) => Effect.locally(generation, AiRegistry.SessionOverrideRef, Option.some(override)),
                }).pipe(Effect.catchAll((e) => _emit('kargadan.harness.plan.generate.failed', { error: String(e) }).pipe(
                    Effect.as({ args: {} as Record<string, unknown>, commandId: fallbackId }))));
                const entry = yield* HashMap.get(catalogByOp, planned.commandId).pipe(Option.match({
                    onNone: () => Effect.fail(new CommandDispatchError({ details: { commandId: planned.commandId, message: 'Operation missing from session catalog' }, reason: 'protocol' })),
                    onSome: Effect.succeed }));
                const paramSet = HashSet.fromIterable(A.map(entry.params, (p) => p.name));
                const args = { ...planned.args, ...(yield* S.decodeUnknown(_ParamNormSchema)(Object.fromEntries(
                    (['detail', 'includeHidden', 'limit'] as const).filter((n) => HashSet.has(paramSet, n)).map((n) => [n, planned.args[n]])))) };
                yield* Effect.filterOrFail(Effect.succeed(entry.params.filter((p) => p.required && !Object.hasOwn(args, p.name))), (m) => m.length === 0,
                    (m) => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Missing required: ${m.map((p) => p.name).join(', ')}` }, reason: 'protocol' }));
                const kind = Match.value(entry.dispatch.mode).pipe(Match.when('script', () => 'script' as const),
                    Match.orElse(() => entry.isDestructive ? 'write' as const : 'read' as const));
                const objectRefs = entry.requirements.requiresObjectRefs ? A.replicate(config.resolveWriteObjectRef, Math.max(1, entry.requirements.minimumObjectRefCount)) : undefined;
                yield* Effect.filterOrFail(Effect.succeed(objectRefs?.length ?? 0), (c) => c >= entry.requirements.minimumObjectRefCount,
                    () => new CommandDispatchError({ details: { commandId: planned.commandId, message: `Requires ${String(entry.requirements.minimumObjectRefCount)}+ objectRefs` }, reason: 'protocol' }));
                const command = dispatch.buildCommand(state.identityBase, planned.commandId, args, { attempt: state.attempt, deadlineMs: config.commandDeadlineMs,
                    objectRefs, operationTag: _K.op.planExecute(planned.commandId),
                    ...(kind === 'write' ? { idempotency: persistence.idempotency(state.identityBase.correlationId, args, state.sequence), undoScope: 'kargadan.phase7' } : {}) });
                return { command, compaction, operationKind: kind, sceneSummary, startedAt: yield* Effect.clockWith((clock) => clock.currentTimeMillis) } as const;
            });
            const execute = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>) =>
                Match.value(planned.operationKind).pipe(Match.when('write', () => _execWrite(planned.command, state.sequence).pipe(Effect.map((wf) => ({ command: planned.command,
                    result: wf.result, startedAt: planned.startedAt, workflow: Option.some({ approved: wf.approved, commandId: planned.command.commandId, executionId: wf.executionId }) })))),
                Match.orElse(() => _dispatch(planned.command).pipe(Effect.map((r) => ({ command: planned.command, result: r, startedAt: planned.startedAt, workflow: Option.none() })))));
            const _captureVisual = (state: LoopState, detStatus: 'ok' | 'error') =>
                HashSet.has(negotiatedCaps, _K.aux.viewCapture) ? _aux(state, _K.aux.viewCapture, config.viewCapture, _K.op.verifyCapture).pipe(
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
                    Effect.catchAll((reason) => Effect.succeed({ reason: String(reason), status: 'capture_failed' as const }))) : Effect.succeed({ status: 'capability_missing' as const });
            const _adviceMap = { compensatable: 'Workflow compensation is available; inspect undo scope and rerun after validation.',
                correctable: 'Adjust parameters or scene constraints, then retry planning.', fatal: 'Stop execution and inspect transport/protocol assumptions before retry.',
                retryable: 'Retry operation with the same intent after transient conditions clear.' } as const;
            const verify = (state: LoopState, _p: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>) => Effect.gen(function* () {
                const { decoded: sceneDecoded, probe: sceneProbe } = yield* _probeScene(state, _K.op.verifyScene);
                const objectProbe = yield* A.head(exec.command.objectRefs ?? []).pipe(
                    Option.filter(() => HashMap.has(catalogByOp, _K.aux.objectMetadata)), Option.match({
                        onNone: () => Effect.succeed(Option.none<Envelope.Result>()),
                        onSome: (ref) => _aux(state, _K.aux.objectMetadata, { detail: 'compact' }, _K.op.verifyMetadata, [ref]).pipe(Effect.map(Option.some)) }));
                const failureClassification: Option.Option<Envelope.FailureClass> = Match.value({
                    cmdErr: exec.result.status === 'error', objErr: Option.exists(objectProbe, (p) => p.status === 'error'),
                    sceneBad: Option.exists(sceneProbe, (p) => p.status === 'ok') && Option.isNone(sceneDecoded),
                    sceneErr: Option.exists(sceneProbe, (p) => p.status === 'error') }).pipe(
                    Match.when({ cmdErr: true }, () => Option.some(exec.result.error?.failureClass ?? ('fatal' as Envelope.FailureClass))),
                    Match.whenOr({ sceneErr: true }, { objErr: true }, () => Option.some('retryable' as Envelope.FailureClass)),
                    Match.when({ sceneBad: true }, () => Option.some('correctable' as Envelope.FailureClass)), Match.orElse(() => Option.none()));
                const _semFallback = { confidence: 0, discrepancy: undefined as string | undefined, intentSatisfied: true };
                const _semGen = ai.model.generateObject({ prompt: JSON.stringify({ args: exec.command.args, commandId: exec.command.commandId, intent: input.intent,
                    sceneAfter: Option.getOrUndefined(sceneDecoded), sceneBefore: Option.getOrUndefined(state.sceneSummary) }), schema: _SemanticVerifySchema });
                const semanticCheck = yield* Option.match(failureClassification, {
                    onNone: () => Option.match(input.architectOverride, { onNone: () => _semGen, onSome: (o) => Effect.locally(_semGen, AiRegistry.SessionOverrideRef, Option.some(o)) })
                        .pipe(Effect.map((r) => r.value), Effect.catchAll(() => Effect.succeed(_semFallback))),
                    onSome: () => Effect.succeed(_semFallback) });
                const effectiveClassification: typeof failureClassification = !semanticCheck.intentSatisfied && semanticCheck.confidence > 0.7
                    ? Option.some('correctable' as Envelope.FailureClass) : failureClassification;
                yield* Option.match(effectiveClassification, { onNone: () => Effect.void, onSome: (f) => hooks.onFailure({ advice: _adviceMap[f],
                    commandId: exec.command.commandId, failureClass: f, message: exec.result.error?.message ?? 'Verification detected non-success.' }) });
                const detStatus = Option.isSome(effectiveClassification) ? 'error' as const : 'ok' as const;
                const visual = yield* _captureVisual(state, detStatus);
                const obs = Option.fromNullable(exec.result.result).pipe(Option.map((v) => _maskDeep(v, config.maskedKeys, config.truncation)));
                const evidence: typeof Loop.evidence.Type = { deterministicFailureClass: Option.getOrNull(effectiveClassification), deterministicStatus: detStatus,
                    semanticDiscrepancy: Option.isNone(failureClassification) ? (semanticCheck.discrepancy ?? null) : null, visualStatus: visual.status };
                return { command: exec.command, evidence, failureClass: effectiveClassification, observation: obs, operation: detStatus === 'ok' ? 'command.completed' : 'command.failed',
                    params: { commandId: exec.command.commandId, dedupe: exec.result.dedupe, deterministicStatus: detStatus, observationCaptured: Option.isSome(obs),
                        status: exec.result.status, visualStatus: visual.status, workflow: Option.getOrUndefined(exec.workflow) },
                    result: Option.some({ dedupe: exec.result.dedupe, deterministic: { objectMetadataProbe: Option.getOrUndefined(objectProbe), sceneSummary: Option.getOrUndefined(sceneDecoded),
                        sceneSummaryProbe: Option.getOrUndefined(sceneProbe), status: detStatus }, observation: Option.getOrUndefined(obs), status: detStatus, verified: detStatus === 'ok', visual,
                        workflow: Option.getOrUndefined(exec.workflow) }), startedAt: exec.startedAt, status: detStatus } as const;
            });
            const decide = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>,
                exec: Effect.Effect.Success<ReturnType<typeof execute>>, vf: Effect.Effect.Success<ReturnType<typeof verify>>) => {
                const next = Match.value({ fault: Option.getOrElse(vf.failureClass, () => 'fatal' as const),
                    hasMoreSteps: Option.exists(state.pendingSteps, (steps) => state.currentStepIndex + 1 < steps.length), ok: vf.status === 'ok' }).pipe(
                    Match.when({ hasMoreSteps: true, ok: true }, () => 'Planning' as const), Match.when({ ok: true }, () => 'Completed' as const),
                    Match.when({ fault: 'correctable' }, () => state.correctionCycles < config.correctionCycles ? 'Planning' as const : 'Failed' as const),
                    Match.when({ fault: 'retryable' }, () => state.attempt < config.retryMaxAttempts ? 'Planning' as const : 'Failed' as const), Match.orElse(() => 'Failed' as const));
                const cont = next === 'Planning';
                const stepAdvanced = vf.status === 'ok' && Option.exists(state.pendingSteps, (steps) => state.currentStepIndex + 1 < steps.length);
                const nextState: LoopState = { ...state, attempt: stepAdvanced ? 1 : (cont ? state.attempt + 1 : state.attempt),
                    correctionCycles: stepAdvanced ? 0 : (cont && Option.getOrElse(vf.failureClass, () => 'fatal' as const) === 'correctable' ? state.correctionCycles + 1 : state.correctionCycles),
                    currentStepIndex: stepAdvanced ? state.currentStepIndex + 1 : state.currentStepIndex,
                    executionHistory: vf.status === 'ok'
                        ? [...state.executionHistory, { args: _maskDeep(vf.command.args, config.maskedKeys, config.truncation) as Record<string, unknown>, commandId: vf.command.commandId,
                            resultSummary: Option.map(vf.observation, (o) => _maskDeep(o, config.maskedKeys, config.truncation)).pipe(Option.getOrUndefined) }].slice(-_K.limits.executionHistoryCap)
                        : state.executionHistory,
                    lastCompaction: Option.orElse(planned.compaction, () => state.lastCompaction), recentObservation: Option.orElse(vf.observation, () => state.recentObservation),
                    sceneSummary: Option.orElse(planned.sceneSummary, () => state.sceneSummary), sequence: state.sequence + 1, status: next, verificationEvidence: Option.some(vf.evidence),
                    workflowExecution: Option.orElse(exec.workflow, () => state.workflowExecution) };
                return Match.value(Option.getOrElse(vf.failureClass, () => 'fatal' as const)).pipe(
                    Match.when('compensatable', () => _emit('kargadan.compensation.required', { commandId: vf.command.commandId })),
                    Match.when('fatal', () => Effect.logError('kargadan.fatal').pipe(Effect.annotateLogs({ commandId: vf.command.commandId, failureClass: Option.getOrElse(vf.failureClass, () => 'fatal') }))),
                    Match.orElse(() => Effect.void)).pipe(Effect.as(nextState));
            };
            const persistPhase = (state: LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>, exec: Effect.Effect.Success<ReturnType<typeof execute>>,
                vf: Effect.Effect.Success<ReturnType<typeof verify>>, decision: LoopState) => {
                const d = decision; const _gu = Option.getOrUndefined;
                const snap = { attempt: d.attempt, correctionCycles: d.correctionCycles, currentStepIndex: d.currentStepIndex, executionHistory: d.executionHistory,
                    lastCompaction: _gu(d.lastCompaction), operations: d.operations, pendingSteps: _gu(d.pendingSteps), recentObservation: _gu(d.recentObservation),
                    sceneSummary: _gu(d.sceneSummary), sequence: d.sequence, status: d.status, verificationEvidence: _gu(d.verificationEvidence), workflowExecution: _gu(d.workflowExecution) };
                return Effect.clockWith((clock) => clock.currentTimeMillis).pipe(Effect.flatMap((now) => _persist(chatRef, state.identityBase, snap, {
                    durationMs: Math.max(0, Number(now - vf.startedAt)), error: vf.status === 'ok' ? Option.none() : Option.some(exec.result.error?.message ?? 'Result error payload missing'),
                    operation: vf.operation, params: { ...vf.params, compaction: _gu(planned.compaction), sceneSummary: snap.sceneSummary,
                        verificationEvidence: snap.verificationEvidence, workflowExecution: snap.workflowExecution },
                    result: vf.result, sequence: d.sequence, status: vf.status }))).pipe(Effect.asVoid); };
            const _defaultScene = { activeLayer: { index: -1, name: '' }, activeView: '', layerCount: 0, objectCount: 0,
                objectCountsByType: {}, tolerances: { absoluteTolerance: 0, angleToleranceRadians: 0, unitSystem: '' }, worldBoundingBox: { max: [0, 0, 0], min: [0, 0, 0] } } as const satisfies typeof Loop.scene.Type;
            const baseline: LoopState = { attempt: 1, correctionCycles: 0, currentStepIndex: 0, executionHistory: [], identityBase: input.identityBase, lastCompaction: Option.none(),
                operations, pendingSteps: Option.none(), recentObservation: Option.none(), sceneSummary: Option.some(_defaultScene), sequence: 0, status: 'Planning', verificationEvidence: Option.none(), workflowExecution: Option.none() };
            const initialState: LoopState = yield* Option.match(input.resume, { onNone: () => Effect.succeed(baseline),
                onSome: (r) => S.decodeUnknown(Loop.state)(r.state).pipe(Effect.map((s): LoopState => ({ ...s, currentStepIndex: s.currentStepIndex ?? 0,
                    executionHistory: s.executionHistory ?? [], identityBase: input.identityBase,
                    lastCompaction: Option.fromNullable(s.lastCompaction).pipe(Option.filter(S.is(Loop.compaction))),
                    operations: s.operations.length === 0 ? operations : s.operations, pendingSteps: Option.fromNullable(s.pendingSteps), recentObservation: Option.fromNullable(s.recentObservation),
                    sceneSummary: Option.fromNullable(s.sceneSummary).pipe(Option.filter(S.is(Loop.scene)), Option.orElse(() => Option.some(_defaultScene))),
                    sequence: Math.max(s.sequence, r.sequence), verificationEvidence: Option.fromNullable(s.verificationEvidence).pipe(Option.filter(S.is(Loop.evidence))),
                    workflowExecution: Option.fromNullable(s.workflowExecution).pipe(
                        Option.filter(S.is(S.Struct({ approved: S.Boolean, commandId: S.NonEmptyTrimmedString, executionId: S.NonEmptyTrimmedString })))) })),
                Effect.tap((s) => Effect.log('kargadan.harness.resume.restored').pipe(Effect.annotateLogs({ operations: s.operations.length, sequence: s.sequence, status: s.status }))),
                Effect.catchAll((e) => _emit('kargadan.harness.resume.decode.failed', { error: String(e), stateHash: typeof r.state === 'object' ? 'present' : 'absent' }).pipe(
                    Effect.zipRight(persistence.persistCall(input.identityBase, { corruptState: true, decodeError: String(e) }, {
                        chatJson: r.chatJson, durationMs: 0, error: Option.some(String(e)), operation: 'resume.corruption.audit',
                        params: { baselineSequence: r.sequence }, result: Option.none(), sequence: r.sequence, status: 'error' })),
                    Effect.catchAll(() => Effect.void), Effect.as({ ...baseline, sequence: r.sequence })))) });
            yield* Ref.set(eventSeqRef, Math.max(config.initialSequence, initialState.sequence + 1));
            const fibers = yield* Effect.all([Effect.fork(dispatch.takeEvent().pipe(
                Effect.flatMap((evt) => Effect.sync(() => performance.now()).pipe(Effect.flatMap((t0) => Ref.modify(eventSeqRef, (counter) => [counter, counter + 1] as const).pipe(
                    Effect.tap((seq) => _persist(chatRef, evt, { eventType: evt.eventType, sequence: seq }, { durationMs: Math.max(0, Math.round(performance.now() - t0)),
                        error: Option.none(), operation: _K.op.transportEvent(evt.eventType), params: { causationRequestId: evt.causationRequestId, delta: evt.delta,
                            eventType: evt.eventType, sourceRevision: evt.sourceRevision, ...(evt.eventType === 'stream.compacted' ? { batchSummary: evt.delta } : {}) },
                        result: Option.some({ eventId: evt.eventId }), sequence: seq, status: 'ok' })))))),
                Effect.tap(() => Effect.logDebug('kargadan.harness.transport.event')),
                Effect.catchAll((e) => _emit('kargadan.harness.transport.event.failed', { error: String(e) })), Effect.forever)),
            Effect.fork(Ref.get(lastDispatchRef).pipe(
                Effect.flatMap((t) => Effect.clockWith((clock) => clock.currentTimeMillis).pipe(Effect.flatMap((now) => now - t < config.heartbeatIntervalMs ? Effect.void : dispatch.heartbeat(input.identityBase)))),
                Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                Effect.catchAll((e) => _emit('kargadan.harness.heartbeat.failed', { error: String(e) })),
                Effect.zipRight(Effect.sleep(Duration.millis(config.heartbeatIntervalMs))), Effect.forever)) ]);
            const _stage = <A, E, R>(s: LoopState, stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist', fx: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
                hooks.onStage({ attempt: s.attempt, phase: 'start', sequence: s.sequence, stage, status: s.status }).pipe(Effect.zipRight(Effect.exit(fx)),
                    Effect.tap((exit) => hooks.onStage({ attempt: s.attempt, phase: 'end', sequence: s.sequence, stage,
                        status: Exit.match(exit, { onFailure: () => 'Failed' as const, onSuccess: (v) => stage === 'decide' ? (v as LoopState).status : s.status }) })),
                    Effect.flatten);
            const decomposed = yield* (Option.isNone(input.resume) && input.intent.length > 60 && _DECOMPOSITION_SIGNALS.test(input.intent)
                ? ai.model.generateObject({ prompt: JSON.stringify({ intent: input.intent, task: 'Decompose this composite intent into ordered atomic steps' }),
                    schema: _DecomposeSchema }).pipe(
                    Effect.map((r) => r.value.steps.length > 1 ? Option.some(r.value.steps.map((s) => s.step)) : Option.none<ReadonlyArray<string>>()),
                    Effect.catchAll(() => Effect.succeed(Option.none<ReadonlyArray<string>>())))
                : Effect.succeed(Option.none<ReadonlyArray<string>>()));
            const finalState = yield* ai.runAgentCore({
                decide: (s, p: Parameters<typeof decide>[1], e: Parameters<typeof decide>[2], v: Parameters<typeof decide>[3]) => _stage(s, 'decide', decide(s, p, e, v)),
                execute: (s, p: Parameters<typeof execute>[1]) => _stage(s, 'execute', execute(s, p)),
                initialState: { ...initialState, pendingSteps: Option.orElse(initialState.pendingSteps, () => decomposed) } as LoopState,
                isTerminal: (s) => s.status !== 'Planning',
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
