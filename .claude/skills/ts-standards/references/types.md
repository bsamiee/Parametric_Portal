# [H1][TYPES]
>**Dictum:** *Types extract from schemas; names attach to runtime symbols; narrowing happens at the call site.*

<br>

**No module-level type aliases.** Types are either:
- derived inline (`typeof Schema.Type`, `Extract<...>`, `InstanceType<...>`), or
- exported under a `const+namespace` / `class+namespace` merge.

For schema definitions see `objects.md`.

---
## Canonical Pattern: const + namespace

Derive types from schema values and attach them to the runtime symbol via namespace merge.

```typescript
import { Schema as S } from 'effect';

const UserId = S.UUID.pipe(S.brand('UserId'));

class UserSchema extends S.TaggedClass<UserSchema>()('User', {
    id:   UserId,
    name: S.NonEmptyTrimmedString,
    tier: S.Literal('free', 'pro', 'enterprise'),
}) {}

const projection = {
    create: UserSchema.pipe(S.omit('_tag')),
    patch:  UserSchema.pipe(S.pick('name', 'tier'), S.partial),
    read:   UserSchema,
} as const;

const User = { Id: UserId, Schema: UserSchema, projection } as const;
namespace User {
    export type Id =     typeof UserId.Type;
    export type Type =   typeof UserSchema.Type;
    export type Create = typeof projection.create.Type;
    export type Patch =  typeof projection.patch.Type;
}
```

*Rule:* schema values are runtime; types are derived from those values and live under the merged namespace.

---
## Narrowing: Extract at the use site

Use `Extract<Union, Pattern>` and a type predicate inline, then narrow through the error channel via `Effect.filterOrFail`.

```typescript
import { Data, Effect, Schema as S } from 'effect';

class StateError extends Data.TaggedError('StateError')<{ readonly expected: string; readonly actual: string }> {}

const State = S.Union(
    S.Struct({ _tag: S.Literal('pending'), requestId: S.String }),
    S.Struct({ _tag: S.Literal('active'), sessionId: S.String, userId: S.String }),
);
const requireActive = (loaded: typeof State.Type) =>
    Effect.succeed(loaded).pipe(
        Effect.filterOrFail(
            (s): s is Extract<typeof State.Type, { _tag: 'active' }> => s._tag === 'active',
            () => new StateError({ expected: 'active', actual: loaded._tag }),
        ),
    );
```

---
## Literal Preservation: <const T> and satisfies

Preserve literals through generics with `<const T extends ...>`. Validate shapes with `satisfies` without widening.

```typescript
import { Schema as S } from 'effect';

const Action = S.Literal('read', 'write', 'delete');
const withAction = <const T extends typeof Action.Type>(action: T) => ({ action, at: 0 as const } as const);
const permissions = [
    { resource: 'document', actions: ['read', 'write'] },
    { resource: 'account',  actions: ['read', 'write', 'delete'] },
] as const satisfies ReadonlyArray<{
    readonly resource: string;
    readonly actions: readonly string[];
}>;
```

---
## Union Derivation from Constructor Maps

Derive unions from a constructor map so adding a constructor extends the union automatically (no manual union maintenance).

```typescript
const errors = { NotFound, Conflict, Forbidden, Internal } as const;

export namespace DomainError {
    export type Any = InstanceType<(typeof errors)[keyof typeof errors]>;
    export type Of<K extends keyof typeof errors> = InstanceType<(typeof errors)[K]>;
}
```

---
## Rules
- Never write standalone `type X = ...` at module scope.
- Prefer `const+namespace` merge for named exported types.
- Narrow at the call site with `Extract` and type predicates; route failure through `Effect.filterOrFail`.
- Derive unions from constructor maps with `InstanceType`.

*Inline over Helper:* Use `InstanceType<(typeof _errors)[K]>` directly in the namespace -- no intermediate `type _I<K>` alias. The mapped form reads at the call site without indirection.

---
## Quick Reference

| [INDEX] | [PATTERN]                              | [WHEN]                               | [EXAMPLE]                                              |
| :-----: | -------------------------------------- | ------------------------------------ | ------------------------------------------------------ |
|   [1]   | **`typeof X.Type`**                    | Derive type from any schema          | `type User = typeof UserSchema.Type`                   |
|   [2]   | **`const+namespace` Merge**            | Export values + types as one symbol  | `const Ctx = {...}; namespace Ctx {...}`               |
|   [3]   | **`Extract<U, {_tag}>`**               | Narrow union member at call site     | `Extract<typeof State.Type, {_tag: 'active'}>`         |
|   [4]   | **`F extends X<infer T> ? T : never`** | Extract inner type from schema field | `Session extends Option<infer S> ? S : never`          |
|   [5]   | **`InstanceType<(typeof obj)[K]>`**    | Derive union from constructor map    | `InstanceType<(typeof _errors)[keyof typeof _errors]>` |
|   [6]   | **`as const satisfies`**               | Validate shape, preserve literals    | `[...] as const satisfies ReadonlyArray<T>`            |
|   [7]   | **`<const T extends E>`**              | Preserve literals through generics   | `<const T extends typeof ActionSchema.Type>`           |
