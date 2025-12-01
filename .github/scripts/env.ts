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
    cs: { build: 'dotnet build', lint: 'dotnet format --verify-no-changes', test: 'dotnet test' },
    ts: { build: 'pnpm typecheck', lint: 'pnpm check', test: 'pnpm test' },
} as const)[ENV.lang];

// --- Export ------------------------------------------------------------------

export { CMD, ENV };
export type { Lang };
