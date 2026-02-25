# [H1][SERVICES]
>**Dictum:** *Services are scoped capability algebras: constructor mode fixes lifetime, traced methods fix observability, layer topology fixes wiring -- compose all three or drift is guaranteed.*

<br>

Service owns `Effect.Service` class API (3.19.x): constructor modes, scoped resource lifecycle, `Effect.fn` traced methods, dual-access patterns, fiber subscription ownership, layer substitution, and cross-library integration surfaces. Layer graph algebra: `composition.md`; fiber ownership: `concurrency.md`; telemetry vocabulary: `observability.md`; error rail design: `errors.md`.

---
## [1][CONSTRUCTOR_MODE_AND_RESOURCE_LIFECYCLE]
>**Dictum:** *Constructor mode determines service lifetime algebra.*

<br>

- `scoped:` is default -- `effect:` only when zero resources need finalization.
- LIFO release -- acquire infrastructure first (released last), register drain finalizers second (run before infra teardown).
- `acquireRelease` for guaranteed cleanup; `addFinalizer` for inline registration without paired acquire.
- [NEVER] `sync:` for IO -- cannot express errors or deps.
- [NEVER] `acquireRelease` inside `Layer.effect` -- Scope leaks into `RIn`, no teardown on interrupt.

```ts
import { Data, Effect, Metric, Queue } from "effect";
import { SqlClient } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------

class StorageError extends Data.TaggedError("StorageError")<{
    readonly operation: "acquire" | "migrate" | "query";
    readonly reason: "pool";
    readonly cause?: unknown;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _METRICS = {
    activeConns: Metric.gauge("storage_active_connections"),
    acquireMs:   Metric.histogram("storage_acquire_duration_ms", Metric.exponentialBuckets(1, 2, 12)),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class StorageService extends Effect.Service<StorageService>()("domain/Storage", {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* Effect.acquireRelease(
            sql`SELECT pg_advisory_lock(42)`.pipe(
                Effect.zipRight(Metric.increment(_METRICS.activeConns)),
                Effect.mapError((cause) => new StorageError({ operation: "acquire", reason: "pool", cause })),
            ),
            () => Metric.incrementBy(_METRICS.activeConns, -1),
        );
        yield* Effect.addFinalizer(() => sql`SELECT pg_advisory_unlock(42)`.pipe(Effect.ignore));
        const channel = yield* Effect.acquireRelease(Queue.bounded<string>(512), Queue.shutdown);
        const read = Effect.fn("Storage.read")((key: string) =>
            sql<{ readonly value: string }>`SELECT value FROM kv WHERE key = ${key}`.pipe(
                Effect.mapError((cause) => new StorageError({ operation: "query", reason: "pool", cause })),
            ),
        );
        const write = Effect.fn("Storage.write")((key: string, value: string) =>
            sql`INSERT INTO kv (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = ${value}`.pipe(
                Effect.zipRight(Queue.offer(channel, key)),
                Effect.mapError((cause) => new StorageError({ operation: "query", reason: "pool", cause })),
            ),
        );
        return { read, write, channel } as const;
    }),
}) {}
```

**Laws:**<br>
- if `acquireRelease` succeeds and the enclosing scope closes via success, failure, or interruption, the release callback executes exactly once -- no path skips finalization,
- LIFO stack ordering is the sole contract: the last resource registered is the first released, regardless of error channel state at teardown.

---
## [2][TRACED_METHODS_AND_OBSERVABILITY_SURFACE]
>**Dictum:** *Every service method is a named span with metric emission.*

<br>

- `Effect.fn('Service.method')` wraps every public method -- automatic span + pipe continuation for retry/timeout.
- Module-level `_METRICS` const holds counters/histograms/gauges -- co-located, never shared across modules.
- `FiberRef` propagates tenant/request context through fiber hierarchy -- set at boundary, read via `FiberRef.get`.
- `Effect.annotateCurrentSpan` for structured span attributes -- bounded vocabulary only.
- [NEVER] metrics inside scoped gen -- module-level singletons, not per-instance allocations.
- [NEVER] string interpolation for span names -- dot-path convention: `'Namespace.method'`.

```ts
import { Data, Duration, Effect, FiberRef, Metric, Option, Schedule } from "effect";
import { SqlClient } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------

class CatalogError extends Data.TaggedError("CatalogError")<{
    readonly operation: "lookup" | "upsert";
    readonly reason: "missing" | "conflict" | "timeout" | "upstream";
    readonly cause?: unknown;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const TenantRef = FiberRef.unsafeMake<Option.Option<string>>(Option.none());
const _METRICS = {
    lookups:   Metric.counter("catalog_lookups_total"),
    upserts:   Metric.counter("catalog_upserts_total"),
    latencyMs: Metric.histogram("catalog_operation_duration_ms", Metric.exponentialBuckets(1, 2, 12)),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class CatalogService extends Effect.Service<CatalogService>()("domain/Catalog", {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const lookup = Effect.fn("Catalog.lookup")(function* (slug: string) {
            const tenant = yield* FiberRef.get(TenantRef);
            yield* Effect.annotateCurrentSpan({ "catalog.slug": slug, "catalog.tenant": Option.getOrElse(tenant, () => "system") });
            const rows = yield* sql<{ readonly id: string; readonly slug: string }>`SELECT id, slug FROM catalog WHERE slug = ${slug}`.pipe(
                Effect.mapError((cause) => new CatalogError({ operation: "lookup", reason: "upstream", cause })),
            );
            yield* Metric.increment(Metric.tagged(_METRICS.lookups, "tenant", Option.getOrElse(tenant, () => "system")));
            return rows;
        });
        const upsert = Effect.fn("Catalog.upsert")(
            (slug: string, payload: string) =>
                sql`INSERT INTO catalog (slug, payload) VALUES (${slug}, ${payload}) ON CONFLICT (slug) DO UPDATE SET payload = ${payload}`.pipe(
                    Effect.timedWith((duration) => Metric.update(_METRICS.latencyMs, Duration.toMillis(duration))),
                    Effect.zipRight(Metric.increment(_METRICS.upserts)),
                    Effect.mapError((cause) => new CatalogError({ operation: "upsert", reason: "conflict", cause })),
                ),
            (effect) => effect.pipe(
                Effect.retry(Schedule.exponential("50 millis").pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3)))),
                Effect.timeoutFail({ duration: Duration.seconds(5), onTimeout: () => new CatalogError({ operation: "upsert", reason: "timeout" }) }),
            ),
        );
        return { lookup, upsert } as const;
    }),
}) {}
```

**Laws:**<br>
- `Effect.fn` pipe continuation receives the wrapped effect and original args -- retry/timeout compose without re-entering the generator or losing argument context,
- `Effect.timedWith` duration is wall-clock elapsed between effect start and completion -- not CPU time, not span duration from tracing,
- `FiberRef` mutation in a child fiber is invisible to the parent after fork -- tenant context set via `locally` is scoped, not shared.

---
## [3][DUAL_ACCESS_AND_LAYER_TOPOLOGY]
>**Dictum:** *Closure capture eliminates R; static delegates preserve it.*

<br>

- Instance access: methods close over yielded deps -> `R = never` for callers within scope.
- Static delegates: `accessors: true` generates delegates that yield service tag -> `R = ServiceTag`.
- [NEVER] mix instance and static access for the same call within a scoped generator.
- `Layer.provideMerge` passes deps through for downstream consumers; `Layer.provide` removes them from output.
- `accessors: true` generates `.pipe(Effect.flatMap(tag => tag.method))` delegates -- callers import static accessors without yielding the service tag.
- [CRITICAL] `Layer.fresh` bypasses memo -- test isolation only, never production composition.

```ts
import { Data, Effect, Layer, Metric } from "effect";
import { SqlClient } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------

class InventoryError extends Data.TaggedError("InventoryError")<{
    readonly reason: "missing" | "conflict" | "upstream";
    readonly cause?: unknown;
}> {}
const _METRICS = { quotes: Metric.counter("pricing_quotes_total") } as const;

// --- [SERVICES] --------------------------------------------------------------

class InventoryService extends Effect.Service<InventoryService>()("domain/Inventory", {
    accessors: true,
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const reserve = Effect.fn("Inventory.reserve")((sku: string, quantity: number) =>
            sql`UPDATE inventory SET reserved = reserved + ${quantity} WHERE sku = ${sku}`.pipe(
                Effect.mapError((cause) => new InventoryError({ reason: "conflict", cause })),
            ),
        );
        const check = Effect.fn("Inventory.check")((sku: string) =>
            sql<{ readonly available: number }>`SELECT available FROM inventory WHERE sku = ${sku}`.pipe(
                Effect.mapError((cause) => new InventoryError({ reason: "upstream", cause })),
            ),
        );
        return { reserve, check } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

class PricingService extends Effect.Service<PricingService>()("domain/Pricing", {
    effect: Effect.gen(function* () {
        const inventory = yield* InventoryService;
        return { quote: Effect.fn("Pricing.quote")((sku: string, quantity: number) =>
            inventory.check(sku).pipe(
                Effect.filterOrFail((rows) => rows.length > 0, () => new InventoryError({ reason: "missing" })),
                Effect.map((rows) => ({ sku, quantity, unitPrice: rows[0].available * 0.15, total: rows[0].available * 0.15 * quantity })),
                Effect.tap(() => inventory.reserve(sku, quantity)),
                Effect.zipRight(Metric.increment(Metric.tagged(_METRICS.quotes, "sku", sku))),
            )) } as const;
    }),
}) {}
const ServicesLayer = PricingService.Default.pipe(Layer.provideMerge(InventoryService.Default)); // Layer.fresh bypasses memo -- test isolation only
```

**Laws:**<br>
- `accessors: true` delegates yield the service tag -- callers outside the scoped gen observe `R = Self`; callers inside observe `R = never` -- the R-channel difference is structural, not incidental,
- `Layer.provideMerge` output includes both the new service AND its satisfied deps -- reversing chain order produces a compile-time error, not a runtime failure,
- two `Layer` values constructed by the same factory function are memoized independently -- reference identity, not structural equality, governs sharing.

---
## [4][SCOPED_SUBSCRIPTION_AND_EVENT_PIPELINE]
>**Dictum:** *Fibers born in scope die with scope — subscriptions are lifecycle-bound; subscribe before fork or lose messages.*

<br>

- `Effect.forkScoped` spawns fibers that auto-interrupt on layer teardown — canonical for event subscriptions inside service constructors.
- Subscribe inside scoped gen, pass dequeuer to forked fiber — acquiring subscription inside the forked fiber creates a race window where messages between constructor return and fiber start are silently dropped.
- `Stream.groupedWithin` for microbatch aggregation before persistence — window policy is explicit data: count cap and duration ceiling.
- Drain: `Stream.fromQueue` -> `groupedWithin` -> traced `persistBatch` -> `runDrain` composes subscription, aggregation, write, and metrics in one rail.
- [NEVER] `Effect.fork` inside scoped gen — fiber outlives service scope, resource leak on teardown.
- [NEVER] acquire subscription inside `Effect.forkScoped` body — race window silently drops messages.
- Cross-reference: fiber ownership -> `concurrency.md [1]`; queue strategy -> `concurrency.md [2]`.

```ts
import { Chunk, Data, Duration, Effect, Metric, MetricLabel, PubSub, Stream } from "effect";
import { SqlClient } from "@effect/sql";

// --- [ERRORS] ----------------------------------------------------------------

class EventError extends Data.TaggedError("EventError")<{ readonly operation: "subscribe" | "persist" | "drain"; readonly reason: "write"; readonly cause?: unknown }> {}

// --- [CONSTANTS] -------------------------------------------------------------

const _METRICS = {
    batchesProcessed: Metric.counter("events_batches_processed_total"),
    eventsIngested:   Metric.counter("events_ingested_total"),
    batchLatencyMs:   Metric.histogram("events_batch_latency_ms", Metric.exponentialBuckets(1, 2, 10)),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class EventProcessor extends Effect.Service<EventProcessor>()("domain/EventProcessor", {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const hub = yield* Effect.acquireRelease(PubSub.bounded<{ readonly topic: string; readonly payload: string }>(2048), PubSub.shutdown);
        const sub = yield* PubSub.subscribe(hub);
        const persistBatch = Effect.fn("EventProcessor.persistBatch")(
            (batch: Chunk.Chunk<{ readonly topic: string; readonly payload: string }>) =>
                sql.withTransaction(Effect.forEach(Chunk.toReadonlyArray(batch), (event) => sql`INSERT INTO event_log (topic, payload) VALUES (${event.topic}, ${event.payload})`, { concurrency: 1 })).pipe(
                    Effect.timed,
                    Effect.tap(([duration]) => Metric.update(Metric.taggedWithLabels(_METRICS.batchLatencyMs, [MetricLabel.make("pipeline", "event")]), Duration.toMillis(duration))),
                    Effect.map(([, result]) => result),
                    Effect.tap(() => Metric.increment(_METRICS.batchesProcessed)),
                    Effect.tap(() => Metric.incrementBy(_METRICS.eventsIngested, Chunk.size(batch))),
                    Effect.mapError((cause) => new EventError({ operation: "persist", reason: "write", cause })),
                ),
        );
        yield* Effect.forkScoped(
            Stream.fromQueue(sub).pipe(Stream.groupedWithin(100, Duration.millis(250)), Stream.mapEffect((batch) => persistBatch(batch)), Stream.runDrain),
        );
        const publish = Effect.fn("EventProcessor.publish")(
            (topic: string, payload: string) => PubSub.publish(hub, { topic, payload }).pipe(Effect.asVoid),
        );
        return { publish } as const;
    }),
}) {}
```

**Laws:**<br>
- if subscription is acquired inside `Effect.forkScoped` body, messages published between scope entry and fork start are silently lost -- subscribe-then-fork eliminates this window,
- `groupedWithin` emits a partial chunk when the time window expires before count is reached -- the drain fiber observes every message, never silently drops,
- if the drain fiber is interrupted mid-batch, unprocessed messages remain in the queue -- the producer's next `offer` observes backpressure, not silent loss.

---
## [5][SUBSTITUTION_ALGEBRA]
>**Dictum:** *Layer substitution is the only mechanism for test doubles — type system enforces full shape; `Ref` tracks interactions.*

<br>

- `Layer.succeed(Tag, stub)` — full replacement, `R=never`; compiler rejects partial shapes.
- `Tag.DefaultWithoutDependencies` — preserves scoped constructor, overrides only upstream dependencies.
- `Layer.fresh` — bypasses memoization for per-test state isolation; critical when services hold `Ref`, `PubSub`, or `Queue`.
- `it.scoped` from `@effect/vitest` — required when service uses `acquireRelease`; provides `Scope` automatically.
- [NEVER] mock at function level — substitute at Layer level where the type system enforces completeness.
- [NEVER] partial implementations — `Layer.succeed` requires every key; `Layer.mock` defaults omitted effectful keys to `UnimplementedError`.

```ts
import { Effect, Layer, Ref } from "effect";
import { it } from "@effect/vitest";

// --- [SERVICES] --------------------------------------------------------------

class LedgerService extends Effect.Service<LedgerService>()("domain/Ledger", {
    scoped: Effect.gen(function* () {
        const entries = yield* Effect.acquireRelease(Ref.make<ReadonlyArray<{ readonly account: string; readonly amount: number }>>([]), () => Effect.logDebug("ledger.ref.released"));
        const credit = Effect.fn("Ledger.credit")((account: string, amount: number) => Ref.update(entries, (current) => [...current, { account, amount }]));
        const balance = Ref.get(entries);
        return { credit, balance } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const LedgerTracked = (calls: Ref.Ref<ReadonlyArray<string>>) => Layer.succeed(LedgerService, {
    credit: (account: string, _amount: number) => Ref.update(calls, (ids) => [...ids, account]),
    balance: Ref.get(calls).pipe(Effect.map((ids) => ids.map((account) => ({ account, amount: 0 })))),
});

// --- [FUNCTIONS] -------------------------------------------------------------

const ledgerSpec = it.scoped("tracks credits via layer substitution", () =>
    Effect.gen(function* () {
        const calls = yield* Ref.make<ReadonlyArray<string>>([]);
        const service = yield* LedgerService.pipe(Effect.provide(LedgerTracked(calls)));
        yield* service.credit("acct-1", 100);
        yield* service.credit("acct-2", 250);
        const tracked = yield* Ref.get(calls);
        return { tracked, invariant: tracked.length === 2 } as const;
    }),
);
```

**Laws:**<br>
- `Layer.succeed` requires every key in the service interface at compile time -- omitting a method is a type error, not a runtime `undefined`,
- without `Layer.fresh`, two tests providing the same service layer share `Ref`/`Queue` state -- test B observes mutations from test A,
- `it.scoped` provides `Scope` to the test fiber -- `it.effect` does not, causing `acquireRelease` finalizers to never execute.

---
## [6][CROSS_LIBRARY_SERVICE_INTEGRATION]
>**Dictum:** *Services are the integration surface for the Effect ecosystem — routes, resolvers, and tools are thin adapters over service capabilities.*

<br>

- `HttpApiBuilder.group` yields services inside handler generator — routes delegate all logic to service methods; handler bodies stay under 3 lines.
- `SqlResolver.findById` inside scoped gen — automatic request batching eliminates N+1 queries transparently across concurrent fiber access.
- `FiberRef` propagates tenant context through the fiber hierarchy — set once at boundary middleware, read downstream without parameter threading.
- [ALWAYS] services own the integration boundary — routes/handlers are thin adapters that yield service and call methods.

```ts
import { Data, Effect, FiberRef, Metric, Option, Schema as S } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import { SqlClient, SqlResolver } from "@effect/sql";
import * as Model from "@effect/sql/Model";

// --- [SCHEMA] ----------------------------------------------------------------

class Tenant extends Model.Class<Tenant>("Tenant")({
    id: Model.GeneratedByApp(S.UUID), slug: S.NonEmptyTrimmedString, plan: S.Literal("starter", "pro", "enterprise"), createdAt: Model.DateTimeInsertFromDate, updatedAt: Model.DateTimeUpdateFromDate,}) {}

// --- [ERRORS] ----------------------------------------------------------------
class TenantError extends Data.TaggedError("TenantError")<{ readonly operation: "resolve" | "provision"; readonly reason: "missing" | "conflict" | "upstream"; readonly cause?: unknown }> {}

// --- [CONSTANTS] -------------------------------------------------------------

const TenantRef = FiberRef.unsafeMake<Option.Option<string>>(Option.none());
const _METRICS = { resolved: Metric.counter("tenant_resolved_total"), provisioned: Metric.counter("tenant_provisioned_total") } as const;

// --- [SERVICES] --------------------------------------------------------------

class TenantService extends Effect.Service<TenantService>()("domain/TenantService", {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const resolver = yield* SqlResolver.findById("TenantById", { Id: S.UUID, Result: Tenant.json, ResultId: (tenant) => tenant.id, execute: (ids) => sql`SELECT * FROM tenant WHERE id IN ${sql.in(ids)}` });
        const resolve = Effect.fn("Tenant.resolve")((tenantId: string) =>
            resolver.execute(tenantId).pipe(Effect.mapError((cause) => new TenantError({ operation: "resolve", reason: "upstream", cause })), Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new TenantError({ operation: "resolve", reason: "missing" })),
                onSome: (tenant) => Metric.increment(Metric.tagged(_METRICS.resolved, "plan", tenant.plan)).pipe(Effect.zipRight(Effect.annotateCurrentSpan({ "tenant.id": tenantId, "tenant.plan": tenant.plan })), Effect.as(tenant)),
            }))),
        );
        const provision = Effect.fn("Tenant.provision")(function* (slug: string, plan: "starter" | "pro" | "enterprise") {
            const tenant = yield* FiberRef.get(TenantRef);
            yield* Effect.annotateCurrentSpan({ "tenant.slug": slug, "tenant.plan": plan, "tenant.requester": Option.getOrElse(tenant, () => "system") });
            yield* sql`INSERT INTO tenant (slug, plan) VALUES (${slug}, ${plan})`.pipe(Effect.mapError((cause) => new TenantError({ operation: "provision", reason: "conflict", cause })));
            yield* Metric.increment(Metric.tagged(_METRICS.provisioned, "plan", plan));
        });
        return { resolve, provision } as const;
    }),
}) {}

// --- [LAYERS] ----------------------------------------------------------------

const TenantApi = HttpApi.make("TenantApi").add(HttpApiGroup.make("tenant")
    .add(HttpApiEndpoint.get("resolve", "/tenants/:id").setPath(S.Struct({ id: S.UUID })).addSuccess(Tenant.json))
    .add(HttpApiEndpoint.post("provision", "/tenants").setPayload(Tenant.jsonCreate).addSuccess(S.Void)));
const TenantHandlers = HttpApiBuilder.group(TenantApi, "tenant", (handlers) =>
    Effect.gen(function* () {
        const tenants = yield* TenantService;
        return handlers
            .handle("resolve", ({ path }) => tenants.resolve(path.id))
            .handle("provision", ({ payload }) => tenants.provision(payload.slug, payload.plan));
    }),
);
```

**Laws:**<br>
- `SqlResolver` deduplicates concurrent requests for the same entity ID within a single fiber scope -- two fibers resolving ID "x" simultaneously produce one SQL query, not two,
- handler bodies exceeding 3 lines indicate domain logic leaking past the service boundary -- the handler's sole role is parameter extraction and delegation,
- `FiberRef` set in middleware propagates to all service methods called within that request fiber -- no explicit parameter threading required,
- `Entity.client` yields a curried factory `(id: string) => TypedClient` -- the same service methods exposed via `HttpApiBuilder.group` are equally reachable through `Sharding.registerEntity`, proving protocol-agnostic service design.
