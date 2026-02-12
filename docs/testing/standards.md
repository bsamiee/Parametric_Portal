# [H1][TESTING_STANDARDS]
>
>**Dictum:** *Dense, algorithmic, deterministic patterns enable high coverage with minimal LOC.*

<br>

Canonical standards for test authoring. Leverage `@effect/vitest` for Effect-native property-based testing.

**Philosophy:** Algebraic property generation + Effect composition + mutation testing = 95% per-file coverage in <125 LOC per file.

[REFERENCE] Patterns: [->patterns.md](patterns.md) | Architecture: [->overview.md](overview.md)

---

## [1][FILE_STRUCTURE]
>
>**Dictum:** *Canonical section order enables rapid navigation.*

<br>

Unit tests for `packages/server/` live in `tests/packages/server/`. Integration tests go in `tests/integration/`.Fixtures in `tests/fixtures/`. System tests in `tests/system/`. Separators pad to column 80.

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

## [2][DENSITY_TECHNIQUES]
>
>**Dictum:** *Parametric generation multiplies coverage per LOC.*

<br>

| [INDEX] | [TECHNIQUE]                 | [MULTIPLIER]     | [USE_CASE]                              |
| :-----: | --------------------------- | ---------------- | --------------------------------------- |
|   [1]   | `it.effect.prop()` PBT      | 50-200x cases    | Domain invariants, round-trips          |
|   [2]   | Property packing            | 2-4x per test    | Multiple laws in single prop body       |
|   [3]   | `Effect.all` aggregation    | Nx1 assertion    | Parallel ops, single structural check   |
|   [4]   | Statistical testing         | Batch validation | Chi-squared, distribution analysis      |
|   [5]   | Symmetric properties        | 2x directions    | Test both (x,y) and (y,x)               |
|   [6]   | `fc.pre()` filtering        | Constrain space  | Preconditions without branching         |
|   [7]   | `fc.sample()` batching      | Bulk generation  | Statistical analysis outside PBT loop   |
|   [8]   | Model-based (`fc.commands`) | Stateful sequences | Arbitrary command interleavings       |
|   [9]   | External oracle vectors     | Authoritative    | RFC 6902, NIST CAVP test vectors        |
|  [10]   | Schema-derived arbs         | Schema-synced    | `Arbitrary.make(S)` from @effect/schema |

<br>

### [2.1][PROPERTY_BASED]

Single test covers 50-200 generated cases. Shrinking finds minimal counterexamples.

```typescript
const _json = fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 3 }));

it.effect.prop('round-trips preserve value', { x: _json, y: _json }, ({ x, y }) =>
    Effect.fromNullable(Diff.create(x, y)).pipe(
        Effect.andThen((patch) => Diff.apply(x, patch)),
        Effect.tap((result) => { expect(result).toEqual(y); }),
        Effect.optionFromOptional,
        Effect.asVoid,
    ), { fastCheck: { numRuns: 200 } });
```

### [2.2][PROPERTY_PACKING]

Pack 2-4 logically related laws into a single test body to maximize assertions per LOC:

```typescript
// crypto P7: 4 hash laws verified in 1 test (determinism + reflexivity + correctness + symmetry)
it.effect.prop('P7: hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) =>
    Effect.gen(function* () {
        const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([
            Crypto.hash(x), Crypto.hash(x), Crypto.compare(x, x), Crypto.compare(x, y), Crypto.compare(y, x),
        ]);
        expect(h1).toBe(h2);           // Determinism
        expect(eqSelf).toBe(true);      // Reflexivity
        expect(eqXY).toBe(x === y);     // Correctness
        expect(eqXY).toBe(eqYX);        // Symmetry
    }));
```

---

## [3][EFFECT_TESTING]
>
>**Dictum:** *Effect-native assertions treat Exit/Either/Option as first-class primitives.*

<br>

`tests/setup.ts` registers `addEqualityTesters()` from `@effect/vitest` -- enables structural equality for Effect types in `expect().toEqual()` comparisons. Custom matchers (`.toSucceed()`, `.toBeRight()`) are forbidden -- use `it.effect()` + standard `expect()` assertions within the Effect pipeline.

### [3.1][LAYER_SCOPED]

```typescript
import { it, layer } from '@effect/vitest';

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
>
>**Dictum:** *Test mathematical properties, not individual cases.*

<br>

| [INDEX] | [LAW]        | [PROPERTY]                                     | [EXAMPLE]                  |
| :-----: | ------------ | ---------------------------------------------- | -------------------------- |
|   [1]   | Identity     | `f(x, x) = neutral`                            | `Diff.create(x, x) = null` |
|   [2]   | Inverse      | `apply(x, create(x, y)) = y`                   | Patch application          |
|   [3]   | Idempotent   | `f(f(x)) = f(x)`                               | Normalization              |
|   [4]   | Composition  | `apply(apply(a, p1), p2) = apply(a, p1 ++ p2)` | Patch concatenation        |
|   [5]   | Immutability | `apply(x, p)` does not mutate `x`              | Structural sharing         |
|   [6]   | Equivalence  | `f_ours(x) = f_ref(x)` for all x              | Differential testing       |

---

## [5][GUARDRAILS]
>
>**Dictum:** *Tests verify externally observable properties, never implementation internals.*

<br>

### [5.1][IMPLEMENTATION_CONFIRMING_DETECTION]

A test is **implementation-confirming** if changing the internal algorithm (while preserving the contract) breaks it. Algebraic tests assert externally observable mathematical properties (identity, inverse, equivalence) rather than replicating source logic. **Mutation testing** (Stryker, `pnpm test:mutate`) is the primary automated defense: a circular test that re-derives source logic will have a LOW mutation score because mutants survive when the test computes the same wrong answer.

**Defense-in-depth pipeline:** algebraic PBT -> mutation testing -> external oracles -> PostToolUse hook -> human review.

| [INDEX] | [SIGNAL]                              | [FIX]                                        |
| :-----: | ------------------------------------- | -------------------------------------------- |
|   [1]   | Asserts internal data structures      | Assert output shape or behavioral property   |
|   [2]   | Mirrors source code branching logic   | Use algebraic law (identity, inverse, etc.)  |
|   [3]   | Hardcodes expected intermediate state | Generate inputs, assert only final invariant |
|   [4]   | Breaks when refactoring internals     | Test externally observable contract          |
|   [5]   | Tests private function directly       | Test via public API composition              |
|   [6]   | Low mutation score (< 60%)            | Replace with algebraic or oracle-based test  |

### [5.2][COVERAGE_CONSTRAINTS]

[CRITICAL] Every test file MUST achieve 95% per-file coverage (statements, branches, functions) in <125 LOC. Run `pnpm exec nx test -- --coverage` to verify. Aggregate coverage across all files is NOT sufficient -- each file is measured independently. Mutation score thresholds: high=80, low=60, break=50 (configured in `stryker.config.mjs`).

### [5.3][ANTI_PATTERNS]

| [INDEX] | [FORBIDDEN]                | [REPLACEMENT]                              |
| :-----: | -------------------------- | ------------------------------------------ |
|   [1]   | Hardcoded test arrays      | `it.each(CONSTANT_TABLE)`                  |
|   [2]   | Manual loops in tests      | `describe.each()` + `it.prop()`            |
|   [3]   | `new Date()` in tests      | Frozen constants or Effect clock           |
|   [4]   | `any` types                | Branded types via Schema                   |
|   [5]   | `if/else` branching        | `Effect.fromNullable`, ternary, `fc.pre()` |
|   [6]   | Expression-form assertions | Block syntax `{ expect(...); }`            |
|   [7]   | Magic numbers              | Named constants                            |
|   [8]   | `try/catch` in tests       | Effect error channel                       |
|   [9]   | Re-deriving source logic   | Algebraic law or external oracle           |
|  [10]   | Hand-rolled arbitraries    | `Arbitrary.make(Schema)` from @effect/schema |

### [5.4][AUTOMATED_ENFORCEMENT]

The PostToolUse hook (`.claude/hooks/validate-spec.sh`) validates every Edit/Write to `*.spec.ts` files, enforcing: 125 LOC limit, anti-patterns from [5.3], expression-form assertions, and import order. Violations emit JSON `decision: "block"` with line-specific errors for agent self-correction.

---

## [6][REFERENCES]
>
>**Dictum:** *Cross-references enable navigation.*

<br>

| [INDEX] | [DOCUMENT]                   | [SCOPE]                           |
| :-----: | ---------------------------- | --------------------------------- |
|   [1]   | [->overview.md](overview.md) | Architecture, topology, commands  |
|   [2]   | [->patterns.md](patterns.md) | Density techniques, code patterns |

**Exemplar Specs:**

- `tests/packages/server/diff.spec.ts` -- Algebraic laws, composition, immutability
- `tests/packages/server/crypto.spec.ts` -- Layer-scoped, statistical, security properties
- `tests/packages/server/transfer.spec.ts` -- Codec roundtrips, boundary + security testing
- `tests/packages/server/transfer-model.spec.ts` -- Model-based stateful testing via `fc.commands()`
- `tests/packages/server/diff-vectors.spec.ts` -- External oracle vectors (RFC 6902)
