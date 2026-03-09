# Types

The `[TYPES]` section should be the **rarest section** in any file. Most modules need zero standalone type declarations — types derive from runtime values, schemas, and function signatures. A standalone `type` or `interface` declaration is justified only when no runtime anchor exists to derive from.

## Inline-first principle

Schema fields, branded primitives, and literal unions belong **inline at the point of use** — never as standalone module-level declarations unless genuinely reused by 2+ consumers within the same file.

```ts
// WRONG: 2 module-level consts for single-use field schemas
const _Status =   S.Literal("todo", "in_progress", "done")
const _Priority = S.Literal("low", "medium", "high")
class Task extends Model.Class<Task>("Task")({
  status:   _Status,
  priority: _Priority,
}) {}

// RIGHT: inline — zero module-level members for single-use fields
class Task extends Model.Class<Task>("Task")({
  id:        Model.Generated(S.String.pipe(S.brand("TaskId"))),
  title:     S.NonEmptyTrimmedString,
  status:    S.Literal("todo", "in_progress", "done"),
  priority:  S.Literal("low", "medium", "high"),
  tenantId:  Model.FieldExcept("update", "jsonUpdate")(S.String.pipe(S.brand("TenantId"))),
  createdAt: Model.DateTimeInsertFromDate,
}) {}
// Task.insert.Type, Task.update.Type, Task.fields.status.Type — all derived

// ACCEPTABLE: single const when genuinely reused (query predicates + field)
const _Status = S.Literal("todo", "in_progress", "done")
class Task extends Model.Class<Task>("Task")({
  status: _Status,
}) {
  static readonly repo = Effect.gen(function* () {
    // _Status.Type used here in predicate composition
    const _predicate = (filters: { readonly status?: typeof _Status.Type }) => /* ... */
    return { query: _predicate } as const
  })
}
// One const justified by 2 consumption sites — never 2+ consts for parallel fields
```

**Inline contracts:**
- `S.Literal(...)` and `S.String.pipe(S.brand("X"))` go directly in field position unless reused.
- When a field schema IS reused (e.g., in query predicates), extract **one** `const _X = ...` — never proliferate parallel consts for every field.
- A module with N schema fields should have 0-1 extracted consts, not N.

## Derivation hierarchy

Derive types from runtime declarations. Never declare what the compiler already infers.

```ts
// 1. From schema — the schema IS the type
class Task extends Model.Class<Task>("Task")({ /* fields */ }) {}
// Task, Task.insert.Type, Task.update.Type, Task.fields.id.Type — all derived

// 2. From const — typeof + keyof inference
const _Policy = {
  normal:  { maxRate: 0.10, retries: 3 },
  blocked: { maxRate: 1.00, retries: 0 },
} as const satisfies Record<string, { maxRate: number; retries: number }>
type _Tier = keyof typeof _Policy  // derived from runtime anchor

// 3. From function — ReturnType / Parameters
const buildQuery = (filters: Filters, limit: number) => /* ... */
type _QueryArgs = Parameters<typeof buildQuery>

// 4. From Effect service — class IS both value and type
class Cache extends Effect.Service<Cache>()("Cache", { /* ... */ }) {}
```

**Derivation contracts:**
- `typeof X.Type` when a Schema/Model exists — never redeclare the shape manually.
- `keyof typeof` when a vocabulary object defines the domain — the type narrows to literal keys.
- `ReturnType<typeof fn>` / `Parameters<typeof fn>` for function-derived types.
- `as const satisfies Record<K, V>` preserves literal types while constraining shape — without `as const`, literals widen; without `satisfies`, shape is unconstrained.

## Compression

One complex type with intersection/mapped/conditional logic replaces 4-5 simple type aliases. The `[TYPES]` section earns its place only when expressing constraints the type system enforces at compile time — not for documentation.

```ts
// WRONG: 5 simple types that mirror runtime shapes
type TaskId =       string & Brand<"TaskId">
type TaskStatus =   "todo" | "in_progress" | "done"
type TaskPriority = "low" | "medium" | "high"
type TaskInput =    { title: string; status: TaskStatus; priority: TaskPriority }
type TaskOutput =   TaskInput & { id: TaskId; createdAt: Date }

// RIGHT: zero standalone types — Schema derives everything inline
class Task extends Model.Class<Task>("Task")({
  id:        Model.Generated(S.String.pipe(S.brand("TaskId"))),
  title:     S.NonEmptyTrimmedString,
  status:    S.Literal("todo", "in_progress", "done"),
  priority:  S.Literal("low", "medium", "high"),
  createdAt: Model.DateTimeInsertFromDate,
}) {}
// Task.insert.Type, Task.update.Type — all derived, zero standalone types
```

**Compression contracts:**
- Zero standalone `type`/`interface` when a Schema, Model, or `as const` object exists for that concept.
- Branded primitives as inline field modifiers (`S.String.pipe(S.brand("X"))`) inside the owning class — never standalone module-level branded type exports.
- `Data.TaggedEnum<{ A: { ... }; B: { ... } }>` for file-internal discriminated unions — one type declaration replaces N individual types.
- When a type IS needed (no runtime anchor), prefer intersection/mapped/conditional composition over multiple simple aliases.

## Advanced type-level patterns

Use these to compress multiple type declarations into single, high-value constructs.

```ts
// Conditional extraction — one type replaces manual per-variant types
type FieldsOf<T, Condition> = {
  [K in keyof T as T[K] extends Condition ? K : never]: T[K]
}

// Mapped key remapping — derive accessor shapes from source
type Accessors<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K]
}

// Distributive conditional — flatten nested structures
type Flatten<T> = T extends ReadonlyArray<infer U>
  ? U extends ReadonlyArray<infer V> ? Flatten<V> : U
  : T

// Recursive deep readonly — one type for arbitrary depth
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T

// Exclusive union — exactly one variant at a time
type XOR<A, B> =
  | (A & { [K in Exclude<keyof B, keyof A>]?: never })
  | (B & { [K in Exclude<keyof A, keyof B>]?: never })

// Path extraction — compile-time safe deep access keys
type Paths<T> = T extends object ? {
  [K in keyof T]: K extends string
    ? T[K] extends object ? K | `${K}.${Paths<T[K]>}` : K
    : never
}[keyof T] : never
```

**When to reach for type-level computation:**
- Enforcing mutual exclusion, required-at-least-one, or exact-one-of constraints.
- Deriving accessor/builder/proxy shapes from source types automatically.
- Deep transformation (readonly, partial, required) beyond built-in utility depth.
- Never for shapes that Schema already derives — type-level ops complement Schema, they do not replace it.

## Built-in utility types

Use TypeScript built-in utilities before reaching for custom type-level computation:

| Utility          | Purpose                        |
| ---------------- | ------------------------------ |
| `Pick<T, K>`     | Select subset of properties    |
| `Omit<T, K>`     | Remove subset of properties    |
| `Partial<T>`     | Make all properties optional   |
| `Required<T>`    | Make all properties required   |
| `Readonly<T>`    | Make all properties readonly   |
| `Record<K, V>`   | Create object type with keys K |
| `Extract<T, U>`  | Extract types assignable to U  |
| `Exclude<T, U>`  | Remove types assignable to U   |
| `NonNullable<T>` | Remove null and undefined      |
| `ReturnType<T>`  | Extract function return type   |
| `Parameters<T>`  | Extract function parameters    |
| `Awaited<T>`     | Unwrap Promise type            |
| `NoInfer<T>`     | Prevent inference from arg     |

## Anti-patterns

- TYPE PROLIFERATION: `type X = { a: string; b: number }` when `typeof schema.Type` gives the same shape. Delete the type, derive from runtime.
- INTERFACE CEREMONY: `interface IService { method(): void }` separate from the class that implements it. The `Effect.Service` class IS both value and type.
- BRAND SPRAWL: `type TenantId = string & Brand<"TenantId">` as standalone export. Inline `S.String.pipe(S.brand("TenantId"))` as field modifier inside the owning Model/Class.
- MIRROR TYPES: `type TaskInsert = Omit<Task, "id" | "createdAt">` manually mirroring what `Model.Class` derives via field modifiers (`Task.insert.Type`).
- TYPE-ONLY FILES: A module containing only type declarations with no runtime anchor. Types live adjacent to their runtime anchors, not in separate files.
- CONST SPAM: `const _A = S.Literal(...)` + `const _B = S.Literal(...)` + `const _C = S.brand(...)` before a class when all three are single-use field schemas. Inline directly in field position.
