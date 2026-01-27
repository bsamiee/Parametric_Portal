# Testing Patterns

**Analysis Date:** 2026-01-26

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config via `vite.config.ts` (no separate vitest.config)
- Run via `pnpm exec nx` to ensure Nx caching

**Assertion Library:**
- Playwright `expect()` for E2E tests
- Vitest built-in expect (via Vitest)
- No dedicated mocking library at package level; MSW (Mock Service Worker) for API mocking

**Run Commands:**
```bash
pnpm exec nx test [package]              # Run tests for package
pnpm exec nx test --all                  # Run all tests
pnpm exec nx test --watch                # Watch mode
pnpm exec nx typecheck                   # TypeScript validation (no type tests)
```

**Coverage:**
- No coverage target enforced
- View via test output when running (if configured)

## Test File Organization

**Location:**
- Tests co-located with source: tests live alongside implementation
- E2E tests: `tests/e2e/` directory (separate from packages)
- **No unit tests found in packages** - pattern shows E2E only in current codebase

**Naming:**
- E2E test files: `*.spec.ts` (e.g., `seed.spec.ts`)
- Playwright convention: descriptive names matching feature

**Structure:**
```
tests/
├── e2e/
│   ├── seed.spec.ts              # Bootstrap + smoke tests
│   └── test-results/             # Generated output
packages/*/                        # Source co-location (no tests found yet)
```

## Test Structure

**Suite Organization:**
```typescript
// tests/e2e/seed.spec.ts
test.describe('Application Bootstrap', () => {
    test('feature - aspect', async ({ page, request }) => {
        // Arrange
        const B = Object.freeze({ /* constants */ });

        // Act
        await page.goto(B.apps.api.baseURL);
        const response = await request.get(B.apps.api.healthPath);

        // Assert
        expect(response.ok()).toBe(true);
    });
});
```

**Patterns:**
- Setup: `test.describe()` groups related tests
- Teardown: Playwright handles cleanup automatically
- Assertion: Direct `expect()` calls with `.toBe()`, `.toHaveTitle()`, `.toHaveStatus()`
- Constants: Freeze static test data via `Object.freeze()`

## Mocking

**Framework:**
- MSW (Mock Service Worker) 2.12.7 for HTTP API mocking
- No client-side mocking of Effect services found
- Database: Uses real test database (no mocks in infrastructure)

**Patterns:**
- MSW handlers defined at integration test level
- Intercepts fetch/node-fetch requests
- Configure via MSW server setup before tests run

**What to Mock:**
- External HTTP APIs (OAuth providers, third-party services)
- Not database queries (use test database)
- Not Effect services (use real implementations with test layers)

**What NOT to Mock:**
- Domain logic (Effect services implement real behavior)
- Database access (use transactions for cleanup)
- Core Effect imports (use real Effect)

## Fixtures and Factories

**Test Data:**
- Biome config shows test files at: `**/*.spec.ts`, `**/*.test.ts`, `tests/**/*.ts`
- Constants defined inline: `const B = Object.freeze({ ... })`
- No centralized fixture library found
- Database models used directly: `User`, `Session`, `Asset` from `@parametric-portal/database/models`

**Location:**
- Fixtures: Would go in `tests/fixtures/` or alongside test files
- Factories: Would go in `tests/factories/` or test helper modules
- Currently: Test data inline in E2E tests

**Example pattern (not yet in codebase):**
```typescript
// Recommended structure for unit tests
const createTestUser = (overrides?: Partial<typeof User.Type>) => ({
    id: crypto.randomUUID(),
    email: 'test@example.com',
    role: 'viewer',
    appId: crypto.randomUUID(),
    ...overrides,
});
```

## Test Types

**E2E Tests:**
- Framework: Playwright 1.58.0
- Scope: Full application flow from browser/API client
- Fixtures: `{ page, request }` (Playwright built-in)
- Location: `tests/e2e/*.spec.ts`
- Examples: Health checks, page load verification, app bootstrap
- Run: Requires running servers on localhost

**Unit Tests:**
- **Not yet implemented in codebase**
- Would use: Vitest with Effect runtime
- Pattern: Test individual services and domain logic
- Should follow: Effect.runTest for async effects
- Mocking: Test layers with stub implementations

**Integration Tests:**
- **Not yet separated from E2E**
- Would test: Service combinations, database repositories
- Database: Use transactions for test isolation

## Coverage

**Requirements:**
- Not enforced
- Vitest capable of generating coverage reports

**View Coverage (if generated):**
```bash
pnpm exec nx test --coverage    # If configured in vitest
```

## Common Patterns

**Async Testing (E2E with Playwright):**
```typescript
test('feature name', async ({ page, request }) => {
    // All operations are async
    await page.goto(url);
    await page.waitForLoadState('domcontentloaded');
    const response = await request.get(endpoint);
    expect(response.ok()).toBe(true);
});
```

**Async Testing (Potential Unit Tests with Effect):**
```typescript
test('service operation', async () => {
    const result = await Effect.runPromise(
        AuditService.Default.pipe(
            Effect.flatMap(service => service.log('operation', { ... }))
        )
    );
    expect(result).toEqual({ ... });
});
```

**Playwright Assertions:**
```typescript
expect(page).toHaveTitle(regex);           // Page title
expect(response.ok()).toBe(true);          // HTTP status
expect(response.status()).toBe(200);       // Specific status
expect(await response.json()).toEqual({    // Response body
    data: 'value'
});
```

## Environment Configuration

**E2E Test Environment:**
- API base: `http://localhost:4000` (configured in seed.spec.ts)
- Health path: `/api/health/liveness`
- Icons app: `http://localhost:3001`
- Requires running API server before tests

**Setup:**
- No setup/teardown files found
- Playwright auto-initializes fixtures
- Database: Real database accessed via API (no direct test DB client)

## Special Configurations

**Biome Overrides for Tests:**
```json
{
    "includes": [
        "**/*.spec.ts",
        "**/*.test.ts",
        "tests/**/*.ts"
    ],
    "linter": {
        "rules": {
            "nursery": { "useAwaitThenable": "off" }
        }
    }
}
```

- Disables `useAwaitThenable` in test files (async/await OK in tests)
- Otherwise tests follow same linting rules as source

---

*Testing analysis: 2026-01-26*
