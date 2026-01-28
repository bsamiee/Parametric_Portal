# Architecture

**Analysis Date:** 2026-01-28

## Pattern Overview

**Overall:** Effect-TS Layered Architecture with Domain-Driven Design

**Key Characteristics:**
- Effect-based functional architecture with explicit dependency injection via Layer composition
- Strict layer hierarchy enforced through ManagedRuntime and Layer.provideMerge chains
- Schema-first design with @effect/schema as single source of truth for types
- HTTP API built with @effect/platform HttpApiBuilder, type-safe client derivation from server contract
- Multi-tenant isolation via FiberRef context propagation through request lifecycle

## Layers

**Platform Layer:**
- Purpose: External resource adapters (database, S3, filesystem, telemetry)
- Location: Composed in `apps/api/src/main.ts` lines 49-54
- Contains: SqlClient (PostgreSQL), S3 client, FileSystem, OpenTelemetry
- Depends on: Nothing (bottom layer)
- Used by: BaseInfra layer

**BaseInfra Layer:**
- Purpose: Database repositories, search indexing, cryptographic utilities
- Location: `apps/api/src/main.ts` lines 55-61
- Contains: DatabaseService, SearchRepo, MetricsService, Crypto, RequestContext
- Depends on: Platform layer
- Used by: Cache layer

**Cache Layer:**
- Purpose: Redis-backed caching and rate limiting
- Location: `apps/api/src/main.ts` lines 62-64
- Contains: CacheService, RateLimiter
- Depends on: BaseInfra layer
- Used by: Data layer

**Data Layer:**
- Purpose: TOTP replay protection using Redis
- Location: `apps/api/src/main.ts` lines 65-67
- Contains: ReplayGuardService
- Depends on: Cache layer
- Used by: Core layer

**Core Layer:**
- Purpose: Infrastructure services and audit logging
- Location: `apps/api/src/main.ts` lines 68-71
- Contains: StorageAdapter (S3), AuditService
- Depends on: Data layer
- Used by: Auth layer

**Auth Layer:**
- Purpose: Authentication and authorization services
- Location: `apps/api/src/main.ts` lines 72-75
- Contains: MfaService, OAuthService
- Depends on: Core layer
- Used by: Domain layer

**Domain Layer:**
- Purpose: Business logic services
- Location: `apps/api/src/main.ts` lines 76-82
- Contains: SessionService, StorageService, SearchService, JobService, PollingService
- Depends on: Auth layer (includes all lower layers via provideMerge chain)
- Used by: HTTP layer

**HTTP Layer:**
- Purpose: HTTP API endpoints and middleware
- Location: `apps/api/src/main.ts` lines 94-100
- Contains: SessionAuthLayer, RouteLayer (all route handlers), ApiLayer
- Depends on: Domain layer
- Used by: Server layer

## Data Flow

**Request Ingress:**

1. HTTP request arrives at NodeHttpServer (line 124 in `apps/api/src/main.ts`)
2. Middleware pipeline executes in order:
   - xForwardedHeaders: Extract client IP from proxy headers
   - makeRequestContext: Initialize tenant isolation (FiberRef)
   - trace: OpenTelemetry span creation and propagation
   - security: Set security headers (HSTS, X-Frame-Options, etc.)
   - serverTiming: Performance measurement
   - metrics: Prometheus metric collection
   - CacheService.headers: Cache control headers
   - logger: HTTP request/response logging
3. SessionAuthLayer validates bearer token if present
4. Route handler executes within tenant context
5. Response serialization via HttpApiBuilder
6. Middleware pipeline executes in reverse for response transforms

**State Management:**
- Request context (tenant ID, session, IP, user agent) stored in FiberRef and propagates through Effect execution
- Session state persisted to PostgreSQL with soft-delete support
- MFA enabled state cached in Redis (via CacheService) to reduce per-request DB lookups
- Database transactions isolate mutations via `db.withTransaction`

## Key Abstractions

**Effect Services:**
- Purpose: Dependency injection containers for business logic
- Examples: `DatabaseService`, `SessionService`, `MfaService` (all in `packages/server/src/`)
- Pattern: Effect.Service with Layer composition, accessed via `yield* ServiceName`

**Model Classes:**
- Purpose: Database entity definitions with auto-derived variants
- Examples: `User`, `Session`, `Asset` in `packages/database/src/models.ts`
- Pattern: @effect/sql Model.Class with six variants (select, insert, update, json, jsonCreate, jsonUpdate)

**Repository Pattern:**
- Purpose: Data access abstraction with batched operations
- Examples: `makeUserRepo`, `makeSessionRepo` in `packages/database/src/repos.ts`
- Pattern: Factory functions returning typed CRUD operations with custom methods

**HttpApiGroup:**
- Purpose: Type-safe HTTP endpoint definitions
- Examples: `_AuthGroup`, `_StorageGroup` in `packages/server/src/api.ts`
- Pattern: HttpApiGroup with explicit success/error schemas, enables client derivation

**Context Propagation:**
- Purpose: Request-scoped state without prop drilling
- Examples: `Context.Request` in `packages/server/src/context.ts`
- Pattern: FiberRef for current context, locally/within for scope isolation

## Entry Points

**API Server:**
- Location: `apps/api/src/main.ts`
- Triggers: NodeRuntime.runMain invocation
- Responsibilities: Layer composition, ManagedRuntime creation, HTTP server lifecycle

**Database Migration:**
- Location: `apps/api/src/migrate.ts`
- Triggers: Manual invocation via `pnpm migrate`
- Responsibilities: Execute pending Drizzle migrations against PostgreSQL

**Route Handlers:**
- Location: `apps/api/src/routes/*.ts` (auth.ts, storage.ts, transfer.ts, etc.)
- Triggers: HTTP requests matching API contract in `packages/server/src/api.ts`
- Responsibilities: Input validation, business logic delegation, response serialization

## Error Handling

**Strategy:** Typed errors in Effect error channel, never thrown exceptions

**Patterns:**
- Data.TaggedError for domain errors (recoverable): `HttpError.Auth`, `HttpError.NotFound`
- Schema.decode for input validation: automatic transformation to HttpError.Validation
- Effect.catchTag for discriminated error handling: `Effect.catchTag('Auth', handler)`
- Effect.mapError to transform lower-layer errors: database errors → HTTP errors

## Cross-Cutting Concerns

**Logging:** Structured logging via Effect.log* functions, spans via OpenTelemetry
**Validation:** @effect/schema decode at HTTP boundaries, branded types for domain primitives
**Authentication:** SessionAuthLayer middleware validates bearer tokens, populates Context.Request.session

---

*Architecture analysis: 2026-01-28*
