# [H1][OBJECTS]
>**Dictum:** *Schema is single source of truth: class, brand, codec, projection derive from one declaration.*

<br>

Every data definition starts as a schema. Prefer schema classes for durable domain objects (Hash/Equal, codecs, projections). Derive projections with `pick`/`omit`/`partial` from the canonical schema. Use `S.transform` when you genuinely have **two** representations (wire vs domain) and need a bidirectional codec.

Error schemas live in `errors.md`. Type organization and narrowing live in `types.md`.

---
## S.Class

`S.Class` is plain data (no `_tag`). It is appropriate for records that do not participate in discriminated unions.

```typescript
import { HashMap, Option, Schema as S } from 'effect';

class RequestContext extends S.Class<RequestContext>('app/RequestContext')({
    ipAddress: S.optional(S.String),
    requestId: S.String,
    tenantId:  S.String,
    userId:    S.optional(S.String),
}) {static readonly ip = (ctx: RequestContext) => Option.fromNullable(ctx.ipAddress);}

// Hash + Equal are derived automatically — HashMap/HashSet ready
const byRequestId = HashMap.fromIterable([[ 'r1', new RequestContext({ requestId: 'r1', tenantId: 't1' }) ]] as const);
```

*Rule:* define exactly one canonical schema for the object; lift “internal convenience” into functions (e.g. `Option.fromNullable`) instead of parallel structs.

---
## S.TaggedClass + Projections

`S.TaggedClass` auto-injects `_tag` for union membership. Derive projections from the same declaration.

```typescript
import { Array, Schema as S } from 'effect';

const LineItemId = S.UUID.pipe(S.brand('LineItemId'));

class LineItem extends S.TaggedClass<LineItem>()('LineItem', {
    id:        LineItemId,
    sku:       S.NonEmptyTrimmedString,
    quantity:  S.Int.pipe(S.positive(), S.brand('Quantity')),
    currency:  S.Literal('USD', 'EUR', 'GBP'),
    unitPrice: S.Positive,
}) {}

const projection = {
    create:  LineItem.pipe(S.omit('_tag')),
    patch:   LineItem.pipe(S.pick('quantity', 'unitPrice'), S.partial),
    summary: LineItem.pipe(S.pick('sku', 'quantity')),
} as const;
const unique =     Array.dedupe(items);
const byCurrency = Array.groupBy(items, (item) => item.currency);
```

---
## Recursive Unions

Break cycles with `S.suspend`. The union type is written inline (no module-level aliases).

```typescript
import { Schema as S } from 'effect';

const NodeId = S.UUID.pipe(S.brand('NodeId'));

class Leaf extends S.TaggedClass<Leaf>()('Leaf', {
    id: NodeId,
    label: S.NonEmptyTrimmedString,
    weight: S.Positive,
}) {}
class Branch extends S.TaggedClass<Branch>()('Branch', {
    id: NodeId,
    label: S.NonEmptyTrimmedString,
    children: S.Array(S.suspend((): S.Schema<Leaf | Branch> => Tree)),
}) {}

const Tree: S.Schema<Leaf | Branch> = S.Union(Leaf, Branch);
```

---
## S.TaggedRequest + PrimaryKey

`failure`, `payload`, `success` define the full type signature. `PrimaryKey.symbol` yields deterministic cache keys.

```typescript
import { PrimaryKey, Schema as S } from 'effect';

class CacheKey extends S.TaggedRequest<CacheKey>()('CacheKey', {
    failure: ServiceError,
    payload: { id: S.String, scope: S.String, tenantId: S.String },
    success: S.Unknown,
}) {[PrimaryKey.symbol]() { return `${this.scope}:${this.tenantId}:${this.id}`; }}
```

---
## Codecs and Transforms

Use branded pipelines for validation + nominal typing. Use `S.transform` for computed/derived fields with explicit encode/decode.

```typescript
import { DateTime, Schema as S } from 'effect';

const Email = S.Trimmed.pipe(
    S.pattern(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
    S.brand('Email'),
);
const Interval = S.transform(
    S.Struct({ start: S.DateTimeUtc, end: S.DateTimeUtc }),
    S.Struct({ start: S.DateTimeUtc, end: S.DateTimeUtc, durationMs: S.Number }),
    {
        strict: true,
        decode: ({ start, end }) => ({
            start,
            end,
            durationMs: DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start),
        }),
        encode: ({ start, end }) => ({ start, end }),
    },
);
```

---
## Rules
- One canonical schema per object; derive projections via `pick`/`omit`/`partial`.
- Use `S.TaggedClass` for unions, `S.Class` otherwise.
- Use `S.suspend` for recursion.
- Use `S.transform` only when you truly have multiple representations.

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
|  [11]   | **`Array.groupBy/dedupe`**      | Functional array transforms             | Replaces imperative loops                                 |
