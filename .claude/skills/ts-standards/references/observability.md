# [H1][OBSERVABILITY]
>**Dictum:** *Observability is a deterministic projection contract: one operation rail, one bounded telemetry vocabulary, one failure-preserving cause matrix.*

<br>

This chapter owns projection and transport composition for traces, metrics, and logs in Effect systems. It does not own domain failure taxonomy (`errors.md`), route ownership (`surface.md`), or throughput tuning policy (`performance.md`). Every section is executable reference material for production-grade telemetry decisions.

---
## [1][OPERATION_RAIL_AND_METRIC_ALGEBRA]
>**Dictum:** *One operation identifier drives all channels: span name, metric dimensions, and structured log vocabulary.*

<br>

- Execution law: canonicalize operation and rail once, then reuse the same dimension set in span, metrics, and logs.
- Failure law: classify outcomes from `Exit`/`Cause`, never from ad-hoc branch-local status strings.
- Ownership law: this section defines projection discipline, not domain error semantics (`errors.md`).

```ts
import { Cause, Effect, Exit, Metric, MetricLabel, Option } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const telemetryVocab = {
  attr: { operation: "obs.operation", rail: "obs.rail" },
  event: { outcome: "obs.outcome", profileLoaded: "profile.loaded" },
  label: { operation: "operation", rail: "rail", status: "status" },
  operation: {
    httpRequest:      "http.request",
    jobsReconcile:    "jobs.reconcile",
    usersLoadProfile: "users.load-profile",
    unknown:          "operation.unknown",
  },
  outcome: { defect: "defect", error: "error", interrupt: "interrupt", ok: "ok" },
  rail: { job: "job", rpc: "rpc", unknown: "unknown" },
} as const;
const operationProjection = {
  [telemetryVocab.operation.httpRequest]: telemetryVocab.operation.httpRequest,
  [telemetryVocab.operation.jobsReconcile]: telemetryVocab.operation.jobsReconcile,
  [telemetryVocab.operation.usersLoadProfile]: telemetryVocab.operation.usersLoadProfile,
} as const;
const railProjection = {
  [telemetryVocab.rail.job]: telemetryVocab.rail.job,
  [telemetryVocab.rail.rpc]: telemetryVocab.rail.rpc,
} as const;
const signal = {
  defects:    Metric.frequency("operation_defects_total"),
  durationMs: Metric.timerWithBoundaries("operation_duration_ms", [1, 10, 100, 1_000, 10_000]),
  errors:     Metric.frequency("operation_errors_total"),
  outcomes:   Metric.counter("operation_outcomes_total"),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

type TelemetryOperation = (typeof operationProjection)[keyof typeof operationProjection] | typeof telemetryVocab.operation.unknown;
type TelemetryRail = (typeof railProjection)[keyof typeof railProjection] | typeof telemetryVocab.rail.unknown;
type TelemetryOutcome = (typeof telemetryVocab.outcome)[keyof typeof telemetryVocab.outcome];

const labels = (operation: TelemetryOperation, rail: TelemetryRail) =>
  [MetricLabel.make(telemetryVocab.label.operation, operation), MetricLabel.make(telemetryVocab.label.rail, rail)] as const;
const canonicalRail = (rail: string): TelemetryRail =>
  Option.fromNullable((railProjection as Record<string, TelemetryRail>)[rail]).pipe(Option.getOrElse(() => telemetryVocab.rail.unknown));
const outcomeFromCause = (cause: Cause.Cause<unknown>): TelemetryOutcome =>
  Cause.match(cause, {
    onDie:        () => telemetryVocab.outcome.defect,
    onEmpty:           telemetryVocab.outcome.error,
    onFail:       () => telemetryVocab.outcome.error,
    onInterrupt:  () => telemetryVocab.outcome.interrupt,
    onParallel:   () => telemetryVocab.outcome.error,
    onSequential: () => telemetryVocab.outcome.error,
  });
const canonicalOperation = (operation: string): TelemetryOperation =>
  Option.fromNullable((operationProjection as Record<string, TelemetryOperation>)[operation]).pipe(Option.getOrElse(() => telemetryVocab.operation.unknown));
const observeOperation = <A, E, R>(operation: string, rail: string, program: Effect.Effect<A, E, R>) => {
  const op = canonicalOperation(operation);
  const railTag = canonicalRail(rail);
  const dimension = labels(op, railTag);
  const duration = Metric.taggedWithLabels(signal.durationMs, dimension);
  const errors = Metric.taggedWithLabels(signal.errors, dimension);
  const defects = Metric.taggedWithLabels(signal.defects, dimension);
  return program.pipe(
    Effect.withSpan(op, { attributes: { [telemetryVocab.attr.operation]: op, [telemetryVocab.attr.rail]: railTag } }),
    Metric.trackDuration(duration),
    Metric.trackErrorWith(errors, () => telemetryVocab.outcome.error),
    Metric.trackDefectWith(defects, () => telemetryVocab.outcome.defect),
    Effect.onExit((exit) =>
      Exit.match(exit, {
        onSuccess: () =>
          Metric.increment(Metric.taggedWithLabels(signal.outcomes, [...dimension, MetricLabel.make(telemetryVocab.label.status, telemetryVocab.outcome.ok)])).pipe(
            Effect.zipRight(Effect.logInfo(telemetryVocab.event.outcome, { operation: op, rail: railTag, outcome: telemetryVocab.outcome.ok })),
          ),
        onFailure: (cause) => {
          const outcome = outcomeFromCause(cause);
          return Metric.increment(Metric.taggedWithLabels(signal.outcomes, [...dimension, MetricLabel.make(telemetryVocab.label.status, outcome)])).pipe(
            Effect.zipRight(Effect.logError(telemetryVocab.event.outcome, { operation: op, rail: railTag, outcome })),
          );
        },
      }),
    ),
  );
};
const loadProfile = (userId: string) => observeOperation(telemetryVocab.operation.usersLoadProfile, telemetryVocab.rail.rpc, Effect.logInfo(telemetryVocab.event.profileLoaded, { userId }).pipe(Effect.as(userId)));
```

Projection rules stay deterministic: operation and rail are finite vocabularies, unknown values collapse to explicit sentinel values, and outcome values are bounded to `ok|error|defect|interrupt`. Raw identifiers and free-form strings never become metric dimensions. This keeps metric cardinality stable while preserving operation-level forensic power through structured logs.

---
## [2][SCOPED_CORRELATION_AND_OPTIONAL_SPAN_SAFETY]
>**Dictum:** *Correlation is scope-bound, inherited by rails, and safe when a span context is absent.*

<br>

- Correlation writes once at ingress and propagates by scope; inner rails consume but do not mutate correlation shape.
- Span enrichment stays optional-safe because detached/test rails can run without an active span.
- Metrics and logs share the same scoped keys so incident queries stay cross-channel joinable.

```ts
import { Clock, DateTime, Effect, MetricLabel, Option } from "effect";

const withCorrelation =
  (requestClass: "batch" | "interactive", tenantTier: "enterprise" | "free" | "pro") =>
  <A, E, R>(program: Effect.Effect<A, E, R>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const startedAtNanos = yield* Clock.currentTimeNanos;
        const startedAtIso = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
        yield* Effect.annotateLogsScoped({ requestClass, startedAtIso, tenantTier });
        yield* Effect.labelMetricsScoped([MetricLabel.make("request_class", requestClass), MetricLabel.make("tenant_tier", tenantTier)]);
        return yield* program.pipe(
          Effect.withSpan("request.lifecycle", { attributes: { "request.class": requestClass, "tenant.tier": tenantTier, "request.started_at": startedAtIso } }),
          Effect.tap(() =>
            Effect.option(Effect.currentSpan).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => Effect.void,
                  onSome: (span) => Effect.sync(() => span.event("request.correlation", startedAtNanos, { "request.class": requestClass, "tenant.tier": tenantTier })),
                }),
              ),
            ),
          ),
        );
      }),
    );
const requestProgram = withCorrelation("interactive", "pro")(Effect.logInfo("request.accepted"));
```

Scope is the only writable correlation boundary: ingress writes once, downstream rails inherit. Optional span access is mandatory because context-free rails can run in tests, fibers, and detached execution paths. The pattern keeps metrics/logs/span attributes consistent without relying on ambient global state.

---
## [3][CAUSE_PROJECTION_MATRIX_AND_ERROR_SEMANTICS]
>**Dictum:** *Cause projection is compact and bounded for spans/metrics, verbose and lossless in logs.*

<br>

- Channel matrix: spans get compact bounded keys, metrics get bounded vocab values, logs keep full causal detail.
- Composition law: `parallel` and `sequential` preserve left/right shape in the compact projection.
- Ownership law: this section projects causes; domain failure modeling remains in `errors.md`.

```ts
import { Cause, Effect, HashMap, Metric, Option } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const errorTopology = Metric.frequency("operation_error_topology");
const causeFingerprintVocab = {
  key: {
    composition: "error.composition",
    kind: "error.kind",
    leftKind: "error.left.kind",
    present: "error.present",
    rightKind: "error.right.kind",
  },
  value: {
    none: "none",
    present: { no: "false", yes: "true" },
  },
} as const;
type FingerprintKey = (typeof causeFingerprintVocab.key)[keyof typeof causeFingerprintVocab.key];

// --- [FUNCTIONS] -------------------------------------------------------------

const kind = (map: HashMap.HashMap<FingerprintKey, string>) =>
  HashMap.get(map, causeFingerprintVocab.key.kind).pipe(Option.getOrElse(() => causeFingerprintVocab.value.none));
const composition = (map: HashMap.HashMap<FingerprintKey, string>) =>
  HashMap.get(map, causeFingerprintVocab.key.composition).pipe(Option.getOrElse(() => causeFingerprintVocab.value.none));
const fingerprint = (kind: string, composition: string, leftKind: string, rightKind: string, present: boolean) =>
  HashMap.fromIterable<FingerprintKey, string>([
    [causeFingerprintVocab.key.kind, kind],
    [causeFingerprintVocab.key.composition, composition],
    [causeFingerprintVocab.key.leftKind, leftKind],
    [causeFingerprintVocab.key.rightKind, rightKind],
    [causeFingerprintVocab.key.present, present ? causeFingerprintVocab.value.present.yes : causeFingerprintVocab.value.present.no],
  ]);
const causeFingerprint = (cause: Cause.Cause<unknown>) =>
  Cause.match(cause, {
    onDie:        () => fingerprint("defect",    "none", "none", "none", true ),
    onEmpty:            fingerprint("none",      "none", "none", "none", false),
    onFail:       () => fingerprint("failure",   "none", "none", "none", true ),
    onInterrupt:  () => fingerprint("interrupt", "none", "none", "none", true ),
    onParallel:   (left, right) => fingerprint("parallel", "parallel",     kind(left), kind(right), true),
    onSequential: (left, right) => fingerprint("sequential", "sequential", kind(left), kind(right), true),
  });
const annotateFailure = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.tapErrorCause((cause) =>
      Effect.gen(function* () {
        const compact = causeFingerprint(cause);
        yield* Effect.annotateCurrentSpan(Object.fromEntries(HashMap.toEntries(compact)));
        yield* Metric.update(Metric.tagged(errorTopology, "composition", composition(compact)), kind(compact));
        yield* Effect.logError("operation.failed", { compact: HashMap.toEntries(compact) });
      }),
    ),
  );
const unstableRail = annotateFailure(Effect.fail("network.timeout"));
```

Projection policy is explicit: spans receive bounded keys, metrics receive bounded value vocabularies, and logs keep compact deterministic fingerprints by default. Parallel/sequential composition keeps left/right kind attribution, preventing merge loss during fan-out and retry graphs.

---
## [4][BOUNDARY_INSTRUMENTATION_HTTP]
>**Dictum:** *Boundary observability consumes canonical route templates and emits status-class telemetry without branchy adapters.*

<br>

- Input contract: `routeTemplate` is already canonical from `surface.md`; this section does not derive routes from URLs.
- Boundary law: active gauge lifecycle, duration timing, and request counters are emitted from one composed rail.
- Status law: status class is bounded (`2xx|4xx|5xx|other|unknown`) and aligned across span+metric dimensions.

```ts
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpMiddleware from "@effect/platform/HttpMiddleware";
import { Effect, Exit, Layer, Match, Metric, MetricLabel, Option } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const httpVocab = {
  attr: { method: "http.request.method", route: "http.route" },
  label: { method: "method", route: "route", statusClass: "status_class", outcome: "outcome" },
  method: { DELETE: "DELETE", GET: "GET", HEAD: "HEAD", OTHER: "OTHER", PATCH: "PATCH", POST: "POST", PUT: "PUT" },
  outcome: { error: "error", ok: "ok" },
  route: { health: "/health", ready: "/ready" },
  span: { client: "http.client", prefix: "http." },
  statusClass: { class2xx: "2xx", class4xx: "4xx", class5xx: "5xx", other: "other", unknown: "unknown" },
} as const;
const methodProjection = {
  [httpVocab.method.DELETE]: httpVocab.method.DELETE,
  [httpVocab.method.GET]: httpVocab.method.GET,
  [httpVocab.method.HEAD]: httpVocab.method.HEAD,
  [httpVocab.method.PATCH]: httpVocab.method.PATCH,
  [httpVocab.method.POST]: httpVocab.method.POST,
  [httpVocab.method.PUT]: httpVocab.method.PUT,
} as const;
const httpSignal = {
  active:     Metric.gauge("http_requests_active"),
  durationMs: Metric.timerWithBoundaries("http_request_duration_ms", [1, 10, 100, 1_000, 10_000]),
  requests:   Metric.counter("http_requests_total"),
} as const;

// --- [LAYERS] ----------------------------------------------------------------

const inboundTracingPolicy = Layer.empty.pipe(HttpMiddleware.withTracerDisabledWhen((request) => request.url.startsWith(httpVocab.route.health) || request.url.startsWith(httpVocab.route.ready)));
const outboundClient = Effect.map(HttpClient.HttpClient, HttpClient.withSpanNameGenerator(() => httpVocab.span.client)).pipe(Effect.map(HttpClient.withTracerDisabledWhen((request) => request.url.endsWith(httpVocab.route.health))));

// --- [FUNCTIONS] -------------------------------------------------------------

type HttpMethod = (typeof methodProjection)[keyof typeof methodProjection] | typeof httpVocab.method.OTHER;
type HttpStatusClass = (typeof httpVocab.statusClass)[keyof typeof httpVocab.statusClass];

const statusClass = (status: number): HttpStatusClass =>
  Match.value(status).pipe(
    Match.when((n) => n >= 200 && n < 300, () => httpVocab.statusClass.class2xx),
    Match.when((n) => n >= 400 && n < 500, () => httpVocab.statusClass.class4xx),
    Match.when((n) => n >= 500 && n < 600, () => httpVocab.statusClass.class5xx),
    Match.orElse(() => httpVocab.statusClass.other),
  );
const canonicalMethod = (method: string): HttpMethod =>
  Option.fromNullable((methodProjection as Record<string, HttpMethod>)[method.toUpperCase()]).pipe(Option.getOrElse(() => httpVocab.method.OTHER));
const observeHttpBoundary = <A extends { status: number }, E, R>(method: string, routeTemplate: string, program: Effect.Effect<A, E, R>) => {
  const methodTag = canonicalMethod(method);
  const baseLabels = [MetricLabel.make(httpVocab.label.method, methodTag), MetricLabel.make(httpVocab.label.route, routeTemplate)] as const;
  return Effect.scoped(
    Effect.acquireRelease(Metric.increment(httpSignal.active), () => Metric.incrementBy(httpSignal.active, -1)).pipe(
      Effect.flatMap(() => program),
      Effect.withSpan(`${httpVocab.span.prefix}${methodTag.toLowerCase()}`, { attributes: { [httpVocab.attr.method]: methodTag, [httpVocab.attr.route]: routeTemplate } }),
      Metric.trackDuration(Metric.taggedWithLabels(httpSignal.durationMs, baseLabels)),
      Effect.onExit((exit) =>
        Exit.match(exit, {
          onSuccess: (response) => Metric.increment(Metric.taggedWithLabels(httpSignal.requests, [...baseLabels, MetricLabel.make(httpVocab.label.statusClass, statusClass(response.status)), MetricLabel.make(httpVocab.label.outcome, httpVocab.outcome.ok)])),
          onFailure: () => Metric.increment(Metric.taggedWithLabels(httpSignal.requests, [...baseLabels, MetricLabel.make(httpVocab.label.statusClass, httpVocab.statusClass.unknown), MetricLabel.make(httpVocab.label.outcome, httpVocab.outcome.error)])),
        }),
      ),
    ),
  );
};
```

Route production belongs to `surface.md`; this chapter consumes pre-shaped route templates and projects telemetry at the HTTP boundary. Status-class bucketing stays bounded and queryable (`2xx|4xx|5xx|other|unknown`) while span and metric dimensions remain aligned.

---
## [5][PROPAGATION_AND_OTLP_TOPOLOGY_DECISIONS]
>**Dictum:** *Topology is explicit policy: choose unified OTLP layer for compact setup, split layers for transport isolation.*

<br>

- Unified mode minimizes wiring and suits single-collector deployments with shared retry/backoff behavior.
- Split mode isolates logger/metrics/tracer exporters for independent transport and failure blast-radius control.
- Ownership law: this section chooses telemetry transport topology; SLO budgets and throughput policy remain in `performance.md`.

```ts
import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import * as Otlp from "@effect/opentelemetry/Otlp";
import * as OtlpLogger from "@effect/opentelemetry/OtlpLogger";
import * as OtlpMetrics from "@effect/opentelemetry/OtlpMetrics";
import * as OtlpSerialization from "@effect/opentelemetry/OtlpSerialization";
import * as OtlpTracer from "@effect/opentelemetry/OtlpTracer";
import { Layer, Match } from "effect";

const telemetryLayer = (mode: "split" | "unified", collector: string, token: string, serviceName: string, serviceVersion: string) => {
  const headers = { authorization: `Bearer ${token}` };
  const resource = { serviceName, serviceVersion };
  return Match.value(mode).pipe(
    Match.when("unified", () =>
      Otlp.layerProtobuf({ baseUrl: collector, headers, loggerExcludeLogSpans: true, loggerExportInterval: "1 second", maxBatchSize: 512, metricsExportInterval: "10 seconds", resource, shutdownTimeout: "5 seconds", tracerExportInterval: "3 seconds" }).pipe(
        Layer.provide(FetchHttpClient.layer),
      ),
    ),
    Match.when("split", () =>
      Layer.mergeAll(
        OtlpLogger.layer({ url: `${collector}/v1/logs`, headers, excludeLogSpans: true, exportInterval: "1 second", maxBatchSize: 512, resource, shutdownTimeout: "5 seconds" }),
        OtlpMetrics.layer({ url: `${collector}/v1/metrics`, headers, exportInterval: "10 seconds", resource, shutdownTimeout: "5 seconds" }),
        OtlpTracer.layer({ url: `${collector}/v1/traces`, headers, exportInterval: "3 seconds", maxBatchSize: 512, resource, shutdownTimeout: "5 seconds" }),
      ).pipe(Layer.provide(OtlpSerialization.layerProtobuf), Layer.provide(FetchHttpClient.layer)),
    ),
    Match.exhaustive,
  );
};
const unifiedJsonFallback = Otlp.layer({ baseUrl: "http://127.0.0.1:4318", headers: { authorization: "Bearer runtime-token" }, resource: { serviceName: "portal-api", serviceVersion: "build.version" } }).pipe(Layer.provide(OtlpSerialization.layerJson), Layer.provide(FetchHttpClient.layer));
const telemetryLive = telemetryLayer("unified", "http://127.0.0.1:4318", "runtime-token", "portal-api", "build.version");
```

`@effect/opentelemetry@0.61+` requires explicit serialization policy: `Otlp.layer` needs `OtlpSerialization`, while `layerJson/layerProtobuf` encode policy directly. `@effect/platform` propagation support is W3C/B3 with extraction order `w3c -> b3 -> x-b3-*`; keep ingress/egress policy consistent across services.

---
## [6][STREAM_SCHEDULE_STM_TMAP_OBSERVABILITY_BLUEPRINT]
>**Dictum:** *Batching, retries, lag metrics, and aggregate snapshots must live in one effect graph.*

<br>

- Read this rail in three phases: retry decision policy, stream batch instrumentation, STM snapshot projection.
- Aggregation law: all counters update transactionally inside STM before external projection to metrics/logs.
- Ownership law: this is an observability blueprint for processing rails, not a concurrency primer (`concurrency.md`).

```ts
import { Chunk, Clock, DateTime, Effect, HashMap, Match, Metric, Schedule, Stream, STM, TMap } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const jobSignal = {
  batches:  Metric.counter("jobs_batches_total"),
  defects:  Metric.frequency("jobs_defects_total"),
  elements: Metric.counter("jobs_elements_total"),
  failures: Metric.frequency("jobs_failures_total"),
  lagMs:    Metric.summaryTimestamp({ error: 0.01, maxAge: "5 minutes", maxSize: 4096, name: "jobs_lag_ms", quantiles: [0.5, 0.9, 0.99] }),
  retries:  Metric.counter("jobs_retries_total"),
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const retryPolicy = Schedule.exponential("50 millis").pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(5)), Schedule.onDecision((_, decision) => Match.value(decision._tag).pipe(Match.when("Continue", () => Metric.increment(jobSignal.retries)), Match.when("Done", () => Effect.void), Match.exhaustive)));
const reconcileObserved = Effect.gen(function* () {
  const startedAtIso = yield* DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const startedAtMs = yield* Clock.currentTimeMillis;
  const aggregate = yield* STM.commit(TMap.empty<string, number>());
  const processed = yield* Stream.fromIterable(["a", "b", "c", "d", "e", "f", "g"]).pipe(
    Stream.groupedWithin(3, "200 millis"),
    Stream.tap((batch) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          STM.commit(TMap.merge(aggregate, "batches", 1, (x, y) => x + y).pipe(STM.zipRight(TMap.merge(aggregate, "elements", Chunk.size(batch), (x, y) => x + y)))).pipe(
            Effect.zipRight(Metric.increment(jobSignal.batches)),
            Effect.zipRight(Metric.incrementBy(jobSignal.elements, Chunk.size(batch))),
            Effect.zipRight(Metric.update(jobSignal.lagMs, [now - startedAtMs, now])),
          ),
        ),
      ),
    ),
    Stream.map(Chunk.size),
    Stream.runFold(0, (sum, n) => sum + n),
    Effect.withSpan("jobs.reconcile", { attributes: { "job.name": "reconcile", "job.started_at": startedAtIso } }),
    Metric.trackErrorWith(jobSignal.failures, () => "failure"),
    Metric.trackDefectWith(jobSignal.defects, () => "defect"),
    Effect.retry(retryPolicy),
  );
  const snapshot = yield* STM.commit(TMap.toChunk(aggregate));
  const compact = HashMap.fromIterable(Chunk.toReadonlyArray(snapshot));
  yield* Effect.logInfo("jobs.summary", { processed, snapshot: HashMap.toEntries(compact), startedAtIso });
  return processed;
});
```

The rail stays coherent because stream batching, retry decisions, and STM aggregation are composed in one graph and emitted once. Snapshot logging stays compact and bounded, while full event detail remains available in trace/log channels without metric cardinality blow-up.
