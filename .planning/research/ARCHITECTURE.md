# Architecture Patterns: Effect Layer Composition

**Domain:** Effect HTTP Server / Layer Restructuring
**Researched:** 2026-01-26
**Confidence:** HIGH (verified via Effect official docs, codebase analysis)

## Executive Summary

This document defines a 4-layer architecture for Effect-based HTTP servers, consolidating the current 7-layer structure (Platform, BaseInfra, RateLimit, Data, Core, Domain, HTTP) into a cleaner hierarchy. The restructuring preserves existing FiberRef-based tenant isolation while improving testability, dependency clarity, and future Effect Cluster compatibility.

## Current State Analysis

### Current 7-Layer Structure (main.ts)

```
PlatformLayer         : Client, StorageAdapter.S3ClientLayer, NodeFileSystem, Telemetry.Default
    |
    v
BaseInfraLayer        : DatabaseService, SearchRepo, MetricsService, Crypto.Service, Context.Request.SystemLayer
    |
    v
RateLimitLayer        : RateLimit.Default (RateLimiter + RateLimiterStore)
    |
    v
DataLayer             : ReplayGuardService.Default
    |
    v
CoreLayer             : StorageAdapter, AuditService, MfaService, OAuthService
    |
    v
DomainLayer           : SessionService, StorageService, SearchService, JobService, PollingService
    |
    v
HTTPLayer             : SessionAuthLayer, RouteLayer, ApiLayer, ServerLayer
```

### Current Issues

| Issue | Impact | Root Cause |
|-------|--------|------------|
| Too many granular layers | Harder to test, unclear boundaries | Services split by implementation detail, not domain |
| RateLimit as separate layer | Unnecessary indirection | RateLimiterStore is shared infra, not a layer boundary |
| DataLayer contains only ReplayGuard | Layer exists for single service | Dependency on RateLimiterStore forced extra layer |
| Core vs Domain boundary unclear | MfaService in Core, SessionService in Domain | Mixed responsibilities (MFA is domain, not core) |
| Default layers scattered | Each service defines own Default | No centralized composition point |

## Recommended 4-Layer Architecture

```
+---------------------------------------------------------------------------------+
|                                    HTTP Layer                                   |
|  Routes, Middleware, Session Auth, CORS, Request Context Factory               |
|  [RouteLayer, SessionAuthLayer, ApiLayer, ServerLayer]                         |
+---------------------------------------------------------------------------------+
                                       |
                                       | depends on
                                       v
+---------------------------------------------------------------------------------+
|                                  Domain Layer                                   |
|  Business Logic: Session, MFA, OAuth, Storage, Search, Jobs, Polling           |
|  [SessionService, MfaService, OAuthService, StorageService, SearchService,     |
|   JobService, PollingService]                                                   |
+---------------------------------------------------------------------------------+
                                       |
                                       | depends on
                                       v
+---------------------------------------------------------------------------------+
|                                  Infra Layer                                    |
|  Infrastructure Adapters: Database, S3, RateLimit, ReplayGuard, Audit          |
|  [DatabaseService, StorageAdapter, RateLimit, ReplayGuardService, AuditService,|
|   MetricsService, Crypto.Service]                                              |
+---------------------------------------------------------------------------------+
                                       |
                                       | depends on
                                       v
+---------------------------------------------------------------------------------+
|                                Platform Layer                                   |
|  External Resources: DB Client, S3 Client, FileSystem, Telemetry               |
|  [Client.layer, S3ClientLayer, NodeFileSystem.layer, Telemetry.Default]        |
+---------------------------------------------------------------------------------+
```

## Layer Boundaries and Responsibilities

### Layer 1: Platform (External Resources)

**Responsibility:** Initialize connections to external systems. No business logic.

**Services:**
| Service | Source | Purpose |
|---------|--------|---------|
| Client.layer | @parametric-portal/database | PostgreSQL connection pool |
| S3ClientLayer | @effect-aws/client-s3 | S3/MinIO connection |
| NodeFileSystem.layer | @effect/platform-node | File system access |
| Telemetry.Default | server/observe/telemetry | OTLP traces, metrics, logs |

**Dependencies:** None (base layer)

**Composition:**
```typescript
const PlatformLayer = Layer.mergeAll(
  Client.layer,
  StorageAdapter.S3ClientLayer,
  NodeFileSystem.layer,
  Telemetry.Default,
);
```

### Layer 2: Infra (Infrastructure Adapters)

**Responsibility:** Adapt external systems for domain use. Repositories, rate limiting, cryptography.

**Services:**
| Service | Requires | Purpose |
|---------|----------|---------|
| DatabaseService | Client | Repository methods for all tables |
| SearchRepo | Client | Search index operations |
| StorageAdapter | S3Client | S3 operations with tenant isolation |
| RateLimit.Default | (none) | Token bucket / fixed window rate limiting |
| ReplayGuardService | RateLimiterStore | TOTP replay detection + lockout |
| Crypto.Service | (none) | Token generation, hashing, encryption |
| MetricsService | (none) | Prometheus-style metrics |
| AuditService | DatabaseService, FileSystem | Audit log persistence |
| Context.Request.SystemLayer | (none) | System-level request context |

**Key Design Decision:** RateLimiterStore is a dependency of both `RateLimit.Default` and `ReplayGuardService`. Both services are in Infra because they adapt external state (Redis/memory) for application use.

**Composition:**
```typescript
const InfraLayer = Layer.mergeAll(
  DatabaseService.Default,
  SearchRepo.Default,
  StorageAdapter.Default,
  RateLimit.Default,
  ReplayGuardService.Default,
  Crypto.Service.Default,
  MetricsService.Default,
  AuditService.Default,
  Context.Request.SystemLayer,
).pipe(Layer.provideMerge(PlatformLayer));
```

### Layer 3: Domain (Business Logic)

**Responsibility:** Implement business rules. No direct external system access.

**Services:**
| Service | Requires | Purpose |
|---------|----------|---------|
| SessionService | DatabaseService, MfaService, MetricsService, Crypto | Session lifecycle, token rotation |
| MfaService | DatabaseService, MetricsService, Crypto, ReplayGuardService | TOTP enrollment, verification |
| OAuthService | DatabaseService, Crypto | OAuth flow, PKCE, state management |
| StorageService | StorageAdapter, DatabaseService, AuditService | Business-level storage operations |
| SearchService | SearchRepo | Search with domain filtering |
| JobService | DatabaseService, AuditService, MetricsService | Background job orchestration |
| PollingService | DatabaseService, MetricsService | System metrics polling |

**Composition:**
```typescript
const DomainLayer = Layer.mergeAll(
  SessionService.Default,
  MfaService.Default,
  OAuthService.Default,
  StorageService.Default,
  SearchService.Default,
  JobService.Default,
  PollingService.Default,
).pipe(Layer.provideMerge(InfraLayer));
```

### Layer 4: HTTP (Request Handling)

**Responsibility:** HTTP concerns only. Route handlers, middleware, authentication.

**Components:**
| Component | Requires | Purpose |
|-----------|----------|---------|
| SessionAuthLayer | SessionService | Bearer token validation middleware |
| RouteLayer | DomainLayer services | Route handlers for all endpoints |
| ApiLayer | RouteLayer | HttpApiBuilder.api composition |
| ServerLayer | ApiLayer, all middleware | HTTP server with middleware stack |

**Composition:**
```typescript
const SessionAuthLayer = Layer.unwrapEffect(
  SessionService.pipe(
    Effect.map((session) => Middleware.Auth.makeLayer((hash) => session.lookup(hash)))
  )
).pipe(Layer.provide(DomainLayer));

const RouteLayer = Layer.mergeAll(
  AuditLive, AuthLive, HealthLive, JobsLive, SearchLive,
  StorageLive, TelemetryRouteLive, TransferLive, UsersLive,
).pipe(Layer.provide(DomainLayer));

const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(RouteLayer));

const ServerLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    return HttpApiBuilder.serve(/* middleware stack */).pipe(
      Layer.provide(HttpApiSwagger.layer({ path: '/docs' })),
      Layer.provide(ApiLayer),
      Layer.provide(Middleware.cors(serverConfig.corsOrigins)),
      Layer.provide(SessionAuthLayer),
      HttpServer.withLogAddress,
      Layer.provide(NodeHttpServer.layer(createServer, { port: serverConfig.port })),
    );
  }),
).pipe(Layer.provide(DomainLayer));
```

## Dependency Direction Rules

### Allowed Dependencies

| Layer | Can Depend On |
|-------|---------------|
| Platform | Nothing |
| Infra | Platform |
| Domain | Infra, Platform |
| HTTP | Domain, Infra, Platform |

### Forbidden Dependencies

| Anti-Pattern | Why Forbidden |
|--------------|---------------|
| Platform depending on Infra | Platform should be pure resource initialization |
| Infra depending on Domain | Creates circular dependencies |
| Domain depending on HTTP | Business logic must be transport-agnostic |
| HTTP types leaking into Domain | Couples domain to HTTP transport |

## Service Composition Within Layers

### Pattern: Effect.Service with Factory Layers

Services that need dependencies use `Effect.Service.effect`:

```typescript
class MfaService extends Effect.Service<MfaService>()('server/MfaService', {
  effect: Effect.gen(function* () {
    const db = yield* DatabaseService;
    const metrics = yield* MetricsService;
    const replayGuard = yield* ReplayGuardService;
    // ... service implementation
    return { enroll, verify, disable, /* ... */ };
  }),
}) {}
```

### Pattern: Scoped Services for Lifecycle

Services with background fibers or cleanup use `scoped`:

```typescript
class JobService extends Effect.Service<JobService>()('server/Jobs', {
  scoped: Effect.gen(function* () {
    // ... setup
    yield* Effect.addFinalizer(() => shutdown);
    yield* pollLoop.pipe(Effect.forkScoped);
    return { enqueue, onStatusChange, /* ... */ };
  }),
}) {}
```

### Pattern: Static Layers for Stateless Services

Services without dependencies use `succeed`:

```typescript
class Crypto extends Effect.Service<Crypto>()('server/Crypto', {
  succeed: {
    token: { generate, hash, compare, pair },
    encrypt, decrypt,
  },
}) {}
```

## FiberRef Propagation Through Layers

### Current Pattern (Preserve)

Request context flows via FiberRef, not Effect Context:

```typescript
// context.ts
const _ref = FiberRef.unsafeMake<Context.Request.Data>(_default);

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
  static readonly current = FiberRef.get(_ref);
  static readonly update = (partial) => FiberRef.update(_ref, (ctx) => ({ ...ctx, ...partial }));
  static readonly within = (tenantId, effect, ctx?) =>
    Effect.locallyWith(effect, _ref, (current) => ({ ...current, ...ctx, tenantId }));
}
```

### Why FiberRef Instead of Effect Context

| Aspect | FiberRef | Effect Context |
|--------|----------|----------------|
| Middleware Access | Can read/write in middleware without layer changes | Requires Layer.provide in middleware |
| Async Safety | Automatically propagates across Effect.fork | Manual propagation needed |
| Tenant Isolation | withinSync for database transactions | Complex with Effect Context |
| Testing | Easy to mock via locally() | Requires full layer replacement |

### FiberRef Flow Through Layers

```
HTTP Request
    |
    v [makeRequestContext middleware]
    FiberRef.update({ tenantId, ipAddress, requestId, userAgent })
    |
    v [SessionAuth middleware]
    FiberRef.update({ session })
    |
    v [Route Handler]
    Context.Request.current -> full request context
    |
    v [Domain Service]
    Context.Request.tenantId -> tenant isolation
    Context.Request.session -> user context
    |
    v [Infra Service]
    StorageAdapter uses Context.Request.tenantId for S3 path prefixing
    AuditService uses full context for audit entries
```

## Effect Cluster Compatibility

### Current Architecture Cluster-Readiness

| Aspect | Status | Notes |
|--------|--------|-------|
| Stateless Services | READY | Domain services can run on any node |
| FiberRef Context | NEEDS WORK | Must serialize/deserialize across nodes |
| Job Processing | PARTIAL | Currently single-worker, needs shard assignment |
| Rate Limiting | READY | Redis store already supports multi-node |

### Required Changes for Effect Cluster

**1. Message Serialization for Context**

```typescript
// Context must be serializable for cross-node messages
const RequestContextSchema = S.Struct({
  tenantId: S.String,
  requestId: S.String,
  userId: S.Option(S.String),
  // ... serializable fields only
});
```

**2. Sharded Job Processing**

```typescript
// Replace polling with Effect Cluster entity
const JobEntity = Entity.make({
  name: 'Job',
  handler: (jobId: string) => Effect.gen(function* () {
    // Process single job, cluster handles distribution
  }),
});
```

**3. Layer Structure for Cluster**

```typescript
// Additional cluster layer between Domain and HTTP
const ClusterLayer = Layer.mergeAll(
  ShardingConfig.layer({ numberOfShards: 300 }),
  RunnerStorage.layer,
  MessageStorage.layer,
).pipe(Layer.provideMerge(InfraLayer));
```

## Migration Path: 7 to 4 Layers

### Phase 1: Consolidate RateLimit + Data into Infra

**Before:**
```typescript
const RateLimitLayer = RateLimit.Default.pipe(Layer.provideMerge(BaseInfraLayer));
const DataLayer = ReplayGuardService.Default.pipe(Layer.provideMerge(RateLimitLayer));
```

**After:**
```typescript
// RateLimit.Default internally provides RateLimiterStore
const InfraLayer = Layer.mergeAll(
  DatabaseService.Default,
  SearchRepo.Default,
  RateLimit.Default,  // Includes RateLimiterStore
  ReplayGuardService.Default,  // Uses RateLimiterStore from RateLimit.Default
  // ...
).pipe(Layer.provideMerge(PlatformLayer));
```

**Risk:** ReplayGuardService depends on RateLimiterStore. Must verify RateLimit.Default exports RateLimiterStore.

### Phase 2: Move MfaService, OAuthService to Domain

**Current (CoreLayer):**
```typescript
const CoreLayer = Layer.mergeAll(
  StorageAdapter.Default,
  AuditService.Default,
  MfaService.Default,    // <- Move to Domain
  OAuthService.Default,  // <- Move to Domain
).pipe(Layer.provideMerge(DataLayer));
```

**After:**
- StorageAdapter stays in Infra (it's an adapter)
- AuditService stays in Infra (it's an adapter)
- MfaService moves to Domain (it's business logic)
- OAuthService moves to Domain (it's business logic)

### Phase 3: Rename and Consolidate

```typescript
// Final 4-layer structure
const PlatformLayer = Layer.mergeAll(/* ... */);

const InfraLayer = Layer.mergeAll(
  DatabaseService.Default,
  SearchRepo.Default,
  StorageAdapter.Default,
  RateLimit.Default,
  ReplayGuardService.Default,
  Crypto.Service.Default,
  MetricsService.Default,
  AuditService.Default,
  Context.Request.SystemLayer,
).pipe(Layer.provideMerge(PlatformLayer));

const DomainLayer = Layer.mergeAll(
  SessionService.Default,
  MfaService.Default,
  OAuthService.Default,
  StorageService.Default,
  SearchService.Default,
  JobService.Default,
  PollingService.Default,
).pipe(Layer.provideMerge(InfraLayer));

const HTTPLayer = /* ServerLayer composition */;
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Service Importing Layer from Different Tier

**What:** Domain service importing Layer from HTTP layer
**Why bad:** Creates upward dependency, breaks layer isolation
**Instead:** Pass dependencies via Effect.Service.effect, not direct imports

### Anti-Pattern 2: Layer.mergeAll with Interdependencies

**What:** Putting services with mutual dependencies in same Layer.mergeAll
**Why bad:** Effect cannot resolve circular dependencies
**Detection:** Effect Language Service warns about this
**Instead:** Split into separate layers with Layer.provideMerge chain

### Anti-Pattern 3: Passing Full Layer Instead of Service

**What:** `(layer: Layer<DatabaseService>) => ...`
**Why bad:** Couples to layer construction, not service interface
**Instead:** `(db: DatabaseService) => ...` - depend on service, not layer

### Anti-Pattern 4: Cross-Layer FiberRef Modification

**What:** HTTP layer modifying FiberRef that Domain layer depends on after Domain call
**Why bad:** Unpredictable context state
**Instead:** Set all FiberRef state before calling lower layers

## Scalability Considerations

| Concern | At 100 users | At 10K users | At 1M users |
|---------|--------------|--------------|-------------|
| Rate Limiting | Memory store | Redis store | Redis cluster |
| Session Lookup | Direct DB | Cache layer | Distributed cache |
| Job Processing | Single worker | Multi-worker | Effect Cluster sharding |
| Audit Logging | Direct write | Buffered batch | Async queue |
| Tenant Isolation | FiberRef | FiberRef | FiberRef + shard affinity |

## Testing Strategy by Layer

### Platform Layer Testing

```typescript
// Replace with test implementations
const TestPlatform = Layer.mergeAll(
  TestDatabaseClient,     // In-memory or test container
  TestS3Client,           // LocalStack or mock
  InMemoryFileSystem,     // @effect/platform-test
  Telemetry.NoOp,         // Silent telemetry
);
```

### Infra Layer Testing

```typescript
// Test against Platform test layer
const TestInfra = Layer.mergeAll(
  DatabaseService.Default,  // Real implementation against test DB
  // ...
).pipe(Layer.provideMerge(TestPlatform));
```

### Domain Layer Testing

```typescript
// Option 1: Full integration (real Infra against test Platform)
const IntegrationTest = DomainLayer.pipe(Layer.provide(TestInfra));

// Option 2: Unit test (mock Infra services)
const UnitTest = Layer.mergeAll(
  MockDatabaseService,
  MockStorageAdapter,
  // ...
);
```

### HTTP Layer Testing

```typescript
// Use Effect's HttpClient.mock for route testing
const RouteTest = TestClient.make(ApiLayer).pipe(
  Layer.provide(DomainLayer),
  Layer.provide(TestInfra),
);
```

## Sources

- [Managing Layers | Effect Documentation](https://effect.website/docs/requirements-management/layers/) - HIGH confidence
- [Managing Services | Effect Documentation](https://effect.website/docs/requirements-management/services/) - HIGH confidence
- [Layer.ts API Reference](https://effect-ts.github.io/effect/effect/Layer.ts.html) - HIGH confidence
- [Effect Cluster DeepWiki](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - MEDIUM confidence
- [EffectPatterns Repository](https://github.com/PaulJPhilp/EffectPatterns) - MEDIUM confidence
- [Building Robust Typescript APIs with Effect](https://dev.to/martinpersson/building-robust-typescript-apis-with-the-effect-ecosystem-1m7c) - MEDIUM confidence
- Codebase Analysis: `/Users/bardiasamiee/Documents/99.Github/Parametric_Portal/apps/api/src/main.ts` - HIGH confidence
