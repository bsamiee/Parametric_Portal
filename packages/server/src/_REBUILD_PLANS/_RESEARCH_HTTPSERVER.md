# @effect/platform HttpServer API Research

**Researched:** 2026-01-29
**Domain:** HTTP server, routing, request handling, multi-tenant middleware
**Confidence:** HIGH

## Summary

@effect/platform provides composable HTTP server primitives. Two composition strategies:

1. **HttpApiBuilder** — Contract-first APIs with OpenAPI generation, typed middleware (codebase primary)
2. **HttpRouter** — Low-level routing with manual error handling (internal/testing)

**Key Integration:** `HttpApiBuilder.group` + `HttpApiMiddleware.Tag` for typed handlers; `HttpServer.serve` + `HttpServer.drain` for lifecycle; `Schema.TaggedError` with `HttpApiSchema.annotations({ status })` for automatic error mapping.

## Standard Stack

### Core Imports by Module

**@effect/platform/HttpServer** (7 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpServer.serve` | Layer-based lifecycle | `HttpServer.serve(app).pipe(Layer.provide(NodeHttpServer.layer(...)))` |
| `HttpServer.serveEffect` | Effect-based (testing) | `HttpServer.serveEffect(app).pipe(Effect.scoped)` |
| `HttpServer.withLogAddress` | Log address on startup | `HttpServer.serve(app).pipe(HttpServer.withLogAddress)` |
| `HttpServer.drain` | Graceful shutdown | `Effect.onInterrupt(() => HttpServer.drain)` |
| `HttpServer.layerContext` | Platform services | Provides FileSystem, Path, Etag.Generator |
| `HttpServer.layerTestClient` | Test client | Integration testing without network |
| `HttpServer.addressWith` | Access address | `HttpServer.addressWith((addr) => Effect.log(addr.port))` |

**@effect/platform/HttpServerRequest** (9 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpServerRequest.HttpServerRequest` | Request context | `yield* HttpServerRequest.HttpServerRequest` |
| `HttpServerRequest.schemaBodyJson` | Typed JSON body | `yield* HttpServerRequest.schemaBodyJson(Schema)` |
| `HttpServerRequest.schemaHeaders` | Typed headers | `yield* HttpServerRequest.schemaHeaders(Schema)` |
| `HttpServerRequest.schemaBodyUrlParams` | Form data | `yield* HttpServerRequest.schemaBodyUrlParams(Schema)` |
| `HttpServerRequest.schemaBodyMultipart` | File uploads | `yield* HttpServerRequest.schemaBodyMultipart(Schema)` |
| `HttpServerRequest.schemaCookies` | Typed cookies | `yield* HttpServerRequest.schemaCookies(Schema)` |
| `HttpServerRequest.upgradeChannel` | WebSocket upgrade | `yield* HttpServerRequest.upgradeChannel` returns Channel |
| `HttpServerRequest.persistedMultipart` | Large file persist | Files written to disk before handler |
| `HttpServerRequest.withMaxBodySize` | Body limit | `handler.pipe(HttpServerRequest.withMaxBodySize(10 * 1024 * 1024))` |

**@effect/platform/HttpRouter** (10 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpRouter.empty` | Create router | `HttpRouter.empty.pipe(HttpRouter.get('/health', handler))` |
| `HttpRouter.get/post/put/del` | Method routes | `HttpRouter.get('/users/:id', handler)` |
| `HttpRouter.prefixAll` | Path prefix | `router.pipe(HttpRouter.prefixAll('/api/v1'))` |
| `HttpRouter.mount` | Sub-router | `HttpRouter.mount('/admin', adminRouter)` |
| `HttpRouter.concat` | Merge routers | `router1.pipe(HttpRouter.concat(router2))` |
| `HttpRouter.catchTags` | Multi-error catch | `router.pipe(HttpRouter.catchTags({ NotFound: h1, Forbidden: h2 }))` |
| `HttpRouter.catchAllCause` | Catch all errors | `router.pipe(HttpRouter.catchAllCause((cause) => ...))` |
| `HttpRouter.RouteContext` | Path params | `yield* HttpRouter.RouteContext` |
| `HttpRouter.schemaPathParams` | Typed path params | `yield* HttpRouter.schemaPathParams(Schema)` |
| `HttpRouter.schemaParams` | Typed query params | `yield* HttpRouter.schemaParams(Schema)` |

**@effect/platform/HttpMiddleware** (5 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpMiddleware.make` | Custom middleware | `HttpMiddleware.make((app) => Effect.gen(...))` |
| `HttpMiddleware.xForwardedHeaders` | Proxy headers | Parse X-Forwarded-For/Host/Proto |
| `HttpMiddleware.logger` | Request logging | Method, URL, status, duration |
| `HttpMiddleware.cors` | CORS (HttpRouter) | `HttpMiddleware.cors({ allowOrigins: [...] })` |
| `HttpMiddleware.withTracerDisabledForUrls` | Skip tracing | Health probe noise reduction |

**@effect/platform/HttpApiBuilder** (6 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpApiBuilder.api` | Create API Layer | `HttpApiBuilder.api(ParametricApi).pipe(Layer.provide(...))` |
| `HttpApiBuilder.group` | Implement handlers | `HttpApiBuilder.group(Api, 'users', (h) => h.handle(...))` |
| `HttpApiBuilder.serve` | Serve with middleware | `HttpApiBuilder.serve((app) => app.pipe(middleware))` |
| `HttpApiBuilder.middlewareCors` | CORS (HttpApi) | `HttpApiBuilder.middlewareCors({ allowedOrigins: [...] })` |
| `HttpApiBuilder.toWebHandler` | Edge deployment | `HttpApiBuilder.toWebHandler(Api, runtime)` |
| `HttpApiBuilder.Router` | Internal router access | Route composition |

**@effect/platform/HttpApiMiddleware** (3 key imports):
| Import | Purpose | Pattern |
|--------|---------|---------|
| `HttpApiMiddleware.Tag` | Typed middleware | Security + provides + failure |
| `HttpApiMiddleware.SecurityToService` | Security → Service | Auto-provision from security |
| `HttpApiMiddleware.layer` | Middleware Layer | Alternative to `Layer.effect` |

## Architecture Patterns

### Pattern 1: Server Lifecycle with Graceful Shutdown

```typescript
import { HttpApiBuilder, HttpServer } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { createServer } from 'node:http';

const ServerLive = HttpApiBuilder.serve((app) => app.pipe(
  Middleware.trace,
  Middleware.security(),
  HttpMiddleware.logger,
)).pipe(
  HttpServer.withLogAddress,
  Layer.provide(HttpApiBuilder.api(ParametricApi)),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(
  Layer.launch(ServerLive).pipe(
    Effect.scoped,
    Effect.onInterrupt(() => Effect.all([
      HttpServer.drain,      // Stop accepting, wait for in-flight
      ClusterService.leave,
      CacheService.flush,
    ], { concurrency: 'unbounded' })),
  ),
);
```

### Pattern 2: HttpApiBuilder.group Handler Implementation

```typescript
import { HttpApiBuilder, HttpServerResponse } from '@effect/platform';
import { Effect, Option } from 'effect';

const UsersRouteLive = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
  Effect.gen(function* () {
    const db = yield* DatabaseService;
    const audit = yield* AuditService;
    return handlers
      .handle('getUser', ({ path }) => db.users.findById(path.id).pipe(
        Effect.flatMap(Option.match({
          onNone: () => Effect.fail(HttpError.NotFound.of('User', path.id)),
          onSome: Effect.succeed,
        })),
        Effect.tap((user) => audit.log('user_view', { subjectId: user.id })),
      ))
      .handleRaw('export', ({ urlParams }) => Effect.gen(function* () {
        const data = yield* db.users.export(urlParams);
        return HttpServerResponse.stream(data, { contentType: 'application/ndjson' });
      }));
  }),
);
```

### Pattern 3: HttpApiMiddleware.Tag with Security

```typescript
import { HttpApiMiddleware, HttpApiSecurity } from '@effect/platform';
import { Effect, Layer, Metric, Option, Redacted } from 'effect';

class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('server/SessionAuth', {
  failure: HttpError.Auth,
  security: { bearer: HttpApiSecurity.bearer },
}) {}

const SessionAuthLive = (lookup: (hash: Hex64) => Effect.Effect<Option.Option<SessionData>>) =>
  Layer.effect(SessionAuth, Effect.gen(function* () {
    const metrics = yield* MetricsService;
    return SessionAuth.of({
      bearer: (token: Redacted.Redacted<string>) => Crypto.hash(Redacted.value(token)).pipe(
        Effect.tap(() => Metric.increment(metrics.auth.lookups)),
        Effect.flatMap(lookup),
        Effect.flatMap(Option.match({
          onNone: () => Metric.increment(metrics.auth.misses).pipe(
            Effect.andThen(Effect.fail(HttpError.Auth.of('Invalid session'))),
          ),
          onSome: (s) => Context.Request.update({ session: Option.some(s) }).pipe(
            Effect.tap(() => Metric.increment(metrics.auth.hits)),
          ),
        })),
      ),
    });
  }));
```

### Pattern 4: Request Context Middleware with Headers

```typescript
import { Headers, HttpMiddleware, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Option } from 'effect';
import { constant } from 'effect/Function';

const makeRequestContext = (findByNamespace: (ns: string) => Effect.Effect<Option.Option<App>>) =>
  HttpMiddleware.make((app) => Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
    const namespaceOpt = Headers.get(req.headers, 'x-app-id');
    const found = yield* Option.match(namespaceOpt, {
      onNone: () => Effect.succeed(Option.none<App>()),
      onSome: (ns) => findByNamespace(ns).pipe(Effect.orElseSucceed(Option.none)),
    });
    const tenantId = Option.match(namespaceOpt, {
      onNone: constant(Context.Request.Id.default),
      onSome: () => Option.match(found, {
        onNone: constant(Context.Request.Id.unspecified),
        onSome: (item) => item.id,
      }),
    });
    return yield* Context.Request.within(tenantId, app.pipe(
      Effect.flatMap((response) => Effect.succeed(
        HttpServerResponse.setHeader(response, 'x-request-id', requestId),
      )),
    ));
  }));
```

### Pattern 5: Timing Middleware with Clock

```typescript
import { HttpMiddleware, HttpServerResponse } from '@effect/platform';
import { Clock, Effect } from 'effect';

const serverTiming = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const startMs = yield* Clock.currentTimeMillis;
    const response = yield* app;
    const endMs = yield* Clock.currentTimeMillis;
    return HttpServerResponse.setHeader(response, 'server-timing', `total;dur=${endMs - startMs}`);
  }),
);
```

### Pattern 6: Schema.TaggedError with HttpApiSchema (Auto-Mapping)

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

class NotFound extends S.TaggedError<NotFound>()('NotFound',
  { cause: S.optional(S.Unknown), id: S.optional(S.String), resource: S.String },
  HttpApiSchema.annotations({ description: 'Resource not found', status: 404 }),
) {
  static readonly of = (resource: string, id?: string, cause?: unknown) =>
    new NotFound({ cause, id, resource });
  override get message() { return this.id ? `NotFound: ${this.resource}/${this.id}` : `NotFound: ${this.resource}`; }
}

// Usage: automatic error-to-response mapping via HttpApiBuilder
// NO manual HttpServerResponse.json construction needed
```

### Pattern 7: HttpRouter with catchTags (Low-Level)

```typescript
import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

const router = HttpRouter.empty.pipe(
  HttpRouter.get('/resource/:id', handler),
  HttpRouter.catchTags({
    NotFound: (e) => Effect.succeed(HttpServerResponse.json({ error: e.message }, { status: 404 })),
    Forbidden: (e) => Effect.succeed(HttpServerResponse.json({ error: e.reason }, { status: 403 })),
    Validation: (e) => Effect.succeed(HttpServerResponse.json({ error: e.details }, { status: 400 })),
  }),
  HttpRouter.catchAllCause((cause) => Effect.succeed(
    HttpServerResponse.json({ error: 'Internal error' }, { status: 500 }),
  )),
);
```

### Pattern 8: WebSocket Upgrade

```typescript
import { HttpServerRequest, HttpServerResponse, HttpRouter } from '@effect/platform';
import { Effect, Stream } from 'effect';

const wsHandler = Effect.gen(function* () {
  const channel = yield* HttpServerRequest.upgradeChannel;
  yield* Stream.fromChannel(channel).pipe(
    Stream.decodeText(),
    Stream.mapEffect(handleMessage),
    Stream.encodeText(),
    Stream.run(Stream.toChannel(channel)),
  );
  return HttpServerResponse.empty();
});

const router = HttpRouter.empty.pipe(
  HttpRouter.get('/ws', wsHandler),
);
```

### Pattern 9: Edge Deployment (toWebHandler)

```typescript
import { HttpApiBuilder, ManagedRuntime } from '@effect/platform';
import { Layer } from 'effect';

const runtime = ManagedRuntime.make(Layer.mergeAll(
  ApiLive,
  DatabaseLive,
  HttpServer.layerContext,
));

const { dispose, handler } = HttpApiBuilder.toWebHandler(ParametricApi, runtime);

export default { fetch: handler };
```

### Pattern 10: Test Client Layer

```typescript
import { HttpClient, HttpServer, HttpServerResponse, HttpRouter } from '@effect/platform';
import { Effect } from 'effect';

const TestRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/api/health', Effect.succeed(HttpServerResponse.json({ status: 'ok' }))),
);
const TestServerLayer = HttpServer.serve(TestRouter).pipe(HttpServer.layerTestClient);

const testHealthEndpoint = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get('/api/health').pipe(
    Effect.flatMap(HttpClient.filterStatusOk),
    Effect.flatMap((r) => r.json),
  );
  return response;
}).pipe(Effect.provide(TestServerLayer));
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| JSON body parsing | `JSON.parse(await req.text())` | `HttpServerRequest.schemaBodyJson(Schema)` |
| Header extraction | `req.headers['x-foo']` | `Headers.get(req.headers, 'x-foo')` |
| Query params | `URLSearchParams` parsing | `HttpRouter.schemaParams(Schema)` |
| Path params | Manual regex extraction | `HttpRouter.schemaPathParams(Schema)` |
| File uploads | Manual multipart parsing | `HttpServerRequest.schemaBodyMultipart(Schema)` |
| Large file uploads | In-memory streaming | `HttpServerRequest.persistedMultipart({ directory })` |
| Cookie parsing | Manual string split | `HttpServerRequest.schemaCookies(Schema)` |
| Error mapping | `Match.type` + `HttpServerResponse.json` | `Schema.TaggedError` + `HttpApiSchema.annotations({ status })` |
| Route composition | Array of handlers | `HttpRouter.concat` / `HttpRouter.mount` |
| Multi-error catch | Chained `catchTag` | `HttpRouter.catchTags({ ... })` |
| Server lifecycle | Manual `http.createServer` | `HttpServer.serve` + `HttpServer.drain` |
| Test client | Actual HTTP requests | `HttpServer.layerTestClient` |
| Edge handler | Custom fetch adapter | `HttpApiBuilder.toWebHandler` |
| CORS | Manual header injection | `HttpApiBuilder.middlewareCors` / `HttpMiddleware.cors` |
| Body size limits | Manual Content-Length | `HttpServerRequest.withMaxBodySize(bytes)` |
| Request timing | `Date.now()` diff | `Clock.currentTimeMillis` in middleware |
| Proxy headers | Manual parsing | `HttpMiddleware.xForwardedHeaders` |

## Common Pitfalls

### Pitfall 1: withMaxBodySize Argument Type
**Wrong:** `HttpServerRequest.withMaxBodySize(Option.some('10mb'))`
**Correct:** `HttpServerRequest.withMaxBodySize(10 * 1024 * 1024)` — takes number (bytes)

### Pitfall 2: HttpRouter.schemaParams vs schemaPathParams
**Query params:** `HttpRouter.schemaParams(Schema)` — `?page=1&limit=20`
**Path params:** `HttpRouter.schemaPathParams(Schema)` — `/users/:id`

### Pitfall 3: Missing HttpServer.drain on Shutdown
**Wrong:** `Effect.onInterrupt(() => Effect.log('Stopping'))`
**Correct:** `Effect.onInterrupt(() => HttpServer.drain)` — waits for in-flight requests

### Pitfall 4: Manual Error-to-Response with HttpApiBuilder
**Wrong:** Using `Match.type<Error>().pipe(...)` with manual `HttpServerResponse.json`
**Correct:** Use `Schema.TaggedError` with `HttpApiSchema.annotations({ status })` — automatic mapping

### Pitfall 5: Bracket Header Access
**Wrong:** `req.headers['x-request-id']`
**Correct:** `Headers.get(req.headers, 'x-request-id')` — returns `Option<string>`

### Pitfall 6: schemaBodyMultipart Requires FileSystem
**Runtime Error:** Missing FileSystem context
**Fix:** Provide `HttpServer.layerContext` or `NodeContext.layer`

## Codebase Integration

**api.ts** — HttpApi contract definition with `HttpApiGroup.make`, `HttpApiEndpoint.*`
**middleware.ts** — `HttpApiMiddleware.Tag` (SessionAuth), `HttpMiddleware.make` (custom), `HttpApiBuilder.middlewareCors`
**context.ts** — FiberRef-based request context, `Context.Request.within` for tenant scoping
**errors.ts** — `Schema.TaggedError` with `HttpApiSchema.annotations({ status })` for auto-mapping
**routes/*.ts** — `HttpApiBuilder.group(Api, 'name', handlers)` implementation

## Sources

### Primary (HIGH confidence)
- [@effect/platform/HttpServer.ts](https://effect-ts.github.io/effect/platform/HttpServer.ts.html)
- [@effect/platform/HttpServerRequest.ts](https://effect-ts.github.io/effect/platform/HttpServerRequest.ts.html)
- [@effect/platform/HttpRouter.ts](https://effect-ts.github.io/effect/platform/HttpRouter.ts.html)
- [@effect/platform/HttpMiddleware.ts](https://effect-ts.github.io/effect/platform/HttpMiddleware.ts.html)
- [@effect/platform/HttpApiBuilder.ts](https://effect-ts.github.io/effect/platform/HttpApiBuilder.ts.html)
- [@effect/platform/HttpApiMiddleware.ts](https://effect-ts.github.io/effect/platform/HttpApiMiddleware.ts.html)

### Codebase (HIGH confidence)
- `/packages/server/src/api.ts` — HttpApi contract
- `/packages/server/src/middleware.ts` — HttpApiMiddleware.Tag, HttpMiddleware.make
- `/packages/server/src/context.ts` — Request context, tenant isolation
- `/packages/server/src/errors.ts` — Schema.TaggedError HTTP errors
- `/apps/api/src/routes/*.ts` — HttpApiBuilder.group implementations

## Metadata

**Confidence:** HIGH — APIs verified against @effect/platform source, patterns aligned with codebase
**Research date:** 2026-01-29
**Refined:** 2026-01-29 (fixed API errors, removed handrolling, added missing capabilities)
**Valid until:** 2026-02-28 (30 days — stable APIs)

**Refinements applied:**
- Fixed `withMaxBodySize` argument type (number, not Option<string>)
- Fixed `Headers.get` vs bracket access pattern
- Added `HttpServer.drain` for graceful shutdown
- Added `HttpServerRequest.upgradeChannel` for WebSocket
- Added `HttpApiBuilder.group` / `.api` patterns (codebase primary)
- Added `HttpMiddleware.xForwardedHeaders`, `.logger`
- Added `Schema.TaggedError` + `HttpApiSchema.annotations` error pattern
- Removed redundant patterns (merged conceptually similar ones)
- Applied Effect patterns: `Clock.currentTimeMillis`, `Option.match`, `constant`, `catchTags`
