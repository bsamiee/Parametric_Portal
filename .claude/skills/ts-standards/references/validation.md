# [H1][VALIDATION]
>**Dictum:** *Validation is one deterministic rail: decode unknown once, normalize in schema combinators, and project failures once at the boundary.*

Scope: `@effect/schema` + Effect rails for decode, normalization, accumulation, persistence, concurrency, and transport mapping.
Cross-references: `types.md`, `surface.md`, `errors.md`, `matching.md`, `effects.md`, `composition.md`, `services.md`, `persistence.md`, `concurrency.md`, `performance.md`, `observability.md`, `patterns.md`, `algorithms.md`.

---
## [1][CHANNEL_CONTRACTS]
>**Dictum:** *Select APIs by channel semantics; sync collapse is explicit and local.*

```ts
import { Effect, Schema as S, pipe } from "effect";

const ChannelContracts = [
  { need: "decode unknown in rail", api: "S.decodeUnknown", shape: "Effect<Type, ParseError, R>" },
  { need: "decode unknown in pure pre-routing", api: "S.decodeUnknownEither", shape: "Either<Type, ParseError>" },
  { need: "explicit sync decode collapse", api: "S.decodeUnknownSync", shape: "Type | throw" },
  { need: "validate in rail", api: "S.validate", shape: "Effect<Type, ParseError, R>" },
  { need: "explicit sync validation", api: "S.validateSync", shape: "Type | throw" },
  { need: "encode in rail", api: "S.encode", shape: "Effect<Encoded, ParseError, R>" },
  { need: "guard/assert edge collapse", api: "S.is / S.asserts", shape: "boolean / assertion" },
] as const;

const StrictIngress =       S.Struct({ id: S.UUID, namespace: S.String.pipe(S.pattern(/^[a-z0-9-]+$/)), limit: S.optionalWith(S.Int.pipe(S.between(1, 500)), { default: () => 100 }) });
const decodeIngress =       S.decodeUnknown(StrictIngress);
const decodeIngressEither = S.decodeUnknownEither(StrictIngress);
const decodeIngressSync =   S.decodeUnknownSync(StrictIngress);
const validateIngress =     S.validate(StrictIngress);
const validateIngressSync = S.validateSync(StrictIngress);
const encodeIngress =       S.encode(StrictIngress);
const isIngress =           S.is(StrictIngress);
const assertIngress =       S.asserts(StrictIngress);

const ingressRail = (raw: unknown) => pipe(
  decodeIngress(raw, { errors: "all", onExcessProperty: "error" }),
  Effect.flatMap((decoded) => validateIngress(decoded)),
);
```

---
## [2][SINGLE_BOUNDARY_RAIL]
>**Dictum:** *Decode once, normalize once, map once; every downstream module receives typed values only.*

```ts
import { Cause, Effect, Option, ParseResult, Schema as S, pipe } from "effect";

class ValidationBoundaryError extends S.TaggedError<ValidationBoundaryError>()("ValidationBoundaryError", {
  stage:   S.Literal("decode", "normalize", "upstream", "defect"),
  reason:  S.Literal("invalid", "rejected", "failed", "unexpected"),
  details: S.String,
  cause:   S.optional(S.Unknown),
}) {}

const parseErrorAt =   (stage: "decode" | "normalize" | "upstream") => (error: ParseResult.ParseError) =>
  new ValidationBoundaryError({ stage, reason: "invalid", details: ParseResult.TreeFormatter.formatErrorSync(error), cause: error });
const unknownErrorAt = (stage: "upstream" | "defect", reason: "failed" | "unexpected") => (cause: unknown) =>
  new ValidationBoundaryError({ stage, reason, details: String(cause), cause });

const RawIngress =        S.Struct({ id: S.UUID, namespace: S.String, payload: S.Unknown });
const NormalizedIngress = S.Struct({ id: S.UUID, namespace: S.String.pipe(S.pattern(/^[a-z0-9-]+$/)), payload: S.Unknown });
const UpstreamResponse =  S.Struct({ accepted: S.Boolean, revision: S.Int.pipe(S.nonNegative()) });

const decodeRawIngress = (raw: unknown) => pipe(
  S.decodeUnknown(RawIngress)(raw, { errors: "all", onExcessProperty: "error" }),
  Effect.mapError(parseErrorAt("decode")),
);

const normalizeIngress = (decoded: typeof RawIngress.Type) => pipe(
  S.validate(NormalizedIngress)({ ...decoded, namespace: decoded.namespace.trim().toLowerCase().replaceAll("_", "-") }),
  Effect.mapError(parseErrorAt("normalize")),
);

const callUpstream = (normalized: typeof NormalizedIngress.Type) => pipe(
  Effect.tryPromise({
    try: () => fetch("https://upstream.example/validate", { method: "POST", body: JSON.stringify(normalized) }).then((response) => response.json()),
    catch: unknownErrorAt("upstream", "failed"),
  }),
  Effect.flatMap((raw) => S.decodeUnknown(UpstreamResponse)(raw, { errors: "all" })),
  Effect.mapError(parseErrorAt("upstream")),
  Effect.map((upstream) => ({ normalized, upstream }) as const),
);

const boundaryRail = (raw: unknown) => pipe(
  decodeRawIngress(raw),
  Effect.flatMap(normalizeIngress),
  Effect.flatMap(callUpstream),
  Effect.catchAllCause((cause) => pipe(
    Cause.failureOption(cause),
    Option.match({ onNone: () => Effect.fail(unknownErrorAt("defect", "unexpected")(Cause.pretty(cause))), onSome: Effect.fail }),
  )),
);
```

---
## [3][NORMALIZATION_POLICY_AND_STAGE_WITNESS]
>**Dictum:** *Use `transformOrFail` for fallible normalization and keep parse-stage reasons in the contract.*

```ts
import { Effect, Match, ParseResult, Schema as S, pipe } from "effect";

const Namespace = S.transformOrFail(S.String, S.String.pipe(S.pattern(/^[a-z0-9-]+$/)), {
  decode: (raw, options, ast) => pipe(
    raw.trim().toLowerCase().replaceAll("_", "-"),
    (normalized) => Match.value(normalized.length >= 3).pipe(
      Match.when(true,  () => ParseResult.succeed(normalized)),
      Match.when(false, () => ParseResult.fail(new ParseResult.Type(ast, raw, options?.errors === "all" ? "namespace.too_short" : "namespace.invalid"))),
      Match.exhaustive,
    ),
  ),
  encode: ParseResult.succeed,
  strict: true,
});

const TenantKey =      S.TemplateLiteral(S.Literal("tenant:"), S.String);
const TenantKeyParts = S.TemplateLiteralParser(S.Literal("tenant:"), S.String);
const Cursor = S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ sequence: S.Int.pipe(S.nonNegative()), ts: S.Int.pipe(S.nonNegative()) })));
const CursorEnvelope = S.Struct({ tenantKey: TenantKey, namespace: Namespace, cursor: Cursor });

const decodeCursorEnvelope = (raw: unknown) => pipe(
  S.decodeUnknown(CursorEnvelope)(raw, { errors: "all", onExcessProperty: "error" }),
  Effect.mapError(parseErrorAt("decode")),
  Effect.flatMap((decoded) => pipe(
    S.decodeUnknown(TenantKeyParts)(decoded.tenantKey),
    Effect.map(([prefix, tenantId]) => ({ ...decoded, prefix, tenantId }) as const),
    Effect.mapError(parseErrorAt("normalize")),
  )),
);
```

---
## [4][ACCUMULATION_AND_EXHAUSTIVE_COLLAPSE]
>**Dictum:** *Mode selection is product behavior: fail-fast, branch-visible, retained failures, or partitioned outputs.*

```ts
import { Either, Effect, Match, Option, Schema as S } from "effect";

const shards = ["shard-1", "shard-two", "shard-3", "invalid"] as const;
const validateShard = (value: string) => Match.value(/^shard-\d+$/.test(value)).pipe(
  Match.when(true,  () => Effect.succeed(value)),
  Match.when(false, () => Effect.fail(new ValidationBoundaryError({ stage: "normalize", reason: "rejected", details: `invalid shard: ${value}` }))),
  Match.exhaustive,
);

const failFast =         Effect.all(shards.map(validateShard));
const branchVisible =    Effect.all(shards.map(validateShard), { mode: "either" });
const retainedFailures = Effect.all(shards.map(validateShard), { mode: "validate" });
const allOrErrors =      Effect.validateAll(shards, validateShard, { concurrency: 8 });
const firstSuccessOrAllErrors = Effect.validateFirst(shards, validateShard, { concurrency: 8 });
const partitioned =      Effect.partition(shards, validateShard, { concurrency: 8 });

const GateSignal = S.Union(
  S.Struct({ _tag: S.Literal("Decoded"),    quotaOk: S.Boolean }),
  S.Struct({ _tag: S.Literal("Normalized"), quotaOk: S.Boolean }),
  S.Struct({ _tag: S.Literal("Upstream"),   status:  S.Literal(200, 409, 429, 503) }),
);

const routeGate = Match.type<typeof GateSignal.Type>().pipe(
  Match.withReturnType<{ readonly rail: "accept" | "reject" | "retry"; readonly status: 200 | 400 | 409 | 429 | 503 }>(),
  Match.tagsExhaustive({
    Decoded: ({ quotaOk }) => Match.value(quotaOk).pipe(Match.when(true, () => ({ rail: "accept", status: 200 } as const)), Match.when(false, () => ({ rail: "reject", status: 400 } as const)), Match.exhaustive),
    Normalized: ({ quotaOk }) => Match.value(quotaOk).pipe(Match.when(true, () => ({ rail: "accept", status: 200 } as const)), Match.when(false, () => ({ rail: "reject", status: 400 } as const)), Match.exhaustive),
    Upstream: ({ status }) => Match.value(status).pipe(
      Match.when(200, () => ({ rail: "accept", status: 200 } as const)),
      Match.when(409, () => ({ rail: "reject", status: 409 } as const)),
      Match.when(429, () => ({ rail: "retry",  status: 429 } as const)),
      Match.when(503, () => ({ rail: "retry",  status: 503 } as const)),
      Match.exhaustive,
    ),
  }),
);

const resolveRegion = Match.type<string>().pipe(Match.when((region) => region.startsWith("us-"), (region) => region), Match.when((region) => region.startsWith("eu-"), (region) => region), Match.option);
const collapseRoute = (status: 200 | 400 | 409 | 429 | 503): Either.Either<"retry" | "reject", "accept"> => Match.value(status).pipe(Match.when(200, () => "accept" as const), Match.when(400, () => "reject" as const), Match.when(409, () => "reject" as const), Match.when(429, () => "retry" as const), Match.when(503, () => "retry" as const), Match.either);
const requireRegion = (raw: string) => Option.match(resolveRegion(raw), { onNone: () => ({ _tag: "region.invalid" } as const), onSome: (value) => ({ _tag: "region.valid", value } as const) });
```

---
## [5][PERSISTENCE_CURSOR_OCC_GATES]
>**Dictum:** *Predicates, cursors, and writes are validation algebra over one canonical schema family.*

```ts
import { Array as A, Effect, Match, Option, Schema as S, pipe } from "effect";
import { Model, SqlClient, SqlSchema, type Statement } from "@effect/sql";
import { PgClient } from "@effect/sql-pg";

class LedgerEntry extends Model.Class<LedgerEntry>("LedgerEntry")({
  id: Model.Generated(S.UUID), tenantId: S.UUID, namespace: S.String.pipe(S.pattern(/^[a-z0-9-]+$/)), payload: Model.JsonFromString(S.Struct({ score: S.Number })), updatedAt: Model.DateTimeUpdateFromDate,
}) {}

const LedgerCursor = S.compose(S.StringFromBase64Url, S.parseJson(S.Struct({ id: S.UUID, updatedAt: S.String })));

const makeLedgerRead = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return (filter: { readonly tenantId?: string; readonly namespace?: string; readonly cursor?: string }) => pipe(
    Effect.all({
      cursor: pipe(Option.fromNullable(filter.cursor), Option.match({ onNone: () => Effect.succeed(Option.none<typeof LedgerCursor.Type>()), onSome: (raw) => pipe(S.decodeUnknown(LedgerCursor)(raw), Effect.map(Option.some), Effect.mapError(parseErrorAt("decode")))})),
      tenantId:  Effect.succeed(Option.fromNullable(filter.tenantId)),
      namespace: Effect.succeed(Option.fromNullable(filter.namespace)),
    }),
    Effect.flatMap(({ cursor, tenantId, namespace }) => {
      const predicates = A.getSomes([
        pipe(tenantId,  Option.map((value) => sql`tenant_id = ${value}`)),
        pipe(namespace, Option.map((value) => sql`namespace = ${value}`)),
        pipe(cursor,    Option.map((value) => sql`(updated_at, id) < (${value.updatedAt}, ${value.id})`)),
      ]) as ReadonlyArray<Statement.Fragment>;
      const where = Match.value(predicates.length > 0).pipe(Match.when(true, () => sql.and(predicates)), Match.when(false, () => sql`TRUE`), Match.exhaustive);
      return SqlSchema.findAll({ Request: S.Void, Result: LedgerEntry, execute: () => sql`SELECT * FROM ledger_entry WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT 101` })(undefined);
    }),
  );
});

const makeLedgerWrite = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pg = yield* PgClient.PgClient;
  return (id: string, expectedUpdatedAt: string, payload: { readonly score: number }) => pipe(
    sql`UPDATE ledger_entry SET payload = ${pg.json(payload)}::jsonb, updated_at = NOW() WHERE id = ${id} AND updated_at = ${expectedUpdatedAt} RETURNING *`,
    Effect.flatMap((rows) => pipe(
      Option.fromNullable(rows.at(0)),
      Option.match({
        onNone: () => Effect.fail(new ValidationBoundaryError({ stage: "normalize", reason: "rejected", details: "occ.conflict" })),
        onSome: Effect.succeed,
      }),
    )),
  );
});
```

---
## [6][OWNERSHIP_PERMITS_OBSERVABILITY_AND_CAUSE]
>**Dictum:** *Concurrent validation is valid only with explicit ownership, permit policy, queue outcome accounting, bounded telemetry, and exhaustive cause projection.*

```ts
import { Cause, Effect, Match, Metric, MetricLabel, Option, Queue, Schema as S, pipe } from "effect";

const ValidationRuntimePolicy = S.Struct({ capacity: S.Int.pipe(S.between(32, 4096)), permits: S.Int.pipe(S.between(1, 512)) });
const operationMetric =         Metric.frequency("validation.operation", { preregisteredWords: ["accept", "reject", "retry", "shed", "drain"] });
const acceptedMetric =          Metric.counter("validation.accepted");
const shedMetric =              Metric.counter("validation.shed");
const queueDepthMetric =        Metric.gauge("validation.queue_depth");

const runOwnedValidationIngress = (rawPolicy: unknown, inputs: ReadonlyArray<unknown>) => pipe(
  S.decodeUnknown(ValidationRuntimePolicy)(rawPolicy, { errors: "all", onExcessProperty: "error" }),
  Effect.mapError(parseErrorAt("decode")),
  Effect.flatMap((policy) => Effect.acquireRelease(
    Effect.all({ queue: Queue.dropping<unknown>(policy.capacity), semaphore: Effect.makeSemaphore(policy.permits) }),
    ({ queue }) => pipe(Queue.shutdown(queue), Effect.zipRight(Queue.awaitShutdown(queue))),
  )),
  Effect.flatMap(({ queue, semaphore }) => Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({ module: "validation" });
    yield* Effect.labelMetricsScoped([MetricLabel.make("rail", "boundary")]);
    const _span = yield* Effect.option(Effect.currentSpan);
    yield* Effect.forEach(inputs, (input) => pipe(
      semaphore.withPermitsIfAvailable(1)(Queue.offer(queue, input)),
      Effect.flatMap(Option.match({
        onNone: () => pipe(Metric.increment(shedMetric), Effect.zipRight(Metric.update(operationMetric, "shed"))),
        onSome: (accepted) => Match.value(accepted).pipe(
          Match.when(true, () => pipe(Metric.increment(acceptedMetric), Effect.zipRight(Metric.update(operationMetric, "accept")))),
          Match.when(false, () => pipe(Metric.increment(shedMetric), Effect.zipRight(Metric.update(operationMetric, "reject")))),
          Match.exhaustive,
        ),
      })),
      Effect.zipRight(Queue.size(queue)),
      Effect.flatMap((depth) => Metric.set(queueDepthMetric, depth)),), { concurrency: policy.permits }),
    Effect.withSpan("validation.ingress"),
  })),
);

const toHttpFailure = (error: ValidationBoundaryError) => Match.value(error.reason).pipe(
  Match.when("invalid",    () => ({ status: 400, body: { code: "validation.invalid",    details: error.details } } as const)),
  Match.when("rejected",   () => ({ status: 409, body: { code: "validation.rejected",   details: error.details } } as const)),
  Match.when("failed",     () => ({ status: 503, body: { code: "validation.failed",     details: error.details } } as const)),
  Match.when("unexpected", () => ({ status: 500, body: { code: "validation.unexpected", details: error.details } } as const)),
  Match.exhaustive,
);

const projectCause = (cause: Cause.Cause<ValidationBoundaryError>) => Cause.match({
  onEmpty: { status: 500, body: { code: "cause.empty", details: "empty cause" } }, onFail: toHttpFailure,
  onDie: (defect) => ({ status: 500, body: { code: "cause.defect",    details: String(defect) } }),
  onInterrupt: () => ({ status: 499, body: { code: "cause.interrupt", details: "request interrupted" } }),
  onSequential: (left) => left, onParallel: (left) => left,
})(cause);
```

---
## [7][NON_NEGOTIABLES]
>**Dictum:** *Validation quality is enforced by immutable laws and explicit anti-pattern bans.*

Validation gate matrix:
- `VG-01` Decode-once detector: count decode boundaries in ingress path. Reject when payload is decoded more than once.
- `VG-02` Boundary mapping detector: locate parse->tagged conversion site. Reject when mapping is duplicated across layers.
- `VG-03` Exhaustive closure detector: finite union matchers. Reject when no exhaustive terminator or explicit collapse.
- `VG-04` Rail ownership detector: module error tags. Reject when boundary exports raw string/unknown failures.
- `VG-05` Queue/permit detector: ingress rails with queue policy. Reject when offer outcomes are ignored.
- `VG-06` OCC detector: update paths with expected version/timestamp. Reject when zero-row conflict is not typed.

Anti-pattern bans:
- Re-decoding payloads downstream.
- Using `S.validate` as sync collapse.
- Fallback routing over finite tagged unions.
- String errors at boundary seams.
- Parallel DTO families drifting from schema authority.
- Detached fibers without scoped ownership.
- Retries keyed by raw status code without typed reason.
- Unbounded metric labels.
- Ad-hoc `JSON.stringify` for JSONB writes.
- Implicit OCC semantics.
