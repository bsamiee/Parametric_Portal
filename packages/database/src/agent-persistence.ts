import { createHash } from 'node:crypto';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Match, Option } from 'effect';
import { Client } from './client.ts';
import { DatabaseService } from './repos.ts';

// --- [TYPES] -----------------------------------------------------------------

type AgentSessionStatus =  'running' | 'completed' | 'failed' | 'interrupted';
type AgentToolCallStatus = 'ok' | 'error';
type SessionFilter = {
    readonly after?:  Date | undefined;
    readonly before?: Date | undefined;
    readonly status?: ReadonlyArray<AgentSessionStatus> | undefined;
};
type HydrateResult =
    | { readonly fresh: true }
    | {
        readonly chatJson: string;
        readonly diverged: boolean;
        readonly fresh:    false;
        readonly sequence: number;
        readonly state:    unknown;
    };

// --- [FUNCTIONS] -------------------------------------------------------------

const _canonicalize = (value: unknown): unknown =>
    Match.value(value).pipe(
        Match.when(Match.instanceOf(Array), (values) => values.map(_canonicalize)),
        Match.when((raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null, (obj) =>
            Object.fromEntries(Object.entries(obj).toSorted(([left], [right]) => left.localeCompare(right)).map(([key, node]) => [key, _canonicalize(node)])),
        ),
        Match.orElse((raw) => raw),
    );
const _hash = (state: unknown) => createHash('sha256').update(JSON.stringify(_canonicalize(state))).digest('hex');
/** Key format `run:<8chars>:seq:<0-padded>` — truncated runId keeps keys compact; payloadHash is the uniqueness guarantee. */
const idempotency = (input: { readonly payload: unknown; readonly runId: string; readonly sequence: number }) => ({
    idempotencyKey: `run:${input.runId.slice(0, 8)}:seq:${String(input.sequence).padStart(4, '0')}`,
    payloadHash: _hash(input.payload),
}) as const;
const _record = (value: unknown): Record<string, unknown> =>
    Match.value(value).pipe(
        Match.when((raw: unknown): raw is Record<string, unknown> => typeof raw === 'object' && raw !== null, (raw) => raw),
        Match.orElse(() => ({})),
    );

// --- [SERVICES] --------------------------------------------------------------

class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const database = yield* DatabaseService;
        const _withApp = <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) => Client.tenant.with(appId, effect);
        const createSession = Effect.fn('database.agentPersistence.createSession')((input: {
            readonly appId:         string;
            readonly metadata?:     Record<string, unknown> | undefined;
            readonly runId:         string;
            readonly sessionId:     string;
            readonly startedAt?:    Date | undefined;
            readonly status:        AgentSessionStatus;
            readonly toolCallCount: number;
            readonly userId?:       string | undefined;
        }) =>
            _withApp(
                input.appId,
                database.agentJournal.put({
                    appId:             input.appId,
                    entryKind:         'session_start',
                    operation:         Option.none(),
                    payloadJson: {
                        metadata:      input.metadata ?? {},
                        startedAt:     input.startedAt ?? new Date(),
                        toolCallCount: input.toolCallCount,
                        userId:        input.userId ?? null,
                    },
                    runId:             input.runId,
                    sequence:          0,
                    sessionId:         input.sessionId,
                    stateHash:         Option.none(),
                    status:            Option.some(input.status),
                }),
            ),
        );
        const completeSession = Effect.fn('database.agentPersistence.completeSession')((input: {
            readonly appId:         string;
            readonly endedAt:       Date;
            readonly error?:        string | undefined;
            readonly runId:         string;
            readonly sessionId:     string;
            readonly status:        'completed' | 'failed';
            readonly toolCallCount: number;
        }) =>
            _withApp(
                input.appId,
                database.agentJournal.put({
                    appId:             input.appId,
                    entryKind:         'session_complete',
                    operation:         Option.none(),
                    payloadJson: {
                        endedAt:       input.endedAt,
                        error:         input.error ?? null,
                        toolCallCount: input.toolCallCount,
                    },
                    runId:             input.runId,
                    sequence:          input.toolCallCount,
                    sessionId:         input.sessionId,
                    stateHash:         Option.none(),
                    status:            Option.some(input.status),
                }),
            ).pipe(Effect.asVoid),
        );
        const persist = Effect.fn('database.agentPersistence.persist')((input: {
            readonly appId:            string;
            readonly checkpoint: {
                readonly chatJson:     string;
                readonly loopState:    unknown;
                readonly sceneSummary: Option.Option<unknown>;
                readonly sequence:     number;
                readonly sessionId:    string;
            };
            readonly toolCall: {
                readonly durationMs:   number;
                readonly error:        Option.Option<string>;
                readonly operation:    string;
                readonly params:       unknown;
                readonly result:       Option.Option<unknown>;
                readonly runId:        string;
                readonly sequence:     number;
                readonly sessionId:    string;
                readonly status:       AgentToolCallStatus;
            };
        }) =>
            _withApp(
                input.appId,
                database.withTransaction(
                    Effect.all(
                        [
                            database.agentJournal.put({
                                appId:          input.appId,
                                entryKind:      'tool_call',
                                operation:      Option.some(input.toolCall.operation),
                                payloadJson: {
                                    durationMs: input.toolCall.durationMs,
                                    error:      Option.getOrNull(input.toolCall.error),
                                    params:     input.toolCall.params,
                                    result:     Option.getOrNull(input.toolCall.result),
                                },
                                runId:          input.toolCall.runId,
                                sequence:       input.toolCall.sequence,
                                sessionId:      input.toolCall.sessionId,
                                stateHash:      Option.none(),
                                status:         Option.some(input.toolCall.status),
                            }),
                            database.agentJournal.put({
                                appId:            input.appId,
                                entryKind:        'checkpoint',
                                operation:        Option.none(),
                                payloadJson: {
                                    chatJson:     input.checkpoint.chatJson,
                                    loopState:    input.checkpoint.loopState,
                                    sceneSummary: Option.getOrNull(input.checkpoint.sceneSummary),
                                },
                                runId:            input.toolCall.runId,
                                sequence:         input.checkpoint.sequence,
                                sessionId:        input.checkpoint.sessionId,
                                stateHash:        Option.some(_hash(input.checkpoint.loopState)),
                                status:           Option.none(),
                            }),
                        ],
                        { discard: true },
                    ),
                ),
            ).pipe(Effect.asVoid),
        );
        const hydrate = Effect.fn('database.agentPersistence.hydrate')((input: {
            readonly appId:     string;
            readonly sessionId: string;
        }) =>
            _withApp(input.appId, database.agentJournal.by('bySession', input.sessionId)).pipe(
                Effect.map((entries) =>
                    entries
                        .filter((entry) => entry.entryKind === 'checkpoint')
                        .toSorted((left, right) => right.sequence - left.sequence)[0],
                ),
                Effect.map((checkpoint) => Option.fromNullable(checkpoint)),
                Effect.map(
                    Option.match({
                        onNone: () => ({ fresh: true }) as HydrateResult,
                        onSome: (checkpoint) => {
                            const payload = _record(checkpoint.payloadJson);
                            const loopState = payload['loopState'] ?? {};
                            const chatJson = Match.value(payload['chatJson']).pipe(
                                Match.when(Match.string, (value) => value),
                                Match.orElse(() => ''),
                            );
                            const stateHash = Option.getOrElse(checkpoint.stateHash, () => '');
                            return {
                                chatJson,
                                diverged: stateHash.length > 0 && _hash(loopState) !== stateHash,
                                fresh:    false,
                                sequence: checkpoint.sequence,
                                state:    loopState,
                            } as HydrateResult;
                        },
                    }),
                ),
            ),
        );
        const findResumable = Effect.fn('database.agentPersistence.findResumable')((appId: string) =>
            _withApp(
                appId,
                Effect.all([
                    database.agentJournal.find([{ field: 'entryKind', value: 'session_start'    }], { asc: false }),
                    database.agentJournal.find([{ field: 'entryKind', value: 'session_complete' }], { asc: false }),
                ]),
            ).pipe(
                Effect.map(([starts, completions]) => {
                    const completedSessionIds = new Set(completions.map((entry) => entry.sessionId));
                    return starts
                        .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
                        .find((entry) => {
                            const status = Option.getOrElse(entry.status, () => 'running' as const);
                            return !completedSessionIds.has(entry.sessionId) && (status === 'running' || status === 'interrupted');
                        });
                }),
                Effect.map((entry) => Option.fromNullable(entry).pipe(Option.map((row) => row.sessionId))),
            ),
        );
        const listSessions = Effect.fn('database.agentPersistence.listSessions')((input: {
            readonly appId:  string;
            readonly filter: SessionFilter;
        }) =>
            _withApp(
                input.appId,
                Effect.all([
                    database.agentJournal.find([{ field: 'entryKind', value: 'session_start'    }], { asc: false }),
                    database.agentJournal.find([{ field: 'entryKind', value: 'session_complete' }], { asc: false }),
                ]),
            ).pipe(
                Effect.map(([starts, completions]) => {
                    const completionBySession = new Map(completions.map((entry) => [entry.sessionId, entry] as const));
                    return starts
                        .map((start) => {
                            const startPayload = _record(start.payloadJson);
                            const completion = completionBySession.get(start.sessionId);
                            const completionPayload = _record(completion?.payloadJson);
                            const startedAt = Match.value(startPayload['startedAt']).pipe(
                                Match.when(Match.instanceOf(Date), (value) => value),
                                Match.orElse(() => start.createdAt),
                            );
                            const endedAt = Match.value(completionPayload['endedAt']).pipe(
                                Match.when(Match.instanceOf(Date), (value) => Option.some(value)),
                                Match.when(Match.string, (value) => Option.some(new Date(value))),
                                Match.orElse(() => Option.none<Date>()),
                            );
                            const status: AgentSessionStatus = Match.value(Option.getOrElse(completion?.status ?? Option.none(), () => Option.getOrElse(start.status, () => 'running' as const))).pipe(
                                Match.when('completed', () => 'completed' as const),
                                Match.when('failed', () => 'failed' as const),
                                Match.when('interrupted', () => 'interrupted' as const),
                                Match.when('running', () => 'running' as const),
                                Match.orElse(() => 'running' as const),
                            );
                            return {
                                appId: input.appId,
                                endedAt,
                                error: Match.value(completionPayload['error']).pipe(
                                    Match.when(Match.string, (value) => Option.some(value)),
                                    Match.orElse(() => Option.none<string>()),
                                ),
                                id:       start.sessionId,
                                metadata: _record(startPayload['metadata']),
                                runId:    start.runId,
                                startedAt,
                                status,
                                toolCallCount: Match.value(completionPayload['toolCallCount'] ?? startPayload['toolCallCount']).pipe(
                                    Match.when(Match.number, (value) => value),
                                    Match.orElse(() => 0),
                                ),
                                updatedAt: completion?.createdAt ?? start.createdAt,
                                userId: Match.value(startPayload['userId']).pipe(
                                    Match.when(Match.string, (value) => Option.some(value)),
                                    Match.orElse(() => Option.none<string>()),
                                ),
                            };
                        })
                        .filter((session) => {
                            const afterOk =  input.filter.after ===  undefined || session.startedAt >= input.filter.after;
                            const beforeOk = input.filter.before === undefined || session.startedAt <= input.filter.before;
                            const statusOk = input.filter.status === undefined || input.filter.status.length === 0 || input.filter.status.includes(session.status);
                            return afterOk && beforeOk && statusOk;
                        })
                        .toSorted((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
                }),
            ),
        );
        const sessionTrace = Effect.fn('database.agentPersistence.sessionTrace')((input: {
            readonly appId: string;
            readonly sessionId: string;
        }) =>
            _withApp(input.appId, database.agentJournal.by('bySession', input.sessionId)).pipe(
                Effect.map((entries) =>
                    entries
                        .filter((entry) => entry.entryKind === 'tool_call')
                        .toSorted((left, right) => left.sequence - right.sequence)
                        .map((entry) => {
                            const payload = _record(entry.payloadJson);
                            return {
                                appId:      entry.appId,
                                createdAt:  entry.createdAt,
                                durationMs: Match.value(payload['durationMs']).pipe(
                                    Match.when(Match.number, (value) => value),
                                    Match.orElse(() => 0),
                                ),
                                error: Match.value(payload['error']).pipe(
                                    Match.when(Match.string, (value) => Option.some(value)),
                                    Match.orElse(() => Option.none<string>()),
                                ),
                                operation: Option.getOrElse(entry.operation, () => 'unknown'),
                                params:    payload['params'] ?? {},
                                result:    Option.fromNullable(payload['result']),
                                runId:     entry.runId,
                                sequence:  entry.sequence,
                                sessionId: entry.sessionId,
                                status: Match.value(Option.getOrElse(entry.status, () => 'ok' as const)).pipe(
                                    Match.when('error', () => 'error' as const),
                                    Match.when('ok', () => 'ok' as const),
                                    Match.orElse(() => 'error' as const),
                                ),
                            };
                        }),
                ),
            ),
        );
        return {
            completeSession, createSession, findResumable, hydrate,
            idempotency, listSessions, persist, sessionTrace,
        } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const AgentPersistenceLayer = (config: Parameters<typeof PgClient.layerConfig>[0]) =>
    Layer.mergeAll(
        AgentPersistenceService.Default,
        DatabaseService.Default,
    ).pipe(Layer.provideMerge(PgClient.layerConfig(config)));

// --- [EXPORT] ----------------------------------------------------------------

export { AgentPersistenceLayer, AgentPersistenceService };
