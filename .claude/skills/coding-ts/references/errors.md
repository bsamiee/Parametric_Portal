# Errors

## Tagged Error Contracts and Dispatch

Unbounded error construction compiles exhaustive-looking handlers that silently drop new variants. Tagged vocabularies force compilation failure at incomplete dispatch sites; computed getters derive operational policy from structure.

```ts
import { Data, Duration, Effect, Match, Schedule } from "effect"

type Disruption = Data.TaggedEnum<{
  Exhausted: { readonly active:  number; readonly ceiling:   number }
  Poisoned:  { readonly faulted: number; readonly threshold: number }
  Latent:    { readonly p99Ms:   number; readonly budgetMs:  number }
}>
const Disruption = Data.taggedEnum<Disruption>()

class ConnFault extends Data.TaggedError("ConnFault")<{
  readonly source:     string
  readonly disruption: Disruption
}> {
  get ratio() {
    return Disruption.$match(this.disruption, {
      Exhausted: ({ active, ceiling })    => active / ceiling,
      Poisoned:  ({ faulted, threshold }) => faulted / threshold,
      Latent:    ({ p99Ms, budgetMs })    => p99Ms / budgetMs,
    })
  }
  get severity(): "critical" | "degraded" { return this.ratio >= 0.95 ? "critical" : "degraded" }
  get retryable() { return Disruption.$is("Latent")(this.disruption) || this.ratio < 1.0 }
}

const withConnRetry = <A, R>(self: Effect.Effect<A, ConnFault, R>) =>
  self.pipe(
    Effect.retry(Schedule.exponential(Duration.millis(200)).pipe(
      Schedule.intersect(Schedule.recurs(5)), Schedule.jittered,
      Schedule.whileInput((e: ConnFault) => e.retryable),
    )),
    Effect.tapError((e) => Match.value(e.severity).pipe(
      Match.when("critical", () => Effect.logError(`${e.source}: ${e.disruption._tag} ratio=${e.ratio}`)),
      Match.when("degraded", () => Effect.logWarning(`${e.source}: ${e.disruption._tag} ratio=${e.ratio}`)),
      Match.exhaustive,
    )),
  )
```

**Dispatch contracts:**
- `Data.taggedEnum<T>()` exposes `$match` (exhaustive fold) and `$is` (type-narrowing `Refinement` factory). `$is("Latent")` usable in `catchIf` refinement overloads and `Array.filter`.
- `ConnFault` embeds `Disruption` as payload — boundary error keeps one `_tag`, internal dispatch on sub-vocabulary. Getters derive from `$match` fold to normalized scalar; `retryable` short-circuits on `$is`.
- `Schedule.intersect` = tighter (terminates when either exhausts); `union` = looser. `whileInput` gates on error value. `Match.exhaustive` on literal union forces compile failure when level added.
- Error-payload-driven delays: `Schedule.identity<E>().pipe(addDelay(e => Duration.millis(e.field)))`. `catchIf` with `Refinement<E, E2>` narrows `E` to `Exclude<E, E2>`.

## Error Rail Normalization

Error channels accumulate union members through composition — each `flatMap` widens `E`, leaking implementation topology. Per-stage normalization collapses heterogeneous internal rails to one boundary type.

```ts
import { Effect, Data } from "effect"

const Stages = {
  decode:  { retryable: false, severity: "terminal" as const, log: Effect.logError   },
  policy:  { retryable: true,  severity: "degraded" as const, log: Effect.logWarning },
  enrich:  { retryable: true,  severity: "degraded" as const, log: Effect.logWarning },
} as const satisfies Record<string, { readonly retryable: boolean; readonly severity: "terminal" | "degraded"; readonly log: typeof Effect.logWarning }>
type Stage = keyof typeof Stages

class IngestFault extends Data.TaggedError("IngestFault")<{
  readonly stage:  Stage
  readonly spanId: string
  readonly detail: string
}> {
  get retryable() { return Stages[this.stage].retryable }
  get severity()  { return Stages[this.stage].severity  }
}

const normalizeStage = (stage: Stage, spanId: string) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, IngestFault, R> =>
    self.pipe(
      Effect.mapError((e) => new IngestFault({ stage, spanId, detail: String(e) })),
      Effect.tapError((e) => Stages[e.stage].log(`[${e.severity}] ${e.detail}`)),
      Effect.annotateLogs({ stage, spanId }),
    )
```

**Normalization contracts:**
- Vocabulary table co-locates `retryable`, `severity`, `log` per stage. Adding stage requires one entry; `Stage` = `keyof typeof Stages` propagates.
- Getters derive from `Stages[this.stage]` — no classification logic outside table. Replaces monolithic `catchTags` (N internal error classes) with per-stage wrapping.
- `normalizeStage(stage, spanId)` is curried combinator: `mapError` collapses to boundary type, `tapError` emits at vocabulary-determined level, `annotateLogs` attaches context to entire subtree.

## Failure vs Defect Boundary

Laundering defects into recoverable failures destroys postmortem fidelity — crash site vanishes from cause tree. `Effect.sandbox` surfaces full `Cause<E>` into typed error channel; `unsandbox` re-elevates. The sandwich is lossless and enables cause-aware retry impossible at `E` channel level.

```ts
import { Cause, Data, Duration, Effect, Option, Schedule } from "effect"

class StoreFault extends Data.TaggedError("StoreFault")<{
  readonly op:     "append" | "compact" | "replay"
  readonly detail: string
  readonly origin: "fail" | "defect" | "interrupt"
}> {
  get severity(): "fatal" | "degraded" | "transient" {
    return this.origin === "interrupt" ? "transient" : this.op === "compact" ? "degraded" : "fatal"
  }
}

const boundaryClose = (op: StoreFault["op"]) =>
  <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, StoreFault, R> =>
    self.pipe(
      Effect.sandbox,
      Effect.retry(Schedule.exponential(Duration.millis(50)).pipe(
        Schedule.intersect(Schedule.recurs(2)),
        Schedule.whileInput((cause: Cause.Cause<E>) =>
          !Cause.isInterruptedOnly(cause) && Option.isNone(Cause.keepDefects(cause))),
      )),
      Effect.mapError((cause) => Cause.fail(new StoreFault({
        op, detail: Cause.pretty(cause),
        origin: Cause.isInterruptedOnly(cause) ? "interrupt" : Option.isSome(Cause.keepDefects(cause)) ? "defect" : "fail",
      }))),
      Effect.unsandbox,
      Effect.withSpan(`boundary.${op}`),
    )
```

**Boundary contracts:**
- `sandbox` → `Effect<A, Cause<E>, R>`: `Schedule.whileInput` gates on cause-level predicates — retries only on pure failures (not interrupted-only, no defects via `keepDefects`). `catchAllCause` is alternative without channel reshaping.
- `mapError` produces `Cause.fail(StoreFault)` — `unsandbox` interprets error AS cause. `Cause.fail` elevates as checked; `die` suppresses to defect. `pretty` preserves tree topology; `squash` is lossy.
- `isInterruptedOnly` = pure cancellation (no Fail/Die). `keepDefects` → `Option` (Some if Die exists). `stripFailures` returns `Cause<never>`. Defects rank above failures.
- Domain code: `die`/`dieMessage` for invariants, `orDie`/`orDieWith` for non-recoverable elevation, `filterOrDie` for guards. Only boundary functions translate Die→Fail.

## Cause Normalization and Terminalization

Parallel/sequential composition produces composite cause trees — `Parallel(Fail(a), Die(b))` cannot be dispatched by `catchTag`. `Cause.match` is the exhaustive catamorphism; `onSequential`/`onParallel` receive already-reduced values. Terminalization absorbs the report into defect channel.

```ts
import { Cause, Data, Effect } from "effect"

class CauseReport extends Data.Class<{
  readonly failures: ReadonlyArray<string>; readonly defects: ReadonlyArray<unknown>; readonly interrupted: boolean
}> {
  get severity(): "critical" | "degraded" | "clean" {
    return this.defects.length > 0 ? "critical" : this.failures.length > 0 ? "degraded" : "clean"
  }
  static readonly empty = new CauseReport({ failures: [], defects: [], interrupted: false })
  static concat = (l: CauseReport, r: CauseReport) => new CauseReport({
    failures: [...l.failures, ...r.failures], defects: [...l.defects, ...r.defects], interrupted: l.interrupted || r.interrupted,
  })
}

const foldCause = <E>(render: (e: E) => string) => (cause: Cause.Cause<E>): CauseReport =>
  Cause.match(cause, {
    onEmpty: CauseReport.empty,
    onFail:      (e) => new CauseReport({ failures: [render(e)], defects: [],  interrupted: false }),
    onDie:       (d) => new CauseReport({ failures: [],          defects: [d], interrupted: false }),
    onInterrupt: ()  => new CauseReport({ failures: [],          defects: [],  interrupted: true  }),
    onSequential: CauseReport.concat, onParallel: CauseReport.concat,
  })

const terminalize = <E>(render: (e: E) => string) =>
  <A, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
    self.pipe(Effect.catchAllCause((cause) => {
      const report = foldCause(render)(cause)
      return Effect.logError(Cause.pretty(cause)).pipe(
        Effect.annotateLogs({ severity: report.severity, failures: String(report.failures.length), defects: String(report.defects.length) }),
        Effect.andThen(Effect.die(report)),
      )
    }))
```

**Fold contracts:**
- `concat` commutative = same combiner for both composition modes — correct for aggregate counts without topology sensitivity. Non-commutative folds require distinct callbacks.
- `Cause.match` is the ONLY safe fold — hand-rolled `_tag` switches drop nested causes. `reduceWithContext` threads context for position-dependent logic.
- `terminalize` composes `foldCause` + `catchAllCause`: `pretty` renders tree, `annotateLogs` attaches severity/counts, `die(report)` absorbs to defect channel. `E = never` downstream.
- `parallelErrors` extracts `Fail` values flat. `failures`/`defects` provide per-rail extraction. Catamorphism when topology load-bearing; extractors when counts suffice.

## Accumulation Semantics

`validateAll` discards all successes on any failure — retention contract silently determines partial-success possibility. `partition` separates with `E = never`, preserving both sides.

```ts
import { Effect, Array as Arr, Data } from "effect"

class EntryFault extends Data.TaggedError("EntryFault")<{
  readonly tenantId: string
  readonly reason:   "schema" | "quota" | "suspended"
}> {
  get terminal()   { return this.reason === "suspended" }
  get diagnostic() { return `[${this.reason}] tenant=${this.tenantId}` }
}

class BatchRejection extends Data.TaggedError("BatchRejection")<{
  readonly accepted:  number
  readonly rejected:  number
  readonly threshold: number
  readonly histogram: Record<string, ReadonlyArray<EntryFault>>
}> {
  get rate() { return this.rejected / (this.accepted + this.rejected) }
}

const ingestBatch = <A, B>(
  entries: ReadonlyArray<A>,
  process: (entry: A) => Effect.Effect<B, EntryFault>,
  threshold: number,
) =>
  Effect.partition(entries, process, { concurrency: "inherit" }).pipe(
    Effect.map(([rejected, accepted]) => {
      const histogram = Arr.groupBy(rejected, (e) => e.reason)
      const reject = () => new BatchRejection({
        accepted: accepted.length, rejected: rejected.length, threshold, histogram,
      })
      return { accepted, rejected, histogram, reject }
    }),
    Effect.filterOrFail(({ rejected }) => !Arr.some(rejected, (e) => e.terminal), ({ reject }) => reject()),
    Effect.filterOrFail(
      ({ rejected, accepted }) => rejected.length / (accepted.length + rejected.length) <= threshold,
      ({ reject }) => reject(),
    ),
    Effect.map(({ accepted, histogram }) => ({ accepted, histogram })),
    Effect.withSpan("ingest-batch", { attributes: { entryCount: entries.length, threshold } }),
  )
```

**Retention contracts:**
- `partition` → `[excluded, satisfying]` with `E = never`. `{ concurrency: "inherit" }` propagates caller policy. `validateAll` discards successes (all-or-nothing); `validateFirst` succeeds on first.
- Two-tier policy: `terminal` gates immediate batch failure; rate threshold gates non-terminal. `reject` factory closure — one construction site, two consumption.
- `Schema.decodeUnknown({ errors: "all" })` applies same accumulation at parse level. `groupBy` key erases to `string` (known limitation).

## Boundary Translation and Policy Projection

Inline status/retry/transport literals create N×M maintenance surfaces. One vocabulary table and one projection function reduce to N entries with mechanical consistency.

```ts
import { Data, Duration, Effect } from "effect"

const Policy = {
  unauthorized: { status: 401, retryable: false, retryAfter: Duration.zero,       log: Effect.logWarning },
  forbidden:    { status: 403, retryable: false, retryAfter: Duration.zero,       log: Effect.logWarning },
  notFound:     { status: 404, retryable: false, retryAfter: Duration.zero,       log: Effect.logInfo    },
  conflict:     { status: 409, retryable: true,  retryAfter: Duration.zero,       log: Effect.logWarning },
  unavailable:  { status: 503, retryable: true,  retryAfter: Duration.seconds(1), log: Effect.logError   },
} as const satisfies Record<string, { readonly status: number; readonly retryable: boolean; readonly retryAfter: Duration.Duration; readonly log: typeof Effect.logWarning }>

class GatewayFault extends Data.TaggedError("GatewayFault")<{
  readonly reason: keyof typeof Policy
  readonly detail: string
}> {
  get status()     { return Policy[this.reason].status     }
  get retryable()  { return Policy[this.reason].retryable  }
  get retryAfter() { return Policy[this.reason].retryAfter }
  get body() {
    return {
      error: this.reason, detail: this.detail, status: this.status, retryable: this.retryable,
      ...(Duration.greaterThan(this.retryAfter, Duration.zero) && { retryAfterMs: Duration.toMillis(this.retryAfter) }),
    } as const
  }
}

const withBoundaryTranslation = <A, E extends { readonly _tag: string }, R>(
  classify: (e: E) => { readonly reason: keyof typeof Policy; readonly detail: string },
) =>
  (self: Effect.Effect<A, E, R>): Effect.Effect<A, GatewayFault, R> =>
    self.pipe(
      Effect.mapError((e) => new GatewayFault(classify(e))),
      Effect.tapError((e) => Effect.all([
        Policy[e.reason].log(`[${e.status}] ${e.detail}`),
        Effect.annotateCurrentSpan({ "gateway.reason": e.reason, "gateway.status": e.status }),
      ], { discard: true })),
      Effect.withSpan("boundary-translation"),
    )
```

**Projection contracts:**
- `Policy` carries four dimensions per reason. `Duration.greaterThan` + `toMillis` in `body` — `retryAfterMs` conditionally included. `keyof typeof Policy` replaces separate `type Reason`.
- `body` is terminal projection — structured payload from vocabulary. Adding reason requires one row. `tapError` returns `Effect<void, never>`, no channel widening.
- `withBoundaryTranslation(classify)`: `mapError` applies classification, `tapError` combines logging + `annotateCurrentSpan`, `withSpan` names boundary in traces. Transport-edge concern, distinct from normalization.

## Rules
- One boundary error type per module surface — internal tagged errors are file-scoped, never exported.
- Normalization via `catchTags` or per-stage `mapError` must reduce to exactly the boundary type; residual union = incomplete handling.
- Defects never caught by `catchAll`/`catchTags` — only `sandbox`/`unsandbox` or `catchAllCause` with exhaustive `Cause.match` at explicit boundaries.
- Policy vocabularies use `as const satisfies` — inline literals outside the vocabulary owner forbidden.
- Computed getters derive from vocabulary lookup, `$match` fold, or shared derived values — no classification duplication.
- Cause-level handlers at explicit boundary functions only, never inline in domain pipelines.
