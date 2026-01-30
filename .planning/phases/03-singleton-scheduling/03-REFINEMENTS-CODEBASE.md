# Refinements - Codebase Integration
**Reviewed**: context.ts, cluster.ts, telemetry.ts, metrics.ts, resilience.ts, circuit.ts, jobs.ts, storage.ts, diff.ts, transfer.ts

## Overlooked Infrastructure

- [Line 48] Research uses `Match.value(cfg.retry).pipe(...)` but resilience.ts:42 has complete Schedule dispatch table | Integration: Use `Resilience.schedules` for retry mode lookup
- [Line 312] Boolean.match example lacks import | Source: telemetry.ts:80 uses `Boolean.match(condition, { onFalse, onTrue })` | Integration: Import Boolean from effect
- [Line 483] SQL KeyValueStore size query uses `::int` cast | Source: jobs.ts:55 uses `PgClient` directly | Integration: Use established SqlClient patterns
- [Line 101] Research factory wraps with manual `Metric.trackDuration(hb)` | Source: metrics.ts:200-212 has `MetricsService.trackEffect` | Integration: Use trackEffect for duration+error tracking
- [Line 174] Research uses `sharding.getSnowflake` directly | Source: cluster.ts:201 already has `generateId` accessor | Integration: Use existing ClusterService.generateId

## Style Inconsistencies

- [Line 107] _CONFIG uses nested `health.graceMs` structure | cluster.ts:18-26 uses flat `_CONFIG.cron`, `_CONFIG.entity` pattern | Fix: Use `_CONFIG.singleton = { grace, heartbeatInterval }` not `_CONFIG.health`
- [Line 198] CoordinatorSingletonLive function creates Layer directly | cluster.ts:212 factory returns Layer from Singleton.make().pipe(Layer.provide) | Fix: Match factory return pattern
- [Line 466] SQL KeyValueStore IIFE uses `sql` helper inside | cluster.ts:107-128 _storageLayers IIFE builds Layer.mergeAll | Fix: Follow Layer composition pattern from cluster.ts
- [Line 146] Match.value(e.reason).pipe for isRetryable | cluster.ts:101 uses direct comparison `e.reason === 'MailboxFull'` | Fix: Simple boolean OR for 2 variants
- [Line 235] Pattern 2 uses `Schedule.fixed(...).pipe(Schedule.jittered)` | resilience.ts:29-32 uses `Schedule.exponential().pipe(Schedule.jittered, Schedule.intersect)` | Fix: Match exponential+jittered+intersect pattern

## Duplicate Logic

- [Line 312] `checkStaleness` helper for health threshold | Existing: metrics.ts:17-25 `_boundaries` for SLA-aligned thresholds | Replace with: Use boundary pattern + threshold comparison
- [Line 48] Metric.set for heartbeat gauge | Existing: telemetry.ts:102 uses `MetricsService.trackEffect` | Replace with: Integrate into trackEffect pattern
- [Line 236] makeCron creates gauge per-call | Existing: metrics.ts:68-87 defines cluster metrics centrally | Replace with: Add `singleton.lastExecution` to MetricsService.singleton namespace

## Missing Integrations

- Research should show: `dual()` pattern for withinCluster | Source: context.ts:127 | Why: Data-first and data-last API like existing withinCluster
- Research should show: `Option.match` for state load | Source: context.ts:74 uses `Option.match(ctx.session, { onNone, onSome })` | Why: Consistent with codebase Option handling
- Research should show: `Cause.match` for error classification | Source: telemetry.ts:66-73 | Why: Exhaustive cause handling in singleton errors
- Research should show: `MetricsService.label` usage | Source: metrics.ts:172-182 | Why: All metric labels should use label() for sanitization
- Research should show: `Telemetry.span` with metrics:false | Source: telemetry.ts:102-108 | Why: Avoid double-tracking when using trackEffect
- Research should show: `Effect.annotateLogs` for context | Source: jobs.ts:57 uses `Effect.annotateLogsScoped` | Why: Singleton logs need service.name annotation
- Research should show: `S.TaggedError` pattern | Source: cluster.ts:36,82 | Why: Use S.TaggedError for SingletonError, not S.TaggedError<T>()
- Research should show: `Circuit.make` integration | Source: circuit.ts:44-121 | Why: Singleton DB operations should use circuit breaker
- Research should show: `Effect.acquireRelease` for resources | Source: storage.ts:185-188 uses acquire/release for multipart | Why: EntityResource pattern should match
- Research should show: `Match.exhaustive` for dispatch | Source: jobs.ts:66-93, metrics.ts:257-260 | Why: State transitions need exhaustive matching

## Additional Observations

- cluster.ts:54-79 ClusterEntityLive uses `Effect.gen` with `Ref.make` | Research Pattern 3 should match this structure
- circuit.ts:72 `_updateMetric` helper | Research heartbeat gauge update should use similar helper pattern
- jobs.ts:32-40 `B` constant naming | Research `_CONFIG` extension should use similar short alias if needed
- storage.ts:45-53 `$` wrapper for metrics | Research singleton factory should use similar labeled wrapper pattern
- transfer.ts:13-19 `_drivers` lazy loading | Research could use lazy driver pattern for KeyValueStore backends
