/**
 * PostgreSQL-backed checkpoint persistence + in-memory transition trace for Kargadan harness recovery.
 * Owns hashing, replay, snapshot, and checkpoint CRUD in one service surface.
 */
import { createHash } from 'node:crypto';
import * as SqlClient from '@effect/sql/SqlClient';
import { Kargadan } from '@parametric-portal/types/kargadan';
import { Effect, Match, Option, Ref, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const _table = 'kargadan_checkpoints' as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _rowSchema = S.Struct({
    conversationHistory: S.Array(S.Unknown),
    createdAt:           S.DateFromString,
    loopState:           S.Struct({ attemptCount: S.Int, pendingOperations: S.Int, stage: S.String }),
    sceneSummary:        S.NullOr(S.Unknown),
    sequence:            S.Int,
    sessionId:           S.String,
    stateHash:           S.String,
    updatedAt:           S.DateFromString,
});

// --- [FUNCTIONS] -------------------------------------------------------------

// Why: deterministic hashing requires recursive key-sorting for objects, preserving array order and primitives
const _canonicalize = (v: unknown): unknown =>
    Match.value(v).pipe(
        Match.when(Match.instanceOf(Array), (values) => values.map(_canonicalize)),
        Match.when((x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null, (obj) =>
            Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)).map(([k, n]) => [k, _canonicalize(n)])),
        ),
        Match.orElse((x) => x),
    );
const hashCanonicalState = (state: unknown) => createHash('sha256').update(JSON.stringify(_canonicalize(state))).digest('hex');

// --- [SERVICES] --------------------------------------------------------------

class CheckpointService extends Effect.Service<CheckpointService>()('kargadan/CheckpointService', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* Ref.make({
            artifacts: [] as ReadonlyArray<Kargadan.RetrievalArtifact>,
            events:    [] as ReadonlyArray<Kargadan.RunEvent>,
            snapshots: [] as ReadonlyArray<Kargadan.RunSnapshot>,
        });
        const appendArtifact = Effect.fn('kargadan.checkpoint.append.artifact')((input: unknown) =>
            S.decodeUnknown(Kargadan.RetrievalArtifactSchema)(input).pipe(
                Effect.flatMap((decoded) => Ref.update(store, (c) => ({ ...c, artifacts: [...c.artifacts, decoded] }))),
            ),
        );
        const appendTransition = Effect.fn('kargadan.checkpoint.append.transition')((input: unknown) =>
            S.decodeUnknown(Kargadan.RunEventSchema)(input).pipe(
                Effect.flatMap((decoded) => Ref.update(store, (c) => ({ ...c, events: [...c.events, decoded] }))),
            ),
        );
        const snapshot = Effect.fn('kargadan.checkpoint.snapshot')(
            (input: { readonly appId: string; readonly runId: string; readonly sequence: number; readonly state: unknown }) =>
                S.decode(Kargadan.RunSnapshotSchema)({
                    appId: input.appId, createdAt: new Date(), runId: input.runId,
                    sequence: input.sequence, snapshotHash: hashCanonicalState(input.state), state: input.state,
                }).pipe(Effect.flatMap((decoded) => Ref.update(store, (c) => ({ ...c, snapshots: [...c.snapshots, decoded] })))),
        );
        const replay = Effect.fn('kargadan.checkpoint.replay')(
            (input: { readonly runId: string; readonly expectedHash?: string | undefined }) =>
                Ref.get(store).pipe(Effect.map((current) => {
                    const events = current.events.filter((e) => e.runId === input.runId).toSorted((a, b) => a.sequence - b.sequence);
                    const stateHash = hashCanonicalState(events.map((e) => ({ eventType: e.eventType, payload: e.payload, sequence: e.sequence })));
                    const snapshotHash = current.snapshots.filter((s) => s.runId === input.runId).toSorted((a, b) => b.sequence - a.sequence).at(0)?.snapshotHash;
                    return { events, expectedHash: input.expectedHash, matchesExpected: input.expectedHash === undefined || input.expectedHash === stateHash, snapshotHash, stateHash } as const;
                })),
        );
        const listArtifacts = Effect.fn('kargadan.checkpoint.listArtifacts')((runId: string) =>
            Ref.get(store).pipe(Effect.map((c) => c.artifacts.filter((a) => a.runId === runId))),
        );
        const save = Effect.fn('kargadan.checkpoint.save')((input: {
            readonly conversationHistory: ReadonlyArray<unknown>;
            readonly loopState: { readonly attemptCount: number; readonly pendingOperations: number; readonly stage: string };
            readonly sceneSummary?: unknown;
            readonly sequence: number;
            readonly sessionId: string;
        }) => {
            const stateHash = hashCanonicalState({ conversationHistory: input.conversationHistory, loopState: input.loopState });
            const now = new Date().toISOString();
            const historyJson = JSON.stringify(input.conversationHistory);
            const loopStateJson = JSON.stringify(input.loopState);
            const sceneSummaryJson = input.sceneSummary === undefined ? null : JSON.stringify(input.sceneSummary);
            return sql`
                INSERT INTO ${sql(_table)} (session_id, conversation_history, loop_state, state_hash, scene_summary, sequence, created_at, updated_at)
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
            sql`
                SELECT session_id AS "sessionId", conversation_history AS "conversationHistory", loop_state AS "loopState",
                    state_hash AS "stateHash", scene_summary AS "sceneSummary", sequence, created_at AS "createdAt", updated_at AS "updatedAt"
                FROM ${sql(_table)} WHERE session_id = ${sessionId}
            `.pipe(
                Effect.flatMap((rows) => rows.length === 0
                    ? Effect.succeed(Option.none())
                    : S.decodeUnknown(_rowSchema)(rows[0]).pipe(Effect.map(Option.some)),
                ),
            ),
        );
        const verifySceneState = Effect.fn('kargadan.checkpoint.verifySceneState')(
            (sessionId: string, currentSceneHash: string) =>
                restore(sessionId).pipe(
                    Effect.map(Option.match({
                        onNone: () => ({ checkpoint: Option.none(), diverged: false }),
                        onSome: (row) => ({ checkpoint: Option.some(row), diverged: row.stateHash !== currentSceneHash }),
                    })),
                ),
        );
        const remove = Effect.fn('kargadan.checkpoint.delete')((sessionId: string) =>
            sql`DELETE FROM ${sql(_table)} WHERE session_id = ${sessionId}`.pipe(Effect.asVoid),
        );
        return { appendArtifact, appendTransition, listArtifacts, remove, replay, restore, save, snapshot, verifySceneState } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { CheckpointService, hashCanonicalState };
