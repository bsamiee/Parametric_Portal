/**
 * Validate environment schema parsing and error boundary behavior.
 */
/* biome-ignore-all lint/style/useNamingConvention: Environment variables use SCREAMING_CASE */
import { it } from '@fast-check/vitest';
import { Effect, Exit } from 'effect';
import fc from 'fast-check';
import { describe, expect } from 'vitest';
import { createEnv, createEnvSync, ENV_TUNING, EnvValidationError } from '../src/env.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    levels: ['Debug', 'Info', 'Warning', 'Error'] as const,
    required: ['MODE', 'BASE_URL'] as const,
} as const);

const validEnv = (overrides: Record<string, unknown> = {}) =>
    ({ BASE_URL: '/', DEV: true, MODE: 'development', PROD: false, ...overrides }) as Record<string, unknown>;

// --- [TESTS] -----------------------------------------------------------------

describe('env', () => {
    describe('createEnvSync', () => {
        it('applies defaults for optional fields', () => {
            const result = createEnvSync(validEnv());
            expect([
                result.VITE_DEVTOOLS_CONSOLE,
                result.VITE_DEVTOOLS_LOG_LEVEL,
                result.VITE_DEVTOOLS_EXPERIMENTAL,
            ]).toEqual([
                ENV_TUNING.defaults.devtools.console,
                ENV_TUNING.defaults.devtools.logLevel,
                ENV_TUNING.defaults.devtools.experimental,
            ]);
        });

        it.each(B.levels)('preserves explicit VITE_DEVTOOLS_LOG_LEVEL=%s', (level) => {
            expect(createEnvSync(validEnv({ VITE_DEVTOOLS_LOG_LEVEL: level })).VITE_DEVTOOLS_LOG_LEVEL).toBe(level);
        });

        it.each(['true', 'false'] as const)('preserves VITE_DEVTOOLS_CONSOLE=%s', (value) => {
            expect(createEnvSync(validEnv({ VITE_DEVTOOLS_CONSOLE: value })).VITE_DEVTOOLS_CONSOLE).toBe(value);
        });

        it.each(B.required)('throws when %s missing', (field) => {
            const { [field]: _, ...partial } = validEnv();
            expect(() => createEnvSync(partial)).toThrow();
        });

        it.prop([fc.string().filter((s) => !B.levels.includes(s as (typeof B.levels)[number]))])(
            'throws for invalid log level',
            (level) => {
                expect(() => createEnvSync(validEnv({ VITE_DEVTOOLS_LOG_LEVEL: level }))).toThrow();
            },
        );
    });

    describe('createEnv', () => {
        it('returns Effect success for valid env', async () => {
            const exit = await Effect.runPromiseExit(createEnv(validEnv()));
            expect(Exit.isSuccess(exit)).toBe(true);
            Exit.isSuccess(exit) && expect(exit.value.MODE).toBe('development');
        });

        it('returns Effect failure for invalid env', async () => {
            const exit = await Effect.runPromiseExit(createEnv({}));
            expect(Exit.isFailure(exit)).toBe(true);
        });

        it.prop([fc.constantFrom(...B.levels)])('Effect success preserves log level', async (level) => {
            const exit = await Effect.runPromiseExit(createEnv(validEnv({ VITE_DEVTOOLS_LOG_LEVEL: level })));
            Exit.isSuccess(exit) && expect(exit.value.VITE_DEVTOOLS_LOG_LEVEL).toBe(level);
        });
    });

    describe('EnvValidationError', () => {
        it.prop([fc.string()])('extracts message from string cause', (msg) => {
            const error = new EnvValidationError(msg);
            expect([error.message, error._tag]).toEqual([msg, 'EnvValidationError']);
        });

        it('extracts message from Error cause', () => {
            const cause = new Error('inner error');
            expect(new EnvValidationError(cause).message).toBe('inner error');
        });

        it.each([
            [42, '42'],
            [null, 'null'],
            [undefined, 'undefined'],
            [true, 'true'],
            [{ toString: () => 'custom' }, 'custom'],
            [['a', 'b'], 'a,b'],
        ])('stringifies %p to %s', (cause, expected) => {
            expect(new EnvValidationError(cause).message).toBe(expected);
        });
    });
});
