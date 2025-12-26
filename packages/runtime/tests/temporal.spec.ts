/**
 * Temporal tests: Effect-native date/time operations with frozen time determinism.
 */
import { it } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS } from '@parametric-portal/test-utils/constants';
import '@parametric-portal/test-utils/harness';
import { DateTime, Duration, Effect, Exit, pipe } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { createTemporal, TEMPORAL_TUNING, TemporalError } from '../src/temporal';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    derived: {
        msPerDay: 24 * 60 * 60 * 1000,
        msPerHour: 60 * 60 * 1000,
        msPerMinute: 60 * 1000,
    },
    frozenDate: TEST_CONSTANTS.frozenTime,
    invalidDates: ['not-a-date', '2025-13-01', '2025-01-32', '', 'abc123'] as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const run = <A, E>(eff: Effect.Effect<A, E, never>): Exit.Exit<A, E> => Effect.runSyncExit(eff);
const mkDateTime = (date: Date): DateTime.DateTime => DateTime.unsafeMake(date);
const extractMs = (exit: Exit.Exit<DateTime.DateTime, never>): number =>
    Exit.isSuccess(exit) ? DateTime.toEpochMillis(exit.value) : Number.NaN;

// --- [CONSTANTS] -------------------------------------------------------------

const temporalApi = createTemporal();
const arithmeticOps = [
    {
        arb: FC_ARB.days,
        handler: (v: number, dt: DateTime.DateTime) => run(temporalApi.addDays(v)(dt)),
        msPer: B.derived.msPerDay,
        name: 'addDays',
    },
    {
        arb: FC_ARB.hours,
        handler: (v: number, dt: DateTime.DateTime) => run(temporalApi.addHours(v)(dt)),
        msPer: B.derived.msPerHour,
        name: 'addHours',
    },
    {
        arb: FC_ARB.minutes,
        handler: (v: number, dt: DateTime.DateTime) => run(temporalApi.addMinutes(v)(dt)),
        msPer: B.derived.msPerMinute,
        name: 'addMinutes',
    },
] as const;

// --- [DESCRIBE] TEMPORAL_TUNING + createTemporal -----------------------------

describe('TEMPORAL_TUNING', () => {
    it('is frozen with correct structure and derived msPerDay', () => {
        expect(Object.isFrozen(TEMPORAL_TUNING)).toBe(true);
        expect(TEMPORAL_TUNING.defaults).toEqual({ format: 'yyyy-MM-dd', timeZone: 'UTC' });
        expect(TEMPORAL_TUNING.msPerDay).toBe(B.derived.msPerDay);
    });
});
describe('createTemporal', () => {
    const expectedMethods = [
        'addDays',
        'addHours',
        'addMinutes',
        'addMonths',
        'daysBetween',
        'endOfDay',
        'format',
        'isAfter',
        'isBefore',
        'parseIso',
        'startOfDay',
        'timeAgo',
    ] as const;
    it('returns frozen API with all methods', () => {
        const api = createTemporal();
        expect(Object.isFrozen(api)).toBe(true);
        expectedMethods.forEach((m) => {
            expect(typeof api[m]).toBe('function');
        });
    });
    it('accepts custom config', () => {
        expect(createTemporal({ timeZone: 'America/New_York' })).toBeDefined();
    });
});

// --- [DESCRIBE] parseIso -----------------------------------------------------

describe('parseIso', () => {
    it.prop([FC_ARB.isoDate()])('parses arbitrary valid ISO dates', (date) => {
        expect(run(temporalApi.parseIso(date))).toBeSuccess();
    });
    it.each(B.invalidDates)('fails invalid date: %s', (date) => {
        const result = run(temporalApi.parseIso(date));
        expect(result).toBeFailure();
        Exit.isFailure(result) &&
            result.cause._tag === 'Fail' &&
            expect(result.cause.error).toBeInstanceOf(TemporalError);
    });
});

// --- [DESCRIBE] temporal arithmetic ------------------------------------------

describe.each(arithmeticOps)('$name', ({ arb, handler, msPer }) => {
    const baseDate = mkDateTime(B.frozenDate);
    const baseMs = B.frozenDate.getTime();
    it.prop([arb()])('applies correct ms offset', (value) => {
        const result = handler(value, baseDate);
        expect(result).toBeSuccess();
        expect(extractMs(result)).toBe(baseMs + value * msPer);
    });
    it.prop([arb().filter((v) => v !== 0)])('inverse operation is identity', (value) => {
        const result = pipe(
            temporalApi.addDays(value)(baseDate),
            Effect.flatMap(temporalApi.addDays(-value)),
            Effect.map(DateTime.toEpochMillis),
            Effect.runSyncExit,
        );
        expect(result).toBeSuccess(baseMs);
    });
});
describe('addMonths', () => {
    const baseDate = mkDateTime(B.frozenDate);
    const baseMonth = B.frozenDate.getMonth();
    it.prop([FC_ARB.months()])('produces valid DateTime with deterministic month delta', (months) => {
        const result = run(temporalApi.addMonths(months)(baseDate));
        expect(result).toBeSuccess();
        Exit.isSuccess(result) &&
            expect(new Date(DateTime.toEpochMillis(result.value)).getMonth()).toBe((baseMonth + months + 12) % 12);
    });
    it('handles year boundary (Dec → Jan)', () => {
        const dec31 = mkDateTime(new Date('2025-12-31'));
        const result = run(temporalApi.addMonths(1)(dec31));
        expect(result).toBeSuccess();
        Exit.isSuccess(result) && expect(new Date(DateTime.toEpochMillis(result.value)).getMonth()).toBe(0);
    });
});

// --- [DESCRIBE] daysBetween --------------------------------------------------

describe('daysBetween', () => {
    const baseDate = mkDateTime(B.frozenDate);
    it('calculates exact difference and zero for same date', () => {
        const future = mkDateTime(new Date('2025-01-22'));
        expect(run(temporalApi.daysBetween(baseDate, future))).toBeSuccess(7);
        expect(run(temporalApi.daysBetween(baseDate, baseDate))).toBeSuccess(0);
    });
    it.prop([FC_ARB.days()])('daysBetween(base, base+n) equals |n|', (days) => {
        const added = run(temporalApi.addDays(days)(baseDate));
        Exit.isSuccess(added) &&
            expect(run(temporalApi.daysBetween(baseDate, added.value))).toBeSuccess(Math.abs(days));
    });
    it('handles leap year Feb 28 → Mar 1', () => {
        const feb28 = mkDateTime(new Date('2024-02-28T12:00:00Z'));
        const result = run(temporalApi.addDays(2)(feb28));
        expect(result).toBeSuccess();
        Exit.isSuccess(result) && expect(new Date(DateTime.toEpochMillis(result.value)).getUTCMonth()).toBe(2);
    });
});

// --- [DESCRIBE] day boundaries -----------------------------------------------

describe('day boundaries', () => {
    const baseDate = mkDateTime(B.frozenDate);
    const expectedYMD = {
        date: B.frozenDate.getUTCDate(),
        month: B.frozenDate.getUTCMonth(),
        year: B.frozenDate.getUTCFullYear(),
    };
    it('startOfDay sets 00:00:00.000 and preserves YMD', () => {
        const result = run(temporalApi.startOfDay(baseDate));
        expect(result).toBeSuccess();
        Exit.isSuccess(result) &&
            (() => {
                const d = new Date(DateTime.toEpochMillis(result.value));
                expect([d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]).toEqual([
                    0, 0, 0, 0,
                ]);
                expect({ date: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() }).toEqual(expectedYMD);
            })();
    });
    it('endOfDay sets 23:59:59.999 and preserves YMD', () => {
        const result = run(temporalApi.endOfDay(baseDate));
        expect(result).toBeSuccess();
        Exit.isSuccess(result) &&
            (() => {
                const d = new Date(DateTime.toEpochMillis(result.value));
                expect([d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()]).toEqual([
                    23, 59, 59, 999,
                ]);
                expect({ date: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() }).toEqual(expectedYMD);
            })();
    });
});

// --- [DESCRIBE] comparisons --------------------------------------------------

describe('comparisons', () => {
    const earlier = mkDateTime(new Date('2025-01-01'));
    const later = mkDateTime(new Date('2025-01-15'));
    it('isBefore: earlier < later, not later < earlier, not same < same', () => {
        expect(run(temporalApi.isBefore(earlier, later))).toBeSuccess(true);
        expect(run(temporalApi.isBefore(later, earlier))).toBeSuccess(false);
        expect(run(temporalApi.isBefore(earlier, earlier))).toBeSuccess(false);
    });
    it('isAfter: later > earlier, not earlier > later, not same > same', () => {
        expect(run(temporalApi.isAfter(later, earlier))).toBeSuccess(true);
        expect(run(temporalApi.isAfter(earlier, later))).toBeSuccess(false);
        expect(run(temporalApi.isAfter(earlier, earlier))).toBeSuccess(false);
    });
    it.prop([FC_ARB.days()])('isBefore and isAfter are inverses for non-equal dates', (days) => {
        fc.pre(days !== 0);
        const baseDate = mkDateTime(B.frozenDate);
        const added = run(temporalApi.addDays(days)(baseDate));
        Exit.isSuccess(added) &&
            (() => {
                const before = run(temporalApi.isBefore(baseDate, added.value));
                const after = run(temporalApi.isAfter(baseDate, added.value));
                Exit.isSuccess(before) && Exit.isSuccess(after) && expect(before.value).toBe(!after.value);
            })();
    });
});

// --- [DESCRIBE] format -------------------------------------------------------

describe('format', () => {
    const baseDate = mkDateTime(B.frozenDate);
    it('formats to yyyy-MM-dd pattern deterministically', () => {
        const r1 = run(temporalApi.format(baseDate));
        const r2 = run(temporalApi.format(baseDate));
        expect(r1).toBeSuccess('2025-01-15');
        expect(r2).toBeSuccess('2025-01-15');
        Exit.isSuccess(r1) && Exit.isSuccess(r2) && expect(r1.value).toBe(r2.value);
    });
    it('output matches ISO date regex', () => {
        const result = run(temporalApi.format(baseDate));
        Exit.isSuccess(result) && expect(result.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

// --- [DESCRIBE] timeAgo ------------------------------------------------------

describe('timeAgo', () => {
    it('returns near-zero duration for current time', () => {
        const now = DateTime.unsafeMake(new Date());
        const result = Effect.runSync(temporalApi.timeAgo(now));
        expect(Duration.toMillis(result)).toBeLessThan(100);
    });
    it('calculates duration for past date with correct magnitude', () => {
        const oneHourAgo = DateTime.subtract(DateTime.unsafeMake(new Date()), { hours: 1 });
        const result = Effect.runSync(temporalApi.timeAgo(oneHourAgo));
        const hours = Duration.toHours(result);
        expect(hours).toBeGreaterThanOrEqual(0.99);
        expect(hours).toBeLessThanOrEqual(1.01);
    });
    it.prop([FC_ARB.days().filter((d) => d >= 1 && d <= 30)])('duration magnitude scales with offset', (days) => {
        const past = DateTime.subtract(DateTime.unsafeMake(new Date()), { days });
        const result = Effect.runSync(temporalApi.timeAgo(past));
        const resultDays = Math.abs(Duration.toDays(result));
        expect(resultDays).toBeGreaterThanOrEqual(days - 0.1);
        expect(resultDays).toBeLessThanOrEqual(days + 0.1);
    });
});

// --- [DESCRIBE] TemporalError ------------------------------------------------

describe('TemporalError', () => {
    it.each(['format', 'parse', 'math'] as const)('has correct _tag and accepts operation: %s', (op) => {
        const error = new TemporalError({ message: 'test', operation: op });
        expect(error._tag).toBe('TemporalError');
        expect(error.operation).toBe(op);
    });
});
