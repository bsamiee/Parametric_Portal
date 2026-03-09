# Objects

## Schema selection

**Zero `S.Struct` in domain code.** Every domain concept uses `S.Class` or `Model.Class` — never a bare `S.Struct` declaration at module level. `S.Struct` is permitted only inside `S.transform` (as from/to schemas) and inside `S.Class`/`Model.Class` field definitions where it is structurally required.

| Context            | Use                                                    | Never                        |
| ------------------ | ------------------------------------------------------ | ---------------------------- |
| Domain entity      | `Model.Class` with field modifiers                     | `S.Struct` + separate type   |
| Value object       | `S.Class` with computed getters                        | `S.Struct` + manual parse    |
| Wire codec         | `S.transform(S.Struct({...}), S.Struct({...}), {...})` | standalone `S.Struct` export |
| Inline field shape | `S.Struct({...})` as field value                       | —                            |

Derive all projections from the class: `Task.pipe(S.pick("a", "b"))`, `Task.pipe(S.omit("c"))`, `S.partialWith(Task, { exact: true })`. Never declare parallel `TaskInsert`/`TaskUpdate`/`TaskSelect` structs.

Branded primitives are inline field modifiers: `S.String.pipe(S.brand("TenantId"))` inside the owning class field — never standalone module-level branded type exports.

## Class Authority and Private Integration

A class absorbs its behavioral surface — vocabulary-driven getters, cross-field invariants, transform projections — so the module exports ONE class. `_`-prefixed vocabularies and projections are implementation substrate consumers never touch.

```ts
import { Duration, Schema as S } from "effect"

const _Protocol = {
  h2:   { secure: true,  multiplex: true,  upgrade: false },
  h2c:  { secure: false, multiplex: true,  upgrade: true  },
  http: { secure: false, multiplex: false, upgrade: false },
} as const satisfies Record<string, { secure: boolean; multiplex: boolean; upgrade: boolean }>

class Target extends S.Class<Target>("Target")(S.Struct({
  host:     S.NonEmptyString,
  port:     S.Number.pipe(S.int(), S.between(1, 65535)),
  protocol: S.Literal(...Object.keys(_Protocol) as [keyof typeof _Protocol, ...(keyof typeof _Protocol)[]]),
  weight:   S.Number.pipe(S.between(0, 1)),
  zone:     S.NonEmptyString,
  drain:    S.optionalWith(S.Boolean, { default: () => false }),
}).pipe(S.filter(({ host, zone }) => host !== zone || "host and zone must differ"))) {
  get transport() { return _Protocol[this.protocol] }
  get secure()    { return this.transport.secure }
  get multiplex() { return this.transport.multiplex }
  get active()    { return !this.drain && this.weight > 0 }
  // polymorphic projection — one static method replaces N exported decoders
  static readonly as = <K extends keyof typeof _Projections>(variant: K) =>
    S.decodeUnknown(_Projections[variant]) as unknown as
      (input: unknown) => import("effect/Effect").Effect<S.Schema.Type<(typeof _Projections)[K]>, S.ParseError, never>
}

const _Projections = {
  route:   Target.pipe(S.omit(), S.pick("host", "port", "protocol", "weight")),
  summary: Target.pipe(S.omit(), S.pick("host", "protocol", "drain")),
  patch:   Target.pipe(S.omit(), S.omit("host", "zone"), S.partialWith({ exact: true })),
} satisfies Record<string, S.Schema<any, any, never>>
```

**Why this compresses:** `_Protocol` is private substrate — consumers call `target.secure`, never `_Protocol.h2.secure`. `_Projections` is private substrate — consumers call `Target.as("route")(input)`, never import a projection map. The module exports `Target` and nothing else. Adding a protocol requires one `_Protocol` entry; `S.Literal` spread, getters, and cross-field filter derive automatically. Adding a projection requires one `_Projections` entry; `Target.as` derives automatically via `keyof typeof`.

**Authority contracts:**
- `S.Struct({...}).pipe(S.filter(...))` co-locates cross-field invariants with authority, enforcing at decode before Class instantiation. `Target.pipe(S.omit())` crosses Class → TypeLiteral, stripping nominal identity + struct-level filter + computed getters — an irreversible projection.
- Computed getters compose multiple private-vocabulary axes into derived semantics (`active` = `!drain && weight > 0`). No conditional logic — property lookup resolves every axis.
- `S.partialWith({ exact: true })` on `patch` suppresses `| undefined` from optional field types — PATCH payloads cannot nullify fields under `exactOptionalPropertyTypes`. `S.partial()` before `S.omit()` or directly on a Class throws at runtime.
- `satisfies Record<string, S.Schema<any, any, never>>` gates the context channel — no variant may carry `R ≠ never`. `S.omit("host", "zone")` fails at compile time when either field is absent from `Target`, propagating anchor renames as simultaneous failures across all projection sites.


## Model Authority and Modifier Stacking

`Model.Class` field modifiers compose conjunctively — each narrows variant membership. The 6 typed projections (`.fields`, `.insert`, `.update`, `.select`, `.json`, `.jsonCreate`) derive automatically. One model replaces what would otherwise be 4–6 parallel struct declarations.

```ts
import { Model, SqlClient, SqlSchema } from "@effect/sql"
import { Array as A, Data, Effect, Option, Schema as S } from "effect"

class Entity extends Model.Class<Entity>("Entity")({
  id:        Model.Generated(Model.GeneratedByApp(S.UUID)),
  tenantId:  Model.FieldExcept("update", "jsonUpdate")(S.String.pipe(S.brand("TenantId"))),
  name:      S.NonEmptyTrimmedString,
  payload:   S.optionalWith(S.Unknown, { as: "Option" }),
  status:    S.Literal("active", "archived", "purging"),
  createdAt: Model.DateTimeInsertFromDate,
  updatedAt: Model.DateTimeUpdateFromDate,
}) {
  // why: polymorphic repository — one static method replaces exported repo factory + finder + inserter + updater
  static readonly repo = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const _predicate = (filters: { status?: typeof Entity.fields.status.Type; tenantId?: typeof Entity.fields.tenantId.Type }) =>
      A.match(A.getSomes([
        Option.fromNullable(filters.status).pipe(Option.map((v) => sql`status = ${v}`)),
        Option.fromNullable(filters.tenantId).pipe(Option.map((v) => sql`tenant_id = ${v}`)),
      ]), { onEmpty: () => sql`TRUE`, onNonEmpty: (ps) => sql.and(ps) })
    const _insert = SqlSchema.single({
      Request: Entity.insert, Result: Entity,
      execute: (r) => sql`INSERT INTO entity ${sql.insert(r)} RETURNING *`,
    })
    const _upsert = (id: typeof Entity.fields.id.Type, data: typeof Entity.update.Type, occ: Date) =>
      sql`UPDATE entity SET ${sql.update(data)}, updated_at = NOW()
          WHERE id = ${id} AND updated_at = ${occ} RETURNING *`.pipe(
        Effect.flatMap((rows) => Option.match(A.head(Array.from(rows)), {
          onNone: () => Effect.fail(new _RepoFault({ reason: "stale" })),
          onSome: Effect.succeed,
        })))
    const _query = (filters: Parameters<typeof _predicate>[0], limit: number, cursor?: string) =>
      sql`SELECT * FROM entity WHERE ${_predicate(filters)}
          ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`.pipe(
        Effect.map((rows) => ({
          items: rows.slice(0, limit),
          hasNext: rows.length > limit,
        })))
    // why: one polymorphic entrypoint discriminates on input shape
    return {
      run: Object.assign(
        (filters: Parameters<typeof _predicate>[0], limit: number, cursor?: string) => _query(filters, limit, cursor),
        { insert: _insert, upsert: _upsert },
      ),
    } as const
  })
}

class _RepoFault extends Data.TaggedError("RepoFault")<{ readonly reason: "not_found" | "stale" }> {}
```

**Why this compresses:** The module exports `Entity`. The repository is `Entity.repo` — a static `Effect.gen` that yields `SqlClient`, defines `_predicate`, `_insert`, `_upsert`, `_query` as closures, and returns a single `run` surface with `.insert`/`.upsert` attached. Consumers call `Entity.repo` and get one object. `_RepoFault` is `_`-private — it appears in error channels but consumers `catchTag` on the tag, never import the class.

**Modifier stacking contracts:**
- `Model.Generated(Model.GeneratedByApp(S.UUID))` — app-generated ID: present in `insert`, absent from `update`. `Model.Generated(S.UUID)` would mean DB-generated (absent from `insert` too).
- `Model.FieldExcept("update", "jsonUpdate")` — tenantId immutable after creation: present in `insert` and `select`, absent from `update` and `jsonUpdate`.
- `S.optionalWith(S.Unknown, { as: "Option" })` — nullable DB column surfaces as `Option<unknown>` in TypeScript. `Option.none()` = SQL NULL.
- `Model.DateTimeInsertFromDate` — `Date` on insert, `DateTime.Utc` in domain; `Model.DateTimeUpdateFromDate` — auto-set on mutation.
- Modifiers compose conjunctively: `Generated ∩ FieldExcept("update")` means the field appears ONLY in `select` and `json`.


## Transform Codec Chains

Bidirectional transforms preserve decode/encode round-trip fidelity while projecting between transport and domain representations. `S.transform` requires an explicit target schema — the transform IS the projection, not a post-processing step.

```ts
import { Schema as S } from "effect"

const _Encoding = {
  gzip: { id: 1, streamable: true  },
  zstd: { id: 2, streamable: true  },
  none: { id: 0, streamable: false },
} as const satisfies Record<string, { id: number; streamable: boolean }>

const _EncodingId = Object.fromEntries(Object.entries(_Encoding).map(([k, v]) => [v.id, k])) as
  Record<number, keyof typeof _Encoding>

const Envelope = S.transform(
  S.Struct({
    payload:    S.Uint8ArrayFromBase64,
    encodingId: S.Number.pipe(S.int(), S.between(0, 2)),
    version:    S.Number.pipe(S.int(), S.positive()),
  }),
  S.Struct({
    payload:    S.Uint8ArrayFromSelf,
    encoding:   S.Literal("gzip", "zstd", "none"),
    version:    S.Number.pipe(S.int(), S.positive()),
    streamable: S.Boolean,
  }),
  {
    decode: ({ payload, encodingId, version }) => ({
      payload, version,
      encoding:   _EncodingId[encodingId] ?? ("none" as const),
      streamable: (_Encoding[_EncodingId[encodingId] ?? "none"]).streamable,
    }),
    encode: ({ payload, encoding, version }) => ({
      payload, version, encodingId: _Encoding[encoding].id,
    }),
  },
)
```

**Why this compresses:** `_Encoding` is the bijection authority — `id` for wire format, `key` for domain. `_EncodingId` is the reverse lookup, also private. `Envelope` is the only export — decode inflates wire `encodingId` to domain `encoding` + `streamable`, encode deflates back. No separate "parser" or "serializer" functions. The vocabulary drives both directions; adding an encoding requires one `_Encoding` entry.

**Transform contracts:**
- `S.Uint8ArrayFromBase64` on decode side, `S.Uint8ArrayFromSelf` on domain side — Schema handles the base64 layer, transform handles the encoding-id-to-name layer. Layers compose, each handling one concern.
- `encode` drops `streamable` — it's derived, not stored. The round-trip is `wire → decode → domain → encode → wire`, where derived fields appear in domain but not wire. This is intentional asymmetry.
- The target struct schema (`S.Struct({...})`) is explicit — TypeScript infers the domain type from it. No separate `type Envelope = ...` declaration.
