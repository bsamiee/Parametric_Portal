# [H1][MATCHING]
>**Dictum:** *Pattern matching is the control algebra for finite domain state; exhaustive dispatch and explicit collapse keep Effect rails predictable.*

Pattern matching is the primary mechanism for branch-free control flow in this skill, so matcher form, completion operator, and boundary rail conversion must be chosen as one design unit. This reference focuses on high-leverage forms that preserve totality proofs and typed error channels under composition. If a matcher cannot prove exhaustiveness or explicit unmatched semantics, the design is incomplete.
Cross-references: `types.md`, `effects.md`, `errors.md`, `validation.md`.

---
## [1][MATCHER_FORM_AND_RETURN_CONTRACTS]
>**Dictum:** *Select matcher constructor from domain shape, then pin branch codomain with `Match.withReturnType` when widening risk is non-trivial.*

`Match.type` is for reusable total functions over a known union; `Match.value` is for immediate single-value classification inside a pipeline. Use `Match.withReturnType` when branch codomain widening is possible or public API shape must remain frozen.

```ts
import { Match, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const Command = S.Union(
  S.Struct({ _tag: S.Literal("Create"),  name: S.NonEmptyString             }),
  S.Struct({ _tag: S.Literal("Patch"),   id: S.UUID, name: S.NonEmptyString }),
  S.Struct({ _tag: S.Literal("Archive"), id: S.UUID                         }),
);

// --- [FUNCTIONS] -------------------------------------------------------------

const toAudit = Match.type<typeof Command.Type>().pipe(
  Match.withReturnType<{ readonly event: "entity.created" | "entity.patched" | "entity.archived"; readonly key: string }>(),
  Match.tagsExhaustive({
    Archive: ({ id }) =>   ({ event: "entity.archived", key: id   } as const),
    Create:  ({ name }) => ({ event: "entity.created",  key: name } as const),
    Patch:   ({ id }) =>   ({ event: "entity.patched",  key: id   } as const),
  }),
);
const modeLabel = Match.type<"preview" | "publish" | "archive">().pipe(
  Match.withReturnType<"Preview" | "Publish" | "Archive">(),
  Match.when("preview", () => "Preview"),
  Match.when("publish", () => "Publish"),
  Match.when("archive", () => "Archive"),
  Match.exhaustive,
);
```

---
## [2][EXHAUSTIVE_TAGGED_AND_DISCRIMINATOR_DISPATCH]
>**Dictum:** *Use exhaustive tag/discriminator combinators for finite dispatch; fallback-based routing is a structural defect when the domain is closed.*

Use `Match.valueTags` for immediate `_tag` value dispatch and `Match.typeTags` for reusable `_tag` classifiers; both keep closed-domain routing exhaustive. `Match.discriminatorsExhaustive` enforces total handling for non-`_tag` discriminants. `Match.discriminatorStartsWith` is the compact route for prefix families (event topics, code namespaces) without imperative prefix trees. Prefix branches must be mutually exclusive or ordered longest-prefix-first to avoid silent shadowing.

```ts
import { Match, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const Signal = S.Union(
  S.Struct({ _tag: S.Literal("join"),      roomId: S.String                     }),
  S.Struct({ _tag: S.Literal("leave"),     roomId: S.String                     }),
  S.Struct({ _tag: S.Literal("broadcast"), payload: S.Unknown, roomId: S.String }),
);

// --- [FUNCTIONS] -------------------------------------------------------------

const routeSignal = (signal: typeof Signal.Type) => Match.valueTags(signal, {
  broadcast: ({ payload, roomId }) => ({ op: "publish",     payload, roomId } as const),
  join:      ({ roomId }) =>          ({ op: "subscribe",   roomId          } as const),
  leave:     ({ roomId }) =>          ({ op: "unsubscribe", roomId          } as const),
});
const Envelope = S.Union(
  S.Struct({ kind: S.Literal("http"), status: S.Literal(200, 404, 503) }),
  S.Struct({ kind: S.Literal("nats"), subject: S.String }),
);
const routeEnvelope = Match.type<typeof Envelope.Type>().pipe(
  Match.discriminatorsExhaustive("kind")({
    http: ({ status }) => Match.value(status).pipe(
      Match.when(200, () => "http.ok" as const),
      Match.when(404, () => "http.missing" as const),
      Match.when(503, () => "http.retryable" as const),
      Match.exhaustive,
    ),
    nats: ({ subject }) => `nats.${subject}` as const,
  }),
);
const routeTopic = Match.type<{ readonly topic: `${"invoice" | "user" | "ops"}.${string}`; readonly payload: unknown }>().pipe(
  Match.discriminatorStartsWith("topic")("invoice.", () => "billing" as const),
  Match.discriminatorStartsWith("topic")("user.", () => "identity" as const),
  Match.discriminatorStartsWith("topic")("ops.", () => "operations" as const),
  Match.exhaustive,
);
```

---
## [3][PREDICATE_AND_STRUCTURAL_COMPOSITION]
>**Dictum:** *Compose predicates directly in matcher scope (`whenAnd`, `whenOr`, `not`) instead of detached boolean pre-checks or branch statements.*

Predicate composition should narrow value space and preserve structural guarantees in the same expression. `Match.not(pattern, handler)` is a first-class matcher combinator; nesting it as a `Match.when(...)` predicate is invalid.

```ts
import { Match } from "effect";

const classifyInput = Match.type<string | number | bigint | null>().pipe(
  Match.whenAnd(Match.string, Match.nonEmptyString, (value) => ({ _tag: "CommandString", value } as const)),
  Match.whenOr(Match.number, Match.bigint, (value) => ({ _tag: "NumericScalar", value } as const)),
  Match.not(null, (value) => ({ _tag: "Defined", value } as const)),
  Match.orElse(() => ({ _tag: "Nullish" } as const)),
);
const routeProtocol = Match.type<
  | { readonly channel: "http"; readonly op: "read" | "write"; readonly tenant: string }
  | { readonly channel: "ws"; readonly op: "read" | "write"; readonly tenant: string }
>().pipe(
  Match.when({ channel: "http", op: "read"  }, ({ tenant }) => ({ route: "GET /resource",        tenant } as const)),
  Match.when({ channel: "http", op: "write" }, ({ tenant }) => ({ route: "POST /resource",       tenant } as const)),
  Match.when({ channel: "ws",   op: "read"  }, ({ tenant }) => ({ route: "NATS fetch.resource",  tenant } as const)),
  Match.when({ channel: "ws",   op: "write" }, ({ tenant }) => ({ route: "NATS mutate.resource", tenant } as const)),
  Match.exhaustive,
);
```

---
## [4][COMPLETION_OPERATORS_AND_CHANNEL_COLLAPSE]
>**Dictum:** *Completion operators (`option`, `either`) make unmatched semantics explicit; collapse immediately at the nearest boundary.*

Use `Match.option` when unmatched cases represent absence and `Match.either` when unmatched input must remain observable for policy decisions. Collapsing immediately after the match keeps Option/Either scopes local and prevents rail leakage.
`Match.either` polarity is fixed: `Right` is a matched branch result, `Left` is the unmatched remainder.

```ts
import { Data, Either, Effect, Match, Option } from "effect";

// --- [CLASSES] ---------------------------------------------------------------

class RegionError extends Data.TaggedError("RegionError")<{
  readonly input:  string;
  readonly reason: "unknown";
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const resolveRegion = Match.type<string>().pipe(
  Match.when("us-east-1", () => "iad" as const),
  Match.when("eu-west-1", () => "dub" as const),
  Match.option,
);
const collapseRegion = (raw: string) => Option.match(resolveRegion(raw), {
  onNone: () => Effect.fail(new RegionError({ input: raw, reason: "unknown" })),
  onSome: (region) => Effect.succeed({ region } as const),
});
const classifyStatus = Match.type<200 | 401 | 404 | 429>().pipe(
  Match.when(401, () => ({ code: "auth",    status: 401 } as const)),
  Match.when(404, () => ({ code: "missing", status: 404 } as const)),
  Match.when(429, () => ({ code: "rate",    status: 429 } as const)),
  Match.either,
);
const collapseStatus = (status: 200 | 401 | 404 | 429) => Either.match(classifyStatus(status), {
  onLeft: (okStatus) => ({ ok: true, status: okStatus } as const),
  onRight: (failure) => ({ ok: false, ...failure } as const),
});
```

---
## [5][EFFECT_PLATFORM_AND_CAUSE_BRIDGES]
>**Dictum:** *Boundary matching is one deterministic projection from unknown/transport/cause rails to one tagged domain error rail.*

Use platform-native rails end-to-end when normalizing `HttpClientError` so matcher branches map to real boundary failures, not hypothetical ones. For sandboxed programs, collapse `Cause` with a total matcher projection before leaving the boundary and keep a deterministic merge policy for sequential/parallel causes.

```ts
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientError from "@effect/platform/HttpClientError";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Cause, Data, Effect, Match, Schema as S } from "effect";
import { identity } from "effect/Function";

// --- [CLASSES] ---------------------------------------------------------------

class UpstreamError extends Data.TaggedError("UpstreamError")<{
  readonly reason:  "decode" | "defect" | "http" | "interrupt" | "missing" | "transport" | "unexpected_status";
  readonly cause?:  unknown;
  readonly status?: number;
}> {}

// --- [SCHEMA] ----------------------------------------------------------------

const Todo = S.Struct({ id: S.Number, title: S.String });

// --- [FUNCTIONS] -------------------------------------------------------------

const normalizeThrowable = Match.type<unknown>().pipe(
  Match.withReturnType<UpstreamError>(),
  Match.when(Match.instanceOf(UpstreamError), identity),
  Match.when(Match.instanceOf(HttpClientError.RequestError),  (cause) => new UpstreamError({ reason: "transport", cause })),
  Match.when(Match.instanceOf(HttpClientError.ResponseError), (cause) => new UpstreamError({ reason: "http", cause, status: cause.response.status })),
  Match.orElse((cause) => new UpstreamError({ reason: "defect", cause })),
);
const decodeTodoResponse = (response: HttpClientResponse.HttpClientResponse) =>
  HttpClientResponse.matchStatus(response, {
    200:    (ok) => HttpClientResponse.schemaBodyJson(Todo)(ok).pipe(Effect.mapError((cause) => new UpstreamError({ reason: "decode", cause }))),
    404:    () => Effect.fail(new UpstreamError({    reason: "missing", status: 404 })),
    "5xx":  (bad) => Effect.fail(new UpstreamError({ reason: "http",    status: bad.status })),
    orElse: (bad) => Effect.fail(new UpstreamError({ reason: "unexpected_status", status: bad.status })),
  });
const fetchTodo = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.mapError(normalizeThrowable),
    Effect.flatMap(decodeTodoResponse),
  );
const reasonPriority = {
  interrupt: 0,
  transport: 1,
  http: 2,
  decode: 3,
  missing: 4,
  unexpected_status: 5,
  defect: 6,
} as const satisfies Record<UpstreamError["reason"], number>;
const pickReason = (left: UpstreamError["reason"], right: UpstreamError["reason"]) =>
  Match.value(reasonPriority[left] <= reasonPriority[right]).pipe(
    Match.when(true, () => left),
    Match.when(false, () => right),
    Match.exhaustive,
  );
const collapseCause = (cause: Cause.Cause<UpstreamError>) => Cause.match(cause, {
  onEmpty: new UpstreamError({ reason: "defect" }),
  onFail: identity,
  onDie:        (defect) =>      new UpstreamError({ reason: "defect",    cause: defect }),
  onInterrupt:  (fiberId) =>     new UpstreamError({ reason: "interrupt", cause: fiberId }),
  onSequential: (left, right) => new UpstreamError({ reason: pickReason(left.reason, right.reason), cause: { left, right } }),
  onParallel:   (left, right) => new UpstreamError({ reason: pickReason(left.reason, right.reason), cause: { left, right } }),
});
const withCauseBridge = <A, R>(program: Effect.Effect<A, UpstreamError, R>) => program.pipe(Effect.sandbox, Effect.mapError(collapseCause));
```

---
## [6][MATCHER_REUSE_ACROSS_STREAM_STM_TEMPORAL_STRUCTURES]
>**Dictum:** *A classifier should be reusable across Effect, Stream, and STM without rewriting branch logic or introducing mutable control scaffolding.*

This pattern keeps matching value-level while reusing the same classifier in temporal bucketing, transactional aggregation (`TMap`), and immutable materialization (`Chunk` -> `HashMap`). Keeping matcher logic central avoids duplicated branch trees between batch and streaming paths.

```ts
import { Chunk, Clock, DateTime, Effect, HashMap, Match, Option, STM, Stream, TMap } from "effect";

const bucketZone = DateTime.match({
  onUtc:   () => "utc" as const,
  onZoned: () => "zoned" as const,
});
const bucketLatencyAt = (now: number, deadline: DateTime.DateTime) => Match.value(now <= DateTime.toEpochMillis(deadline)).pipe(
  Match.when(true, () => "on_time" as const),
  Match.when(false, () => "late" as const),
  Match.exhaustive,
);
const classifyEventAt = (now: number, event: { readonly deadline: DateTime.DateTime; readonly tenantId: string }) =>
  `${event.tenantId}:${bucketZone(event.deadline)}:${bucketLatencyAt(now, event.deadline)}` as const;
const summarizeWindows = (events: ReadonlyArray<{ readonly deadline: DateTime.DateTime; readonly tenantId: string }>) =>
  STM.commit(TMap.empty<string, bigint>()).pipe(
    Effect.flatMap((counters) =>
      Stream.fromIterable(events).pipe(
        Stream.groupedWithin(128, "1 second"),
        Stream.mapEffect((window) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => Effect.forEach(window, (event) =>
              STM.commit(TMap.updateWith(counters, classifyEventAt(now, event), (current) =>
                Option.some(Option.match(current, {
                  onNone: () => 1n,
                  onSome: (value) => value + 1n,
                })),
              )),
            )),
          ),
        ),
        Stream.runDrain,
        Effect.as(counters),
      ),
    ),
    Effect.flatMap((counters) => STM.commit(TMap.toArray(counters))),
    Effect.map((entries) => Chunk.fromIterable(entries).pipe(
      Chunk.reduce(HashMap.empty<string, bigint>(), (acc, [key, value]) => HashMap.set(acc, key, value)),
    )),
  );
```
