/**
 * KB seeder: reads command manifest, upserts into search_documents and
 * search_embeddings tables via direct SQL. Embedding generation is
 * decoupled via an injected embed function (provider-agnostic).
 */
import { createHash } from 'node:crypto';
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';
import { hashCanonicalState } from '../persistence/checkpoint.ts';
import type { CommandManifestEntry } from './manifest.ts';

// --- [TYPES] -----------------------------------------------------------------

type SeedResult = {
    readonly documentsUpserted: number;
    readonly embeddingsUpserted: number;
};

type EmbedFn = (texts: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, unknown>;

// --- [CONSTANTS] -------------------------------------------------------------

const _EMBEDDING_CONFIG = {
    batchSize: 100,
    concurrency: 10,
    dimensions: 1536,
    maxDimensions: 3072,
    model: 'text-embedding-3-small',
    padValue: 0,
} as const;

// why: deterministic namespace for generating UUIDs from command string IDs
const _NAMESPACE = 'kargadan:rhinoCommand';

// --- [FUNCTIONS] -------------------------------------------------------------

/**
 * Deterministic UUID v5-style generation from a string key within a namespace.
 * Produces consistent UUIDs so the same command ID always maps to the same UUID.
 */
const _deterministicUuid = (key: string): string => {
    const hash = createHash('sha256').update(`${_NAMESPACE}:${key}`).digest('hex');
    return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        `5${hash.slice(13, 16)}`,
        `${(0x80 | (Number.parseInt(hash.slice(16, 18), 16) & 0x3f)).toString(16)}${hash.slice(18, 20)}`,
        hash.slice(20, 32),
    ].join('-');
};

const _buildEmbeddingText = (command: CommandManifestEntry): string =>
    [command.name, command.description, ...command.params.map((param) => param.name)].join(' ');

const _padVector = (vector: ReadonlyArray<number>): string => {
    const padCount = _EMBEDDING_CONFIG.maxDimensions - vector.length;
    const padded = padCount <= 0
        ? vector
        : [...vector, ...Array.from({ length: padCount }, () => _EMBEDDING_CONFIG.padValue)];
    return JSON.stringify(padded);
};

// --- [SERVICES] --------------------------------------------------------------

class KBSeeder extends Effect.Service<KBSeeder>()('kargadan/KBSeeder', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const seed = Effect.fn('kargadan.kb.seed')((
            manifest: ReadonlyArray<CommandManifestEntry>,
            embed: EmbedFn,
        ) =>
            Effect.gen(function* () {
                // --- Step 1: Upsert search documents ---
                yield* Effect.forEach(manifest, (command) => {
                    const entityId = _deterministicUuid(command.id);
                    const metadata = JSON.stringify({
                        category: command.category,
                        examples: command.examples,
                        isDestructive: command.isDestructive,
                        params: command.params,
                    });
                    return sql`
                        INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                        VALUES (
                            'rhinoCommand',
                            ${entityId}::uuid,
                            NULL,
                            ${command.name},
                            ${command.description},
                            ${metadata}::jsonb,
                            ${command.name.toLowerCase()}
                        )
                        ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                            display_text = EXCLUDED.display_text,
                            content_text = EXCLUDED.content_text,
                            metadata = EXCLUDED.metadata,
                            normalized_text = EXCLUDED.normalized_text,
                            updated_at = NOW()
                    `.pipe(Effect.asVoid);
                }, { concurrency: _EMBEDDING_CONFIG.concurrency, discard: true });

                const documentsUpserted = manifest.length;

                // --- Step 2: Generate embeddings via injected function ---
                const texts = manifest.map(_buildEmbeddingText);
                const batches = Array.from(
                    { length: Math.ceil(texts.length / _EMBEDDING_CONFIG.batchSize) },
                    (_, index) => texts.slice(index * _EMBEDDING_CONFIG.batchSize, (index + 1) * _EMBEDDING_CONFIG.batchSize),
                );
                const batchResults = yield* Effect.forEach(batches, (batch) => embed(batch), { concurrency: 1 });
                const allEmbeddings = batchResults.flat();

                // --- Step 3: Upsert embeddings ---
                const pairs = manifest.map((command, index) => ({
                    command,
                    embedding: allEmbeddings[index] ?? [],
                }));

                yield* Effect.forEach(pairs, ({ command, embedding }) => {
                    const entityId = _deterministicUuid(command.id);
                    const documentHash = hashCanonicalState(command);
                    const embeddingJson = _padVector(embedding);
                    return sql`
                        INSERT INTO search_embeddings (entity_type, entity_id, scope_id, model, dimensions, embedding, hash)
                        VALUES (
                            'rhinoCommand',
                            ${entityId}::uuid,
                            NULL,
                            ${_EMBEDDING_CONFIG.model},
                            ${_EMBEDDING_CONFIG.dimensions},
                            (${embeddingJson})::halfvec(${_EMBEDDING_CONFIG.maxDimensions}),
                            ${documentHash}
                        )
                        ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                            embedding = EXCLUDED.embedding,
                            scope_id = EXCLUDED.scope_id,
                            model = EXCLUDED.model,
                            dimensions = EXCLUDED.dimensions,
                            hash = EXCLUDED.hash,
                            updated_at = NOW()
                    `.pipe(Effect.asVoid);
                }, { concurrency: _EMBEDDING_CONFIG.concurrency, discard: true });

                const embeddingsUpserted = pairs.length;

                return { documentsUpserted, embeddingsUpserted } satisfies SeedResult;
            }),
        );

        return { seed } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { KBSeeder };
export type { EmbedFn, SeedResult };
