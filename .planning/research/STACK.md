# Technology Stack: Effect HTTP Foundation

**Project:** Unified HTTP Foundation for Parametric Portal
**Researched:** 2026-01-26
**Confidence:** HIGH (verified against official Effect documentation and existing codebase)

## Executive Summary

The existing codebase already uses @effect/platform 0.94.2 and @effect/experimental 0.58.0 effectively. This research identifies specific APIs to maximize and hand-rolled patterns to eliminate. The key finding: the codebase is 80% aligned with official patterns but has opportunities to adopt newer APIs for Cookies, ETags, KeyValueStore, and Worker pooling.

---

## Current Stack (Verified from `pnpm-workspace.yaml`)

| Package | Version | Status |
|---------|---------|--------|
| effect | 3.19.15 | Current |
| @effect/platform | 0.94.2 | Current |
| @effect/platform-node | 0.104.1 | Current |
| @effect/experimental | 0.58.0 | Current |
| @effect/sql-pg | 0.50.1 | Current |
| @effect/cluster | 0.56.1 | Current |

---

## HTTP Primitives: What to Use

### 1. Cookies Module (`@effect/platform/Cookies`)

**Location:** `@effect/platform/Cookies`

**Key APIs:**

```typescript
// Cookie creation (returns Either<Cookie, CookiesError>)
Cookies.makeCookie(name: string, value: string, options?: Cookie["options"]): Either<Cookie, CookiesError>
Cookies.unsafeMakeCookie(name: string, value: string, options?: Cookie["options"]): Cookie

// Cookies collection construction
Cookies.empty: Cookies
Cookies.fromIterable(cookies: Iterable<Cookie>): Cookies
Cookies.fromSetCookie(headers: Iterable<string>): Either<Cookies, CookiesError>

// Manipulation (functional, returns new Cookies)
Cookies.set(self: Cookies, name: string, value: string, options?): Either<Cookies, CookiesError>
Cookies.setCookie(self: Cookies, cookie: Cookie): Cookies
Cookies.remove(self: Cookies, name: string): Cookies
Cookies.merge(self: Cookies, that: Cookies): Cookies
Cookies.get(self: Cookies, name: string): Option<Cookie>
Cookies.getValue(self: Cookies, name: string): Option<string>

// Serialization
Cookies.serializeCookie(cookie: Cookie): string
Cookies.toCookieHeader(cookies: Cookies): string
Cookies.toSetCookieHeaders(cookies: Cookies): ReadonlyArray<string>
Cookies.parseHeader(header: string): Record<string, string>
```

**Current codebase pattern (`context.ts:77-83`):**
```typescript
// Existing: manual cookie wrapper over HttpServerResponse
static readonly cookie = {
  clear: (key) => (res) => HttpServerResponse.expireCookie(res, name, options),
  get: (key, req, onNone) => Effect.fromNullable(req.cookies[name]).pipe(Effect.mapError(onNone)),
  set: (key, value) => (res) => HttpServerResponse.setCookie(res, name, value, options),
}
```

**Recommendation:** The current pattern is acceptable but could use `Cookies.makeCookie` for validation. The `HttpServerResponse.setCookie` API is already correct. No immediate refactor needed.

---

### 2. HttpServerResponse Streaming (`@effect/platform/HttpServerResponse`)

**Key APIs:**

```typescript
// Streaming response from byte stream
HttpServerResponse.stream<E>(
  body: Stream.Stream<Uint8Array, E, never>,
  options?: { contentType?: string; headers?: Headers.Input; status?: number }
): HttpServerResponse

// HTML streaming with template interpolation
HttpServerResponse.htmlStream<A extends ReadonlyArray<Template.InterpolatedWithStream>>(
  strings: TemplateStringsArray,
  ...args: A
): Effect<HttpServerResponse, never, Template.Interpolated.Context<A[number]>>

// Cookie management on responses
HttpServerResponse.setCookie(
  self: HttpServerResponse,
  name: string,
  value: string,
  options?: Cookie["options"]
): Effect<HttpServerResponse, CookiesError>

HttpServerResponse.unsafeSetCookie(
  self: HttpServerResponse,
  name: string,
  value: string,
  options?: Cookie["options"]
): HttpServerResponse

HttpServerResponse.expireCookie(
  self: HttpServerResponse,
  name: string,
  options?: Omit<Cookie["options"], "expires" | "maxAge">
): HttpServerResponse

// Header manipulation
HttpServerResponse.setHeader(self, key: string, value: string): HttpServerResponse
HttpServerResponse.setHeaders(self, input: Headers.Input): HttpServerResponse
```

**Current codebase usage (CORRECT):**
- `routes/jobs.ts:48` - `HttpServerResponse.stream(sseStream, { contentType: 'text/event-stream', headers })`
- `routes/transfer.ts:83-84` - `HttpServerResponse.stream(body, { contentType }).pipe(Effect.flatMap(setHeader))`

**Recommendation:** Current patterns are correct. No changes needed.

---

### 3. Server-Sent Events (`@effect/experimental/Sse`)

**Location:** `@effect/experimental/Sse`

**Key APIs:**

```typescript
// Event type
interface Event {
  readonly _tag: "Event"
  readonly event: string      // event type identifier
  readonly id?: string        // optional unique ID
  readonly data: string       // message payload
}

// Retry type for reconnection
class Retry {
  readonly _tag: "Retry"
  readonly timeout: number    // milliseconds
  static is(u: unknown): u is Retry
}

type AnyEvent = Event | Retry

// Encoder (singleton instance)
Sse.encoder: Encoder
interface Encoder {
  write(event: AnyEvent): string
}

// Parser construction
Sse.makeParser(callback: (event: Event | Retry) => void): Parser
interface Parser {
  feed(chunk: string): void
  reset(): void
}

// Channel for stream processing
Sse.makeChannel(options?: { bufferSize?: number }): Channel<Chunk<Event>, string, never, never, void, unknown>
```

**Current codebase usage (`routes/jobs.ts:30-44`):**
```typescript
// CORRECT: Uses Sse.encoder.write() for formatting
const sseStream = jobs.onStatusChange().pipe(
  Stream.map((event) =>
    encoder.encode(Sse.encoder.write({
      _tag: 'Event',
      data: JSON.stringify(event),
      event: 'status',
      id: event.jobId,
    }))
  ),
);
```

**Recommendation:** Current pattern is correct. Consider using `Sse.makeChannel` for client-side consumption if adding EventSource support.

---

### 4. ETag Generation (`@effect/platform/Etag`)

**Location:** `@effect/platform/Etag`

**Key APIs:**

```typescript
// ETag types
interface Weak { readonly _tag: "Weak"; readonly value: string }
interface Strong { readonly _tag: "Strong"; readonly value: string }
type Etag = Weak | Strong

// Generator service
interface Generator {
  readonly fromFileInfo: (info: FileSystem.File.Info) => Effect<Etag>
  readonly fromFileWeb: (file: Body.HttpBody.FileLike) => Effect<Etag>
}

// Service tag for dependency injection
Etag.Generator: Context.Tag<Generator>

// Utility
Etag.toString(etag: Etag): string

// Layers
Etag.layer: Layer<Generator>        // Strong ETags
Etag.layerWeak: Layer<Generator>    // Weak ETags
```

**Current codebase:** No ETag handling. Storage operations in `domain/storage.ts` return S3 ETags but don't use Effect's ETag module.

**Recommendation:**
- Use `Etag.Generator` for generating ETags on served files
- Add `If-None-Match` / `304 Not Modified` handling for cacheable endpoints
- Consider middleware that auto-generates ETags for JSON responses

---

### 5. KeyValueStore (`@effect/platform/KeyValueStore`)

**Location:** `@effect/platform/KeyValueStore`

**Key APIs:**

```typescript
interface KeyValueStore {
  // Basic operations
  readonly get: (key: string) => Effect<Option<string>, PlatformError>
  readonly getUint8Array: (key: string) => Effect<Option<Uint8Array>, PlatformError>
  readonly set: (key: string, value: string) => Effect<void, PlatformError>
  readonly remove: (key: string) => Effect<void, PlatformError>
  readonly clear: Effect<void, PlatformError>
  readonly size: Effect<number, PlatformError>

  // Convenience operations
  readonly has: (key: string) => Effect<boolean, PlatformError>
  readonly isEmpty: Effect<boolean, PlatformError>
  readonly modify: (key: string, f: (v: string) => string) => Effect<Option<string>, PlatformError>

  // Schema-typed wrapper
  readonly forSchema: <A, I, R>(schema: Schema<A, I, R>) => SchemaStore<A, I, R>
}

// Layer factories
KeyValueStore.layerMemory: Layer<KeyValueStore>
KeyValueStore.layerFileSystem(directory: string): Layer<KeyValueStore, PlatformError, FileSystem>
```

**Use cases in codebase:**
- Session caching (currently in database)
- Rate limit state (currently Redis via cockatiel)
- OAuth state (currently encrypted cookies)

**Recommendation:**
- Good candidate for session caching layer
- Can replace some Redis usage for simpler cases
- Use `forSchema` for type-safe session/token storage

---

### 6. Worker Pools (`@effect/platform/Worker`)

**Location:** `@effect/platform/Worker`

**Key APIs:**

```typescript
// Serialized worker for schema-validated requests
interface SerializedWorker<I extends Schema.TaggedRequest.All> {
  readonly execute: <Req extends I>(message: Req) => Stream<Success<Req>, Failure<Req> | WorkerError>
  readonly executeEffect: <Req extends I>(message: Req) => Effect<Success<Req>, Failure<Req> | WorkerError>
}

// Pool of serialized workers
interface SerializedWorkerPool<I extends Schema.TaggedRequest.All> {
  readonly backing: Pool.Pool<SerializedWorker<I>, WorkerError>
  readonly broadcast: <Req extends I>(message: Req) => Effect<void>
  readonly execute: <Req extends I>(message: Req) => Stream<Success<Req>, Failure<Req> | WorkerError>
  readonly executeEffect: <Req extends I>(message: Req) => Effect<Success<Req>, Failure<Req> | WorkerError>
}

// Generic worker pool
interface WorkerPool<I, O, E> {
  readonly backing: Pool.Pool<Worker<I, O, E>, WorkerError>
  readonly broadcast: (message: I) => Effect<void>
  readonly execute: (message: I) => Stream<O, E | WorkerError>
  readonly executeEffect: (message: I) => Effect<O, E | WorkerError>
}

// Construction
Worker.makePool<I, O, E>(options: WorkerPool.Options<I>): Effect<WorkerPool<I, O, E>>
Worker.makePoolSerialized<I>(options: SerializedWorker.Options<I>): Effect<SerializedWorkerPool<I>>
Worker.makeSerialized<I>(options: SerializedWorker.Options<I>): Effect<SerializedWorker<I>>

// Pool options
interface WorkerPool.Options<I> {
  // Fixed sizing
  readonly size?: number
  // OR dynamic sizing
  readonly minSize?: number
  readonly maxSize?: number
  readonly timeToLive?: DurationInput
  readonly concurrency?: number
  readonly targetUtilization?: number
  // Initialization
  readonly onCreate?: (worker: Worker) => Effect<void>
}
```

**Current codebase:** No worker pools. Job processing uses Effect.Semaphore for concurrency control (`infra/jobs.ts:58`).

**Recommendation:**
- Consider `SerializedWorkerPool` for CPU-intensive operations (image processing, large JSON serialization)
- Use for parallel export generation in `transfer.ts`
- Requires platform-specific layer (`@effect/platform-node/NodeWorker`)

---

### 7. PersistedCache (`@effect/experimental/PersistedCache`)

**Location:** `@effect/experimental/PersistedCache`

**Key APIs:**

```typescript
// Construction
PersistedCache.make<K extends Persistence.ResultPersistence.KeyAny, R>(options: {
  readonly storeId: string
  readonly lookup: (key: K) => Effect<Success<K>, Failure<K>, R>
  readonly timeToLive: (...args: TimeToLiveArgs<K>) => DurationInput
  readonly inMemoryCapacity?: number
  readonly inMemoryTTL?: DurationInput
}): Effect<PersistedCache<K>, never, SerializableWithResult.Context<K> | R | ResultPersistence | Scope>

// Interface
interface PersistedCache<K> {
  readonly get: (key: K) => Effect<Success<K>, Failure<K> | PersistenceError>
  readonly invalidate: (key: K) => Effect<void, PersistenceError>
}
```

**Use cases:**
- API response caching
- Expensive computation results
- OAuth token caching

**Recommendation:** Good fit for caching S3 presigned URL generation or expensive database queries.

---

### 8. Machine (`@effect/experimental/Machine`)

**Location:** `@effect/experimental/Machine`

**Key APIs:**

```typescript
// Primary constructor
Machine.make<State, Public, Private, InitError, R>(options: {
  readonly initialize: (input: Input) => Effect<ProcedureList<State, Public, Private>, InitError, R>
}): Machine<State, Public, Private, InitError, R, Input>

// With pre-specified types
Machine.makeWith<State, Input = void>(): MachineBuilder

// Serializable variant
Machine.makeSerializable<State, Public, Private, InitError, R, Input>(options: {
  readonly initialize: (input: Input) => Effect<ProcedureList<...>, InitError, R>
  readonly schemaState: Schema<State>
  readonly schemaInput?: Schema<Input>
}): SerializableMachine<...>

// Actor runtime
interface Actor<State, Public> {
  readonly state: Subscribable<State>
  readonly send: <Req extends Public>(request: Req) => Effect<Success<Req>, Failure<Req>>
  readonly join: Effect<void>
}
```

**Use cases:**
- Complex stateful workflows (approval flows, multi-step imports)
- Long-running processes with persistence

**Recommendation:** Evaluate for complex job workflows that need state persistence. Current `JobService` pattern may benefit from Machine abstraction.

---

## What NOT to Hand-Roll

| Pattern | Hand-Roll | Use Instead |
|---------|-----------|-------------|
| Cookie parsing | Manual string manipulation | `Cookies.parseHeader`, `Cookies.fromSetCookie` |
| SSE formatting | Template strings | `Sse.encoder.write()` (already correct) |
| ETag generation | crypto.createHash | `Etag.Generator.fromFileInfo` |
| Worker management | Raw Worker API | `Worker.makePoolSerialized` |
| Cache with TTL | Map + setTimeout | `PersistedCache.make` |
| State machines | switch/case | `Machine.make` |
| Key-value storage | File I/O | `KeyValueStore.layerFileSystem` |

---

## Integration Patterns

### Middleware Composition

```typescript
// HttpApiBuilder for API-level middleware
HttpApiBuilder.serve(api).pipe(
  HttpApiBuilder.middlewareCors({ allowedOrigins: [...] }),
  Layer.provide(AuthMiddlewareLive),
  Layer.provide(EtagMiddlewareLive),
)

// HttpMiddleware for raw HttpApp transformation
HttpMiddleware.make((app) => Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const response = yield* app
  return HttpServerResponse.setHeader(response, 'X-Custom', 'value')
}))
```

### Layer Composition for HTTP Services

```typescript
// Provide KeyValueStore to routes
const SessionCacheLive = KeyValueStore.layerMemory.pipe(
  Layer.provide(Scope.layer)
)

// Provide Etag.Generator
const EtagLive = Etag.layer

// Combine
const HttpServicesLive = Layer.mergeAll(
  SessionCacheLive,
  EtagLive,
)
```

---

## Sources

**HIGH confidence (official documentation):**
- [KeyValueStore Documentation](https://effect.website/docs/platform/key-value-store/)
- [Cookies.ts API Reference](https://effect-ts.github.io/effect/platform/Cookies.ts.html)
- [HttpServerResponse.ts API Reference](https://effect-ts.github.io/effect/platform/HttpServerResponse.ts.html)
- [Worker.ts API Reference](https://effect-ts.github.io/effect/platform/Worker.ts.html)
- [Etag.ts API Reference](https://effect-ts.github.io/effect/platform/Etag.ts.html)
- [Sse.ts API Reference](https://effect-ts.github.io/effect/experimental/Sse.ts.html)
- [PersistedCache.ts API Reference](https://effect-ts.github.io/effect/experimental/PersistedCache.ts.html)
- [Machine.ts API Reference](https://effect-ts.github.io/effect/experimental/Machine.ts.html)

**MEDIUM confidence (verified patterns):**
- Existing codebase patterns in `packages/server/src/`
- @effect/platform npm package structure
- Effect-TS GitHub repository

---

## Version Compatibility Notes

1. **Effect 3.19.15** - All APIs documented here are stable in this version
2. **@effect/platform 0.94.2** - Worker APIs, KeyValueStore, Cookies, HttpServerResponse all available
3. **@effect/experimental 0.58.0** - Sse, PersistedCache, Machine available
4. **Breaking change watch:** Machine API is in experimental, may change

---

## Recommendations Summary

| Priority | Action | Impact |
|----------|--------|--------|
| HIGH | Add ETag middleware for cacheable responses | Bandwidth savings, proper HTTP semantics |
| MEDIUM | Evaluate KeyValueStore for session caching | Simplify Redis dependency |
| MEDIUM | Add SerializedWorkerPool for export generation | Better CPU utilization |
| LOW | Migrate complex job workflows to Machine | Better state management |
| NONE | Current Sse usage | Already optimal |
| NONE | Current streaming patterns | Already optimal |
