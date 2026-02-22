# Architecture

**Analysis Date:** 2026-02-22

## Pattern Overview

**Overall:** Layered Effectful Monolith with Cluster-Aware Infrastructure

**Key Characteristics:**
- Effect-first architecture — all IO, concurrency, and errors flow through Effect's runtime; no `async/await` or `try/catch`
- Schema-First design — `@effect/sql` `Model.Class` definitions in `packages/database/src/models.ts` are the single source of truth; all TypeScript types are derived via `typeof XSchema.Type`
- Three-tier layer composition in `apps/api/src/main.ts`: PlatformLayer → ServicesLayer → ServerLayer; each tier is a composable `Layer` resolved at startup
- Functional Core, Effectful Shell — pure domain transformations in domain services; Effect wraps IO and dependencies only
- Multi-tenant isolation via PostgreSQL `set_config('app.current_tenant', tenantId, true)` scoped per-query inside the repository factory

## Layers

**Platform Layer:**
- Purpose: External resource initialization (DB connection, S3, filesystem, telemetry collector)
- Location: `apps/api/src/main.ts` — `const PlatformLayer`
- Contains: `Client.layerFromConfig`, `StorageAdapter.S3ClientLayer`, `NodeFileSystem.layer`, `Telemetry.Default`, `Env.Service`
- Depends on: Environment variables via `Env.Service`
- Used by: ServicesLayer via `Layer.provideMerge(PlatformLayer)`

**Services Layer:**
- Purpose: All application services in topological dependency order
- Location: `apps/api/src/main.ts` — `const ServicesLayer`, composed from `CoreServicesLayer`, `ServiceCronsLayer`, `ServiceInfraLayer`
- Contains: 20+ Effect services including `Auth.Service`, `FeatureService`, `JobService`, `EventBus`, `ClusterService`, `CacheService`, `Resilience.Layer`, `WebSocketService`, `WebhookService`, `PolicyService`, `DopplerService`
- Depends on: PlatformLayer
- Used by: ServerLayer (HTTP route handlers consume services via `yield* ServiceName`)

**Server Layer:**
- Purpose: HTTP server with middleware pipeline, CORS, auth, graceful shutdown
- Location: `apps/api/src/main.ts` — `const ServerLayer`
- Contains: `Middleware.layer`, `HttpApiBuilder.serve`, `HttpApiSwagger.layer`, route layers, `NodeHttpServer`
- Depends on: ServicesLayer
- Used by: `NodeRuntime.runMain` entry point

**Route Layer:**
- Purpose: Thin HTTP adapters — delegate all business logic to domain services
- Location: `apps/api/src/routes/` — one file per route group (`admin.ts`, `auth.ts`, `users.ts`, `search.ts`, `storage.ts`, `webhooks.ts`, `websocket.ts`, `health.ts`, `jobs.ts`, `audit.ts`, `telemetry.ts`, `transfer.ts`)
- Contains: `HttpApiBuilder.group` implementations, one `Live` layer per file
- Depends on: Domain services, `Middleware.resource`, `Context.Request`
- Used by: `RouteLayer = Layer.mergeAll(...)` in `main.ts`

**Domain Layer:**
- Purpose: Business logic — authentication, feature flags, notifications, storage, data transfer
- Location: `packages/server/src/domain/` — `auth.ts`, `features.ts`, `notifications.ts`, `storage.ts`, `transfer.ts`
- Contains: `Effect.Service` classes with scoped generators; nested closures over injected deps
- Depends on: `packages/database`, `packages/server/src/platform/`, `packages/server/src/observe/`
- Used by: Route handlers via `yield* Auth.Service`, `yield* FeatureService`, etc.

**Infrastructure Layer:**
- Purpose: Cross-cutting infra concerns — cluster coordination, job engine, event bus, email, webhooks, object storage
- Location: `packages/server/src/infra/` — `cluster.ts`, `jobs.ts`, `events.ts`, `email.ts`, `webhooks.ts`, `storage.ts`, plus `handlers/` (purge, tenant-lifecycle)
- Contains: `ClusterService` (shard coordination via `@effect/cluster`), `JobService` (durable workflow via `@effect/workflow`), `EventBus` (journal → PubSub fan-out via `@effect/sql` + PostgreSQL LISTEN/NOTIFY)
- Depends on: Database, Cache, Cluster, Resilience
- Used by: Domain services and route handlers

**Platform Services Layer:**
- Purpose: Stateful platform primitives — caching, secrets, streaming, WebSocket
- Location: `packages/server/src/platform/` — `cache.ts`, `doppler.ts`, `streaming.ts`, `websocket.ts`
- Contains: `CacheService` (Redis/ioredis with rate limiting via `@effect/experimental`), `DopplerService` (secret rotation), `StreamingService`, `WebSocketService`
- Depends on: `Env`, Redis (ioredis), `@effect/experimental`
- Used by: Domain services, auth, middleware

**Observability Layer:**
- Purpose: Telemetry, metrics, audit logging, polling
- Location: `packages/server/src/observe/` — `telemetry.ts`, `metrics.ts`, `audit.ts`, `polling.ts`
- Contains: `Telemetry` (OTLP export via `@effect/opentelemetry`; span wrapper with auto-inferred `SpanKind` from name prefix), `MetricsService`, `AuditService`, `PollingService`
- Depends on: Env, Context.Request, Database
- Used by: All domain and infra services

**Security Layer:**
- Purpose: Cryptography, RBAC policy enforcement, TOTP replay guard
- Location: `packages/server/src/security/` — `crypto.ts`, `policy.ts`, `totp-replay.ts`
- Contains: `Crypto.Service`, `PolicyService` (RBAC cache with EventBus invalidation), `ReplayGuardService`
- Depends on: Database, CacheService, EventBus
- Used by: Auth domain, middleware

**Database Layer:**
- Purpose: PostgreSQL connection pool, polymorphic repository factory, ORM-like models, keyset pagination, schema search
- Location: `packages/database/src/` — `client.ts`, `factory.ts`, `models.ts`, `repos.ts`, `field.ts`, `page.ts`, `search.ts`
- Contains: `Client` (PgClient Layer), `repo()` factory (predicate-based CRUD, OCC, soft-delete, scoped tenant), `DatabaseService` (batched repositories), `SearchRepo` (pgvector + trigram)
- Depends on: `@effect/sql-pg`, `effect`
- Used by: All server-side services via `yield* DatabaseService`

**AI Layer:**
- Purpose: LLM runtime, embedding model, semantic search
- Location: `packages/ai/src/` — `runtime.ts`, `runtime-provider.ts`, `registry.ts`, `mcp.ts`, `search.ts`, `errors.ts`
- Contains: `AiRuntime` (budget-gated LLM calls via `@effect/ai`), `AiRuntimeProvider` (provider config), `SearchService` (vector embedding + pgvector queries)
- Depends on: `@effect/ai`, Database, CacheService
- Used by: `apps/api` via `SearchLive` route group

**Frontend Runtime Layer:**
- Purpose: Effect integration in browser React apps
- Location: `packages/runtime/src/` — `runtime.ts`, `effect.ts`, `browser.ts`, `messaging.ts`, `stores/`
- Contains: React hooks wrapping Effect (`useEffectRun`, `useEffectMutate`, `useEffectSuspense`), `ManagedRuntime`, CSS sync, URL helpers
- Depends on: `effect`, React 19
- Used by: Frontend apps (test-harness) and components

**Kargadan Agent System:**
- Purpose: Workflow-driven agentic loop integrating with CAD software (Rhino) via a C# plugin over WebSocket
- Location: `apps/kargadan/` — `harness/` (TypeScript) + `plugin/` (C#)
- Contains: `AgentLoop` service (`PLAN→EXECUTE→VERIFY→PERSIST→DECIDE` recursive loop), WebSocket protocol (MessagePack), `KargadanPlugin.cs` (Rhino plugin), `SessionHost.cs` (transport layer)
- Depends on: `packages/types/src/kargadan/`, WebSocket via `apps/api` routes
- Used by: External Rhino/CAD sessions connecting via WS

**C# Analyzer:**
- Purpose: Roslyn-based static analyzer enforcing 58 custom CSP rules on C# source
- Location: `apps/cs-analyzer/` — `Kernel/` (state, catalog, symbol facts), `Rules/` (FlowRules, RuntimeRules, ShapeRules, TypeShapeRules), `Contracts/` (boundary exemptions)
- Contains: `RuleCatalog.cs`, `AnalyzerState.cs`, `SymbolFacts.cs`; rules categorized as Flow, Runtime, Shape, TypeShape
- Depends on: Roslyn Analyzers SDK
- Used by: .NET build pipeline for all C# projects

## Data Flow

**HTTP Request Flow:**

1. Request arrives at `NodeHttpServer` (port from `Env.app.port`)
2. `Middleware.pipeline(database)` runs: tenant resolution (X-App-Id → DB lookup), session/API key auth, rate limiting, idempotency check, CORS, request context population into `Context.Request` FiberRef
3. `HttpApiBuilder.serve` dispatches to matching route group handler in `apps/api/src/routes/`
4. Route handler yields domain/infra services (`yield* Auth.Service`, etc.) and delegates business logic
5. Domain service executes Effect pipelines, reads/writes via `DatabaseService`, publishes events via `EventBus`
6. Response serialized via `HttpApiBuilder` schema-typed endpoints; errors mapped to `HttpError.*` types
7. `Telemetry.span` wraps each operation; OTLP exported to Grafana Alloy

**Event Flow:**

1. Domain service calls `eventBus.emit(event)` → `SqlEventJournal.append` (durable, PostgreSQL)
2. `EventBus` publishes to local in-process `PubSub`
3. PostgreSQL `NOTIFY` broadcasts `{ eventId, sourceNodeId }` to all cluster pods
4. Remote pods receive via `LISTEN`, fetch event from journal by ID (deduped by `PrimaryKey`)
5. Subscribers receive typed `EventEnvelope`; validation failure → DLQ (terminal, no retry)
6. DLQ watcher (leader-only via `ClusterService.isLocal()`) replays with exponential backoff

**Job Flow:**

1. Client or service submits job via `JobService.submit`
2. `@effect/cluster` routes to entity via shard assignment; mailbox queues work
3. `@effect/workflow` durable execution: activities, compensation, state persistence in DB
4. `ClusterService` coordinates leader election; `DLQ watcher` runs on leader only
5. Job status updates streamed to client via SSE (`StorageService.stream`)

**Agent Loop (Kargadan):**

1. Rhino plugin (`KargadanPlugin.cs`) establishes WebSocket session via `SessionHost.cs`
2. Harness receives `handshake.init` → server responds `handshake.ack` with accepted capabilities
3. `AgentLoop` runs `PLAN→EXECUTE→VERIFY→PERSIST→DECIDE` recursively
4. `CommandDispatch` sends `CommandEnvelope` (MessagePack) to plugin over WS
5. Plugin executes Rhino API calls, returns `ResultEnvelope`
6. `loop-stages.ts` pure functions verify result, decide retry/correction/compensation/complete
7. `PersistenceTrace` records canonical state hash for idempotency

**State Management:**
- Server-side: `Context.Request` FiberRef holds per-request tenant/session state; propagated via `within()`/`withinSync()`
- Frontend: `packages/runtime/src/stores/` — Zustand-compatible stores via Effect ManagedRuntime
- Cache: `CacheService` Redis-backed `PersistedCache` (`@effect/experimental`); invalidation via EventBus + cross-pod Redis pub/sub

## Key Abstractions

**`Effect.Service` Pattern:**
- Purpose: Dependency injection without DI containers; services declare dependencies inline
- Examples: `packages/server/src/domain/auth.ts`, `packages/server/src/observe/audit.ts`, `packages/server/src/platform/cache.ts`
- Pattern: `class X extends Effect.Service<X>()('namespace/X', { scoped: Effect.gen(function* () { ... }) }) {}`; scoped generator yields all deps once, defines capability object

**`repo()` Factory:**
- Purpose: Polymorphic repository — single function generates typed CRUD surface with scoping, OCC, soft-delete, pagination, and custom DB functions
- Examples: All repositories in `packages/database/src/repos.ts`
- Pattern: `repo(Model, 'table_name', { pk, scoped, resolve, conflict, purge, functions })` → Effect resolving to repo surface

**`Middleware.resource()`:**
- Purpose: DSL for consistent route-level rate limiting, idempotency, and telemetry
- Examples: `apps/api/src/routes/auth.ts` — `authRoute.api('action', effect)`
- Pattern: `Middleware.resource('name').api('action', effect)` (read), `.mutation('action', effect)` (write), `.realtime('action', effect)` (stream)

**`HttpError.*`:**
- Purpose: 11 typed HTTP error classes as `Schema.TaggedError`; each has static `.of()` factory and `HttpApiSchema` annotations for OpenAPI
- Examples: `packages/server/src/errors.ts`
- Pattern: `HttpError.Auth.of('reason')` — caught by `@effect/platform` and serialized to typed HTTP response

**`DomainEvent` / `EventBus`:**
- Purpose: Durable event sourcing with cross-pod fan-out
- Examples: `packages/server/src/infra/events.ts`
- Pattern: `EventBus.emit(new DomainEvent({ aggregateId, payload, tenantId }))` → `SqlEventJournal` → `PubSub` → LISTEN/NOTIFY

**`Telemetry.span()`:**
- Purpose: Zero-ceremony OTLP tracing; auto-infers `SpanKind` from span name prefix; auto-captures errors
- Examples: `packages/server/src/observe/telemetry.ts`
- Pattern: `effect.pipe(Telemetry.span('auth.login', { metrics: false }))` — dual-argument curried function

**`Kargadan.CommandEnvelope` / `ResultEnvelope`:**
- Purpose: Type-safe WebSocket protocol shared between TypeScript harness and C# plugin
- Examples: `packages/types/src/kargadan/kargadan-schemas.ts` (TS schemas), `apps/kargadan/plugin/src/contracts/*.cs` (C# mirrors)
- Pattern: Schema-first in TS; C# contracts mirror field names exactly; decode at all inbound boundaries

## Entry Points

**API Server:**
- Location: `apps/api/src/main.ts`
- Triggers: `NodeRuntime.runMain` — runs at process start
- Responsibilities: Composes all layers, starts HTTP server, hooks graceful shutdown on interrupt

**API Schema / Contract:**
- Location: `packages/server/src/api.ts`
- Triggers: Imported by `apps/api/src/main.ts` and all route files
- Responsibilities: Defines `ParametricApi` (`HttpApi`) with all endpoint groups, request/response schemas, OpenAPI annotations; derives type-safe client

**Database Migrations:**
- Location: `packages/database/migrations/0001_initial.ts`
- Triggers: `apps/api/src/migrate.ts` — run separately before server start
- Responsibilities: Single initial migration; future migrations add sequentially numbered files

**Frontend App:**
- Location: `apps/test-harness/src/main.tsx`
- Triggers: Vite dev server / browser
- Responsibilities: Mounts React 19 app with Effect `ManagedRuntime`; calls API via type-safe `HttpApiClient`

**Kargadan Harness:**
- Location: `apps/kargadan/harness/src/runtime/agent-loop.ts` — `AgentLoop` service
- Triggers: WebSocket connection from Rhino plugin
- Responsibilities: Drives PLAN→EXECUTE→VERIFY→PERSIST→DECIDE loop until run completes or fails terminally

**Pulumi Infrastructure:**
- Location: `infrastructure/src/deploy.ts`
- Triggers: `pnpm exec nx run infrastructure:deploy`
- Responsibilities: Provisions EKS/Docker Compose resources; `runtimeProjection()` splits config vs secrets for container env

## Error Handling

**Strategy:** Typed error channels only — no `try/catch`, no `throw`, no generic `Error`

**Patterns:**
- Domain errors: `class XError extends S.TaggedError<XError>()('XError', { reason: S.Literal(...), cause: S.optional(S.Unknown) })` — recoverable via `catchTag`
- HTTP boundary errors: `class X extends S.TaggedError<X>()('X', { ... }, HttpApiSchema.annotations({ status: N }))` — serialized automatically by `@effect/platform`
- Infrastructure errors: `class X extends Data.TaggedError('X')<{ ... }>` — caught internally, mapped to domain or HTTP errors at service boundary
- `HttpError.mapTo('label')` wraps any effect to map non-HttpError exceptions to `Internal.of('label')`
- Defect (unexpected exception) handler in `ServerLayer`: catches all defects, logs, returns 500

## Cross-Cutting Concerns

**Logging:** `Effect.logInfo/logError/logWarning` — structured; OTLP-exported via `Telemetry.Default`

**Validation:** Decode at every inbound boundary via `S.decodeUnknown`; never trust raw data after the decode point

**Authentication:** `Middleware.pipeline` resolves session/API key on every request; populates `Context.Request.session`; route handlers access via `yield* Context.Request.current`

**Multi-tenancy:** `Client.tenant.with(tenantId, effect)` sets PostgreSQL `app.current_tenant` config for RLS; `Context.Request.tenantId` flows via FiberRef; `repo()` factory auto-injects tenant scope

**Resilience:** `Resilience.run(name, effect, { circuit, bulkhead, timeout, retry, hedge })` — composes Semaphore (bulkhead), timeout, hedge, retry schedule, and circuit breaker in a single call

---

*Architecture analysis: 2026-02-22*
