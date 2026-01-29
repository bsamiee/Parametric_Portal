---
phase: 02-context-integration
plan: 01
subsystem: infra
tags: [effect, fiberref, cluster, sharding, branded-types]

# Dependency graph
requires:
  - phase: 01-cluster-foundation
    provides: ClusterService, ShardingConfig, ClusterError
provides:
  - ClusterState interface with 5 fields
  - RunnerId and ShardIdString branded schemas
  - Context.Request static accessors (clusterState, shardId, runnerId, isLeader)
  - makeRunnerId helper for Snowflake conversion
  - withinCluster dual for scoped context
affects: [02-02-middleware, 03-entity-handlers, 05-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ClusterState uses outer Option, inner nulls (avoid nesting)"
    - "Namespace type exports for external consumers"
    - "dual pattern for data-first and pipeable APIs"

key-files:
  created: []
  modified:
    - packages/server/src/context.ts

key-decisions:
  - "ClusterContextRequired local error (avoids circular import from cluster.ts)"
  - "Accessor named 'clusterState' not 'cluster' (TypeScript class extension conflict)"
  - "String(snowflake) for conversion (Snowflake has no toString method)"
  - "Type imports only for ShardId/Snowflake (namespace type references)"

patterns-established:
  - "FiberRef-based cluster context following circuit/session pattern"
  - "Effect.locallyWith for scoped context updates"
  - "Option.flatMapNullable for extracting nullable fields from Option"
  - "Option.exists for boolean checks on Option contents"

# Metrics
duration: 6min
completed: 2026-01-29
---

# Phase 02 Plan 01: Context State Definition Summary

**ClusterState interface with FiberRef-based accessors for shard, runner, and leader context**

## Performance

- **Duration:** 6 min
- **Started:** 2026-01-29T10:00:43Z
- **Completed:** 2026-01-29T10:07:09Z
- **Tasks:** 2 (combined into 1 atomic commit)
- **Files modified:** 1

## Accomplishments
- ClusterState interface with 5 fields: entityId, entityType, isLeader, runnerId, shardId
- RunnerId and ShardIdString branded schemas for type-safe serialization
- Static accessors on Context.Request: clusterState, shardId, runnerId, isLeader
- makeRunnerId helper for Snowflake to branded RunnerId conversion
- withinCluster dual API for scoped cluster context updates
- Namespace exports: Context.Request.ClusterState, Context.Request.RunnerId

## Task Commits

Tasks 1 and 2 were combined into a single atomic commit (interdependent, incomplete without both):

1. **Task 1+2: ClusterState and accessors** - `0fd4d83` (feat)

## Files Created/Modified
- `packages/server/src/context.ts` - Extended with cluster state infrastructure (+66 lines)

## Decisions Made

1. **ClusterContextRequired local error** - Defined locally to avoid circular import (context.ts -> cluster.ts -> metrics.ts -> context.ts). Semantically matches ClusterError('RunnerUnavailable') intent.

2. **Accessor named 'clusterState' not 'cluster'** - Effect.Tag base class has internal `cluster` property causing TypeScript class extension conflict. Renamed to `clusterState` for compatibility.

3. **Type imports for @effect/cluster** - ShardId and Snowflake only used as type references (Snowflake.Snowflake, ShardId.ShardId), so imported as `import type`.

4. **String(snowflake) conversion** - Snowflake is a branded bigint without toString method. Used JavaScript String() for conversion to pass to RunnerId schema validation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Circular import resolution**
- **Found during:** Task 1 (Add imports)
- **Issue:** Plan specified importing ClusterError from `./infra/cluster.js`, but this creates a circular dependency (context.ts -> cluster.ts -> metrics.ts -> context.ts)
- **Fix:** Defined ClusterContextRequired tagged error locally in context.ts
- **Files modified:** packages/server/src/context.ts
- **Verification:** Biome lint passes, no import cycle errors
- **Committed in:** 0fd4d83 (combined task commit)

**2. [Rule 3 - Blocking] TypeScript class extension conflict**
- **Found during:** Task 2 (Add accessors)
- **Issue:** Static property `cluster` conflicts with Effect.Tag base class, causing TS2417 error
- **Fix:** Renamed accessor to `clusterState`
- **Files modified:** packages/server/src/context.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** 0fd4d83 (combined task commit)

**3. [Rule 3 - Blocking] Snowflake API mismatch**
- **Found during:** Task 2 (makeRunnerId implementation)
- **Issue:** Plan specified `Snowflake.toString(snowflake)` but Snowflake module has no toString function
- **Fix:** Used `String(snowflake)` for bigint to string conversion
- **Files modified:** packages/server/src/context.ts
- **Verification:** TypeScript compiles, schema validation works
- **Committed in:** 0fd4d83 (combined task commit)

**4. [Rule 3 - Blocking] FiberRef.locallyWith API mismatch**
- **Found during:** Task 2 (withinCluster implementation)
- **Issue:** Plan specified `FiberRef.locallyWith(_ref, fn)(effect)` but correct API is `Effect.locallyWith(effect, _ref, fn)`
- **Fix:** Used Effect.locallyWith with correct argument order
- **Files modified:** packages/server/src/context.ts
- **Verification:** TypeScript compiles, follows existing codebase pattern
- **Committed in:** 0fd4d83 (combined task commit)

---

**Total deviations:** 4 auto-fixed (all Rule 3 - blocking issues)
**Impact on plan:** All fixes necessary for TypeScript compilation and linting. Semantic intent preserved. No scope creep.

## Issues Encountered
- Pre-existing circuit.ts errors (unrelated to this plan, uncommitted changes in repo)
- Resolved by verifying only context.ts compilation, not full server:typecheck

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- ClusterState interface and accessors ready for Plan 02 (middleware integration)
- _makeShardIdString helper available for Serializable.fromData extension
- withinCluster API ready for entity/singleton handler scoping in Phase 3

---
*Phase: 02-context-integration*
*Completed: 2026-01-29*
