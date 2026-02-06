import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { Context } from '@parametric-portal/server/context';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Cron, Data, Effect, Match, Option, pipe } from 'effect';
import { constant } from 'effect/Function';
import { AiRuntime } from './runtime.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    cron: { embeddings: { concurrency: 5, name: 'refresh-embeddings', schedule: '0 3 * * *' } },
    labels: { embeddings: 'embeddings' },
    text: { joiner: ' ' },
    users: { anonymous: 'anonymous', system: 'system' },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

function _sourceText(src: {
    readonly contentText: string | null;
    readonly displayText: string;
    readonly metadata: unknown;
}) {
    return A.filter(
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
}

// --- [CLASSES] ---------------------------------------------------------------

class AiSearchError extends Data.TaggedError('AiSearchError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {}

// --- [SERVICES] --------------------------------------------------------------

class SearchService extends Effect.Service<SearchService>()('ai/Search', {
    effect: Effect.gen(function* () {
        const [searchRepo, audit, metrics, ai] = yield* Effect.all([
            SearchRepo,
            AuditService,
            MetricsService,
            AiRuntime,
        ]);
        const userId = (ctx: Context.Request.Data, fallback: string) =>
            pipe(
                ctx.session,
                Option.map((session) => session.userId),
                Option.getOrElse(constant(fallback)),
            );
        const query = (
            options: {
                readonly entityTypes?: readonly string[];
                readonly includeFacets?: boolean;
                readonly includeGlobal?: boolean;
                readonly includeSnippets?: boolean;
                readonly term: string;
            },
            pagination?: { readonly cursor?: string; readonly limit?: number },) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = userId(ctx, _CONFIG.users.anonymous);
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
                const result = yield* searchRepo.search(
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
                yield* Effect.all(
                    [
                        audit.log('Search.query', {
                            details: {
                                entityTypes: options.entityTypes,
                                resultCount: result.total,
                                term: options.term,
                            },
                            subjectId,
                        }),
                        MetricsService.inc(metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId })),
                    ],
                    { discard: true },
                );
                return result;
            }).pipe(Telemetry.span('search.query', { 'search.term': options.term }));
        const suggest = (options: {
            readonly includeGlobal?: boolean;
            readonly limit?: number;
            readonly prefix: string;}) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = userId(ctx, _CONFIG.users.anonymous);
                const result = yield* searchRepo.suggest({ ...options, scopeId });
                yield* Effect.all(
                    [
                        audit.log('Search.suggest', {
                            details: { prefix: options.prefix, resultCount: result.length },
                            subjectId,
                        }),
                        MetricsService.inc(metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId })),
                    ],
                    { discard: true },
                );
                return result;
            }).pipe(Telemetry.span('search.suggest', { 'search.prefix': options.prefix }));
        const refresh = (includeGlobal = false) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = userId(ctx, _CONFIG.users.system);
                yield* searchRepo.refresh(scopeId, includeGlobal);
                yield* Effect.all(
                    [
                        audit.log('Search.refresh', { details: { includeGlobal, scopeId }, subjectId }),
                        MetricsService.inc(metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId })),
                    ],
                    { discard: true },
                );
            }).pipe(Telemetry.span('search.refresh', { 'search.includeGlobal': includeGlobal }));
        const refreshEmbeddings = (options?: {
            readonly entityTypes?: readonly string[];
            readonly includeGlobal?: boolean;
            readonly limit?: number;}) =>
            Effect.gen(function* () {
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = userId(ctx, _CONFIG.users.system);
                const appSettings = yield* ai.settings();
                const { dimensions, model } = appSettings.embedding;
                const sources = yield* searchRepo.embeddingSources({
                    dimensions,
                    entityTypes: options?.entityTypes ?? [],
                    includeGlobal: options?.includeGlobal ?? false,
                    limit: options?.limit,
                    model,
                    scopeId,
                });
                const texts = A.map(sources, _sourceText);
                const embeddings = yield* ai.embed(texts);
                yield* Match.value(embeddings.length === sources.length).pipe(
                    Match.when(true, () => Effect.void),
                    Match.orElse(() =>
                        Effect.fail(
                            new AiSearchError({
                                cause: { actual: embeddings.length, expected: sources.length },
                                operation: 'refreshEmbeddings',
                            }),
                        ),
                    ),
                );
                yield* Effect.forEach(
                    A.zip(sources, embeddings),
                    ([source, embedding]) =>
                        searchRepo.upsertEmbedding({
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
                yield* Effect.all(
                    [
                        audit.log('Search.refreshEmbeddings', {
                            details: { count: sources.length, includeGlobal: options?.includeGlobal ?? false, scopeId },
                            subjectId,
                        }),
                        MetricsService.inc(
                            metrics.search.refreshes,
                            MetricsService.label({ kind: _CONFIG.labels.embeddings, tenant: ctx.tenantId }),
                        ),
                    ],
                    { discard: true },
                );
                return { count: sources.length };
            }).pipe(
                Telemetry.span('search.refreshEmbeddings', { 'search.includeGlobal': options?.includeGlobal ?? false }),
            );
        return { query, refresh, refreshEmbeddings, suggest };
    }),
}) {
    static readonly EmbeddingCron = ClusterService.cron({
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
