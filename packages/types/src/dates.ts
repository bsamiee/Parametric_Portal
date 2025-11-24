import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
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
                (numDays: number) =>
                (date: Date): Effect.Effect<Date, never> =>
                    Effect.sync(() => new Date(date.getTime() + numDays * 86400000)),
            daysBetween: (start: Date, end: Date): Effect.Effect<number, never> =>
                Effect.sync(() => Math.floor((end.getTime() - start.getTime()) / 86400000)),
            formatDate:
                (formatStr = 'yyyy-MM-dd') =>
                (date: Date): Effect.Effect<string, ParseError> =>
                    Effect.try({
                        catch: (error) => new Error(`Format failed: ${String(error)}`) as ParseError,
                        try: () => {
                            const year = date.getFullYear();
                            const month = String(date.getMonth() + 1).padStart(2, '0');
                            const day = String(date.getDate()).padStart(2, '0');
                            return formatStr.replace('yyyy', String(year)).replace('MM', month).replace('dd', day);
                        },
                    }),
            parse: (input: string): Effect.Effect<Date, ParseError> =>
                pipe(
                    Effect.try({
                        catch: (error) => new Error(`Parse failed: ${String(error)}`) as ParseError,
                        try: () => new Date(input),
                    }),
                    Effect.filterOrFail(
                        (parsedDate) => !Number.isNaN(parsedDate.getTime()),
                        () => new Error(`Invalid date: ${input}`) as ParseError,
                    ),
                ),
        } as const),
    }),
);

const DateUtils = Object.freeze(dateUtils);

// --- Export ------------------------------------------------------------------

export { DateUtils, IsoDateSchema };
export type { IsoDate };
