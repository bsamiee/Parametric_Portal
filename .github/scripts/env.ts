#!/usr/bin/env tsx
/**
 * Environment config: language-specific build commands and external service IDs.
 * Standalone module, no schema.ts dependencies.
 */
declare const process: { readonly env: Record<string, string | undefined> };

// --- Types -------------------------------------------------------------------

type Lang = 'ts' | 'cs';

// --- Constants ---------------------------------------------------------------

const ENV = Object.freeze({
    lang: (process.env.REPO_LANG ?? 'ts') as Lang,
    // Nx Cloud workspace ID - fallback must match nx.json nxCloudId
    nxCloudWorkspaceId: process.env.NX_CLOUD_WORKSPACE_ID ?? '6929c006315634b45342f623',
} as const);

// --- Pure Functions ----------------------------------------------------------

const CMD = Object.freeze({
    cs: {
        build: 'nx run-many -t build:cs',
        lint: "find apps -name '*.csproj' -exec env -u DOTNET_ROOT dotnet format --verify-no-changes {} \\;",
        test: 'nx run-many -t test:cs',
    },
    ts: { build: 'nx run-many -t typecheck', lint: 'nx run-many -t check', test: 'nx run-many -t test' },
} as const)[ENV.lang];

// --- Export ------------------------------------------------------------------

export { CMD, ENV };
export type { Lang };
