---
phase: 03-singleton-scheduling
plan: 03
subsystem: infra
tags: [effect, cluster, health, metrics, datetime, clustermetrics]

requires:
  - phase: 03-singleton-scheduling
    plan: 01
    provides: SingletonError, _CONFIG.singleton, MetricsService.singleton namespace
  - phase: 02-context-integration
    provides: Context.Request.withinCluster for cluster state propagation
provides:
  - Entity handlers wrapped with withinCluster context (entityId, entityType, shardId)
  - checkSingletonHealth utility for heartbeat staleness validation
  - checkClusterHealth utility for cluster-wide status aggregation
  - ClusterService static exports for health check utilities
  - SingletonHealthResult and ClusterHealthResult type definitions
affects: [phase-8-observability, health-endpoints]

tech-stack:
  added: []
  patterns:
    - "withinCluster wraps entire handler including ensuring and matchCauseEffect"
    - "DateTime.distanceDuration for Duration-based staleness calculation"
    - "Duration.format for human-readable staleness output"
    - "N.between for self-documenting range validation"
    - "Array.partition for single-pass healthy/unhealthy split"
    - "Effect.forEach with concurrency: 'unbounded' for parallel health checks"
    - "ClusterMetrics.* for official cluster gauge access"

key-files:
  created: []
  modified:
    - packages/server/src/infra/cluster.ts

key-decisions:
  - "withinCluster wraps ENTIRE handler (gen body + ensuring + matchCauseEffect) for complete context propagation"
  - "DateTime.distanceDuration returns Duration directly for staleness calculation (no manual subtraction)"
  - "N.between with named object params for self-documenting threshold validation"
  - "Static exports on ClusterService class for Phase 8 health endpoint integration"

patterns-established:
  - "Entity handlers set cluster context via withinCluster at handler entry"
  - "Health check utilities use Telemetry.span for named tracing"
  - "Metric.value(ClusterMetrics.*) for reading official cluster gauges"
  - "Boolean.match for binary condition handling in health result formatting"

duration: 6min
completed: 2026-01-29
---

# Phase 3 Plan 03: Entity withinCluster Wrapping and Health Check Utilities Summary

**Entity handlers wrapped with withinCluster context propagation, checkSingletonHealth for heartbeat staleness validation, checkClusterHealth for cluster-wide status aggregation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-29
- **Completed:** 2026-01-29
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Entity handlers now propagate cluster context (entityId, entityType, shardId) via withinCluster wrapper
- checkSingletonHealth validates heartbeat staleness against configurable threshold (default 2x interval)
- checkClusterHealth aggregates ClusterMetrics.* gauges for cluster-wide health status
- Health utilities exported via ClusterService for Phase 8 health endpoint integration

## Task Commits

Each task was committed atomically:

1. **Task 1: Wrap entity handlers with withinCluster context** - `bcd823f` (feat)
2. **Task 2+3: Add health check utilities with ClusterService exports** - `22a9550` (feat)

Note: Tasks 2 and 3 were combined in a single commit because Task 3 exports the utilities from Task 2, and the linter would fail if utilities were defined but not exported.

## Files Created/Modified

- `packages/server/src/infra/cluster.ts` - Added Context import, withinCluster wrapping on entity handler, [HEALTH] section with _checkStaleness/checkSingletonHealth/checkClusterHealth, static exports on ClusterService, SingletonHealthResult/ClusterHealthResult types in namespace

## Decisions Made

1. **withinCluster scope** - Wrapping encompasses the ENTIRE handler (Effect.gen body + Effect.ensuring finalizer + Effect.matchCauseEffect error transformer). This ensures cluster context is available throughout the entire processing pipeline including error handlers and finalizers.

2. **DateTime.distanceDuration** - Used for clean Duration arithmetic. Returns Duration directly from two timestamps, avoiding manual millisecond subtraction.

3. **Combined Task 2+3 commit** - The health check utilities must be exported to pass biome's unused-variable lint rule. Combined into single commit for atomicity.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - straightforward implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Entity handlers now propagate cluster context for downstream tracing and metrics
- Health check utilities ready for Phase 8 observability integration
- ClusterService.checkSingletonHealth enables dead man's switch pattern for singleton monitoring
- ClusterService.checkClusterHealth enables cluster-wide health probes for K8s readiness

---
*Phase: 03-singleton-scheduling*
*Completed: 2026-01-29*
