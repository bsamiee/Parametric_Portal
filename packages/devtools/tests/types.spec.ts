/**
 * Validate devtools types module via property-based testing.
 */

import { it } from '@fast-check/vitest';
import { LogLevel, Schema as S } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import {
    DevToolsConfigSchema,
    formatDuration,
    formatLogEntry,
    parseLogLevel,
    TYPES_TUNING,
    toError,
} from '../src/types.ts';
import { entry } from './utils.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    boundary: TYPES_TUNING.format.msPerSecond,
    levels: Object.keys(LogLevel).filter(
        (k) => !k.startsWith('_') && k !== 'Order' && k !== 'locally',
    ) as ReadonlyArray<string>,
    logRange: { max: TYPES_TUNING.defaults.maxLogs * 5, min: 50 },
} as const);

// --- [TESTS] -----------------------------------------------------------------

describe('types', () => {
    describe('toError', () => {
        it.prop([fc.anything()])('always returns Error instance', (input) => {
            expect(toError(input)).toBeInstanceOf(Error);
        });

        it('preserves Error identity', () => {
            const e = new Error('original');
            expect(toError(e)).toBe(e);
        });

        it.prop([fc.string()])('wraps string as message', (s) => {
            expect(toError(s).message).toBe(s);
        });
    });

    describe('formatDuration', () => {
        it.prop([fc.float({ max: Math.fround(B.boundary - 0.01), min: 0, noNaN: true })])(
            'ms format below boundary',
            (n) => {
                expect(formatDuration(n)).toMatch(/ms$/);
            },
        );

        it.prop([fc.float({ max: Math.fround(1e5), min: Math.fround(B.boundary), noNaN: true })])(
            'seconds format at/above boundary',
            (n) => {
                const result = formatDuration(n);
                expect(result).toMatch(/^\d+\.\d+s$/);
            },
        );

        it('boundary precision', () => {
            expect([formatDuration(999), formatDuration(1000), formatDuration(1001)]).toEqual([
                '999.0ms',
                '1.00s',
                '1.00s',
            ]);
        });
    });

    describe('formatLogEntry', () => {
        it.prop([
            fc.string({ minLength: 1 }),
            fc.constantFrom('Debug', 'Info', 'Warning', 'Error', 'Fatal') as fc.Arbitrary<
                'Debug' | 'Error' | 'Fatal' | 'Info' | 'Warning'
            >,
        ])('includes message and level', (message, level) => {
            const result = formatLogEntry(entry({ level, message }));
            expect(result).toContain(message);
            expect(result).toContain(level);
        });

        it.prop([fc.dictionary(fc.string({ minLength: 1 }), fc.nat(), { maxKeys: 3, minKeys: 1 })])(
            'formats spans as key=value pairs',
            (spans) => {
                const result = formatLogEntry(entry({ spans }));
                expect(Object.entries(spans).every(([k, v]) => result.includes(`${k}=${v}ms`))).toBe(true);
            },
        );

        it('empty spans omit brackets', () => {
            expect(formatLogEntry(entry({ spans: {} }))).not.toContain('[');
        });
    });

    describe('parseLogLevel', () => {
        it.each([
            ['Debug', LogLevel.Debug],
            ['Info', LogLevel.Info],
            ['Warning', LogLevel.Warning],
            ['Error', LogLevel.Error],
            ['Fatal', LogLevel.Fatal],
        ] as const)('%s → LogLevel.%s', (input, expected) => {
            expect(parseLogLevel(input)).toBe(expected);
        });

        it.prop([fc.string().filter((s) => !['Debug', 'Info', 'Warning', 'Error', 'Fatal'].includes(s))])(
            'invalid defaults to Info',
            (s) => {
                expect(parseLogLevel(s)).toBe(LogLevel.Info);
            },
        );

        it('undefined defaults to Info', () => {
            expect(parseLogLevel(undefined)).toBe(LogLevel.Info);
        });
    });

    describe('DevToolsConfigSchema', () => {
        const cfg = (o: Record<string, unknown> = {}) => ({ app: 'test', env: {}, ...o });

        it.prop([fc.integer({ max: B.logRange.max, min: B.logRange.min })])('accepts maxLogs in range', (n) => {
            expect(S.is(DevToolsConfigSchema)(cfg({ maxLogs: n }))).toBe(true);
        });

        it.prop([fc.integer({ max: B.logRange.min - 1, min: -1000 })])('rejects maxLogs below minimum', (n) => {
            expect(S.is(DevToolsConfigSchema)(cfg({ maxLogs: n }))).toBe(false);
        });

        it.prop([fc.integer({ max: 10000, min: B.logRange.max + 1 })])('rejects maxLogs above maximum', (n) => {
            expect(S.is(DevToolsConfigSchema)(cfg({ maxLogs: n }))).toBe(false);
        });
    });
});
