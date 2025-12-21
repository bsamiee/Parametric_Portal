/**
 * Provide branded domain types for database entities.
 */
import { pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ApiKeyId = S.Schema.Type<typeof ApiKeyIdSchema>;
type AssetId = S.Schema.Type<typeof AssetIdSchema>;
type UserId = S.Schema.Type<typeof UserIdSchema>;
type AssetMetadata = S.Schema.Type<typeof AssetMetadataSchema>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    patterns: {
        uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    },
} as const);

// --- [SCHEMA] ----------------------------------------------------------------

const uuidBase = pipe(S.String, S.pattern(B.patterns.uuid));
const ApiKeyIdSchema = pipe(uuidBase, S.brand('ApiKeyId'));
const AssetIdSchema = pipe(uuidBase, S.brand('AssetId'));
const UserIdSchema = pipe(uuidBase, S.brand('UserId'));
const AssetMetadataSchema = S.Struct({
    colorMode: S.Literal('light', 'dark'),
    intent: S.Literal('create', 'refine'),
});

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKeyIdSchema, AssetIdSchema, AssetMetadataSchema, B as SCHEMA_TUNING, UserIdSchema };
export type { ApiKeyId, AssetId, AssetMetadata, UserId };
