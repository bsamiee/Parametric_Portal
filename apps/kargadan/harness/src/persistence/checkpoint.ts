/**
 * PostgreSQL-backed checkpoint persistence + in-memory transition trace for Kargadan harness recovery.
 * Owns hashing, replay, snapshot, and checkpoint CRUD in one service surface.
 */
import { createHash } from 'node:crypto';
import * as SqlClient from '@effect/sql/SqlClient';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Effect, Match, Option, Ref, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _checkpoint = (() => {
    const _loopStateSchema = S.Struct({
        attemptCount:      S.Int,
        pendingOperations: S.Int,
        stage:             S.String,
    });
    const _rowSchema = S.Struct({
        conversationHistory: S.Array(S.Unknown),
        createdAt:           S.DateFromString,
        loopState:           _loopStateSchema,
        sceneSummary:        S.NullOr(S.Unknown),
        sequence:            S.Int,
        sessionId:           S.String,
        stateHash:           S.String,
        updatedAt:           S.DateFromString,
    });
    const _canonicalStateForHash = (input: unknown): unknown =>
        Match.value(input).pipe(
            Match.when(Match.instanceOf(Array), (values) => values.map(_canonicalStateForHash)),
            Match.when(
                (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null,
                (value) =>
                    Object.fromEntries(
                        Object.entries(value)
                            .toSorted(([left], [right]) => left.localeCompare(right))
                            .map(([key, nested]) => [key, _canonicalStateForHash(nested)]),
                    ),
            ),
            Match.orElse((value) => value),
        );
    return {
        hashCanonicalState: (state: unknown) =>
            createHash('sha256')
                .update(JSON.stringify(_canonicalStateForHash(state)))
                .digest('hex'),
        rowSchema: _rowSchema,
        table:     'kargadan_checkpoints' as const,
    } as const;
})();
const hashCanonicalState = _checkpoint.hashCanonicalState;

// --- [SERVICES] --------------------------------------------------------------

class CheckpointService extends Effect.Service<CheckpointService>()('kargadan/CheckpointService', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const _store = yield* Ref.make({
            artifacts: [] as ReadonlyArray<Kargadan.RetrievalArtifact>,
            events:    [] as ReadonlyArray<Kargadan.RunEvent>,
            snapshots: [] as ReadonlyArray<Kargadan.RunSnapshot>,
        });
        const _appendArtifact = Effect.fn('kargadan.checkpoint.append.artifact')((input: unknown) =>
            S.decodeUnknown(Kargadan.RetrievalArtifactSchema)(input).pipe(
                Effect.flatMap((decoded) =>
                    Ref.update(_store, (current) => ({
                        ...current,
                        artifacts: [...current.artifacts, decoded],
                    })),
                ),
            ),
        );
        const _appendTransition = Effect.fn('kargadan.checkpoint.append.transition')((input: unknown) =>
            S.decodeUnknown(Kargadan.RunEventSchema)(input).pipe(
                Effect.flatMap((decoded) =>
                    Ref.update(_store, (current) => ({
                        ...current,
                        events: [...current.events, decoded],
                    })),
                ),
            ),
        );
        const _snapshot = Effect.fn('kargadan.checkpoint.snapshot')(
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
                        Ref.update(_store, (current) => ({
                            ...current,
                            snapshots: [...current.snapshots, decoded],
                        })),
                    ),
                ),
        );
        const _replay = Effect.fn('kargadan.checkpoint.replay')(
            (input: { readonly runId: string; readonly expectedHash?: string | undefined }) =>
                Ref.get(_store).pipe(
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
                        } as const;
                    }),
                ),
        );
        const _listArtifacts = Effect.fn('kargadan.checkpoint.listArtifacts')((runId: string) =>
            Ref.get(_store).pipe(Effect.map((current) => current.artifacts.filter((artifact) => artifact.runId === runId))),
        );
        const _save = Effect.fn('kargadan.checkpoint.save')((input: {
            readonly conversationHistory: ReadonlyArray<unknown>;
            readonly loopState: { readonly attemptCount: number; readonly pendingOperations: number; readonly stage: string };
            readonly sceneSummary?: unknown;
            readonly sequence: number;
            readonly sessionId: string;
        }) => {
            const stateHash = hashCanonicalState({
                conversationHistory: input.conversationHistory,
                loopState:           input.loopState,
            });
            const now = new Date().toISOString();
            const historyJson = JSON.stringify(input.conversationHistory);
            const loopStateJson = JSON.stringify(input.loopState);
            const sceneSummaryJson = input.sceneSummary === undefined ? null : JSON.stringify(input.sceneSummary);
            return sql`
                INSERT INTO ${sql(_checkpoint.table)} (session_id, conversation_history, loop_state, state_hash, scene_summary, sequence, created_at, updated_at)
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
        const _restore = Effect.fn('kargadan.checkpoint.restore')((sessionId: string) =>
            sql`
                SELECT
                    session_id AS "sessionId",
                    conversation_history AS "conversationHistory",
                    loop_state AS "loopState",
                    state_hash AS "stateHash",
                    scene_summary AS "sceneSummary",
                    sequence,
                    created_at AS "createdAt",
                    updated_at AS "updatedAt"
                FROM ${sql(_checkpoint.table)}
                WHERE session_id = ${sessionId}
            `.pipe(
                Effect.flatMap((rows) =>
                    rows.length === 0
                        ? Effect.succeed(Option.none())
                        : S.decodeUnknown(_checkpoint.rowSchema)(rows[0]).pipe(Effect.map(Option.some)),
                ),
            ),
        );
        const _verifySceneState = Effect.fn('kargadan.checkpoint.verifySceneState')(
            (sessionId: string, currentSceneHash: string) =>
                _restore(sessionId).pipe(
                    Effect.map((checkpoint) =>
                        Option.match(checkpoint, {
                            onNone: () => ({ checkpoint: Option.none(), diverged: false }),
                            onSome: (row) => ({
                                checkpoint: Option.some(row),
                                diverged: row.stateHash !== currentSceneHash,
                            }),
                        }),
                    ),
                ),
        );
        const _remove = Effect.fn('kargadan.checkpoint.delete')((sessionId: string) =>
            sql`DELETE FROM ${sql(_checkpoint.table)} WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
        );
        return {
            appendArtifact:   _appendArtifact,
            appendTransition: _appendTransition,
            listArtifacts:    _listArtifacts,
            remove:           _remove,
            replay:           _replay,
            restore:          _restore,
            save:             _save,
            snapshot:         _snapshot,
            verifySceneState: _verifySceneState,
        } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CheckpointService, hashCanonicalState };
