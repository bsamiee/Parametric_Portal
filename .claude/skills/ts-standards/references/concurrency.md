# Concurrency

## Fiber ownership algebra

Fiber ownership is a compile-time commitment encoded by fork strategy and resolved by join semantics. Three fork strategies (`fork`, `forkScoped`, `forkDaemon`) pair with three join semantics (`join`, `await`, `interruptFork`) — nine combinatorial outcomes collapsed to vocabulary-driven dispatch. `Deferred` provides one-shot handshake synchronization; scope binding determines automatic vs manual lifetime management.

```ts
import { Chunk, Deferred, Effect, Exit, Fiber, Scope } from "effect"

const ForkStrategy = {
  ephemeral: <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.fork(e),
  scoped:    <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.forkScoped(e),
  daemon:    <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.forkDaemon(e),
} as const satisfies Record<string, <A, E, R>(e: Effect.Effect<A, E, R>) => Effect.Effect<Fiber.RuntimeFiber<A, E>, never, unknown>>

const JoinStrategy = {
  unwrap:  <A, E>(f: Fiber.RuntimeFiber<A, E>) => Fiber.join(f),
  exit:    <A, E>(f: Fiber.RuntimeFiber<A, E>) => Fiber.await(f),
  discard: <A, E>(f: Fiber.RuntimeFiber<A, E>) => Fiber.interruptFork(f),
} as const satisfies Record<string, <A, E>(f: Fiber.RuntimeFiber<A, E>) => Effect.Effect<unknown>>

const spawnPool = <A, E, R>(tasks: ReadonlyArray<Effect.Effect<A, E, R>>, strategy: keyof typeof ForkStrategy) =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>()
    const fibers = yield* Effect.forEach(tasks, (task) => ForkStrategy[strategy](task))
    yield* Deferred.succeed(gate, void 0)
    const exits = yield* Fiber.awaitAll(fibers)
    return { fibers, exits, firstFailure: Chunk.findFirst(exits, Exit.isFailure) } as const
  })
```

**Ownership contracts:**
- `ForkStrategy` encodes lifetime as vocabulary: `ephemeral` binds to parent fiber (auto-interrupted on parent exit), `scoped` binds to explicit `Scope` (interrupted on scope close), `daemon` binds to global scope (outlives parent, requires manual interrupt). Strategy selection is a single lookup.
- `JoinStrategy` encodes completion semantics: `unwrap` awaits and extracts value (`Effect<A, E>`), `exit` awaits and preserves exit structure (`Effect<Exit<A, E>>`), `discard` fires interrupt without blocking. The vocabulary makes join policy a call-site decision.
- `Deferred.succeed(gate, void 0)` before `Fiber.awaitAll` implements the handshake pattern: gate signals spawn completion, consumers block on `Deferred.await` until pool ready. One-shot semantics make subsequent `succeed` calls no-ops.
- `Fiber.awaitAll(fibers)` returns `Chunk<Exit>` preserving per-fiber exit status. `Chunk.findFirst(exits, Exit.isFailure)` surfaces first failure for fail-fast propagation. Use `Fiber.all` when you need to compose N fibers into a single joinable fiber.


## Contention algebra

Queue strategy (bounded/dropping/sliding) and semaphore usage (blocking/shedding) are the same contention algebra — different resource shapes, identical policy vocabulary. `bounded` backpressures (producer waits), `dropping` sheds oldest (offer returns false), `sliding` evicts head (preserves recency). Semaphore `withPermits` blocks until permits available; `withPermitsIfAvailable` returns `Option.none` when denied.

```ts
import { Chunk, Effect, Number as N, Option, Queue, Ref } from "effect"

const QueuePolicy = {
  bounded:  <A>(cap: number) => Queue.bounded<A>(cap),
  dropping: <A>(cap: number) => Queue.dropping<A>(cap),
  sliding:  <A>(cap: number) => Queue.sliding<A>(cap),
} as const satisfies Record<string, <A>(cap: number) => Effect.Effect<Queue.Queue<A>>>

const withContention = <A, E, R>(
  sem: Effect.Semaphore, permits: number, shedRef: Ref.Ref<number>,
  effect: Effect.Effect<A, E, R>,
) =>
  sem.withPermitsIfAvailable(permits)(effect).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Ref.update(shedRef, N.increment).pipe(Effect.as(Option.none<A>())),
      onSome: (a) => Effect.succeed(Option.some(a)),
    })),
  )

const contentionSurface = Effect.gen(function* () {
  const sem = yield* Effect.makeSemaphore(2)
  const shed = yield* Ref.make(0)
  const queue = yield* QueuePolicy.sliding<number>(4)
  const results = yield* Effect.forEach([1, 2, 3, 4, 5, 6], (n) =>
    withContention(sem, 1, shed, Queue.offer(queue, n).pipe(Effect.as(n))), { concurrency: "unbounded" })
  const values = yield* Queue.takeAll(queue).pipe(Effect.map(Chunk.toReadonlyArray))
  const shedCount = yield* Ref.get(shed)
  return { results, values, shedCount, admitted: results.filter(Option.isSome).length } as const
})
```

**Contention contracts:**
- `QueuePolicy` vocabulary encodes data-loss semantics: `bounded` never loses data (backpressures), `dropping` discards on full (oldest), `sliding` evicts head on full (preserves recency). Strategy selection is a single lookup, not runtime conditional.
- `withContention` abstracts the shed-or-admit pattern: `withPermitsIfAvailable` returns `Option<A>`, `Option.none` increments shed counter via `Ref.update(shed, N.increment)`. `N.increment` is the Effect-native `n + 1` combinator.
- `Option.match` replaces `if/else` for permit result handling — exhaustive pattern match, not boolean branch. The shed path and admit path are both effectful, composed in the match arms.
- Shed count plus admitted count equals request count — the invariant is compositional, not asserted imperatively.


## Transactional coordination

STM composes reads and writes across disjoint transactional structures into a single atomic commit — no locks, no race windows, no partial state. `TQueue.take` + `TMap.set` in the same `STM.gen` guarantees atomic dequeue plus state registration; `TSemaphore` provides transactional admission; `TDeferred` provides one-shot completion signaling. The transaction retries automatically on conflict.

```ts
import { Effect, Option, STM, TDeferred, TMap, TQueue, TSemaphore } from "effect"

type Task<A>   = { readonly id: string; readonly payload: A }
type TaskState = "pending" | "active" | "done"

const coordinator = <A>(concurrency: number) => Effect.gen(function* () {
  const sem = yield* TSemaphore.make(concurrency)
  const queue = yield* TQueue.unbounded<Task<A>>()
  const state = yield* TMap.empty<string, TaskState>()
  const done = yield* TDeferred.make<void>()
  const acquire = STM.gen(function* () {
    yield* TSemaphore.acquire(sem)
    const task = yield* TQueue.take(queue)
    yield* TMap.set(state, task.id, "active" as TaskState)
    return task
  })
  const release = (id: string) => TMap.set(state, id, "done" as TaskState).pipe(STM.zipRight(TSemaphore.release(sem)))
  const submit = (task: Task<A>) => TQueue.offer(queue, task).pipe(STM.zipRight(TMap.set(state, task.id, "pending" as TaskState)))
  return { acquire: STM.commit(acquire), release: (id: string) => STM.commit(release(id)), submit: (t: Task<A>) => STM.commit(submit(t)), signal: STM.commit(TDeferred.succeed(done, void 0)), await: STM.commit(TDeferred.await(done)) } as const
})
```

**STM contracts:**
- `acquire` transaction composes three structures atomically — `TSemaphore.acquire` + `TQueue.take` + `TMap.set` execute as one commit. No task dequeued without permit acquisition and state registration; transaction retries if permits or tasks unavailable.
- `release` via `STM.zipRight` chains state update → permit release — both mutations commit together. Permit cannot orphan if state update fails.
- `TDeferred` for one-shot completion — `TDeferred.succeed` resolves waiters transactionally; multiple calls are idempotent (first wins). `TDeferred.await` blocks until resolved.
- Return bundle of committed effects — caller composes `acquire`/`release`/`submit`/`signal`/`await` at call site. Orchestration logic remains explicit, not hidden in the coordinator.


## Resource lifecycle algebra

Resources — pools, streams, workers — share a single lifecycle algebra: acquire → use → release, with interruption as a first-class rail. `acquireRelease` encodes the three-phase contract; `onInterrupt` registers handlers for cancellation exclusively; `ensuring` guarantees finalization regardless of exit path. Pool TTL strategies (`usage` vs `creation`) and stream broadcast parameters are lifecycle policy values.

```ts
import { Deferred, Duration, Effect, Fiber, Number as N, Pool, Ref, Stream } from "effect"

const LifecyclePolicy = {
  poolMin: 1, poolMax: 4, ttl: Duration.seconds(30), ttlStrategy: "usage",
  broadcastN: 2, broadcastCap: 16, replay: 0,
} as const

const lifecycleSurface = Effect.scoped(Effect.gen(function* () {
  const shutdown = yield* Deferred.make<void>()
  const processed = yield* Ref.make(0)
  const pool = yield* Pool.makeWithTTL({
    acquire:    Effect.succeed({ id: crypto.randomUUID() }),
    min:        LifecyclePolicy.poolMin, max: LifecyclePolicy.poolMax,
    timeToLive: LifecyclePolicy.ttl, timeToLiveStrategy: LifecyclePolicy.ttlStrategy,
  })
  const source = Stream.range(1, 100)
  const [fast, slow] = yield* source.pipe(Stream.broadcast(LifecyclePolicy.broadcastN, { capacity: LifecyclePolicy.broadcastCap, replay: LifecyclePolicy.replay }))
  const sumFiber = yield* fast.pipe(Stream.interruptWhenDeferred(shutdown), Stream.runFold(0, N.sum), Effect.fork)
  const processFiber = yield* slow.pipe(
    Stream.mapEffect((n) => Pool.get(pool).pipe(Effect.flatMap(() => Ref.update(processed, N.increment)), Effect.as(n)), { concurrency: LifecyclePolicy.poolMax }),
    Stream.runFold(0, N.sum),
    Effect.ensuring(Deferred.succeed(shutdown, void 0).pipe(Effect.ignore)),
    Effect.onInterrupt(() => Ref.set(processed, -1)),
    Effect.fork,
  )
  const [fastSum, slowSum, count] = yield* Effect.all([Fiber.join(sumFiber), Fiber.join(processFiber), Ref.get(processed)])
  return { fastSum, slowSum, count } as const
}))
```

**Lifecycle contracts:**
- `Pool.makeWithTTL` with `timeToLiveStrategy: "usage"` resets TTL on each `Pool.get`, keeping hot resources alive; `"creation"` evicts at fixed age regardless of access frequency. The value determines cache vs ephemeral semantics.
- `Effect.ensuring` guarantees `Deferred.succeed(shutdown, ...)` executes on success, failure, or interruption — unifies fan-out termination signaling across all exit paths.
- `Effect.onInterrupt` registers a cleanup handler that fires exclusively on cancellation — distinct from `ensuring` which fires on all exits. The `Ref.set(processed, -1)` sentinel distinguishes interrupt-path finalization.
- `Stream.broadcast(n, { capacity, replay })` materializes n independent downstream streams with bounded backpressure; `replay: 0` means late subscribers see only elements after subscription. Replay budget is lifecycle policy.
