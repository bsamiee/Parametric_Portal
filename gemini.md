# [H1][GEMINI_MANIFEST]
>**Dictum:** *Protocol governs agent execution in monorepo context.*

Operate as senior developer in bleeding-edge Nx/Vite/Effect monorepo designed for hundreds of unique apps, multi-tenant workloads, mixed deployment modes (cluster/single), and workflow-driven agentic automation. Workspace queries via skill scripts: `nx-tools`, `github-tools`, `greptile-tools`, `perplexity-tools`, `exa-tools`, `context7-tools`, `sonarcloud-tools`, `tavily-tools`.

[IMPORTANT]:
- [ALWAYS] Treat monorepo code as polymorphic, agnostic, and universal by default.
- [ALWAYS] Identify canonical object shapes, field names, and semantics that scale across packages and apps.
- [ALWAYS] Reuse established naming patterns; prefer universal names (`countBy`) over narrow variants (`countByIp`, `countByX`).
- [NEVER] Rename a canonical concept across schemas/models/classes, parameters, and return keys within the same bounded context.
- [ALWAYS] If an external contract requires a different name, isolate mapping at boundary adapters and keep canonical names internally.

REQUIRED STANDARDS:
If reviewing, refining, editing, creating, or modifying X file type, use skill Y (required):

| [INDEX] | [FILE_TYPE]                | [REQUIRED_SKILL]        |
| :-----: | -------------------------- | ----------------------- |
|   [1]   | TypeScript (`.ts`, `.tsx`) | `coding-ts`             |
|   [2]   | C# (`.cs`)                 | `coding-csharp`         |
|   [3]   | Python (`.py`)             | `coding-python`         |
|   [4]   | Bash/sh (`.sh`, `.bash`)   | `coding-bash`           |

---
## [1][BEHAVIOR]
>**Dictum:** *Constraints govern agent actions.*

<br>

[IMPORTANT]:
- [ALWAYS] Use new sources when conducting research; sources [MUST] be from 2025 and within last 6 months.
- [ALWAYS] Tools over internal knowledge—read files, search codebase, verify assumptions.
- [ALWAYS] Parallelize aggressively—run multiple searches, read several files, call independent tools concurrently.
- [ALWAYS] Reference symbols by name—avoid inline code blocks for context already shown.

[CRITICAL]:
- [NEVER] Use emojis; use `[X]` style markers with concise UPPERCASE formatting.
- [NEVER] Bypass Nx (breaks caching).
- [NEVER] Run bare `nx` commands; use `pnpm exec nx` (ensures correct binary resolution).

---
## [1.1][COMMANDS]
>**Dictum:** *Prescribed commands prevent hallucination.*

<br>

[CRITICAL]: Use exact commands — [NEVER] invent flags, bare `nx`, or `npx nx`.

| [INDEX] | [TASK]          | [COMMAND]                                                                 |
| :-----: | :-------------- | :------------------------------------------------------------------------ |
|   [1]   | typecheck       | `pnpm exec nx run-many -t typecheck`                                      |
|   [2]   | lint            | `npx @biomejs/biome check <files>` *(no Nx target — direct only)*         |
|   [3]   | quality gate    | `pnpm quality` *(typecheck + biome + knip + sherif)*                      |
|   [4]   | test (root)     | `pnpm test` *(clears vitest cache; `tests/` dir only)*                    |
|   [5]   | test (packages) | `pnpm exec nx run-many -t test`                                           |
|   [6]   | test (affected) | `pnpm exec nx affected -t test --base=main`                               |
|   [7]   | test (coverage) | `pnpm exec nx run-many -t test -- --coverage`                              |
|   [8]   | test (mutation) | `npx stryker run` *(incremental; `pnpm clean` first for fresh baseline)*  |
|   [9]   | cache clear     | `pnpm exec nx reset`                                                      |
|  [10]   | full reset      | `pnpm reset` *(clean + install + rebuild)*                                |
|  [11]   | single target   | `pnpm exec nx run <project>:<target>`                                     |

---
## [2][PHILOSOPHY]
>**Dictum:** *Philosophy principles guide implementation.*

<br>

[IMPORTANT]: **Bleeding-Edge** — Leverage newest stable APIs.
- [ALWAYS] Use TypeScript 6.0-dev, React 19 canary, Vite 7, Effect 3.19.
- [ALWAYS] Prefer modern syntax: `using`, `satisfies`, `as const`, const type parameters.
- [ALWAYS] Research docs ≤6 months old before implementation.

[IMPORTANT]: **Functional Core, Effectful Shell** — Pure transformations stay pure.
- [ALWAYS] Reserve Effect for: IO, errors, dependencies, concurrency.
- [ALWAYS] Use `Effect.gen` for 3+ dependent operations; `pipe` for linear flows.
- [NEVER] Wrap pure `A → B` functions in Effect—Effect orchestrates, domain computes.

[IMPORTANT]: **Minimal-Surface Discipline** — Use Schema only when necessary.
- [ALWAYS] Use Schema (S.Class, S.TaggedClass, Model.Class) when: parsing external input, codec required, Hash/Equal derivation needed, or validation pipeline warranted.
- [ALWAYS] Use plain objects + `typeof` inference for internal config, intermediate state, and values that never cross serialization boundaries.
- [ALWAYS] Derive types from runtime values: `typeof`, `ReturnType`, `Parameters`, `typeof XSchema.Type`.
- [NEVER] Schema-wrap internal config, state objects, or intermediates that never serialize.
- [NEVER] Manually redeclare types the compiler already infers.

[IMPORTANT]: **Typed Errors** — Errors are values, not exceptions.
- [ALWAYS] Use `Data.TaggedError` for domain errors (recoverable, ergonomic `catchTag`).
- [ALWAYS] Use `Schema.TaggedError` when errors cross boundaries (serialization).
- [ALWAYS] Keep error unions small: 3-5 variants per service boundary.
- [NEVER] Use string errors, generic `Error`, or `try/catch` in Effect code.

[IMPORTANT]: **Topology** — Packages export mechanisms; apps define values.
- [ALWAYS] Packages own: types, schemas, factories, CSS variable slots.
- [ALWAYS] Apps own: CSS variable values, factory invocations.
- [NEVER] Color/font/spacing literals in `packages/*`.

[IMPORTANT]: **External-Lib-First** — Approved dependencies are primary implementation surface.
- [ALWAYS] Treat dependencies declared in `pyproject.toml`, `pnpm-workspace.yaml`, `Directory.Build.props`/`build.props` as first-class libraries.
- [ALWAYS] Integrate approved external libraries directly; use native APIs end-to-end.
- [NEVER] Hand-roll functionality already provided by approved dependencies.
- [NEVER] Prefer stdlib alternatives when approved external libraries already cover requirement.

---
## [3][CONSTRAINTS]
>**Dictum:** *Constraints enforce code standards.*

<br>

[CRITICAL]:
- [NEVER] `any` → use branded types via Schema.
- [NEVER] `let`/`var` → use `const` only.
- [NEVER] `for/while` → use `.map`, `.filter`, Effect.forEach.
- [NEVER] `try/catch` → use Effect error channel.
- [NEVER] Default exports → use named exports (except `*.config.ts`).
- [NEVER] Barrel files (`index.ts`) → consumers import directly from source.
- [NEVER] Re-export external lib types → import directly from source.
- [NEVER] Inline exports → declare first, export at file end.
- [NEVER] Hand-roll utilities that exist in external libs.
- [NEVER] `if` (including bare guards), `else if`, `switch` → use `Match.type`, `$match`, `Option.match`, `Effect.filterOrFail`.
- [NEVER] Module-level type declarations separate from schema → derive via `typeof XSchema.Type`.
- [NEVER] Helper/utility files or functions (`helpers.ts`, `*Helper`, `*Util`) → colocate logic in domain module.
- [NEVER] Wrappers/indirection/const spam → no thin wrappers, unnecessary intermediate bindings, single-use aliases; wrappers only when truly needed.
- [NEVER] Function proliferation → consolidate into fewer, polymorphic solutions.
- [NEVER] Comments describing "what" → reserve for "why".
- [NEVER] Nesting deeper than 4 levels → extract into named Effect pipelines or flatten with `pipe`/`Effect.filterOrFail`.
- [NEVER] Schema/struct/branded type proliferation → one canonical polymorphic schema, derive variants at call site via `pick`/`omit`/`partial`/field modifiers.
- [NEVER] Inconsistent field/parameter naming → same concept uses same name everywhere; no unnecessary differentiation across objects.

[CONDITIONAL]:
- [PREFER] `Match.type`/`Match.value`/`$match` for exhaustive variant handling.
- [ALLOW] Static data maps (`Record<string, string>`) for immutable key-to-value lookups — no functions/Effects as values.
- [ALLOW] Ternary for binary conditions with simple expressions.

---
## [3.1][EFFECT_PATTERNS]
>**Dictum:** *Effect composition follows consistent patterns.*

<br>

[IMPORTANT]:
- [ALWAYS] Use `pipe()` for left-to-right composition (linear flows).
- [ALWAYS] Use `Effect.gen` for 3+ dependent operations or control flow.
- [ALWAYS] Use `Effect.Service` for application services with Layer.
- [ALWAYS] Use `Effect.all` to aggregate independent effects.
- [ALWAYS] Use `Effect.fn('name')` for service methods needing traces.

[CRITICAL]:
- [NEVER] Mix `async/await` with Effect—use `Effect.promise` for interop.
- [NEVER] Ignore effects in `flatMap` chains—all must contribute to result.

| [INDEX] | [FUNCTION/PATTERN]         | [WHEN_TO_USE]                                               |
| :-----: | -------------------------- | ----------------------------------------------------------- |
|   [1]   | `Effect.gen`               | Monadic composition (3+ dependent operations, control flow) |
|   [2]   | `Effect.fn('name')`        | Traced function with automatic span for metrics             |
|   [3]   | `Effect.Service` + `Layer` | Scoped service with managed lifecycle + DI                  |
|   [4]   | `Effect.acquireRelease`    | Resource lifecycle (acquire → use → release)                |
|   [5]   | `Stream.groupedWithin`     | Microbatch aggregation with time/count bounds               |
|   [6]   | `Schedule.exponential`     | Algebraic retry policies with backoff strategy              |
|   [7]   | `FiberRef`                 | Scoped context propagation (tenant, request ID)             |
|   [8]   | `STM`/`TMap`               | Software transactional memory for concurrent state          |
|   [9]   | `Layer.scoped`             | Managed resource DI with lifecycle hooks                    |
|  [10]   | `Match.valueTags`/`type`   | Exhaustive structural dispatch on unions/variants           |

---
## [3.2][TYPE_DISCIPLINE]
>**Dictum:** *Fewer, more powerful types reduce surface.*

<br>

[IMPORTANT]:
- [ALWAYS] Derive types from runtime values: `typeof`, `ReturnType`, `Parameters`. Use `typeof XSchema.Type` when schema exists; use `typeof _CONFIG` when plain object.
- [ALWAYS] Use `satisfies` to validate shape while preserving literals.
- [ALWAYS] Use `as const` for immutable config objects.

[CRITICAL]:
- [NEVER] Re-export external lib types—consumers import directly.
- [NEVER] Create type aliases adding no semantic value.
- [NEVER] Use `Object.freeze`—`as const` is sufficient for immutability.

---
## [3.3][EXTERNAL_LIBS]
>**Dictum:** *Leverage external libraries; do not hand-roll.*

<br>

[IMPORTANT]:
- [ALWAYS] Prefer built-in TS utility types first (`Pick`, `Omit`, `Required`, `Awaited`).
- [ALWAYS] Use `Simplify` from type-fest at public API boundaries only.
- [ALWAYS] Quarantine ts-toolbelt computation in `types/internal/`.
- [ALWAYS] Check catalog (`pnpm-workspace.yaml`) before adding dependencies.

| [INDEX] | [LIBRARY]               | [KEY_UTILITIES]                   | [USE_WHEN]                                 |
| :-----: | ----------------------- | --------------------------------- | ------------------------------------------ |
|   [1]   | `@effect/sql`           | `Model.Class`, `SqlClient`        | Entity models, codecs, database access     |
|   [2]   | `@effect/platform`      | `HttpApi`, `HttpApiGroup`         | HTTP server/client, Router contracts       |
|   [3]   | `@effect/cluster`       | `Sharding`, `Entity`, `Singleton` | Distributed entity orchestration           |
|   [4]   | `@effect/opentelemetry` | `NodeSdk`, `Tracer`               | Observability, tracing, span lifecycle     |
|   [5]   | `@effect/rpc`           | `Rpc`, `RpcGroup`                 | Remote procedure call with typed contracts |
|   [6]   | `@effect/workflow`      | `Workflow`, `Activity`            | Durable workflows, activity definitions    |
|   [7]   | `@effect/ai`            | `AiChat`                          | AI chat abstractions, protocol-agnostic    |
|   [8]   | `@effect/ai-anthropic`  | `AnthropicProvider`               | Anthropic Claude integration               |
|   [9]   | `ts-toolbelt`           | `O.Merge`, `L.Concat`             | Type-level ops (quarantine in types/)      |
|  [10]   | `ts-essentials`         | `XOR`, `DeepReadonly`             | Exclusive unions, deep immutability        |
|  [11]   | `type-fest`             | `Simplify`, `LiteralUnion`        | Public API readability                     |
|  [12]   | `@effect/experimental`  | `Machine`, `VariantSchema`        | Server-side patterns (behind service)      |

---
## [4][OUTPUT]
>**Dictum:** *Output format optimizes readability.*

<br>

[IMPORTANT]:
- [ALWAYS] Use `backticks` for file paths, symbols, and CLI commands.
- [ALWAYS] Avoid large code blocks—reference file/symbol names instead.
- [ALWAYS] Use Markdown: headings for structure, bullets for lists, tables for comparisons.
- [ALWAYS] Keep responses actionable—lead with what changed, not what you will do.

<br>

### [4.1][DEPENDENCIES]

[IMPORTANT]:
1. [ALWAYS] **Check catalog**: `cat pnpm-workspace.yaml | grep my-dep`.
2. [ALWAYS] **Add to catalog** (if missing): `my-dep: 1.2.3` (exact version).
3. [ALWAYS] **Reference**: `"dependencies": { "my-dep": "catalog:" }`.
4. [ALWAYS] **Install**: `pnpm install`.
5. [ALWAYS] **Validate**: `pnpm exec nx run-many -t typecheck`.

---
## [5][FILE_ORGANIZATION]
>**Dictum:** *Organization patterns enable navigation.*

<br>

[IMPORTANT] **Section separators**: `// --- [LABEL] ` + dashes to column 80.

```typescript
// --- [TYPES] -----------------------------------------------------------------
// --- [SCHEMA] ----------------------------------------------------------------
// --- [CONSTANTS] -------------------------------------------------------------
// --- [ERRORS] ----------------------------------------------------------------
// --- [SERVICES] --------------------------------------------------------------
// --- [FUNCTIONS] -------------------------------------------------------------
// --- [LAYERS] ----------------------------------------------------------------
// --- [EXPORT] ----------------------------------------------------------------
```

**Canonical order** (omit unused): Types → Schema → Constants → Errors → Services → Functions → Layers → Export.

**Core Sections**:
- `[TYPES]` — Type aliases, inferred types, discriminated unions
- `[SCHEMA]` — @effect/schema definitions, branded types
- `[CONSTANTS]` — Immutable config with `as const`
- `[ERRORS]` — Data.TaggedError definitions
- `[SERVICES]` — Effect.Service definitions
- `[FUNCTIONS]` — Pure functions + Effect pipelines
- `[LAYERS]` — Layer composition, composition root
- `[EXPORT]` — Named exports

**Domain Extensions** (insert after corresponding core section):
- Database: `[TABLES]` (after SCHEMA), `[REPOSITORIES]` (after SERVICES)
- API: `[GROUPS]` (after SCHEMA), `[MIDDLEWARE]` (after SERVICES)

**FORBIDDEN labels**: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.
