# Services

Service owns `Effect.Service` class API: constructor modes fix resource lifetime, `Effect.fn` traced methods fix observability, layer composition fixes wiring topology. One scoped constructor per capability boundary — resource acquisition, method definition, and subscription wiring compose inside a single generator where closure capture eliminates `R` for all callers within scope. Layer graph algebra: `composition.md`; fiber ownership: `concurrency.md`; error rail design: `errors.md`.


## Scoped lifecycle and traced methods

`scoped:` acquires a `Scope` and registers LIFO finalizers — `acquireRelease` for paired acquire/release, `addFinalizer` for unpaired cleanup. `Effect.fn("span")(body, pipeline)` separates domain logic from resilience: the body executes once per attempt; the pipeline operator receives the sealed effect and original arguments, composing retry, timeout, and telemetry outside the body without re-entering the generator. Module-level metrics are singletons — allocating inside the scoped generator creates per-instance registrations that leak on re-provision.

```ts
import { Data, Duration, Effect, FiberRef, Metric, Option, Queue, Schedule } from "effect"
import { SqlClient } from "@effect/sql"

const _Ops = {
  acquire: { retryable: false, log: Effect.logError   },
  query:   { retryable: true,  log: Effect.logWarning },
} as const satisfies Record<string, { retryable: boolean; log: (...a: ReadonlyArray<unknown>) => Effect.Effect<void> }>

class StoreFault extends Data.TaggedError("StoreFault")<{
  readonly op: keyof typeof _Ops; readonly cause?: unknown
}> {
  get retryable() { return _Ops[this.op].retryable }
  get log()       { return _Ops[this.op].log       }
}

const _TenantRef = FiberRef.unsafeMake(Option.none<string>())
const _Metrics = { conns: Metric.gauge("store_conns"), latMs: Metric.histogram("store_lat_ms", Metric.exponentialBuckets(1, 2, 12)) } as const

class StoreService extends Effect.Service<StoreService>()("domain/Store", {
  scoped: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* Effect.acquireRelease(
      sql`SELECT pg_advisory_lock(42)`.pipe(Effect.zipRight(Metric.increment(_Metrics.conns)), Effect.mapError((cause) => new StoreFault({ op: "acquire", cause }))),
      () => sql`SELECT pg_advisory_unlock(42)`.pipe(Effect.zipRight(Metric.incrementBy(_Metrics.conns, -1)), Effect.ignore))
    const channel = yield* Effect.acquireRelease(Queue.bounded<string>(512), Queue.shutdown)
    const read = Effect.fn("Store.read")(
      (key: string) => sql<{ readonly value: string }>`SELECT value FROM kv WHERE key = ${key}`.pipe(
        Effect.mapError((cause) => new StoreFault({ op: "query", cause }))),
      (effect) => effect.pipe(
        Effect.tap(() => FiberRef.getWith(_TenantRef, (t) => Effect.annotateCurrentSpan({ "store.tenant": Option.getOrElse(t, () => "system") }))),
        Effect.timedWith((d) => Metric.update(_Metrics.latMs, Duration.toMillis(d))),
        Effect.retry(Schedule.exponential("50 millis").pipe(Schedule.intersect(Schedule.recurs(3)), Schedule.jittered)),
        Effect.timeoutFail({ duration: Duration.seconds(5), onTimeout: () => new StoreFault({ op: "query" }) })))
    const write = Effect.fn("Store.write")(
      (key: string, value: string) => sql`INSERT INTO kv (key,value) VALUES (${key},${value}) ON CONFLICT(key) DO UPDATE SET value=${value}`.pipe(
        Effect.zipRight(Queue.offer(channel, key)), Effect.mapError((cause) => new StoreFault({ op: "query", cause }))))
    return { read, write, channel } as const
  }),
}) {}
```

`_Ops` vocabulary drives `StoreFault` getters — adding an operation requires one entry; `retryable` and `log` derive without classification logic outside the table. `Effect.fn("Store.read")(body, pipeline)`: on retry, only the sealed effect re-executes — the generator body is not re-entered. The pipeline operator receives `(effect, ...originalArgs)`, making call-site arguments available for input-dependent retry logic. `Effect.timedWith` measures wall-clock elapsed — not CPU time, not span duration — for histogram update. `FiberRef.getWith` reads tenant context in-place and projects directly into `annotateCurrentSpan` without yielding. LIFO release ordering: `channel` shuts down first (registered last), advisory lock releases last (registered first). `acquireRelease` guarantees exactly-once release on success, failure, or interruption — no finalizer path is skipped.


## Subscription drain topology

`PubSub.subscribe` must execute inside the scoped generator BEFORE `Effect.forkScoped` — subscribing inside the forked fiber creates a race window where messages published between constructor return and fork start are silently dropped. `Effect.forkScoped` binds the drain fiber to the service scope: scope closure interrupts the fiber, preventing resource leaks. `Stream.groupedWithin` batches by count cap OR time window, emitting partial chunks on time expiry — the drain observes every published message.

```ts
import { Chunk, Data, Duration, Effect, Metric, MetricLabel, PubSub, Stream } from "effect"
import { SqlClient } from "@effect/sql"

class DrainFault extends Data.TaggedError("DrainFault")<{ readonly cause?: unknown }> {}

const _Metrics = {
  batches:  Metric.counter("drain_batches_total"),
  ingested: Metric.counter("drain_ingested_total"),
  latMs:    Metric.histogram("drain_batch_lat_ms", Metric.exponentialBuckets(1, 2, 10)),
} as const

class EventDrain extends Effect.Service<EventDrain>()("domain/EventDrain", {
  scoped: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const hub = yield* Effect.acquireRelease(PubSub.bounded<{ readonly topic: string; readonly payload: string }>(2048), PubSub.shutdown)
    const sub = yield* PubSub.subscribe(hub)
    const persist = Effect.fn("EventDrain.persist")(
      (batch: Chunk.Chunk<{ readonly topic: string; readonly payload: string }>) =>
        sql.withTransaction(Effect.forEach(Chunk.toReadonlyArray(batch), (e) => sql`INSERT INTO events (topic,payload) VALUES (${e.topic},${e.payload})`, { concurrency: 1 })).pipe(
          Effect.timedWith((d) => Metric.update(Metric.taggedWithLabels(_Metrics.latMs, [MetricLabel.make("pipeline", "drain")]), Duration.toMillis(d))),
          Effect.zipRight(Metric.increment(_Metrics.batches)),
          Effect.zipRight(Metric.incrementBy(_Metrics.ingested, Chunk.size(batch))),
          Effect.mapError((cause) => new DrainFault({ cause }))))
    yield* Effect.forkScoped(Stream.fromQueue(sub).pipe(
      Stream.groupedWithin(100, Duration.millis(250)), Stream.mapEffect(persist), Stream.runDrain))
    return { publish: Effect.fn("EventDrain.publish")((topic: string, payload: string) => PubSub.publish(hub, { topic, payload }).pipe(Effect.asVoid)) } as const
  }),
}) {}
```

`PubSub.subscribe` returns a scoped `Dequeue` registered to the service scope, not the fork's scope — `Stream.fromQueue(sub)` consumes from the already-subscribed dequeue. `groupedWithin(100, Duration.millis(250))` emits at whichever threshold hits first; partial chunks flush on time expiry, never silently dropped. If the drain fiber is interrupted mid-batch, unprocessed messages remain in the queue — the producer's next `PubSub.publish` observes backpressure, not silent loss. `sql.withTransaction` wraps each batch as one atomic commit with `{ concurrency: 1 }` preserving insertion order. `Effect.forkScoped` — not `Effect.fork` — guarantees fiber interruption on scope closure; `Effect.fork` inside a scoped gen leaks the fiber past service teardown.


## Layer algebra and test substitution

`accessors: true` generates static delegates that yield the service tag — callers observe `R = Self`. Inside the constructor, methods close over yielded dependencies — callers within the closure observe `R = never`. `dependencies:` auto-provides upstream layers into `Default`; `DefaultWithoutDependencies` preserves raw `R` for test substitution. `Layer.succeed` enforces full service shape at compile time: omitting a method is a type error, not a runtime `undefined`. `Layer.fresh` bypasses memoization — without it, two tests providing the same layer share `Ref`/`Queue` state silently. `it.scoped` provides `Scope` to the test fiber; `it.effect` does not, causing `acquireRelease` finalizers to never execute.

```ts
import { Data, Effect, Layer, Ref } from "effect"
import { SqlClient } from "@effect/sql"
import { it } from "@effect/vitest"

class InventoryFault extends Data.TaggedError("InventoryFault")<{ readonly op: "reserve" | "check" }> {}

class InventoryService extends Effect.Service<InventoryService>()("domain/Inventory", {
  accessors: true,
  scoped: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const reserve = Effect.fn("Inventory.reserve")((sku: string, qty: number) =>
      sql`UPDATE inventory SET reserved = reserved + ${qty} WHERE sku = ${sku}`.pipe(
        Effect.asVoid, Effect.mapError(() => new InventoryFault({ op: "reserve" }))))
    const check = Effect.fn("Inventory.check")((sku: string) =>
      sql<{ readonly available: number }>`SELECT available FROM inventory WHERE sku = ${sku}`.pipe(
        Effect.mapError(() => new InventoryFault({ op: "check" }))))
    return { reserve, check } as const
  }),
}) {}

class PricingService extends Effect.Service<PricingService>()("domain/Pricing", {
  dependencies: [InventoryService.Default],
  effect: Effect.gen(function* () {
    const inventory = yield* InventoryService
    return { quote: Effect.fn("Pricing.quote")((sku: string, qty: number) =>
      inventory.check(sku).pipe(
        Effect.filterOrFail((rows) => rows.length > 0, () => new InventoryFault({ op: "check" })),
        Effect.map(([row]) => ({ sku, qty, total: row.available * qty * 0.15 })),
        Effect.tap(() => inventory.reserve(sku, qty)))) } as const
  }),
}) {}

const TestInventory = (calls: Ref.Ref<ReadonlyArray<string>>) => Layer.succeed(InventoryService, {
  reserve: (sku: string, _qty: number) => Ref.update(calls, (a) => [...a, sku]),
  check:   () => Effect.succeed([{ available: 42 }]),
})

const spec = it.scoped("tracks reserve calls via layer substitution", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const pricing = yield* PricingService.pipe(
      Effect.provide(PricingService.DefaultWithoutDependencies.pipe(Layer.provide(TestInventory(calls)))))
    yield* pricing.quote("sku-1", 5)
    yield* Ref.get(calls).pipe(
      Effect.filterOrFail((tracked) => tracked.length === 1, () => "expected 1 reserve call"))
  }))
```

`accessors: true` on `InventoryService` generates `InventoryService.check(sku)` as `Effect.flatMap(InventoryService, (s) => s.check(sku))` — callers outside the constructor observe `R = InventoryService`. `PricingService` yields `InventoryService` inside its `effect:` constructor, closing over it — `quote` carries `R = never` despite depending on inventory. `dependencies: [InventoryService.Default]` auto-provides inventory into `PricingService.Default` without manual `Layer.provide`; `PricingService.DefaultWithoutDependencies` exposes raw `R = InventoryService` for test substitution via `TestInventory`. `Layer.succeed` enforces every method — omitting `check` from `TestInventory` is a compile error. Two `Layer` values from the same factory memoize independently by reference identity; `Layer.fresh` is required only when the same layer reference must produce isolated state per test. `Layer.provideMerge` is the general-purpose alternative to `dependencies:` — it outputs both the new service AND its satisfied deps.


## Resolver batching and route delegation

`SqlResolver.findById` constructs a batched resolver — concurrent fibers requesting the same entity ID within a single fiber scope produce one SQL query, not N. The resolver returns `Option<A>`, forcing `Option.match` at every call site — no silent `undefined` on missing entities. `HttpApiBuilder.group` handlers are thin delegation adapters — the handler body's sole role is parameter extraction and service method invocation. Bodies exceeding three lines indicate domain logic leaking past the service boundary; the service is protocol-agnostic, equally reachable via HTTP, `Sharding.Entity`, or `Workflow.Activity`.

```ts
import { Data, Effect, FiberRef, Metric, Option, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform"
import { SqlClient, SqlResolver } from "@effect/sql"
import * as Model from "@effect/sql/Model"

class Tenant extends Model.Class<Tenant>("Tenant")({
  id:        Model.GeneratedByApp(Schema.UUID), slug: Schema.NonEmptyTrimmedString,
  plan:      Schema.Literal("starter", "pro", "enterprise"),
  createdAt: Model.DateTimeInsertFromDate, updatedAt: Model.DateTimeUpdateFromDate,
}) {}

class TenantFault extends Data.TaggedError("TenantFault")<{ readonly op: "resolve" | "provision"; readonly cause?: unknown }> {}

const _TenantRef = FiberRef.unsafeMake(Option.none<string>())
const _Metrics = { resolved: Metric.counter("tenant_resolved_total") } as const

class TenantService extends Effect.Service<TenantService>()("domain/Tenant", {
  scoped: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const byId = yield* SqlResolver.findById("TenantById", {
      Id: Schema.UUID, Result: Tenant.json, ResultId: (t) => t.id,
      execute: (ids) => sql`SELECT * FROM tenant WHERE id IN ${sql.in(ids)}` })
    const resolve = Effect.fn("Tenant.resolve")((id: string) =>
      byId.execute(id).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(new TenantFault({ op: "resolve" })),
          onSome: (t) => FiberRef.getWith(_TenantRef, (caller) =>
            Effect.annotateCurrentSpan({ "tenant.id": id, "tenant.plan": t.plan, "tenant.caller": Option.getOrElse(caller, () => "system") })).pipe(
            Effect.zipRight(Metric.increment(Metric.tagged(_Metrics.resolved, "plan", t.plan))), Effect.as(t)) })),
        Effect.mapError((cause) => new TenantFault({ op: "resolve", cause }))))
    const provision = Effect.fn("Tenant.provision")((slug: string, plan: Tenant["plan"]) =>
      sql`INSERT INTO tenant (slug,plan) VALUES (${slug},${plan})`.pipe(
        Effect.mapError((cause) => new TenantFault({ op: "provision", cause }))))
    return { resolve, provision } as const
  }),
}) {}

const TenantApi = HttpApi.make("tenants").add(HttpApiGroup.make("tenant")
  .add(HttpApiEndpoint.get("resolve", "/tenants/:id").setPath(Schema.Struct({ id: Schema.UUID })).addSuccess(Tenant.json))
  .add(HttpApiEndpoint.post("provision", "/tenants").setPayload(Tenant.jsonCreate).addSuccess(Schema.Void)))

const TenantHandlers = HttpApiBuilder.group(TenantApi, "tenant", (h) => Effect.map(TenantService, (svc) => h
  .handle("resolve", ({ path }) => svc.resolve(path.id))
  .handle("provision", ({ payload }) => svc.provision(payload.slug, payload.plan))))
```

`SqlResolver.findById` yields a batched resolver inside the scoped constructor — two concurrent fibers resolving tenant ID `"x"` produce one SQL query via internal deduplication. `Result: Tenant.json` decodes rows through the `Model.Class` schema anchor; `ResultId: (t) => t.id` maps results back to request IDs for `Option` wrapping. `byId.execute(id)` returns `Option<Tenant>` — `Option.match` forces exhaustive handling of missing entities at every call site. `FiberRef.getWith(_TenantRef, ...)` reads the calling tenant (set at middleware) and annotates the span — no explicit parameter threading. `Tenant["plan"]` derives the literal union from the entity class, keeping `provision`'s type co-derived. Handler bodies are one-line delegations: `svc.resolve(path.id)` and `svc.provision(payload.slug, payload.plan)` — the same methods serve HTTP, `Entity.client`, or `Activity` adapters without modification.
