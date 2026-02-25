# [H1][CONCURRENCY]
>**Dictum:** *Concurrency is explicit coordination plus explicit ownership: signal once, bound contention, and encode cancellation paths in the rail.*

<br>

Concurrency here is ownership algebra, not syntax sugar. Every fork, queue, permit, and transport is an allocation event that must declare lifetime, interruption, and contention policy. The sections below encode those decisions as values so pressure, shutdown, and cancellation remain inspectable and composable.

---
## [1][FIBER_OWNERSHIP_AND_HANDSHAKE]
>**Dictum:** *Fork is allocation; every fork requires an ownership decision (`join`, `awaitAll`, `interruptAll`, or scoped lifetime).*

<br>

```ts
import { Chunk, Deferred, Effect, Fiber, Queue } from "effect";

const workerGraph = Effect.scoped(
  Effect.gen(function* () {
    const start = yield* Deferred.make<void>();
    const queue = yield* Queue.bounded<number>(64);
    const workers = yield* Effect.forEach(
      [1, 2, 3, 4] as const,
      (lane) =>
        Effect.forkScoped(
          Deferred.await(start).pipe(
            Effect.zipRight(Queue.offer(queue, lane * 10)),
            Effect.zipRight(Queue.offer(queue, lane * 10 + 1)),
            Effect.as(lane),
          ),
        ),
      { concurrency: "unbounded" },
    );
    yield* Deferred.succeed(start, undefined);
    const lanes = yield* Effect.all(workers.map(Fiber.join), { concurrency: "unbounded" });
    const values = yield* Queue.takeAll(queue);
    return {
      lanes,
      values:    Chunk.toReadonlyArray(values),
      invariant: lanes.length === 4 && Chunk.size(values) === 8,
    } as const;
  }),
);
```

**Ownership laws:**<br>
- `forkScoped` ties worker lifetime to scope; detached fibers require explicit finalizers.
- `Effect.all(workers.map(Fiber.join))` keeps failure propagation in-rail without detached exit post-processing.
- one-shot `Deferred` handshakes remove ambient start ordering.

**Invariant:** worker completion count and emitted queue cardinality are both explicit output values.

---
## [2][QUEUE_STRATEGY_AND_SHUTDOWN_PROTOCOL]
>**Dictum:** *Queue strategy is data-loss policy: `bounded` backpressures, `dropping` sheds, `sliding` preserves recency.*

<br>

```ts
import { Chunk, Duration, Effect, Option, Queue } from "effect";

const queuePolicySurface = Effect.scoped(
  Effect.gen(function* () {
  const bounded = yield* Effect.acquireRelease(Queue.bounded<number>(2), Queue.shutdown);
  const dropping = yield* Effect.acquireRelease(Queue.dropping<number>(2), Queue.shutdown);
  const sliding = yield* Effect.acquireRelease(Queue.sliding<number>(2), Queue.shutdown);
  yield* Effect.all([
    Queue.offer(bounded,  1),  Queue.offer(bounded, 2), Queue.offer(dropping, 1),
    Queue.offer(dropping, 2),  Queue.offer(sliding, 1), Queue.offer(sliding,  2),
  ]);
  const boundedThird = yield* Queue.offer(bounded, 3).pipe(Effect.timeoutOption(Duration.millis(5)),);
  const droppingThird = yield* Queue.offer(dropping, 3);
  const slidingThird = yield* Queue.offer(sliding, 3);
  const boundedValues = yield* Queue.takeAll(bounded);
  const droppingValues = yield* Queue.takeAll(dropping);
  const slidingValues = yield* Queue.takeAll(sliding);
  const boundedSnapshot =  Chunk.toReadonlyArray(boundedValues);
  const droppingSnapshot = Chunk.toReadonlyArray(droppingValues);
  const slidingSnapshot =  Chunk.toReadonlyArray(slidingValues);
  return {
    boundedThird, droppingThird, slidingThird, boundedSnapshot, droppingSnapshot, slidingSnapshot,
    invariant:
      Option.isNone(boundedThird) &&
      droppingThird === false &&
      slidingSnapshot[0] === 2 &&
      slidingSnapshot[1] === 3,
  } as const;
}),
);
```

**Queue laws:**<br>
- bounded policy must declare what waits and for how long.
- dropping/sliding semantics are product behavior, not logging behavior.
- `acquireRelease` finalizers keep shutdown ownership explicit even on failure paths.

**Invariant:** backpressure, shedding, and recency outcomes are returned as first-class booleans and snapshots.

---
## [3][PERMIT_ALGEBRA_AND_LOAD_SHEDDING]
>**Dictum:** *Use permits as the canonical contention model; shape admission with blocking (`withPermits`) or shedding (`withPermitsIfAvailable`).*

<br>

```ts
import { Duration, Effect, Option, Ref } from "effect";

const permitPolicySurface = Effect.gen(function* () {
  const semaphore = yield* Effect.makeSemaphore(2);
  const admitted = yield* Ref.make(0);
  const shed = yield* Ref.make(0);
  const BlockingDelay = Duration.millis(8);
  const SheddingDelay = Duration.millis(2);
  const blockingRun = yield* Effect.all(
    [1, 2, 3, 4].map((id) =>
      semaphore.withPermits(1)(
        Effect.sleep(BlockingDelay).pipe(
          Effect.zipRight(Ref.update(admitted, (n) => n + 1)),
          Effect.as(id),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );
  const shedRun = yield* Effect.all(
    [11, 12, 13, 14].map((id) =>
      semaphore.withPermitsIfAvailable(1)(
        Effect.sleep(SheddingDelay).pipe(
          Effect.zipRight(Ref.update(admitted, (n) => n + 1)),
          Effect.as(id),
        ),
      ).pipe(
        Effect.tap((result) =>
          Option.match(result, {
            onNone: () => Ref.update(shed, (n) => n + 1),
            onSome: () => Effect.void,
          }),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );
  const admittedCount = yield* Ref.get(admitted);
  const shedCount = yield* Ref.get(shed);
  return {
    blockingRun, shedRun, admittedCount, shedCount,
    invariant:
      admittedCount === blockingRun.length + shedRun.filter(Option.isSome).length &&
      shedCount === shedRun.filter(Option.isNone).length,
  } as const;
});
```

**Permit laws:**<br>
- switch from blocking to shedding only with explicit product policy.
- shed counts are primary runtime signals.
- semaphore boundaries must wrap the critical section itself.

**Invariant:** admissions and sheds reconcile exactly against observed optional results.

---
## [4][STM_COORDINATION_WITH_TRANSACTIONAL_SIGNALING]
>**Dictum:** *Cross-structure consistency (`TQueue` + `TMap` + `TSemaphore` + `TDeferred`) belongs in one transactional model.*

<br>

```ts
import { Duration, Effect, Fiber, Option, STM, TDeferred, TMap, TQueue, TSemaphore } from "effect";

const transactionalCoordinator = Effect.gen(function* () {
  const jobs = yield* STM.commit(TQueue.bounded<readonly [string, number]>(32));
  const inFlight = yield* STM.commit(TMap.empty<string, number>());
  const permits = yield* STM.commit(TSemaphore.make(2));
  const done = yield* STM.commit(TDeferred.make<void>());
  const CompletionSignal = "observed" as const;
  const WorkerDelay = Duration.millis(3);
  yield* STM.commit(
    TQueue.offerAll(jobs, [
      ["tenant-a", 1], ["tenant-b", 1], ["tenant-a", 2],
      ["tenant-c", 1], ["tenant-b", 3], ["tenant-a", 1],
    ]),
  );
  const completionObserver = yield* Effect.fork(
    STM.commit(TDeferred.await(done)).pipe(Effect.as(CompletionSignal)),
  );
  const fibers = yield* Effect.forEach(
    [0, 1, 2, 3, 4, 5] as const,
    () =>
      Effect.fork(
        TSemaphore.withPermits(
          STM.commit(
            TQueue.take(jobs).pipe(
              STM.flatMap(([tenant, delta]) =>
                TMap.updateWith(inFlight, tenant, (current) =>
                  Option.some(Option.getOrElse(current, () => 0) + delta),
                ).pipe(STM.as(tenant)),
              ),
            ),
          ).pipe(Effect.zipLeft(Effect.sleep(WorkerDelay))),
          permits,
          1,
        ),
      ),
    { concurrency: "unbounded" },
  );
  yield* Fiber.awaitAll(fibers);
  yield* STM.commit(TDeferred.succeed(done, undefined));
  const completionSignal = yield* Fiber.join(completionObserver);
  const snapshot = yield* STM.commit(TMap.toArray(inFlight));
  const available = yield* STM.commit(TSemaphore.available(permits));
  return {
    completionSignal, snapshot, available,
    invariant: completionSignal === CompletionSignal && snapshot.length === 3 && available === 2,
  } as const;
});
```

**STM laws:**<br>
- dequeue plus state transition belongs in the same committed transaction.
- admission remains explicit and separate in `TSemaphore` permits.
- `TDeferred` completion is useful only when at least one distinct observer awaits it.

**Invariant:** transactional cardinality and restored permit count are explicit outputs.

---
## [5][INTERRUPTION_PATHS_AND_RELEASE_GUARANTEES]
>**Dictum:** *Interruption is a first-class runtime event; cleanup must be encoded in the effect graph.*

<br>

```ts
import { Deferred, Effect, Fiber, Queue } from "effect";

const interruptionSurface = Effect.scoped(
  Effect.gen(function* () {
    const queue = yield* Queue.bounded<number>(16);
    const cleaned = yield* Deferred.make<void>();
    const worker = Queue.take(queue).pipe(
      Effect.tap((n) => Effect.logDebug(`worker:${n}`)),
      Effect.forever,
      Effect.onInterrupt(() =>
        Queue.shutdown(queue).pipe(
          Effect.zipRight(Deferred.succeed(cleaned, undefined)),
          Effect.asVoid,
        ),
      ),
    );
    const fiber = yield* Effect.forkScoped(worker);
    yield* Queue.offerAll(queue, [1, 2, 3, 4]);
    yield* Fiber.interrupt(fiber);
    yield* Deferred.await(cleaned);
    const closed = yield* Queue.isShutdown(queue);
    return { closed, invariant: closed } as const;
  }),
);
```

**Interruption laws:**<br>
- interruption handlers are business policy when resources are shared.
- cleanup effects must be idempotent and local to interrupted scope.
- interruption correctness is observable through closure and signals.

**Invariant:** cleanup signal completion and queue shutdown state converge to one outcome.

---
## [6][SCOPED_FANOUT_AND_POOL_CONTENTION]
>**Dictum:** *Fan-out and pooling are scope-bound resources; lag, replay, and contention limits must be explicit at the call site.*

<br>

```ts
import { randomUUID } from "node:crypto";
import { Deferred, Duration, Effect, Fiber, Pool, Ref, Schedule, Stream } from "effect";

const fanoutAndPool = Effect.scoped(
  Effect.gen(function* () {
    const done = yield* Deferred.make<void>();
    const BroadcastStrategy = "suspend" as const;
    const PoolTtlStrategy = "usage" as const;
    const PoolStepDelay = Duration.millis(1);
    const streams = yield* Stream.range(1, 60).pipe(
      Stream.schedule(Schedule.spaced(Duration.millis(2))),
      Stream.broadcast(2, { capacity: 32, strategy: BroadcastStrategy, replay: 0 }),
    );
    const [slow, fast] = streams;
    const pool = yield* Pool.makeWithTTL({
      acquire: Effect.sync(() => ({ id: randomUUID(), closed: false } as const)),
      min: 1,
      max: 4,
      concurrency: 4,
      timeToLive: Duration.seconds(20),
      timeToLiveStrategy: PoolTtlStrategy,
    });
    const invalidated = yield* Ref.make(0);
    const sumFiber = yield* Effect.fork(
      fast.pipe(
        Stream.interruptWhenDeferred(done),
        Stream.runFold(0, (sum, n) => sum + n),
      ),
    );
    const processedFiber = yield* Effect.fork(
      slow.pipe(
        Stream.mapEffect(
          (n) =>
            Pool.get(pool).pipe(
              Effect.flatMap((resource) =>
                Effect.sleep(PoolStepDelay).pipe(
                  Effect.zipRight(Pool.invalidate(pool, resource)),
                  Effect.zipRight(Ref.update(invalidated, (x) => x + 1)),
                  Effect.as(n),
                ),
              ),
            ),
          { concurrency: 4 },
        ),
        Stream.runFold(0, (count) => count + 1),
        Effect.ensuring(Deferred.succeed(done, undefined).pipe(Effect.ignore)),
      ),
    );
    const [sum, processed, invalidationCount] = yield* Effect.all([
      Fiber.join(sumFiber),
      Fiber.join(processedFiber),
      Ref.get(invalidated),
    ]);
    return {
      sum, processed, invalidationCount,
      invariant: processed === invalidationCount && processed <= 60,
    } as const;
  }),
);
```

**Concurrency laws:**<br>
- fan-out lag strategy and replay budget define causal pressure boundaries.
- pool `max` and stream map concurrency must communicate one contention policy.
- termination signaling (`Deferred`) should govern consumer shutdown explicitly.

**Invariant:** invalidation count and processed cardinality remain policy-aligned under bounded contention.

---
## [7][WORKER_RUNNER_AND_BROWSER_TRANSPORT_BRIDGES]
>**Dictum:** *Cross-runtime lanes (`@effect/platform`, `@effect/platform-browser`) must share one ownership contract for close-latch and interruption semantics.*

<br>

```ts
import * as WorkerRunner from "@effect/platform/WorkerRunner";
import * as BrowserWorkerRunner from "@effect/platform-browser/BrowserWorkerRunner";
import * as Transferable from "@effect/platform/Transferable";
import { Effect, Layer } from "effect";

const workerLane = WorkerRunner.layer((payload: Uint8Array) =>
  Transferable.addAll([payload.buffer]).pipe(Effect.zipRight(Effect.succeed(payload.byteLength * 2)),),
);
const launchWorkerLane = (port: MessagePort | Window) =>
  WorkerRunner.launch(workerLane).pipe(
    Effect.provide(Layer.mergeAll(BrowserWorkerRunner.layerMessagePort(port), WorkerRunner.layerCloseLatch)),
    Effect.provideServiceEffect(Transferable.Collector, Transferable.makeCollector),
  );
```

**Bridge laws:**<br>
- `layerCloseLatch` is the canonical close signal across worker lanes.
- browser runner binding is transport ownership, not business logic.
- transferables are explicit payload policy, not implicit transport side effects.

**Invariant:** worker launch, browser transport, and transferable collection are composed through one close-latch contract.
