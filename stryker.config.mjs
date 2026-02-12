// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
    // --- [CHECKERS] ----------------------------------------------------------
    checkers: ['typescript'],
    cleanTempDir: true,

    // --- [PERFORMANCE] -------------------------------------------------------
    concurrency: 4,
    htmlReporter: {
        fileName: 'test-results/mutation/index.html',
    },

    // --- [SANDBOX] -----------------------------------------------------------
    ignorePatterns: [
        'apps',
        'infrastructure',
        'dist',
        '.nx',
        '.git',
        'node_modules',
        'coverage',
        'test-results',
        '.stryker-tmp',
    ],

    // --- [MUTATE] ------------------------------------------------------------
    mutate: [
        'packages/server/src/**/*.ts',
        '!packages/server/src/**/*.spec.ts',
        '!packages/server/src/**/*.test.ts',
        '!packages/server/src/**/*.d.ts',
        '!packages/server/src/**/*.config.ts',
        '!packages/server/src/**/__tests__/**',
        '!packages/server/src/**/__mocks__/**',
    ],

    // --- [REPORTERS] ---------------------------------------------------------
    reporters: ['clear-text', 'html', 'progress'],
    tempDirName: '.stryker-tmp',
    // --- [TEST_RUNNER] -------------------------------------------------------
    testRunner: 'vitest',

    // --- [THRESHOLDS] --------------------------------------------------------
    thresholds: {
        break: 50,
        high: 80,
        low: 60,
    },
    timeoutFactor: 1.5,
    timeoutMS: 30_000,
    tsconfigFile: 'tsconfig.base.json',
    typescriptChecker: {
        prioritizePerformanceOverAccuracy: true,
    },
};

export default config;
