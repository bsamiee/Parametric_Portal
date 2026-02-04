---
name: ts-standards
description: Enforce Parametric Portal TypeScript/Effect standards and functional style. Use for any TypeScript coding, refactoring, review, or design task in any repository. Apply Parametric Portal-specific rules when working in that monorepo.
---

# TS Standards

## Overview

Enforce a dense, functional, Effect-first TypeScript style with minimal exports, algorithmic derivation, and maximum use of external libraries.

## Non-negotiables

- No imperative statements: no `if`, `for`, `while`, `try/catch`, `let`, `var`.
- Use `Match`, `Option`, `Either`, `Effect`, `Stream`, `Schedule`, and `Effect.iterate` for control flow.
- Avoid `any` and ad-hoc casts; derive types from schemas, tables, or library types.
- Avoid wrappers, redundant aliases, and indirection; import official library objects directly.
- Avoid helpers until after implementation proves duplication; if needed, consolidate into one namespace object.
- Prefix all private/internal values with `_`.
- Avoid default exports, inline exports, and barrel files; export via a dedicated `[EXPORT]` section.
- Use comments only to explain "why", never "what".

## API Shape

- Expose one primary export per file (max three).
- Provide unified polymorphic APIs; one function handles single and batch inputs.
- Preserve input shape on output; do not split APIs into `get/getMany` or `emit/emitBatch`.
- Prefer callable objects via `Object.assign` when a function needs attached metadata.

## Types, Schemas, Constants

- Derive types from schemas/tables (e.g., `type X = S.Schema.Type<typeof XSchema>`).
- Use `S.Class` and `S.TaggedError` for schema-coupled classes and errors.
- Inline types/consts to strengthen inference; avoid type/const spam.
- Use a dense tuning object (`_CONFIG`, `Tuning`, `limits`) with `as const` and `satisfies` instead of scattered literals.
- Use `as const` and `satisfies` to preserve literals and avoid redundant aliases.

## Effect Patterns

- Compose with `pipe`, `Effect.map`, `Effect.flatMap`, `Effect.andThen`, `Effect.tap`, `Effect.gen`, `Effect.fn`.
- Use `Data.TaggedError` or `Data.taggedEnum` for error ADTs not tied to Schema.
- Use `Context.Tag` or `Effect.Service` for services and `Layer.*` for wiring.
- Use `Match.value(...).pipe(Match.when/Match.tag/Match.orElse/Match.exhaustive)` for branching.
- Use dispatch tables for variants; ternary only for binary cases.
- Prefer `Effect.tryPromise`, `Effect.promise`, `Either.try` instead of `try/catch`.


## Libraries and Imports

- Always use explicit imports; never rely on implicit globals or re-exported wrappers.
- Prefer canonical sources: core types/utilities from `effect`, platform features from `@effect/platform*`, data access from `@effect/sql*`, tracing from `@effect/opentelemetry`.
- Available libraries (catalog): `effect`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@effect-aws/client-s3`, `@effect/cli`, `@effect/cluster`, `@effect/experimental`, `@effect/opentelemetry`, `@effect/platform`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/printer`, `@effect/printer-ansi`, `@effect/rpc`, `@effect/sql`, `@effect/sql-pg`, `@effect/workflow`.
- Common `effect` imports to consider for consistency: `Match`, `Duration`, `Layer`, `Option`, `Order`, `pipe`, `Record`, `Schedule`, `Schema as S`, `Metric`, `Redacted`, `Data`, `Effect`, `FiberId`, `FiberRef`, `Array as A`, `Chunk`, `Clock`, `Either`, `Stream`, `STM`, `TMap`, `Encoding`, `Number as N`, `Cache`, `Config`, `HashMap`, `HashSet`, `Predicate`, `Function as F`, `Scope`, `Cause`.
- Import `constant` and `dual` from `effect/Function` when needed; avoid redefining them.
- Always check these libraries before hand-rolling utilities.

## Platform Integration (Parametric Portal)

- Always use `packages/server/src/platform/cache.ts` for caching. Do not roll custom cache or bypass cache layer.
- Always use `packages/server/src/utils/resilience.ts` for retry, circuit, bulkhead, timeout, hedge, or memoization.
- Always integrate `packages/server/src/observe/telemetry.ts` for tracing. Prefer `Telemetry.span` and `MetricsService.trackEffect` over `Effect.fn`.
- Always integrate `packages/server/src/observe/metrics.ts` for metrics. Prefer domain-specific metrics (for example cluster metrics) and fall back to generic metrics only when needed.
- Always respect request context. Read and follow `packages/server/src/context.ts` and `packages/server/src/middleware.ts` patterns for headers, cookies, auth, tenant scoping, and request metadata. Assume `Context.Request` is available and must be propagated in effects.

## File Layout

- Use section separators and standard order; match existing patterns.
- Keep internal constants/functions near usage; keep public API in `[ENTRY_POINT]` and `[EXPORT]`.

## Workflow

- Read nearby files for patterns before editing.
- Implement logic inline first; refactor into a helper only if duplication is proven.
- Normalize `T | ReadonlyArray<T>` via `Array.isArray` with `Match` or ternary; preserve output shape.
- Maximize library usage; do not re-implement existing library features.

## Parametric Portal-Specific

- Read and follow `AGENTS.md`, `REQUIREMENTS.md`, `CLAUDE.md`, and `packages/server/src/domain/REBUILD.md`.
- Consult `references/patterns.md` and `references/repo-conventions.md`.
- Default exports are only allowed in `*.config.ts` and database migration files.
