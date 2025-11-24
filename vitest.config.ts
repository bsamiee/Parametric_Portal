/// <reference types="vitest/config" />
import { Effect, pipe } from 'effect';
import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

// --- Constants (Unified Factory → Frozen) ------------------------------------

const { coverage, patterns, reporters } = Effect.runSync(
    Effect.all({
        coverage: Effect.succeed({ branches: 80, functions: 80, lines: 80, statements: 80 }),
        patterns: Effect.all({
            benchInclude: Effect.succeed(['**/*.bench.{ts,tsx}']),
            coverageExclude: Effect.succeed([
                '**/*.config.*',
                '**/*.d.ts',
                '**/__mocks__/**',
                '**/__tests__/**',
                '**/dist/**',
                '**/node_modules/**',
                '**/test/**',
            ]),
            testExclude: Effect.succeed(['**/*.e2e.{test,spec}.{ts,tsx}', '**/node_modules/**', '**/dist/**']),
            testInclude: Effect.succeed(['**/*.{test,spec}.{ts,tsx}']),
        }),
        reporters: Effect.all({
            coverage: Effect.succeed(['text', 'json', 'html', 'lcov']),
            test: Effect.succeed(['default', 'html', 'json', 'junit']),
        }),
    }),
);

const COVERAGE_THRESHOLDS = Object.freeze(coverage);
const COVERAGE_EXCLUDE_PATTERNS = Object.freeze(patterns.coverageExclude);
const TEST_EXCLUDE_PATTERNS = Object.freeze(patterns.testExclude);
const TEST_INCLUDE_PATTERNS = Object.freeze(patterns.testInclude);
const BENCHMARK_INCLUDE_PATTERNS = Object.freeze(patterns.benchInclude);
const COVERAGE_REPORTERS = Object.freeze(reporters.coverage);
const TEST_REPORTERS = Object.freeze(reporters.test);

// --- Effect Pipelines & Builders ---------------------------------------------

const createVitestConfig = () =>
    pipe(
        Effect.succeed({
            test: {
                benchmark: {
                    exclude: [...TEST_EXCLUDE_PATTERNS],
                    include: [...BENCHMARK_INCLUDE_PATTERNS],
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
                    exclude: [...COVERAGE_EXCLUDE_PATTERNS],
                    extension: ['.ts', '.tsx'],
                    ignoreEmptyLines: true,
                    provider: 'v8' as const,
                    reporter: [...COVERAGE_REPORTERS],
                    reportOnFailure: true,
                    reportsDirectory: process.env.NX_TASK_TARGET_PROJECT
                        ? `${process.env.NX_TASK_TARGET_PROJECT}/coverage`
                        : 'coverage',
                    skipFull: false,
                    thresholds: { ...COVERAGE_THRESHOLDS },
                },
                environment: 'happy-dom' as const,
                exclude: [...TEST_EXCLUDE_PATTERNS],
                globals: true,
                include: [...TEST_INCLUDE_PATTERNS],
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
                            include: [...TEST_INCLUDE_PATTERNS],
                            name: 'unit',
                        },
                    },
                ],
                reporters: [...TEST_REPORTERS],
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
                ui: true,
                unstubEnvs: true,
                unstubGlobals: true,
            },
        }),
    );

// --- Export ------------------------------------------------------------------

export default mergeConfig(viteConfig, defineConfig(Effect.runSync(createVitestConfig())));
