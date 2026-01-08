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

const B = Object.freeze({
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
    optimizeDeps: ['@effect/vitest', '@fast-check/vitest', 'effect', 'fast-check'],
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
            '**/dist/**',
            '**/node_modules/**',
            '**/test/**',
            '**/tests/**',
        ],
        coverageInclude: ['packages/runtime/src/**/*.{ts,tsx}', 'packages/test-utils/src/**/*.{ts,tsx}'],
        testExclude: ['**/*.e2e.{test,spec}.{ts,tsx}', '**/node_modules/**', '**/dist/**'],
        testInclude: ['tests/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    },
    reporters: {
        coverage: ['text', 'json', 'html', 'lcov'] as const,
        test: (process.env.CI
            ? ['dot', 'json', 'junit', 'github-actions', 'blob']
            : ['default', 'json', 'junit']) as readonly string[],
    },
    setupFiles: ['@parametric-portal/test-utils/setup'],
    snapshot: { format: { printBasicPrototype: false } },
    timeouts: { hook: 10_000, slow: 5_000, test: 10_000 },
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export default defineConfig({
    cacheDir: B.cacheDir,
    optimizeDeps: { include: [...B.optimizeDeps] },
    test: {
        allowOnly: process.env.CI !== 'true',
        benchmark: { exclude: ['**/node_modules/**', '**/dist/**'], include: [...B.patterns.benchInclude] },
        chaiConfig: { ...B.output.chaiConfig },
        clearMocks: true,
        coverage: {
            clean: true,
            cleanOnRerun: true,
            enabled: false,
            exclude: [...B.patterns.coverageExclude],
            include: [...B.patterns.coverageInclude],
            provider: 'v8',
            reporter: [...B.reporters.coverage],
            reportOnFailure: true,
            reportsDirectory: path.resolve(Dirname, 'coverage'),
            skipFull: false,
            // Thresholds disabled for fast-moving early development - re-enable when stabilized
        },
        deps: { ...B.deps },
        diff: { ...B.output.diff },
        exclude: [...B.patterns.testExclude],
        fakeTimers: { ...B.fakeTimers, toFake: [...B.fakeTimers.toFake] },
        fileParallelism: true,
        globals: true,
        hookTimeout: B.timeouts.hook,
        include: [...B.patterns.testInclude],
        isolate: true,
        mockReset: true,
        onConsoleLog: (log, type) => !log.includes('Download the React DevTools') && type !== 'stderr',
        outputFile: { ...B.output.outputFile },
        passWithNoTests: false,
        pool: 'threads',
        printConsoleTrace: true,
        projects: [
            {
                extends: true,
                test: {
                    environment: 'node',
                    exclude: ['packages/runtime/**'],
                    include: ['packages/*/tests/**/*.spec.ts'],
                    name: 'packages-node',
                    root: Dirname,
                },
            },
            {
                test: {
                    browser: {
                        enabled: true,
                        expect: B.browser.expect,
                        headless: B.browser.headless,
                        instances: [{ browser: 'chromium' }],
                        provider: B.browser.provider,
                        screenshotDirectory: B.browser.screenshotDirectory,
                        screenshotFailures: true,
                        trace: B.browser.trace,
                        viewport: B.browser.viewport,
                    },
                    include: ['packages/runtime/tests/**/*.spec.ts'],
                    name: 'runtime-browser',
                    root: Dirname,
                    setupFiles: [path.resolve(Dirname, 'packages/test-utils/src/setup.ts')],
                },
            },
            {
                extends: true,
                test: {
                    environment: 'jsdom',
                    include: ['apps/*/tests/**/*.spec.ts'],
                    name: 'apps',
                    root: Dirname,
                },
            },
        ],
        reporters: [...B.reporters.test],
        restoreMocks: true,
        retry: process.env.CI ? 2 : 0,
        sequence: { concurrent: false, hooks: 'stack', shuffle: false },
        setupFiles: [...B.setupFiles],
        slowTestThreshold: B.timeouts.slow,
        snapshotFormat: { ...B.snapshot.format },
        testTimeout: B.timeouts.test,
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

export { B as VITEST_TUNING };
