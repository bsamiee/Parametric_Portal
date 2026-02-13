# Coding Conventions

**Analysis Date:** 2026-02-13

## Naming Patterns

**Files:**
- TypeScript modules: `camelCase` (e.g., `auth.ts`, `userService.ts`)
- React components: `PascalCase` (e.g., `Button.tsx`, `Modal.tsx`)
- Test files: `snake_case.spec.ts` or `snake_case.test.ts` (e.g., `errors.spec.ts`)
- Private/internal modules: prefix with underscore `_` (e.g., `_config`, `_helpers`)
- Configuration files: allow kebab-case (e.g., `biome.json`, `vitest.config.ts`)

**Functions:**
- Named functions: `camelCase` (e.g., `createUser`, `validateEmail`)
- Private functions: prefix with `_` (e.g., `_validateInput`, `_formatDate`)
- Hook functions (React): `useCamelCase` (e.g., `useAsyncAnnounce`, `useMessageListener`)
- Service methods: `camelCase` (e.g., `AuthService.createSession`, `CacheService.kv.set`)
- Arrow functions discouraged for named exports; use `const` + `=` (e.g., `const sendMessage = ()`)

**Variables:**
- Constants: `UPPER_SNAKE_CASE` for module-level immutable config
- Private config objects: `_camelCase` (e.g., `_CONFIG`, `_defaults`)
- Regular variables: `camelCase` (e.g., `userData`, `requestCount`)
- Loop variables: no single-letter abbreviations; use full names (e.g., `subscriber` not `s`, `channel` not `ch`)
- Destructured imports: use full names or widely accepted aliases (`S` for Schema, `A` for Array, `F` for Function from Effect ecosystem)

**Types:**
- Type definitions: `PascalCase` (e.g., `AuthState`, `UserPayload`)
- Union/discriminated types: `PascalCase` (e.g., `HttpError`, `AsyncState`)
- Generic parameters: `PascalCase` (e.g., `<T>`, `<E>`, `<R>`)
- Branded types: `PascalCase` with meaningful suffix (e.g., `Hex64`, `UserId`)
- Error types: extend pattern `${Name}Error` via `S.TaggedError` (e.g., `AuthError`, `ValidationError`)

**Classes:**
- Effect.Service instances: `PascalCase` + `Service` suffix (e.g., `AuthService`, `CacheService`)
- Error classes: derive from `S.TaggedError` with static `of()` factory (e.g., `HttpError.Auth`)
- Namespace exports: match class name (e.g., `namespace HttpError`)

**Constants & Presets:**
- Config maps: `PRESETS` or `_CONFIG` with readonly structure
- Immutable data: `as const` at declaration (no `Object.freeze`)
- Magic numbers: extract to named constants with context (e.g., `maxAttempts: 5`)

## Code Style

**Formatting:**
- Tool: Biome 2.3.15
- Indent: 4 spaces (PEP 8 style, not tabs)
- Line width: 120 characters
- Quotes: single quotes (`'`) for strings and JSX attributes
- Trailing commas: all (in arrays/objects)
- Semicolons: always
- Arrow parentheses: always (e.g., `(x) => x + 1` not `x => x + 1`)

**Biome Formatter Disabling:**
- Special files have formatter disabled to preserve custom formatting:
  - `packages/server/src/**/*.ts` - preserves Effect pipeline inlining
  - `packages/database/src/**/*.ts` - preserves schema definitions
  - `packages/theme/**/*.css` - preserves CSS structure
  - `**/matchers.ts`, `**/types/src/*.ts` - preserves type aliases
- When editing these files, manually maintain 4-space indentation

**Linting:**
- Tool: Biome with strict rules enabled
- No default exports except `*.config.ts` files
- `noExplicitAny`: error (use branded types via Schema)
- `useConst`: error (never use `let`/`var`)
- `noVar`: error
- `noUnusedImports`: error
- `noUnusedVariables`: error
- `useForOf`: off (prefer `.map()`, `.filter()`, `Effect.forEach`)
- `noConsole`: warn (allow: debug, error, info, trace, warn)
- `noImportCycles`: error
- `noFloatingPromises`: error

## Import Organization

**Order (left-to-right, grouped):**
1. External packages (node:*, effect, @effect/*, third-party libs)
2. Workspace packages (@parametric-portal/*)
3. Local relative imports (./*, ../*)
4. Type imports: `import type` for types only

**Example from `packages/server/src/domain/auth.ts`:**
```typescript
import { HttpTraceContext } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { OAuthProviderSchema, Session } from '@parametric-portal/database/models';
import { DatabaseService } from '@parametric-portal/database/repos';
import type { Hex64 } from '@parametric-portal/types/types';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { Array as A, Clock, Config, DateTime, Duration, Effect, Match, Option, pipe } from 'effect';
import { Context } from '../context.ts';
import { HttpError } from '../errors.ts';
```

**Path Aliases:**
- All imports: direct file paths (no barrel files/index.ts)
- Workspace imports: full path from @parametric-portal/* (e.g., `@parametric-portal/database/models`)
- No re-exports of external library types; consumers import directly from source

**Biome Import Organization:**
- Automatically organized via `organizeImports` action
- Disabled for `packages/server/src/**/*.ts`, `packages/database/src/**/*.ts` to preserve manual grouping
- Manual organization follows the 3-group pattern above

## Error Handling

**Pattern: Schema.TaggedError**
- All domain errors: extend `S.TaggedError` (serializable, typed discriminated unions)
- All HTTP errors: extend `S.TaggedError` with `HttpApiSchema.annotations()` for status codes
- Single static `of()` factory per error class (e.g., `HttpError.Auth.of('reason', cause?)`)
- Error unions: keep small (3-5 variants per boundary)

**Example from `packages/server/src/errors.ts`:**
```typescript
class Auth extends S.TaggedError<Auth>()('Auth', {
    cause: S.optional(S.Unknown),
    details: S.String
}, HttpApiSchema.annotations({ description: 'Auth required', status: 401 })) {
    static readonly of = (details: string, cause?: unknown) => new Auth({ cause, details });
    override get message() { return `Auth: ${this.details}`; }
}
```

**Effect Error Channel:**
- All errors flow through `Effect.fail()`, never `throw` statements
- Catch via `Effect.catch*` operators (e.g., `Effect.catchTag('Auth', handler)`)
- Transform via `Effect.mapError()`, `HttpError.mapTo()` for wrapping
- No generic `Error` instances; use domain-specific tagged errors

## Logging

**Framework:** Console or Effect Logger (via Context)

**Patterns:**
- Do NOT log in domain functions; return errors as values
- Logging at service boundaries via `Logger` or telemetry context
- In packages/server: use `Telemetry` (route-level) or `Logger` (internal)
- In apps: wire telemetry context from server response
- Console logging: warn/error only in production, debug/info in development
- Sensitive data: use `Redacted` type for secrets, passwords, tokens

## Comments

**When to Comment:**
- Reserved for "why" explanations, not "what" the code does
- Precede complex algorithms or non-obvious decisions
- Document public APIs via JSDoc/TSDoc (for types, schemas)
- Link to related issues/tickets when reasoning changes

**JSDoc/TSDoc:**
- Required on exported functions, types, schemas
- Include `@param`, `@returns`, `@throws` for public APIs
- Example from `packages/server/src/domain/auth.ts`:
```typescript
/**
 * Unified authentication: OAuth flows, session lifecycle, MFA enrollment, WebAuthn credentials.
 * Rate-limited callbacks, TOTP/backup codes, passkey support, tenant-scoped token rotation.
 */
```

**Multi-line Comment:**
- Use `/** ... */` for JSDoc
- Avoid inline comments; extract logic to named functions instead

## File Organization (Section Separators)

**Canonical order** (omit unused sections):
```typescript
// --- [TYPES] -----------------------------------------------------------------
// Type aliases, inferred types, discriminated unions

// --- [SCHEMA] ----------------------------------------------------------------
// @effect/schema definitions, branded types

// --- [CONSTANTS] -------------------------------------------------------------
// Immutable config with `as const`

// --- [ERRORS] ----------------------------------------------------------------
// Data.TaggedError or Schema.TaggedError definitions

// --- [SERVICES] --------------------------------------------------------------
// Effect.Service definitions

// --- [FUNCTIONS] -------------------------------------------------------------
// Pure functions + Effect pipelines

// --- [LAYERS] ----------------------------------------------------------------
// Layer composition, composition root

// --- [EXPORT] ----------------------------------------------------------------
// Named exports at file end
```

**Section Length:** Use dashes to reach column 80 for visual consistency.

**Domain Extensions** (insert after corresponding section):
- Database files: `[TABLES]` after SCHEMA, `[REPOSITORIES]` after SERVICES
- API files: `[GROUPS]` after SCHEMA, `[MIDDLEWARE]` after SERVICES
- Platform files: `[HANDLERS]`, `[PROVIDERS]` as needed

**FORBIDDEN Section Names:** Never use `Helpers`, `Handlers`, `Utils`, `Config` as section labels.

## Function Design

**Size:** Keep functions ≤ 50 lines; extract helpers for complex logic

**Parameters:**
- No destructuring in parameter position; destructure in function body if needed
- Use option objects for multiple optional parameters
- Example: `(schema?: T, options?: { targetOrigin?: string })` not `({ schema, targetOrigin })`

**Return Values:**
- Pure functions: return data directly
- Effect functions: always return `Effect.Effect<A, E, R>`
- React hooks: return values, state tuples, or void
- Avoid nullable returns; use `Option.Option<T>` or `Either.Either<L, R>` from Effect

**Naming Conventions for Returns:**
- Boolean predicates: prefix with `is*` or `has*` (e.g., `isValid`, `hasPermission`)
- Computed values: verb as prefix (e.g., `mapError`, `validateInput`)
- Stream/async producers: use `create*` or `make*` (e.g., `createMessageStream`)

## Module Design

**Exports:**
- Named exports only (no default exports except *.config.ts)
- Export section at file end (no inline exports)
- Import directly from source file, never from barrel files (index.ts forbidden)

**Barrel Files:**
- `noBarrelFile`: error in biome linter
- Each module exports its own symbols
- Consumers import: `import { X } from '@parametric-portal/package/module'`

**Service Pattern:**
- Services: singleton via `Effect.Service<X>()('id', { effect, ... })`
- Public API: static methods or instance properties depending on context
- Configuration: separate `_CONFIG` constant at module top
- Factory functions: private `_makeFoo(deps)` before class definition

## React/Component Conventions

**Function Components:**
- Use `FC<Props>` type annotation
- Props destructuring in parameter position
- Example from `packages/components-next/src/core/announce.tsx`:
```typescript
const AsyncAnnouncer: FC<{
    readonly asyncState: AsyncState<unknown, unknown> | undefined;
    readonly config?: AsyncAnnounceConfig;
}> = ({ asyncState, config }) => { ... };
```

**Hooks:**
- Effect dependencies: use `useExhaustiveDependencies` (biome enforced)
- Stabilize callbacks via `useRef` + `biome-ignore` comment if intentional
- Example: `// biome-ignore lint/correctness/useExhaustiveDependencies: handlerRef pattern`

**Component Exports:**
- No barrel files; import directly: `import { Button } from '@parametric-portal/components-next/actions/button'`
- Package.json exports define public API per file

---

*Conventions analysis: 2026-02-13*
