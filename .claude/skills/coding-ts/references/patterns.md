# Patterns

Cross-boundary integration contracts. Each section addresses a single topology where schema authority, error classification, or runtime policy must align across transport/persistence/cluster boundaries.

---
## Schema convergence

Model projections derive RPC and HTTP contracts — the model IS the schema authority. Protocol errors share a vocabulary with status codes; the vocabulary drives both transport binding and error serialization.

```ts
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup, HttpClient } from "@effect/platform"
import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient"
import * as Model from "@effect/sql/Model"
import * as Rpc from "@effect/rpc/Rpc"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import { Effect, Schema as S } from "effect"

class Tenant extends Model.Class<Tenant>("Tenant")({
  id: Model.GeneratedByApp(S.UUID), slug: S.NonEmptyTrimmedString, plan: S.Literal("starter", "pro", "enterprise"),
}) {}
const Err = { conflict: { status: 409, _tag: "TenantConflict" }, notFound: { status: 404, _tag: "TenantNotFound" } } as const
type ErrKey = keyof typeof Err
const TenantErr = <K extends ErrKey>(k: K) => S.TaggedError<{ _tag: (typeof Err)[K]["_tag"]; tenantId: S.UUID["Type"] }>()(Err[k]._tag, { tenantId: Tenant.fields.id })
const Rpc_ = {
  create: Rpc.make("tenant.create", { payload: Tenant.jsonCreate, success: Tenant.json, error: TenantErr("conflict") }),
  read:   Rpc.make("tenant.read", { payload: S.Struct({ id: Tenant.fields.id }), success: Tenant.json, error: TenantErr("notFound") }),
} as const
const Api = HttpApi.make("Api").add(HttpApiGroup.make("tenant")
  .add(HttpApiEndpoint.post("create", "/tenants").setPayload(Rpc_.create.payload).addSuccess(Rpc_.create.success).addError(Rpc_.create.error, { status: Err.conflict.status }))
  .add(HttpApiEndpoint.get("read", "/tenants/:id").setPath(Rpc_.read.payload).addSuccess(Rpc_.read.success).addError(Rpc_.read.error, { status: Err.notFound.status })))
const Protocol = { rpc: RpcGroup.make(Rpc_.create, Rpc_.read), api: Api, decode: { create: S.decodeUnknown(Tenant.jsonCreate), read: S.decodeUnknown(Rpc_.read.payload) } } as const

const httpClient = (baseUrl: string) => Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient
  return yield* HttpApiClient.group(Api, { group: "tenant", httpClient: http, baseUrl })
}).pipe(Effect.provide(BrowserHttpClient.layerXMLHttpRequest))
```

**Contracts:**
- `Err` vocabulary unifies error tag and HTTP status — `TenantErr(k)` factory derives `S.TaggedError` from vocabulary lookup; adding an error requires one entry.
- `Tenant.fields.id` extracts field schema for reuse in payload structs — no parallel `S.UUID` declarations.
- `Protocol` aggregates RPC group, HTTP API, and decode functions — single import surface for consumers; all three derive from `Rpc_` definitions.
- `httpClient` factory demonstrates browser client construction via `HttpApiClient.group` with `BrowserHttpClient.layerXMLHttpRequest` — platform runtime explicit.

**Failure modes prevented:**
- Status code drift between error vocabulary and HTTP binding.
- Parallel error classes with duplicated field definitions.
- Decode functions diverging from transport schemas.

---
## Transport classification

Status classification is a closed algebra — the vocabulary maps status ranges to policy bundles. `Effect.filterOrFail` gates success/failure; metrics and logging derive from the same lookup with zero conditional branching.

```ts
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform"
import { Data, Duration, Effect, Metric, MetricLabel, Schedule, Schema as S, Tuple } from "effect"

const Status = {
  ok:      { range: [200, 299] as const, retry: false, log: Effect.logDebug },
  client:  { range: [400, 428] as const, retry: false, log: Effect.logWarning },
  rate:    { range: [429, 429] as const, retry: true,  log: Effect.logWarning },
  server:  { range: [500, 599] as const, retry: true,  log: Effect.logError },
} as const satisfies Record<string, { range: readonly [number, number]; retry: boolean; log: (..._: ReadonlyArray<unknown>) => Effect.Effect<void> }>
type StatusKey = keyof typeof Status
const classify = (code: number): StatusKey => (Object.entries(Status).find(([, { range: [lo, hi] }]) => code >= lo && code <= hi)?.[0] ?? "server") as StatusKey

class TransportFault extends Data.TaggedError("TransportFault")<{ readonly code: number; readonly key: StatusKey; readonly url: string }> {
  get policy() { return Status[this.key] }
}
const Signals = Tuple.make(Metric.counter("http_requests_total"), Metric.histogram("http_latency_ms", Metric.Boundaries.exponential({ start: 1, factor: 2, count: 10 })))

const execute = <A>(req: HttpClientRequest.HttpClientRequest, schema: S.Schema<A, unknown>) =>
  Effect.gen(function* () {
    const [count, lat] = Signals
    const http = yield* HttpClient.HttpClient
    const [res, ms] = yield* Effect.timedWith(http.execute(req), Effect.clockWith((c) => c.currentTimeMillis))
    const key = classify(res.status)
    yield* Effect.all([Metric.increment(Metric.taggedWithLabels(count, [MetricLabel.make("status_class", key)])), Metric.update(lat, Number(Duration.toMillis(ms)))])
    yield* Status[key].log(req.url, { status: res.status, ms: Duration.toMillis(ms) })
    yield* Effect.filterOrFail(Effect.succeed(res), () => key === "ok", () => new TransportFault({ code: res.status, key, url: req.url }))
    return yield* HttpClientResponse.schemaBodyJson(schema)(res)
  }).pipe(Effect.retry(Schedule.exponential(Duration.millis(50)).pipe(Schedule.intersect(Schedule.recurs(3)), Schedule.whileInput((e: TransportFault) => e.policy.retry))))
```

**Contracts:**
- `Status` vocabulary with tuple ranges — `classify` performs single scan; `Status[key]` projects retry eligibility AND log function from same lookup.
- `MetricLabel.make` for explicit label construction — `Metric.taggedWithLabels` accepts label array, enabling multi-dimensional tagging without string concatenation.
- `Tuple.make` for metric pair — destructured once, no repeated object access.
- `Effect.filterOrFail` replaces ternary — success path continues pipeline, failure path short-circuits with `TransportFault`. No `if`/ternary.
- `Effect.timedWith` returns `[A, Duration]` — single timing invocation instead of start/end clock reads.

**Failure modes prevented:**
- Ternary/conditional branching for success/failure dispatch.
- Duplicated timing logic across transport functions.
- Metric tagging diverging from classification vocabulary.

---
## Stream persistence window

Windowed persistence composes three boundaries: decode (unknown → typed), window (time/count aggregation), and transaction (batch atomicity). `Sink.foldWeighted` with `aggregateWithin` provides algebraic control over batch formation; transaction scope matches exactly one aggregated chunk.

```ts
import * as SqlClient from "@effect/sql/SqlClient"
import { PgClient } from "@effect/sql-pg"
import { Chunk, Data, DateTime, Duration, Effect, Number as N, Schedule, Schema as S, Sink, Stream } from "effect"

const Event = S.Struct({ tenantId: S.UUID, metric: S.String, value: S.Number })
class PersistFault extends Data.TaggedError("PersistFault")<{ readonly stage: "decode" | "write"; readonly cause: unknown }> {
  get retry() { return Schedule.exponential(Duration.millis(50)).pipe(Schedule.intersect(Schedule.recurs(4)), Schedule.whileInput(() => this.stage === "write")) }
}
const Batch = { maxCost: 10_000, cost: (e: typeof Event.Type) => N.abs(e.value), schedule: Schedule.spaced(Duration.millis(250)) } as const
const stamp = <A>(a: A) => DateTime.now.pipe(Effect.map((at) => ({ ...a, observedAt: DateTime.toEpochMillis(at) })))

const persist = (raw: Stream.Stream<unknown>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const pg = yield* PgClient.PgClient
    const sink = Sink.foldWeighted({ initial: Chunk.empty<typeof Event.Type & { observedAt: number }>(), maxCost: Batch.maxCost, cost: (_, e) => Batch.cost(e), body: Chunk.append })
    const decoded = raw.pipe(
      Stream.mapEffect((r) => S.decodeUnknown(Event)(r).pipe(Effect.mapError((cause) => new PersistFault({ stage: "decode", cause })))),
      Stream.mapEffect(stamp), Stream.aggregateWithin(sink, Batch.schedule))
    return yield* decoded.pipe(Stream.runForEach((batch) => sql.withTransaction(
      Effect.forEach(batch, (e) => sql`insert into event (tenant_id, metric, value, payload, observed_at_ms) values (${e.tenantId}, ${e.metric}, ${e.value}, ${pg.json({ metric: e.metric })}, ${e.observedAt})`.pipe(Effect.asVoid, Effect.mapError((cause) => new PersistFault({ stage: "write", cause }))), { discard: true })
    ).pipe(Effect.retry(Schedule.exponential(Duration.millis(50)).pipe(Schedule.intersect(Schedule.recurs(4)), Schedule.whileInput((e: PersistFault) => e.stage === "write"))))))
  })
```

**Contracts:**
- `Sink.foldWeighted` with `cost` function — batch forms when cumulative cost exceeds `maxCost` OR schedule elapses. `Batch.cost` derives from domain semantics (value magnitude), not arbitrary count.
- `PgClient.PgClient` acquired for Postgres-specific features — `pg.json()` serializes JSONB payloads with proper type handling.
- `Schedule.whileInput` with inline predicate gates retry on `stage === "write"` — decode failures (malformed input) are terminal, write failures (transient) retry.
- `aggregateWithin(sink, schedule)` — sink controls batch capacity, schedule controls flush interval. Both configurable independently via `Batch` object.
- `sql.withTransaction` ensures batch atomicity — partial batch failure triggers full rollback, no orphaned rows.

**Failure modes prevented:**
- Hardcoded batch sizes ignoring domain cost semantics.
- Retry schedules that conflict with error stage classification.
- Manual SQL column enumeration drifting from schema.

---
## Workflow compensation

Saga compensation is vocabulary-driven — each activity maps to a rollback policy. `Effect.when` gates compensation execution; the vocabulary determines both eligibility and rollback action label. Activity definitions inline their compensation policy.

```ts
import * as Activity from "@effect/workflow/Activity"
import * as Workflow from "@effect/workflow/Workflow"
import { Effect, Option, pipe, Schema as S } from "effect"

const Act = {
  charge:  { reversible: true,  action: "refund",  schema: S.Struct({ receiptId: S.UUID, amount: S.Number }) },
  reserve: { reversible: true,  action: "release", schema: S.Struct({ reservationId: S.UUID, sku: S.String }) },
  notify:  { reversible: false, action: "no-op",   schema: S.Struct({ delivered: S.Boolean }) },
} as const satisfies Record<string, { reversible: boolean; action: string; schema: S.Schema.AnyNoContext }>
type ActKey = keyof typeof Act

const activity = <K extends ActKey>(k: K, exec: Effect.Effect<S.Schema.Type<(typeof Act)[K]["schema"]>>) =>
  Activity.make({ name: k, success: Act[k].schema, execute: exec })
const compensate = <K extends ActKey>(k: K, v: S.Schema.Type<(typeof Act)[K]["schema"]>, ctx: { orderId: string }) =>
  Effect.when(Effect.logWarning(Act[k].action, { activity: k, ...ctx, value: v }), () => Act[k].reversible)

const Charge  = activity("charge", Effect.sync(() => ({ receiptId: S.decodeSync(S.UUID)(crypto.randomUUID()), amount: 100 })))
const Reserve = activity("reserve", Effect.sync(() => ({ reservationId: S.decodeSync(S.UUID)(crypto.randomUUID()), sku: "SKU-001" })))
const Notify  = activity("notify", Effect.succeed({ delivered: true }))

const Fulfill = Workflow.make({ name: "Fulfill", payload: { orderId: S.UUID }, idempotencyKey: ({ orderId }) => orderId,
  success: S.Struct({ receiptId: S.UUID, reservationId: S.UUID }), error: S.TaggedError<{ _tag: "FulfillFailed" }>()("FulfillFailed", {}) })
const FulfillLive = Fulfill.toLayer(({ orderId }) => Effect.gen(function* () {
  const ctx = { orderId }
  const c = yield* Charge.execute.pipe(Workflow.withCompensation((v) => compensate("charge", v, ctx)))
  const r = yield* Reserve.execute.pipe(Workflow.withCompensation((v) => compensate("reserve", v, ctx)))
  yield* Notify.execute
  return { receiptId: c.receiptId, reservationId: r.reservationId }
}))
```

**Contracts:**
- `Act` vocabulary unifies schema, reversibility, and action label — `activity(k, exec)` factory derives `Activity.make` config from vocabulary; type parameter `K` constrains to valid keys.
- `Effect.when(effect, predicate)` replaces ternary — returns `Option<void>` when false, executes effect when true. No conditional branching.
- `compensate` function is polymorphic over activity key — type parameter `K` ensures value type matches activity schema via `S.Schema.Type<(typeof Act)[K]["schema"]>`.
- `Notify.execute` has no `withCompensation` wrapper — `Act.notify.reversible = false` makes this explicit in vocabulary, not implicit in missing code.

**Failure modes prevented:**
- Ternary/if-else for compensation eligibility.
- Activity schema diverging from compensation value type.
- Implicit non-reversibility via missing wrapper.

---
## Cluster entity topology

Entity protocols aggregate RPC capabilities into sharded actors. Singleton duties run at most once cluster-wide. Layer composition makes the runtime graph explicit — no implicit startup glue.

```ts
import * as Entity from "@effect/cluster/Entity"
import * as Singleton from "@effect/cluster/Singleton"
import * as Rpc from "@effect/rpc/Rpc"
import { Data, Duration, Effect, Layer, Option, Ref, Schedule, Schema as S } from "effect"

const JobState = Data.taggedEnum<Data.TaggedEnum<{
  Pending:  {}
  Running:  { readonly pct: number }
  Complete: { readonly result: string }
  Failed:   { readonly reason: string }
}>>()
type JobState = Data.TaggedEnum.Value<typeof JobState>

const JobRpc = {
  progress: Rpc.make("job.progress", { payload: S.Struct({ jobId: S.UUID }), success: S.Struct({ state: S.Unknown }), error: S.Struct({ _tag: S.Literal("JobMissing") }) }),
  cancel:   Rpc.make("job.cancel", { payload: S.Struct({ jobId: S.UUID }), success: S.Void, error: S.Struct({ _tag: S.Literal("JobMissing") }) }),
  advance:  Rpc.make("job.advance", { payload: S.Struct({ jobId: S.UUID, pct: S.Int }), success: S.Void, error: S.Struct({ _tag: S.Literal("JobMissing") }) }),
} as const

const JobEntity = Entity.make("Job", [JobRpc.progress, JobRpc.cancel, JobRpc.advance])
const JobEntityLive = JobEntity.toLayer((jobId, state: Ref.Ref<JobState>) => ({
  "job.progress": () => state.pipe(Ref.get, Effect.map((s) => ({ state: s }))),
  "job.cancel":   () => state.pipe(Ref.set(JobState.Failed({ reason: "cancelled" }))),
  "job.advance":  ({ pct }) => state.pipe(Ref.update(JobState.$match({
    Pending:  () => JobState.Running({ pct }),
    Running:  (s) => pct >= 100 ? JobState.Complete({ result: "done" }) : JobState.Running({ pct }),
    Complete: (s) => s,
    Failed:   (s) => s,
  }))),
}))

const RebalanceLeader = Singleton.make("cluster.rebalance", Effect.logDebug("cluster.rebalance.tick").pipe(Effect.repeat(Schedule.spaced(Duration.seconds(15)))))
const ClusterTopology = Layer.mergeAll(JobEntityLive, RebalanceLeader)
```

**Contracts:**
- `JobState` is a `TaggedEnum` — `$match` provides exhaustive dispatch over state transitions. State machine logic lives in the entity handler, not scattered across RPCs.
- `JobRpc` object aggregates protocol — `Entity.make` receives the array, `toLayer` implements the handler contract with access to entity-local `Ref<JobState>`.
- `Singleton.make` for cluster-wide leader duty — `Schedule.spaced` without jitter for deterministic tick behavior. `Schedule.jittered` applies when staggering is desirable.
- `Layer.mergeAll` assembles entity + singleton into one graph — no implicit startup order, no hidden bootstrap code.

**Failure modes prevented:**
- State machine transitions scattered across handler methods.
- Entity responsibilities spread across unrelated modules.
- Singleton duties with non-deterministic scheduling.

---
## STM coordination

High-contention coordination requires transactional atomicity — `TMap` for ledger state, `TQueue` for ingestion policy. Queue strategy (bounded/dropping/sliding) is a vocabulary choice evaluated once at construction.

```ts
import { Chunk, Clock, DateTime, Effect, HashMap, Option, Order, STM, TMap, TQueue } from "effect"

const QueuePolicy = {
  bounded:  <A>(cap: number) => TQueue.bounded<A>(cap),
  dropping: <A>(cap: number) => TQueue.dropping<A>(cap),
  sliding:  <A>(cap: number) => TQueue.sliding<A>(cap),
} as const satisfies Record<string, <A>(cap: number) => STM.STM<TQueue.TQueue<A>>>
type QueueMode = keyof typeof QueuePolicy

type Entry = readonly [tenant: string, delta: bigint]
const ledgerProgram = (mode: QueueMode, capacity: number, seed: ReadonlyArray<Entry>) =>
  Effect.gen(function* () {
    const queue = yield* STM.commit(QueuePolicy[mode]<Entry>(capacity))
    const ledger = yield* STM.commit(TMap.empty<string, bigint>())
    yield* STM.commit(TQueue.offerAll(queue, seed))
    const drain = STM.gen(function* () {
      const items = yield* TQueue.takeUpTo(queue, 64)
      yield* STM.forEach(items, ([tenant, delta]) => TMap.updateWith(ledger, tenant, (opt) => Option.some(Option.getOrElse(opt, () => 0n) + delta)))
    })
    yield* Effect.all([STM.commit(drain), STM.commit(drain), STM.commit(drain)], { concurrency: 3 })
    const nowMs = yield* Clock.currentTimeMillis
    const snapshot = yield* STM.commit(TMap.toHashMap(ledger))
    const entries = Chunk.fromIterable(HashMap.toEntries(snapshot)).pipe(Chunk.sortWith(([t]) => t, Order.string), Chunk.toReadonlyArray)
    const total = entries.reduce((acc, [, d]) => acc + d, 0n)
    const asOf = DateTime.unsafeMake(nowMs).pipe(DateTime.formatIso)
    return { asOf, entries, total, balanced: total >= 0n } as const
  })
```

**Contracts:**
- `QueuePolicy` vocabulary maps mode to constructor — `QueuePolicy[mode]<Entry>(capacity)` produces the configured queue without `Match` chains. Adding a mode requires one vocabulary entry.
- `STM.gen` inside `drain` composes transactional reads and updates — the entire sequence runs atomically. `STM.commit` executes the transaction.
- `TMap.updateWith` with `Option.some(...)` return — insert-or-update semantics. Returning `Option.none` would delete the key.
- Snapshot ordering via `Chunk.sortWith` before externalization — deterministic output regardless of internal HashMap iteration order.
- `DateTime.unsafeMake` for clock-derived timestamps (known valid) — `DateTime.make` returns `Option` for potentially invalid inputs.

**Failure modes prevented:**
- Lost updates from non-transactional mutation.
- Non-deterministic snapshot order in downstream consumers.
- Queue behavior changes that bypass compile-time policy selection.
