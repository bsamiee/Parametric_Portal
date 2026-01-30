# @effect/platform HttpServer API Research

**Researched:** 2026-01-29
**Domain:** HTTP server setup, routing, request handling, multi-tenant middleware
**Confidence:** HIGH

## Summary

@effect/platform provides a composable HTTP server stack via HttpServer, HttpRouter, HttpApp, and HttpServerRequest modules. Key patterns for multi-tenant systems:

1. **HttpServer.serve** returns Layer for server lifecycle management
2. **HttpRouter** provides method-based routing with pipe composition
3. **HttpServerRequest.schemaBodyJson/schemaHeaders** for typed request parsing
4. **HttpApp.Default** as the unified handler type throughout
5. **HttpLayerRouter** for Layer-based route composition with middleware

**Integration with codebase:** Use HttpApiBuilder for contract-first APIs (existing api.ts pattern), HttpRouter for lower-level routing, HttpServerRequest schema functions within handlers.

## Standard Stack

### Core Imports by Module

**@effect/platform/HttpServer** (6 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpServer.serve` | Layer-based server lifecycle | `HttpServer.serve(app).pipe(Layer.provide(NodeHttpServer.layer(...)))` |
| `HttpServer.serveEffect` | Effect-based server for testing | `HttpServer.serveEffect(app).pipe(Effect.scoped)` |
| `HttpServer.withLogAddress` | Log server address on startup | `HttpServer.serve(app).pipe(HttpServer.withLogAddress)` |
| `HttpServer.layerContext` | Core platform services layer | Provides FileSystem, Path, HttpPlatform, Etag.Generator |
| `HttpServer.layerTestClient` | Test client auto-prefixed | Integration testing with `HttpClient.HttpClient` |
| `HttpServer.addressWith` | Access server address | `HttpServer.addressWith((addr) => Effect.log(addr.port))` |

**@effect/platform/HttpServerRequest** (8 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpServerRequest.HttpServerRequest` | Request context Tag | `yield* HttpServerRequest.HttpServerRequest` in handlers |
| `HttpServerRequest.schemaBodyJson` | Typed JSON body parsing | `yield* HttpServerRequest.schemaBodyJson(PayloadSchema)` |
| `HttpServerRequest.schemaHeaders` | Typed header parsing | `yield* HttpServerRequest.schemaHeaders(HeadersSchema)` |
| `HttpServerRequest.schemaBodyUrlParams` | Form data parsing | `yield* HttpServerRequest.schemaBodyUrlParams(FormSchema)` |
| `HttpServerRequest.schemaBodyMultipart` | File upload parsing | `yield* HttpServerRequest.schemaBodyMultipart(UploadSchema)` |
| `HttpServerRequest.schemaCookies` | Typed cookie parsing | `yield* HttpServerRequest.schemaCookies(CookieSchema)` |
| `HttpServerRequest.toURL` | Extract URL object | `Option.map(HttpServerRequest.toURL(req), (url) => url.pathname)` |
| `HttpServerRequest.withMaxBodySize` | Limit body size | `handler.pipe(HttpServerRequest.withMaxBodySize(Option.some('10mb')))` |

**@effect/platform/HttpRouter** (12 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpRouter.empty` | Create empty router | `HttpRouter.empty.pipe(HttpRouter.get('/health', handler))` |
| `HttpRouter.get/post/put/del` | Method-specific routes | `HttpRouter.get('/users/:id', userHandler)` |
| `HttpRouter.all` | Catch-all method handler | `HttpRouter.all('/proxy/*', proxyHandler)` |
| `HttpRouter.prefixAll` | Apply path prefix | `router.pipe(HttpRouter.prefixAll('/api/v1'))` |
| `HttpRouter.mount` | Mount sub-router | `HttpRouter.mount('/admin', adminRouter)` |
| `HttpRouter.concat` | Merge routers | `router1.pipe(HttpRouter.concat(router2))` |
| `HttpRouter.catchTag` | Typed error handling | `router.pipe(HttpRouter.catchTag('NotFound', errorHandler))` |
| `HttpRouter.RouteContext` | Route params context | `yield* HttpRouter.RouteContext` for path params |
| `HttpRouter.schemaParams` | Typed query params | `yield* HttpRouter.schemaParams(QuerySchema)` |
| `HttpRouter.schemaPathParams` | Typed path params | `yield* HttpRouter.schemaPathParams(PathSchema)` |
| `HttpRouter.use` | Apply middleware | `router.pipe(HttpRouter.use(authMiddleware))` |

**@effect/platform/HttpApp** (5 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpApp.Default` | Standard handler type | `Effect.Effect<HttpServerResponse, E, R \| HttpServerRequest>` |
| `HttpApp.toWebHandler` | Convert to Fetch API | `const handler = HttpApp.toWebHandler(app, runtime)` |
| `HttpApp.toHandled` | Convert with error handler | `HttpApp.toHandled(app, errorToResponse)` |
| `HttpApp.withPreResponseHandler` | Intercept responses | Logging, header injection |
| `HttpApp.appendPreResponseHandler` | Chain response handlers | Multiple middleware composition |

**@effect/platform/HttpLayerRouter** (7 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpLayerRouter.add` | Add route as Layer | `HttpLayerRouter.add('GET', '/health', handler)` |
| `HttpLayerRouter.addAll` | Batch route registration | `HttpLayerRouter.addAll([route1, route2], { prefix: '/api' })` |
| `HttpLayerRouter.route` | Create route definition | `HttpLayerRouter.route('POST', '/users', createUser)` |
| `HttpLayerRouter.middleware` | Typed middleware layer | Auth, logging, rate limiting |
| `HttpLayerRouter.layer` | Base router context | Foundation for composition |
| `HttpLayerRouter.serve` | Server from layers | `HttpLayerRouter.serve(AllRoutes)` |
| `HttpLayerRouter.cors` | CORS middleware | `HttpLayerRouter.cors({ allowedOrigins: ['*'] })` |

## Architecture Patterns

### Pattern 1: Server Setup with HttpServer.serve

```typescript
import { HttpServer, HttpServerResponse } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { createServer } from 'node:http';

const app = Effect.succeed(HttpServerResponse.text('OK'));
const ServerLive = HttpServer.serve(app).pipe(
  HttpServer.withLogAddress,
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
  Layer.provide(HttpServer.layerContext),
);
Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
```

### Pattern 2: HttpRouter Composition for Multi-Tenant APIs

```typescript
import { HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Schema as S } from 'effect';

const TenantHeader = S.Struct({ 'x-tenant-id': S.NonEmptyString });
const UserParams = S.Struct({ id: S.UUID });

const getUser = Effect.gen(function* () {
  const headers = yield* HttpServerRequest.schemaHeaders(TenantHeader);
  const pathParams = yield* HttpRouter.schemaPathParams(UserParams);
  return HttpServerResponse.json({ tenantId: headers['x-tenant-id'], userId: pathParams.id });
});

const UsersRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/users/:id', getUser),
  HttpRouter.get('/users', Effect.succeed(HttpServerResponse.json({ users: [] }))),
);
const ApiRouter = HttpRouter.empty.pipe(
  HttpRouter.mount('/v1', UsersRouter),
  HttpRouter.prefixAll('/api'),
);
```

### Pattern 3: Request Body Parsing with Schema Validation

```typescript
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Effect, Schema as S } from 'effect';

const CreateUserPayload = S.Struct({
  email: S.NonEmptyString.pipe(S.pattern(/@/)),
  name: S.NonEmptyString,
  role: S.optional(S.Literal('admin', 'member', 'viewer'), { default: () => 'viewer' as const }),
});

const createUser = Effect.gen(function* () {
  const payload = yield* HttpServerRequest.schemaBodyJson(CreateUserPayload);
  return HttpServerResponse.json({ id: crypto.randomUUID(), ...payload }, { status: 201 });
}).pipe(
  Effect.catchTag('ParseError', (e) =>
    Effect.succeed(HttpServerResponse.json({ error: 'Validation failed', details: e.message }, { status: 400 })),
  ),
);
```

### Pattern 4: Multipart File Upload Handling

```typescript
import { HttpServerRequest, HttpServerResponse, Multipart } from '@effect/platform';
import { Effect, Option, Schema as S } from 'effect';

const UploadSchema = S.Struct({ file: Multipart.SingleFileSchema, metadata: S.optional(S.String) });

const uploadFile = Effect.gen(function* () {
  const { file, metadata } = yield* HttpServerRequest.schemaBodyMultipart(UploadSchema);
  return HttpServerResponse.json({ filename: file.name, size: file.size, contentType: file.contentType });
}).pipe(
  HttpServerRequest.withMaxBodySize(Option.some('50mb')),
  Effect.catchTag('MultipartError', (e) =>
    Effect.succeed(HttpServerResponse.json({ error: 'Upload failed', details: e.reason }, { status: 400 })),
  ),
);
```

### Pattern 5: Error Handling with Tagged Errors

```typescript
import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { Data, Effect, Match } from 'effect';

class NotFound extends Data.TaggedError('NotFound')<{ readonly resource: string; readonly id: string }> {}
class Forbidden extends Data.TaggedError('Forbidden')<{ readonly reason: string }> {}
type DomainError = NotFound | Forbidden;

const domainErrorToResponse = Match.type<DomainError>().pipe(
  Match.tag('NotFound', (e) => HttpServerResponse.json({ error: `${e.resource}/${e.id} not found` }, { status: 404 })),
  Match.tag('Forbidden', (e) => HttpServerResponse.json({ error: e.reason }, { status: 403 })),
  Match.exhaustive,
);

const router = HttpRouter.empty.pipe(
  HttpRouter.get('/resource/:id', handler),
  HttpRouter.catchTags({
    NotFound: (e) => Effect.succeed(domainErrorToResponse(e)),
    Forbidden: (e) => Effect.succeed(domainErrorToResponse(e)),
  }),
);
```

### Pattern 6: HttpLayerRouter for Service-Based Routing

```typescript
import { HttpLayerRouter, HttpServerResponse } from '@effect/platform';
import { Effect, Layer } from 'effect';

class UserService extends Effect.Service<UserService>()('UserService', {
  effect: Effect.succeed({ findById: (id: string) => Effect.succeed({ id, name: 'Test User' }) }),
}) {}

const getUserRoute = HttpLayerRouter.route('GET', '/users/:id',
  Effect.gen(function* () {
    const { id } = yield* HttpLayerRouter.params;
    const userService = yield* UserService;
    const user = yield* userService.findById(id);
    return HttpServerResponse.json(user);
  }),
);

const RoutesLayer = HttpLayerRouter.addAll([getUserRoute], { prefix: '/api' });
const AppLayer = RoutesLayer.pipe(Layer.provideMerge(UserService.Default), Layer.provideMerge(HttpLayerRouter.layer));
```

### Pattern 7: Middleware Composition

```typescript
import { HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Clock, Effect, Option } from 'effect';

const timingMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    const response = yield* app;
    const elapsed = (yield* Clock.currentTimeMillis) - start;
    return HttpServerResponse.setHeader(response, 'x-response-time', `${elapsed}ms`);
  }),
);

const requestIdMiddleware = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const requestId = Option.getOrElse(Option.fromNullable(req.headers['x-request-id']), crypto.randomUUID);
    const response = yield* app;
    return HttpServerResponse.setHeader(response, 'x-request-id', requestId);
  }),
);

const router = HttpRouter.empty.pipe(
  HttpRouter.get('/health', Effect.succeed(HttpServerResponse.text('OK'))),
  HttpRouter.use(timingMiddleware),
  HttpRouter.use(requestIdMiddleware),
);
```

### Pattern 8: HttpApp.toWebHandler for Edge Deployment

```typescript
import { HttpApp, HttpRouter, HttpServerResponse } from '@effect/platform';
import { Effect, Layer, ManagedRuntime } from 'effect';

const router = HttpRouter.empty.pipe(
  HttpRouter.get('/api/health', Effect.succeed(HttpServerResponse.json({ status: 'ok' }))),
);

const runtime = ManagedRuntime.make(Layer.empty);
const handler = HttpApp.toWebHandler(router, runtime);
export default { fetch: handler };
```

### Pattern 9: Response Interception

```typescript
import { HttpApp, HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';

const securityHeaders = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } as const;

const withSecurityHeaders = HttpApp.withPreResponseHandler((req, response) =>
  Effect.succeed(HttpServerResponse.setHeaders(response, securityHeaders)),
);

const withResponseLogging = HttpApp.appendPreResponseHandler((req, response) =>
  Effect.gen(function* () {
    yield* Effect.log(`${req.method} ${req.url} -> ${response.status}`);
    return response;
  }),
);

const app = baseRouter.pipe(withSecurityHeaders, withResponseLogging);
```

### Pattern 10: Testing with layerTestClient

```typescript
import { HttpClient, HttpServer, HttpServerResponse, HttpRouter } from '@effect/platform';
import { Effect } from 'effect';

const TestRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/api/health', Effect.succeed(HttpServerResponse.json({ status: 'ok' }))),
);
const TestServerLayer = HttpServer.serve(TestRouter).pipe(HttpServer.layerTestClient);

const testHealthEndpoint = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.get('/api/health').pipe(Effect.flatMap(HttpClient.filterStatusOk), Effect.flatMap((r) => r.json));
  return response;
}).pipe(Effect.provide(TestServerLayer));
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON body parsing | Manual JSON.parse | `HttpServerRequest.schemaBodyJson` | Type-safe, error handling |
| Header extraction | `req.headers['x-foo']` | `HttpServerRequest.schemaHeaders` | Typed, Option-based |
| Query params | URLSearchParams parsing | `HttpRouter.schemaParams` | Schema validation |
| Path params | Manual regex extraction | `HttpRouter.schemaPathParams` | Type-safe extraction |
| File uploads | Manual multipart parsing | `HttpServerRequest.schemaBodyMultipart` | Stream handling, temp files |
| Cookie parsing | Manual string split | `HttpServerRequest.schemaCookies` | Type-safe, HttpOnly aware |
| Route composition | Array of handlers | `HttpRouter.concat` / `HttpRouter.mount` | Type-safe error unions |
| Server lifecycle | Manual http.createServer | `HttpServer.serve` | Layer-based, cleanup |
| Test client | Actual HTTP requests | `HttpServer.layerTestClient` | No network overhead |
| Web handler | Custom fetch adapter | `HttpApp.toWebHandler` | Runtime integration |
| CORS | Manual header injection | `HttpLayerRouter.cors` | Complete CORS handling |
| Body size limits | Manual Content-Length | `HttpServerRequest.withMaxBodySize` | Stream-aware limiting |

## Common Pitfalls

### Pitfall 1: Missing HttpServerRequest Context
**What:** Handler fails with "HttpServerRequest not in context"
**Fix:** Define handlers inline in route registration or ensure context flows through

### Pitfall 2: Schema ParseError Not Caught
**What:** Uncaught ParseError crashes request
**Fix:** Always `Effect.catchTag('ParseError', handler)` after schema functions

### Pitfall 3: Router Order Matters
**What:** Specific routes never match
**Fix:** Register specific routes first, catch-all routes last

### Pitfall 4: Middleware Applied Before Routes
**What:** Middleware doesn't affect routes
**Fix:** Apply middleware after routes: `router.pipe(HttpRouter.get(...), HttpRouter.use(middleware))`

### Pitfall 5: HttpServer.serve Returns Layer
**What:** Server doesn't start
**Fix:** Terminate with `Layer.launch(...).pipe(NodeRuntime.runMain)`

### Pitfall 6: schemaBodyMultipart Requires FileSystem
**What:** Runtime error about missing FileSystem
**Fix:** Provide `HttpServer.layerContext` or `NodeContext.layer`

## Codebase Integration

**HttpApiBuilder vs HttpRouter:** Use `HttpApiBuilder` (api.ts) for contract-first APIs with OpenAPI generation. Use `HttpRouter` for internal routing and low-level handlers.

```typescript
// api.ts — Contract-first with HttpApi
const ParametricApi = HttpApi.make('ParametricApi').add(_AuthGroup).add(_HealthGroup);

// middleware.ts — Low-level middleware via HttpMiddleware
const trace = HttpMiddleware.make((app) => Effect.gen(function* () { ... }));

// context.ts — Request context via FiberRef
const ctx = { tenantId, requestId, session: Option.none() };
yield* Context.Request.within(tenantId, app.pipe(Effect.provideService(Context.Request, ctx)));
```

**Multi-Tenant Context:** Tenant isolation via `Context.Request.tenantId` (FiberRef), populated from `x-app-id` header in `makeRequestContext` middleware.

**Error Handling:** Use `HttpError.*` (errors.ts) as `Schema.TaggedError` with `HttpApiSchema.annotations({ status })`.

## Sources

### Primary (HIGH confidence)
- [HttpServer.ts API](https://effect-ts.github.io/effect/platform/HttpServer.ts.html)
- [HttpServerRequest.ts API](https://effect-ts.github.io/effect/platform/HttpServerRequest.ts.html)
- [HttpRouter.ts API](https://effect-ts.github.io/effect/platform/HttpRouter.ts.html)
- [HttpApp.ts API](https://effect-ts.github.io/effect/platform/HttpApp.ts.html)
- [HttpLayerRouter.ts API](https://effect-ts.github.io/effect/platform/HttpLayerRouter.ts.html)

### Codebase (HIGH confidence)
- `/packages/server/src/api.ts` - HttpApi contract definition
- `/packages/server/src/middleware.ts` - HttpMiddleware patterns
- `/packages/server/src/context.ts` - Request context, tenant isolation
- `/packages/server/src/errors.ts` - Schema.TaggedError HTTP errors

## Metadata

**Confidence:** HIGH - All functions documented from official API docs, patterns aligned with codebase
**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable APIs)
