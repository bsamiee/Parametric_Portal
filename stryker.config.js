// --- [STRYKER_CONFIG] --------------------------------------------------------
// CLI-capable options (--incremental, --testRunner, --mutate, --ignorePatterns,
// --reporters, --concurrency, --coverageAnalysis) live in nx.json mutate target.

export default {
    disableTypeChecks: '{src,packages}/**/*.{ts,tsx}',
    htmlReporter: { fileName: 'reports/stryker/mutation-report.html' },

    // --- [PERFORMANCE] -------------------------------------------------------
    ignoreStatic: true,

    // --- [OUTPUT_PATHS] ------------------------------------------------------
    incrementalFile: '.nx/cache/stryker-incremental.json',
    jsonReporter: { fileName: 'reports/stryker/mutation-report.json' },
    maxTestRunnerReuse: 50,

    // --- [CORE] --------------------------------------------------------------
    packageManager: 'pnpm',
    thresholds: { break: 80, high: 90, low: 70 },
    vitest: { configFile: 'vitest.config.ts' },
};
