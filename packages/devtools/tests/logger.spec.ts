/**
 * Validate Effect logger factory and accumulation via deterministic tests.
 */
import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';
import {
    clearLogs,
    createAccumulatingLogger,
    createCombinedLogger,
    createHmrHandler,
    createLoggerLayer,
    getLogs,
    getLogsFormatted,
    getLogsJson,
    installDevTools,
    LOGGER_TUNING,
} from '../src/logger.ts';
import { entry } from './utils.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    levels: ['logInfo', 'logWarning', 'logError'] as const,
    maxLogs: LOGGER_TUNING.defaults.maxLogs,
    testMaxLogs: [5, 10, 20, 50] as const,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const runLogIterations = (count: number, logFn: (i: number) => void): void => {
    for (let i = 0; i < count; i += 1) {
        logFn(i);
    }
};

// --- [TESTS] -----------------------------------------------------------------

describe('logger', () => {
    describe('createAccumulatingLogger', () => {
        it.each(B.levels)('%s captures with correct level', (method) => {
            const { logger, logs } = createAccumulatingLogger({ maxLogs: 100 });
            const layer = Logger.replace(Logger.defaultLogger, logger);
            Effect.runSync(Effect[method]('test message').pipe(Effect.provide(layer)));
            const expectedLevel = method.replace('log', '');
            expect(logs[0]?.level).toBe(expectedLevel);
        });

        it.each([
            [{ key1: 'value1' }],
            [{ baz: 'qux', foo: 'bar' }],
            [{ a: '1', b: '2', c: '3' }],
        ])('captures annotations %j', (annotations) => {
            const { logger, logs } = createAccumulatingLogger({ maxLogs: 100 });
            const layer = Logger.replace(Logger.defaultLogger, logger);
            Effect.runSync(
                Effect.logInfo('t').pipe(
                    Effect.annotateLogs(annotations as Record<string, string>),
                    Effect.provide(layer),
                ),
            );

            expect(Object.entries(annotations).every(([k, v]) => logs[0]?.annotations[k] === v)).toBe(true);
        });

        it.each(B.testMaxLogs)('truncates at maxLogs boundary (maxLogs=%i)', (maxLogs) => {
            const { logger, logs } = createAccumulatingLogger({ maxLogs });
            const layer = Logger.replace(Logger.defaultLogger, logger);
            const overflow = maxLogs + 10;
            runLogIterations(overflow, (i) => Effect.runSync(Effect.logInfo(`msg-${i}`).pipe(Effect.provide(layer))));
            expect([logs.length, logs[0]?.message, logs[maxLogs - 1]?.message]).toEqual([
                maxLogs,
                `msg-${overflow - maxLogs}`,
                `msg-${overflow - 1}`,
            ]);
        });
    });

    describe('createLoggerLayer', () => {
        it.each(B.testMaxLogs)('accumulates up to maxLogs (maxLogs=%i)', (maxLogs) => {
            const { layer, logs } = createLoggerLayer({ logLevel: 'Debug', maxLogs, silent: true });
            runLogIterations(maxLogs + 5, (i) => Effect.runSync(Effect.logInfo(`m-${i}`).pipe(Effect.provide(layer))));
            expect(logs.length).toBe(maxLogs);
        });

        it.each([
            ['Debug', ['Debug', 'Info', 'Warning']],
            ['Info', ['Info', 'Warning']],
            ['Warning', ['Warning']],
        ] as const)('logLevel=%s filters correctly', (level, expectedLevels) => {
            const { layer, logs } = createLoggerLayer({ logLevel: level, maxLogs: 100, silent: true });
            Effect.runSync(Effect.logDebug('d').pipe(Effect.provide(layer)));
            Effect.runSync(Effect.logInfo('i').pipe(Effect.provide(layer)));
            Effect.runSync(Effect.logWarning('w').pipe(Effect.provide(layer)));
            expect(logs.map((l) => l.level)).toEqual(expectedLevels);
        });
    });

    describe('getLogs/getLogsFormatted/getLogsJson', () => {
        it.each([
            ['msg1'],
            ['hello', 'world'],
            ['a', 'b', 'c', 'd', 'e'],
        ])('getLogs returns shallow copy', (...messages) => {
            const logs = messages.map((m) => entry({ message: m }));
            const result = getLogs(logs);
            expect([result.length, result !== logs]).toEqual([logs.length, true]);
        });

        it.each([
            [['line1', 'line2']],
            [['a', 'b', 'c']],
            [['first', 'second', 'third', 'fourth']],
        ])('getLogsFormatted joins with newlines', (messages) => {
            const logs = messages.map((m) => entry({ message: m }));
            const result = getLogsFormatted(logs);
            expect(result.split('\n').length).toBe(messages.length);
        });

        it.each([
            [['single']],
            [['one', 'two']],
            [['a', 'b', 'c', 'd', 'e']],
        ])('getLogsJson produces valid JSON', (messages) => {
            const logs = messages.map((m) => entry({ message: m }));
            expect(() => JSON.parse(getLogsJson(logs))).not.toThrow();
        });
    });

    describe('clearLogs', () => {
        it.each([0, 1, 10, 50, 100])('empties array of size %i', (n) => {
            const logs = Array.from({ length: n }, (_, i) => entry({ message: `msg-${i}` }));
            clearLogs(logs);
            expect(logs).toHaveLength(0);
        });
    });

    describe('createCombinedLogger', () => {
        it.each(['test message', 'hello world', 'accumulation test'])('accumulates message: %s', (message) => {
            const { logger, logs } = createCombinedLogger({ maxLogs: 100, silent: true });
            Effect.runSync(Effect.logInfo(message).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))));
            expect(logs[0]?.message).toBe(message);
        });
    });

    describe('createHmrHandler', () => {
        it('clears logs and adds HMR message', () => {
            const { layer, logs } = createLoggerLayer({ silent: true });
            logs.push(entry({ message: 'existing' }));
            const handler = createHmrHandler(logs, layer);
            handler();
            expect([logs.length, logs[0]?.message?.includes('HMR')]).toEqual([1, true]);
        });
    });

    describe('installDevTools', () => {
        it('returns functional devtools object', () => {
            const { layer, logs } = createLoggerLayer({ silent: true });
            Effect.runSync(Effect.logInfo('devtools test').pipe(Effect.provide(layer)));
            const dt = installDevTools({ env: 'test', loggerLayer: layer, logs, renderDebug: () => {}, startTime: 0 });
            expect([
                dt.appDebug.env,
                typeof dt.appGetLogs,
                typeof dt.appLogTest,
                dt.appGetLogs().includes('devtools test'),
            ]).toEqual(['test', 'function', 'function', true]);
        });

        it('appGetLogsJson returns parseable JSON', () => {
            const { layer, logs } = createLoggerLayer({ silent: true });
            const dt = installDevTools({ env: 'test', loggerLayer: layer, logs, renderDebug: () => {}, startTime: 0 });
            expect(() => JSON.parse(dt.appGetLogsJson())).not.toThrow();
        });
    });
});
