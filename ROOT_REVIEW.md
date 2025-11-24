# Root Review — Parametric Portal

## Scope
- Consolidated reading of root-level controls and standards to confirm bleeding-edge stack, Nx/biome enforcement, and path/plugin integration.
- Focused on ensuring aliasing (`@/*`), Vite/Vitest plugin stacks, and Nx defaults align with the monorepo factory patterns.

## Stack Snapshot (catalog-aligned)
- Requirements lock Node 25.2.1, pnpm 10.23.0, TypeScript 6.0.0-dev, React 19 canary, Vite 7.2.4, Vitest 4.0.13, Effect 3.19.6, Tailwind 4.1.17, LightningCSS 1.30.2, Biome 2.3.7, Nx 22.2.0-canary. 【F:REQUIREMENTS.md†L5-L22】
- Root package manifest references every dependency via `catalog:` to enforce the centralized versions. 【F:package.json†L7-L65】
- `.npmrc` pins engines, isolated linker, highest resolution, and frozen lockfile to prevent drift. 【F:.npmrc†L1-L24】

## Pathing and TypeScript Baseline
- `tsconfig.base.json` enables strict ESNext compilation, bundler resolution, and workspace aliases for `@/*`, `@theme/*`, and `@types/*`, backing the requested `@` import style across packages. 【F:tsconfig.base.json†L2-L43】
- Composite build and watch settings route tsbuildinfo to Nx cache for consistent incremental outputs. 【F:tsconfig.base.json†L6-L43】

## Nx Orchestration
- Nx installs bleeding-edge plugins (`@nx/js`, `@nx/react`, `@nx/vite`) and Crystal inference, with named inputs (`sharedGlobals`, `production`, `typescript`) tying targets to root configs. 【F:nx.json†L5-L38】
- Target defaults standardize outputs (`dist`/`coverage`) and cache behavior for build/test/typecheck/check plus a `pwa:icons` command via `tsx`, aligning with monorepo expectations. 【F:nx.json†L53-L85】

## Vite Integration (Factory-First)
- Root Vite config builds frozen constants (browser targets, chunk/asset patterns, PWA manifest/workbox, SVGR, SSR) through `Effect.runSync(Effect.all(...))`, enforcing LightningCSS-only CSS and React compiler wiring. 【F:vite.config.ts†L28-L168】
- `createAllPlugins` centralizes plugins: tsconfig paths, React 19 compiler, Tailwind v4, PWA, SVGR, image optimizer, compression, custom build hooks, Inspect, plus worker reuse. 【F:vite.config.ts†L299-L329】
- `createAppConfig` keeps manifest/SSR manifests on, esbuild purity/drop targets, alias `@` -> `/packages`, warmup, and worker chunk strategies for monorepo apps. 【F:vite.config.ts†L331-L459】
- `createLibraryConfig` wraps rollup TypeScript output with LightningCSS targets and aliasing, matching library builds to the same browser baselines. 【F:vite.config.ts†L197-L253】

## Vitest Integration
- Vitest config reuses Vite via `mergeConfig`, freezing coverage thresholds/reporters and test patterns while defaulting to happy-dom, Vitest UI, and Playwright-disabled browser mode. 【F:vitest.config.ts†L9-L120】
- Coverage directories follow Nx output conventions (`{project}/coverage`) to stay cache-aligned. 【F:vitest.config.ts†L57-L113】

## Biome Guardrails
- Biome enforces no default exports (except configs), no `any`, no loops/forEach, complexity ≤10, exhaustive deps/switch, naming conventions, and sorted imports/keys; overrides keep config defaults but retain strictness for package sources. 【F:biome.json†L2-L141】

## Findings
- Root layer already integrates the bleeding-edge toolchain, path aliases, Nx defaults, and plugin stacks requested. No additional rollup/ts-path wiring gaps observed at the root level.
