# Transforms

## Discriminant projection

Bounded domains with N discriminants and M consumers produce N×M branches when each consumer reimplements dispatch. A vocabulary object compresses this to N entries looked up M times. The vocabulary is the single source of truth — the discriminant type derives from it via `keyof typeof`, not the other way around.

Vocabulary values are pipeline-composable constructs — `Effect.logWarning` over `"warn"`, `Duration.seconds(5)` over `5000` — so one lookup resolves every downstream axis simultaneously and the discriminant disappears from the pipeline.

```ts
import { Effect } from "effect"

const Policy = {
  transient: { status: 503, retryable: true,  log: Effect.logWarning },
  degraded:  { status: 503, retryable: true,  log: Effect.logError   },
  fatal:     { status: 500, retryable: false, log: Effect.logError   },
} as const satisfies Record<string, {
  status:    number
  retryable: boolean
  log: (...message: ReadonlyArray<unknown>) => Effect.Effect<void>
}>

const withErrorPolicy = <A, R>(effect: Effect.Effect<A, { severity: keyof typeof Policy; cause: string }, R>) =>
  effect.pipe(
    Effect.tapError(({ severity, cause }) => Policy[severity].log(cause)),
    Effect.mapError(({ severity, cause }) =>
      (({ status, retryable }) => ({ status, retryable, body: { error: cause } }))(Policy[severity])),
  )
```

**Projection contracts:**
- One vocabulary per behavioral domain — `Policy` maps severity to response shape AND logging behavior, not two parallel tables for the same discriminant.
- `as const satisfies Record<string, Shape>` — `satisfies` without `as const` widens literals to `number | boolean`, collapsing `503` and `500` into the same type. `Record<K, V>` with a concrete key union creates a circular dependency when the key type derives from the same object.
- Vocabulary entries project into pipeline stages without intermediate mapping — `Policy[severity].log(cause)` calls the value directly. If a consumer wraps (`new HttpError(Policy[severity].status)`) or unwraps (`.valueOf()`), the vocabulary stores the wrong abstraction.


## Stateful accumulation

`Stream.mapAccum` threads compound state as a Mealy machine — the accumulator record is memory, the emission record is output tape. `[state, emission] as const` makes the decoupling load-bearing: state fields serve the algorithm's memory, emission fields project what downstream consumes, and the two sets share no members.

Welford's online variance uses forward state only — no windowing, no re-scanning. The before-delta × after-delta product (`δ * (dd - mean)`) keeps `m2` non-negative by construction: the mean update is a convex combination, so both deltas land on the same side of zero. Classification flows from running statistics (`dd ≤ mean`, `dd ≤ mean + σ`), not external thresholds — regime boundaries adapt as the distribution evolves.

```ts
import { Chunk, Number as N, Stream } from "effect"

const analyze = (prices: Stream.Stream<number>) =>
  prices.pipe(
    Stream.mapAccum({ n: 0, mean: 0, m2: 0, peak: 0 }, (s, price) => {
      const n      = s.n + 1
      const peak   = N.max(s.peak, price)
      const dd     = peak > 0 ? (peak - price) / peak : 0
      const δ      = dd - s.mean
      const mean   = s.mean + δ / n
      const m2     = s.m2 + δ * (dd - mean)
      const σ      = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0
      const regime = dd <= mean ? "rally" : dd <= mean + σ ? "drift" : "stress"
      return [{ n, mean, m2, peak }, { price, dd, σ, regime }] as const
    }),
    Stream.groupAdjacentBy(({ regime }) => regime),
    Stream.map(([regime, run]) => ({
      regime,
      length: Chunk.size(run),
      peakDD: Chunk.reduce(run, 0, (mx, { dd }) => N.max(mx, dd)),
    })),
    Stream.runCollect,
  )
```

**Accumulation contracts:**
- State immutable: compound record, returned fresh each step — no `Ref`, no mutation, no closed-over counters. **Keyed accumulator state uses `HashMap`** — `HashMap.set` returns a new map (persistent, structurally shared). Never `new Map()` + `.set()` — that mutates in place and breaks referential transparency. `HashMap.fromIterable` at initialization, `HashMap.get`/`HashMap.set` for lookup and update.
- State/emission zero overlap: state fields serve computation (`n`, `mean`, `m2`, `peak`), emission fields serve consumption (`price`, `dd`, `σ`, `regime`). `σ` derives from two state fields — the decoupling is structural.
- Welford update order is load-bearing: `δ` before mean update, `(dd - mean)` after. Reversing gives `δ²` (overcounts). Bessel's correction (`n - 1`) with `n > 1` guard prevents 0/0 at single observation. Regime boundaries derive from accumulator fields at point of use — no extracted threshold logic.
- Run-length segmentation via `groupAdjacentBy` on emission field, not via counter in accumulator state. `Chunk.reduce` folds each `NonEmptyChunk` to scalar — no re-expansion after aggregation.

```ts
// HashMap accumulator in mapAccum — persistent update, zero mutation
import { HashMap, Option, Stream } from "effect"

Stream.mapAccum(HashMap.empty<string, State>(), (clients, event) => {
  const prev = HashMap.get(clients, event.clientId).pipe(
    Option.getOrElse(() => initialState),
  )
  const next = updateState(prev, event)
  const updated = HashMap.set(clients, event.clientId, next)
  return [updated, { ...emission }] as const
})
```


## Keyed merge

`zipAllSortedByKeyWith` trades upstream sort cost for unbounded merge capacity — `Order<K>` as precondition contract eliminates buffering, so two streams of arbitrary length co-traverse in constant space. Embedding functions project heterogeneous source types into the monoid's value space — the three key-alignment callbacks (`onSelf`, `onOther`, `onBoth`) resolve asymmetric key presence without coupling sources to each other's shapes.

`Order.struct` composes per-field orderings into a lexicographic product over named composite keys. `Monoid.struct` lifts field-level monoids into a product monoid — the merge algebra is defined per field, not per record. Output is `Stream<[K, V]>` — the same shape as input — so merges left-fold into N-way joins via associativity.

```ts
import { Order, Stream, String as S } from "effect"
import { Monoid } from "@effect/typeclass"
import * as N from "@effect/typeclass/data/Number"

const alignSorted = <K, A, B, V>(
  ord: Order.Order<K>,
  M: Monoid.Monoid<V>,
  embedL: (a: A, zero: V) => V,
  embedR: (b: B, zero: V) => V,
) =>
  ((el, er) =>
    (left: Stream.Stream<readonly [K, A]>, right: Stream.Stream<readonly [K, B]>) =>
      left.pipe(
        Stream.zipAllSortedByKeyWith({
          other:   right,
          order:   ord,
          onSelf:  el,
          onOther: er,
          onBoth:  (a, b) => M.combine(el(a), er(b)),
        }),
      )
  )((a) => embedL(a, M.empty), (b) => embedR(b, M.empty))

const merged = alignSorted(
  Order.struct({ region: S.Order, sku: S.Order }),
  Monoid.struct({ qty: N.MonoidSum, peak: N.MonoidMax }),
  (qty, z) => ({ ...z, qty }),
  (p, z)   => ({ ...z, peak: p }),
)(quantities, peaks)
```

**Merge contracts:**
- Three callbacks partition the key space exhaustively. Omitting `onSelf` or `onOther` silently drops unmatched keys; unsorted input silently corrupts output — neither failure is type-enforced. The monoid specialization (`embedL = embedR = identity`) is a design choice, not a default.
- Embedding functions project heterogeneous sources into the monoid's value space. `{ ...zero, field }` is the canonical embedding — monoid identity as base, override one axis. No hardcoded zero-values.
- Output preserves input shape `Stream<[K, V]>` — merges chain via left-fold. N-way composability requires `A = B = V`; the first heterogeneous merge fixes the output type and closes the chain.


## Partitioned reduction

`groupByKey` routes elements by discriminant into K concurrent sub-streams; `GroupBy.evaluate` runs an independent terminal per partition, merging results in arbitrary order. `reduceByKey` encapsulates the full partition-reduce-index pipeline — `keyOf` configures partitioning, the fold triple (seed, step, projection) configures reduction, and both axes vary independently. Adding a new aggregate requires one new `reduceByKey` call, zero plumbing. The projection compresses internal accumulator fields to the consumer's output contract — without it, downstream types depend on accumulation internals that vary per aggregate.

```ts
import { Effect, GroupBy, HashMap, Number as N, Stream, identity, pipe } from "effect"

type Tick = readonly [queue: string, passed: boolean, elapsed: number]

const reduceByKey = <K, A, S, B>(
  keyOf: (a: A) => K, seed: NoInfer<S>, step: (s: S, a: A) => S, project: (s: S) => B,
  opts?: { bufferSize?: number },
) => (stream: Stream.Stream<A>) =>
  stream.pipe(
    Stream.groupByKey(keyOf),
    GroupBy.evaluate((key, sub) => sub.pipe(
      Stream.runFold(seed, step), Effect.map((s) => [key, project(s)] as const), Stream.fromEffect), opts),
    Stream.runCollect,
    Effect.map(HashMap.fromIterable),
  )

const queueHealth = (ticks: Stream.Stream<Tick>) =>
  ticks.pipe(
    reduceByKey(
      ([q]) => q, [0, 0, 0] as const,
      ([n, ok, ms], [, pass, elapsed]: Tick) => [n + 1, ok + +pass, ms + elapsed] as const,
      ([n, ok, ms]) => ({ n, failRate: 1 - ok / n, avgMs: ms / n }),
      { bufferSize: 64 },
    ),
    Effect.map((idx) =>
      [idx, pipe(idx, HashMap.filter(({ failRate }) => failRate > 0.1), HashMap.keySet)] as const),
  )

const peakLatency = (ticks: Stream.Stream<Tick>) =>
  ticks.pipe(reduceByKey(([q]) => q, 0, (peak, [, , ms]: Tick) => N.max(peak, ms), identity))
```

**Reduction contracts:**
- `reduceByKey` takes `keyOf` and the fold triple positionally — no named algebra type. `NoInfer<S>` defers accumulator inference to the step function's return type; removing it makes literal seeds (`[0, 0, 0] as const`) over-narrow `S` to `readonly [0, 0, 0]`, failing the step's wider `readonly [number, number, number]` assignability check.
- Fold is left action `(S, A) → S` — accumulator type `S` differs from element type `A` and output type `B`. `project: S → B` bridges the gap; when `S = B` (degenerate), `project = identity`.
- `reduceByKey` internalizes `groupByKey` → `evaluate` → `runCollect` → `fromIterable` — the fold algebra never sees the key. Partitioning and reduction are orthogonal; swapping the triple changes per-partition output without touching `keyOf` or `bufferSize`.
- `HashMap.fromIterable` absorbs arbitrary evaluation order (`GroupBy.evaluate` merges with unbounded concurrency). `HashMap.filter` → `HashMap.keySet` derives a typed `HashSet<string>` membership predicate from the index without re-scanning the stream.

## Terminal algebra

Whether invalid input terminates a pipeline or accumulates as evidence is a terminal policy decision orthogonal to segmentation. `ingest` configures both concerns: a cost function and budget drive `Sink.foldWeighted` internally (`L = In` guarantees self-reset via `transduce`), while the fold triple (seed, continuation predicate, per-element step) drives reduction. The step's error channel type is the terminal policy: `E = Fault` halts on first invalid element, `E = never` routes rejections into the accumulator.

```ts
import { Chunk, Data, Effect, Number as N, Schedule, Sink, Stream } from "effect"

type Reading = readonly [sensor: string, metric: string, mag: number, conf: number]

class Fault extends Data.TaggedError("Fault")<{ readonly sensor: string; readonly confidence: number }> {}

const ingest = <A, S, E>(
  seed: NoInfer<S>, cont: (s: S) => boolean, step: (s: S, a: A) => Effect.Effect<S, E>,
  costFn: (a: A) => number, budget: number,
) => (stream: Stream.Stream<A>) =>
  stream.pipe(
    Stream.transduce(Sink.foldWeighted({
      initial: Chunk.empty<A>(), maxCost: budget,
      cost: (_, a) => costFn(a), body: (acc, a) => Chunk.append(acc, a),
    })),
    Stream.runFoldWhileEffect(seed, cont, (acc, chunk) => Effect.reduce(chunk, acc, step)))

const processed = ingest(
  [0, 0, 0] as const, ([sum]) => sum < 50_000,
  ([sum, peak, n], [sensor, , mag, conf]) => conf > 0
    ? Effect.succeed([sum + mag, N.max(peak, mag), n + 1] as const)
    : Effect.fail(new Fault({ sensor, confidence: conf })),
  ([, , mag]: Reading) => mag, 10_000)

const timed = (readings: Stream.Stream<Reading>) =>
  readings.pipe(
    Stream.aggregateWithin(
      Sink.foldWeighted({ initial: Chunk.empty<Reading>(), maxCost: 10_000, cost: (_, [, , mag]) => mag, body: (acc, a) => Chunk.append(acc, a) }),
      Schedule.spaced("5 seconds"),
    ))
```

## Pipeline factory closure

When a module has no `Effect.Service` (stateless pipeline, pure transform), the exported factory function acts as the scoped constructor. Single-caller helpers inline into this factory rather than floating at module level. The factory captures shared resources (vocabularies, metrics, config) in its closure and returns the composed pipeline.

```ts
import { Chunk, Effect, HashMap, Metric, Option, Stream } from "effect"

// _-prefixed module-level: semantic anchors serving 2+ call sites or algorithm implementations
const _Policy = { /* vocabulary */ } as const satisfies Record<string, { /* shape */ }>
const _signal = { processed: Metric.counter("x_total") } as const
const _classify = (stats: Stats): Tier => /* reusable pure transform */

// exported factory IS the scoped constructor — single-caller helpers inline here
const Pipeline = (events: Stream.Stream<Event>) =>
  events.pipe(
    Stream.mapAccum(HashMap.empty<string, State>(), (acc, event) => {
      // inline: single-caller logic lives inside the factory, not at module level
      const prev = HashMap.get(acc, event.id).pipe(Option.getOrElse(() => init))
      const next = update(prev, event)
      return [HashMap.set(acc, event.id, next), { ...emission }] as const
    }),
    Stream.mapEffect(({ stats }) =>
      Metric.increment(_signal.processed).pipe(Effect.as(stats)),
    ),
    Stream.runCollect,
    Effect.map(Chunk.toReadonlyArray),
  )

export { Pipeline }
```

**Factory closure contracts:**
- Module-level `_`-prefixed symbols are semantic anchors (vocabularies, metrics, reusable algorithms) serving 2+ call sites or embodying domain knowledge worth naming.
- Single-caller logic inlines into the factory body — no `_helper` at module level consumed by one pipeline stage.
- The factory captures nothing mutable — vocabularies and metrics are immutable; mutable state flows through `mapAccum`/`Ref` only.

**Terminal contracts:**
- `Sink.foldWeighted` with `costFn` and `budget` produces `Sink<Chunk<A>, A, A>` — `L = In` satisfies `transduce`'s self-resetting contract. `costFn = () => 1` degenerates to count-based batching; the cost projection and the fold triple are independently configurable.
- `maxCost` is exclusive (batch open while cost `<=` budget) — a single element exceeding the budget on an empty accumulator is force-absorbed rather than deadlocking. The final partial batch is always emitted on stream termination, so the fold sees every element regardless of how the last batch aligns with the cost ceiling.
- The step's error channel type IS the terminal policy — `Effect<S, Fault>` halts the pipeline on first invalid element via typed failure. Replacing `Effect.fail(new Fault(...))` with `Effect.succeed([sum, Chunk.append(rej, ...)])` changes `E` from `Fault` to `never`, routing rejections into the accumulator as a single-pass `Chunk` without concurrent sub-streams, `Scope` requirements, or ordering hazards.
- `aggregateWithin` composes Sink × Schedule — emit batch when sink saturates OR schedule fires (whichever comes first). Schedule receives `Option<B>` (prior batch result) to compute adaptive delays; `Schedule.spaced` is constant-interval, `Schedule.exponential` adapts emission rate to throughput patterns.
