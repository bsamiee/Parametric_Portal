# [H1][TESTING_LAWS]
>**Dictum:** *Algebraic laws define WHAT to test; patterns and standards define HOW.*

For implementation patterns see [`patterns.md`](./patterns.md). For structural standards see [`standards.md`](./standards.md).

---
## [1][LAW_TAXONOMY]

| [INDEX] | [LAW]        | [FORMULA]                       | [EXAMPLE_SPEC]                       |
| :-----: | ------------ | ------------------------------- | ------------------------------------ |
|   [1]   | Identity     | `f(x, x) = neutral`             | diff P1, crypto P7 (determinism)     |
|   [2]   | Inverse      | `g(f(x)) = x`                   | diff P2, crypto P1 (encrypt/decrypt) |
|   [3]   | Idempotent   | `f(f(x)) = f(x)`                | normalization, codec roundtrip       |
|   [4]   | Composition  | `f(g(x)) = (f . g)(x)`          | diff P5 (patch concatenation)        |
|   [5]   | Immutability | `f(x)` does not mutate `x`      | diff P4 (structural sharing)         |
|   [6]   | Equivalence  | `f_ours(x) = f_ref(x)`          | differential D1-D4                   |
|   [7]   | Reflexivity  | `compare(x, x) = true`          | crypto P7 (hash/compare)             |
|   [8]   | Symmetry     | `compare(x, y) = compare(y, x)` | crypto P7 (hash/compare)             |

[IMPORTANT]: See [`standards.md` [5.2]](./standards.md) for HOW to write these as property tests.

---
## [2][PROPERTY_EXAMPLES]

### [2.1][IDENTITY_INVERSE]
Identity (Law 1) and Inverse (Law 2) from diff:
```typescript
// P1: Identity Law - create(x, x) = null
it.effect.prop('P1: identity', { x: _json }, ({ x }) =>
    Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }));

// P2: Inverse Law (symmetric) - apply(source, create(source, target)) = target
it.effect.prop('P2: inverse', { x: _json, y: _json }, ({ x, y }) =>
    Effect.forEach([[x, y], [y, x]] as const, ([s, t]) =>
        Effect.fromNullable(Diff.create(s, t)).pipe(
            Effect.andThen((p) => Diff.apply(s, p)),
            Effect.map((r) => { expect(r).toEqual(t); }),
            Effect.optionFromOptional))
        .pipe(Effect.asVoid));
```

### [2.2][PROPERTY_PACKING]
4 laws packed into a single property (Laws 1, 7, 6, 8):
```typescript
it.effect.prop('P7: hash/compare laws', { x: _nonempty, y: _nonempty }, ({ x, y }) =>
    Effect.gen(function* () {
        const [h1, h2, eqSelf, eqXY, eqYX] = yield* Effect.all([
            Crypto.hash(x), Crypto.hash(x), Crypto.compare(x, x), Crypto.compare(x, y), Crypto.compare(y, x),
        ]);
        expect(h1).toBe(h2);           // Determinism  (Law 1: Identity)
        expect(eqSelf).toBe(true);      // Reflexivity  (Law 7)
        expect(eqXY).toBe(x === y);     // Correctness  (Law 6: Equivalence)
        expect(eqXY).toBe(eqYX);        // Symmetry     (Law 8)
    }));
```

### [2.3][COMPOSITION]
Patch composition (Law 4) -- sequential application equals concatenated application:
```typescript
it.effect.prop('P5: composition', { a: _json, b: _json, c: _json, ctx: fc.context() }, ({ a, b, c, ctx }) => {
    const [p1, p2] = [Diff.create(a, b), Diff.create(b, c)];
    ctx.log(`p1: ${p1 ? p1.ops.length : 'null'} ops, p2: ${p2 ? p2.ops.length : 'null'} ops`);
    return Effect.all([
        Effect.gen(function* () { const mid = p1 ? yield* Diff.apply(a, p1) : a; return p2 ? yield* Diff.apply(mid, p2) : mid; }),
        Diff.apply(a, { ops: [...(p1?.ops ?? []), ...(p2?.ops ?? [])] }),
    ]).pipe(Effect.tap(([seq, comp]) => { expect(seq).toEqual(comp); }), Effect.asVoid);
}, { fastCheck: { numRuns: 200 } });
```

---
## [3][SECURITY_LAWS]

### [3.1][PROTOTYPE_POLLUTION]
Prototype pollution paths rejected at diff boundary:
```typescript
it.effect('P9: security', () => Effect.all(
    ['/__proto__/polluted', '/constructor/prototype/polluted'].map((p) =>
        Diff.apply({}, { ops: [{ op: 'add', path: p, value: true }] }).pipe(Effect.ignore))
).pipe(Effect.map(() => {
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
})));
```

### [3.2][TENANT_ISOLATION]
Cross-tenant ciphertext isolation with `fc.pre` precondition filtering:
```typescript
it.effect.prop('P5: tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _nonempty }, ({ t1, t2, x }) => {
    fc.pre(t1 !== t2);
    return Effect.gen(function* () {
        const [c1, c2] = yield* Effect.all([
            Context.Request.within(t1, Crypto.encrypt(x)),
            Context.Request.within(t2, Crypto.encrypt(x)),
        ]);
        expect(c1.slice(CIPHER.version + CIPHER.iv)).not.toEqual(c2.slice(CIPHER.version + CIPHER.iv));
        expect((yield* Context.Request.within(t2, Crypto.decrypt(c1)).pipe(Effect.flip)).code).toBe('OP_FAILED');
    });
});
```

### [3.3][PATH_TRAVERSAL]
Path traversal rejection in zip imports:
```typescript
it.effect('P5: path security', () => Effect.promise(() => import('jszip').then((m) => m.default)).pipe(
    Effect.flatMap((JSZip) => Effect.all(['../escape.txt', '/etc/passwd'].map((path) => {
        const archive = new JSZip();
        archive.file(path, 'pwned');
        return Effect.promise(() => archive.generateAsync({ type: 'arraybuffer' })).pipe(
            Effect.flatMap((buf) => Transfer.import(buf, { format: 'zip' }).pipe(Stream.runCollect)),
            Effect.map((c) => Transfer.partition(Chunk.toArray(c)).failures.some((f) => f.code === 'INVALID_PATH')));
    }))),
    Effect.map((results) => expect(results).toEqual([true, true]))));
```

---
## [4][STATISTICAL_LAWS]

Chi-squared uniformity test on IV bytes -- validates cryptographic randomness:
```typescript
it.effect('P6: IV uniformity', () => Effect.gen(function* () {
    const ciphertexts = yield* Effect.forEach(fc.sample(_nonempty, { numRuns: 600 }), (v) => Crypto.encrypt(v));
    const bytes = ciphertexts.flatMap((c) => Array.from(c.slice(CIPHER.version, CIPHER.version + CIPHER.iv)));
    const expected = bytes.length / 256, counts = Object.groupBy(bytes, (b) => b);
    expect(A.reduce(A.makeBy(256, (i) => counts[i]?.length ?? 0), 0,
        (s, o) => s + (o - expected) ** 2 / expected)).toBeLessThan(310.46);
}));
```
- **600 samples** -- sufficient statistical power for 256-bucket distribution
- **df=255** -- degrees of freedom for 256 byte values (256 - 1)
- **alpha=0.01** -- critical value 310.46; false positive rate < 1%

---
## [5][ORACLE_VECTORS]

| [INDEX] | [ORACLE]     | [STANDARD]           | [SPEC]             |
| :-----: | ------------ | -------------------- | ------------------ |
|   [1]   | SHA-256 hash | NIST FIPS 180-4      | crypto P7          |
|   [2]   | HMAC-SHA-256 | RFC 4231             | crypto P8          |
|   [3]   | JSON Patch   | RFC 6902             | diff P6            |
|   [4]   | Differential | node:crypto, rfc6902 | crypto P7, diff P2 |

[IMPORTANT]: Store vectors as `as const` arrays -- never hand-roll expected values. Reference implementations (`node:crypto`, `fast-json-patch`, `rfc6902`) serve as runtime oracles for differential testing.

---
## [6][SPEC_CATALOG]

| [INDEX] | [SPEC]             | [LOC] | [PATTERNS]                                                            |
| :-----: | ------------------ | :---: | --------------------------------------------------------------------- |
|   [1]   | crypto.spec.ts     |  124  | algebraic, statistical, security, vectors, differential               |
|   [2]   | diff.spec.ts       |  104  | algebraic, vectors, differential, option combinators                  |
|   [3]   | transfer.spec.ts   |  159  | codec roundtrip, boundary, security, error paths, model-based PBT     |
|   [4]   | resilience.spec.ts |  121  | fault injection, TestClock, circuit breaker, halfOpen                  |
|   [5]   | time.spec.ts       |  102  | TestClock, fiber, schedule, duration                                  |
|   [6]   | schema-arb.spec.ts |   79  | schema roundtrip, branded types, domain integration                   |
