/// <reference types="vitest/config" />
/**
 * Root Vitest: unified config with explicit inline projects for workspace.
 * Child packages do NOT need vitest.config.ts when using inline projects pattern.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const Dirname = path.dirname(fileURLToPath(import.meta.url));

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
    browser: {
        expect: {
            toMatchScreenshot: {
                comparatorName: 'pixelmatch' as const,
                comparatorOptions: {
                    allowedMismatchedPixelRatio: 0.01,
                    threshold: 0.2,
                },
            },
        },
        headless: true,
        provider: playwright({
            actionTimeout: 5_000,
            contextOptions: {
                colorScheme: 'light',
                locale: 'en-US',
                permissions: ['clipboard-read', 'clipboard-write'],
                timezoneId: 'America/Los_Angeles',
            },
            launchOptions: {
                args: ['--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
            },
        }),
        screenshotDirectory: path.resolve(Dirname, 'test-results/screenshots'),
        trace: {
            mode: 'retain-on-failure' as const,
            screenshots: true,
            snapshots: true,
            tracesDir: path.resolve(Dirname, 'test-results/traces'),
        },
        viewport: { height: 720, width: 1280 },
    },
    cacheDir: 'node_modules/.vitest',
    deps: { interopDefault: true },
    fakeTimers: {
        loopLimit: 10_000,
        shouldClearNativeTimers: true,
        toFake: ['setTimeout', 'setInterval', 'Date', 'performance'] as const,
    },
    optimizeDeps: ['@effect/vitest', 'rfc6902', 'effect', 'fast-check'],
    output: {
        chaiConfig: { includeStack: true, showDiff: true, truncateThreshold: 0 },
        diff: { expand: true, truncateThreshold: 0 },
        outputFile: {
            blob: path.resolve(Dirname, 'test-results/.vitest-reports'),
            json: path.resolve(Dirname, 'test-results/results.json'),
            junit: path.resolve(Dirname, 'test-results/junit.xml'),
        },
    },
    patterns: {
        benchInclude: ['**/*.bench.{ts,tsx}'],
        coverageExclude: [
            '**/*.config.*',
            '**/*.d.ts',
            '**/__mocks__/**',
            '**/__tests__/**',
            '**/.stryker-tmp/**',
            '**/dist/**',
            '**/node_modules/**',
            '**/test/**',
            '**/tests/**',
            'apps/docs/**',
            'apps/portal/**',
            'apps/test-harness/**',
            'packages/ai/**',
            'packages/components/**',
            'packages/components-next/**',
            'packages/devtools/**',
            'packages/runtime/**',
            'packages/theme/**',
            'packages/types/**',
        ],
        coverageInclude: ['apps/**/src/**/*.{ts,tsx}', 'packages/**/src/**/*.{ts,tsx}'],
        testExclude: [
            '**/*.e2e.{test,spec}.{ts,tsx}',
            '**/node_modules/**',
            '**/dist/**',
            '**/.stryker-tmp/**',
            'tests/.stryker-tmp/**',
            'tests/e2e/**',
        ],
        testInclude: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    },
    reporters: {
        coverage: ['text', 'json', 'json-summary', 'html', 'lcov'] as const,
        test: (process.env['CI'] ? ['dot', 'json', 'junit', 'github-actions', 'blob'] : ['tree']) as readonly string[],
    },
    setupFiles: [],
    snapshot: { format: { printBasicPrototype: false } },
    timeouts: { hook: 10_000, slow: 5_000, test: 10_000 },
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig({
    cacheDir: _CONFIG.cacheDir,
    optimizeDeps: { include: [..._CONFIG.optimizeDeps] },
    test: {
        allowOnly: process.env['CI'] !== 'true',
        benchmark: { exclude: ['**/node_modules/**', '**/dist/**'], include: [..._CONFIG.patterns.benchInclude] },
        chaiConfig: { ..._CONFIG.output.chaiConfig },
        coverage: {
            clean: true,
            cleanOnRerun: true,
            enabled: false,
            exclude: [..._CONFIG.patterns.coverageExclude],
            include: [..._CONFIG.patterns.coverageInclude],
            provider: 'v8',
            reporter: [..._CONFIG.reporters.coverage],
            reportOnFailure: true,
            reportsDirectory: path.resolve(Dirname, 'coverage'),
            skipFull: true,
            thresholds: {
                branches: 95,
                functions: 95,
                lines: 95,
                perFile: false,
                statements: 95,
            },
        },
        deps: { ..._CONFIG.deps },
        diff: { ..._CONFIG.output.diff },
        exclude: [..._CONFIG.patterns.testExclude],
        fakeTimers: { ..._CONFIG.fakeTimers, toFake: [..._CONFIG.fakeTimers.toFake] },
        fileParallelism: true,
        forceRerunTriggers: ['**/package.json/**', '**/vitest.config.*/**', '**/tsconfig*.json', 'tests/setup.ts'],
        globals: true,
        hideSkippedTests: process.env['CI'] === 'true',
        hookTimeout: _CONFIG.timeouts.hook,
        include: [..._CONFIG.patterns.testInclude],
        isolate: true,
        onConsoleLog: (log, type) => !log.includes('Download the React DevTools') && type !== 'stderr',
        outputFile: { ..._CONFIG.output.outputFile },
        passWithNoTests: false,
        pool: 'threads',
        printConsoleTrace: false,
        projects: [
            {
                extends: true,
                test: {
                    environment: 'node',
                    exclude: ['tests/.stryker-tmp/**', 'tests/e2e/**'],
                    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
                    name: 'root-tests',
                    root: Dirname,
                    setupFiles: [path.resolve(Dirname, 'tests/setup.ts')],
                },
            },
            {
                extends: true,
                test: {
                    environment: 'node',
                    exclude: ['packages/runtime/**'],
                    include: ['packages/*/tests/**/*.spec.ts'],
                    name: 'packages-node',
                    root: Dirname,
                    setupFiles: [path.resolve(Dirname, 'tests/setup.ts')],
                },
            },
            {
                test: {
                    browser: {
                        enabled: true,
                        expect: _CONFIG.browser.expect,
                        headless: _CONFIG.browser.headless,
                        instances: [{ browser: 'chromium' }],
                        provider: _CONFIG.browser.provider,
                        screenshotDirectory: _CONFIG.browser.screenshotDirectory,
                        screenshotFailures: true,
                        trace: _CONFIG.browser.trace,
                        viewport: _CONFIG.browser.viewport,
                    },
                    include: ['packages/runtime/tests/**/*.spec.ts'],
                    name: 'runtime-browser',
                    root: Dirname,
                    setupFiles: [path.resolve(Dirname, 'tests/setup.ts')],
                },
            },
            {
                extends: true,
                test: {
                    environment: 'jsdom',
                    include: ['apps/*/tests/**/*.spec.ts'],
                    name: 'apps',
                    root: Dirname,
                    setupFiles: [path.resolve(Dirname, 'tests/setup.ts')],
                },
            },
        ],
        reporters: [..._CONFIG.reporters.test],
        restoreMocks: true,
        retry: process.env['CI'] ? 2 : 0,
        sequence: { concurrent: false, hooks: 'stack', shuffle: process.env['CI'] === 'true' },
        setupFiles: [],
        silent: 'passed-only',
        slowTestThreshold: _CONFIG.timeouts.slow,
        snapshotFormat: { ..._CONFIG.snapshot.format },
        testTimeout: _CONFIG.timeouts.test,
        typecheck: {
            checker: 'tsc',
            enabled: false,
            ignoreSourceErrors: false,
            include: ['**/*.{test,spec}-d.{ts,tsx}'],
            tsconfig: './tsconfig.base.json',
        },
        unstubEnvs: true,
        unstubGlobals: true,
    },
});

export { _CONFIG as VITEST_TUNING };
