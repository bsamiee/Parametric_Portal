---
phase: 05-eventbus-reliability
plan: 03
subsystem: observability
tags: [effect-devtools, tracing, deprecation, websocket]

# Dependency graph
requires:
  - phase: 05-01
    provides: EventBus infrastructure for deprecation references
provides:
  - DevToolsLayer for optional development debugging
  - StreamingService.channel() deprecation with migration path
  - StreamingService.broadcast() deprecation with migration path
affects: [08-observability-k8s]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Layer.unwrapEffect for conditional layer construction"
    - "Effect.timeoutTo for WebSocket availability check"
    - "JSDoc @deprecated with migration examples"

key-files:
  created:
    - packages/server/src/observe/devtools.ts
  modified:
    - packages/server/src/platform/streaming.ts

key-decisions:
  - "DevTools uses @effect/experimental DevTools.layer() (not Client.layerTracer directly)"
  - "WebSocket availability check with 1s timeout before tracer activation"
  - "Both channel() and broadcast() deprecated (broadcast also single-pod only)"

patterns-established:
  - "Config-gated optional layers: Effect.filterOrElse chain for conditional activation"

# Metrics
duration: 2min
completed: 2026-02-01
---

# Phase 5 Plan 3: DevTools & Deprecation Summary

**DevToolsLayer for development tracing via @effect/experimental, StreamingService.channel() and broadcast() deprecated with EventBus migration path**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-01T11:45:21Z
- **Completed:** 2026-02-01T11:47:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- DevToolsLayer with config-driven activation (NODE_ENV + DEVTOOLS_ENABLED)
- WebSocket availability check prevents connection failures
- Graceful degradation to empty layer when DevTools server unavailable
- StreamingService.channel() marked deprecated with EventBus.subscribe() migration
- StreamingService.broadcast() marked deprecated with EventBus.emit() migration

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DevTools layer** - `a547bb9` (feat)
2. **Task 2: Deprecate StreamingService.channel()** - `6b0f6e7` (docs)

## Files Created/Modified

- `packages/server/src/observe/devtools.ts` - DevToolsLayer with WebSocket availability check and config-driven activation
- `packages/server/src/platform/streaming.ts` - @deprecated annotations on channel() and broadcast() methods

## Decisions Made

1. **DevTools.layer() vs Client.layerTracer:** Used DevTools.layer(url) which provides complete layer including WebSocketConstructor via Socket.layerWebSocketConstructorGlobal - simpler than manual Client.layerTracer composition
2. **broadcast() also deprecated:** Added deprecation to broadcast() method as it's also single-pod only and EventBus.emit() provides cluster-wide alternative
3. **Effect.timeoutTo over Effect.timeout:** Used timeoutTo for cleaner boolean result without Option unwrapping

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DevToolsLayer ready for optional layer composition in app initialization
- StreamingService methods deprecated; new code should use EventBus (Phase 5 Plan 2)
- Phase 5 Plan 2 (EventBus core) is the remaining plan in this phase

---
*Phase: 05-eventbus-reliability*
*Completed: 2026-02-01*
