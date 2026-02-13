# [H1][REPO_CONVENTIONS]
>**Dictum:** *Authoritative sources prevent convention drift.*

---
## [1][SOURCES_OF_TRUTH]

Authoritative sources: `CLAUDE.md` (behavior, constraints, Effect patterns), `REQUIREMENTS.md` (features, acceptance criteria).

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

[IMPORTANT]:
- [ALWAYS] Alias ecosystem modules: `Schema as S`, `Array as A` from `effect`.
- [ALWAYS] Group: external libs first, internal paths second, blank line between.
- [ALWAYS] Use `import type { ... }` for types not used at runtime.
- [NEVER] Wildcard imports -- except ecosystem aliases (`Schema as S`, `Array as A`).

---
## [5][NAMING]

[CRITICAL]:
- [NEVER] 1-3 letter parameter abbreviations: `(s)` -> `(service)`, `(d)` -> `(delta)`.

[IMPORTANT]:
- [ALWAYS] Prefix private/internal with `_`: `_config`, `_fetchUser`.
- [ALWAYS] Descriptive parameters: `subscriber` not `sub`, `requestContext` not `ctx`.
- [ALLOW] Import aliases: `Schema as S`, `Array as A` (ecosystem convention).

**Effect type parameter naming:**

| [INDEX] | [PARAM] | [MEANING]                           | [EXAMPLE]                           |
| :-----: | :-----: | ----------------------------------- | ----------------------------------- |
|   [1]   |   `A`   | Success value                       | `Effect<A, E, R>`                   |
|   [2]   |   `E`   | Error channel                       | `Effect<User, AuthError, R>`        |
|   [3]   |   `R`   | Requirements (service dependencies) | `Effect<User, AuthError, UserRepo>` |
|   [4]   |   `I`   | Encoded (schema input) type         | `Schema<A, I, R>`                   |

**Service naming conventions:**

| [INDEX] | [SUFFIX]     | [ROLE]                             | [EXAMPLE]                        |
| :-----: | ------------ | ---------------------------------- | -------------------------------- |
|   [1]   | `XxxService` | Effect.Service application service | `AuthService`, `FeatureService`  |
|   [2]   | `XxxRepo`    | Data access / repository           | `UserRepo`, `AuditRepo`          |
|   [3]   | `XxxAdapter` | External system integration        | `StorageAdapter`, `EmailAdapter` |
|   [4]   | `XxxClient`  | External API caller                | `HttpClient`, `S3Client`         |

---
## [6][FILE_ORGANIZATION]

**Canonical order** (omit unused): Types -> Schema -> Constants -> Errors -> Services -> Functions -> Layers -> Export.
**Domain extensions**: TABLES (after SCHEMA), REPOSITORIES (after SERVICES), GROUPS (after SCHEMA), MIDDLEWARE (after SERVICES).
**Forbidden labels**: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`. All exports gathered in `[EXPORT]` at file end -- no inline `export const`.

---
## [7][EFFECT_CONVENTIONS]
>**Dictum:** *Services acquire resources; layers compose implementations; tracing separates concerns.*

[CRITICAL]: Use `Effect.Service<T>()('tag', { ... })` -- not `Context.Tag`. Three constructor modes: `succeed` (static), `effect` (deps, no cleanup), `scoped` (deps + cleanup). `dependencies` field for auto-provision.

[IMPORTANT]:
- [ALWAYS] `Effect.fn('ServiceName.method')` for all service methods.
- [ALWAYS] Dual access: instance (`R=never`) inside scoped constructors, static (`R=Service`) for external consumers.
- [ALWAYS] Layer naming: `Default` for production, `Test` for test doubles.
- [ALWAYS] Compose layers: Platform -> Infra -> Domain -> App via `Layer.provideMerge`.
- [ALWAYS] `ManagedRuntime.make` at composition root.
- [ALWAYS] `Effect.acquireRelease` for scoped resources, `using` keyword in `Effect.gen`.

[REFERENCE] Tracing: [->composition.md](./composition.md) section 1.

**Platform services:**

| [INDEX] | [CONCERN]  | [CANONICAL_SOURCE]                         | [RULE]                                            |
| :-----: | ---------- | ------------------------------------------ | ------------------------------------------------- |
|   [1]   | Caching    | `packages/server/src/platform/cache.ts`    | Use CacheService; no custom cache                 |
|   [2]   | Resilience | `packages/server/src/utils/resilience.ts`  | Use for retry, circuit, bulkhead, timeout         |
|   [3]   | Tracing    | `packages/server/src/observe/telemetry.ts` | `Telemetry.span` for routes; `Effect.fn` internal |
|   [4]   | Metrics    | `packages/server/src/observe/metrics.ts`   | Domain-specific metrics; generic as fallback      |
|   [5]   | Context    | `packages/server/src/context.ts`           | Propagate `Context.Request` in all effects        |
|   [6]   | Middleware | `packages/server/src/middleware.ts`        | Follow header/cookie/auth/tenant patterns         |

[REFERENCE] Full patterns: [->composition.md](./composition.md), [->errors-and-services.md](./errors-and-services.md)

---
## [8][TYPE_CONVENTIONS]
>**Dictum:** *Advanced type patterns encode domain invariants at compile time.*

**Schema-derived types:**

| [INDEX] | [PATTERN]                | [SYNTAX]                                    | [WHEN]                       |
| :-----: | ------------------------ | ------------------------------------------- | ---------------------------- |
|   [1]   | Domain type from schema  | `type X = typeof XSchema.Type`              | All domain types             |
|   [2]   | Table type from Drizzle  | `type User = typeof users.$inferSelect`     | Database models              |
|   [3]   | Encoded type from schema | `type XEncoded = typeof XSchema.Encoded`    | Wire format / boundary types |
|   [4]   | Recursive schema         | `S.suspend(() => TreeNode)`                 | Self-referential structures  |
|   [5]   | Composed schema          | `S.compose(ASchema, BSchema)`               | Transform pipeline A -> B    |
|   [6]   | Transform schema         | `S.transform(From, To, { decode, encode })` | Bidirectional mapping        |

[IMPORTANT]:
- [ALWAYS] `as const satisfies T` for config objects -- literal inference + shape validation.
- [ALWAYS] IIFE companion for branded types -- schema + operations in single binding.
- [ALWAYS] Namespace + const merge for grouping related types and values.
- [ALLOW] Conditional types with `infer` for discriminant/nested type extraction.
- [ALLOW] Generic constraints for polymorphic service interfaces.

[REFERENCE] Consolidation patterns: [->consolidation.md](./consolidation.md), [->adts-and-matching.md](./adts-and-matching.md)

---
## [9][DEPENDENCY_MANAGEMENT]

[REFERENCE] Dependency workflow: CLAUDE.md section 4.1.
