---
phase: 01-platform-api-adoption
plan: 02
subsystem: api
tags: [effect-service, streaming, sse, http-response, backpressure]

# Dependency graph
requires:
  - phase: none
    provides: standalone service, no prior dependencies
provides:
  - StreamingService Effect.Service class with unified streaming API
  - sse() method for Server-Sent Events with heartbeat and sliding buffer
  - download() method for binary streams with suspend buffer
  - export() method for formatted data (json/csv/ndjson) with suspend buffer
affects: [01-03, http-routes, jobs-routes]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Effect.Service class pattern for streaming services"
    - "Intelligent backpressure defaults (sliding for SSE, suspend for downloads/exports)"
    - "Buffer BEFORE encoding for efficient sliding window"
    - "Effect.serviceOption for optional metrics integration"
    - "Sse.encoder.write from @effect/experimental"

key-files:
  created:
    - packages/server/src/platform/streaming.ts
  modified: []

key-decisions:
  - "No consumer-configurable buffer options - intelligent defaults baked in"
  - "Buffer applied BEFORE encoding for SSE - lets sliding strategy drop stale domain objects"
  - "download() is synchronous (no Effect wrapper) since no async dependencies"
  - "Heartbeat at 30 seconds via Stream.merge with scheduled comment"

patterns-established:
  - "StreamingService.sse(name, events, serialize) - SSE with sliding buffer"
  - "StreamingService.download(stream, config) - binary with suspend buffer"
  - "StreamingService.export(name, stream, format, serialize?) - formatted with suspend buffer"

# Metrics
duration: 2min
completed: 2026-01-27
---

# Phase 01 Plan 02: StreamingService Summary

**Unified streaming service with intelligent backpressure defaults via Effect.Service class pattern**

## Performance

- **Duration:** 2 min
- **Started:** 2026-01-27T10:13:22Z
- **Completed:** 2026-01-27T10:15:38Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Created StreamingService as proper Effect.Service class with static methods
- Implemented intelligent backpressure: sliding for SSE (drop stale), suspend for downloads/exports (wait)
- Automatic metrics tracking via Effect.serviceOption(MetricsService)
- SSE heartbeat via Stream.merge with scheduled comment every 30 seconds
- Cleanup logging via Stream.ensuring on stream termination

## Task Commits

Each task was committed atomically:

1. **Task 1: Create StreamingService with unified streaming API** - `547abb8` (feat)

## Files Created/Modified

- `packages/server/src/platform/streaming.ts` - StreamingService Effect.Service class with sse(), download(), export() static methods

## Decisions Made

1. **No consumer-configurable buffer options** - Intelligent defaults are baked in per stream type. SSE uses sliding (64 capacity) to drop stale events. Downloads use suspend (256 capacity) to wait for consumer. Exports use suspend (128 capacity).

2. **Buffer BEFORE encoding for SSE** - This lets the sliding strategy drop stale domain objects rather than encoded strings, which is more efficient and semantically correct.

3. **download() is synchronous** - No Effect wrapper needed since there are no async dependencies (no metrics, no context reads). Returns HttpServerResponse directly.

4. **Heartbeat at 30 seconds** - Standard keep-alive interval for SSE connections using SSE comment syntax (`: heartbeat\n\n`).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- StreamingService ready for consumers in routes (jobs.ts can migrate to use StreamingService.sse)
- Follows same polymorphic pattern as MetricsService - consistent service architecture
- Export formats (json/csv/ndjson) ready for data export features

---
*Phase: 01-platform-api-adoption*
*Completed: 2026-01-27*
