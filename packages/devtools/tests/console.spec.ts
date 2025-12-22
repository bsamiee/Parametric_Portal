/**
 * Validate console interception behavior and argument formatting.
 */
/* biome-ignore-all lint/suspicious/noConsole: Testing console interception requires console access */
import { it } from '@fast-check/vitest';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { CONSOLE_TUNING, createLogEntry, formatArgs, interceptConsole } from '../src/console.ts';
import type { LogEntry } from '../src/types.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    levels: Object.entries(CONSOLE_TUNING.levelMap) as ReadonlyArray<readonly [string, string]>,
    methods: CONSOLE_TUNING.defaults.methods,
} as const);

// --- [TESTS] -----------------------------------------------------------------

describe('console', () => {
    describe('formatArgs', () => {
        it.prop([fc.array(fc.oneof(fc.string(), fc.integer(), fc.boolean()))])(
            'joins primitives with space',
            (args) => {
                const result = formatArgs(args);
                expect(args.length === 0 ? result === '' : args.every((a) => result.includes(String(a)))).toBe(true);
            },
        );

        it.prop([fc.jsonValue()])('stringifies objects', (obj) => {
            const result = formatArgs([obj]);
            typeof obj === 'object' && obj !== null
                ? expect(result).toBe(JSON.stringify(obj))
                : expect(result).toBe(String(obj));
        });

        it('handles mixed types', () => {
            expect(formatArgs(['msg', 42, { k: 'v' }])).toBe('msg 42 {"k":"v"}');
        });
    });

    describe('createLogEntry', () => {
        it.each(B.levels)('%s → level=%s', (method, expectedLevel) => {
            const entry = createLogEntry(method as 'log', ['test']);
            expect([entry.level, entry.fiberId, entry.annotations['source']]).toEqual([
                expectedLevel,
                'console',
                'console',
            ]);
        });

        it.prop([fc.array(fc.string(), { maxLength: 5, minLength: 1 })])('captures message from args', (args) => {
            const entry = createLogEntry('log', args);
            expect(args.every((a) => entry.message.includes(a))).toBe(true);
        });
    });

    describe('interceptConsole', () => {
        let origLog: typeof console.log;
        let origDebug: typeof console.debug;
        let mockLog: ReturnType<typeof vi.fn<typeof console.log>>;
        let mockDebug: ReturnType<typeof vi.fn<typeof console.debug>>;

        beforeEach(() => {
            origLog = console.log;
            origDebug = console.debug;
            mockLog = vi.fn<typeof console.log>();
            mockDebug = vi.fn<typeof console.debug>();
            console.log = mockLog;
            console.debug = mockDebug;
        });

        afterEach(() => {
            console.log = origLog;
            console.debug = origDebug;
        });

        it('captures logs and calls original', () => {
            const logs: LogEntry[] = [];
            const { restore } = interceptConsole({ logs, methods: ['log'] });

            console.log('test', 123);

            expect([logs.length, logs[0]?.message, mockLog.mock.calls[0]]).toEqual([1, 'test 123', ['test', 123]]);
            restore();
        });

        it('restores original methods', () => {
            const logs: LogEntry[] = [];
            const { restore } = interceptConsole({ logs, methods: ['log'] });

            restore();
            mockLog.mockClear();

            // After restore: console.log should invoke original mock, NOT capture to logs
            console.log('after-restore');
            expect([mockLog.mock.calls[0], logs.length]).toEqual([['after-restore'], 0]);
        });

        it('only intercepts specified methods', () => {
            const logs: LogEntry[] = [];
            const { restore } = interceptConsole({ logs, methods: ['log'] });

            console.log('captured');
            console.debug('not captured');

            expect(logs.map((l) => l.message)).toEqual(['captured']);
            restore();
        });

        it.prop([fc.nat({ max: 1000 })])('timestamps within execution window', (delay) => {
            const logs: LogEntry[] = [];
            const before = Date.now();
            const { restore } = interceptConsole({ logs, methods: ['log'] });

            console.log('t');
            const after = Date.now() + delay;

            expect(logs[0]?.timestamp.getTime()).toBeGreaterThanOrEqual(before);
            expect(logs[0]?.timestamp.getTime()).toBeLessThanOrEqual(after);
            restore();
        });
    });
});
