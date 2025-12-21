/**
 * Validate Effect logger factory and accumulation via property-based tests.
 */
import { it } from '@fast-check/vitest';
import { Effect, Logger } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
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
} as const);

// --- [TESTS] -----------------------------------------------------------------

describe('logger', () => {
    describe('createAccumulatingLogger', () => {
        it.each(B.levels)('%s captures with correct level', (method) => {
            const { logger, logs } = createAccumulatingLogger({ maxLogs: 100 });
            const layer = Logger.replace(Logger.defaultLogger, logger);
            Effect.runSync(Effect[method]('test message').pipe(Effect.provide(layer)));

            const expectedLevel = method.replace('log', '');
            expect(logs[0].level).toBe(expectedLevel);
        });

        it.prop([fc.dictionary(fc.string({ minLength: 1 }), fc.string(), { maxKeys: 3, minKeys: 1 })])(
            'captures annotations',
            (annotations) => {
                const { logger, logs } = createAccumulatingLogger({ maxLogs: 100 });
                const layer = Logger.replace(Logger.defaultLogger, logger);

                Effect.runSync(
                    Effect.logInfo('t').pipe(
                        Effect.annotateLogs(annotations as Record<string, string>),
                        Effect.provide(layer),
                    ),
                );

                expect(Object.entries(annotations).every(([k, v]) => logs[0].annotations[k] === v)).toBe(true);
            },
        );

        it.prop([fc.integer({ max: 50, min: 5 })])('truncates at maxLogs boundary', (maxLogs) => {
            const { logger, logs } = createAccumulatingLogger({ maxLogs });
            const layer = Logger.replace(Logger.defaultLogger, logger);
            const overflow = maxLogs + 10;

            Array.from({ length: overflow }, (_, i) => i).map((i) =>
                Effect.runSync(Effect.logInfo(`msg-${i}`).pipe(Effect.provide(layer))),
            );

            expect([logs.length, logs[0].message, logs[maxLogs - 1].message]).toEqual([
                maxLogs,
                `msg-${overflow - maxLogs}`,
                `msg-${overflow - 1}`,
            ]);
        });
    });

    describe('createLoggerLayer', () => {
        it.prop([fc.integer({ max: 50, min: 5 })])('accumulates up to maxLogs', (maxLogs) => {
            const { layer, logs } = createLoggerLayer({ logLevel: 'Debug', maxLogs });

            Array.from({ length: maxLogs + 5 }, (_, i) => i).map((i) =>
                Effect.runSync(Effect.logInfo(`m-${i}`).pipe(Effect.provide(layer))),
            );

            expect(logs.length).toBe(maxLogs);
        });

        it.each([
            ['Debug', ['Debug', 'Info', 'Warning']],
            ['Info', ['Info', 'Warning']],
            ['Warning', ['Warning']],
        ] as const)('logLevel=%s filters correctly', (level, expectedLevels) => {
            const { layer, logs } = createLoggerLayer({ logLevel: level, maxLogs: 100 });

            Effect.runSync(Effect.logDebug('d').pipe(Effect.provide(layer)));
            Effect.runSync(Effect.logInfo('i').pipe(Effect.provide(layer)));
            Effect.runSync(Effect.logWarning('w').pipe(Effect.provide(layer)));

            expect(logs.map((l) => l.level)).toEqual(expectedLevels);
        });
    });

    describe('getLogs/getLogsFormatted/getLogsJson', () => {
        it.prop([fc.array(fc.string(), { maxLength: 10, minLength: 1 })])(
            'getLogs returns shallow copy',
            (messages) => {
                const logs = messages.map((m) => entry({ message: m }));
                const result = getLogs(logs);
                expect([result.length, result !== logs]).toEqual([logs.length, true]);
            },
        );

        it.prop([fc.array(fc.string(), { maxLength: 5, minLength: 2 })])(
            'getLogsFormatted joins with newlines',
            (messages) => {
                const logs = messages.map((m) => entry({ message: m }));
                const result = getLogsFormatted(logs);
                expect(result.split('\n').length).toBe(messages.length);
            },
        );

        it.prop([fc.array(fc.string(), { maxLength: 5, minLength: 1 })])(
            'getLogsJson produces valid JSON',
            (messages) => {
                const logs = messages.map((m) => entry({ message: m }));
                expect(() => JSON.parse(getLogsJson(logs))).not.toThrow();
            },
        );
    });

    describe('clearLogs', () => {
        it.prop([fc.integer({ max: 100, min: 0 })])('empties array of any size', (n) => {
            const logs = Array.from({ length: n }, (_, i) => entry({ message: `msg-${i}` }));
            clearLogs(logs);
            expect(logs).toHaveLength(0);
        });
    });

    describe('createCombinedLogger', () => {
        it.prop([fc.string({ minLength: 1 })])('accumulates messages', (message) => {
            const { logger, logs } = createCombinedLogger({ maxLogs: 100 });
            Effect.runSync(Effect.logInfo(message).pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))));
            expect(logs[0]?.message).toBe(message);
        });
    });

    describe('createHmrHandler', () => {
        it('clears logs and adds HMR message', () => {
            const { layer, logs } = createLoggerLayer();
            logs.push(entry({ message: 'existing' }));

            const handler = createHmrHandler(logs, layer);
            handler();

            expect([logs.length, logs[0]?.message?.includes('HMR')]).toEqual([1, true]);
        });
    });

    describe('installDevTools', () => {
        it('returns functional devtools object', () => {
            const { layer, logs } = createLoggerLayer();
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
            const { layer, logs } = createLoggerLayer();
            const dt = installDevTools({ env: 'test', loggerLayer: layer, logs, renderDebug: () => {}, startTime: 0 });
            expect(() => JSON.parse(dt.appGetLogsJson())).not.toThrow();
        });
    });
});
