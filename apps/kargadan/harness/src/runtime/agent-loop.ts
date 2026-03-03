import { AiService } from '@parametric-portal/ai/service';
import { AgentPersistenceService } from '@parametric-portal/database/agent-persistence';
import { Duration, Effect, Fiber, Match, Option, Ref, Schema as S } from 'effect';
import { HarnessConfig } from '../config';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';
import { NonNegInt, Operation, type Envelope } from '../protocol/schemas';

// --- [TYPES] -----------------------------------------------------------------

type LoopState = typeof _LoopStateCodec.Type & {
    readonly command:      Option.Option<Envelope.Command>;
    readonly identityBase: Envelope.IdentityBase;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _RecoveryPolicy = {
    compensatable: { canRetry: false, preAction: 'compensate', usesCorrections: false },
    correctable:   { canRetry: true,  preAction: 'none',       usesCorrections: true  },
    fatal:         { canRetry: false, preAction: 'log',        usesCorrections: false },
    retryable:     { canRetry: true,  preAction: 'none',       usesCorrections: false },
} as const satisfies Record<Envelope.FailureClass, { canRetry: boolean; preAction: 'compensate' | 'log' | 'none'; usesCorrections: boolean }>;

// --- [SCHEMA] ----------------------------------------------------------------

const _CatalogSearchProjection = S.Struct({
    items: S.Array(S.Struct({
        metadata: S.NullOr(S.Record({ key: S.String, value: S.Unknown })),
    })),
});
const _LoopStateCodec = S.Struct({
    attempt:          S.Int.pipe(S.greaterThanOrEqualTo(1)),
    correctionCycles: NonNegInt,
    operations:       S.Array(Operation),
    sequence:         NonNegInt,
    status:           S.Literal('Planning', 'Completed', 'Failed'),
});
const _Plan = S.Struct({
    args:      S.Record({ key: S.String, value: S.Unknown }),
    commandId: S.NonEmptyTrimmedString,
});

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [ai, dispatch, persistence, commandDeadlineMs, retryMax, correctionMax, heartbeatIntervalMs, fallbackOperations, writeObjectRef] = yield* Effect.all([
            AiService, CommandDispatch, AgentPersistenceService, HarnessConfig.commandDeadlineMs,
            HarnessConfig.retryMaxAttempts, HarnessConfig.correctionCycles, HarnessConfig.heartbeatIntervalMs, HarnessConfig.resolveLoopOperations,
            HarnessConfig.resolveWriteObjectRef,
        ]);
        const eventSequence = yield* Ref.make(1_000_000);
        const run = Effect.fn('AgentLoop.handle')((input: {
            readonly catalog: ReadonlyArray<Envelope.CatalogEntry>;
            readonly identityBase: Envelope.IdentityBase;
            readonly intent: string;
            readonly resume: Option.Option<{ readonly chatJson: string; readonly sequence: number; readonly state: unknown }>;
        }) =>
            Effect.gen(function* () {
                const catalogByOperation = new Map(input.catalog.map((entry) => [entry.id, entry] as const));
                const operations = Match.value(input.catalog.filter((entry) => entry.dispatch.mode !== 'script').map((entry) => entry.id)).pipe(
                    Match.when((decoded) => decoded.length === 0, () => fallbackOperations),
                    Match.orElse((decoded) => decoded),
                );
                const initialChat = yield* Option.match(input.resume, {
                    onNone: () => ai.model.chat(),
                    onSome: (resumePayload) =>
                        ai.model.deserializeChat(resumePayload.chatJson).pipe(
                            Effect.catchAll((error) => Effect.logWarning('kargadan.harness.resume.chat.decode.failed', { error: String(error) }).pipe(
                                Effect.zipRight(ai.model.chat()),
                            )),
                        ),
                });
                const chatRef = yield* Ref.make(initialChat);
                const persistWithChat = (
                    identity: { readonly appId: string; readonly correlationId: string; readonly sessionId: string },
                    loopState: unknown,
                    call: {
                        readonly durationMs: number;
                        readonly error:      Option.Option<string>;
                        readonly operation:  string;
                        readonly params:     Record<string, unknown>;
                        readonly result:     Option.Option<unknown>;
                        readonly sequence:   number;
                        readonly status:     'ok' | 'error';
                    },
                ) =>
                    Ref.get(chatRef).pipe(
                        Effect.flatMap((chat) => ai.model.serializeChat(chat).pipe(
                            Effect.catchAll((error) => Effect.logWarning('kargadan.harness.chat.serialize.failed', { error: String(error) }).pipe(Effect.as(''))),
                        )),
                        Effect.flatMap((chatJson) =>
                            persistence.persistCall(identity, loopState, { ...call, chatJson })),
                    );
                const persistInboundEvent = (eventEnvelope: Envelope.Event) =>
                    Effect.gen(function* () {
                        const start = performance.now();
                        const sequence = yield* Ref.modify(eventSequence, (current) => [current, current + 1] as const);
                        const [batchSummary, totalCount] = Match.value(eventEnvelope).pipe(
                            Match.when({ eventType: 'stream.compacted' }, (e) => [e.delta, e.delta.totalCount] as const),
                            Match.orElse(() => [undefined, 0] as const));
                        yield* persistWithChat(eventEnvelope, { eventType: eventEnvelope.eventType, sequence }, {
                            durationMs: Math.max(0, Math.round(performance.now() - start)), error: Option.none(), operation: `transport.event.${eventEnvelope.eventType}`,
                            params: { causationRequestId: eventEnvelope.causationRequestId, delta: eventEnvelope.delta,
                                eventType: eventEnvelope.eventType, sourceRevision: eventEnvelope.sourceRevision, ...(batchSummary ? { batchSummary } : {}) },
                            result: Option.some({ eventId: eventEnvelope.eventId }), sequence, status: 'ok',
                        });
                        return { eventEnvelope, sequence, totalCount } as const;
                    });
                const planStage = (state: LoopState) =>
                    Effect.gen(function* () {
                        const searchLimit = Math.max(1, Math.min(8, input.catalog.length));
                        const rankedCandidates = yield* ai.searchQuery({
                            entityTypes: ['command'],
                            includeSnippets: false,
                            term: input.intent,
                        }, { limit: searchLimit }).pipe(
                            Effect.flatMap((raw) => S.decodeUnknown(_CatalogSearchProjection)(raw)),
                            Effect.map((result) => result.items.flatMap((item) =>
                                Option.fromNullable(item.metadata?.['id']).pipe(
                                    Option.filter(S.is(S.NonEmptyTrimmedString)),
                                    Option.match({ onNone: () => [], onSome: (id) => [id] }),
                                ),
                            )),
                            Effect.map((ids) => [...new Set(ids.filter((id) => catalogByOperation.has(id)))]),
                            Effect.catchAll((error) => Effect.logWarning('kargadan.harness.plan.search.failed', { error: String(error) }).pipe(Effect.as([] as ReadonlyArray<string>))),
                        );
                        const candidateIds = Match.value(rankedCandidates).pipe(
                            Match.when((ids: ReadonlyArray<string>) => ids.length === 0, () => state.operations),
                            Match.orElse((ids: ReadonlyArray<string>) => ids),
                        );
                        const candidateCatalog = candidateIds.flatMap((id) =>
                            Option.fromNullable(catalogByOperation.get(id)).pipe(Option.match({ onNone: () => [], onSome: (entry) => [entry] })));
                        const fallbackCommandId = yield* Option.fromNullable(candidateIds[0]).pipe(
                            Option.match({
                                onNone: () => Effect.fail(new CommandDispatchError({ details: { message: 'No operation available for PLAN' }, reason: 'protocol' })),
                                onSome: Effect.succeed,
                            }),
                        );
                        const plannerPrompt = JSON.stringify({
                            attempt: state.attempt,
                            candidates: candidateCatalog.map((entry) => ({
                                commandId: entry.id,
                                description: entry.description,
                                params: entry.params,
                                requiresObjectRefs: entry.requirements.requiresObjectRefs,
                            })),
                            intent: input.intent,
                            sequence: state.sequence,
                        });
                        const planned = yield* Ref.get(chatRef).pipe(
                            Effect.flatMap((chat) =>
                                chat.generateObject({
                                    prompt: plannerPrompt,
                                    schema: _Plan,
                                })),
                            Effect.map((response) => response.value),
                            Effect.catchAll((error) => Effect.logWarning('kargadan.harness.plan.generate.failed', { error: String(error) }).pipe(
                                Effect.as({ args: {}, commandId: fallbackCommandId } satisfies typeof _Plan.Type),
                            )),
                        );
                        const catalogEntry = yield* Option.fromNullable(catalogByOperation.get(planned.commandId)).pipe(
                            Option.match({
                                onNone: () => Effect.fail(new CommandDispatchError({ details: { commandId: planned.commandId, message: 'Operation missing from session catalog' }, reason: 'protocol' })),
                                onSome: Effect.succeed,
                            }),
                        );
                        const missingRequired = catalogEntry.params
                            .filter((parameter) => parameter.required && !Object.hasOwn(planned.args, parameter.name))
                            .map((parameter) => parameter.name);
                        yield* Match.value(missingRequired.length).pipe(
                            Match.when(0, () => Effect.void),
                            Match.orElse(() => Effect.fail(new CommandDispatchError({
                                details: { commandId: planned.commandId, message: `Missing required parameters: ${missingRequired.join(', ')}` },
                                reason: 'protocol',
                            }))),
                        );
                        const operationKind = Match.value(catalogEntry.dispatch.mode).pipe(
                            Match.when('script', () => 'script' as const),
                            Match.orElse(() => catalogEntry.isDestructive ? 'write' as const : 'read' as const),
                        );
                        const requiredObjectRefs = catalogEntry.requirements.requiresObjectRefs
                            ? Math.max(1, catalogEntry.requirements.minimumObjectRefCount)
                            : 0;
                        const objectRefs = requiredObjectRefs === 0 ? undefined : Array.from({ length: requiredObjectRefs }, () => writeObjectRef);
                        yield* Match.value((objectRefs?.length ?? 0) >= catalogEntry.requirements.minimumObjectRefCount).pipe(
                            Match.when(true, () => Effect.void),
                            Match.orElse(() => Effect.fail(new CommandDispatchError({
                                details: {
                                    commandId: planned.commandId,
                                    message: `Command requires at least ${String(catalogEntry.requirements.minimumObjectRefCount)} objectRefs`,
                                },
                                reason: 'protocol',
                            }))),
                        );
                        const command: Envelope.Command = {
                            _tag: 'command',
                            ...state.identityBase,
                            args: planned.args,
                            commandId:   planned.commandId,
                            deadlineMs:  commandDeadlineMs,
                            idempotency: operationKind === 'write' ? persistence.idempotency(state.identityBase.correlationId, planned.args, state.sequence) : undefined,
                            objectRefs,
                            requestId:   crypto.randomUUID(),
                            undoScope:   operationKind === 'write' ? 'kargadan.phase5' : undefined,
                        };
                        return { command, startedAt: performance.now() } as const;
                    });
                const executeStage = (_state: LoopState, plan: Effect.Effect.Success<ReturnType<typeof planStage>>) =>
                    dispatch.execute(plan.command).pipe(
                        Effect.catchTag('CommandDispatchError', (error) => Effect.succeed({
                            _tag: 'result',
                            appId: plan.command.appId,
                            correlationId: plan.command.correlationId,
                            dedupe: { decision: 'rejected', originalRequestId: plan.command.requestId },
                            error: {
                                code: 'DISPATCH_ERROR',
                                details: error,
                                failureClass: error.failureClass ?? Match.value(error.reason).pipe(
                                    Match.when('protocol', () => 'fatal' as const),
                                    Match.when('rejected', () => 'fatal' as const),
                                    Match.when('disconnected', () => 'retryable' as const),
                                    Match.when('transport', () => 'retryable' as const),
                                    Match.exhaustive,
                                ),
                                message: error.message,
                            },
                            requestId: plan.command.requestId,
                            sessionId: plan.command.sessionId,
                            status: 'error',
                        } satisfies Envelope.Result)),
                        Effect.map((result) => ({ command: plan.command, result: result as Envelope.Result, startedAt: plan.startedAt })),
                    );
                const verifyStage = (_state: LoopState, _plan: Effect.Effect.Success<ReturnType<typeof planStage>>, execution: Effect.Effect.Success<ReturnType<typeof executeStage>>) =>
                    Effect.succeed({
                        command: execution.command,
                        failureClass: execution.result.status === 'ok'
                            ? Option.none<Envelope.FailureClass>()
                            : Option.some(execution.result.error?.failureClass ?? 'fatal'),
                        operation: execution.result.status === 'ok' ? 'command.completed' : 'command.failed',
                        params: { commandId: execution.command.commandId, dedupe: execution.result.dedupe, status: execution.result.status },
                        result: Option.some({ dedupe: execution.result.dedupe, status: execution.result.status, verified: execution.result.status === 'ok' }),
                        startedAt: execution.startedAt,
                        status: execution.result.status === 'ok' ? 'ok' : 'error',
                    } as const);
                const decideStage = (
                    state: LoopState,
                    _plan: Effect.Effect.Success<ReturnType<typeof planStage>>,
                    _execution: Effect.Effect.Success<ReturnType<typeof executeStage>>,
                    verification: Effect.Effect.Success<ReturnType<typeof verifyStage>>,
                ) => Effect.gen(function* () {
                    const current: LoopState = { ...state, command: Option.some(verification.command), sequence: state.sequence + 1 };
                    const failureClass = Option.getOrElse(verification.failureClass, () => 'fatal' as const);
                    const policy = _RecoveryPolicy[failureClass];
                    const withinLimit = verification.status === 'error' && policy.canRetry
                        ? policy.usesCorrections ? state.correctionCycles < correctionMax : state.attempt < retryMax
                        : false;
                    const nextState: LoopState = Match.value({ status: verification.status, withinLimit }).pipe(
                        Match.when({ status: 'ok', withinLimit: true }, () => ({ ...current, command: Option.none(), status: 'Completed' as const })),
                        Match.when({ status: 'ok', withinLimit: false }, () => ({ ...current, command: Option.none(), status: 'Completed' as const })),
                        Match.when({ status: 'error', withinLimit: true }, () => ({
                            ...current,
                            attempt: state.attempt + 1,
                            command: Option.none(),
                            correctionCycles: state.correctionCycles + (policy.usesCorrections ? 1 : 0),
                            status: 'Planning' as const,
                        })),
                        Match.orElse(() => ({ ...current, command: Option.none(), status: 'Failed' as const })),
                    );
                    yield* Match.value(policy.preAction).pipe(
                        Match.when('compensate', () => Effect.logWarning('kargadan.compensation.required', { commandId: verification.command.commandId })),
                        Match.when('log', () => Effect.logError('kargadan.fatal', { commandId: verification.command.commandId, failureClass })),
                        Match.when('none', () => Effect.void),
                        Match.exhaustive,
                    );
                    return nextState;
                });
                const persistStage = (
                    state: LoopState,
                    _plan: Effect.Effect.Success<ReturnType<typeof planStage>>,
                    execution: Effect.Effect.Success<ReturnType<typeof executeStage>>,
                    verification: Effect.Effect.Success<ReturnType<typeof verifyStage>>,
                    decision: LoopState,
                ) =>
                    persistWithChat(state.identityBase, {
                        attempt:          decision.attempt,
                        correctionCycles: decision.correctionCycles,
                        operations:       decision.operations,
                        sequence:         decision.sequence,
                        status:           decision.status,
                    }, {
                        durationMs: Math.max(0, Math.round(performance.now() - verification.startedAt)),
                        error:     verification.status === 'ok' ? Option.none() : Option.some(execution.result.error?.message ?? 'Result error payload is missing'),
                        operation: verification.operation,
                        params:    verification.params,
                        result:    verification.result,
                        sequence:  decision.sequence,
                        status:    verification.status,
                    }).pipe(Effect.asVoid);
                const baseline: LoopState = {
                    attempt: 1,
                    command: Option.none(),
                    correctionCycles: 0,
                    identityBase: input.identityBase,
                    operations,
                    sequence: 0,
                    status: 'Planning',
                };
                const initialState: LoopState = yield* Option.match(input.resume, {
                    onNone: () => Effect.succeed(baseline),
                    onSome: (resumePayload) =>
                        S.decodeUnknown(_LoopStateCodec)(resumePayload.state).pipe(
                            Effect.map((restored): LoopState => ({
                                ...restored,
                                command: Option.none(),
                                identityBase: input.identityBase,
                                operations: restored.operations.length === 0 ? operations : restored.operations,
                                sequence: Math.max(restored.sequence, resumePayload.sequence),
                            })),
                            Effect.tap((restored) => Effect.log('kargadan.harness.resume.restored', { operations: restored.operations.length, sequence: restored.sequence, status: restored.status })),
                            Effect.catchAll((error) => Effect.logWarning('kargadan.harness.resume.decode.failed', { error: String(error) }).pipe(
                                Effect.as({ ...baseline, sequence: resumePayload.sequence }),
                            )),
                        ),
                });
                yield* Ref.set(eventSequence, Math.max(1_000_000, initialState.sequence + 1));
                const heartbeatLoop = dispatch.heartbeat(input.identityBase).pipe(
                    Effect.tap(() => Effect.logDebug('kargadan.harness.heartbeat')),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.heartbeat.failed', { error: String(error) })),
                    Effect.zipRight(Effect.sleep(Duration.millis(heartbeatIntervalMs))),
                    Effect.forever,
                );
                const inboundLoop = dispatch.takeEvent().pipe(
                    Effect.flatMap(persistInboundEvent),
                    Effect.tap((es) => Effect.logDebug('kargadan.harness.transport.event', { eventType: es.eventEnvelope.eventType, sequence: es.sequence })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.transport.event.failed', { error: String(error) })),
                    Effect.forever,
                );
                const fibers = yield* Effect.all([Effect.fork(inboundLoop), Effect.fork(heartbeatLoop)]);
                const finalState = yield* ai.runAgentCore({
                    decide: decideStage,
                    execute: executeStage,
                    initialState,
                    isTerminal: (state) => state.status === 'Completed' || state.status === 'Failed',
                    persist: persistStage,
                    plan: planStage,
                    verify: verifyStage,
                }).pipe(
                    Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })),
                );
                const trace = yield* persistence.trace(finalState.identityBase.sessionId);
                return { state: finalState, trace } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
