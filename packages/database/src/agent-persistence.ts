import { createHash } from 'node:crypto';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Match, Option } from 'effect';
import { Client } from './client.ts';
import { DatabaseService } from './repos.ts';

// --- [TYPES] -----------------------------------------------------------------

type AgentSessionStatus = 'running' | 'completed' | 'failed' | 'interrupted';
type AgentToolCallStatus = 'ok' | 'error';
type SessionFilter = {
    readonly after?: Date | undefined;
    readonly before?: Date | undefined;
    readonly status?: ReadonlyArray<AgentSessionStatus> | undefined;
};
type HydrateResult =
    | { readonly fresh: true }
    | {
        readonly chatJson: string;
        readonly diverged: boolean;
        readonly fresh: false;
        readonly sequence: number;
        readonly state: unknown;
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

// --- [SERVICES] --------------------------------------------------------------

class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const database = yield* DatabaseService;
        const _withApp = <A, E, R>(appId: string, effect: Effect.Effect<A, E, R>) => Client.tenant.with(appId, effect);
        const createSession = Effect.fn('database.agentPersistence.createSession')((input: {
            readonly appId: string;
            readonly metadata?: Record<string, unknown> | undefined;
            readonly runId: string;
            readonly startedAt?: Date | undefined;
            readonly status: AgentSessionStatus;
            readonly toolCallCount: number;
            readonly userId?: string | undefined;
        }) =>
            _withApp(
                input.appId,
                database.agentSessions.put({
                    appId:         input.appId,
                    error:         Option.none(),
                    metadata:      input.metadata ?? {},
                    runId:         input.runId,
                    status:        input.status,
                    toolCallCount: input.toolCallCount,
                    userId:        Option.fromNullable(input.userId),
                }),
            ),
        );
        const completeSession = Effect.fn('database.agentPersistence.completeSession')((input: {
            readonly appId: string;
            readonly endedAt: Date;
            readonly error?: string | undefined;
            readonly sessionId: string;
            readonly status: 'completed' | 'failed';
            readonly toolCallCount: number;
        }) =>
            _withApp(
                input.appId,
                database.agentSessions.set(input.sessionId, {
                    endedAt:       Option.some(input.endedAt),
                    error:         Option.fromNullable(input.error),
                    status:        input.status,
                    toolCallCount: input.toolCallCount,
                }),
            ).pipe(Effect.asVoid),
        );
        const persist = Effect.fn('database.agentPersistence.persist')((input: {
            readonly appId: string;
            readonly checkpoint: {
                readonly chatJson: string;
                readonly loopState: unknown;
                readonly sceneSummary: Option.Option<unknown>;
                readonly sequence: number;
                readonly sessionId: string;
            };
            readonly toolCall: {
                readonly durationMs: number;
                readonly error: Option.Option<string>;
                readonly operation: string;
                readonly params: unknown;
                readonly result: Option.Option<unknown>;
                readonly runId: string;
                readonly sequence: number;
                readonly sessionId: string;
                readonly status: AgentToolCallStatus;
            };
        }) =>
            _withApp(
                input.appId,
                database.withTransaction(
                    Effect.all(
                        [
                            database.agentToolCalls.put({
                                appId:      input.appId,
                                durationMs: input.toolCall.durationMs,
                                error:      input.toolCall.error,
                                operation:  input.toolCall.operation,
                                params:     input.toolCall.params,
                                result:     input.toolCall.result,
                                runId:      input.toolCall.runId,
                                sequence:   input.toolCall.sequence,
                                sessionId:  input.toolCall.sessionId,
                                status:     input.toolCall.status,
                            }),
                            database.agentCheckpoints.upsert({
                                appId:        input.appId,
                                chatJson:     input.checkpoint.chatJson,
                                loopState:    input.checkpoint.loopState,
                                sceneSummary: input.checkpoint.sceneSummary,
                                sequence:     input.checkpoint.sequence,
                                sessionId:    input.checkpoint.sessionId,
                                stateHash:    _hash(input.checkpoint.loopState),
                            }),
                        ],
                        { discard: true },
                    ),
                ),
            ).pipe(Effect.asVoid),
        );
        const hydrate = Effect.fn('database.agentPersistence.hydrate')((input: {
            readonly appId: string;
            readonly sessionId: string;
        }) =>
            _withApp(input.appId, database.agentCheckpoints.by('bySession', input.sessionId)).pipe(
                Effect.map(
                    Option.match({
                        onNone: () => ({ fresh: true }) as HydrateResult,
                        onSome: (checkpoint) =>
                            ({
                                chatJson:  checkpoint.chatJson,
                                diverged:  _hash(checkpoint.loopState) !== checkpoint.stateHash,
                                fresh:     false,
                                sequence:  checkpoint.sequence,
                                state:     checkpoint.loopState,
                            }) as HydrateResult,
                    }),
                ),
            ),
        );
        const findResumable = Effect.fn('database.agentPersistence.findResumable')((appId: string) =>
            _withApp(
                appId,
                database.agentSessions.page([
                    { field: 'status', op: 'in', values: ['running', 'interrupted'] },
                ], { asc: false, limit: 1 }),
            ).pipe(
                Effect.map((result) => Option.fromNullable(result.items[0]?.id)),
            ),
        );
        const listSessions = Effect.fn('database.agentPersistence.listSessions')((input: {
            readonly appId: string;
            readonly filter: SessionFilter;
        }) =>
            _withApp(
                input.appId,
                database.agentSessions.find(
                    [
                        ...(input.filter.after === undefined
                            ? []
                            : [{ field: 'startedAt', op: 'gte' as const, value: input.filter.after }]),
                        ...(input.filter.before === undefined
                            ? []
                            : [{ field: 'startedAt', op: 'lte' as const, value: input.filter.before }]),
                        ...(input.filter.status === undefined || input.filter.status.length === 0
                            ? []
                            : [{ field: 'status', op: 'in' as const, values: [...input.filter.status] }]),
                    ],
                    { asc: false },
                ),
            ),
        );
        const sessionTrace = Effect.fn('database.agentPersistence.sessionTrace')((input: {
            readonly appId: string;
            readonly sessionId: string;
        }) =>
            _withApp(input.appId, database.agentToolCalls.by('bySession', input.sessionId)).pipe(
                Effect.map((calls) => calls.toSorted((left, right) => left.sequence - right.sequence)),
            ),
        );
        return {
            completeSession,
            createSession,
            findResumable,
            hash: _hash,
            hydrate,
            listSessions,
            persist,
            sessionTrace,
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
