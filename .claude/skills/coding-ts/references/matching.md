# Matching

## Exhaustive Matcher Contracts

A circuit breaker with N phase variants and M policy consumers produces N×M inline derivations when each consumer reimplements variant-metric normalization and schedule construction independently — a fourth phase silently leaves stale logic in M-1 sites. `$match` as curried fold and `Match.tagsExhaustive` with `withReturnType` compress all derivation to two canonical sites where a new variant is a compile error at both.

```ts
import { Data, Duration, Match, Number as N, Option, pipe, Schedule } from "effect"

type Phase = Data.TaggedEnum<{
  Closed:   { readonly failures:  number;            readonly ceiling: number            }
  HalfOpen: { readonly successes: number;            readonly window:  number            }
  Open:     { readonly elapsed:   Duration.Duration; readonly backoff: Duration.Duration }
}>
const Phase = Data.taggedEnum<Phase>()

const pressure = Phase.$match({
  Closed: ({ failures, ceiling }) => pipe(N.divide(failures, failures + ceiling), Option.getOrElse(() => 0)),
  HalfOpen: ({ successes, window }) => pipe(
    N.divide(successes, window), Option.map((r) => N.subtract(1, N.multiply(r, r))), Option.getOrElse(() => 1)),
  Open: ({ elapsed, backoff }) => pipe(N.divide(Duration.toMillis(elapsed), Duration.toMillis(backoff)),
    Option.map(N.clamp({ minimum: 0, maximum: 1 })), Option.getOrElse(() => 1)),
})

const projectPolicy = Match.type<Phase>().pipe(
  Match.withReturnType<{ readonly schedule: Schedule.Schedule; readonly drain: boolean }>(),
  Match.tagsExhaustive({
    Closed: ({ failures, ceiling }) => ({
      schedule: Schedule.exponential(Duration.millis(N.max(10, N.subtract(ceiling, failures)))).pipe(
        Schedule.compose(Schedule.recurs(N.min(failures, ceiling)))),
      drain: false,
    }),
    HalfOpen: ({ successes, window }) => ({
      schedule: Schedule.spaced(Duration.millis(N.max(50, N.multiply(N.subtract(window, successes), 10)))),
      drain:    pipe(N.divide(successes, window), Option.map(N.lessThan(0.5)), Option.getOrElse(() => true)),
    }),
    Open: ({ elapsed, backoff }) => ({
      schedule: Schedule.exponential(backoff).pipe(Schedule.compose(Schedule.recurs(3))),
      drain:    Duration.greaterThanOrEqualTo(elapsed, backoff),
    }),
  }),
)
```

- `Phase.$match` returns curried `(phase: Phase) => number` composable with `Array.map(pressure)` or `pipe(phase, pressure)`. Michaelis-Menten `f/(f+c)` for Closed bounds to `[0,1)` with half-saturation at ceiling; quadratic complement `1 - r²` for HalfOpen delays pressure decline until ~70% success rate. Every division routes through `N.divide` returning `Option`, forcing explicit `getOrElse` at each zero-denominator site.
- `withReturnType<{ schedule; drain }>()` precedes `tagsExhaustive` — a handler returning wrong types for either field fails at the arm definition, not at consumption. Placement after any `when` evaluates the constraint against partially-constructed result type, permitting heterogeneous returns to widen.
- `Schedule.compose(Schedule.recurs(n))` truncates infinite schedules to `n` recurrences derived from variant metrics — `Schedule.intersect` is the dual (tighter of two policies). HalfOpen `drain` derives via `N.divide → Option.map(N.lessThan(0.5)) → getOrElse` — the curried predicate plugs directly into `Option.map` without intermediate boolean binding.

## Discriminator and Prefix Routing

Hierarchical metric namespaces encode a bounded prefix vocabulary as strings — open dispatch silently admits unknown tiers into aggregation hot paths where unbounded cardinality exhausts scrape budgets. `discriminatorStartsWith` routes via template literal narrowing `` `${P}${string}` ``: each arm partitions the input union by literal prefix, and the `exhaustive` terminal rejects compilation when the vocabulary outgrows the handled prefix set. A distributive mapped type `` { [T in keyof Tiers]: ... }[keyof Tiers] `` derives the discriminated union from vocabulary keys, binding type generation, dispatch routing, and exponential-decay projection to a single source.

```ts
import { flow, Match, Number as N, Option, pipe } from "effect"

const Tiers = {
  infra: { lambda: 0.01, cap: 500,  weight: 3, base: 60 },
  app:   { lambda: 0.05, cap: 2000, weight: 1, base: 10 },
  edge:  { lambda: 0.10, cap: 5000, weight: 2, base: 1  },
} as const satisfies Record<string, { lambda: number; cap: number; weight: number; base: number }>

const project = ({ lambda, cap, weight, base }: (typeof Tiers)[keyof typeof Tiers], k: number, age: number) => {
  const decay = pipe(N.multiply(lambda, age), N.multiply(-1), Math.exp)
  const sat   = pipe(N.divide(k, cap), Option.map(flow(N.min(1), N.multiply(-1), N.sum(1))), Option.getOrElse(() => 1))
  return {
    priority: pipe(N.multiply(decay, weight), N.multiply(sat), N.clamp({ minimum: 0, maximum: 1 })),
    budget:   pipe(N.multiply(cap, decay), Math.ceil),
    interval: pipe(N.divide(base, decay), Option.map(flow(Math.floor, N.max(base))), Option.getOrElse(() => base)),
  }
}

const route = Match.type<{
  [T in keyof typeof Tiers]: { readonly ns: `${T}.${string}`; readonly cardinality: number; readonly age: number }
}[keyof typeof Tiers]>().pipe(
  Match.discriminatorStartsWith("ns")("infra.", ({ cardinality, age }) => project(Tiers.infra, cardinality, age)),
  Match.discriminatorStartsWith("ns")("app.",   ({ cardinality, age }) => project(Tiers.app,   cardinality, age)),
  Match.discriminatorStartsWith("ns")("edge.",  ({ cardinality, age }) => project(Tiers.edge,  cardinality, age)),
  Match.exhaustive,
)
```

- `{ [T in keyof typeof Tiers]: ... }[keyof typeof Tiers]` distributes over vocabulary keys to construct a per-tier discriminated union. A single-object type `{ ns: UnionField }` fails silently: `Extract<SingleObj, Record<"ns", `infra.${string}`>>` yields `never` for union-valued fields, so `exhaustive` passes vacuously without routing anything.
- `discriminatorStartsWith("ns")` is curried: first call fixes the discriminant field, second extracts `` Record<"ns", `${P}${string}`> `` from `Remaining`. Three chained calls narrow `Remaining` to `never`, satisfying `exhaustive`'s `Matcher<I, F, never, A, Pr, Ret>` constraint.
- Decay `exp(-λ·age)` attenuates priority and budget over time; saturation `1 - min(k/C, 1)` penalizes high cardinality. Both pipelines route division through `N.divide` → `Option`, with `getOrElse` defaulting to vocabulary base values — no `NaN`/`Infinity` propagation. `N.clamp({ minimum: 0, maximum: 1 })` post-gates priority after multiplication.

## Predicate and Completion Algebra

N independent resource dimensions produce 2^N boolean branch surfaces when dispatched with nested conditionals — predicate algebra (`whenAnd`/`whenOr`/`not`) collapses this to linear additive composition where each combinator extends the pipeline without restructuring existing arms. The terminal operator is an explicit architectural decision: `either` preserves unmatched input as capacity-planning `Left` evidence, `option` discards as `None`, `exhaustive` requires compile-time coverage proof.

```ts
import { Array as A, Data, Match, Number as N, Option, pipe } from "effect"

type Verdict = Data.TaggedEnum<{
  Granted: { readonly fitness: number }; Deferred: { readonly rank: number }; Denied: { readonly deficit: number }
}>
const Verdict = Data.taggedEnum<Verdict>()

const adjudicate = (cap: Record<"cpu" | "mem" | "net", number>, w: readonly [number, number, number]) =>
  Match.type<{
    readonly cpu:   number; readonly mem:         number;  readonly net:      number
    readonly burst: number; readonly preemptible: boolean; readonly priority: number
  }>().pipe(
    Match.whenAnd(
      { cpu: N.lessThanOrEqualTo(cap.cpu) }, { mem: N.lessThanOrEqualTo(cap.mem) }, { net: N.lessThanOrEqualTo(cap.net) },
      (c) => Verdict.Granted({ fitness: pipe(
        A.zipWith([cap.cpu - c.cpu, cap.mem - c.mem, cap.net - c.net], w, N.multiply),
        N.sumAll, N.divide(N.sumAll(w)), Option.getOrElse(() => 0),
      )}),
    ),
    Match.whenOr(
      { burst: N.greaterThan(0) }, { preemptible: (p: boolean) => p },
      (c) => Verdict.Deferred({ rank: pipe(
        N.sum(N.multiply(c.burst, w[0]), N.multiply(+c.preemptible, w[1])),
        N.divide(N.sumAll(w)), Option.getOrElse(() => 0),
      )}),
    ),
    Match.not({ priority: N.greaterThan(0) }, (c) => Verdict.Denied({ deficit: pipe(
      A.zipWith([c.cpu - cap.cpu, c.mem - cap.mem, c.net - cap.net], w, (d, wi) => N.multiply(N.max(d, 0), wi)),
      N.sumAll,
    )})),
    Match.either,
  )
```

- `whenAnd` intersects three dimension guards — `N.lessThanOrEqualTo(cap.cpu)` is a data-last predicate plugged directly into the object pattern slot. Weighted fitness via `A.zipWith(slacks, w, N.multiply) → N.sumAll → N.divide(totalWeight)` normalizes through `Option`-wrapped division, producing a continuous `[0,1]` scalar rather than a boolean pass/fail.
- `Match.not({ priority: N.greaterThan(0) })` captures the complement: claims where priority is NOT above zero become `Denied`. High-priority over-budget claims failing both `whenAnd` and `whenOr` fall through to `Match.either` as `Left`, preserving full input shape as observability evidence. `exhaustive` cannot terminate predicate-based matchers — numeric guards do not narrow structural `Remaining` to `never`.
- Weight vector `w` serves triple duty: fitness normalization in `whenAnd` (weighted slack), deferral ranking in `whenOr` (weighted burst+preemptibility via `+c.preemptible` boolean-to-numeric coercion), deficit weighting in `not` (per-dimension overshoot clamped at zero via `N.max(d, 0)`). `N.sumAll(w)` as shared denominator means zero total weight routes through `Option.none`, caught symmetrically by `getOrElse(0)`.

## Match Bridges to Effect and Data Boundaries

HTTP status codes and fiber cause trees dispatch at different abstraction layers — transport boundary vs concurrency topology. Without a single canonical bridge, each caller fragments the domain error type into per-site variants that resist composite retry policy. `matchStatus` and `Cause.match` converge into one `BoundaryFault` whose `Order`-derived lattice join reduces arbitrary cause trees to a single fault through vocabulary ordinal comparison.

```ts
import { Cause, Data, Duration, Effect, Option, Order, flow } from "effect"
import { HttpClientResponse } from "@effect/platform"

const Severity = {
  timeout:  { ord: 0, retry: true  }, throttled: { ord: 1, retry: true  }, unavailable: { ord: 2, retry: true },
  rejected: { ord: 3, retry: false }, internal:  { ord: 4, retry: false },
} as const satisfies Record<string, { readonly ord: number; readonly retry: boolean }>

class BoundaryFault extends Data.TaggedError("BoundaryFault")<{ readonly reason: keyof typeof Severity }> {
  static readonly ord  = Order.mapInput(Order.number, (f: BoundaryFault) => Severity[f.reason].ord)
  static readonly join = Order.max(BoundaryFault.ord)
  get retryable() { return Severity[this.reason].retry }
  get retryAfter() { return this.retryable ? Option.some(Duration.seconds(Severity[this.reason].ord + 1)) : Option.none() }
  static readonly fromStatus = HttpClientResponse.matchStatus({
    408:   () => Effect.fail(new BoundaryFault({ reason: "timeout"     })),
    429:   () => Effect.fail(new BoundaryFault({ reason: "throttled"   })),
    503:   () => Effect.fail(new BoundaryFault({ reason: "unavailable" })),
    "4xx": () => Effect.fail(new BoundaryFault({ reason: "rejected"    })),
    "5xx": () => Effect.fail(new BoundaryFault({ reason: "internal"    })),
    orElse: (r) => Effect.succeed(r),
  })
  static fromCause = <A, R>(self: Effect.Effect<A, unknown, R>): Effect.Effect<A, BoundaryFault, R> =>
    self.pipe(
      Effect.sandbox,
      Effect.mapError(flow((c: Cause.Cause<unknown>) => Cause.match(c, {
        onEmpty: new BoundaryFault({ reason: "internal" }), onFail: () => new BoundaryFault({ reason: "internal" }),
        onDie: () => new BoundaryFault({ reason: "internal" }), onInterrupt: () => new BoundaryFault({ reason: "timeout" }),
        onSequential: BoundaryFault.join, onParallel: BoundaryFault.join,
      }), Cause.fail)),
      Effect.unsandbox,
    )
}
```

- `Severity` vocabulary encodes merge precedence (`ord`), retryability, and backoff derivation in one entry — `Order.mapInput(Order.number, projector)` lifts the ordinal into `Order<BoundaryFault>`, and `Order.max` produces the lattice join directly. `onSequential`/`onParallel` commit to this algebra, making cause-tree topology irrelevant to merge outcome.
- Both bridges are static methods on the error type — `fromStatus` normalizes HTTP transport via `matchStatus` (exact codes before range patterns, `orElse` captures the success rail), `fromCause` normalizes concurrency topology. The canonical bridge site IS the error class; no per-caller projection functions exist. Adding a severity is one `Severity` entry; merge, retryability, and backoff adapt without class modification.
- `sandbox` surfaces `Cause<unknown>`, `Cause.match` folds bottom-up with the lattice join, `flow(matcher, Cause.fail)` re-embeds the reduced fault as typed cause, and `unsandbox` extracts to the error channel. This re-promotion preserves typed-error-rail semantics for downstream retry composition, unlike `catchAllCause` which absorbs defects into the success channel.

## Immediate Dispatch and Value Classification

`Match.type` constructs reusable matchers that return functions; immediate forms dispatch and resolve within a single expression. `Match.valueTags(signal, handlers)` is the data-first mirror of `$match(handlers)` — both enforce exhaustive `_tag` coverage, but `valueTags` returns the result directly rather than a curried function. `Match.value(x).pipe(..., Match.option)` binds a concrete value inline and terminates with `Option`, capturing partial classification where unmatched inputs represent valid absence rather than programmer error.

```ts
import { Data, Match, Number as N, Option, pipe } from "effect"

type Signal = Data.TaggedEnum<{
  Heartbeat:   { readonly latency: number; readonly baseline: number }
  Degraded:    { readonly errorRate: number; readonly threshold: number }
  Unreachable: { readonly downtime: number; readonly sla: number }
}>
const Signal = Data.taggedEnum<Signal>()

const Severity = {
  nominal:  { ceiling: 0.3, weight: 1 },
  elevated: { ceiling: 0.7, weight: 3 },
  critical: { ceiling: 1.0, weight: 5 },
} as const satisfies Record<string, { readonly ceiling: number; readonly weight: number }>

const classify = (signal: Signal) => {
  const score = Match.valueTags(signal, {
    Heartbeat: ({ latency, baseline }) => pipe(
      N.divide(latency, baseline), Option.map(N.clamp({ minimum: 0, maximum: 1 })), Option.getOrElse(() => 0)),
    Degraded: ({ errorRate, threshold }) => pipe(
      N.divide(errorRate, threshold), Option.map(N.clamp({ minimum: 0, maximum: 1 })), Option.getOrElse(() => 1)),
    Unreachable: ({ downtime, sla }) => pipe(
      N.divide(downtime, sla), Option.map(N.clamp({ minimum: 0, maximum: 1 })), Option.getOrElse(() => 1)),
  })
  return pipe(
    Match.value(score).pipe(
      Match.when(N.lessThan(Severity.nominal.ceiling),  () => "nominal" as const),
      Match.when(N.lessThan(Severity.elevated.ceiling), () => "elevated" as const),
      Match.option,
    ),
    Option.map((level)  => ({ score, level, weight: Severity[level].weight })),
    Option.getOrElse(() => ({ score, level: "critical" as const, weight: Severity.critical.weight })),
  )
}
```

- `valueTags(signal, handlers)` is the data-first dual of `$match(handlers)`: identical exhaustive constraint on `_tag` coverage via `{ [Tag in Tags<"_tag", I>]: ... } & { [Tag in Exclude<keyof P, Tags>]: never }`, but where `$match` returns `(input: I) => A` for pipeline composition (`Array.map(pressure)`), `valueTags` returns `A` immediately. The curried overload `valueTags(handlers)` is equivalent to `$match` — the data-first arity is syntactic preference for one-shot call sites.
- `Match.option` terminates predicate-based matchers as `Option<A>` — matched arms produce `Some(a)`, unmatched inputs produce `None`. Contrast with `either` which preserves the unmatched input as `Left(Remaining)` for downstream observability, and `exhaustive` which requires compile-time proof that `Remaining` is `never`. Score `>=` `elevated.ceiling` falls through both `when` arms, yielding `None` that `Option.map` never evaluates — critical classification exists only in the `getOrElse` fallback, encoding that critical is the *absence* of a benign classification rather than an affirmative match.
- `Severity` vocabulary drives both dispatch layers: `ceiling` fields serve as `N.lessThan` threshold arguments in the value matcher, `weight` fields project from the result via `Severity[level].weight`. `N.divide` returns `Option<number>` in all three `valueTags` arms — each `Option.map(N.clamp({...})) -> getOrElse` chain is the canonical zero-denominator-safe normalization. Default values diverge by variant semantics: `Heartbeat` defaults to `0` (absence of latency is healthy), `Degraded` and `Unreachable` default to `1` (division failure under degradation is worst-case).

## Discriminant Exhaustion and Type Narrowing

`discriminatorsExhaustive` generalizes `tagsExhaustive` beyond `_tag` — any string-literal discriminant field drives exhaustive dispatch with compile-time totality. `Match.instanceOf` narrows by class prototype chain, returning `SafeRefinement<InstanceType<A>, never>` where the `never` remainder means it cannot subtract from `Remaining`; non-subtractive refinements demand open terminals (`orElse`, `option`, `either`) rather than `exhaustive`. Type-level refinements `Match.string`, `Match.number`, `Match.bigint` ARE subtractive — they narrow the `Remaining` type and compose with `exhaustive` when all type-branches are covered.

```ts
import { Data, Match, Number as N, Option, pipe } from "effect"

const Weights = {
  transport: { base: 5, decay: 0.8 },
  timeout:   { base: 3, decay: 0.6 },
  protocol:  { base: 1, decay: 0.9 },
} as const satisfies Record<string, { readonly base: number; readonly decay: number }>

class TransportError { readonly channel = "transport" as const; constructor(readonly bytes:   number) {} }
class TimeoutError   { readonly channel = "timeout"   as const; constructor(readonly elapsed: number) {} }
class ProtocolError  { readonly channel = "protocol"  as const; constructor(readonly code:    number) {} }

type ChannelEvent = TransportError | TimeoutError | ProtocolError

const quantify = (evt: ChannelEvent, depth: number) =>
  Match.value(evt).pipe(
    Match.instanceOf(TransportError, ({ bytes }) => pipe(
      N.divide(bytes, 1024), Option.map(N.multiply(Weights.transport.base)), Option.getOrElse(() => Weights.transport.base))),
    Match.instanceOf(TimeoutError, ({ elapsed }) => pipe(
      N.multiply(elapsed, Math.pow(Weights.timeout.decay, depth)))),
    Match.instanceOf(ProtocolError, ({ code }) => pipe(
      N.multiply(code, Math.pow(Weights.protocol.decay, depth)))),
    Match.orElse(() => 0),
  )

const route = Match.discriminatorsExhaustive("channel")({
  transport: ({ bytes }: TransportError) => pipe(N.divide(bytes, 1024), Option.getOrElse(() => 0)),
  timeout:   ({ elapsed }: TimeoutError) => N.multiply(elapsed, Weights.timeout.decay),
  protocol:  ({ code }: ProtocolError)   => N.multiply(code, Weights.protocol.decay),
})
```

- `discriminatorsExhaustive("channel")(handlers)` is curried — the first call selects the discriminant field, the second supplies exhaustive handlers keyed by that field's literal values. Unlike `tagsExhaustive` which is hard-wired to `_tag`, this generalizes to any `readonly field: "literal"` discriminant. The returned function IS the exhaustive terminal — no trailing `Match.exhaustive` call. Adding a new literal to the union without a corresponding handler is a compile error.
- `instanceOf(Class, handler)` tests via `instanceof` and narrows to `InstanceType<A>`, but its return type `SafeRefinement<T, never>` makes the refinement non-subtractive — `Remaining` is unchanged after the arm. Consequently, `Match.exhaustive` always fails after `instanceOf` branches because `Remaining` never reaches `never`. The `orElse(() => 0)` terminal is structurally mandatory, not a catch-all escape hatch. Contrast with `Match.string`/`Match.number`/`Match.bigint` which DO subtract their respective primitive from `Remaining`, allowing exhaustive completion when combined with union constituents.
- `Weights` vocabulary centralizes severity and decay parameters — `quantify` combines `instanceOf` dispatch with `N.divide`/`N.multiply` arithmetic on class fields, `route` uses `discriminatorsExhaustive` as the canonical function form for pipeline composition. Both access the same vocabulary; `quantify` uses `base` + `decay` for depth-scaled scoring, `route` uses only `decay` for flat projection. The vocabulary-driven pattern means adding a channel requires one `Weights` entry, one class, one union constituent, and the compiler enforces handler addition in both matchers.

## Rules
- Closed tagged domains require exhaustive finalizers (`tagsExhaustive`, `discriminatorsExhaustive`, or terminal `Match.exhaustive`) — no catch-all `orElse` masking new variants in bounded unions.
- `Match.withReturnType` precedes all branch declarations — placement after any `when` evaluates the constraint against partially-constructed result type.
- Predicate composition via `whenAnd`/`whenOr`/`not` replaces boolean branching — no `if`/ternary chains for multi-dimension dispatch.
- Completion operator (`option`/`either`/`exhaustive`) is an explicit architectural decision: `either` when unmatched cases are observable evidence, `option` when they are absence, `exhaustive` when they are compile errors.
- Match bridges to Effect rails exist at exactly one canonical site per boundary type — no duplicated status-to-error or cause-to-error projections across call sites.
- `$match` and `Match.valueTags` are the exhaustive fold forms for `Data.TaggedEnum` — use curried `$match(handlers)` for pipeline composition, `valueTags(value, handlers)` for immediate one-shot dispatch.
