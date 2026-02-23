import { createHash } from 'node:crypto';
import { EmbeddingModel } from '@effect/ai';
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';
import { CommandManifest } from './manifest.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _ENTITY_TYPE = 'rhinoCommand' as const;
const _EMBEDDING = {
    dimensions:    1536,
    maxDimensions: 3072,
    model:         'text-embedding-3-small',
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _deterministicUuid = (key: string): string => {
    const hex = createHash('sha256').update(`kargadan:${_ENTITY_TYPE}:${key}`).digest('hex');
    return [hex.slice(0, 8), hex.slice(8, 12), `5${hex.slice(13, 16)}`, `${(0x80 | (Number.parseInt(hex.slice(16, 18), 16) & 0x3f)).toString(16)}${hex.slice(18, 20)}`, hex.slice(20, 32)].join('-');
};
const _serializeVector = (vector: ReadonlyArray<number>): string => {
    const pad = _EMBEDDING.maxDimensions - vector.length;
    return JSON.stringify(pad <= 0 ? vector : [...vector, ...Array.from<number>({ length: pad }).fill(0)]);
};

// --- [SERVICES] --------------------------------------------------------------

class KBSeeder extends Effect.Service<KBSeeder>()('kargadan/KBSeeder', {
    effect: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const seed = Effect.fn('kargadan.kb.seed')((manifest: ReadonlyArray<typeof CommandManifest.schema.Type>) =>
            sql.withTransaction(
                Effect.gen(function* () {
                    const model = yield* EmbeddingModel.EmbeddingModel;
                    const texts = manifest.map(CommandManifest.embeddingText);
                    const embeddings = yield* model.embedMany(texts);
                    yield* Effect.forEach(manifest, (command, index) => {
                        const entityId = _deterministicUuid(command.id);
                        const metadata = JSON.stringify({ category: command.category, examples: command.examples, isDestructive: command.isDestructive, params: command.params });
                        const vectorJson = _serializeVector(embeddings[index] ?? []);
                        return sql`
                            WITH doc AS (
                                INSERT INTO search_documents (entity_type, entity_id, scope_id, display_text, content_text, metadata, normalized_text)
                                VALUES (${_ENTITY_TYPE}, ${entityId}::uuid, NULL, ${command.name}, ${command.description}, ${metadata}::jsonb, ${(texts[index] ?? '').toLowerCase()})
                                ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                                    display_text = EXCLUDED.display_text, content_text = EXCLUDED.content_text, metadata = EXCLUDED.metadata, normalized_text = EXCLUDED.normalized_text, updated_at = NOW()
                                RETURNING entity_type, entity_id, document_hash
                            )
                            INSERT INTO search_embeddings (entity_type, entity_id, scope_id, model, dimensions, embedding, hash)
                            SELECT doc.entity_type, doc.entity_id, NULL, ${_EMBEDDING.model}, ${_EMBEDDING.dimensions}, (${vectorJson})::halfvec(${_EMBEDDING.maxDimensions}), doc.document_hash
                            FROM doc
                            ON CONFLICT (entity_type, entity_id) DO UPDATE SET
                                embedding = EXCLUDED.embedding, scope_id = EXCLUDED.scope_id, model = EXCLUDED.model, dimensions = EXCLUDED.dimensions, hash = EXCLUDED.hash, updated_at = NOW()
                        `.pipe(Effect.asVoid);
                    }, { concurrency: 10, discard: true });
                    return { upserted: manifest.length } as const;
                }),
            ),
        );
        return { seed } as const;
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { KBSeeder };
