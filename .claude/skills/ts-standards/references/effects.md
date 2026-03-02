## Entry rail composition

`Effect.fn` separates domain logic from resilience policy — the pipeline operator (second argument) applies retry/timeout outside the generator body, ensuring one execution per attempt. `Policy` drives both `tapError` and `retry` from a vocabulary gated via `satisfies` on `IngressError["stage"]`.

```ts
import { Data, Duration, Effect, Schedule, Schema as S } from "effect"

class IngressError extends Data.TaggedError("IngressError")<{
  readonly stage: "decode" | "quota" | "upstream"; readonly cause: unknown
}>() {}

const Policy = {
  decode:   { status: 400, retryable: false, log: Effect.logWarning },
  quota:    { status: 429, retryable: true,  log: Effect.logWarning },
  upstream: { status: 502, retryable: true,  log: Effect.logError   },
} as const satisfies Record<IngressError["stage"], { status: number; retryable: boolean; log: (...args: ReadonlyArray<unknown>) => Effect.Effect<void> }>

const ingest = <A extends { readonly quota: number }, I, R>(
  schema: S.Schema<A, I, R>,
  dispatch: (a: A, signal: AbortSignal) => Promise<Response>,
) => Effect.fn("Ingress.ingest")(
  (input: unknown): Effect.Effect<Response, IngressError, R> =>
    S.decodeUnknown(schema)(input).pipe(
      Effect.mapError((cause) => new IngressError({ stage: "decode", cause })),
      Effect.filterOrFail(({ quota }) => quota > 0, (a) => new IngressError({ stage: "quota", cause: a.quota })),
      Effect.flatMap((a) =>
        Effect.tryPromise({ try: (signal) => dispatch(a, signal), catch: (cause) => new IngressError({ stage: "upstream", cause }) }),
      ),
      Effect.tapError(({ stage }) => Policy[stage].log("ingress rejected").pipe(Effect.annotateLogs({ stage }))),
    ),
  (effect) => effect.pipe(
    Effect.retry({ while: ({ stage }) => Policy[stage].retryable, schedule: Schedule.exponential(Duration.millis(100)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))) }),
    Effect.timeoutFail({ duration: Duration.seconds(5), onTimeout: () => new IngressError({ stage: "upstream", cause: "deadline" }) }),
  ),
)
```

**Entry contracts:**
- `Effect.fn("span")(body, pipeline)` — retry executes only the sealed effect, not the generator. Catches defects in both body and pipeline as `Cause.Sequential`. `fnUntraced` passes original args to pipeline steps; traced variant does not.
- `S.Schema<A, I, R>` propagates context requirements — `transformOrFail` or service-backed filters widen `R`. `decodeUnknown` accepts `unknown`; `decode` accepts `Schema.Encoded<S>`. `Either`/`Option` decode variants require `R = never`.
- `tryPromise` object form threads `AbortSignal` for fiber interruption propagation; thunk form runs to completion regardless. `Effect.try` is the synchronous counterpart. `liftPredicate(value, pred, onFalse)` lifts values at entry; `filterOrFail` guards mid-pipeline.
- Vocabulary fields gated via `satisfies` — adding a stage without matching Policy entry fails at compile time.
- `Schedule.jittered` prevents thundering herd. `intersect` = tighter (both agree); `union` = looser (either permits). `resetAfter` = circuit-breaker primitive. `whileInput` gates on error value; `tapInput`/`tapOutput` emit within algebra.


## Fan-in topology and retention contracts

`mode` commits return shape — `"either"` yields `Either<A, E>` per branch (never fails); `"validate"` fails with `{ [K]: Option<E_K> }` (discards successes). Mode selection propagates into all downstream combinators.

`foldOutcomes` parameterizes fold algebra over `(Z, Either<A, E>, index) => Z`. `diagnose` preserves per-key structural identity via `Record.map` — the key-preserving dual to `mergeAll`'s key-collapsing fold.

```ts
import { Array as Arr, Data, Effect, Either, Record } from "effect"

class FetchError extends Data.TaggedError("FetchError")<{
  readonly source: "profile" | "usage" | "entitlements"
}>() {}

const foldOutcomes = <A, E, R, Z>(
  effects: ReadonlyArray<Effect.Effect<A, E, R>>,
  zero: Z,
  f: (z: Z, outcome: Either.Either<A, E>, index: number) => Z,
): Effect.Effect<Z, never, R> =>
  Effect.mergeAll(Arr.map(effects, Effect.either), zero, f, { concurrency: "unbounded" })

const diagnose = <
  Fields extends Record<string, Effect.Effect<unknown, { readonly source: string }, any>>,
>(fields: Fields) =>
  Effect.all(fields, { mode: "either" }).pipe(
    Effect.map(Record.map(Either.match({
      onLeft:  (e) => ({ ok: false, source: e.source } as const),
      onRight: ()  => ({ ok: true } as const),
    }))),
  )
```

**Topology contracts:**
- `Effect.mergeAll` — N-way concurrent fold with positional index. Pre-wrap with `Effect.either` to convert failures to data; without it, first failure short-circuits.
- `mode: "either"` → `{ [K]: Either<A_K, E_K> }` (never fails). `"validate"` → error channel `{ [K]: Option<E_K> }` (success values absent). Default → `{ [K]: A_K }`, fail-fast. `Effect.all` preserves tuple positional types, struct named types.
- `partition` → `[rejected, accepted]` with `E = never` (lossless). `validateAll` → `NonEmptyArray<E>` (lossy). `validateFirst` → first success or all errors.
- Two accumulation patterns: `Record.map` = structural (key-preserving); `mergeAll` = statistical (key-collapsing). `allSuccesses` silently discards failures.


## Context derivation and demand narrowing

`mapInputContext` is contravariant: `Context<R2> → Context<R>` widens requirements. `deriveContext` encapsulates `Exclude` arithmetic once. `Layer.function` is the layer-graph dual — pure derivation, no effect.

`serviceOption` → `Effect<Option<A>, never, never>` (zero R). `Context.Reference` (v3.11+) provides default values, vanishing from R when unprovided.

```ts
import { Context, Effect, Layer, Option, String as Str } from "effect"

class AppTrace     extends Context.Tag("Fx/AppTrace")<AppTrace,         { readonly correlationId: string }>() {}
class RequestTrace extends Context.Tag("Fx/RequestTrace")<RequestTrace, { readonly traceId:       string }>() {}
class TenantLens   extends Context.Tag("Fx/TenantLens")<TenantLens,     { readonly tenantId:      string }>() {}

const auditOp = (action: string) =>
  Effect.all({ trace: RequestTrace, tenant: Effect.serviceOption(TenantLens) }).pipe(
    Effect.map(({ trace, tenant }) => ({
      action,
      traceId:  trace.traceId,
      tenantId: Option.map(tenant, (t) => t.tenantId),
    }) as const),
    Effect.provideServiceEffect(RequestTrace,
      AppTrace.pipe(
        Effect.filterOrFail(
          ({ correlationId }) => Str.isNonEmpty(correlationId),
          () => ({ _tag: "InvalidTrace" as const }),
        ),
        Effect.map(({ correlationId }) => ({ traceId: correlationId })),
      ),
    ),
  )

const deriveContext = <FId, F, TId, T>(
  from: Context.Tag<FId, F>,
  to:   Context.Tag<TId, T>,
  f:    (a: F) => T,
) =>
  <A, E, R>(self: Effect.Effect<A, E, R | TId>): Effect.Effect<A, E, Exclude<R, TId> | FId> =>
    self.pipe(
      Effect.mapInputContext((ctx: Context.Context<Exclude<R, TId> | FId>) =>
        Context.add(ctx, to, f(Context.get(ctx, from))),
      ),
    )

const TraceLive = Layer.function(AppTrace, RequestTrace, ({ correlationId }) => ({ traceId: correlationId }))
```

**Context contracts:**
- `deriveContext` encapsulates `Exclude<R, TId> | FId`; `Layer.function` is the layer-graph dual. Effect-level for inline pipelines, layer-level for static graphs.
- `provideServiceEffect` merges provision effect's E and R into consumer. Infallible provision leaves E unchanged — misleading; effectful derivation that can fail belongs here, pure derivation in `mapInputContext`.
- `serviceOption` → zero R, zero E. `Context.Reference` with `defaultValue` vanishes from R when unprovided. Use `Reference` for config defaults; `serviceOption` for optional capabilities.
- `Layer.merge` = peer composition (no narrowing). `provide` = narrowing via `Exclude<RIn, ROut_dep>`. `provideMerge` = narrowing + dep output exposed. `Context.omit`/`pick` = value-level `Exclude`/intersection.
- `Layer.scoped` attaches finalizers to scope; `Layer.effect` has no lifecycle. `Layer.fresh` bypasses memoization; `unwrapEffect` lifts `Effect<Layer>` to `Layer`.


## Scoped lifecycle and policy composition

Lifetime, timeout, and failure classification compose on a single policy rail. Placing `timeoutFail` outside `Effect.scoped` inverts exit classification — scope closes first with `Exit.Success`, then timeout fires.

`withTransport`: non-empty channel tuple unifies single-channel and hedged paths, per-channel scoped lifecycle with four-way exit classification via `ExitLevel` vocabulary, `raceAll` + `disconnect` for hedging, structured telemetry. `resilient` composes six schedule combinators into one circuit-breaker expression.

```ts
import { Array as Arr, Cause, Data, Duration, Effect, Exit, Option, Schedule } from "effect"

class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "timeout"
}>() {}

const withTransport = <A, E, R>(
  channels: readonly [string, ...ReadonlyArray<string>],
  policy: {
    readonly timeout: Duration.DurationInput
    readonly stagger: (index: number) => Duration.DurationInput
  },
  send: (ch: { readonly id: string }) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TransportError, R> => {
  const ExitLevel = {
    released:    Effect.logDebug,
    interrupted: Effect.logDebug,
    defect:      Effect.logError,
    failure:     Effect.logWarning,
  } as const satisfies Record<
    "released" | "interrupted" | "defect" | "failure",
    (...args: ReadonlyArray<unknown>) => Effect.Effect<void>
  >

  return Effect.raceAll(
    Arr.map(channels, (id, i) =>
      Effect.scoped(
        Effect.uninterruptibleMask((restore) =>
          Effect.acquireRelease(
            Effect.succeed({ id }),
            (ch, exit) => {
              const kind = Exit.match(exit, {
                onSuccess: () => "released" as const,
                onFailure: (cause) =>
                  Cause.isInterruptedOnly(cause) ? "interrupted" as const
                  : Option.isSome(Cause.keepDefects(cause)) ? "defect" as const
                  : "failure" as const,
              })
              return ExitLevel[kind]("transport").pipe(Effect.annotateLogs({ channel: ch.id, exit: kind }))
            },
          ).pipe(
            Effect.flatMap((ch) =>
              Effect.disconnect(restore(
                Effect.sleep(policy.stagger(i)).pipe(Effect.andThen(send(ch))),
              )),
            ),
            Effect.timeoutFail({ duration: policy.timeout, onTimeout: () => new TransportError({ reason: "timeout" }) }),
          ),
        ),
      ),
    ),
  )
}

const resilient = <E>(isTransient: (cause: Cause.Cause<E>) => boolean) =>
  Schedule.exponential(Duration.millis(100)).pipe(
    Schedule.jittered, Schedule.intersect(Schedule.recurs(5)),
    Schedule.resetAfter(Duration.seconds(30)), Schedule.whileInput(isTransient),
  )
```

**Lifecycle contracts:**
- Non-empty tuple `[string, ...string[]]` polymorphic over arity — single-channel or hedged. Per-channel `Effect.scoped`; `raceAll` interrupts losers. `ExitLevel` vocabulary gated via `satisfies`.
- `acquireUseRelease` seals use phase, preventing fiber-external interruption. `ensuring` = exit-unaware; `onExit` = exit-aware without `Scope`.
- Four-way exit: `isInterruptedOnly` (pure cancellation), `keepDefects` → `Option` (Some if Die present), typed failure (remaining). `isInterrupted` is weaker (finds any Interrupt). `Cause.match` = exhaustive catamorphism.
- `disconnect` makes loser interruption non-blocking. `raceAll` returns FIRST error; use `validateFirst` for all errors.
- `timeoutFail` inside `scoped` = correct. Outside inverts classification: scope closes with `Success`, then timeout fires. `resilient` on caller retries entire constellation; per-channel retry belongs in `send`.
- `resetAfter` = circuit-breaker: halts after N failures within window, resets after quiescence. `addDelay(f)` enables error-derived delays (`Retry-After`).


## Cache contract taxonomy

`Cache.makeWith` provides bounded LRU with adaptive TTL — `timeToLive` receives `Exit` for stale-while-revalidate via `cache.refresh`. `RequestResolver.makeBatched` coalesces cross-fiber requests in the same tick.

`cachedFunction` is unbounded with custom `Equivalence`. Critical type distinction: `Cache.make` captures R at construction (getter eliminates R); `cachedFunction` retains R per invocation.

```ts
import { Array as Arr, Cache, Duration, Effect, Equivalence, Exit, Request, RequestResolver } from "effect"

interface FetchUser extends Request.Request<string, Error> {
  readonly _tag: "FetchUser"
  readonly id:   number
}
const FetchUser = Request.tagged<FetchUser>("FetchUser")

const fetchResolver = RequestResolver.makeBatched(
  (reqs: ReadonlyArray<FetchUser>) =>
    Effect.tryPromise({
      try:   (signal) => fetch("/api/users", { method: "POST", signal,
        body: JSON.stringify(Arr.map(reqs, (r) => r.id)) }).then((r) => r.json() as Promise<ReadonlyArray<string>>),
      catch: (cause) => new Error(String(cause)),
    }).pipe(
      Effect.andThen((names) => Effect.forEach(reqs, (req, i) => Request.succeed(req, names[i]!))),
      Effect.catchAll((err)  => Effect.forEach(reqs, (req)    => Request.fail(req, err))),
    ),
)

const makeUserCache = Effect.all({
  bounded: Cache.makeWith({
    capacity: 256,
    lookup: (id: number) => Effect.request(FetchUser({ id }), fetchResolver),
    timeToLive: Exit.match({ onFailure: () => Duration.seconds(10), onSuccess: () => Duration.minutes(5) }),
  }),
  keyed: Effect.cachedFunction(
    (key: { readonly tenant: string; readonly id: number }) =>
      Effect.request(FetchUser({ id: key.id }), fetchResolver),
    Equivalence.make((self, that) => self.tenant === that.tenant && self.id === that.id),
  ),
})
```

**Cache contracts:**
- `makeWith` accepts `timeToLive: (exit) => Duration` — cache successes long, failures short. `refresh(key)` re-computes without invalidation (stale-while-revalidate). `getEither` → left = pre-existing, right = fresh.
- `Cache.make` captures R at setup; getter eliminates R. `cachedFunction` retains R per-invocation — resolvers can depend on request-scoped context.
- `Request.tagged` auto-derives `Equal` + `Hash`. `makeBatched` must complete every request — uncompleted hang source fibers. `fromEffectTagged` multiplexes by `_tag`.
- `Equivalence.make` for compound keys — field-wise comparison avoids delimiter concatenation. `mapInput` projects into simpler domain. Without explicit `Equivalence`, `cachedFunction` uses referential equality.
- `Layer.scoped` is correct instantiation site — module-level caches grow unboundedly. `ConsumerCache` is read-only view (safe to share).


## Contention algebra and admission policy

Queue strategy (`bounded`/`dropping`/`sliding`) and semaphore usage (`withPermits`/`withPermitsIfAvailable`) are the same contention algebra — different resource shapes, identical admit/shed semantics. A single policy vocabulary governs both: `backpressure` blocks producers, `shedding` drops arrivals, `sliding` evicts oldest entries.

```ts
import { Chunk, Effect, Match, Number, Option, Queue, Ref, type Semaphore } from "effect"

// --- [TYPES] -----------------------------------------------------------------
type ContentionPolicy = "backpressure" | "shedding" | "sliding"

// --- [CONSTANTS] -------------------------------------------------------------
const QueueStrategy = {
  backpressure: Queue.bounded,
  shedding:     Queue.dropping,
  sliding:      Queue.sliding,
} as const satisfies Record<ContentionPolicy, (cap: number) => Effect.Effect<Queue.Queue<unknown>>>

// --- [FUNCTIONS] -------------------------------------------------------------
const withContention = <A, E, R>(
  policy: ContentionPolicy, semaphore: Semaphore, permits: number, effect: Effect.Effect<A, E, R>,
) =>
  Match.value(policy).pipe(
    Match.when("backpressure", () => semaphore.withPermits(permits)(effect).pipe(Effect.map(Option.some))),
    Match.when("shedding",     () => semaphore.withPermitsIfAvailable(permits)(effect)),
    Match.when("sliding",      () => semaphore.withPermitsIfAvailable(permits)(effect)),
    Match.exhaustive,
  )

const runContentionDemo = (policy: ContentionPolicy, capacity: number) =>
  Effect.gen(function* () {
    const queue = yield* QueueStrategy[policy](capacity)
    const sem   = yield* Effect.makeSemaphore(capacity)
    const shed  = yield* Ref.make(0)
    yield* Effect.forEach(Chunk.range(1, capacity * 2), (id) =>
      withContention(policy, sem, 1, Queue.offer(queue, id)).pipe(
        Effect.tap(Option.match({ onNone: () => Ref.update(shed, Number.increment), onSome: () => Effect.void })),
      ), { concurrency: "unbounded" })
    return yield* Effect.all({ queued: Queue.takeAll(queue).pipe(Effect.map(Chunk.size)), shed: Ref.get(shed) })
  })
```

**Contention contracts:**
- `QueueStrategy` map is polymorphic over `ContentionPolicy` — adding a policy literal without a corresponding constructor fails at the `satisfies` gate. `Queue.bounded` suspends producers at capacity; `Queue.dropping` discards new arrivals; `Queue.sliding` evicts oldest entries. All three return `Effect<Queue<A>>`, making the map value-uniform.
- `withPermits(n)(effect)` blocks until n permits are available — backpressure semantics. `withPermitsIfAvailable(n)(effect)` returns `Option.none` immediately when permits are unavailable — shedding semantics. The `sliding` case uses `withPermitsIfAvailable` because true sliding requires the queue's internal eviction (`Queue.sliding`), not the semaphore — the semaphore only gates admission.
- `Option.match` on the contention result tracks shed count without branching — `onNone` increments the shed counter, `onSome` is a no-op. The shed counter is the primary observability signal for capacity exhaustion; queue depth alone conflates backpressure with shedding.
- `Match.exhaustive` enforces that all three policy variants are handled — adding a fourth policy without a corresponding `Match.when` clause fails at compile time. The entire dispatch is data-driven: policy selection propagates through both queue construction and semaphore usage with zero string comparison at runtime.
