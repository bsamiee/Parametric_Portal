# [H1][TESTING_LAWS]
>**Dictum:** *Algebraic laws define WHAT to test -- mathematical truths independent of implementation.*

[IMPORTANT] Walk law taxonomy per exported function. Select all applicable laws. Pack laws sharing the same arbitrary shape into a single `it.effect.prop`.

---
## [1][ALGEBRAIC_LAWS]
>**Dictum:** *Algebraic laws hold universally -- they are provable independent of any implementation.*

### [1.1][FUNCTION_PROPERTIES]

| [INDEX] | [LAW]        | [FORMULA]                         | [WHEN_TO_USE]                                            |
| :-----: | ------------ | --------------------------------- | -------------------------------------------------------- |
|   [1]   | Identity     | `f(x, e) = x` or `f(x, x) = null` | Neutral element or self-comparison yields trivial result |
|   [2]   | Inverse      | `g(f(x)) = x`                     | Paired encode/decode, encrypt/decrypt, serialize/parse   |
|   [3]   | Idempotent   | `f(f(x)) = f(x)`                  | Normalization, deduplication, canonicalization           |
|   [4]   | Commutative  | `f(x, y) = f(y, x)`               | Order-independent operations (set union, hash combine)   |
|   [5]   | Associative  | `f(f(x, y), z) = f(x, f(y, z))`   | Grouping-independent operations (concat, merge, compose) |
|   [6]   | Homomorphism | `f(x <> y) = f(x) <> f(y)`        | Structure-preserving maps (patch concat, stream fold)    |
|   [7]   | Annihilation | `f(zero) = zero`                  | Zero/empty input produces zero/empty output              |
|   [8]   | Monotonicity | `x <= y => f(x) <= f(y)`          | Order-preserving transforms (timestamps, indices)        |

**Identity** -- `diff(x, x)` returns null; `apply(x, emptyPatch)` returns `x`.
**Inverse** -- `decrypt(encrypt(x)) = x`; `apply(source, diff(source, target)) = target`.
**Idempotent** -- `normalize(normalize(x)) = normalize(x)`.
**Homomorphism** -- `apply(a, concat(p1, p2)) = apply(apply(a, p1), p2)` (patch composition).
**Annihilation** -- `import('') = []`; `diff(x, x) = null`.

### [1.2][EQUIVALENCE_RELATIONS]

| [INDEX] | [LAW]      | [FORMULA]                       | [WHEN_TO_USE]                    |
| :-----: | ---------- | ------------------------------- | -------------------------------- |
|   [1]   | Reflexive  | `compare(x, x) = true`          | Hash equality, schema validation |
|   [2]   | Symmetric  | `compare(x, y) = compare(y, x)` | Bidirectional equality checks    |
|   [3]   | Transitive | `eq(x,y) && eq(y,z) => eq(x,z)` | Ordering, equivalence classes    |

Pack all three into a single property when the function under test is a comparison or equality check.

```typescript
it.effect.prop('equivalence relation', { x: _arb, y: _arb, z: _arb }, ({ x, y, z }) =>
    Effect.gen(function* () {
        const [eqXX, eqXY, eqYX, eqYZ, eqXZ] = yield* Effect.all([
            Module.compare(x, x), Module.compare(x, y), Module.compare(y, x),
            Module.compare(y, z), Module.compare(x, z),
        ]);
        expect(eqXX).toBe(true);                            // Reflexive
        expect(eqXY).toBe(eqYX);                            // Symmetric
        if (eqXY && eqYZ) { expect(eqXZ).toBe(true); }     // Transitive
    }));
```

### [1.3][STRUCTURAL_PROPERTIES]

| [INDEX] | [LAW]           | [FORMULA]                     | [WHEN_TO_USE]                                |
| :-----: | --------------- | ----------------------------- | -------------------------------------------- |
|   [1]   | Immutability    | `f(x)` preserves `x`          | Any function receiving reference types       |
|   [2]   | Determinism     | `f(x) = f(x)` across calls    | Hashing, serialization, canonical forms      |
|   [3]   | Non-determinism | `f(x) !== f(x)` per call      | Encryption (IV/nonce), random generation     |
|   [4]   | Length formula  | `                             | f(x)                                         | = g( | x | )` | Ciphertext length = version + IV + payload + tag |
|   [5]   | Preservation    | `sort(xs).length = xs.length` | Collection transforms preserve size/contents |

```typescript
// Immutability
it.effect.prop('immutability', { x: _arb }, ({ x }) => Effect.sync(() => {
    const snapshot = structuredClone(x);
    Module.process(x);
    expect(x).toEqual(snapshot);
}));
// Determinism + Non-determinism (packed)
it.effect.prop('det + nondet', { x: _arb }, ({ x }) => Effect.gen(function* () {
    const [a, b] = yield* Effect.all([Module.encrypt(x), Module.encrypt(x)]);
    expect(yield* Module.decrypt(a)).toBe(x);       // Inverse
    expect(a.join(',')).not.toBe(b.join(','));        // Non-determinism
}));
```

### [1.4][CONCURRENCY_LAWS]

| [INDEX] | [LAW]               | [FORMULA]                                              | [WHEN_TO_USE]                                |
| :-----: | ------------------- | ------------------------------------------------------ | -------------------------------------------- |
|   [1]   | Interruption safety | Fiber interrupt preserves consistent state             | Services managing fibers or long-running ops |
|   [2]   | Resource bracket    | `acquireRelease` cleans up on success, failure, abort  | Pool connections, file handles, locks        |
|   [3]   | Ref atomicity       | Concurrent `Ref.update` calls produce consistent state | Shared mutable state across fibers           |

**Interruption safety** -- fork a fiber, interrupt it, verify no resource leak or inconsistent state.
**Resource bracket** -- `Effect.acquireRelease(acquire, release)` guarantees `release` runs even under interruption. Verify via `it.scoped`.
**Ref atomicity** -- concurrent `Ref.update` with `Effect.fork` + `Fiber.join`; final value equals sequential application.

### [1.5][TYPE_LEVEL_LAWS]

| [INDEX] | [LAW]               | [MECHANISM]                                        | [WHEN_TO_USE]                       |
| :-----: | ------------------- | -------------------------------------------------- | ----------------------------------- |
|   [1]   | Type assertion      | `expectTypeOf(fn).returns.toMatchTypeOf<T>()`      | Exported function return types      |
|   [2]   | Negative assertion  | `// @ts-expect-error` above invalid call           | Branded types reject raw primitives |
|   [3]   | Schema type extract | `expectTypeOf<typeof S.Type>().toEqualTypeOf<T>()` | Schema infers expected domain type  |

**Type-level tests** run at compile time -- zero runtime cost. Use alongside algebraic PBT to verify type narrowing, branded type rejection, and schema type inference.

---
## [2][TESTING_STRATEGIES]
>**Dictum:** *Strategies define HOW to obtain expected values when algebraic laws alone are insufficient.*

### [2.1][ORACLE_STRATEGIES]

| [INDEX] | [STRATEGY]     | [DESCRIPTION]                                    | [WHEN_TO_USE]                        |
| :-----: | -------------- | ------------------------------------------------ | ------------------------------------ |
|   [1]   | Known-answer   | Expected values from authoritative standards     | NIST FIPS, RFC vectors               |
|   [2]   | Differential   | Cross-validate against reference implementation  | node:crypto vs ours, rfc6902 vs ours |
|   [3]   | Model-based    | Simplified model tracks state alongside real sys | Stateful sequences (import pipeline) |
|   [4]   | Metamorphic    | Relate outputs for related inputs                | `insert(x); search(x) = found`       |
|   [5]   | Schema-derived | Arbitrary.make(Schema) generates domain values   | Branded type roundtrips              |

**Known-answer vectors** -- store as `as const` arrays, iterate with `Effect.forEach`.
```typescript
const VECTORS = [{ expected: 'e3b0c44...', input: '' }, { expected: 'ba7816b...', input: 'abc' }] as const;
it.effect('known-answer', () =>
    Effect.forEach(VECTORS, (v) => Module.hash(v.input).pipe(
        Effect.tap((d) => { expect(d).toBe(v.expected); }))).pipe(Effect.asVoid));
```

**Differential oracle** -- compare optimized impl against reference in same property.
```typescript
it.effect.prop('differential', { x: _arb }, ({ x }) => Effect.gen(function* () {
    const ours = yield* Module.hash(x);
    const reference = createHash('sha256').update(x).digest('hex');
    expect(ours).toBe(reference);
}));
```

### [2.2][STATISTICAL_TESTING]

Chi-squared uniformity for randomness validation. Parameters:

| [INDEX] | [PARAM]            | [VALUE]   | [RATIONALE]                          |
| :-----: | ------------------ | --------- | ------------------------------------ |
|   [1]   | Sample count       | 600+      | Sufficient power for 256-bucket dist |
|   [2]   | Degrees of freedom | N-1 (255) | 256 byte values minus 1              |
|   [3]   | Alpha              | 0.01      | Critical value 310.46, FP rate <1%   |

```typescript
it.effect('uniformity', () => Effect.gen(function* () {
    const samples = yield* Effect.forEach(fc.sample(_arb, { numRuns: 600 }), Module.encrypt);
    const bytes = samples.flatMap((c) => Array.from(c.slice(OFFSET, OFFSET + SIZE)));
    const expected = bytes.length / 256;
    const counts = Object.groupBy(bytes, (b) => b);
    expect(A.reduce(A.makeBy(256, (i) => counts[i]?.length ?? 0), 0,
        (sum, observed) => sum + (observed - expected) ** 2 / expected))
        .toBeLessThan(310.46);
}));
```

---
## [3][DOMAIN_INVARIANTS]
>**Dictum:** *Security and boundary properties are universally-quantified invariants -- they hold for ALL inputs.*

### [3.1][SECURITY_INVARIANTS]

| [INDEX] | [INVARIANT]         | [PROPERTY]                                                       |
| :-----: | ------------------- | ---------------------------------------------------------------- |
|   [1]   | Prototype pollution | Dangerous keys (`__proto__`, `constructor`) rejected at boundary |
|   [2]   | Tenant isolation    | Cross-tenant ciphertext differs; cross-tenant decrypt fails      |
|   [3]   | Path traversal      | `../` and absolute paths rejected in archive imports             |
|   [4]   | Tampering detection | Flipped ciphertext bit yields decryption failure                 |
|   [5]   | Bomb resistance     | Decompression ratio / size limits enforced                       |

**Tenant isolation** uses `fc.pre()` to filter same-tenant pairs.
```typescript
it.effect.prop('tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _arb }, ({ t1, t2, x }) => {
    fc.pre(t1 !== t2);
    return Effect.gen(function* () {
        const [c1, c2] = yield* Effect.all([
            Context.within(t1, Module.encrypt(x)), Context.within(t2, Module.encrypt(x)),
        ]);
        expect(c1.slice(PREFIX)).not.toEqual(c2.slice(PREFIX));
        expect((yield* Context.within(t2, Module.decrypt(c1)).pipe(Effect.flip)).code).toBe('OP_FAILED');
    });
});
```

### [3.2][BOUNDARY_INVARIANTS]

| [INDEX] | [INVARIANT]   | [PROPERTY]                                        |
| :-----: | ------------- | ------------------------------------------------- |
|   [1]   | Empty input   | `import('') = []` (identity stream)               |
|   [2]   | Row limits    | Exceeding max rows yields `ROW_LIMIT` error       |
|   [3]   | Size limits   | Oversized entries yield `TOO_LARGE` error         |
|   [4]   | Format bounds | Invalid version/min-bytes yield `INVALID_FORMAT`  |
|   [5]   | AAD binding   | Wrong/missing additional authenticated data fails |

---
## [4][LAW_SELECTION]
>**Dictum:** *Walk each exported function through the taxonomy to discover applicable laws.*

**Selection procedure:**
1. **Identify function signature** -- `A -> B`, `A -> A`, `(A, A) -> B`, `(A, B) -> A`.
2. **Check algebraic laws** -- does the function have an inverse? Is it idempotent? Commutative?
3. **Check structural properties** -- does it mutate inputs? Is output size predictable?
4. **Check oracle availability** -- reference impl? RFC vectors? Simplified model?
5. **Check domain invariants** -- security boundaries? Size limits? Error codes?
6. **Pack compatible laws** -- laws sharing the same arbitrary shape go in one `it.effect.prop`.

| [INDEX] | [SIGNATURE]             | [CANDIDATE_LAWS]                                                |
| :-----: | ----------------------- | --------------------------------------------------------------- |
|   [1]   | `encode: A -> B`        | Inverse (with decode), determinism, length formula              |
|   [2]   | `decode: B -> A`        | Inverse (with encode), tampering detection, format bounds       |
|   [3]   | `diff: (A,A)->P`        | Identity, immutability, homomorphism (composition), equivalence |
|   [4]   | `hash: A -> H`          | Determinism, reflexivity, differential oracle, known-answer     |
|   [5]   | `compare: (A,A)->Bool`  | Reflexive, symmetric, transitive (equivalence relation)         |
|   [6]   | `import: S -> [A]`      | Inverse (with export), annihilation, boundary limits            |
|   [7]   | `normalize: A -> A`     | Idempotent, determinism, preservation                           |
|   [8]   | `fork/join: A -> Fiber` | Interruption safety, resource bracket, Ref atomicity            |
|   [9]   | `Layer.provide: L -> E` | Resource bracket, layer merge correctness                       |
