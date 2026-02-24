# [H1][ALGORITHMS]
>**Dictum:** *One polymorphic scheme replaces N bespoke loops -- unfold generates, Order sorts, Hash indexes, Sink consumes.*

Algorithmic building blocks for pure data transformation using Effect's immutable collections and composition primitives. All snippets assume `import { Effect, Stream, Chunk, Sink, HashMap, HashSet, SortedMap, Option, Data, Order, Equivalence, Array as A, pipe } from "effect"`.

Cross-references: `effects.md [2]` (pipe/flow) -- `concurrency.md [1]` (STM/TMap service patterns) -- `composition.md [5]` (Stream terminal in Layer) -- `performance.md [3]` (structural sharing costs).

---
## [1][UNFOLD_AND_GENERATION]
>**Dictum:** *Unfold is the dual of fold -- a coalgebra builds structure from a seed; termination is Option.none.*

`Stream.unfold` generates lazy sequences from a seed without materializing. `Stream.unfoldChunk` emits batches per step. `Stream.unfoldEffect` enables effectful seed expansion. `Stream.paginateEffect` specializes unfold with cursor-based termination. `Effect.unfold` produces an eager `Array` from a seed -- use for bounded generation outside Stream context.

```typescript
// --- [GENERATION] ------------------------------------------------------------
const fibonacci = Stream.unfold(
    [0, 1] as const,
    ([a, b]) => Option.some([a, [b, a + b] as const] as const),
)
// BFS tree traversal -- unfoldChunk emits full frontier per step
type TreeNode = { readonly id: string; readonly children: ReadonlyArray<TreeNode> }
const bfs = (root: TreeNode): Stream.Stream<TreeNode> =>
    Stream.unfoldChunk(Chunk.make(root), (frontier) =>
        Chunk.isEmpty(frontier)
            ? Option.none()
            : Option.some([
                frontier,
                Chunk.flatMap(frontier, (node) =>
                    Chunk.fromIterable(node.children)),
            ] as const),
    )
// Paginated fetch -- unfold with effectful seed + termination
const paginate = <A>(
    fetch: (cursor: number) => Effect.Effect<ReadonlyArray<A>>,
): Stream.Stream<A> =>
    Stream.paginateEffect(0, (cursor) =>
        pipe(
            fetch(cursor),
            Effect.map((rows) => [
                rows,
                rows.length >= 100
                    ? Option.some(cursor + rows.length)
                    : Option.none(),
            ] as const),
        ),
    ).pipe(Stream.flattenIterables)
// Effect.unfold -- bounded eager generation (not Stream)
const powers = Effect.unfold(1, (n) =>
    n > 1024 ? Option.none() : Option.some([n, n * 2] as const),
)
```

---
## [2][HASH_EQUAL_AND_COLLECTION_ALGEBRA]
>**Dictum:** *Hash + Equal protocols govern all keyed collections -- Data.* derives both; HashMap/HashSet compose set algebra.*

`Data.struct` / `Data.TaggedClass` / `S.Class` auto-derive Hash + Equal. Native `===` is referential -- `HashMap`/`HashSet` require structural equality. `HashMap.modifyAt` is the atomic upsert via `Option<V> => Option<V>`. `HashSet.union` / `intersection` / `difference` encode set algebra. `HashMap.keySet` bridges map to set.

```typescript
// --- [HASH_EQUAL] ------------------------------------------------------------
class EntityId extends Data.TaggedClass('EntityId')<{
    readonly namespace: string
    readonly id: string
}> {}
// HashMap with structural keys -- Data.TaggedClass gives Hash+Equal
const registry = pipe(
    HashMap.empty<EntityId, number>(),
    HashMap.set(new EntityId({ namespace: 'user', id: 'u1' }), 100),
    HashMap.set(new EntityId({ namespace: 'user', id: 'u2' }), 200),
)
HashMap.get(registry, new EntityId({ namespace: 'user', id: 'u1' })) // Option.some(100)

// --- [HASHMAP_ALGEBRA] -------------------------------------------------------
// modifyAt -- canonical upsert: insert if absent, update if present
const upsert = <K, V>(
    map: HashMap.HashMap<K, V>, key: K, value: V,
    combine: (existing: V, incoming: V) => V,
): HashMap.HashMap<K, V> =>
    HashMap.modifyAt(map, key, Option.match({
        onNone: () => Option.some(value),
        onSome: (existing) => Option.some(combine(existing, value)),
    }))
// HashMap.union (right-biased), filter, map compose without intermediates
const active = pipe(
    HashMap.union(registry, HashMap.make(
        [new EntityId({ namespace: 'user', id: 'u3' }), 300],
    )),
    HashMap.filter((score) => score > 150),
    HashMap.map((score) => score * 2),
)

// --- [HASHSET_ALGEBRA] -------------------------------------------------------
const admins = HashSet.make('alice', 'bob', 'carol')
const banned = HashSet.make('bob', 'dave')
const allowed = HashSet.difference(admins, banned) // {alice, carol}
const known = HashSet.union(admins, banned) // {alice, bob, carol, dave}
const overlap = HashSet.intersection(admins, banned) // {bob}
const registeredIds = HashMap.keySet(registry) // bridge map keys to HashSet
```

---
## [3][ORDER_AND_EQUIVALENCE]
>**Dictum:** *Order is a composable algebra -- mapInput projects, combine layers, reverse inverts; Equivalence governs dedup.*

`Order.mapInput` projects a comparator onto a field. `Order.combine` layers sort keys (primary, secondary). `Order.reverse` flips direction. `Order.all` combines N orders. `Equivalence.mapInput` projects equality onto a field for dedup.

```typescript
// --- [ORDER_ALGEBRA] ---------------------------------------------------------
type Entry = { readonly name: string; readonly score: number; readonly dept: string }
// Multi-key sort: dept ASC, then score DESC
const byDeptThenScore: Order.Order<Entry> = Order.combine(
    Order.mapInput(Order.string, (entry: Entry) => entry.dept),
    pipe(Order.number, Order.reverse, Order.mapInput((entry: Entry) => entry.score)),
)
// Array.sortBy composes multiple Order instances
const sorted = pipe(
    [{ name: 'Alice', score: 90, dept: 'eng' },
     { name: 'Bob',   score: 95, dept: 'eng' },
     { name: 'Carol', score: 80, dept: 'sales' }] as const,
    A.sortBy(
        Order.mapInput(Order.string, (e: Entry) => e.dept),
        pipe(Order.number, Order.reverse, Order.mapInput((e: Entry) => e.score)),
    ),
) // eng:Bob(95), eng:Alice(90), sales:Carol(80)
// Chunk.sort takes Order<A> -- NOT a raw comparator
const topChunk = pipe(
    Chunk.make({ id: 'a', score: 30 }, { id: 'b', score: 90 }, { id: 'c', score: 60 }),
    Chunk.sort(pipe(Order.number, Order.reverse, Order.mapInput((r) => r.score))),
)
// --- [EQUIVALENCE] -----------------------------------------------------------
const byCompositeKey = Equivalence.mapInput(
    Equivalence.string,
    (entry: Entry) => `${entry.dept}:${entry.name}`,
)
const deduped = A.dedupeWith([
    { name: 'Alice', score: 90, dept: 'eng' },
    { name: 'Alice', score: 95, dept: 'eng' },
] as Array<Entry>, byCompositeKey) // keeps first Alice
```

---
## [4][CHUNK_ALGORITHMS]
>**Dictum:** *Chunk is the dense immutable carrier -- partition, dedupe, set ops, and batching without materializing intermediates.*

`Chunk.partition` splits by predicate (tuple). `Chunk.dedupe` uses structural Equal; `Chunk.dedupeWith` takes custom Equivalence. `Chunk.intersection` / `Chunk.difference` are sequence-level set operations. `Chunk.chunksOf` batches into fixed-size groups.

```typescript
// --- [CHUNK_OPS] -------------------------------------------------------------
type Metric = { readonly source: string; readonly value: number }
// partition -- single-pass split into [falsy, truthy]
const [low, high] = Chunk.partition(
    Chunk.make({ source: 'a', value: 10 }, { source: 'b', value: 90 }, { source: 'c', value: 5 }),
    (metric: Metric) => metric.value > 50,
)
// dedupe -- structural equality via Equal protocol
const unique = pipe(
    Chunk.make(Data.struct({ id: 1 }), Data.struct({ id: 1 }), Data.struct({ id: 2 })),
    Chunk.dedupe,
) // Chunk(Data.struct({id:1}), Data.struct({id:2}))
// dedupeWith -- custom equivalence
const uniqueBySource = Chunk.dedupeWith(
    Chunk.make({ source: 'a', value: 10 }, { source: 'a', value: 20 }, { source: 'b', value: 30 }),
    (a: Metric, b: Metric) => a.source === b.source,
)
// set operations on sequences
const left = Chunk.make(1, 2, 3, 4)
const right = Chunk.make(3, 4, 5, 6)
const common = Chunk.intersection(left, right) // Chunk(3, 4)
const onlyLeft = Chunk.difference(left, right) // Chunk(1, 2)
// chunksOf -- fixed-size batching
const batches = pipe(Chunk.fromIterable(A.range(1, 100)), Chunk.chunksOf(25))
// Reduce into HashMap -- single-pass aggregation
const aggregate = Chunk.reduce(
    Chunk.make({ source: 'a', value: 10 }, { source: 'a', value: 20 }, { source: 'b', value: 5 }),
    HashMap.empty<string, number>(),
    (acc, metric: Metric) => upsert(acc, metric.source, metric.value, (a, b) => a + b),
)
```

---
## [5][ARRAY_COMBINATORS]
>**Dictum:** *Array module replaces imperative loops with curried, pipe-friendly transforms -- groupBy, partitionMap, and match have no native equivalents.*

```typescript
// --- [ARRAY_MODULE] ----------------------------------------------------------
import { Either } from 'effect'
type Result = { readonly ok: boolean; readonly value: string; readonly error?: string }
// groupBy -- Record<string, NonEmptyArray<A>>
const byDept = A.groupBy(
    [{ name: 'Alice', dept: 'eng' }, { name: 'Bob', dept: 'sales' }, { name: 'Carol', dept: 'eng' }],
    (user) => user.dept,
) // { eng: [Alice, Carol], sales: [Bob] }
// partitionMap -- single-pass split via Either
const [errors, values] = A.partitionMap(
    [{ ok: true, value: 'a' }, { ok: false, value: '', error: 'fail' }] as Array<Result>,
    (result) => result.ok
        ? Either.right(result.value)
        : Either.left(result.error ?? 'unknown'),
)
// match -- exhaustive empty/non-empty handling
const summary = A.match(values, {
    onEmpty: () => 'no results',
    onNonEmpty: (items) => `${A.headNonEmpty(items)} +${items.length - 1} more`,
})
// Set algebra on arrays
const merged = pipe(
    A.intersection(['a', 'b', 'c'], ['b', 'c', 'd']),
    A.union(['e']),
    A.difference(['b']),
) // ['c', 'e']
// chunksOf -- fixed-size batch for parallel dispatch
const batched = pipe(
    A.range(1, 200),
    A.chunksOf(50),
    A.map((batch) => Effect.succeed(batch.length)),
)
```

---
## [6][SINK_COMPOSITION]
>**Dictum:** *Sinks form a composition algebra -- zip combines, race selects, dimap transforms, foldWeighted budgets.*

`Sink.zip` combines two sinks sequentially (tuple result). `Sink.race` runs two sinks concurrently -- first to complete wins. `Sink.dimap` contramaps input and maps output. `Sink.foldWeighted` accumulates with cost budget. `Sink.collectAllToMap` groups by key with merge. `Stream.aggregateWithin` pairs Sink with Schedule for time-bounded aggregation.

```typescript
// --- [SINK_ALGEBRA] ----------------------------------------------------------
type Event = { readonly topic: string; readonly size: number; readonly payload: unknown }
// foldWeighted -- cost-budget batching (byte-aware, priority-aware)
const byteBudgetSink = Sink.foldWeighted({
    initial: Chunk.empty<Event>(),
    maxCost: 65536,
    cost: (_acc, event: Event) => event.size,
    body: (acc, event: Event) => Chunk.append(acc, event),
})
// collectAllToMap -- in-stream group-by with merge semantics
const countByTopic = Sink.collectAllToMap(
    (event: Event) => event.topic,
    (existing: Event, _incoming) => existing,
)
// zip -- sequential composition, tuple result
const statsAndGroups = Sink.zip(
    Sink.foldLeft(0, (count: number, _event: Event) => count + 1),
    countByTopic,
) // Sink<[number, HashMap<string, Event>]>
// race -- first-to-complete wins (e.g., size-limit vs count-limit)
const firstComplete = Sink.race(
    Sink.foldUntil(Chunk.empty<Event>(), 1000,
        (acc, event: Event) => Chunk.append(acc, event)),
    Sink.collectAllWhile((event: Event) => event.size < 4096),
)
// dimap -- contravariant input + covariant output
const scoreSink = pipe(
    Sink.foldLeft(0, (sum: number, value: number) => sum + value),
    Sink.dimap({
        onInput: (event: Event) => event.size,
        onDone: (total) => ({ totalBytes: total }),
    }),
)
// aggregateWithin -- canonical microbatch: Sink + Schedule
const microbatch = (source: Stream.Stream<Event>): Effect.Effect<void> =>
    pipe(
        source,
        Stream.aggregateWithin(byteBudgetSink, Schedule.spaced('5 seconds')),
        Stream.runForEach((batch) =>
            Effect.log(`flushed ${Chunk.size(batch)} events`)),
    )
```

---
## [7][SORTED_MAP]
>**Dictum:** *SortedMap maintains Order invariant -- O(log n) insert, ordered iteration, headOption/lastOption for min/max.*

```typescript
// --- [SORTED_MAP] ------------------------------------------------------------
// Leaderboard -- always iterates by score descending
const leaderboard = pipe(
    SortedMap.empty<number, string>(Order.reverse(Order.number)),
    SortedMap.set(100, 'Alice'),
    SortedMap.set(250, 'Bob'),
    SortedMap.set(175, 'Carol'),
)
SortedMap.headOption(leaderboard) // Option.some([250, "Bob"]) -- max
SortedMap.lastOption(leaderboard) // Option.some([100, "Alice"]) -- min

// Time-series with ordered reduction
const timeline = SortedMap.fromIterable(
    [
        [1000, { severity: 'info', msg: 'start' }],
        [2000, { severity: 'critical', msg: 'alert' }],
        [3000, { severity: 'info', msg: 'end' }],
    ] as const,
    Order.number,
)
const critical = SortedMap.reduce(
    timeline,
    Chunk.empty<string>(),
    (acc, event, _ts) =>
        event.severity === 'critical' ? Chunk.append(acc, event.msg) : acc,
)
```

---
## [8][RULES]

- [ALWAYS] `Stream.unfold` / `Stream.unfoldChunk` for lazy seed-based generation -- never hand-roll recursive emitters.
- [ALWAYS] `Stream.paginateEffect` for cursor-based data loading with automatic termination.
- [ALWAYS] `Data.struct` / `Data.TaggedClass` / `S.Class` to derive Hash + Equal for HashMap/HashSet keys.
- [ALWAYS] `HashMap.modifyAt` with `Option.match` for upsert -- define once, reference everywhere.
- [ALWAYS] `Order.mapInput` + `Order.combine` for composite sorting -- never raw comparator functions.
- [ALWAYS] `Chunk.sort(order)` with `Order<A>` -- not `(a, b) => number`.
- [ALWAYS] `Chunk.partition` over manual filter+filter-negate -- single pass, tuple result.
- [ALWAYS] `Chunk.dedupe` for structural dedup; `Chunk.dedupeWith` when custom equivalence needed.
- [ALWAYS] `A.groupBy` / `A.partitionMap` / `A.match` -- no native equivalents; eliminates loops.
- [ALWAYS] `Sink.foldWeighted` for cost-budget batching; `Sink.collectAllToMap` for in-stream group-by.
- [ALWAYS] `Stream.aggregateWithin(sink, schedule)` for time-bounded microbatch aggregation.
- [ALWAYS] `SortedMap` when ordered iteration or min/max access is required -- not HashMap.
- [NEVER] Raw comparator `(a, b) => number` where `Order` algebra composes -- Order is first-class.
- [NEVER] `Chunk` for general-purpose collections outside Stream context -- use `ReadonlyArray`.
- [NEVER] Repeated inline upsert patterns -- extract a single polymorphic `upsert` combinator.
- [NEVER] `A.sort` with ad-hoc comparator -- use `A.sortBy` with `Order.mapInput` composition.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [PATTERN]              | [API]                                       | [WHEN]                               |
| :-----: | ---------------------- | ------------------------------------------- | ------------------------------------ |
|   [1]   | Lazy unfold            | `Stream.unfold(seed, coalgebra)`            | Infinite/bounded sequence generation |
|   [2]   | Batch unfold           | `Stream.unfoldChunk(seed, coalgebra)`       | Tree traversal, frontier expansion   |
|   [3]   | Effectful unfold       | `Stream.unfoldEffect(seed, coalgebra)`      | IO per seed step                     |
|   [4]   | Paginated fetch        | `Stream.paginateEffect(seed, fetch)`        | Cursor-based data loading            |
|   [5]   | Eager unfold           | `Effect.unfold(seed, coalgebra)`            | Bounded generation outside Stream    |
|   [6]   | Structural upsert      | `HashMap.modifyAt(map, key, Option.match)`  | Insert-or-update with merge          |
|   [7]   | Set algebra (Hash)     | `HashSet.union / intersection / difference` | Membership, filtering, diffing       |
|   [8]   | Composite sort         | `Order.combine(mapInput, reverse)`          | Multi-key sorting                    |
|   [9]   | Sequence dedup         | `Chunk.dedupe / dedupeWith`                 | Structural or custom equivalence     |
|  [10]   | Sequence set ops       | `Chunk.intersection / difference`           | Dense collection algebra             |
|  [11]   | Fixed batching         | `Chunk.chunksOf(n) / A.chunksOf(n)`         | Partition into fixed groups          |
|  [12]   | Single-pass split      | `Chunk.partition / A.partitionMap`          | Predicate or Either-based separation |
|  [13]   | Key-based grouping     | `A.groupBy(xs, keyFn)`                      | Categorization without loops         |
|  [14]   | Cost-budget sink       | `Sink.foldWeighted({ maxCost, cost, ... })` | Byte/priority-aware batching         |
|  [15]   | Sink composition       | `Sink.zip / race / dimap`                   | Combine, select, or transform sinks  |
|  [16]   | Group-by sink          | `Sink.collectAllToMap(keyFn, merge)`        | In-stream aggregation by key         |
|  [17]   | Time-bounded aggregate | `Stream.aggregateWithin(sink, schedule)`    | Microbatch with flush deadline       |
|  [18]   | Ordered map            | `SortedMap.empty(order)`                    | Min/max access, ordered iteration    |
