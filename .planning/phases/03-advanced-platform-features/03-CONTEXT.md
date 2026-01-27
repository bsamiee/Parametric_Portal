# Phase 3: Advanced Platform Features - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Add CPU offload via worker pools for parsing operations (xlsx, zip, csv) and extend CacheService with schema-validated typed access. Workers handle heavy parsing off the main thread; CacheService gains `forSchema` capability for compile-time type validation on cached data.

</domain>

<decisions>
## Implementation Decisions

### Worker Pool Design

**Dispatch pattern:**
- Stream progress — return `Effect.Stream` with progress events until final result
- Progress includes bytes/rows processed, percentage complete, and ETA calculation

**Queue management:**
- FIFO only — no priority lanes
- Use official Effect queue management from `@effect/platform` and `@effect/experimental` — no hand-rolled queue logic
- Simple fixed pool size for now (Claude's discretion on count)

**Worker behavior:**
- Stateless workers — receive data, return parsed result, main thread handles DB
- Graceful cancel — caller can cancel; worker finishes current chunk then stops
- Workers can fetch from URLs directly (S3, external sources) via presigned URLs only — no auth credentials passed to workers
- No file size limit — workers handle any size file (streaming internally if needed)

**Error reporting:**
- Partial results + errors — return successfully parsed items plus list of row/cell errors
- Typed error union: `ParseError | TimeoutError | WorkerCrashError`

### Cache Schema Contracts

**Schema validation:**
- Decode failure = cache miss — fetch fresh data, re-cache (no migration functions)
- String keys — type safety on values only, no branded key types
- Shared store with typed keys — single KeyValueStore, keys encode entity type (`session:*`, `token:*`)
- Call-site TTL override — schema has default, callers can override when setting

**API surface:**
- Extend CacheService — add `CacheService.getSchema<S>()` for schema-enforced get/set
- Registered domains — `CacheService.register(domain, schema)` at startup, then `getSchema(domain, key)`

### Error & Timeout Handling

**Timeouts:**
- Soft timeout + grace — signal timeout, give worker N seconds to checkpoint, then kill

**Retries:**
- No auto-retry on worker crash — return error to caller, let them decide retry strategy

**Observability:**
- Full observability — expose all metrics via MetricsService (queue depth, active workers, latencies, failures)

### Claude's Discretion

- Worker pool size (fixed count, reasonable default)
- Memory-only CacheService.Layer for dev/test (no Redis required)
- Exact grace period duration for soft timeout
- Progress event frequency/throttling
- Compression algorithm for large payloads

</decisions>

<specifics>
## Specific Ideas

- Queue management must use official Effect APIs (`@effect/platform`, `@effect/experimental`) — no hand-rolled queue logic
- Future consideration: integrate Effect's Resource API for proper cluster resource management (not Phase 3 scope)
- Workers should feel like Effect's SerializedWorkerPool pattern — research needed on schema definitions and worker script setup

</specifics>

<deferred>
## Deferred Ideas

- **Effect Resource API integration** — proper cluster resource loading, dynamic pool sizing based on cluster state
- **Plugin registry for parsers** — extensible system where new format parsers can be registered (needs research spike to assess feasibility vs all-formats approach)
- **Priority lanes for worker queue** — separate queues for small/large files, interactive vs batch (complexity vs FIFO simplicity)

</deferred>

---

*Phase: 03-advanced-platform-features*
*Context gathered: 2026-01-27*
