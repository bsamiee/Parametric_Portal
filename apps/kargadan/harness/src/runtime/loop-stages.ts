/**
 * Pure stage functions for PLAN command construction, DECIDE branching, and result verification in the agent loop.
 * Generates deterministic idempotency keys and SHA-256 payload hashes; no Effects — all IO delegated to AgentLoop.
 */
import { createHash } from 'node:crypto';
import type { Kargadan } from '@parametric-portal/types/kargadan';
import { Effect, Match, Option, pipe } from 'effect';
import { type LoopState, Verification } from '../loop-types';
import { CommandDispatchError } from '../protocol/dispatch';
import type { PersistenceTrace } from './persistence-trace';

// --- [FUNCTIONS] -------------------------------------------------------------

const sortKeysDeep = (value: unknown): unknown =>
    Match.value(value).pipe(
        Match.when(Array.isArray, (arr) => arr.map(sortKeysDeep)),
        Match.when(
            (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object',
            (obj) =>
                Object.fromEntries(
                    Object.entries(obj)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, v]) => [k, sortKeysDeep(v)] as const),
                ),
        ),
        Match.orElse((v) => v),
    );
const planCommand = (input: { readonly deadline: number; readonly state: LoopState.Type }) =>
    pipe(
        Option.fromNullable(input.state.command),
        Option.map(
            (envelope) =>
                ({
                    ...envelope,
                    identity: { ...envelope.identity, issuedAt: new Date() },
                    telemetryContext: { ...envelope.telemetryContext, attempt: input.state.attempt },
                }) satisfies Kargadan.CommandEnvelope,
        ),
        Option.orElse(() =>
            Option.fromNullable(input.state.operations[0]).pipe(
                Option.map((operation) => {
                    const identity = {
                        appId:     input.state.identityBase.appId,
                        issuedAt:  new Date(),
                        protocolVersion: input.state.identityBase.protocolVersion,
                        requestId: crypto.randomUUID(),
                        runId:     input.state.identityBase.runId,
                        sessionId: input.state.identityBase.sessionId,
                    } as const satisfies Kargadan.EnvelopeIdentity;
                    const telemetryContext = {
                        attempt: input.state.attempt,
                        operationTag: 'PLAN',
                        spanId:  crypto.randomUUID().replaceAll('-', ''),
                        traceId: crypto.randomUUID().replaceAll('-', ''),
                    } as const satisfies Kargadan.TelemetryContext;
                    const isWrite = operation.startsWith('write.');
                    const payload = isWrite
                        ? ({
                            operationId: `${input.state.identityBase.runId}:${input.state.sequence}`,
                            patch: { layer: 'default', name: 'phase-3' },
                        } as const)
                        : ({ includeAttributes: true, scope: 'active' } as const);
                    const command: Kargadan.CommandEnvelope = {
                        _tag: 'command',
                        deadlineMs:  input.deadline,
                        idempotency: isWrite
                            ? {
                                idempotencyKey: `run:${input.state.identityBase.runId.slice(0, 8)}:seq:${String(input.state.sequence).padStart(4, '0')}`,
                                payloadHash: createHash('sha256')
                                    .update(JSON.stringify(sortKeysDeep(payload)))
                                    .digest('hex'),
                            }
                            : undefined,
                        identity,
                        objectRefs: isWrite
                            ? undefined
                            : [
                                {
                                    objectId: '00000000-0000-0000-0000-000000000100',
                                    sourceRevision: 0,
                                    typeTag:  'Brep',
                                },
                            ],
                        operation,
                        payload,
                        telemetryContext,
                        undoScope: isWrite ? 'kargadan.phase3' : undefined,
                    };
                    return command;
                }),
            ),
        ),
        Option.match({
            onNone: () => Effect.fail(CommandDispatchError.of('protocol', { message: 'No operation available for PLAN' })),
            onSome: Effect.succeed,
        }),
    );
const handleDecision = (input: {
    readonly command: Kargadan.CommandEnvelope;
    readonly context: {
        readonly correctionMax: number;
        readonly retryMax:      number;
        readonly trace:         PersistenceTrace;
    };
    readonly state:        LoopState.Type;
    readonly verification: Verification.Type;
}) =>
    Verification.$match(input.verification, {
        Failed: ({ error }) => {
            const failedState = { ...input.state, status: 'Failed' } satisfies LoopState.Type;
            const nextAttemptCommand = {
                ...input.command,
                identity: { ...input.command.identity, issuedAt: new Date() },
                telemetryContext: { ...input.command.telemetryContext, attempt: input.state.attempt + 1 },
            } satisfies Kargadan.CommandEnvelope;
            return Match.value(error.failureClass).pipe(
                Match.when('compensatable', () =>
                    input.context.trace
                        .appendTransition({
                            appId:       input.state.identityBase.appId,
                            createdAt:   new Date(),
                            eventId:     crypto.randomUUID(),
                            eventType:   'command.compensate',
                            payload: { code: error.code, compensation: 'required' },
                            requestId:   input.command.identity.requestId,
                            runId:       input.state.identityBase.runId,
                            sequence:    input.state.sequence + 1,
                            sessionId:   input.state.identityBase.sessionId,
                            telemetryContext: {
                                attempt: input.state.attempt,
                                operationTag: 'DECIDE',
                                spanId:  crypto.randomUUID().replaceAll('-', ''),
                                traceId: crypto.randomUUID().replaceAll('-', ''),
                            },
                            ...(input.command.idempotency === undefined
                                ? {}
                                : { idempotency: input.command.idempotency }),
                        })
                        .pipe(Effect.as(failedState)),
                ),
                Match.when('correctable', () =>
                    Effect.succeed(
                        input.state.correctionCycles < input.context.correctionMax
                            ? ({
                                ...input.state,
                                attempt: input.state.attempt + 1,
                                command: nextAttemptCommand,
                                correctionCycles: input.state.correctionCycles + 1,
                                status:  'Planning',
                            } satisfies  LoopState.Type)
                        : failedState,
                    ),
                ),
                Match.when('fatal', () =>
                    input.context.trace
                        .appendArtifact({
                            appId:               input.state.identityBase.appId,
                            artifactId:          crypto.randomUUID(),
                            artifactType:        'incident',
                            body:                error.message,
                            createdAt:           new Date(),
                            metadata: { code:    error.code, escalated: true, failureClass: error.failureClass },
                            runId:               input.state.identityBase.runId,
                            sourceEventSequence: input.state.sequence,
                            title:               'Fatal failure escalation',
                            updatedAt:           new Date(),
                        })
                        .pipe(Effect.as(failedState)),
                ),
                Match.when('retryable', () =>
                    Effect.succeed(
                        input.state.attempt < input.context.retryMax
                            ? ({
                                ...input.state,
                                attempt: input.state.attempt + 1,
                                command: nextAttemptCommand,
                                status:  'Planning',
                            } satisfies LoopState.Type)
                        : failedState,
                    ),
                ),
                Match.exhaustive,
            );
        },
        Verified: () => {
            const remaining = input.state.operations.slice(1);
            return Effect.succeed(
                remaining.length === 0
                    ? ({
                        ...input.state,
                        command: undefined,
                        operations: [],
                        status: 'Completed',
                    } satisfies LoopState.Type)
                    : ({
                        ...input.state,
                        attempt:    1,
                        command:    undefined,
                        correctionCycles: 0,
                        operations: remaining,
                        status:     'Planning',
                    } satisfies LoopState.Type),
            );
        },
    });
const verifyResult = (result: Kargadan.ResultEnvelope): Verification.Type =>
    result.status === 'ok'
        ? Verification.Verified()
        : Verification.Failed({
            error:
                result.error === undefined
                    ? {
                        code:         'UNKNOWN_FAILURE',
                        failureClass: 'fatal',
                        message:      'Result error payload is missing',
                    }
                    : {
                        ...result.error.reason,
                        ...(result.error.details === undefined ? {} : { details: result.error.details }),
                    },
            });

// --- [EXPORT] ----------------------------------------------------------------

export { handleDecision, planCommand, verifyResult };
