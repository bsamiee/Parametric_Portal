# Effect HTTP Refactoring Pitfalls

**Domain:** Effect HTTP Foundation Refactor
**Researched:** 2026-01-26
**Confidence:** HIGH (verified against codebase patterns and official Effect documentation)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken functionality, or architectural debt.

---

### Pitfall 1: Wrapping Platform APIs Unnecessarily

**What goes wrong:**
Creating custom wrappers around `@effect/platform` modules that already provide the needed functionality. The codebase shows this in `context.ts` where cookie operations are manually wrapped despite `HttpServerResponse` providing `setCookie`, `expireCookie` directly, and the `Cookies` module offering comprehensive APIs (`get`, `set`, `remove`, `merge`, `serializeCookie`, etc.).

**Why it happens:**
- Developers unfamiliar with full scope of `@effect/platform` APIs
- Legacy code predating platform features
- Over-abstracting for "cleanliness" without understanding cost

**Consequences:**
- Duplicated logic that drifts from platform behavior
- Missed security features (platform handles encoding, validation)
- API surface that must be maintained when platform evolves
- Harder onboarding (two APIs to learn instead of one)

**Warning signs (code review):**
```typescript
// BAD: Manual cookie wrapper
static readonly cookie = {
  clear: (key) => (res) => HttpServerResponse.expireCookie(res, ...),
  get: (key, req, onNone) => Effect.fromNullable(req.cookies[...]),
  set: (key, value) => (res) => HttpServerResponse.setCookie(res, ...),
}
```

**Prevention:**
1. Audit existing wrappers against current `@effect/platform` exports
2. Use `Cookies` module directly: `Cookies.get()`, `Cookies.set()`, `Cookies.remove()`
3. For `HttpServerResponse`: use `setCookie`, `expireCookie`, `setHeaders` directly
4. Only wrap when adding domain logic (e.g., encryption), not for thin pass-through

**Recovery path:**
1. Map wrapper calls to equivalent platform calls
2. Replace incrementally, starting with routes using cookies
3. Keep domain logic (encryption in `oauth.ts`) but delegate HTTP mechanics

**Sources:**
- [Effect Platform Cookies Module](https://effect-ts.github.io/effect/platform/Cookies.ts.html) [HIGH confidence]
- Codebase analysis: `packages/server/src/context.ts` lines 76-83

---

### Pitfall 2: Breaking FiberRef Propagation in Middleware

**What goes wrong:**
Context stored in `FiberRef` (like `tenantId`, `session`, `rateLimit`) fails to propagate through middleware chains, causing tenant isolation failures or missing request context in handlers.

**Why it happens:**
- Using `Effect.fork` without `Effect.forkScoped` (loses fiber context)
- Wrapping in new `Effect.gen` without inheriting context
- Mixing `async/await` patterns that escape the Effect runtime
- Incorrect middleware ordering that reads context before it's set

**Consequences:**
- Tenant isolation breach (queries run against wrong tenant)
- Session data unavailable in handlers
- Rate limiting fails (no IP/context)
- Audit logs with missing context

**Warning signs (code review):**
```typescript
// BAD: Forking without scope loses FiberRef
Effect.fork(someEffect)  // FiberRef not propagated

// BAD: Mixing async/await escapes runtime
const middleware = async (req, res) => {
  await Effect.runPromise(effect)  // Context lost after this
}

// BAD: Reading context before middleware sets it
app.pipe(
  requireSession,           // Reads session
  makeRequestContext(...),  // Sets session - WRONG ORDER
)
```

**Prevention:**
1. Use `Effect.forkScoped` or `Effect.forkDaemon` with explicit context passing
2. Never mix `async/await` inside Effect middleware - use `Effect.promise` for interop
3. Audit middleware ordering: context-setting middleware runs before context-reading
4. Use `Context.Request.within()` pattern (already in codebase) for tenant scoping
5. Test FiberRef propagation explicitly in integration tests

**Recovery path:**
1. Add telemetry span attributes for `tenant.id` at entry and exit
2. Compare values to detect propagation failures
3. Refactor problematic middleware to pure Effect chains

**Sources:**
- [FiberRef Introduction - ZIO](https://zio.dev/reference/state-management/fiberref/) [MEDIUM confidence - ZIO docs, similar pattern]
- [Effect Platform HttpMiddleware](https://effect-ts.github.io/effect/platform/HttpMiddleware.ts.html) [HIGH confidence]
- Codebase analysis: `packages/server/src/middleware.ts` (correct pattern at line 123)

---

### Pitfall 3: Circular Layer Dependencies

**What goes wrong:**
Service A requires Service B, Service B requires Service A, creating a deadlock or type error during layer composition.

**Why it happens:**
- Organic growth without dependency graph planning
- Services that "naturally" need each other (e.g., `SessionService` and `MfaService` both validate users)
- Metrics/Audit services that need domain context but are also used by domain

**Consequences:**
- TypeScript type errors (infinite recursion in types)
- Runtime deadlock (layers waiting on each other)
- Refactoring paralysis (can't change one without the other)

**Warning signs (code review):**
```typescript
// In SessionService.ts
class SessionService extends Effect.Service<...>({
  dependencies: [MfaService]  // Requires MFA
})

// In MfaService.ts
class MfaService extends Effect.Service<...>({
  dependencies: [SessionService]  // Requires Session - CIRCULAR!
})
```

**Prevention:**
1. **Dependency direction rule:** Lower layers never depend on higher layers
   - Infrastructure (DB, Cache) -> Domain (Session, MFA) -> HTTP (Routes)
2. **Extract shared logic:** If A and B both need X, X becomes a separate service
3. **Invert with callbacks:** Instead of SessionService calling MfaService, pass a function
4. **Layer composition order matters:** Use `Layer.provideMerge` chains with clear hierarchy
5. Map dependencies before coding: draw the graph, find cycles early

**Current codebase pattern (correct):**
```typescript
// main.ts - Layered hierarchy prevents cycles
const BaseInfraLayer = Layer.mergeAll(DatabaseService, SearchRepo, ...).pipe(
  Layer.provideMerge(PlatformLayer)
);
const CoreLayer = Layer.mergeAll(MfaService, OAuthService, ...).pipe(
  Layer.provideMerge(DataLayer)
);
const DomainLayer = Layer.mergeAll(SessionService, ...).pipe(
  Layer.provideMerge(CoreLayer)
);
```

**Recovery path:**
1. Extract the shared dependency into its own service
2. Inject via callback/function parameter instead of service dependency
3. Use `Layer.suspend` for legitimate lazy evaluation needs

**Sources:**
- [Effect Managing Layers](https://effect.website/docs/requirements-management/layers/) [HIGH confidence]
- Codebase analysis: `apps/api/src/main.ts` lines 49-82

---

### Pitfall 4: Mixing async/await with Effect

**What goes wrong:**
Using JavaScript `async/await` inside `Effect.gen` or mixing Promise-based code with Effect pipelines, breaking error tracking, interruption handling, and fiber context.

**Why it happens:**
- Familiarity with async/await from pre-Effect code
- Third-party libraries that only expose Promise APIs
- Copy-pasting non-Effect examples
- "It works" mentality without understanding cost

**Consequences:**
- Errors escape Effect's typed error channel (become defects)
- Interruption doesn't work (Promise can't be cancelled)
- FiberRef context lost
- Resource cleanup not guaranteed

**Warning signs (code review):**
```typescript
// BAD: await inside Effect.gen
Effect.gen(function* () {
  const result = await somePromise()  // WRONG - escapes Effect
  yield* Effect.succeed(result)
})

// BAD: Promise.then mixed with Effect
someEffect.pipe(
  Effect.flatMap((x) => Promise.resolve(x + 1))  // WRONG - returns Promise, not Effect
)

// BAD: try/catch around Effect
try {
  await Effect.runPromise(effect)
} catch (e) {
  // Typed errors lost
}
```

**Prevention:**
1. **Wrap Promises immediately:** `Effect.tryPromise({ try: () => promiseFn(), catch: toTypedError })`
2. **Use `yield*` exclusively in generators:** Never `await`
3. **Interop at boundaries only:** Convert to Promise at API edge, not internally
4. **Prefer Effect-native libraries:** `@effect/platform`, `@effect/sql` over raw drivers

**Correct pattern (from codebase):**
```typescript
// GOOD: oauth.ts wraps Arctic's Promises properly
const exchange = (provider, fn: () => Promise<OAuth2Tokens>) =>
  Effect.tryPromise({ catch: mapOAuthError(provider), try: fn }).pipe(
    Effect.retry(Context.Request.config.oauth.retry),
    Effect.timeoutFail({ ... }),
  );
```

**Recovery path:**
1. Search for `await` inside `Effect.gen` blocks
2. Search for `.then(` mixed with Effect
3. Wrap each Promise call with `Effect.tryPromise` or `Effect.promise`

**Sources:**
- [Effect Using Generators](https://effect.website/docs/getting-started/using-generators/) [HIGH confidence]
- [Effect Myths](https://effect.website/docs/additional-resources/myths/) [HIGH confidence]

---

## Moderate Pitfalls

Mistakes that cause delays, technical debt, or maintainability issues.

---

### Pitfall 5: Manual SSE Encoding Instead of Sse Module

**What goes wrong:**
Hand-rolling Server-Sent Events formatting when `@effect/platform` provides SSE utilities.

**Why it happens:**
- SSE seems "simple enough" to implement manually
- Unaware of platform's streaming response utilities
- Legacy code from before platform stabilized

**Consequences:**
- Edge cases missed (retry, id, multiline data)
- No proper backpressure handling
- Client reconnection logic more complex

**Warning signs (code review):**
```typescript
// BAD: Manual SSE formatting
const formatSse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
Stream.map(events, formatSse)
```

**Prevention:**
1. Use `HttpServerResponse.stream` with proper SSE formatting
2. Check `@effect/platform` for `Sse` or streaming utilities
3. Follow platform examples for event streaming

**Recovery path:**
1. Identify SSE endpoints (e.g., `/jobs/subscribe` in codebase)
2. Refactor to use platform streaming primitives
3. Test reconnection and backpressure scenarios

**Sources:**
- [Effect HTTP API Builder](https://deepwiki.com/Effect-TS/effect/4.3-http-api-builder) [MEDIUM confidence]

---

### Pitfall 6: Over-Granular Layer Composition (7+ Layers)

**What goes wrong:**
Creating too many fine-grained layers that must be composed in specific order, making the dependency graph hard to understand and maintain.

**Why it happens:**
- Each new service gets its own layer
- Refactoring adds layers without consolidation
- No clear tier boundaries

**Consequences:**
- `main.ts` becomes hard to read (current: 7 distinct layer tiers)
- Subtle ordering bugs when composition changes
- Onboarding friction understanding layer relationships

**Warning signs (code review):**
```typescript
// Current pattern - many tiers
const PlatformLayer = ...    // Tier 1
const BaseInfraLayer = ...   // Tier 2
const RateLimitLayer = ...   // Tier 3
const DataLayer = ...        // Tier 4
const CoreLayer = ...        // Tier 5
const DomainLayer = ...      // Tier 6
const AppLayer = ...         // Tier 7
```

**Prevention:**
1. **Three-tier target:** Platform -> Core -> Domain
2. Group related services into cohesive layers
3. Document layer responsibilities in comments
4. Question each new layer: does this need its own tier?

**Recovery path:**
1. Identify services that belong together (same bounded context)
2. Merge `RateLimitLayer` and `DataLayer` into `InfraLayer`
3. Merge `CoreLayer` and `DomainLayer` if no circular deps
4. Target: PlatformLayer -> InfraLayer -> DomainLayer

**Sources:**
- [Effect Managing Services](https://effect.website/docs/requirements-management/services/) [HIGH confidence]
- Codebase analysis: `apps/api/src/main.ts`

---

### Pitfall 7: Improper Error Channel Handling

**What goes wrong:**
Errors that should be in Effect's error channel become defects (uncaught), or vice versa. Domain errors leak as 500s, or system failures become user-facing validation errors.

**Why it happens:**
- Using `Effect.die` for recoverable errors
- Not mapping errors at layer boundaries
- Catching too broadly with `Effect.catchAll`

**Consequences:**
- 500 errors for user input mistakes
- Lost error context in logs
- Inconsistent error responses

**Warning signs (code review):**
```typescript
// BAD: Die for recoverable error
Effect.die('No session')  // Should be typed error

// BAD: Catch-all hides error types
.pipe(Effect.catchAll(() => Effect.succeed(null)))  // Lost error information

// BAD: Not mapping at boundary
return db.query(...).pipe(
  Effect.map(transformResult)
  // Missing: Effect.mapError to domain error
)
```

**Prevention:**
1. Use `Data.TaggedError` for domain errors (recoverable, typed)
2. Use `Schema.TaggedError` for errors that cross API boundary
3. Map errors at service boundaries: `Effect.mapError(dbError => HttpError.Internal.of(...))`
4. Reserve `Effect.die` for truly unrecoverable programmer errors
5. Keep error unions small: 3-5 variants per service

**Correct pattern (from codebase):**
```typescript
// GOOD: errors.ts - Schema.TaggedError with HTTP status
class Auth extends S.TaggedError<Auth>()('Auth',
  { cause: S.optional(S.Unknown), details: S.String },
  HttpApiSchema.annotations({ status: 401 }),
) {
  static readonly of = (details: string, cause?: unknown) => new Auth({ cause, details });
}
```

**Recovery path:**
1. Audit uses of `Effect.die` - most should be `Effect.fail`
2. Add error mapping at service boundaries
3. Ensure all handler paths have typed error responses

**Sources:**
- Codebase analysis: `packages/server/src/errors.ts` [HIGH confidence]
- [Effect Error Handling](https://www.tweag.io/blog/2024-11-07-typescript-effect/) [MEDIUM confidence]

---

## Minor Pitfalls

Annoyances that are fixable but waste time if not known.

---

### Pitfall 8: Scattered Cache Logic Instead of KeyValueStore

**What goes wrong:**
Multiple services implement their own caching patterns instead of using a unified `KeyValueStore` abstraction.

**Current state:** `SessionService` has `mfaEnabledCache`, other services likely have ad-hoc caching.

**Prevention:**
1. Use `@effect/platform` `KeyValueStore` for consistent caching
2. Configure single cache layer with TTL, capacity
3. Services use KeyValueStore via dependency injection

**Sources:**
- [Effect KeyValueStore](https://effect.website/docs/platform/key-value-store/) [HIGH confidence]

---

### Pitfall 9: Hand-Rolled Job Queue Instead of Effect Cluster

**What goes wrong:**
Building custom job queue infrastructure (database polling, locking, retry logic) when `@effect/cluster` and `@effect/workflow` provide battle-tested distributed workflows.

**Current state:** `infra/jobs.ts` implements:
- Database-backed queue with `SELECT FOR UPDATE SKIP LOCKED`
- Manual retry with exponential backoff
- Circuit breaker resilience
- Graceful shutdown coordination
- 200+ lines of infrastructure code

**Consequences:**
- Maintenance burden for distributed systems complexity
- Edge cases (partial failures, exactly-once delivery) hard to get right
- No durable execution (workflow state lost on crash)

**Prevention:**
1. Evaluate `@effect/cluster` for distributed entity management
2. Evaluate `@effect/workflow` for durable workflows
3. Use `ClusterWorkflowEngine` for job orchestration
4. Keep simple background tasks, migrate complex workflows

**Recovery path:**
1. Identify job types that need durability/distribution
2. Migrate those to `@effect/workflow` incrementally
3. Keep simple polling for non-critical tasks

**Sources:**
- [@effect/workflow npm](https://www.npmjs.com/package/@effect/workflow) [HIGH confidence]
- [@effect/cluster docs](https://effect-ts.github.io/effect/docs/cluster) [HIGH confidence]

---

### Pitfall 10: Not Using HttpApiMiddleware for Endpoint-Specific Logic

**What goes wrong:**
Putting endpoint-specific middleware (like `requireMfaVerified`) in global middleware chain instead of using `HttpApiMiddleware` at the endpoint/group level.

**Why it happens:**
- Global middleware is the familiar pattern from Express/Koa
- Not knowing HttpApi supports endpoint-level middleware

**Consequences:**
- All endpoints affected when only some need the middleware
- Complex conditional logic in global middleware
- Harder to reason about endpoint behavior

**Prevention:**
1. Use `.middleware(Middleware.Auth)` on endpoints that need auth
2. Use `HttpApiGroup.middleware()` for group-wide middleware
3. Reserve global middleware for truly universal concerns (CORS, logging, tracing)

**Current pattern (correct):**
```typescript
// api.ts - Auth middleware at endpoint level
HttpApiEndpoint.post('logout', '/logout')
  .middleware(Middleware.Auth)  // Only this endpoint requires auth
```

**Sources:**
- [Effect HttpApiMiddleware](https://deepwiki.com/Effect-TS/effect/4.3-http-api-builder) [MEDIUM confidence]

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Cookie refactor | Breaking OAuth state encryption flow | Test OAuth flow end-to-end after each change |
| FiberRef/context | Losing tenant isolation in middleware reorder | Add telemetry assertions for tenant propagation |
| Layer consolidation | Introducing circular dependency | Map dependency graph before merging layers |
| SSE refactor | Losing backpressure handling | Test with slow clients |
| Job queue evaluation | Scope creep evaluating Effect Cluster | Time-box evaluation, focus on specific job types |
| Error handling | Changing response shapes breaks clients | Version API or add compatibility layer |

---

## Must Not Break Checklist

Before each refactor phase, verify:

- [ ] OAuth flows complete successfully (cookie-based state)
- [ ] Tenant isolation works (FiberRef propagation)
- [ ] Rate limiting applies correctly (context available)
- [ ] API contracts unchanged (existing clients work)
- [ ] MFA verification state persists across requests
- [ ] Audit logs have complete context (tenant, user, request ID)

---

## Sources Summary

| Source | Confidence | Topics |
|--------|------------|--------|
| [Effect Managing Layers](https://effect.website/docs/requirements-management/layers/) | HIGH | Layer composition, circular deps |
| [Effect Using Generators](https://effect.website/docs/getting-started/using-generators/) | HIGH | async/await anti-pattern |
| [Effect KeyValueStore](https://effect.website/docs/platform/key-value-store/) | HIGH | Unified caching |
| [@effect/workflow](https://www.npmjs.com/package/@effect/workflow) | HIGH | Durable job workflows |
| [Effect Platform Cookies](https://effect-ts.github.io/effect/platform/Cookies.ts.html) | HIGH | Cookie API |
| [ZIO FiberRef](https://zio.dev/reference/state-management/fiberref/) | MEDIUM | FiberRef patterns (similar to Effect) |
| [Effect HTTP API Builder](https://deepwiki.com/Effect-TS/effect/4.3-http-api-builder) | MEDIUM | HttpApiMiddleware patterns |
| Codebase analysis | HIGH | Current patterns and anti-patterns |
