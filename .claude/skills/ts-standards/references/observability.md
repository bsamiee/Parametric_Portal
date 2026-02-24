# [H1][OBSERVABILITY]
>**Dictum:** *Spans describe what happened; metrics quantify how often; logs capture why -- all three compose through fiber context without manual threading.*

Effect 3.19 + `@effect/opentelemetry`. Tracing, metrics, structured logging, and error annotation compose via `pipe` and `Effect.gen`. Fiber-local state propagates automatically across `Effect.fork`, `Stream`, and scoped boundaries.

---
## [1][TRACING]
>**Dictum:** *Effect.fn traces service methods; Effect.withSpan wraps arbitrary effects; Telemetry.span fuses all three signals with auto-inferred SpanKind and context.*

`Effect.fn('Name.method')` wraps a generator with an automatic span -- use for all service methods touching IO. `Effect.withSpan(name, opts)` wraps any standalone effect. `Effect.annotateCurrentSpan` attaches queryable attributes to the active span. Span events record timestamped occurrences within a span's lifetime (exceptions, retries, checkpoints). `Effect.currentSpan` fails when no span is active -- always access via `Effect.option` for safe `Option<Span>`.

```typescript
import { Cause, Clock, Effect, FiberId, Option, pipe } from "effect";
import type { Tracer } from "effect";
// --- [FUNCTIONS] -------------------------------------------------------------
// Effect.fn: traced service method with automatic span + stack trace on error
const fetchAccount = Effect.fn("AccountService.fetch")(
    function* (accountId: string) {
        yield* Effect.annotateCurrentSpan({
            "account.id": accountId,
            "db.system": "postgresql",
        });
        yield* Effect.logInfo("Fetching account").pipe(
            Effect.annotateLogs({ accountId }),
            Effect.withLogSpan("account.fetch"),
        );
        return yield* Effect.succeed({ id: accountId, balance: 100 });
    },
);
// Effect.withSpan: wrap arbitrary effect with explicit kind
const callUpstream = (url: string): Effect.Effect<Response> =>
    pipe(
        Effect.tryPromise({ try: () => fetch(url), catch: (cause) => cause }),
        Effect.withSpan("upstream.call", {
            kind: "client" satisfies Tracer.SpanKind,
            attributes: { "http.url": url },
            captureStackTrace: false,
        }),
    );
// Safe span access: Option<Span> -- never assume a span exists
const safeAnnotate = (key: string, value: string): Effect.Effect<void> =>
    pipe(
        Effect.option(Effect.currentSpan),
        Effect.tap(Option.match({
            onNone: () => Effect.void,
            onSome: (span) => Effect.sync(() => span.attribute(key, value)),
        })),
        Effect.asVoid,
    );
// Span events: timestamped occurrences within a span (exceptions, checkpoints)
const emitSpanEvent = (
    eventName: string, attrs: Record<string, unknown>,
): Effect.Effect<void> =>
    Effect.gen(function* () {
        const span = yield* Effect.option(Effect.currentSpan);
        const nowNs = yield* Clock.currentTimeNanos;
        yield* Option.match(span, {
            onNone: () => Effect.void,
            onSome: (s) => Effect.sync(() => s.event(eventName, nowNs, attrs)),
        });
    });
```

---
## [2][FUSED_SIGNAL_ALGEBRA]
>**Dictum:** *Telemetry.span is the canonical observability surface -- auto-infers SpanKind from operation prefix, auto-annotates from Context.Request, auto-redacts sensitive keys, and conditionally applies MetricsService tracking.*

The codebase's `Telemetry.span` is a `dual` function wrapping `Effect.withSpan` + `_annotateError` + `Effect.withLogSpan` + `Effect.annotateLogs` + conditional `MetricsService.trackEffect` into one call. Every service method and route handler uses it instead of raw `Effect.withSpan`. SpanKind is resolved by prefix lookup table: `auth.*` -> server, `cache.*` -> internal, `webhook.*` -> client, `jobs.process` -> consumer, `eventbus.*` -> producer. Route handlers use `Telemetry.span` directly; service methods use `Effect.fn` (which generates its own span).

```typescript
import { Effect, pipe } from "effect";
import type { Tracer } from "effect";
import { dual } from "effect/Function";
// --- [TYPES] -----------------------------------------------------------------
type SpanOpts = Tracer.SpanOptions["attributes"] & {
    readonly captureStackTrace?: false;
    readonly kind?: Tracer.SpanKind;
    readonly metrics?: false;
};
// --- [CONSTANTS] -------------------------------------------------------------
// SpanKind auto-inference: prefix -> kind. First match wins.
const _SPAN_KIND_PREFIXES = [
    ["consumer",  ["jobs.process", "jobs.poll"]],
    ["internal",  ["cache.", "cron.", "crypto."]],
    ["producer",  ["email.send", "eventbus.", "jobs.enqueue"]],
    ["server",    ["auth.", "health.", "search.", "users."]],
    ["client",    ["webhook.", "upstream."]],
] as const satisfies ReadonlyArray<
    readonly [Tracer.SpanKind, ReadonlyArray<string>]
>;
const _REDACT_KEYS = [
    "client.address", "session.id", "user.id",
] as const;
// --- [FUNCTIONS] -------------------------------------------------------------
// Dual-form: pipe(effect, Telemetry.span("name")) or Telemetry.span(effect, "name")
// Auto-resolves: SpanKind from prefix, request context from FiberRef,
//   redacts _REDACT_KEYS, applies _annotateError, conditionally tracks metrics
const _span: {
    (name: string, opts?: SpanOpts): <A, E, R>(
        self: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    <A, E, R>(
        self: Effect.Effect<A, E, R>, name: string, opts?: SpanOpts,
    ): Effect.Effect<A, E, R>;
} = dual(
    (args) => Effect.isEffect(args[0]),
    <A, E, R>(
        self: Effect.Effect<A, E, R>, name: string, opts?: SpanOpts,
    ): Effect.Effect<A, E, R> => {
        const { captureStackTrace, kind, metrics, ...restAttrs } = opts ?? {};
        // 1. Resolve request context + fiber ID concurrently
        // 2. Build span attributes: merge request attrs, remove redacted keys
        // 3. Infer SpanKind from prefix table (fallback: "internal")
        // 4. Wrap: withSpan -> _annotateError -> withLogSpan -> annotateLogs
        // 5. If metrics !== false && kind !== "server": MetricsService.trackEffect
        return self.pipe(
            Effect.withSpan(name, {
                attributes: restAttrs,
                captureStackTrace: captureStackTrace !== false,
                kind: kind ?? "internal",
            }),
        ) as Effect.Effect<A, E, R>;
    },
);
```

---
## [3][ERROR_ANNOTATION]
>**Dictum:** *_annotateError captures typed error cause into span events + attributes via tapErrorCause + Cause.match -- the single error projection pipeline.*

`_annotateError` is an `Effect.tapErrorCause` pipeline applied by `Telemetry.span` to every instrumented effect. It matches all `Cause` variants exhaustively, emitting OTel `exception` span events with `exception.message`, `exception.stacktrace`, `exception.type` and setting `error: true` + `error.type` span attributes. Parallel/sequential causes accumulate nested attributes. This is the TypeScript equivalent of the C# `TagPolicy.AnnotateFailure`.

```typescript
import { Array as A, Cause, Clock, Effect, FiberId, HashSet, Option, Record, pipe } from "effect";
// --- [FUNCTIONS] -------------------------------------------------------------
// Exhaustive cause projection: every variant emits structured span attributes
const _annotateError = Effect.tapErrorCause(
    (cause: Cause.Cause<unknown>) => {
        const pretty = A.head(Cause.prettyErrors(cause));
        const msg = Option.match(pretty, {
            onNone: () => Cause.pretty(cause),
            onSome: (entry) => entry.message,
        });
        const stack = pipe(
            pretty,
            Option.flatMapNullable((entry) => entry.stack),
            Option.getOrUndefined,
        );
        const base = {
            "exception.message": msg,
            "exception.stacktrace": stack,
        };
        // Cause.match: exhaustive dispatch on all cause variants
        const attrs = Cause.match(cause, {
            onDie: (defect) => ({
                ...base,
                "error": true,
                "error.type": defect instanceof Error
                    ? defect.constructor.name : "Defect",
            }),
            onEmpty: {} as Record.ReadonlyRecord<string, unknown>,
            onFail: (error) => ({
                ...base,
                "error": true,
                "error.type": (error as { _tag?: string })?._tag ?? "Unknown",
            }),
            onInterrupt: (fiberId) => ({
                "error": true,
                "error.type": "FiberInterrupted",
                "exception.message": `Interrupted by ${FiberId.threadName(fiberId)}`,
            }),
            onParallel: (left, right) => ({
                ...left, ...right,
                "error.parallel": HashSet.size(Cause.linearize(cause)),
            }),
            onSequential: (left, right) => ({
                ...left, ...right, "error.sequential": true,
            }),
        });
        return Effect.gen(function* () {
            const nowNs = yield* Clock.currentTimeNanos;
            const span = yield* Effect.option(Effect.currentSpan);
            yield* Option.match(span, {
                onNone: () => Effect.void,
                onSome: (currentSpan) => Effect.when(
                    Effect.sync(() => currentSpan.event("exception", nowNs, {
                        "exception.message": attrs["exception.message"],
                        "exception.stacktrace": attrs["exception.stacktrace"],
                    })),
                    () => attrs["error"] === true,
                ),
            });
            yield* Effect.annotateCurrentSpan(attrs);
        });
    },
);
```

---
## [4][METRICS]
>**Dictum:** *Six metric types declared at module scope; pipeline aspects attach to effects without ceremony; MetricsService centralizes the registry with domain groups.*

Metric objects are stateless descriptions -- declare once, reuse via aspects. `Metric.trackDuration` records wall-clock timing, `Metric.trackErrorWith` captures error tags on failure, `Metric.trackDefectWith` captures defect tags on die. Pair the latter two for complete error coverage. `Metric.increment`/`incrementBy` are discrete count Effects for `Effect.tap`. `Metric.set` assigns absolute gauge values. Labels attach via `Metric.tagged` (single pair) or `Metric.taggedWithLabels` (HashSet).

```typescript
import { Effect, HashSet, Metric, MetricLabel, Stream, pipe } from "effect";
// --- [CONSTANTS] -------------------------------------------------------------
const _duration = Metric.timerWithBoundaries(
    "transfer_duration_seconds",
    [0.001, 0.01, 0.1, 1, 10, 100],
);
const _operations = Metric.counter("transfer_operations_total");
const _errors     = Metric.frequency("transfer_errors_total");
const _active     = Metric.gauge("transfer_connections_active");
const _summary    = Metric.summary("transfer_latency_summary", {
    maxAge: "60 seconds", maxSize: 1000, error: 0.01,
    quantiles: [0.5, 0.9, 0.95, 0.99],
});
// --- [FUNCTIONS] -------------------------------------------------------------
// Pipeline aspects: attach metrics without changing the effect's type signature
const withMetrics = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    labels: HashSet.HashSet<MetricLabel.MetricLabel>,
): Effect.Effect<A, E, R> =>
    effect.pipe(
        Metric.trackDuration(Metric.taggedWithLabels(_duration, labels)),
        Metric.trackErrorWith(
            Metric.taggedWithLabels(_errors, labels),
            (err: unknown) =>
                (err as { _tag?: string })?._tag ?? "Unknown",
        ),
        Metric.trackDefectWith(
            Metric.taggedWithLabels(_errors, labels),
            (defect: unknown) =>
                defect instanceof Error ? defect.constructor.name : "Defect",
        ),
    );
// Discrete operations: increment, incrementBy, set, update
const recordMetrics = (
    labels: HashSet.HashSet<MetricLabel.MetricLabel>,
): Effect.Effect<void> =>
    Effect.all([
        Metric.increment(Metric.taggedWithLabels(_operations, labels)),
        Metric.set(Metric.taggedWithLabels(_active, labels), 42),
        Metric.update(Metric.taggedWithLabels(_summary, labels), 0.123),
    ], { concurrency: "unbounded", discard: true });
// Stream tracking: count elements flowing through a stream
const trackStream = <A, E, R>(
    stream: Stream.Stream<A, E, R>,
    counter: Metric.Metric.Counter<number>,
    labelPairs: Record<string, string | undefined>,
): Stream.Stream<A, E, R> => {
    const labels = HashSet.fromIterable(
        Object.entries(labelPairs)
            .filter((e): e is [string, string] => e[1] !== undefined)
            .map(([k, v]) => MetricLabel.make(k, v)),
    );
    return Stream.tap(stream, () =>
        Metric.increment(Metric.taggedWithLabels(counter, labels)),
    );
};
```

---
## [5][METRICS_SERVICE]
>**Dictum:** *MetricsService centralizes all metric declarations in domain-grouped registry with polymorphic label builder, sanitization, and static tracking methods.*

The codebase uses a single `MetricsService` that groups metrics by domain (`ai`, `auth`, `cache`, `jobs`, `events`, etc.). Static methods provide label building with sanitization + truncation, effect tracking (duration + errors + defects), stream tracking, and job-specific tracking with operation dispatch. Built-in fiber metrics (`Metric.fiberActive`, `fiberStarted`, `fiberSuccesses`, `fiberFailures`, `fiberLifetimes`) are included in the `fiber` group.

```typescript
import { Effect, HashSet, Match, Metric, MetricLabel, Stream, pipe } from "effect";
// --- [SERVICES] --------------------------------------------------------------
class MetricsService extends Effect.Service<MetricsService>()(
    "server/Metrics",
    {
        effect: Effect.succeed({
            // Domain-grouped metric registry (subset shown)
            auth: {
                logins: Metric.counter("auth_logins_total"),
                session: {
                    hits: Metric.counter("auth_session_hits_total"),
                    misses: Metric.counter("auth_session_misses_total"),
                },
            },
            fiber: {
                active: Metric.fiberActive,
                started: Metric.fiberStarted,
                successes: Metric.fiberSuccesses,
                failures: Metric.fiberFailures,
                lifetimes: Metric.fiberLifetimes,
            },
            rpc: {
                duration: Metric.timerWithBoundaries(
                    "rpc_duration_seconds", [0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
                ),
                errors: Metric.frequency("rpc_errors_total"),
            },
        }),
    },
) {
    // Polymorphic label builder: sanitizes, truncates >120 chars, strips control
    static readonly label = (
        pairs: Record<string, string | undefined>,
    ): HashSet.HashSet<MetricLabel.MetricLabel> =>
        HashSet.fromIterable(
            Object.entries(pairs)
                .filter((e): e is [string, string] => e[1] !== undefined)
                .map(([k, v]) => MetricLabel.make(
                    k, v.length > 120 ? `${v.slice(0, 120)}...` : v,
                )),
        );
    // Error tag extraction: _tag for TaggedError, constructor.name for Error
    static readonly errorTag = (err: unknown): string =>
        Match.value(err).pipe(
            Match.when(
                (e): e is { _tag: string } =>
                    typeof e === "object" && e !== null && "_tag" in e,
                (tagged) => tagged._tag,
            ),
            Match.when(
                (e): e is Error => e instanceof Error,
                (error) => error.constructor.name,
            ),
            Match.orElse(() => "Unknown"),
        );
    // Fused effect tracking: duration + errors + defects in one pipeline
    static readonly trackEffect = <A, E, R>(
        effect: Effect.Effect<A, E, R>,
        config: {
            readonly duration: ReturnType<typeof Metric.timerWithBoundaries>;
            readonly errors: Metric.Metric.Frequency<string>;
            readonly labels: HashSet.HashSet<MetricLabel.MetricLabel>;
        },
    ): Effect.Effect<A, E, R> =>
        effect.pipe(
            Metric.trackDuration(
                Metric.taggedWithLabels(config.duration, config.labels),
            ),
            Metric.trackErrorWith(
                Metric.taggedWithLabels(config.errors, config.labels),
                MetricsService.errorTag,
            ),
            Metric.trackDefectWith(
                Metric.taggedWithLabels(config.errors, config.labels),
                MetricsService.errorTag,
            ),
        );
}
```

---
## [6][STRUCTURED_LOGGING]
>**Dictum:** *Six log levels, annotation scoping, log spans, and Logger selection compose via Layer -- never manual level guards in business logic.*

`Effect.logTrace` through `Effect.logFatal` are the six structured logging effects. `Effect.annotateLogs` attaches key-value pairs to all log entries within the scoped effect. `Effect.annotateLogsScoped` extends annotations for the full `Scope` lifetime -- use inside service constructors. `Effect.withLogSpan` groups entries under an operation label with automatic duration. Logger selection is a Layer concern: `Logger.json` for production, `Logger.pretty` for development, `Logger.logfmt` for Loki-based systems. `Logger.withSpanAnnotations` auto-attaches `traceId`/`spanId` to every log entry for OTLP correlation.

```typescript
import { Effect, Layer, Logger, LogLevel, pipe } from "effect";
// --- [FUNCTIONS] -------------------------------------------------------------
// Six log levels: trace, debug, info, warning, error, fatal
const instrumentedOperation = Effect.fn("Billing.charge")(
    function* (tenantId: string, amount: number) {
        yield* Effect.logInfo("Charge initiated").pipe(
            Effect.annotateLogs({ tenantId, amount: String(amount) }),
            Effect.withLogSpan("billing.charge"),
        );
        yield* Effect.logDebug("Validating payment method");
        const result = yield* Effect.succeed({ charged: amount });
        yield* Effect.logTrace("Charge completed");
        return result;
    },
);
// annotateLogsScoped: persists for full Scope lifetime (service constructors)
const serviceConstructor = Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({ service: "BillingService" });
    // all logs from methods defined below carry service="BillingService"
    return { charge: instrumentedOperation } as const;
});
// --- [LAYERS] ----------------------------------------------------------------
// Production: JSON lines + OTLP span correlation + minimum INFO level
const ProductionLogLayer = Layer.mergeAll(
    Logger.replace(
        Logger.defaultLogger,
        Logger.withSpanAnnotations(Logger.jsonLogger),
    ),
    Logger.minimumLogLevel(LogLevel.Info),
);
// Development: pretty-printed with colors
const DevelopmentLogLayer = Layer.mergeAll(
    Logger.replace(
        Logger.defaultLogger,
        Logger.prettyLogger({ colors: "auto", mode: "auto" }),
    ),
    Logger.minimumLogLevel(LogLevel.Debug),
);
```

---
## [7][OTEL_INTEGRATION]
>**Dictum:** *OtlpTracer + OtlpMetrics + OtlpLogger compose into one layer -- provide once at the application root; HttpClient.withTracerPropagation(false) prevents infinite trace loops on the OTLP exporter client.*

`@effect/opentelemetry` exports `OtlpTracer`, `OtlpMetrics`, `OtlpLogger`, and `OtlpSerialization`. Each layer requires `HttpClient | OtlpSerialization`. Resource identity uses `{ serviceName, serviceVersion, attributes }`. `OtlpSerialization.layerJson` or `layerProtobuf` selects wire format. The OTLP HTTP client must disable tracer propagation to avoid recursive trace export.

```typescript
import { OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from "@effect/opentelemetry";
import { FetchHttpClient, HttpClient } from "@effect/platform";
import { Duration, Effect, Layer, Logger } from "effect";
// --- [CONSTANTS] -------------------------------------------------------------
const _resource = {
    serviceName: "my-service", serviceVersion: "1.0.0",
    attributes: {
        "deployment.environment.name": "production",
        "service.namespace": "my-org",
        "service.instance.id": crypto.randomUUID(),
        "process.pid": process.pid,
        "process.runtime.name": "node",
        "process.runtime.version": process.versions.node,
    },
} as const;
const _base = "http://alloy.monitoring.svc.cluster.local:4318";
// --- [LAYERS] ----------------------------------------------------------------
const TelemetryLayer = Layer.mergeAll(
    OtlpTracer.layer({
        url: `${_base}/v1/traces`, resource: _resource,
        exportInterval: Duration.millis(500), maxBatchSize: 512,
        shutdownTimeout: Duration.seconds(30),
    }),
    OtlpMetrics.layer({
        url: `${_base}/v1/metrics`, resource: _resource,
        exportInterval: Duration.seconds(10),
        shutdownTimeout: Duration.seconds(30),
    }),
    OtlpLogger.layer({
        url: `${_base}/v1/logs`, resource: _resource,
        replaceLogger: Logger.defaultLogger,
        excludeLogSpans: true,
        exportInterval: Duration.seconds(10), maxBatchSize: 512,
        shutdownTimeout: Duration.seconds(30),
    }),
).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    // withTracerPropagation(false): prevents OTLP client from generating
    // traces for its own export requests -- avoids infinite trace loop
    Layer.provide(Layer.effect(
        HttpClient.HttpClient,
        Effect.map(HttpClient.HttpClient, HttpClient.withTracerPropagation(false)),
    )),
    Layer.provide(FetchHttpClient.layer),
);
```

---
## [8][FIBERREF_CONTEXT]
>**Dictum:** *Propagate cross-cutting state via FiberRef -- never drill parameters. Scope mutations to handler lifetime via locallyWith.*

`FiberRef.unsafeMake` creates module-level refs (no Scope); child fibers inherit a copy at fork time. `FiberRef.make` requires `Scope` -- use inside scoped generators only. `FiberRef.unsafeMake` accepts optional `fork`/`join` functions for custom inheritance semantics. `Effect.locallyWith(effect, ref, fn)` scopes a mutation to the effect's lifetime without leaking writes upward (`fn: A -> A` transforms). `Effect.locally(ref, value)` replaces the value absolutely. Effect's tracer stores the current span in a FiberRef -- spans nest automatically in `Effect.gen` because child fibers inherit the parent span ref.

```typescript
import { Effect, FiberRef, Option, pipe } from "effect";
// --- [CONSTANTS] -------------------------------------------------------------
const _requestContext = FiberRef.unsafeMake<{
    readonly correlationId: string;
    readonly tenantId: Option.Option<string>;
}>({
    correlationId: "unset",
    tenantId: Option.none(),
});
// --- [FUNCTIONS] -------------------------------------------------------------
// locallyWith: scoped FiberRef mutation -- fn transforms A -> A
const withRequestScope = <A, E, R>(
    tenantId: string,
    effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
    Effect.locallyWith(effect, _requestContext, () => ({
        correlationId: crypto.randomUUID(),
        tenantId: Option.some(tenantId),
    }));
// Reading FiberRef inside a traced method
const auditRecord = Effect.fn("AuditService.record")(
    function* (action: string, resource: string) {
        const ctx = yield* FiberRef.get(_requestContext);
        const tenantId = Option.getOrElse(ctx.tenantId, () => "system");
        yield* Effect.annotateCurrentSpan({
            "audit.action": action,
            "audit.resource": resource,
            "tenant.id": tenantId,
        });
        yield* Effect.logInfo("Audit event recorded").pipe(
            Effect.annotateLogs({
                action, resource, tenantId,
                correlationId: ctx.correlationId,
            }),
        );
    },
);
```

---
## [9][CONFIG_AND_DATETIME]
>**Dictum:** *Config is pure description; ConfigProvider injects the source; DateTime reads from Clock for deterministic time.*

`Config.all` composes typed config fields. `Config.withDefault` provides fallbacks. `Config.validate` adds custom validation. `ConfigProvider.fromMap` swaps the source in tests without env mutation. `DateTime.now` reads the `Clock` service -- providing `TestClock` makes all time deterministic.

```typescript
import { Clock, Config, ConfigProvider, DateTime, Effect, Layer, pipe } from "effect";
// --- [CONSTANTS] -------------------------------------------------------------
const _appConfig = Config.all({
    port:     Config.port("PORT").pipe(Config.withDefault(3000)),
    logLevel: Config.string("LOG_LEVEL").pipe(Config.withDefault("info")),
    dbUrl:    Config.redacted("DATABASE_URL"),
    maxConn:  Config.integer("DB_MAX_CONNECTIONS").pipe(
        Config.validate({
            message: "Must be 1-100",
            validation: (n) => n >= 1 && n <= 100,
        }),
    ),
});
// --- [FUNCTIONS] -------------------------------------------------------------
// DateTime: immutable, timezone-aware, Clock-testable
const recordTimestamp = Effect.gen(function* () {
    const now = yield* DateTime.now;
    const zoned = DateTime.setZoneNamed(now, "America/New_York");
    const elapsed = DateTime.distance(
        DateTime.subtract(now, { hours: 1 }), now,
    );
    yield* Effect.annotateCurrentSpan({
        "event.timestamp": DateTime.formatIso(now),
        "event.elapsed_ms": String(elapsed),
    });
    return { utc: now, local: zoned };
});
// --- [LAYERS] ----------------------------------------------------------------
// Test: deterministic config + clock -- zero env mutation
const TestConfigLayer = Layer.setConfigProvider(
    ConfigProvider.fromMap(new Map([
        ["PORT", "8080"],
        ["DATABASE_URL", "postgres://test"],
        ["DB_MAX_CONNECTIONS", "10"],
    ])),
);
```

---
## [10][RULES]

- [ALWAYS] Use `Telemetry.span` (project wrapper) over raw `Effect.withSpan` -- auto-infers kind, redacts, annotates context.
- [ALWAYS] Use `Effect.fn('Service.method')` for service methods touching IO -- automatic span + stack trace on error.
- [ALWAYS] Declare `Metric.*` instances at module scope or inside `MetricsService` registry -- never inside `Effect.gen` or function bodies.
- [ALWAYS] Pair `Metric.trackErrorWith` with `Metric.trackDefectWith` for complete error coverage.
- [ALWAYS] Use `Metric.timerWithBoundaries` over raw `Metric.histogram` -- accepts `Duration` directly.
- [ALWAYS] Use `Metric.set(gauge, value)` for absolute gauge values; `Metric.increment`/`incrementBy` only for relative adjustments.
- [ALWAYS] Build `MetricLabel` sets once at request boundary via `MetricsService.label` -- reuse across increments; never build in hot paths.
- [ALWAYS] Normalize HTTP paths before using as metric labels -- replace UUIDs/IDs/hashes/tokens with `:uuid`/`:id`/`:hash`/`:token`.
- [ALWAYS] Use `Effect.annotateCurrentSpan` for span attributes; `Effect.annotateLogs` for log context -- never conflate.
- [ALWAYS] Use `Effect.annotateLogsScoped` inside service constructors for service-scoped log context.
- [ALWAYS] Use `Effect.option(Effect.currentSpan)` for safe span access returning `Option<Span>`.
- [ALWAYS] Use `FiberRef.unsafeMake` for module-level refs; `FiberRef.make` only inside scoped generators requiring `Scope`.
- [ALWAYS] Use `Effect.locallyWith(effect, ref, fn)` to scope FiberRef writes -- never bare `FiberRef.set` leaking beyond handler lifetime.
- [ALWAYS] Provide explicit `kind` on root spans (`server`/`client`/`internal`/`producer`/`consumer`) -- inner spans inherit.
- [ALWAYS] Use `Logger.withSpanAnnotations(envLogger)` for auto `traceId`/`spanId` in structured log entries.
- [ALWAYS] Use `Logger.minimumLogLevel` via Layer -- never manual level guards in business logic.
- [ALWAYS] Use `HttpClient.withTracerPropagation(false)` on the OTLP exporter HTTP client -- prevents infinite trace loops.
- [ALWAYS] Provide `OtlpSerialization.layerJson` (or `layerProtobuf`) and `FetchHttpClient.layer` -- both required by OTLP exporters.
- [NEVER] Use `Effect.fn` for HTTP route handlers -- loses request context and metrics; use `Telemetry.span` directly.
- [NEVER] Call `OtlpTracer.layer`/`OtlpMetrics.layer`/`OtlpLogger.layer` more than once -- each is a singleton batch exporter.
- [NEVER] Annotate spans with sensitive fields (`user.id`, `session.id`, `client.address`) -- redact at wrapper level.
- [NEVER] Use `console.log` or `JSON.stringify` for logging -- use `Effect.logInfo`..`Effect.logFatal` with `annotateLogs`.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [API]                                                         | [SHAPE]                                                | [USE_WHEN]                                        |
| :-----: | ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------- |
|   [1]   | `Effect.fn("Name.method")`                                    | `(...args) -> Effect<A,E,R>`                           | Service methods with automatic traced span        |
|   [2]   | `Effect.withSpan(name, opts?)`                                | `Effect<A,E,R> -> Effect<A,E,R>`                       | Wrap arbitrary effect in named OTel span          |
|   [3]   | `Telemetry.span(name, opts?)`                                 | `Effect<A,E,R> -> Effect<A,E,R>` (dual)                | Fused: span + error annotation + logs + metrics   |
|   [4]   | `Effect.annotateCurrentSpan(k,v)` / `(record)`                | `Effect<void>`                                         | Attach attributes to innermost active span        |
|   [5]   | `Effect.option(Effect.currentSpan)`                           | `Effect<Option<Span>>`                                 | Safe span access when span may not exist          |
|   [6]   | `span.event(name, nanos, attrs)`                              | `void`                                                 | Timestamped span events (exception, checkpoint)   |
|   [7]   | `Metric.counter` / `gauge` / `frequency`                      | `Metric<Type, In, Out>`                                | Declare metric shape at module scope              |
|   [8]   | `Metric.timerWithBoundaries` / `histogram` / `summary`        | `Metric<Type, In, Out>`                                | Duration histogram / distribution / percentiles   |
|   [9]   | `Metric.tagged` / `taggedWithLabels`                          | `Metric<Type, In, Out>`                                | Dimensional labels (single pair or HashSet)       |
|  [10]   | `Metric.trackDuration` / `trackErrorWith` / `trackDefectWith` | `Effect<A,E,R> -> Effect<A,E,R>`                       | Pipeline aspects for timing and error/defect tags |
|  [11]   | `Metric.trackSuccess`                                         | `Effect<A,E,R> -> Effect<A,E,R>`                       | Increment counter on success                      |
|  [12]   | `Metric.increment` / `incrementBy` / `set` / `update`         | `Effect<void>`                                         | Discrete counter/gauge/histogram adjustments      |
|  [13]   | `Metric.fiberActive` / `fiberStarted` / `fiberSuccesses`      | `Metric<Gauge\|Counter>`                               | Built-in fiber runtime metrics                    |
|  [14]   | `Effect.logTrace` .. `Effect.logFatal`                        | `Effect<void>`                                         | Six structured log levels                         |
|  [15]   | `Effect.annotateLogs` / `annotateLogsScoped` / `withLogSpan`  | `Effect<A,E,R> -> ...`                                 | Log context: pipeline / Scope / operation label   |
|  [16]   | `Logger.json` / `Logger.pretty` / `Logger.logfmt`             | `Layer<never>`                                         | Output format: JSON / colored / key=value         |
|  [17]   | `Logger.withSpanAnnotations(logger)`                          | `Logger<...>`                                          | Auto-attach traceId/spanId to log entries         |
|  [18]   | `Logger.minimumLogLevel(level)`                               | `Layer<never>`                                         | Level gate via Layer                              |
|  [19]   | `FiberRef.unsafeMake` / `FiberRef.make`                       | `FiberRef<A>` / `Effect<FiberRef<A>, never, Scope>`    | Module-level ref (no Scope) / scoped ref          |
|  [20]   | `FiberRef.get` / `set` / `update`                             | `Effect<A>` / `Effect<void>`                           | Read / write / transform fiber-local value        |
|  [21]   | `Effect.locallyWith(eff, ref, fn)`                            | `Effect<A,E,R>`                                        | Scoped FiberRef mutation (fn: A -> A)             |
|  [22]   | `Effect.locally(ref, value)(eff)`                             | `Effect<A,E,R>`                                        | Scoped FiberRef absolute replacement              |
|  [23]   | `Otlp{Tracer,Metrics,Logger}.layer(opts)`                     | `Layer<never, never, HttpClient \| OtlpSerialization>` | OTLP exporters (trace / metrics / logs)           |
|  [24]   | `OtlpSerialization.layerJson` / `layerProtobuf`               | `Layer<OtlpSerialization>`                             | Wire format for OTLP exporters                    |
|  [25]   | `HttpClient.withTracerPropagation(false)`                     | `HttpClient -> HttpClient`                             | Disable trace propagation on OTLP client          |
|  [26]   | `Config.all` / `Config.withDefault` / `Config.validate`       | `Config<A>`                                            | Typed config composition with validation          |
|  [27]   | `ConfigProvider.fromMap(map)`                                 | `ConfigProvider`                                       | Deterministic test config without env mutation    |
|  [28]   | `DateTime.now` / `DateTime.setZoneNamed`                      | `Effect<DateTime.Utc>` / `DateTime.Zoned`              | Immutable timezone-aware time via Clock service   |
|  [29]   | `MetricsService.label(pairs)`                                 | `HashSet<MetricLabel>`                                 | Sanitized, truncated label builder                |
|  [30]   | `MetricsService.trackEffect(eff, config)`                     | `Effect<A,E,R>`                                        | Fused duration + error + defect tracking          |

Cross-references: `effects.md [1]` (Effect.fn traced methods) -- `services.md [2]` (scoped constructor + annotateLogsScoped) -- `composition.md [1]` (Layer.provide for OTLP layer wiring) -- `concurrency.md [5]` (FiberRef inheritance on fork).
