# [H1][COMPOSITION]

Composition owns graph geometry, not service semantics. Snippets target current Effect APIs, maintain branch-free FP+ROP, avoid wrapper indirection. Root assembly is a one-time boundary operation; feature modules export partial layers.

---
## [1][COMPOSITION_LAWS]

- Encode dependencies with raw `Layer` combinators; no helpers hiding DAG semantics.
- Dynamic graph choice via `unwrapEffect`, `unwrapScoped`, `flatMap`, `match`, `matchCause`.
- Model visibility with `provide`/`provideMerge`; never rely on accidental exposure.
- Shape outputs with `project`, `passthrough`, `discard`, `effectDiscard`, `scopedDiscard`.
- Collection-driven mapping (`HashMap`, `Chunk`) when topology must stay data-driven.
- Effect-* packages are first-class graph nodes; composition wires nodes.

---
## [2][REQUIREMENT_ELIMINATION_AND_VISIBILITY]

`provide` collapses a requirement edge, retaining only consumer output — provider vanishes. `provideMerge` eliminates and unions provider output for downstream binding. Misclassifying an edge produces type errors or silent capability leakage.

```ts
import { Context, Duration, Effect, Layer, Number as N, pipe } from "effect"

const sealed = <A, E>(layer: Layer.Layer<A, E, never>): Layer.Layer<A, E> => layer

const Pipeline = (() => {
  const SampleRate = { head: 0.1, tail: 1.0, parent: 0.5 } as const satisfies Record<string, number>
  type SampleMode = keyof typeof SampleRate
  const Transport = Context.GenericTag<{ readonly endpoint: string }>("Cmp/Transport")
  const Sampler   = Context.GenericTag<{ readonly rate: number }>("Cmp/Sampler")
  const Collector = Context.GenericTag<{ readonly endpoint: string; readonly bufferSize: number; readonly window: Duration.Duration }>("Cmp/Collector")
  const Exporter  = Context.GenericTag<{ readonly flush: Effect.Effect<void> }>("Cmp/Exporter")
  const transport = (region: string) => Layer.succeed(Transport, { endpoint: `otlp://${region}.collector:4317` })
  const sampler   = (mode: SampleMode) => Layer.succeed(Sampler, { rate: SampleRate[mode] })
  const collector = Layer.effect(Collector, Effect.all([Transport, Sampler]).pipe(
    Effect.map(([t, s]) => ({
      endpoint: t.endpoint,
      bufferSize: pipe(s.rate, N.multiply(4096), Math.ceil),
      window: Duration.millis(pipe(s.rate, N.multiply(30_000), N.max(500), Math.ceil)),
    })),
  ))
  const exporter = Layer.effect(Exporter, Effect.all([Transport, Collector]).pipe(
    Effect.map(([t, c]) => ({ flush: Effect.log(`flush ${c.bufferSize} → ${t.endpoint}`).pipe(
      Effect.annotateLogs({ buffer: String(c.bufferSize), windowMs: String(Duration.toMillis(c.window)) }),
      Effect.withSpan("exporter.flush", { attributes: { bufferSize: c.bufferSize } }),
    ) })),
  ))
  return (region: string, mode: SampleMode) => ({
    sealed: sealed(exporter.pipe(Layer.provide(collector), Layer.provide(sampler(mode)), Layer.provide(transport(region)))),
    shared: sealed(exporter.pipe(Layer.provide(collector), Layer.provide(sampler(mode)), Layer.provideMerge(transport(region)))),
  })
})()
```

**Elimination contracts:**
- Diamond DAG: Transport feeds both Collector and Exporter. Default memoization deduplicates by reference. `provideMerge` exposes Transport downstream; `provide` seals it.
- Reverse-topological ordering is load-bearing. Swapping order wastes resolution or leaves dangling requirements.
- `sealed` enforces `RIn = never` at value level. Composes with `Layer.launch`, `Effect.provide`, `Layer.merge`.
- `SampleRate` vocabulary with `as const satisfies` — `SampleMode` = `keyof typeof SampleRate` propagates exhaustiveness.

---
## [3][BOUNDARY_OUTPUT_SHAPING]

Exposing every internal node creates accidental coupling. `Layer.project` narrows to consumer-facing subset; `discard` produces initialization-only layers (no output); `passthrough` re-exposes requirements as outputs for test introspection.

```ts
import { Context, Duration, Effect, Layer } from "effect"

class Pool extends Context.Tag("Cmp/Pool")<Pool, {
  readonly acquire: Effect.Effect<{ readonly query: <A>(sql: string) => Effect.Effect<A>; readonly release: Effect.Effect<void> }>
  readonly stats: Effect.Effect<{ readonly active: number; readonly idle: number }>
}>() {}
class QueryRunner extends Context.Tag("Cmp/QueryRunner")<QueryRunner, { readonly run: <A>(sql: string) => Effect.Effect<A> }>() {}

const Boundary = (() => {
  const Config = Context.GenericTag<{ readonly maxConns: number; readonly timeout: Duration.Duration }>("Cmp/PoolConfig")
  const PoolLive = Layer.effect(Pool, Config.pipe(Effect.map(({ maxConns, timeout }) => ({
    acquire: Effect.succeed({
      query: <A>(sql: string) => Effect.succeed(sql as unknown as A).pipe(
        Effect.timeoutFail({ duration: timeout, onTimeout: () => new Error("query.deadline") }),
      ),
      release: Effect.log("conn.released"),
    }),
    stats: Effect.succeed({ active: 0, idle: maxConns }),
  }))))
  return {
    narrowed: PoolLive.pipe(Layer.project(Pool, QueryRunner, (pool) => ({
      run: <A>(sql: string) => pool.acquire.pipe(
        Effect.flatMap((conn) => conn.query<A>(sql).pipe(Effect.ensuring(conn.release))),
      ),
    }))),
    warmup: PoolLive.pipe(
      Layer.tap((ctx) => Context.get(ctx, Pool).stats.pipe(
        Effect.flatMap((s) => Effect.logInfo("pool.ready").pipe(
          Effect.annotateLogs({ active: String(s.active), idle: String(s.idle) }),
        )),
      )),
      Layer.discard,
    ),
    introspect: PoolLive.pipe(Layer.passthrough),
  } as const
})()
```

**Boundary shaping contracts:**
- `project(From, To, f)` consumes single-tag output. Unions rejected — collapse via `provide` first.
- `tap` executes during build, `discard` zeros `ROut` to `never`. `mergeAll(narrowed, warmup)` → only `narrowed`'s output.
- `passthrough` on `RIn = Config` produces `Layer<Out | Config, E, Config>` — both requirement and output. Useful for test assertions; production use leaks capability.
- Default memoization deduplicates across projections. `Layer.fresh` creates isolated instance.

---
## [4][DYNAMIC_TOPOLOGY_SELECTION]

Static `provide`/`merge` chains fix topology at module load. `Layer.unwrapEffect` defers wiring to graph-construction time; `unwrapScoped` extends this to modes with scoped resources.

```ts
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect"

type IngestMode = Data.TaggedEnum<{
  Streaming: {}
  Batch:     { readonly batchSize: number }
  Replay:    { readonly cursor: string }
}>
const IngestMode = Data.taggedEnum<IngestMode>()

const IngestTopology = (() => {
  const Transport = Context.GenericTag<{ readonly send: (data: ReadonlyArray<unknown>) => Effect.Effect<void> }>("Cmp/Transport")
  const Buffer    = Context.GenericTag<{ readonly capacity: number; readonly flush: Schedule.Schedule<number> }>("Cmp/Buffer")
  const ModeRef   = Context.GenericTag<IngestMode>("Cmp/IngestMode")
  return Layer.unwrapEffect(ModeRef.pipe(Effect.map(IngestMode.$match({
    Streaming: () => Layer.mergeAll(
      Layer.succeed(Transport, { send: (data) => Effect.logDebug(`stream ${data.length}`).pipe(Effect.withSpan("transport.stream")) }),
      Layer.succeed(Buffer, { capacity: 4096, flush: Schedule.spaced(Duration.millis(100)).pipe(Schedule.intersect(Schedule.recurs(50))) }),
    ),
    Batch: ({ batchSize }) => Layer.mergeAll(
      Layer.succeed(Transport, { send: (data) => Effect.logInfo(`batch ${data.length}`).pipe(Effect.withSpan("transport.batch")) }),
      Layer.succeed(Buffer, { capacity: batchSize, flush: Schedule.fixed(Duration.seconds(5)) }),
    ),
    Replay: ({ cursor }) => Layer.unwrapScoped(
      Effect.acquireRelease(
        Effect.logInfo(`cursor.acquire ${cursor}`).pipe(Effect.as(cursor)),
        (c) => Effect.logInfo(`cursor.release ${c}`),
      ).pipe(Effect.map((c) => Layer.mergeAll(
        Layer.succeed(Transport, { send: (data) => Effect.logDebug(`replay ${c} ${data.length}`).pipe(Effect.withSpan("transport.replay")) }),
        Layer.succeed(Buffer, { capacity: 1024, flush: Schedule.exponential(Duration.millis(200)).pipe(Schedule.jittered) }),
      ))),
    ),
  }))))
})()
```

**Dynamic topology contracts:**
- `unwrapEffect` flattens `Effect<Layer<A, E1, R1>, E, R>` to `Layer<A, E | E1, R | R1>` — deferred selection encapsulated at definition.
- `unwrapScoped` registers finalizers in Layer's ambient `Scope` — releases on `Layer.launch` shutdown, not selection completion.
- `$match` curried form passes directly to `Effect.map`. Adding mode without handler fails at compile time — two-site exhaustiveness.
- Default memoization deduplicates shared sub-layers across modes.

---
## [5][ERROR_AWARE_GRAPH_REWRITES]

Layer-level error handling operates on construction, not runtime requests. `Layer.match` receives typed `E` (defects/interrupts propagate); `matchCause` receives full `Cause<E>` — use only when cause-level discrimination is required.

```ts
import { Cause, Context, Data, Effect, HashMap, Layer, Option, pipe } from "effect"

class MeshFault extends Data.TaggedError("MeshFault")<{ readonly reason: "unreachable" | "timeout" | "tls_rejected" }>() {}
class Transport extends Context.Tag("Cmp/Transport")<Transport, { readonly protocol: "grpc" | "http2"; readonly mesh: boolean }>() {}

const rewriteMesh = <R>(primary: Layer.Layer<Transport, MeshFault, R>) => {
  const bypass = HashMap.make(
    ["unreachable", () => Layer.effect(Transport, Effect.logWarning("mesh.bypass.direct").pipe(Effect.as({ protocol: "http2" as const, mesh: false })))] as const,
    ["timeout",     () => Layer.effect(Transport, Effect.logWarning("mesh.bypass.retry").pipe(Effect.as({ protocol: "grpc" as const, mesh: true })))] as const,
  )
  const resolve = (e: MeshFault) => pipe(HashMap.get(bypass, e.reason), Option.match({
    onNone: ()  => Layer.fail(e),
    onSome: (f) => f(),
  }))
  return {
    typed: primary.pipe(Layer.match({ onFailure: resolve, onSuccess: Layer.succeedContext })),
    causal: primary.pipe(Layer.matchCause({
      onFailure: (cause) => pipe(Cause.failureOption(cause), Option.match({
        onNone:  () => Layer.failCause(cause),
        onSome:  resolve,
      })),
      onSuccess: Layer.succeedContext,
    })),
  } as const
}
```

**Error-aware rewrite contracts:**
- `Layer.match` receives typed failure; defects (`Effect.die`) and interrupts bypass entirely. Construction defects are bugs; interrupts are cancellation — neither should trigger fallback.
- `matchCause` receives `Cause<E>` — `failureOption` extracts typed failure as `Option`. `onNone` re-propagates via `Layer.failCause`; swallowing defects masks bugs.
- `HashMap` dispatch with `Option.match` provides type-safe partial coverage. Unhandled reasons fall through to `Layer.fail(e)`.
- Same primary graph with distinct error-handling topologies — error channel narrowing visible at type level.

---
## [6][MEMOIZATION_AND_FRESHNESS]

Default sharing is a correctness invariant masquerading as optimization — shared pools across DDL migrations and read queries produce lock leakage and visibility races. `Layer.fresh` enforces construction-time isolation; `memoize` + `extendScope` binds finalization to managed scope boundary.

```ts
import { Data, Effect, Layer, Record, Scope } from "effect"

type Freshness = Data.TaggedEnum<{ Shared: {}; Fresh: {}; Scoped: {} }>
const Freshness = Data.taggedEnum<Freshness>()

const withFreshness = <A, E, R>(base: Layer.Layer<A, E, R>) =>
  <const K extends string>(layout: Readonly<Record<K, Freshness>>): Effect.Effect<Readonly<Record<K, Layer.Layer<A, E, R>>>, never, Scope.Scope> =>
    Effect.all(Record.map(layout, (mode) =>
      Freshness.$match(mode, {
        Shared: () => Layer.memoize(base),
        Fresh:  () => Effect.succeed(Layer.fresh(base)),
        Scoped: () => Layer.memoize(Layer.extendScope(base)),
      }),
    ))

const topology = <A, E, R>(pool: Layer.Layer<A, E, R>) =>
  withFreshness(pool)({
    primary:   Freshness.Shared(),
    migration: Freshness.Fresh(),
    probe:     Freshness.Scoped(),
  })
```

**Freshness contracts:**
- `Freshness` is closed `TaggedEnum` — `$match` rejects at compile time when mode added without handler.
- `fresh` guarantees isolated instance — advisory locks, prepared statements, transactions isolated from read pool.
- `extendScope` changes `RIn` to include `Scope` — finalization propagates to enclosing scope rather than first use-site completion.
- `Record.map` + `Effect.all` resolves selections within same `Scope`. `withFreshness` is curried: base captured once, layout per-caller.

---
## [7][EFFECT_STAR_CROSS_LIBRARY_COMPOSITION]

`@effect/*` packages publish layers composing with the same `provide`/`merge` algebra but create cross-boundary requirement edges invisible until graph close. Failing to eliminate produces `RIn = HttpClient | PgClient | ...` — formally open, operationally unrunnable.

```ts
import { FetchHttpClient, HttpClient } from "@effect/platform"
import { PgClient } from "@effect/sql-pg"
import { RpcSerialization, RpcServer } from "@effect/rpc"
import { Context, Effect, Layer, Redacted } from "effect"

const closed = <A, E>(layer: Layer.Layer<A, E, never>): Layer.Layer<A, E> => layer

const composeCrossLibrary = <A, EA, RA, EB, RB, C, EC, RC>(
  consumer: Layer.Layer<A, EA, RA>,
  resolver: Layer.Layer<RA, EB, RB>,
  peers:    Layer.Layer<C, EC, RC>,
): Layer.Layer<A | C, EA | EB | EC, RB | RC> =>
  Layer.merge(consumer.pipe(Layer.provide(resolver)), peers)

const AppInfra = (() => {
  const SyncService = Context.GenericTag<{ readonly sync: Effect.Effect<void> }>("Cmp/Sync")
  const consumer = Layer.effect(SyncService, Effect.all([HttpClient.HttpClient, PgClient.PgClient]).pipe(
    Effect.map(([http, pg]) => ({
      sync: pg.execute("SELECT 1").pipe(
        Effect.andThen(http.get("https://webhook.internal/ack")),
        Effect.asVoid,
        Effect.withSpan("sync.roundtrip"),
        Effect.annotateLogs({ op: "sync", target: "webhook.internal" }),
      ),
    })),
  ))
  const resolver = Layer.merge(
    FetchHttpClient.layer,
    PgClient.layer({ database: "app", username: "svc_app", password: Redacted.make("__vault__") }),
  )
  return closed(composeCrossLibrary(
    consumer, resolver,
    RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(Layer.provide(RpcSerialization.layerNdjson)),
  ))
})()
```

**Cross-library contracts:**
- `composeCrossLibrary` eliminates consumer requirements via `provide(resolver)` before `merge` with peers. Requirements collapse to `never` at join.
- Resolver merges independent `@effect/*` surfaces into one — jointly satisfies cross-package requirements in single `provide`.
- `closed` on final graph = acceptance test: `RIn = never` proves all library surfaces resolved. Adding dependency without resolver extension → type error at `closed`.
- Each library sub-graph closes independently, composing as opaque atoms.

---
## [8][ROOT_ASSEMBLY_ONCE]

Build-phase layer operations (`tap`, `annotateLogs`, `locally`) execute once at startup, not per-request. Constraining every subgraph to `RIn = never` guarantees closed graph: no dangling requirements escape to `Layer.launch`.

```ts
import { Clock, Effect, FiberRef, Layer, LogLevel } from "effect"
import { NodeRuntime } from "@effect/platform-node"

type ClosedLayer = Layer.Layer<any, any, never>

const assembleRoot = <const Layers extends readonly [ClosedLayer, ...ClosedLayer[]]>(
  name: string,
  ...layers: Layers
): Effect.Effect<never, Layer.Layer.Error<Layers[number]>> =>
  Layer.mergeAll(...(layers as [ClosedLayer, ...ClosedLayer[]])).pipe(
    Layer.tap(() =>
      Clock.currentTimeMillis.pipe(Effect.flatMap((epoch) =>
        Effect.logInfo("root.assembled").pipe(
          Effect.annotateLogs({ assembly: name, epoch: String(epoch), nodes: String(layers.length) }),
          Effect.withSpan("assembly.boot", { attributes: { name, nodes: layers.length } }),
        ),
      )),
    ),
    Layer.annotateLogs({ phase: "build", assembly: name }),
    Layer.locally(FiberRef.currentLogLevel, LogLevel.Debug),
    Layer.launch,
  )
```

**Assembly contracts:**
- `mergeAll` enforces `RIn = never` on every argument — type system rejects partial layers at merge site.
- `tap` receives fully-built `Context<ROut>`. `annotateLogs`/`locally` scope to build phase, not request fibers.
- `launch` converts `Layer<ROut, E, never>` to `Effect<never, E>` — runs until interrupted. `NodeRuntime.runMain` handles signals, finalization, exit codes.
- Heterogeneous tuple preserves exact error union. Adding/removing subgraph = single-argument edit.

---
## [9][LAYER_FUSION_AND_NORMALIZATION]

Parallel graph nodes producing overlapping data require merge policy, not concatenation. `zipWith` fuses two contexts through a combiner encoding conflict resolution. `Layer.map` normalizes to consumer-facing contract, separating internal representation from minimal downstream interface.

```ts
import { Context, HashMap, Layer, Number as N, Option, pipe } from "effect"

type Entry = { readonly value: string; readonly priority: number }

const Resolve = {
  byPriority: (a: Entry, b: Entry): Entry => (a.priority >= b.priority ? a : b),
  leftWins:   (a: Entry, _: Entry): Entry => a,
  merge:      (a: Entry, b: Entry): Entry => ({ value: `${a.value}|${b.value}`, priority: N.max(a.priority, b.priority) }),
} as const satisfies Record<string, (a: Entry, b: Entry) => Entry>

const fuseConfigs = (policy: (typeof Resolve)[keyof typeof Resolve]) => {
  const Env   = Context.GenericTag<HashMap.HashMap<string, Entry>> ("Fuse/Env" )
  const Vault = Context.GenericTag<HashMap.HashMap<string, Entry>> ("Fuse/Vault")
  const App   = Context.GenericTag<HashMap.HashMap<string, string>>("Fuse/App")
  return (envData: ReadonlyArray<readonly [string, Entry]>, vaultData: ReadonlyArray<readonly [string, Entry]>) =>
    Layer.map(
      Layer.zipWith(
        Layer.succeed(Env, HashMap.fromIterable(envData)),
        Layer.succeed(Vault, HashMap.fromIterable(vaultData)),
        (envCtx, vaultCtx) => Context.make(
          App,
          pipe(
            HashMap.reduce(Context.get(vaultCtx, Vault), Context.get(envCtx, Env), (acc, v, k) =>
              HashMap.set(acc, k, pipe(HashMap.get(acc, k), Option.match({ onNone: () => v, onSome: (e) => policy(e, v) }))),
            ),
            HashMap.map((entry) => entry.value),
          ),
        ),
      ),
      (ctx) => ctx,
    )
}
```

**Fusion contracts:**
- `zipWith` constructs both sources in parallel — parallelism is structural. Combiner produces `Context<Out>` from two inputs.
- `HashMap.reduce` implements set-union merge: `onNone` = novel entries, `onSome` = policy dispatch. Keys absent from overlay preserved. Complexity $O(|\text{overlay}|)$ with $O(1)$ `HashMap` ops.
- `HashMap.map` projects rich representation to minimal consumer contract — downstream depends only on final shape.
- Changing merge strategy = vocabulary selection at call site. Extending adds one entry without touching algorithms.
