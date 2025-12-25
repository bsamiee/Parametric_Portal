/**
 * Effect-native date/time operations with timezone-aware logic.
 */

import { DateTime, Duration, Effect, pipe, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TemporalConfig = {
    readonly defaultFormat?: string;
    readonly timeZone?: string;
};
type TemporalApi = {
    readonly addDays: (days: number) => (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly addHours: (hours: number) => (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly addMinutes: (minutes: number) => (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly addMonths: (months: number) => (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly daysBetween: (start: DateTime.DateTime, end: DateTime.DateTime) => Effect.Effect<number, never>;
    readonly endOfDay: (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly format: (dt: DateTime.DateTime, formatStr?: string) => Effect.Effect<string, TemporalError>;
    readonly isAfter: (dt1: DateTime.DateTime, dt2: DateTime.DateTime) => Effect.Effect<boolean, never>;
    readonly isBefore: (dt1: DateTime.DateTime, dt2: DateTime.DateTime) => Effect.Effect<boolean, never>;
    readonly parseIso: (input: string) => Effect.Effect<DateTime.DateTime, TemporalError>;
    readonly startOfDay: (dt: DateTime.DateTime) => Effect.Effect<DateTime.DateTime, never>;
    readonly timeAgo: (dt: DateTime.DateTime) => Effect.Effect<Duration.Duration, never>;
};

// --- [SCHEMA] ----------------------------------------------------------------

class TemporalError extends S.TaggedClass<TemporalError>()('TemporalError', {
    message: S.String,
    operation: S.Literal('format', 'parse', 'math'),
}) {}

/** Simple date schema: YYYY-MM-DD format, validates day/month bounds. */
const SimpleDateSchema = pipe(S.String, S.pattern(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        format: 'yyyy-MM-dd',
        timeZone: 'UTC',
    },
    msPerDay: 24 * 60 * 60 * 1000,
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const temporalHandlers = {
    addDays: (days: number) => (dt: DateTime.DateTime) => Effect.sync(() => DateTime.add(dt, { days })),
    addHours: (hours: number) => (dt: DateTime.DateTime) => Effect.sync(() => DateTime.add(dt, { hours })),
    addMinutes: (minutes: number) => (dt: DateTime.DateTime) => Effect.sync(() => DateTime.add(dt, { minutes })),
    addMonths: (months: number) => (dt: DateTime.DateTime) => Effect.sync(() => DateTime.add(dt, { months })),
    daysBetween: (start: DateTime.DateTime, end: DateTime.DateTime) =>
        Effect.sync(() => Math.round(Duration.toDays(DateTime.distanceDuration(start, end)))),
    endOfDay: (dt: DateTime.DateTime) => Effect.sync(() => DateTime.endOf(dt, 'day')),
    format: (config: TemporalConfig) => (dt: DateTime.DateTime, formatStr?: string) =>
        Effect.try({
            catch: (error) =>
                new TemporalError({
                    message: `Format failed: ${String(error)}`,
                    operation: 'format',
                }),
            try: () => {
                const fmt = formatStr ?? config.defaultFormat ?? B.defaults.format;
                const date = new Date(DateTime.toEpochMillis(dt));
                const yyyy = date.getUTCFullYear();
                const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(date.getUTCDate()).padStart(2, '0');
                return fmt === 'yyyy-MM-dd' ? `${yyyy}-${mm}-${dd}` : DateTime.format(dt, { dateStyle: 'short' });
            },
        }),
    isAfter: (dt1: DateTime.DateTime, dt2: DateTime.DateTime) => Effect.sync(() => DateTime.greaterThan(dt1, dt2)),
    isBefore: (dt1: DateTime.DateTime, dt2: DateTime.DateTime) => Effect.sync(() => DateTime.lessThan(dt1, dt2)),
    parseIso: (input: string) =>
        pipe(
            S.decodeUnknown(SimpleDateSchema)(input),
            Effect.flatMap((dateStr) =>
                DateTime.make(`${dateStr}T00:00:00.000Z`).pipe(
                    Effect.mapError(
                        () =>
                            new TemporalError({
                                message: `Invalid ISO date: ${input}`,
                                operation: 'parse',
                            }),
                    ),
                ),
            ),
            Effect.mapError((e) =>
                e instanceof TemporalError ? e : new TemporalError({ message: String(e), operation: 'parse' }),
            ),
        ),
    startOfDay: (dt: DateTime.DateTime) => Effect.sync(() => DateTime.startOf(dt, 'day')),
    timeAgo: (dt: DateTime.DateTime) =>
        pipe(
            DateTime.now,
            Effect.map((now) => DateTime.distanceDuration(now, dt)),
        ),
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const createTemporal = (config: TemporalConfig = {}): TemporalApi =>
    Object.freeze({
        addDays: temporalHandlers.addDays,
        addHours: temporalHandlers.addHours,
        addMinutes: temporalHandlers.addMinutes,
        addMonths: temporalHandlers.addMonths,
        daysBetween: temporalHandlers.daysBetween,
        endOfDay: temporalHandlers.endOfDay,
        format: temporalHandlers.format(config),
        isAfter: temporalHandlers.isAfter,
        isBefore: temporalHandlers.isBefore,
        parseIso: temporalHandlers.parseIso,
        startOfDay: temporalHandlers.startOfDay,
        timeAgo: temporalHandlers.timeAgo,
    });

// --- [EXPORT] ----------------------------------------------------------------

export { B as TEMPORAL_TUNING, createTemporal, TemporalError };
export type { TemporalApi, TemporalConfig };
