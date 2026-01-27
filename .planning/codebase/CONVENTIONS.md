# Coding Conventions

**Analysis Date:** 2026-01-26

## Naming Patterns

**Files:**
- Lowercase with hyphens for multi-word files: `totp-replay.ts`, `purge-assets.ts`, `rate-limit.ts`
- Descriptive names reflecting domain/layer: `mfa.ts` (domain), `crypto.ts` (security), `audit.ts` (observe)
- No index/barrel files per biome linter enforcement

**Functions:**
- Constant functions prefixed with `_` indicating private scope: `_dbErr()`, `_parseOperation()`, `_extractClientIp()`
- Public functions use camelCase: `enroll()`, `verify()`, `useRecoveryCode()`, `deriveKey()`
- Effect-wrapped functions use `Effect.fn('name')` for automatic tracing: `Effect.fn('audit.log')`
- Arrow functions for functional transforms: `(s) => s.split(',')`

**Variables:**
- Const-only enforcement via biome linter (no let/var)
- Private module state prefixed with `_`: `_config`, `_ref`, `_cookie`, `_trustedCidrs`, `_securityOps`
- Options and Record types use PascalCase for class names: `AuthResponse`, `KeysetResponse`, `TransferQuery`
- Immutable config objects marked `as const satisfies`: `_cookie satisfies Record<string, {...}>`

**Types:**
- Derived from schemas where possible: `type X = typeof XSchema.Type`
- Branded types via `Schema.brand()` for domain primitives
- Namespace pattern for organizing related exports: `HttpError.Auth`, `Context.Request`
- Union types use discriminated unions with tagged errors: `HttpError.Auth | HttpError.Conflict | ...`

## Code Style

**Formatting:**
- Line width: 120 characters
- Indent: 4 spaces
- Semicolons: always
- Quotes: single quotes (`'text'`)
- Trailing commas: all (arrays/objects)
- Arrow function parens: always (`(x) =>` not `x =>`)
- Tool: Biome 2.3.13

**Linting:**
- Tool: Biome 2.3.13
- Domains: react, project, test (all enabled)
- Key rules enforced:
  - `noDefaultExport`: error (except `*.config.ts`)
  - `noUnusedImports`: error
  - `noUnusedVariables`: error
  - `noExplicitAny`: error
  - `useConst`: error (all const, no let/var)
  - `noVar`: error
  - `useArrowFunction`: error
  - `useExhaustiveSwitchCases`: error
  - `noImportCycles`: error
  - `noFloatingPromises`: error (in Effect context)
  - `noConsole`: warn (allowed: assert, debug, error, info, trace, warn)
  - `noBannedTypes`: error
  - `noExcessiveCognitiveComplexity`: 30 max
  - Cognitive complexity relaxed to 45 in special cases: `packages/components-next/src/menu/menu.tsx`

## Import Organization

**Order:**
1. Node.js built-ins (`node:*` imports)
2. Third-party packages (standard imports)
3. Third-party Effect packages (`@effect/*`)
4. Workspace packages (`@parametric-portal/*`)
5. Local imports (`./*`)

**Path Aliases:**
- No path aliases used; direct relative imports from source
- Workspace packages referenced by full paths: `@parametric-portal/server/domain/mfa`

**Barrel Files:**
- Explicitly prohibited by biome `noBarrelFile: error`
- Consumers import directly from source files
- Re-exports only in package.json exports field (not in code)

## Error Handling

**Patterns:**
- Domain errors extend `Schema.TaggedError` for serializable HTTP errors: `Auth`, `Conflict`, `Forbidden`, `Validation`, etc.
- Each error class has static `of()` factory: `HttpError.Auth.of('reason', cause?)`
- Errors include `message` getter for logging: `\`Auth: ${this.details}\``
- Effect error channel used exclusively: no `try/catch` in Effect code
- Match pattern for exhaustive error handling via `Effect.catchTag`: `Effect.catchTag('CryptoEncryptError', handler)`
- Errors as values not exceptions; discrimination via tagged union types

**Error Categories:**
- HTTP errors: `HttpError.*` (Auth, Conflict, Forbidden, GatewayTimeout, Gone, Internal, NotFound, OAuth, RateLimit, ServiceUnavailable, Validation)
- Domain errors: `Data.TaggedError` for internal service failures (CryptoEncryptError, DecryptError)
- Conversion: Schema errors converted at boundaries immediately

## Logging

**Framework:** Effect's built-in logging via `Effect.logInfo`, `Effect.logWarning`, `Effect.logError`

**Patterns:**
- Log at decision boundaries (auth success/failure, audit events)
- Include context: `{ requestId, operation, subject, tenantId }`
- Structured logging: objects, not string interpolation
- Log levels:
  - `Info`: Configuration loaded, service initialized
  - `Warning`: Malformed operations, missing context, degraded features
  - `Error`: Unrecoverable failures, external service timeouts

**Audit Logging:**
- Polymorphic operation format: `'Subject.operation'` (business) or `'operation'` (security)
- Recorded via `AuditService.log()` with before/after diffs
- Dead-letter queue enabled via `AUDIT_DEAD_LETTER_FILE` env var

**Telemetry:**
- Structured tracing via `Effect.withSpan('name')` on critical operations
- Annotations via `Effect.annotateCurrentSpan('key', value)`
- Metrics via `MetricsService.inc(counter, labels, delta)`

## Comments

**When to Comment:**
- Algorithm explanation: TOTP verification logic, keyset pagination cursors
- Non-obvious design decisions: why tenant keys cached, why backup codes hashed
- Biome directives: `// biome-ignore lint/rule: reason` for rule exceptions
- Complex regex/transforms: commented inline

**JSDoc/TSDoc:**
- Used at service/module level describing purpose and dependencies
- Example: `packages/server/src/context.ts` header describes FiberRef usage
- Not on every function; reserved for public APIs and complex behaviors
- Never re-exports from external types; consumers import directly

## Function Design

**Size:**
- Most functions 5-20 lines
- Complex operations wrapped in `Effect.gen` with multiple yields
- Stream operations use Stream API for iteration logic

**Parameters:**
- Prefer destructured objects for config/options: `config?: { readonly subjectId?: string; ... }`
- Effect-returning functions explicitly typed: `Effect.Effect<A, E, R>`
- Readonly modifiers on input parameters and record keys

**Return Values:**
- Effect-wrapped for IO/errors/dependencies
- Tagged error unions in error channel: `Effect.Effect<T, HttpError.Auth | HttpError.Internal, R>`
- Option used for nullable values: `Option.Option<T>` not `T | null`
- Never implicit undefined; use Option or Effect.fail

## Module Design

**Exports:**
- Named exports only
- Single class per module or a const namespace wrapper
- Example: `const HttpError = { Auth, Conflict, ... } as const` with namespace merging
- Services exported as Effect.Service classes: `class AuditService extends Effect.Service<AuditService>()`

**File Organization:**
- Section separators: `// --- [LABEL] ` followed by dashes to column 80
- Canonical order (omit unused sections):
  1. `[TYPES]` — Type aliases, inferred types, discriminated unions
  2. `[SCHEMA]` — @effect/schema definitions, branded types
  3. `[CONSTANTS]` — Immutable config with `as const`
  4. `[ERRORS]` — Data.TaggedError or Schema.TaggedError definitions
  5. `[SERVICES]` — Effect.Service definitions or factory functions
  6. `[FUNCTIONS]` — Pure functions + Effect pipelines
  7. `[LAYERS]` — Layer composition, composition root
  8. `[EXPORT]` — Named exports or namespace merging

**Domain Extensions:**
- Database: `[TABLES]` after [SCHEMA], `[REPOSITORIES]` after [SERVICES]
- API: `[GROUPS]` after [SCHEMA], `[MIDDLEWARE]` after [SERVICES]
- HTTP: `[HTTP_SCHEMAS]` for API contract shapes
- Observability: metrics/traces inline with service methods

## Effect Patterns

**Composition:**
- Use `pipe()` for left-to-right linear flows
- Use `Effect.gen` for 3+ dependent operations or control flow
- Use `Effect.all` to aggregate independent effects
- Chain with `flatMap`/`andThen`: `Effect.flatMap((x) => ...)`
- Side effects: `Effect.tap` without changing value

**Service Definition:**
- Extend `Effect.Service<T>()` class pattern
- Provide via `scoped` or `effect` generator
- Expose methods as `Effect.fn('name')(...)` for tracing
- Layer composition via `Layer.provideMerge` with explicit dependencies

**Pattern matching:**
- Use `Match.type` for exhaustive variant handling
- Use `Option.match` for Option discrimination
- Use `Effect.matchEffect` for effect-returning handlers
- Avoid if/else when exhaustive matching available

## Polymorphic Unity

**Core Principle:** Single intelligent functions with discriminated behavior, not explosion of variants.

**Metrics Ownership:**
- ALL metrics defined in `MetricsService` only — never local `_metrics` objects in module files
- Modules emit via `MetricsService.inc(service.counter, labels)` accessing the service
- Add new metric namespaces to MetricsService when needed (e.g., `cache: { hits, misses }`)

**Anti-Pattern — Const Spam:**
```typescript
// BAD: Separate functions for each variant
const _emitHitMetric = (name: string) => ...
const _emitMissMetric = (name: string) => ...

// GOOD: Single polymorphic function
const _emitMetric = (type: 'hit' | 'miss', name: string) => ...
```

**Anti-Pattern — Accessor Explosion:**
```typescript
// BAD: Separate functions for optional/required
const read = (schema) => ...
const readOptional = (schema) => ...

// GOOD: Single intelligent function
const read = <S>(schema: S, opts?: { optional?: boolean }) => ...
// Or use existing context.ts pattern: onNone callback
```

**Anti-Pattern — "with" Wrapper Explosion:**
```typescript
// BAD: Explosion of optional wrappers
sse, sseTracked, withBuffer, withCircuit, withProgress

// GOOD: Single function with intelligent defaults
sse(stream, { name: '...' })  // metrics, buffer, circuit automatic
```

**Anti-Pattern — Loose Type Spam:**
```typescript
// BAD: Standalone interface definitions
interface CacheConfig<K, V, E, R> { ... }
interface CacheInstance<K, V, E, R> { ... }
interface CacheStats { ... }

// GOOD: Types derived from functions in namespace
namespace Cache {
  export type Config<K, V, E, R> = Parameters<typeof make<K, V, E, R>>[0]
  export type Instance<K, V, E, R> = ReturnType<typeof make<K, V, E, R>>
}
```

**Automatic Defaults:**
- Metrics emission is automatic when MetricsService in context (use `Effect.serviceOption`)
- Buffer configuration has smart defaults per stream type
- Circuit breaker integration automatic for external calls
- Tenant isolation automatic via FiberRef context
- User configures behavior, not ceremony

**Reference Implementation:** `observe/metrics.ts`, `context.ts`, `security/circuit.ts`

---

*Convention analysis: 2026-01-26*
*Polymorphic unity added: 2026-01-27*
