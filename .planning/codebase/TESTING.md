# Testing Patterns

**Analysis Date:** 2026-02-22

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: `vitest.config.ts` (root, unified — child packages do NOT have their own vitest configs)
- Pool: threads with file-level parallelism

**Effect Integration:**
- `@effect/vitest` — provides `it.effect`, `it.live`, `it.scoped`, `it.effect.prop`, `layer()`
- `addEqualityTesters()` from `@effect/vitest` registered globally in `tests/setup.ts`

**Property-Based Testing:**
- `fast-check` via Effect's `FastCheck` re-export (`import { FastCheck as fc } from 'effect'`)
- Global config: 50 runs locally, 200 runs in CI, 30s interrupt limit
- Configured in `tests/setup.ts`

**Mutation Testing:**
- Stryker with `@stryker-mutator/vitest-runner` and `@stryker-mutator/typescript-checker`
- Config: `stryker.config.mjs`
- Thresholds: break=50, low=60, high=80

**Run Commands:**
```bash
pnpm test                          # Run root tests (clears vitest cache)
pnpm exec nx run-many -t test      # Run all package tests
pnpm exec nx affected -t test --base=main  # Run affected tests only
pnpm test:coverage                 # Run with v8 coverage
pnpm test:mutate                   # Incremental mutation testing
```

**Coverage Thresholds** (v8 provider):
```
branches:   95%
functions:  95%
lines:      95%
statements: 95%
```

Coverage excludes: `apps/portal/**`, `apps/docs/**`, `packages/components/**`, `packages/runtime/**`, `packages/theme/**`, `packages/types/**`.

## Test File Organization

**Location:**
- `tests/packages/server/` — server package tests (mirrors `packages/server/src/` structure)
- `tests/packages/database/` — database package tests
- `tests/integration/` — cross-package integration tests
- `tests/e2e/` — E2E tests (excluded from normal runs)
- `tests/apps/api/` — API app tests
- `tests/system/` — system-level tests

**Pattern:** Tests are NOT co-located with source. All tests live under the top-level `tests/` directory.

**Naming:**
- Test files: `{module-name}.spec.ts` (e.g., `crypto.spec.ts`, `circuit.spec.ts`, `page.spec.ts`)
- Never `*.test.ts`

**Structure mapping:**
```
packages/server/src/security/crypto.ts  →  tests/packages/server/security/crypto.spec.ts
packages/database/src/page.ts           →  tests/packages/database/page.spec.ts
packages/server/src/infra/jobs.ts       →  tests/packages/server/infra/jobs.spec.ts
packages/server/src/infra/events.ts     →  tests/packages/server/infra/events.spec.ts
```

## Test Structure

**Suite naming convention:**
- `P1`, `P2`, `P3`... — Property/algebraic law tests (the primary test type)
- `E1`, `E2`, `E3`... — Edge case / boundary tests

**Section organization** (same canonical sections as source files):
```typescript
// --- [CONSTANTS] -------------------------------------------------------------
// private arbitraries, frozen test data, expected constants

// --- [FUNCTIONS] -------------------------------------------------------------
// _provide helpers, layer factories, reset functions

// --- [MOCKS] -----------------------------------------------------------------
// vi.mock(), vi.hoisted() calls

// --- [ALGEBRAIC] -------------------------------------------------------------
// it.effect.prop() property tests

// --- [EDGE_CASES] ------------------------------------------------------------
// it.effect() deterministic edge case tests
```

**File-level doc comment** (always present, one line):
```typescript
/** {Module} tests: {comma-separated list of what's tested}. */
```

**Size cap:** 175 LOC maximum per spec file. Enforced by PostToolUse hook.

## Test Types and API

**`it.effect`** — synchronous Effect test, no real time:
```typescript
it.effect('E1: decode graceful degradation', () =>
    Effect.gen(function* () {
        expect(yield* Page.decode(undefined)).toEqual(Option.none());
        expect(yield* Page.decode('not-base64!!!')).toEqual(Option.none());
    }));
```

**`it.effect.prop`** — property-based test with fast-check arbitraries:
```typescript
it.effect.prop('P1: encode/decode inverse', { id: fc.uuid(), v: fc.integer() }, ({ id, v }) =>
    Effect.gen(function* () {
        expect(yield* Page.decode(Page.encode(id))).toEqual(Option.some({ id }));
    }),
{ fastCheck: { numRuns: 100 } });
```

**`it.live`** — test with real timers (for staleness windows, GC eviction, etc.):
```typescript
it.live('E2: gc eviction + dispose removal', () =>
    _provide(Effect.gen(function* () {
        yield* Circuit.make('e2-stale');
        yield* Effect.sleep(Duration.millis(50));
        expect(yield* Circuit.gc(25 as never)).toEqual({ removed: 1 });
    })));
```

**`layer(someLayer)('Suite Name', (it) => { ... })`** — scoped test suite sharing a layer:
```typescript
layer(_layer(_testEnv))('Crypto', (it) => {
    it.effect.prop('P1: inverse + nondet + length', { x: _text }, ({ x }) => ...);
    it.scoped('P3: format + reencrypt', () => ...);
});
```

**`it.scoped`** — inside `layer()` suites; same as `it.effect` but scoped to the layer:
```typescript
layer(_testLayer)('Resilience: Pipeline', (it) => {
    it.scoped('P3: annihilation — all features disabled yields identity', () =>
        Effect.gen(function* () {
            expect(yield* Resilience.run('identity', Effect.succeed(42), { ... })).toBe(42);
        }));
});
```

## Mocking

**`vi.mock` with `importOriginal`** — for partial mocks preserving real module:
```typescript
vi.mock('@effect/sql', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@effect/sql')>();
    const { Effect, Option } = await import('effect');
    return {
        ...orig,
        SqlSchema: {
            ...orig.SqlSchema,
            findOne: (spec) => (params) => Effect.sync(() => { spec.execute(params); return Option.some(_row); }),
        },
    };
});
```

**`vi.hoisted`** — shared mutable state referenced inside `vi.mock` closures:
```typescript
const _state = vi.hoisted(() => ({
    audit:         [] as Array<{ event: string; payload: unknown }>,
    permissions:   new Map<string, Array<{ action: string; deletedAt: Option.Option<Date>; resource: string }>>(),
    userMode:      'active' as 'active' | 'deleted' | 'inactive' | 'missing',
}));
```

**`vi.spyOn`** — used for testing failure paths of native Web APIs:
```typescript
const importSpy = vi.spyOn(crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('mock'));
const initErr = yield* Effect.scoped(Layer.launch(_layer(_testEnv))).pipe(Effect.flip);
importSpy.mockRestore();
```

**`Layer.succeed(Tag, stub)`** — preferred over `vi.mock` for injecting Effect service stubs:
```typescript
effect.pipe(
    Effect.provideService(DatabaseService, _database as never),
    Effect.provideService(AuditService, { log: (event, payload) => Effect.sync(() => { ... }) } as never),
    Effect.provideService(MetricsService, { errors: Metric.frequency('errors') } as never),
    Effect.provideService(SqlClient.SqlClient, _sql as never),
);
```

**`Layer.provide` chain** — for composing real layers with test substitutes:
```typescript
const _service = Effect.gen(function* () { return yield* DatabaseService; }).pipe(
    Effect.provide(DatabaseService.Default.pipe(
        Layer.provide(SearchRepo.Test()),
        Layer.provide(Layer.succeed(SqlClient.SqlClient, _sqlClient)),
        Layer.provide(Layer.succeed(PgClient.PgClient, _pg)),
    )),
);
```

**What to mock:**
- Infrastructure services (SQL client, Redis, S3) — always stub
- Cross-package services that require real infra — use `Layer.succeed(Tag, stub)`
- Native Web APIs when testing failure paths — `vi.spyOn` + `mockRejectedValueOnce`

**What NOT to mock:**
- Pure functions — test directly with real inputs
- Effect schema decode/encode — test with real schemas
- The module under test — no self-mocking

## Test Data and Arbitraries

**fast-check arbitraries defined as module constants** (prefixed `_`):
```typescript
const _text     = fc.string({ maxLength: 64, minLength: 0 });
const _nonempty = fc.string({ maxLength: 64, minLength: 1 });
const _uuid     = fc.uuid();
const _validId  = fc.array(_digit, { maxLength: 19, minLength: 18 }).map((a) => a.join(''));
const _row      = fc.record({ id: fc.uuid(), totalCount: fc.nat({ max: 999 }), value: fc.integer() });
```

**Schema-based arbitraries** — pass schema directly (no `Arbitrary.make()` wrapping):
```typescript
it.effect.prop('P5: Limit rejects out-of-range', { valid: _validLimit }, ({ valid }) => ...)
```

**Sentinel / pinned constants** for registry contracts:
```typescript
const _EXPECTED_KEYS = ['apiKeys', 'apps', 'assets', ...] as const;
// Sentinel: pinned registry count — update when fields are added/removed
expect(_ALL_FIELDS).toHaveLength(86);
```

**`fc.pre(condition)`** — discard generated values that violate preconditions:
```typescript
it.effect.prop('P4: tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _nonempty }, ({ t1, t2, x }) => {
    fc.pre(t1 !== t2);
    return Effect.gen(function* () { ... });
});
```

**Known-answer vectors** for cryptographic primitives:
```typescript
const SHA256_NIST = [
    { expected: 'e3b0c44298fc...', input: '' },
    { expected: 'ba7816bf8f01...', input: 'abc' },
] as const;
const HMAC_RFC4231 = { data: 'what do ya want for nothing?', expected: '5bdcc146...', key: 'Jefe' } as const;
```

## Error Testing Pattern

**Testing error channels** — use `Effect.flip` to invert failure to success:
```typescript
const [tErr, wrongAad, noAad] = yield* Effect.all([
    Crypto.decrypt(tampered).pipe(Effect.flip),
    Crypto.decrypt(aadCipher, new TextEncoder().encode('wrong')).pipe(Effect.flip),
    Crypto.decrypt(aadCipher).pipe(Effect.flip),
]);
expect([tErr.code, wrongAad.code, noAad.code]).toEqual(['OP_FAILED', 'OP_FAILED', 'OP_FAILED']);
```

**Testing layer init errors** — `Effect.scoped(Layer.launch(layer)).pipe(Effect.flip)`:
```typescript
const fail = (env: Map<string, string>) => Effect.scoped(Layer.launch(_layer(env))).pipe(Effect.flip);
const errors = yield* Effect.all([
    fail(new Map([..._testEnv].filter(([key]) => key !== 'ENCRYPTION_KEY'))),
    fail(new Map([..._testEnv, ['ENCRYPTION_KEYS', '{bad']])),
]);
expect(errors.map((error) => [error.code, error.op])).toEqual([
    ['KEY_NOT_FOUND', 'key'], ['INVALID_FORMAT', 'key'],
]);
```

**Testing FSM state machines** — `expect(instance.state).toBe(...)` between operations:
```typescript
expect(cb.state).toBe('Closed');
yield* cb.execute(_fail()).pipe(Effect.flip);
expect(cb.state).toBe('Open');
```

## Algebraic Law Patterns

The codebase mandates algebraic PBT as the primary technique (from MEMORY.md: "Algebraic PBT as external oracle — laws are mathematical truths independent of implementation").

**Inverse (roundtrip) laws:**
```typescript
// P1: encode/decode inverse
expect(yield* Page.decode(Page.encode(id))).toEqual(Option.some({ id }));
```

**Idempotence:**
```typescript
yield* Circuit.clear();
yield* Circuit.clear();
expect(yield* Circuit.stats()).toEqual([]);
```

**Annihilation:**
```typescript
// All features disabled yields identity
expect(yield* Resilience.run('identity', Effect.succeed(42), { bulkhead: false, circuit: false, hedge: false, retry: false, timeout: false })).toBe(42);
```

**Complement / XOR laws:**
```typescript
expect(error.isRetryable).toBe(!error.isTerminal);
expect(eqXY).toBe(eqYX);  // symmetry
```

**Monotonicity:**
```typescript
// P1: breaker opens at exactly threshold N, not before
yield* _trip(cb, threshold - 1);
expect(cb.state).toBe('Closed');
yield* cb.execute(_fail()).pipe(Effect.flip);
expect(cb.state).toBe('Open');
```

## Coverage

**Thresholds:** 95% branches, functions, lines, statements (enforced, not per-file).

**Excluded from coverage:**
- `apps/portal/**`, `apps/docs/**`, `apps/test-harness/**`
- `packages/components/**`, `packages/components-next/**`, `packages/devtools/**`
- `packages/runtime/**`, `packages/theme/**`, `packages/types/**`, `packages/ai/**`
- All test files, dist, config files

**Coverage reporters:** text, json, json-summary, html, lcov

**Mutation testing scope** (`stryker.config.mjs`):
```
packages/server/src/**/*.ts
packages/database/src/**/*.ts
apps/api/src/**/*.ts
!apps/api/src/routes/**/*.ts   (excluded)
```

Excluded mutations: `UpdateOperator`, `OptionalChaining`.

## Test Types Summary

**Unit tests (`tests/packages/`):**
- Effect service contract tests (service identity, layer shape)
- Schema/model roundtrip and validation
- Pure function algebraic laws via PBT
- Error factory and discrimination tests

**Integration tests (`tests/integration/`):**
- `server-database/` — cross-package flows (auth-session, tenant-lifecycle-purge)
- `api/routes.spec.ts` — route contract tests

**E2E tests (`tests/e2e/`):**
- Playwright via `@vitest/browser-playwright` + Chromium
- Excluded from normal `pnpm test` run; separate execution
- `tests/e2e/seed.spec.ts` for database seeding

**Apps tests (`tests/apps/`):**
- `api/main.spec.ts`, `api/migrate.spec.ts` — app-level boot and migration tests
- Run in jsdom environment

**System tests (`tests/system/`):**
- Directory exists, currently empty

## Global Test Setup

`tests/setup.ts` registers globally:
1. `addEqualityTesters()` — Effect-aware deep equality for `expect`
2. `fc.configureGlobal(...)` — fast-check settings (50/200 runs local/CI)
3. `Logger.defaultLogger.log = () => {}` — silences Effect's structured logger in all test contexts

---

*Testing analysis: 2026-02-22*
