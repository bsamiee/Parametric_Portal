import { createHash } from 'node:crypto';
import { DatabaseService } from '@parametric-portal/database/repos';
import { Array as A, Effect, Schema as S } from 'effect';
import { AiError } from './errors.ts';
import { AiRuntime } from './runtime.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    concurrency: 10,
    namespace:   'ai',
} as const;

// --- [SCHEMA] ----------------------------------------------------------------

const _SCHEMA = {
    manifest: S.Array(
        S.Struct({
            aliases:       S.optionalWith(S.Array(S.NonEmptyTrimmedString), { default: () => [] }),
            category:      S.optional(S.NonEmptyTrimmedString),
            description:   S.NonEmptyString,
            examples:      S.Array(S.Struct({
                description: S.optional(S.String),
                input:       S.NonEmptyString,
            })),
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
        }),
    ),
} as const;

// --- [TYPES] -----------------------------------------------------------------

type _ManifestEntry = (typeof _SCHEMA.manifest.Type)[number];

// --- [FUNCTIONS] -------------------------------------------------------------

const _decodeManifest = (json: string) => S.decodeUnknown(S.parseJson(_SCHEMA.manifest))(json);
const _embeddingSource = (entry: _ManifestEntry): string =>
    [
        entry.name,
        ...entry.aliases,
        entry.category,
        entry.description,
        ...entry.params.map((parameter) => `${parameter.name}: ${parameter.description ?? parameter.type}`),
        ...entry.examples.map((example) => example.description ?? example.input),
    ].filter(Boolean).join(' ');
const _deterministicUuid = (namespace: string, entityType: string, key: string): string => {
    const hex = createHash('sha256').update(`${namespace}:${entityType}:${key}`).digest('hex');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        `8${hex.slice(13, 16)}`,
        `${(0x80 | (Number.parseInt(hex.slice(16, 18), 16) & 0x3f)).toString(16)}${hex.slice(18, 20)}`,
        hex.slice(20, 32),
    ].join('-');
};

// --- [SERVICES] --------------------------------------------------------------

class KnowledgeService extends Effect.Service<KnowledgeService>()('ai/Knowledge', {
    dependencies: [AiRuntime.Default, DatabaseService.Default],
    effect: Effect.gen(function* () {
        const [ai, database] = yield* Effect.all([AiRuntime, DatabaseService]);
        const seed = Effect.fn('ai.knowledge.seed')((input: {
            readonly entityType: string;
            readonly entries: ReadonlyArray<_ManifestEntry>;
            readonly namespace?: string | undefined;
            readonly scopeId?: string | null | undefined;
        }) =>
            Effect.gen(function* () {
                const settings = yield* ai.settings();
                const embeddingSources = A.map(input.entries, _embeddingSource);
                const vectors = yield* ai.embed(embeddingSources).pipe(
                    Effect.filterOrFail(
                        (value) => value.length === input.entries.length,
                        (value) => new AiError({
                            cause: {
                                actual:   value.length,
                                expected: input.entries.length,
                            },
                            operation: 'ai.knowledge.seed',
                            reason:    'unknown',
                        }),
                    ),
                );
                const namespace = input.namespace ?? _CONFIG.namespace;
                const scopeId = input.scopeId ?? null;
                yield* Effect.forEach(
                    A.zip(input.entries, vectors),
                    ([entry, vector]) => {
                        const entityId = _deterministicUuid(namespace, input.entityType, entry.id);
                        return database.search
                            .upsertDocument({
                                contentText: entry.description,
                                displayText: entry.name,
                                entityId,
                                entityType: input.entityType,
                                metadata: {
                                    aliases:       entry.aliases,
                                    category:      entry.category,
                                    examples:      entry.examples,
                                    isDestructive: entry.isDestructive,
                                    params:        entry.params,
                                },
                                scopeId,
                            })
                            .pipe(
                                Effect.flatMap((document) =>
                                    database.search.upsertEmbedding({
                                        dimensions: settings.embedding.dimensions,
                                        documentHash: document.documentHash,
                                        embedding: vector,
                                        entityId,
                                        entityType: input.entityType,
                                        model: settings.embedding.model,
                                        scopeId,
                                    }),
                                ),
                            );
                    },
                    { concurrency: _CONFIG.concurrency, discard: true },
                );
                return { upserted: input.entries.length } as const;
            }),
        );
        const seedJson = Effect.fn('ai.knowledge.seedJson')((input: {
            readonly entityType: string;
            readonly manifestJson: string;
            readonly namespace?: string | undefined;
            readonly scopeId?: string | null | undefined;
        }) =>
            _decodeManifest(input.manifestJson).pipe(
                Effect.flatMap((entries) =>
                    seed({
                        entityType: input.entityType,
                        entries,
                        namespace: input.namespace,
                        scopeId: input.scopeId,
                    }),
                ),
            ),
        );
        return { seed, seedJson } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { KnowledgeService };
