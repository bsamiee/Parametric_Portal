# [H1][TYPES]
>**Dictum:** *Schema hierarchy stratifies codec need; inference eliminates redundancy; brands eradicate primitives; tagged enums exhaust state space.*

Cross-references: `matching.md [1]` ($match dispatch), `errors.md [1-2]` (error declarations), `persistence.md [1]` (Model.Class + field modifiers), `surface.md [1-3]` (HttpApi, Rpc.make)

---
## [1][SCHEMA_HIERARCHY]
>**Dictum:** *Choose the minimal abstraction satisfying the constraint; never over-schema.*

| [INDEX] | [API]                 | [WHEN]                                         | [AUTO_DERIVES]                    |
| :-----: | --------------------- | ---------------------------------------------- | --------------------------------- |
|   [1]   | Plain object + typeof | Internal config, state; never serializes       | Literal types via `as const`      |
|   [2]   | `S.Struct`            | Inline shape; no class identity needed         | Type/Encoded inference            |
|   [3]   | `S.Class`             | Codec + Hash/Equal; single non-union entity    | `.fields`, `.make()`, Equal trait |
|   [4]   | `S.TaggedClass`       | Discriminated entity in union; auto `_tag`     | `_tag` literal, codec, Hash/Equal |
|   [5]   | `S.TaggedError`       | Error crossing boundary -- see `errors.md [2]` | `_tag`, codec, `get message` slot |
|   [6]   | `S.TaggedRequest`     | RPC contract -- see `surface.md [3]`           | `_tag`, success/failure schemas   |
|   [7]   | `Model.Class`         | SQL persistence -- see `persistence.md [1]`    | 6 auto-projections from modifiers |

```typescript
import { Data, Effect, Match, Option, Schema as S, pipe } from 'effect';
// --- [SCHEMA] ----------------------------------------------------------------
// why: Entity crosses HTTP boundary -- needs codec + Hash/Equal for HashMap keys
class Workspace extends S.Class<Workspace>('Workspace')({
    id:      S.UUID,
    name:    S.String.pipe(S.minLength(1), S.maxLength(100)),
    tier:    S.Literal('free', 'pro', 'enterprise'),
    ownerId: S.UUID,
}) {}
// --- [PROJECTIONS] -----------------------------------------------------------
// why: derive at call site -- one canonical schema, many shapes; never create
//      separate CreateWorkspace.ts or PatchWorkspace.ts files
const CreateWorkspace = S.Struct(Workspace.fields).pipe(
    S.pick('name', 'tier', 'ownerId'),
);
const PatchWorkspace = S.Struct(Workspace.fields).pipe(
    S.pick('name', 'tier'),
    S.partial,
);
type CreateWorkspace = typeof CreateWorkspace.Type;
type PatchWorkspace  = typeof PatchWorkspace.Type;
```

---
## [2][INFERENCE_AND_IMMUTABILITY]
>**Dictum:** *One runtime declaration; all type information flows from it.*

`typeof` for config, `ReturnType` for factories, `typeof X.Type` for schemas.
`as const satisfies` validates shape while preserving literal types.
`const` type parameters (TS 5.0+) preserve literal tuples at call site.

```typescript
// --- [CONSTANTS] -------------------------------------------------------------
// why: rate-limit presets are internal -- never serialize; typeof preserves literals
const _LIMITS = {
    api:      { windowMs: 60_000, max: 100 },
    mutation: { windowMs: 60_000, max: 20  },
    realtime: { windowMs: 60_000, max: 5   },
} as const satisfies Record<string, { windowMs: number; max: number }>;
type LimitPreset = keyof typeof _LIMITS;
// --- [INFERENCE] -------------------------------------------------------------
// why: typeof _LIMITS.api infers { readonly windowMs: 60000; readonly max: 100 }
//      never redeclare what the compiler already knows
type ApiLimit = typeof _LIMITS.api;
// why: ReturnType extracts factory return shape without manual annotation
const makeConfig = () => ({
    retries: 3 as const,
    timeout: 5_000 as const,
    mode: 'strict' as const,
});
type Config = ReturnType<typeof makeConfig>;
// --- [CONST_TYPE_PARAMS] -----------------------------------------------------
// why: <const T> preserves literal tuple at call site without caller `as const`
const createRoute = <const T extends readonly string[]>(
    segments: T,
): `/${string}` =>
    `/${segments.join('/')}` as `/${string}`;
// inferred: readonly ["api", "v1", "users"] -- not string[]
const route = createRoute(['api', 'v1', 'users']);
```

---
## [3][BRANDED_TYPES]
>**Dictum:** *S.brand produces nominal refinement; companion IIFE groups domain operations under one symbol.*

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
// why: Email crosses HTTP boundary -- codec validates at parse time
const Email = S.String.pipe(
    S.pattern(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/),
    S.brand('Email'),
);
type Email = typeof Email.Type;
// why: Timestamp needs arithmetic ops beyond what raw number provides;
//      companion IIFE groups schema + ops under one const
const Timestamp = (() => {
    const schema = S.Number.pipe(S.positive(), S.brand('Timestamp'));
    type T = typeof schema.Type;
    const nowSync = (): T => Date.now() as T;
    return {
        add:       (ts: T, delta: number): T => (ts + delta) as T,
        expiresAt: (delta: number): T => (nowSync() + delta) as T,
        now:       Effect.sync(nowSync),
        nowSync,
        schema,
    } as const;
})();
type Timestamp = typeof Timestamp.schema.Type;
// --- [FUNCTIONS] -------------------------------------------------------------
// why: branded arg rejects raw strings at compile time -- decode at boundary,
//      flow branded values through domain, never re-validate
const scheduleSend = (
    to: Email,
    at: Timestamp,
): Effect.Effect<{ to: Email; at: Timestamp; scheduled: true }> =>
    Effect.succeed({ to, at, scheduled: true as const });
// In production: Email, Timestamp, scheduleSend would live inside a
// const+namespace export -- see [6] for the canonical pattern.
```

---
## [4][TAGGED_CLASS_AND_UNIONS]
>**Dictum:** *S.TaggedClass auto-injects _tag; S.Union composes discriminated sets; S.attachPropertySignature adds discriminants post-hoc.*

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
// why: TaggedClass auto-injects _tag; S.Union composes discriminated set
class Provision extends S.TaggedClass<Provision>()('Provision', {
    name: S.NonEmptyTrimmedString,
}) {}
class Suspend extends S.TaggedClass<Suspend>()('Suspend', {
    tenantId: S.UUID,
    reason:   S.String,
}) {}
class Resume extends S.TaggedClass<Resume>()('Resume', {
    tenantId: S.UUID,
}) {}
const LifecycleCommand = S.Union(Provision, Suspend, Resume);
type LifecycleCommand = typeof LifecycleCommand.Type;
// Decoder reads _tag first -> dispatches to correct member schema: O(1)
// Dispatch via Match.valueTags -- see matching.md [3]
// --- [ATTACH_PROPERTY_SIGNATURE] ---------------------------------------------
// why: inject discriminant without modifying source schema
const DomainEvent = S.Struct({ id: S.UUID, payload: S.Unknown }).pipe(
    S.attachPropertySignature('_tag', 'DomainEvent'),
);
type DomainEvent = typeof DomainEvent.Type;
// DomainEvent.Type = { id: string; payload: unknown; _tag: 'DomainEvent' }
```

---
## [5][TAGGED_ENUM_AND_PHANTOM]
>**Dictum:** *Data.TaggedEnum closes the algebra; phantom types encode state machines at zero runtime cost.*

`Data.taggedEnum` produces variant constructors, `$match` (exhaustive), `$is` (narrowing).
Generic enums extend `WithGenerics<N>`. Phantom type parameters encode lifecycle state --
functions accept only valid source state; the compiler rejects illegal transitions.

```typescript
// --- [TYPES] -----------------------------------------------------------------
type Command<A> = Data.TaggedEnum<{
    Create:  { readonly payload: A };
    Update:  { readonly id: string; readonly patch: Partial<A> };
    Archive: { readonly id: string; readonly reason: string };
}>;
interface _CommandDef extends Data.TaggedEnum.WithGenerics<1> {
    readonly taggedEnum: Command<this['A']>;
}
const Command = Data.taggedEnum<_CommandDef>();
// $match and $is dispatch: see matching.md [1]
// --- [PHANTOM] ---------------------------------------------------------------
// why: phantom brands are zero-cost proofs -- invalid transitions fail at
//      the type level, not at runtime
interface Draft     { readonly _brand: 'Draft'     }
interface Published { readonly _brand: 'Published' }
interface Archived  { readonly _brand: 'Archived'  }
type Article<S> = {
    readonly id: string; readonly title: string;
    readonly content: string; readonly _state: S;
};
// why: only Draft->Published is valid; Draft->Archived is a compile error
const publish = (
    article: Article<Draft>,
): Effect.Effect<Article<Published>> =>
    pipe(
        Effect.succeed(article),
        Effect.filterOrFail(
            (a) => a.content.length > 0,
            () => new ArticleError({ reason: 'empty_content' }),
        ),
        Effect.map((a) => ({ ...a, _state: {} as Published })),
    );
// why: only Published->Archived; calling archive(draft) is a type error
const archive = (
    article: Article<Published>,
): Effect.Effect<Article<Archived>> =>
    Effect.succeed({ ...article, _state: {} as Archived });
// Error types: see errors.md [1] for Data.TaggedError patterns
```

---
## [6][NAMESPACE_MERGE]
>**Dictum:** *Const + namespace merge exports one symbol carrying both runtime values and types.*

Consumers use `X.method()` for runtime and `X.Of<A>` for types through a single import.
Destructure `taggedEnum` internals into a const object. Namespace adds type-level exports.

```typescript
// --- [TYPES] -----------------------------------------------------------------
type AsyncState<A = unknown, E = unknown> = Data.TaggedEnum<{
    Idle:    {};
    Loading: { readonly startedAt: number };
    Success: { readonly data: A; readonly at: number };
    Failure: { readonly error: E; readonly at: number };
}>;
interface _Def extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: AsyncState<this['A'], this['B']>;
}
// --- [INTERNAL] --------------------------------------------------------------
const { $is, $match, Failure, Idle, Loading, Success } = Data.taggedEnum<_Def>();
// --- [OBJECT] ----------------------------------------------------------------
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
//   requires the const binding even though namespace re-exports the symbol
const AsyncState = {
    $is, $match,
    failure: <E>(error: E, at = Date.now()): AsyncState<never, E> => Failure({ error, at }),
    idle:    (): AsyncState<never, never> => Idle({}),
    loading: (startedAt = Date.now()): AsyncState<never, never> => Loading({ startedAt }),
    success: <A>(data: A, at = Date.now()): AsyncState<A, never> => Success({ data, at }),
    // why: extract data from Success; all other variants collapse to Option.none
    unwrap:  <A, E>(state: AsyncState<A, E>): Option.Option<A> =>
        $match(state, {
            Idle: () => Option.none(), Loading: () => Option.none(),
            Success: ({ data }) => Option.some(data), Failure: () => Option.none(),
        }),
} as const;
// --- [NAMESPACE] -------------------------------------------------------------
namespace AsyncState {
    export type Of<A = unknown, E = unknown> = AsyncState<A, E>;
    export type Tag = AsyncState['_tag'];
}
// --- [EXPORT] ----------------------------------------------------------------
export { AsyncState };
```

---
## [7][TEMPLATE_LITERALS_AND_RECURSIVE]
>**Dictum:** *S.TemplateLiteral validates string patterns at runtime; S.suspend breaks circular references.*

```typescript
// --- [TYPES] -----------------------------------------------------------------
// why: branded route paths reject arbitrary strings at compile time
type ApiPath   = `/api/v${number}/${string}`;
type EventName = `${string}.${string}`;
// --- [SCHEMA] ----------------------------------------------------------------
// why: runtime validation of template literal patterns for untrusted input
const ApiPathSchema = S.TemplateLiteral(
    S.Literal('/api/v'), S.Number, S.Literal('/'), S.String,
);
type ApiPathSchema = typeof ApiPathSchema.Type;
// S.TemplateLiteralParser: parses into structured tuple (not just validates)
const SemVer = S.TemplateLiteralParser(
    S.NumberFromString, S.Literal('.'),
    S.NumberFromString, S.Literal('.'),
    S.NumberFromString,
);
// Decode("1.2.3") -> [1, ".", 2, ".", 3] -- structured parsing
// --- [OPTIONAL_SEMANTICS] ----------------------------------------------------
// why: S.optional = key may be absent (type includes undefined)
//      S.optionalWith({default}) = absent key -> injected default (no undefined in type)
const FeatureFlags = S.Struct({
    maxRetries:  S.optionalWith(S.Int, { default: () => 3 }),
    enableAudit: S.optionalWith(S.Boolean, { default: () => false }),
    label:       S.optional(S.String),
});
// Decode({}) -> { maxRetries: 3, enableAudit: false, label: undefined }
// --- [RECURSIVE] -------------------------------------------------------------
// why: S.suspend breaks circular reference for self-referential schemas;
//      without it, TreeNode would cause infinite recursion at definition time
type TreeNode = {
    readonly value: string;
    readonly children: ReadonlyArray<TreeNode>;
};
const TreeNode: S.Schema<TreeNode> = S.Struct({
    value:    S.String,
    children: S.Array(S.suspend(() => TreeNode)),
});
```

---
## [8][ADVANCED_INFERENCE]
>**Dictum:** *Conditional and mapped types extract structure from Effect signatures and Schema fields.*

```typescript
// --- [TYPES] -----------------------------------------------------------------
// why: extract error/success types from Effect signatures for composition
//      without manually redeclaring service return types
type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R>
    ? A
    : never;
type EffectError<T> = T extends Effect.Effect<infer _A, infer E, infer _R>
    ? E
    : never;
type EffectContext<T> = T extends Effect.Effect<infer _A, infer _E, infer R>
    ? R
    : never;
// why: derive service error union from function reference, not manual listing
type ServiceErrors = EffectError<ReturnType<typeof createUser>>;
// --- [MAPPED_OVER_SCHEMA_FIELDS] ---------------------------------------------
// why: map over schema fields to derive parallel structures (e.g., repo factory
//      field resolution, form state objects) without manual enumeration
type FieldNames<T extends S.Struct.Fields> = keyof T & string;
type OptionalFields<T extends S.Struct.Fields> = {
    [K in keyof T as T[K] extends S.optional<any> ? K : never]: T[K];
};
// usage: FieldNames<typeof Workspace.fields> = "id" | "name" | "tier" | "ownerId"
// why: Data.struct creates objects with structural Hash/Equal for HashMap keys
//      without requiring full S.Class overhead
const point = Data.struct({ x: 0, y: 0 });
const set = new Set([point, Data.struct({ x: 0, y: 0 })]);
// set.size = 1 -- structural equality deduplicates
```

---
## [9][RULES]
>**Dictum:** *Constraints enforce the invariants that make types useful.*

- [ALWAYS] Derive types from runtime values: `typeof _CONFIG`, `typeof X.Type`, `ReturnType`, `Parameters`.
- [ALWAYS] `const X = S.String.pipe(..., S.brand('Name'))` then `type X = typeof X.Type` -- name match.
- [ALWAYS] `as const satisfies Record<K,V>` for dispatch tables -- preserves literals, validates shape.
- [ALWAYS] `<const T>` type parameter to preserve literal tuples at call site.
- [ALWAYS] `S.Class` when codec, Hash, or Equal derivation is needed; `S.TaggedClass` for union members.
- [ALWAYS] `S.Union` of `S.TaggedClass` for discriminated command/event algebras with O(1) decode.
- [ALWAYS] `S.attachPropertySignature` to inject discriminants into existing schemas.
- [ALWAYS] `Data.TaggedEnum` + `Data.taggedEnum<Def>()` for closed algebraic unions with generics.
- [ALWAYS] Const + namespace merge for domain objects -- one symbol for values and types.
- [ALWAYS] Derive projections via `S.pick`/`S.omit`/`S.partial` at call site -- one canonical schema per entity.
- [ALWAYS] Companion IIFE for brands needing domain operations (arithmetic, generators).
- [ALWAYS] Phantom type parameters for state machines -- empty interfaces, zero runtime cost.
- [ALWAYS] `S.optionalWith({ default })` when absent means "use default"; `S.optional` when absent means undefined.
- [ALWAYS] `S.suspend(() => X)` for recursive/self-referential schemas only.
- [ALWAYS] `S.TemplateLiteral` for runtime validation of structured string patterns.
- [ALWAYS] `Data.struct` for lightweight structural Hash/Equal without full `S.Class`.
- [NEVER] Redeclare types the compiler already infers -- no `type X = { id: string; ... }` when schema exists.
- [NEVER] Schema-wrap internal config, state, or intermediates that never serialize.
- [NEVER] Create separate `CreateX`/`UpdateX` schema files -- derive via `pick`/`omit`/`partial` at call site.
- [NEVER] `Object.freeze` -- `as const` is sufficient for immutability.
- [NEVER] Re-export external lib types -- consumers import directly from source.

---
## [10][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                   | [WHEN]                          | [KEY_TRAIT]                             |
| :-----: | --------------------------- | ------------------------------- | --------------------------------------- |
|   [1]   | `typeof _CONFIG`            | Internal config; never serial.  | Literal types; zero schema overhead     |
|   [2]   | `S.brand('X')` + pipeline   | Nominal refinement, primitives  | `type X = typeof X.Type` extracts proof |
|   [3]   | Companion IIFE              | Brand + domain ops (arithmetic) | `schema` + ops in one const             |
|   [4]   | `satisfies Record<K,V>`     | Dispatch tables, config shape   | Validates shape; preserves literals     |
|   [5]   | `<const T>` type param      | Literal tuple preservation      | No `as const` at call site required     |
|   [6]   | `S.TaggedClass` + `S.Union` | Discriminated command/event set | O(1) decode dispatch on `_tag`          |
|   [7]   | `S.attachPropertySignature` | Post-hoc discriminant injection | Existing schema + `_tag` field          |
|   [8]   | `Data.TaggedEnum`           | Closed algebraic union          | `$match` exhausts at compile time       |
|   [9]   | `WithGenerics<N>`           | Generic closed union            | `_Def` interface; params propagate      |
|  [10]   | Phantom type parameter      | State machine; invalid transtns | Empty interface; zero runtime cost      |
|  [11]   | Const + namespace merge     | Domain object; one export       | `X.method()` + `X.Of<A>` one import     |
|  [12]   | `S.TemplateLiteral`         | Structured string patterns      | Runtime + type-level validation         |
|  [13]   | `S.TemplateLiteralParser`   | Parse strings into tuples       | Structured decoding, not just checking  |
|  [14]   | `S.optionalWith({default})` | Absent key -> default value     | Type excludes undefined; default inject |
|  [15]   | `S.suspend(() => X)`        | Recursive/self-referential      | Deferred evaluation; circularity escape |
|  [16]   | `Data.struct`               | Structural Hash/Equal keys      | HashMap/HashSet key deduplication       |
|  [17]   | Conditional `infer`         | Extract A/E/R from Effect types | `EffectError<T>`, `EffectSuccess<T>`    |
|  [18]   | Mapped over `.fields`       | Derive parallel structures      | `keyof T & string` field enumeration    |
