# [H1][REPO_CONVENTIONS]
>**Dictum:** *Authoritative sources prevent convention drift.*

<br>

## [1][SOURCES_OF_TRUTH]

| [INDEX] | [FILE]                                       | [GOVERNS]                                     |
| :-----: | -------------------------------------------- | --------------------------------------------- |
|   [1]   | `CLAUDE.md`                                  | Agent behavior, constraints, Effect patterns   |
|   [2]   | `AGENTS.md`                                  | Agent roles and responsibilities               |
|   [3]   | `REQUIREMENTS.md`                            | Feature requirements and acceptance criteria   |
|   [4]   | `packages/server/src/domain/REBUILD.md`      | Domain model rebuild specifications            |

---
## [2][FORMATTING]

| [INDEX] | [RULE]                                       | [SCOPE]                          |
| :-----: | -------------------------------------------- | -------------------------------- |
|   [1]   | 4-space indentation (no tabs)                | All TypeScript source files      |
|   [2]   | Biome formatter disabled for TS source       | `biome.json` override at L167-185 |
|   [3]   | Biome lint-only via `npx @biomejs/biome check` | Lint without reformatting      |
|   [4]   | No trailing semicolons in override files     | Where Biome formatter is disabled |

---
## [3][BUILD_AND_VALIDATION]

| [INDEX] | [COMMAND]                                    | [PURPOSE]                        |
| :-----: | -------------------------------------------- | -------------------------------- |
|   [1]   | `pnpm exec nx run-many -t typecheck`         | Full monorepo typecheck          |
|   [2]   | `npx @biomejs/biome check <files>`           | Lint-only (no format)            |
|   [3]   | `pnpm exec nx` (never bare `nx`)             | All Nx commands                  |
|   [4]   | `pnpm install`                               | After dependency changes         |

---
## [4][IMPORTS]

[CRITICAL]:
- [NEVER] Default imports -- use named imports (`import { X } from 'lib'`).
- [NEVER] Barrel file imports (`import { X } from './index'`) -- import directly from source module.
- [NEVER] Re-export external library types -- consumers import directly from the library.
- [NEVER] Wildcard imports (`import * as X`) -- except ecosystem conventions (`Schema as S`, `Array as A`).

[IMPORTANT]:
- [ALWAYS] Import `Schema as S` from `effect` (ecosystem convention).
- [ALWAYS] Import `Array as A` from `effect` (avoids shadowing global Array).
- [ALWAYS] Group imports: external libs first, then internal paths, separated by blank line.

---
## [5][NAMING]

[CRITICAL]:
- [NEVER] Use 1-3 letter parameter/field abbreviations: `(s)` -> `(service)`, `(ch, msg)` -> `(channel, raw)`, `(d)` -> `(delta)`.
- [NEVER] Use ambiguous names: `data`, `info`, `item`, `result`, `temp`, `value`.

[IMPORTANT]:
- [ALWAYS] Prefix private/internal values with `_`: `_config`, `_fetchUser`, `_parseInput`.
- [ALWAYS] Use descriptive parameter names: `subscriber` not `sub`, `requestContext` not `ctx`, `ipAddress` not `ip`.
- [ALLOW] Import aliases that are ecosystem convention: `Schema as S`, `Array as A`.

---
## [6][FILE_ORGANIZATION]

### Section Separators

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

### Rules

- **Canonical order** (omit unused): Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export.
- **Domain extensions**: `[TABLES]` (after SCHEMA), `[REPOSITORIES]` (after SERVICES), `[GROUPS]` (after SCHEMA), `[MIDDLEWARE]` (after SERVICES).
- **FORBIDDEN labels**: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.
- **Export section**: All exports gathered in the `[EXPORT]` section at file end. No inline `export const`.
- **Single primary export**: Expose one primary export per file (max three). Use `Object.assign(fn, { ... })` for callable objects with attached metadata.

---
## [7][BRANCHING_AND_CONTROL_FLOW]

### PROHIBITED for behavioral branching

| [INDEX] | [PATTERN]                                          | [REPLACEMENT]                                     | [EXCEPTION]                              |
| :-----: | -------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- |
|   [1]   | `Record<string, () => void>` (dispatch table)      | `Match.type` or `Data.TaggedEnum.$match`          | Pure data lookups (no behavior)          |
|   [2]   | `if (x._tag === ...) else if (x._tag === ...)`    | `Match.type().pipe(Match.tag(...), Match.exhaustive)` | None                               |
|   [3]   | `switch (x._tag) { case ... }`                    | `Match.type` with `Match.exhaustive`              | None                                     |
|   [4]   | `switch (x) { case ... }` (on primitives)         | `Match.value(x).pipe(Match.when(...), ...)`       | None                                     |

### ALLOWED for pure data lookups (no behavior)

Pure data lookups map a key to a static value with no function execution, no side effects, and no branching logic. These are acceptable as `Record<string, string>` or equivalent:

```typescript
// ALLOWED -- pure data lookup, no behavior
const _HTTP_STATUS_MESSAGES = {
    200: "OK",
    404: "Not Found",
    500: "Internal Server Error",
} as const

// ALLOWED -- pure data lookup, no behavior
const _ERROR_LABELS = {
    AuthError: "Authentication Failed",
    NotFound: "Resource Not Found",
    RateLimit: "Too Many Requests",
} as const
```

### PROHIBITED -- dispatch table masquerading as data lookup

```typescript
// PROHIBITED -- values are functions, not data. This is behavioral branching.
const _handlers = {
    auth: () => handleAuth(),
    notFound: () => handleNotFound(),
} as const
```

### Decision criteria

- If the value is a **string, number, or other primitive**: data lookup (allowed).
- If the value is a **function, Effect, or other callable**: behavioral branching (prohibited -- use Match).

---
## [8][EFFECT_CONVENTIONS]

### Composition

| [PATTERN]        | [USE WHEN]                                  |
| ---------------- | ------------------------------------------- |
| `pipe()`         | Linear left-to-right composition            |
| `Effect.gen`     | 3+ dependent operations or control flow     |
| `Effect.fn`      | Service methods needing tracing spans       |
| `Effect.all`     | Aggregating independent effects             |

### Tracing

| [CONTEXT]          | [USE]                          | [NOT]               |
| ------------------ | ------------------------------ | ------------------- |
| Service method     | `Effect.fn('Service.method')`  | `Telemetry.span`    |
| Route handler      | `Telemetry.routeSpan('name')`  | `Effect.fn`         |
| Pure function      | Neither                        | Either              |

### Errors

| [SCOPE]            | [USE]                          | [WHY]                           |
| ------------------ | ------------------------------ | ------------------------------- |
| Internal domain    | `Data.TaggedError`             | No serialization needed         |
| API/RPC boundary   | `Schema.TaggedError`           | Needs serialization             |
| Recovery           | `Effect.catchTag`              | Precise per-variant recovery    |
| Multi-recovery     | `Effect.catchTags`             | Handle multiple variants at once |
| Transform          | `Effect.mapError`              | Change error type without catch |
| Boundary mapping   | `Match.value` + `Match.exhaustive` in `mapError` | Provably complete domain-to-HTTP mapping |

### Services

- Define via `Context.Tag` with service shape interface.
- Implement via `Layer.effect` (effectful) or `Layer.succeed` (pure).
- Service methods have `R = never` -- no dependency leakage into interface.
- `Live` suffix for production, `Test` suffix for test doubles.
- Provide all layers at composition root via `Layer.merge` / `Layer.compose`.

---
## [9][TYPE_CONVENTIONS]

### Derivation

| [SOURCE]           | [SYNTAX]                                  | [SCOPE]                  |
| ------------------ | ----------------------------------------- | ------------------------ |
| Effect Schema      | `type X = typeof XSchema.Type`            | All domain types         |
| Drizzle table      | `type X = typeof table.$inferSelect`      | Database models          |
| Branded primitive  | `S.String.pipe(S.brand('UserId'))`        | Domain identifiers       |
| Tagged enum        | `Data.taggedEnum<MyEnum>()`               | Sum types with data      |
| Generic tagged enum | `Data.TaggedEnum.WithGenerics<N>`        | Polymorphic sum types    |
| Conditional type   | `T extends U ? X : Y`                    | Type-level dispatch      |
| Mapped type        | `{ [K in keyof T]: ... }`                | Type-level transforms    |
| Template literal   | `` `prefix${T}` ``                        | Type-safe strings        |

### Forbidden type patterns

- [NEVER] `type X = { ... }` alongside a schema defining the same shape.
- [NEVER] `string` for domain identifiers -- use branded types via `Schema.brand`.
- [NEVER] `string | null` for optional values -- use `Option<string>`.
- [NEVER] `type Status = 'active' | 'inactive'` when variants carry data -- use `Data.TaggedEnum`.
- [NEVER] `any` anywhere -- use `unknown` at boundaries, branded types for domains.
- [NEVER] Type aliases adding no semantic value -- derive from source.

---
## [10][DEPENDENCY_MANAGEMENT]

1. **Check catalog**: `cat pnpm-workspace.yaml | grep my-dep`.
2. **Add to catalog** (if missing): `my-dep: 1.2.3` (exact version).
3. **Reference in package.json**: `"dependencies": { "my-dep": "catalog:" }`.
4. **Install**: `pnpm install`.
5. **Validate**: `pnpm exec nx run-many -t typecheck`.

[CRITICAL]:
- [ALWAYS] Check catalog before adding any dependency.
- [ALWAYS] Use exact versions in catalog (no `^` or `~`).
- [ALWAYS] Prefer built-in TS utility types before reaching for `ts-toolbelt` or `type-fest`.
- [NEVER] Bypass `pnpm` (no `npm install`, no `yarn add`).
