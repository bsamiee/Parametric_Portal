# Testing Patterns

**Analysis Date:** 2026-01-28

## Test Framework

**Runner:**
- Vitest 4.0.16
- Config: `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/vitest.config.ts`

**Assertion Library:**
- Vitest built-in assertions (Chai-compatible)
- Effect equality testers via `@effect/vitest`

**Run Commands:**
```bash
pnpm exec nx run-many -t test              # Run all tests
pnpm exec nx run-many -t test -- --watch   # Watch mode (implied)
pnpm exec nx run-many -t test -- --coverage # With coverage
pnpm nx e2e                                 # E2E tests via Playwright
pnpm nx e2e --ui                            # E2E with Playwright UI
```

## Test File Organization

**Location:**
- Unit/integration tests: `tests/**/*.spec.ts` at workspace root
- Package tests: `packages/*/tests/**/*.spec.ts` (currently not in use)
- E2E tests: `tests/e2e/**/*.spec.ts`
- Test utilities: `packages/test-utils/src/`

**Naming:**
- Test files: `*.spec.ts` (preferred) or `*.test.ts`
- E2E tests: `*.e2e.spec.ts` or `*.e2e.test.ts` (excluded from unit test runs)
- Type tests: `*.spec-d.ts` or `*.test-d.ts` (for type-level testing)

**Structure:**
```
parametric-portal/
├── tests/
│   ├── e2e/
│   │   └── seed.spec.ts          # E2E tests
│   └── (unit tests - to be added)
├── packages/
│   └── test-utils/
│       └── src/
│           ├── setup.ts           # Global test setup
│           ├── arbitraries.ts     # fast-check generators
│           ├── effect-test.ts     # Effect test helpers
│           ├── harness.ts         # Test harness utilities
│           └── mocks/             # Mock factories
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect } from 'effect';

describe('ServiceName', () => {
  describe('methodName', () => {
    it('should handle success case', async () => {
      // Arrange
      const input = { ... };

      // Act
      const result = await Effect.runPromise(
        serviceMethod(input)
      );

      // Assert
      expect(result).toEqual(expected);
    });

    it('should fail when invalid', async () => {
      // Arrange & Act & Assert
      await expect(
        Effect.runPromise(serviceMethod(invalid))
      ).rejects.toThrow(ExpectedError);
    });
  });
});
```

**Patterns:**
- Use `describe` blocks to group related tests by module/method
- Use `it` for individual test cases (prefer `it` over `test`)
- Setup: Global setup in `packages/test-utils/src/setup.ts`, per-test setup in `beforeEach`
- Teardown: Global teardown in `afterEach` (timers, storage clearing)
- Assertions: Use Vitest `expect` API with Effect equality testers

## Mocking

**Framework:** Vitest built-in mocking (`vi`)

**Patterns:**
```typescript
import { vi, beforeEach } from 'vitest';

// Mock modules
vi.mock('@parametric-portal/database/repos', () => ({
  DatabaseService: mockDatabaseService,
}));

// Mock functions
const mockFn = vi.fn().mockResolvedValue(result);

// Spy on implementations
const spy = vi.spyOn(object, 'method');

// Clear mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
});
```

**What to Mock:**
- External API calls (use MSW for HTTP mocking via `packages/test-utils/src/mocks/msw.ts`)
- Database queries (mock repository methods)
- File system operations
- Time-dependent code (use `vi.useFakeTimers()` from setup)
- Browser APIs (storage, clipboard, etc.)

**What NOT to Mock:**
- Pure functions (test directly)
- Simple data transformations
- Schema validation (test actual validation logic)
- Effect composition (test actual Effect pipelines)

## Fixtures and Factories

**Test Data:**
```typescript
import { fc } from '@fast-check/vitest';
import { arbitraries } from '@parametric-portal/test-utils/arbitraries';

// Property-based testing
it.prop([fc.string(), fc.integer()])('validates all inputs', (str, num) => {
  expect(validate(str, num)).toBeDefined();
});

// Predefined arbitraries
it.prop([arbitraries.email, arbitraries.uuid])('user creation', (email, id) => {
  // Test with generated values
});
```

**Location:**
- Arbitraries: `packages/test-utils/src/arbitraries.ts`
- Constants: `packages/test-utils/src/constants.ts`
- Mock data: `packages/test-utils/src/mocks/`

**Patterns:**
- fast-check configured globally in setup: `fc.configureGlobal(TEST_CONSTANTS.fc)`
- Frozen time for deterministic tests: `vi.setSystemTime(TEST_CONSTANTS.frozenTime)` in `beforeEach`
- Fake IndexedDB injected in Node environment (auto-imported in setup)

## Coverage

**Requirements:**
- Coverage reporting enabled but thresholds disabled ("fast-moving early development")
- Provider: V8 (native Node.js coverage)

**View Coverage:**
```bash
pnpm exec nx run-many -t test -- --coverage
open coverage/index.html                       # Open HTML report
```

**Coverage Config:**
- Reports: text (console), json, html, lcov
- Included: `packages/runtime/src/**/*.{ts,tsx}`, `packages/test-utils/src/**/*.{ts,tsx}`
- Excluded: `**/*.config.*`, `**/*.d.ts`, `**/__mocks__/**`, `**/dist/**`, `**/node_modules/**`
- Reports directory: `coverage/` at workspace root

## Test Types

**Unit Tests:**
- Scope: Individual functions, services, schemas
- Environment: Node (default) or jsdom (for apps)
- Projects in vitest.config.ts:
  - `packages-node`: Node environment for server packages
  - `apps`: jsdom environment for app code

**Integration Tests:**
- Scope: Multi-service interactions, database transactions
- Same test structure as unit tests
- Use `db.withTransaction` for transactional tests
- Located in `tests/**/*.spec.ts` (not currently populated)

**E2E Tests:**
- Framework: Playwright
- Config: `playwright.config.ts`
- Scope: Full user flows, OAuth, UI interactions
- Located in `tests/e2e/**/*.spec.ts`
- Run: `pnpm nx e2e` or `pnpm nx e2e --ui`

**Browser Tests:**
- Project: `runtime-browser` in vitest.config.ts
- Provider: Playwright via `@vitest/browser-playwright`
- Environment: Real Chromium browser
- Scope: `packages/runtime/tests/**/*.spec.ts`
- Viewport: 1280x720
- Screenshot on failure enabled
- Trace mode: `retain-on-failure`

## Common Patterns

**Async Testing:**
```typescript
// Effect programs
it('runs Effect program', async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* ServiceTag;
      return yield* service.method();
    })
  );
  expect(result).toBe(expected);
});

// Promise-based
it('handles async operation', async () => {
  const result = await asyncFunction();
  expect(result).toBeDefined();
});
```

**Error Testing:**
```typescript
// Effect errors
it('fails with typed error', async () => {
  const program = serviceMethod(invalid).pipe(
    Effect.catchTag('NotFound', (err) => Effect.succeed(err))
  );
  const result = await Effect.runPromise(program);
  expect(result).toBeInstanceOf(NotFoundError);
});

// Promise rejection
it('rejects with error', async () => {
  await expect(
    Effect.runPromise(failingOperation())
  ).rejects.toThrow('Expected error message');
});
```

**Fake Timers:**
```typescript
import { vi } from 'vitest';

it('advances time', () => {
  // Timers are fake by default (set in setup.ts)
  const callback = vi.fn();
  setTimeout(callback, 1000);

  vi.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalled();
});
```

**Storage Testing:**
```typescript
it('clears storage between tests', () => {
  // Storage cleared automatically in setup afterEach
  localStorage.setItem('key', 'value');
  expect(localStorage.getItem('key')).toBe('value');
  // Automatically cleared after test
});
```

## Setup and Lifecycle

**Global Setup:** `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/packages/test-utils/src/setup.ts`

Automatically:
- Configures fast-check with global settings
- Adds Effect equality testers for accurate assertions
- Injects fake-indexeddb in Node environment
- Clears localStorage, sessionStorage, indexedDB before each test
- Enables fake timers with frozen time (`2025-01-01T00:00:00.000Z`)
- Restores real timers after each test

**Per-Test Setup:**
```typescript
beforeEach(() => {
  // Test-specific setup
});

afterEach(() => {
  // Test-specific cleanup
  vi.clearAllMocks();
});
```

**Test Isolation:**
- Each test runs in isolated module scope
- Mocks cleared between tests: `vi.clearAllMocks()` in global setup
- Storage cleared automatically
- Timers reset automatically

## Vitest Configuration Highlights

**Test Execution:**
- Globals enabled: `describe`, `it`, `expect` available without imports
- File parallelism: Enabled (tests run in parallel)
- Isolation: Each test file isolated
- Retries: 0 locally, 2 in CI
- Timeout: 10s per test, 10s per hook

**Projects (Multi-Environment):**
1. `packages-node`: Node env for server packages (excludes runtime)
2. `runtime-browser`: Browser env for runtime package only
3. `apps`: jsdom env for app code

**Snapshot Testing:**
- Format: No prototype printing (`printBasicPrototype: false`)
- Location: `__snapshots__/` adjacent to test files

---

*Testing analysis: 2026-01-28*
