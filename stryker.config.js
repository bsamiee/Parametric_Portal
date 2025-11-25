// @ts-check
// --- Stryker Mutation Testing Configuration ----------------------------------
// NOTE: Minimal config - only options WITHOUT CLI support live here.
// CLI-capable options are in nx.json targetDefaults.mutate for visibility.
// See: https://stryker-mutator.io/docs/stryker-js/configuration/

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
    // Required: no CLI support for nested object configs
    packageManager: 'pnpm',
    thresholds: { break: 50, high: 80, low: 60 },
    vitest: { configFile: 'vitest.config.ts' },
};
