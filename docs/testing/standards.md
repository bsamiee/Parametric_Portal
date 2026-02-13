# [H1][TESTING_STANDARDS]
>**Dictum:** *Dense, algorithmic, deterministic patterns enable high coverage with minimal LOC.*

Canonical standards for test authoring. Leverage `@effect/vitest` for Effect-native property-based testing.

[REFERENCE] Patterns: [->patterns.md](patterns.md) | Laws: [->laws.md](laws.md) | Guardrails: [->guardrails.md](guardrails.md)

---
## [1][FILE_STRUCTURE]
>**Dictum:** *Canonical section order enables rapid navigation.*

Unit tests for `packages/server/` live in `tests/packages/server/`. Integration tests go in `tests/integration/`. Fixtures in `tests/fixtures/`. System tests in `tests/system/`. Separators pad to column 80.

```typescript
/**
 * [Module] tests: [brief description].
 */
import { it, layer } from '@effect/vitest';
import { FunctionUnderTest } from '@parametric-portal/server/module';
import { Array as A, Effect, FastCheck as fc, Option } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------
// --- [LAYER] -----------------------------------------------------------------
// --- [ALGEBRAIC] -------------------------------------------------------------
// --- [EDGE_CASES] ------------------------------------------------------------
```

**Import Order:** @effect/vitest -> source module -> effect -> vitest.<br>
**Test File Sections** (omit unused): Constants -> Layer -> Algebraic (property-based) -> Edge Cases.

[IMPORTANT]:
- [ALWAYS] Use `// --- [LABEL]` separator format padded to 80 columns.
- [NEVER] Create `[HELPERS]`, `[UTILS]`, `[CONFIG]` sections.

---
## [2][CONSTANTS_PATTERN]
>**Dictum:** *Frozen constants centralize test data per spec file.*

| [INDEX] | [PREFIX] | [PURPOSE]              | [EXAMPLE]                     |
| :-----: | -------- | ---------------------- | ----------------------------- |
|   [1]   | `_`      | Fast-check arbitraries | `_json`, `_text`, `_nonempty` |
|   [2]   | `_`      | Schema-derived arbs    | `Arbitrary.make(ItemSchema)`  |
|   [3]   | `UPPER`  | Static constants       | `CIPHER`, `RFC6902_OPS`       |

```typescript
const _safeKey = fc.string({ maxLength: 24, minLength: 1 })
    .filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 3 }));
const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;
```

[IMPORTANT]:
- [ALWAYS] Use `as const` for literal inference on static constants.
- [ALWAYS] Filter arbitraries to exclude dangerous values (proto pollution).
- [NEVER] Scatter test data across multiple ad-hoc variables.

---
## [3][DENSITY_TECHNIQUES]
>**Dictum:** *Parametric generation multiplies coverage per LOC.*

| [INDEX] | [TECHNIQUE]                 | [MULTIPLIER]       | [USE_CASE]                              |
| :-----: | --------------------------- | ------------------ | --------------------------------------- |
|   [1]   | `it.effect.prop()` PBT      | 50-200x cases      | Domain invariants, round-trips          |
|   [2]   | Property packing            | 2-4x per test      | Multiple laws in single prop body       |
|   [3]   | `Effect.all` aggregation    | Nx1 assertion      | Parallel ops, single structural check   |
|   [4]   | Statistical testing         | Batch validation   | Chi-squared, distribution analysis      |
|   [5]   | Symmetric properties        | 2x directions      | Test both (x,y) and (y,x)               |
|   [6]   | `fc.pre()` filtering        | Constrain space    | Preconditions without branching         |
|   [7]   | `fc.sample()` batching      | Bulk generation    | Statistical analysis outside PBT loop   |
|   [8]   | Model-based (`fc.commands`) | Stateful sequences | Arbitrary command interleavings         |
|   [9]   | External oracle vectors     | Authoritative      | RFC 6902, NIST CAVP test vectors        |
|  [10]   | Schema-derived arbs         | Schema-synced      | `Arbitrary.make(S)` from @effect/schema |

### [3.1][PROPERTY_BASED]
Single test covers 50-200 generated cases. Shrinking finds minimal counterexamples.
```typescript
it.effect.prop('round-trips preserve value', { x: _json, y: _json }, ({ x, y }) =>
    Effect.fromNullable(Diff.create(x, y)).pipe(
        Effect.andThen((patch) => Diff.apply(x, patch)),
        Effect.tap((result) => { expect(result).toEqual(y); }),
        Effect.optionFromOptional,
        Effect.asVoid,
    ), { fastCheck: { numRuns: 200 } });
```

### [3.2][EFFECT_ALL_AGGREGATION]
Aggregate multiple checks in a single structural assertion -- reduces LOC, increases coverage density:
```typescript
it.effect('P6: RFC6902 ops', () => Effect.all([
    Diff.apply({ a: 1 },        { ops: [{ op: 'add',     path: '/b',     value: 2 }] }),
    Diff.apply({ a: 1, b: 2 },  { ops: [{ op: 'remove',  path: '/b' }] }),
    Diff.apply({ a: 1 },        { ops: [{ op: 'replace', path: '/a',     value: 9 }] }),
]).pipe(Effect.map((r) => expect(r).toEqual([{ a: 1, b: 2 }, { a: 1 }, { a: 9 }]))));
```

---
## [4][EFFECT_TESTING]
>**Dictum:** *Effect-native assertions treat Exit/Either/Option as first-class primitives.*

`tests/setup.ts` registers `addEqualityTesters()` from `@effect/vitest` -- enables structural equality for Effect types in `expect().toEqual()`. Custom matchers (`.toSucceed()`, `.toBeRight()`) are forbidden -- use `it.effect()` + standard `expect()` within the Effect pipeline.

### [4.1][LAYER_SCOPED]
```typescript
const _testLayer = Crypto.Service.Default.pipe(
    Layer.provide(Layer.setConfigProvider(ConfigProvider.fromMap(new Map([...])))),
);
layer(_testLayer)('Crypto', (it) => {
    it.effect.prop('P1: inverse + nondeterminism', { x: _text }, ({ x }) =>
        Effect.gen(function* () {
            const [c1, c2] = yield* Effect.all([Crypto.encrypt(x), Crypto.encrypt(x)]);
            expect(yield* Crypto.decrypt(c1)).toBe(x);
            expect(c1.join(',')).not.toBe(c2.join(','));
        }));
});
```

### [4.2][PROPERTY_RETURN_VALUES]
[CRITICAL] Property-based tests must return `void` or `Effect<void>`. Use block syntax for assertions:
```typescript
// CORRECT: Block syntax returns void
it.effect.prop('identity', { x: _json }, ({ x }) =>
    Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }));

// WRONG: Expression returns Assertion object (causes false failures)
it.effect.prop('identity', { x: _json }, ({ x }) =>
    Effect.sync(() => expect(Diff.create(x, x)).toBeNull()));
```

---
## [5][ADVANCED_PATTERNS]
>**Dictum:** *Advanced fast-check patterns maximize generation quality.*

### [5.1][PRECONDITION_FILTERING]
Use `fc.pre()` to constrain generation space without branching logic. Rejects invalid samples at the generator level. See [->laws.md](laws.md) for security isolation properties using `fc.pre()`.
```typescript
fc.pre(t1 !== t2);  // Rejects invalid samples, no if/continue
return Effect.gen(function* () { /* tenant isolation assertions */ });
```

### [5.2][MODEL_BASED_TESTING]
Stateful property testing via `fc.commands()` + `fc.asyncModelRun()`. Commands mutate both a lightweight model and the real system; invariants asserted after arbitrary command sequences.
```typescript
await fc.assert(fc.asyncProperty(fc.commands(allCommands), (cmds) =>
    fc.asyncModelRun(() => ({ model: new TransferModel(), real: new TransferReal() }), cmds)));
```

### [5.3][CHAOS_AND_FAULT_INJECTION]
Effect layer wrapping for configurable failure injection (Nth-call failure, delay). Use `TestClock.adjust()` + `Fiber.fork/join` for deterministic time-dependent testing. Differential testing cross-validates against reference implementations.

### [5.4][SCHEMA_DERIVED_ARBITRARIES]
`Arbitrary.make(Schema)` from `@effect/schema` generates arbitraries directly from domain schemas -- stays in sync, replaces hand-rolled generators. Example: `const _item = Arbitrary.make(ItemSchema);`

---
## [6][ANTI_PATTERNS]
>**Dictum:** *Forbidden patterns have deterministic replacements.*

| [INDEX] | [FORBIDDEN]                | [REPLACEMENT]                                |
| :-----: | -------------------------- | -------------------------------------------- |
|   [1]   | Hardcoded test arrays      | `it.each(CONSTANT_TABLE)`                    |
|   [2]   | Manual loops in tests      | `describe.each()` + `it.prop()`              |
|   [3]   | `new Date()` in tests      | Frozen constants or Effect clock             |
|   [4]   | `any` types                | Branded types via Schema                     |
|   [5]   | `if/else` branching        | `Effect.fromNullable`, ternary, `fc.pre()`   |
|   [6]   | Expression-form assertions | Block syntax `{ expect(...); }`              |
|   [7]   | Magic numbers              | Named constants                              |
|   [8]   | `try/catch` in tests       | Effect error channel                         |
|   [9]   | Re-deriving source logic   | Algebraic law or external oracle             |
|  [10]   | Hand-rolled arbitraries    | `Arbitrary.make(Schema)` from @effect/schema |

See [->guardrails.md](guardrails.md) for PostToolUse hook enforcement of these patterns.
