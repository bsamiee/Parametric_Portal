# [H1][ADTS_AND_MATCHING]
>**Dictum:** *ADTs define closed behavior sets; exhaustive matches guarantee coverage.*

<br>

Use this reference for variant modeling, exhaustive dispatch, and advanced type-level polymorphism.

---
## [1][SUM_TYPES]
>**Dictum:** *Use tagged unions for behavior-bearing variants.*

<br>

```typescript
type Connection = Data.TaggedEnum<{
    readonly Idle: {};
    readonly Loading: {};
    readonly Ready: { readonly data: unknown };
    readonly Failed: { readonly message: string };
}>;

const { Idle, Loading, Ready, Failed } = Data.taggedEnum<Connection>();
```

[CRITICAL]:
- [NEVER] model data-carrying variants as plain string unions.
- [NEVER] rely on ad hoc type guards for closed unions.

---
## [2][EXHAUSTIVE_MATCHING]
>**Dictum:** *`Match.exhaustive` is mandatory for closed unions.*

<br>

Use [SNIP-01](./snippets.md#snip-01command_algebra) for canonical exhaustive service dispatch.

[IMPORTANT]:
- [ALWAYS] use `Match.type<T>()` for reusable matchers.
- [ALWAYS] use `Match.value(x)` for inline value dispatch.
- [ALWAYS] use `Match.exhaustive` for closed variants.

---
## [3][TYPE_LEVEL_POLYMORPHISM]
>**Dictum:** *Advanced typing preserves precision while keeping APIs small.*

<br>

Use [SNIP-04](./snippets.md#snip-04advanced_polymorphic_types).

| [INDEX] | [PATTERN]              | [PURPOSE]                              |
| :-----: | ---------------------- | -------------------------------------- |
|   [1]   | `const` type parameter | preserve literal identity              |
|   [2]   | `NoInfer<T>`           | control inference source direction     |
|   [3]   | variadic tuples        | typed flexible parameter composition   |
|   [4]   | conditional `infer`    | structural type extraction             |
|   [5]   | `as const satisfies`   | literal retention with shape checking  |

---
## [4][STATE_PROTOCOL_TYPES]
>**Dictum:** *Phantom typing encodes protocol legality at compile time.*

<br>

```typescript
type Draft = { readonly _state: 'draft' };
type Valid = { readonly _state: 'valid' };

type Builder<S> = { readonly value: string; readonly _s: S };

const validate = (b: Builder<Draft>): Builder<Valid> => ({ ...b, _s: { _state: 'valid' } });
```

[CRITICAL]:
- [NEVER] represent protocol states with mutable booleans.

---
## [5][NO_IF_CONTROL_FLOW]
>**Dictum:** *Branching should remain algebraic and explicit.*

<br>

```typescript
const normalize = (input: Option.Option<string>) =>
    Option.match(input, {
        onNone: () => 'unknown',
        onSome: (value) => value.trim(),
    });
```

```typescript
const classify = (n: number) => Match.value(n).pipe(
    Match.when((value) => value < 0, () => 'neg'),
    Match.when(0, () => 'zero'),
    Match.orElse(() => 'pos'),
);
```

[CRITICAL]:
- [NEVER] use `if (...)` for variant/state dispatch in standard scope.
