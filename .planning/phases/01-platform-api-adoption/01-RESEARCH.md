# Phase 1: Platform API Adoption - Research

**Researched:** 2026-01-26
**Domain:** Effect HTTP Platform APIs (Cookies, Streams, Cache, Resilience)
**Confidence:** HIGH

## Summary

This research investigates the official Effect ecosystem APIs required to build unified polymorphic modules for cookies, streaming, caching, and resilience. The codebase already uses Effect extensively with established patterns (metrics.ts, circuit.ts, context.ts) that inform the new module designs.

Key findings:
1. **@effect/platform Cookies** provides typed cookie operations with schema validation via `HttpServerRequest.schemaCookies` - eliminates manual parsing
2. **@effect/experimental Sse** provides encoder/parser for Server-Sent Events - eliminates manual TextEncoder usage
3. **Effect.Cache** provides request deduplication, TTL, and LRU eviction - already used in session.ts, extend to unified cache
4. **Stream buffer strategies** (`suspend`, `dropping`, `sliding`) provide explicit backpressure control - must configure per stream type
5. **FiberRef** enables automatic tenant context propagation - already used in context.ts, leverage for cache key prefixing
6. **Effect.retry + Schedule** provides complete resilience primitives - can replace cockatiel for pure Effect pipelines

**Primary recommendation:** Build four unified modules following metrics.ts pattern: dense FP+Effect code, polymorphic API, automatic tenant/metrics integration. Use 100% Effect primitives for traceable Railway-Oriented Programming.

## Standard Stack

The established libraries/tools for this domain:

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| effect | 3.19.15 | Core Effect runtime, Cache, Schedule, FiberRef, Stream | Foundation - all other packages depend on it |
| @effect/platform | 0.94.2 | Cookies, HttpServerResponse, HttpServerRequest, KeyValueStore | Official HTTP platform primitives |
| @effect/experimental | 0.58.0 | Sse encoder/parser, Persistence patterns | Official experimental APIs (stable enough for production) |
| @effect/opentelemetry | 0.61.0 | OpenTelemetry integration for metrics/tracing | Official observability integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| cockatiel | 3.2.1 | Circuit breaker, policy composition | Already in codebase; keep for complex breaker strategies |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| cockatiel | Pure Effect.retry + Schedule | Effect provides full tracing; cockatiel provides richer breaker strategies. Recommend hybrid: Effect for retry/timeout, keep cockatiel for CircuitBreaker |
| Manual cookie encryption | Effect Crypto layer | Keep current pattern - encryption is domain concern (oauth.ts) |
| KeyValueStore.layerMemory | Custom in-memory cache | KeyValueStore is simpler interface; Effect.Cache provides deduplication |

**Installation:**
```bash
# Already in catalog - no changes needed
pnpm install
```

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── http/
│   ├── cookies.ts      # Cookie operations with schema validation
│   ├── stream.ts       # Unified streaming (SSE, file, export/import)
│   ├── cache.ts        # Unified cache (Memory + Redis fallback)
│   └── resilience.ts   # Retry, timeout, circuit breaker, fallback
├── context.ts          # FiberRef-based request context (existing)
├── middleware.ts       # HTTP middleware composition (existing)
├── errors.ts           # Typed errors (existing)
└── observe/
    └── metrics.ts      # Metrics service (pattern reference)
```

### Pattern 1: Polymorphic Module (metrics.ts pattern)

**What:** Single file with dense FP code, unified polymorphic API, automatic context/metrics

**When to use:** All new http/ modules - cookies, stream, cache, resilience

**Example:**
```typescript
// Source: packages/server/src/observe/metrics.ts (existing pattern)
class MetricsService extends Effect.Service<MetricsService>()('server/Metrics', {
  effect: Effect.succeed({
    audit: { failures: Metric.counter('audit_failures_total'), ... },
    // Nested metric hierarchy for polymorphic access
  }),
}) {
  // Static methods for polymorphic operations
  static readonly label = (pairs: Record<string, string | undefined>) => ...
  static readonly inc = (counter, labels, value = 1) => ...
  static readonly trackEffect = (effect, config) => ...
  static readonly trackStream = (stream, counter, labels) => ...
}
```

### Pattern 2: Cookie Schema Validation at Boundary

**What:** Use `HttpServerRequest.schemaCookies` for typed cookie access

**When to use:** Any route handler reading cookies

**Example:**
```typescript
// Source: @effect/platform README
import { HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Schema } from "effect"

const handler = Effect.gen(function* () {
  const cookies = yield* HttpServerRequest.schemaCookies(
    Schema.Struct({ refreshToken: Schema.String })
  )
  return cookies.refreshToken
}).pipe(
  Effect.catchTag("ParseError", (e) =>
    HttpServerResponse.text(`Invalid cookie: ${e.message}`, { status: 400 })
  )
)
```

### Pattern 3: SSE Stream Response

**What:** Use `@effect/experimental Sse.encoder` for SSE formatting

**When to use:** Real-time event streams to browser clients

**Example:**
```typescript
// Source: @effect/experimental Sse.ts API
import * as Sse from "@effect/experimental/Sse"
import { HttpServerResponse } from "@effect/platform"
import { Stream } from "effect"

const sseStream = Stream.fromIterable(events).pipe(
  Stream.map((event) => Sse.encoder.write({
    _tag: "Event",
    event: "message",
    data: JSON.stringify(event),
    id: event.id
  })),
  Stream.map((s) => new TextEncoder().encode(s)) // Still need encoding for bytes
)

// Return with proper SSE content-type
HttpServerResponse.stream(sseStream, {
  contentType: "text/event-stream",
  headers: Headers.fromInput({ "Cache-Control": "no-cache" })
})
```

### Pattern 4: Cached Lookup with Request Deduplication

**What:** Use `Effect.Cache` for automatic request coalescing

**When to use:** Session lookups, app configuration, tenant settings

**Example:**
```typescript
// Source: packages/server/src/domain/session.ts (existing pattern)
const mfaEnabledCache = yield* Cache.make({
  capacity: 5000,
  lookup: (userId: string) => mfa.isEnabled(userId),
  timeToLive: Duration.minutes(5),
})

// Multiple concurrent lookups for same key coalesce into single call
const result = yield* mfaEnabledCache.get(userId)
```

### Pattern 5: Stream Buffering with Backpressure

**What:** Use `Stream.buffer` with explicit strategy per stream type

**When to use:** All streaming endpoints (SSE, file downloads, exports)

**Example:**
```typescript
// Source: effect/Stream.ts API
const exportStream = dataSource.pipe(
  Stream.buffer({
    capacity: 256,      // Powers of 2 optimal
    strategy: "suspend" // Backpressure: block producer when full
  })
)

const sseStream = events.pipe(
  Stream.buffer({
    capacity: 64,
    strategy: "sliding" // Drop oldest on overflow (real-time, stale data useless)
  })
)
```

### Pattern 6: FiberRef for Tenant Context Propagation

**What:** Use `Effect.locally` or `Effect.locallyWith` for scoped context

**When to use:** Automatic tenant ID prefixing in cache, automatic context in metrics

**Example:**
```typescript
// Source: packages/server/src/context.ts (existing pattern)
const _ref = FiberRef.unsafeMake<Context.Request.Data>(_default)

// Scoped modification
static readonly within = <A, E, R>(
  tenantId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.locallyWith(effect, _ref, (current) => ({
    ...current,
    tenantId
  }))
```

### Anti-Patterns to Avoid

- **Hand-rolled cookie parsing:** Use `HttpServerRequest.schemaCookies` - handles encoding, errors, validation
- **Manual TextEncoder for SSE:** Use `Sse.encoder.write()` - handles SSE spec compliance
- **Unbounded buffers:** Always specify `capacity` - prevents OOM under load
- **try/catch in Effect code:** Use `Effect.catchTag` - maintains typed error channel
- **Mixing async/await with Effect:** Use `Effect.promise` for interop - keeps pipeline traceable
- **Separate retry wrapper functions:** Use `Effect.retry(effect, schedule)` - composable, traceable

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie parsing | Manual string.split | `HttpServerRequest.schemaCookies` | Handles encoding, SameSite, Secure, expires |
| SSE formatting | `data: ${json}\n\n` strings | `Sse.encoder.write` | Handles retry field, event type, id, newlines |
| Request deduplication | Custom Map + Promise tracking | `Effect.Cache` | Automatic TTL, LRU, fiber-safe coalescing |
| Exponential backoff | Custom delay calculation | `Schedule.exponential` | Composable with jitter, limits, conditions |
| Circuit state machine | Custom open/half-open/closed | Keep cockatiel `circuitBreaker` | Proven implementation, metrics integration |
| Tenant key prefixing | Manual `${tenantId}:${key}` | `KeyValueStore.prefix` or FiberRef-derived | Automatic propagation via fiber context |

**Key insight:** Effect ecosystem provides official primitives for nearly all HTTP platform concerns. The 12-15+ imports mentioned in CONTEXT.md (Array, Match, Channel, Cache, Config, Context, Data, Encoding, Fiber*, Hash*, Duration) should replace custom utilities.

## Common Pitfalls

### Pitfall 1: Unbounded Stream Memory Growth

**What goes wrong:** Streams buffer indefinitely when producer outpaces consumer, causing OOM under load.

**Why it happens:** Default `Stream.buffer({ capacity: "unbounded" })` or forgetting buffer config entirely.

**How to avoid:** Always specify numeric capacity with appropriate strategy:
- `suspend`: Standard choice, natural backpressure
- `sliding`: Real-time streams where old data is stale
- `dropping`: Fire-and-forget where loss is acceptable

**Warning signs:** Memory growth during sustained streaming, OOM errors under load.

### Pitfall 2: Cookie Schema Validation Misalignment

**What goes wrong:** Schema expects required cookie, but browser never sent it (first visit, cleared).

**Why it happens:** Using `Schema.Struct({ x: Schema.String })` instead of `Schema.Struct({ x: Schema.optional(Schema.String) })`.

**How to avoid:** Model cookie presence as Optional in schema, handle None case explicitly.

**Warning signs:** ParseError on first visit, 500 errors for unauthenticated users.

### Pitfall 3: Effect.Cache vs KeyValueStore Confusion

**What goes wrong:** Using Cache for persistent data or KeyValueStore for computed lookups.

**Why it happens:** Similar-sounding names, overlapping use cases.

**How to avoid:**
- `Effect.Cache`: Request deduplication, computed values, automatic TTL expiration
- `KeyValueStore`: Simple key-value persistence, manual TTL, swappable backends

**Warning signs:** Over-engineering simple gets/sets, under-engineering computed lookups.

### Pitfall 4: Retry Without Timeout

**What goes wrong:** Retries continue indefinitely on slow/hung services.

**Why it happens:** `Effect.retry(schedule)` without `Effect.timeout`.

**How to avoid:** Always compose: `effect.pipe(Effect.retry(schedule), Effect.timeout(duration))`.

**Warning signs:** Hung requests, resource exhaustion, cascading failures.

### Pitfall 5: SSE Event ID Omission

**What goes wrong:** Clients can't resume from last event after reconnection.

**Why it happens:** Not setting `id` field in SSE events.

**How to avoid:** Include monotonic or UUID event IDs in every event.

**Warning signs:** Duplicate events after reconnection, data gaps on flaky connections.

### Pitfall 6: Circuit Breaker Without Fallback

**What goes wrong:** BrokenCircuitError propagates to user as 500.

**Why it happens:** Circuit opens but no fallback behavior defined.

**How to avoid:** Use `Effect.catchTag("BrokenCircuitError", fallbackEffect)` or wrap in resilience module.

**Warning signs:** 500 errors correlating with external service degradation.

## Code Examples

Verified patterns from official sources:

### Cookie Operations with Schema Validation

```typescript
// Source: @effect/platform README + existing context.ts patterns
import { Cookies, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { Effect, Schema as S } from "effect"

// Cookie schemas - define once, validate at boundary
const RefreshTokenCookie = S.Struct({ refreshToken: S.String })
const OAuthStateCookie = S.Struct({ oauthState: S.String })

// Read with validation
const getRefreshToken = HttpServerRequest.schemaCookies(RefreshTokenCookie).pipe(
  Effect.map((c) => c.refreshToken),
  Effect.catchTag("ParseError", () => Effect.fail(new AuthError("Invalid refresh token")))
)

// Set with proper options (existing pattern from context.ts)
const setRefreshToken = (value: string) => (res: HttpServerResponse.HttpServerResponse) =>
  HttpServerResponse.setCookie(res, "refreshToken", value, {
    httpOnly: true,
    maxAge: Duration.days(30),
    path: "/api/auth",
    sameSite: "lax",
    secure: isProduction,
  })
```

### Unified Cache with Tenant Isolation

```typescript
// Source: effect/Cache.ts API + context.ts FiberRef pattern
import { Cache, Duration, Effect, FiberRef } from "effect"

const makeUnifiedCache = <K, V, E>(config: {
  capacity: number
  lookup: (key: K) => Effect.Effect<V, E>
  ttl: Duration.Duration
}) =>
  Effect.gen(function* () {
    const cache = yield* Cache.make({
      capacity: config.capacity,
      lookup: (compositeKey: { tenantId: string; key: K }) =>
        config.lookup(compositeKey.key),
      timeToLive: config.ttl,
    })

    return {
      get: (key: K) =>
        Effect.gen(function* () {
          const tenantId = yield* Context.Request.tenantId
          return yield* cache.get({ tenantId, key })
        }),
      invalidate: (key: K) =>
        Effect.gen(function* () {
          const tenantId = yield* Context.Request.tenantId
          yield* cache.invalidate({ tenantId, key })
        }),
    }
  })
```

### SSE Stream with Proper Buffering

```typescript
// Source: @effect/experimental Sse.ts + Stream buffer API
import * as Sse from "@effect/experimental/Sse"
import { HttpServerResponse } from "@effect/platform"
import { Effect, Schedule, Stream } from "effect"

const createSseResponse = <A>(
  events: Stream.Stream<A>,
  serialize: (a: A) => { id?: string; event?: string; data: string }
) => {
  const sseStream = events.pipe(
    Stream.map((a) => {
      const { id, event, data } = serialize(a)
      return Sse.encoder.write({
        _tag: "Event",
        event: event ?? "message",
        data,
        id,
      })
    }),
    Stream.map((s) => new TextEncoder().encode(s)),
    Stream.buffer({ capacity: 64, strategy: "sliding" }) // Drop stale for real-time
  )

  return HttpServerResponse.stream(sseStream, {
    contentType: "text/event-stream",
    headers: Headers.fromInput({
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    }),
  })
}
```

### Resilience Composition

```typescript
// Source: effect/Schedule.ts + Effect retry API
import { Duration, Effect, Schedule } from "effect"

// Composable retry schedule with jitter
const defaultRetrySchedule = Schedule.exponential(Duration.millis(100), 2).pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.upTo(Duration.seconds(10))
)

// Resilient effect wrapper
const withResilience = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config?: { timeout?: Duration.Duration; retries?: number }
) =>
  effect.pipe(
    Effect.retry(
      config?.retries !== undefined
        ? Schedule.recurs(config.retries)
        : defaultRetrySchedule
    ),
    Effect.timeout(config?.timeout ?? Duration.seconds(30)),
    Effect.catchTag("TimeoutException", () =>
      Effect.fail(new Error("Operation timed out"))
    )
  )
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `Set-Cookie` headers | `HttpServerResponse.setCookie` | @effect/platform 0.90+ | Type-safe options, proper encoding |
| Custom SSE string formatting | `Sse.encoder.write` | @effect/experimental 0.50+ | Spec-compliant event formatting |
| Hand-rolled cache Map | `Effect.Cache.make` | effect 3.0+ | Request deduplication, LRU, TTL |
| `async/await` + try/catch | `Effect.gen` + typed errors | effect 3.0+ | Full traceability, typed error channel |
| Polly/resilience4j patterns | `Effect.retry` + `Schedule` | effect 3.0+ | Native Effect composition, spans |

**Deprecated/outdated:**
- `@effect/stream` package: Merged into `effect` core as `Stream` module
- Manual `Effect.runPromise` wrapping: Use `Effect.gen` throughout
- `Effect.catchAll` for specific tags: Use `Effect.catchTag` for precision

## Open Questions

Things that couldn't be fully resolved:

1. **Redis KeyValueStore adapter**
   - What we know: `KeyValueStore.layerMemory` exists for in-memory, `layerFileSystem` for disk
   - What's unclear: No official Redis adapter; need custom implementation using `KeyValueStore.make`
   - Recommendation: Defer to Phase 3 per CONTEXT.md; use memory-first cache now

2. **Sse integration with HttpApi declarative endpoints**
   - What we know: Can return `HttpServerResponse.stream` from handlers
   - What's unclear: How to declare SSE endpoint type in `HttpApiEndpoint.addSuccess`
   - Recommendation: Use `HttpApiSchema.withEncoding({ kind: "Text", contentType: "text/event-stream" })`

3. **cockatiel vs pure Effect for circuit breaker**
   - What we know: Effect has `Effect.retry`, `Schedule`, `Effect.timeout`; cockatiel has `CircuitBreakerPolicy`
   - What's unclear: Effect doesn't have native circuit breaker state machine
   - Recommendation: Keep cockatiel for circuit breaker (proven in oauth.ts), use Effect for retry/timeout

4. **Worker pool integration for heavy parsing**
   - What we know: `@effect/experimental` has `SerializedWorkerPool`
   - What's unclear: Integration pattern with streaming engine
   - Recommendation: Deferred to Phase 3 per CONTEXT.md; establish streaming foundation in Phase 1

## Sources

### Primary (HIGH confidence)

- [effect-ts/effect GitHub](https://github.com/Effect-TS/effect) - Official repository, source code for Cache, Stream, Schedule
- [@effect/platform README](https://github.com/effect-ts/effect/blob/main/packages/platform/README.md) - Cookies, HttpServerResponse, KeyValueStore documentation
- [effect/Cache.ts](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Cache.ts) - Cache API: make, lookup, TTL, capacity
- [effect/Stream.ts](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Stream.ts) - Buffer strategies: suspend, dropping, sliding
- [@effect/experimental Sse.ts](https://github.com/Effect-TS/effect/blob/main/packages/experimental/src/Sse.ts) - SSE encoder API
- [effect/Schedule.ts](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schedule.ts) - exponential, jittered, intersect, recurs
- [Effect Documentation - Retrying](https://effect.website/docs/error-management/retrying/) - retry, retryOrElse patterns

### Secondary (MEDIUM confidence)

- [cockatiel npm](https://www.npmjs.com/package/cockatiel) - Circuit breaker documentation
- Existing codebase: `packages/server/src/observe/metrics.ts`, `packages/server/src/security/circuit.ts`, `packages/server/src/context.ts`

### Tertiary (LOW confidence)

- WebSearch results for Effect SSE patterns - limited official documentation found

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, verified from official sources
- Architecture: HIGH - Patterns derived from existing codebase (metrics.ts) and official docs
- Pitfalls: MEDIUM - Some derived from experience, some from official docs
- SSE integration: MEDIUM - API verified, HttpApi integration pattern needs validation

**Research date:** 2026-01-26
**Valid until:** 2026-02-26 (30 days - stable Effect ecosystem)
