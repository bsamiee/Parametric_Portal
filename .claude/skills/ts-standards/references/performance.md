# [H1][PERFORMANCE]
>**Dictum:** *Structural sharing replaces copying; fiber-safe caching collapses N executions to one; bounded concurrency converts backpressure into throughput.*

Chunk amortizes append via tree nodes. HashMap shares all unchanged paths on write. `Effect.cached` memoizes across fibers atomically. `Pool` manages scoped resource lifecycles. Stream backpressure topology determines OOM risk. All patterns target TypeScript 6.0-dev, Effect 3.19, Node.js 22+.

Cross-references: `concurrency.md [2]` (TSemaphore/TReentrantLock full API) -- `algorithms.md [1-4]` (Stream pipelines, Sink composition, groupedWithin) -- `effects.md [3]` (Schedule algebra, retry/repeat) -- `composition.md [1]` (Layer memoization guarantees)

---
## [1][CHUNK_BATCH_PROCESSING]
>**Dictum:** *Chunk is a tree of segments -- append is O(1) amortized; Array.concat is O(n) copy.*

Chunk stores segments as tree nodes -- `Chunk.append`/`Chunk.appendAll` link nodes without copying. `Chunk.make` returns `NonEmptyChunk<A>` -- `Chunk.headNonEmpty` yields `A` directly (no Option). `Chunk.unsafeFromArray` zero-copies when caller owns the array. Batch operations (`chunksOf`, `splitWhere`, `flatMap`, `compact`, `dedupe`) operate on tree representation without materializing intermediate arrays.

```typescript
import { Chunk, Effect, HashMap, Option, pipe } from 'effect';
// --- [AMORTIZED APPEND CHAIN] ------------------------------------------------
type Event = { readonly id: string; readonly score: number; readonly tag: string };
const buildBatch = (events: ReadonlyArray<Event>): Chunk.Chunk<Event> =>
    events.reduce(
        (acc, event) => Chunk.append(acc, event),
        Chunk.empty<Event>(),
    );
// --- [NONEMPTYCHUNK TYPE SAFETY] ---------------------------------------------
const ne = Chunk.make(1, 2, 3);
const first: number = Chunk.headNonEmpty(ne);
// --- [BATCH PROCESSING WITHOUT ARRAY MATERIALIZATION] ------------------------
const aggregateByTag = (
    events: Chunk.Chunk<Event>,
): HashMap.HashMap<string, number> =>
    pipe(
        events,
        Chunk.filter((event) => event.score > 0),
        Chunk.dedupe,
        Chunk.chunksOf(100),
        Chunk.reduce(HashMap.empty<string, number>(), (acc, batch) =>
            Chunk.reduce(batch, acc, (inner, event) =>
                HashMap.modifyAt(inner, event.tag, Option.match({
                    onNone: () => Option.some(event.score),
                    onSome: (total) => Option.some(total + event.score),
                })),
            ),
        ),
    );
// --- [ZERO-COPY BRIDGE] -----------------------------------------------------
const trusted = Chunk.unsafeFromArray([1, 2, 3]);
```

Use Chunk inside Stream pipelines, Sink accumulators, and batch aggregation. Use ReadonlyArray outside Stream context.

---
## [2][HASHMAP_VS_NATIVE_MAP]
>**Dictum:** *HAMT gives O(log32 N) writes sharing all unchanged nodes; native Map copies nothing but shares nothing.*

`HashMap` is a Hash Array Mapped Trie -- `HashMap.set` allocates only the root-to-leaf path (~7 nodes for 1B entries). Unchanged subtrees are shared between old and new versions. Native `Map` is mutable -- immutable snapshots require full copy. `HashMap` keys dispatch on `Hash`+`Equal` (structural); native `Map` uses referential `===`.

```typescript
import { Data, HashMap, HashSet, pipe } from 'effect';
// --- [STRUCTURAL SHARING ON WRITE] -------------------------------------------
class UserId extends Data.TaggedClass('UserId')<{ readonly value: string }> {}
const registry = pipe(
    HashMap.empty<UserId, { name: string; score: number }>(),
    HashMap.set(new UserId({ value: 'u1' }), { name: 'Alice', score: 99 }),
    HashMap.set(new UserId({ value: 'u2' }), { name: 'Bob', score: 42 }),
);
const updated = HashMap.set(registry, new UserId({ value: 'u1' }), { name: 'Alicia', score: 99 });
// --- [STRUCTURAL KEY LOOKUP] -------------------------------------------------
// Native Map FAILS: new UserId !== original reference. HashMap: Hash+Equal by value.
HashMap.get(updated, new UserId({ value: 'u1' })); // Option.some({name:'Alicia',...})
// --- [HASHSET -- O(1) MEMBERSHIP] --------------------------------------------
const activeIds = HashSet.fromIterable([new UserId({ value: 'u1' }), new UserId({ value: 'u2' })]);
HashSet.has(activeIds, new UserId({ value: 'u1' })); // true -- HAMT probe
// --- [BATCH MUTATION -- AMORTIZED CONSTRUCTION] ------------------------------
const populated = HashMap.mutate(HashMap.empty<string, number>(), (draft) => {
    HashMap.set(draft, 'a', 1);
    HashMap.set(draft, 'b', 2);
    HashMap.set(draft, 'c', 3);
});
```

Use HashMap/HashSet when: (A) keys need structural equality, (B) immutable snapshots without cloning, (C) collections >100 entries with frequent lookup. Plain objects for static config <50 keys.

---
## [3][EFFECT_CACHED_AND_MEMOIZATION]
>**Dictum:** *cached collapses N fiber executions to one atomic Ref read; cachedWithTTL adds bounded lifetime.*

`Effect.cached` returns `Effect<Effect<A, E>>` -- two-level: outer sets up Ref-backed cache (run once), inner reads memoized value (run N times). `Effect.cachedWithTTL` adds automatic recomputation on expiry -- concurrent callers during refresh share the result.

```typescript
import { Duration, Effect, Ref, pipe } from 'effect';
// --- [EFFECT.CACHED -- FIBER-SAFE MEMOIZATION] ------------------------------
class FeatureFlags extends Effect.Service<FeatureFlags>()(
    'app/FeatureFlags',
    {
        scoped: Effect.gen(function* () {
            const loadFlags = Effect.gen(function* () {
                yield* Effect.logDebug('feature-flags.loading');
                return { darkMode: true, betaSearch: false } as const;
            });
            const reader = yield* Effect.cached(loadFlags);
            const get = Effect.fn('FeatureFlags.get')(function* () {
                return yield* reader;
            });
            return { get } as const;
        }),
    },
) {}
// --- [EFFECT.CACHEDWITHTTL -- BOUNDED-LIFETIME CACHE] -----------------------
const makeTokenCache = Effect.gen(function* () {
    const fetchToken = Effect.tryPromise({
        try: () => fetch('/api/token').then((r) => r.text()),
        catch: (cause) => new TokenError({ cause }),
    });
    const reader = yield* Effect.cachedWithTTL(fetchToken, '5 minutes');
    return { current: reader } as const;
});
// --- [CACHED + REF INVALIDATION] --------------------------------------------
// why: Ref<Effect<A, E>> allows manual cache bust by re-executing outer cached
const makeInvalidatingCache = Effect.gen(function* () {
    const compute = Effect.succeed({ version: Date.now() });
    const cacheRef = yield* Ref.make(yield* Effect.cached(compute));
    const read = pipe(Ref.get(cacheRef), Effect.flatMap((reader) => reader));
    const invalidate = Effect.gen(function* () {
        const freshReader = yield* Effect.cached(compute);
        yield* Ref.set(cacheRef, freshReader);
    });
    return { read, invalidate } as const;
});
```

For TTL-based invalidation, prefer `Effect.cachedWithTTL`. For manual invalidation, wrap the cached reader in a `Ref` and replace on bust.

---
## [4][POOL_LIFECYCLE]
>**Dictum:** *Pool.make manages N resources with scoped acquire/release; Pool.makeWithTTL evicts idle resources beyond min after TTL.*

Both return `Effect<Pool<A, E>, never, Scope>` -- lifecycle tied to ambient Scope. `pool.get` returns `Effect<A, E, Scope>` -- acquired resource auto-releases when inner scope closes. `timeToLiveStrategy: 'creation'` evicts by creation time; `'usage'` (default) by last use.

```typescript
import { Effect, Pool, Data, pipe } from 'effect';
// --- [POOL IN LAYER.SCOPED] -------------------------------------------------
class ConnectionError extends Data.TaggedError('ConnectionError')<{
    readonly cause: unknown;
}> {}
type Connection = { readonly query: (sql: string) => Promise<unknown> };
declare const createConnection: () => Promise<Connection>;
class ConnectionPool extends Effect.Service<ConnectionPool>()(
    'app/ConnectionPool',
    {
        scoped: Effect.gen(function* () {
            const pool = yield* Pool.makeWithTTL({
                acquire: pipe(
                    Effect.tryPromise({
                        try: () => createConnection(),
                        catch: (cause) => new ConnectionError({ cause }),
                    }),
                    Effect.tap(() => Effect.logDebug('connection.acquired')),
                ),
                min: 2,
                max: 20,
                timeToLive: '60 seconds',
            });
            const use = <A, E>(
                operation: (conn: Connection) => Effect.Effect<A, E>,
            ): Effect.Effect<A, E | ConnectionError> =>
                Effect.scoped(Effect.flatMap(pool.get, operation));
            return { use } as const;
        }),
    },
) {}
```

---
## [5][STREAM_BACKPRESSURE_TOPOLOGY]
>**Dictum:** *Bounded buffers propagate slowness upstream; unbounded buffers convert slowness into OOM.*

Stream is pull-based -- downstream controls pace. `Stream.buffer({ capacity, strategy })` decouples producer/consumer speeds. `'suspend'` blocks producer when full. `'sliding'` drops oldest. `'dropping'` drops newest. Unbounded accumulates without limit -- OOM under sustained load.

```typescript
import { Duration, Effect, Stream, pipe } from 'effect';
// --- [BACKPRESSURE TOPOLOGY] ------------------------------------------------
type Metric = { readonly name: string; readonly value: number };
const safePipeline = (source: Stream.Stream<Metric>): Effect.Effect<void> =>
    source.pipe(
        Stream.buffer({ capacity: 256, strategy: 'suspend' }),
        Stream.groupedWithin(100, Duration.seconds(5)),
        Stream.mapEffect((batch) =>
            Effect.logDebug('flush', { count: batch.length }),
        ),
        Stream.runDrain,
    );
// --- [THROUGHPUT vs LATENCY] ------------------------------------------------
const rateLimited = (source: Stream.Stream<Metric>): Stream.Stream<Metric> =>
    source.pipe(
        Stream.throttle({
            cost: () => 1, units: 100,
            duration: Duration.seconds(1), burst: 20, strategy: 'shape',
        }),
    );
```

Topology determines failure mode: `suspend` trades throughput for safety. `sliding`/`dropping` trade data loss for latency. See `algorithms.md [2]` for groupedWithin/debounce/throttle composition.

---
## [6][LAZY_EVALUATION_AND_SUSPEND]
>**Dictum:** *Effect.suspend defers construction until execution -- prevents eager closure capture and enables recursive pipelines.*

Without `Effect.suspend`, recursive Effect references evaluate immediately -- infinite loop at definition time. Also critical for conditional Effect selection where both branches would otherwise be eagerly constructed.

```typescript
import { Effect, pipe } from 'effect';
// --- [RECURSIVE PIPELINE] ---------------------------------------------------
type Tree<A> = { readonly value: A; readonly children: ReadonlyArray<Tree<A>> };
const traverseTree = <A>(
    tree: Tree<A>,
    visit: (value: A) => Effect.Effect<void>,
): Effect.Effect<void> =>
    Effect.suspend(() =>
        Effect.gen(function* () {
            yield* visit(tree.value);
            yield* Effect.forEach(tree.children, (child) =>
                traverseTree(child, visit),
            );
        }),
    );
// --- [DEFERRED CONDITIONAL] -------------------------------------------------
const loadResource = (cached: boolean): Effect.Effect<string> =>
    Effect.suspend(() =>
        cached
            ? Effect.succeed('from-cache')
            : Effect.tryPromise({
                  try: () => fetch('/api/resource').then((r) => r.text()),
                  catch: (cause) => cause,
              }),
    );
```

---
## [7][BOUNDED_FAN_OUT]
>**Dictum:** *Effect.all with concurrency caps active fibers; Semaphore limits shared resource access.*

`Effect.all(effects, { concurrency: N })` -- fiber explosion prevention. Polymorphic: tuples, records, iterables. `Effect.makeSemaphore(N)` -- permit-based throttle; `withPermits(1)` wraps with automatic acquire/release. `{ mode: 'either' }` returns `Either` per element (typed `allSettled`); `{ mode: 'validate' }` collects ALL errors.

```typescript
import { Data, Effect, pipe } from 'effect';
// --- [EFFECT.ALL BOUNDED FAN-OUT] -------------------------------------------
class FetchError extends Data.TaggedError('FetchError')<{
    readonly url: string;
    readonly cause: unknown;
}> {}
const fetchAll = (
    urls: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Response>, FetchError> =>
    Effect.all(
        urls.map((url) =>
            pipe(
                Effect.tryPromise({
                    try: () => fetch(url),
                    catch: (cause) => new FetchError({ url, cause }),
                }),
                Effect.timeout('5 seconds'),
            ),
        ),
        { concurrency: 10 },
    );
// --- [SEMAPHORE -- SHARED RESOURCE THROTTLE] --------------------------------
// Full Semaphore API: concurrency.md [2]
const makeBoundedClient = Effect.gen(function* () {
    const semaphore = yield* Effect.makeSemaphore(5);
    const request = (url: string) =>
        semaphore.withPermits(1)(
            Effect.tryPromise({
                try: () => fetch(url),
                catch: (cause) => new FetchError({ url, cause }),
            }),
        );
    return { request } as const;
});
```

---
## [8][MEASUREMENT]
>**Dictum:** *Effect.timed is the measurement primitive -- instrument before optimizing.*

`Effect.timed` returns `[Duration, A]` -- fiber-safe elapsed time. For production use `Metric.timer`/`Metric.histogram`. For dev/debug, `Effect.timed` + `Effect.logDebug` suffices.

```typescript
import { Duration, Effect, pipe } from 'effect';
// --- [EFFECT.TIMED + LOGDEBUG] ----------------------------------------------
const measured = <A, E, R>(
    label: string,
    effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
        const [elapsed, result] = yield* Effect.timed(effect);
        yield* Effect.logDebug(`perf.${label}`).pipe(
            Effect.annotateLogs({ durationMs: Duration.toMillis(elapsed) }),
        );
        return result;
    });
```

---
## [9][HIDDEN_CLASS_STABILITY]
>**Dictum:** *Property insertion order IS the hidden class -- same order everywhere compiles to native; divergence poisons the inline cache.*

V8 assigns a hidden class per unique property-insertion sequence. Monomorphic IC (one shape) emits direct memory offset loads. 5+ shapes triggers megamorphic deopt. `delete` forces permanent dictionary mode. Explicit `undefined` sentinel for optional fields prevents 2^N hidden class branching.

```typescript
import { Effect } from 'effect';
// --- [MONOMORPHIC FACTORY] ---------------------------------------------------
// Consistent order: { id, ts, kind, meta } -- every site, one shape.
const makeEvent = (
    id: string, ts: number, kind: string, meta: string | undefined,
) => ({ id, ts, kind, meta });
// --- [SHAPE-PRESERVING PROJECTION] ------------------------------------------
const toSummary = (event: ReturnType<typeof makeEvent>) => ({
    id: event.id,
    kind: event.kind,
});
// --- [STATIC FUNCTION REFERENCE -- ZERO CLOSURE PER CALL] -------------------
const parseRow = (raw: { id: string; v: string }) => ({
    id: raw.id,
    value: Number(raw.v),
});
const parseBatch = (rows: ReadonlyArray<{ id: string; v: string }>) =>
    Effect.succeed(rows.map(parseRow));
```

Budget: 1-2 shapes free (monomorphic/dimorphic). 3-4 linear IC probe. 5+ megamorphic.

---
## [10][RULES]
>**Dictum:** *Rules compress into constraints.*

| [INDEX] | [RULE]   | [CONSTRAINT]                                               | [WHY]                                          |
| :-----: | -------- | ---------------------------------------------------------- | ---------------------------------------------- |
|   [1]   | [ALWAYS] | `Chunk` as data carrier inside Stream pipelines            | Amortized O(1) append; avoids Array conversion |
|   [2]   | [ALWAYS] | `Chunk.unsafeFromArray` for trusted arrays entering Stream | Zero-copy wrap                                 |
|   [3]   | [ALWAYS] | `HashMap`/`HashSet` for keyed collections >100 entries     | HAMT structural sharing; O(log32 N) writes     |
|   [4]   | [ALWAYS] | `HashMap.mutate` for batch construction                    | Transient mode; amortized O(1) per insert      |
|   [5]   | [ALWAYS] | `Effect.cached`/`cachedWithTTL` for shared computations    | Atomic Ref memoization; fiber-safe             |
|   [6]   | [ALWAYS] | `Pool.make`/`makeWithTTL` inside `scoped` constructors     | Lifecycle tied to Layer scope                  |
|   [7]   | [ALWAYS] | `Stream.buffer({ strategy: 'suspend' })` as default        | Backpressure prevents OOM                      |
|   [8]   | [ALWAYS] | `Effect.all` with `{ concurrency: N }` for fan-out         | Caps active fibers                             |
|   [9]   | [ALWAYS] | `Effect.suspend` for recursive/deferred construction       | Prevents eager evaluation                      |
|  [10]   | [ALWAYS] | `Effect.timed` + `logDebug` to validate perf claims        | Fiber-safe measurement                         |
|  [11]   | [ALWAYS] | Consistent property insertion order at every site          | V8 hidden class stability                      |
|  [12]   | [ALWAYS] | Explicit `undefined` sentinel for optional fields          | Prevents 2^N hidden class branching            |
|  [13]   | [ALWAYS] | Static module-level function refs on hot paths             | Zero closure allocation per call               |
|  [14]   | [NEVER]  | `delete` on object properties                              | Forces V8 dictionary mode permanently          |
|  [15]   | [NEVER]  | Different property orders for same logical object          | Shatters hidden class                          |
|  [16]   | [NEVER]  | Layer construction inside `Effect.gen`                     | Breaks Layer identity memoization              |
|  [17]   | [NEVER]  | `Stream.buffer({ strategy: 'unbounded' })` in production   | OOM under sustained load                       |
|  [18]   | [NEVER]  | Unbounded `Effect.all` for IO-bound operations             | Fiber explosion                                |
|  [19]   | [NEVER]  | Inline closures on hot paths where static ref suffices     | Closure allocation per call                    |

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                        | [WHEN]                       | [PERF_CHARACTERISTIC]           |
| :-----: | -------------------------------- | ---------------------------- | ------------------------------- |
|   [1]   | `Chunk.appendAll`                | Batch accumulation in Stream | O(1) amortized tree link        |
|   [2]   | `Chunk.chunksOf(n)`              | Fixed-size microbatching     | Zero-copy sub-chunks            |
|   [3]   | `Chunk.unsafeFromArray`          | Trusted array enters Stream  | Zero-copy wrap                  |
|   [4]   | `HashMap.set`                    | Immutable keyed update       | O(log32 N) path copy            |
|   [5]   | `HashMap.mutate`                 | Batch construction           | Transient; O(1) per insert      |
|   [6]   | `HashSet.has`                    | Value-type membership        | HAMT probe; Hash+Equal          |
|   [7]   | `Effect.cached`                  | One-shot shared init         | Atomic Ref; run-once            |
|   [8]   | `Effect.cachedWithTTL`           | Expiring cache               | Auto-recompute on TTL           |
|   [9]   | `Effect.suspend`                 | Recursive/deferred Effect    | Thunk defers to runtime         |
|  [10]   | `Effect.all({ concurrency: N })` | Bounded fan-out              | Caps N active fibers            |
|  [11]   | `Effect.makeSemaphore(N)`        | Resource throttle            | Permit-based; auto release      |
|  [12]   | `Pool.makeWithTTL`               | Elastic pool                 | Scoped; idle eviction           |
|  [13]   | `Stream.buffer({ suspend })`     | Backpressure                 | Producer blocks at capacity     |
|  [14]   | `Stream.throttle`                | Rate limiting                | Shape (delay) or enforce (drop) |
|  [15]   | `Effect.timed`                   | Measurement                  | `[Duration, A]`; fiber-safe     |
