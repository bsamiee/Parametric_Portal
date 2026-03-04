import { createHash } from 'node:crypto';
import { Toolkit, Tool } from '@effect/ai';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { Context } from '@parametric-portal/server/context';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Cron, Effect, Layer, Match, Option, Schema as S } from 'effect';
import { AiRuntime } from './runtime.ts';
import { AiError, AiRuntimeProvider } from './runtime-provider.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const ManifestEntrySchema = S.Struct({
    aliases:         S.optionalWith(S.Array(S.NonEmptyTrimmedString), { default: () => [] }),
    category:        S.optional(S.NonEmptyTrimmedString),
    description:     S.NonEmptyString,
    examples:        S.Array(S.Struct({ description: S.optional(S.String), input: S.NonEmptyString })),
    id:              S.NonEmptyTrimmedString,
    isDestructive:   S.optional(S.Boolean),
    name:            S.NonEmptyTrimmedString,
    params:          S.Array(S.Struct({
        default:     S.optional(S.Unknown),
        description: S.optional(S.String),
        name:        S.NonEmptyTrimmedString,
        required:    S.Boolean,
        type:        S.NonEmptyTrimmedString,
    })),
});
const _ManifestSchema = S.parseJson(S.Array(ManifestEntrySchema));

// --- [SERVICES] --------------------------------------------------------------

class AiService extends Effect.Service<AiService>()('ai/Service', {
    effect: Effect.gen(function* () {
        const model    = yield* AiRuntime;
        const audit    = yield* AuditService;
        const database = yield* DatabaseService;
        const metrics  = yield* MetricsService;
        const _track = (label: string, details: Record<string, unknown>, subjectId: string, metricCounter: typeof metrics.search.queries, metricLabels: ReturnType<typeof MetricsService.label>) =>
            Effect.all([
                audit.log(label, { details, subjectId }),
                MetricsService.inc(metricCounter, metricLabels),
            ], { discard: true });
        const _resolveSearchContext = (defaultSubject = 'anonymous') => Effect.gen(function* () {
            const ctx = yield* Context.Request.current;
            return {
                ctx,
                scopeId:   ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId,
                subjectId: Option.map(ctx.session, (s) => s.userId).pipe(Option.getOrElse(() => defaultSubject)),
            } as const;
        });
        const _embedAndUpsert = (
            operation: string,
            items: ReadonlyArray<{ readonly documentHash: string; readonly entityId: string; readonly entityType: string; readonly scopeId: string | null }>,
            texts: readonly string[],
            embeddingSettings: { readonly dimensions: number; readonly model: string },
        ) => model.embed(texts).pipe(
            Effect.filterOrFail(
                (v) => v.length === items.length,
                (v) => new AiError({ cause: { actual: v.length, expected: items.length }, operation, reason: 'unknown' }),
            ),
            Effect.flatMap((vectors) =>
                Effect.forEach(items, (item, i) =>
                    database.search.upsertEmbedding({ dimensions: embeddingSettings.dimensions, documentHash: item.documentHash, embedding: A.unsafeGet(vectors, i), entityId: item.entityId, entityType: item.entityType, model: embeddingSettings.model, scopeId: item.scopeId }),
                    { concurrency: 10, discard: true },
                ),
            ),
        );
        const seedKnowledge = Effect.fn('AiService.seedKnowledge')((input: {
            readonly entityType: string;
            readonly manifest:   ReadonlyArray<typeof ManifestEntrySchema.Type> | string;
            readonly namespace?: string | undefined;
            readonly scopeId?:   string | null | undefined;
        }) => Effect.gen(function* () {
            const entries = typeof input.manifest === 'string' ? yield* S.decodeUnknown(_ManifestSchema)(input.manifest) : input.manifest;
            const namespace = input.namespace ?? 'ai';
            const scopeId = input.scopeId ?? null;
            const entityIds = A.map(entries, (e) => {
                const hex = createHash('sha256').update(`${namespace}:${input.entityType}:${e.id}`).digest('hex');
                return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(0x80 | (Number.parseInt(hex.slice(16, 18), 16) & 0x3f)).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
            });
            const sources = A.map(entries, (e) => {
                const parts = [
                    e.name,
                    ...e.aliases,
                    ...(e.category === undefined ? [] : [e.category]),
                    e.description,
                    ...e.params.map((p) => `${p.name}: ${p.description ?? p.type}`),
                    ...e.examples.map((x) => x.description ?? x.input).filter((t): t is string => Boolean(t)),
                ];
                return parts.join(' ');
            });
            const settings = yield* model.settings();
            const { dimensions, model: embeddingModel } = settings.embedding;
            const docs = yield* Effect.forEach(entries, (e, i) =>
                database.search.upsertDocument({
                    contentText: e.description, displayText: e.name, entityId: A.unsafeGet(entityIds, i), entityType: input.entityType,
                    metadata: { aliases: e.aliases, category: e.category, examples: e.examples, id: e.id, isDestructive: e.isDestructive, params: e.params },
                    scopeId,
                }),
                { concurrency: 10 },
            );
            yield* _embedAndUpsert(
                'seedKnowledge',
                A.map(docs, (doc, i) => ({ documentHash: doc.documentHash, entityId: A.unsafeGet(entityIds, i), entityType: input.entityType, scopeId })),
                sources,
                { dimensions, model: embeddingModel },
            );
            return { upserted: entries.length } as const;
        }));
        const searchQuery = Effect.fn('AiService.searchQuery')(
                (options: {
                    readonly entityTypes?:     readonly string[] | undefined;
                    readonly includeFacets?:   boolean | undefined;
                    readonly includeGlobal?:   boolean | undefined;
                    readonly includeSnippets?: boolean | undefined;
                    readonly term: string;
                }, pagination?: { readonly cursor?: string | undefined; readonly limit?: number | undefined }) =>
                Effect.gen(function* () {
                    const { ctx, scopeId, subjectId } = yield* _resolveSearchContext();
                    const discovery = yield* model.discovery();
                    const providerCandidates = yield* model.providerToolSearch({ limit: pagination?.limit, term: options.term }).pipe(
                        Effect.catchAll((error) => Effect.logWarning('ai.discovery.provider.search.failed', { error: String(error) }).pipe(
                            Effect.as([] as ReadonlyArray<string>),
                        )),
                    );
                    const settings = yield* model.settings();
                    const { dimensions, model: embeddingModel } = settings.embedding;
                    const embedding = yield* model.embed(options.term).pipe(
                        Effect.tapError((e) => Effect.logWarning('Search embedding failed', { error: String(e), tenantId: ctx.tenantId })),
                        Effect.option,
                    );
                    const fallbackResult = yield* database.search.search(
                        { ...options, scopeId, ...Option.match(embedding, { onNone: () => ({}), onSome: (vector) => ({ embedding: { dimensions, model: embeddingModel, vector } }) }) },
                        pagination,
                    );
                    const result = Match.value(providerCandidates.length).pipe(
                        Match.when(0, () => fallbackResult),
                        Match.orElse(() => {
                            const itemById = new Map<string, (typeof fallbackResult.items)[number]>(
                                fallbackResult.items.flatMap((item) =>
                                    Option.fromNullable(item.metadata).pipe(
                                        Option.flatMap((metadata) =>
                                            Option.fromNullable((metadata as Record<string, unknown>)['id']).pipe(
                                                Option.filter((id): id is string => typeof id === 'string'),
                                            )),
                                        Option.match({
                                            onNone: () => [] as ReadonlyArray<readonly [string, (typeof fallbackResult.items)[number]]>,
                                            onSome: (id) => [[id, item] as const],
                                        }),
                                    )),
                            );
                            const ranked = providerCandidates.flatMap((candidateId) =>
                                Option.fromNullable(itemById.get(candidateId)).pipe(
                                    Option.match({
                                        onNone: () => [] as typeof fallbackResult.items,
                                        onSome: (item) => [item] as typeof fallbackResult.items,
                                    }),
                                ),
                            );
                            return ranked.length === 0
                                ? fallbackResult
                                : {
                                    ...fallbackResult,
                                    cursor:  null,
                                    hasNext: false,
                                    hasPrev: false,
                                    items:   ranked,
                                    total:   ranked.length,
                                };
                        }),
                    );
                    yield* Effect.logDebug('ai.discovery.provider.candidates', {
                        candidateCount: providerCandidates.length,
                        provider: discovery.provider,
                        toolSearchEnabled: discovery.anthropicToolSearchEnabled,
                    });
                    yield* _track('Search.read', { entityTypes: options.entityTypes, resultCount: result.total, term: options.term }, subjectId, metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId }));
                    return result;
                }).pipe(Telemetry.span('search.query', { 'search.term': options.term })),
        );
        const searchRefresh = Effect.fn('AiService.searchRefresh')((includeGlobal = false) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* _resolveSearchContext('system');
                yield* database.search.refresh(scopeId, includeGlobal);
                yield* _track('Search.refresh', { includeGlobal, kind: 'index', scopeId }, subjectId, metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId }));
            }).pipe(Telemetry.span('search.refresh', { 'search.includeGlobal': includeGlobal })),
        );
        const searchRefreshEmbeddings = Effect.fn('AiService.searchRefreshEmbeddings')((options?: {
            readonly entityTypes?:   readonly string[] | undefined;
            readonly includeGlobal?: boolean | undefined;
            readonly limit?:         number | undefined;
        }) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* _resolveSearchContext('system');
                const settings = yield* model.settings();
                const { dimensions, model: embeddingModel } = settings.embedding;
                const sources = yield* database.search.embeddingSources({
                    dimensions,
                    entityTypes:   options?.entityTypes ?? [],
                    includeGlobal: options?.includeGlobal ?? false,
                    limit:         options?.limit,
                    model:         embeddingModel,
                    scopeId,
                });
                yield* _embedAndUpsert('searchRefreshEmbeddings', sources, A.map(sources, (s) => s.embeddingSource), { dimensions, model: embeddingModel });
                yield* _track('Search.refresh',
                    {count: sources.length, includeGlobal: options?.includeGlobal ?? false, kind: 'embeddings', scopeId },
                    subjectId,
                    metrics.search.refreshes,
                    MetricsService.label({ kind: 'embeddings', tenant: ctx.tenantId })
                );
                return { count: sources.length };
            }).pipe(Telemetry.span('search.refreshEmbeddings', { 'search.includeGlobal': options?.includeGlobal ?? false })),
        );
        const searchSuggest = Effect.fn('AiService.searchSuggest')((options: {
            readonly includeGlobal?: boolean | undefined;
            readonly limit?:         number | undefined;
            readonly prefix:         string;
        }) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* _resolveSearchContext();
                const result = yield* database.search.suggest({ ...options, scopeId });
                yield* _track('Search.list', { prefix: options.prefix, resultCount: result.length }, subjectId, metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId }));
                return result;
            }).pipe(Telemetry.span('search.suggest', { 'search.prefix': options.prefix })),
        );
        const buildAgentToolkit = Effect.fn('AiService.buildAgentToolkit')(
            <
                CatalogSuccess,
                CatalogEncoded extends Record<string, unknown>,
                CommandSuccess,
                CommandEncoded extends Record<string, unknown>,
                ContextSuccess,
                ContextEncoded extends Record<string, unknown>,
            >(input: {
                readonly catalogSearch: (term: string) => Effect.Effect<CatalogSuccess, never, never>;
                readonly commandExecute: (payload: { readonly commandId: string; readonly args: Record<string, unknown> }) => Effect.Effect<CommandSuccess, never, never>;
                readonly readContext: (query: string) => Effect.Effect<ContextSuccess, never, never>;
                readonly schemas: {
                    readonly catalogSearch: S.Schema<CatalogSuccess, CatalogEncoded, never>;
                    readonly commandExecute: S.Schema<CommandSuccess, CommandEncoded, never>;
                    readonly readContext: S.Schema<ContextSuccess, ContextEncoded, never>;
                };
            }) =>
            Effect.sync(() => {
                const toolkit = Toolkit.make(
                    Tool.make('catalog.search', {
                        description: 'Searches command catalog entries by semantic query.',
                        parameters:  { term: S.NonEmptyTrimmedString },
                        success:     input.schemas.catalogSearch,
                    }),
                    Tool.make('command.execute', {
                        description: 'Executes a plugin command using catalog commandId plus structured args.',
                        parameters:  { args: S.Record({ key: S.String, value: S.Unknown }), commandId: S.NonEmptyTrimmedString },
                        success:     input.schemas.commandExecute,
                    }),
                    Tool.make('context.read', {
                        description: 'Reads scoped context artifacts required by the current step.',
                        parameters:  { query: S.NonEmptyTrimmedString },
                        success:     input.schemas.readContext,
                    }),
                );
                return {
                    layer: toolkit.toLayer({
                        'catalog.search': ({ term }) => input.catalogSearch(term),
                        'command.execute': ({ args, commandId }) => input.commandExecute({ args, commandId }),
                        'context.read': ({ query }) => input.readContext(query),
                    }),
                    toolkit,
                } as const;
            }),
        );
        const runAgentCore = Effect.fn('AiService.runAgentCore')(<
            State,
            Plan,
            Execution,
            Verification,
            PlanError,
            ExecuteError,
            VerifyError,
            DecideError,
            PersistError,
            PlanContext,
            ExecuteContext,
            VerifyContext,
            DecideContext,
            PersistContext,
        >(input: {
            readonly decide: (state: State, plan: Plan, execution: Execution, verification: Verification) => Effect.Effect<State, DecideError, DecideContext>;
            readonly execute: (state: State, plan: Plan) => Effect.Effect<Execution, ExecuteError, ExecuteContext>;
            readonly initialState: State;
            readonly isTerminal: (state: State) => boolean;
            readonly persist: (state: State, plan: Plan, execution: Execution, verification: Verification, decision: State) => Effect.Effect<void, PersistError, PersistContext>;
            readonly plan: (state: State) => Effect.Effect<Plan, PlanError, PlanContext>;
            readonly verify: (state: State, plan: Plan, execution: Execution) => Effect.Effect<Verification, VerifyError, VerifyContext>;
        }) =>
            Effect.iterate(input.initialState, {
                body: (state) => Effect.gen(function* () {
                    const planResult = yield* input.plan(state);
                    const executionResult = yield* input.execute(state, planResult);
                    const verificationResult = yield* input.verify(state, planResult, executionResult);
                    const decisionResult = yield* input.decide(state, planResult, executionResult, verificationResult);
                    yield* input.persist(state, planResult, executionResult, verificationResult, decisionResult);
                    return decisionResult;
                }),
                while: (state) => !input.isTerminal(state),
            }),
        );
        return { buildAgentToolkit, model, runAgentCore, searchQuery, searchRefresh, searchRefreshEmbeddings, searchSuggest, seedKnowledge } as const;
    }),
}) {
    static readonly EmbeddingCron = ClusterService.Schedule.cron({
        cron: Cron.unsafeParse('0 3 * * *'),
        execute: Effect.gen(function* () {
            const [ai, database] = yield* Effect.all([AiService, DatabaseService]);
            const apps = yield* Context.Request.withinSync(Context.Request.Id.system, database.apps.find([{ field: 'id', op: 'notNull' }]), Context.Request.system());
            yield* Effect.forEach(apps, (app) => Context.Request.withinSync(app.id, ai.searchRefreshEmbeddings({ includeGlobal: false }), Context.Request.system()), { concurrency: 5, discard: true });
            yield* Context.Request.withinSync(Context.Request.Id.system, ai.searchRefreshEmbeddings({ includeGlobal: true }), Context.Request.system());
        }),
        name: 'refresh-embeddings',
    });
    static readonly KnowledgeDefault = Layer.mergeAll(AiService.Default, AiRuntime.Default, AiRuntimeProvider.Default        );
    static readonly KnowledgeLive =    Layer.mergeAll(AiService.Default, AiRuntime.Live, DatabaseService.Default, SearchRepo.Default);
    static readonly Live =             Layer.mergeAll(AiService.Default, AiRuntime.Live                                                    );
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiService, ManifestEntrySchema };
