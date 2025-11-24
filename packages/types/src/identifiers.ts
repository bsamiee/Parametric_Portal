import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { Cache, Duration, Effect, pipe } from 'effect';
import { v7 as uuidv7 } from 'uuid';

// --- Type Definitions --------------------------------------------------------

export type Uuidv7 = S.Schema.Type<typeof Uuidv7Schema>;

// --- Schema Definitions ------------------------------------------------------

const Uuidv7SchemaUnbranded = pipe(
    S.String,
    S.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
);

export const Uuidv7Schema = pipe(Uuidv7SchemaUnbranded, S.brand('Uuidv7'));

// --- Constants (Unified Factory → Frozen) ------------------------------------

const { idCache } = Effect.runSync(
    Effect.all({
        idCache: Cache.make({
            capacity: 1000,
            lookup: (uuid: string) => Effect.succeed(S.is(Uuidv7SchemaUnbranded)(uuid)),
            timeToLive: Duration.minutes(5),
        }),
    }),
);

const ID_CACHE = Object.freeze(idCache);

// --- Pure Utility Functions --------------------------------------------------

const castToUuidv7 = (uuid: string): Uuidv7 => uuid as Uuidv7;

export const isUuidv7 = S.is(Uuidv7Schema);

export const isUuidv7Cached = (uuid: string): Effect.Effect<boolean, never, never> => ID_CACHE.get(uuid);

// --- Effect Pipelines --------------------------------------------------------

export const generateUuidv7: Effect.Effect<Uuidv7, never, never> = Effect.sync(() => castToUuidv7(uuidv7()));

export const createIdGenerator = <A>(schema: S.Schema<A, string, never>): Effect.Effect<A, ParseError, never> =>
    pipe(
        generateUuidv7,
        Effect.flatMap((uuid) => S.decode(schema)(uuid)),
    );
