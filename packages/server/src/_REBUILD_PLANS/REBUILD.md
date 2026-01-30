# API Architecture Rebuild Specification

## [1] CRITICAL FAILURES REQUIRING FULL REBUILD

### [1.1] Tenant Isolation is Broken
- Sessions table has NO `app_id` column - tokens work across tenants
- `X-App-Id` header is trusted without cryptographic binding to session
- Attack: Authenticated user sends `X-App-Id: victim-tenant`, accesses their data
- RLS policies use `current_setting(..., true)` - missing GUC returns NULL, not error

### [1.2] ClusterService is Dead Code
- `infra/cluster.ts` has full sharding, entities, K8s health - ZERO integration
- `main.ts` never imports or provides ClusterService.Layer
- Jobs, sessions, cache invalidation all run as N independent pods
- No leader election, no distributed cron, no entity routing

### [1.3] Effect Primitives Underutilized
- `PersistedCache` exists but sessions hit DB every request
- `Machine` exists but OAuth/MFA/import are imperative spaghetti
- `HttpApiClient` exists but no derived clients for internal calls
- `Workflow` exists but import has no checkpointing/compensation

### [1.4] API Contract Fragmented
- Schemas in `api.ts`, handlers in `routes/*.ts`, auth in `middleware.ts`
- `requireMfaVerified` called manually in handlers despite middleware declaration
- No OpenAPI security scheme annotations - clients can't discover auth

---

## [2] NEW ARCHITECTURE: TENANT-FIRST CLUSTER-NATIVE

### [2.1] Core Principle: Tenant Binding at Every Layer

```
┌─────────────────────────────────────────────────────────────────┐
│ Request → TenantMiddleware → Session validates tenant binding   │
│         → ClusterService routes to tenant-affinity shard        │
│         → RLS enforces at DB (fail-closed)                      │
│         → Response includes tenant correlation                  │
└─────────────────────────────────────────────────────────────────┘
```

### [2.2] File Structure (packages/server/src/)

```
src/
├── api/
│   ├── contract.ts      # HttpApi definition (single source of truth)
│   ├── client.ts        # HttpApiClient derivation for internal calls
│   ├── errors.ts        # Schema.TaggedError with status annotations
│   └── security.ts      # HttpApiSecurity schemes + middleware tags
├── cluster/
│   ├── entities.ts      # Entity definitions (Session, Job, Tenant)
│   ├── sharding.ts      # Tenant-affinity shard assignment
│   ├── cron.ts          # Distributed scheduled tasks
│   └── singleton.ts     # Leader-elected singletons
├── domain/
│   ├── auth.machine.ts  # Machine: OAuth + MFA state machines
│   ├── transfer.workflow.ts  # Workflow: Import with compensation
│   └── *.ts             # Pure domain logic (no IO)
├── platform/
│   ├── tenant.ts        # TenantContext service + middleware
│   ├── session.ts       # Tenant-bound session with PersistedCache
│   └── cache.ts         # Cross-cluster invalidation via Reactivity
├── handlers/
│   └── *.ts             # Thin handlers delegating to domain/cluster
└── main.ts              # Single composition root
```

---

## [3] TENANT CONTEXT: CRYPTOGRAPHIC BINDING

### [3.1] Schema Changes Required

```sql
-- sessions: ADD tenant binding
ALTER TABLE sessions ADD COLUMN app_id UUID NOT NULL REFERENCES apps(id);
CREATE INDEX idx_sessions_app_user ON sessions(app_id, user_id);

-- RLS: fail-closed (remove 'true' parameter)
DROP POLICY sessions_tenant_isolation ON sessions;
CREATE POLICY sessions_tenant_isolation ON sessions
    USING (app_id = current_setting('app.current_tenant')::uuid);
```

### [3.2] Tenant Middleware (Provides Context)

```typescript
// platform/tenant.ts
class TenantContext extends Context.Tag("TenantContext")<TenantContext, {
    readonly id: string;
    readonly namespace: string;
    readonly config: TenantConfig;
}>() {}

class TenantMiddleware extends HttpApiMiddleware.Tag<TenantMiddleware>()(
    "TenantMiddleware",
    {
        failure: HttpError.TenantRequired,
        provides: TenantContext,
        security: { tenant: HttpApiSecurity.apiKey({ in: "header", key: "X-Tenant-ID" }) }
    }
) {}

// Implementation: validates tenant exists, user has access
const TenantMiddlewareLive = Layer.effect(TenantMiddleware,
    Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* SessionContext; // From auth middleware
        const tenantId = yield* Headers.get(request.headers, 'x-tenant-id').pipe(
            Effect.mapError(() => new HttpError.TenantRequired())
        );
        // CRITICAL: Verify session.appId === tenantId
        yield* Effect.filterOrFail(
            Effect.succeed(session),
            (s) => s.appId === tenantId,
            () => new HttpError.TenantMismatch({ sessionTenant: session.appId, requestedTenant: tenantId })
        );
        const tenant = yield* TenantService.findById(tenantId);
        return tenant;
    })
);
```

### [3.3] Session Schema (Tenant-Bound)

```typescript
// platform/session.ts
class SessionContext extends Context.Tag("SessionContext")<SessionContext, {
    readonly id: string;
    readonly userId: string;
    readonly appId: string;  // CRITICAL: Tenant binding
    readonly mfaVerified: boolean;
}>() {}

// PersistedCache for session lookup
const SessionCache = CacheService.cache<SessionKey>({
    storeId: 'sessions',
    lookup: (key) => db.sessions.byHash(key.hash).pipe(
        Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new SessionNotFound()),
            onSome: (s) => Effect.succeed({
                id: s.id,
                userId: s.userId,
                appId: s.appId,  // Include tenant
                mfaVerified: Option.isSome(s.verifiedAt)
            })
        }))
    ),
    timeToLive: Duration.minutes(5),
    inMemoryTTL: Duration.seconds(30),
});
```

---

## [4] CLUSTER INTEGRATION: TENANT-AFFINITY SHARDING

### [4.1] Entity Definitions

```typescript
// cluster/entities.ts
const TenantEntity = Entity.make("Tenant", [
    Rpc.make("invalidateCache", {
        payload: S.Struct({ keys: S.Array(S.String) }),
        success: S.Void
    }),
    Rpc.make("broadcastEvent", {
        payload: S.Struct({ event: S.String, data: S.Unknown }),
        success: S.Void
    }),
]);

const JobEntity = Entity.make("Job", [
    Rpc.make("execute", {
        payload: JobPayload,
        success: JobResult,
        error: JobError,
        primaryKey: (p) => p.idempotencyKey  // Deterministic for replay
    }),
]);
```

### [4.2] Tenant-Affinity Shard Assignment

```typescript
// cluster/sharding.ts
const TenantSharding = Effect.gen(function* () {
    const sharding = yield* Sharding.Sharding;

    // Route requests to tenant-specific shard
    const forTenant = <A, E, R>(
        tenantId: string,
        effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | ClusterError, R> =>
        sharding.messenger(TenantEntity).sendDiscard(
            tenantId,  // entityId = tenantId for affinity
            { _tag: "execute", effect }
        );

    // Broadcast to all shards (cache invalidation)
    const broadcast = (event: string, data: unknown) =>
        sharding.broadcastDiscard(TenantEntity)({ event, data });

    return { forTenant, broadcast };
});
```

### [4.3] Distributed Cron (Leader-Elected)

```typescript
// cluster/cron.ts
const ScheduledTasks = Layer.mergeAll(
    ClusterService.cron({
        name: "purge-expired-sessions",
        cron: "0 */6 * * *",  // Every 6 hours
        execute: SessionService.purgeExpired,
    }),
    ClusterService.cron({
        name: "refresh-search-embeddings",
        cron: "0 3 * * *",  // Daily at 3am
        execute: SearchService.refreshEmbeddings,
    }),
    ClusterService.singleton("metrics-aggregator", MetricsService.aggregate),
);
```

---

## [5] API CONTRACT: SINGLE SOURCE OF TRUTH

### [5.1] Unified Contract Definition

```typescript
// api/contract.ts
const AuthApi = HttpApiGroup.make("auth")
    .add(HttpApiEndpoint.post("login", "/oauth/:provider/callback")
        .setPath(S.Struct({ provider: OAuthProvider }))
        .setUrlParams(S.Struct({ code: S.String, state: S.String }))
        .addSuccess(AuthResponse)
        .addError(HttpError.OAuth)
        .middleware(TenantMiddleware))  // Tenant required
    .add(HttpApiEndpoint.get("me", "/me")
        .addSuccess(User.json)
        .middleware(SessionMiddleware)
        .middleware(TenantMiddleware)
        .middleware(MfaVerifiedMiddleware))  // All auth in middleware
    .prefix("/auth");

// NO manual requireMfaVerified in handlers - middleware enforces
```

### [5.2] Security Scheme Annotations

```typescript
// api/security.ts
const SecuritySchemes = {
    bearer: HttpApiSecurity.bearer.pipe(
        OpenApi.annotate(OpenApi.SecurityScheme, {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT"
        })
    ),
    tenant: HttpApiSecurity.apiKey({ in: "header", key: "X-Tenant-ID" }).pipe(
        OpenApi.annotate(OpenApi.SecurityScheme, {
            type: "apiKey",
            in: "header",
            name: "X-Tenant-ID"
        })
    ),
};
```

### [5.3] Derived Client for Internal Calls

```typescript
// api/client.ts
const InternalClient = Effect.gen(function* () {
    const baseUrl = yield* Config.string("INTERNAL_API_URL");
    return yield* HttpApiClient.make(ParametricApi, {
        baseUrl,
        // Automatic retry, circuit breaker, tracing
        transformClient: (client) => client.pipe(
            Resilience.withCircuit("internal-api"),
            Resilience.withRetry({ times: 3, base: Duration.millis(100) })
        )
    });
});

// Usage: Type-safe internal route calls
const refreshSearch = (tenantId: string) =>
    InternalClient.pipe(
        Effect.flatMap((client) => client.search.refresh({
            payload: { includeGlobal: false },
            headers: { "X-Tenant-ID": tenantId }
        }))
    );
```

---

## [6] ACTOR MACHINES: OAUTH + MFA (Effect Procedure Pattern)

### [6.1] OAuth Flow as Procedure Actor

```typescript
// domain/auth.machine.ts
import { Machine, Procedure } from "@effect/experimental";

// Schema for serializable state
class OAuthState extends S.Class<OAuthState>("OAuthState")({
    status: S.Literal("idle", "authorizing", "exchanging", "linking", "complete", "failed"),
    provider: S.optional(OAuthProvider),
    tenantId: S.optional(S.String),
    stateToken: S.optional(S.String),
    error: S.optional(S.String),
}) {}

// Procedure definitions with Schema payloads
const Start = Procedure.makeSerializable({
    failure: OAuthError,
    payload: S.Struct({ provider: OAuthProvider, tenantId: S.String }),
    success: S.Struct({ authUrl: S.String, stateToken: S.String }),
});

const Callback = Procedure.makeSerializable({
    failure: OAuthError,
    payload: S.Struct({ code: S.String, state: S.String }),
    success: S.Struct({ userId: S.String, isNewUser: S.Boolean }),
});

// Machine definition with typed procedures
const OAuthMachine = Machine.make(OAuthState, {
    Start: (state, payload) => Effect.gen(function* () {
        yield* Effect.filterOrFail(Effect.succeed(state.status), (s) => s === "idle",
            () => new OAuthError({ reason: "Already in progress" }));
        const stateToken = yield* Crypto.randomHex(32);
        const authUrl = yield* OAuthService.buildAuthUrl(payload.provider, stateToken);
        return [{ ...state, status: "authorizing", ...payload, stateToken }, { authUrl, stateToken }];
    }),
    Callback: (state, payload) => Effect.gen(function* () {
        // CRITICAL: Timing-safe state comparison
        yield* Effect.filterOrFail(
            Crypto.compare(state.stateToken ?? "", payload.state),
            Boolean.isTrue,
            () => new OAuthError({ reason: "Invalid state token" })
        );
        const tokens = yield* OAuthService.exchange(state.provider!, payload.code);
        const { userId, isNewUser } = yield* linkOrCreateUser(state.tenantId!, tokens);
        return [{ ...state, status: "complete" }, { userId, isNewUser }];
    }),
});
```

### [6.2] MFA Enrollment as Procedure Actor

```typescript
class MfaState extends S.Class<MfaState>("MfaState")({
    status: S.Literal("unenrolled", "pending", "enabled"),
    userId: S.String,
    secretId: S.optional(S.String),
}) {}

const Enroll = Procedure.makeSerializable({
    failure: MfaError,
    payload: S.Struct({ userId: S.String }),
    success: S.Struct({ qrDataUrl: S.String, backupCodes: S.Array(S.String) }),
});

const Verify = Procedure.makeSerializable({
    failure: MfaError,
    payload: S.Struct({ code: S.String.pipe(S.pattern(/^\d{6}$/)) }),
    success: S.Struct({ verified: S.Boolean }),
});

const MfaMachine = Machine.make(MfaState, {
    Enroll: (state, payload) => Effect.gen(function* () {
        yield* Effect.filterOrFail(Effect.succeed(state.status), (s) => s === "unenrolled",
            () => new MfaError({ reason: "Already enrolled" }));
        const { secretId, qrDataUrl, backupCodes } = yield* MfaService.generateSecret(payload.userId);
        return [{ ...state, status: "pending", secretId }, { qrDataUrl, backupCodes }];
    }),
    Verify: (state, payload) => Effect.gen(function* () {
        const valid = yield* MfaService.verifyCode(state.secretId!, payload.code);
        yield* Effect.filterOrFail(Effect.succeed(valid), Boolean.isTrue,
            () => new MfaError({ reason: "Invalid code" }));
        yield* MfaService.enable(state.secretId!);
        return [{ ...state, status: "enabled" }, { verified: true }];
    }),
});
```

---

## [7] IMPORT WORKFLOW: DURABLE WITH COMPENSATION

```typescript
// domain/transfer.workflow.ts
const ImportWorkflow = Workflow.make({
    name: "AssetImport",
    payload: S.Struct({
        tenantId: S.String,
        userId: S.String,
        format: Codec.Transfer,
        fileKey: S.String,
    }),
    idempotencyKey: (p) => `import:${p.tenantId}:${p.fileKey}`,

    steps: [
        Workflow.step("parse", {
            execute: (ctx) => Transfer.parse(ctx.payload.fileKey, ctx.payload.format),
            compensate: (ctx) => Storage.delete(ctx.payload.fileKey),
        }),
        Workflow.step("validate", {
            execute: (ctx, parsed) => Transfer.validate(parsed),
            // No compensation - validation is read-only
        }),
        Workflow.step("upload-binaries", {
            execute: (ctx, validated) =>
                Effect.forEach(validated.binaries, (b) => Storage.put(b), { concurrency: 10 }),
            compensate: (ctx, uploaded) =>
                Effect.forEach(uploaded, (key) => Storage.delete(key), { concurrency: 10 }),
        }),
        Workflow.step("insert-records", {
            execute: (ctx, uploaded) =>
                DatabaseService.assets.insertMany(uploaded),
            compensate: (ctx, inserted) =>
                DatabaseService.assets.deleteMany(inserted.map((a) => a.id)),
        }),
        Workflow.step("refresh-search", {
            execute: (ctx) => SearchService.refresh(ctx.payload.tenantId),
            // No compensation - search is eventually consistent
        }),
    ],
});
```

---

## [8] MAIN.TS: SINGLE COMPOSITION ROOT

```typescript
// main.ts
const PlatformLayer = Layer.mergeAll(
    NodeHttpServer.layer(createServer, { port: Config.number("PORT") }),
    NodeFileSystem.layer,
    Telemetry.Default,
);

const ClusterLayer = Layer.mergeAll(
    ClusterService.Layer,
    TenantEntity.toLayer(...),
    JobEntity.toLayer(...),
    ScheduledTasks,
).pipe(Layer.provide(PlatformLayer));

const DomainLayer = Layer.mergeAll(
    SessionService.Default,
    TenantService.Default,
    AuthMachine.Default,
    ImportWorkflow.Default,
).pipe(
    Layer.provideMerge(CacheService.LayerWithPersistence),
    Layer.provideMerge(ClusterLayer),
);

const ApiLayer = HttpApiBuilder.api(ParametricApi).pipe(
    Layer.provide(HttpApiBuilder.middlewareCors(corsConfig)),
    Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
    Layer.provide(TenantMiddlewareLive),
    Layer.provide(SessionMiddlewareLive),
    Layer.provide(MfaMiddlewareLive),
    Layer.provide(HandlersLayer),
    Layer.provide(DomainLayer),
);

const ServerLayer = HttpApiBuilder.serve((app) => app.pipe(
    Middleware.trace,
    Middleware.security(),
    Middleware.metrics,
    HttpMiddleware.logger,
)).pipe(
    Layer.provide(ApiLayer),
    HttpServer.withLogAddress,
);

// Graceful shutdown with drain
NodeRuntime.runMain(
    Layer.launch(ServerLayer).pipe(
        Effect.scoped,
        Effect.onInterrupt(() => Effect.all([
            HttpServer.drain,
            ClusterService.leave,
            CacheService.flush,
            Telemetry.flush,
        ], { concurrency: "unbounded" })),
    )
);
```

---

## [9] ADDITIONAL SECURITY FIXES

### [9.1] Storage Key Path Traversal Prevention

```typescript
// api/contract.ts - Storage key schema with validation
const StorageKey = S.String.pipe(
    S.minLength(1),
    S.maxLength(1024),
    S.pattern(/^[a-zA-Z0-9][a-zA-Z0-9\/_.-]*$/),  // No leading dots/slashes
    S.filter((k) => !k.includes("..") && !k.startsWith("/"), {
        message: () => "Path traversal detected"
    }),
    S.brand("StorageKey")
);

// All storage endpoints use this schema
HttpApiEndpoint.get("exists", "/exists/:key")
    .setPath(S.Struct({ key: StorageKey }))  // Validated!
```

### [9.2] Health Probe Timeout (Prevents K8s Cascade)

```typescript
// handlers/health.ts
const readinessProbe = Effect.all({
    db: Client.healthDeep(),
    cache: CacheService.health(),
    alerts: PollingService.getHealth(),
}).pipe(
    Effect.timeout(Duration.millis(500)),  // K8s default is 1s
    Effect.catchTag("TimeoutException", () => Effect.succeed({
        db: { healthy: false, latencyMs: 500 },
        cache: { connected: false, latencyMs: 500 },
        alerts: [],
    })),
    // Degrade gracefully, don't cascade failure
);
```

### [9.3] Refresh Token Race Condition Fix

```typescript
// platform/session.ts - Atomic refresh with row lock
const refresh = (hash: Hex64) =>
    db.withTransaction(Effect.gen(function* () {
        // SELECT FOR UPDATE inside transaction - prevents race
        const token = yield* db.refreshTokens.byHashForUpdate(hash).pipe(
            Effect.flatMap(Option.match({
                onNone: () => Effect.fail(new InvalidRefreshToken()),
                onSome: Effect.succeed,
            }))
        );
        // Soft delete BEFORE creating new tokens
        yield* db.refreshTokens.softDelete(token.id);
        // Now safe to create new session
        return yield* createSession(token.userId, token.appId);
    }));
```

---

## [10] VALIDATION CHECKLIST

Before deployment, verify:

- [ ] Session tokens include `appId`, validated on every request
- [ ] RLS policies use fail-closed `current_setting()` (no `true` param)
- [ ] ClusterService.Layer provided in main.ts
- [ ] All cron jobs use ClusterService.cron (leader-elected)
- [ ] PersistedCache used for session lookup
- [ ] OAuth/MFA implemented as Machines
- [ ] Import uses Workflow with compensation
- [ ] HttpApiClient used for internal route calls
- [ ] Graceful shutdown drains connections
- [ ] OpenAPI includes security scheme annotations
- [ ] Storage keys validated against path traversal
- [ ] Health probes have 500ms timeout

---

## [11] MIGRATION PATH

1. **Schema migration**: Add `app_id` to sessions, fix RLS policies
2. **Delete**: `api.ts`, all `routes/*.ts`, current `middleware.ts`
3. **Create**: New structure per Section 2.2
4. **Wire**: ClusterService in main.ts composition
5. **Test**: Tenant isolation with cross-tenant attack vectors
6. **Deploy**: Rolling update with session invalidation
