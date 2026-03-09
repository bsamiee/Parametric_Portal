# Type-Level Programming

Type-level computation as algebraic discipline — conditional distribution, mapped projection, template literal algebra, recursive transformation, variance exploitation, and compression strategies that make 1 type replace 5-7 declarations. Schema/Model derivation lives in objects.md; this file owns pure TS type mechanics.

---

## [1] Derivation & Polymorphic Dispatch

Inference primitives compose as operators over runtime anchors. `typeof` lifts values into types, `keyof` projects to key union, indexed access selects by key. `satisfies` validates structure while preserving literal narrowing. `ReturnType`/`Parameters` decompose function shapes. One vocabulary drives both derivation and polymorphic dispatch — the keys determine valid inputs, indexed access determines output types, eliminating overloads entirely.

```ts
const _HANDLERS = {
    create: { method: "POST" as const,   idempotent: false, returns: "entity" as const },
    read:   { method: "GET" as const,    idempotent: true,  returns: "option" as const },
    delete: { method: "DELETE" as const, idempotent: true,  returns: "void" as const   },
    list:   { method: "GET" as const,    idempotent: true,  returns: "array" as const  },
} as const satisfies Record<string, { method: string; idempotent: boolean; returns: string }>

// derivation: 4 types from 1 anchor — zero standalone declarations
type _Action     = keyof typeof _HANDLERS
type _Method     = (typeof _HANDLERS)[_Action]["method"]
type _Idempotent = { [K in _Action as (typeof _HANDLERS)[K]["idempotent"] extends true ? K : never]: K }[keyof typeof _HANDLERS]
type _ReturnShape<K extends _Action> = (typeof _HANDLERS)[K]["returns"]

// polymorphic dispatch: conditional return type eliminates 4 overloads
type _ActionResult<K  extends _Action> =
    _ReturnShape<K>   extends "entity" ? Effect.Effect<Entity, NotFound>
    : _ReturnShape<K> extends "option" ? Effect.Effect<Option.Option<Entity>, never>
    : _ReturnShape<K> extends "array"  ? Effect.Effect<ReadonlyArray<Entity>, never>
    : Effect.Effect<void, NotFound>

// one signature — K carries discriminant through indexed access to return type
const _dispatch: <K extends _Action>(
    action: K,
    payload: { readonly tenantId: string },
) => _ActionResult<K> = undefined as never // body lives in Effect service, not type reference
```

Rename a key and every derivation + dispatch site fails simultaneously. `ReturnType` / `Parameters` extract from function shapes without explicit annotation — use when the function IS the authority:

```ts
const _buildPredicate = (filters: { status?: string; zone?: string }, limit: number) =>
    ({ filters, limit, offset: 0 }) as const
type _PredicateShape = ReturnType<typeof _buildPredicate>
```

---

## [2] Type Parameter Mechanics

Type parameters have two independent axes of behavior: **distribution** (how they evaluate over unions in conditional position) and **variance** (how they constrain subtype compatibility in generic position). `NoInfer` controls which parameter positions contribute to inference, bridging both axes.

```ts
// --- DISTRIBUTION: naked T distributes, [T] suppresses ---

// Distributive: extracts success channel per-member of a union
type _SuccessOf<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
// _SuccessOf<Effect<string, E1> | Effect<number, E2>> → string | number

// Non-distributive: extracts as unit — union stays intact in infer position
type _SuccessAll<T> = [T] extends [Effect.Effect<infer A, infer _E, infer _R>] ? A : never
// _SuccessAll<Effect<string, E1> | Effect<number, E2>> → string | number (single union)

// Multi-clause infer: decompose Effect's 3 channels simultaneously
type _Decompose<T> = T extends Effect.Effect<infer A, infer E, infer R>
    ? { readonly success: A; readonly error: E; readonly context: R }
    : never

// --- VARIANCE: in/out annotations enforce position contracts ---

// Effect<A, E, R> variance: A covariant, E covariant, R contravariant
// Effect itself uses structural variance (position-inferred), not declaration-site annotations.
// Use explicit in/out on YOUR types to enforce variance contracts the compiler would otherwise infer lazily:
type _ServiceOf<out A, out E, in R> = { readonly run: (deps: R) => Effect.Effect<A, E> }
// _ServiceOf<string, Error, DbClient> assignable to _ServiceOf<string | number, Error, DbClient>
// _ServiceOf<string, Error, DbClient | Cache> assignable to _ServiceOf<string, Error, DbClient>

// --- NoInfer: control which positions drive inference ---

// Without NoInfer: T inferred from both args — ambiguous widening
// With NoInfer: T inferred solely from first arg, second must conform
const _provide = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    layer:  NoInfer<Layer.Layer<R, E>>,
): Effect.Effect<A, E> => undefined as never
```

`extends` in generic position is a constraint (upper bound) — it restricts T's domain. Combined with conditional return types, constraints narrow both input and output simultaneously:

```ts
type _Resolve<T> = T extends { readonly _tag: string }
    ? { readonly tag: T["_tag"]; readonly value: T }
    : { readonly tag: "unknown"; readonly value: T }
```

---

## [3] Mapped & Template Algebra

Mapped types iterate `keyof T` and transform each entry. Template literals perform string algebra in key remapping position. Together they project vocabularies into accessor signatures, event names, filtered subsets, and permission matrices — replacing N manual declarations with one parameterized mapped type.

```ts
// Integrated: key remapping + template literal + filtering + modifier arithmetic
// One type replaces _Accessors + _EventNames + _FilteredFields + _StrictProps
type _VocabProjection<T, Filter = unknown> = {
    +readonly [K in keyof T as T[K] extends Filter
        ? `get${Capitalize<string & K>}`
        : never
    ]-?: () => T[K]
}
// _VocabProjection<{ name: string; age: number; active: boolean }, string>
// → { readonly getName: () => string }
```

Homomorphic mapped types (`keyof T`) preserve source modifiers (optional, readonly); non-homomorphic (independent union) do not. This determines whether a mapped type "inherits" the shape's modifier structure or starts fresh.

Cartesian product generation — template literals over union operands expand combinatorially, producing the full matrix without manual enumeration:

```ts
const _PERMISSIONS = {
    users:   { scopes: ["read", "write", "admin"] as const },
    billing: { scopes: ["read", "write"] as const },
} as const satisfies Record<string, { scopes: ReadonlyArray<string> }>

type _Domain = keyof typeof _PERMISSIONS
type _Scope<D extends _Domain> = (typeof _PERMISSIONS)[D]["scopes"][number]
type _Permission = { [D in _Domain]: `${D}:${_Scope<D>}` }[_Domain]
// "users:read" | "users:write" | "users:admin" | "billing:read" | "billing:write"

// Branded string pattern — template literal as compile-time format constraint
type _TenantSlug = `tn_${string}`
const _isSlug = (raw: string): raw is _TenantSlug => raw.startsWith("tn_")
```

Event name generation from vocabulary keys — `Capitalize` intrinsic transforms the key, mapped type iterates the vocabulary:

```ts
type _EventNames<T> = { [K in keyof T & string as `on${Capitalize<K>}Changed`]: T[K] }
// _EventNames<{ status: string; priority: number }>
// → { onStatusChanged: string; onPriorityChanged: number }
```

---

## [4] Recursive Transformation

Recursive types walk arbitrary-depth structures via self-reference in conditional branches. One parameterized recursive type replaces `DeepPartial`, `DeepReadonly`, `DeepRequired` as special cases of a general transform.

```ts
// General deep replacement — From→To at arbitrary depth
// _DeepReplace<T, Date, string> subsumes DeepReadonly, DeepPartial as special cases
type _DeepReplace<T, From, To> = T extends From
    ? To
    : T extends object
        ? { [K in keyof T]: _DeepReplace<T[K], From, To> }
        : T
```

Path extraction yields compile-time-safe dot-notation keys for deep access. The `Depth` tuple accumulator enforces an explicit budget — at the limit, recursion terminates with `never`. Without a budget, deeply nested types hit `Type instantiation is excessively deep` (~50 levels). `keyof T & string` excludes symbol/number keys since dot-notation paths are string-only — use `keyof T & (string | number)` with template literal conversion when numeric tuple indices matter.

```ts
type _Paths<T, Depth extends ReadonlyArray<unknown> = []> =
    Depth["length"] extends 8 ? never
    : T extends object ? {
        [K in keyof T & string]: K | `${K}.${_Paths<T[K], [...Depth, unknown]>}`
    }[keyof T & string] : never
```

Tail-recursive conditional types accumulate results in a type parameter rather than building nested conditional chains — TS recognizes this pattern and raises the depth limit:

```ts
type _Join<T extends ReadonlyArray<string>, Sep extends string, Acc extends string = ""> =
    T extends readonly [infer H extends string, ...infer Rest extends ReadonlyArray<string>]
        ? _Join<Rest, Sep, Acc extends "" ? H : `${Acc}${Sep}${H}`>
        : Acc
```

When recursive depth exceeds ~50, quarantine the type in `types/internal/` and consider `ts-toolbelt` (`O.Merge`, `L.Concat`) which uses pre-computed lookup tables instead of runtime recursion.

---

## [5] Compression Algebra

Utility types are set-theoretic operators over type structures: `Pick` projects, `Omit` eliminates, `Partial` lifts to optional, `Extract`/`Exclude` filter unions by assignability. One canonical type + projection operators replaces N standalone declarations.

```ts
// 1 canonical type → 5 projections via operators — replaces 6 interface declarations
type _Entity = {
    readonly id:        string
    readonly tenantId:  string
    readonly name:      string
    readonly status:    "active" | "archived" | "purging" | "suspended"
    readonly createdAt: Date
    readonly updatedAt: Date
}
type _EntityCreate = Omit<_Entity, "id" | "createdAt" | "updatedAt">
type _EntityPatch  = Partial<Pick<_Entity, "name" | "status">>
type _EntityKey    = Pick<_Entity, "id" | "tenantId">
type _EntityView   = Omit<_Entity, "tenantId">
type _EntityRef    = Pick<_Entity, "id" | "name">

// Extract/Exclude as set intersection/difference on union discriminants
type _Visible  = Extract<_Entity["status"], "active" | "archived">    // "active"  | "archived"
type _Terminal = Exclude<_Entity["status"], _Visible>                 // "purging" | "suspended"
```

**Compression economics**: if a type derives via 1 utility application on an existing type, never declare it standalone unless 3+ consumers reference it — below that threshold, inline the projection at the call site. When the canonical type has a Schema/Model anchor, prefer `S.pick`/`S.omit`/`S.partial` over TS utility types (objects.md owns that boundary).

---

## [6] Anti-Patterns

- **TYPE PROLIFERATION** `[CRITICAL]`: Standalone `type X = { ... }` when `typeof schema.Type` or `typeof _VOCAB[K]` gives the same shape. Delete the type, derive from runtime.
- **INTERFACE CEREMONY** `[CRITICAL]`: `interface IService` separate from `Effect.Service` class. The class IS both value and type.
- **BRAND SPRAWL** `[HIGH]`: `type TenantId = string & Brand<"TenantId">` as standalone export. Inline `S.brand("TenantId")` as field modifier in the owning Model/Class (objects.md).
- **MIRROR TYPES** `[HIGH]`: `type TaskInsert = Omit<Task, "id">` manually redeclaring what `Model.Class` derives via field modifiers.
- **TYPE-ONLY FILES** `[HIGH]`: Module containing only type declarations with no runtime anchor. Types live adjacent to their runtime anchors.
- **DISTRIBUTIVE ACCIDENT** `[MEDIUM]`: Unintended per-member evaluation when passing a union to a conditional type. Wrap in `[T] extends [U]` when union-as-unit semantics required.
- **RECURSIVE BLOWUP** `[MEDIUM]`: Recursive type without depth budget hitting `Type instantiation is excessively deep`. Use tuple accumulator pattern or quarantine in `types/internal/`.
- **VARIANCE CONFUSION** `[MEDIUM]`: Assigning `Consumer<string>` to `Consumer<string | number>` (contravariant violation). Annotate with `in`/`out` to surface errors at declaration.
- **OVERLOAD INFLATION** `[LOW]`: 3+ overload signatures when a conditional return type + generic constraint achieves the same polymorphism in 1 signature.
