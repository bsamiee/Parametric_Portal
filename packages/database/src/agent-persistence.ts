import { createHash } from 'node:crypto';
import { PgClient } from '@effect/sql-pg';
import { Chunk, Effect, HashMap, HashSet, Layer, Match, Option, type ParseResult, Schema as S } from 'effect';
import type { AgentJournal } from './models.ts';
import { DatabaseService } from './repos.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const CheckpointPayload = S.Struct({ chatJson:   S.String, loopState: S.Unknown });
const StartPayload =      S.Struct({ metadata:   S.optional(S.Record({
    key:           S.String, value: S.Unknown })),
    startedAt:     S.optional(S.DateFromSelf),
    toolCallCount: S.optional(S.Number),
    userId:        S.NullOr(S.String)
});
const CompletePayload = S.Struct({ endedAt:    S.optional(S.Union(S.DateFromSelf, S.String)), error: S.NullOr(S.String), toolCallCount: S.optional(S.Number) });
const ToolCallPayload = S.Struct({ durationMs: S.optional(S.Number), params: S.optional(S.Unknown), result: S.optional(S.Unknown) });

// --- [TYPES] -----------------------------------------------------------------

type JournalEntry  = S.Schema.Type<typeof AgentJournal>;
type HydrateResult = { readonly fresh: true } | { chatJson: string; diverged: boolean; fresh: false; sequence: number; state: unknown };

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

class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const { agentJournal: repo } = yield* DatabaseService;
        const write = Effect.fn('database.agentPersistence.write')((entries: readonly S.Schema.Type<typeof AgentJournal.insert>[]) => repo.put([...entries]));
        const decodeStart = (json: unknown) =>
            S.decodeUnknown(StartPayload)(json).pipe(Effect.orElseSucceed(() => ({ userId: null }) as typeof StartPayload.Type));
        const decodeComplete = (json: unknown) =>
            S.decodeUnknown(CompletePayload)(json).pipe(Effect.map(Option.some), Effect.orElseSucceed(() => Option.none<typeof CompletePayload.Type>()));
        const decodeToolCall = (json: unknown) =>
            S.decodeUnknown(ToolCallPayload)(json).pipe(Effect.orElseSucceed(() => ({}) as typeof ToolCallPayload.Type));
        const deriveStatus = (start: JournalEntry, complete: Option.Option<JournalEntry>): 'running' | 'completed' | 'failed' | 'interrupted' =>
            complete.pipe(
                Option.flatMap((entry) => entry.status),
                Option.orElse(() => start.status),
                Option.match({
                    onNone: () => 'running' as const,
                    onSome: (status) => status === 'ok' || status === 'error' ? 'running' as const : status,
                }),
            );
        const mapToolCall = (entry: JournalEntry) =>
            decodeToolCall(entry.payloadJson).pipe(Effect.map((payload) => ({
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
            })));
        const mapStart = (completionBySession: HashMap.HashMap<string, JournalEntry>) => (start: JournalEntry) => {
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
                Effect.flatMap((entry): Effect.Effect<HydrateResult, ParseResult.ParseError> =>
                    Option.match(entry, {
                        onNone: () => Effect.succeed({ fresh: true as const }),
                        onSome: (checkpoint) =>
                            S.decodeUnknown(CheckpointPayload)(checkpoint.payloadJson).pipe(
                                Effect.map((payload) => ({
                                    chatJson: payload.chatJson,
                                    diverged: Option.exists(checkpoint.stateHash, (hash) => hash !== _stateHash(payload.loopState)),
                                    fresh:    false as const,
                                    sequence: checkpoint.sequence,
                                    state:    payload.loopState,
                                })),
                            ),
                    }),
                ),
                Effect.catchAll((error) =>
                    Effect.logWarning('database.agentPersistence.hydrate.decode_failed', { error: String(error), sessionId }).pipe(
                        Effect.as({ fresh: true as const }),
                    ),
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
                const { cursor, hasNext, hasPrev, items: starts, total } = yield* repo.page([{ field: 'entryKind', value: 'session_start' }, ...repo.preds({ after: filter?.after, before: filter?.before })], { asc: false, cursor: filter?.cursor, limit: filter?.limit });
                const sessionIds = starts.map((s) => s.sessionId);
                const completions = sessionIds.length ? yield* repo.find([{ field: 'entryKind', value: 'session_complete' }, { field: 'sessionId', op: 'in', values: sessionIds }]) : [];
                const items = yield* Effect.forEach(starts, mapStart(HashMap.fromIterable(completions.map((entry) => [entry.sessionId, entry] as const))));
                const filteredItems = items.filter((item) => !filter?.status?.length || filter.status.includes(item.status));
                return { cursor, hasNext, hasPrev, items: filteredItems, total: filter?.status?.length ? filteredItems.length : total };
            }),
        );
        const trace = Effect.fn('database.agentPersistence.trace')((sessionId: string, options?: { cursor?: string; limit?: number }) =>
            repo.page([['sessionId', sessionId], { field: 'entryKind', value: 'tool_call' }], { cursor: options?.cursor, limit: options?.limit }).pipe(
                Effect.map((page) => ({ ...page, items: page.items.toSorted((left, right) => left.sequence - right.sequence) })),
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
            readonly appId: string; readonly correlationId: string; readonly error: string | null;
            readonly sequence: number; readonly sessionId: string; readonly status: 'completed' | 'failed' | 'interrupted'; readonly toolCallCount: number;
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
                payloadJson: { chatJson: call.chatJson, loopState }, runId: identity.correlationId,
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

const AgentPersistenceLayer = (config: Parameters<typeof PgClient.layerConfig>[0]) => AgentPersistenceService.Default.pipe(Layer.provideMerge(PgClient.layerConfig(config)));

// --- [EXPORT] ----------------------------------------------------------------

export { AgentPersistenceLayer, AgentPersistenceService };
