# Refinements - Effect APIs Group 1
**APIs**: Array, BigDecimal, Boolean, Chunk, Clock, Config, Context, Cron, Data, DateTime, Differ, Duration

## HIGH Priority

- [Line 312-313] Current: `Date.now() - lastExec < Duration.toMillis(interval) * 2` | Use: `Clock.currentTimeMillis` | Reason: Effect-native time access; testable via Clock layer mocking; avoids impure Date.now()
- [Line 318-328] Current: `pipe(config, A.map(...), Effect.all, Effect.map(...))` | Use: `Array.map` + `Array.every` | Reason: Already using Array.map but `A.every(results, (r) => r.healthy)` should use curried `Array.every((r) => r.healthy)(results)`
- [Line 564] Current: `Match.value('version' in raw)` checking boolean | Use: `Boolean.match` | Reason: Direct boolean pattern match; cleaner than Match.value for binary conditions
- [Line 720-728] Current: `Date.now()` for heartbeat timestamp | Use: `Clock.currentTimeMillis` | Reason: Consistent effectful time access; enables time-travel testing
- [Line 238-241] Current: Schedule chain with ternary delay | Use: `Duration.zero` constant directly | Reason: Already used but ensure import from Duration module not inline literal
- [Line 147-151] Current: `Match.value(e.reason).pipe(...)` for error classification | Use: `Data.TaggedEnum.$match` | Reason: If SingletonError variants become tagged enum, built-in $match provides exhaustive matching

## MEDIUM Priority

- [Line 309] Current: `import { Array as A, Boolean as B, ... }` | Use: Consistent aliasing | Reason: Standardize on `A` for Array, `B` for Boolean across all patterns
- [Line 244] Current: `Cron.unsafeParse(cronExpr)` | Use: `Cron.parse` + `Either.getOrThrowWith` for dynamic strings | Reason: Better error messages; unsafeParse appropriate only for compile-time constants
- [Line 365] Current: `DateTime.formatIso(Snowflake.dateTime(sf))` | Use: `DateTime.formatIsoZoned` or `DateTime.formatIsoOffset` | Reason: More explicit about timezone handling in formatted output
- [Line 557-558] Current: Separate StateV1, StateV2 schema versions | Use: `Data.TaggedClass` with version discriminator | Reason: Built-in structural equality; cleaner migration via $match
- [Line 119-122] Current: `Duration.toMillis(Duration.seconds(60))` | Use: `Duration.toMillis("60 seconds")` | Reason: Duration.decode accepts string input directly
- [Line 728] Current: `Duration.times(expectedInterval, 2)` | Use: Verify times signature | Reason: Confirm curried form `Duration.times(2)(expectedInterval)` for pipeable use
- [Line 468-470] Current: SQL query result mapping | Use: `Array.head` | Reason: Already used; ensure Option.flatMap chain follows Array.head pattern
- [Line 135-156] Current: SingletonError as Schema.TaggedError | Use: `Data.TaggedError` | Reason: When errors don't cross serialization boundaries, Data.TaggedError is lighter weight

## LOW Priority

- [Line 322-327] Current: `B.match(state.value > 0, { onTrue: ..., onFalse: ... })` | Use: Already correct | Reason: Confirm Boolean.match usage; documentation mentions `onTrue`/`onFalse` callbacks
- [Line 113-114] Current: `Duration.seconds(30)` for heartbeatInterval | Use: `Config.duration("HEARTBEAT_INTERVAL")` | Reason: Externalize to environment config for runtime tuning
- [Line 120] Current: `threshold: 2` hardcoded | Use: `Config.integer("HEALTH_THRESHOLD")` | Reason: Allow runtime configuration of staleness multiplier
- [Line 369-370] Current: `shardId.toString()` / `ShardId.fromString(str)` | Use: Already correct | Reason: Built-in serialization; no hand-rolling needed
- [Line 486] Current: SQL modify function | Use: `Differ.update` concept | Reason: For complex state tracking, Differ could track changes to singleton state for audit logging
- [Line 361-366] Current: Snowflake decomposition logging | Use: `DateTime.toParts(Snowflake.dateTime(sf))` | Reason: Get structured parts (year, month, day, etc.) for richer logging

## New Patterns to Add

- Clock layer mocking for tests | API: `Clock.currentTimeMillis` + custom Clock layer | Why: Enables deterministic time-based tests without Date.now() pollution
- Config.all for cluster settings | API: `Config.all({ health: Config.nested("health")(healthConfig), state: Config.nested("state")(stateConfig) })` | Why: Type-safe config composition with nesting
- Cron.sequence for schedule preview | API: `Cron.sequence(cron, startFrom)` | Why: Generate upcoming execution times for debugging/monitoring UI
- Cron.match for manual trigger validation | API: `Cron.match(cron, DateTime.now)` | Why: Validate if manual trigger aligns with expected schedule
- Data.TaggedEnum for entity states | API: `Data.taggedEnum<EntityState>()` with $is and $match | Why: Replaces manual Match.value patterns; built-in exhaustive checking
- DateTime.startOf/endOf for time bucketing | API: `DateTime.startOf(dt, "hour")` | Why: Clean time aggregation for metrics windows
- DateTime.distance for staleness calculation | API: `DateTime.distanceDuration(now, lastExec)` | Why: Returns Duration directly; cleaner than Date.now() arithmetic
- Duration.format for human-readable logs | API: `Duration.format(elapsed)` | Why: Better log readability ("2h 30m" vs "9000000")
- Duration.parts for structured breakdown | API: `Duration.parts(totalDuration)` | Why: Get hours/minutes/seconds components for detailed metrics
- Context.pick for service subset | API: `Context.pick(ctx, Tag1, Tag2)` | Why: Create minimal context for testing; reduce dependency surface
- Array.groupBy for metric aggregation | API: `Array.groupBy(metrics, (m) => m.name)` | Why: Group health check results by singleton name
- Array.partition for healthy/unhealthy split | API: `Array.partition(results, (r) => r.healthy)` | Why: Separate passing from failing checks in single pass
