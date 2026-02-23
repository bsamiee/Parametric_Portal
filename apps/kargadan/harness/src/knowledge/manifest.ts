import { Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const CommandManifestEntrySchema = S.Struct({
    category:      S.optional(S.NonEmptyTrimmedString),
    description:   S.NonEmptyString,
    examples:      S.Array(S.Struct({ description: S.optional(S.String), input: S.NonEmptyString })),
    id:            S.NonEmptyTrimmedString,
    isDestructive: S.optional(S.Boolean),
    name:          S.NonEmptyTrimmedString,
    params:        S.Array(S.Struct({ default: S.optional(S.Unknown), description: S.optional(S.String), name: S.NonEmptyTrimmedString, required: S.Boolean, type: S.NonEmptyTrimmedString })),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const decode = (json: string) => S.decodeUnknown(S.parseJson(S.Array(CommandManifestEntrySchema)))(json);
const embeddingText = (entry: typeof CommandManifestEntrySchema.Type): string =>
    [
        entry.name,
        entry.category,
        entry.description,
        ...entry.params.map((p) => `${p.name}: ${p.description ?? p.type}`),
        ...entry.examples.map((e) => e.description ?? e.input),
    ].filter(Boolean).join(' ');

// --- [EXPORT] ----------------------------------------------------------------

const CommandManifest = {
    decode,
    embeddingText,
    schema: CommandManifestEntrySchema
} as const;

export { CommandManifest };
