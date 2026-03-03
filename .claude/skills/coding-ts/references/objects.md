# Objects

## Schema Authority and Channel Triples

Projection from `Schema.Class` to TypeLiteral is irreversible — it strips nominal identity, the struct-level filter, and computed behavior — so any schema not co-derived from the same anchor drifts structurally under refactor. The `R` channel accumulates transitively: any stage carrying context requirements propagates them to every downstream consumer.

```ts
import { Schema as S } from "effect"

const protocols = {
  h2: { secure: true, multiplex: true }, h2c: { secure: false, multiplex: true }, http1: { secure: false, multiplex: false },
} as const satisfies Record<string, { secure: boolean; multiplex: boolean }>

class Target extends S.Class<Target>("Target")(S.Struct({
  host:     S.NonEmptyString,
  port:     S.Number.pipe(S.int(), S.between(1, 65535)),
  protocol: S.Literal("h2", "h2c", "http1"),
  weight:   S.Number.pipe(S.between(0, 1)),
  zone:     S.NonEmptyString,
  drain:    S.optionalWith(S.Boolean, { default: () => false }),
}).pipe(S.filter(({ host, zone }) => host !== zone || "host and zone must differ"))) {
  get secure()    { return protocols[this.protocol].secure }
  get multiplex() { return protocols[this.protocol].multiplex }
}

const TransportRoute = Target.pipe(
  S.omit(),
  S.pick("host", "port", "protocol", "weight"),
  S.filter(({ weight }) => weight > 0 || "zero-weight excluded"),
  S.transform(
    Target.pipe(S.omit(), S.pick("host", "port", "weight"), S.extend(S.Struct({ secure: S.Boolean, multiplex: S.Boolean }))),
    {
      decode: ({ host, port, protocol, weight }) => ({
        host, port, weight, ...protocols[protocol],
      }),
      encode: ({ host, port, secure, multiplex, weight }) => ({
        host, port, weight,
        protocol: (secure ? "h2" : multiplex ? "h2c" : "http1") as "h2" | "h2c" | "http1",
      }),
    },
  ),
)

const TransportDecoded = S.typeSchema(TransportRoute)
const TransportEncoded = S.encodedSchema(TransportRoute)
const TransportBound   = S.encodedBoundSchema(TransportRoute)
```

**Authority contracts:**
- `protocols` is the bijection authority — `as const` preserves literal narrowing for keyed lookup while `satisfies Record<...>` catches shape errors without widening; getters derive via property lookup, decode via spread, encode via ternary. The `as "h2" | "h2c" | "http1"` cast on encode is irreducible: TypeScript cannot prove a ternary over boolean inputs produces a literal union — correctness rests on `protocols`' exhaustive coverage of the 3 valid `(secure, multiplex)` coordinates.
- `S.Struct({...}).pipe(S.filter(...))` co-locates the cross-field invariant (`host !== zone`) with authority, enforcing it at decode before Class instantiation. `Target.pipe(S.omit())` crosses Transformation → TypeLiteral, stripping the struct-level filter, nominal identity, and computed getters. The transform target re-uses the anchor via `S.omit()/S.pick()/S.extend()`, merging `(host, port, weight)` with transport-specific `(secure, multiplex)` into a single TypeLiteral.
- `S.typeSchema` → `Schema<A, A, never>`, `S.encodedSchema` → `Schema<I, I, never>`, `S.encodedBoundSchema` → `Schema<I, I, never>` (refinements preserved through the first transform). The distinction is load-bearing: `TransportEncoded` accepts `weight: 0` (filter erased), `TransportBound` rejects it (`S.filter` precedes the transform and survives `encodedBoundSchema`). `transformOrFail` at any stage introduces `R ≠ never`, propagating context requirements to every downstream consumer.

## Protocol Projection and Drift Gates

Schema variants as independent declarations carry no type-level coupling to each other or to the anchor — a field rename at the canonical shape requires N manual updates, each typechecking in isolation while silently misrepresenting the shared contract. Keyed derivation collapses N maintenance surfaces into one: projection combinators referencing renamed fields fail simultaneously across the full variant set, and `keyof typeof` on the map IS the discriminant union.

```ts
import { Effect, Schema as S } from "effect"

class CollectorSink extends S.Class<CollectorSink>("CollectorSink")(S.Struct({
  id:          S.UUID,
  name:        S.NonEmptyString,
  endpoint:    S.NonEmptyString,
  protocol:    S.Literal("otlp/grpc", "otlp/http", "prometheus"),
  compression: S.Literal("gzip", "zstd", "none"),
  batchSize:   S.Number.pipe(S.int(), S.between(1, 10_000)),
  flushMs:     S.Number.pipe(S.int(), S.between(100, 60_000)),
  authType:    S.Literal("bearer", "mtls", "none"),
  credential:  S.NonEmptyString,
  labels:      S.Record({ key: S.NonEmptyString, value: S.NonEmptyString }),
  draining:    S.optionalWith(S.Boolean, { default: () => false }),
}).pipe(S.filter(({ protocol, compression, authType, batchSize, flushMs }) =>
  (protocol !== "prometheus" || (compression === "none" && authType === "none")) && batchSize * flushMs <= 600_000 ||
  "prometheus: compression and auth must be none; batchSize × flushMs exceeds budget"
))) {}

const SinkVariants = {
  full:    CollectorSink.pipe(S.omit()),
  write:   CollectorSink.pipe(S.omit("id", "draining")),
  patch:   CollectorSink.pipe(S.omit("id", "draining"), S.partialWith({ exact: true })),
  summary: CollectorSink.pipe(S.pick("id", "name", "protocol", "endpoint", "draining")),
} satisfies Record<string, S.Schema<any, any, never>>

const decodeSink = <K extends keyof typeof SinkVariants>(key: K) =>
  // Double assertion required: TS collapses SinkVariants[key] to union type at call site
  S.decodeUnknown(SinkVariants[key]) as unknown as
    (input: unknown) => Effect.Effect<S.Schema.Type<(typeof SinkVariants)[K]>, S.ParseError, never>
```

- `SinkVariants` is a keyed record, not N named consts; `keyof typeof SinkVariants` IS the discriminant. `CollectorSink.pipe(S.omit())` crosses Class → TypeLiteral via `SurrogateAnnotation`, stripping the compound cross-field filter; `CollectorSink` remains the authoritative decode point for the full invariant set. `S.partialWith({ exact: true })` on `patch` suppresses `| undefined` from optional field types — PATCH payloads cannot nullify fields under `exactOptionalPropertyTypes`. `S.partial()` or `S.partialWith()` before `S.omit()`, or directly on a Class, throws at runtime (FinalTransformation path in the AST is rejected).
- `satisfies Record<string, S.Schema<any, any, never>>` gates the context channel — no variant may carry `R ≠ never` — while `S.omit("draining")` fails to compile when `draining` is absent from `CollectorSink`, propagating any anchor rename as N simultaneous failures at variant sites. `decodeSink<K>` infers the variant-specific `A`-channel from `(typeof SinkVariants)[K]` via the explicit return-type annotation; TypeScript collapses `SinkVariants[key]` to the value-type union at the call expression, requiring `as unknown as` to internalize the mismatch without leaking it to consumers.
