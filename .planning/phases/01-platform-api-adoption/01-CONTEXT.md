# Phase 1: Platform API Adoption - Context

**Gathered:** 2026-01-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Create proper Effect.Service implementations for CacheService and StreamingService following the polymorphic pattern established in MetricsService. Full refactor of existing cache and streaming wrappers into dense, intelligent services. Migrate all consumers (rate-limit.ts, totp-replay.ts) to use CacheService. Prepare StreamingService API for Phase 3 worker pool integration.

**Not in scope:** Layer reorganization (Phase 2), actual worker pool implementation (Phase 3).

</domain>

<decisions>
## Implementation Decisions

### CacheService API surface
- **No consumer-facing namespaces** — namespace derived automatically from FiberRef context (tenantId, userId when session exists)
- **Context-aware auto-scope** — if session exists, scope to user; otherwise scope to tenant; consumers never pass tenant/user
- **Caller specifies TTL** with internal sliding expiration — TTL is explicit on get/set, sliding renewal handled internally
- **Single `get()` function** — internally integrates resilience, metrics, lookup callback; returns Option.none on failure
- **Registration at service init** — lookup functions registered in layer: `{ sessions: findSession, tokens: findToken }`

### StreamingService composition
- **Unified StreamingService** — single service with `sse()`, `download()`, `export()` entry points
- **Intelligent backpressure defaults** — SSE: sliding (drop stale); downloads: suspend (wait); exports: suspend — internal, not configurable
- **Resilience integrated** — circuit/retry/fallback logic internalized via utilities from circuit.ts/resilience.ts; consumers don't configure per-call
- **Always track metrics** — all streams auto-emit bytes/elements/duration with tenant labels via MetricsService
- **Automatic cleanup** — Effect.ensuring handles cleanup internally; no consumer callback
- **Universal chunking** — understand and integrate all streaming/transfer/chunk APIs (Effect Stream, Web Streams, Node streams) for unified ingestion + egress; optimal batching internally

### Backend abstraction (L1/L2 cache)
- **Proper L1/L2 architecture** — L1 (memory) is fast path; L2 (Redis) is durable fallback; consumers always use single `get()` API
- **Lazy write-behind** — writes go to L1; background fiber asynchronously pushes to L2 using official @effect/experimental Redis API
- **Graceful degradation** — warn if Redis unavailable in production but continue with memory-only
- **Redis pub/sub for invalidation** — use official Effect Redis API (or ioredis); broadcast invalidation via pub/sub; all instances clear L1 when key invalidated
- **Metrics + health** — cache stats auto-emit via MetricsService; `CacheService.health()` available for explicit L1/L2 status checks

### Service integration
- **Rate limiting absorbed** — CacheService provides rate limiting internally; no separate `RateLimit.apply` — it's automatic based on service configuration similar to circuit.ts pattern
- **ReplayGuard keeps specialized STM** — but shares Redis client from CacheService; no duplicate connections or configs
- **CacheService exposes Redis client** — `CacheService.redis` available for specialized services (ReplayGuard) that need direct access
- **SessionService stays separate** — owns auth flow logic; not absorbed into CacheService
- **Resilience stays as utilities** — circuit.ts and resilience.ts remain utilities in /utils; CacheService and StreamingService use them internally

### Code quality standards
- **Polymorphic unity** — one polymorphic function per concern (like MetricsService.label); no function/const spam
- **Dense Effect.Service classes** — all logic internalized via static methods; no loose const exports
- **Advanced TS inference** — no loose type exports; use inferred types, inline types, branded schemas
- **Maximum 1 helper** — ideally zero; if absolutely needed, one internal helper maximum per file
- **Internalized intelligence** — logic is private and automatic; minimal API surface for consumers

### Roadmap preparation
- **Phase 1 enables Phase 2** — CacheService + StreamingService become building blocks for layer consolidation
- **Full migration in Phase 1** — refactor rate-limit.ts and totp-replay.ts to use CacheService; clean break
- **Prepare for Phase 3 workers** — StreamingService API designed to support offloading to workers; understand @effect/platform worker APIs, Effect.Workflow, SerializedWorkerPool before designing

</decisions>

<specifics>
## Specific Ideas

- Follow MetricsService polymorphic pattern exactly: single service class, static methods, internal logic, polymorphic label function
- Circuit.ts is the model for utility structure: const+namespace merge, typed config, registry pattern
- Look at how rate-limit.ts currently uses @effect/experimental RateLimiterStore — CacheService should provide equivalent capability without separate store concept
- "No handrolling" — use official Effect APIs: @effect/experimental for Redis, Effect.Cache for deduplication, Stream for backpressure
- Tenant isolation already flows via FiberRef (Context.Request.tenantId) — services read it internally

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-platform-api-adoption*
*Context gathered: 2026-01-27*
