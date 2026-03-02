---
paths: ["**/*.ts", "**/*.tsx"]
---

# Type Discipline

## Consolidation

One dense type over many thin ones. A 4-5 LOC type with conditionals, mapped properties, or template literals replaces 2-4 trivially distinct types. >60% structural overlap = merge with discriminant or generic parameter. Every type definition must justify its existence.

## Values Are the Source

All configuration and constant data: `as const satisfies Shape`. The const is the single source — derive everything from it via indexed access `T[K]`, mapped types, `Extract`, `Exclude`.

A const map validated with `satisfies` and consumed by `Match.value` serves multiple purposes simultaneously: runtime dispatch, type constraint, exhaustiveness proof, and source of all derived types. This single declaration replaces what would otherwise require a separate type, runtime value, assertion, and dispatch function.

Generic function parameters: `<const T>` to preserve literal inference at call site. Combined with `NoInfer<T>` on return positions, polymorphic single-entry-point functions stay type-safe without overloads. `as string`, `as number` for targeted interop widening of const members.

## Types Flow From Runtime

`typeof`, `ReturnType`, `Parameters`, `Awaited`, `InstanceType`, `ConstructorParameters` from values and functions. `Schema.Type<S>`, `Schema.Encoded<S>`, `Schema.Context<S>` from Effect schemas. `Effect.Success<E>`, `Effect.Error<E>`, `Effect.Context<E>`, `Layer.Success<L>` from effects and layers. `Array.filter` narrows automatically (inferred type predicates) — explicit `(x): x is T =>` guards are redundant.

## Reshaping

`Pick`, `Omit`, `Partial`, `Required`, `Readonly` for subset/modifier operations. `Extract<Union, Constraint>`, `Exclude<Union, Constraint>` for union narrowing. Key remapping: `{ [K in keyof T as NewKey]: T[K] }`. Conditional mapped: `{ [K in keyof T]: T[K] extends X ? A : B }`. Template literals: `` `${Prefix}${string}` `` with `Uppercase`, `Lowercase`, `Capitalize`, `Uncapitalize` intrinsics. Constrained `infer`: `T extends Schema<infer A extends Record<string, unknown>> ? A : never`.

## Schema at Boundaries

Schema when crossing any boundary (serialization, validation, Hash/Equal, brand). `Schema.brand` for all domain primitives — `UserId`, `Email`, `ISO8601Timestamp`. Raw `string`/`number` forbidden in public signatures. `Schema.transform` for codec boundaries. Plain `typeof` for internal-only transient state.
