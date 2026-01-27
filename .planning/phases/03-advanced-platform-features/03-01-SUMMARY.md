---
phase: 03-advanced-platform-features
plan: 01
subsystem: platform
tags: [effect-rpc, schema, cache, worker-pool, streaming]

# Dependency graph
requires:
  - phase: 01-platform-api-adoption
    provides: CacheService L1/L2 architecture
provides:
  - RPC contract schemas for worker communication (ParseProgress, ParseResult, ParseTransfer)
  - Schema-validated typed cache access (register, getSchema, setSchema)
  - TransferRpc group for worker pool integration
affects: [03-02, 03-03, 03-04, worker-pool-implementation]

# Tech tracking
tech-stack:
  added: ["@effect/rpc (existing but now used)"]
  patterns:
    - "Rpc.make with stream:true for streaming worker requests"
    - "RpcGroup.make for request grouping"
    - "S.TaggedError for serializable error types"
    - "Schema registry pattern for typed cache domains"
    - "Decode-failure-as-miss cache semantics"

key-files:
  created:
    - packages/server/src/platform/workers/contract.ts
  modified:
    - packages/server/src/platform/cache.ts

key-decisions:
  - "Use S.TaggedError (not Data.TaggedError) for RPC errors - required for serialization across worker boundary"
  - "Duration fields in TimeoutError stored as milliseconds (Number) - Duration type not serializable"
  - "Option.fromNullable + Option.match pattern for imperative-free schema registry access"
  - "Schema stores bypass L1 Effect.Cache - direct Redis access for simplicity"

patterns-established:
  - "RPC contract pattern: schemas in contract.ts, shared by main thread and worker"
  - "Cache domain registration: register at startup, getSchema/setSchema for typed access"

# Metrics
duration: 4min
completed: 2026-01-27
---

# Phase 3 Plan 1: RPC Contracts and Schema Cache Summary

**RPC contract schemas for worker communication with Rpc.make streaming, plus CacheService schema-validated typed access via register/getSchema/setSchema methods**

## Performance

- **Duration:** 4 min
- **Started:** 2026-01-27T21:14:19Z
- **Completed:** 2026-01-27T21:18:41Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created complete RPC contract with ParseProgress, ParseResult, ParseFormat schemas
- Added ParseError, TimeoutError, WorkerCrashError as S.TaggedError for serialization
- Defined ParseTransfer streaming RPC via Rpc.make with stream:true
- Extended CacheService with schema registry (_domains Map)
- Added register/getSchema/setSchema methods with auto-scoping from context

## Task Commits

Each task was committed atomically:

1. **Task 1: Create RPC Contract Schemas** - `4907cbe` (feat)
2. **Task 2: Extend CacheService with forSchema** - `6de211f` (feat)

## Files Created/Modified

- `packages/server/src/platform/workers/contract.ts` - RPC contract schemas for worker communication
- `packages/server/src/platform/cache.ts` - Extended with schema registry and typed access methods

## Decisions Made

1. **S.TaggedError for RPC errors** - Data.TaggedError is not serializable across worker boundaries; S.TaggedError provides schema-based serialization required for @effect/rpc
2. **Duration as milliseconds in TimeoutError** - Duration.Duration is not JSON-serializable; stored as elapsedMs, softLimitMs, hardLimitMs Numbers
3. **Imperative-free schema registry access** - Converted early returns to Option.match pattern to pass lefthook imperatives check
4. **Direct Redis for schema stores** - getSchema/setSchema bypass L1 Effect.Cache for simplicity; L1 caching can be added later if needed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Rpc.StreamRequest API mismatch**
- **Found during:** Task 1 (RPC contract creation)
- **Issue:** Research documented Rpc.StreamRequest pattern but actual @effect/rpc 0.73.0 API is Rpc.make with stream:true option
- **Fix:** Used Rpc.make('ParseTransfer', { stream: true, ... }) pattern from actual library types
- **Files modified:** packages/server/src/platform/workers/contract.ts
- **Verification:** pnpm exec nx run server:typecheck passes
- **Committed in:** 4907cbe

**2. [Rule 1 - Bug] Fixed Data.TaggedError for RPC serialization**
- **Found during:** Task 1 (RPC contract creation)
- **Issue:** Plan specified Data.TaggedError but RPC requires schema-serializable errors
- **Fix:** Used S.TaggedError pattern for ParseError, TimeoutError, WorkerCrashError
- **Files modified:** packages/server/src/platform/workers/contract.ts
- **Verification:** Typecheck passes, errors work with TransferWorkerErrorSchema union
- **Committed in:** 4907cbe

**3. [Rule 3 - Blocking] Fixed imperative patterns in cache methods**
- **Found during:** Task 2 (CacheService extension)
- **Issue:** Initial implementation used early returns which failed lefthook imperatives check
- **Fix:** Refactored to Option.match pattern with pipe composition
- **Files modified:** packages/server/src/platform/cache.ts
- **Verification:** Lefthook pre-commit passes
- **Committed in:** 6de211f

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All auto-fixes necessary for correct API usage and codebase standards compliance. No scope creep.

## Issues Encountered

- Research documentation was slightly out of date regarding Rpc.StreamRequest vs Rpc.make pattern - resolved by checking actual library types in node_modules

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RPC contracts ready for worker pool implementation (Plan 03-02)
- CacheService schema methods ready for typed session/token storage
- TransferRpc group ready for RpcServer.layer integration in workers

---
*Phase: 03-advanced-platform-features*
*Completed: 2026-01-27*
