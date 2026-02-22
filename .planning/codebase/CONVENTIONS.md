# Coding Conventions

**Analysis Date:** 2026-02-22

## Naming Patterns

**Files:**
- `kebab-case.ts` for all source files: `crypto.ts`, `cache.ts`, `tenant-lifecycle.ts`
- `*.spec.ts` suffix for all test files (never `*.test.ts`)
- No barrel files (`index.ts`) — consumers import directly from source path
- Config files use `*.config.ts` or `*.config.mjs` (only file type where default export is allowed)

**Classes / Services:**
- PascalCase class names: `CryptoError`, `PolicyService`, `DatabaseService`
- Service key format: `'namespace/ServiceName'` — e.g., `'server/CryptoService'`, `'server/Auth'`
- Error classes suffix with `Error`: `CryptoError`, `CircuitError`

**Functions and Constants:**
- Module-private constants prefixed with `_`: `_CONFIG`, `_registry`, `_encoder`, `_sqlClient`
- Private helpers prefixed with `_`: `_makeDlqWatcher`, `_provide`, `_isHttpError`
- Public functions: camelCase without prefix: `decode`, `encode`, `keyset`, `offset`, `strip`
- No abbreviations in params/fields: `ipAddress` not `ip`, `subscriber` not `sub`, `channel` not `ch`, `delta` not `d`

**Types:**
- Types derived from schemas: `type X = typeof XSchema.Type`
- Discriminated union tags: string literals matching class name exactly (`'Auth'`, `'CryptoError'`)
- No separate type declarations — derive via `pick`/`omit`/`partial` at call site

**Database Fields:**
- camelCase in TypeScript model fields: `appId`, `deletedAt`, `expiresAt`
- snake_case in SQL column names: `app_id`, `deleted_at`, `expires_at`
- Mapping lives exclusively in `packages/database/src/field.ts`

## Code Style

**Formatter:**
- Biome 2.4.4 (`biome.json`)
- Line width: 120 characters
- Indent: 4 spaces (NOT tabs)
- Line endings: LF
- Trailing commas: always (JS/TS), none (JSON)
- Quote style: single quotes for JS/TS strings and JSX attributes
- Semicolons: always
- Arrow function parens: always

**IMPORTANT:** Biome formatter is DISABLED for `apps/**/*.ts`, `packages/**/*.ts`, `tests/**/*.ts` (biome.json override lines 175-186). These files use manual formatting. The formatter runs only on config files, JSON, CSS, HTML.

**Linting (enforced as errors):**
- `noDefaultExport` — named exports only (except `*.config.ts`)
- `noExplicitAny` — no `any`; use branded types or `unknown`
- `useConst` — `const` only, never `let` or `var`
- `noBarrelFile` / `noReExportAll` — no barrel files, no re-export-all
- `noImportCycles` — circular imports forbidden
- `noFloatingPromises` — all promises must be awaited or wrapped
- `useExhaustiveSwitchCases` — switch must cover all cases (prefer `Match` instead)
- `noIncrementDecrement` — use `n + 1` not `n++`
- `noParameterAssign` — never reassign parameters
- Max cognitive complexity: 30 per function (45 for `menu.tsx`)

## File Section Organization

All source files follow this canonical section order (omit unused sections):

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

Section separator format: `// --- [LABEL] ` padded with dashes to column 80.

Domain extensions inserted after corresponding core section:
- `[TABLES]` after SCHEMA (database files)
- `[REPOSITORIES]` after SERVICES (database files)
- `[GROUPS]` after SCHEMA (API files)
- `[MIDDLEWARE]` after SERVICES (API files)

Forbidden labels: `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.

## Import Organization

Biome `organizeImports` is OFF for all source files (biome.json override). Imports are manually ordered:

1. Node built-ins (`node:crypto`, `node:path`)
2. Third-party packages (`@effect/platform`, `effect`, `@effect/sql`)
3. Internal monorepo packages (`@parametric-portal/database/models`, `@parametric-portal/types/types`)
4. Relative imports (`'../context.ts'`, `'./env.ts'`)

Use `import type` for type-only imports (Biome `useImportType` enforced as error).

**No re-exporting external lib types** — consumers import directly from the library.

## Effect Composition Patterns

**Use `pipe()` for linear flows:**
```typescript
Effect.fail(new CryptoError(...)).pipe(
    Effect.mapError((error) => new CryptoError({ cause: error, code: 'INVALID_FORMAT', op: 'key', tenantId: ... })),
);
```

**Use `Effect.gen` for 3+ dependent operations or control flow:**
```typescript
Effect.gen(function* () {
    const env = yield* Env.Service;
    const parsed = yield* Option.match(multiKeyConfig, { ... });
    const keys = yield* Effect.forEach(parsedEntries, (entry) => ...);
    return { keys };
})
```

**Use `Match.value` / `Match.when` instead of if/switch:**
```typescript
Match.value(entry.attempts).pipe(
    Match.when((attempts) => attempts > dlqConfig.dlqMaxRetries, () => Effect.void),
    Match.when((attempts) => attempts === dlqConfig.dlqMaxRetries, (attempts) => ...),
    Match.orElse(() => ...),
)
```

**Use `Effect.filterOrFail` instead of if-guards:**
```typescript
yield* Effect.filterOrFail(
    Effect.succeed(HashMap.has(keys, currentVersion)),
    Boolean,
    () => new CryptoError({ code: 'KEY_NOT_FOUND', op: 'key', tenantId: ... }),
);
```

**Never `async/await` inside Effect code** — use `Effect.promise`, `Effect.tryPromise`.

## Error Handling

**HTTP errors** (`packages/server/src/errors.ts`): `Schema.TaggedError` with `HttpApiSchema.annotations()`. Static `.of()` factory on each class. `HttpError.mapTo('label')` wraps unknown errors as `Internal`.

**Domain errors**: `Data.TaggedError('ErrorName')` with typed fields `code`, `op`, optional `cause`. Small unions (3-5 variants per service).

**Never** `try/catch`, string errors, or generic `Error` in Effect code.

**Error namespace pattern** (const+namespace merge):
```typescript
const HttpError = { ...errorClasses, is: _isHttpError, mapTo: _mapToHttpError } as const;
namespace HttpError { export type Any = ...; export type Auth = ...; }
export { HttpError };
```

## Service Pattern

Canonical `Effect.Service` shape:
```typescript
class Service extends Effect.Service<Service>()('namespace/ServiceName', {
    scoped: Effect.gen(function* () {
        const dep = yield* Dependency;
        const _helper = (arg: string) => dep.doWork(arg);
        return { method: _helper } as const;
    }),
}) {}
```

- `scoped` (not `effect`) when service needs cleanup
- Scoped constructor yields all deps once, defines helpers as closures
- Returns object literal with `as const`
- No constructors, no `new` on service class — use `Effect.Service`

## Constants Pattern

Module-level config as `_CONFIG` with `as const`:
```typescript
const _CONFIG = {
    cache: { capacity: 1000, ttl: Duration.hours(24) },
    iv: 12,
    key: { length: 256, name: 'AES-GCM' } as const,
} as const;
```

Static data maps for immutable lookups:
```typescript
const _ERROR_PROPS = {
    AlreadyCancelled: { retryable: false, terminal: true },
    HandlerMissing:   { retryable: false, terminal: true },
} as const satisfies Record<typeof _ErrorReason.Type, { retryable: boolean; terminal: boolean }>;
```

## Schema-First Types

Always derive types from schemas; never declare separately:
```typescript
const JobStatusSchema = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
type JobStatus = typeof JobStatusSchema.Type;  // derived, not declared separately
```

Decode at boundaries immediately — treat external data as `unknown`:
```typescript
yield* S.decodeUnknown(S.parseJson(S.Array(S.Struct({ key: S.String, version: S.Number }))))(rawJson)
```

## Logging

Use Effect's structured logger: `Effect.logInfo`, `Effect.logWarning`, `Effect.logError`.

Structured fields as second argument object with dot-notation keys:
```typescript
Effect.logWarning('DLQ entry exceeded max retries', { 'dlq.id': entry.id, 'dlq.max_retries': config.dlqMaxRetries })
```

Never `console.log` in production code (Biome warns; `console.error/warn/info/debug` are allowed).

## Comments

**JSDoc**: Module-level doc comment describing purpose and key design decisions only. One per file at the top.

**Inline comments**: Only `// Why:` prefix when explaining non-obvious intent. Never describe "what" the code does.

**Section labels**: `// --- [LABEL] ---...` are structural, not explanatory.

Examples from codebase:
```typescript
/** Pagination cursor encoding; fetch LIMIT+1 for accurate hasNext detection. */
// Why: Env is a plain object — Env.Service cannot appear in type position; extract via typeof.
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
```

## Module Size Cap

225 LOC maximum per source file. Split at domain boundaries, never by helper extraction.

One `Effect.Service` class per module. Capabilities grouped as `{ read, write, observe } as const`.

## Export Pattern

Declare first, export at file end. Named exports only. Export at bottom in `// --- [EXPORT] ---` section:

```typescript
export { HttpError };
export { Page };
export type { CryptoError };
```

---

*Convention analysis: 2026-02-22*
