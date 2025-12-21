/// <reference types="vitest/config" />
/**
 * Vitest configuration: define test patterns, coverage thresholds, and reporters.
 * Uses B constant for centralized configuration, createVitestConfig factory.
 */
import { Effect, pipe } from 'effect';
import { defineConfig, mergeConfig } from 'vitest/config';
import { createConfig } from './vite.factory.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    patterns: {
        benchInclude: ['**/*.bench.{ts,tsx}'],
        coverageExclude: [
            '**/*.config.*',
            '**/*.d.ts',
            '**/__mocks__/**',
            '**/__tests__/**',
            '**/dist/**',
            '**/node_modules/**',
            '**/test/**',
        ],
        testExclude: ['**/*.e2e.{test,spec}.{ts,tsx}', '**/node_modules/**', '**/dist/**'],
        testInclude: ['**/*.{test,spec}.{ts,tsx}'],
    },
    reporters: {
        coverage: ['text', 'json', 'html', 'lcov'],
        test: ['default', 'json', 'junit'],
    },
    thresholds: { branches: 80, functions: 80, lines: 80, statements: 80 },
} as const);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const createVitestConfig = () =>
    pipe(
        Effect.succeed({
            test: {
                benchmark: {
                    exclude: [...B.patterns.testExclude],
                    include: [...B.patterns.benchInclude],
                },
                browser: {
                    enabled: false,
                    headless: true,
                    name: 'chromium' as const,
                },
                coverage: {
                    clean: true,
                    cleanOnRerun: true,
                    enabled: false,
                    exclude: [...B.patterns.coverageExclude],
                    extension: ['.ts', '.tsx'],
                    ignoreEmptyLines: true,
                    provider: 'v8' as const,
                    reporter: [...B.reporters.coverage],
                    reportOnFailure: true,
                    reportsDirectory: process.env.NX_TASK_TARGET_PROJECT
                        ? `${process.env.NX_TASK_TARGET_PROJECT}/coverage`
                        : 'coverage',
                    skipFull: false,
                    thresholds: { ...B.thresholds },
                },
                environment: 'happy-dom' as const,
                exclude: [...B.patterns.testExclude],
                globals: true,
                include: [...B.patterns.testInclude],
                mockReset: true,
                pool: 'threads' as const,
                poolOptions: {
                    threads: {
                        isolate: true,
                        singleThread: false,
                    },
                },
                projects: [
                    {
                        test: {
                            environment: 'happy-dom' as const,
                            include: [...B.patterns.testInclude],
                            name: 'unit',
                        },
                    },
                ],
                reporters: [...B.reporters.test],
                restoreMocks: true,
                retry: 0,
                sequence: {
                    concurrent: false,
                    hooks: 'stack' as const,
                    shuffle: false,
                },
                setupFiles: [],
                slowTestThreshold: 5000,
                testTimeout: 10000,
                typecheck: {
                    checker: 'tsc' as const,
                    enabled: false,
                    ignoreSourceErrors: false,
                    include: ['**/*.{test,spec}-d.{ts,tsx}'],
                    tsconfig: './tsconfig.base.json',
                },
                ui: false,
                unstubEnvs: true,
                unstubGlobals: true,
            },
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

const viteConfig = Effect.runSync(
    createConfig({
        mode: 'app',
        name: 'VitestRunner',
    }),
);

export default mergeConfig(viteConfig, defineConfig(Effect.runSync(createVitestConfig())));
