import { Data, Duration, Effect, Fiber, Match, Option, Ref, Schema as S, pipe } from 'effect';
import type {
    CommandEnvelopeSchema, EnvelopeIdentitySchema, EventEnvelopeSchema,
    FailureReasonSchema, ResultEnvelopeSchema, TelemetryContextSchema,
} from '../protocol/schemas';
import { HarnessConfig } from '../config';
import { CheckpointService, hashCanonicalState } from '../persistence/checkpoint';
import { CommandDispatch, CommandDispatchError } from '../protocol/dispatch';

// --- [TYPES] -----------------------------------------------------------------

type IdentityBase = { readonly appId: string; readonly protocolVersion: typeof EnvelopeIdentitySchema.fields.protocolVersion.Type; readonly runId: string; readonly sessionId: string; readonly traceId: string };
type LoopState = { readonly attempt: number; readonly command: typeof CommandEnvelopeSchema.Type | undefined; readonly correctionCycles: number; readonly identityBase: IdentityBase; readonly operations: ReadonlyArray<typeof CommandEnvelopeSchema.fields.operation.Type>; readonly sequence: number; readonly status: 'Created' | 'Planning' | 'Executing' | 'Verifying' | 'Persisting' | 'Deciding' | 'Completed' | 'Failed' | 'Compensating' };
type SceneObjectRef = NonNullable<typeof CommandEnvelopeSchema.Type['objectRefs']>[number];
type Verification = Data.TaggedEnum<{ Failed: { readonly error: typeof FailureReasonSchema.Type & { readonly details?: unknown } }; Verified: { readonly ok: true } }>;

// --- [SCHEMA] ----------------------------------------------------------------

const Verification = Data.taggedEnum<Verification>();

// --- [CONSTANTS] -------------------------------------------------------------

const writeOperations = new Set<typeof CommandEnvelopeSchema.fields.operation.Type>(['write.annotation.update', 'write.layer.update', 'write.object.create', 'write.object.delete', 'write.object.update', 'write.viewport.update']);
const eventSequenceBase = 1_000_000;

// --- [FUNCTIONS] -------------------------------------------------------------

const planCommand = (input: { readonly deadline: number; readonly state: LoopState; readonly writeObjectRef: SceneObjectRef }) =>
    pipe(
        Option.fromNullable(input.state.command),
        Option.map((command) => ({ ...command, identity: { ...command.identity, issuedAt: new Date() }, telemetryContext: { ...command.telemetryContext, attempt: input.state.attempt } }) satisfies typeof CommandEnvelopeSchema.Type),
        Option.orElse(() => Option.fromNullable(input.state.operations[0]).pipe(Option.map((operation) => {
            const { identityBase: base, sequence } = input.state;
            const requestId = crypto.randomUUID();
            const isWrite = writeOperations.has(operation);
            const identity = { appId: base.appId, issuedAt: new Date(), protocolVersion: base.protocolVersion, requestId, runId: base.runId, sessionId: base.sessionId } as const satisfies typeof EnvelopeIdentitySchema.Type;
            const telemetryContext = { attempt: input.state.attempt, operationTag: 'PLAN', spanId: requestId.replaceAll('-', ''), traceId: base.traceId } as const satisfies typeof TelemetryContextSchema.Type;
            const payload = isWrite
                ? ({ operationId: `${base.runId}:${sequence}`, patch: { layer: 'default', name: 'phase-3' } } as const)
                : ({ includeAttributes: true, scope: 'active' } as const);
            return {
                _tag: 'command',
                deadlineMs: input.deadline,
                idempotency: isWrite ? { idempotencyKey: `run:${base.runId.slice(0, 8)}:seq:${String(sequence).padStart(4, '0')}`, payloadHash: hashCanonicalState(payload) } : undefined,
                identity,
                objectRefs: [input.writeObjectRef],
                operation,
                payload,
                telemetryContext,
                undoScope: isWrite ? 'kargadan.phase3' : undefined,
            } satisfies typeof CommandEnvelopeSchema.Type;
        }))),
        Option.match({ onNone: () => Effect.fail(CommandDispatchError.of('protocol', { message: 'No operation available for PLAN' })), onSome: Effect.succeed }),
    );

// --- [SERVICES] --------------------------------------------------------------

class AgentLoop extends Effect.Service<AgentLoop>()('kargadan/AgentLoop', {
    effect: Effect.gen(function* () {
        const [dispatch, checkpoint, commandDeadlineMs, retryMax, correctionMax, operations, writeObjectRef, simulatedPluginRevision] = yield* Effect.all([
            CommandDispatch,
            CheckpointService,
            HarnessConfig.commandDeadlineMs,
            HarnessConfig.retryMaxAttempts,
            HarnessConfig.correctionCycles,
            HarnessConfig.resolveLoopOperations,
            HarnessConfig.resolveWriteObjectRef,
            HarnessConfig.simulatedPluginRevision,
        ]);
        const eventSequence = yield* Ref.make(eventSequenceBase);
        const normalizeDispatchError = (error: unknown) => Match.value(error).pipe(Match.when(Match.instanceOf(CommandDispatchError), (dispatchError) => dispatchError), Match.orElse(() => CommandDispatchError.of('transport', { error: String(error) })));
        const persistInboundEvent = (eventEnvelope: typeof EventEnvelopeSchema.Type) =>
            Effect.gen(function* () {
                const sequence = yield* Ref.modify(eventSequence, (current) => [current, current + 1] as const);
                const summary = yield* Match.value(eventEnvelope.eventType).pipe(
                    Match.when('stream.compacted', () => S.decodeUnknown(S.Struct({
                        batchWindowMs:    S.Int.pipe(S.greaterThanOrEqualTo(0)),
                        categories:       S.Array(S.Struct({ category: S.NonEmptyTrimmedString, count: S.Int.pipe(S.greaterThanOrEqualTo(0)), subtypes: S.Array(S.NonEmptyTrimmedString) })),
                        containsUndoRedo: S.Boolean,
                        totalCount:       S.Int.pipe(S.greaterThanOrEqualTo(0)),
                    }))(eventEnvelope.delta).pipe(Effect.map(Option.some))),
                    Match.orElse(() => Effect.succeed(Option.none())),
                );
                const batchSummary = Option.getOrUndefined(summary);
                yield* checkpoint.appendTransition({
                    appId: eventEnvelope.identity.appId,
                    createdAt: new Date(),
                    eventId: eventEnvelope.eventId,
                    eventType: `transport.event.${eventEnvelope.eventType}`,
                    payload: {
                        causationRequestId: eventEnvelope.causationRequestId,
                        delta: eventEnvelope.delta,
                        eventType: eventEnvelope.eventType,
                        sourceRevision: eventEnvelope.sourceRevision,
                        ...(batchSummary === undefined ? {} : { batchSummary }),
                    },
                    requestId: eventEnvelope.identity.requestId,
                    runId: eventEnvelope.identity.runId,
                    sequence,
                    sessionId: eventEnvelope.identity.sessionId,
                    telemetryContext: { ...eventEnvelope.telemetryContext, operationTag: 'EVENT' },
                });
                return { eventEnvelope, sequence, totalCount: batchSummary?.totalCount ?? 0 } as const;
            });
        const dispatchFailure = (command: typeof CommandEnvelopeSchema.Type, error: unknown): typeof ResultEnvelopeSchema.Type => {
            const dispatchError = normalizeDispatchError(error);
            return {
                _tag: 'result',
                dedupe: { decision: 'rejected', originalRequestId: command.identity.requestId },
                error: { details: dispatchError, reason: { code: 'DISPATCH_ERROR', failureClass: dispatchError.failureClass ?? 'retryable', message: dispatchError.message } },
                execution: { durationMs: 0, pluginRevision: simulatedPluginRevision, sourceRevision: 0 },
                identity: command.identity,
                result: {},
                status: 'error',
                telemetryContext: { ...command.telemetryContext, operationTag: 'EXECUTE' },
            } satisfies typeof ResultEnvelopeSchema.Type;
        };
        const persist = (state: LoopState, command: typeof CommandEnvelopeSchema.Type, result: typeof ResultEnvelopeSchema.Type): Effect.Effect<LoopState, unknown, never> => {
            const verification: Verification = result.status === 'ok'
                ? Verification.Verified({ ok: true })
                : Verification.Failed({ error: result.error === undefined ? { code: 'UNKNOWN_FAILURE', failureClass: 'fatal', message: 'Result error payload is missing' } : { ...result.error.reason, ...(result.error.details === undefined ? {} : { details: result.error.details }) } });
            const { appId, runId, sessionId } = state.identityBase;
            const nextSequence = state.sequence + 1;
            const nextState = { ...state, command, sequence: nextSequence };
            const decide = Verification.$match(verification, {
                Failed: ({ error }) => {
                    const failedState = { ...nextState, status: 'Failed' } satisfies LoopState;
                    const eventBase = { appId, createdAt: new Date(), eventId: crypto.randomUUID(), idempotency: command.idempotency, requestId: command.identity.requestId, runId, sequence: nextSequence + 1, sessionId, telemetryContext: { ...command.telemetryContext, attempt: state.attempt, operationTag: 'DECIDE' } } as const;
                    return Match.value(error.failureClass).pipe(
                        Match.when('compensatable', () => checkpoint.appendTransition({ ...eventBase, eventType: 'command.compensate', payload: { code: error.code, compensation: 'required' } }).pipe(Effect.as(failedState))),
                        Match.when('correctable', () => Effect.succeed(state.correctionCycles < correctionMax ? ({ ...nextState, attempt: state.attempt + 1, correctionCycles: state.correctionCycles + 1, status: 'Planning' } satisfies LoopState) : failedState)),
                        Match.when('fatal', () => checkpoint.appendArtifact({ appId, artifactId: crypto.randomUUID(), artifactType: 'incident', body: error.message, createdAt: new Date(), metadata: { code: error.code, escalated: true, failureClass: error.failureClass }, runId, sourceEventSequence: nextSequence, title: 'Fatal failure escalation', updatedAt: new Date() }).pipe(Effect.as(failedState))),
                        Match.when('retryable', () => Effect.succeed(state.attempt < retryMax ? ({ ...nextState, attempt: state.attempt + 1, status: 'Planning' } satisfies LoopState) : failedState)),
                        Match.exhaustive,
                    );
                },
                Verified: () => {
                    const remaining = state.operations.slice(1);
                    return Effect.succeed(remaining.length === 0 ? ({ ...nextState, command: undefined, operations: [], status: 'Completed' } satisfies LoopState) : ({ ...nextState, attempt: 1, command: undefined, correctionCycles: 0, operations: remaining, status: 'Planning' } satisfies LoopState));
                },
            });
            return checkpoint.appendTransition({
                appId,
                createdAt: new Date(),
                eventId: crypto.randomUUID(),
                eventType: verification._tag === 'Verified' ? 'command.completed' : 'command.failed',
                idempotency: command.idempotency,
                payload: { dedupe: result.dedupe, status: result.status, verification },
                requestId: command.identity.requestId,
                runId,
                sequence: nextSequence,
                sessionId,
                telemetryContext: { ...command.telemetryContext, attempt: state.attempt, operationTag: 'PERSIST' },
            }).pipe(
                Effect.andThen(checkpoint.snapshot({ appId, runId, sequence: nextSequence, state: { operation: command.operation, status: verification._tag } })),
                Effect.andThen(decide),
            );
        };
        const execute = (state: LoopState, command: typeof CommandEnvelopeSchema.Type): Effect.Effect<LoopState, unknown, never> => dispatch.command.execute(command).pipe(Effect.catchAll((error) => Effect.succeed(dispatchFailure(command, error))), Effect.flatMap((result) => persist(state, command, result)));
        const plan = (state: LoopState): Effect.Effect<LoopState, unknown, never> =>
            Effect.gen(function* () {
                const command = yield* planCommand({ deadline: commandDeadlineMs, state, writeObjectRef });
                const { appId, runId, sessionId } = state.identityBase;
                yield* checkpoint.appendTransition({ appId, createdAt: new Date(), eventId: crypto.randomUUID(), eventType: 'command.plan', idempotency: command.idempotency, payload: { operation: command.operation, status: state.status }, requestId: command.identity.requestId, runId, sequence: state.sequence + 1, sessionId, telemetryContext: command.telemetryContext });
                return yield* execute(state, command);
            });
        const run = Effect.fn('AgentLoop.handle')((input: { readonly identityBase: IdentityBase; readonly token: string }) =>
            Effect.gen(function* () {
                const connected = yield* dispatch.protocol.handshake({
                    identity: { appId: input.identityBase.appId, issuedAt: new Date(), protocolVersion: input.identityBase.protocolVersion, requestId: crypto.randomUUID(), runId: input.identityBase.runId, sessionId: input.identityBase.sessionId },
                    token: input.token,
                    traceId: input.identityBase.traceId,
                });
                const heartbeatLoop = dispatch.protocol.heartbeat(connected.identity, input.identityBase.traceId).pipe(
                    Effect.tap((heartbeat) => Effect.logDebug('kargadan.harness.heartbeat', { mode: heartbeat.mode, requestId: heartbeat.identity.requestId, runId: heartbeat.identity.runId })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.heartbeat.failed', { error: String(error), runId: connected.identity.runId })),
                    Effect.zipRight(HarnessConfig.heartbeatIntervalMs.pipe(Effect.flatMap((ms) => Effect.sleep(Duration.millis(ms))))),
                    Effect.forever,
                );
                const inboundLoop = dispatch.transport.takeEvent().pipe(
                    Effect.flatMap((eventEnvelope) => persistInboundEvent(eventEnvelope)),
                    Effect.tap((eventState) => Effect.logDebug('kargadan.harness.transport.event', { batchCount: eventState.totalCount, eventId: eventState.eventEnvelope.eventId, eventType: eventState.eventEnvelope.eventType, requestId: eventState.eventEnvelope.identity.requestId, runId: eventState.eventEnvelope.identity.runId, sequence: eventState.sequence })),
                    Effect.catchAll((error) => Effect.logWarning('kargadan.harness.transport.event.failed', { error: String(error), runId: connected.identity.runId })),
                    Effect.forever,
                );
                const fibers = yield* Effect.all([Effect.fork(inboundLoop), Effect.fork(heartbeatLoop)]);
                const initialState: LoopState = {
                    attempt: 1,
                    command: undefined,
                    correctionCycles: 0,
                    identityBase: { appId: connected.identity.appId, protocolVersion: connected.identity.protocolVersion, runId: connected.identity.runId, sessionId: connected.identity.sessionId, traceId: input.identityBase.traceId },
                    operations,
                    sequence: 0,
                    status: 'Planning',
                };
                const finalState = yield* Effect.iterate(initialState, { body: plan, while: (state) => state.status !== 'Completed' && state.status !== 'Failed' }).pipe(Effect.ensuring(Effect.forEach(fibers, Fiber.interrupt, { discard: true })));
                const replay = yield* checkpoint.replay({ runId: finalState.identityBase.runId });
                return { replay, state: finalState } as const;
            }),
        );
        return { handle: run } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { AgentLoop };
export type { LoopState };
