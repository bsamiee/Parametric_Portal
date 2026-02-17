import { cpus } from 'node:os';

const config = {
    checkerNodeArgs: ['--max-old-space-size=4096'],
    // --- [CHECKERS] ----------------------------------------------------------
    checkers: ['typescript'],
    cleanTempDir: true,
    clearTextReporter: {
        allowEmojis: false,
        logTests: false,
        maxTestsToLog: 0,
        reportMutants: false,
        reportScoreTable: true,
        skipFull: true,
    },
    // --- [PERFORMANCE] -------------------------------------------------------
    concurrency: Math.max(cpus().length - 1, 2),
    disableTypeChecks: false,
    dryRunTimeoutMinutes: 10,
    htmlReporter: {
        fileName: 'test-results/mutation/index.html',
    },
    ignorePatterns: ['dist', '.nx', '.git', 'node_modules', 'coverage', 'test-results', '.stryker-tmp'],
    ignoreStatic: true,
    incremental: true,
    incrementalFile: 'test-results/mutation/stryker-incremental.json',
    jsonReporter: { fileName: 'test-results/mutation/mutation.json' },
    // --- [SANDBOX] -----------------------------------------------------------
    logLevel: 'info',
    // --- [MUTATE] ------------------------------------------------------------
    mutate: [
        'packages/server/src/**/*.ts',
        'packages/database/src/**/*.ts',
        'apps/api/src/**/*.ts',
        '!apps/api/src/routes/**/*.ts',
    ],
    mutator: { excludedMutations: ['UpdateOperator', 'OptionalChaining'] },
    // --- [REPORTERS] ---------------------------------------------------------
    plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
    reporters: ['clear-text', 'html', 'json', 'progress'],
    tempDirName: '.stryker-tmp',
    // --- [TEST_RUNNER] -------------------------------------------------------
    testFiles: ['tests/**/*.spec.ts', '!tests/e2e/**'],
    testRunner: 'vitest',
    testRunnerNodeArgs: ['--max-old-space-size=4096'],
    // --- [THRESHOLDS] --------------------------------------------------------
    thresholds: {
        break: 50,
        high: 80,
        low: 60,
    },
    timeoutFactor: 1.5,
    timeoutMS: 10_000,
    tsconfigFile: 'tsconfig.base.json',
    typescriptChecker: {
        prioritizePerformanceOverAccuracy: true,
    },
    vitest: {
        related: false,
    },
    warnings: {
        slow: false,
    },
};

export default config;
