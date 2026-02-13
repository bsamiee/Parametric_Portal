# Testing Patterns

**Analysis Date:** 2026-02-13

## Test Framework

**Runner:**
- Vitest 2.x
- Config: `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/vitest.config.ts`

**Assertion Library:**
- Vitest built-in `expect()` (Chai-based)
- Effect-specific matchers via `@effect/vitest` (addEqualityTesters)

**Run Commands:**
```bash
# Run all tests across projects
pnpm exec nx run-many -t test

# Watch mode (development)
vitest watch

# Coverage report
vitest run --coverage

# Single project
pnpm -F @parametric-portal/server test

# Type-safe tests
vitest run --typecheck
```

## Test File Organization

**Location:**
- Root tests: `tests/**/*.{test,spec}.{ts,tsx}` (separate from source)
- Package tests: `packages/*/tests/**/*.spec.ts` (co-located per package)
- Browser tests: `packages/runtime/tests/**/*.spec.ts` (Playwright-based)
- E2E tests: `tests/e2e/**/*.spec.ts` (excluded from regular suite)

**Naming:**
- Convention: `{module}.spec.ts` (not `.test.ts`)
- Example: `tests/packages/server/errors.spec.ts`, `tests/packages/server/transfer.spec.ts`

**Structure:**
```
tests/
├── setup.ts                      # Global test setup (equality testers)
├── packages/server/
│   ├── errors.spec.ts
│   ├── transfer.spec.ts
│   ├── resilience.spec.ts
│   └── ...
└── e2e/
    └── seed.spec.ts
```

## Test Configuration

**Vitest Projects** (inline projects pattern):
- `root-tests`: Node environment for general tests, root-level setup
- `packages-node`: Node environment for package tests (excludes runtime)
- `runtime-browser`: Browser environment (Playwright) for `packages/runtime` tests
- `apps`: jsdom environment for app tests

**Coverage Settings:**
- Threshold: 95% (branches, functions, lines, statements) per file
- Excluded: `**/*.config.*`, `**/*.d.ts`, `**/__mocks__/**`, `test/**`, `tests/**`, `dist/**`
- Included: `packages/runtime/src/**`, `packages/server/src/**`, `packages/test-utils/src/**`, `packages/types/src/**`

**Timeout Configuration:**
- Hook timeout: 10,000ms
- Test timeout: 10,000ms
- Slow test threshold: 5,000ms
- Retry on CI: 2 attempts

**Fake Timers:**
- Enabled: `setTimeout`, `setInterval`, `Date`, `performance`
- Loop limit: 10,000 iterations (prevent infinite loops)
- Should clear native timers: true

## Test Structure: Effect Tests

**Basic Test Format** (from `tests/packages/server/errors.spec.ts`):
```typescript
import { it } from '@effect/vitest';
import { HttpError } from '@parametric-portal/server/errors';
import { Effect } from 'effect';
import { expect } from 'vitest';

it.effect('mapTo wraps unknown error in Internal with label and cause', () =>
    Effect.gen(function* () {
        const cause = new Error('boom');
        const result = yield* Effect.fail(cause).pipe(HttpError.mapTo('db failed'), Effect.flip);
        expect(result._tag).toBe('Internal');
        expect((result as HttpError.Internal).details).toBe('db failed');
        expect((result as HttpError.Internal).cause).toBe(cause);
    }));
```

**Test Markers:**
- `it.effect('name', () => Effect.gen(...))` — Basic Effect test (synchronous within gen)
- `it.scoped('name', () => Effect.gen(...))` — Scoped resources (acquireUseRelease)
- `it.scopedLive('name', () => Effect.gen(...))` — Live (non-test) Effect execution
- `it.effect.prop('name', props, (generated) => Effect.gen(...))` — Property-based via `@effect/vitest` + fast-check
- `layer(testLayer)('name', (it) => { it.scoped(...) })` — Provide Layer as scope

**Effect.gen Pattern:**
- Always use `function*` generator syntax inside `Effect.gen`
- Yield effects with `yield*` for sequential composition
- Use `Effect.all()` for parallel independent effects
- Assertions via `expect()` after `yield*` statements

## Test Structure: Layered Tests

**With Service Layer** (from `tests/packages/server/resilience.spec.ts`):
```typescript
import { it, layer } from '@effect/vitest';
import { Logger, LogLevel } from 'effect';

const _testLayer = Resilience.Layer.pipe(
    Layer.provide(Logger.minimumLogLevel(LogLevel.Warning))
);

layer(_testLayer)('Resilience: Pipeline', (it) => {
    it.scoped('C1: timeout fires on slow effect', () => Effect.gen(function* () {
        // Test code here — Layer provided in scope
    }));
});
```

**Pattern:**
- Compose layers with `Layer.provide()` for dependencies
- `layer(testLayer)('group', (it) => { ... })` defines scope
- All `it.*` calls inside closure have layer-provided services available

## Property-Based Testing

**Fast-Check Integration** (from `tests/packages/server/transfer.spec.ts`):
```typescript
it.effect.prop(
    'P1: text roundtrip',
    {
        format: fc.constantFrom<'ndjson' | 'yaml'>('ndjson', 'yaml'),
        items: fc.array(_item, { maxLength: 6, minLength: 1 })
    },
    ({ format, items }) => Effect.gen(function* () {
        // Property test with generated inputs
        const exported = yield* Stream.fromIterable(items)...
        expect(parsed).toEqual(items);
    })),
    { fastCheck: { numRuns: 60 } }  // Property config
);
```

**Patterns:**
- Use `fc.record()`, `fc.array()`, `fc.constantFrom()` for generators
- Generators passed as second argument (object of props)
- Property function receives generated object
- Optional third argument: `{ fastCheck: { numRuns: N } }`
- Useful for: codec roundtrips, boundary testing, security validation

## Mocking

**Pattern: No Framework Required**
- Effect/Vitest provides built-in mocking via Ref, Deferred, TestClock
- No jest/vitest mock library needed for most cases

**Using Ref for State**:
```typescript
it.scoped('C2: retry exhaustion', () => Effect.gen(function* () {
    const counter = yield* Ref.make(0);
    const failing = Ref.update(counter, (n) => n + 1).pipe(
        Effect.andThen(Effect.fail(_FROZEN_ERROR))
    );
    // Use counter and failing as mock behavior
    expect(yield* Ref.get(counter)).toBe(2);
}));
```

**Using TestClock for Time**:
```typescript
it.scoped('C1: timeout fires', () => Effect.gen(function* () {
    const fiber = yield* Effect.fork(Resilience.run('test', slowEffect, { ... }));
    yield* TestClock.adjust(Duration.millis(50));  // Advance time
    const exit = yield* Fiber.await(fiber);
    // Assert timeout occurred
}));
```

**Using Deferred for Async Coordination**:
```typescript
it.scoped('Async gate', () => Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    const f1 = yield* Effect.fork(Deferred.await(gate));  // Wait for gate
    // Do work
    yield* Deferred.succeed(gate, undefined);  // Release gate
    yield* Fiber.join(f1);
}));
```

**When to Mock:**
- Avoid mocking; use real implementations when possible
- Mock external services: databases (via test schemas), APIs (via Effect layers)
- Mock side effects: file I/O, network calls, timers

## Fixtures and Test Data

**Test Data via Generators**:
```typescript
// From transfer.spec.ts
const _safe = fc.string({ maxLength: 32, minLength: 1 })
    .filter((v) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(v));
const _item = fc.record({
    content: _safe,
    id: fc.uuid(),
    type: _safe,
    updatedAt: fc.integer({ max: 1_700_604_800_000, min: 1_700_000_000_000 })
});
```

**Test Constants**:
```typescript
// From resilience.spec.ts
const _FROZEN_ERROR = { _tag: 'TestDomainError', message: 'synthetic' } as const;
const _NO_CIRCUIT = { circuit: false, timeout: false } as const;
const PRESETS = {
    brief: { base: 50, maxAttempts: 2 },
    default: { base: 100, maxAttempts: 3 },
    patient: { base: 500, maxAttempts: 5 },
    persistent: { base: 100, maxAttempts: 5 }
} as const;
```

**Location:**
- Generators: top of test file as `const _gen = fc.record(...)`
- Test constants: labeled section `// --- [CONSTANTS] ----`
- Shared fixtures: `tests/fixtures/` or within test file

## Common Test Patterns

### Async Testing

```typescript
// Effect-based async (preferred)
it.effect('async operation', () => Effect.gen(function* () {
    const result = yield* someAsyncEffect;
    expect(result).toBeDefined();
}));

// Promise interop (rare)
it.effect('promise interop', () => Effect.gen(function* () {
    const result = yield* Effect.promise(() => fetch('/api/...').then(r => r.json()));
    expect(result).toBeDefined();
}));
```

### Error Testing

```typescript
// Via Effect.flip to extract error
it.effect('error handling', () => Effect.gen(function* () {
    const error = yield* Effect.fail(HttpError.Auth.of('unauthorized')).pipe(Effect.flip);
    expect(error._tag).toBe('Auth');
    expect((error as HttpError.Auth).details).toBe('unauthorized');
}));

// Via Effect.exit for non-failure path
it.effect('error path', () => Effect.gen(function* () {
    const exit = yield* someEffect.pipe(Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    Exit.match(exit, {
        onFailure: (cause) => expect(String(cause)).toContain('TimeoutError'),
        onSuccess: () => { throw new Error('unreachable'); }
    });
}));
```

### Stream Testing

```typescript
// Collect stream output
it.effect('stream roundtrip', () => Effect.gen(function* () {
    const exported = yield* Stream.fromIterable(items)
        .pipe(
            (s) => Transfer.export(s, 'ndjson'),
            Stream.runCollect,
            Effect.map((c) => Chunk.toArray(c))
        );
    expect(exported).toHaveLength(items.length);
}));
```

### Match/Pattern Testing

```typescript
// Exhaustive variant testing
it.effect('match all variants', () => Effect.gen(function* () {
    const result = Match.value(error).pipe(
        Match.when('TimeoutError', () => 'timeout'),
        Match.when('AuthError', () => 'auth'),
        Match.orElse(() => 'unknown')
    );
    expect(result).toBe('timeout');
}));
```

## Test Organization

**Test Grouping:**
- Use `describe()` for logical test suites (rarely needed in Effect tests)
- Use comments for test categories (e.g., `// --- [ALGEBRAIC: CODEC ROUNDTRIPS]`)
- Name tests with descriptive context (e.g., `P1: text roundtrip`, `C3: non-retriable Auth bypasses retry`)

**Test Conventions:**
- One assertion per test (or minimal related assertions)
- Test names start with action/property (e.g., "wraps", "throws", "roundtrips")
- Comments above test explain preconditions or references

**Example Grouping** (from `transfer.spec.ts`):
```typescript
// --- [ALGEBRAIC: CODEC ROUNDTRIPS] -------------------------------------------
// P1: Text codec roundtrip (ndjson, yaml) + D3 cross-validation
it.effect.prop('P1: text roundtrip', { ... }, ({ ... }) => { ... });

// P2: Binary codec roundtrip (xlsx, zip)
it.effect.prop('P2: binary roundtrip', { ... }, ({ ... }) => { ... });

// --- [BOUNDARY + SECURITY] ---------------------------------------------------
// P3: Empty inputs = identity stream
it.effect('P3: empty inputs', () => { ... });

// P4: Import modes + row limit + too large entry
it.effect('P4: modes + limits', () => { ... });
```

## Coverage

**Requirements:**
- Target: 95% branches, functions, lines, statements (per file)
- Enforced: biome CI runs full coverage check
- Excluded: test files, mock files, config, type definitions

**View Coverage:**
```bash
# Generate coverage report
pnpm exec vitest run --coverage

# View HTML report
open coverage/index.html
```

**Coverage Tool:** v8 provider

**Reporting:** Multiple formats
- text (console summary)
- json (machine-readable)
- html (interactive browser view)
- lcov (CI integration)

## Test Types in This Codebase

**Unit Tests** (majority):
- File location: `tests/packages/server/*.spec.ts`, `packages/*/tests/*.spec.ts`
- Scope: Single function, service method, or domain boundary
- Example: `errors.spec.ts` tests error wrapping logic
- Approach: Direct Effect pipelines with controlled state (Ref, Deferred)

**Integration Tests:**
- File location: `tests/packages/server/*.spec.ts` with Layer dependencies
- Scope: Multiple services or subsystems working together
- Example: `resilience.spec.ts` tests retry + circuit breaker + timeout composition
- Approach: Provide test Layer with realistic service implementations

**Property-Based Tests:**
- File location: `tests/packages/server/*.spec.ts` with `it.effect.prop`
- Scope: Codec roundtrips, boundary conditions, security properties
- Example: `transfer.spec.ts` validates import/export across 10+ formats
- Approach: Fast-check generators with invariant assertions

**E2E Tests:**
- File location: `tests/e2e/*.spec.ts`
- Scope: Full application workflows (setup, seeding, etc.)
- Example: `seed.spec.ts` validates database initialization
- Approach: Real infrastructure, no mocking

**Browser Tests:**
- File location: `packages/runtime/tests/**/*.spec.ts`
- Scope: React hooks, DOM interactions, browser APIs
- Approach: Playwright headless browser, pixel-perfect assertions available
- Example: `useMessageListener`, `useAsyncAnnounce` hooks tested in browser context

## Biome Linting for Tests

**Test-specific overrides** (from `biome.json`):
```json
{
    "includes": ["**/*.spec.ts", "**/*.test.ts", "tests/**/*.ts"],
    "linter": { "rules": { "nursery": { "useAwaitThenable": "off" } } }
}
```

**Allowed in tests:**
- `.not.toEqual()` chains (floating promises acceptable)
- `// biome-ignore` for intentional violations (e.g., dependency patterns)

**Enforced in tests:**
- `useConst` (no `let`/`var` in test setup)
- `noUnusedVariables` (clean test code)
- `noImportCycles` (isolated test modules)

## Setup Files

**Global Setup:**
- File: `tests/setup.ts`
- Content: Adds Effect equality testers to Vitest
- Import: `addEqualityTesters()` from `@effect/vitest`

**Per-Project Setup:**
- `root-tests`: uses `tests/setup.ts`
- `packages-node`: uses `tests/setup.ts`
- `runtime-browser`: uses `tests/setup.ts`
- `apps`: empty `setupFiles: []` (jsdom-specific)

---

*Testing analysis: 2026-02-13*
