---
name: coding-ts
description: >-
  Enforces TypeScript + Effect style, type discipline, error handling,
  concurrency, and module organization standards.
  Use when writing, editing, reviewing, refactoring, or debugging
  .ts/.tsx modules, implementing domain models, Effect services,
  persistence adapters, or boundary handlers, or configuring TypeScript,
  Effect, or lint/type-check posture.
---

# Coding TypeScript

All code follows five governing principles:
- **Polymorphic** — one entrypoint per concern, generic over specific, extend over duplicate
- **Functional + ROP** — pure pipelines, typed error rails, monadic composition
- **Strongly typed** — inference-first, one canonical shape per concept, zero `any`/`unknown` leakage
- **Programmatic** — variable-driven dispatch, bounded vocabularies, zero stringly-typed routing
- **Algorithmic** — drive functionality through transforms, folds, and discriminant projection; reduce branching to composable pipelines


## Paradigm

- **Immutability**: `S.Class` copy-update transitions, `Ref` for managed mutable state, zero `let` in domain code
- **Typed error channels**: `Data.TaggedEnum` for file-internal errors (never exported), `class extends Data.TaggedError` for cross-cutting domain errors (polymorphic, few per system), composed via `mapError`/`catchTag`/`catchTags`
- **Exhaustive dispatch**: `Match.valueTags`/`Match.tagsExhaustive` for closed tagged domains, `Match.exhaustive` for non-tag domains
- **Type anchoring**: one `S.Class` per concept — derive projections via `pick`/`omit`/`partial`/`extend`, never parallel structs
- **Expression control flow**: `pipe` + monadic combinators (`map`, `flatMap`, `tap`, `filterOrFail`), zero statement branching
- **Programmatic logic**: bounded vocabulary objects as discriminant sources, `Record`-driven dispatch, zero stringly-typed routing
- **Surface ownership**: one polymorphic entrypoint per concern, no helpers, no extraction, no method-family inflation
- **Cross-cutting composition**: `Layer` + `Effect.Service` for DI, `Effect.withSpan`/`Effect.annotateLogs` for observability


## Conventions

Effect is the sole ecosystem — no third-party alternatives for concerns Effect owns.
One library's types per module boundary. Bridge at layer edges via Schema decode/encode.


## Contracts

**Type discipline**
- One canonical `S.Class` per concept; derive all projections (`pick`/`omit`/`partial`/`extend`), never parallel `S.Struct` variants.
- Search existing shapes before creating new ones — extend or modify fields over declaring fresh schemas.
- Avoid module-level `type`/`interface` when inference from runtime declarations suffices.
- No parallel schemas/brands/types for the same domain concept.

**Control flow**
- Zero `if`/`else`/`switch`/`for`/`while`/`try`/`catch`/`throw` in domain transforms.
- Expression dispatch: `Match.valueTags`/`Match.tagsExhaustive` for closed tagged domains, monadic combinators elsewhere.
- Boundary adapters may use required statement forms with explicit marker: `// BOUNDARY ADAPTER — reason`.

**Error handling**
- `Data.TaggedEnum` for file-internal errors — bounded discriminants, never exported, never crosses module boundaries.
- `class extends Data.TaggedError` for domain-level errors — polymorphic, boundary-crossing, co-located in the owning folder/package (no dedicated error files). Few per system (1-3 typical).
- Domain error classes carry polymorphic/agnostic logic reusable across all call sites.
- One canonical `reason → policy` projection table per domain error class — zero inline status/retry/transport literals outside it.
- Decode unknown input at boundaries, map unknown causes immediately.

**Surface**
- One polymorphic entrypoint per concern — no `run`/`runSafe`/`runV2` family inflation.
- No helper files, no single-caller extracted functions, no module-level one-use `const` values.
- No convenience wrappers that rename or forward external APIs.
- `~350 LOC` scrutiny threshold — investigate for compression via polymorphism, not file splitting.

**Resources**
- Resource lifecycle through `Effect.acquireRelease`.
- Retry, timeout, concurrency policy via `Schedule`, `Effect.forEach`, `Stream` — declarative only.
- Zero hidden global state, zero untracked ambient dependencies.


## Load sequence

**Foundation** (always):

| Reference                             | Focus                                |
| ------------------------------------- | ------------------------------------ |
| [patterns.md](references/patterns.md) | Cross-boundary integration contracts |

**Core** (always):

| Reference                                 | Focus                                    |
| ----------------------------------------- | ---------------------------------------- |
| [types.md](references/types.md)           | TypeScript types, inference, generics    |
| [objects.md](references/objects.md)       | Schemas, classes, shapes, projections    |
| [effects.md](references/effects.md)       | Effect pipelines, ROP, composition       |
| [matching.md](references/matching.md)     | Exhaustive expression control flow       |
| [errors.md](references/errors.md)         | Error construction, architecture, policy |
| [transforms.md](references/transforms.md) | Folds, projections, pipeline strategies  |
| [surface.md](references/surface.md)       | Public API creation and refinement       |

**Specialized** (load when task matches):

| Reference                                       | Load when                                |
| ----------------------------------------------- | ---------------------------------------- |
| [composition.md](references/composition.md)     | Layer and module boundary composition    |
| [services.md](references/services.md)           | Service topology and dependency strategy |
| [persistence.md](references/persistence.md)     | SQL/model boundary work                  |
| [concurrency.md](references/concurrency.md)     | Streams, fibers, bounded concurrency     |
| [observability.md](references/observability.md) | Logging, tracing, metrics                |
| [performance.md](references/performance.md)     | Hot path and allocation discipline       |

## Anti Patterns

**Type-system violations**
- SHAPE PROLIFERATION: Duplicate schema/type for one concept. Keep one runtime anchor and derive projections via `pick`/`omit`/`partial`.
- TYPE PROLIFERATION: Top-level `type`/`interface` aliases that mirror runtime shape. Derive from runtime declarations (`typeof XSchema.Type`).
- NULL ARCHITECTURE: `null`/`undefined` leaking across domain boundaries. `Option<T>` for absence, tagged failure for errors.

**Control-flow violations**
- IMPERATIVE BRANCH: Statement branching (`if`/`else`/`switch`/`for`/`while`) in domain flow. Replace with `Match` + monadic operators.
- EARLY MATCH COLLAPSE: Calling `match`/`Match.exhaustive` mid-pipeline and losing composition. Keep `map`/`flatMap`; match at boundaries.
- MUTABLE ACCUMULATOR: `let` + loop accumulation breaks referential transparency. `Array.reduce`, `Effect.forEach`, or `Stream.runFold` replace it.

**Surface-area violations**
- SURFACE INFLATION: Multiple entrypoints for one concern (`run`, `runSafe`, `runV2`). Collapse to one polymorphic surface.
- WRAPPER REDUNDANCY: Thin wrappers around external library APIs. Call upstream primitives directly.
- MODULE CONST SPAM: One-use top-level `const` values that are not semantic anchors (schemas, schedules, metrics, vocabularies). Inline into the owning rail.
- STRINGLY TELEMETRY: Repeated raw telemetry keys/values (`"operation"`, `"status_class"`, `"obs.outcome"`) across spans/metrics/logs. Define one bounded vocabulary object and project through it.
- GOD FUNCTION: Giant dispatch handling all variants in one function body. DU + exhaustive `Match.valueTags` makes extension additive.

**Error-rail violations**
- ERROR RAIL FRAGMENTATION: Separate error classes per method. Keep one tagged module failure rail with bounded `reason` literals.
- STRINGLY POLICY DRIFT: Duplicate inline status/retry/transport literals in handlers. Project via one canonical `reason -> policy` table only.
- STRINGLY SIGNATURE DRIFT: Delimiter-concatenated signatures (`${a}:${b}:${c}`) for equality/routing. Project structured tuples/records and compare fields directly.
- VARIABLE REASSIGNMENT: `let value = x; value = process(value)` creates temporal coupling. `pipe` chains make the computation graph explicit.

## Validation gate

- Required during iteration: `pnpm ts:check`.
- Required for final completion: `pnpm ts:check`, `pnpm cs:check`, `pnpm py:check`.
- Reject completion when load order, contracts, or checks are not satisfied.

## First-class libraries

Effect packages are standard libraries — use over stdlib equivalents.

| Package                        | Provides                           |
| ------------------------------ | ---------------------------------- |
| `effect`                       | Core runtime, types, concurrency   |
| `@effect/platform`             | HTTP, filesystem, sockets, workers |
| `@effect/platform-browser`     | Browser runtime adapter            |
| `@effect/platform-bun`         | Bun runtime adapter                |
| `@effect/platform-node`        | Node.js runtime adapter            |
| `@effect/platform-node-shared` | Shared Node.js platform utilities  |
| `@effect/sql`                  | SQL client abstraction             |
| `@effect/sql-pg`               | PostgreSQL adapter                 |
| `@effect/cluster`              | Distributed actors, sharding       |
| `@effect/rpc`                  | Type-safe remote procedure calls   |
| `@effect/workflow`             | Durable workflow orchestration     |
| `@effect/ai`                   | AI provider abstraction            |
| `@effect/ai-anthropic`         | Anthropic provider adapter         |
| `@effect/ai-google`            | Google AI provider adapter         |
| `@effect/ai-openai`            | OpenAI provider adapter            |
| `@effect/opentelemetry`        | Tracing and metrics integration    |
| `@effect/vitest`               | Effect-aware test runner           |
| `@effect/cli`                  | Type-safe CLI builder              |
| `@effect/printer`              | Composable document layout         |
| `@effect/printer-ansi`         | ANSI terminal rendering            |
| `@effect/experimental`         | Event sourcing, state machines     |
