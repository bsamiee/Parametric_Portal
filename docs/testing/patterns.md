# [H1][TESTING_PATTERNS]
>
>**Dictum:** *Patterns encode bleeding-edge test practices via constants, algebraic laws, and Effect composition.*

<br>

Reference implementation: `tests/packages/server/*.spec.ts`.

---

## [1][CONSTANTS_PATTERN]
>
>**Dictum:** *Frozen constants centralize test data per spec file.*

<br>

Each spec file defines frozen constants with 2 prefix conventions:

```typescript
// Arbitraries prefixed with underscore
const _safeKey = fc.string({ maxLength: 24, minLength: 1 })
    .filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 3 }));

// Static constants in SCREAMING_CASE
const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;

// Schema-derived arbitraries (replaces hand-rolled generators, stays in sync with schema)
const _item = Arbitrary.make(ItemSchema);
```

| [INDEX] | [PREFIX] | [PURPOSE]              | [EXAMPLE]                          |
| :-----: | -------- | ---------------------- | ---------------------------------- |
|   [1]   | `_`      | Fast-check arbitraries | `_json`, `_text`, `_nonempty`      |
|   [2]   | `_`      | Schema-derived arbs    | `Arbitrary.make(ItemSchema)`       |
|   [3]   | `UPPER`  | Static constants       | `CIPHER`, `RFC6902_OPS`            |

[IMPORTANT]:

- [ALWAYS] Use `as const` for literal inference.
- [ALWAYS] Filter arbitraries to exclude dangerous values (proto pollution).
- [NEVER] Scatter test data across multiple variables.

---

## [2][ALGEBRAIC_TESTING]
>
>**Dictum:** *Test mathematical properties, not individual cases.*

<br>

Property-based tests encode algebraic laws:

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

// P3: Empty Patch Identity - apply(x, empty) = x
it.effect.prop('P3: empty patch', { x: _json }, ({ x }) =>
    Diff.apply(x, { ops: [] }).pipe(Effect.map((r) => { expect(r).toEqual(x); })));
```

| [INDEX] | [LAW]        | [FORMULA]                  |
| :-----: | ------------ | -------------------------- |
|   [1]   | Identity     | `f(x, x) = neutral`        |
|   [2]   | Inverse      | `g(f(x)) = x`              |
|   [3]   | Idempotent   | `f(f(x)) = f(x)`           |
|   [4]   | Composition  | `f(g(x)) = (f . g)(x)`     |
|   [5]   | Immutability | `f(x)` does not mutate `x` |

---

## [3][EFFECT_COMPOSITION]
>
>**Dictum:** *Effect.all aggregates parallel operations into single structural assertions.*

<br>

Aggregate multiple checks in single assertion -- reduces LOC, increases coverage density:

```typescript
// 8 RFC 6902 operations validated in 1 assertion
it.effect('P6: RFC6902 ops', () => Effect.all([
    Diff.apply({ a: 1 },        { ops: [{ op: 'add',     path: '/b',     value: 2 }] }),
    Diff.apply({ a: 1, b: 2 },  { ops: [{ op: 'remove',  path: '/b' }] }),
    Diff.apply({ a: 1 },        { ops: [{ op: 'replace', path: '/a',     value: 9 }] }),
]).pipe(Effect.map((r) => expect(r).toEqual([{ a: 1, b: 2 }, { a: 1 }, { a: 9 }]))));
```

Error code structural assertions -- 3 error modes validated in 1 test:

```typescript
it.effect('P4: modes + limits', () => Effect.all([
    Transfer.import('arbitrary', { format: 'txt', mode: 'file', type: 'doc' }).pipe(...),
    Transfer.import('test', { type: 'unknown' }).pipe(...),
    Transfer.import(A.replicate(JSON.stringify({ content: 'x', type: 't' }), 10_001).join('\n'), { format: 'ndjson' }).pipe(...),
]).pipe(Effect.map(([file, detect, rowLimit]) =>
    expect([file, detect, rowLimit]).toEqual(['doc', 1, 'ROW_LIMIT']))));
```

---

## [4][ADVANCED_TECHNIQUES]
>
>**Dictum:** *Advanced fast-check patterns maximize generation quality.*

<br>

### [4.1][PRECONDITION_FILTERING]

Constrain generation space without branching logic:

```typescript
it.effect.prop('P5: tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _nonempty }, ({ t1, t2, x }) => {
    fc.pre(t1 !== t2);  // Rejects invalid samples, no if/continue
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

### [4.2][BATCH_STATISTICAL_ANALYSIS]

Use `fc.sample()` for bulk statistical analysis outside the PBT loop:

```typescript
// Chi-squared uniformity test on IV bytes (600 samples, df=255, critical value=310.46 at alpha=0.01)
it.effect('P6: IV uniformity', () => Effect.gen(function* () {
    const ciphertexts = yield* Effect.forEach(fc.sample(_nonempty, { numRuns: 600 }), (v) => Crypto.encrypt(v));
    const bytes = ciphertexts.flatMap((c) => Array.from(c.slice(CIPHER.version, CIPHER.version + CIPHER.iv)));
    const expected = bytes.length / 256, counts = Object.groupBy(bytes, (b) => b);
    expect(A.reduce(A.makeBy(256, (i) => counts[i]?.length ?? 0), 0,
        (s, o) => s + (o - expected) ** 2 / expected)).toBeLessThan(310.46);
}));
```

### [4.3][MODEL_BASED_TESTING]

Stateful property testing via `fc.commands()` + `fc.asyncModelRun()`. Commands mutate both a lightweight model and the real system; invariants are asserted after arbitrary command sequences. Bridges Effect -> fast-check via `Effect.runPromise`. See `transfer-model.spec.ts`.

```typescript
await fc.assert(fc.asyncProperty(fc.commands(allCommands), (cmds) =>
    fc.asyncModelRun(() => ({ model: new TransferModel(), real: new TransferReal() }), cmds)));
```

### [4.4][EXTERNAL_ORACLE_VECTORS]

Standards-body test vectors (RFC 6902, NIST CAVP) provide authoritative oracles independent of implementation. Store as `as const` arrays. See `diff-vectors.spec.ts`.

### [4.5][DIFFERENTIAL_AND_CHAOS_TESTING]

**Differential:** Cross-validate against reference implementations (fast-json-patch, Node crypto). Generate random inputs via `fc.jsonValue()`, run through BOTH, assert identical output. **Chaos:** Effect layer wrapping for configurable failure injection (Nth-call failure, delay). Use `TestClock.adjust()` + `Fiber.fork/join` for deterministic time-dependent testing.

---

## [5][SECURITY_TESTING]
>
>**Dictum:** *Security properties are algebraic laws.*

<br>

Test security boundaries with property-based generation:

```typescript
// Prototype pollution prevention
it.effect('P9: security', () => Effect.all(
    ['/__proto__/polluted', '/constructor/prototype/polluted'].map((p) =>
        Diff.apply({}, { ops: [{ op: 'add', path: p, value: true }] }).pipe(Effect.ignore))
).pipe(Effect.map(() => {
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
})));

// Path traversal rejection in zip imports
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

## [6][REFERENCES]
>
>**Dictum:** *Source files demonstrate pattern application.*

<br>

| [INDEX] | [FILE]                                          | [PATTERNS]                                  |
| :-----: | ----------------------------------------------- | ------------------------------------------- |
|   [1]   | `tests/packages/server/diff.spec.ts`            | Algebraic laws, composition, RFC compliance |
|   [2]   | `tests/packages/server/crypto.spec.ts`          | Layer-scoped, statistical, security props   |
|   [3]   | `tests/packages/server/transfer.spec.ts`        | Codec roundtrips, boundary + security       |
|   [4]   | `tests/packages/server/transfer-model.spec.ts`  | Model-based stateful testing, fc.commands() |
|   [5]   | `tests/packages/server/diff-vectors.spec.ts`    | External oracle vectors (RFC 6902)          |

**Related Docs:**

- [->standards.md](standards.md) -- Authoring standards, guardrails, anti-patterns
- [->overview.md](overview.md) -- Architecture, topology, commands
