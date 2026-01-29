---
phase: 01-cluster-foundation
plan: 03
subsystem: infra
tags: [effect-cluster, metrics, observability, otlp, prometheus]

# Dependency graph
requires:
  - phase: 01-cluster-foundation/01-01
    provides: ClusterService facade with ClusterError (e.reason pattern)
provides:
  - cluster namespace in MetricsService (app-specific counters/histograms)
  - MetricsService.trackCluster utility for cluster operation tracking
  - Error classification by type (e.reason labeling)
affects: [01-02, phase-02, phase-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "App-specific metrics complement ClusterMetrics auto-provided gauges"
    - "Error classification via e.reason labeling"
    - "Match.value for exhaustive operation handling"

key-files:
  created: []
  modified:
    - packages/server/src/observe/metrics.ts

key-decisions:
  - "ClusterMetrics gauges (effect_cluster_*) auto-provided by Sharding - no duplication"
  - "App-specific metrics: counters for messages/errors, histograms for latency/lifetime"
  - "trackCluster uses e.reason for error type discrimination"

patterns-established:
  - "cluster namespace for app-level cluster metrics (vs ClusterMetrics for state)"
  - "trackCluster pattern: track duration + errors + operation type in one call"

# Metrics
duration: 8min
completed: 2026-01-29
---

# Phase 01 Plan 03: Cluster Metrics Namespace Summary

**App-specific cluster metrics (counters/histograms) in MetricsService, complementing @effect/cluster/ClusterMetrics auto-provided gauges**

## Performance

- **Duration:** 8 min
- **Started:** 2026-01-29T10:30:00Z
- **Completed:** 2026-01-29T10:38:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added cluster namespace to MetricsService with app-specific metrics
- Created MetricsService.trackCluster utility for unified cluster operation tracking
- Established pattern for ClusterError type labeling via e.reason

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cluster metrics namespace to MetricsService** - `d31276f` (feat)
2. **Task 2: Add cluster error tracking utility** - `3983f20` (feat)

## Files Created/Modified

- `packages/server/src/observe/metrics.ts` - Added cluster namespace and trackCluster method

## Metrics Added

**_boundaries.cluster:** `[0.001, 0.01, 0.05, 0.1, 0.5, 1, 5]` - SLA-aligned for <100ms target

**MetricsService.cluster namespace:**
| Metric | Type | Purpose |
|--------|------|---------|
| `cluster_messages_sent_total` | Counter | Track messages sent (labels: entity_type, operation) |
| `cluster_messages_received_total` | Counter | Track messages received |
| `cluster_redeliveries_total` | Counter | Track message redeliveries |
| `cluster_entity_activations_total` | Counter | Entity lifecycle - capacity planning |
| `cluster_entity_deactivations_total` | Counter | Entity lifecycle - capacity planning |
| `cluster_message_latency_seconds` | Histogram | Message delivery latency |
| `cluster_entity_lifetime_seconds` | Histogram | Entity lifetime - tune maxIdleTime |
| `cluster_errors_total` | Counter | Errors by type label |

**MetricsService.trackCluster:** Utility method that:
- Increments message counters (send/receive based on operation)
- Tracks message latency via histogram
- Labels errors by type (e.reason for ClusterError)

## Decisions Made

- **ClusterMetrics gauges not duplicated:** effect_cluster_* metrics are auto-provided by Sharding internals and exported via Telemetry.Default OTLP layer. We only define app-specific metrics.
- **Error labeling via e.reason:** trackCluster requires `E extends { readonly reason: string }` constraint, which ClusterError satisfies.
- **Match.value for operations:** Used Match.value(config.operation) for exhaustive handling per CLAUDE.md guidelines.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- **TypeScript inference issue with Effect.flatten in pipe:** Initial implementation used `Effect.gen(...).pipe(Effect.flatten)` which caused type inference failure. Resolved by using `Effect.flatMap(MetricsService, (metrics) => ...)` pattern instead.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Cluster metrics namespace ready for use in ClusterService operations
- trackCluster utility ready for send/broadcast/receive operations in Plan 02
- Entity lifecycle metrics ready for activate/deactivate hooks

---
*Phase: 01-cluster-foundation*
*Completed: 2026-01-29*
