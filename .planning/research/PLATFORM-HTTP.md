# @effect/platform HTTP Research

**Version:** 0.94.2 (from pnpm catalog)
**Researched:** 2026-01-28
**Confidence:** HIGH (official docs + existing codebase patterns)

## Executive Summary

@effect/platform provides a comprehensive, type-safe HTTP infrastructure built on Effect's compositional model. The library offers two paradigms: (1) low-level `HttpServer`/`HttpRouter` for custom servers, and (2) high-level `HttpApi`/`HttpApiBuilder` for declarative API definitions with automatic OpenAPI generation. Both integrate seamlessly with Effect's Layer system for dependency injection.

The existing codebase (`api.ts`, `middleware.ts`, `main.ts`, `streaming.ts`) already uses `HttpApi`/`HttpApiBuilder` extensively. New features (cluster health, SSE) should extend this pattern rather than introduce raw `HttpRouter`.

**Primary recommendation:** Use `HttpApiBuilder.group()` with `handleRaw()` for streaming endpoints; use `StreamingService.sse()` for SSE delivery.

## Core Imports

| Import Path | Provides | When to Use |
|-------------|----------|-------------|
| `@effect/platform/HttpServer` | `serve`, `withLogAddress`, `layerContext` | Server lifecycle, Layer composition |
| `@effect/platform/HttpRouter` | `Tag`, `route`, `get/post/...`, `concat`, `prefixAll` | Low-level routing (not for HttpApi) |
| `@effect/platform/HttpMultiplex` | `empty`, `headerExact`, `add` | Protocol multiplexing (HTTP+WS same port) |
| `@effect/platform/HttpLayerRouter` | `route`, `addAll`, `middleware` | Layer-based routing (not for HttpApi) |
| `@effect/platform/HttpServerResponse` | `empty`, `text`, `json`, `stream`, `file` | Building responses |
| `@effect/platform/HttpBody` | `empty`, `text`, `json`, `stream`, `uint8Array` | Request/response bodies |
| `@effect/platform/Headers` | `fromInput`, `get`, `set`, `merge`, `redact` | Header manipulation |
| `@effect/platform/HttpTraceContext` | `fromHeaders`, `toHeaders` | W3C trace propagation |
| `@effect/platform/HttpApi` | `make`, `add`, `prefix`, `annotate` | API definition container |
| `@effect/platform/HttpApiBuilder` | `api`, `group`, `serve`, `middlewareCors` | API implementation |
| `@effect/platform/HttpApiEndpoint` | `get`, `post`, `del`, `setPath`, `addSuccess` | Endpoint definitions |
| `@effect/platform/HttpApiGroup` | `make`, `add`, `prefix` | Endpoint grouping |
| `@effect/platform/HttpApiMiddleware` | `Tag`, `security` | Type-safe middleware |
| `@effect/platform/Etag` | `Generator`, `layer`, `fromFileInfo` | HTTP caching |
| `@effect/platform/Path` | `join`, `resolve`, `dirname`, `basename` | File path utilities |
| `@effect/platform/Url` | `fromString`, `setPath`, `modifyUrlParams` | URL manipulation |
| `@effect/platform/UrlParams` | `fromInput`, `get`, `append`, `toString` | Query string handling |

## HttpServer Patterns

```typescript
// Basic server with Layer (from official examples)
const ServerLive = NodeHttpServer.layer(() => createServer(), { port: 3000 })
const HttpLive = HttpServer.serve(HttpServerResponse.text("Hello")).pipe(Layer.provide(ServerLive))
NodeRuntime.runMain(Layer.launch(HttpLive))

// Server with middleware pipeline (existing pattern in main.ts)
HttpApiBuilder.serve((app) => app.pipe(
  Middleware.xForwardedHeaders,
  Middleware.makeRequestContext(lookup),
  Middleware.trace,
  Middleware.security(),
  HttpMiddleware.logger,
))
```

**Address utilities:**
- `HttpServer.withLogAddress` - logs server address on startup (used in `main.ts`)
- `HttpServer.addressFormattedWith` - access formatted address in effects

## HttpRouter (Low-Level)

**NOTE:** Existing codebase uses `HttpApi`/`HttpApiBuilder`, NOT raw `HttpRouter`. Use this only for non-API routes (health checks, metrics export).

```typescript
// Tag-based router for service pattern
const AppRouter = HttpRouter.Tag<AppRouter>()('AppRouter')
const routes = AppRouter.use((router) =>
  router.get('/health', Effect.succeed(HttpServerResponse.json({ status: 'ok' })))
)

// Composition
const combined = HttpRouter.concat(router1, router2)
const prefixed = HttpRouter.prefixAll(router, '/api/v2')

// Mount app under path
HttpRouter.mountApp('/ws', websocketApp)
```

**Route context access:**
```typescript
HttpRouter.params // Effect<Record<string, string | undefined>>
HttpRouter.schemaPathParams(S.Struct({ id: S.UUID }))
HttpRouter.schemaJson(schema) // validates body + headers + params
```

## HttpMultiplex

Handles multiple protocols on same port via predicate routing.

```typescript
const multiplex = HttpMultiplex.empty.pipe(
  HttpMultiplex.headerExact('upgrade', 'websocket', wsApp),
  HttpMultiplex.hostStartsWith('api.', apiApp),
  HttpMultiplex.add((req) => Effect.succeed(req.url.startsWith('/health')), healthApp),
)
```

**Predicates:** `headerExact`, `headerStartsWith`, `headerEndsWith`, `headerRegex`, `hostExact`, `hostStartsWith`, `hostEndsWith`, `hostRegex`, `add` (custom)

## HttpLayerRouter

Layer-based routing for modular microservices. Routes are layers, not direct effects.

```typescript
const userRoutes = HttpLayerRouter.route('GET', '/users/:id', handler)
const adminRoutes = HttpLayerRouter.route('DELETE', '/users/:id', deleteHandler)
const app = HttpLayerRouter.addAll([userRoutes, adminRoutes]).pipe(
  Layer.provide(authMiddleware),
  Layer.provide(dbLayer),
)
```

**Key difference from HttpRouter:** Composition happens at Layer level, enabling automatic dependency propagation.

## Response Building

```typescript
// Basic responses
HttpServerResponse.empty()
HttpServerResponse.text('hello', { status: 200 })
HttpServerResponse.json({ ok: true })
HttpServerResponse.html`<h1>Title</h1>`

// Streaming (critical for SSE)
HttpServerResponse.stream(uint8ArrayStream, {
  contentType: 'text/event-stream',
  headers: Headers.fromInput({ 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' })
})

// File serving with Etag
HttpServerResponse.file(path, { etag: true })

// Modification (immutable)
response.pipe(
  HttpServerResponse.setStatus(201),
  HttpServerResponse.setHeader('X-Custom', 'value'),
  HttpServerResponse.setCookie('session', token, { httpOnly: true, secure: true }),
)

// From Web Response
HttpServerResponse.fromWeb(webResponse)
```

## Tracing Integration

```typescript
// Extract parent span from incoming request
const trace = HttpMiddleware.make((app) => Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  const parent = HttpTraceContext.fromHeaders(req.headers)
  const response = yield* Option.isSome(parent)
    ? Effect.withParentSpan(app, parent.value)
    : Effect.withSpan(app, 'http.request')
  const span = yield* Effect.currentSpan
  return HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(span))
}))
```

**Formats supported:** W3C Trace Context, B3, X-B3

## HttpApi Pattern (Existing Codebase)

The codebase uses declarative API definitions. **Follow this pattern.**

```typescript
// Definition (api.ts)
const HealthGroup = HttpApiGroup.make('health').prefix('/health')
  .add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
  .add(HttpApiEndpoint.get('readiness', '/readiness').addSuccess(ReadinessSchema).addError(HttpError.ServiceUnavailable))

const ParametricApi = HttpApi.make('ParametricApi')
  .add(HealthGroup)
  .prefix('/api')

// Implementation (routes/health.ts)
const HealthLive = HttpApiBuilder.group(ParametricApi, 'health', (handlers) =>
  handlers
    .handle('liveness', () => Effect.succeed({ status: 'ok' as const }))
    .handle('readiness', () => readinessCheck)
)
```

**Raw handlers for streaming (existing pattern in jobs.ts):**
```typescript
HttpApiBuilder.group(ParametricApi, 'jobs', (handlers) =>
  handlers.handleRaw('subscribe', () =>
    StreamingService.sse({ source: events, serialize: toSSE, name: 'jobs.status' })
  )
)
```

## SSE Delivery (Existing Pattern)

The codebase has `StreamingService.sse()` - USE THIS, do not hand-roll.

```typescript
StreamingService.sse({
  source: jobs.onStatusChange(),           // Stream<A, E, never>
  serialize: (e) => ({                     // A -> { data, event?, id? }
    data: JSON.stringify(e),
    event: 'status',
    id: e.jobId
  }),
  name: 'jobs.status',                     // for metrics
  filter: (e) => e.appId === appId,        // optional tenant filter
  onError: (e) => ({ data: JSON.stringify({ error: String(e) }), event: 'error' }),
  heartbeat: 30,                           // seconds, default 30
})
```

**Under the hood:** Uses `HttpServerResponse.stream()` with `text/event-stream`, `@effect/experimental/Sse.encoder`, heartbeat stream, sliding buffer, metrics.

## Health Check Patterns

```typescript
// Liveness: instant, no dependencies
const liveness = Effect.succeed({ status: 'ok' as const })

// Readiness: check dependencies with timeout
const readiness = Effect.all({
  database: db.ping.pipe(Effect.timed, Effect.map(([d, _]) => ({ healthy: true, latencyMs: d.toMillis() }))),
  cache: cache.ping.pipe(Effect.timed, Effect.map(([d, _]) => ({ connected: true, latencyMs: d.toMillis() }))),
}, { concurrency: 'unbounded' }).pipe(
  Effect.timeout(Duration.seconds(5)),
  Effect.mapError(() => HttpError.ServiceUnavailable.of('Dependency check failed')),
)
```

## Existing Integration Points

| File | Uses | Integration Pattern |
|------|------|---------------------|
| `api.ts` | HttpApi, HttpApiGroup, HttpApiEndpoint | Declarative API definition |
| `middleware.ts` | HttpMiddleware, HttpApiMiddleware, HttpTraceContext | Trace propagation, auth |
| `main.ts` | HttpApiBuilder.serve, HttpApiSwagger | Server composition |
| `streaming.ts` | HttpServerResponse.stream, Headers | SSE, emit, ingest |
| `routes/*.ts` | HttpApiBuilder.group, handle/handleRaw | Route implementations |

## Don't Hand-Roll

| Problem | Platform Provides | Notes |
|---------|-------------------|-------|
| SSE streaming | `StreamingService.sse()` | Handles heartbeat, encoding, metrics |
| NDJSON streaming | `StreamingService.emit({ format: 'ndjson' })` | Buffering, backpressure |
| Trace propagation | `HttpTraceContext.fromHeaders/toHeaders` | W3C, B3 support |
| CORS | `HttpApiBuilder.middlewareCors()` | Full config options |
| OpenAPI | `HttpApiSwagger.layer()` | Auto-generates from API |
| Etag generation | `Etag.Generator`, `Etag.layer` | File-based caching |
| Header redaction | `Headers.redact()` | Log-safe headers |
| URL params | `UrlParams.fromInput/schemaStruct` | Type-safe parsing |

## Code Patterns

**Adding health endpoints to existing API:**
```typescript
// In api.ts - add to existing ParametricApi
const _HealthGroup = HttpApiGroup.make('health').prefix('/health')
  .add(HttpApiEndpoint.get('liveness', '/liveness').addSuccess(S.Struct({ status: S.Literal('ok') })))
  .add(HttpApiEndpoint.get('readiness', '/readiness')
    .addSuccess(ReadinessResponseSchema)
    .addError(HttpError.ServiceUnavailable))
  .annotate(OpenApi.Exclude, true)  // Don't include in OpenAPI docs
```

**SSE endpoint with tenant filtering:**
```typescript
const handleSubscribe = Effect.fn('cluster.subscribe')(() =>
  Effect.gen(function* () {
    const ctx = yield* Context.Request.current
    return yield* StreamingService.sse({
      source: clusterEvents,
      serialize: (e) => ({ data: JSON.stringify(e), event: e.type, id: e.id }),
      name: 'cluster.events',
      filter: (e) => e.nodeId === process.env.NODE_ID,
    })
  })
)
```

**Cluster-aware health with node identification:**
```typescript
const readiness = Effect.gen(function* () {
  const nodeId = process.env.NODE_ID ?? 'standalone'
  const checks = yield* Effect.all({
    database: dbPing,
    cache: cachePing,
    cluster: clusterStatus,
  }, { concurrency: 'unbounded' })
  return { status: 'ok' as const, nodeId, checks }
})
```

## Common Pitfalls

**1. Using HttpRouter with HttpApi**
- HttpApi uses `HttpApiBuilder.group()`, not HttpRouter
- Mixing them breaks type safety and OpenAPI generation

**2. Forgetting handleRaw for streams**
- `handle()` returns JSON, `handleRaw()` returns HttpServerResponse
- SSE requires `handleRaw()` to set custom content-type

**3. Not providing ServerLayer**
- `HttpApiBuilder.serve()` requires `NodeHttpServer.layer()`
- Error: "Cannot find service: HttpServer"

**4. Missing heartbeat in SSE**
- Clients disconnect after proxy timeout (typically 60s)
- `StreamingService.sse()` includes heartbeat by default

**5. Blocking readiness on slow checks**
- Use `Effect.timeout()` to prevent K8s probe failures
- Return degraded status instead of hanging

## Sources

### Primary (HIGH confidence)
- [HttpServer.ts](https://effect-ts.github.io/effect/platform/HttpServer.ts.html) - Server APIs
- [HttpRouter.ts](https://effect-ts.github.io/effect/platform/HttpRouter.ts.html) - Routing APIs
- [HttpMultiplex.ts](https://effect-ts.github.io/effect/platform/HttpMultiplex.ts.html) - Protocol multiplexing
- [HttpServerResponse.ts](https://effect-ts.github.io/effect/platform/HttpServerResponse.ts.html) - Response building
- [HttpTraceContext.ts](https://effect-ts.github.io/effect/platform/HttpTraceContext.ts.html) - Tracing
- [HttpApiBuilder.ts](https://effect-ts.github.io/effect/platform/HttpApiBuilder.ts.html) - API implementation
- Existing codebase: `api.ts`, `middleware.ts`, `streaming.ts`, `main.ts`

### Secondary (MEDIUM confidence)
- [Platform README](https://github.com/Effect-TS/effect/blob/main/packages/platform/README.md)
- [Platform examples](https://github.com/Effect-TS/effect/blob/main/packages/platform-node/examples/http-server.ts)

## Metadata

**Confidence breakdown:**
- HttpApi/HttpApiBuilder: HIGH - verified against existing codebase + official docs
- HttpRouter/HttpLayerRouter: MEDIUM - official docs, not used in codebase
- HttpMultiplex: MEDIUM - official docs, may need validation
- SSE patterns: HIGH - existing `StreamingService.sse()` implementation

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (Effect releases frequently, verify version compatibility)
