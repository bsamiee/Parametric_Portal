import { createHash } from 'node:crypto';
import { PgClient } from '@effect/sql-pg';
import { Effect, Layer, Match, Option, Schema as S } from 'effect';
import { Client } from './client.ts';
import { DatabaseService } from './repos.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const Vocab = {
    kind: { checkpoint: 'checkpoint', session_complete: 'session_complete', session_start: 'session_start', tool_call: 'tool_call' },
    session: { completed: 'completed', failed: 'failed', interrupted: 'interrupted', running: 'running' },
    tool: { error: 'error', ok: 'ok' },
} as const;
const Payload = {
    checkpoint:       S.Struct({ chatJson:   S.String, loopState: S.Unknown, sceneSummary: S.optional(S.Unknown) }),
    session_complete: S.Struct({ endedAt:    S.optional(S.Union(S.DateFromSelf, S.String)), error: S.optional(S.NullOr(S.String)), toolCallCount: S.optional(S.Number) }),
    session_start:    S.Struct({ metadata:   S.optional(S.Record({ key: S.String, value: S.Unknown })), startedAt: S.optional(S.DateFromSelf), toolCallCount: S.optional(S.Number), userId: S.optional(S.NullOr(S.String)) }),
    tool_call:        S.Struct({ durationMs: S.optional(S.Number), error: S.optional(S.NullOr(S.String)), params: S.optional(S.Unknown), result: S.optional(S.Unknown) }),
} as const;

// --- [TYPES] -----------------------------------------------------------------

type SessionStatus = (typeof Vocab.session)[keyof typeof Vocab.session];
type HydrateResult = { fresh: true } | { chatJson: string; diverged: boolean; fresh: false; sequence: number; state: unknown };

// --- [FUNCTIONS] -------------------------------------------------------------

const hash = (state: unknown): string => {
    const rec = (v: unknown): unknown =>
        Match.value(v).pipe(
            Match.when(Match.instanceOf(Array), (arr) => arr.map(rec)),
            Match.when((x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null, (o) =>
                Object.fromEntries(Object.entries(o).toSorted(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, rec(val)])),
            ),
            Match.orElse((x) => x),
        );
    return createHash('sha256').update(JSON.stringify(rec(state))).digest('hex');
};
const idempotency = (i: { payload: unknown; correlationId: string; sequence: number }) =>
    ({ idempotencyKey: `run:${i.correlationId.slice(0, 8)}:seq:${String(i.sequence).padStart(4, '0')}`, payloadHash: hash(i.payload) }) as const;

// --- [SERVICES] --------------------------------------------------------------

class AgentPersistenceService extends Effect.Service<AgentPersistenceService>()('database/AgentPersistenceService', {
    dependencies: [DatabaseService.Default],
    effect: Effect.gen(function* () {
        const db = yield* DatabaseService;
        const put = db.agentJournal.put;
        const createSession = Effect.fn('database.agentPersistence.createSession')((i: {
            appId: string; correlationId: string; sessionId: string; startedAt: Date; status: 'running' | 'interrupted'; toolCallCount: number;
            metadata?: Record<string, unknown>; userId?: string;
        }) =>
            Client.tenant.with(i.appId, put({
                appId: i.appId, entryKind: Vocab.kind.session_start, operation: Option.none(),
                payloadJson: { metadata: i.metadata ?? {}, startedAt: i.startedAt, toolCallCount: i.toolCallCount, userId: i.userId ?? null },runId: i.correlationId, sequence: 0, sessionId: i.sessionId, stateHash: Option.none(),
                status: Option.some(i.status),
            })),
        );
        const completeSession = Effect.fn('database.agentPersistence.completeSession')((i: {
            appId: string; correlationId: string; sessionId: string; status: 'completed' | 'failed'; toolCallCount: number;
            endedAt?: Date; error?: string;
        }) =>
            Client.tenant.with(i.appId, put({
                appId: i.appId, entryKind: Vocab.kind.session_complete,operation: Option.none(),
                payloadJson: { endedAt: i.endedAt ?? new Date(), error: i.error ?? null, toolCallCount: i.toolCallCount },runId: i.correlationId, sequence: i.toolCallCount, sessionId: i.sessionId, stateHash: Option.none(),
                status: Option.some(i.status),
            })).pipe(Effect.asVoid),
        );
        const persist = Effect.fn('database.agentPersistence.persist')((i: {
            appId: string;
            checkpoint: { chatJson: string; loopState: unknown; sceneSummary: Option.Option<unknown>; sequence: number; sessionId: string };
            toolCall: { correlationId: string; durationMs: number; error: Option.Option<string>; operation: string; params: unknown; result: Option.Option<unknown>; sequence: number; sessionId: string; status: 'ok' | 'error' };
        }) =>
            Client.tenant.with(i.appId, db.withTransaction(Effect.all([
                put({ appId: i.appId, entryKind: Vocab.kind.tool_call, operation: Option.some(i.toolCall.operation), payloadJson: { durationMs: i.toolCall.durationMs, error: Option.getOrNull(i.toolCall.error), params: i.toolCall.params, result: Option.getOrNull(i.toolCall.result) }, runId: i.toolCall.correlationId, sequence: i.toolCall.sequence, sessionId: i.toolCall.sessionId, stateHash: Option.none(), status: Option.some(i.toolCall.status) }),
                put({ appId: i.appId, entryKind: Vocab.kind.checkpoint, operation: Option.none(), payloadJson: { chatJson: i.checkpoint.chatJson, loopState: i.checkpoint.loopState, sceneSummary: Option.getOrNull(i.checkpoint.sceneSummary) }, runId: i.toolCall.correlationId, sequence: i.checkpoint.sequence, sessionId: i.checkpoint.sessionId, stateHash: Option.some(hash(i.checkpoint.loopState)), status: Option.none() }),
            ], { discard: true }))),
        );
        const hydrate = Effect.fn('database.agentPersistence.hydrate')((i: { appId: string; sessionId: string }) =>
            Client.tenant.with(i.appId, db.agentJournal.by('bySession', i.sessionId)).pipe(
                Effect.map((e) => e.filter((x) => x.entryKind === Vocab.kind.checkpoint).toSorted((a, b) => b.sequence - a.sequence)[0]),
                Effect.flatMap((cp) => cp === undefined
                    ? Effect.succeed({ fresh: true } as HydrateResult)
                    : S.decodeUnknown(Payload.checkpoint)(cp.payloadJson).pipe(Effect.map((p) => ({
                        chatJson: p.chatJson,
                        diverged: Option.isSome(cp.stateHash) && Option.getOrElse(cp.stateHash, () => '') !== hash(p.loopState),
                        fresh: false, sequence: cp.sequence, state: p.loopState,
                    }) satisfies HydrateResult)),
                ),
            ),
        );
        const findResumable = Effect.fn('database.agentPersistence.findResumable')((appId: string) =>
            Client.tenant.with(appId, Effect.all([
                db.agentJournal.find([{ field: 'entryKind', value: Vocab.kind.session_start }], { asc: false }),
                db.agentJournal.find([{ field: 'entryKind', value: Vocab.kind.session_complete }], { asc: false }),
            ])).pipe(Effect.map(([starts, completions]) => {
                const done = new Set(completions.map((c) => c.sessionId));
                return Option.fromNullable(starts.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).find((e) => {
                    const s = Option.getOrElse(e.status, () => Vocab.session.running);
                    return !done.has(e.sessionId) && (s === Vocab.session.running || s === Vocab.session.interrupted);
                })?.sessionId);
            })),
        );
        const listSessions = Effect.fn('database.agentPersistence.listSessions')((i: { appId: string; filter?: { after?: Date; before?: Date; status?: ReadonlyArray<SessionStatus> } }) =>
            Client.tenant.with(i.appId, Effect.all([db.agentJournal.find([{ field: 'entryKind', value: Vocab.kind.session_start }], { asc: false }), db.agentJournal.find([{ field: 'entryKind', value: Vocab.kind.session_complete }], { asc: false })])).pipe(
                Effect.flatMap(([starts, completions]) => {
                    const cMap = new Map(completions.map((c) => [c.sessionId, c] as const));
                    return Effect.forEach(starts, (s) => {
                        const comp = cMap.get(s.sessionId);
                        return S.decodeUnknown(Payload.session_start)(s.payloadJson).pipe(
                            Effect.flatMap((sp) => comp === undefined
                                ? Effect.succeed({ comp: undefined as typeof comp, cpVal: undefined as S.Schema.Type<typeof Payload.session_complete> | undefined, sp })
                                : S.decodeUnknown(Payload.session_complete)(comp.payloadJson).pipe(Effect.map((cpVal) => ({ comp, cpVal, sp })))),
                            Effect.map(({ sp, cpVal, comp: c }) => {
                                const rawStatus = String(Option.getOrElse(c?.status ?? s.status, () => ''));
                                return {
                                    appId: i.appId, correlationId: s.runId, endedAt: Option.fromNullable(cpVal?.endedAt).pipe(Option.map((v) => v instanceof Date ? v : new Date(v))),
                                    error: Option.fromNullable(cpVal?.error), id: s.sessionId, metadata: (sp.metadata ?? {}) as Record<string, unknown>,
                                    startedAt: sp.startedAt ?? s.createdAt, status: (rawStatus in Vocab.session ? rawStatus : Vocab.session.running) as SessionStatus,
                                    toolCallCount: cpVal?.toolCallCount ?? sp.toolCallCount ?? 0, updatedAt: c?.createdAt ?? s.createdAt, userId: Option.fromNullable(sp.userId),
                                };
                            }),
                        );
                    }, { concurrency: 'unbounded' });
                }),
                Effect.map((sess) => {
                    const f = i.filter;
                    return sess.filter((x) => (!f?.after || x.startedAt >= f.after) && (!f?.before || x.startedAt <= f.before) && (!f?.status?.length || f.status.includes(x.status))).toSorted((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
                }),
            ),
        );
        const sessionTrace = Effect.fn('database.agentPersistence.sessionTrace')((i: { appId: string; sessionId: string }) =>
            Client.tenant.with(i.appId, db.agentJournal.by('bySession', i.sessionId)).pipe(
                Effect.flatMap((entries) => Effect.forEach(
                    entries.filter((e) => e.entryKind === Vocab.kind.tool_call).toSorted((a, b) => a.sequence - b.sequence),
                    (e) => S.decodeUnknown(Payload.tool_call)(e.payloadJson).pipe(Effect.map((p) => ({
                        appId: e.appId, correlationId: e.runId, createdAt: e.createdAt,
                        durationMs: p.durationMs ?? 0, error: Option.fromNullable(p.error),
                        operation: Option.getOrElse(e.operation, () => 'unknown'),params: p.params ?? {}, result: Option.fromNullable(p.result), sequence: e.sequence, sessionId: e.sessionId,
                        status: Option.getOrElse(e.status, () => Vocab.tool.ok) === Vocab.tool.error ? Vocab.tool.error : Vocab.tool.ok,
                    }))),
                    { concurrency: 'unbounded' },
                )),
            ),
        );
        return { completeSession, createSession, findResumable, hydrate, idempotency, listSessions, persist, sessionTrace } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const AgentPersistenceLayer = (config: Parameters<typeof PgClient.layerConfig>[0]) => AgentPersistenceService.Default.pipe(Layer.provideMerge(PgClient.layerConfig(config)));

// --- [EXPORT] ----------------------------------------------------------------

export { AgentPersistenceLayer, AgentPersistenceService, type HydrateResult };
