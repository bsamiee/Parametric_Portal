# [H1][TESTING_PATTERNS]
>**Dictum:** *Patterns encode bleeding-edge test practices via B constant, dispatch tables, and Effect composition.*

<br>

Reference implementation: `packages/runtime/tests/*.spec.ts`.

---
## [1][B_CONSTANT]
>**Dictum:** *Frozen B constant centralizes test data per spec file.*

<br>

Each spec file defines ONE frozen B constant with semantic sections:

```typescript
const B = Object.freeze({
    samples: { /* static test cases */ },
    arb: { /* fast-check arbitraries */ },
    derived: { /* computed from base values */ },
    tuning: { /* configuration parameters */ },
    bounds: { /* min/max constraints */ },
} as const);
```

| [INDEX] | [SECTION] | [PURPOSE]                                 | [EXAMPLE]                             |
| :-----: | --------- | ----------------------------------------- | ------------------------------------- |
|   [1]   | `samples` | Static test cases for deterministic tests | `camelCase: ['myFileName'] as const`  |
|   [2]   | `arb`     | Fast-check arbitraries for property tests | `devtools: fc.oneof(fc.boolean())`    |
|   [3]   | `derived` | Values computed from base constants       | `msPerDay: 24 * 60 * 60 * 1000`       |
|   [4]   | `tuning`  | Configuration parameters                  | `timeout: 5000, retries: 3`           |
|   [5]   | `bounds`  | Min/max constraints for validation        | `historyLimit: { min: 1, max: 1000 }` |

[IMPORTANT]:
- [ALWAYS] Freeze B with `Object.freeze()`.
- [ALWAYS] Use `as const` for literal inference.
- [NEVER] Scatter test data across multiple variables.

---
## [2][DISPATCH_TABLES]
>**Dictum:** *Handler tables enable exhaustive polymorphic testing.*

<br>

Combine dispatch with `describe.each` for multi-variant coverage:

```typescript
const arithmeticOps = [
    { name: 'addDays', arb: FC_ARB.days, handler: handlers.addDays, msPer: B.derived.msPerDay },
    { name: 'addHours', arb: FC_ARB.hours, handler: handlers.addHours, msPer: B.derived.msPerHour },
] as const;

describe.each(arithmeticOps)('$name', ({ arb, handler, msPer }) => {
    it.prop([arb()])('applies correct offset', (value) => {
        expect(extractMs(handler(value, base))).toBe(baseMs + value * msPer);
    });
});
```

[REFERENCE] Pattern exemplar: `packages/runtime/tests/temporal.spec.ts`

---
## [3][PROPERTY_BASED]
>**Dictum:** *Arbitraries generate exhaustive test cases algorithmically.*

<br>

Import domain arbitraries: `import { FC_ARB } from '@parametric-portal/test-utils/arbitraries'`

| [INDEX] | [ARBITRARY]                 | [GENERATES]                              |
| :-----: | --------------------------- | ---------------------------------------- |
|   [1]   | `FC_ARB.storeName()`        | Pattern-validated store names            |
|   [2]   | `FC_ARB.days()`             | Symmetric temporal offsets `[-365, 365]` |
|   [3]   | `FC_ARB.jsonValue()`        | Serialized JSON strings                  |
|   [4]   | `FC_ARB.invalidStoreName()` | Deliberately invalid names               |
|   [5]   | `FC_ARB.historyLimit()`     | Bounded integers `[1, 1000]`             |
|   [6]   | `FC_ARB.storageType()`      | Enum: localStorage, sessionStorage, etc. |

**itProp Pattern:** Use `it.prop()` from `@fast-check/vitest`:

```typescript
it.prop([FC_ARB.storeName()])('decodes valid names', (name) => {
    expect(S.decodeUnknownEither(Schema)(name)).toBeRight(name);
});
```

**Inverse Operations:** Test bidirectional transformations return to identity:

```typescript
it.prop([arb().filter((v) => v !== 0)])('inverse is identity', (value) => {
    const result = pipe(addDays(value)(base), Effect.flatMap(addDays(-value)), Effect.runSyncExit);
    expect(result).toBeSuccess(baseMs);
});
```

---
## [4][EFFECT_NATIVE]
>**Dictum:** *Monadic assertions validate Effect pipelines.*

<br>

Execute Effects synchronously: `const result = Effect.runSyncExit(effect)`

Custom matchers registered via `test-utils/matchers/effect.ts`:

| [INDEX] | [MATCHER]       | [ASSERTS]                               |
| :-----: | --------------- | --------------------------------------- |
|   [1]   | `toBeSuccess()` | Exit.isSuccess, optionally checks value |
|   [2]   | `toBeFailure()` | Exit.isFailure, optionally checks error |
|   [3]   | `toBeRight()`   | Either.isRight, optionally checks value |
|   [4]   | `toBeLeft()`    | Either.isLeft, optionally checks error  |
|   [5]   | `toBeSome()`    | Option.isSome, optionally checks value  |
|   [6]   | `toBeNone()`    | Option.isNone                           |

[IMPORTANT]:
- [ALWAYS] Use `Exit.isSuccess() && (...)` for conditional execution.
- [NEVER] Use `if/else` blocks in test logic.

---
## [5][HARNESS_API]
>**Dictum:** *TEST_HARNESS utilities isolate test execution.*

<br>

Import: `import { TEST_HARNESS } from '@parametric-portal/test-utils/harness'`

| [INDEX] | [UTILITY]             | [PURPOSE]                           | [USAGE]                       |
| :-----: | --------------------- | ----------------------------------- | ----------------------------- |
|   [1]   | `console.warn(fn)`    | Capture console, auto-cleanup spy   | Validate warning emissions    |
|   [2]   | `env.production(fn)`  | Execute with NODE_ENV=production    | Test production-only behavior |
|   [3]   | `storage.seed(k, v)`  | Seed localStorage with value        | Pre-populate test data        |
|   [4]   | `storage.clear()`     | Clear localStorage + sessionStorage | Reset between tests           |
|   [5]   | `timers.advance(ms)`  | Advance fake timers                 | Test async flows              |
|   [6]   | `uniqueId(base)`      | Generate unique test IDs            | Browser test isolation        |
|   [7]   | `effect.runSync(eff)` | Run Effect, return Exit             | Synchronous Effect execution  |

**Console Capture:**

```typescript
TEST_HARNESS.console.warn((spy) => {
    createStore(init, { name: 'INVALID!' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid store name'));
});
```

**Unique IDs:** Isolate browser tests with `uniqueName('prefix')` → `prefix-1`, `prefix-2`, etc.

---
## [6][HYBRID_STRATEGIES]
>**Dictum:** *Mix deterministic and property-based tests for comprehensive coverage.*

<br>

Combine strategies within single describe:

```typescript
describe('sanitizeFilename', () => {
    // Property-based: algorithmic coverage
    it.prop([FC_ARB.safeFilename()])('returns non-empty', (input) => {
        expect(sanitizeFilename(input).length).toBeGreaterThan(0);
    });

    // Deterministic: edge cases from B.samples
    it.each(B.samples.camelCase)('converts: %s', (input) => {
        expect(sanitizeFilename(input)).toMatch(/^[a-z0-9-]+$/);
    });

    // Edge case: explicit boundary
    it('handles empty string', () => expect(sanitizeFilename('')).toBe('export'));
});
```

**Schema Roundtrip:** Validate schema and validator consistency:

```typescript
it.prop([FC_ARB.storeName()])('schema and validator agree', (name) => {
    expect(validateStoreName(name)).toBe(S.decodeUnknownEither(Schema)(name)._tag === 'Right');
});
```

---
## [7][REFERENCES]
>**Dictum:** *Source files demonstrate pattern application.*

<br>

| [INDEX] | [FILE]                                    | [PATTERNS]                             |
| :-----: | ----------------------------------------- | -------------------------------------- |
|   [1]   | `packages/runtime/tests/temporal.spec.ts` | Dispatch tables, describe.each, Effect |
|   [2]   | `packages/runtime/tests/factory.spec.ts`  | Harness utilities, unique IDs, storage |
|   [3]   | `packages/runtime/tests/types.spec.ts`    | Schema roundtrip, validator consensus  |
|   [4]   | `packages/runtime/tests/browser.spec.ts`  | Error factories, property-based        |
|   [5]   | `packages/test-utils/src/arbitraries.ts`  | FC_ARB implementation, B constant      |
|   [6]   | `packages/test-utils/src/harness.ts`      | TEST_HARNESS implementation            |

**Related Docs:**
- [→standards.md](standards.md) — Authoring standards, anti-patterns
- [→overview.md](overview.md) — Architecture, topology, commands
- [→tooling.md](tooling.md) — Dependency catalog, version matrix
