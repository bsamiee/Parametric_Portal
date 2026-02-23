/**
 * PostgreSQL-backed PersistenceService with write-through Ref cache.
 * Atomic tool call + checkpoint writes per invocation. Silent resume
 * with corruption fallback. Session listing and replay queries.
 */
import { createHash } from 'node:crypto';
import { SqlClient, SqlSchema } from '@effect/sql';
import { Effect, Match, Option, Ref, Schema as S } from 'effect';
import { KargadanCheckpoint, KargadanSession, KargadanToolCall } from './models';

// --- [TYPES] -----------------------------------------------------------------

type HydrateResult =
    | { readonly fresh: true }
    | { readonly chatJson: string; readonly fresh: false; readonly sequence: number; readonly state: unknown };

type SessionFilter = {
    readonly after?: Date | undefined;
    readonly before?: Date | undefined;
    readonly status?: ReadonlyArray<string> | undefined;
};

// --- [FUNCTIONS] -------------------------------------------------------------

const _canonicalize = (v: unknown): unknown =>
    Match.value(v).pipe(
        Match.when(Match.instanceOf(Array), (values) => values.map(_canonicalize)),
        Match.when((x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null, (obj) =>
            Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)).map(([k, n]) => [k, _canonicalize(n)])),
        ),
        Match.orElse((x) => x),
    );
const hashCanonicalState = (state: unknown) => createHash('sha256').update(JSON.stringify(_canonicalize(state))).digest('hex');
const verifySceneState = (storedHash: string, candidateHash: string) => ({ diverged: storedHash !== candidateHash } as const);

// --- [SERVICES] --------------------------------------------------------------

class PersistenceService extends Effect.Service<PersistenceService>()('kargadan/PersistenceService', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const store = yield* Ref.make<ReadonlyArray<typeof KargadanToolCall.Type>>([]);

        const persist = Effect.fn('kargadan.persistence.persist')((input: {
            readonly chatJson: string;
            readonly checkpoint: typeof KargadanCheckpoint.insert.Type;
            readonly toolCall: typeof KargadanToolCall.insert.Type;
        }) =>
            Effect.gen(function* () {
                yield* sql.withTransaction(
                    Effect.all([
                        SqlSchema.void({
                            execute: (row) => sql`INSERT INTO kargadan_tool_calls ${sql.insert(row)}`,
                            Request: KargadanToolCall.insert,
                        })(input.toolCall),
                        SqlSchema.void({
                            execute: (row) => sql`
                                INSERT INTO kargadan_checkpoints ${sql.insert(row)}
                                ON CONFLICT (session_id) DO UPDATE SET
                                    loop_state = EXCLUDED.loop_state,
                                    chat_json = EXCLUDED.chat_json,
                                    state_hash = EXCLUDED.state_hash,
                                    scene_summary = EXCLUDED.scene_summary,
                                    sequence = EXCLUDED.sequence,
                                    updated_at = NOW()`,
                            Request: KargadanCheckpoint.insert,
                        })(input.checkpoint),
                    ], { discard: true }),
                );
                yield* Ref.update(store, (current) => [...current, input.toolCall as unknown as typeof KargadanToolCall.Type]);
            }),
        );

        const hydrate = Effect.fn('kargadan.persistence.hydrate')((sessionId: string) =>
            SqlSchema.findOne({
                execute: (sid) => sql`SELECT * FROM kargadan_checkpoints WHERE session_id = ${sid}`,
                Request: S.String,
                Result: KargadanCheckpoint,
            })(sessionId).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => Effect.succeed({ fresh: true } as HydrateResult),
                    onSome: (row) =>
                        S.decodeUnknown(S.Unknown)(row.loopState).pipe(
                            Effect.map((loopState) => ({ chatJson: row.chatJson, fresh: false, sequence: row.sequence, state: loopState } as HydrateResult)),
                            Effect.catchAll((decodeError) =>
                                Effect.logWarning('kargadan.checkpoint.corrupt', { error: String(decodeError), sessionId }).pipe(
                                    Effect.as({ fresh: true } as HydrateResult),
                                ),
                            ),
                        ),
                })),
            ),
        );

        const createSession = Effect.fn('kargadan.persistence.createSession')((input: typeof KargadanSession.insert.Type) =>
            SqlSchema.void({
                execute: (row) => sql`INSERT INTO kargadan_sessions ${sql.insert(row)}`,
                Request: KargadanSession.insert,
            })(input),
        );

        const completeSession = Effect.fn('kargadan.persistence.completeSession')((input: {
            readonly endedAt: Date;
            readonly error?: string | undefined;
            readonly sessionId: string;
            readonly status: 'completed' | 'failed';
            readonly toolCallCount: number;
        }) =>
            sql`UPDATE kargadan_sessions
                SET status = ${input.status},
                    ended_at = ${input.endedAt.toISOString()}::timestamptz,
                    tool_call_count = ${input.toolCallCount},
                    error = ${input.error ?? null},
                    updated_at = NOW()
                WHERE id = ${input.sessionId}::uuid`.pipe(Effect.asVoid),
        );

        const listSessions = Effect.fn('kargadan.persistence.listSessions')((filter: SessionFilter) =>
            SqlSchema.findAll({
                execute: () => {
                    const statusClause = filter.status !== undefined && filter.status.length > 0
                        ? sql` AND status IN ${sql.in(filter.status as ReadonlyArray<string>)}`
                        : sql``;
                    const afterClause = filter.after !== undefined
                        ? sql` AND started_at >= ${filter.after.toISOString()}::timestamptz`
                        : sql``;
                    const beforeClause = filter.before !== undefined
                        ? sql` AND started_at <= ${filter.before.toISOString()}::timestamptz`
                        : sql``;
                    return sql`SELECT * FROM kargadan_sessions WHERE TRUE${statusClause}${afterClause}${beforeClause} ORDER BY started_at DESC`;
                },
                Request: S.Void,
                Result: KargadanSession,
            })(undefined as void),
        );

        const sessionTrace = Effect.fn('kargadan.persistence.sessionTrace')((sessionId: string) =>
            SqlSchema.findAll({
                execute: (sid) => sql`SELECT * FROM kargadan_tool_calls WHERE session_id = ${sid}::uuid ORDER BY sequence ASC`,
                Request: S.String,
                Result: KargadanToolCall,
            })(sessionId),
        );

        const findResumable = Effect.fn('kargadan.persistence.findResumable')(() =>
            SqlSchema.findOne({
                execute: () => sql`SELECT id FROM kargadan_sessions WHERE status IN ('running', 'interrupted') ORDER BY started_at DESC LIMIT 1`,
                Request: S.Void,
                Result: S.Struct({ id: S.UUID }),
            })(undefined as void).pipe(
                Effect.map(Option.map((row) => row.id)),
            ),
        );

        return { completeSession, createSession, findResumable, hydrate, listSessions, persist, sessionTrace } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { PersistenceService, hashCanonicalState, verifySceneState };
export type { HydrateResult, SessionFilter };
