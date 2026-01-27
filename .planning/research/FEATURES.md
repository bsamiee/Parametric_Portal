# Feature Landscape: Effect HTTP Primitives

**Domain:** Effect-based HTTP foundation for existing monorepo
**Researched:** 2026-01-26
**Overall Confidence:** HIGH (verified via official Effect documentation)

---

## Executive Summary

The @effect/platform and @effect/experimental packages provide comprehensive HTTP primitives that directly address the codebase's current pain points. The key insight: Effect already provides typed cookies, SSE encoding, worker pools, and caching primitives - the codebase just needs to adopt them instead of manual implementations.

**Current gaps identified:**
1. Manual cookie wrapper in `context.ts` (lines 77-83) - should use `Cookies` module directly
2. Manual SSE encoding in `jobs.ts` (line 26) with `TextEncoder` - partially uses `Sse.encoder` but still manual byte conversion
3. xlsx/zip parsing blocks event loop in `transfer.ts` - needs `SerializedWorkerPool` for CPU offload
4. No unified caching layer - should use `KeyValueStore` + `Cache` module

---

## Table Stakes

Features the codebase MUST adopt - no reasonable alternatives exist within Effect ecosystem.

| Feature | Module | Current Gap | Complexity | Confidence |
|---------|--------|-------------|------------|------------|
| Typed Cookies | `@effect/platform/Cookies` | Manual wrapper in `context.ts` | Low | HIGH |
| Cookie Response Helpers | `@effect/platform/HttpServerResponse` | Using `setCookie`/`expireCookie` correctly | Low | HIGH |
| SSE Encoding | `@effect/experimental/Sse` | Partial use, manual byte encoding | Low | HIGH |
| Stream Backpressure | `effect/Stream` | Already pull-based, needs buffer tuning | Low | HIGH |
| Effect.cached/cachedWithTTL | `effect/Effect` | No memoization layer | Medium | HIGH |
| Cache Module | `effect/Cache` | No request deduplication | Medium | HIGH |

### 1. Typed Cookies (`@effect/platform/Cookies`)

**What it provides:**
- `Cookies` interface: pipeable, inspectable container for HTTP cookies
- `Cookie` interface: name, value, domain, expires, maxAge, path, httpOnly, secure, sameSite
- `CookiesError` class for validation failures
- Construction: `empty`, `fromIterable`, `fromReadonlyRecord`, `fromSetCookie`, `makeCookie`
- Access: `get` (returns `Option<Cookie>`), `getValue` (returns `Option<string>`)
- Modification: `set`, `setCookie`, `setAllCookie`, `remove`, `merge`
- Serialization: `serializeCookie`, `toCookieHeader`, `toSetCookieHeaders`

**Current codebase pattern (context.ts:77-83):**
```typescript
// Manual wrapper - should be eliminated
static readonly cookie = {
  clear: (key) => (res) => HttpServerResponse.expireCookie(res, _cookie[key].name, _cookie[key].options),
  get: (key, req, onNone) => Effect.fromNullable(req.cookies[_cookie[key].name]).pipe(Effect.mapError(onNone)),
  set: (key, value) => (res) => HttpServerResponse.setCookie(res, _cookie[key].name, value, _cookie[key].options),
}
```

**Recommended pattern:**
```typescript
// Use Cookies module directly with schema validation
const OAuthCookie = Cookies.forSchema(OAuthStateSchema)
const RefreshCookie = Cookies.forSchema(RefreshTokenSchema)
```

**Migration effort:** Low - mostly API alignment, no architectural change.

---

### 2. SSE Encoding (`@effect/experimental/Sse`)

**What it provides:**
- `Event` interface: `{ _tag: "Event", event: string, id: string | undefined, data: string }`
- `Retry` class: reconnection behavior signaling
- `Parser` interface: `feed(chunk: string)`, `reset()` for incremental parsing
- `Encoder` interface: `write(event: AnyEvent): string` for serialization
- `makeParser(onParse)`: callback-based stream parser
- `makeChannel(options?)`: Channel for string -> Event transformation
- `encoder`: pre-built singleton for serializing events

**Current codebase pattern (jobs.ts:26-46):**
```typescript
const encoder = new TextEncoder();  // Manual TextEncoder - unnecessary
const sseStream = jobs.onStatusChange().pipe(
  Stream.map((event) =>
    encoder.encode(Sse.encoder.write({  // Using Sse.encoder.write correctly!
      _tag: 'Event',
      data: JSON.stringify(event),
      event: 'status',
      id: event.jobId,
    })),
  ),
);
```

**Recommended pattern:**
```typescript
// Eliminate manual TextEncoder, use Effect's built-in encoding
const sseStream = jobs.onStatusChange().pipe(
  Stream.map((event) => Sse.encoder.write({
    _tag: 'Event',
    data: JSON.stringify(event),
    event: 'status',
    id: event.jobId,
  })),
  Stream.encodeText,  // Effect's text encoding
);
```

**Migration effort:** Low - already partially adopted, just cleanup.

---

### 3. Stream Backpressure (Built-in)

**What Effect provides:**
- Pull-based streams with automatic backpressure
- `Stream.buffer(options)` for explicit buffering
- `Stream.grouped(n)` for batching (already used in transfer.ts:199)
- `Stream.throttle(...)` for rate limiting
- Default chunk size: 4096 elements

**Current codebase:**
- Already uses `Stream.grouped` in transfer.ts for batching
- Already uses `Stream.fromAsyncIterable` for S3 responses

**Recommendation:** Current patterns are correct. Add explicit buffer tuning for SSE streams if connection delays cause memory growth.

---

### 4. Effect Caching Layer

**What Effect provides:**

`Cache.make`:
```typescript
Cache.make({
  capacity: number,
  timeToLive: Duration,
  lookup: (key: Key) => Effect<Value, Error, Requirements>
})
```

Core methods:
- `get(key)`: retrieve or compute with deduplication
- `refresh(key)`: recompute without blocking reads
- `invalidate(key)` / `invalidateAll()`
- `cacheStats`: hit/miss metrics

`Effect.cached` / `Effect.cachedWithTTL`:
```typescript
Effect.cachedWithTTL(expensiveEffect, Duration.minutes(5))
```

**Current codebase gap:** No request deduplication, no TTL-based caching for:
- Session lookups (middleware.ts SessionAuth)
- App namespace lookups (middleware.ts makeAppLookup)
- OAuth token validation

**Recommended pattern:**
```typescript
// Session cache with TTL
const sessionCache = yield* Cache.make({
  capacity: 10000,
  timeToLive: Duration.minutes(5),
  lookup: (hash: Hex64) => db.sessions.findByHash(hash)
})
```

**Migration effort:** Medium - requires service refactoring.

---

## Differentiators

Features that provide significant value over manual implementations. Not strictly required but strongly recommended.

| Feature | Module | Value Proposition | Complexity | Confidence |
|---------|--------|-------------------|------------|------------|
| KeyValueStore | `@effect/platform/KeyValueStore` | Unified cache interface, swappable backends | Medium | HIGH |
| SerializedWorkerPool | `@effect/platform/Worker` | CPU offload with schema validation | High | HIGH |
| HttpServerResponse helpers | `@effect/platform/HttpServerResponse` | Streaming, ETag, file responses | Low | HIGH |
| Schema-validated stores | `KeyValueStore.forSchema` | Type-safe cache entries | Low | HIGH |

### 1. KeyValueStore (`@effect/platform/KeyValueStore`)

**What it provides:**

Core interface:
```typescript
interface KeyValueStore {
  get(key: string): Effect<Option<string>, PlatformError>
  getUint8Array(key: string): Effect<Option<Uint8Array>, PlatformError>
  set(key: string, value: string | Uint8Array): Effect<void, PlatformError>
  remove(key: string): Effect<void, PlatformError>
  has(key: string): Effect<boolean, PlatformError>
  size(): Effect<number, PlatformError>
  clear(): Effect<void, PlatformError>
  modify(key, f): Effect<Option<string>, PlatformError>
  isEmpty(): Effect<boolean, PlatformError>
}
```

Built-in implementations:
- `layerMemory`: in-memory, ideal for testing/development
- `layerFileSystem`: file-based persistent storage

Schema-validated stores:
```typescript
const typedStore = keyValueStore.forSchema(PersonSchema)
await typedStore.set("user1", { name: "Alice", age: 30 })
const result = await typedStore.get("user1")  // Option<Person>
```

**Current codebase gap:** No unified cache abstraction. Redis usage is scattered.

**Value:**
- Swap backends without code changes (memory -> redis -> file)
- Schema validation at cache boundary
- Consistent error handling via `PlatformError`

**Note:** Official Redis implementation not found in @effect/platform. Community implementation or custom adapter needed for production.

**Migration effort:** Medium - need to create Redis adapter implementing KeyValueStore interface.

---

### 2. SerializedWorkerPool (`@effect/platform/Worker`)

**What it provides:**

```typescript
interface SerializedWorkerPool<I> {
  backing: Pool.Pool<SerializedWorker<I>, WorkerError>
  broadcast<Req>(message: Req): Effect<void, ...>
  execute<Req>(message: Req): Stream<A, E | WorkerError>
  executeEffect<Req>(message: Req): Effect<A, E | WorkerError>
}
```

Construction:
```typescript
makePoolSerialized(options: {
  size: number,           // Fixed pool size
  // OR
  minSize: number,
  maxSize: number,
  timeToLive: Duration,   // Dynamic sizing

  onCreate?: (worker) => Effect<void>,
  targetUtilization?: number
})
```

Workers use `Schema.TaggedRequest` for typed request/response.

**Current codebase gap (transfer.ts):**
```typescript
// These block the event loop:
const _xlsx = (...) => Stream.unwrap(_drivers.excel().pipe(...))
const _zip = (...) => Stream.unwrap(_drivers.zip().pipe(...))
```

xlsx parsing with `exceljs` and zip decompression with `jszip` are CPU-intensive and block the Node.js event loop during large file processing.

**Recommended pattern:**
```typescript
// Define worker request schema
class ParseXlsx extends Schema.TaggedRequest<ParseXlsx>()("ParseXlsx", {
  failure: TransferError.Fatal,
  success: Schema.Array(AssetSchema),
  payload: { buffer: Schema.Uint8Array }
}) {}

// Use worker pool
const pool = yield* SerializedWorkerPool.make({ size: 4 })
const results = yield* pool.executeEffect(new ParseXlsx({ buffer }))
```

**Migration effort:** High - requires:
1. Worker script setup
2. Request/response schema definitions
3. Pool lifecycle management
4. Error propagation handling

---

### 3. HttpServerResponse Helpers

**What it provides:**

Streaming:
- `stream(stream: Stream<Uint8Array>, options?)`: streaming response
- `file(path)` / `fileWeb(file)`: file streaming with content-type detection

Cookies:
- `setCookie(name, value, options)` / `setCookies(cookies)`: with validation (returns Effect)
- `unsafeSetCookie` / `unsafeSetCookies`: synchronous, no validation
- `expireCookie(name, options)`: mark for expiration
- `updateCookies(f)`: apply transformation

Headers/Status:
- `setHeader(name, value)` / `setHeaders(headers)`
- `setStatus(code, text?)`

Content constructors:
- `json(value)` / `unsafeJson(value)`: JSON serialization
- `text(content)`: plain text
- `html(template)` / `htmlStream(stream)`: HTML responses
- `schemaJson(schema, value)`: schema-validated JSON

**Current usage:** Already using `HttpServerResponse.stream`, `setCookie`, `expireCookie` correctly.

**Opportunity:** Consider `schemaJson` for type-safe API responses.

---

## Anti-Features

Things to explicitly NOT do in Effect HTTP code.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Manual TextEncoder for SSE | Effect provides encoding utilities | Use `Stream.encodeText` or let SSE module handle it |
| try/catch in Effect code | Breaks error channel composition | Use Effect.try, Effect.catchTag |
| Raw redis client calls | No type safety, scattered error handling | Wrap in KeyValueStore or custom Effect service |
| Synchronous file I/O in handlers | Blocks event loop | Use FileSystem service with Effect |
| Promise.all for parallel effects | Loses Effect benefits | Use Effect.all with concurrency option |
| Manual cookie parsing | Error-prone, inconsistent | Use Cookies.fromSetCookie, parseHeader |

### Detailed Anti-Patterns

**1. Manual byte encoding for SSE:**
```typescript
// BAD - unnecessary manual work
const encoder = new TextEncoder();
Stream.map((event) => encoder.encode(Sse.encoder.write(event)))

// GOOD - let Effect handle encoding
Stream.map((event) => Sse.encoder.write(event)).pipe(Stream.encodeText)
```

**2. Blocking CPU work in request handlers:**
```typescript
// BAD - blocks event loop
const xlsx = await workbook.xlsx.readFile(path)  // Sync CPU work

// GOOD - offload to worker pool
const result = yield* workerPool.executeEffect(new ParseXlsx({ buffer }))
```

**3. Scattered cache logic:**
```typescript
// BAD - redis calls throughout codebase
const cached = await redis.get(key)
if (!cached) {
  const value = await compute()
  await redis.set(key, value, 'EX', 300)
}

// GOOD - unified through Cache or KeyValueStore
const value = yield* cache.get(key)  // Auto-compute if missing
```

---

## Feature Dependencies

```
KeyValueStore
    |
    v
Cache.make (uses KV as backing store option)
    |
    v
Session/App caching in middleware

SerializedWorkerPool
    |
    v
Transfer parsing (xlsx, zip)

Sse + Stream encoding
    |
    v
Job status streaming (already partially implemented)

Cookies module
    |
    v
OAuth/Session cookie handling
```

---

## Migration Priority

Based on pain points and effort:

### Phase 1: Low-Hanging Fruit (Low effort, immediate value)
1. **SSE cleanup** - Remove manual TextEncoder in jobs.ts
2. **Cookies adoption** - Align context.ts wrapper with Cookies module patterns
3. **Cache.make** - Add request deduplication for session lookups

### Phase 2: Unified Caching (Medium effort, high value)
1. **KeyValueStore adapter** - Create Redis implementation
2. **Schema-validated stores** - Type-safe session/token caching
3. **Cache integration** - Wire KeyValueStore as Cache backing

### Phase 3: Worker Offload (High effort, critical for scale)
1. **Worker pool setup** - SerializedWorkerPool infrastructure
2. **Transfer migration** - Move xlsx/zip parsing to workers
3. **Request schemas** - Define TaggedRequest for all worker operations

---

## Gaps Requiring Custom Implementation

| Gap | Status | Recommendation |
|-----|--------|----------------|
| Redis KeyValueStore | Not in @effect/platform | Create custom adapter implementing KeyValueStore interface |
| ETag generation | Not built-in | Use existing HttpServerResponse.setHeader with manual ETag computation |
| Response compression | Not built-in | Use middleware or platform-specific (Node compression) |

---

## Sources

**HIGH Confidence (Official Documentation):**
- [Effect Cookies Module](https://effect-ts.github.io/effect/platform/Cookies.ts.html)
- [Effect HttpServerResponse](https://effect-ts.github.io/effect/platform/HttpServerResponse.ts.html)
- [Effect Worker Module](https://effect-ts.github.io/effect/platform/Worker.ts.html)
- [Effect KeyValueStore](https://effect.website/docs/platform/key-value-store/)
- [Effect Cache Documentation](https://effect.website/docs/caching/cache/)
- [Effect Caching Effects](https://effect.website/docs/caching/caching-effects/)
- [@effect/experimental Modules](https://effect-ts.github.io/effect/docs/experimental)

**MEDIUM Confidence (Verified patterns):**
- [Effect-TS/effect GitHub](https://github.com/Effect-TS/effect/blob/main/packages/platform/README.md)
- [Stream Processing DeepWiki](https://deepwiki.com/Effect-TS/effect/2.2-schema-system)

**Current Codebase Files Analyzed:**
- `packages/server/src/context.ts` - Cookie wrapper (lines 77-83)
- `packages/server/src/api.ts` - API definitions
- `apps/api/src/routes/jobs.ts` - SSE streaming
- `packages/server/src/utils/transfer.ts` - xlsx/zip parsing
- `packages/server/src/infra/storage.ts` - S3 streaming patterns
- `packages/server/src/middleware.ts` - Auth/context middleware
