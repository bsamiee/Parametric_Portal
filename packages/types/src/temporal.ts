/**
 * Temporal operations: date-fns wrappers with Effect pipelines.
 */
import { addDays, differenceInDays, format, parseISO } from 'date-fns';
import { Effect, pipe, Schema as S } from 'effect';
import { produce } from 'immer';

// --- [TYPES] -----------------------------------------------------------------

type TemporalConfig = {
    readonly defaultDateFormat?: string;
};
type TemporalApi = {
    readonly addDays: (numDays: number) => (date: Date) => Effect.Effect<Date, never>;
    readonly daysBetween: (start: Date, end: Date) => Effect.Effect<number, never>;
    readonly formatDate: (formatStr?: string) => (date: Date) => Effect.Effect<string, TemporalError>;
    readonly parse: (input: string) => Effect.Effect<Date, TemporalError>;
    readonly produce: typeof produce;
};

// --- [CLASSES] ---------------------------------------------------------------

class TemporalError extends S.TaggedClass<TemporalError>()('TemporalError', {
    message: S.String,
    operation: S.Literal('format', 'parse'),
}) {}

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaultFormat: 'yyyy-MM-dd',
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const temporalHandlers = {
    addDays:
        (numDays: number) =>
        (date: Date): Effect.Effect<Date, never> =>
            Effect.sync(() => addDays(date, numDays)),
    daysBetween: (start: Date, end: Date): Effect.Effect<number, never> =>
        Effect.sync(() => differenceInDays(end, start)),
    formatDate:
        (formatStr: string) =>
        (date: Date): Effect.Effect<string, TemporalError> =>
            Effect.try({
                catch: (error) =>
                    new TemporalError({ message: `Format failed: ${String(error)}`, operation: 'format' }),
                try: () => format(date, formatStr),
            }),
    parse: (input: string): Effect.Effect<Date, TemporalError> =>
        pipe(
            Effect.try({
                catch: (error) => new TemporalError({ message: `Parse failed: ${String(error)}`, operation: 'parse' }),
                try: () => parseISO(input),
            }),
            Effect.filterOrFail(
                (parsedDate) => !Number.isNaN(parsedDate.getTime()),
                () => new TemporalError({ message: `Invalid date: ${input}`, operation: 'parse' }),
            ),
        ),
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createTemporal = (config: TemporalConfig = {}): TemporalApi =>
    Object.freeze({
        addDays: temporalHandlers.addDays,
        daysBetween: temporalHandlers.daysBetween,
        formatDate: (formatStr?: string) =>
            temporalHandlers.formatDate(formatStr ?? config.defaultDateFormat ?? B.defaultFormat),
        parse: temporalHandlers.parse,
        produce,
    } as const);

// --- [EXPORT] ----------------------------------------------------------------

export { B as TEMPORAL_TUNING, createTemporal, TemporalError };
export type { TemporalApi, TemporalConfig };
