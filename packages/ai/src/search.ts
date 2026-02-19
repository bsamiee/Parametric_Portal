import { DatabaseService } from '@parametric-portal/database/repos';
import { Context } from '@parametric-portal/server/context';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Cron, Data, Effect, Option, pipe } from 'effect';
import { constant } from 'effect/Function';
import { AiRuntime } from './runtime.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cron:   { embeddings: { concurrency: 5, name: 'refresh-embeddings', schedule: '0 3 * * *' } },
    labels: { embeddings: 'embeddings' },
    text:   { joiner: ' ' },
    users:  { anonymous: 'anonymous', system: 'system' },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const _sourceText = (src: { readonly contentText: string | null; readonly displayText: string; readonly metadata: unknown }) =>
    A.filter(
        [
            src.displayText,
            src.contentText ?? undefined,
            Option.fromNullable(src.metadata).pipe(
                Option.map((m) => JSON.stringify(m)),
                Option.getOrUndefined,
            ),
        ],
        (value): value is string => value !== undefined && value !== '',
    ).join(_CONFIG.text.joiner);

// --- [CLASSES] ---------------------------------------------------------------

class AiSearchError extends Data.TaggedError('AiSearchError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('ai/Search', {
    effect: Effect.gen(function* () {
        const [database, audit, metrics, ai] = yield* Effect.all([
            DatabaseService,
            AuditService,
            MetricsService,
            AiRuntime,
        ]);
        const _observe = (
            operation: string,
            details: Record<string, unknown>,
            metric: Parameters<typeof MetricsService.inc>[0],
            subjectId: string,
            tenantId: string,
            labels?: Record<string, string>,
        ) =>
            Effect.all([
                audit.log(operation, { details, subjectId }),
                MetricsService.inc(metric, MetricsService.label({ tenant: tenantId, ...labels })),
            ], { discard: true });
        const requestContext = (fallback: string) =>
            Context.Request.current.pipe(
                Effect.map((ctx) => ({
                    ctx,
                    scopeId: ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId,
                    subjectId: pipe(ctx.session, Option.map((session) => session.userId), Option.getOrElse(constant(fallback))),
                })),
            );
        const query = (
            options: {
                readonly entityTypes?:     readonly string[] | undefined;
                readonly includeFacets?:   boolean | undefined;
                readonly includeGlobal?:   boolean | undefined;
                readonly includeSnippets?: boolean | undefined;
                readonly term:             string;
            },
            pagination?: { readonly cursor?: string | undefined; readonly limit?: number | undefined },) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* requestContext(_CONFIG.users.anonymous);
                const appSettings = yield* ai.settings();
                const { dimensions, model } = appSettings.embedding;
                const embedding = yield* ai.embed(options.term).pipe(
                    Effect.tapError((error) =>
                        Effect.logWarning('Search embedding failed', {
                            error: String(error),
                            tenantId: ctx.tenantId,
                        }),
                    ),
                    Effect.option,
                );
                const result = yield* database.search.search(
                    {
                        ...options,
                        scopeId,
                        ...Option.match(embedding, {
                            onNone: () => ({}),
                            onSome: (vector) => ({
                                embedding: {
                                    dimensions,
                                    model,
                                    vector,
                                },
                            }),
                        }),
                    },
                    pagination,
                );
                yield* _observe('Search.read', { entityTypes: options.entityTypes, resultCount: result.total, term: options.term }, metrics.search.queries, subjectId, ctx.tenantId);
                return result;
            }).pipe(Telemetry.span('search.query', { 'search.term': options.term }));
        const suggest = (options: {
            readonly includeGlobal?: boolean | undefined;
            readonly limit?: number | undefined;
            readonly prefix: string;}) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* requestContext(_CONFIG.users.anonymous);
                const result = yield* database.search.suggest({ ...options, scopeId });
                yield* _observe('Search.list', { prefix: options.prefix, resultCount: result.length }, metrics.search.suggestions, subjectId, ctx.tenantId);
                return result;
            }).pipe(Telemetry.span('search.suggest', { 'search.prefix': options.prefix }));
        const refresh = (includeGlobal = false) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* requestContext(_CONFIG.users.system);
                yield* database.search.refresh(scopeId, includeGlobal);
                yield* _observe('Search.refresh', { includeGlobal, kind: 'index', scopeId }, metrics.search.refreshes, subjectId, ctx.tenantId);
            }).pipe(Telemetry.span('search.refresh', { 'search.includeGlobal': includeGlobal }));
        const refreshEmbeddings = (options?: {
            readonly entityTypes?: readonly string[] | undefined;
            readonly includeGlobal?: boolean | undefined;
            readonly limit?: number | undefined;}) =>
            Effect.gen(function* () {
                const { ctx, scopeId, subjectId } = yield* requestContext(_CONFIG.users.system);
                const appSettings = yield* ai.settings();
                const { dimensions, model } = appSettings.embedding;
                const sources = yield* database.search.embeddingSources({
                    dimensions,
                    entityTypes: options?.entityTypes ?? [],
                    includeGlobal: options?.includeGlobal ?? false,
                    limit: options?.limit,
                    model,
                    scopeId,
                });
                const texts = A.map(sources, _sourceText);
                const embeddings = yield* ai.embed(texts);
                yield* embeddings.length === sources.length
                    ? Effect.void
                    : Effect.fail(new AiSearchError({ cause: { actual: embeddings.length, expected: sources.length }, operation: 'refreshEmbeddings' }));
                yield* Effect.forEach(
                    A.zip(sources, embeddings),
                    ([source, embedding]) =>
                        database.search.upsertEmbedding({
                            dimensions,
                            documentHash: source.documentHash,
                            embedding,
                            entityId: source.entityId,
                            entityType: source.entityType,
                            model,
                            scopeId: source.scopeId,
                        }),
                    { discard: true },
                );
                yield* _observe('Search.refresh', { count: sources.length, includeGlobal: options?.includeGlobal ?? false, kind: _CONFIG.labels.embeddings, scopeId }, metrics.search.refreshes, subjectId, ctx.tenantId, { kind: _CONFIG.labels.embeddings });
                return { count: sources.length };
            }).pipe(Telemetry.span('search.refreshEmbeddings', { 'search.includeGlobal': options?.includeGlobal ?? false }),);
        return { query, refresh, refreshEmbeddings, suggest };
    }),
}) {
    static readonly EmbeddingCron = ClusterService.Schedule.cron({
        cron: Cron.unsafeParse(_CONFIG.cron.embeddings.schedule),
        execute: Effect.gen(function* () {
            const [database, search] = yield* Effect.all([DatabaseService, SearchService]);
            const apps = yield* Context.Request.withinSync(
                Context.Request.Id.system,
                database.apps.find([{ field: 'id', op: 'notNull' }]),
                Context.Request.system(),
            );
            yield* Effect.forEach(
                apps,
                (app) =>
                    Context.Request.withinSync(
                        app.id,
                        search.refreshEmbeddings({ includeGlobal: false }),
                        Context.Request.system(),
                    ),
                { concurrency: _CONFIG.cron.embeddings.concurrency, discard: true },
            );
            yield* Context.Request.withinSync(
                Context.Request.Id.system,
                search.refreshEmbeddings({ includeGlobal: true }),
                Context.Request.system(),
            );
        }),
        name: _CONFIG.cron.embeddings.name,
    });
}

// --- [EXPORT] ----------------------------------------------------------------

export { SearchService };
