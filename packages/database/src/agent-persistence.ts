import { createHash } from 'node:crypto';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Chunk, Config, Context, Effect, HashMap, HashSet, Layer, Match, Option, Schema as S, String as Str } from 'effect';
import type { AgentJournal } from './models.ts';
import { PersistenceService } from './repos.ts';

// --- [TYPES] -----------------------------------------------------------------

type ToolCallProjector = (payload: { readonly params: unknown; readonly result: unknown }) => Record<string, unknown>;

// --- [CONSTANTS] -------------------------------------------------------------

const _CURRENT_SCHEMA_VERSION = 1;

// --- [SCHEMA] ----------------------------------------------------------------

const CheckpointPayload = S.Struct({ chatJson: S.String, loopState: S.Unknown, schemaVersion: S.optional(S.Int) });
const StartPayload =      S.Struct({ metadata:   S.optional(S.Record({
    key:           S.String, value: S.Unknown })),
    startedAt:     S.optional(S.DateFromSelf),
    toolCallCount: S.optional(S.Number),
    userId:        S.NullOr  (S.String)
});
const CompletePayload = S.Struct({ endedAt:    S.optional(S.Union(S.DateFromSelf, S.String)), error: S.NullOr(S.String), toolCallCount: S.optional(S.Number) });
const ToolCallPayload = S.Struct({ durationMs: S.optional(S.Number), params: S.optional(S.Unknown), result: S.optional(S.Unknown) });

// --- [FUNCTIONS] -------------------------------------------------------------

const _sortKeys = (v: unknown): unknown =>
    Match.value(v).pipe(
        Match.when(Match.instanceOf(Array), (arr) => arr.map(_sortKeys)),
        Match.when((x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object', (obj) =>
            Object.fromEntries(Object.entries(obj).toSorted(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, _sortKeys(val)]))),
        Match.orElse((x) => x),
    );
const _stateHash = (state: unknown) => createHash('sha256').update(JSON.stringify(_sortKeys(state))).digest('hex');

// --- [SERVICES] --------------------------------------------------------------

class _ToolCallProjectorTag extends Context.Tag('database/_ToolCallProjector')<_ToolCallProjectorTag, ToolCallProjector>() {}
class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [PersistenceService.Default],
    effect: Effect.gen(function* () {
        const { journal: repo } = yield* PersistenceService;
        const sql = yield* SqlClient.SqlClient;
        const projector = yield* _ToolCallProjectorTag;
    const write = Effect.fn('database.agentPersistence.write')((entries: readonly S.Schema.Type<typeof AgentJournal.insert>[]) =>
        repo.put([...entries]).pipe(
            Effect.catchIf(
                (e) => (e as { cause?: { code?: unknown; constraint?: unknown } }).cause?.code === '23505'
                    && (e as { cause?: { code?: unknown; constraint?: unknown } }).cause?.constraint === 'idx_agent_journal_session_sequence_kind',
                () => Effect.void,
            ),
        ));
    const decodeStart = (json: unknown) =>
        S.decodeUnknown(StartPayload)(json).pipe(Effect.orElseSucceed(() => ({ userId: null }) as typeof StartPayload.Type));
    const decodeComplete = (json: unknown) =>
        S.decodeUnknown(CompletePayload)(json).pipe(Effect.map(Option.some), Effect.orElseSucceed(() => Option.none<typeof CompletePayload.Type>()));
    const decodeToolCall = (json: unknown) =>
        S.decodeUnknown(ToolCallPayload)(json).pipe(Effect.orElseSucceed(() => ({}) as typeof ToolCallPayload.Type));
    const deriveStatus = (start: typeof AgentJournal.Type, complete: Option.Option<typeof AgentJournal.Type>): 'running' | 'completed' | 'failed' | 'interrupted' =>
        complete.pipe(
            Option.flatMap((entry) => entry.status),
            Option.orElse(() => start.status),
            Option.match({
                onNone: () => 'running' as const,
                onSome: (status) => status === 'ok' || status === 'error' ? 'running' as const : status,
            }),
        );
    const mapToolCall = (entry: typeof AgentJournal.Type) =>
        decodeToolCall(entry.payloadJson).pipe(
            Effect.map((payload) => Object.assign({
                appId:         entry.appId,
                correlationId: entry.runId,
                createdAt:     entry.createdAt,
                durationMs:    payload.durationMs ?? 0,
                operation:     Option.getOrElse(entry.operation, () => 'unknown'),
                params:        payload.params ?? {},
                result:        Option.fromNullable(payload.result),
                sequence:      entry.sequence,
                sessionId:     entry.sessionId,
                success:       Option.exists(entry.status, (status) => status === 'ok'),
            }, projector({ params: payload.params, result: payload.result }))),
        );
    const mapStart = (completionBySession: HashMap.HashMap<string, typeof AgentJournal.Type>) => (start: typeof AgentJournal.Type) => {
        const complete = HashMap.get(completionBySession, start.sessionId);
        return Effect.zipWith(
            decodeStart(start.payloadJson),
            Option.match(complete, { onNone: () => Effect.succeed(Option.none<typeof CompletePayload.Type>()), onSome: (entry) => decodeComplete(entry.payloadJson) }),
            (startPayload, completePayloadOption) => {
                const completePayload = Option.getOrUndefined(completePayloadOption);
                return {
                    appId:         start.appId,
                    correlationId: start.runId,
                    endedAt:       Option.fromNullable(completePayload?.endedAt).pipe(Option.map((value) => value instanceof Date ? value : new Date(value))),
                    error:         Option.fromNullable(completePayload?.error),
                    id:            start.sessionId,
                    metadata:      startPayload.metadata ?? {},
                    startedAt:     startPayload.startedAt ?? start.createdAt,
                    status:        deriveStatus(start, complete),
                    toolCallCount: completePayload?.toolCallCount ?? startPayload.toolCallCount ?? 0,
                    updatedAt:     complete.pipe(Option.map((entry) => entry.createdAt), Option.getOrElse(() => start.createdAt)),
                    userId:        Option.fromNullable(startPayload.userId),
                };
            },
        );
    };
    const hydrate = Effect.fn('database.agentPersistence.hydrate')((sessionId: string) =>
        repo.latestCheckpoint(sessionId).pipe(
            Effect.flatMap((entry) =>
                Option.match(entry, {
                    onNone: () => Effect.succeed({ fresh: true as const }),
                    onSome: (checkpoint) =>
                        S.decodeUnknown(CheckpointPayload)(checkpoint.payloadJson).pipe(
                            Effect.flatMap((payload) =>
                                Option.fromNullable(payload.schemaVersion).pipe(
                                    Option.filter((version) => version !== _CURRENT_SCHEMA_VERSION),
                                    Option.match({
                                        onNone: () => Effect.succeed(Option.some(payload)),
                                        onSome: (version) =>
                                            Effect.logWarning('database.agentPersistence.hydrate.schema_version_mismatch', {
                                                current: _CURRENT_SCHEMA_VERSION, found: version, sessionId,
                                            }).pipe(Effect.as(Option.none<typeof payload>())),
                                    }),
                                ),
                            ),
                            Effect.map(
                                Option.match({
                                    onNone: () => ({ fresh: true as const }),
                                    onSome: (payload) => ({
                                        chatJson: payload.chatJson,
                                        diverged: Option.exists(checkpoint.stateHash, (hash) => hash !== _stateHash(payload.loopState)),
                                        fresh:    false as const,
                                        sequence: checkpoint.sequence,
                                        state:    payload.loopState,
                                    }),
                                }),
                            ),
                            Effect.catchAll((error) =>
                                Effect.logWarning('database.agentPersistence.hydrate.decode_failed', { error: String(error), sessionId }).pipe(
                                    Effect.as({ fresh: true as const }),
                                ),
                            ),
                        ),
                }),
            ),
        ),
    );
    const findResumable = Effect.fn('database.agentPersistence.findResumable')((appId: string) =>
        Effect.zipWith(
            repo.find([{ field: 'appId', value: appId }, { field: 'entryKind', value: 'session_start' }], { asc: false }),
            repo.find([{ field: 'appId', value: appId }, { field: 'entryKind', value: 'session_complete' }]),
            (starts, completions) => {
                const done = HashSet.fromIterable(completions.map((c) => c.sessionId));
                return Chunk.findFirst(
                    Chunk.fromIterable(starts),
                    (entry) => !HashSet.has(done, entry.sessionId) && !Option.exists(entry.status, (status) => status === 'completed' || status === 'failed'),
                ).pipe(Option.map((entry) => entry.sessionId));
            },
        ),
    );
    const list = Effect.fn('database.agentPersistence.list')((filter?: { after?: Date; before?: Date; cursor?: string; limit?: number; status?: readonly string[] }) =>
        Effect.gen(function* () {
            const statusFilter = filter?.status ?? [];
            const statusPredicate = statusFilter.length === 0
                ? Option.none()
                : Option.some({
                    raw: sql`(
                        EXISTS (
                            SELECT 1
                            FROM (
                                SELECT complete.status
                                FROM agent_journal complete
                                WHERE complete.app_id = agent_journal.app_id
                                  AND complete.session_id = agent_journal.session_id
                                  AND complete.entry_kind = 'session_complete'
                                ORDER BY complete.created_at DESC, complete.id DESC
                                LIMIT 1
                            ) latest
                            WHERE latest.status IN ${sql.in(statusFilter)}
                        )
                        OR (
                            NOT EXISTS (
                                SELECT 1
                                FROM agent_journal complete
                                WHERE complete.app_id = agent_journal.app_id
                                  AND complete.session_id = agent_journal.session_id
                                  AND complete.entry_kind = 'session_complete'
                            )
                            AND (
                                CASE
                                    WHEN agent_journal.status IN ('ok', 'error') OR agent_journal.status IS NULL THEN 'running'
                                    ELSE agent_journal.status
                                END
                            ) IN ${sql.in(statusFilter)}
                        )
                    )`,
                });
            const { cursor, hasNext, hasPrev, items: starts, total } = yield* repo.page(
                [
                    { field: 'entryKind', value: 'session_start' },
                    ...repo.preds({ after: filter?.after, before: filter?.before }),
                    ...Option.match(statusPredicate, { onNone: () => [], onSome: (predicate) => [predicate] }),
                ],
                { asc: false, cursor: filter?.cursor, limit: filter?.limit },
            );
            const sessionIds = starts.map((s) => s.sessionId);
            const completions = sessionIds.length
                ? yield* repo.find([{ field: 'entryKind', value: 'session_complete' }, { field: 'sessionId', op: 'in', values: sessionIds }], { asc: false })
                : [];
            const completionBySession = completions.reduce(
                (acc, entry) =>
                    HashMap.has(acc, entry.sessionId)
                        ? acc
                        : HashMap.set(acc, entry.sessionId, entry),
                HashMap.empty<string, typeof AgentJournal.Type>(),
            );
            const items = yield* Effect.forEach(starts, mapStart(completionBySession));
            return { cursor, hasNext, hasPrev, items, total };
        }),
    );
    const trace = Effect.fn('database.agentPersistence.trace')((sessionId: string, options?: { cursor?: string; limit?: number }) =>
        repo.page([['sessionId', sessionId], { field: 'entryKind', value: 'tool_call' }], { asc: true, cursor: options?.cursor, limit: options?.limit }).pipe(
            Effect.flatMap((page) => Effect.map(Effect.forEach(page.items, mapToolCall), (items) => ({ ...page, items }))),
        ),
    );
    const startSession = Effect.fn('database.agentPersistence.startSession')((params: {
        readonly appId: string; readonly correlationId: string; readonly sessionId: string;
    }) => write([{
        appId:       params.appId, entryKind: 'session_start' as const, operation: Option.none(),
        payloadJson: { startedAt: new Date(), toolCallCount: 0, userId: null },
        runId:       params.correlationId, sequence: 0, sessionId: params.sessionId,
        stateHash:   Option.none(), status: Option.some('running' as const),
    }]));
    const completeSession = Effect.fn('database.agentPersistence.completeSession')((params: {
        readonly appId:    string; readonly correlationId: string; readonly error:  string | null;
        readonly sequence: number; readonly sessionId:     string; readonly status: 'completed' | 'failed' | 'interrupted'; readonly toolCallCount: number;
    }) => write([{
        appId:       params.appId, entryKind: 'session_complete' as const, operation: Option.none(),
        payloadJson: { endedAt: new Date(), error: params.error, toolCallCount: params.toolCallCount },
        runId:       params.correlationId, sequence: params.sequence, sessionId: params.sessionId,
        stateHash:   Option.none(), status: Option.some(params.status),
    }]));
    const persistCall = Effect.fn('database.agentPersistence.persistCall')((
        identity: { readonly appId: string; readonly correlationId: string; readonly sessionId: string },
        loopState: unknown,
        call: {
            readonly chatJson:   string;
            readonly durationMs: number; readonly error: Option.Option<string>; readonly operation: string;
            readonly params:     Record<string, unknown>; readonly result: Option.Option<unknown>;
            readonly sequence:   number; readonly status: 'ok' | 'error';
        },
    ) => write([
        {
            appId:       identity.appId, entryKind: 'checkpoint' as const, operation: Option.none(),
            payloadJson: { chatJson: call.chatJson, loopState, schemaVersion: _CURRENT_SCHEMA_VERSION }, runId: identity.correlationId,
            sequence:    call.sequence, sessionId: identity.sessionId,
            stateHash:   Option.some(_stateHash(loopState)), status: Option.none(),
        },
        {
            appId:       identity.appId, entryKind: 'tool_call' as const,
            operation:   Option.some(call.operation),
            payloadJson: { durationMs: call.durationMs, params: call.params, result: Option.getOrUndefined(call.result) },
            runId:       identity.correlationId, sequence: call.sequence, sessionId: identity.sessionId,
            stateHash:   Option.none(),
            status:      Option.some(call.status),
        },
    ]));
    const idempotency = (correlationId: string, payload: unknown, sequence: number) =>
        ({ idempotencyKey: `run:${correlationId.slice(0, 8)}:seq:${String(sequence).padStart(4, '0')}`, payloadHash: _stateHash(payload) }) as const;
        return { completeSession, findResumable, hydrate, idempotency, list, persistCall, startSession, trace } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const AgentPersistenceLayer = (config: Parameters<typeof PgClient.layerConfig>[0], options?: { readonly projector?: ToolCallProjector }) =>
    AgentPersistenceService.Default.pipe(
        Layer.provide(Layer.succeed(_ToolCallProjectorTag, options?.projector ?? (() => ({})))),
        Layer.provideMerge(PgClient.layerConfig({
            ...config, transformJson: Config.succeed(true), transformQueryNames: Config.succeed(Str.camelToSnake), transformResultNames: Config.succeed(Str.snakeToCamel),
        })),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { AgentPersistenceLayer, AgentPersistenceService };
export type { ToolCallProjector };
