# [H1][TYPES]
>**Dictum:** *Type power is achieved by compressing authority, not by multiplying declarations.*

<br>

This reference targets proof-grade type practice: inference firebreaks, protocol drift algebra, nominal rail preservation, and `A/E/R` channel control. Runtime schema is used only at true ingress/egress boundaries; everywhere else, value-driven inference and compile-time law gates own correctness.

---
## [1][SCHEMA_AUTHORITY_PARSE_POLICY]
>**Dictum:** *Schema authority is valid only when stage order, channel mapping, and recovery policy are one deterministic identity.*

<br>

- **ALWAYS** keep `Type/Encoded/Context` coupled to one schema identity.
- **ALWAYS** encode stage order as a compile-time witness, not prose.
- **NEVER** silently recover parse failures into valid domain values.

```ts
import { Effect, Match, ParseResult } from "effect";
import type * as ParseResultTypes from "effect/ParseResult";
import * as Schema from "effect/Schema";

// --- [CONSTANTS] -------------------------------------------------------------

const parseStages =             ["asymmetry", "invariant", "transform", "policy"] as const;
const parseStageProof: readonly ["asymmetry", "invariant", "transform", "policy"] = parseStages;

// --- [SCHEMA] ----------------------------------------------------------------

const LocaleCode =    Schema.String.pipe(Schema.pattern(/^[a-z]{2}-[A-Z]{2}$/), Schema.brand("LocaleCode"));
const ResourcePatch = Schema.transformOrFail(
  Schema.Struct({
    display_name:  Schema.NonEmptyTrimmedString,
    locale:        Schema.String,
    expires_at_ms: Schema.optional(Schema.NumberFromString),
  }),
  Schema.Struct({
    displayName: Schema.NonEmptyTrimmedString,
    locale:      LocaleCode,
    expiresAtMs: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  }),
  {
    strict: true,
    decode: ({ display_name, locale, expires_at_ms }, _options, ast) =>
      Match.value(locale.trim()).pipe(
        Match.when(
          (candidate) => /^[a-z]{2}-[A-Z]{2}$/.test(candidate),
          (candidate) => Schema.decodeUnknown(LocaleCode)(candidate).pipe(
            Effect.map((decodedLocale) => ({
              displayName: display_name,
              locale:      decodedLocale,
              expiresAtMs: expires_at_ms,
            })),
          ),
        ),
        Match.orElse(() => Effect.fail(new ParseResult.Type(ast, locale, "locale.invalid"))),
      ),
    encode: ({ displayName, locale, expiresAtMs }) =>
      Effect.succeed({ display_name: displayName, locale, expires_at_ms: expiresAtMs }),
  },
);

// --- [FUNCTIONS] -------------------------------------------------------------

type ResourcePatchEncoded = Schema.Schema.Encoded<typeof ResourcePatch>;
const parseWithPolicy = <const Policy extends {
  readonly onDecodeError: (
    error: ParseResultTypes.ParseError,
    encoded: NoInfer<ResourcePatchEncoded>,
  ) => ParseResultTypes.ParseError;
}>(policy: Policy) =>
  (input: ResourcePatchEncoded) =>
    Schema.decodeUnknown(ResourcePatch)(input).pipe(
      Effect.mapError((error) => policy.onDecodeError(error, input)),
    );
const strictPolicy = parseWithPolicy({ onDecodeError: (error) => error });

// --- [SAMPLES] ---------------------------------------------------------------

const resourcePatchEncoded = {
  display_name:  "Portal",
  locale:        "en-US",
  expires_at_ms: "4102444800000",
} as const satisfies Schema.Schema.Encoded<typeof ResourcePatch>;
const resourcePatchDecoded = {
  displayName: "Portal",
  locale:      "en-US" as Schema.Schema.Type<typeof LocaleCode>,
  expiresAtMs: 4_102_444_800_000,
} as const satisfies Schema.Schema.Type<typeof ResourcePatch>;
```

---
## [2][NOMINAL_BOUNDARY_TYPES]
>**Dictum:** *Nominal rails are meaningful only when parse creates identity, composition keeps identity, and transport unwraps last.*

<br>

- **ALWAYS** parse unknown identifiers into branded values before composition.
- **ALWAYS** prove adjacent brands are non-interchangeable with negative compile gates.
- **NEVER** unwrap branded values before the explicit transport edge.

```ts
import * as HttpApiSchema from "@effect/platform/HttpApiSchema";
import { Brand, Either, Effect, pipe } from "effect";
import * as Schema from "effect/Schema";

// --- [SCHEMA] ----------------------------------------------------------------

const defineId = <const Name extends string>(name: Name) => Schema.UUID.pipe(Schema.brand(`${name}Id` as const));
const EntityId = defineId("Entity");
const ScopeId =  defineId("Scope");
const EntityPathParam = HttpApiSchema.param("entity_id", EntityId);

// --- [CONSTANTS] -------------------------------------------------------------

const entityPathEncoded = "00000000-0000-4000-8000-000000000001" as const satisfies Schema.Schema.Encoded<typeof EntityPathParam>;
declare const scopeId: Schema.Schema.Type<typeof ScopeId>;

// --- [FUNCTIONS] -------------------------------------------------------------

const toBoundary = {
  entity: (id: Schema.Schema.Type<typeof EntityId>) => ({ kind: "entity", id } as const),
  scope:  (id: Schema.Schema.Type<typeof ScopeId>) =>  ({ kind: "scope",  id } as const),
} as const satisfies {
  readonly entity: (id: Schema.Schema.Type<typeof EntityId>) => { readonly kind: "entity"; readonly id: Schema.Schema.Type<typeof EntityId> };
  readonly scope:  (id: Schema.Schema.Type<typeof ScopeId>) =>  { readonly kind: "scope";  readonly id: Schema.Schema.Type<typeof ScopeId>  };
};
const toTransport = {
  entity: ({ id }: ReturnType<typeof toBoundary.entity>) => ({ kind: "entity", id: Brand.unbranded(id) } as const),
  scope:  ({ id }: ReturnType<typeof toBoundary.scope>) =>  ({ kind: "scope",  id: Brand.unbranded(id) } as const),
} as const;
const acceptsEntity = (_id: Schema.Schema.Type<typeof EntityId>) => Effect.void;

// --- [SAMPLES] ---------------------------------------------------------------

const entityIdentity = pipe(
  entityPathEncoded,
  Schema.decodeUnknownEither(EntityId),
  Either.map(toBoundary.entity),
  Either.map(toTransport.entity),
);
const scopeIdentity = pipe(
  "00000000-0000-4000-8000-000000000002",
  Schema.decodeUnknownEither(ScopeId),
  Either.map(toBoundary.scope),
  Either.map(toTransport.scope),
);
// @ts-expect-error adjacent brands are intentionally non-interchangeable
const crossBrand = acceptsEntity(scopeId);
```

---
## [3][PROTOCOL_PROJECTION_REGRESSION_GATES]
>**Dictum:** *Protocol surfaces must be projected from constructors once, then guarded by structural drift proofs.*

<br>

- **ALWAYS** derive payload/success/error from protocol constructors.
- **ALWAYS** assert projection equality and enforce negative drift gates.
- **NEVER** maintain detached DTO aliases for protocol edges.

```ts
import * as Model from "@effect/sql/Model";
import * as Rpc from "@effect/rpc/Rpc";
import { Chunk, DateTime } from "effect";
import * as Schema from "effect/Schema";

// --- [TYPES] -----------------------------------------------------------------

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// --- [CLASSES] ---------------------------------------------------------------

class ResourceRecord extends Model.Class<ResourceRecord>("TypesResourceRecord")({
  id:       Model.Generated(Schema.UUID),
  scopeId:  Schema.UUID,
  amount:   Schema.Number,
  readings: Schema.Chunk(Schema.Struct({ key: Schema.String, delta: Schema.BigIntFromSelf, at: Schema.DateTimeUtcFromNumber }),),
}) {}

// --- [SCHEMA] ----------------------------------------------------------------

const ResourceRejected = Schema.Struct({ _tag: Schema.Literal("ResourceRejected"), reason: Schema.String });
const UpsertResource = Rpc.make("resource.upsert", {
  payload: ResourceRecord.jsonCreate,
  success: ResourceRecord.json,
  error: ResourceRejected,
});

// --- [LAW_GATES] -------------------------------------------------------------

type PayloadLaw = Assert<Equal<Rpc.Payload<typeof UpsertResource>, Schema.Schema.Type<typeof ResourceRecord.jsonCreate>>>;
type SuccessLaw = Assert<Equal<Rpc.Success<typeof UpsertResource>, Schema.Schema.Type<typeof ResourceRecord.json>>>;
type ErrorLaw =   Assert<Equal<Rpc.Error  <typeof UpsertResource>, Schema.Schema.Type<typeof ResourceRejected>>>;

// --- [SAMPLES] ---------------------------------------------------------------

const payloadOk = {
  scopeId:  "00000000-0000-4000-8000-000000000003",
  amount:   12,
  readings: Chunk.of({ key: "cpu", delta: 1n, at: DateTime.unsafeNow() }),
} as const satisfies Rpc.Payload<typeof UpsertResource>;
const successOk = {
  id: "00000000-0000-4000-8000-000000000004",
  ...payloadOk,
} as const satisfies Rpc.Success<typeof UpsertResource>;
const errorOk = {
  _tag:    "ResourceRejected",
  reason:  "duplicate",
} as const satisfies Rpc.Error<typeof UpsertResource>;

// --- [DRIFT_GATES] -----------------------------------------------------------

// @ts-expect-error amount is required by payload projection
const payloadMissing: Rpc.Payload<typeof UpsertResource> = { scopeId: payloadOk.scopeId, readings: payloadOk.readings };
// @ts-expect-error extra key is forbidden by payload projection
const payloadExtra: Rpc.Payload<typeof UpsertResource> = { ...payloadOk, extra: "drift" };
// @ts-expect-error tag drift must fail against error projection
const errorTagDrift: Rpc.Error<typeof UpsertResource> = { _tag: "Rejected", reason: "duplicate" };
```

---
## [4][INLINED_HARDENING_NARROWING_INFERENCE_LOCKS]
>**Dictum:** *Inline hardening wins when discriminants, defaults, exactness, and metadata all preserve literal authority under inference pressure.*

<br>

- **ALWAYS** keep hardening and narrowing inline at definition sites.
- **ALWAYS** combine `const` generics + `NoInfer` + mapped `satisfies` for anti-widening control.
- **NEVER** offload inference-critical constraints to detached helper types.

```ts
import { Effect, Match } from "effect";

// --- [TYPES] -----------------------------------------------------------------

type Command = ReturnType<(typeof command)[keyof typeof command]>;

// --- [CONSTANTS] -------------------------------------------------------------

const routeMetaKey: unique symbol = Symbol("route");
const command = {
  append: (id: string, amount: number) => ({ _tag: "Append", id, amount } as const),
  revoke: (id: string, reason: "manual" | "retention") => ({ _tag: "Revoke", id, reason } as const),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const handlers = {
  Append: (input: Extract<Command, { readonly _tag: "Append" }>) => Effect.succeed({ topic: `resource.append.${input.id}` as const }),
  Revoke: (input: Extract<Command, { readonly _tag: "Revoke" }>) => Effect.succeed({ topic: `resource.revoke.${input.id}` as const }),
} satisfies {
  [C in Command as C["_tag"]]: (input: C) => Effect.Effect<{ readonly topic: `resource.${Lowercase<C["_tag"]>}.${string}` }, never, never>;
};
const dispatch = Match.type<Command>().pipe(
  Match.tag("Append", handlers.Append),
  Match.tag("Revoke", handlers.Revoke),
  Match.exhaustive,
);
const defineExact = <Shape>() => <const Value extends Shape>(value: Value & Record<Exclude<keyof Value, keyof Shape>, never>) => value;
const distributed = <T>(value: T extends unknown ? readonly T[] : never) => value;
const atomic = <T>(value: [T] extends [unknown] ? readonly T[] : never) => value;
const selectMode = <const Modes extends readonly ["read" | "write" | "admin", ...("read" | "write" | "admin")[]]>(modes: Modes, preferred: NoInfer<Modes[number]> | undefined) => ({ modes, preferred: preferred ?? modes[0] } as const);
const getRouteMeta = <const Method extends "GET" | "POST", const Path extends `/${string}`>(metadata: Record<PropertyKey, unknown> | undefined) =>
  metadata?.[routeMetaKey] as { readonly method: Method; readonly path: Path } | undefined;
const route = <const Method extends "GET" | "POST", const Path extends `/${string}`>(spec: { readonly method: Method; readonly path: Path }) =>
  <This, Args extends readonly unknown[], Return>(value: (this: This, ...args: Args) => Return, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>) =>
    context.metadata ? (context.metadata[routeMetaKey] = spec, value) : value;

// --- [SAMPLES] ---------------------------------------------------------------

const basePolicy =        defineExact<{ readonly mode: "read" | "write" | "admin"; readonly retries: number }>()({ mode: "write", retries: 3 });
const modePolicy =        selectMode(["read", "write", "admin"], basePolicy.mode);
const distributedSample = distributed<string | number>(["x"]);
const atomicSample =      atomic<string | number>([1, "x"]);
const routeDecorator =    route({ method: "GET", path: "/resource/:id" });
const routeMeta =         getRouteMeta<"GET", "/resource/:id">(undefined);
```

---
## [5][EFFECT_CHANNEL_ALGEBRA_AND_TYPESTATE_TRANSITIONS]
>**Dictum:** *Channel algebra is complete only when `R` elimination, `E` elimination, and legal transition edges are all proven in one rail.*

<br>

- **ALWAYS** prove `A/E/R` from effect values instead of manually restating rails.
- **ALWAYS** model capabilities on transition edges (`from -> to`), not state buckets.
- **NEVER** leave context or error elimination as informal assumptions.

```ts
import { Context, Data, Effect, Match } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class ExecuteError extends Data.TaggedError("ExecuteError")<{
  readonly operation: "read" | "write";
  readonly reason: "missing" | "conflict";
}> {}

// --- [SERVICES] --------------------------------------------------------------

const Reader = Context.GenericTag<{ readonly read:  (id: string) => Effect.Effect<{ readonly id: string }, ExecuteError> }>("Reader");
const Writer = Context.GenericTag<{ readonly write: (id: string) => Effect.Effect<void, ExecuteError> }>("Writer");

// --- [FUNCTIONS] -------------------------------------------------------------

const requireWriterOnly = <A, E>(fx: Effect.Effect<A, E, Context.Tag.Service<typeof Writer>>) => fx;
const requireNoContext = <A, E>(fx: Effect.Effect<A, E, never>) => fx;
const requireNoError = <A, R>(fx: Effect.Effect<A, never, R>) => fx;
const transition = <S extends EdgeState, N extends Next<S>, Owned extends readonly string[]>(from: S, to: N, owned: Owned & (HasAll<Owned, Need<S, N>> extends true ? unknown : never)) => ({ from, to, owned } as const);
const execute = (id: string) =>
  Effect.gen(function* () {
    const reader = yield* Reader;
    const writer = yield* Writer;
    const entity = yield* reader.read(id);
    yield* writer.write(entity.id);
    return entity.id;
  });

// --- [TYPES] -----------------------------------------------------------------

type ExecuteA = Effect.Effect.Success<ReturnType<typeof execute>>;
type ExecuteE = Effect.Effect.Error  <ReturnType<typeof execute>>;
type ExecuteR = Effect.Effect.Context<ReturnType<typeof execute>>;

type State = keyof typeof transitions | (typeof terminalStates)[number];
type EdgeState = keyof typeof transitions;
type Next<S extends EdgeState> = Extract<keyof (typeof transitions)[S], string>;
type Need<S extends EdgeState, N extends Next<S>> = (typeof transitions)[S][N] extends readonly string[] ? (typeof transitions)[S][N][number] : never;
type HasAll<Owned extends readonly string[], Needed extends string> = Exclude<Needed, Owned[number]> extends never ? true : false;

// --- [CONSTANTS] -------------------------------------------------------------

const transitions = {
  Draft:    { Reviewed:  ["write"]                         },
  Reviewed: { Published: ["approve"], Rejected: ["reject"] },
} as const satisfies {
  readonly Draft:    { readonly Reviewed:  readonly string[]                                       };
  readonly Reviewed: { readonly Published: readonly string[]; readonly Rejected: readonly string[] };
};
const terminalStates = ["Published", "Rejected"] as const;

// --- [SAMPLES] ---------------------------------------------------------------

const withReader = execute("e-1").pipe(
  Effect.provideService(Reader, {
    read: (id) => Match.value(id).pipe(Match.when("missing", () => Effect.fail(new ExecuteError({ operation: "read", reason: "missing" }))), Match.orElse(() => Effect.succeed({ id }))),
  }),
);
const withInfra = withReader.pipe(
  Effect.provideService(Writer, {
    write: (id) => Match.value(id).pipe(Match.when("blocked", () => Effect.fail(new ExecuteError({ operation: "write", reason: "conflict" }))), Match.orElse(() => Effect.void)),
  }),
);
const recovered = execute("blocked").pipe(
  Effect.provideService(Reader, {
    read: (id) => Match.value(id).pipe(Match.when("missing", () => Effect.fail(new ExecuteError({ operation: "read", reason: "missing" }))), Match.orElse(() => Effect.succeed({ id }))),
  }),
  Effect.provideService(Writer, {
    write: (id) => Match.value(id).pipe(Match.when("blocked", () => Effect.fail(new ExecuteError({ operation: "write", reason: "conflict" }))), Match.orElse(() => Effect.void)),
  }),
  Effect.catchTag("ExecuteError", () => Effect.succeed("fallback")),
);
const writerOnly = requireWriterOnly(withReader);
const noContext = requireNoContext(withInfra);
const noError = requireNoError(recovered);

const publish = transition("Reviewed", "Published", ["read", "approve"] as const);
```

---
## [6][RAIL_PRESERVATION_ACROSS_DATA_STRUCTURES]
>**Dictum:** *Boundary decode, transactional reduction, and watermark progression must preserve one typed error rail across `Chunk`, `Stream`, `STM`, and `TMap`.*

<br>

- **ALWAYS** decode boundary input from encoded shapes, not in-memory conveniences.
- **ALWAYS** keep mutation transactional until `STM.commit`.
- **NEVER** leak untyped literals across decode/time/transaction stages.

```ts
import { Chunk, Clock, Data, DateTime, Effect, Match, Option, STM, Stream, TMap, pipe } from "effect";
import * as Schema from "effect/Schema";

// --- [ERRORS] ----------------------------------------------------------------

class IngestError extends Data.TaggedError("IngestError")<{ readonly reason: "decode.invalid" | "at.invalid" | "watermark.regression" }> {}

// --- [SCHEMA] ----------------------------------------------------------------

const DeltaWire =      Schema.Struct({ key: Schema.String, delta: Schema.BigInt, atMs: Schema.Number });
const DeltaBatchWire = Schema.Chunk(DeltaWire);

// --- [FUNCTIONS] -------------------------------------------------------------

const decodeDeltaBatch = (input: unknown) =>
  Schema.decodeUnknown(DeltaBatchWire)(input).pipe(
    Effect.mapError(() => new IngestError({ reason: "decode.invalid" })),
    Effect.flatMap((batch) =>
      Effect.forEach(batch, ({ key, delta, atMs }) =>
        Option.match(DateTime.make(atMs), {
          onNone: () =>   Effect.fail(new IngestError({ reason: "at.invalid" })),
          onSome: (at) => Effect.succeed({ key, delta, atMs: DateTime.toEpochMillis(at) }),
        }),
      ),
    ),
  );

const applyDeltaBatchTx = (state: TMap.TMap<string, bigint>, batch: ReadonlyArray<{ readonly key: string; readonly delta: bigint; readonly atMs: number }>) =>
  pipe(
    batch,
    STM.forEach(
      ({ key, delta }) =>
        pipe(
          TMap.get(state, key),
          STM.map(Option.getOrElse(() => 0n)),
          STM.flatMap((current) => TMap.set(state, key, current + delta)),
        ),
      { discard: true },
    ),
    STM.flatMap(() => TMap.toHashMap(state)),
  );

const ingestDeltaWindows = (state: TMap.TMap<string, bigint>, source: Stream.Stream<unknown>) =>
  source.pipe(
    Stream.mapEffect(decodeDeltaBatch),
    Stream.groupedWithin(64, "500 millis"),
    Stream.mapEffect((window) =>
      pipe(
        window,
        STM.forEach((batch) => applyDeltaBatchTx(state, batch), { discard: true }),
        STM.flatMap(() => TMap.toHashMap(state)),
        STM.commit,
      ),
    ),
  );
const monotonicWatermark = (previous: number) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Match.value(now >= previous).pipe(
        Match.when(true, () => Effect.succeed(now)),
        Match.orElse(    () => Effect.fail(new IngestError({ reason: "watermark.regression" }))),
      ),
    ),
  );

// --- [SAMPLES] ---------------------------------------------------------------

const deltaBatchEncoded = [{ key: "cpu", delta: "1", atMs: Date.now() }] as const satisfies Schema.Schema.Encoded<typeof DeltaBatchWire>;
```
