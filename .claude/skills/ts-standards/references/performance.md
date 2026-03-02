# Performance

Typed budget enforcement, saturation discipline, transactional contention, and CI gate algebra. Measurements are first-class values. Failures are typed evidence.


## Budget algebra

Budget vocabulary maps operation discriminants to pipeline-composable constructs — timeout bounds, failure classification, metric projectors. One lookup resolves every downstream axis. Discriminant type derives from `keyof typeof Budget`. Vocabulary values are Effect-native (`Duration`, `Schedule`).

`classify` returns composite `{ label, severity, retry }` — one invocation resolves metric tag, log selection, and retry schedule. `measure` is the sole entrypoint: composes denominator metric, timeout, latency tracking, and severity-driven retry.

```ts
import { Data, Duration, Effect, Metric, Schedule, pipe } from "effect"

const Budget = {
  ingest: {
    timeout: Duration.millis(900),
    classify: (cause: "upstream" | "terminal") => ({
      upstream: { label: "upstream", severity: "warn" as const,  retry: Schedule.exponential("50 millis").pipe(Schedule.intersect(Schedule.recurs(3))) },
      terminal: { label: "terminal", severity: "error" as const, retry: Schedule.stop },
    })[cause],
  },
  emit: {
    timeout: Duration.millis(700),
    classify: (cause: "throttle" | "terminal") => ({
      throttle: { label: "throttle", severity: "warn" as const,  retry: Schedule.spaced("100 millis").pipe(Schedule.intersect(Schedule.recurs(5))) },
      terminal: { label: "terminal", severity: "error" as const, retry: Schedule.stop },
    })[cause],
  },
} as const satisfies Record<string, {
  timeout: Duration.Duration
  classify: (cause: string) => { label: string; severity: "warn" | "error"; retry: Schedule.Schedule<number> }
}>

type Op = keyof typeof Budget
type Cause<O extends Op> = Parameters<(typeof Budget)[O]["classify"]>[0]
type Policy = ReturnType<(typeof Budget)[Op]["classify"]>

class BudgetFault<O extends Op> extends Data.TaggedError("BudgetFault")<{ readonly op: O; readonly cause: Cause<O> }> {
  get policy(): Policy { return Budget[this.op].classify(this.cause) }
}

const Log = { warn: Effect.logWarning, error: Effect.logError } as const

const measure = <O extends Op, A, R>(op: O, work: Effect.Effect<A, BudgetFault<O>, R>) => {
  const retry = <E extends BudgetFault<O>>(e: E) => e.policy.retry
  return pipe(
    Metric.increment(Metric.tagged(Metric.counter("budget_attempts"), "op", op)),
    Effect.zipRight(work),
    Effect.timeoutFail({ duration: Budget[op].timeout, onTimeout: () => new BudgetFault({ op, cause: "terminal" as Cause<O> }) }),
    Effect.tapError((e) => Log[e.policy.severity](`${op}:${e.policy.label}`)),
    Effect.retry({ schedule: Schedule.passthrough(retry), while: (e) => e.policy.severity === "warn" }),
    Metric.trackDuration(Metric.tagged(Metric.timerWithBoundaries("budget_latency_s", [.001, .01, .05, .1, .5, 1, 3]), "op", op)),
    Metric.trackErrorWith(Metric.tagged(Metric.frequency("budget_faults", { preregisteredWords: ["upstream", "throttle", "terminal"] }), "op", op), (e) => e.policy.label),
  )
}
```

**Budget contracts:**
- `classify` returns composite — no parallel `severities`, `retryPolicies` tables.
- `Log` is severity → Effect dispatcher map; index selection, no branching. Closed discriminant makes map exhaustive.
- `Schedule.passthrough(retry)` extracts schedule from error at retry-time. `while` gates on severity: `"warn"` = retry, `"error"` = fail-fast.


## Saturation discipline

Queue backpressure requires typed offer outcomes — dropping queue's `boolean` is the loss boundary. Two patterns: `Ref` accumulation for completion-time statistics (batch jobs); `Stream.mapAccum` with state/emission decoupling for real-time emission.

`saturateBatch` reads statistics after drain. `saturateLive` emits running statistics per-element via Mealy-machine — state fields (`n`, `drops`, `peak`) serve algorithm, emission fields (`item`, `depth`, `running`) serve downstream. Zero shared members; decoupling is load-bearing.

```ts
import { Chunk, Duration, Effect, Fiber, Metric, Number as N, Queue, Ref, Stream } from "effect"

type Stats   = { n:    number; drops: number; peak:    number }
type Live<A> = { item: A;      depth: number; running: Stats  }

const saturateBatch = <A>(cfg: { maxDepth: number; batchSize: number; within: Duration.Duration }) =>
  (source: Stream.Stream<A>, dropped: Metric.Metric.Counter<number>) => Effect.scoped(Effect.gen(function* () {
    const queue = yield* Queue.dropping<A>(cfg.maxDepth)
    const stats = yield* Ref.make<Stats>({ n: 0, drops: 0, peak: 0 })
    const offer = (a: A) => Queue.offer(queue, a).pipe(
      Effect.zip(Queue.size(queue)),
      Effect.tap(([ok, d]) => Ref.update(stats, (s) => ({ n: s.n + 1, drops: s.drops + +!ok, peak: N.max(s.peak, d) }))),
      Effect.tap(([ok]) => Effect.when(Metric.increment(dropped), () => !ok)))
    const producer = yield* Stream.runForEach(source, offer).pipe(Effect.ensuring(Queue.shutdown(queue)), Effect.forkScoped)
    const drained = yield* Stream.fromQueue(queue, { maxChunkSize: cfg.batchSize }).pipe(
      Stream.groupedWithin(cfg.batchSize, cfg.within), Stream.mapChunks((c) => Chunk.flatMap(c, (x) => x)), Stream.runCollect)
    yield* Fiber.join(producer)
    return { drained, stats: yield* Ref.get(stats) }
  }))

const saturateLive = <A>(cfg: { maxDepth: number }) =>
  (source: Stream.Stream<A>): Stream.Stream<Live<A>> =>
    source.pipe(
      Stream.mapAccum({ n: 0, drops: 0, peak: 0 } as Stats, (s, item) => {
        const nextCount = s.n + 1
        const willDrop = nextCount > cfg.maxDepth
        const next: Stats = { n: nextCount, drops: s.drops + (willDrop ? 1 : 0), peak: Math.max(s.peak, nextCount) }
        return [next, { item, depth: nextCount, running: next }] as const
      }),
      Stream.filterMap(({ item, depth, running }) =>
        depth <= cfg.maxDepth
          ? { _tag: "Some" as const, value: { item, depth, running } }
          : { _tag: "None" as const }))
```

**Saturation contracts:**
- `saturateBatch`: `Ref.update` for scalar accumulation — statistics read once at completion. `Effect.when` conditionally increments; `+!ok` coerces `boolean` to `0 | 1`.
- `saturateLive`: pure `Stream.mapAccum` — no queue. `filterMap` drops items exceeding depth without queue overhead.
- Choose `saturateBatch` when backpressure requires queue semantics. `saturateLive` when depth tracking suffices.
- `running` in emission is snapshot copy — downstream never holds reference to accumulator internals.


## Transactional contention

STM serializes concurrent accounting via optimistic locks — conflicts trigger automatic retry. TRef for single-counter hot paths; TMap for keyed aggregation.

Two composition patterns: `STM.all` batches independent reads into one atomic observation. `STM.gen` with named bindings for derived computations where intermediate values appear in predicates or multiple expressions.

Vocabulary maps strategy discriminants to pool configuration, threshold predicate, invalidation policy — one lookup resolves all axes.

```ts
import { Data, Duration, Effect, Pool, STM, TRef, pipe } from "effect"

const Strategy = {
  usage: {
    ttlStrategy:      "usage" as const, utilization: 0.7,
    threshold:        (hit: number, total: number) => total > 0 && hit / total >= 0.7,
    shouldInvalidate: (n:   number) => n % 11 === 0,
  },
  creation: {
    ttlStrategy:      "creation" as const, utilization: 0.5,
    threshold:        (hit: number, total: number) => total > 0 && hit / total >= 0.5,
    shouldInvalidate: (n:   number) => n % 7 === 0,
  },
} as const satisfies Record<string, {
  ttlStrategy:      "usage" | "creation"; utilization: number
  threshold:        (hit: number, total: number) => boolean
  shouldInvalidate: (n:   number) => boolean
}>

class ResourceId extends Data.Class<{ readonly id: string }> {}

const accounting = <K extends keyof typeof Strategy>(strategy: K, poolSize: number, ttl: Duration.Duration) =>
  Effect.scoped(Effect.gen(function* () {
    const cfg = Strategy[strategy]
    const requests = yield* TRef.make(0)
    const hits = yield* TRef.make(0)
    const invalidations = yield* TRef.make(0)
    const pool = yield* Pool.makeWithTTL({
      acquire: Effect.sync(() => new ResourceId({ id: crypto.randomUUID() })),
      min: 1, max: poolSize, timeToLive: ttl, timeToLiveStrategy: cfg.ttlStrategy, targetUtilization: cfg.utilization,
    })
    const execute = pipe(
      STM.commit(TRef.updateAndGet(requests, (n) => n + 1)),
      Effect.flatMap((n) => Effect.scoped(Pool.get(pool).pipe(
        Effect.tap((r) => Effect.when(Pool.invalidate(pool, r).pipe(
          Effect.zipRight(STM.commit(TRef.update(invalidations, (i) => i + 1)))), () => cfg.shouldInvalidate(n))),
        Effect.tap(() => STM.commit(TRef.update(hits, (h) => h + (n % 3 === 0 ? 0 : 1))))))))
    const awaitThreshold = (minRequests: number) => STM.gen(function* () {
      const h = yield* TRef.get(hits)
      const t = yield* TRef.get(requests)
      yield* STM.check(t >= minRequests && cfg.threshold(h, t))
      return { hitRate: h / t, hits: h, total: t }
    }).pipe(STM.commit)
    const snapshot = STM.all([TRef.get(requests), TRef.get(hits), TRef.get(invalidations)]).pipe(
      STM.map(([total, hit, inv]) => ({ total, hit, inv, hitRate: total > 0 ? hit / total : 0 })), STM.commit)
    return { execute, awaitThreshold, snapshot, pool }
  }))
```

**Contention contracts:**
- `STM.gen` with named bindings when values appear in predicate AND return. `STM.all` → `map` when values feed single aggregate.
- `shouldInvalidate` as function — per-strategy logic without branching at call site. Adding strategy requires one entry with all axes.
- `STM.check` blocks until predicate succeeds — cleaner than `retryWhile` with negation.


## Gate discipline

Performance gates compute order-statistic aggregates over timed samples, compare against budget policy, reject regressions with typed evidence. Vocabulary encodes operation → (percentile function, budget, workload shape) as single lookup.

`Array.get` returns `Option`, surfacing out-of-bounds as typed failure. `filterOrFail` converts threshold breach to `GateFault` without branching.

```ts
import { Array as A, Data, Duration, Effect, Metric, Number as N, Order, Schedule, Stream, pipe } from "effect"

const Gates = {
  ingest: { budgetMs: 140, p: 0.95, warmup: 8, measured: 64, items: 80, batchSize: 32, within: Duration.millis(20) },
  emit:   { budgetMs: 110, p: 0.95, warmup: 8, measured: 64, items: 80, batchSize: 32, within: Duration.millis(20) },
} as const satisfies Record<string, { budgetMs: number; p: number; warmup: number; measured: number; items: number; batchSize: number; within: Duration.Duration }>

const pIdx = <K extends keyof typeof Gates>(op: K) => Math.ceil(Gates[op].measured * Gates[op].p) - 1

class GateFault extends Data.TaggedError("GateFault")<{ readonly op: keyof typeof Gates; readonly measured: number; readonly budget: number }> {
  get delta() { return N.subtract(this.measured, this.budget) }
}

const gate = <K extends keyof typeof Gates>(op: K) => {
  const cfg = Gates[op]
  const sample = Stream.range(1, cfg.items).pipe(
    Stream.schedule(Schedule.spaced("1 millis")),
    Stream.groupedWithin(cfg.batchSize, cfg.within),
    Stream.runDrain, Effect.timed, Effect.map(([d]) => Duration.toMillis(d)))
  return pipe(
    Effect.replicateEffect(sample, cfg.warmup, { discard: true }),
    Effect.zipRight(Effect.replicateEffect(sample, cfg.measured)),
    Effect.map(A.sort(Order.number)),
    Effect.flatMap((sorted) => A.get(sorted, pIdx(op))),
    Effect.tap((p) => Metric.set(Metric.tagged(Metric.gauge("gate_p_ms"), "op", op), p)),
    Effect.filterOrFail((p) => p <= cfg.budgetMs, (p) => new GateFault({ op, measured: p, budget: cfg.budgetMs })),
    Effect.map((p) => ({ op, p, budget: cfg.budgetMs }) as const))
}
```

**Gate contracts:**
- `pIdx` computes percentile index from vocabulary — pure function, not scattered arithmetic.
- `GateFault` carries both `measured` and `budget` as constructor params. `delta` getter computes from instance fields.
- Warmup and measured phases via `replicateEffect` — determinism from fixed counts.
- `Array.get` returns `Option`, composing with `flatMap` — out-of-bounds surfaces as typed `NoSuchElementException`.
