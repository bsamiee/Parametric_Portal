import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { Effect, pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type IsoDate = S.Schema.Type<typeof IsoDateSchema>;

// --- Schema Definitions ------------------------------------------------------

const IsoDateSchema = pipe(S.String, S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/), S.brand('IsoDate'));

// --- Constants (Unified Factory → Frozen) -----------------------------------

const { dateUtils } = Effect.runSync(
    Effect.all({
        dateUtils: Effect.succeed({
            addDays:
                (days: number) =>
                (date: Date): Effect.Effect<Date, never> =>
                    Effect.sync(() => addDays(date, days)),
            daysBetween: (start: Date, end: Date): Effect.Effect<number, never> =>
                Effect.sync(() => differenceInDays(end, start)),
            format:
                (formatStr = 'yyyy-MM-dd') =>
                (date: Date): Effect.Effect<string, ParseError> =>
                    Effect.try({
                        catch: (error) => new Error(`Format failed: ${String(error)}`) as ParseError,
                        try: () => format(date, formatStr),
                    }),
            parse: (input: string): Effect.Effect<Date, ParseError> =>
                pipe(
                    S.decodeUnknown(IsoDateSchema)(input),
                    Effect.map(parseISO),
                    Effect.filterOrFail(
                        (parsedDate) => isValid(parsedDate),
                        () => new Error(`Invalid date: ${input}`) as ParseError,
                    ),
                ),
        } as const),
    }),
);

const DateUtils = Object.freeze(dateUtils);

// --- Export ------------------------------------------------------------------

export { DateUtils, IsoDateSchema as IsoDate };
export type { IsoDate };
