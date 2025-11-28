#!/usr/bin/env tsx
/**
 * Environment-driven configuration for repository-agnostic infrastructure.
 * Minimal ENV: only truly repo-specific values (lang for build commands, bundleThresholdKb for JS projects).
 */

declare const process: { readonly env: Record<string, string | undefined> };

// --- Type Definitions -------------------------------------------------------

type Lang = 'ts' | 'cs';

// --- Helpers ----------------------------------------------------------------

const num = (v: string | undefined, def: number): number => (v ? Number(v) : def);

// --- Environment Config -----------------------------------------------------

const ENV = Object.freeze({
    bundleThresholdKb: num(process.env.BUNDLE_THRESHOLD_KB, 10),
    lang: (process.env.REPO_LANG ?? 'ts') as Lang,
} as const);

// --- Language Commands (for workflow prompts) -------------------------------

const CMD = Object.freeze({
    cs: { build: 'dotnet build', lint: 'dotnet format --verify-no-changes', test: 'dotnet test' },
    ts: { build: 'pnpm typecheck', lint: 'pnpm check', test: 'pnpm test' },
} as const)[ENV.lang];

// --- Export -----------------------------------------------------------------

export { CMD, ENV };
export type { Lang };
