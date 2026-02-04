# [H1][TESTING_PATTERNS]
>**Dictum:** *Patterns encode bleeding-edge test practices via constants, algebraic laws, and Effect composition.*

<br>

Reference implementation: `tests/packages/server/*.spec.ts`.

---
## [1][CONSTANTS_PATTERN]
>**Dictum:** *Frozen constants centralize test data per spec file.*

<br>

Each spec file defines frozen constants with semantic prefixes:

```typescript
// Arbitraries prefixed with underscore
const _safeKey = fc.string({ maxLength: 24, minLength: 1 })
    .filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k));
const _json = fc.dictionary(_safeKey, fc.jsonValue({ maxDepth: 3 }));

// Static constants in SCREAMING_CASE
const CIPHER = { iv: 12, minBytes: 14, tag: 16, version: 1 } as const;
```

| [INDEX] | [PREFIX]  | [PURPOSE]                | [EXAMPLE]                              |
| :-----: | --------- | ------------------------ | -------------------------------------- |
|   [1]   | `_`       | Fast-check arbitraries   | `_json`, `_text`, `_nonempty`          |
|   [2]   | `UPPER`   | Static constants         | `CIPHER`, `RFC6902_OPS`                |

[IMPORTANT]:
- [ALWAYS] Use `as const` for literal inference.
- [ALWAYS] Filter arbitraries to exclude dangerous values (proto pollution).
- [NEVER] Scatter test data across multiple variables.

---
## [2][ALGEBRAIC_TESTING]
>**Dictum:** *Test mathematical properties, not individual cases.*

<br>

Property-based tests encode algebraic laws:

```typescript
// P1: Identity Law - create(x, x) = null
it.effect.prop('P1: identity', { x: _json }, ({ x }) =>
    Effect.sync(() => { expect(Diff.create(x, x)).toBeNull(); }));

// P2: Inverse Law - apply(source, create(source, target)) = target
it.effect.prop('P2: inverse', { x: _json, y: _json }, ({ x, y }) =>
    Effect.forEach([[x, y], [y, x]] as const, ([s, t]) =>
        Effect.fromNullable(Diff.create(s, t)).pipe(
            Effect.andThen((p) => Diff.apply(s, p)),
            Effect.map((r) => { expect(r).toEqual(t); }),
            Effect.optionFromOptional))
        .pipe(Effect.asVoid));

// P3: Empty Patch Identity - apply(x, ∅) = x
it.effect.prop('P3: empty patch', { x: _json }, ({ x }) =>
    Diff.apply(x, { ops: [] }).pipe(Effect.map((r) => { expect(r).toEqual(x); })));
```

| [INDEX] | [LAW]        | [FORMULA]                                     |
| :-----: | ------------ | --------------------------------------------- |
|   [1]   | Identity     | `f(x, x) = neutral`                           |
|   [2]   | Inverse      | `g(f(x)) = x`                                 |
|   [3]   | Idempotent   | `f(f(x)) = f(x)`                              |
|   [4]   | Composition  | `f(g(x)) = (f ∘ g)(x)`                        |
|   [5]   | Immutability | `f(x)` does not mutate `x`                    |

---
## [3][EFFECT_NATIVE]
>**Dictum:** *Monadic assertions validate Effect pipelines.*

<br>

Use `@effect/vitest` for Effect-native testing:

```typescript
import { it, layer } from '@effect/vitest';
import { Effect, FastCheck as fc } from 'effect';

// Layer-scoped tests
layer(testLayer)('ServiceName', (it) => {
    it.effect.prop('property name', { x: _arb }, ({ x }) =>
        Effect.gen(function* () {
            const result = yield* Service.method(x);
            expect(result).toBeSuccess();
        }));
});
```

Custom matchers from `tests/setup.ts`:

| [INDEX] | [MATCHER]       | [ASSERTS]                               |
| :-----: | --------------- | --------------------------------------- |
|   [1]   | `toBeSuccess()` | Exit.isSuccess, optionally checks value |
|   [2]   | `toBeFailure()` | Exit.isFailure, optionally checks error |
|   [3]   | `toBeRight()`   | Either.isRight, optionally checks value |
|   [4]   | `toBeLeft()`    | Either.isLeft, optionally checks error  |
|   [5]   | `toBeSome()`    | Option.isSome, optionally checks value  |
|   [6]   | `toBeNone()`    | Option.isNone                           |

---
## [4][PARALLEL_ASSERTIONS]
>**Dictum:** *Effect.all enables parallel test operations.*

<br>

Aggregate multiple checks in single assertion:

```typescript
it.effect('RFC6902 ops', () => Effect.all([
    Diff.apply({ a: 1 },        { ops: [{ op: 'add', path: '/b', value: 2 }] }),
    Diff.apply({ a: 1, b: 2 },  { ops: [{ op: 'remove', path: '/b' }] }),
    Diff.apply({ a: 1 },        { ops: [{ op: 'replace', path: '/a', value: 9 }] }),
]).pipe(Effect.map((r) => expect(r).toEqual([
    { a: 1, b: 2 },
    { a: 1 },
    { a: 9 },
]))));
```

---
## [5][SECURITY_TESTING]
>**Dictum:** *Security properties are algebraic laws.*

<br>

Test security boundaries with property-based generation:

```typescript
// Prototype pollution prevention
it.effect('prevents prototype pollution', () => Effect.all(
    ['/__proto__/polluted', '/constructor/prototype/polluted'].map((p) =>
        Diff.apply({}, { ops: [{ op: 'add', path: p, value: true }] }).pipe(Effect.ignore))
).pipe(Effect.map(() => {
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
})));

// Tenant isolation
it.effect.prop('tenant isolation', { t1: fc.uuid(), t2: fc.uuid(), x: _text }, ({ t1, t2, x }) => {
    fc.pre(t1 !== t2);
    return Effect.gen(function* () {
        const c1 = yield* Context.Request.within(t1, Crypto.encrypt(x));
        const decryptAttempt = yield* Context.Request.within(t2, Crypto.decrypt(c1)).pipe(Effect.flip);
        expect(decryptAttempt.code).toBe('OP_FAILED');
    });
});
```

---
## [6][REFERENCES]
>**Dictum:** *Source files demonstrate pattern application.*

<br>

| [INDEX] | [FILE]                              | [PATTERNS]                          |
| :-----: | ----------------------------------- | ----------------------------------- |
|   [1]   | `tests/packages/server/diff.spec.ts`| Algebraic laws, RFC compliance      |
|   [2]   | `tests/packages/server/crypto.spec.ts`| Layer-scoped, security properties |
|   [3]   | `tests/packages/server/transfer.spec.ts`| Schema validation, edge cases   |

**Related Docs:**
- [→standards.md](standards.md) — Authoring standards, anti-patterns
- [→overview.md](overview.md) — Architecture, topology, commands
