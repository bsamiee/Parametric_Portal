# [H1][TESTING_STANDARDS]
>**Dictum:** *Dense, algorithmic, deterministic patterns enable high coverage with minimal LOC.*

<br>

Canonical standards for test authoring. Leverage `@effect/vitest` and `@fast-check/vitest` infrastructure.

**Philosophy:** Property-based generation + Effect-native assertions = high coverage, low maintenance.

[REFERENCE] Patterns: [→patterns.md](patterns.md) | Architecture: [→overview.md](overview.md)

---
## [1][FILE_STRUCTURE]
>**Dictum:** *Canonical section order enables rapid navigation.*

<br>

Test files live in `tests/` directory at repo root. Separators pad to column 80.

```typescript
/**
 * [Module] tests: [brief description].
 */
import { it, layer } from '@effect/vitest';
import { Array as A, Effect, FastCheck as fc, Option } from 'effect';
import { expect } from 'vitest';
import { FunctionUnderTest } from '@parametric-portal/server/module';

// --- [CONSTANTS] -------------------------------------------------------------
// --- [LAYER] -----------------------------------------------------------------
// --- [ALGEBRAIC] -------------------------------------------------------------
// --- [EDGE_CASES] ------------------------------------------------------------
```

**Import Order:** @effect/vitest → effect → vitest → source module.

**Test File Sections** (omit unused): Constants → Layer → Algebraic (property-based) → Edge Cases.

[IMPORTANT]:
- [ALWAYS] Use `// --- [LABEL] ` separator format padded to 80 columns.
- [NEVER] Create `[HELPERS]`, `[UTILS]`, `[CONFIG]` sections.

---
## [2][DENSITY_TECHNIQUES]
>**Dictum:** *Parametric generation multiplies coverage per LOC.*

<br>

| [INDEX] | [TECHNIQUE]                | [COVERAGE]                     | [USE_CASE]                     |
| :-----: | -------------------------- | ------------------------------ | ------------------------------ |
|   [1]   | `it.effect.prop()` PBT     | 50-200x cases                  | Domain invariants, round-trips |
|   [2]   | `it.each()` parameterized  | Nx cases                       | Sample validation, edge cases  |
|   [3]   | `describe.each()` cartesian| NxM cases                      | Multi-backend, multi-mode      |

<br>

### [2.1][PROPERTY_BASED]

Single test covers 50-200 generated cases. Shrinking finds minimal counterexamples.

```typescript
import { it } from '@effect/vitest';
import { Effect, FastCheck as fc } from 'effect';

const _json = fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 3 }));

it.effect.prop('round-trips preserve value', { x: _json, y: _json }, ({ x, y }) =>
    Effect.gen(function* () {
        const patch = Diff.create(x, y);
        if (patch) {
            const result = yield* Diff.apply(x, patch);
            expect(result).toEqual(y);
        }
    }), { fastCheck: { numRuns: 200 } });
```

### [2.2][PARAMETERIZED]

Matrix-driven from constant collections.

```typescript
const RFC6902_OPS = [
    { input: { a: 1 }, ops: [{ op: 'add', path: '/b', value: 2 }], expected: { a: 1, b: 2 } },
    { input: { a: 1, b: 2 }, ops: [{ op: 'remove', path: '/b' }], expected: { a: 1 } },
] as const;

it.each(RFC6902_OPS)('$ops.0.op operation', ({ input, ops, expected }) => {
    expect(Diff.apply(input, { ops })).resolves.toEqual(expected);
});
```

---
## [3][EFFECT_TESTING]
>**Dictum:** *Effect-native assertions treat Exit/Either/Option as first-class primitives.*

<br>

Custom matchers registered in `tests/setup.ts`:

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

### [3.1][EFFECT_VITEST]

Use `@effect/vitest` for Effect-native test runners:

```typescript
import { it, layer } from '@effect/vitest';

// Layer-scoped tests
const testLayer = Layer.mergeAll(Context.Request.SystemLayer, Crypto.Service.Default);

layer(testLayer)('Crypto', (it) => {
    it.effect('encrypts and decrypts', () => Effect.gen(function* () {
        const ciphertext = yield* Crypto.encrypt('hello');
        const plaintext = yield* Crypto.decrypt(ciphertext);
        expect(plaintext).toBe('hello');
    }));
});
```

### [3.2][PROPERTY_RETURN_VALUES]

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
## [4][ALGEBRAIC_LAWS]
>**Dictum:** *Test mathematical properties, not individual cases.*

<br>

| [INDEX] | [LAW]         | [PROPERTY]                                    | [EXAMPLE]                        |
| :-----: | ------------- | --------------------------------------------- | -------------------------------- |
|   [1]   | Identity      | `f(x, x) = neutral`                           | `Diff.create(x, x) = null`       |
|   [2]   | Inverse       | `apply(x, create(x, y)) = y`                  | Patch application                |
|   [3]   | Idempotent    | `f(f(x)) = f(x)`                              | Normalization                    |
|   [4]   | Composition   | `apply(apply(a, p1), p2) = apply(a, p1 ++ p2)`| Patch concatenation              |
|   [5]   | Immutability  | `apply(x, p)` does not mutate `x`             | Structural sharing               |

```typescript
// P1: Identity Law
it.effect.prop('P1: identity', { x: _json }, ({ x }) =>
    Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }));

// P2: Inverse Law
it.effect.prop('P2: inverse', { x: _json, y: _json }, ({ x, y }) =>
    Effect.fromNullable(Diff.create(x, y)).pipe(
        Effect.andThen((p) => Diff.apply(x, p)),
        Effect.map((r) => { expect(r).toEqual(y); }),
        Effect.optionFromOptional,
        Effect.asVoid));
```

---
## [5][ANTI-PATTERNS]
>**Dictum:** *Prohibited patterns increase maintenance and reduce reliability.*

<br>

| [INDEX] | [FORBIDDEN]                  | [REPLACEMENT]                    |
| :-----: | ---------------------------- | -------------------------------- |
|   [1]   | Hardcoded test arrays        | `it.each(CONSTANT_TABLE)`        |
|   [2]   | Manual loops in tests        | `describe.each()` + `it.prop()`  |
|   [3]   | `new Date()` in tests        | Frozen constants or Effect clock |
|   [4]   | `any` types                  | Branded types via Schema         |
|   [5]   | `if/else` in assertions      | Ternary + `&&` chaining          |
|   [6]   | Expression-form assertions   | Block syntax `{ expect(...); }`  |
|   [7]   | Magic numbers                | Named constants                  |
|   [8]   | `try/catch` in tests         | Effect error channel             |

---
## [6][REFERENCES]
>**Dictum:** *Cross-references enable navigation.*

<br>

| [INDEX] | [DOCUMENT]                  | [SCOPE]                           |
| :-----: | --------------------------- | --------------------------------- |
|   [1]   | [→overview.md](overview.md) | Architecture, topology, commands  |
|   [2]   | [→patterns.md](patterns.md) | B constant, dispatch tables       |

**Exemplar Specs:**
- `tests/packages/server/diff.spec.ts` — Property-based algebraic laws
- `tests/packages/server/crypto.spec.ts` — Layer-scoped Effect tests
- `tests/packages/server/transfer.spec.ts` — RFC compliance testing
