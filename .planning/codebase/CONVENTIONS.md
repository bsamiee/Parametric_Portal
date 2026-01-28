# Coding Conventions

**Analysis Date:** 2026-01-28

## Naming Patterns

**Files:**
- Source files: `kebab-case.ts` (e.g., `auth.ts`, `transfer.ts`, `session.ts`)
- Test files: Not detected in packages (tests appear to be in root `tests/` directory)
- Config files: `name.config.ts` (e.g., `vite.config.ts`, `vitest.config.ts`)
- Type definitions: `name.d.ts` (e.g., `env.d.ts`)

**Functions:**
- Exported functions: `camelCase` (e.g., `handleExport`, `handleImport`, `requireOption`)
- Service methods: `camelCase` (e.g., `byEmail`, `softDelete`, `create`)
- Effect-wrapped functions: Use `Effect.fn('namespace.operation')` for traced functions
- Pure functions: Regular camelCase without Effect wrapper

**Variables:**
- Constants: `PascalCase` for schemas and configurations (e.g., `ThemeConfigSchema`, `B` for bundled constants)
- Regular variables: `camelCase`
- Immutable config objects: Use `const` with `as const` assertion, stored in `B` constant

**Types:**
- Type aliases: `PascalCase` (e.g., `ThemeConfig`, `ColorSpec`, `BatchResult`)
- Branded types: `PascalCase` with schema companion (e.g., `Timestamp`, `Uuidv7`, `Hex64`)
- Schema types: Derived from schema via `typeof XSchema.Type`
- Error types: `PascalCase` class names extending `S.TaggedError` or `Data.TaggedError`

## Code Style

**Formatting:**
- Tool: Biome 1.x
- Line width: 120 characters
- Indent: 4 spaces (tabs disabled)
- Line ending: LF
- Quote style: Single quotes for JS/TS, single quotes for JSX
- Semicolons: Always required
- Trailing commas: Always (all contexts)
- Arrow parens: Always (even for single parameters)

**Linting:**
- Tool: Biome (replaces ESLint)
- Config: `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/biome.json`
- Key enforced rules:
  - `noUnusedImports: error` - No unused imports allowed
  - `noUnusedVariables: error` - No unused variables
  - `noDefaultExport: error` - Named exports only (except `*.config.ts`)
  - `noExplicitAny: error` - Never use `any` type
  - `noVar: error` - Use `const`/`let` only
  - `useConst: error` - Prefer `const` over `let`
  - `useTemplate: error` - Use template literals over concatenation
  - `useImportType: error` - Use `import type` for type-only imports
  - `noForEach: off` - Array.forEach is allowed
  - `useForOf: off` - Traditional for-of disabled in favor of functional patterns
  - `noIncrementDecrement: error` - No `++`/`--` operators
  - `noFloatingPromises: error` - All promises must be handled
  - `noExcessiveCognitiveComplexity: error` - Max complexity 30 (45 for specific files)

## Import Organization

**Order:**
1. External dependencies (`@effect/platform`, `effect`, etc.)
2. Internal packages (`@parametric-portal/*`)
3. Relative imports from same package (`./`, `../`)

**Path Aliases:**
- Direct package imports: `@parametric-portal/package-name/module`
- No barrel files (`index.ts`) - import directly from source files
- TypeScript path resolution via `tsconfig.base.json` with `moduleResolution: "bundler"`

**Import Style:**
- Named imports only (no default exports except config files)
- Type-only imports: `import type { X } from 'y'`
- Namespace imports for Effect stdlib: `import { Schema as S } from 'effect'`
- Common Effect namespace aliases:
  - `Schema as S`
  - `Array as A`
  - `Record as R`
  - `Function as F`

## Error Handling

**Patterns:**
- Never use `try/catch` in Effect code
- Use Effect error channel with typed errors
- Domain errors: `Data.TaggedError` (e.g., `class Browser extends Data.TaggedError('Browser')`)
- HTTP errors: `Schema.TaggedError` with `HttpApiSchema.annotations({ status: 401 })`
- Static factory methods: `static readonly of = (details: string) => new ErrorClass({ details })`
- Error recovery: Use `Effect.catchTag`, `Effect.catchAll`, `Option.match`
- Namespace pattern for grouped errors:
  ```typescript
  const HttpError = { Auth, NotFound, Forbidden } as const;
  namespace HttpError {
    export type Any = Auth | NotFound | Forbidden;
  }
  ```

**Error Mapping:**
- Use `Match.value().pipe(Match.when, Match.orElse)` to classify errors
- Always provide context in error messages (resource ID, operation name)
- Map generic errors to domain errors at boundaries

## Logging

**Framework:** Effect built-in logging via `Effect.log*` functions

**Patterns:**
- Debug: `Effect.logDebug`
- Info: `Effect.logInfo`
- Warning: `Effect.logWarning`
- Error: `Effect.logError('message', { error: String(err), context })`
- Structured logging: Pass object as second parameter with relevant context
- Trace spans: Use `Telemetry.span(effect, 'span.name')` or `Effect.withSpan('name', { kind: 'server' })`
- Annotate spans: `Effect.annotateCurrentSpan('key', value)` for contextual metadata

## Comments

**When to Comment:**
- File-level JSDoc explaining module purpose (e.g., security architecture notes in `auth.ts`)
- Complex algorithms requiring "why" explanation
- Design trade-offs and architectural decisions
- Security considerations marked with `[SECURITY_DESIGN]`
- Architecture notes marked with `[ARCHITECTURE]`, `[GROUNDING]`, `[CRITICAL]`

**JSDoc/TSDoc:**
- File-level JSDoc for route handlers and service modules
- Parameter documentation: Not heavily used; rely on TypeScript types
- Return value documentation: Only when non-obvious
- Examples: Provided in `REQUIREMENTS.md`, not inline

**Forbidden:**
- Comments describing "what" the code does (code should be self-documenting)
- Redundant comments repeating variable names
- Commented-out code

## Function Design

**Size:**
- No strict limit, but prefer functions under 50 lines
- Complex flows: Use `Effect.gen` for readability
- Biome enforces max cognitive complexity of 30 (configurable per file)

**Parameters:**
- Use object parameters for 3+ arguments
- Destructure in function signature when appropriate
- Service dependencies: Yield from Effect context, don't pass as parameters

**Return Values:**
- Effectful operations: Return `Effect<Success, Error, Requirements>`
- Pure functions: Return plain values (A → B)
- Use `Effect.succeed` for immediate values in Effect context
- Never return `void` - use `Effect.void` or `Effect.asVoid` in Effect context

## Module Design

**Exports:**
- Named exports only (except `*.config.ts` files)
- Group related exports in const+namespace merge pattern:
  ```typescript
  const HttpError = { Auth, NotFound } as const;
  namespace HttpError {
    export type Any = Auth | NotFound;
  }
  export { HttpError };
  ```
- Declare first, export at file end under `// --- [EXPORT]` section

**Barrel Files:**
- FORBIDDEN - Biome enforces `noBarrelFile: error`
- Consumers import directly from source: `@parametric-portal/server/errors` not `@parametric-portal/server`

**File Sections:**
Use standardized section separators (dashes to column 80):
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

Domain-specific sections:
- `[PURE_FUNCTIONS]` - Pure transformation functions
- `[EFFECT_PIPELINE]` - Effect orchestration
- `[OAUTH_HANDLERS]`, `[SESSION_HANDLERS]`, `[MFA_HANDLERS]` - Domain-specific handler groups

---

*Convention analysis: 2026-01-28*
