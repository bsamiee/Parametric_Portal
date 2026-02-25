import { createHash } from 'node:crypto';
import { DatabaseService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { Context } from '@parametric-portal/server/context';
import { ClusterService } from '@parametric-portal/server/infra/cluster';
import { AuditService } from '@parametric-portal/server/observe/audit';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Array as A, Cron, Effect, Layer, Option, Schema as S } from 'effect';
import { AiError } from './errors.ts';
import { AiRuntime } from './runtime.ts';
import { AiRuntimeProvider } from './runtime-provider.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const _ManifestEntry = S.Struct({
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
const _ManifestSchema = S.parseJson(S.Array(_ManifestEntry));

// --- [SERVICES] --------------------------------------------------------------

class AiService extends Effect.Service<AiService>()('ai/Service', {
    effect: Effect.gen(function* () {
        const model = yield* AiRuntime;
        const seedKnowledge = Effect.fn('AiService.seedKnowledge')((input: {
            readonly entityType: string;
            readonly entries:    ReadonlyArray<typeof _ManifestEntry.Type>;
            readonly namespace?: string | undefined;
            readonly scopeId?:   string | null | undefined;
        }) => {
            const namespace = input.namespace ?? 'ai';
            const scopeId =   input.scopeId ?? null;
            const batch =     A.map(input.entries, (e) => {
                const parts = [
                    e.name, ...e.aliases, e.category, e.description,
                    ...e.params.map((p) => `${p.name}: ${p.description ?? p.type}`),
                    ...e.examples.map((x) => x.description ?? x.input),
                ];
                const source = parts.filter((v): v is string => typeof v === 'string' && v.length > 0).join(' ');
                const hex = createHash('sha256').update(`${namespace}:${input.entityType}:${e.id}`).digest('hex');
                const entityId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(0x80 | (Number.parseInt(hex.slice(16, 18), 16) & 0x3f)).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
                return { entityId, entry: e, source };
            });
            return Effect.gen(function* () {
                const database = yield* DatabaseService;
                const settings = yield* model.settings();
                const { dimensions, model: embeddingModel } = settings.embedding;
                const vectors = yield* model.embed(A.map(batch, (b) => b.source)).pipe(
                    Effect.filterOrFail(
                        (v) => v.length === batch.length,
                        (v) => new AiError({ cause: { actual: v.length, expected: batch.length }, operation: 'seedKnowledge', reason: 'unknown' }),
                    ),
                );
                const items = A.zip(batch, vectors);
                const docs = yield* Effect.forEach(items, ([b, _]) =>
                    database.search.upsertDocument({
                        contentText: b.entry.description, displayText: b.entry.name, entityId: b.entityId, entityType: input.entityType,
                        metadata: { aliases: b.entry.aliases, category: b.entry.category, examples: b.entry.examples, isDestructive: b.entry.isDestructive, params: b.entry.params },
                        scopeId,
                    }), { concurrency: 10 });
                yield* Effect.forEach(A.zip(items, docs), ([[b, vector], doc]) =>
                    database.search.upsertEmbedding({ dimensions, documentHash: doc.documentHash, embedding: vector, entityId: b.entityId, entityType: input.entityType, model: embeddingModel, scopeId }),
                    { concurrency: 10, discard: true });
                return { upserted: input.entries.length } as const;
            });
        });
        const seedKnowledgeJson = Effect.fn('AiService.seedKnowledgeJson')((input: {
            readonly entityType:   string;
            readonly manifestJson: string;
            readonly namespace?:   string | undefined;
            readonly scopeId?:     string | null | undefined;
        }) => S.decodeUnknown(_ManifestSchema)(input.manifestJson).pipe(Effect.flatMap((entries) => seedKnowledge({ ...input, entries })),),);
        const searchQuery = Effect.fn('AiService.searchQuery')(
            (options: {
                readonly entityTypes?: readonly string[] | undefined;
                readonly includeFacets?:   boolean | undefined;
                readonly includeGlobal?:   boolean | undefined;
                readonly includeSnippets?: boolean | undefined;
                readonly term: string;
            }, pagination?: { readonly cursor?: string | undefined; readonly limit?: number | undefined }) =>
                Effect.gen(function* () {
                    const [audit, database, metrics] = yield* Effect.all([AuditService, DatabaseService, MetricsService]);
                    const ctx = yield* Context.Request.current;
                    const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                    const subjectId = Option.match(ctx.session, { onNone: () => 'anonymous', onSome: (s) => s.userId });
                    const settings = yield* model.settings();
                    const { dimensions, model: embeddingModel } = settings.embedding;
                    const embedding = yield* model.embed(options.term).pipe(
                        Effect.tapError((e) => Effect.logWarning('Search embedding failed', { error: String(e), tenantId: ctx.tenantId })),
                        Effect.option,
                    );
                    const result = yield* database.search.search(
                        { ...options, scopeId, ...Option.match(embedding, { onNone: () => ({}), onSome: (vector) => ({ embedding: { dimensions, model: embeddingModel, vector } }) }) },
                        pagination,
                    );
                    yield* Effect.all([
                        audit.log('Search.read', { details: { entityTypes: options.entityTypes, resultCount: result.total, term: options.term }, subjectId }),
                        MetricsService.inc(metrics.search.queries, MetricsService.label({ tenant: ctx.tenantId })),
                    ], { discard: true });
                    return result;
                }).pipe(Telemetry.span('search.query', { 'search.term': options.term })),
        );
        const searchRefresh = Effect.fn('AiService.searchRefresh')((includeGlobal = false) =>
            Effect.gen(function* () {
                const [audit, database, metrics] = yield* Effect.all([AuditService, DatabaseService, MetricsService]);
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = Option.match(ctx.session, { onNone: () => 'system', onSome: (s) => s.userId });
                yield* database.search.refresh(scopeId, includeGlobal);
                yield* Effect.all([
                    audit.log('Search.refresh', { details: { includeGlobal, kind: 'index', scopeId }, subjectId }),
                    MetricsService.inc(metrics.search.refreshes, MetricsService.label({ tenant: ctx.tenantId })),
                ], { discard: true });
            }).pipe(Telemetry.span('search.refresh', { 'search.includeGlobal': includeGlobal })),
        );
        const searchRefreshEmbeddings = Effect.fn('AiService.searchRefreshEmbeddings')((options?: {
            readonly entityTypes?: readonly string[] | undefined;
            readonly includeGlobal?: boolean | undefined;
            readonly limit?: number | undefined;
        }) =>
            Effect.gen(function* () {
                const [audit, database, metrics] = yield* Effect.all([AuditService, DatabaseService, MetricsService]);
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = Option.match(ctx.session, { onNone: () => 'system', onSome: (s) => s.userId });
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
                const embeddings = yield* model.embed(A.map(sources, (s) => s.embeddingSource)).pipe(
                    Effect.filterOrFail(
                        (v) => v.length === sources.length,
                        (v) => new AiError({ cause: { actual: v.length, expected: sources.length }, operation: 'searchRefreshEmbeddings', reason: 'unknown' }),
                    ),
                );
                yield* Effect.forEach(
                    A.zipWith(sources, embeddings, (source, embedding) => ({ ...source, embedding })),
                    (s) => database.search.upsertEmbedding({ dimensions, documentHash: s.documentHash, embedding: s.embedding, entityId: s.entityId, entityType: s.entityType, model: embeddingModel, scopeId: s.scopeId }),
                    { concurrency: 10, discard: true },
                );
                yield* Effect.all([
                    audit.log('Search.refresh', { details: { count: sources.length, includeGlobal: options?.includeGlobal ?? false, kind: 'embeddings', scopeId }, subjectId }),
                    MetricsService.inc(metrics.search.refreshes, MetricsService.label({ kind: 'embeddings', tenant: ctx.tenantId })),
                ], { discard: true });
                return { count: sources.length };
            }).pipe(Telemetry.span('search.refreshEmbeddings', { 'search.includeGlobal': options?.includeGlobal ?? false })),
        );
        const searchSuggest = Effect.fn('AiService.searchSuggest')((options: {
            readonly includeGlobal?: boolean | undefined;
            readonly limit?:         number | undefined;
            readonly prefix:         string;
        }) =>
            Effect.gen(function* () {
                const [audit, database, metrics] = yield* Effect.all([AuditService, DatabaseService, MetricsService]);
                const ctx = yield* Context.Request.current;
                const scopeId = ctx.tenantId === Context.Request.Id.system ? null : ctx.tenantId;
                const subjectId = Option.match(ctx.session, { onNone: () => 'anonymous', onSome: (s) => s.userId });
                const result = yield* database.search.suggest({ ...options, scopeId });
                yield* Effect.all([
                    audit.log('Search.list', { details: { prefix: options.prefix, resultCount: result.length }, subjectId }),
                    MetricsService.inc(metrics.search.suggestions, MetricsService.label({ tenant: ctx.tenantId })),
                ], { discard: true });
                return result;
            }).pipe(Telemetry.span('search.suggest', { 'search.prefix': options.prefix })),
        );
        return { model, searchQuery, searchRefresh, searchRefreshEmbeddings, searchSuggest, seedKnowledge, seedKnowledgeJson } as const;
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
    static readonly KnowledgeLive =    Layer.mergeAll(AiService.KnowledgeDefault, DatabaseService.Default, SearchRepo.Default);
    static readonly Live =             Layer.mergeAll(AiService.Default, AiRuntime.Live                                      );
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiService };
