import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Effect, pipe } from 'effect';
import { v7 as uuidv7 } from 'uuid';

// --- Type Definitions --------------------------------------------------------

export type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>;

// --- Constants (Unified Factory → Frozen) ------------------------------------

const { patterns } = Effect.runSync(
    Effect.all({
        patterns: Effect.succeed({
            uuidv7: /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        } as const),
    }),
);

const IDENTIFIER_PATTERNS = Object.freeze(patterns);

// --- Schema Definitions ------------------------------------------------------

export const Uuidv7Schema = pipe(S.String, S.pattern(IDENTIFIER_PATTERNS.uuidv7), S.brand('Uuidv7'));

// --- Pure Utility Functions --------------------------------------------------

const castToUuidv7 = (uuid: string): Uuidv7 => uuid as Uuidv7;

export const isUuidv7 = S.is(Uuidv7Schema);

// --- Effect Pipelines --------------------------------------------------------

export const generateUuidv7: Effect.Effect<Uuidv7, never, never> = Effect.sync(() => castToUuidv7(uuidv7()));

export const createIdGenerator = <A>(schema: S.Schema<A, string, never>): Effect.Effect<A, ParseError, never> =>
    pipe(
        generateUuidv7,
        Effect.flatMap((uuid) => S.decode(schema)(uuid)),
    );
