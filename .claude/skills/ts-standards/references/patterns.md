# [H1][PATTERNS]
>**Dictum:** *Patterns are cross-boundary contracts: one canonical model family, one explicit rail taxonomy, one inspectable runtime graph.*

<br>

This file is for integration points where one module spans multiple boundaries (HTTP, RPC, workflow, persistence, cluster, telemetry, STM). It specifies the minimal contracts that keep those boundaries aligned through refactors.

---
## [1][CONTRACT_CONVERGENCE]
>**Dictum:** *Model, RPC, and HTTP must project from one runtime schema family or drift is guaranteed.*

<br>

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import * as Model from "@effect/sql/Model";
import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import { Effect, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------
class Tenant extends Model.Class<Tenant>("PatternTenant")({
  id: Model.GeneratedByApp(S.UUID), slug: S.NonEmptyTrimmedString, plan: S.Literal("starter", "pro", "enterprise"), createdAt: Model.DateTimeInsertFromDate, updatedAt: Model.DateTimeUpdateFromDate,
}) {}
const TenantConflict = S.Struct({ _tag: S.Literal("TenantConflict"), message: S.String });

// --- [SERVICES] --------------------------------------------------------------
const CreateTenant =   Rpc.make("tenant.create", { payload: Tenant.jsonCreate, success: Tenant.json, error: TenantConflict });
const TenantProtocol = RpcGroup.make(CreateTenant);
const TenantApi =      HttpApi.make("PortalApi").add(HttpApiGroup.make("tenant").add(HttpApiEndpoint.post("create", "/tenants").setPayload(Tenant.jsonCreate).addSuccess(Tenant.json).addError(TenantConflict, { status: 409 })));

// --- [FUNCTIONS] -------------------------------------------------------------
const contractSurface = Effect.succeed({ api: TenantApi, rpc: TenantProtocol, decodeTenantCreate: (raw: unknown) => S.decodeUnknown(Tenant.jsonCreate)(raw) } as const);
```

Contracts:
- `Model.Class` projection is the single schema authority for RPC payloads and HTTP payloads.
- Decode ingress from the exact projection used by the transports.
- Shared error payload (`TenantConflict`) stays structurally identical across protocols.

Failure modes prevented:
- Parallel DTO families with field drift.
- Transport-specific "almost the same" payloads.
- Decode logic diverging from exposed contracts.

Escalate to:
- `surface.md` for route/middleware/client internals.
- `persistence.md` for storage modeling and repository semantics.

---
## [2][SERVICE_RAIL_CONSTRUCTION]
>**Dictum:** *Constructor rail owns dependency acquisition, classification algebra, and retry policy as typed data.*

<br>

```ts
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import * as SqlClient from "@effect/sql/SqlClient";
import { Data, Effect, Match, Schedule, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------
const UpstreamTenant = S.Struct({ id: S.UUID, slug: S.NonEmptyTrimmedString, plan: S.Literal("starter", "pro", "enterprise") });
class UpstreamError extends Data.TaggedError("UpstreamError")<{ readonly reason: "rate" | "timeout" | "fatal"; readonly detail: string; }> {}

// --- [FUNCTIONS] -------------------------------------------------------------
const upstreamReasonPolicy = {
  fatal:   { retryable: false },
  rate:    { retryable: true  },
  timeout: { retryable: true  },
} as const satisfies Record<UpstreamError["reason"], { readonly retryable: boolean }>;
const classifyStatus = (status: number) => Match.value(status).pipe(Match.when((n) => n === 429, () => "rate" as const), Match.when((n) => n >= 500 && n < 600, () => "timeout" as const), Match.orElse(() => "fatal" as const));
const retryPolicy = Schedule.recurWhile((error: UpstreamError) => upstreamReasonPolicy[error.reason].retryable);

// --- [SERVICES] --------------------------------------------------------------
class TenantSync extends Effect.Service<TenantSync>()("Patterns/TenantSync", {
  effect: Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const http = yield* HttpClient.HttpClient;
    return {
      pull: (baseUrl: string, tenantId: string) => http.execute(HttpClientRequest.get(`${baseUrl}/tenants/${tenantId}`)).pipe(Effect.flatMap((response) => Match.value(response.status).pipe(Match.when((s) => s >= 200 && s < 300, () => HttpClientResponse.schemaBodyJson(UpstreamTenant)(response)), Match.orElse(() => Effect.fail(new UpstreamError({ reason: classifyStatus(response.status), detail: `status:${response.status}` }))))), Effect.mapError((error) => Match.value(error).pipe(Match.when((e): e is UpstreamError => e instanceof UpstreamError, (e) => e), Match.orElse((cause) => new UpstreamError({ reason: "fatal", detail: String(cause) })))), Effect.retry(retryPolicy)),
      markSynced: (tenantId: string) => sql`update tenant set synced_at = now() where id = ${tenantId}`.pipe(Effect.asVoid),
    } as const;
  }),
}) {}
```

Contracts:
- Constructor acquires dependencies once and returns a closed capability surface.
- Status classification is a total mapping from transport status to bounded reasons.
- Retry policy is defined from typed reasons, not ad-hoc call-site conditionals.

Failure modes prevented:
- Retrying terminal failures.
- Unbounded or inconsistent retry behavior per call site.
- Mixed transport/decode failures leaking as unclassified errors.

Escalate to:
- `services.md` for service catalog/topology.
- `errors.md` for module-wide error family design.

---
## [3][TRANSPORT_PARITY_HTTP_RPC]
>**Dictum:** *Parity means HTTP client and RPC handler are derived from the same contract family and validated together.*

<br>

```ts
import { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from "@effect/platform";
import * as HttpClient from "@effect/platform/HttpClient";
import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import * as BrowserKeyValueStore from "@effect/platform-browser/BrowserKeyValueStore";
import * as Rpc from "@effect/rpc/Rpc";
import * as RpcGroup from "@effect/rpc/RpcGroup";
import { Effect, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------
const TenantRead =     Rpc.make("tenant.read", { payload: S.Struct({ id: S.UUID }), success: S.Struct({ id: S.UUID, slug: S.NonEmptyTrimmedString, plan: S.Literal("starter", "pro", "enterprise") }), error: S.Struct({ _tag: S.Literal("TenantNotFound"), message: S.String }) });
const TenantRpc =      RpcGroup.make(TenantRead);
const TenantApi =      HttpApi.make("PortalApi").add(HttpApiGroup.make("tenant").add(HttpApiEndpoint.get("read", "/tenants/:id").setPath(TenantRead.payload).addSuccess(TenantRead.success).addError(TenantRead.error, { status: 404 })));

// --- [LAYERS] ----------------------------------------------------------------
const TenantRpcLive = TenantRpc.toLayer({ "tenant.read": ({ id }) => Effect.succeed({ id, slug: `tenant-${id.slice(0, 8)}`, plan: "starter" as const }) });
const TenantHttpClient = Effect.gen(function* () { const httpClient = yield* HttpClient.HttpClient; return yield* HttpApiClient.group(TenantApi, { group: "tenant", httpClient, baseUrl: "https://api.parametric.dev" }); }).pipe(Effect.provide(BrowserHttpClient.layerXMLHttpRequest), Effect.provide(BrowserKeyValueStore.layerSessionStorage));
const paritySurface = Effect.all({ http: TenantHttpClient, rpc: TenantRpc.accessHandler("tenant.read").pipe(Effect.provide(TenantRpcLive)) }, { concurrency: 2 });
```

Contracts:
- RPC and HTTP surfaces share the exact success/error schema family.
- Parity checks construct both paths (`HttpApiClient` and RPC access handler) in one effect.
- Browser runtime dependencies are explicit and local to the parity graph.

Failure modes prevented:
- Schema drift hidden by one-sided tests.
- Runtime-only integration breaks between RPC and HTTP callers.
- Implicit browser dependency assumptions.

Escalate to:
- `surface.md` for route design, middleware policy, and client architecture.

---
## [4][STREAMED_PERSISTENCE_WINDOWS]
>**Dictum:** *Windowing policy, decode boundary, and transaction scope must compose as one rail.*

<br>

```ts
import * as SqlClient from "@effect/sql/SqlClient";
import { PgClient } from "@effect/sql-pg";
import { Chunk, Data, DateTime, Effect, Schedule, Schema as S, Stream } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------
const IngestedEvent = S.Struct({ tenantId: S.UUID, payload: S.Record({ key: S.String, value: S.Unknown }) });

// --- [CLASSES] ---------------------------------------------------------------

class PersistEventsError extends Data.TaggedError("PersistEventsError")<{ readonly reason: "decode" | "write"; readonly cause?: unknown }> {}

// --- [FUNCTIONS] -------------------------------------------------------------
const persistEvents = (input: Stream.Stream<unknown>) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pg = yield* PgClient.PgClient;
  const retry = Schedule.exponential("20 millis").pipe(Schedule.intersect(Schedule.recurs(5)));
  const stamped = input.pipe(Stream.mapEffect((raw) => S.decodeUnknown(IngestedEvent)(raw).pipe(Effect.mapError((cause) => new PersistEventsError({ reason: "decode", cause })))), Stream.mapEffect((event) => DateTime.now.pipe(Effect.map((at) => [event, at] as const))), Stream.groupedWithin(128, "250 millis"));
  return yield* stamped.pipe(Stream.runForEach((batch) => sql.withTransaction(Effect.forEach(Chunk.toReadonlyArray(batch), ([event, at]) => sql`insert into tenant_event (tenant_id, payload, observed_at_ms) values (${event.tenantId}, ${pg.json(event.payload)}, ${DateTime.toEpochMillis(at)})`.pipe(Effect.asVoid, Effect.mapError((cause) => new PersistEventsError({ reason: "write", cause }))), { concurrency: 1 })).pipe(Effect.retry(retry))));
});
```

Contracts:
- Unknown ingress is decoded before timestamping and windowing.
- Window policy is explicit in count and duration (`groupedWithin`).
- Transaction scope encloses one batch unit; retry wraps that unit.

Failure modes prevented:
- Mixed decoded/undecoded items inside the same persistence path.
- Partial batch semantics without explicit retry boundaries.
- Time-window behavior changing silently with refactors.

Escalate to:
- `persistence.md` for repositories, DDL, pagination, and OCC policy.

---
## [5][WORKFLOW_COMPENSATION_RAIL]
>**Dictum:** *Compensation is typed workflow data attached at top-level effects, not side-channel rollback glue.*

<br>

```ts
import * as Activity from "@effect/workflow/Activity";
import * as Workflow from "@effect/workflow/Workflow";
import { Effect, Schema as S } from "effect";

// --- [SERVICES] --------------------------------------------------------------
const Charge = Activity.make({ name: "payment.charge", success: S.Struct({ receiptId: S.UUID }), execute: Effect.succeed({ receiptId: "00000000-0000-4000-8000-000000000010" }) });
const ReserveInventory = Activity.make({ name: "inventory.reserve", success: S.Struct({ reservationId: S.UUID }), execute: Effect.succeed({ reservationId: "00000000-0000-4000-8000-000000000011" }) });
const FulfillOrder = Workflow.make({ name: "FulfillOrder", payload: { orderId: S.UUID }, idempotencyKey: ({ orderId }) => orderId, success: S.Struct({ receiptId: S.UUID, reservationId: S.UUID }), error: S.Struct({ _tag: S.Literal("FulfillFailed"), message: S.String }) });

// --- [LAYERS] ----------------------------------------------------------------
const FulfillOrderLive = FulfillOrder.toLayer((payload) => Effect.gen(function* () {
  const charge = yield* Charge.execute.pipe(Workflow.withCompensation((value, _cause) => Effect.logWarning("payment.refund", { receiptId: value.receiptId, orderId: payload.orderId })));
  const reservation = yield* ReserveInventory.execute.pipe(Workflow.withCompensation((value, _cause) => Effect.logWarning("inventory.release", { reservationId: value.reservationId, orderId: payload.orderId })));
  return { receiptId: charge.receiptId, reservationId: reservation.reservationId } as const;
}));
```

Contracts:
- Each side effect registers compensation at the call site of the activity.
- Workflow idempotency key derives from business identity (`orderId`).
- Workflow success shape is assembled only from activity outputs.

Failure modes prevented:
- Hidden rollback logic outside the workflow graph.
- Non-deterministic retries without stable idempotency identity.
- Compensation paths that are not co-located with the forward action.

Escalate to:
- `services.md` and infra docs for runtime engine topology/deployment policy.

---
## [6][CLUSTER_ENTITY_TOPOLOGY]
>**Dictum:** *Entity protocol and singleton duties belong in one explicit layer graph with bounded leadership behavior.*

<br>

```ts
import * as Entity from "@effect/cluster/Entity";
import * as Singleton from "@effect/cluster/Singleton";
import * as Rpc from "@effect/rpc/Rpc";
import { Effect, Layer, Schedule, Schema as S } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------
const JobProgress = Rpc.make("job.progress", { payload: S.Struct({ jobId: S.UUID }), success: S.Struct({ pct: S.Int }), error: S.Struct({ _tag: S.Literal("JobMissing"), message: S.String }) });
const JobCancel =   Rpc.make("job.cancel", { payload: JobProgress.payload, success: S.Void, error: JobProgress.error });

// --- [LAYERS] ----------------------------------------------------------------
const JobEntity =       Entity.make("Job", [JobProgress, JobCancel]);
const JobEntityLive =   JobEntity.toLayer({ "job.progress": ({ payload }) => Effect.succeed({ pct: payload.jobId.length % 100 }), "job.cancel": () => Effect.void });
const RebalanceLeader = Singleton.make("cluster.rebalance", Effect.logDebug("cluster.rebalance.tick").pipe(Effect.repeat(Schedule.spaced("15 seconds"))));
const ClusterTopology = Layer.mergeAll(JobEntityLive, RebalanceLeader);
```

Contracts:
- Entity protocol is defined as explicit RPC capability set.
- Singleton duties are isolated as separately named leadership tasks.
- Cluster runtime graph is declared via layer composition, not implicit startup glue.

Failure modes prevented:
- Leadership behavior hidden in transport handlers.
- Entity responsibilities spread across unrelated modules.
- Runtime graphs that cannot be inspected from layer composition.

Escalate to:
- `surface.md` and infra docs for transport/server/deployment wiring.

---
## [7][OBSERVABILITY_POLICY_SURFACE]
>**Dictum:** *Telemetry policy is a stable contract: metric vocabulary, cardinality mapping, and exporter layer composition.*

<br>

```ts
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Otlp from "@effect/opentelemetry/Otlp";
import { Effect, Layer, Match, Metric, MetricLabel } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------
const syncTelemetryVocab = {
  label: { statusClass: "status_class" },
  resource: { serviceName: "portal-api" },
  statusClass: { class2xx: "2xx", class4xx: "4xx", class5xx: "5xx", other: "other" },
} as const;
const syncSignals = {
  requests: Metric.counter("tenant_sync_requests_total"),
  latency:  Metric.withNow(Metric.summaryTimestamp({ name: "tenant_sync_latency_ms", maxAge: "5 minutes", maxSize: 2048, error: 0.01, quantiles: [0.5, 0.9, 0.99] })),
} as const;
const statusClass = (status: number) => Match.value(status).pipe(Match.when((n) => n >= 200 && n < 300, () => syncTelemetryVocab.statusClass.class2xx), Match.when((n) => n >= 400 && n < 500, () => syncTelemetryVocab.statusClass.class4xx), Match.when((n) => n >= 500 && n < 600, () => syncTelemetryVocab.statusClass.class5xx), Match.orElse(() => syncTelemetryVocab.statusClass.other));

// --- [FUNCTIONS] -------------------------------------------------------------
const observeTenantSync = (status: number, durationMs: number) => Effect.all([Metric.increment(Metric.taggedWithLabels(syncSignals.requests, [MetricLabel.make(syncTelemetryVocab.label.statusClass, statusClass(status))])), Metric.update(syncSignals.latency, durationMs)], { concurrency: 2 });
const telemetryLayer = (cfg: { readonly baseUrl: string; readonly authorization: string; readonly serviceVersion: string }) => Otlp.layerJson({ baseUrl: cfg.baseUrl, headers: { authorization: cfg.authorization }, resource: { serviceName: syncTelemetryVocab.resource.serviceName, serviceVersion: cfg.serviceVersion } }).pipe(Layer.provide(FetchHttpClient.layer));
```

Contracts:
- Metric names and label vocabulary are bounded and reviewable.
- Status classification is canonicalized once before emission.
- Exporter layer is parameterized by explicit config payload.

Failure modes prevented:
- Cardinality blowups from free-form labels.
- Divergent status bucketing across call sites.
- Telemetry transport configuration hidden in ambient process state.

Escalate to:
- `observability.md` for tracing policy, dashboards, and alerts.

---
## [8][STM_LEDGER_COORDINATION]
>**Dictum:** *High-contention coordination stays deterministic when queue strategy, transactional mutation, and snapshot projection live in one STM rail.*

<br>

```ts
import { Chunk, Clock, DateTime, Effect, HashMap, Match, Option, Order, STM, TMap, TQueue } from "effect";

// --- [FUNCTIONS] -------------------------------------------------------------
const ledgerProgram = (policy: "bounded" | "dropping" | "sliding") => Effect.gen(function* () {
  const queue = yield* STM.commit(Match.value(policy).pipe(Match.when("bounded", () => TQueue.bounded<readonly [tenant: string, delta: bigint]>(128)), Match.when("dropping", () => TQueue.dropping<readonly [tenant: string, delta: bigint]>(128)), Match.when("sliding", () => TQueue.sliding<readonly [tenant: string, delta: bigint]>(128)), Match.exhaustive));
  const ledger = yield* STM.commit(TMap.fromIterable<string, bigint>([["tenant-a", 0n], ["tenant-b", 0n], ["tenant-c", 0n]]));
  yield* STM.commit(TQueue.offerAll(queue, [["tenant-a", 4n], ["tenant-b", -2n], ["tenant-c", 3n], ["tenant-a", -1n], ["tenant-b", 5n], ["tenant-c", -1n]]));
  const drain = STM.commit(TQueue.takeUpTo(queue, 64).pipe(STM.flatMap((items) => STM.forEach(items, ([tenant, delta]) => TMap.updateWith(ledger, tenant, (current) => Option.some(Option.getOrElse(current, () => 0n) + delta))))));
  yield* Effect.all([drain, drain, drain], { concurrency: 3 });
  const nowMs = yield* Clock.currentTimeMillis;
  const snapshot = yield* STM.commit(TMap.toHashMap(ledger));
  const ordered = Chunk.fromIterable(HashMap.toEntries(snapshot)).pipe(Chunk.sortWith(([tenant]) => tenant, Order.string), Chunk.toReadonlyArray);
  const totals = ordered.reduce((acc, [, delta]) => acc + delta, 0n);
  const asOf = DateTime.make(nowMs).pipe(Option.map(DateTime.formatIso), Option.getOrElse(() => "invalid-time"));
  return { asOf, ordered, totals, status: Match.value(totals >= 0n).pipe(Match.when(true, () => "balanced" as const), Match.when(false, () => "drift" as const), Match.exhaustive) } as const;
});
```

Contracts:
- Queue policy selection is exhaustive and value-driven.
- Ledger mutation occurs only inside committed STM transactions.
- Snapshot projection is ordered deterministically before externalization.

Failure modes prevented:
- Lost updates from non-transactional mutation paths.
- Non-deterministic snapshot order in downstream consumers.
- Queue behavior changes that bypass compile-time policy selection.

Escalate to:
- `concurrency.md` for fiber/queue runtime strategy beyond STM coordination.
