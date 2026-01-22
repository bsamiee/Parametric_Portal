---
description: Technical specification and quality standards for Parametric Portal
alwaysApply: true
---

# Parametric Portal — Technical Specification

## [1][CONSTRAINTS]

[APPROACH] Surgical, targeted changes. Examine existing patterns before proposing. Minimal modifications.

[FORBIDDEN]:
- NEVER create wrappers adding no semantic value beyond delegation
- NEVER create barrel files (`index.ts`); consumers import directly from source
- NEVER re-export external lib types; import directly from ts-toolbelt, ts-essentials, type-fest
- NEVER use inline exports; declare first, export at file end
- NEVER write comments describing what; reserve for why
- NEVER hand-roll utilities that exist in external libs
- NEVER duplicate type definitions; derive from schema/tables
- NEVER declare types separately from schemas

[REQUIRED]:
- Replace `any` with branded types via Schema
- Replace `try/catch` with Effect error channel
- Replace `for/while` with `.map`, `.filter`, or Effect.forEach
- Replace `let`/`var` with `const`
- Replace default exports with named exports (exception: `*.config.ts`)
- Derive types from schemas: `type X = typeof XSchema.Type`
- Use `as const` for immutable config objects
- Decode at boundaries; treat external data as `unknown`

[CONDITIONAL]:
- PREFER `Match.type`/`Match.value` for exhaustive variant handling
- ALLOW dispatch tables for simple key→value maps
- ALLOW ternary for binary conditions

---
## [2][CONTEXT]

### [2.1][TOOLING]

[STACK]: TypeScript 6.0-dev, React 19 canary, Vite 7, Tailwind v4, LightningCSS, Nx 22 Crystal.
[BUILD]: Nx distributed caching + affected commands. Single `vite.factory.ts` extended per package.
[CLI]: Always run Nx via `pnpm exec nx <command>`. Never use bare `nx`.
[QUALITY]: Biome for lint + format. Vitest for tests. SonarCloud for static analysis.

### [2.2][BOUNDARY_DISCIPLINE]

Data crossing system boundaries follows 3-level model:

| [INDEX] | [LEVEL]     | [SEMANTICS]                           | [LOCATION]           |
| :-----: | ----------- | ------------------------------------- | -------------------- |
|   [1]   | Encoded     | Wire format, might be malformed       | Boundary adapters    |
|   [2]   | Validated   | Runtime-checked, safe to operate on   | After Schema.decode  |
|   [3]   | Domain      | Branded primitives, semantic aliases  | Core business logic  |

[CRITICAL]: Domain code accepts branded primitives, never raw `string`/`number`.

---
## [3][CODE_STANDARDS]

**[CORE]**: Schema-first types. Effect for orchestration. Pure functions for computation. Match for exhaustive handling.

**[COMPOSITION]**: Functional core computes; effectful shell orchestrates IO/errors/dependencies.

---
### [3.1][SCHEMA_FIRST]

[IMPORTANT] Single source of truth for types and validation.

```typescript
import { Schema as S } from 'effect'

// Schema defines structure + validation + brand
const UserIdSchema = S.String.pipe(
  S.pattern(/^usr_[a-z0-9]{24}$/),
  S.brand('UserId'),
)

// Type derived—never declared separately
type UserId = typeof UserIdSchema.Type

// Decode at boundary
const decodeUserId = S.decodeUnknown(UserIdSchema)
```

---
### [3.2][TYPED_ERRORS]

[IMPORTANT] Errors are tagged values with exhaustive handling.

```typescript
import { Data, Match } from 'effect'

// Domain errors via Data.TaggedError
class NotFound extends Data.TaggedError('NotFound')<{
  readonly resource: string
  readonly id?: string
}> {
  get message() {
    return this.id
      ? `${this.resource}/${this.id} not found`
      : `${this.resource} not found`
  }
}

class Unauthorized extends Data.TaggedError('Unauthorized')<{
  readonly reason: string
}> {}

// Exhaustive handling via Match
const handleError = (error: NotFound | Unauthorized) =>
  Match.value(error).pipe(
    Match.tag('NotFound', (e) => ({ status: 404, body: e.message })),
    Match.tag('Unauthorized', (e) => ({ status: 401, body: e.reason })),
    Match.exhaustive,
  )
```

---
### [3.3][PATTERN_MATCHING]

[IMPORTANT] Use Match for exhaustive variant handling.

```typescript
import { Match, Schema as S } from 'effect'

// Discriminated union
const Shape = S.Union(
  S.Struct({ _tag: S.Literal('Circle'), radius: S.Number }),
  S.Struct({ _tag: S.Literal('Rect'), width: S.Number, height: S.Number }),
)
type Shape = typeof Shape.Type

// Match.type for exhaustive handling (compiler error if cases missing)
const area = Match.type<Shape>().pipe(
  Match.tag('Circle', ({ radius }) => Math.PI * radius ** 2),
  Match.tag('Rect', ({ width, height }) => width * height),
  Match.exhaustive,
)

// Match.value for single-value matching
const formatStatus = (code: number) =>
  Match.value(code).pipe(
    Match.when(200, () => 'OK'),
    Match.when(404, () => 'Not Found'),
    Match.orElse(() => 'Unknown'),
  )
```

---
### [3.4][EFFECT_SERVICES]

[IMPORTANT] Use Effect.Service for application services.

```typescript
import { Effect, Layer } from 'effect'

// Service definition with Effect.Service
class UserRepo extends Effect.Service<UserRepo>()('UserRepo', {
  effect: Effect.gen(function* () {
    // Acquire dependencies
    // const sql = yield* SqlClient
    return {
      findById: (id: UserId) => Effect.succeed({ id, name: 'Test' }),
      create: (data: CreateUser) => Effect.succeed({ id: UserId.make(), ...data }),
    }
  }),
}) {}

// Usage: yield* ServiceTag
const program = Effect.gen(function* () {
  const repo = yield* UserRepo
  return yield* repo.findById(userId)
})

// Provide at composition root
program.pipe(Effect.provide(UserRepo.Default))
```

---
### [3.5][EFFECT_COMPOSITION]

[IMPORTANT] Effect orchestrates; pure functions compute.

```typescript
import { Effect, pipe } from 'effect'

// Pure function: A → B (no Effect wrapper)
const normalize = (name: string) => name.trim().toLowerCase()

// Effect.all for aggregating independent effects
const fetchUserData = (id: UserId) =>
  Effect.all({
    user: UserRepo.findById(id),
    perms: PermissionRepo.findByUser(id),
    prefs: PreferenceRepo.findByUser(id),
  })

// Effect.gen for sequential operations with control flow
const processUser = (id: UserId) =>
  Effect.gen(function* () {
    const user = yield* UserRepo.findById(id)
    if (!user) {
      return yield* Effect.fail(new NotFound({ resource: 'User', id }))
    }
    const normalized = normalize(user.name) // Pure function call
    return yield* UserRepo.update(id, { name: normalized })
  })

// pipe for linear transformations
const getActiveUsers = pipe(
  UserRepo.findAll(),
  Effect.map((users) => users.filter((u) => u.active)),
  Effect.map((users) => users.map((u) => u.id)),
)
```

---
### [3.6][IMMUTABLE_CONFIG]

[IMPORTANT] Use `as const` for configuration objects.

```typescript
// Config with as const (Object.freeze unnecessary)
const config = {
  timeoutMs: 5000,
  maxAttempts: 3,
  backoffMs: 1000,
} as const

// satisfies validates shape while preserving literals
const mimeTypes = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  document: ['application/pdf', 'text/plain'],
} as const satisfies Record<string, readonly string[]>

// Type derived from config
type MimeCategory = keyof typeof mimeTypes
type MimeType = (typeof mimeTypes)[MimeCategory][number]
```

---
### [3.7][LAYERS]

[IMPORTANT] Compose layers once at composition root.

```typescript
import { Layer } from 'effect'

// Infrastructure layers (no dependencies)
const ConfigLive = Layer.succeed(Config, loadConfig())

// Service layers (depend on infra)
const UserRepoLive = Layer.effect(UserRepo, Effect.gen(function* () {
  const db = yield* Database
  return createUserRepo(db)
}))

// Composition root: single point of Layer wiring
const AppLive = Layer.mergeAll(
  UserRepoLive,
  PermissionRepoLive,
).pipe(
  Layer.provide(DatabaseLive),
  Layer.provide(ConfigLive),
)

// Run program with all dependencies
Effect.runPromise(program.pipe(Effect.provide(AppLive)))
```

---
## [4][FILE_ARCHITECTURE]

### [4.1][SECTION_ORGANIZATION]

**Separator Format**: `// --- [LABEL] ` + dashes to column 80

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

**Canonical Sections** (omit unused):

| [INDEX] | [SECTION]      | [CONTAINS]                                    |
| :-----: | -------------- | --------------------------------------------- |
|   [1]   | `[TYPES]`      | Type aliases, inferred types, unions          |
|   [2]   | `[SCHEMA]`     | Schema definitions, branded types             |
|   [3]   | `[CONSTANTS]`  | Immutable config with `as const`              |
|   [4]   | `[ERRORS]`     | Data.TaggedError definitions                  |
|   [5]   | `[SERVICES]`   | Effect.Service definitions                    |
|   [6]   | `[FUNCTIONS]`  | Pure functions + Effect pipelines             |
|   [7]   | `[LAYERS]`     | Layer composition                             |
|   [8]   | `[EXPORT]`     | Named exports                                 |

**Domain Extensions**:
- Database: `[TABLES]` after SCHEMA, `[REPOSITORIES]` after SERVICES
- API: `[GROUPS]` after SCHEMA, `[MIDDLEWARE]` after SERVICES

**FORBIDDEN labels**: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`, `Namespace_Objects`.

---
## [5][MONOREPO_TOPOLOGY]

>**Dictum:** *Packages export mechanisms; apps define values.*

| [INDEX] | [LAYER]      | [OWNS]                                              |
| :-----: | ------------ | --------------------------------------------------- |
|   [1]   | `packages/*` | Types, schemas, factories, pure functions, CSS slots |
|   [2]   | `apps/*`     | CSS values, factory invocations, visual overrides   |

**FORBIDDEN**: Color/font/spacing literals in `packages/*`.
