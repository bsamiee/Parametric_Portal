---
paths: ["**/*.ts", "**/*.tsx", "**/package.json"]
---

# Dependency Catalog & Process

## Installation

1. Add to `pnpm-workspace.yaml` catalog (exact version, no ranges)
2. Reference in package.json: `"<dep>": "catalog:"`
3. `pnpm install`

Never pin versions in individual `package.json` when a catalog entry exists. Validation via CI — typecheck gates merge.

## Core Effect Ecosystem

`@effect/sql` (Model/SqlClient/SqlResolver for batched queries), `@effect/platform` (HttpApi/HttpApiGroup/HttpApiEndpoint/HttpClient/FileSystem), `@effect/cluster` (Entity/Sharding for distributed actors), `@effect/opentelemetry` (NodeSdk/Otlp unified layer for traces+metrics+logs), `@effect/rpc` (Rpc/RpcGroup), `@effect/workflow` (Workflow/Activity), `@effect/ai` (AiChat), `@effect/experimental` (Machine/VariantSchema)

Before hand-rolling any infrastructure (batching, caching, HTTP client, file IO, telemetry, RPC, state machines), verify it does not already exist in these packages.

## Type Utilities

`ts-essentials` (XOR, DeepReadonly), `type-fest` (Simplify at public API boundaries only). `ts-toolbelt` quarantined in `types/internal/` — internal-only to prevent compile-time bloat and re-export surface pollution.

## Stack Versions

TypeScript 6.0, React 19, Vite 7, Effect 3.19, Nx 22 Crystal. Research docs must be <=6 months old before implementing against any dependency.
