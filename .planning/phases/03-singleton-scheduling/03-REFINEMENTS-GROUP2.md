# Refinements - Effect APIs Group 2
**APIs**: Effect (CRITICAL), Equal, Equivalence, ExecutionPlan, ExecutionStrategy, Exit, Fiber, FiberMap, FiberStatus

## HIGH Priority

- [Line 161-165] Current: Manual Effect.catchTag chain | Use: Effect.catchTags | Reason: Single catchTags call handles multiple tagged errors without chaining
- [Line 204-207] Current: Effect.flatMap + orElseSucceed | Use: Effect.andThen | Reason: andThen auto-unwraps mixed types (Effect, value) reducing nesting
- [Line 408-419] Current: Effect.race with manual polling loop | Use: Effect.raceFirst + Effect.when | Reason: raceFirst cleaner for shutdown; when wraps conditional execution
- [Line 522-526] Current: Effect.exit + Exit.match separate | Use: Effect.matchCauseEffect | Reason: Direct cause-based matching without explicit exit capture
- [Line 527-530] Current: Exit.match for success/failure | Use: Effect.match | Reason: Effect.match handles success/failure directly without Exit conversion
- [Line 797-810] Current: Ternary for binary state check | Use: Effect.if | Reason: Effect.if provides effectful if-then-else expression natively

## MEDIUM Priority

- [Line 186-221] Current: Anonymous Effect.gen function | Use: Effect.fn('CoordinatorSingleton') | Reason: Named function with automatic tracing span
- [Line 235-254] Current: Anonymous makeCron function body | Use: Effect.fn('CronExecutor') | Reason: Tracing spans for cron execution lifecycle
- [Line 268-299] Current: Anonymous entity handler | Use: Effect.fn('EntityProcess') | Reason: Named spans for entity processing traces
- [Line 316-328] Current: Manual Array.map + Effect.all | Use: Effect.forEach with concurrency option | Reason: forEach with { concurrency: 'unbounded' } cleaner than map+all
- [Line 331-341] Current: Effect.all for cluster health | Use: Effect.all with ExecutionStrategy.parallel | Reason: Explicit parallelism control via ExecutionStrategy
- [Line 412-418] Current: Effect.repeat + filterOrFail | Use: Effect.repeatWhile | Reason: repeatWhile cleaner for condition-based repetition
- [Line 564] Current: Match.value for version check | Use: Equal.equals + Effect.if | Reason: Equal.equals for type-safe equality, Effect.if for branching

## LOW Priority

- [Line 289-293] Current: Match.value for recipient dispatch | Use: Match.type on discriminated union | Reason: Match.type exhaustive when payload has _tag field
- [Line 312-313] Current: Inline staleness check function | Use: Equivalence.number for comparison | Reason: Explicit equivalence relation for numeric comparison
- [Line 319] Current: Metric.value type annotation | Use: Type inference | Reason: Remove explicit MetricState.Gauge annotation; Effect infers correctly
- [Line 486-498] Current: Inline modify callback | Use: Effect.tap + Effect.flatMap | Reason: Clearer read-modify-write flow with tap logging
- [Line 539-543] Current: Manual checkpoint progress | Use: Fiber.status check | Reason: FiberStatus.isRunning for checkpoint validation
- [Line 571-575] Current: store.set for migration persistence | Use: Effect.tap | Reason: Clearer side-effect intent with tap

## New Patterns to Add

- FiberMap for singleton fiber tracking | API: FiberMap.make + FiberMap.run | Why: Automatic fiber cleanup on scope close; replaces manual Ref-based tracking
- Fiber.scoped for leader election | API: Fiber.scoped | Why: Converts fiber to scoped effect with automatic interruption on scope close
- Effect.annotateCurrentSpan for state changes | API: Effect.annotateCurrentSpan | Why: Adds singleton state to active trace span for debugging
- Effect.withSpan around KeyValueStore ops | API: Effect.withSpan | Why: Explicit spans for state persistence latency tracking
- ExecutionStrategy.parallelN for bounded health checks | API: ExecutionStrategy.parallelN(5) | Why: Limits concurrent health probes to avoid resource exhaustion
- Effect.validate for multi-error aggregation | API: Effect.validate | Why: Collects all validation errors instead of failing fast
- Exit.isInterrupted for shutdown detection | API: Exit.isInterrupted | Why: Distinguishes graceful shutdown from failure in logging
- Equal.isEqual for state change detection | API: Equal.isEqual + Equal.symbol | Why: Custom equality for singleton state diff logging
- Effect.filterOrFail with tagged error | API: Effect.filterOrFail | Why: Converts predicate failure to SingletonError directly
- Effect.whenFiberRef for leader-only execution | API: Effect.whenFiberRef | Why: Conditional execution based on isLeader FiberRef
