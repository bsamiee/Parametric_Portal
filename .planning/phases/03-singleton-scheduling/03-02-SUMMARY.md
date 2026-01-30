---
phase: 03-singleton-scheduling
plan: 02
subsystem: infra
tags: [effect, cluster, singleton, cron, keyvaluestore, metrics, fibermap, state-persistence]

requires:
  - phase: 03-01
    provides: SingletonError, MetricsService.singleton namespace, _kvStoreLayers
  - phase: 02-context-integration
    provides: Context.Request.withinCluster for cluster state propagation
provides:
  - Enhanced ClusterService.singleton() with state schema, lifecycle hooks, graceful shutdown
  - Enhanced ClusterService.cron() with MetricsService.trackEffect and withinCluster wrapping
  - Cron utilities (cronNextRuns, cronMatchesNow) for schedule preview and validation
  - FiberMap-based fiber tracking with auto-cleanup
  - Effect.raceFirst + sharding.isShutdown shutdown coordination pattern
affects: [03-03, phase-4-jobs, phase-6-machine, phase-8-health]

tech-stack:
  added: []
  patterns:
    - "State passed via Ref (stateRef parameter) for user modification"
    - "Effect.addFinalizer for lifecycle hooks and state auto-persist"
    - "FiberMap for fiber tracking with auto-cleanup on scope close"
    - "Effect.raceFirst + sharding.isShutdown for graceful shutdown"
    - "Exit.isInterrupted + Boolean.match for shutdown vs failure detection"
    - "Effect.repeat(Schedule.recurWhile) for condition-based loops"
    - "MetricsService.trackEffect(effect, config) for unified observability"
    - "Telemetry.span({ metrics: false }) when using trackEffect"

key-files:
  created: []
  modified:
    - packages/server/src/infra/cluster.ts

key-decisions:
  - "Local variable binding (stateOpts) instead of non-null assertions for type narrowing in closures"
  - "Effect.repeat(Schedule.recurWhile) instead of Effect.repeatWhile (doesn't exist in Effect 3.x)"
  - "Error tags BadArgument, ParseError, SystemError for KeyValueStore.SchemaStore"
  - "Removed HashMap, HashSet, SynchronizedRef, Tuple (unused after implementation simplification)"

patterns-established:
  - "stateOpts pattern: Extract optional property to local variable for type narrowing in closures"
  - "Shutdown coordination: Effect.raceFirst(Effect.never, awaitShutdown)"
  - "Cron utilities exposed as ClusterService static methods (cronNextRuns, cronMatchesNow)"

duration: 12min
completed: 2026-01-30
---

# Phase 03 Plan 02: Singleton/Cron Factory Enhancement Summary

**Stateful singleton factory with Ref-based state access, lifecycle hooks, FiberMap fiber tracking, graceful shutdown via sharding.isShutdown, and cron utilities with Cron.sequence/match**

## Performance

- **Duration:** 12 min
- **Started:** 2026-01-30T03:20:48Z
- **Completed:** 2026-01-30T03:32:57Z
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- ClusterService.singleton() accepts optional state schema with Ref-based access pattern (run receives stateRef)
- Lifecycle hooks (onBecomeLeader, onLoseLeadership) with Effect.addFinalizer for proper cleanup
- State auto-persists on scope close via Effect.addFinalizer
- FiberMap for fiber tracking with auto-cleanup on scope close
- Effect.raceFirst + sharding.isShutdown for graceful shutdown coordination
- Exit.isInterrupted + Boolean.match distinguishes shutdown from failure
- ClusterService.cron() with calculateNextRunFromPrevious option and MetricsService.trackEffect
- Cron utilities: cronNextRuns (Cron.sequence), cronMatchesNow (Cron.match)

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend ClusterService.singleton() factory with state and lifecycle hooks** - `dab7bda` (feat)
2. **Task 2: Extend ClusterService.cron() factory with MetricsService.trackEffect** - (included in Task 1)
3. **Task 3: Verify singleton/cron factory integration and typecheck** - (verification only)

## Files Created/Modified

- `packages/server/src/infra/cluster.ts` - Extended singleton/cron factories, added cron utilities, FiberMap fiber tracking, graceful shutdown coordination

## Decisions Made

1. **Local variable binding for type narrowing** - Used `const stateOpts = options?.state` outside the closure to enable TypeScript type narrowing. Inside closures, TypeScript cannot narrow optional properties.

2. **Effect.repeat(Schedule.recurWhile) pattern** - Effect.repeatWhile does not exist in Effect 3.x. Used Effect.repeat with Schedule.recurWhile for condition-based loops.

3. **KeyValueStore error tags** - SchemaStore operations can fail with BadArgument, ParseError, or SystemError tags. All three are caught and mapped to SingletonError variants.

4. **Import cleanup** - Removed HashMap, HashSet, SynchronizedRef, Tuple imports as they were not used in the final implementation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Effect.repeatWhile does not exist**
- **Found during:** Task 1 (singleton factory implementation)
- **Issue:** Plan specified `Effect.repeatWhile` but this API doesn't exist in Effect 3.x
- **Fix:** Used `Effect.repeat(Schedule.recurWhile((shutdown: boolean) => !shutdown))` instead
- **Files modified:** packages/server/src/infra/cluster.ts
- **Verification:** pnpm exec nx run server:typecheck passes
- **Committed in:** dab7bda (Task 1 commit)

**2. [Rule 1 - Bug] Non-null assertions blocked by linter**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** Biome linter rejects `options.state!.schema` non-null assertions
- **Fix:** Extracted to local variable `const stateOpts = options?.state` for type narrowing
- **Files modified:** packages/server/src/infra/cluster.ts
- **Verification:** pnpm exec nx run server:typecheck passes, biome check passes
- **Committed in:** dab7bda (Task 1 commit)

**3. [Rule 3 - Blocking] MetricsService.trackEffect signature**
- **Found during:** Task 1 (singleton factory implementation)
- **Issue:** Plan showed pipe syntax but trackEffect takes (effect, config) as separate args
- **Fix:** Changed from `effect.pipe(MetricsService.trackEffect({...}))` to `MetricsService.trackEffect(effect, {...})`
- **Files modified:** packages/server/src/infra/cluster.ts
- **Verification:** pnpm exec nx run server:typecheck passes
- **Committed in:** dab7bda (Task 1 commit)

**4. [Rule 3 - Blocking] Unused imports**
- **Found during:** Task 1 (pre-commit hook)
- **Issue:** Biome linter flagged HashMap, HashSet, SynchronizedRef, Tuple as unused
- **Fix:** Removed unused imports from effect import statement
- **Files modified:** packages/server/src/infra/cluster.ts
- **Verification:** biome check passes
- **Committed in:** dab7bda (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (2 bugs, 2 blocking)
**Impact on plan:** All fixes required for correct compilation and linting. No scope creep.

## Issues Encountered

None - straightforward implementation after resolving API signature differences.

## User Setup Required

None - no external service configuration required. (Database migration for kv_store table documented in 03-01-SUMMARY.md)

## Next Phase Readiness

- Singleton factory complete with state persistence, lifecycle hooks, and graceful shutdown
- Cron factory complete with MetricsService.trackEffect and withinCluster context
- Cron utilities available for schedule inspection (debugging UI, manual trigger validation)
- Ready for Plan 03: Health check integration (checkSingletonHealth already implemented)

---
*Phase: 03-singleton-scheduling*
*Completed: 2026-01-30*
