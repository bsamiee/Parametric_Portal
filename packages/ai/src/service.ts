import { createHash } from 'node:crypto';
import { SqlClient } from '@effect/sql';
import { Client } from '@parametric-portal/database/client';
import { DatabaseService, PersistenceService } from '@parametric-portal/database/repos';
import { SearchRepo } from '@parametric-portal/database/search';
import { Array as A, Effect, Layer, Option, Schema as S } from 'effect';
import type { AiRegistry } from './registry.ts';
import { AiRuntime } from './runtime.ts';

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
        dimensions: S.Literal(1_536),
        provider: S.Literal('gemini', 'openai'),
    }),
    entryCount: S.Int.pipe(S.greaterThanOrEqualTo(0)),
    entryIds:   S.Array(S.NonEmptyTrimmedString),
    hash:       S.String,
    manifestHash: S.String,
    metadata:   S.Struct({ kind: S.Literal('search-manifest'), namespace: S.String }),
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
const _knowledgeKey = (scopeId: string, namespace: string, entityType: string, embedding: AiRegistry.Settings['embedding']) =>
    ['ai', 'knowledge', 'current', scopeId, namespace, entityType, embedding.provider, String(embedding.dimensions)].join(':');
const _DataLayer = Layer.mergeAll(DatabaseService.Default, PersistenceService.Default, SearchRepo.Default);

// --- [SERVICES] --------------------------------------------------------------

class AiService extends Effect.Service<AiService>()('ai/Service', {
    effect: Effect.gen(function* () {
        const { model, persistence, search, sql } = yield* Effect.all({
            model:       AiRuntime,
            persistence: PersistenceService,
            search:      SearchRepo,
            sql:         SqlClient.SqlClient,
        });
        const _persistKnowledge = Effect.fn('AiService.persistKnowledge')((input: {
            readonly embedding:  AiRegistry.Settings['embedding'];
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
                    metadata:    {
                        aliases:          entry.aliases,
                        category:         entry.category ?? null,
                        description:      entry.description,
                        examples:         entry.examples,
                        id:               entry.id,
                        isDestructive:    entry.isDestructive ?? false,
                        kind:             'search-manifest',
                        name:             entry.name,
                        namespace:        input.namespace,
                        params:           entry.params,
                        searchableParams: entry.params.map((param) => param.name).join(' '),
                    },
                    scopeId:     input.scopeId,
                }).pipe(Effect.map((document) => ({
                    documentHash: document.documentHash,
                    entityId:     document.entityId,
                    entityType:   input.entityType,
                    entry,
                }))), { concurrency: 'unbounded' });
            const embeddings = yield* A.match(persisted.map((item) => `${item.entry.name}\n${_manifestContent(item.entry)}`), {
                onEmpty: () => Effect.succeed([] as ReadonlyArray<readonly number[]>),
                onNonEmpty: (sources) => model.embedMany(sources, { usage: 'document' }),
            });
            yield* Effect.forEach(persisted.map((item, index) => ({ ...item, embedding: embeddings[index] ?? [] })), (item) =>
                search.upsertEmbedding({
                    documentHash: item.documentHash,
                    embedding:    item.embedding,
                    entityId:     item.entityId,
                    entityType:   item.entityType,
                    profile:      input.embedding,
                }), { concurrency: 'unbounded', discard: true });
            yield* A.match(input.state.entryIds, {
                onEmpty: () => sql`
                    DELETE FROM search_documents
                    WHERE entity_type = ${input.entityType}
                      AND scope_id = ${input.scopeId}::uuid
                      AND metadata->>'namespace' = ${input.namespace}`.pipe(Effect.asVoid),
                onNonEmpty: (entryIds) => Effect.all([
                    sql`
                        DELETE FROM search_documents
                        WHERE entity_type = ${input.entityType}
                          AND scope_id = ${input.scopeId}::uuid
                          AND metadata->>'namespace' = ${input.namespace}
                          AND metadata->>'id' NOT IN ${sql.in(entryIds)}`.pipe(Effect.asVoid),
                    sql`
                        DELETE FROM search_embeddings embeddings
                        USING search_documents documents
                        WHERE documents.entity_type = embeddings.entity_type
                          AND documents.entity_id = embeddings.entity_id
                          AND documents.entity_type = ${input.entityType}
                          AND documents.scope_id = ${input.scopeId}::uuid
                          AND documents.metadata->>'namespace' = ${input.namespace}
                          AND documents.metadata->>'id' IN ${sql.in(entryIds)}
                          AND (
                            embeddings.provider <> ${input.embedding.provider}
                            OR embeddings.dimensions <> ${input.embedding.dimensions}
                          )`.pipe(Effect.asVoid),
                ], { discard: true }),
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
            const { entries, scopeId, settings } = yield* Effect.all({
                entries:  typeof input.manifest === 'string' ? S.decodeUnknown(ManifestArraySchema)(input.manifest) : Effect.succeed(input.manifest),
                scopeId:  Client.tenant.current,
                settings: model.settings(),
            });
            const namespace = input.namespace ?? 'default';
            const version = input.version ?? 'current';
            const embedding = settings.embedding;
            const manifestHash = createHash('sha256').update(`${version}\n${JSON.stringify(entries)}`).digest('hex');
            const profile = yield* search.profileFingerprint({ profile: embedding, sourceHash: manifestHash });
            const key = _knowledgeKey(scopeId, namespace, input.entityType, embedding);
            const state = {
                embedding: { dimensions: embedding.dimensions, provider: embedding.provider },
                entryCount: entries.length,
                entryIds:   entries.map((entry) => entry.id),
                hash: profile.hash,
                manifestHash,
                metadata:   { kind: 'search-manifest' as const, namespace },
                updatedAt:  new Date().toISOString(),
                version,
            } satisfies typeof _KnowledgeStateSchema.Type;
            const existing = yield* persistence.kv.getJson(key, _KnowledgeStateSchema);
            return yield* Option.match(existing, {
                onNone: () => _persistKnowledge({ embedding, entityType: input.entityType, entries, key, namespace, scopeId, state }),
                onSome: (stored) => stored.hash === state.hash
                    ? Effect.succeed({ key, prepared: false, state: stored } as const)
                    : _persistKnowledge({ embedding, entityType: input.entityType, entries, key, namespace, scopeId, state }),
            });
        }));
        const queryKnowledge = Effect.fn('AiService.queryKnowledge')((input: {
            readonly entityType?: string | undefined;
            readonly limit?: number | undefined;
            readonly namespace?: string | undefined;
            readonly term: string;
        }) => Effect.gen(function* () {
            const { settings, scopeId } = yield* Effect.all({
                scopeId:  Client.tenant.current,
                settings: model.settings(),
            });
            const namespace = input.namespace ?? 'default';
            const entityType = input.entityType ?? 'command';
            const embedding = settings.embedding;
            const key = _knowledgeKey(scopeId, namespace, entityType, embedding);
            const state = yield* persistence.kv.getJson(key, _KnowledgeStateSchema).pipe(
                Effect.flatMap((state) => Option.match(state, {
                    onNone: () => Effect.fail(new Error(`Knowledge state missing for ${namespace}:${entityType}`)),
                    onSome: Effect.succeed,
                })),
            );
            const semantic = yield* model.embed(input.term, { usage: 'query' });
            const limit = input.limit ?? settings.knowledge.maxCandidates;
            const searched = yield* search.search({
                embedding:       { profile: embedding, vector: semantic },
                entityTypes:     [entityType],
                includeFacets:   false,
                includeGlobal:   false,
                includeSnippets: false,
                scopeId,
                term:            input.term,
            }, { limit });
            const currentEntryIds = new Set(state.entryIds);
            const items = searched.items.flatMap((item) =>
                item.metadata !== null
                && typeof item.metadata === 'object'
                && typeof (item.metadata as Record<string, unknown>)['id'] === 'string'
                && currentEntryIds.has((item.metadata as { readonly id: string }).id)
                    ? [{ id: (item.metadata as { readonly id: string }).id, score: item.rank }] as const
                    : [] as ReadonlyArray<{ readonly id: string; readonly score: number }>,
            ).slice(0, limit);
            return { items, namespace } as const;
        }));
        const searchQuery = Effect.fn('AiService.searchQuery')((options: {
            readonly entityTypes?:     readonly string[] | undefined;
            readonly includeFacets?:   boolean | undefined;
            readonly includeGlobal?:   boolean | undefined;
            readonly includeSnippets?: boolean | undefined;
            readonly scopeId?:         string | null | undefined;
            readonly term:             string;
        }, pagination?: { readonly cursor?: string | undefined; readonly limit?: number | undefined }) =>
            Effect.gen(function* () {
                const { embedding, settings, tenantScopeId } = yield* Effect.all({
                    embedding:     model.embed(options.term, { usage: 'query' }),
                    settings:      model.settings(),
                    tenantScopeId: Client.tenant.current.pipe(Effect.option),
                });
                return yield* search.search({
                    embedding:       { profile: settings.embedding, vector: embedding },
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
                const { settings, tenantScopeId } = yield* Effect.all({
                    settings:      model.settings(),
                    tenantScopeId: Client.tenant.current.pipe(Effect.option),
                });
                const profile = settings.embedding;
                const pruned = yield* search.pruneEmbeddings({
                    entityTypes:   options?.entityTypes,
                    includeGlobal: options?.includeGlobal,
                    limit:         options?.limit,
                    profile,
                    scopeId:       options?.scopeId ?? Option.getOrNull(tenantScopeId),
                });
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
                return { count: sources.length, pruned } as const;
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
            model,
            prepareKnowledge,
            queryKnowledge,
            searchQuery,
            searchRefresh,
            searchRefreshEmbeddings,
            searchSuggest,
        } as const;
    }),
}) {
    static readonly Live = AiService.Default.pipe(
        Layer.provideMerge(_DataLayer),
        Layer.provideMerge(AiRuntime.Live.pipe(Layer.provideMerge(_DataLayer))),
    );
}

// --- [EXPORT] ----------------------------------------------------------------

export { AiService, ManifestArraySchema, ManifestEntrySchema };
