# [H1][OBJECTS]
>**Dictum:** *Schema is single source of truth: class, brand, codec, projection derive from one declaration.*

<br>

Every data definition starts as a schema. `S.Class` for plain data, `S.TaggedClass` for discriminated variants, `S.TaggedRequest` for request/response contracts. Projections use `pick`/`omit`/`partial` at call site -- never parallel struct definitions. Error schemas belong in `errors.md`. Type extraction and namespace patterns belong in `types.md`.

---
## S.Class

`S.Class` omits the `_tag` discriminant -- use for plain data objects that do not participate in unions. Static factories convert between representations without exposing the full constructor.

```typescript
import { Effect, HashMap, Option, Schema as S } from 'effect';

const _RequestData = S.Struct({
    ipAddress: S.OptionFromSelf(S.String),
    requestId: S.String,
    tenantId:  S.String,
    userId:    S.optional(S.String),
});

class Serializable extends S.Class<Serializable>('app/Context.Serializable')({
    ipAddress: S.optional(S.String),
    requestId: S.String,
    runnerId:  S.optional(S.NonEmptyTrimmedString),
    tenantId:  S.String,
    userId:    S.optional(S.String),
}) {
    static readonly fromData = (ctx: typeof _RequestData.Type): Serializable =>
        new Serializable({
            ipAddress: Option.getOrUndefined(ctx.ipAddress),
            requestId: ctx.requestId,
            tenantId:  ctx.tenantId,
        });
}

// S.Class auto-implements Hash + Equal — HashMap/HashSet ready
const sessionMap = HashMap.make(['sess-1', new Serializable({ requestId: 'r1', tenantId: 't1' })],);
const found = HashMap.get(sessionMap, 'sess-1'); // Option<Serializable>
```

---
## S.TaggedClass with Projections

`S.TaggedClass` auto-injects `_tag` for union membership. `S.pick`, `S.omit`, `S.partial` derive subset schemas from the canonical class at call site. Branded fields inline validation and nominal typing in one pipeline.

```typescript
import { Array, Schema as S } from 'effect';

const NodeId = S.UUID.pipe(S.brand('NodeId'));

class LineItem extends S.TaggedClass<LineItem>()('LineItem', {
    sku:       S.NonEmptyTrimmedString,
    quantity:  S.Int.pipe(S.positive(), S.brand('Quantity')),
    currency:  S.Literal('USD', 'EUR', 'GBP'),
    unitPrice: S.Positive,
}) {}

const CreateLineItem =  LineItem.pipe(S.omit('_tag'));
const PatchLineItem =   LineItem.pipe(S.pick('quantity', 'unitPrice'), S.partial);
const LineItemSummary = LineItem.pipe(S.pick('sku', 'quantity'));

// Array module: structural equality enables dedupe/groupBy without custom comparators
const unique =                  Array.dedupe(items);
const byCurrency =              Array.groupBy(items, (item) => item.currency);
const [expensive, affordable] = Array.partition(items, (item) => item.unitPrice > 100);
```

*Recursive Union:* `S.suspend(() => Tree)` breaks the circular reference. The `const Tree` schema value uses inline `Leaf | Branch` in its type annotation.

```typescript
import { Schema as S } from 'effect';

class Leaf extends S.TaggedClass<Leaf>()('Leaf', {
    id:     NodeId,
    label:  S.NonEmptyTrimmedString,
    weight: S.Positive,
}) {}

class Branch extends S.TaggedClass<Branch>()('Branch', {
    id:       NodeId,
    label:    S.NonEmptyTrimmedString,
    children: S.Array(S.suspend((): S.Schema<Leaf | Branch> => Tree)),
}) {}

const Tree: S.Schema<Leaf | Branch> = S.Union(Leaf, Branch);
```

---
## S.TaggedRequest with PrimaryKey

`failure`, `payload`, and `success` define the complete type signature at compile time. `PrimaryKey.symbol` provides deterministic key computation for cache storage and invalidation routing.

```typescript
import { Effect, PrimaryKey, Schema as S } from 'effect';

class CacheKey extends S.TaggedRequest<CacheKey>()('CacheKey', {
    failure: ServiceError,
    payload: { id: S.String, scope: S.String, tenantId: S.String },
    success: S.Unknown,
}) {
    [PrimaryKey.symbol]() {return `${this.scope}:${this.tenantId}:${this.id}`;}
}

const result = yield* cache.get(
    new CacheKey({ id: hash, scope: 'session', tenantId }),
);
```

*Type-Safe Lookup:* `cache.get(new CacheKey({...}))` returns `Effect.Effect<Success, Failure>` -- type parameters inferred from the TaggedRequest definition. Request dispatch patterns belong in `matching.md`.

---
## Schema Codecs and Transforms

Branded pipelines chain validation and branding. `S.parseJson` decodes from JSON string to typed struct in one step. `S.transform` maps between encoded (wire) and decoded (domain) representations. `S.attachPropertySignature` injects discriminants without modifying the base schema.

```typescript
import { Data, DateTime, Equal, Schema as S } from 'effect';

const Email = S.Trimmed.pipe(
    S.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    S.brand('Email'),
);

const _Pkce = S.parseJson(S.Struct({
    exp:      S.Number,
    provider: S.String,
    state:    S.String,
    verifier: S.optional(S.String),
}));

const Interval = S.transform(
    S.Struct({ start: S.DateTimeUtc, end: S.DateTimeUtc }),
    S.Struct({ start: S.DateTimeUtc, end: S.DateTimeUtc, durationMs: S.Number }),
    {
        strict: true,
        decode: ({ start, end }) => ({
            start, end,
            durationMs: DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start),
        }),
        encode: ({ start, end }) => ({ start, end }),
    },
);

class Metric extends S.Class<Metric>('Metric')({
    name:       S.NonEmptyTrimmedString,
    value:      S.Number,
    unit:       S.Literal('ms', 'bytes', 'count'),
    recordedAt: S.DateTimeUtc,
}) {}

const TimestampedMetric = Metric.pipe(S.attachPropertySignature('version', 1 as const),);

// Data.struct: ad-hoc structural equality for records without a full Schema class
const point =       Data.struct({ x: 1, y: 2 });
Equal.equals(point, Data.struct({ x: 1, y: 2 })); // true — structural, not reference
// Use HashSet.make(point, ...) for deduplication of ad-hoc values
```

---
## Immutable Collections

Schema classes implement `Hash` and `Equal` automatically -- `HashMap` and `HashSet` provide O(1) immutable lookups on schema-typed values. Use `HashMap` for indexed access by key. Use `HashSet` for membership testing and set algebra.

```typescript
import { HashMap, HashSet, Schema as S } from 'effect';

// HashMap: indexed lookup by branded key
const userIndex = HashMap.fromIterable(users.map((user) => [user.id, user] as const),);
const lookup =    HashMap.get(userIndex, userId); // Option<User>
const updated =   HashMap.modify(userIndex, userId, (user) => ({ ...user, tier: 'pro' }));

// HashSet: membership + set algebra on schema types
const activePerms = HashSet.fromIterable(permissions);
const required =    HashSet.make(Permission.Read(), Permission.Write());
const hasAll =      HashSet.isSubset(required, activePerms);
const revoked =     HashSet.difference(activePerms, required);
```

---
## Quick Reference

| [INDEX] | [SCHEMA_FAMILY]                 | [WHEN]                                  | [KEY_TRAIT]                                               |
| :-----: | ------------------------------- | --------------------------------------- | --------------------------------------------------------- |
|   [1]   | **`S.Class`**                   | Plain data without discriminant         | Static factory, no `_tag`                                 |
|   [2]   | **`S.TaggedClass`**             | Discriminated union member              | `_tag` auto-injected, `pick`/`omit`/`partial` projections |
|   [3]   | **`S.TaggedRequest`**           | Request/response contract               | `failure`/`payload`/`success` + `PrimaryKey.symbol`       |
|   [4]   | **`S.suspend`**                 | Recursive or mutually recursive schemas | Breaks circular reference via thunk                       |
|   [5]   | **`S.transform`**               | Bidirectional codec                     | Computed fields in decode, stripped in encode             |
|   [6]   | **`S.parseJson`**               | JSON string to typed struct             | Single-step decode from serialized form                   |
|   [7]   | **`S.attachPropertySignature`** | Discriminant injection                  | Adds field without modifying base schema                  |
|   [8]   | **`S.brand`**                   | Nominal type refinement                 | Pipeline: `S.String.pipe(S.pattern, S.brand)`             |
|   [9]   | **`HashMap.fromIterable`**      | Indexed lookup by key                   | O(1) get/set, immutable, Hash+Equal                       |
|  [10]   | **`HashSet.fromIterable`**      | Membership testing, set algebra         | O(1) has, union/intersection/difference                   |
|  [11]   | **`Data.struct`**               | Ad-hoc structural equality              | Auto Hash+Equal without Schema class                      |
|  [12]   | **`Array.groupBy/dedupe`**      | Functional array transforms             | Replaces imperative loops                                 |
