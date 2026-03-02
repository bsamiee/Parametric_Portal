---
paths: ["**/*.ts", "**/*.tsx"]
---

# Effect Ecosystem Leverage

## Data Structures

`Data.struct`, `Data.tuple`, `Data.tagged`, `Data.TaggedEnum` for structural equality — never manual `equals`/`hashCode`. `HashMap`, `HashSet`, `SortedSet`, `Chunk` over native JS collections when structural equality or efficient concatenation matters. `Chunk` for high-throughput append/prepend sequences.

## Pattern Matching & Dispatch

`Match.type`, `Match.value`, `Match.tag` with `Match.exhaustive` for compile-time exhaustiveness. `Match.discriminator` for custom discriminant fields. `Match.whenAnd`, `Match.whenOr` for composite conditions.

## Collections

`Array.groupBy`, `Array.partition`, `Array.filterMap`, `Array.deduplicateWith` — not native `.filter().map()` chains. `Record.map`, `Record.filter`, `Record.union`, `Record.intersection` for object manipulation. `Array.Do`/`Array.bind` for comprehension notation over arrays.

## Primitives & Combinators

`Option.map`, `Option.flatMap`, `Option.getOrElse` — never null checks. `Either.map`, `Either.flatMap` — never try/catch. `Predicate.and`, `Predicate.or`, `Predicate.not` for composable guards. `Order.combine`, `Order.mapInput` for composed sorting. `Equivalence.struct` for object comparison. `Duration.millis`, `Duration.seconds` — never raw number arithmetic for time.

## Composition

`pipe()` for linear transforms. `Effect.all` for independent aggregation. `Effect.fn('name')` for traced functions. `Context.Tag` + `Layer` for DI. `Effect.race` for competitive execution. `Effect.timeout` for deadlines. `Effect.Do`/`Effect.bind`/`Effect.let` for 2-3 linear bindings — flat compositional pipelines. `Effect.gen` for 3+ dependent ops with branching — reserve for complex control flow.

## Concurrency

`FiberSet`/`FiberMap` for managed concurrent fiber collections with automatic cleanup on scope close. `Effect.forkScoped` for scope-bound fibers. `ScopedRef` for mutable references that respect resource lifecycle. `Cache` for thread-safe memoization with TTL. `Request.TaggedClass` + `RequestResolver.makeBatched` for automatic batching and deduplication. `SqlResolver.grouped` (returns Map, unordered) for independent lookups; `SqlResolver.ordered` (returns positional array) when input ordering is semantically required. Never hand-roll a DataLoader.

## Configuration & Resources

`Config.string`, `Config.number`, `Config.boolean`, `Config.secret`, `Config.array` — never `process.env` access. `Config.secret` wraps values in a `Secret` opaque container that redacts on `.toString()` — secrets cannot leak through Logger pipelines. `Config.nested('prefix')` for namespaced config groups. `Config.withDefault` for fallback values. `Pool.make({ acquire, size })` for fixed-size connection pooling (pre-allocates all connections at scope creation — correct behind pgBouncer or upstream connection managers). `Pool.make({ acquire, min, max })` for elastic pooling (creates on demand — correct for HTTP pools without upstream proxy).

## Streaming & Scheduling

`Stream.groupedWithin` for microbatch. `Schedule.exponential`, `Schedule.spaced`, `Schedule.union` for retry/repeat. `Effect.acquireRelease` for resource lifecycle. `Stream.scan`, `Stream.zipWithPrevious` for stateful windowing.

## Schema

`Schema.Struct` for data shapes. `Schema.Class` for opaque types with Hash/Equal. `Schema.transform` for codec boundaries. Derive — never duplicate shapes. Branded domain primitives: see type-discipline.md §Schema at Boundaries.

## Constraint

Never mix `async/await` with Effect — `Effect.promise` for interop. Never wrap pure `A -> B` in Effect — Effect orchestrates IO/errors/deps/concurrency, domain logic stays pure.
