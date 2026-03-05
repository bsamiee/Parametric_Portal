import { createHash } from 'node:crypto';
import { SqlClient } from '@effect/sql';
import { PgClient } from '@effect/sql-pg';
import { Chunk, Effect, HashMap, HashSet, Layer, Match, Option, Schema as S } from 'effect';
import type { AgentJournal } from './models.ts';
import { DatabaseService } from './repos.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _FailureClassVocabulary = new Set(['retryable', 'correctable', 'compensatable', 'fatal'] as const);

// --- [SCHEMA] ----------------------------------------------------------------

const CheckpointPayload = S.Struct({ chatJson:   S.String, loopState: S.Unknown });
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
const _asRecord = (value: unknown) =>
    value !== null && typeof value === 'object'
        ? Option.some(value as Record<string, unknown>)
        : Option.none<Record<string, unknown>>();
const _path = (value: unknown, keys: ReadonlyArray<string>) =>
    keys.reduce(
        (acc, key) =>
            Option.flatMap(acc, (current) =>
                Option.flatMap(_asRecord(current), (record) => Option.fromNullable(record[key]))),
        Option.some(value),
    );

// --- [SERVICES] --------------------------------------------------------------

class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const { agentJournal: repo } = yield* DatabaseService;
        const sql = yield* SqlClient.SqlClient;
        const write = Effect.fn('database.agentPersistence.write')((entries: readonly S.Schema.Type<typeof AgentJournal.insert>[]) => repo.put([...entries]));
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
                Effect.map((payload) => {
                    const workflowExecutionId = _path(payload, ['params', 'workflowExecution', 'executionId']).pipe(
                        Option.orElse(() => _path(payload, ['params', 'workflow', 'executionId'])),
                        Option.orElse(() => _path(payload, ['result', 'workflow', 'executionId'])),
                        Option.filter((value): value is string => typeof value === 'string' && value.length > 0),
                    );
                    const failureClass = _path(payload, ['params', 'verificationEvidence', 'deterministicFailureClass']).pipe(
                        Option.orElse(() => _path(payload, ['params', 'failureClass'])),
                        Option.orElse(() => _path(payload, ['params', 'delta', 'failureClass'])),
                        Option.filter(
                            (value): value is 'retryable' | 'correctable' | 'compensatable' | 'fatal' =>
                                typeof value === 'string' && _FailureClassVocabulary.has(value as 'retryable' | 'correctable' | 'compensatable' | 'fatal'),
                        ),
                    );
                    const workflowApproved = _path(payload, ['params', 'workflowExecution', 'approved']).pipe(
                        Option.orElse(() =>  _path(payload, ['params', 'workflow', 'approved'])),
                        Option.orElse(() =>  _path(payload, ['result', 'workflow', 'approved'])),
                        Option.filter((value): value is boolean => typeof value === 'boolean'),
                    );
                    const workflowCommandId = _path(payload, ['params', 'workflowExecution', 'commandId']).pipe(
                        Option.orElse(() =>   _path(payload, ['params', 'workflow', 'commandId'])),
                        Option.orElse(() =>   _path(payload, ['result', 'workflow', 'commandId'])),
                        Option.filter((value): value is string => typeof value === 'string' && value.length > 0),
                    );
                    return {
                        appId:                entry.appId,
                        correlationId:        entry.runId,
                        createdAt:            entry.createdAt,
                        durationMs:           payload.durationMs ?? 0,
                        failureClass:         Option.getOrUndefined(failureClass),
                        hasWorkflow:          Option.isSome(workflowExecutionId),
                        operation:            Option.getOrElse(entry.operation, () => 'unknown'),
                        params:               payload.params ?? {},
                        result:               Option.fromNullable(payload.result),
                        sequence:             entry.sequence,
                        sessionId:            entry.sessionId,
                        success:              Option.exists(entry.status, (status) => status === 'ok'),
                        workflowApproved:     Option.getOrUndefined(workflowApproved),
                        workflowCommandId:    Option.getOrUndefined(workflowCommandId),
                        workflowExecutionId:  Option.getOrUndefined(workflowExecutionId),
                    };
                }),
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
                                Effect.map((payload) => ({
                                    chatJson: payload.chatJson,
                                    diverged: Option.exists(checkpoint.stateHash, (hash) => hash !== _stateHash(payload.loopState)),
                                    fresh:    false as const,
                                    sequence: checkpoint.sequence,
                                    state:    payload.loopState,
                                })),
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
            readonly appId:    string; readonly correlationId: string; readonly error: string | null;
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
