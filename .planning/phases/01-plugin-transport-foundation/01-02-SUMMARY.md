---
phase: 01-plugin-transport-foundation
plan: 02
subsystem: transport
tags: [effect, websocket, reconnect, postgresql, checkpoint, exponential-backoff]

# Dependency graph
requires:
  - phase: 01-plugin-transport-foundation
    provides: "Kargadan harness base socket client and protocol dispatch (plan 01)"
provides:
  - "Port discovery via ~/.kargadan/port file with PID liveness validation"
  - "Reconnection supervisor with exponential backoff (500ms base, 2x, jitter, 30s cap)"
  - "PostgreSQL checkpoint persistence for session recovery"
  - "Scene state verification on reconnect to detect manual user changes"
  - "Heartbeat staleness detection triggering reconnection"
  - "DisconnectedError propagation through dispatch to callers"
affects: [02-command-execution-engine, 04-persistence-journal-redesign, 05-agent-intelligence-pipeline]

# Tech tracking
tech-stack:
  added: ["@effect/sql 0.49.0", "@effect/sql-pg 0.50.3"]
  patterns: ["Port file discovery", "Exponential backoff reconnection", "PostgreSQL checkpoint upsert", "Scene hash verification"]

key-files:
  created:
    - "apps/kargadan/harness/src/transport/port-discovery.ts"
    - "apps/kargadan/harness/src/transport/reconnect.ts"
    - "apps/kargadan/harness/src/persistence/checkpoint.ts"
    - "apps/kargadan/harness/src/persistence/schema.ts"
  modified:
    - "apps/kargadan/harness/src/config.ts"
    - "apps/kargadan/harness/src/socket.ts"
    - "apps/kargadan/harness/src/protocol/dispatch.ts"
    - "apps/kargadan/harness/src/harness.ts"
    - "apps/kargadan/harness/src/runtime/agent-loop.ts"
    - "apps/kargadan/harness/src/runtime/loop-stages.ts"
    - "apps/kargadan/harness/src/runtime/persistence-trace.ts"
    - "apps/kargadan/harness/package.json"

key-decisions:
  - "CheckpointService composes PersistenceTrace's in-memory trace methods (appendTransition, snapshot, replay) plus PostgreSQL persistence, replacing PersistenceTrace as single service"
  - "PgClient.layerConfig used for environment-driven PostgreSQL configuration with explicit pool limits (5 connections, 30s idle, 10s connect timeout)"
  - "readPortFile is an Effect.fn zero-arg function requiring FileSystem in R -- callers invoke as readPortFile()"
  - "DisconnectedError propagated via catchTag('DisconnectedError') in dispatch, mapped to CommandDispatchError('disconnected')"
  - "Heartbeat staleness checker forked as background fiber via stalenessChecker property on socket lifecycle"

patterns-established:
  - "Port file discovery: read JSON from known path, validate PID liveness via process.kill(pid, 0)"
  - "Exponential backoff: Schedule.exponential + jittered + intersect(recurs) + upTo for capped retry"
  - "Checkpoint upsert: INSERT ON CONFLICT DO UPDATE for idempotent session state persistence"
  - "ReconnectionSupervisor.supervise wraps connection lifecycle with automatic retry on disconnect"

requirements-completed: [TRAN-04, TRAN-05, TRAN-06]

# Metrics
duration: 12min
completed: 2026-02-22
---

# Phase 1 Plan 2: Harness Reconnection and Checkpoint Persistence Summary

**Dynamic port discovery, exponential backoff reconnection, and PostgreSQL checkpoint storage enabling session survival across plugin disconnections**

## Performance

- **Duration:** 12 min
- **Started:** 2026-02-22T11:40:13Z
- **Completed:** 2026-02-22T11:52:16Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Harness discovers plugin WebSocket port dynamically by reading ~/.kargadan/port and validating PID liveness
- Reconnection supervisor retries with exponential backoff (500ms initial, 2x multiplier, jitter, 30s cap, 50 max attempts)
- CheckpointService persists conversation history and loop state to PostgreSQL with upsert semantics
- Scene state hash verification on reconnect detects if user made manual changes during disconnect
- In-flight commands fail immediately with DisconnectedError during disconnection (no auto-retry)
- Heartbeat staleness detection triggers reconnection when no inbound message arrives within timeout window
- All PersistenceTrace consumers migrated to CheckpointService; persistence-trace.ts marked deprecated for Phase 4 cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Port discovery, reconnection supervisor, and config updates** - `21440af` (feat)
2. **Task 2: PostgreSQL checkpoint persistence, PersistenceTrace migration, and harness lifecycle rewiring** - `7a0ba91` (feat)

## Files Created/Modified
- `apps/kargadan/harness/src/transport/port-discovery.ts` - Port file reader with PID validation and typed errors (PortFileNotFound, PortFileStale, PortFileInvalid)
- `apps/kargadan/harness/src/transport/reconnect.ts` - ReconnectionSupervisor with exponential backoff schedule and DisconnectedError
- `apps/kargadan/harness/src/persistence/schema.ts` - kargadan_checkpoints table schema (session_id, conversation_history, loop_state, state_hash, scene_summary, sequence)
- `apps/kargadan/harness/src/persistence/checkpoint.ts` - CheckpointService: save/restore/verifySceneState plus in-memory trace methods migrated from PersistenceTrace
- `apps/kargadan/harness/src/config.ts` - Removed hardcoded host/port, added KARGADAN_HEARTBEAT_TIMEOUT_MS, KARGADAN_RECONNECT_MAX_ATTEMPTS, KARGADAN_CHECKPOINT_DATABASE_URL, PG pool config
- `apps/kargadan/harness/src/socket.ts` - Uses port discovery, adds heartbeat staleness checker, fails all pending on disconnect
- `apps/kargadan/harness/src/protocol/dispatch.ts` - Propagates DisconnectedError as CommandDispatchError('disconnected')
- `apps/kargadan/harness/src/harness.ts` - Composes ReconnectionSupervisor, CheckpointService, PgClient.layerConfig into ServicesLayer; main wraps lifecycle in reconnect supervision
- `apps/kargadan/harness/src/runtime/agent-loop.ts` - Yields CheckpointService instead of PersistenceTrace
- `apps/kargadan/harness/src/runtime/loop-stages.ts` - References CheckpointService type instead of PersistenceTrace
- `apps/kargadan/harness/src/runtime/persistence-trace.ts` - Marked [DEPRECATED]; hashCanonicalState still imported by checkpoint.ts and loop-stages.ts
- `apps/kargadan/harness/package.json` - Added @effect/sql and @effect/sql-pg catalog dependencies

## Decisions Made
- CheckpointService subsumes PersistenceTrace's in-memory trace API (appendTransition, snapshot, replay, appendArtifact, listArtifacts) alongside new PostgreSQL checkpoint methods (save, restore, verifySceneState, remove), enabling a clean single-service migration without dual-wiring
- Used PgClient.layerConfig for config-driven PostgreSQL setup with explicit pool bounds suitable for single-user CLI (5 max connections, 30s idle timeout, 10s connect timeout)
- Port file path hardcoded as ~/.kargadan/port using os.homedir() + path.join -- consistent cross-platform resolution
- readPortFile defined as Effect.fn zero-arg function (invoked as readPortFile()) rather than a plain Effect, for tracing span support

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import type for Kargadan in checkpoint.ts**
- **Found during:** Task 2 (checkpoint.ts typecheck)
- **Issue:** Used `import type { Kargadan }` but needed runtime access to schema values (RetrievalArtifactSchema, RunEventSchema, RunSnapshotSchema)
- **Fix:** Changed to regular `import { Kargadan }` for runtime schema access
- **Files modified:** apps/kargadan/harness/src/persistence/checkpoint.ts
- **Committed in:** 7a0ba91

**2. [Rule 1 - Bug] Removed unused Match import from config.ts**
- **Found during:** Task 1 (pre-commit lint hook)
- **Issue:** Match was imported but no longer used after removing resolveSocketUrl which used Match.value
- **Fix:** Removed Match from import statement
- **Files modified:** apps/kargadan/harness/src/config.ts
- **Committed in:** 21440af

**3. [Rule 3 - Blocking] Fixed readPortFile invocation pattern**
- **Found during:** Task 1 (typecheck)
- **Issue:** readPortFile is Effect.fn (returns a function), but was used without calling it (readPortFile instead of readPortFile())
- **Fix:** Changed all callsites to readPortFile() in reconnect.ts and socket.ts
- **Files modified:** apps/kargadan/harness/src/transport/reconnect.ts, apps/kargadan/harness/src/socket.ts
- **Committed in:** 21440af

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All auto-fixes necessary for compilation correctness. No scope creep.

## Issues Encountered
- Path.Path from @effect/platform required URL input for fromFileUrl; switched to direct node:os homedir() + node:path join() for simpler cross-platform path construction
- verifySceneState explicit return type annotation conflicted with inferred error types (ParseError | SqlError vs never); removed annotation to let TypeScript infer correctly
- Recursive run function in agent-loop.ts requires explicit return type annotation since TypeScript cannot infer recursive function types

## User Setup Required
None - no external service configuration required. PostgreSQL connection is configured via KARGADAN_CHECKPOINT_DATABASE_URL environment variable at runtime.

## Next Phase Readiness
- Transport layer is resilient: port discovery, reconnection, heartbeat, and checkpoint persistence are complete
- Phase 2 (Command Execution Engine) can build on the reconnection-aware dispatch layer
- Phase 4 (Persistence Journal Redesign) will remove deprecated persistence-trace.ts and fully replace with journal-based persistence
- KARGADAN_CHECKPOINT_DATABASE_URL must be configured in the runtime environment before the harness can connect to PostgreSQL

## Self-Check: PASSED

All 5 created files verified present. Both task commits (21440af, 7a0ba91) verified in git log.

---
*Phase: 01-plugin-transport-foundation*
*Completed: 2026-02-22*
