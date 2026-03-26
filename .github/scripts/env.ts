#!/usr/bin/env tsx
/**
 * Environment config: language-specific build commands and external service IDs.
 * Standalone module, no schema.ts dependencies.
 */
declare const process: { readonly env: Record<string, string | undefined> };

// --- Types -------------------------------------------------------------------

// --- Constants ---------------------------------------------------------------

const ENV = {
    // Nx Cloud workspace ID - fallback must match nx.json nxCloudId
    nxCloudWorkspaceId: process.env.NX_CLOUD_WORKSPACE_ID ?? '6929c006315634b45342f623',
} as const;

// --- Export ------------------------------------------------------------------

export { ENV };
