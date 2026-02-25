# [H1][ALGORITHMS]
>**Dictum:** *Algorithm design in Effect is contract-first algebra: lock cardinality, state, merge, and terminal semantics before selecting operators.*

<br>

This chapter defines executable algorithm contracts for Effect streams and chunks, not style recipes: cardinality transition, state transition, merge policy, and terminal policy are the only primitives that matter. Choose the minimum operators that preserve those contracts (`mapAccum*`, `zipAllSortedByKey*`, `GroupBy.evaluate`, `transduce`, `runFoldWhile*`) and reject convenience wrappers that do not add algebraic value. Retry/lifecycle/boundary concerns are intentionally excluded so agents can keep this file as a pure transform reference.

---
## [1][CARDINALITY_REWRITE_LAWS]
>**Dictum:** *Encode `element -> chunk -> summary` boundaries directly in operators; avoid downstream reinterpretation.*

<br>

```ts
import { Chunk, Order, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const source = Chunk.fromIterable([11, 4, 8, 8, 2, 15, 6, 4, 13, 9, 1, 12]);

// --- [FUNCTIONS] -------------------------------------------------------------

const canonical = pipe(
  source,
  Chunk.filter((n) => n >= 4),
  Chunk.dedupe,
  Chunk.sort(Order.number),
);
const summaries = pipe(
  canonical,
  Chunk.chunksOf(4),
  Chunk.map((batch) =>
    Chunk.reduce(
      batch,
      [0, 0, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const,
      ([count, sum, min, max], n) => [count + 1, sum + n, Math.min(min, n), Math.max(max, n)] as const,
    )),
  Chunk.toReadonlyArray,
);
const splitByThreshold = pipe(
  canonical,
  Chunk.splitWhere((n) => n >= 12),
  ([below, atOrAbove]) => [Chunk.toReadonlyArray(below), Chunk.toReadonlyArray(atOrAbove)] as const,
);
```

**Rewrite contracts:**
- use `Chunk.sort(Order.*)` or projection-order `Chunk.sortWith`; never comparator-style sorting,
- keep summary folds one-pass and tuple-driven,
- handle `splitWhere` as tuple output immediately,
- avoid redundant secondary splits when one boundary rule captures the domain contract.

---
## [2][STATEFUL_STREAM_TRANSDUCERS]
>**Dictum:** *State machines belong in `mapAccum`/`mapAccumEffect`; terminals consume already-shaped stream products.*

<br>

```ts
import { Chunk, Effect, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const prices: ReadonlyArray<number> = [100, 102, 104, 103, 101, 101, 105, 106, 104];
const Regime = {
  hot: "hot",
  warm: "warm",
  cool: "cool",
} as const satisfies Record<"hot" | "warm" | "cool", string>;
const RegimeThreshold = {
  hot: 105,
  warm: 102,
} as const satisfies Record<"hot" | "warm", number>;

// --- [FUNCTIONS] -------------------------------------------------------------

const rollingState = Stream.fromIterable(prices).pipe(
  Stream.mapAccum([Number.NEGATIVE_INFINITY, -1] as const, ([peak, index], price) => {
    const nextIndex = index + 1;
    const nextPeak =  Math.max(peak, price);
    return [
      [nextPeak, nextIndex] as const,
      [nextIndex, price, nextPeak, nextPeak - price] as const,
    ] as const;
  }),
  Stream.runCollect,
);
const regimeRuns = Stream.fromIterable(prices).pipe(
  Stream.map((price) =>
    price >= RegimeThreshold.hot
      ? Regime.hot
      : price >= RegimeThreshold.warm
        ? Regime.warm
        : Regime.cool,
  ),
  Stream.groupAdjacentBy((regime) => regime),
  Stream.map(([regime, run]) => [regime, Chunk.size(run)] as const),
  Stream.runCollect,
);
const driftAdjusted = Stream.fromIterable(prices).pipe(
  Stream.mapAccumEffect(0, (drift, price) => {
    const delta =     price % 2 === 0 ? 1 : -1;
    const nextDrift = drift + delta;
    return Effect.succeed([nextDrift, price + nextDrift] as const);
  }),
  Stream.runCollect,
);
```

**Transducer contracts:**
- transition state remains local and immutable inside the transducer,
- run-length segmentation uses `groupAdjacentBy`, not ad-hoc mutable counters,
- effectful state transitions stay in `mapAccumEffect` with typed rails.

---
## [3][SORTED_KEY_MERGE_ALGEBRA]
>**Dictum:** *Sparse keyed joins are stream merges, not map materialization exercises.*

<br>

```ts
import { Order, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const plannedRows: ReadonlyArray<readonly [string, number]> = [
  ["a", 120], ["c", 95],
  ["e", 110], ["g", 80],
];
const observedRows: ReadonlyArray<readonly [string, number]> = [
  ["a", 118], ["b", 130],
  ["e", 104], ["f", 90 ],
];
const MergeStatus = {
  planOnly:   "plan_only",
  actualOnly: "actual_only",
  metOrAbove: "met_or_above",
  belowPlan:  "below_plan",
} as const satisfies Record<"planOnly" | "actualOnly" | "metOrAbove" | "belowPlan", string>;

// --- [FUNCTIONS] -------------------------------------------------------------

const planned =  Stream.fromIterable(plannedRows);
const observed = Stream.fromIterable(observedRows);
const alignedDelta = planned.pipe(
  Stream.zipAllSortedByKey({
    other:        observed,
    defaultSelf:  0,
    defaultOther: 0,
    order:        Order.string,
  }),
  Stream.map(([tenant, [plan, actual]]) => [tenant, plan, actual, actual - plan] as const),
  Stream.runCollect,
);
const mergedStatus = planned.pipe(
  Stream.zipAllSortedByKeyWith({
    other: observed,
    order: Order.string,
    onSelf:  (plan) =>         [MergeStatus.planOnly, plan, 0] as const,
    onOther: (actual) =>       [MergeStatus.actualOnly, 0, actual] as const,
    onBoth:  (plan, actual) => [actual >= plan ? MergeStatus.metOrAbove : MergeStatus.belowPlan, plan, actual] as const,
  }),
  Stream.runCollect,
);
```

**Merge contracts:**
- both streams must be sorted on the same distinct key order,
- merge inputs are canonical `readonly [K, A]` tuples before zipping,
- `defaultSelf` and `defaultOther` are semantic absence policy, not placeholders,
- widen numeric rows up front (`number`) to avoid literal-over-narrowing with defaults,
- projection-order sort uses `Chunk.sortWith((row) => row[0], Order.string)`,
- enforce a single merged output shape in `zipAllSortedByKeyWith` callbacks.

---
## [4][KEYED_REDUCTION_WITH_GROUPBY]
>**Dictum:** *Partition by key once, fold each partition to a scalar, then merge globally.*

<br>

```ts
import { Chunk, Effect, GroupBy, HashMap, Order, Stream, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const RowStatus = {
  ok: "ok",
  err: "err",
} as const satisfies Record<"ok" | "err", string>;
type RowStatus = (typeof RowStatus)[keyof typeof RowStatus];
const rows: ReadonlyArray<readonly [string, RowStatus, number]> = [
  ["tenant-a", RowStatus.ok,  12], ["tenant-b", RowStatus.ok,  9 ], ["tenant-a", RowStatus.err, 18],
  ["tenant-c", RowStatus.ok,  20], ["tenant-b", RowStatus.err, 15], ["tenant-a", RowStatus.ok,  10],
  ["tenant-c", RowStatus.err, 22],
];

// --- [FUNCTIONS] -------------------------------------------------------------

const perTenantStream = pipe(
  Stream.fromIterable(rows),
  Stream.groupByKey(([tenant]) => tenant),
  GroupBy.evaluate(
    (tenant, grouped) =>
      grouped.pipe(
        Stream.runFold(
          [0, 0, 0] as const,
          ([count, errors, total], [, status, latency]) => [count + 1, errors + Number(status === RowStatus.err), total + latency] as const,
        ),
        Effect.map(([count, errors, total]) => [tenant, count, errors, total / count] as const),
        Stream.fromEffect,
      ),
    { bufferSize: 64 },
  ),
);
const groupedViews = perTenantStream.pipe(
  Stream.runCollect,
  Effect.map((chunk) => {
    const entries = pipe(chunk, Chunk.sortWith(([tenant]) => tenant, Order.string), Chunk.toReadonlyArray);
    const errorIndex = pipe(
      entries.reduce((acc, [tenant, , errors]) => HashMap.set(acc, tenant, errors), HashMap.empty<string, number>()),
      HashMap.toEntries,
      Chunk.fromIterable,
      Chunk.sortWith(([tenant]) => tenant, Order.string),
      Chunk.toReadonlyArray,
    );
    return [entries, errorIndex] as const;
  }),
);
```

**Group contracts:**
- partitioning is delegated to `groupByKey`, not hand-managed maps/queues,
- each group emits one scalar summary before global collection,
- global indices (`HashMap`) are built from scalar outputs in the same terminal pass,
- ordering is applied once at the final presentation boundary.

---
## [5][SINK_ALGEBRA_AND_TRANSDUCE_CONTRACTS]
>**Dictum:** *Sinks define terminal math; `transduce` lifts terminal math into reusable stream rewrites.*

<br>

```ts
import { Chunk, Effect, HashMap, Order, Sink, Stream, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const weightedInput: ReadonlyArray<number> = [7, 2, 6, 11, 4, 5];
const keyedRows: ReadonlyArray<readonly [string, number]> = [
  ["a", 3], ["b", 2], ["a", 5],
  ["c", 7], ["b", 4],
];

// --- [FUNCTIONS] -------------------------------------------------------------

const fixedMicroBatches = Stream.fromIterable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).pipe(
  Stream.transduce(Sink.collectAllN<number>(3)),
  Stream.runCollect,
);
const weightedSegments = Stream.fromIterable(weightedInput).pipe(
  Stream.transduce(
    Sink.foldWeightedDecompose({
      initial:   Chunk.empty<number>(),
      maxCost:   10,
      cost:      (_, n) => n,
      decompose: (n) => (n > 10 ? Chunk.make(10, n - 10) : Chunk.empty<number>()),
      body:      (acc, n) => Chunk.append(acc, n),
    }),
  ),
  Stream.runCollect,
);
const keyedTotals = Stream.fromIterable(keyedRows).pipe(
  Stream.run(
    Sink.collectAllToMap(
      ([key]) => key,
      ([key, left], [, right]): readonly [string, number] => [key, left + right],
    ),
  ),
  Effect.map(HashMap.toEntries),
  Effect.map((entries) =>
    pipe(
      Chunk.fromIterable(entries),
      Chunk.map(([key, [, total]]) => [key, total] as const),
      Chunk.sortWith(([key]) => key, Order.string),
    )),
);
```

**Sink contracts:**
- sink constructor choice is terminal behavior, not implementation detail,
- decomposition must move toward simpler pieces to guarantee progress,
- keyed merge associativity is defined once in `collectAllToMap` merge logic,
- numeric sink inputs are widened to avoid literal arithmetic traps.

---
## [6][TERMINAL_CONTRACTS_STRICT_VS_RESIDUAL]
>**Dictum:** *Strict terminals stop by boundary/failure policy; residual terminals continue while preserving rejected evidence explicitly.*

<br>

```ts
import { Chunk, Data, Effect, Either, Stream } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const samples: ReadonlyArray<number> = [6, -3, 5, 4, -1, 8];

// --- [ERRORS] ----------------------------------------------------------------

class NegativeSample extends Data.TaggedError("NegativeSample")<{
  readonly value: number;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const strictBudget =    Stream.fromIterable([6, 5, 4, 3, 2]).pipe(Stream.runFoldWhile(0, (sum) => sum < 15, (sum, n) => sum + n),);
const strictValidated = Stream.fromIterable(samples).pipe(
  Stream.runFoldWhileEffect(
    0,
    (sum) => sum < 20,
    (sum, n) =>
      Effect.filterOrFail(
        Effect.succeed(n),
        (value) => value >= 0,
        (value) => new NegativeSample({ value }),
      ).pipe(Effect.map((value) => sum + value)),
  ),
  Effect.exit,
);
const residualValidated = Stream.fromIterable(samples).pipe(
  Stream.map((n) => (n >= 0 ? Either.right(n) : Either.left(n))),
  Stream.runFold(
    [0, Chunk.empty<number>()] as const,
    ([sum, rejected], value) =>
      Either.match(value, {
        onLeft: (invalid) => [sum, Chunk.append(rejected, invalid)] as const,
        onRight: (valid) => [sum + valid, rejected] as const,
      }),
  ),
  Effect.map(([sum, rejected]) => [sum, Chunk.toReadonlyArray(rejected)] as const),
);
```

**Terminal contracts:**
- `runFoldWhile` expresses pure early-stop law without external mutable guard state,
- `runFoldWhileEffect` composes boundary stop conditions with typed validation rails,
- strict contracts expose failure (`Effect.exit`) instead of sentinel substitution,
- residual contracts continue by routing invalid elements into an explicit rejection channel.
