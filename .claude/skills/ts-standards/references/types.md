# [H1][TYPES]
>**Dictum:** *Types extract from schemas; namespaces organize; narrowing refines at call site.*

<br>

Types are never declared standalone. They are extracted from schemas via `typeof`, organized via `const+namespace` merge, and narrowed via `Extract`/conditional inference at call sites. For schema **definitions**, see `objects.md`. This file covers extraction, narrowing, and type-level derivation.

---
## Inline Derivation

*Canonical Form:* `type X = typeof XSchema.Type` -- the ONLY way to produce a type from a schema. Never detached `interface` or `type` declarations that duplicate schema shape. Schema definitions follow patterns in `objects.md`.

```typescript
import { Schema as S } from 'effect';

const UserId = S.UUID.pipe(S.brand('UserId'));
type UserId = typeof UserId.Type;
class UserSchema extends S.TaggedClass<UserSchema>()('User', {
    id: UserId,
    name: S.NonEmptyTrimmedString,
    tier: S.Literal('free', 'pro', 'enterprise'),
}) {}
type User = typeof UserSchema.Type;
const CreateUser = UserSchema.pipe(S.omit('_tag'));
type CreateUser = typeof CreateUser.Type;
const PatchUser = UserSchema.pipe(S.pick('name', 'tier'), S.partial);
type PatchUser = typeof PatchUser.Type;
```

*Projection Types:* `pick`/`omit`/`partial` derive subset schemas from the canonical class. The type alias is always `typeof ProjectionSchema.Type` -- never a hand-rolled interface matching the same shape.

---
## Namespace Organization

*Merge Pattern:* `const X = {...} as const` paired with `namespace X` -- TypeScript merges them into a single exportable symbol carrying both runtime values and compile-time types. Companion object pattern for generic enums: see `matching.md`.

```typescript
import { Option, Schema as S } from 'effect';

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Context = { Request: {} } as const;
namespace Context {
    export namespace Request {
        export type Data = S.Schema.Type<typeof _RequestData>;
        export type Session = Data['session'] extends Option.Option<infer T>
            ? T
            : never;
    }
}
```

*Conditional Field Extraction:* `Data['field'] extends Option.Option<infer T> ? T : never` extracts the inner type from optional schema fields without declaring intermediate types. Consumers access `Context.Request.Session` for the unwrapped session type.

*Nesting:* `namespace Context.Request` mirrors the `const Context.Request` hierarchy -- one exportable symbol for both runtime access and type extraction.

---
## Extract Narrowing

*Discriminated Member Selection:* `Extract<Union, { _tag: 'variant' }>` selects one member from a tagged union at the call site without declaring a separate type.

```typescript
import { Effect, Schema as S } from 'effect';

const _State = S.Union(
    S.Struct({ _tag: S.Literal('pending'), requestId: S.String }),
    S.Struct({ _tag: S.Literal('active'), sessionId: S.String, userId: S.String }),
);
const narrowToActive = (loaded: typeof _State.Type) =>
    Effect.succeed(loaded).pipe(
        Effect.filterOrFail(
            (state): state is Extract<typeof _State.Type, { _tag: 'active' }> => state._tag === 'active',
            () => new StateError({ expected: 'active', actual: loaded._tag }),
        ),
    );
```

*Type Predicate + filterOrFail:* Replaces `if (x._tag !== 'active') throw` with a pure, typed narrowing that feeds the Effect error channel. The `Extract` is inline at the predicate -- no module-level type alias needed unless reused across multiple call sites.

---
## Const Type Parameters

*Literal Preservation:* `<const T extends E>` preserves literal types through generic boundaries. Without `const`, TypeScript widens `'read'` to `string`.

```typescript
import { Schema as S } from 'effect';

const ActionSchema = S.Literal('read', 'write', 'delete');
const withAction = <const T extends typeof ActionSchema.Type>(
    action: T,
): { readonly action: T; readonly timestamp: number } => ({
    action,
    timestamp: Date.now(),
});
const readAction = withAction('read');
//    ^? { readonly action: "read"; readonly timestamp: number }
```

*Combined with `satisfies`:* Validates shape while preserving the narrowest type. The `as const` freezes the array; `satisfies` confirms structure without widening.

```typescript
const permissions = [
    { resource: 'document', actions: ['read', 'write'] },
    { resource: 'account', actions: ['read', 'write', 'delete'] },
] as const satisfies ReadonlyArray<{
    readonly resource: string;
    readonly actions: readonly string[];
}>;

// (typeof permissions)[0]['resource']
//   ^? "document"
```

---
## Constructor Map Inference

*Union from Object:* `InstanceType<(typeof constructors)[K]>` derives a union type from ALL constructors in a const object. Adding a constructor automatically extends the union.

```typescript
import { HashMap, Schema as S } from 'effect';

const _errors = { NotFound, Conflict, Forbidden, Internal } as const;
namespace DomainError {
    export type Any = InstanceType<(typeof _errors)[keyof typeof _errors]>;
    export type Of<K extends keyof typeof _errors> =
        InstanceType<(typeof _errors)[K]>;
}

// DomainError.Of<'NotFound'>
//   ^? NotFound
// DomainError.Any
//   ^? NotFound | Conflict | Forbidden | Internal

// HashMap type extractors — derive key/value types from existing maps
// HashMap.HashMap.Key<typeof userIndex>   ^? UserId
// HashMap.HashMap.Value<typeof userIndex> ^? User
```

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
