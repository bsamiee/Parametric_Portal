# [H1][CONCURRENCY]
>**Dictum:** *STM composes atomic transactions; fibers structure concurrent lifecycles; coordination primitives replace locks, condition variables, and polling loops.*

STM (Software Transactional Memory) provides lock-free, composable atomic operations across transactional data structures. Fibers are lightweight threads with structured lifecycles. Coordination primitives (Deferred, Semaphore, Pool, Queue) gate, signal, and bound concurrent work. All snippets assume `import { STM, TMap, TRef, TArray, Deferred, Queue, Effect, Fiber, Stream, Channel, Option, Duration, pipe } from "effect"`.

---
## [1][STM_TRANSACTIONS]
>**Dictum:** *STM.gen composes reads and writes across multiple transactional variables into a single atomic unit -- no locks, no deadlocks, automatic retry on conflict.*

`STM<A, E, R>` is a speculative transaction: reads/writes tracked in a journal, validated at commit. On conflict (overlapping writes from another fiber), the runtime re-executes from scratch. `STM.commit` converts to `Effect`. `STM.retry` blocks until any observed variable changes -- replaces condition variables. `STM.orTry` falls back when the primary branch retries (not failures -- use `STM.orElse` for failures). `STM.check(predicate)` retries until predicate holds.

```typescript
// --- [STM_TRANSACTIONS] ------------------------------------------------------
import { STM, TMap, TRef, Option, Effect, pipe } from "effect";

type Session = { readonly id: string; readonly tenantId: string; readonly expiresAt: number };

// Atomic multi-variable transaction: balance transfer across two TMap entries
const transfer = (
    balances: TMap.TMap<string, number>,
    from: string,
    to: string,
    amount: number,
): Effect.Effect<void> =>
    STM.commit(
        STM.gen(function* () {
            const source = yield* TMap.get(balances, from);
            yield* Option.match(source, {
                onNone: () => STM.fail(new Error("source not found")),
                onSome: (balance) =>
                    STM.gen(function* () {
                        // why: STM.check retries until balance sufficient -- no polling
                        yield* STM.check(() => balance >= amount);
                        yield* TMap.set(balances, from, balance - amount);
                        yield* TMap.merge(balances, to, amount, (old, delta) => old + delta);
                    }),
            });
        }),
    );

// STM.retry + Option.match: block until session appears in map
const awaitSession = (
    sessions: TMap.TMap<string, Session>,
    id: string,
): Effect.Effect<Session> =>
    STM.commit(
        STM.gen(function* () {
            const found = yield* TMap.get(sessions, id);
            return yield* Option.match(found, {
                onNone: () => STM.retry,
                onSome: STM.succeed,
            });
        }),
    );

// STM.orTry: fall back when primary retries -- not when it fails
const takeOrNone = (
    sessions: TMap.TMap<string, Session>,
    id: string,
): Effect.Effect<Option.Option<Session>> =>
    STM.commit(
        pipe(
            STM.gen(function* () {
                const found = yield* TMap.get(sessions, id);
                return yield* Option.match(found, {
                    onNone: () => STM.retry,
                    onSome: (session) => STM.succeed(Option.some(session)),
                });
            }),
            STM.orTry(() => STM.succeed(Option.none())),
        ),
    );

// TRef: single-variable transactional state -- compose with TMap in STM.gen
const conditionalIncrement = (counter: TRef.TRef<number>, ceiling: number): Effect.Effect<number> =>
    STM.commit(STM.gen(function* () {
        const current = yield* TRef.get(counter);
        yield* STM.check(() => current < ceiling);
        yield* TRef.set(counter, current + 1);
        return current + 1;
    }));
```

---
## [2][TMAP_ADVANCED]
>**Dictum:** *TMap blocking extractions, bulk mutations, and conditional updates replace mutex + condition variable choreography.*

`TMap.takeFirst(map, pf)` extracts + removes the first matching entry, **retrying if none exist** -- a blocking dequeue on arbitrary predicates. `TMap.takeSome(map, pf)` extracts all matching entries with the same retry semantics. `TMap.updateWith(map, key, f)` where `f: Option<V> => Option<V>` atomically inserts, updates, or deletes. `TMap.removeIf`/`TMap.retainIf` with `{ discard: boolean }` control whether removed entries are returned. `TMap.transform(map, f)` rebuilds all entries atomically.

```typescript
// --- [TMAP_ADVANCED] ---------------------------------------------------------
import { STM, TMap, TArray, Option, Effect, pipe } from "effect";

type Task = { readonly id: string; readonly priority: number; readonly status: "pending" | "running" };

// takeFirst: blocking dequeue by predicate -- retries until match exists
const claimHighPriority = (tasks: TMap.TMap<string, Task>): Effect.Effect<readonly [string, Task]> =>
    STM.commit(
        TMap.takeFirst(tasks, (key, task) =>
            task.priority > 5 && task.status === "pending"
                ? Option.some([key, { ...task, status: "running" as const }] as const)
                : Option.none(),
        ),
    );

// updateWith: atomic conditional update/delete via Option transform
const completeOrRemove = (tasks: TMap.TMap<string, Task>, id: string): Effect.Effect<void> =>
    STM.commit(
        TMap.updateWith(tasks, id, (existing) =>
            Option.flatMap(existing, (task) =>
                task.status === "running" ? Option.none() : Option.some(task),
            ),
        ),
    );

// removeIf + retainIf: atomic bulk mutations
const evictExpired = (
    sessions: TMap.TMap<string, { expiresAt: number }>,
    now: number,
): Effect.Effect<ReadonlyArray<readonly [string, { expiresAt: number }]>> =>
    STM.commit(TMap.removeIf(sessions, (_, session) => session.expiresAt <= now));

// TArray: fixed-size transactional array for indexed concurrent access
const swapIndices = (array: TArray.TArray<number>, indexA: number, indexB: number): Effect.Effect<void> =>
    STM.commit(
        STM.gen(function* () {
            const valA = yield* TArray.get(array, indexA);
            const valB = yield* TArray.get(array, indexB);
            yield* TArray.update(array, indexA, () => valB);
            yield* TArray.update(array, indexB, () => valA);
        }),
    );
```

---
## [3][COORDINATION]
>**Dictum:** *Deferred signals once; Semaphore bounds concurrency; Pool manages resource lifecycles; Queue bridges producers and consumers.*

`Deferred.make<A, E>()` returns `Effect<Deferred<A, E>>` -- a one-shot completion primitive. `Deferred.await` suspends calling fiber until `Deferred.succeed`/`fail` fires. Both return `Effect<boolean>` (true if first completion). `Effect.makeSemaphore(n)` returns `Semaphore` with `withPermits(n)(effect)` -- guaranteed release on failure/interruption. `Pool.make` creates fixed-size resource pools; `Pool.makeWithTTL` adds idle eviction. `Queue.bounded` back-pressures; `Queue.sliding` drops oldest; `Queue.dropping` drops newest.

```typescript
// --- [COORDINATION] ----------------------------------------------------------
import { Deferred, Effect, Queue, Pool, Duration, pipe } from "effect";

// Deferred: initialization gate -- workers wait until setup completes
const initGate = Effect.gen(function* () {
    const ready = yield* Deferred.make<void, never>();
    yield* Effect.forkScoped(
        Effect.gen(function* () {
            yield* Effect.log("initializing...");
            yield* Effect.sleep(Duration.seconds(1));
            yield* Deferred.succeed(ready, undefined as void);
        }),
    );
    yield* Deferred.await(ready);
    yield* Effect.log("initialized -- proceed");
});

// Semaphore: bound concurrent API calls to N permits
const bounded = Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(10);
    // why: withPermits(n) acquires n slots; guaranteed release on failure/interruption
    const throttled = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        semaphore.withPermits(1)(effect);
    return { throttled } as const;
});

// Pool: scoped resource pool with TTL eviction -- lifetime tied to enclosing Scope
const connectionPool = Pool.makeWithTTL({
    acquire: Effect.succeed({ query: (sql: string) => Effect.succeed(sql) }),
    min: 2, max: 10, timeToLive: Duration.minutes(5),
});

// Queue backpressure modes
const queues = Effect.gen(function* () {
    const lossless = yield* Queue.bounded<string>(128);    // blocks producer when full
    const latestState = yield* Queue.sliding<string>(32);  // evicts oldest on overflow
    const bestEffort = yield* Queue.dropping<string>(32);  // discards newest on overflow
    return { lossless, latestState, bestEffort } as const;
});
```

---
## [4][FIBER_LIFECYCLE]
>**Dictum:** *forkScoped ties fiber to ambient Scope; race auto-interrupts the loser; interrupt masking protects critical sections.*

`Effect.fork` spawns a detached fiber. `Effect.forkScoped` ties fiber lifetime to the enclosing `Scope` -- canonical for service constructors. `Effect.forkDaemon` escapes scope entirely. `Fiber.join` propagates errors; `Fiber.await` returns `Exit`. `Effect.race` runs two effects concurrently -- first to complete wins, loser auto-interrupted. `Effect.raceAll` for N effects. `Fiber.awaitAll` joins N fibers, returning `Array<Exit<A, E>>`. `Effect.uninterruptible` masks interruption for critical sections; `Effect.interruptible` re-opens it.

```typescript
// --- [FIBER_LIFECYCLE] -------------------------------------------------------
import { Effect, Fiber, Duration, Scope, pipe } from "effect";

// forkScoped: worker fibers torn down when enclosing Scope closes
const spawnWorkers = (
    count: number,
    work: Effect.Effect<void>,
): Effect.Effect<ReadonlyArray<Fiber.RuntimeFiber<void>>, never, Scope> =>
    Effect.forEach(
        Array.from({ length: count }, (_, index) => index),
        () => Effect.forkScoped(Effect.forever(work)),
    );

// race: hedged request -- primary + delayed fallback, loser auto-interrupted
const hedged = <A, E>(
    primary: Effect.Effect<A, E>,
    fallback: Effect.Effect<A, E>,
    delay: Duration.DurationInput,
): Effect.Effect<A, E> =>
    Effect.race(
        primary,
        pipe(Effect.sleep(delay), Effect.zipRight(fallback)),
    );

// Fiber.awaitAll: fan-out N fibers, join all exits
const fanOutJoin = <A, E>(effects: ReadonlyArray<Effect.Effect<A, E>>) =>
    Effect.gen(function* () {
        const fibers = yield* Effect.forEach(effects, Effect.fork);
        return yield* Fiber.awaitAll(fibers);
    });

// Interrupt masking: uninterruptible critical section, interruptible cleanup
const safeCommit = <A, E, R>(commit: Effect.Effect<A, E, R>, cleanup: Effect.Effect<void, never, R>) =>
    pipe(Effect.uninterruptible(commit), Effect.tap(() => Effect.interruptible(cleanup)));
```

---
## [5][STREAM_CONCURRENCY]
>**Dictum:** *mergeAll interleaves N streams; broadcast fans out to N consumers; zipLatest combines reactive signals.*

`Stream.mergeAll` merges N streams with bounded concurrency. `Stream.merge` interleaves two streams non-deterministically. `Stream.broadcast(stream, maximumLag)` fans out to N consumers -- each receives ALL elements, bounded by lag. `Stream.broadcastDynamic` allows consumers to join/leave at runtime. `Stream.distributedWith(stream, n, decide)` partitions by predicate. `Stream.zipLatest` combines latest values from two streams (reactive combineLatest).

```typescript
// --- [STREAM_CONCURRENCY] ----------------------------------------------------
import { Stream, Effect, Duration, pipe } from "effect";

// mergeAll: N source streams into one with bounded concurrency
const merged = Stream.mergeAll(
    [Stream.make("a1", "a2"), Stream.make("b1", "b2"), Stream.make("c1", "c2")],
    { concurrency: 3 },
);

// broadcast: fan-out to N consumers, each sees all elements, max lag bounded
const fanOut = <A, E, R>(source: Stream.Stream<A, E, R>) =>
    pipe(
        Stream.broadcast(source, 2, 16),
        Effect.flatMap(([c1, c2]) =>
            Effect.all([Stream.runCollect(c1), Stream.runCollect(c2)], { concurrency: 2 }),
        ),
    );

// distributedWith: partition by predicate into N downstream queues
const partitioned = <E, R>(source: Stream.Stream<string, E, R>) =>
    Stream.distributedWith({
        self: source, size: 2, maximumLag: 16,
        decide: (value) => Effect.succeed((index) => index === (value.startsWith("A") ? 0 : 1)),
    });

// zipLatest: combine latest values from two reactive streams (combineLatest)
const combined = Stream.zipLatest(Stream.make(1, 2, 3), Stream.make("a", "b"));
```

---
## [6][CHANNEL_PIPELINES]
>**Dictum:** *Channels are the backpressure-aware primitive underlying Stream/Sink -- compose pipeline stages with typed input/output/done/error.*

`Channel<out Env, in InErr, in InElem, in InDone, out OutErr, out OutElem, out OutDone>` is bidirectional. `Channel.pipeTo` connects output to input. `Channel.mergeWith` combines two channels with concurrency control. `Channel.mapOutEffectPar(f, n)` enables bounded parallel processing. `Channel.readWith` pattern-matches input (element/error/done). Bridge ops: `Channel.fromQueue`, `Channel.toQueue`, `Channel.fromEffect`.

```typescript
// --- [CHANNEL_PIPELINES] -----------------------------------------------------
import { Channel, Queue, Effect, pipe } from "effect";

// readWith: pattern match on upstream events -- recursive pipeline stage
const transformStage = <E>(): Channel.Channel<never, E, string, void, E, string, void> =>
    Channel.readWith({
        onInput: (input: string) =>
            pipe(Channel.write(input.toUpperCase()), Channel.flatMap(() => transformStage<E>())),
        onFailure: (error: E) => Channel.fail(error),
        onDone: () => Channel.void,
    });

// pipeTo: connect source -> transform stage; fromQueue/toQueue bridge Queue
const pipeline = <E>(
    source: Channel.Channel<never, unknown, unknown, unknown, E, string, void>,
) => Channel.pipeTo(source, transformStage<E>());
```

---
## [7][HAZARDS]
>**Dictum:** *Starvation, livelock, and unbounded growth are structural defects -- detect via topology, not symptoms.*

```typescript
// --- [HAZARDS] ---------------------------------------------------------------

// [ANTI-PATTERN] Unbounded fork: each request spawns a fiber with no backpressure
// const handle = (request: Request) => Effect.fork(process(request));
// [CORRECT] Bounded queue absorbs burst; fixed worker pool drains at controlled rate
// yield* Queue.bounded<Request>(256) -> N forkScoped workers -> Queue.take loop

// [ANTI-PATTERN] Effect.runSync inside Effect pipeline -- sync-over-async starvation
// const bad = Effect.flatMap(fetchData, (data) => Effect.sync(() => Effect.runSync(parse(data))));
// [CORRECT] Compose effects; never collapse mid-pipeline
// const good = Effect.flatMap(fetchData, (data) => parse(data));

// [ANTI-PATTERN] STM livelock: long-running transaction contends with high-frequency writers
// STM.gen(function* () {
//     const all = yield* TMap.toArray(bigMap);        // reads entire map
//     const result = expensiveComputation(all);        // time passes
//     yield* TMap.set(bigMap, "result", result);       // conflict -> re-execute from scratch
// })
// [CORRECT] Snapshot outside transaction, compute, then commit minimal write
// const snapshot = yield* STM.commit(TMap.toArray(bigMap));
// const result = expensiveComputation(snapshot);       // pure, outside STM
// yield* STM.commit(TMap.set(bigMap, "result", result));

// [ANTI-PATTERN] Uninterruptible region blocks graceful shutdown
// Effect.uninterruptible(Effect.forever(pollLoop));
// [CORRECT] Interruptible body with uninterruptible cleanup only
// Effect.forever(pipe(pollLoop, Effect.onInterrupt(() => cleanup)));

// [ANTI-PATTERN] forkDaemon for service work -- escapes scope, leaks on shutdown
// Effect.forkDaemon(workerLoop);
// [CORRECT] forkScoped ties worker lifetime to service scope
// Effect.forkScoped(workerLoop);
```

| [INDEX] | [HAZARD]                | [SYMPTOM]                               | [STRUCTURAL_FIX]                              |
| :-----: | ----------------------- | --------------------------------------- | --------------------------------------------- |
|   [1]   | Unbounded fork          | OOM, fiber count grows without limit    | `Queue.bounded` + fixed worker pool           |
|   [2]   | Sync-over-async         | Deadlock, blocked fiber scheduler       | Compose effects; `Effect.promise` at boundary |
|   [3]   | STM livelock            | Transaction retries spike under load    | Minimize read-set; compute outside STM        |
|   [4]   | Uninterruptible regions | Shutdown hangs, fibers refuse interrupt | Scope `uninterruptible` to critical sections  |
|   [5]   | forkDaemon leak         | Orphan fibers outlive service scope     | `forkScoped` in service constructors          |
|   [6]   | Mutable shared state    | Data races across fibers                | `TMap`/`TRef`/`Ref` -- never JS `Map`/`Set`   |

---
## [8][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `STM.commit` to execute any `STM` value as an `Effect`.
- [ALWAYS] Compose multiple `TMap`/`TRef`/`TArray` operations inside a single `STM.gen` for atomicity.
- [ALWAYS] `STM.check(() => condition)` to guard transactions -- retries until predicate holds.
- [ALWAYS] `STM.orTry` for fallback branches when the primary transaction enters retry.
- [ALWAYS] `Deferred.make` for one-shot signaling; `Deferred.await` to suspend until completion.
- [ALWAYS] `Effect.makeSemaphore(n)` + `withPermits` for bounded concurrency gates.
- [ALWAYS] `Effect.forkScoped` inside service constructors so fibers tear down with scope.
- [ALWAYS] `Queue.bounded` as default -- makes backpressure explicit.
- [ALWAYS] `Pool.makeWithTTL` for connection/resource pools with idle eviction.
- [ALWAYS] Minimize STM transaction read-set -- long transactions under contention livelock.
- [NEVER] Mix `async/await` with STM or Queue operations -- use `Effect.promise` at boundaries.
- [NEVER] Share mutable JS objects (`Map`, `Set`, `Array`) across fibers -- use `TMap`, `Ref`, `Queue`.
- [NEVER] `Effect.forkDaemon` for work that must respect service lifecycle -- use `forkScoped`.
- [NEVER] `Effect.runSync`/`Effect.runPromise` inside Effect pipelines -- compose effects.
- [NEVER] `Effect.uninterruptible` around unbounded loops -- scope to critical sections only.
- [NEVER] Create `Ref`/`TMap`/`Deferred` at module level -- always inside `Effect.gen` or scoped constructor.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PRIMITIVE]        | [CONSTRUCTOR]                      | [KEY_OPS]                                                    | [DOMAIN]                            |
| :-----: | ------------------ | ---------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
|   [1]   | `STM<A,E,R>`       | `STM.gen` + `STM.commit`           | `retry`, `orTry`, `check`, `orElse`                          | Atomic multi-variable transactions  |
|   [2]   | `TMap<K,V>`        | `TMap.empty()` / `TMap.make()`     | `get`, `set`, `merge`, `takeFirst`, `takeSome`, `updateWith` | Session registries, atomic caches   |
|   [3]   | `TRef<A>`          | `TRef.make(a)`                     | `get`, `set`, `update`, `modify`                             | Single-variable transactional state |
|   [4]   | `TArray<A>`        | `TArray.make()` / `TArray.empty`   | `get`, `update`, `transform`, `forEach`                      | Indexed concurrent access           |
|   [5]   | `Deferred<A,E>`    | `Deferred.make()`                  | `await`, `succeed`, `fail`, `poll`                           | One-shot fiber rendezvous           |
|   [6]   | `Semaphore`        | `Effect.makeSemaphore(n)`          | `withPermits(n)(effect)`                                     | Bounded concurrent access           |
|   [7]   | `Pool<A,E>`        | `Pool.make` / `Pool.makeWithTTL`   | `get`, scoped lifecycle                                      | Connection/resource pools           |
|   [8]   | `Queue<A>`         | `Queue.bounded(n)`                 | `offer`, `take`, `takeAll`, `shutdown`                       | Fiber-to-fiber handoff              |
|   [9]   | `Fiber<A,E>`       | `Effect.fork` / `forkScoped`       | `join`, `await`, `interrupt`, `awaitAll`                     | Structured concurrency              |
|  [10]   | `Effect.race`      | `Effect.race(a, b)`                | Loser auto-interrupted                                       | Hedged requests, first-wins         |
|  [11]   | `Stream.mergeAll`  | `Stream.mergeAll(streams, opts)`   | Concurrent interleave                                        | Multi-source ingestion              |
|  [12]   | `Stream.broadcast` | `Stream.broadcast(stream, n, lag)` | N consumers, all elements                                    | Fan-out to parallel consumers       |
|  [13]   | `Stream.zipLatest` | `Stream.zipLatest(a, b)`           | Combine latest values                                        | Reactive signal composition         |
|  [14]   | `Channel`          | `Channel.readWith` / `pipeTo`      | `write`, `fromQueue`, `toQueue`, `mergeWith`                 | Custom backpressure pipelines       |

Cross-references: `effects.md [2]` for `pipe`/`flow` and `Effect.all` concurrency options, `effects.md [3]` for Schedule retry algebra, `services.md [2]` for `Effect.forkScoped` in scoped constructors, `algorithms.md [1]` for `Stream.groupedWithin` microbatch pipelines, `observability.md [2]` for `FiberRef` context propagation across forked fibers, `performance.md [4]` for backpressure topology with `Queue.bounded`.
