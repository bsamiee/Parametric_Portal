# Architecture

**Analysis Date:** 2026-01-26

## Pattern Overview

**Overall:** Functional Effect-based layered architecture with explicit dependency management via Effect.Layer composition. Monorepo with clear separation between app entry points, domain logic, infrastructure, and observability concerns.

**Key Characteristics:**
- Effect.Service + Layer composition for all infrastructure and business logic
- Explicit layer ordering: Platform → BaseInfra → RateLimit → Data → Core → Domain
- Schema-first design with validation at boundaries
- Error types as Schema.TaggedError for typed, serializable failures
- Tenant isolation via FiberRef context (Request.tenantId)
- Server package exports granular domain modules; apps compose them

## Layers

**Platform Layer:**
- Purpose: External resource connections (database, S3, filesystem, telemetry)
- Location: `packages/server/src/` (Client.layer, StorageAdapter.S3ClientLayer, NodeFileSystem.layer, Telemetry.Default)
- Contains: Database client configuration, S3 connection, file system binding
- Depends on: None
- Used by: BaseInfraLayer

**BaseInfraLayer:**
- Purpose: Database repositories, search indexing, utility services with no domain logic
- Location: `packages/server/src/`, `packages/database/src/repos.ts`, `packages/database/src/search.ts`
- Contains: DatabaseService, SearchRepo, MetricsService, Crypto service, request context provider
- Depends on: Platform
- Used by: RateLimitLayer, Core services

**RateLimitLayer:**
- Purpose: Rate limiting and circuit breaker store management
- Location: `packages/server/src/security/rate-limit.ts`
- Contains: RateLimiter service, rate limit store, window-based quota enforcement
- Depends on: BaseInfra
- Used by: DataLayer

**DataLayer:**
- Purpose: Replay guard and token validation services
- Location: `packages/server/src/security/totp-replay.ts`
- Contains: TOTP replay attack prevention
- Depends on: RateLimitLayer (for RateLimiterStore)
- Used by: CoreLayer

**CoreLayer:**
- Purpose: Cross-cutting infrastructure and authentication services
- Location: `packages/server/src/infra/storage.ts`, `packages/server/src/observe/audit.ts`, `packages/server/src/domain/mfa.ts`, `packages/server/src/domain/oauth.ts`
- Contains: StorageAdapter (S3 wrapper), AuditService (audit logging), MfaService, OAuthService
- Depends on: Data
- Used by: DomainLayer

**DomainLayer:**
- Purpose: Business logic services orchestrating repositories and infrastructure
- Location: `packages/server/src/domain/session.ts`, `packages/server/src/domain/storage.ts`, `packages/server/src/domain/search.ts`, `packages/server/src/infra/jobs.ts`, `packages/server/src/observe/polling.ts`
- Contains: SessionService (lifecycle + MFA verification), StorageService (asset management), SearchService, JobService, PollingService
- Depends on: Core
- Used by: Route handlers

**HTTP Layer:**
- Purpose: Route handlers and middleware for HTTP API
- Location: `apps/api/src/routes/` (auth.ts, storage.ts, search.ts, transfer.ts, etc.)
- Contains: Effect.fn handlers per route group, middleware composition, request/response mapping
- Depends on: Domain services
- Used by: HttpServer

## Data Flow

**OAuth Login Flow:**

1. Client calls `GET /api/auth/oauth/:provider`
2. `handleOAuthStart` (auth.ts route) → OAuthService.createAuthorizationUrl()
3. OAuthService (domain/oauth.ts) returns authorization URL + state cookie
4. Client redirects to provider, provider calls `GET /api/auth/oauth/:provider/callback?code=X&state=Y`
5. `handleOAuthCallback` validates state cookie via Context.Request, calls OAuthService.authenticate()
6. OAuthService decrypts stored provider tokens, decrypts with Crypto service
7. Lookup or create user via DatabaseService.users
8. SessionService.create() generates access + refresh tokens
9. Response includes accessToken in body, refreshToken in HttpOnly cookie
10. Audit logged via AuditService

**Request Lifecycle:**

1. HTTP arrives at `packages/server/src/middleware.ts` middlewares (trace, security, metrics, CORS)
2. `Middleware.Auth` validates bearer token → SessionService.lookup(tokenHash)
3. Context.Request set with: tenantId, session, ipAddress, requestId via FiberRef
4. Route handler (e.g., apps/api/src/routes/auth.ts) runs with full service access
5. Handler may call: DatabaseService repos, SearchService, StorageAdapter, AuditService
6. Response formatted via Schema + HttpApiBuilder
7. Metrics recorded via MetricsService
8. Response returned with trace headers

**State Management:**

- **Request Context:** FiberRef + Context.Request.Data (tenantId, session, ipAddress, rateLimit, circuit breaker state)
  - Updated via Context.Request.update() or Context.Request.locally()
  - Tenant isolation enforced by set_config('app.current_tenant', id) in PostgreSQL
- **Session State:** Database only (sessions table)
  - Hash stored in DB, token in bearer header
  - Verified once per request via Middleware.Auth → SessionService.lookup()
  - MFA status cached 5min (SessionService mfaEnabledCache)
- **Rate Limit State:** In-memory store (redis or local) managed by RateLimit service
  - Checked per request endpoint
- **OAuth State:** HttpOnly cookie + in-memory state store during callback flow
  - State validated to prevent CSRF

## Key Abstractions

**Effect.Service:**
- Purpose: Dependency injection + layer composition
- Examples: `SessionService`, `StorageAdapter`, `OAuthService`, `DatabaseService`
- Pattern: Class extends Effect.Service, define effect in class body, expose .Default static layer

**Schema.TaggedError:**
- Purpose: Typed, serializable HTTP errors
- Examples: `HttpError.Auth`, `HttpError.Forbidden`, `HttpError.RateLimit` (errors.ts)
- Pattern: Extends S.TaggedError with of() static factory, optionally includes cause

**Repository Factory Pattern:**
- Purpose: Unified CRUD + custom queries per entity type
- Examples: `databases/src/repos.ts` exports DatabaseService with: users, apps, sessions, assets, apiKeys, jobs, auditLogs
- Pattern: repo(Model, tableName, { resolve, purge, fn }) generates base CRUD + declarative custom resolvers

**Layer Composition:**
- Purpose: Explicit dependency ordering and injection
- Pattern: Layer.mergeAll(services).pipe(Layer.provideMerge(ParentLayer))
- Benefit: Testability (swap layers), clear dependencies, no circular references

## Entry Points

**API Server:**
- Location: `apps/api/src/main.ts`
- Triggers: Node.js invocation or Docker container start
- Responsibilities:
  1. Load serverConfig (CORS_ORIGINS, PORT) via Effect.Config
  2. Build layer hierarchy (Platform → BaseInfra → Domain)
  3. Compose route handlers into HttpApiBuilder
  4. Bind middleware (auth, metrics, security, CORS)
  5. Launch with NodeRuntime.runMain()
  6. Graceful shutdown on SIGINT/SIGTERM

**Route Handlers:**
- Location: `apps/api/src/routes/*.ts` (auth.ts, storage.ts, search.ts, transfer.ts, users.ts, audit.ts, jobs.ts, health.ts, telemetry.ts)
- Triggers: HttpApiBuilder matches request method + path to endpoint
- Responsibilities: Validate request, call domain services, format response via Schema

**Database Migrations:**
- Location: `packages/database/src/migrator.ts`
- Triggers: Manual execution or CI/CD pipeline
- Responsibilities: Run pending SQL migrations via knex or similar

## Error Handling

**Strategy:** Typed Error Channel
- Errors are values, not exceptions
- Domain services return `Effect.Effect<A, DomainError, Deps>`
- Route handlers catch specific error types, map to HTTP status codes
- Never throw exceptions (use Effect.fail)

**Patterns:**

```typescript
// Domain error
yield* Effect.fail(HttpError.Auth.of('Invalid token'))

// Catch specific error type
Effect.catchTag('Auth', (err) => {
  // Handle auth error specifically
  // Return recovery effect or re-fail with different error
})

// Multiple error handling
Effect.catch(err => {
  if (err instanceof HttpError.Auth) { ... }
  if (err instanceof HttpError.NotFound) { ... }
  return Effect.fail(err)
})
```

## Cross-Cutting Concerns

**Logging:**
- Effect.log* functions (logInfo, logDebug, logError)
- Structured via tracing spans (Effect.annotateCurrentSpan)
- Forwarded to telemetry backend via Telemetry service

**Validation:**
- Schema-based at HTTP boundary (HttpApiSchema for query/path/body)
- Entity models define their own Shape schemas (User.json, Asset.json)
- Failed validation → HttpError.Validation

**Authentication:**
- Bearer token → SessionService.lookup(tokenHash)
- MFA optional per session (session.mfaEnabled, session.verifiedAt)
- Middleware.Auth enforces; routes declare Middleware.Auth dependency

**Tenant Isolation:**
- Context.Request.tenantId set per HTTP request (FiberRef)
- PostgreSQL set_config('app.current_tenant', id) for RLS policies
- All queries filtered by current tenant automatically

**Rate Limiting:**
- Per-endpoint rate limits defined in RateLimit service
- Checked via Middleware.headers → RateLimiterStore
- Returns 429 with Retry-After header on exceed

---

*Architecture analysis: 2026-01-26*
