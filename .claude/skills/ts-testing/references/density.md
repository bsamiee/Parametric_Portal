# [H1][DENSITY_TECHNIQUES]
>**Dictum:** *Maximize coverage per LOC -- every line of test code must earn its place.*

Density is the ratio of verified behavior to test LOC. Techniques ordered by coverage multiplier.

---
## [1][TECHNIQUE_CATALOG]
>**Dictum:** *Select the highest-multiplier technique that fits the property shape.*

| [INDEX] | [TECHNIQUE]              | [MULTIPLIER]  | [MECHANISM]                                                  |
| :-----: | ------------------------ | ------------- | ------------------------------------------------------------ |
|   [1]   | `it.effect.prop` PBT     | 50-200x       | Single universally-quantified property                       |
|   [2]   | Property packing         | 2-4x          | Multiple laws sharing one arbitrary shape                    |
|   [3]   | `Effect.all` aggregation | Nx1           | N independent ops, single structural expect                  |
|   [4]   | Table-driven vectors     | Nx1           | N vectors, single parameterized test body                    |
|   [5]   | Symmetric iteration      | 2x            | `[[x,y],[y,x]] as const` + forEach                           |
|   [6]   | Statistical batching     | Bulk          | `fc.sample()` + distribution analysis                        |
|   [7]   | Schema-derived arbs      | Synced        | `Arbitrary.make(S)` eliminates hand-rolled gens              |
|   [8]   | `fc.pre()` filtering     | Constrain     | Preconditions without if/else branching                      |
|   [9]   | Model-based commands     | Stateful      | Arbitrary command interleavings via fc.commands()            |
|  [10]   | External oracle vectors  | Authoritative | RFC/NIST vectors as `as const` + forEach                     |
|  [11]   | `fc.scheduler()` races   | Concurrent    | Adversarial interleaving of async/fiber operations           |
|  [12]   | Orchestration extraction | LOC/3         | Extract repeated service-call pattern to helper, merge tests |

**Selection heuristic:** Start at [1]. Drop to lower-multiplier techniques only when the property shape or cost prevents a higher one.

---
## [2][PROPERTY_BASED_TESTING]
>**Dictum:** *A single `it.effect.prop` replaces 50-200 hand-written examples.*

```typescript
it.effect.prop('inverse', { x: _json, y: _json }, ({ x, y }) =>
    Effect.fromNullable(Module.diff(x, y)).pipe(
        Effect.andThen((patch) => Module.apply(x, patch)),
        Effect.tap((result) => { expect(result).toEqual(y); }),
        Effect.optionFromOptional, Effect.asVoid,
    ), { fastCheck: { numRuns: 200 } });
```

### [2.1][NUMRUNS_CALIBRATION]

| [INDEX] | [TECHNIQUE]        | [NUMRUNS] | [RATIONALE]                          |
| :-----: | ------------------ | :-------: | ------------------------------------ |
|   [1]   | Algebraic PBT      |  100-200  | Cheap generation, high value per run |
|   [2]   | Schema-derived PBT |  50-100   | Moderate generation cost             |
|   [3]   | Model-based        |   15-30   | Expensive setup per command sequence |
|   [4]   | Security isolation |    50     | Costly cross-tenant operations       |
|   [5]   | Scheduler races    |   15-30   | Each run explores different ordering |

---
## [3][PROPERTY_PACKING]
>**Dictum:** *Pack related laws sharing the same arbitrary shape into one property.*

**Pack when:** Same arbitrary parameters, same numRuns, laws form a logical group.
**Split when:** Different arbitrary shapes, mixed success/failure expectations, unrelated operations.
**Merge edge cases when:** Same mock factory parameters, same `_provide` wiring, tests exercise different branches of same `Match`/pipeline. Extract repeated service-call orchestration into `[FUNCTIONS]` helper, then aggregate assertions with `Effect.all` + destructuring. Reduces 3 tests (~30 LOC) to 1 test (~12 LOC).

```typescript
// 4 laws packed: determinism + reflexivity + equivalence + symmetry
it.effect.prop('hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) =>
    Effect.gen(function* () {
        const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([
            Module.hash(x), Module.hash(x),
            Module.compare(x, x), Module.compare(x, y), Module.compare(y, x),
        ]);
        expect(h1).toBe(h2);           // Determinism
        expect(eqSelf).toBe(true);      // Reflexivity
        expect(eqXY).toBe(x === y);     // Equivalence
        expect(eqXY).toBe(eqYX);        // Symmetry
    }));
```

**Density gain:** 4 laws in ~12 LOC vs 4 separate tests at ~8 LOC each (12 vs 32).

---
## [4][EFFECT_ALL_AGGREGATION]
>**Dictum:** *Aggregate N independent checks into a single structural assertion.*

```typescript
it.effect('RFC ops', () => Effect.all([
    Module.apply({ a: 1 },       { ops: [{ op: 'add',     path: '/b', value: 2 }] }),
    Module.apply({ a: 1, b: 2 }, { ops: [{ op: 'remove',  path: '/b' }] }),
    Module.apply({ a: 1 },       { ops: [{ op: 'replace', path: '/a', value: 9 }] }),
]).pipe(Effect.map((r) => expect(r).toEqual([{ a: 1, b: 2 }, { a: 1 }, { a: 9 }]))));
```

**Error path variant** -- same pattern for failure codes:
```typescript
it.effect('error codes', () => Effect.all([
    Module.parse('invalid').pipe(Effect.flip, Effect.map((e) => e.code)),
    Module.parse('').pipe(Effect.flip, Effect.map((e) => e.code)),
]).pipe(Effect.map((codes) => expect(codes).toEqual(['INVALID_RECORD', 'MISSING_TYPE']))));
```

---
## [5][TABLE_DRIVEN_TESTS]
>**Dictum:** *Externalize variation into data tables, keep test body singular.*

```typescript
const RFC6902_VECTORS = [
    { doc: { foo: 'bar' }, expected: { baz: 'qux', foo: 'bar' }, patch: [{ op: 'add', path: '/baz', value: 'qux' }] },
    // ... N vectors
] as const;

it.effect('RFC6902 vectors', () =>
    Effect.forEach(RFC6902_VECTORS, (v) =>
        Module.apply(v.doc, { ops: [...v.patch] }).pipe(
            Effect.tap((r) => { expect(r).toEqual(v.expected); }),
        )).pipe(Effect.asVoid));
```

Prefer `Effect.forEach` over `it.each` when the test body uses an Effect pipeline.
---
## [6][SYMMETRIC_PROPERTIES]
>**Dictum:** *Test both directions to double coverage from a single arbitrary.*

```typescript
Effect.forEach([[x, y], [y, x]] as const, ([source, target]) =>
    Module.diff(source, target).pipe(
        Effect.andThen((patch) => Module.apply(source, patch)),
        Effect.tap((result) => { expect(result).toEqual(target); }),
    ));
```

Applies to: inverse laws, commutative operations, bidirectional codecs.

---
## [7][ADVANCED_GENERATION]
>**Dictum:** *Generator quality directly determines property value.*

### [7.1][PRECONDITION_FILTERING]
```typescript
fc.pre(t1 !== t2);  // Rejects at generator level, no if/else in test body
```

### [7.2][SCHEMA_DERIVED_ARBITRARIES]
```typescript
const _item = Arbitrary.make(ItemSchema);           // Stays synced with domain types
const _error = Arbitrary.make(S.Struct(ErrorType.fields));
```

### [7.3][WEIGHTED_GENERATION]
Bias toward edge cases without separate properties:
```typescript
const _input = fc.oneof(
    { weight: 1, arbitrary: fc.constant('') },                            // Edge case
    { weight: 8, arbitrary: fc.string({ minLength: 1, maxLength: 64 }) }, // Typical
);
```

### [7.4][CONTEXT_LOGGING]
Diagnostic output for shrink traces: add `ctx: fc.context()` to arbitrary record, call `ctx.log()`.

---
## [8][STATISTICAL_TESTING]
>**Dictum:** *Batch generation validates distributional properties outside the PBT loop.*

```typescript
const samples = fc.sample(_nonempty, { numRuns: 600 });
const results = yield* Effect.forEach(samples, (v) => Module.encrypt(v));
// Assert uniqueness, chi-squared uniformity, byte distribution, etc.
```

**When:** Randomness quality (IV uniqueness, hash distribution), large input space coverage.

---
## [9][MODEL_BASED_TESTING]
>**Dictum:** *Arbitrary command interleavings discover ordering bugs in stateful systems.*

```typescript
it.effect('model-based', () => Effect.promise(() => fc.assert(
    fc.asyncProperty(fc.commands(_allCommands, { size: '-1' }), (cmds) =>
        fc.asyncModelRun(() => ({ model: initialModel(), real: initialReal() }), cmds)),
    { numRuns: 30 })));
```

Commands implement `fc.AsyncCommand<Model, Real>` with `check()`, `run()`, `toString()`. Use for: caches, queues, import pipelines -- anywhere operation ordering matters.

---
## [10][MUTATION_AWARE_DENSITY]
>**Dictum:** *Properties that kill mutants are worth more than properties that merely pass.*

Structural `toEqual` on `Effect.all` results kills more mutants than individual field assertions -- changing any value in the tuple breaks the entire expected structure.

[REFERENCE] Mutant types, kill strategies, and surviving mutant analysis: [→guardrails.md](./guardrails.md) section 1.2.

---
## [11][DENSITY_METRICS]
>**Dictum:** *Measure density to prevent regression.*

| [INDEX] | [METRIC]                  | [TARGET] | [MEASUREMENT]                                    |
| :-----: | ------------------------- | -------- | ------------------------------------------------ |
|   [1]   | Generated cases per suite | 2,500+   | Sum of numRuns across all `it.effect.prop` calls |
|   [2]   | Test-to-source LOC ratio  | ~1.2     | Test LOC / source LOC (lower = denser)           |
|   [3]   | Assertions per test       | 2-6      | Property packing sweet spot                      |

[REFERENCE] Hard thresholds (LOC cap, coverage, mutation): SKILL.md section 2.

---
## [12][CONSOLIDATION]
>**Dictum:** *Consolidate related edge cases into fewer, denser assertions.*

**When to consolidate edge cases:**
- 3+ edge cases testing the same function's error paths -- aggregate into `Effect.all` with `Effect.flip`
- Multiple schema validation checks -- single `it.effect.prop` with `S.decodeUnknownEither`
- Multiple delegate method tests -- property: "all delegate keys exist and return Effects"

```typescript
// Consolidated error paths: 3 edge cases in one assertion
it.effect('error paths', () => Effect.all([
    Module.parse('invalid').pipe(Effect.flip, Effect.map((e) => e._tag)),
    Module.parse('').pipe(Effect.flip, Effect.map((e) => e._tag)),
    Module.parse(null).pipe(Effect.flip, Effect.map((e) => e._tag)),
]).pipe(Effect.map((tags) => { expect(tags).toEqual(['InvalidRecord', 'EmptyInput', 'NullInput']); })));
```

**When NOT to consolidate:**
- Different services under test
- Different layer configurations needed
- Different preconditions or lifecycle requirements

**Orchestration extraction pattern:**
When 3+ tests invoke the same service method through identical `Effect.gen` + `pipe` boilerplate, extract the orchestration:
```typescript
// Before: duplicated in every test (3+ LOC each occurrence)
Effect.gen(function* () { return yield* (yield* Svc).method(cmd); }).pipe((e) => _provide(e, db));
// After: single helper in [FUNCTIONS], called with varying mock configs
const _invoke = (cmd: Input, db = _mkDb()) =>
    Effect.gen(function* () { return yield* (yield* Svc).method(cmd); }).pipe((e) => _provide(e, db));
```
