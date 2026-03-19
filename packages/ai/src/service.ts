import { createHash } from 'node:crypto';
import { Client } from '@parametric-portal/database/client';
import { SearchRepo } from '@parametric-portal/database/search';
import { PersistenceService } from '@parametric-portal/database/repos';
import { Array as A, Effect, Layer, Option, Schema as S } from 'effect';
import { AiRegistry } from './registry.ts';
import { AiRuntime } from './runtime.ts';
import { AiRuntimeProvider } from './runtime-provider.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const ManifestEntrySchema = S.Struct({
    aliases:       S.optionalWith(S.Array(S.NonEmptyTrimmedString), { default: () => [] }),
    category:      S.optional(S.NonEmptyTrimmedString),
    description:   S.NonEmptyString,
    examples:      S.Array(S.Struct({ description: S.optional(S.String), input: S.NonEmptyString })),
    id:            S.NonEmptyTrimmedString,
    isDestructive: S.optional(S.Boolean),
    name:          S.NonEmptyTrimmedString,
    params:        S.Array(S.Struct({
        default:     S.optional(S.Unknown),
        description: S.optional(S.String),
        name:        S.NonEmptyTrimmedString,
        required:    S.Boolean,
        type:        S.NonEmptyTrimmedString,
    })),
});
const ManifestArraySchema = S.parseJson(S.Array(ManifestEntrySchema));
const _KnowledgeStateSchema = S.Struct({
    embedding: S.Struct({
        dimensions: S.Int,
        model:      S.String,
        provider:   S.Literal('anthropic', 'gemini', 'openai'),
    }),
    entryCount: S.Int.pipe(S.greaterThanOrEqualTo(0)),
    hash:       S.String,
    metadata:   S.Struct({ capabilities: S.String, kind: S.String, namespace: S.String }),
    updatedAt:  S.String,
    version:    S.String,
});

// --- [FUNCTIONS] -------------------------------------------------------------

const _manifestEntityId = (namespace: string, entityType: string, id: string) => {
    const hex = createHash('sha1').update(`${namespace}\n${entityType}\n${id}`).digest('hex');
    const version = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return version;
};
const _manifestContent = (entry: typeof ManifestEntrySchema.Type) => [
    entry.aliases.join(' '),
    entry.examples.map((example) => `${example.input} ${example.description ?? ''}`).join(' '),
].join('\n').trim();
const _manifestMetadata = (entry: typeof ManifestEntrySchema.Type, namespace: string) => ({
    aliases:          entry.aliases,
    category:         entry.category ?? null,
    description:      entry.description,
    examples:         entry.examples,
    id:               entry.id,
    isDestructive:    entry.isDestructive ?? false,
    name:             entry.name,
    namespace,
    params:           entry.params,
    searchableParams: entry.params.map((p) => p.name).join(' '),
});
const _manifestId = (metadata: unknown) =>
    metadata !== null && typeof metadata === 'object' && typeof (metadata as Record<string, unknown>)['id'] === 'string'
        ? Option.some((metadata as { readonly id: string }).id)
        : Option.none<string>();

// --- [SERVICES] --------------------------------------------------------------

class AiService extends Effect.Service<AiService>()('ai/Service', {
    effect: Effect.gen(function* () {
        const model = yield* AiRuntime;
        const persistence = yield* PersistenceService;
        const search = yield* SearchRepo;
        const _persistNewKnowledge = Effect.fn('AiService.persistNewKnowledge')((input: {
            readonly embedding:  ReturnType<typeof AiRegistry.embeddingIdentity>;
            readonly entries:    ReadonlyArray<typeof ManifestEntrySchema.Type>;
            readonly entityType: string;
            readonly key:        string;
            readonly namespace:  string;
            readonly scopeId:    string;
            readonly state:      typeof _KnowledgeStateSchema.Type;
        }) => Effect.gen(function* () {
            const persisted = yield* Effect.forEach(input.entries, (entry) =>
                search.upsertDocument({
                    contentText: _manifestContent(entry),
                    displayText: `${entry.name} -- ${entry.description}`,
                    entityId:    _manifestEntityId(input.namespace, input.entityType, entry.id),
                    entityType:  input.entityType,
                    metadata:    _manifestMetadata(entry, input.namespace),
                    scopeId:     input.scopeId,
                }).pipe(Effect.map((document) => ({ documentHash: document.documentHash, entityId: document.entityId, entityType: input.entityType, entry }))), { concurrency: 'unbounded' });
            yield* A.match(persisted.map((item) => `${item.entry.name}\n${_manifestContent(item.entry)}`), {
                onEmpty: () => Effect.void,
                onNonEmpty: (sources) => model.embedMany(sources, { usage: 'document' }).pipe(
                    Effect.flatMap((embeddings) => Effect.forEach(persisted.map((item, index) => ({ ...item, embedding: embeddings[index] })), (item) =>
                        search.upsertEmbedding({
                            documentHash: item.documentHash,
                            embedding:    item.embedding ?? [],
                            entityId:     item.entityId,
                            entityType:   item.entityType,
                            profile:      input.embedding,
                        }), { concurrency: 'unbounded', discard: true })),
                ),
            });
            yield* persistence.kv.setJson(input.key, input.state, _KnowledgeStateSchema);
            return { key: input.key, prepared: true, state: input.state } as const;
        }));
        const prepareKnowledge = Effect.fn('AiService.prepareKnowledge')((input: {
            readonly entityType: string;
            readonly manifest:   ReadonlyArray<typeof ManifestEntrySchema.Type> | string;
            readonly namespace?: string | undefined;
            readonly version?:   string | undefined;
        }) => Effect.gen(function* () {
            const [entries, scopeId, settings] = yield* Effect.all([
                typeof input.manifest === 'string' ? S.decodeUnknown(ManifestArraySchema)(input.manifest) : Effect.succeed(input.manifest),
                Client.tenant.current,
                model.settings(),
            ]);
            const namespace = input.namespace ?? 'default';
            const version = input.version ?? 'current';
            const embedding = AiRegistry.embeddingIdentity(settings.embedding.primary);
            const hash = createHash('sha256').update(`${version}\n${JSON.stringify(entries)}\n${embedding.provider}:${embedding.model}:${String(embedding.dimensions)}`).digest('hex');
            const key = ['ai', 'knowledge', namespace, input.entityType, embedding.provider, embedding.model, String(embedding.dimensions), hash].join(':');
            const state = {
                embedding,
                entryCount: entries.length,
                hash,
                metadata:   { capabilities: settings.knowledge.mode, kind: 'search-manifest', namespace },
                updatedAt:  new Date().toISOString(),
                version,
            } satisfies typeof _KnowledgeStateSchema.Type;
            const existing = yield* persistence.kv.getJson(key, _KnowledgeStateSchema);
            return yield* Option.match(existing, {
                onNone: () => _persistNewKnowledge({ embedding, entityType: input.entityType, entries, key, namespace, scopeId, state }),
                onSome: (stored) => Effect.succeed({ key, prepared: false, state: stored } as const),
            });
        }));
        const queryKnowledge = Effect.fn('AiService.queryKnowledge')((input: {
            readonly entityType?: string | undefined;
            readonly limit?: number | undefined;
            readonly manifest: ReadonlyArray<typeof ManifestEntrySchema.Type> | string;
            readonly namespace?: string | undefined;
            readonly term: string;
        }) => Effect.gen(function* () {
            const [entries, settings, scopeId] = yield* Effect.all([
                typeof input.manifest === 'string' ? S.decodeUnknown(ManifestArraySchema)(input.manifest) : Effect.succeed(input.manifest),
                model.settings(),
                Client.tenant.current,
            ]);
            const namespace = input.namespace ?? 'default';
            const entityType = input.entityType ?? 'command';
            const embedding = AiRegistry.embeddingIdentity(settings.embedding.primary);
            const semantic = yield* model.embed(input.term, { usage: 'query' }).pipe(Effect.option);
            const limit = input.limit ?? settings.knowledge.maxCandidates;
            const searched = yield* search.search({
                embedding:       Option.map(semantic, (vector) => ({ profile: embedding, vector })).pipe(Option.getOrUndefined),
                entityTypes:     [entityType],
                includeFacets:   false,
                includeGlobal:   false,
                includeSnippets: false,
                scopeId,
                term:            input.term,
            }, { limit }).pipe(
                Effect.map((page) => page.items.flatMap((item) => Option.match(_manifestId(item.metadata), {
                    onNone: () => [] as ReadonlyArray<{ readonly id: string; readonly score: number }>,
                    onSome: (id) => [{ id, score: item.rank }] as const,
                }))),
                Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<{ readonly id: string; readonly score: number }>)),
            );
            const inManifest = new Set(entries.map((entry) => entry.id));
            const items = searched.filter((item) => inManifest.has(item.id)).slice(0, limit);
            return { items, namespace } as const;
        }));
        const runAgentCore = Effect.fn('AiService.runAgentCore')(<
            State,       Plan,         Execution,   Verification,   PlanError,     ExecuteError,  VerifyError,
            DecideError, PersistError, PlanContext, ExecuteContext, VerifyContext, DecideContext, PersistContext,
        >(input: {
            readonly decide:       (state: State, plan: Plan, execution: Execution, verification: Verification) => Effect.Effect<State, DecideError, DecideContext>;
            readonly execute:      (state: State, plan: Plan) => Effect.Effect<Execution, ExecuteError, ExecuteContext>;
            readonly initialState: State;
            readonly isTerminal:   (state: State) => boolean;
            readonly persist:      (state: State, plan: Plan, execution: Execution, verification: Verification, decision: State) => Effect.Effect<void, PersistError, PersistContext>;
            readonly plan:         (state: State) => Effect.Effect<Plan, PlanError, PlanContext>;
            readonly verify:       (state: State, plan: Plan, execution: Execution) => Effect.Effect<Verification, VerifyError, VerifyContext>;
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
        const searchQuery = Effect.fn('AiService.searchQuery')((options: {
            readonly entityTypes?:     readonly string[] | undefined;
            readonly includeFacets?:   boolean | undefined;
            readonly includeGlobal?:   boolean | undefined;
            readonly includeSnippets?: boolean | undefined;
            readonly scopeId?:         string | null | undefined;
            readonly term:             string;
        }, pagination?: { readonly cursor?: string | undefined; readonly limit?: number | undefined }) =>
            Effect.gen(function* () {
                const [embedding, settings, tenantScopeId] = yield* Effect.all([
                    model.embed(options.term, { usage: 'query' }).pipe(Effect.option),
                    model.settings(),
                    Client.tenant.current.pipe(Effect.option),
                ]);
                return yield* search.search({
                    embedding:       Option.map(embedding, (vector) => ({ profile: AiRegistry.embeddingIdentity(settings.embedding.primary), vector })).pipe(Option.getOrUndefined),
                    entityTypes:     options.entityTypes,
                    includeFacets:   options.includeFacets,
                    includeGlobal:   options.includeGlobal,
                    includeSnippets: options.includeSnippets,
                    scopeId:         options.scopeId ?? Option.getOrNull(tenantScopeId),
                    term:            options.term,
                }, pagination);
            }));
        const searchRefresh = Effect.fn('AiService.searchRefresh')((includeGlobal = false) =>
            Client.tenant.current.pipe(Effect.flatMap((scopeId) => search.refresh(scopeId, includeGlobal))));
        const searchRefreshEmbeddings = Effect.fn('AiService.searchRefreshEmbeddings')((options?: {
            readonly entityTypes?:   readonly string[] | undefined;
            readonly includeGlobal?: boolean | undefined;
            readonly limit?:         number | undefined;
            readonly scopeId?:       string | null | undefined;
        }) =>
            Effect.gen(function* () {
                const [settings, tenantScopeId] = yield* Effect.all([model.settings(), Client.tenant.current.pipe(Effect.option)]);
                const profile = AiRegistry.embeddingIdentity(settings.embedding.primary);
                const sources = yield* search.embeddingSources({
                    entityTypes:   options?.entityTypes,
                    includeGlobal: options?.includeGlobal,
                    limit:         options?.limit,
                    profile,
                    scopeId:       options?.scopeId ?? Option.getOrNull(tenantScopeId),
                });
                const embeddings = yield* A.match(sources.map((source) => source.embeddingSource), {
                    onEmpty: () => Effect.succeed([] as ReadonlyArray<readonly number[]>),
                    onNonEmpty: (input) => model.embedMany(input, { usage: 'document' }),
                });
                yield* Effect.forEach(sources.map((source, index) => ({ ...source, embedding: embeddings[index] ?? [] })), (source) =>
                    search.upsertEmbedding({
                        documentHash: source.documentHash,
                        embedding:    source.embedding,
                        entityId:     source.entityId,
                        entityType:   source.entityType,
                        profile,
                    }), { concurrency: 'unbounded', discard: true });
                return { count: sources.length } as const;
            }));
        const searchSuggest = Effect.fn('AiService.searchSuggest')((options: {
            readonly includeGlobal?:  boolean | undefined;
            readonly limit?:          number | undefined;
            readonly prefix:          string;
            readonly scopeId?:        string | null | undefined;
        }) =>
            Client.tenant.current.pipe(
                Effect.option,
                Effect.flatMap((scopeId) => search.suggest({
                    includeGlobal: options.includeGlobal,
                    limit:         options.limit,
                    prefix:        options.prefix,
                    scopeId:       options.scopeId ?? Option.getOrNull(scopeId),
                })),
                Effect.map((rows) => rows.map((row) => ({ frequency: row.frequency, term: row.term }))),
            ));
        return {
            model, prepareKnowledge, queryKnowledge, runAgentCore, searchQuery,
            searchRefresh, searchRefreshEmbeddings, searchSuggest,
        } as const;
    }),
}) {
    static readonly KnowledgeDefault = AiService.Default.pipe(
        Layer.provideMerge(AiRuntime.Default.pipe(Layer.provideMerge(AiRuntimeProvider.Default))),
        Layer.provideMerge(PersistenceService.Default),
        Layer.provideMerge(SearchRepo.Default),
    );
    static readonly Live = AiService.Default.pipe(
        Layer.provideMerge(AiRuntime.Live),
        Layer.provideMerge(PersistenceService.Default),
        Layer.provideMerge(SearchRepo.Default),
    );
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiService, ManifestArraySchema, ManifestEntrySchema };
