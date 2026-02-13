# Architecture

**Analysis Date:** 2026-02-13

## Pattern Overview

**Overall:** Layered monorepo (Platform → Services → HTTP) with Effect-powered composition.

**Key Characteristics:**
- **Effect-first:** All async/IO/errors via Effect runtime; no try/catch or promises.
- **Schema-driven:** Single source of truth; types derived from schemas (not declared separately).
- **Service-oriented:** Effect.Service with Effect.Tag for dependency injection; Layer composition.
- **Cluster-aware:** Entity-based job routing via @effect/cluster; durable workflows via @effect/workflow.
- **Multi-tenant:** Request context (FiberRef) carries tenant isolation; session/API key validation.
- **Observable:** OTLP telemetry, structured logging, span-based metrics integration.

## Layers

**Platform Layer:**
- Purpose: External resources and low-level clients (database, storage, filesystem, telemetry).
- Location: `packages/server/src/platform/*`, `packages/database/src/*`
- Contains: Clients (PostgreSQL, S3, Redis), streaming adapters, WebSocket handlers, caching.
- Depends on: Node runtime, external SDKs (pg, aws-sdk).
- Used by: Services layer.

**Services Layer:**
- Purpose: Domain business logic (auth, storage, notifications, jobs, transfer, search).
- Location: `packages/server/src/domain/*`, `packages/server/src/infra/*`
- Contains: Effect.Service implementations, event publishing, job submission, cluster coordination.
- Depends on: Platform (database, cache, storage), observability (telemetry, metrics, audit).
- Used by: HTTP layer (routes).

**Infrastructure Layer:**
- Purpose: Cross-cutting runtime concerns (event bus, job processing, webhooks, email, cluster state).
- Location: `packages/server/src/infra/*`
- Contains: EventBus (in-memory pub/sub), JobService (workflow dispatch), TenantLifecycleService, WebhookService, StorageAdapter, EmailAdapter.
- Depends on: Services, platform.
- Used by: Services and HTTP for side effects.

**Observability Layer:**
- Purpose: Tracing, logging, metrics, audit trail, polling (health checks).
- Location: `packages/server/src/observe/*`
- Contains: Telemetry (span wrapper with auto-kind inference), MetricsService, AuditService (mutation tracking), PollingService (alert state).
- Depends on: OTLP, context (request metadata).
- Used by: All layers for instrumentation.

**Security Layer:**
- Purpose: Cryptography, TOTP validation, replay protection, authorization policies.
- Location: `packages/server/src/security/*`
- Contains: Crypto (AES-256-GCM), ReplayGuardService (TOTP cache + nonce), PolicyService (RBAC).
- Depends on: Cache (Redis), context (user/tenant).
- Used by: Auth, middleware.

**Middleware Layer:**
- Purpose: HTTP request pipeline: auth, CORS, rate limiting, tenant resolution, idempotency.
- Location: `packages/server/src/middleware.ts`
- Contains: Single Middleware class with `pipeline()` (request → context propagation) and `layer()` (auth lookups).
- Depends on: Database, cache, crypto, context.
- Used by: HTTP server setup in `apps/api/src/main.ts`.

**HTTP Layer (Routes):**
- Purpose: Request/response marshaling, OpenAPI contracts, endpoint implementations.
- Location: `apps/api/src/routes/*.ts`, `packages/server/src/api.ts`
- Contains: HttpApiGroup definitions (Auth, Users, Storage, etc.), route handlers (effect.gen bodies).
- Depends on: Services, middleware, errors.
- Used by: HttpApiBuilder (OpenAPI generation, client derivation).

**Database Layer:**
- Purpose: Schema, migrations, repositories, query building, search indexing.
- Location: `packages/database/src/*`, `packages/database/migrations/*`
- Contains: Models (User, Session, App, Asset, Job, etc.), repositories (active record pattern), field builders, search engine.
- Depends on: PostgreSQL, drizzle-orm.
- Used by: Services via DatabaseService.

## Data Flow

**Request Flow (Unauthenticated):**

1. HTTP request arrives → middleware `_trace` (span start, extract headers).
2. Tenant resolution: extract from header or query → TenantResolution error if missing.
3. Session lookup: bearer token or API key → database or cache hit → FiberRef.set(RequestContext).
4. Rate limiting: check limit against cache key (user/IP).
5. Route handler runs with context available.
6. Response → middleware `CacheService.headers` (add security headers) → Telemetry span closed.

**Request Flow (Authenticated with MFA):**

1. OAuth callback → Auth.oauthCallback() validates provider and state.
2. User created/updated in database.
3. If MFA enabled: return `mfaPending: true`.
4. If MFA verification pending: subsequent requests see `session.verifiedAt: null`.
5. MFA verify endpoint checks TOTP code (ReplayGuardService prevents replay).
6. On success: update `verifiedAt` timestamp → session fully active.

**Job Submission and Processing:**

1. Service calls `JobService.submit(type, payload, priority)`.
2. Job entity routes to shard via ClusterWorkflowEngine.
3. Workflow activity executes with automatic retry (backoff: 100ms base, 5 attempts).
4. On success: status = 'complete', emit JobCompletedEvent.
5. On failure: status = 'failed' → move to DLQ (JobDlq table).
6. DLQ watcher (runs every 5 min) auto-replays up to 3 times, then emits DlqAlertEvent.
7. Heartbeat cache key (`job:heartbeat:{id}`) tracks staleness (30s threshold).

**State Management:**

- **Request Context:** FiberRef → immutable during request lifetime → `Context.Request.current` + `Context.Request.withinSync(tenantId, effect)`.
- **Session Cache:** Auth.Service owns LRU (5000 capacity, 5min TTL) for session lookup → reduces database round-trips.
- **Job State:** Stored in database (`jobs` table) + heartbeat cache → persistent across restarts.
- **Event State:** EventBus (in-memory) publishes mutations → WebSocketService broadcasts to subscribers → Tenant listeners filter by appId.
- **Rate Limit State:** Cache key per user+IP → incremented on each request → reset after window.

**Search Indexing:**

1. Full-text index via PostgreSQL pg_trgm.
2. Semantic search via embeddings (AI runtime generates vectors).
3. Refresh triggered by cron (SearchService.EmbeddingCron runs hourly) or admin endpoint.
4. Multi-channel ranking: full-text score + trgm similarity + semantic cosine distance.

## Key Abstractions

**Context.Request (Unified Request Context):**
- Purpose: Carry tenant ID, session, rate limit state, cluster shard info, circuit breaker state.
- Examples: `packages/server/src/context.ts`
- Pattern: FiberRef-backed tags; serializable for cluster propagation.
- Usage: `Context.Request.current`, `Context.Request.withinSync(tenantId, effect)`.

**Auth.Service (Unified Authentication):**
- Purpose: OAuth flows, session lifecycle, MFA enrollment, passkey support, token rotation.
- Examples: `packages/server/src/domain/auth.ts`
- Pattern: Effect.Service with static layer (`Auth.Service.Default`); cacheable session lookups.
- Usage: Middleware calls `auth.session.lookup(hash)` for bearer tokens.

**HttpError (Domain Errors):**
- Purpose: Recoverable, typed errors with HTTP status codes.
- Examples: `packages/server/src/errors.ts` (Auth, Forbidden, Conflict, etc.)
- Pattern: Schema.TaggedError with static `of()` factories; serializes to HTTP response.
- Usage: Route handlers fail with `HttpError.NotFound.of('User', id)` → caught by middleware.

**JobService (Workflow Dispatch):**
- Purpose: Entity-based job routing and durable execution.
- Examples: `packages/server/src/infra/jobs.ts`
- Pattern: Mailbox entity with ClusterWorkflowEngine; activities are pure Effect functions.
- Usage: `jobService.submit('email.send', { to, subject }, 'normal')` → routed to shard → retried on failure.

**EventBus (Pub/Sub):**
- Purpose: In-memory event publishing for cross-service coordination.
- Examples: `packages/server/src/infra/events.ts`
- Pattern: Message-driven; WebSocketService subscribes to tenant-scoped topics.
- Usage: `eventBus.publish({ tenantId, aggregateId, payload })` → WebSocket listeners see real-time updates.

**Telemetry.span (Observable Effect):**
- Purpose: Lightweight instrumentation with auto-inferred SpanKind and context capture.
- Examples: `packages/server/src/observe/telemetry.ts`
- Pattern: Dual-argument function; wraps effect with span, attaches request context, annotates errors.
- Usage: `Telemetry.span('auth.oauth.callback', { kind: 'server' })(effect)`.

**DatabaseService (Repository Access):**
- Purpose: Single entry point for all database operations via repositories.
- Examples: `packages/database/src/repos.ts`
- Pattern: Object of objects (users, sessions, apps, etc. as properties); each repo is active-record style.
- Usage: `database.users.byId(userId)`, `database.jobs.byStatus('queued')`.

**CacheService (Redis Wrapper):**
- Purpose: KV store and rate-limit set operations.
- Examples: `packages/server/src/platform/cache.ts`
- Pattern: Dual instance/static access; instance for no-dependency R, static for service injection.
- Usage: `cache.kv.set('key', value)` or `CacheService.kv.set(...)`.

## Entry Points

**HTTP Server:**
- Location: `apps/api/src/main.ts`
- Triggers: `pnpm nx dev api` or Docker entrypoint.
- Responsibilities: Layer composition (Platform → Services → HTTP → Server), middleware setup, graceful shutdown.

**Database Migration:**
- Location: `apps/api/src/migrate.ts`
- Triggers: `pnpm nx migrate api` or Kubernetes init container.
- Responsibilities: Run pending migrations via drizzle.

**Test Harness:**
- Location: `apps/test-harness/src/`
- Triggers: Dev server for manual testing.
- Responsibilities: Dev UI with live component preview.

## Error Handling

**Strategy:** Errors are values; Effect error channel (not exceptions).

**Patterns:**

- **Domain Errors:** Use `HttpError` (Schema.TaggedError) for recoverable failures (e.g., NotFound, Conflict). Caught and mapped to HTTP status.
- **Auth Errors:** AuthError (custom tagged union) for OAuth/session failures. Rate-limited at callback. Mapped to HttpError or logged.
- **Database Errors:** SqlError from @effect/sql. Mapped to HttpError.Internal or caught per operation.
- **Cluster Errors:** RpcClientError on shard unavailability. Caught by JobService, moved to DLQ, auto-replayed.
- **Validation Errors:** Schema.decode failures. Caught by HttpApiBuilder, mapped to HttpError.Validation.

## Cross-Cutting Concerns

**Logging:** Structured via Effect.log* functions. Telemetry layer routes to OTLP or console. LogLevel configured via LOG_LEVEL env var.

**Validation:** Schema-first at boundaries. `decode` at request entry (middleware), schema derivation via `pick`/`omit` at call sites.

**Authentication:** Two-phase: session lookup (middleware) → per-endpoint checks (Middleware.middleware) + role-based policy (PolicyService).

**Rate Limiting:** Cache-backed counter per key (user+IP). Incremented on every request. Returns 429 with Retry-After header. Configurable thresholds per endpoint.

**Observability:** Spans auto-created for named functions (Effect.fn). OTLP export configured via OTEL_* env vars. Metrics integrated: RPC latency, error rates by type, job processing times.

**Tenant Isolation:** FiberRef-backed context propagates tenant ID. Middleware validates headers. Database queries filtered by `appId` (foreign key).

---

*Architecture analysis: 2026-02-13*
