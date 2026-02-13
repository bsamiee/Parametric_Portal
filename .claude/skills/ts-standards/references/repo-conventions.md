# [H1][REPO_CONVENTIONS]
>**Dictum:** *Authoritative sources prevent convention drift.*

<br>

---
## [1][SOURCES_OF_TRUTH]

| [INDEX] | [FILE]                                  | [GOVERNS]                                    |
| :-----: | --------------------------------------- | -------------------------------------------- |
|   [1]   | `CLAUDE.md`                             | Agent behavior, constraints, Effect patterns |
|   [2]   | `AGENTS.md`                             | Agent roles and responsibilities             |
|   [3]   | `REQUIREMENTS.md`                       | Feature requirements and acceptance criteria |
|   [4]   | `packages/server/src/domain/REBUILD.md` | Domain model rebuild specifications          |

---
## [2][FORMATTING]

| [INDEX] | [RULE]                                         | [SCOPE]                           |
| :-----: | ---------------------------------------------- | --------------------------------- |
|   [1]   | 4-space indentation (no tabs)                  | All TypeScript source files       |
|   [2]   | Biome formatter disabled for TS source         | `biome.json` override at L167-185 |
|   [3]   | Biome lint-only via `npx @biomejs/biome check` | Lint without reformatting         |

---
## [3][BUILD_AND_VALIDATION]

| [INDEX] | [COMMAND]                            | [PURPOSE]                |
| :-----: | ------------------------------------ | ------------------------ |
|   [1]   | `pnpm exec nx run-many -t typecheck` | Full monorepo typecheck  |
|   [2]   | `npx @biomejs/biome check <files>`   | Lint-only (no format)    |
|   [3]   | `pnpm exec nx` (never bare `nx`)     | All Nx commands          |
|   [4]   | `pnpm install`                       | After dependency changes |

---
## [4][IMPORTS]

[CRITICAL]:
- [NEVER] Default imports -- use named imports.
- [NEVER] Barrel file imports (`./index`) -- import from source module.
- [NEVER] Re-export external types -- consumers import directly.
- [NEVER] Wildcard imports -- except `Schema as S`, `Array as A`.

[IMPORTANT]:
- [ALWAYS] Import `Schema as S`, `Array as A` from `effect`.
- [ALWAYS] Group: external libs first, internal paths second, blank line between.

---
## [5][NAMING]

[CRITICAL]:
- [NEVER] 1-3 letter parameter abbreviations: `(s)` -> `(service)`, `(d)` -> `(delta)`.
- [NEVER] Ambiguous names: `data`, `info`, `item`, `result`, `temp`, `value`.

[IMPORTANT]:
- [ALWAYS] Prefix private/internal with `_`: `_config`, `_fetchUser`.
- [ALWAYS] Descriptive parameters: `subscriber` not `sub`, `requestContext` not `ctx`.
- [ALLOW] Import aliases: `Schema as S`, `Array as A`.

---
## [6][FILE_ORGANIZATION]

**Canonical order** (omit unused): Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export.<br>
**Domain extensions**: TABLES (after SCHEMA), REPOSITORIES (after SERVICES), GROUPS (after SCHEMA), MIDDLEWARE (after SERVICES).<br>
**Forbidden labels**: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.<br>
**Export section**: All exports gathered in `[EXPORT]` at file end. No inline `export const`.

---
## [7][BRANCHING_AND_CONTROL_FLOW]

| [INDEX] | [FORBIDDEN]                          | [REPLACEMENT]                                         | [EXCEPTION]               |
| :-----: | ------------------------------------ | ----------------------------------------------------- | ------------------------- |
|   [1]   | Dispatch table (functions as values) | `Match.type` or `$match`                              | Pure data lookups (no fn) |
|   [2]   | `if/else if` on `_tag`               | `Match.type().pipe(Match.tag(...), Match.exhaustive)` | None                      |
|   [3]   | `switch` on `_tag`                   | `Match.type` + `Match.exhaustive`                     | None                      |
|   [4]   | `switch` on primitives               | `Match.value().pipe(Match.when(...))`                 | None                      |

---
## [8][EFFECT_CONVENTIONS]

### Composition

| [PATTERN]    | [USE WHEN]                              |
| ------------ | --------------------------------------- |
| `pipe()`     | Linear left-to-right composition        |
| `Effect.gen` | 3+ dependent operations or control flow |
| `Effect.fn`  | Service methods needing tracing spans   |
| `Effect.all` | Aggregating independent effects         |

### Tracing

| [CONTEXT]      | [USE]                         | [NOT]            |
| -------------- | ----------------------------- | ---------------- |
| Service method | `Effect.fn('Service.method')` | `Telemetry.span` |
| Route handler  | `Telemetry.routeSpan('name')` | `Effect.fn`      |
| Pure function  | Neither                       | Either           |

### Errors

- `Data.TaggedError` for internal domain errors. `Schema.TaggedError` for API/RPC boundary.
- `Effect.catchTag` for single-variant recovery. `Effect.catchTags` for multi-variant.
- `Effect.mapError` + `Match.exhaustive` for provably complete boundary mapping.

### Services

- Define via `Context.Tag`. Implement via `Layer.effect` or `Layer.succeed`.
- Service methods: `R = never`. `Live` for production, `Test` for doubles.
- Provide all layers at composition root via `Layer.merge` / `Layer.compose`.

---
## [9][TYPE_CONVENTIONS]

| [SOURCE]          | [SYNTAX]                             | [SCOPE]               |
| ----------------- | ------------------------------------ | --------------------- |
| Effect Schema     | `type X = typeof XSchema.Type`       | All domain types      |
| Drizzle table     | `type X = typeof table.$inferSelect` | Database models       |
| Branded primitive | `S.String.pipe(S.brand('UserId'))`   | Domain identifiers    |
| Tagged enum       | `Data.taggedEnum<MyEnum>()`          | Sum types with data   |
| Conditional type  | `T extends U ? X : Y`                | Type-level dispatch   |
| Mapped type       | `{ [K in keyof T]: ... }`            | Type-level transforms |

[CRITICAL]:
- [NEVER] `type X = {...}` alongside a schema defining the same shape.
- [NEVER] `string` for domain identifiers -- use branded types.
- [NEVER] `any` -- use `unknown` at boundaries, branded types for domains.

---
## [10][DEPENDENCY_MANAGEMENT]

1. **Check catalog**: `rg my-dep pnpm-workspace.yaml`.
2. **Add** (if missing): `my-dep: 1.2.3` (exact version).
3. **Reference**: `"dependencies": { "my-dep": "catalog:" }`.
4. **Install**: `pnpm install`.
5. **Validate**: `pnpm exec nx run-many -t typecheck`.

[CRITICAL]:
- [ALWAYS] Exact versions in catalog (no `^` or `~`).
- [NEVER] Bypass `pnpm` (no `npm install`, no `yarn add`).
