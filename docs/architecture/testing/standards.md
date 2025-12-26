# [H1][TESTING_STANDARDS]
>**Dictum:** *Dense, algorithmic, deterministic patterns enable 90-95% coverage in <250 LOC.*

<br>

Canonical standards for test authoring. Leverage infrastructure; never handroll.

**Philosophy:** Property-based generation + dispatch-driven parameterization + Effect-native assertions = high coverage, low maintenance.

[REFERENCE] Infrastructure: [→tooling.md](tooling.md) | Patterns: [→patterns.md](patterns.md) | Architecture: [→overview.md](overview.md)

---
## [1][FILE_STRUCTURE]
>**Dictum:** *Canonical section order enables rapid navigation.*

<br>

Test files mirror source organization. Separators pad to column 80.

```typescript
/**
 * [Module] tests: [brief description].
 */
import { it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';
import { TEST_CONSTANTS, TEST_HARNESS } from '@parametric-portal/test-utils';
import '@parametric-portal/test-utils/setup';
import { describe, expect, it } from 'vitest';
import { FunctionUnderTest, TUNING } from '../src/module';

// --- [TYPES] -----------------------------------------------------------------
// --- [PURE_FUNCTIONS] --------------------------------------------------------
// --- [CONSTANTS] -------------------------------------------------------------
// --- [MOCK] ------------------------------------------------------------------
// --- [DISPATCH_TABLES] -------------------------------------------------------
// --- [DESCRIBE] --------------------------------------------------------------
```

**Import Order:** fast-check → test-utils → vitest → source module.

[IMPORTANT]:
- [ALWAYS] Use `// --- [LABEL] ` separator format padded to 80 columns.
- [NEVER] Create `[HELPERS]`, `[UTILS]`, `[CONFIG]` sections.

---
## [2][DENSITY_TECHNIQUES]
>**Dictum:** *Parametric generation multiplies coverage per LOC.*

<br>

| [INDEX] | [TECHNIQUE]                 | [COVERAGE]                     | [LOC_REDUCTION] | [USE_CASE]                     |
| :-----: | --------------------------- | ------------------------------ | --------------- | ------------------------------ |
|   [1]   | `it.prop()` property-based  | 50-100x cases                  | ~80%            | Domain invariants, round-trips |
|   [2]   | `it.each()` parameterized   | Nx cases                       | ~70%            | Sample validation, edge cases  |
|   [3]   | `describe.each()` cartesian | NxM cases                      | ~85%            | Multi-backend, multi-mode      |
|   [4]   | Dispatch tables             | Single assertion → N behaviors | ~75%            | Factory testing, error types   |

<br>

### [2.1][PROPERTY_BASED]

Single test covers 50-100 generated cases. Shrinking finds minimal counterexamples.

```typescript
import { it as itProp } from '@fast-check/vitest';
import { FC_ARB } from '@parametric-portal/test-utils/arbitraries';

itProp.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])(
    'round-trips with exact value preservation',
    (key, value) => {
        storage.set(key, value);
        expect(storage.get(key)).toBe(value);
    },
);
```

### [2.2][PARAMETERIZED]

Matrix-driven from B constant collections.

```typescript
const B = Object.freeze({
    samples: { valid: ['alpha', 'beta-1', 'gamma_2'], invalid: ['', '123', '@bad'] },
} as const);

it.each(B.samples.valid)('accepts valid input: %s', (input) => {
    expect(validate(input)).toBeSuccess();
});
```

### [2.3][CARTESIAN]

Nested `describe.each()` for multi-dimensional coverage.

```typescript
describe.each(['localStorage', 'sessionStorage', 'indexedDB'] as const)('%s', (type) => {
    itProp.prop([FC_ARB.storageKey(), FC_ARB.jsonValue()])(
        'persists across operations',
        (key, value) => {
            const ops = createOps(type);
            ops.set(key, value);
            expect(ops.get(key)).toBe(value);
        },
    );
});
```

### [2.4][DISPATCH_TABLES]

Single assertion logic covers N behaviors via table iteration.

```typescript
const errorFactories = [
    { factory: mkClipboardError, def: TEST_CONSTANTS.errors.clipboardRead, tag: 'ClipboardError' },
    { factory: mkDownloadError, def: TEST_CONSTANTS.errors.downloadFailed, tag: 'DownloadError' },
] as const;

it.each(errorFactories)('$tag creates error with correct structure', ({ factory, def, tag }) => {
    const error = factory(def);
    expect(error._tag).toBe(tag);
    expect(error.code).toBe(def.code);
});
```

[CRITICAL] Use `as const` on dispatch tables for literal type interpolation in test names.

---
## [3][EFFECT_TESTING]
>**Dictum:** *Effect-native assertions treat Exit/Either/Option as first-class primitives.*

<br>

Custom matchers from `test-utils/matchers/effect.ts`:

| [INDEX] | [MATCHER]                       | [TYPE]         | [USAGE]                 |
| :-----: | ------------------------------- | -------------- | ----------------------- |
|   [1]   | `toBeSuccess(expected?)`        | `Exit<A, E>`   | Effect pipeline success |
|   [2]   | `toBeFailure(expected?)`        | `Exit<A, E>`   | Effect pipeline failure |
|   [3]   | `toBeRight(expected?)`          | `Either<E, A>` | Schema decode success   |
|   [4]   | `toBeLeft(expected?)`           | `Either<E, A>` | Schema decode failure   |
|   [5]   | `toBeSome(expected?)`           | `Option<A>`    | Optional value present  |
|   [6]   | `toBeNone()`                    | `Option<A>`    | Optional value absent   |
|   [7]   | `toDecodeAs(schema, expected?)` | `unknown`      | Schema validation       |

<br>

### [3.1][RUN_HELPER]

Wrap Effect execution for Exit-based assertions.

```typescript
const run = <A, E>(eff: Effect.Effect<A, E, never>): Exit.Exit<A, E> =>
    Effect.runSyncExit(eff);

it('parses valid ISO date', () => {
    expect(run(temporalApi.parseIso('2025-01-15'))).toBeSuccess();
});

it('fails invalid date', () => {
    const result = run(temporalApi.parseIso('invalid'));
    expect(result).toBeFailure();
});
```

### [3.2][PIPE_COMPOSITION]

Test compositions via pipe; no intermediate assertions.

```typescript
itProp.prop([FC_ARB.days().filter((v) => v !== 0)])(
    'inverse operation is identity',
    (value) => {
        const result = pipe(
            temporalApi.addDays(value)(baseDate),
            Effect.flatMap(temporalApi.addDays(-value)),
            Effect.map(DateTime.toEpochMillis),
            Effect.runSyncExit,
        );
        expect(result).toBeSuccess(baseMs);
    },
);
```

### [3.3][CONDITIONAL_ASSERTIONS]

Expression-centric guards via ternary and `&&` chaining.

```typescript
const exit = run(temporalApi.addMonths(months)(baseDate));
Exit.isSuccess(exit) &&
    expect(new Date(DateTime.toEpochMillis(exit.value)).getMonth())
        .toBe((baseMonth + months + 12) % 12);
```

[IMPORTANT]:
- [ALWAYS] Use `toBeSuccess`/`toBeFailure` for Exit, not manual `Exit.isSuccess` checks.
- [NEVER] Extract values with pattern-matching in assertions—let matchers handle it.

---
## [4][INFRASTRUCTURE]
>**Dictum:** *Leverage test-utils exclusively; never handroll utilities.*

<br>

### [4.1][FC_ARB]

Parametric generators in `@parametric-portal/test-utils/arbitraries`:

| [INDEX] | [GENERATOR]                      | [OUTPUT]        | [USE_CASE]                |
| :-----: | -------------------------------- | --------------- | ------------------------- |
|   [1]   | `storageKey()`                   | `string`        | Storage key validation    |
|   [2]   | `storeName()`                    | `string`        | Store name patterns       |
|   [3]   | `isoDate()`                      | `string`        | Temporal parsing          |
|   [4]   | `jsonValue()`                    | `string`        | Serialization round-trips |
|   [5]   | `messageData()`                  | `unknown`       | Polymorphic payloads      |
|   [6]   | `fileExtension()`                | `FileExtension` | File handling             |
|   [7]   | `fromSchema(schema)`             | `A`             | Schema-derived generation |
|   [8]   | `days()`, `hours()`, `minutes()` | `number`        | Temporal offsets          |

### [4.2][TEST_HARNESS]

Isolation utilities in `@parametric-portal/test-utils/harness`:

| [INDEX] | [UTILITY]                             | [SIGNATURE]     | [PURPOSE]              |
| :-----: | ------------------------------------- | --------------- | ---------------------- |
|   [1]   | `effect.runSync(eff)`                 | `Effect → Exit` | Sync Effect execution  |
|   [2]   | `console.log/warn/error(fn)`          | `(spy) => T`    | Console capture        |
|   [3]   | `env.production/development/test(fn)` | `() => T`       | Environment isolation  |
|   [4]   | `storage.seed(name, state)`           | `void`          | Pre-populate storage   |
|   [5]   | `storage.clear()`                     | `void`          | Reset all storage      |
|   [6]   | `timers.advance(ms?)`                 | `Promise<void>` | Fake timer advancement |
|   [7]   | `uniqueId(prefix?)`                   | `string`        | Isolated test IDs      |
|   [8]   | `spy(target, method, fn)`             | `T`             | Auto-cleanup spyOn     |

### [4.3][TEST_CONSTANTS]

Deterministic values in `@parametric-portal/test-utils/constants`:

| [INDEX] | [CONSTANT]   | [VALUE]                    | [PURPOSE]                  |
| :-----: | ------------ | -------------------------- | -------------------------- |
|   [1]   | `frozenTime` | `2025-01-15T12:00:00.000Z` | Deterministic date         |
|   [2]   | `fc.numRuns` | 100 (CI) / 50 (local)      | Property test iterations   |
|   [3]   | `fc.seed`    | `FC_SEED` env var          | Reproducible failures      |
|   [4]   | `errors.*`   | `{code, message}`          | Standard error definitions |

### [4.4][MOCKING]

HTTP mocking via `test-utils/mocks/*`:

```typescript
// Fetch mock (simple)
const cleanup = FetchMock.install({ json: { data: 'test' } });

// MSW mock (full HTTP)
MswServer.start();
MswServer.use(MswMock.get('/api/users', { id: 1, name: 'Alice' }));
MswServer.use(MswServer.error('/api/broken', 500, 'Server Error'));
```

[CRITICAL]:
- [NEVER] Create inline mock implementations.
- [ALWAYS] Use `FetchMock` or `MswMock` from test-utils.

---
## [5][DETERMINISM]
>**Dictum:** *Reproducible tests require controlled inputs.*

<br>

| [INDEX] | [ASPECT] | [MECHANISM]         | [IMPLEMENTATION]                |
| :-----: | -------- | ------------------- | ------------------------------- |
|   [1]   | Time     | Frozen reference    | `TEST_CONSTANTS.frozenTime`     |
|   [2]   | IDs      | Auto-increment      | `TEST_HARNESS.uniqueId(prefix)` |
|   [3]   | Seeds    | Environment control | `FC_SEED` env var               |
|   [4]   | Timers   | Fake timers         | `vi.useFakeTimers()` in setup   |
|   [5]   | Storage  | Clear between tests | `beforeEach` in setup.ts        |

<br>

**B Constant Pattern:** Derive all test values from frozen base.

```typescript
const B = Object.freeze({
    frozenDate: TEST_CONSTANTS.frozenTime,
    derived: {
        msPerDay: 24 * 60 * 60 * 1000,
        msPerHour: 60 * 60 * 1000,
    },
    bounds: { historyLimit: { min: 1, max: 1000 } },
} as const);
```

[IMPORTANT]:
- [NEVER] Use `new Date()` in tests—always reference B constant.
- [ALWAYS] Derive numeric values algorithmically from base constants.

---
## [6][E2E_PATTERNS]
>**Dictum:** *Playwright automation via agent workflows.*

<br>

### [6.1][BOOTSTRAP]

Dual-app startup for integration testing:

| [INDEX] | [APP] | [PORT] | [COMMAND]                           |
| :-----: | ----- | ------ | ----------------------------------- |
|   [1]   | API   | 4000   | `pnpm exec nx dev api`              |
|   [2]   | Icons | 3001   | `pnpm exec nx dev parametric_icons` |

### [6.2][AGENT_AUTOMATION]

MCP-powered test generation and healing:

| [INDEX] | [AGENT]                     | [PURPOSE]                          |
| :-----: | --------------------------- | ---------------------------------- |
|   [1]   | `playwright-test-planner`   | UI exploration, test plan creation |
|   [2]   | `playwright-test-generator` | Code generation from plans         |
|   [3]   | `playwright-test-healer`    | Failure debugging, locator updates |

### [6.3][ACCESSIBILITY]

WCAG compliance via `@axe-core/playwright`:

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('page has no accessibility violations', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
});
```

### [6.4][TRACE_CAPTURE]

Configuration in `playwright.config.ts`:

```typescript
trace: {
    mode: 'retain-on-failure',
    screenshots: true,
    snapshots: true,
},
```

[IMPORTANT] Use `e2e-ci` target for Atomizer parallel sharding in CI.

---
## [7][MUTATION_TESTING]
>**Dictum:** *Mutation score validates test quality via fault injection.*

<br>

### [7.1][THRESHOLDS]

| [INDEX] | [THRESHOLD] | [VALUE] | [ACTION]          |
| :-----: | ----------- | ------- | ----------------- |
|   [1]   | break       | 80%     | CI fails below    |
|   [2]   | high        | 90%     | Green badge       |
|   [3]   | low         | 70%     | Warning threshold |

### [7.2][INCREMENTAL]

Cache path: `.nx/cache/stryker-incremental.json`

Run incrementally to test only changed files:

```bash
pnpm exec nx run-many -t mutate
```

### [7.3][SURVIVOR_ANALYSIS]

When mutations survive (not killed by tests):
1. Identify untested branch in mutation report
2. Add targeted test case or property
3. Prioritize boundary conditions and error paths

[CRITICAL] Mutation score below 80% fails CI build.

---
## [8][ANTI-PATTERNS]
>**Dictum:** *Prohibited patterns increase maintenance and reduce reliability.*

<br>

| [INDEX] | [FORBIDDEN]                 | [REPLACEMENT]                   |
| :-----: | --------------------------- | ------------------------------- |
|   [1]   | Hardcoded test arrays       | `it.each(B.samples.*)`          |
|   [2]   | Manual loops in tests       | `describe.each()` + `it.prop()` |
|   [3]   | `new Date()`                | `TEST_CONSTANTS.frozenTime`     |
|   [4]   | Inline arbitrary bounds     | `FC_ARB.*` generators           |
|   [5]   | `any` types                 | Branded types via Schema        |
|   [6]   | `if/else` in assertions     | Ternary + `&&` chaining         |
|   [7]   | Manual cleanup              | `TEST_HARNESS.*` wrappers       |
|   [8]   | Custom mock implementations | `FetchMock`, `MswMock`          |
|   [9]   | Magic numbers               | Derive from B constant          |
|  [10]   | `try/catch` in tests        | Effect error channel            |

---
## [9][REFERENCES]
>**Dictum:** *Cross-references enable navigation.*

<br>

| [INDEX] | [DOCUMENT]                  | [SCOPE]                                        |
| :-----: | --------------------------- | ---------------------------------------------- |
|   [1]   | [→overview.md](overview.md) | Architecture, topology, commands               |
|   [2]   | [→patterns.md](patterns.md) | B constant, dispatch tables, hybrid strategies |
|   [3]   | [→tooling.md](tooling.md)   | Dependency catalog, version matrix             |

**Exemplar Specs:**
- `packages/runtime/tests/temporal.spec.ts` — Property-based + Effect
- `packages/runtime/tests/factory.spec.ts` — Dispatch tables
- `packages/runtime/tests/storage.spec.ts` — Parameterized + harness
