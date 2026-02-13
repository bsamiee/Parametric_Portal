# [H1][COMPOSITION]
>**Dictum:** *Consistent combinator selection. Advanced APIs eliminate hand-rolled infrastructure.*

<br>

---
## [1][COMBINATOR_SELECTION]
>**Dictum:** *Each combinator communicates intent. Choose precisely.*

<br>

| [COMBINATOR]     | [WHEN]                                                 |
| ---------------- | ------------------------------------------------------ |
| `pipe()`         | Linear left-to-right composition                       |
| `Effect.map`     | Sync transform of success value (A -> B)               |
| `Effect.flatMap` | Chain Effect-returning functions (A -> Effect\<B\>)    |
| `Effect.andThen` | Mixed input (value, Promise, Effect, Option, Either)   |
| `Effect.tap`     | Side effects without changing value                    |
| `Effect.all`     | Aggregate independent effects into struct/tuple        |
| `Effect.gen`     | 3+ dependent operations or control flow                |
| `Effect.fn`      | Named function with automatic tracing span             |
| `Effect.iterate` | Type-safe recursive computation (replaces while loops) |

[CRITICAL]:
- [NEVER] Mix `async/await` with Effect -- use `Effect.promise` for interop.
- [NEVER] Wrap pure `A -> B` functions in Effect -- Effect orchestrates, domain computes.

**Tracing rule:**

| [CONTEXT]      | [USE]                         | [NOT]            |
| -------------- | ----------------------------- | ---------------- |
| Service method | `Effect.fn('Service.method')` | `Telemetry.span` |
| Route handler  | `Telemetry.routeSpan('name')` | `Effect.fn`      |
| Pure function  | Neither                       | Either           |

---
## [2][STM_AND_TMAP]
>**Dictum:** *Composable atomic transactions replace locks. TMap is a transactional concurrent map.*

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

| [API]            | [REPLACES]                                      |
| ---------------- | ----------------------------------------------- |
| `STM.commit`     | Materializes transaction into Effect            |
| `STM.all`        | Composes multiple STM ops atomically            |
| `STM.zipRight`   | Sequential composition (discard left result)    |
| `STM.check`      | Blocks until predicate holds (replaces polling) |
| `STM.retry`      | Blocks until referenced TRef values change      |
| `STM.gen`        | Generator syntax for multi-step transactions    |
| `TMap.takeFirst` | Blocks until matching entry appears             |
| `TRef`           | Single transactional mutable reference          |
| `TQueue`         | Bounded/unbounded transactional queue           |

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

| [API]                      | [REPLACES]                                       |
| -------------------------- | ------------------------------------------------ |
| `FiberMap.make/run/remove` | `Map<string, Fiber>` + manual lifecycle          |
| `FiberSet.make/run`        | `Set<Fiber>` + cleanup for anonymous tasks       |
| `FiberHandle.make/run`     | `let fiber: Fiber \| null` + replacement logic   |
| `Effect.acquireRelease`    | `try/finally` for resource cleanup               |
| `Effect.addFinalizer`      | Scope-bound cleanup registration                 |
| `Mailbox`                  | Bounded async fiber communication                |
| `Effect.serviceOption`     | Optional dependency injection (returns `Option`) |
| `Semaphore.withPermits(n)` | Manual concurrency limiting                      |
| `Pool.make/makeWithTTL`    | Connection pool with auto-sizing                 |

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

| [OPERATOR]             | [SEMANTICS]                                   |
| ---------------------- | --------------------------------------------- |
| `intersect(a, b)`      | Both must continue; takes longer delay        |
| `union(a, b)`          | Either can continue; takes shorter delay      |
| `andThen(a, b)`        | Run first schedule, then second sequentially  |
| `compose(a, b)`        | First output feeds second input               |
| `whileInput(pred)`     | Continue while input satisfies predicate      |
| `upTo(duration)`       | Cap total elapsed time                        |
| `tapOutput(f)`         | Side-effect on each schedule output (metrics) |
| `resetAfter(duration)` | Reset state after idle period                 |

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

| [PATTERN]                       | [API]                                                  |
| ------------------------------- | ------------------------------------------------------ |
| Heartbeat + data interleaving   | `Stream.merge` with halt strategy                      |
| Fan-out to multiple consumers   | `Stream.broadcast`                                     |
| Partitioned parallel processing | `Stream.groupByKey`                                    |
| External source ingestion       | `Stream.fromReadableStream` / `fromAsyncIterable`      |
| Backpressure control            | `Stream.buffer({ capacity: 16, strategy: 'sliding' })` |
| Time-windowed batching          | `Stream.groupedWithin(100, '5 seconds')`               |
| Debounced processing            | `Stream.debounce('300 millis')`                        |
| Text line processing            | `Stream.splitLines` / `Stream.decodeText`              |

[CRITICAL]:
- [NEVER] Eager `Array<Effect>` for unbounded data -- use `Stream`.
- [NEVER] RxJS or EventEmitter for server-side reactive -- use `PubSub` + `Stream`.

---
## [6][EFFECT_UTILITIES]
>**Dictum:** *Know the one-liner. Effect's utility belt prevents hand-rolling.*

<br>

| [API]                            | [REPLACES]                                    |
| -------------------------------- | --------------------------------------------- |
| `Effect.cached`                  | Manual memoization with closure variable      |
| `Effect.cachedWithTTL`           | Timed cache invalidation                      |
| `Effect.once`                    | At-most-one execution guard                   |
| `Effect.partition`               | `[failures, successes]` without short-circuit |
| `Effect.iterate`                 | Recursive computation (replaces `while`)      |
| `Effect.serviceOption`           | Optional dependency (returns `Option`)        |
| `Effect.annotateCurrentSpan`     | Add attributes to active tracing span         |
| `Effect.withSpan`                | Wrap effect in named span                     |
| `Effect.timeoutFail`             | Fail with typed error on timeout              |
| `Queue.bounded/sliding/dropping` | Back-pressure async queue                     |
| `Deferred`                       | One-shot synchronization primitive            |
| `Semaphore`                      | Permit-based concurrency control              |
| `Latch`                          | Gate synchronization (open/close/await)       |
| `SubscriptionRef`                | Ref with reactive `changes` stream            |
| `SynchronizedRef`                | Ref with effectful `updateEffect`             |

[REFERENCE] Consolidation patterns: [->consolidation.md](./consolidation.md).
