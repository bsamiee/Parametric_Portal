// --- [STRYKER_CONFIG] --------------------------------------------------------
// NOTE: Minimal config - only options WITHOUT CLI support live here.
// CLI-capable options are in nx.json targetDefaults.mutate for visibility.

export default {
    packageManager: 'pnpm',
    thresholds: { break: 50, high: 80, low: 60 },
    vitest: { configFile: 'vitest.config.ts' },
};
