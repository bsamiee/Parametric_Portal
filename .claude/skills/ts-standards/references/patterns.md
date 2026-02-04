# Patterns and Examples

## Sectioned Layout

- Use `// --- [SECTION]` separators and consistent order.
- Example: `packages/server/src/api.ts`, `packages/server/src/utils/circuit.ts`.

## Internal Naming

- Prefix private/internal constants and functions with `_`.
- Prefer `const` + `as const` + `satisfies` for inference.
- Example: `_CONFIG`, `Tuning`, `_SearchQuery`.

## Namespace Object Pattern

- Build a single exported object and merge a namespace for types.
- Example: `packages/server/src/utils/circuit.ts`, `packages/database/src/page.ts`.

## Schema-first APIs

- Use `S.Struct` and inline schemas for HTTP and IO shapes.
- Use `S.Class` and `S.TaggedError` for schema-coupled values/errors.
- Example: `packages/server/src/api.ts`, `packages/server/src/infra/cluster.ts`.

## Effect Control Flow

- Use `Match.value(...).pipe(Match.when/Match.tag/Match.orElse/Match.exhaustive)`.
- Use `Option.fromNullable` + `Option.match`.
- Example: `packages/server/src/utils/circuit.ts`, `packages/server/src/platform/streaming.ts`.

## Dispatch Tables

- Use `const _X = { ... } as const` for variants.
- Example: `packages/server/src/platform/streaming.ts`, `packages/database/src/search.ts`.

## Dense Tuning Objects

- Keep numeric/config tuning in a single dense object.
- Example: `packages/server/src/infra/cluster.ts` (`_CONFIG`), `packages/database/src/search.ts` (`Tuning`), `packages/server/src/utils/transfer.ts` (`limits`).

## Callable Objects

- Use `Object.assign(fn, { ... })` for decorator-style APIs.
- Example: `packages/server/src/utils/resilience.ts`.

## Metrics and Telemetry

- Use `MetricsService.trackEffect` and `Telemetry.span` on long-running or boundary effects.
- Example: `packages/server/src/infra/cluster.ts`, `packages/server/src/observe/telemetry.ts`.

## Caching and Resilience

- Use `packages/server/src/platform/cache.ts` for caching and `packages/server/src/utils/resilience.ts` for retry/circuit/bulkhead.
- Avoid custom cache or retry logic.

## Repository Factory

- Use a polymorphic repo with `put/set/drop/lift/upsert/merge` that tracks input shape.
- Build SQL fragments algorithmically from schema metadata.
- Example: `packages/database/src/factory.ts`, `packages/database/src/repos.ts`.

## Models

- Use `Model.Class` with field variants (`Generated`, `Sensitive`, `FieldOption`, `JsonFromString`).
- Example: `packages/database/src/models.ts`.

## Library Awareness

- Always prefer official packages over custom implementations.
- Treat these as first-class tools: `effect`, `@effect/platform`, `@effect/sql`, `@effect/cluster`, `@effect/opentelemetry`, `@effect/rpc`, `@effect/workflow`, `@effect/experimental`, `@effect/cli`, `@effect/printer`, `@effect/printer-ansi`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-pg`, `@effect-aws/client-s3`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
