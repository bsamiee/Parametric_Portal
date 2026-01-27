---
phase: 01-platform-api-adoption
plan: 01
subsystem: platform
tags: [cache, redis, rate-limit, effect-service]

dependency-graph:
  requires: []
  provides: [CacheService, L1-L2-cache, rate-limiting, redis-pubsub]
  affects: [01-02, 01-03, rate-limit-migration]

tech-stack:
  added: []
  patterns: [Effect.Service, scoped-resources, FiberRef-auto-scope, pub-sub-invalidation]

key-files:
  created:
    - packages/server/src/platform/cache.ts
  modified: []

decisions:
  - key: effect-service-pattern
    choice: "Effect.Service class with static methods"
    reason: "Follows MetricsService polymorphic pattern for consistent API surface"
  - key: l1-l2-architecture
    choice: "Effect.Cache for L1, manual Redis for L2"
    reason: "PersistedCache too complex; simpler approach with manual get/set for Redis"
  - key: auto-scope-keys
    choice: "Read tenantId/userId from FiberRef automatically"
    reason: "Consumers never pass namespace - service derives from context"
  - key: rate-limit-integration
    choice: "Static rateLimit method using @effect/experimental/RateLimiter"
    reason: "Integrated rate limiting without separate RateLimit.apply"

metrics:
  duration: "8 minutes"
  completed: "2026-01-27"
---

# Phase 01 Plan 01: CacheService Platform Summary

**One-liner:** L1/L2 tiered cache service with auto-scope from FiberRef, integrated rate limiting, and Redis pub/sub invalidation.

## What Was Built

CacheService as a proper Effect.Service class following the MetricsService polymorphic pattern:

- **L1 cache:** Effect.Cache per domain for in-memory deduplication
- **L2 cache:** Redis with automatic write-behind from L1 misses
- **Auto-scope:** Keys automatically prefixed with tenantId and userId from FiberRef context
- **Pub/sub invalidation:** Cross-instance cache invalidation via Redis channel
- **Rate limiting:** Integrated presets (api, auth, mfa, mutation) via static method
- **Redis access:** Exposed Redis client for specialized services (ReplayGuard)

## Key Implementation Details

### Static Methods

| Method | Purpose |
|--------|---------|
| `CacheService.get(domain, lookup)` | Returns curried function `(key) => Effect<Option<V>>` with L1/L2 tiering |
| `CacheService.invalidate(domain, key)` | Clears L1, L2, and broadcasts to other instances |
| `CacheService.health()` | Returns `{ l1: boolean, l2: boolean }` |
| `CacheService.rateLimit(preset)` | Consumes rate limit via integrated RateLimiter |
| `CacheService.redis` | Exposes Redis client for direct access |
| `CacheService.Layer` | Composed layer with RateLimiter store |

### Polymorphic Unity

- Zero helper functions (constraint: max 1)
- All logic internalized via static methods
- MetricsService integration via `Effect.serviceOption(MetricsService)`

### Resource Management

- Separate Redis connections: `_pub` for commands, `_sub` for subscriptions
- `Effect.addFinalizer` for proper cleanup (disconnect, unsubscribe)
- Graceful degradation: warns if Redis unavailable, continues memory-only

## Decisions Made

1. **Effect.Cache for L1, not PersistedCache:** Simpler approach per orchestrator guidance
2. **Ternary-based control flow:** No `if` statements (lint constraint)
3. **Option.match chains:** Functional control flow for L1/L2/miss paths
4. **err.reason === 'Exceeded':** Type narrowing for RateLimiterError union

## Deviations from Plan

None - plan executed exactly as written.

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `packages/server/src/platform/cache.ts` | CacheService implementation | 556 |

## Next Phase Readiness

- CacheService ready for consumer migration (rate-limit.ts, totp-replay.ts)
- Redis client exposed for ReplayGuard integration
- Layer composable with existing service layers

## Commits

| Hash | Message |
|------|---------|
| `a526e2a` | feat(01-01): create CacheService with L1/L2 tiering architecture |
