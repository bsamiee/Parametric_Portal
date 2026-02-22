/**
 * PostgreSQL-backed checkpoint service for persisting conversation history and agent loop state across reconnections.
 * Composes in-memory trace (appendTransition, snapshot, replay) with durable PostgreSQL checkpoint storage.
 * Replaces PersistenceTrace as the single service for loop state tracking and session recovery.
 */
import * as SqlClient from '@effect/sql/SqlClient';
import { Effect, Option, Ref, Schema as S } from 'effect';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { hashCanonicalState } from '../runtime/persistence-trace';
import { CheckpointRowSchema, _tableName } from './schema';

// --- [TYPES] -----------------------------------------------------------------

type CheckpointInput = {
    readonly conversationHistory: ReadonlyArray<unknown>;
    readonly loopState:           { readonly attemptCount: number; readonly pendingOperations: number; readonly stage: string };
    readonly sceneSummary?:       unknown;
    readonly sequence:            number;
    readonly sessionId:           string;
};

type SceneVerification = {
    readonly checkpoint: Option.Option<typeof CheckpointRowSchema.Type>;
    readonly diverged:   boolean;
};

// --- [SERVICES] --------------------------------------------------------------

class CheckpointService extends Effect.Service<CheckpointService>()('kargadan/CheckpointService', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Why: in-memory trace store preserves existing appendTransition/snapshot/replay API for agent loop compatibility
        const store = yield* Ref.make<{
            readonly artifacts: ReadonlyArray<Kargadan.RetrievalArtifact>;
            readonly events:    ReadonlyArray<Kargadan.RunEvent>;
            readonly snapshots: ReadonlyArray<Kargadan.RunSnapshot>;
        }>({
            artifacts: [],
            events:    [],
            snapshots: [],
        });

        const appendArtifact = Effect.fn('kargadan.checkpoint.append.artifact')((input: unknown) =>
            S.decodeUnknown(Kargadan.RetrievalArtifactSchema)(input).pipe(
                Effect.flatMap((decoded) =>
                    Ref.update(store, (current) => ({
                        ...current,
                        artifacts: [...current.artifacts, decoded],
                    })),
                ),
            ),
        );

        const appendTransition = Effect.fn('kargadan.checkpoint.append.transition')((input: unknown) =>
            S.decodeUnknown(Kargadan.RunEventSchema)(input).pipe(
                Effect.flatMap((decoded) =>
                    Ref.update(store, (current) => ({
                        ...current,
                        events: [...current.events, decoded],
                    })),
                ),
            ),
        );

        const snapshot = Effect.fn('kargadan.checkpoint.snapshot')(
            (input: {
                readonly appId:    string;
                readonly runId:    string;
                readonly sequence: number;
                readonly state:    unknown;
            }) =>
                S.decode(Kargadan.RunSnapshotSchema)({
                    appId:        input.appId,
                    createdAt:    new Date(),
                    runId:        input.runId,
                    sequence:     input.sequence,
                    snapshotHash: hashCanonicalState(input.state),
                    state:        input.state,
                }).pipe(
                    Effect.flatMap((decoded) =>
                        Ref.update(store, (current) => ({
                            ...current,
                            snapshots: [...current.snapshots, decoded],
                        })),
                    ),
                ),
        );

        const replay = Effect.fn('kargadan.checkpoint.replay')(
            (input: { readonly runId: string; readonly expectedHash?: string | undefined }) =>
                Ref.get(store).pipe(
                    Effect.map((current) => {
                        const events = current.events
                            .filter((event) => event.runId === input.runId)
                            .toSorted((left, right) => left.sequence - right.sequence);
                        const reconstructedState = events.map((event) => ({
                            eventType: event.eventType,
                            payload:   event.payload,
                            sequence:  event.sequence,
                        }));
                        const stateHash = hashCanonicalState(reconstructedState);
                        const snapshotHash = current.snapshots
                            .filter((snap) => snap.runId === input.runId)
                            .toSorted((left, right) => right.sequence - left.sequence)
                            .at(0)?.snapshotHash;
                        const expectedHash = input.expectedHash;
                        return {
                            events,
                            expectedHash,
                            matchesExpected: expectedHash === undefined || expectedHash === stateHash,
                            snapshotHash,
                            stateHash,
                        } satisfies CheckpointService.ReplayResult;
                    }),
                ),
        );

        const listArtifacts = Effect.fn('kargadan.checkpoint.listArtifacts')((runId: string) =>
            Ref.get(store).pipe(Effect.map((current) => current.artifacts.filter((artifact) => artifact.runId === runId))),
        );

        const save = Effect.fn('kargadan.checkpoint.save')((input: CheckpointInput) => {
            const stateHash = hashCanonicalState({
                conversationHistory: input.conversationHistory,
                loopState: input.loopState,
            });
            const now = new Date().toISOString();
            const historyJson = JSON.stringify(input.conversationHistory);
            const loopStateJson = JSON.stringify(input.loopState);
            const sceneSummaryJson = input.sceneSummary === undefined ? null : JSON.stringify(input.sceneSummary);
            return sql`
                INSERT INTO ${sql(_tableName)} (session_id, conversation_history, loop_state, state_hash, scene_summary, sequence, created_at, updated_at)
                VALUES (${input.sessionId}, ${historyJson}::jsonb, ${loopStateJson}::jsonb, ${stateHash}, ${sceneSummaryJson}::jsonb, ${input.sequence}, ${now}::timestamptz, ${now}::timestamptz)
                ON CONFLICT (session_id) DO UPDATE SET
                    conversation_history = ${historyJson}::jsonb,
                    loop_state = ${loopStateJson}::jsonb,
                    state_hash = ${stateHash},
                    scene_summary = ${sceneSummaryJson}::jsonb,
                    sequence = ${input.sequence},
                    updated_at = ${now}::timestamptz
            `.pipe(Effect.asVoid);
        });

        const restore = Effect.fn('kargadan.checkpoint.restore')((sessionId: string) =>
            sql`SELECT session_id, conversation_history, loop_state, state_hash, scene_summary, sequence, created_at, updated_at FROM ${sql(_tableName)} WHERE session_id = ${sessionId}`.pipe(
                Effect.flatMap((rows) =>
                    rows.length === 0
                        ? Effect.succeed(Option.none())
                        : S.decodeUnknown(CheckpointRowSchema)({
                            conversationHistory: (rows[0] as Record<string, unknown>)['conversation_history'],
                            createdAt:           (rows[0] as Record<string, unknown>)['created_at'],
                            loopState:           (rows[0] as Record<string, unknown>)['loop_state'],
                            sceneSummary:        (rows[0] as Record<string, unknown>)['scene_summary'],
                            sequence:            (rows[0] as Record<string, unknown>)['sequence'],
                            sessionId:           (rows[0] as Record<string, unknown>)['session_id'],
                            stateHash:           (rows[0] as Record<string, unknown>)['state_hash'],
                            updatedAt:           (rows[0] as Record<string, unknown>)['updated_at'],
                        }).pipe(Effect.map(Option.some)),
                ),
            ),
        );

        const verifySceneState = Effect.fn('kargadan.checkpoint.verifySceneState')(
            (sessionId: string, currentSceneHash: string) =>
                restore(sessionId).pipe(
                    Effect.map((checkpoint) =>
                        Option.match(checkpoint, {
                            onNone: () => ({ checkpoint: Option.none(), diverged: false }) satisfies SceneVerification,
                            onSome: (row) => ({
                                checkpoint: Option.some(row),
                                diverged: row.stateHash !== currentSceneHash,
                            }) satisfies SceneVerification,
                        }),
                    ),
                ),
        );

        const remove = Effect.fn('kargadan.checkpoint.delete')((sessionId: string) =>
            sql`DELETE FROM ${sql(_tableName)} WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
        );

        return {
            appendArtifact,
            appendTransition,
            listArtifacts,
            remove,
            replay,
            restore,
            save,
            snapshot,
            verifySceneState,
        } as const;
    }),
}) {}

// --- [NAMESPACE] -------------------------------------------------------------

namespace CheckpointService {
    export type ReplayResult = {
        readonly events:          ReadonlyArray<Kargadan.RunEvent>;
        readonly expectedHash:    string | undefined;
        readonly matchesExpected: boolean;
        readonly snapshotHash:    string | undefined;
        readonly stateHash:       string;
    };
}

// --- [EXPORT] ----------------------------------------------------------------

export { CheckpointService };
