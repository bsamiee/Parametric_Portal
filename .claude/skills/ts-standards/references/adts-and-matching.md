# [H1][ADTS_AND_MATCHING]
>**Dictum:** *ADTs encode domain variants. Exhaustive matching guarantees completeness.*

<br>

---
## [1][SUM_TYPES]
>**Dictum:** *`Data.TaggedEnum` for closed unions. `$match` for exhaustive inline dispatch. `$is` for type narrowing.*

<br>

**Basic sum type:**

```typescript
type ConnectionState = Data.TaggedEnum<{
    readonly Disconnected: { readonly reason: Option.Option<string> };
    readonly Connecting: {};
    readonly Connected: { readonly latencyMs: number };
    readonly Reconnecting: { readonly attempt: number };
}>;
const { Disconnected, Connecting, Connected, Reconnecting, $is, $match } =
    Data.taggedEnum<ConnectionState>();
```

**Generic sum type** with `WithGenerics`:

```typescript
type AsyncState<A = unknown, E = unknown> = Data.TaggedEnum<{
    readonly Idle: {};
    readonly Loading: {};
    readonly Success: { readonly data: A };
    readonly Failure: { readonly error: E };
}>;
interface AsyncStateDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: AsyncState<this['A'], this['B']>;
}
const { $is, $match, Idle, Loading, Success, Failure } = Data.taggedEnum<AsyncStateDef>();

const AsyncState = { $is, $match, Idle, Loading, Success, Failure } as const;
namespace AsyncState { export type Of<A, E = never> = AsyncState<A, E>; }
export { AsyncState };
```

[IMPORTANT]:
- [ALWAYS] Use `WithGenerics<N>` for polymorphic variants -- bind `N` to enforce arity.
- [ALWAYS] Apply namespace merge for exported sum types: `const X = { ... } as const; namespace X { ... }`.

[CRITICAL]:
- [NEVER] String literal unions for variants carrying data -- use `Data.TaggedEnum`.
- [NEVER] Manual type guards `isX(v): v is X` -- use `$is('Tag')` or `S.is(XSchema)`.

---
## [2][PHANTOM_AND_RECURSIVE]
>**Dictum:** *Phantom types encode protocol at zero runtime cost. Recursive schemas encode structure.*

<br>

**Phantom types** -- branded `never` fields for compile-time state tracking:
- `Builder<Draft>` vs `Builder<Validated>` -- methods gate on phantom parameter, no runtime cost.
- State transitions return new branded types: `validate(b: Builder<Draft>): Builder<Validated>`.

**Recursive types** -- self-referential schemas:
- `Schema.suspend(() => TreeNodeSchema)` for recursive structure definitions.
- Pair with `Effect.iterate` for recursive computation over the structure.

[CRITICAL]:
- [NEVER] Boolean flags (`isValidated: boolean`) for state tracking -- use phantom types.
- [NEVER] Flat unions (`string | Expr[]`) for recursive structures -- use recursive `Data.TaggedEnum`.

---
## [3][PATTERN_MATCHING]
>**Dictum:** *`Match.exhaustive` makes missing cases a compile error.*

<br>

**`Match.type` -- reusable matcher over discriminated unions:**

```typescript
const toMessage = Match.type<ProvisionEvent>().pipe(
    Match.withReturnType<string>(),
    Match.tag('Requested', ({ tenantId }) => `Provision requested: ${tenantId}`),
    Match.tag('Approved', 'Denied', ({ tenantId, by }) => `${tenantId} ${by}`),
    Match.tag('Completed', ({ tenantId, duration }) => `Done: ${tenantId} in ${duration}ms`),
    Match.tag('Failed', ({ tenantId, error }) => `Failed: ${tenantId}: ${error}`),
    Match.exhaustive,
);
```

**`Match.value` -- inline dispatch on concrete values:**

```typescript
const classify = (input: string | number | boolean) =>
    Match.value(input).pipe(
        Match.when(Predicate.isString, (s) => `str:${s.length}`),
        Match.when(Predicate.isNumber, (n) => `num:${n}`),
        Match.when(Match.is(true), () => 'yes'),
        Match.orElse(() => 'no'),
    );
```

**Advanced matching:**

| [TECHNIQUE]                   | [API]                                              |
| ----------------------------- | -------------------------------------------------- |
| Multi-tag with shared handler | `Match.tag('A', 'B', handler)`                     |
| Multi-field discrimination    | `Match.discriminatorsExhaustive('_tag', 'status')` |
| Class-based matching          | `Match.when(Match.instanceOf(MyClass), ...)`       |
| Nested discriminated matching | Outer `Match.tag` -> inner `Match.value`           |
| Predicate-based narrowing     | `Match.when(Predicate.isString, ...)`              |

[IMPORTANT]:
- [ALWAYS] Use `Match.type<T>()` for reusable matchers (function value).
- [ALWAYS] Use `Match.value(x)` for inline dispatch on concrete values.
- [ALWAYS] Use `Match.withReturnType<R>()` when constraining return type.
- [ALWAYS] Use `Match.tag('A', 'B', handler)` when variants share behavior.

---
## [4][MATCH_FINALIZERS]
>**Dictum:** *Choose finalizer that encodes completeness guarantee.*

<br>

| [FINALIZER]        | [BEHAVIOR]                                  |
| ------------------ | ------------------------------------------- |
| `Match.exhaustive` | Compile error if any variant unhandled      |
| `Match.orElse`     | Fallback for unmatched (non-exhaustive)     |
| `Match.option`     | `Option.some` on match, `Option.none` else  |
| `Match.either`     | `Either.right` on match, `Either.left` else |

[IMPORTANT]:
- [ALWAYS] Prefer `Match.exhaustive` -- compile-time safety over runtime fallbacks.
- [ALWAYS] Use `Match.orElse` only when input type is genuinely open (e.g., `unknown`, union with unbounded members).

---
## [5][TYPE_LEVEL_PATTERNS]
>**Dictum:** *Type system is compile-time programming language.*

<br>

| [INDEX] | [PATTERN]                    | [SYNTAX]                                                                  |
| :-----: | ---------------------------- | ------------------------------------------------------------------------- |
|   [1]   | Conditional + `infer`        | `type Unwrap<T> = T extends { data: infer D } ? D : never`                |
|   [2]   | Template literal types       | `type Event<T extends string> = \`on${Capitalize<T>}\``                   |
|   [3]   | `DeepReadonly<T>`            | From `ts-essentials` -- recursive deep freeze at type level               |
|   [4]   | Non-distribution             | `[T] extends [U] ? X : Y` -- prevents union distribution                  |
|   [5]   | Variadic tuples              | `type Concat<A extends unknown[], B extends unknown[]> = [...A, ...B]`    |
|   [6]   | Mapped + `as` for key rename | `{ [K in keyof T as K extends Old ? New : K]: T[K] }`                     |
|   [7]   | `as const satisfies T`       | Literal inference preserved, shape validated at declaration site          |
|   [8]   | Const type parameters        | `function f<const T extends string>(role: T): T` -- preserves literal     |
|   [9]   | `NoInfer<T>`                 | `f<T>(source: T, fallback: NoInfer<T>)` -- forces inference from `source` |
|  [10]   | `using` in Effect.gen        | `using handle = yield* resource` -- TS 6.0 deterministic cleanup          |

[IMPORTANT]:
- [ALWAYS] Use `as const satisfies T` for config objects -- typos caught, literals preserved.
- [ALWAYS] Use `NoInfer<T>` to control inference direction when multiple params contribute to `T`.
- [ALWAYS] Use `[T] extends [U]` to prevent unintended union distribution.

[REFERENCE] Consolidation patterns: [->consolidation.md](./consolidation.md).
