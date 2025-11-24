import { Schema as S } from '@effect/schema';
import type { ParseError } from '@effect/schema/ParseResult';
import { addDays, differenceInDays, format, isValid, parseISO } from 'date-fns';
import { Effect, pipe } from 'effect';

// --- Type Definitions --------------------------------------------------------

type IsoDate = S.Schema.Type<typeof IsoDate>;

// --- Schema Definitions ------------------------------------------------------

const IsoDate = pipe(S.String, S.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/), S.brand('IsoDate'));

// --- Constants (Unified Factory → Frozen) ------------------------------------

const { dateConfig, dateUtils } = Effect.runSync(
    Effect.all({
        dateConfig: Effect.succeed({
            defaultFormat: 'yyyy-MM-dd',
        } as const),
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
                        catch: (e) => new Error(`Format failed: ${String(e)}`) as ParseError,
                        try: () => format(date, formatStr),
                    }),

            parse: (input: string): Effect.Effect<Date, ParseError> =>
                pipe(
                    S.decodeUnknown(IsoDate)(input),
                    Effect.map(() => parseISO(input)),
                    Effect.filterOrFail(
                        (d) => isValid(d),
                        () => new Error(`Invalid date: ${input}`) as ParseError,
                    ),
                ),
        } as const),
    }),
);

const _DATE_CONFIG = Object.freeze(dateConfig);
const DateUtils = Object.freeze(dateUtils);

// --- Export ------------------------------------------------------------------

export { DateUtils, IsoDate };
