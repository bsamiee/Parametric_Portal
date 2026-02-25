# [H1][PERFORMANCE]

>**Dictum:** *Performance is an executable contract: define workload physics, enforce typed budget failures, and reject drift deterministically.*
<br>

Performance guidance in this reference owns workload shape, budget thresholds, and CI gate determinism; it does not own tracing topology or broad service lifecycle modeling. Every snippet is written as a compositional rail where measurements are first-class values, not logging side effects. Use this document to fail regressions early with typed evidence and reproducible execution surfaces.

---
## [1][BUDGET_REGISTRY_AND_WORKLOAD_MODELS]

>**Dictum:** *Budgets without a workload model are theater; workload without a metric namespace is noise.*

<br>

```ts
import { Metric } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const budget = {
  ingest: { p95Ms: 85, timeoutMs: 900, maxQueueDepth: 256 },
  emit:   { p95Ms: 65, timeoutMs: 700, maxQueueDepth: 192 },
} as const;
const workload = {
  ci: {
    items:        1600,
    cadence:      "2 millis",
    batchSize:    128,
    within:       "35 millis",
    warmupRuns:   [1] as const,
    measuredRuns: [1, 2, 3, 4] as const,
  },
  local: {
    items:        600,
    cadence:      "1 millis",
    batchSize:    128,
    within:       "35 millis",
    warmupRuns:   [1] as const,
    measuredRuns: [1, 2] as const,
  },
} as const;
const perf = {
  operationAttempts: Metric.counter("perf_operation_attempts_total"),
  operationFailures: Metric.frequency("perf_operation_failures_total", { preregisteredWords: ["throttle", "upstream", "terminal"] }),
  operationLatency:  Metric.timerWithBoundaries("perf_operation_latency_seconds", [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 3]),
  queueDepth:        Metric.gauge("perf_queue_depth"),
  queueDropped:      Metric.counter("perf_queue_dropped_total"),
  queueDrained:      Metric.counter("perf_queue_drained_total"),
  gateP95Ms:         Metric.gauge("perf_gate_p95_ms"),
  gateLatency:       Metric.timerWithBoundaries("perf_gate_latency_seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 2, 5]),
  gateFailures:      Metric.frequency("perf_gate_failures_total", { preregisteredWords: ["ingest", "emit"] }),
  cacheHits:         Metric.gauge("perf_cache_hits"),
  poolInvalidations: Metric.counter("perf_pool_invalidations_total"),
} as const;

export { budget, perf, workload };
```

**Ownership laws:**<br>
- this section defines canonical default budgets/workload profiles; standalone snippets may use local profiles for independent compilation,
- histogram boundaries are SLO-resolution policy and are versioned with budgets,
- local and CI workloads are both declared and intentionally non-equivalent.

---
## [2][TYPED_OPERATION_BUDGET_ENFORCEMENT]

>**Dictum:** *Count attempts before work, classify failures on typed rails, and never recover through unsafe casts.*

<br>

```ts
import { Data, Effect, Match, Metric } from "effect";

const perfVocab = {
  label: { operation: "operation" },
  operation: { emit: "emit", ingest: "ingest" },
  reason: { terminal: "terminal", throttle: "throttle", upstream: "upstream" },
  selector: { ok: "ok", terminal: "terminal", throttle: "throttle", upstream: "upstream" },
} as const;
type OpErrorReason = (typeof perfVocab.reason)[keyof typeof perfVocab.reason];
type OperationName = (typeof perfVocab.operation)[keyof typeof perfVocab.operation];
type Selector = (typeof perfVocab.selector)[keyof typeof perfVocab.selector];

// --- [ERRORS] ----------------------------------------------------------------

class OpError extends Data.TaggedError("OpError")<{
  readonly reason: OpErrorReason;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const operationAttempts = Metric.counter("perf_operation_attempts_total");
const operationFailures = Metric.frequency("perf_operation_failures_total", { preregisteredWords: [perfVocab.reason.throttle, perfVocab.reason.upstream, perfVocab.reason.terminal] });
const operationLatency =  Metric.timerWithBoundaries("perf_operation_latency_seconds", [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 3]);

// --- [FUNCTIONS] -------------------------------------------------------------

const raw = (selector: Selector) =>
  Match.value(selector).pipe(
    Match.when(perfVocab.selector.ok, () => Effect.succeed(perfVocab.selector.ok)),
    Match.when(perfVocab.selector.throttle, () => Effect.fail(new OpError({ reason: perfVocab.reason.throttle }))),
    Match.when(perfVocab.selector.upstream, () => Effect.fail(new OpError({ reason: perfVocab.reason.upstream }))),
    Match.when(perfVocab.selector.terminal, () => Effect.fail(new OpError({ reason: perfVocab.reason.terminal }))),
    Match.exhaustive,
  );
const classify = (error: OpError) => error.reason;
const runMeasured = (operation: OperationName, selector: Selector) =>
  Metric.increment(Metric.tagged(operationAttempts, perfVocab.label.operation, operation)).pipe(
    Effect.zipRight(raw(selector)),
    Metric.trackDuration(Metric.tagged(operationLatency, perfVocab.label.operation, operation)),
    Metric.trackErrorWith(Metric.tagged(operationFailures, perfVocab.label.operation, operation), classify),
  );
```

**Enforcement laws:**<br>
- denominator metrics (`attempts`) are side-channel independent and must execute even on failure,
- failure vocabulary is closed and pre-registered to avoid cardinality drift,
- this section owns failure classification for budgeting, not cross-cutting trace/log projection.

---
## [3][QUEUE_SATURATION_WITH_TERMINATION_GUARANTEE]

>**Dictum:** *Backpressure guidance is invalid unless the drain path has a deterministic termination contract.*

<br>

```ts
import { Chunk, Effect, Fiber, Match, Metric, Queue, Schedule, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const queueDepth =   Metric.gauge("perf_queue_depth");
const queueDropped = Metric.counter("perf_queue_dropped_total");
const queueDrained = Metric.counter("perf_queue_drained_total");
const shape = { items: 1600, batchSize: 128, within: "35 millis", maxQueueDepth: 256 } as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const runSaturation = Effect.scoped(
  Effect.gen(function* () {
    const queue = yield* Queue.dropping<number>(shape.maxQueueDepth);
    const offerMeasured = (n: number) =>
      Queue.offer(queue, n).pipe(
        Effect.tap((accepted) =>
          Match.value(accepted).pipe(
            Match.when(true, () => Effect.void),
            Match.orElse(() => Metric.increment(queueDropped)),
          )),
      );
    const depthSampler = yield* Stream.repeatEffect(Queue.size(queue)).pipe(
      Stream.schedule(Schedule.spaced("25 millis")),
      Stream.runForEach((depth) => Metric.set(queueDepth, depth)),
      Effect.forkScoped,
    );
    const producer = yield* Stream.range(1, shape.items).pipe(
      Stream.runForEach(offerMeasured),
      Effect.ensuring(Queue.shutdown(queue)),
      Effect.forkScoped,
    );
    const drained = yield* Stream.fromQueue(queue, { maxChunkSize: shape.batchSize }).pipe(
      Stream.groupedWithin(shape.batchSize, shape.within),
      Stream.tap((batch) => Metric.incrementBy(queueDrained, Chunk.size(batch))),
      Stream.runCollect,
    );
    yield* Fiber.join(producer);
    yield* Fiber.interrupt(depthSampler);
    return drained;
  }),
);
```

**Saturation laws:**<br>
- `Queue.offer` result is the loss boundary for dropping queues and must be captured,
- depth signals without offer outcomes are incomplete under burst pressure,
- termination must be scope-bounded and explicit; `runCollect` without lifecycle closure is a defect.

---
## [4][PARALLELISM_SHAPING_AND_CHUNK_ECONOMICS]

>**Dictum:** *Concurrency, cadence, and chunk boundaries are one policy surface; tuning one in isolation is invalid.*

<br>

```ts
import { Chunk, Effect, Metric, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const transformOut =     Metric.counter("perf_transform_out_total");
const transformLatency = Metric.timerWithBoundaries("perf_transform_stage_seconds", [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1]);

// --- [FUNCTIONS] -------------------------------------------------------------

const square = (n: number) => n * n;
const shaped = Stream.range(1, 4000).pipe(
  Stream.rechunk(256),
  Stream.mapChunks((batch) => Chunk.map(batch, square)),
  Stream.mapChunksEffect((batch) =>
    Effect.succeed(batch).pipe(
      Metric.trackDuration(transformLatency),
      Effect.tap(() => Metric.incrementBy(transformOut, Chunk.size(batch))),
    ),
  ),
);
const runShaped = shaped.pipe(Stream.runFold(0, (count, _elem) => count + 1));
```

**Shaping laws:**<br>
- millisecond/second duration literals may stay as strings for compact policy readability,
- `Stream.mapChunks`/`Stream.mapChunksEffect` keep hot-path transforms allocation-aware and chunk-local,
- throughput should be measured per chunk, not per element, on hot paths.

---
## [5][REQUEST_BATCHING_WITH_PLATFORM_HTTPCLIENT]

>**Dictum:** *Remote latency guidance must include data-source batching and one transformed client choke point.*

<br>

```ts
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpClientResponse from "@effect/platform/HttpClientResponse";
import { Data, Effect, HashMap, Match, Metric, Option, Request, RequestResolver, Schedule, Schema } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class UsageError extends Data.TaggedError("UsageError")<{
  readonly reason: "decode" | "http" | "transport";
}> {}
class FetchUsage extends Request.TaggedClass("FetchUsage")<{
  readonly tenantId: string;
  readonly used:     number;
}, UsageError, {readonly tenantId: string;}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const usageSchema =      Schema.Array(Schema.Struct({ tenantId: Schema.String, used: Schema.Number }));
const httpBatchLatency = Metric.timerWithBoundaries("perf_http_batch_seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 2]);

// --- [FUNCTIONS] -------------------------------------------------------------

const resolver = RequestResolver.fromEffectTagged<FetchUsage>()({
  FetchUsage: (requests) =>
    HttpClient.HttpClient.pipe(
      Effect.map((base) =>
    base.pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://svc.internal")),
      HttpClient.withTracerPropagation(true),
      HttpClient.retry({ schedule: Schedule.exponential("50 millis"), times: 3 }),
          HttpClient.filterStatusOk,
        )),
      Effect.flatMap((client) =>
        client.get("/usage", { urlParams: requests.map((request) => ["tenantId", request.tenantId] as const) }).pipe(
          Effect.flatMap(HttpClientResponse.schemaBodyJson(usageSchema)),
          Effect.mapError((error) =>
            Match.value(error._tag).pipe(
              Match.when("ParseError", () => new UsageError({ reason: "decode" })),
              Match.when("ResponseError", () => new UsageError({ reason: "http" })),
              Match.orElse(() => new UsageError({ reason: "transport" })),
            )),
          Effect.flatMap((rows) => {
            const byTenant = HashMap.fromIterable(rows.map((row) => [row.tenantId, row.used] as const));
            return Effect.forEach(requests, (request) =>
              Option.match(HashMap.get(byTenant, request.tenantId), {
                onNone: () => Effect.fail(new UsageError({ reason: "decode" })),
                onSome: (used) => Effect.succeed({ tenantId: request.tenantId, used }),
              }));
          }),
        )),
    ),
}).pipe(RequestResolver.batchN(64));
const loadUsage = (tenantId: string) =>
  Effect.request(new FetchUsage({ tenantId }), RequestResolver.contextFromEffect(resolver)).pipe(
    Metric.trackDuration(httpBatchLatency),
  );
const tenantIds = ["acme", "globex", "initech", "umbrella"] as const;
const runBatchedUsage = Effect.gen(function* () {
  const cache = yield* Request.makeCache({ capacity: 10_000, timeToLive: "3 minutes" });
  return yield* Effect.forEach(tenantIds, loadUsage, { concurrency: "unbounded" }).pipe(
    Effect.withRequestBatching(true),
    Effect.withRequestCaching(true),
    Effect.withRequestCache(cache),
  );
}).pipe(Effect.provide(FetchHttpClient.layer));
```

**Boundary laws:**<br>
- request batching belongs to performance only when tied to measurable latency/cost outcomes,
- client transformation is centralized to keep retry/timeout/projection policy coherent,
- deep trace/export topology is out of scope here and belongs to `observability.md`.

---
## [6][STM_DRIFT_LEDGER_FOR_CACHE_AND_POOL_POLICY]

>**Dictum:** *Cache and pool policy tuning is incomplete unless drift is measured atomically under concurrency.*

<br>

```ts
import { randomUUID } from "node:crypto";
import { Data, Effect, Match, Metric, Pool, STM, TMap, Schedule } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "timeout" | "upstream";
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const cacheHits =         Metric.gauge("perf_cache_hits");
const poolInvalidations = Metric.counter("perf_pool_invalidations_total");

// --- [FUNCTIONS] -------------------------------------------------------------

const cachePoolPolicy = Effect.scoped(
  Effect.gen(function* () {
    const ledger = yield* STM.commit(TMap.make(
      ["requests", 0], ["misses", 0], ["invalidations", 0],
    ));
    const cachedToken = yield* Effect.cachedWithTTL(
      Effect.sync(randomUUID).pipe(
        Effect.tap(() => STM.commit(TMap.merge(ledger, "misses", 1, (x, y) => x + y))),
      ),
      "15 seconds",
    );
    const pool = yield* Pool.makeWithTTL({
      acquire: Effect.sync(() => ({ id: randomUUID() } as const)),
      min: 1,
      max: 8,
      concurrency: 2,
      targetUtilization: 0.7,
      timeToLive: "30 seconds",
      timeToLiveStrategy: "usage",
    });
    const request = (n: number) =>
      STM.commit(TMap.merge(ledger, "requests", 1, (x, y) => x + y)).pipe(
        Effect.zipRight(cachedToken),
        Effect.flatMap((token) =>
          Effect.scoped(
            Pool.get(pool).pipe(
              Effect.flatMap((resource) => {
                const invalidateIfNeeded = Match.value(n % 9 === 0).pipe(
                  Match.when(true, () =>
                    Pool.invalidate(pool, resource).pipe(
                      Effect.zipRight(Metric.increment(poolInvalidations)),
                      Effect.zipRight(STM.commit(TMap.merge(ledger, "invalidations", 1, (x, y) => x + y))),
                    )),
                  Match.orElse(() => Effect.void),
                );
                const failIfUpstream = Match.value(n % 17 === 0).pipe(
                  Match.when(true, () => Effect.fail(new TransportError({ reason: "upstream" }))),
                  Match.orElse(    () => Effect.void),
                );
                return Effect.sleep("2 millis").pipe(
                  Effect.zipRight(invalidateIfNeeded),
                  Effect.zipRight(failIfUpstream),
                  Effect.map(() => ({ token, resourceId: resource.id, n } as const)),
                );
              }),
            ),
          )),
        Effect.timeoutFail({ duration: "900 millis", onTimeout: () => new TransportError({ reason: "timeout" }) }),
        Effect.retry({ schedule: Schedule.exponential("20 millis"), times: 4, until: (error: TransportError) => error.reason === "upstream" }),
      );
    yield* Effect.all(Array.from({ length: 120 }, (_, index) => request(index + 1)), { concurrency: 24 });
    const summary = yield* STM.gen(function* () {
      const requests = yield* TMap.getOrElse(ledger, "requests", () => 0);
      const misses = yield* TMap.getOrElse(ledger, "misses", () => 0);
      const invalidations = yield* TMap.getOrElse(ledger, "invalidations", () => 0);
      return { requests, misses, invalidations } as const;
    }).pipe(STM.commit);
    yield* Metric.set(cacheHits, summary.requests - summary.misses);
    return summary;
  }),
);
```

**Drift laws:**<br>
- shared counters for contention surfaces are transactional state, not mutable process variables,
- retry predicates must be typed and explicit (`until: (error: TransportError) => ...`),
- transient timeout rails retry; terminal upstream rails stop retry,
- hit accounting is derived from request/miss rails, not guessed from call frequency.

---
## [7][DETERMINISTIC_CI_GATES_WITH_TYPED_FAILURES]

>**Dictum:** *A gate is valid only when sample policy is explicit, percentile math is reproducible, and failures are typed artifacts.*

<br>

```ts
import { Array as Arr, Chunk, Data, Duration, Effect, Match, Metric, Schedule, Stream } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class BudgetExceeded extends Data.TaggedError("BudgetExceeded")<{
  readonly operation:     "ingest" | "emit";
  readonly measuredP95Ms: number;
  readonly budgetMs:      number;
}> {}

// --- [CONSTANTS] -------------------------------------------------------------

const budget = { ingest: { p95Ms: 140 }, emit: { p95Ms: 110 } } as const;
const workload = {
  items:        80,
  cadence:      "1 millis",
  batchSize:    32,
  within:       "20 millis",
  warmupRuns:   Arr.makeBy(8, (index) => index + 1),
  measuredRuns: Arr.makeBy(64, (index) => index + 1),
} as const;
const gateP95Ms =    Metric.gauge("perf_gate_p95_ms");
const gateCycle =    Metric.timerWithBoundaries("perf_gate_cycle_seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 1, 2, 5]);
const gateFailures = Metric.frequency("perf_gate_failures_total", { preregisteredWords: ["ingest", "emit"] });

// --- [FUNCTIONS] -------------------------------------------------------------

const runWorkload = (shape: typeof workload) =>
  Stream.range(1, shape.items).pipe(
    Stream.schedule(Schedule.spaced(shape.cadence)),
    Stream.groupedWithin(shape.batchSize, shape.within),
    Stream.map(Chunk.size),
    Stream.runFold(0, (sum, size) => sum + size),
  );
const runSample = (shape: typeof workload) =>
  runWorkload(shape).pipe(
    Effect.timed,
    Effect.map(([elapsed]) => Duration.toMillis(elapsed)),
  );
const gate = (operation: "ingest" | "emit", budgetMs: number) =>
    Effect.forEach(workload.warmupRuns, () => runSample(workload), { concurrency: 1, discard: true }).pipe(
    Effect.zipRight(Effect.forEach(workload.measuredRuns, () => runSample(workload), { concurrency: 1 })),
    Effect.map((samples) => [...samples].sort((a, b) => a - b)),
    Effect.flatMap((sorted) => Effect.fromNullable(sorted.at(Math.max(0, Math.ceil(sorted.length * 0.95) - 1))).pipe(Effect.orDie)),
    Effect.tap((p95) => Metric.set(Metric.tagged(gateP95Ms, "operation", operation), p95)),
    Metric.trackDuration(Metric.tagged(gateCycle, "operation", operation)),
    Effect.flatMap((p95) =>
      Match.value(p95 <= budgetMs).pipe(
        Match.when(true, () => Effect.succeed({ operation, p95 } as const)),
        Match.orElse(() =>
          Metric.update(Metric.tagged(gateFailures, "operation", operation), operation).pipe(
            Effect.zipRight(Effect.fail(new BudgetExceeded({ operation, measuredP95Ms: p95, budgetMs }))),
          )),
      )),
  );
const ciGate = Effect.all([
  gate("ingest", budget.ingest.p95Ms),
  gate("emit",   budget.emit.p95Ms  ),
], { concurrency: 1 });
```

**Gate laws:**<br>
- warmup and measured runs are separate rails and both are versioned with workload,
- gate metrics are operation-tagged to prevent concurrent overwrite noise,
- percentile violations fail on a typed error, producing deterministic CI evidence.
