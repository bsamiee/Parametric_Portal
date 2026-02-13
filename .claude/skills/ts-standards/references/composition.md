# [H1][COMPOSITION]
>**Dictum:** *Consistent combinator selection. Advanced APIs eliminate hand-rolled infrastructure.*

<br>

---
## [1][COMBINATOR_SELECTION]
>**Dictum:** *Each combinator communicates intent. Choose precisely.*

<br>

| [INDEX] | [COMBINATOR]     | [WHEN]                                                 |
| :-----: | ---------------- | ------------------------------------------------------ |
|   [1]   | `pipe()`         | Linear left-to-right composition                       |
|   [2]   | `Effect.map`     | Sync transform of success value (A -> B)               |
|   [3]   | `Effect.flatMap` | Chain Effect-returning functions (A -> Effect\<B\>)    |
|   [4]   | `Effect.andThen` | Mixed input (value, Promise, Effect, Option, Either)   |
|   [5]   | `Effect.tap`     | Side effects without changing value                    |
|   [6]   | `Effect.all`     | Aggregate independent effects into struct/tuple        |
|   [7]   | `Effect.gen`     | 3+ dependent operations or control flow                |
|   [8]   | `Effect.fn`      | Named function with automatic tracing span             |
|   [9]   | `Effect.iterate` | Type-safe recursive computation (replaces while loops) |

[CRITICAL]:
- [NEVER] Mix `async/await` with Effect -- use `Effect.promise` for interop.
- [NEVER] Wrap pure `A -> B` functions in Effect -- Effect orchestrates, domain computes.

**Tracing rule:**

| [INDEX] | [CONTEXT]      | [USE]                         | [NOT]            |
| :-----: | -------------- | ----------------------------- | ---------------- |
|   [1]   | Service method | `Effect.fn('Service.method')` | `Telemetry.span` |
|   [2]   | Route handler  | `Telemetry.routeSpan('name')` | `Effect.fn`      |
|   [3]   | Pure function  | Neither                       | Either           |

---
## [2][STM_AND_TMAP]
>**Dictum:** *Composable atomic transactions replace locks and manual coordination.*

<br>

STM provides lock-free composable transactions. Multiple TMap operations compose into single atomic commit -- no mutexes, no deadlocks, no manual rollback.

```typescript
scoped: Effect.gen(function* () {
    const registry = yield* STM.commit(TMap.empty<string, Instance>());
    const lastAccess = yield* STM.commit(TMap.empty<string, number>());

    const getOrCreate = (name: string, factory: Effect.Effect<Instance>) =>
        STM.commit(TMap.get(registry, name)).pipe(
            Effect.flatMap(Option.match({
                onNone: () => factory.pipe(Effect.tap((inst) =>
                    STM.commit(STM.all([
                        TMap.set(registry, name, inst),
                        TMap.set(lastAccess, name, Date.now()),
                    ])))),
                onSome: (inst) => STM.commit(TMap.set(lastAccess, name, Date.now())).pipe(
                    Effect.as(inst)),
            })));

    const gc = (maxAgeMs: number) => Effect.gen(function* () {
        const now = Date.now();
        const entries = yield* STM.commit(TMap.toArray(lastAccess));
        const stale = A.filterMap(entries, ([key, ts]) =>
            now - ts > maxAgeMs ? Option.some(key) : Option.none());
        yield* STM.commit(A.reduce(stale, STM.void, (transaction, key) =>
            transaction.pipe(
                STM.zipRight(TMap.remove(registry, key)),
                STM.zipRight(TMap.remove(lastAccess, key)),
            )));
    });
    // ...
})
```

**Key STM APIs:**

| [INDEX] | [API]            | [REPLACES]                                      |
| :-----: | ---------------- | ----------------------------------------------- |
|   [1]   | `STM.commit`     | Materializes transaction into Effect            |
|   [2]   | `STM.all`        | Composes multiple STM ops atomically            |
|   [3]   | `STM.zipRight`   | Sequential composition (discard left result)    |
|   [4]   | `STM.check`      | Blocks until predicate holds (replaces polling) |
|   [5]   | `STM.retry`      | Blocks until referenced TRef values change      |
|   [6]   | `STM.gen`        | Generator syntax for multi-step transactions    |
|   [7]   | `TMap.takeFirst` | Blocks until matching entry appears             |
|   [8]   | `TRef`           | Single transactional mutable reference          |
|   [9]   | `TQueue`         | Bounded/unbounded transactional queue           |

[CRITICAL]:
- [NEVER] `new Map()` + manual locks -- use `TMap` via STM.
- [NEVER] Polling loops for condition waits -- use `STM.check` or `TMap.takeFirst`.

---
## [3][FIBER_AND_CONCURRENCY]
>**Dictum:** *FiberMap manages keyed background work. Scope handles lifecycle.*

<br>

**FiberMap** -- keyed fiber registry with auto-cleanup:

```typescript
const runningJobs = yield* FiberMap.make<string>();
// Fork + store + auto-interrupt-existing + auto-remove-on-complete
yield* FiberMap.run(runningJobs, jobId)(executeWorkflow(jobId));
// Cancel = interrupt + remove
yield* FiberMap.remove(runningJobs, jobId);
// Shutdown: automatic via Scope
yield* Effect.addFinalizer(() => FiberMap.join(runningJobs).pipe(Effect.ignore));
```

**Related patterns:**

| [INDEX] | [API]                      | [REPLACES]                                       |
| :-----: | -------------------------- | ------------------------------------------------ |
|   [1]   | `FiberMap.make/run/remove` | `Map<string, Fiber>` + manual lifecycle          |
|   [2]   | `FiberSet.make/run`        | `Set<Fiber>` + cleanup for anonymous tasks       |
|   [3]   | `FiberHandle.make/run`     | `let fiber: Fiber \| null` + replacement logic   |
|   [4]   | `Effect.acquireRelease`    | `try/finally` for resource cleanup               |
|   [5]   | `Effect.addFinalizer`      | Scope-bound cleanup registration                 |
|   [6]   | `Mailbox`                  | Bounded async fiber communication                |
|   [7]   | `Effect.serviceOption`     | Optional dependency injection (returns `Option`) |
|   [8]   | `Semaphore.withPermits(n)` | Manual concurrency limiting                      |
|   [9]   | `Pool.make/makeWithTTL`    | Connection pool with auto-sizing                 |

[CRITICAL]:
- [NEVER] `Map<string, Fiber>` + manual interrupt/cleanup -- use `FiberMap`.
- [NEVER] Manual `AbortController` -- use `Fiber.interrupt` or scope-based interruption.

---
## [4][SCHEDULE_COMPOSITION]
>**Dictum:** *Schedules are composable values. Each combinator adds exactly one concern.*

<br>

```typescript
const _mkSchedule = (config: {
    readonly base: Duration.DurationInput;
    readonly maxAttempts: number;
    readonly factor?: number;
    readonly cap?: Duration.DurationInput;
}) => Schedule.exponential(config.base, config.factor ?? 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(Math.max(0, config.maxAttempts - 1))),
    ...(config.cap !== undefined ? [Schedule.upTo(config.cap)] : []),
);
```

**Composition operators:**

| [INDEX] | [OPERATOR]             | [SEMANTICS]                                   |
| :-----: | ---------------------- | --------------------------------------------- |
|   [1]   | `intersect(a, b)`      | Both must continue; takes longer delay        |
|   [2]   | `union(a, b)`          | Either can continue; takes shorter delay      |
|   [3]   | `andThen(a, b)`        | Run first schedule, then second sequentially  |
|   [4]   | `compose(a, b)`        | First output feeds second input               |
|   [5]   | `whileInput(pred)`     | Continue while input satisfies predicate      |
|   [6]   | `upTo(duration)`       | Cap total elapsed time                        |
|   [7]   | `tapOutput(f)`         | Side-effect on each schedule output (metrics) |
|   [8]   | `resetAfter(duration)` | Reset state after idle period                 |

**Cron:** `Schedule.cron('0 */6 * * *')` replaces `node-cron`. Also: `dayOfMonth`, `dayOfWeek`, `hourOfDay`, `minuteOfHour`.

[CRITICAL]:
- [NEVER] Manual `setTimeout` + counter + jitter calculation -- use `Schedule` combinators.
- [NEVER] `node-cron` -- use `Schedule.cron`.

---
## [5][STREAM_PATTERNS]
>**Dictum:** *Streams are lazy, backpressured, composable sequences. Use for unbounded or reactive data.*

<br>

```typescript
const eventStream = Stream.fromPubSub(eventBus).pipe(
    Stream.filter((event) => event._tag === 'DataChanged'),
    Stream.throttle({ cost: () => 1, duration: '500 millis', strategy: 'enforce' }),
    Stream.tap((event) => processEvent(event)),
    Stream.catchTag('ProcessError', () => Stream.empty),
);
```

**Key patterns:**

| [INDEX] | [PATTERN]                       | [API]                                                  |
| :-----: | ------------------------------- | ------------------------------------------------------ |
|   [1]   | Heartbeat + data interleaving   | `Stream.merge` with halt strategy                      |
|   [2]   | Fan-out to multiple consumers   | `Stream.broadcast`                                     |
|   [3]   | Partitioned parallel processing | `Stream.groupByKey`                                    |
|   [4]   | External source ingestion       | `Stream.fromReadableStream` / `fromAsyncIterable`      |
|   [5]   | Backpressure control            | `Stream.buffer({ capacity: 16, strategy: 'sliding' })` |
|   [6]   | Time-windowed batching          | `Stream.groupedWithin(100, '5 seconds')`               |
|   [7]   | Debounced processing            | `Stream.debounce('300 millis')`                        |
|   [8]   | Text line processing            | `Stream.splitLines` / `Stream.decodeText`              |

[CRITICAL]:
- [NEVER] Eager `Array<Effect>` for unbounded data -- use `Stream`.
- [NEVER] RxJS or EventEmitter for server-side reactive -- use `PubSub` + `Stream`.

---
## [6][EFFECT_UTILITIES]
>**Dictum:** *Know the one-liner. Effect's utility belt prevents hand-rolling.*

<br>

| [INDEX] | [API]                            | [REPLACES]                                    |
| :-----: | -------------------------------- | --------------------------------------------- |
|   [1]   | `Effect.cached`                  | Manual memoization with closure variable      |
|   [2]   | `Effect.cachedWithTTL`           | Timed cache invalidation                      |
|   [3]   | `Effect.once`                    | At-most-one execution guard                   |
|   [4]   | `Effect.partition`               | `[failures, successes]` without short-circuit |
|   [5]   | `Effect.iterate`                 | Recursive computation (replaces `while`)      |
|   [6]   | `Effect.serviceOption`           | Optional dependency (returns `Option`)        |
|   [7]   | `Effect.annotateCurrentSpan`     | Add attributes to active tracing span         |
|   [8]   | `Effect.withSpan`                | Wrap effect in named span                     |
|   [9]   | `Effect.timeoutFail`             | Fail with typed error on timeout              |
|  [10]   | `Queue.bounded/sliding/dropping` | Back-pressure async queue                     |
|  [11]   | `Deferred`                       | One-shot synchronization primitive            |
|  [12]   | `Semaphore`                      | Permit-based concurrency control              |
|  [13]   | `Latch`                          | Gate synchronization (open/close/await)       |
|  [14]   | `SubscriptionRef`                | Ref with reactive `changes` stream            |
|  [15]   | `SynchronizedRef`                | Ref with effectful `updateEffect`             |

[REFERENCE] Consolidation patterns: [->consolidation.md](./consolidation.md).
