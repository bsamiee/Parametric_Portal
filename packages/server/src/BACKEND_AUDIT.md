# Backend Audit: Infrastructure Analysis

> Scope: `packages/server/` + `packages/database/` + `apps/api/`
> Date: 2026-02-05

---

## [1] MISSING FUNCTIONALITY

### [1.1] No Prometheus/Metrics Scrape Endpoint

`PollingService.snapshot` produces Prometheus-compatible metric snapshots (counters, gauges,
histograms, summaries, frequencies) — but **no HTTP endpoint exposes them**. All internal metrics
(cache hit ratios, DLQ sizes, circuit states, rate limit rejections, HTTP latencies) are collected
but invisible to external monitoring systems.

| What exists                                           | What's missing                               |
| ----------------------------------------------------- | -------------------------------------------- |
| `PollingService.snapshot` → full metric state         | `/metrics` endpoint for Prometheus scraping  |
| `MetricsService` → 24 metric categories               | Export format (OpenMetrics, Prometheus text) |
| `_stateToEntries()` → Prometheus-compatible transform | Grafana/Prometheus integration path          |

**Impact**: Blind to production health without OTLP collector. No fallback observability.

---

### [1.2] No Webhook Management Routes

`WebhookService` (299 lines) is a fully-built durable webhook delivery system with HMAC signatures,
dead-letter compensation, per-endpoint throttling, and settings cache. **Zero API routes expose it.**

| Built capability                   | HTTP exposure |
| ---------------------------------- | ------------- |
| `manage.list(tenantId)`            | None          |
| `manage.register(tenantId, input)` | None          |
| `manage.remove(tenantId, url)`     | None          |
| `test(tenantId, endpoint)`         | None          |
| `retry(dlqId)`                     | None          |
| `status(tenantId, url?)`           | None          |

The service is not even imported in `main.ts`. The `EventBus.onEvent()` stream feeds webhooks
internally, but tenants cannot register endpoints, view delivery status, or retry failures.

**Impact**: 299 lines of dead code. EventBus integration wired but unreachable.

---

### [1.3] No API Key Authentication Path

The database has full `api_keys` table with hash, encrypted token, prefix, expiry, soft-delete.
The API has endpoints to create/list/delete API keys. But **no middleware authenticates requests
using API keys** — only bearer token (session) auth exists.

| What exists                           | What's missing                                   |
| ------------------------------------- | ------------------------------------------------ |
| `api_keys` table + repo + CRUD routes | `X-API-Key` header middleware                    |
| `Crypto.hmac` for hash comparison     | API key → session context bridge                 |
| Rate limit config for `api` preset    | Key-based rate limiting (per-key vs per-session) |

The `_CONFIG.cors.allowedHeaders` includes `X-API-Key` — the header is anticipated but not consumed.

**Impact**: Programmatic API access impossible without OAuth session. API keys are write-only.

---

### [1.4] No Admin Operations Routes

The backend has full repository capabilities but exposes minimal admin surface:

| Missing route                         | Existing capability                                     |
| ------------------------------------- | ------------------------------------------------------- |
| `GET /users` (list/search users)      | `UserRepo.find()`, `UserRepo.byAppRole()`               |
| `GET /sessions` (active sessions)     | `SessionRepo.byUser()`, `SessionRepo.byIp()`            |
| `DELETE /sessions/:id` (force logout) | `SessionRepo.softDelete()`                              |
| `GET /jobs` (job queue state)         | `JobRepo.find()`, `JobRepo.one()`                       |
| `POST /jobs/:id/cancel`               | `JobService.cancel()`                                   |
| `GET /dlq` (dead letter queue)        | `JobDlqRepo.listPending()`, `JobDlqRepo.countPending()` |
| `POST /dlq/:id/replay`                | `JobDlqRepo.markReplayed()`                             |
| `GET /events` (event log)             | `EventBus.onEvent()` stream                             |
| `POST /sessions/revoke-ip`            | `SessionRepo.revokeByIp()` (DB function exists)         |
| `GET /apps` (list tenants)            | `AppRepo.find()`                                        |

**Impact**: No admin visibility into system state without direct DB access.

---

### [1.5] No Notification/Alerting Dispatch

`PollingService` detects critical conditions (DLQ > 1000, cache hit ratio < 90%) and persists
alerts to kvStore. But **alert detection triggers nothing** — no email, Slack, PagerDuty, or
webhook dispatch.

**Impact**: Alerts accumulate silently. Only visible via health endpoint `metrics` field.

---

### [1.6] No CSRF Token Provisioning

Auth routes validate CSRF via `X-Requested-With: XMLHttpRequest` header check. But there's
**no endpoint to obtain a CSRF token** — the implementation relies on the custom header approach
(which is valid), but there's no documentation or provisioning for clients that need traditional
CSRF tokens.

---

## [2] LOW QUALITY / BUGS

### [2.1] Cache Metrics Bug — Hits Counted as Misses

**File**: `cache.ts:170-171`

```
Effect.tapBoth({
  onFailure: () => MetricsService.inc(metrics.cache.misses, labels),
  onSuccess: () => MetricsService.inc(metrics.cache.misses, labels),  // BUG
})
```

Both success AND failure increment `cache.misses`. The `onSuccess` branch should increment
`cache.hits`. This means cache hit ratio metrics are always 0% regardless of actual performance.

**Severity**: HIGH — All cache monitoring is silently broken.

---

### [2.2] CORS Wildcard + Credentials Contradiction

**File**: `middleware.ts:26,28`

Default CORS: `allowedOrigins: ['*']` with `credentials: true`.

Per the Fetch spec, `Access-Control-Allow-Origin: *` is **incompatible** with
`Access-Control-Allow-Credentials: true`. Browsers will reject credentialed requests when origin
is wildcard. The middleware partially handles this (`credentials: !list.includes('*')` at line 158),
but the _default_ config object itself is contradictory — code reading `_CONFIG.cors` would
incorrectly assume credentials work with the default.

**Severity**: MEDIUM — Functional due to runtime fix, but misleading configuration.

---

### [2.3] Transfer Binary Size Validation Missing

**File**: `apps/api/src/routes/transfer.ts`

Text format entries are validated against `Transfer.limits.entryBytes`. Binary format entries
skip this check entirely — a single binary asset could exceed the per-entry limit.

**Severity**: LOW — Total file size limit still applies, but per-entry guardrail is absent.

---

### [2.4] WebSocket Rate Limit Mismatch

**File**: `apps/api/src/routes/websocket.ts`

WebSocket upgrade endpoint uses `api` rate limit preset (100 req/min). For a long-lived
connection protocol, the initial upgrade should use a permissive limit. Reconnection storms
(e.g., after server restart) could exhaust the rate limit and lock out legitimate clients.

**Severity**: LOW — Unlikely in normal operation, problematic under reconnection pressure.

---

## [3] UNFINISHED / PARTIAL FUNCTIONALITY

### [3.1] WebhookService — Complete But Disconnected

**Status**: 100% implementation, 0% integration.

The service has:
- Durable execution via `@effect/workflow`
- HMAC-SHA256 payload signing
- Per-endpoint semaphore throttling
- Dead-letter compensation with DLQ writes
- Settings cache with invalidation
- EventBus auto-dispatch on domain events
- Delivery status tracking (7-day TTL)
- Test delivery endpoint

Missing: Any route group in `api.ts`, any import in `main.ts`, any consumer anywhere.

---

### [3.2] StreamingService — 5 Capabilities, 1 Used

| Capability     | Lines | Consumers            |
| -------------- | ----- | -------------------- |
| `sse()`        | ~35   | 1 (`routes/jobs.ts`) |
| `ingest()`     | ~50   | 0                    |
| `emit()`       | ~45   | 0                    |
| `mailbox()`    | ~30   | 0                    |
| `state()`      | ~15   | 0                    |
| `toEventBus()` | ~20   | 0                    |

The service supports 6 wire formats (binary, msgpack, csv, json, ndjson, sse) for both ingest
and emit, plus reactive state management and mailbox queuing. Only SSE heartbeat streaming is
used by one endpoint.

**Impact**: ~160 lines of unreachable code. The ingest pipeline with circuit breaker protection
is the most sophisticated unused piece.

---

### [3.3] Resilience — Full Framework, 1 Call Site

| Feature                       | Lines | Consumers             |
| ----------------------------- | ----- | --------------------- |
| `Resilience.run()`            | ~60   | 1 (`streaming.ts:84`) |
| Decorator API `@Resilience()` | ~20   | 0                     |
| Hedge (parallel race)         | ~10   | 0                     |
| Memoize (TTL cache)           | ~15   | 0                     |
| Bulkhead (semaphore)          | ~20   | 0                     |
| Fallback                      | ~10   | 0                     |

The decorator API — the primary public interface — has zero consumers. No service method uses
`@Resilience()` decoration. The hedge, memoize, and bulkhead features have never been exercised.

Only `Resilience.run()` is called once, with default config (no hedge, no bulkhead, no memo).

---

### [3.4] PollingService.snapshot — Built, Never Exposed

The `snapshot` method converts all Effect metrics to Prometheus-compatible entries with proper
type mapping (counter, gauge, histogram, summary, frequency). It's defined, returned from the
service constructor, and never called by any consumer.

---

### [3.5] Database Client Monitoring — Polled, Never Exposed

| Function                             | Called by                    | Exposed via route |
| ------------------------------------ | ---------------------------- | ----------------- |
| `Client.monitoring.cacheHitRatio()`  | `PollingService.pollIoStats` | No                |
| `Client.monitoring.ioStats()`        | None                         | No                |
| `Client.monitoring.ioConfig()`       | None                         | No                |
| `Client.monitoring.statements()`     | None                         | No                |
| `DatabaseService.listStatStatements` | None                         | No                |

PG18.1 monitoring functions (`get_io_stats_by_backend`, `get_io_cache_hit_ratio`) exist in the
migration and client but have no admin surface.

---

## [4] UNDERUTILIZED CODE

### [4.1] Factory Repository Methods — Rich API, Narrow Usage

The polymorphic `repo()` factory provides 14 query/mutation methods. Actual usage across all
route handlers:

| Method                 | Defined | Used in routes               |
| ---------------------- | ------- | ---------------------------- |
| `by(key, value)`       | Yes     | Extensively                  |
| `find(pred)`           | Yes     | Moderate                     |
| `one(pred)`            | Yes     | Extensively                  |
| `page(pred, opts)`     | Yes     | Moderate (audit, search)     |
| `count(pred)`          | Yes     | Rare (DLQ only)              |
| `exists(pred)`         | Yes     | Never in routes              |
| `agg(pred, spec)`      | Yes     | **Never**                    |
| `stream(pred)`         | Yes     | **Never**                    |
| `pageOffset(pred)`     | Yes     | **Never**                    |
| `put(data)`            | Yes     | Extensively                  |
| `set(target, updates)` | Yes     | Moderate                     |
| `drop(target)`         | Yes     | Moderate                     |
| `lift(target)`         | Yes     | Never in routes (only repos) |
| `upsert(data)`         | Yes     | Moderate (auth)              |
| `merge(data)`          | Yes     | **Never**                    |
| `withTransaction`      | Yes     | **Never in routes**          |

**Opportunity**: `agg()` could replace manual COUNT queries. `stream()` could handle large
export operations more efficiently. `merge()` with its action tracking (`inserted`/`updated`)
could simplify upsert-heavy flows. `withTransaction` should wrap multi-repo mutations.

---

### [4.2] Circuit Breaker — Only Used Via Resilience (Which Is Barely Used)

`Circuit` (205 lines) supports three breaker types (consecutive, count, sampling), GC for idle
circuits, stats reporting, and manual isolation. Its only consumer is `Resilience._run()`, which
is called once.

External calls that should be circuit-protected but aren't:
- OAuth token exchange (`auth.ts` — direct HTTP calls to providers)
- S3 operations (`storage.ts` — SDK calls with no circuit)
- OTLP collector export (telemetry.ts — uses its own ad-hoc circuit)
- Database health checks (health.ts — raw queries)

**Opportunity**: Wrap all external I/O boundaries with `Circuit.make()` or `Resilience.run()`.

---

### [4.3] EventBus — Internal-Only Event System

`EventBus` is well-used internally (jobs, webhooks, websocket emit events). But:
- No external subscription API (SSE/WebSocket event stream for clients)
- No event replay endpoint
- No event filtering/projection for consumers
- Webhook delivery is the only automated response to events

**Opportunity**: Expose `EventBus.onEvent()` via SSE endpoint for real-time admin monitoring.

---

### [4.4] Database Purge Functions — Scheduled But Not Configurable

Eight purge jobs run on fixed schedules with hardcoded retention periods:

| Resource       | Retention | Schedule | Configurable |
| -------------- | --------- | -------- | ------------ |
| Sessions       | 30d       | Nightly  | No           |
| API Keys       | 365d      | Weekly   | No           |
| Assets         | 30d       | 6-hourly | No           |
| OAuth Accounts | 90d       | Weekly   | No           |
| MFA Secrets    | 90d       | Weekly   | No           |
| KV Store       | 90d       | Weekly   | No           |
| Job DLQ        | 30d       | Nightly  | No           |
| Event Journal  | 30d       | Nightly  | No           |

No admin control: cannot adjust retention, trigger manual purge, or exclude specific records.

---

### [4.5] Cluster Capabilities — Minimal Singleton Usage

`ClusterService` provides:
- Entity sharding with consistent-hash routing
- Singleton management with state persistence + migration
- Cron scheduling on leader
- K8s-aware discovery

Actual usage:
- 3 crons (DLQ polling, IO stats, purge)
- 1 singleton (audit DLQ replay)
- 0 stateful singletons (the migration system is unused)
- 0 K8s-specific features in routes

**Opportunity**: Rate limiting could be cluster-coordinated. Session management could use
entity sharding for cross-pod affinity.

---

### [4.6] Transactions — Available But Never Used at API Level

`DatabaseService.withTransaction` is defined and exported but never called from any route
handler. Multi-step mutations (create user + create session, import assets + refresh search)
execute as independent operations without transactional guarantees.

**Impact**: Partial failure states possible during multi-step mutations.

---

## [5] SUMMARY MATRIX

| #   | Category  | Item                          | Severity | LOC Affected         |
| --- | --------- | ----------------------------- | -------- | -------------------- |
| 1.1 | Missing   | Metrics scrape endpoint       | HIGH     | ~40 new              |
| 1.2 | Missing   | Webhook management routes     | HIGH     | ~80 new              |
| 1.3 | Missing   | API key auth middleware       | HIGH     | ~50 new              |
| 1.4 | Missing   | Admin operations routes       | MEDIUM   | ~200 new             |
| 1.5 | Missing   | Alert dispatch system         | MEDIUM   | ~60 new              |
| 1.6 | Missing   | CSRF provisioning docs        | LOW      | ~5 new               |
| 2.1 | Bug       | Cache hits counted as misses  | HIGH     | 1 line fix           |
| 2.2 | Quality   | CORS wildcard + credentials   | MEDIUM   | Config clarification |
| 2.3 | Quality   | Binary transfer size check    | LOW      | ~5 lines             |
| 2.4 | Quality   | WebSocket rate limit          | LOW      | Config change        |
| 3.1 | Partial   | WebhookService disconnected   | HIGH     | ~80 integration      |
| 3.2 | Partial   | StreamingService (5/6 unused) | MEDIUM   | —                    |
| 3.3 | Partial   | Resilience decorator unused   | MEDIUM   | —                    |
| 3.4 | Partial   | Metrics snapshot unexposed    | MEDIUM   | ~20 integration      |
| 3.5 | Partial   | DB monitoring unexposed       | LOW      | ~30 integration      |
| 4.1 | Underused | Factory repo methods          | MEDIUM   | Adoption             |
| 4.2 | Underused | Circuit breaker               | MEDIUM   | Adoption             |
| 4.3 | Underused | EventBus (internal only)      | MEDIUM   | ~40 new              |
| 4.4 | Underused | Purge configuration           | LOW      | ~30 new              |
| 4.5 | Underused | Cluster singletons            | LOW      | Adoption             |
| 4.6 | Underused | Transactions at API level     | MEDIUM   | Adoption             |

---

## [6] PRIORITY ACTIONS (Infrastructure Value)

**Immediate** (bugs/broken metrics):
1. Fix `cache.ts:170` — `onSuccess` should increment `cache.hits`, not `cache.misses`
2. Clarify CORS config defaults

**High value** (unlock existing code):
3. Add `/api/metrics` endpoint exposing `PollingService.snapshot`
4. Add webhook management route group (connect WebhookService)
5. Add API key authentication middleware (validate `X-API-Key` header)
6. Wrap multi-step route mutations in `withTransaction`

**Medium value** (operational visibility):
7. Add admin routes for users, sessions, jobs, DLQ
8. Apply `Resilience.run()` to OAuth, S3, and external HTTP calls
9. Add configurable retention periods for purge jobs
10. Expose EventBus as admin SSE stream
