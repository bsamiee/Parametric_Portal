import { AiRegistry } from '@parametric-portal/ai/registry';
import { AiService } from '@parametric-portal/ai/service';
import { Activity, DurableDeferred, Workflow, WorkflowEngine } from '@effect/workflow';
import type { FileSystem } from '@effect/platform/FileSystem';
import type { Path } from '@effect/platform/Path';
import type { Terminal } from '@effect/platform/Terminal';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Duration, Effect, Exit, Fiber, Match, Option, Ref, Schema as S } from 'effect';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { Envelope, FailureClass, NonNegInt, Operation, ResultStatus, WorkflowExecutionId } from '../protocol/schemas';

// --- [TYPES] -----------------------------------------------------------------

type _LoopState = {
    readonly attempt:              number;
    readonly command:              Option.Option<Envelope.Command>;
    readonly correctionCycles:     number;
    readonly identityBase:         Envelope.IdentityBase;
    readonly lastCompaction:       Option.Option<typeof _Loop.compaction.Type>;
    readonly operations:           ReadonlyArray<string>;
    readonly recentObservation:    Option.Option<unknown>;
    readonly sceneSummary:         Option.Option<unknown>;
    readonly sequence:             number;
    readonly status:               'Planning' | 'Completed' | 'Failed';
    readonly verificationEvidence: Option.Option<typeof _Loop.evidence.Type>;
    readonly workflowExecution:    Option.Option<typeof _Loop.workflow.Type>;
};

// --- [SCHEMA] ----------------------------------------------------------------

const _Loop = {
    compaction: S.Struct({ estimatedTokensAfter: NonNegInt, estimatedTokensBefore: NonNegInt, mode: S.Literal('history_reset'), sequence: NonNegInt, targetTokens: NonNegInt, triggerTokens: NonNegInt }),
    evidence:   S.Struct({ deterministicFailureClass: S.NullOr(FailureClass), deterministicStatus: ResultStatus, visualStatus: S.Literal('captured', 'capture_failed', 'capability_missing') }),
    scene: S.Struct({
        activeLayer:        S.Struct({ index: S.Int,    name:  S.String  }), activeView: S.String, layerCount: NonNegInt, objectCount: NonNegInt,
        objectCountsByType: S.Record({ key:   S.String, value: NonNegInt }),
        tolerances:         S.Struct({ absoluteTolerance: S.Number, angleToleranceRadians: S.Number, unitSystem: S.String }),
        worldBoundingBox:   S.Struct({ max: S.Tuple(S.Number, S.Number, S.Number), min: S.Tuple(S.Number, S.Number, S.Number) }),
    }),
    state: S.Struct({
        attempt:    S.Int.pipe(S.greaterThanOrEqualTo(1)), correctionCycles: NonNegInt, lastCompaction: S.optional(S.Unknown),
        operations: S.Array(Operation), recentObservation: S.optional(S.Unknown), sceneSummary: S.optional(S.Unknown),
        sequence: NonNegInt, status: S.Literal('Planning', 'Completed', 'Failed'),
        verificationEvidence: S.optional(S.Unknown), workflowExecution: S.optional(S.Unknown),
    }),
    workflow:        S.Struct({ approved: S.Boolean, commandId: S.NonEmptyTrimmedString, executionId: WorkflowExecutionId }),
    workflowPayload: S.Struct({ command:  S.Unknown, sequence:  NonNegInt, workflowExecutionId: WorkflowExecutionId       }),
    workflowResult:  S.Struct({ approved: S.Boolean, result:    S.Unknown, workflowExecutionId: WorkflowExecutionId       }),
} as const;

// --- [CONSTANTS] -------------------------------------------------------------

const _MaskedKeys = new Set(['brep', 'breps', 'edges', 'faces', 'geometry', 'mesh', 'meshes', 'nurbs', 'points', 'vertices']);
const _AuxCommand = {
    objectMetadata: 'read.object.metadata', sceneSummary: 'read.scene.summary', scriptRun: 'script.run',
    undoScript: '_Undo _Enter', viewCapture: 'view.capture',
} as const;
const _ParamNorm = [
    ['detail',        (v: unknown) => Option.fromNullable(v).pipe(Option.filter((x): x is string => typeof x === 'string' && ['compact', 'standard', 'full'].includes(x)), Option.getOrElse(() => 'standard'))],
    ['includeHidden', (v: unknown) => Option.fromNullable(v).pipe(Option.filter(S.is(S.Boolean)), Option.getOrElse(() => false))],
    ['limit',         (v: unknown) => Option.fromNullable(v).pipe(Option.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)), Option.map((x) => Math.max(1, Math.min(200, Math.trunc(x)))), Option.getOrElse(() => 25))],
] as const satisfies ReadonlyArray<readonly [string, (v: unknown) => unknown]>;
const _FailureGuidance: Record<Envelope.FailureClass, string> = {
    compensatable: 'Workflow compensation is available; inspect undo scope and rerun after validation.',
    correctable:   'Adjust parameters or scene constraints, then retry planning.',
    fatal:         'Stop execution and inspect transport/protocol assumptions before retry.',
    retryable:     'Retry operation with the same intent after transient conditions clear.',
} as const;
const _DefaultScene = {
    activeLayer: { index: -1, name: '' }, activeView: '', layerCount: 0, objectCount: 0,
    objectCountsByType: {}, tolerances: { absoluteTolerance: 0, angleToleranceRadians: 0, unitSystem: '' },
    worldBoundingBox: { max: [0, 0, 0], min: [0, 0, 0] },
} as const satisfies typeof _Loop.scene.Type;

// --- [FUNCTIONS] -------------------------------------------------------------

const _workflowExecId = (command: Envelope.Command, sequence: number) =>
    `${command.sessionId}:${String(sequence).padStart(8, '0')}:${command.requestId}`;
const _decodeEnvelope = <T extends 'command' | 'result'>(tag: T) => (payload: unknown) =>
    S.decodeUnknown(Envelope)(payload).pipe(
        Effect.mapError((error) => `Failed to decode envelope: ${String(error)}`),
        Effect.filterOrFail(
            (decoded): decoded is Extract<typeof Envelope.Type, { readonly _tag: T }> => decoded._tag === tag,
            (decoded) => `Expected envelope '${tag}' but received '${decoded._tag}'`));
const _sanitizeObservation = (value: unknown, depth = 0): unknown =>
    Match.value(value).pipe(
        Match.when(Match.string, (s: string) => s.length <= 280 ? s : `${s.slice(0, 280)}...`),
        Match.when((x: unknown): x is ReadonlyArray<unknown> => Array.isArray(x),
            (a) => depth >= 2 ? [`<truncated:${String(a.length)}>`] : a.slice(0, 12).map((i) => _sanitizeObservation(i, depth + 1))),
        Match.when((x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object',
            (o) => depth >= 3 ? { _tag: 'truncated.object', keys: Object.keys(o).length }
                : Object.fromEntries(Object.entries(o).filter(([k]) => !_MaskedKeys.has(k)).slice(0, 24)
                    .map(([k, val]) => [k, _sanitizeObservation(val, depth + 1)]))),
        Match.orElse((x) => x));

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [ai, dispatch, persistence, commandDeadlineMs, retryMax, correctionMax, heartbeatIntervalMs,
            fallbackOperations, writeObjectRef, compactionTriggerPercent, compactionTargetPercent] = yield* Effect.all([
            AiService, CommandDispatch, AgentPersistenceService, HarnessConfig.commandDeadlineMs,
            HarnessConfig.retryMaxAttempts,         HarnessConfig.correctionCycles, HarnessConfig.heartbeatIntervalMs,
            HarnessConfig.resolveLoopOperations,    HarnessConfig.resolveWriteObjectRef,
            HarnessConfig.compactionTriggerPercent, HarnessConfig.compactionTargetPercent,
        ]);
        const workflowEngine = yield* WorkflowEngine.WorkflowEngine;
        const eventSequence  = yield* Ref.make(1_000_000);
        const run = Effect.fn('AgentLoop.handle')((input: {
            readonly architectOverride: Option.Option<AiRegistry.SessionOverride>;
            readonly capabilities:      ReadonlyArray<string>;
            readonly catalog:           ReadonlyArray<Envelope.CatalogEntry>;
            readonly hooks?: {
                readonly onFailure?: (input: { readonly advice: string; readonly commandId: string;
                    readonly failureClass: Envelope.FailureClass; readonly message: string; }) => Effect.Effect<void>;
                readonly onStage?: (input: { readonly attempt: number; readonly phase: 'start' | 'end'; readonly sequence: number;
                    readonly stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist'; readonly status: _LoopState['status']; }) => Effect.Effect<void>;
                readonly onTool?: (input: { readonly command: Envelope.Command; readonly durationMs: number; readonly phase: 'start' | 'end';
                    readonly result: Option.Option<Envelope.Result>; readonly source: 'direct' | 'workflow' | 'compensation'; }) => Effect.Effect<void>;
                readonly onWriteApproval?: (input: { readonly command: Envelope.Command; readonly sequence: number;
                    readonly workflowExecutionId: string; }) => Effect.Effect<boolean, never, FileSystem | Path | Terminal>;
            };
            readonly identityBase: Envelope.IdentityBase;
            readonly intent:       string;
            readonly resume:       Option.Option<{ readonly chatJson: string; readonly sequence: number; readonly state: unknown }>;
        }) =>
            Effect.gen(function* () {
                const hooks = {
                    onFailure:       input.hooks?.onFailure       ?? (() => Effect.void),
                    onStage:         input.hooks?.onStage         ?? (() => Effect.void),
                    onTool:          input.hooks?.onTool          ?? (() => Effect.void),
                    onWriteApproval: input.hooks?.onWriteApproval ?? (() => Effect.succeed(false)),
                } as const;
                const catalogByOp = new Map(input.catalog.map((e) => [e.id, e] as const));
                const negotiatedCaps = new Set(input.capabilities);
                const filtered = input.catalog.filter((e) => e.dispatch.mode !== 'script').map((e) => e.id);
                const operations = filtered.length === 0 ? fallbackOperations : filtered;
                const chatRef = yield* Option.match(input.resume, {
                    onNone: () => ai.model.chat(),
                    onSome: (r) => ai.model.deserializeChat(r.chatJson).pipe(
                        Effect.catchAll((e) => Telemetry.emit('kargadan.harness.resume.chat.decode.failed', { error: String(e) }).pipe(
                            Effect.zipRight(ai.model.chat())))),
                }).pipe(Effect.flatMap(Ref.make));
                const _serializeChat = () => Ref.get(chatRef).pipe(
                    Effect.flatMap((c) => ai.model.serializeChat(c)),
                    Effect.catchAll((e) => Telemetry.emit('kargadan.harness.chat.serialize.failed', { error: String(e) }).pipe(Effect.as(''))));
                const _persist = (identity: Envelope.IdentityBase, loopState: unknown, call: {
                    readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string;
                    readonly params: Record<string, unknown>; readonly result: Option.Option<unknown>;
                    readonly sequence: number; readonly status: 'ok' | 'error';
                }) => _serializeChat().pipe(Effect.flatMap((chatJson) => persistence.persistCall(identity, loopState, { ...call, chatJson })));
                const persistInboundEvent = (evt: Envelope.Event) =>
                    Effect.sync(() => performance.now()).pipe(
                        Effect.flatMap((start) => Ref.modify(eventSequence, (c) => [c, c + 1] as const).pipe(
                            Effect.tap((sequence) => _persist(evt, { eventType: evt.eventType, sequence }, {
                                durationMs: Math.max(0, Math.round(performance.now() - start)), error: Option.none(),
                                operation: `transport.event.${evt.eventType}`,
                                params: { causationRequestId: evt.causationRequestId, delta: evt.delta,
                                    eventType: evt.eventType, sourceRevision: evt.sourceRevision,
                                    ...(evt.eventType === 'stream.compacted' ? { batchSummary: evt.delta } : {}) },
                                result: Option.some({ eventId: evt.eventId }), sequence, status: 'ok' })),
                            Effect.map((sequence) => ({ eventEnvelope: evt, sequence }) as const))));
                const _dispatchCommand = (command: Envelope.Command, source: 'direct' | 'workflow' | 'compensation' = 'direct') =>
                    Effect.sync(() => performance.now()).pipe(
                        Effect.tap(() => hooks.onTool({ command, durationMs: 0, phase: 'start', result: Option.none(), source })),
                        Effect.flatMap((startedAt) => dispatch.execute(command).pipe(
                            Effect.catchTag('CommandDispatchError', (e) => Effect.succeed(dispatch.buildErrorResult(command, e.errorPayload))),
                            Effect.map((r) => r as Envelope.Result), Effect.exit,
                            Effect.tap((exit) => hooks.onTool({ command, durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
                                phase: 'end', result: Exit.match(exit, { onFailure: () => Option.none<Envelope.Result>(), onSuccess: Option.some }), source })),
                            Effect.flatten)));
                const _dispatchAux = (state: _LoopState, commandId: string, args: Record<string, unknown>,
                    operationTag: string, objectRefs?: Envelope.Command['objectRefs']) =>
                    _dispatchCommand(dispatch.buildCommand(state.identityBase, commandId, args, {
                        attempt: state.attempt, deadlineMs: commandDeadlineMs, objectRefs, operationTag }));
                const _compactChat = (state: _LoopState, serialized: string, tokensBefore: number, target: number, trigger: number) =>
                    Effect.gen(function* () {
                        const window = Math.max(target * 4, 1_200);
                        const seed = JSON.stringify({
                            compaction: { estimatedTokensBefore: tokensBefore, targetTokens: target, triggerTokens: trigger },
                            context: { failureState: state.status === 'Failed' ? 'failed' : (state.attempt > 1 ? 'retrying' : 'steady'),
                                goal: input.intent, latestSceneSummary: Option.getOrNull(state.sceneSummary),
                                recentObservation: Option.getOrNull(state.recentObservation), sequence: state.sequence },
                            history: { olderTurnsSummarized: serialized.length > window,
                                recentTurns: serialized.slice(Math.max(0, serialized.length - window)) },
                            kind: 'kargadan.context.compaction' });
                        const compact = yield* ai.model.chat({ prompt: seed });
                        const json = yield* ai.model.serializeChat(compact).pipe(Effect.catchAll(() => Effect.succeed(seed)));
                        const after = yield* ai.model.countTokens(json).pipe(Effect.option);
                        return yield* Option.match(after, {
                            onNone: () => Telemetry.emit('kargadan.harness.compaction.tokens.unavailable.after').pipe(Effect.as(Option.none())),
                            onSome: (n) => n <= target
                                ? Ref.set(chatRef, compact).pipe(Effect.as(Option.some({ estimatedTokensAfter: n,
                                    estimatedTokensBefore: tokensBefore, mode: 'history_reset' as const,
                                    sequence: state.sequence, targetTokens: target, triggerTokens: trigger } satisfies typeof _Loop.compaction.Type)))
                                : Telemetry.emit('kargadan.harness.compaction.target_not_met', { estimatedTokensAfter: n, targetTokens: target }).pipe(
                                    Effect.as(Option.none())) });
                    });
                const _writeWorkflow = Workflow.make({
                    error: S.String,
                    idempotencyKey: (p: { readonly workflowExecutionId: string }) => p.workflowExecutionId, name: 'kargadan.write.execution',
                    payload: _Loop.workflowPayload.fields, success: _Loop.workflowResult,
                });
                yield* workflowEngine.register(_writeWorkflow, (payload) =>
                    Effect.gen(function* () {
                        const command = yield* _decodeEnvelope('command')(payload.command).pipe(
                            Effect.mapError((e) => `write_workflow.decode.command: ${e}`));
                        const gate = DurableDeferred.make(`kargadan.write.approval.${payload.workflowExecutionId}`, { error: S.String, success: S.Boolean });
                        const approved = yield* hooks.onWriteApproval({
                            command, sequence: payload.sequence, workflowExecutionId: payload.workflowExecutionId,
                        }).pipe(Effect.flatMap((decision) =>
                            DurableDeferred.token(gate).pipe(
                                Effect.tap((token) => DurableDeferred.succeed(gate, { token, value: decision })),
                                Effect.zipRight(DurableDeferred.await(gate)))));
                        yield* Effect.when(Effect.fail('write_workflow.approval.rejected'), () => !approved);
                        const result = yield* Activity.make({
                            error: S.String,
                            execute: _dispatchCommand(command, 'workflow').pipe(
                                Effect.mapError((error) => `write_workflow.dispatch: ${String(error)}`),
                                Effect.flatMap((r) => r.status === 'ok' ? Effect.succeed(r) : Effect.fail(`write_workflow.result: ${r.error?.message ?? 'unknown'}`))),
                            name: `kargadan.write.execution.${command.commandId}`, success: S.Unknown,
                        }).pipe(Activity.retry({ times: 2 }), _writeWorkflow.withCompensation((_v, cause) =>
                            _dispatchCommand(dispatch.buildCommand(
                                { appId: command.appId, correlationId: command.correlationId, sessionId: command.sessionId },
                                _AuxCommand.scriptRun, { script: _AuxCommand.undoScript },
                                { attempt: command.telemetryContext.attempt, deadlineMs: command.deadlineMs,
                                    operationTag: `workflow.compensate.${command.commandId}` }), 'compensation').pipe(
                                Effect.tap((r) => Telemetry.emit('kargadan.workflow.compensation.executed', {
                                    cause: String(cause), commandId: command.commandId, compensationStatus: r.status,
                                    workflowExecutionId: payload.workflowExecutionId })),
                                Effect.catchAll((e) => Telemetry.emit('kargadan.workflow.compensation.failed', {
                                    commandId: command.commandId, error: String(e), workflowExecutionId: payload.workflowExecutionId })),
                                Effect.asVoid)));
                        return { approved, result, workflowExecutionId: payload.workflowExecutionId };
                    }));
                const _wfError = {
                    approval_rejected: { code: 'WORKFLOW_APPROVAL_REJECTED',    failureClass: 'correctable' as const,   message: 'Write command rejected by operator approval gate.' },
                    decode_failed:     { code: 'WORKFLOW_RESULT_DECODE_FAILED', failureClass: 'retryable' as const,     message: 'Workflow result decode failed.'                    },
                    execution_failed:  { code: 'WORKFLOW_EXECUTION_FAILED',     failureClass: 'compensatable' as const, message: 'Workflow execution failed.'                        },
                } as const;
                const _runWriteWorkflow = (command: Envelope.Command, sequence: number) =>
                    _writeWorkflow.execute({ command, sequence, workflowExecutionId: _workflowExecId(command, sequence) }).pipe(
                        Effect.flatMap((ws) =>
                            _decodeEnvelope('result')(ws.result).pipe(
                                Effect.map((result) => ({ approved: ws.approved, executionId: ws.workflowExecutionId, result })),
                                Effect.catchAll((e) => Effect.succeed({ approved: ws.approved, executionId: ws.workflowExecutionId,
                                    result: dispatch.buildErrorResult(command, { ..._wfError.decode_failed, details: { error: String(e) } }) })))),
                        Effect.catchAll((e) => Effect.succeed({ approved: false, executionId: _workflowExecId(command, sequence),
                            result: dispatch.buildErrorResult(command, { ...(_wfError[String(e) === 'write_workflow.approval.rejected'
                                ? 'approval_rejected' : 'execution_failed']), details: { error: String(e) } }) })));
                const _probeScene = (state: _LoopState, operationTag: string) =>
                    Option.fromNullable(catalogByOp.get(_AuxCommand.sceneSummary)).pipe(Option.match({
                        onNone: () => Effect.succeed({ decoded: Option.none<typeof _Loop.scene.Type>(), probe: Option.none<Envelope.Result>() }),
                        onSome: () => _dispatchAux(state, _AuxCommand.sceneSummary, {}, operationTag).pipe(
                            Effect.flatMap((probe) =>
                                (probe.status === 'ok'
                                    ? S.decodeUnknown(_Loop.scene)(probe.result).pipe(Effect.map(Option.some),
                                        Effect.catchAll(() => Effect.succeed(Option.none<typeof _Loop.scene.Type>())))
                                    : Effect.succeed(Option.none<typeof _Loop.scene.Type>())
                                ).pipe(Effect.map((decoded) => ({ decoded, probe: Option.some(probe) }))))) }));
                const plan = (state: _LoopState) =>
                    Effect.gen(function* () {
                        const maxTokens = yield* ai.model.settings().pipe(
                            Effect.map((s) => Math.max(1, s.language.maxTokens)), Effect.catchAll(() => Effect.succeed(8_192)));
                        const trigger = Math.max(1, Math.floor((maxTokens * compactionTriggerPercent) / 100));
                        const target  = Math.max(1, Math.floor((maxTokens * Math.min(compactionTriggerPercent - 1, compactionTargetPercent)) / 100));
                        const compaction = yield* Ref.get(chatRef).pipe(
                            Effect.flatMap((chat) => ai.model.serializeChat(chat).pipe(Effect.catchAll(() => Effect.succeed('')))),
                            Effect.flatMap((serialized) => ai.model.countTokens(serialized).pipe(Effect.option, Effect.flatMap(Option.match({
                                onNone: () => Telemetry.emit('kargadan.harness.compaction.tokens.unavailable.before').pipe(Effect.as(Option.none())),
                                onSome: (before) => before < trigger ? Effect.succeed(Option.none())
                                    : _compactChat(state, serialized, before, target, trigger) })))));
                        const sceneProbe = yield* _probeScene(state, 'plan.scene.summary');
                        yield* Option.filter(sceneProbe.probe, (p) => p.status === 'error').pipe(Option.match({
                            onNone: ()  => Effect.void,
                            onSome: (p) => Telemetry.emit('kargadan.harness.plan.scene.summary.failed', { error: p.error?.message ?? 'scene summary probe failed' }) }));
                        const sceneSummary = Option.match(sceneProbe.decoded, {
                            onNone: () => state.sceneSummary, onSome: (d) => Option.some(_sanitizeObservation(d)) });
                        const ranked = yield* ai.searchQuery(
                            { entityTypes: ['command'], includeSnippets: false, term: input.intent },
                            { limit: Math.max(1, Math.min(8, input.catalog.length)) }).pipe(
                            Effect.flatMap((raw) => S.decodeUnknown(S.Struct({ items: S.Array(S.Struct({
                                metadata: S.NullOr(S.Record({ key: S.String, value: S.Unknown })) })) }))(raw)),
                            Effect.map((r) => [...new Set(r.items.map((i) => i.metadata?.['id']).filter(S.is(S.NonEmptyTrimmedString))
                                .filter((id) => catalogByOp.has(id)))]),
                            Effect.catchAll((e) => Telemetry.emit('kargadan.harness.plan.search.failed', { error: String(e) }).pipe(
                                Effect.as([] as ReadonlyArray<string>))));
                        const candidateIds = ranked.length === 0 ? state.operations : ranked;
                        const candidates = candidateIds.flatMap((id) => Option.fromNullable(catalogByOp.get(id)).pipe(
                            Option.match({ onNone: () => [], onSome: (e) => [e] })));
                        const fallbackId = yield* Option.fromNullable(candidateIds[0]).pipe(Option.match({
                            onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })),
                            onSome: Effect.succeed }));
                        const prompt = JSON.stringify({
                            attempt: state.attempt, candidates: candidates.map((e) => ({
                                commandId:          e.id, description: e.description, params: e.params,
                                requiresObjectRefs: e.requirements.requiresObjectRefs })),
                            compaction:        Option.getOrUndefined(compaction), intent: input.intent,
                            recentObservation: Option.getOrUndefined(state.recentObservation),
                            sceneSummary:      Option.getOrUndefined(sceneSummary), sequence: state.sequence });
                        const generation = Ref.get(chatRef).pipe(
                            Effect.flatMap((chat) => chat.generateObject({
                                prompt, schema: S.Struct({ args: S.Record({ key: S.String, value: S.Unknown }),
                                    commandId: S.NonEmptyTrimmedString }) })),
                            Effect.map((r) => r.value));
                        const planned = yield* Option.match(input.architectOverride, {
                            onNone: () => generation,
                            onSome: (override) => Effect.locally(generation, AiRegistry.SessionOverrideRef, Option.some(override)),
                        }).pipe(Effect.catchAll((e) => Telemetry.emit('kargadan.harness.plan.generate.failed', { error: String(e) }).pipe(
                            Effect.as({ args: {} as Record<string, unknown>, commandId: fallbackId }))));
                        const entry = yield* Option.fromNullable(catalogByOp.get(planned.commandId)).pipe(Option.match({
                            onNone: () => Effect.fail(new CommandDispatchError({ details: { commandId: planned.commandId,
                                message: 'Operation missing from session catalog' }, reason: 'protocol' })),
                            onSome: Effect.succeed }));
                        const paramSet = new Set(entry.params.map((p) => p.name));
                        const args = Object.fromEntries([...Object.entries(planned.args),
                            ..._ParamNorm.filter(([name]) => paramSet.has(name)).map(([name, norm]) => [name, norm(planned.args[name])])]);
                        const missing = entry.params.filter((p) => p.required && !Object.hasOwn(args, p.name));
                        yield* Effect.filterOrFail(Effect.succeed(missing), (m) => m.length === 0,
                            (m) => new CommandDispatchError({ details: { commandId: planned.commandId,
                                message: `Missing required parameters: ${m.map((p) => p.name).join(', ')}` }, reason: 'protocol' }));
                        const kind = entry.dispatch.mode === 'script' ? 'script' as const : (entry.isDestructive ? 'write' as const : 'read' as const);
                        const objectRefs = entry.requirements.requiresObjectRefs
                            ? Array.from({ length: Math.max(1, entry.requirements.minimumObjectRefCount) }, () => writeObjectRef) : undefined;
                        yield* Effect.filterOrFail(Effect.succeed(objectRefs?.length ?? 0),
                            (c) => c >= entry.requirements.minimumObjectRefCount,
                            () => new CommandDispatchError({ details: { commandId: planned.commandId,
                                message: `Command requires at least ${String(entry.requirements.minimumObjectRefCount)} objectRefs` }, reason: 'protocol' }));
                        const command = dispatch.buildCommand(state.identityBase, planned.commandId, args, {
                            attempt: state.attempt, deadlineMs: commandDeadlineMs, objectRefs, operationTag: `plan.execute.${planned.commandId}`,
                            ...(kind === 'write' ? { idempotency: persistence.idempotency(state.identityBase.correlationId, args, state.sequence), undoScope: 'kargadan.phase7' } : {}) });
                        return { command, compaction, operationKind: kind, sceneSummary, startedAt: performance.now() } as const;
                    });
                const execute = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>) =>
                    Match.value(planned.operationKind).pipe(
                        Match.when('write', () =>
                            _runWriteWorkflow(planned.command, state.sequence).pipe(
                                Effect.map((wf) => ({ command: planned.command, result: wf.result, startedAt: planned.startedAt,
                                    workflow: Option.some({ approved: wf.approved, commandId: planned.command.commandId,
                                        executionId: wf.executionId } satisfies typeof _Loop.workflow.Type) })))),
                        Match.orElse(() =>
                            _dispatchCommand(planned.command).pipe(
                                Effect.map((result) => ({ command: planned.command, result, startedAt: planned.startedAt,
                                    workflow: Option.none() })))));
                const verify = (state: _LoopState, _plan: Effect.Effect.Success<ReturnType<typeof plan>>,
                    execution: Effect.Effect.Success<ReturnType<typeof execute>>) =>
                    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: <Necessary>
                    Effect.gen(function* () {
                        const { decoded: sceneDecoded, probe: sceneProbe } = yield* _probeScene(state, 'verify.scene.summary');
                        const objectProbe = yield* Option.fromNullable(execution.command.objectRefs?.[0]).pipe(
                            Option.filter(() => catalogByOp.has(_AuxCommand.objectMetadata)),
                            Option.match({
                                onNone: ()    => Effect.succeed(Option.none<Envelope.Result>()),
                                onSome: (ref) => _dispatchAux(state, _AuxCommand.objectMetadata, { detail: 'compact' },
                                    'verify.object.metadata', [ref]).pipe(Effect.map(Option.some)) }));
                        const signals = { cmdErr: execution.result.status === 'error', objErr: Option.exists(objectProbe, (p) => p.status === 'error'),
                            sceneBad: Option.exists(sceneProbe, (p) => p.status === 'ok') && Option.isNone(sceneDecoded),
                            sceneErr: Option.exists(sceneProbe, (p) => p.status === 'error') };
                        const failureClass: Option.Option<Envelope.FailureClass> = signals.cmdErr
                            ? Option.some(execution.result.error?.failureClass ?? 'fatal')
                            : (signals.sceneErr || signals.objErr) ? Option.some('retryable')
                            : signals.sceneBad ? Option.some('correctable') : Option.none();
                        yield* Option.match(failureClass, {
                            onNone: () => Effect.void,
                            onSome: (fc) => hooks.onFailure({ advice: _FailureGuidance[fc], commandId: execution.command.commandId,
                                failureClass: fc, message: execution.result.error?.message ?? 'Verification detected a non-success status.' }) });
                        const detStatus = Option.isSome(failureClass) ? 'error' as const : 'ok' as const;
                        const visual = yield* (negotiatedCaps.has(_AuxCommand.viewCapture)
                            ? _dispatchAux(state, _AuxCommand.viewCapture,
                                { dpi: 144, height: 900, realtimePasses: 2, transparentBackground: false, width: 1600 }, 'verify.view.capture').pipe(
                                Effect.filterOrFail(
                                    (r): r is Envelope.Result & { readonly result: unknown } => r.status === 'ok' && r.result != null,
                                    (r) => r.status === 'ok' ? 'Capture payload is missing.' : (r.error?.message ?? 'Capture command failed.')),
                                Effect.flatMap((r) => S.decodeUnknown(S.Struct({
                                    activeView: S.String, byteLength: NonNegInt, dpi: S.Number, height: NonNegInt,
                                    imageBase64: S.String, mimeType: S.String, realtimePasses: NonNegInt,
                                    transparentBackground: S.Boolean, width: NonNegInt }))(r.result)),
                                Effect.flatMap((cap) => {
                                    const { imageBase64, ...meta } = cap;
                                    const summary = { ...meta, preview: `${imageBase64.slice(0, 64)}...` };
                                    return ai.model.generateObject({
                                        prompt: JSON.stringify({ deterministicStatus: detStatus,
                                            imageBase64Length: imageBase64.length, imagePrefix: imageBase64.slice(0, 96),
                                            metadata: { activeView: cap.activeView, byteLength: cap.byteLength,
                                                dpi: cap.dpi, height: cap.height, width: cap.width } }),
                                        schema: S.Struct({ confidence: S.Number.pipe(S.between(0, 1)), hints: S.Array(S.String) }),
                                    }).pipe(
                                        Effect.map(    (v) => ({ status: 'captured' as const, summary, vision: v.value })),
                                        Effect.catchAll(() => Effect.succeed({ status: 'captured' as const, summary, vision: undefined })));
                                }),
                                Effect.catchAll((reason) => Effect.succeed({ reason: String(reason), status: 'capture_failed' as const })))
                            : Effect.succeed({ status: 'capability_missing' as const }));
                        const evidence: typeof _Loop.evidence.Type = {
                            deterministicFailureClass: Option.getOrNull(failureClass), deterministicStatus: detStatus, visualStatus: visual.status };
                        const observation = Option.fromNullable(execution.result.result).pipe(Option.map(_sanitizeObservation));
                        return {
                            command: execution.command, evidence, failureClass, observation,
                            operation: detStatus === 'ok' ? 'command.completed' : 'command.failed',
                            params: { commandId: execution.command.commandId, dedupe: execution.result.dedupe, deterministicStatus: detStatus,
                                observationCaptured: Option.isSome(observation), status: execution.result.status,
                                visualStatus: visual.status, workflow: Option.getOrUndefined(execution.workflow) },
                            result: Option.some({
                                dedupe: execution.result.dedupe,
                                deterministic: { objectMetadataProbe: Option.getOrUndefined(objectProbe),
                                    sceneSummary: Option.getOrUndefined(sceneDecoded),
                                    sceneSummaryProbe: Option.getOrUndefined(sceneProbe), status: detStatus },
                                observation: Option.getOrUndefined(observation), status: detStatus,
                                verified: detStatus === 'ok', visual, workflow: Option.getOrUndefined(execution.workflow) }),
                            startedAt: execution.startedAt, status: detStatus } as const;
                    });
                const decide = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>,
                    execution: Effect.Effect.Success<ReturnType<typeof execute>>,
                    verification: Effect.Effect.Success<ReturnType<typeof verify>>) =>
                    Effect.gen(function* () {
                        const fault: Envelope.FailureClass = Option.getOrElse(verification.failureClass, () => 'fatal' as const);
                        const next = Match.value({ fault, ok: verification.status === 'ok' }).pipe(
                            Match.when({ ok: true }, () => 'Completed' as const),
                            Match.when({ fault: 'correctable' }, () => state.correctionCycles < correctionMax ? 'Planning' as const : 'Failed' as const),
                            Match.when({ fault: 'retryable' }, () => state.attempt < retryMax ? 'Planning' as const : 'Failed' as const),
                            Match.orElse(() => 'Failed' as const));
                        const retry = next === 'Planning';
                        const nextState: _LoopState = { ...state,
                            attempt: retry ? state.attempt + 1 : state.attempt, command: Option.none(),
                            correctionCycles: retry && fault === 'correctable' ? state.correctionCycles + 1 : state.correctionCycles,
                            lastCompaction: Option.orElse(planned.compaction, () => state.lastCompaction),
                            recentObservation: verification.observation.pipe(Option.orElse(() => state.recentObservation)),
                            sceneSummary: Option.orElse(planned.sceneSummary, () => state.sceneSummary), sequence: state.sequence + 1,
                            status: next, verificationEvidence: Option.some(verification.evidence),
                            workflowExecution: Option.orElse(execution.workflow, () => state.workflowExecution) };
                        yield* Match.value(fault).pipe(
                            Match.when('compensatable', () => Telemetry.emit('kargadan.compensation.required', { commandId: verification.command.commandId })),
                            Match.when('fatal', () => Effect.logError('kargadan.fatal').pipe(
                                Effect.annotateLogs({ commandId: verification.command.commandId, failureClass: fault }))),
                            Match.orElse(() => Effect.void));
                        return nextState;
                    });
                const persist = (state: _LoopState, planned: Effect.Effect.Success<ReturnType<typeof plan>>,
                    execution: Effect.Effect.Success<ReturnType<typeof execute>>,
                    verification: Effect.Effect.Success<ReturnType<typeof verify>>, decision: _LoopState) =>
                    _persist(state.identityBase, {
                        attempt: decision.attempt, correctionCycles: decision.correctionCycles,
                        lastCompaction: Option.getOrUndefined(decision.lastCompaction), operations: decision.operations,
                        recentObservation: Option.getOrUndefined(decision.recentObservation),
                        sceneSummary: Option.getOrUndefined(decision.sceneSummary), sequence: decision.sequence,
                        status: decision.status, verificationEvidence: Option.getOrUndefined(decision.verificationEvidence),
                        workflowExecution: Option.getOrUndefined(decision.workflowExecution) }, {
                        durationMs: Math.max(0, Math.round(performance.now() - verification.startedAt)),
                        error: verification.status === 'ok' ? Option.none() : Option.some(execution.result.error?.message ?? 'Result error payload is missing'),
                        operation: verification.operation,
                        params: { ...verification.params, compaction: Option.getOrUndefined(planned.compaction),
                            sceneSummary: Option.getOrUndefined(decision.sceneSummary),
                            verificationEvidence: Option.getOrUndefined(decision.verificationEvidence),
                            workflowExecution: Option.getOrUndefined(decision.workflowExecution) },
                        result: verification.result, sequence: decision.sequence, status: verification.status }).pipe(Effect.asVoid);
                const baseline: _LoopState = {
                    attempt: 1, command: Option.none(), correctionCycles: 0, identityBase: input.identityBase,
                    lastCompaction: Option.none(), operations, recentObservation: Option.none(),
                    sceneSummary: Option.some(_DefaultScene), sequence: 0, status: 'Planning',
                    verificationEvidence: Option.none(), workflowExecution: Option.none() };
                const initialState: _LoopState = yield* Option.match(input.resume, {
                    onNone: () => Effect.succeed(baseline),
                    onSome: (r) => S.decodeUnknown(_Loop.state)(r.state).pipe(
                        Effect.map((s): _LoopState => ({ ...s, command: Option.none(), identityBase: input.identityBase,
                            lastCompaction: Option.fromNullable(s.lastCompaction).pipe(Option.filter(S.is(_Loop.compaction))),
                            operations: s.operations.length === 0 ? operations : s.operations,
                            recentObservation: Option.fromNullable(s.recentObservation),
                            sceneSummary: Option.fromNullable(s.sceneSummary).pipe(
                                Option.filter(S.is(_Loop.scene)), Option.orElse(() => Option.some(_DefaultScene))),
                            sequence: Math.max(s.sequence, r.sequence),
                            verificationEvidence: Option.fromNullable(s.verificationEvidence).pipe(Option.filter(S.is(_Loop.evidence))),
                            workflowExecution: Option.fromNullable(s.workflowExecution).pipe(Option.filter(S.is(_Loop.workflow))) })),
                        Effect.tap((s) => Effect.log('kargadan.harness.resume.restored').pipe(
                            Effect.annotateLogs({ operations: s.operations.length, sequence: s.sequence, status: s.status }))),
                        Effect.catchAll((e) => Telemetry.emit('kargadan.harness.resume.decode.failed', { error: String(e) }).pipe(
                            Effect.as({ ...baseline, sequence: r.sequence })))) });
                yield* Ref.set(eventSequence, Math.max(1_000_000, initialState.sequence + 1));
                const fibers = yield* Effect.all([
                    Effect.fork(dispatch.takeEvent().pipe(
                        Effect.flatMap(persistInboundEvent),
                        Effect.tap((es) => Effect.logDebug('kargadan.harness.transport.event').pipe(
                            Effect.annotateLogs({ eventType: es.eventEnvelope.eventType, sequence: es.sequence }))),
                        Effect.catchAll((e) => Telemetry.emit('kargadan.harness.transport.event.failed', { error: String(e) })),
                        Effect.forever)),
                    Effect.fork(dispatch.heartbeat(input.identityBase).pipe(
                        Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                        Effect.catchAll((e) => Telemetry.emit('kargadan.harness.heartbeat.failed', { error: String(e) })),
                        Effect.zipRight(Effect.sleep(Duration.millis(heartbeatIntervalMs))), Effect.forever)) ]);
                const _stage = <A, E, R>(state: _LoopState, stage: 'plan' | 'execute' | 'verify' | 'decide' | 'persist',
                    effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
                    hooks.onStage({ attempt: state.attempt, phase: 'start', sequence: state.sequence, stage, status: state.status }).pipe(
                        Effect.zipRight(Effect.exit(effect)),
                        Effect.tap((exit) => hooks.onStage({ attempt: state.attempt, phase: 'end', sequence: state.sequence, stage,
                            status: Exit.match(exit, {
                                onFailure: () => 'Failed' as const,
                                onSuccess: (value) => Match.value(stage).pipe(
                                    Match.when('decide', () => (value as _LoopState).status), Match.orElse(() => state.status)) }) })),
                        Effect.flatten);
                const finalState = yield* ai.runAgentCore({
                    decide:  (s, p: Parameters<typeof decide>[1], e: Parameters<typeof decide>[2], v: Parameters<typeof decide>[3]) =>
                        _stage(s, 'decide', decide(s, p, e, v)),
                    execute: (s, p: Parameters<typeof execute>[1]) => _stage(s, 'execute', execute(s, p)),
                    initialState,
                    isTerminal: (s) => s.status !== 'Planning',
                    persist: (s, p: Parameters<typeof persist>[1], e: Parameters<typeof persist>[2],
                        v: Parameters<typeof persist>[3], d: Parameters<typeof persist>[4]) => _stage(s, 'persist', persist(s, p, e, v, d)),
                    plan:    (s) => _stage(s, 'plan', plan(s)),
                    verify:  (s, p: Parameters<typeof verify>[1], e: Parameters<typeof verify>[2]) => _stage(s, 'verify', verify(s, p, e)),
                }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
                const trace = yield* persistence.trace(finalState.identityBase.sessionId);
                return { state: finalState, trace } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
