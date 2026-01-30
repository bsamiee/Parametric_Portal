---
phase: 03-singleton-scheduling
plan: 01
subsystem: infra
tags: [effect, cluster, singleton, metrics, keyvaluestore, sql, persistence]

requires:
  - phase: 01-cluster-foundation
    provides: ClusterService facade, ClusterError patterns
  - phase: 02-context-integration
    provides: Context.Request.withinCluster for cluster state propagation
provides:
  - SingletonError class with 5 reason variants and static factories
  - _CONFIG.singleton namespace for singleton configuration
  - MetricsService.singleton namespace with 5 observability metrics
  - SQL-backed KeyValueStore layer for state persistence
affects: [03-02, 03-03, phase-4-jobs, phase-6-machine]

tech-stack:
  added: []
  patterns:
    - "Data.TaggedError for internal errors (not crossing RPC boundaries)"
    - "Set-based retryable check pattern (_retryable ReadonlySet)"
    - "Match.type exhaustive factory for error construction"
    - "Layer.effect for service construction with dependencies"
    - "SqlError to PlatformError mapping for interface compatibility"

key-files:
  created: []
  modified:
    - packages/server/src/infra/cluster.ts
    - packages/server/src/observe/metrics.ts

key-decisions:
  - "Data.TaggedError for SingletonError (not Schema.TaggedError) since errors don't cross RPC boundaries"
  - "PlatformError.SystemError with reason 'Unknown' for SqlError mapping"
  - "Layer.effect pattern for KeyValueStore to access SqlClient dependency"
  - "Tuple import removed (unused after simplifying modify implementation)"

patterns-established:
  - "SingletonError._retryable Set pattern matches ClusterError._transient"
  - "Static factory methods (from*) for consistent error construction"
  - "Match.type exhaustive factory for external reason sources"
  - "N.clamp for bounded numeric configuration"

duration: 8min
completed: 2026-01-29
---

# Phase 3 Plan 01: SingletonError, Metrics, and KeyValueStore Summary

**SingletonError class with 5 reason variants, singleton metrics namespace, and SQL-backed KeyValueStore layer for stateful singleton persistence**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-29
- **Completed:** 2026-01-29
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- SingletonError class with StateLoadFailed, StatePersistFailed, SchemaDecodeFailed, HeartbeatFailed, LeaderHandoffFailed reasons
- Singleton metrics namespace with duration histogram, executions counter, lastExecution gauge, stateErrors counter, stateOperations counter
- SQL-backed KeyValueStore layer with SqlError to PlatformError mapping

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SingletonError and _CONFIG.singleton to cluster.ts** - `26f8ff8` (feat)
2. **Task 2: Add singleton metrics to MetricsService** - `aa6af20` (feat)
3. **Task 3: Add SQL-backed KeyValueStore layer to cluster.ts** - `d98e5a5` (feat)

## Files Created/Modified

- `packages/server/src/infra/cluster.ts` - Added SingletonError class, _CONFIG.singleton namespace, _kvStoreLayers IIFE, updated ClusterService.Error to object pattern
- `packages/server/src/observe/metrics.ts` - Added MetricsService.singleton namespace with 5 metrics

## Decisions Made

1. **Data.TaggedError for SingletonError** - These errors are internal to the cluster infrastructure and do not cross RPC serialization boundaries. Schema.TaggedError (used by ClusterError) is only needed for errors that serialize across network.

2. **PlatformError.SystemError mapping** - KeyValueStore interface requires PlatformError types. SqlError is mapped to SystemError with reason 'Unknown' and module 'KeyValueStore' to satisfy interface requirements while preserving original error as cause.

3. **Layer.effect pattern** - Used Layer.effect instead of Layer.succeed to access SqlClient.SqlClient dependency at construction time. This allows the KeyValueStore implementation to capture the SQL client once rather than on each operation.

4. **Removed Tuple import** - Originally planned to use Tuple.make for modify return type, but simplified implementation meant it was unused. Removed to satisfy linter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Type compatibility with KeyValueStore interface**
- **Found during:** Task 3 (SQL-backed KeyValueStore layer)
- **Issue:** Plan specified `Layer.succeed(KeyValueStore.KeyValueStore, KeyValueStore.make(...))` but KeyValueStore interface expects PlatformError, not SqlError. Also required getUint8Array method.
- **Fix:** Used Layer.effect pattern with SqlError to PlatformError mapping helper, added getUint8Array implementation
- **Files modified:** packages/server/src/infra/cluster.ts
- **Verification:** pnpm exec nx run server:typecheck passes
- **Committed in:** d98e5a5 (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (blocking type issue)
**Impact on plan:** Essential fix for type compatibility. No scope creep.

## Issues Encountered

None - straightforward implementation after resolving type compatibility.

## User Setup Required

**Database migration required.** The following table must be created:

```sql
-- Migration: 20260129_add_kv_store.sql
CREATE TABLE IF NOT EXISTS kv_store (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_kv_store_updated_at ON kv_store (updated_at);
```

## Next Phase Readiness

- SingletonError provides typed error handling for Plan 02 state persistence
- MetricsService.singleton enables observability in Plan 02 singleton factories
- _kvStoreLayers provides persistence layer (requires DbClient.layer to be composed)
- Ready for Plan 02: stateful singleton factory implementation

---
*Phase: 03-singleton-scheduling*
*Completed: 2026-01-29*
