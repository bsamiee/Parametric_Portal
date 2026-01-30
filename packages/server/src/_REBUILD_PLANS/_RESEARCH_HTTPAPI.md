# @effect/platform HttpApi Research

**Researched:** 2026-01-29
**Domain:** Typed API contract definition, schema-driven middleware, client generation
**Confidence:** HIGH

## Summary

HttpApi provides a type-safe, schema-first approach to REST API construction. API contracts are defined once via `HttpApi.make()` → `HttpApiGroup` → `HttpApiEndpoint` chain, then implemented via `HttpApiBuilder.group()` handlers. Derived clients via `HttpApiClient.make()` maintain full type safety. Middleware uses `HttpApiMiddleware.Tag` for typed context provision with security scheme integration.

**Key Design Decisions:**
1. **Contract-first**: Schema defines success/error responses at endpoint level; handlers must return matching types
2. **Middleware via Tags**: `HttpApiMiddleware.Tag` provides typed context (`provides`), typed errors (`failure`), and security (`security`)
3. **Composition via Layers**: `HttpApiBuilder.api()` returns Layer; handler groups merge via `Layer.provide`
4. **Client derivation**: `HttpApiClient.make(Api)` auto-generates typed client from same contract

## Standard Stack

| Library | Version | Purpose |
|---------|---------|---------|
| `@effect/platform` | 0.94.2 | HttpApi*, HttpApiBuilder, HttpApiClient, OpenApi |
| `@effect/platform-node` | 0.104.1 | NodeHttpServer.layer for Node.js runtime |
| `effect` | 3.19.15 | Schema, Layer, Effect, Match, Duration, Config |

### Key Imports by Package

**@effect/platform** (15 key imports):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `HttpApi.make` | Root API definition | `HttpApi.make('name').add(group).prefix('/api')` |
| `HttpApiGroup.make` | Endpoint grouping | `HttpApiGroup.make('name', { topLevel?: boolean })` |
| `HttpApiEndpoint.get/post/...` | HTTP method endpoints | `.setPath(schema).addSuccess(schema).addError(schema)` |
| `HttpApiBuilder.api` | API Layer factory | Returns `Layer<HttpApi.Api>` for composition |
| `HttpApiBuilder.group` | Handler registration | `(api, 'groupName', (h) => h.handle(...))` |
| `HttpApiBuilder.serve` | Server middleware | `serve((app) => app.pipe(middleware))` |
| `HttpApiBuilder.toWebHandler` | Web Standard export | `{ handler, dispose }` for Cloudflare/Bun |
| `HttpApiMiddleware.Tag` | Typed middleware factory | `{ provides?, failure?, security?, optional? }` |
| `HttpApiSecurity.bearer/apiKey/basic` | Security schemes | Auto-populates OpenAPI security |
| `HttpApiSchema.annotations` | Status/encoding control | `{ status: 201, description: '...' }` |
| `HttpApiSchema.withEncoding` | Content-Type control | `{ kind: 'Json'|'Text'|'Uint8Array'|'UrlParams' }` |
| `HttpApiClient.make` | Typed client derivation | `yield* HttpApiClient.make(Api, { baseUrl })` |
| `HttpApiScalar.layer` | Documentation UI | Scalar docs at configurable path |
| `OpenApi.Title/Version/...` | OpenAPI annotations | Chain via `.annotate(OpenApi.*, value)` |
| `Multipart.SingleFileSchema` | File upload schema | For `setPayload` on POST endpoints |

**effect** (10 key imports for HttpApi patterns):
| Import | Purpose | Integration Pattern |
|--------|---------|---------------------|
| `Schema.TaggedError` | HTTP error classes | `S.TaggedError()('Tag', fields, HttpApiSchema.annotations())` |
| `Effect.filterOrFail` | Handler validation | Convert predicate to typed error |
| `Effect.catchTags` | Multi-error mapping | Single call handles tagged error dispatch |
| `Match.value` | Status/scheme dispatch | Exhaustive matching on response types |
| `Duration.seconds/minutes` | Timeout configuration | Type-safe duration for client timeouts |
| `Schedule.exponential` | Retry policies | `Effect.retry(Schedule.exponential(...).pipe(...))` |
| `Config.string/redacted` | Environment config | `Config.string('API_BASE_URL').pipe(Config.withDefault(...))` |
| `Layer.effect/succeed` | Service provision | `Layer.effect` for async, `Layer.succeed` for static |
| `Redacted.value` | Token extraction | Safely unwrap security credentials |
| `Option.match` | Optional param handling | Clean onNone/onSome for URL params |

## Architecture Patterns

### Pattern 1: API Contract Definition (Single Source of Truth)

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from '@effect/platform';
import { Duration, Match, Schema as S } from 'effect';

// Errors with status annotations — S.TaggedError for HTTP boundary
class NotFoundError extends S.TaggedError<NotFoundError>()('NotFound',
  { resource: S.String, id: S.optional(S.String) },
  HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })
) {}

// Endpoint: methods chain fluently, types accumulate
const getUser = HttpApiEndpoint.get('getUser', '/users/:id')
  .setPath(S.Struct({ id: S.UUID }))
  .setUrlParams(S.Struct({ include: S.optional(S.String) }))
  .addSuccess(S.Struct({ id: S.UUID, name: S.String, email: S.String }))
  .addError(NotFoundError)
  .annotate(OpenApi.Summary, 'Get user by ID');

// Group: shared prefix, middleware, errors
const UsersGroup = HttpApiGroup.make('users')
  .prefix('/users')
  .add(getUser)
  .add(HttpApiEndpoint.post('createUser', '/').setPayload(S.Struct({ name: S.String, email: S.String })).addSuccess(S.Struct({ id: S.UUID }), { status: 201 }))
  .addError(HttpError.Auth)
  .middleware(SessionAuth);

// API: compose groups, add global config
const ParametricApi = HttpApi.make('ParametricApi')
  .add(UsersGroup)
  .add(HttpApiGroup.make('health', { topLevel: true }).add(HttpApiEndpoint.get('liveness', '/health').addSuccess(S.Struct({ status: S.Literal('ok') }))))
  .prefix('/api')
  .annotate(OpenApi.Title, 'Parametric Portal API')
  .annotate(OpenApi.Version, '1.0.0');
```

**Constraints**: Path params must encode to strings. GET/HEAD/OPTIONS payloads become query params.

### Pattern 2: Handler Implementation (Effect.gen + typed extraction)

```typescript
import { HttpApiBuilder } from '@effect/platform';
import { Effect, Match, Option } from 'effect';

const UsersHandlers = HttpApiBuilder.group(ParametricApi, 'users', (handlers) =>
  handlers
    .handle('getUser', ({ path, urlParams }) => Effect.gen(function* () {
      const user = yield* UserService.findById(path.id);
      yield* Effect.filterOrFail(Option.isSome(user), () => new NotFoundError({ resource: 'User', id: path.id }));
      // urlParams.include is Option<string> — handle with Match
      const data = yield* Match.value(urlParams.include).pipe(
        Match.when(Option.isSome, ({ value }) => UserService.withRelations(user, value)),
        Match.orElse(() => Effect.succeed(Option.getOrThrow(user))),
      );
      return data;
    }))
    .handle('createUser', ({ payload }) => UserService.create(payload).pipe(
      Effect.catchTags({
        DuplicateEmail: () => Effect.fail(new HttpError.Conflict({ resource: 'User', details: 'Email exists' })),
        ValidationFailed: (e) => Effect.fail(new HttpError.Validation({ field: e.field, details: e.message })),
      }),
    ))
);
// Handler receives: { path, urlParams, payload, headers, request: HttpServerRequest }
```

### Pattern 3: Typed Middleware (HttpApiMiddleware.Tag)

```typescript
import { HttpApiMiddleware, HttpApiSecurity, HttpServerRequest } from '@effect/platform';
import { Context, Effect, Layer, Redacted, Schema as S } from 'effect';

// Middleware Tag: provides context, declares failure type, specifies security
class SessionAuth extends HttpApiMiddleware.Tag<SessionAuth>()('server/SessionAuth', {
  failure: HttpError.Auth,
  provides: Context.Tag<SessionAuth.Session>()('SessionAuth.Session'),
  security: { bearer: HttpApiSecurity.bearer },
}) {}
namespace SessionAuth {
  export interface Session { readonly userId: string; readonly tenantId: string; readonly roles: ReadonlyArray<string>; }
}

// Implementation: Layer.effect for async lookup
const SessionAuthLive = (lookup: (token: string) => Effect.Effect<SessionAuth.Session, HttpError.Auth>) =>
  Layer.effect(SessionAuth, Effect.gen(function* () {
    return SessionAuth.of({
      bearer: (token: Redacted.Redacted<string>) => lookup(Redacted.value(token)),
    });
  }));

// Optional auth: continues if auth fails (useful for public+private endpoints)
class OptionalAuth extends HttpApiMiddleware.Tag<OptionalAuth>()('server/OptionalAuth', {
  optional: true,  // Key: doesn't fail request if auth missing
  provides: Context.Tag<Option.Option<SessionAuth.Session>>()('OptionalAuth'),
  security: { bearer: HttpApiSecurity.bearer },
}) {}
```

| Security Scheme | Factory | OpenAPI Mapping |
|-----------------|---------|-----------------|
| Bearer token | `HttpApiSecurity.bearer` | `bearerAuth` |
| API key | `HttpApiSecurity.apiKey({ in: 'header'|'query'|'cookie', key: string })` | `apiKeyAuth` |
| Basic auth | `HttpApiSecurity.basic` | `basicAuth` |

### Pattern 4: Server Composition (Layer-based wiring)

```typescript
import { HttpApiBuilder, HttpApiScalar, HttpMiddleware } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Config, Duration, Effect, Layer, Schedule } from 'effect';

// Config-driven server setup (IIFE encapsulates)
const _serverConfig = (() => {
  const port = Config.integer('PORT').pipe(Config.withDefault(3000));
  const corsOrigins = Config.array(Config.string('CORS_ORIGINS')).pipe(Config.withDefault(['http://localhost:5173']));
  return { corsOrigins, port } as const;
})();

// API Layer: compose handlers + middleware
const ApiLive = HttpApiBuilder.api(ParametricApi).pipe(
  Layer.provide(UsersHandlers),
  Layer.provide(HealthHandlers),
  Layer.provide(SessionAuthLive((token) => TokenService.validate(token))),
);

// Server with middleware pipeline
const ServerLive = HttpApiBuilder.serve((app) => app.pipe(
  HttpMiddleware.cors({ allowedOrigins: (origin) => _serverConfig.corsOrigins.includes(origin) }),
  HttpMiddleware.logger,
)).pipe(
  Layer.provide(HttpApiScalar.layer({ path: '/docs', configuration: { theme: 'moon' } })),
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(createServer, { port: _serverConfig.port })),
);

// Web Standard handler (Cloudflare Workers, Bun)
const webHandler = HttpApiBuilder.toWebHandler(
  Layer.mergeAll(ApiLive, HttpServer.layerContext),
  { middleware: (app) => app.pipe(HttpMiddleware.cors()) }
);
// webHandler.handler: (request: Request) => Promise<Response>
// webHandler.dispose: () => Promise<void>
```

### Pattern 5: Client with Config + Retry (Duration + Schedule)

```typescript
import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform';
import { Config, Duration, Effect, Layer, Schedule } from 'effect';

// Config-driven client layer
const ApiClientLayer = Layer.unwrapEffect(Effect.gen(function* () {
  const baseUrl = yield* Config.string('API_BASE_URL').pipe(Config.withDefault('http://localhost:3000'));
  const timeout = yield* Config.duration('API_TIMEOUT').pipe(Config.withDefault(Duration.seconds(30)));

  return Layer.effect(
    ApiClient,
    HttpApiClient.make(ParametricApi, {
      baseUrl,
      transformClient: (client) => client.pipe(
        HttpClient.mapRequest(HttpClientRequest.setHeader('User-Agent', 'ParametricPortal/1.0')),
      ),
      transformResponse: (effect) => effect.pipe(
        Effect.timeout(timeout),
        Effect.retry(Schedule.exponential(Duration.millis(100)).pipe(
          Schedule.jittered,
          Schedule.intersect(Schedule.recurs(3)),
          Schedule.upTo(Duration.seconds(5)),
        )),
      ),
    }),
  );
}));

// Usage in handlers
const refreshData = Effect.gen(function* () {
  const client = yield* ApiClient;
  const users = yield* client.users.listUsers({ urlParams: { limit: 100 } });
  return users;
});
```

### Pattern 6: Error Namespace (IIFE + namespace merge)

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Boolean as B, Schema as S } from 'effect';

// IIFE bundles related errors with shared structure
const HttpError = (() => {
  const _base = { cause: S.optional(S.Unknown), timestamp: S.optional(S.DateFromSelf) };

  class Auth extends S.TaggedError<Auth>()('Auth',
    { ..._base, details: S.String },
    HttpApiSchema.annotations({ status: 401, description: 'Authentication failed' })
  ) {}

  class NotFound extends S.TaggedError<NotFound>()('NotFound',
    { ..._base, resource: S.String, id: S.optional(S.String) },
    HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })
  ) {
    // Boolean.match for message — no ternary
    override get message() {
      return B.match(this.id !== undefined, {
        onTrue: () => `${this.resource}/${this.id} not found`,
        onFalse: () => `${this.resource} not found`,
      });
    }
  }

  class Validation extends S.TaggedError<Validation>()('Validation',
    { ..._base, field: S.String, details: S.String },
    HttpApiSchema.annotations({ status: 400, description: 'Validation failed' })
  ) {}

  class Conflict extends S.TaggedError<Conflict>()('Conflict',
    { ..._base, resource: S.String, details: S.String },
    HttpApiSchema.annotations({ status: 409, description: 'Resource conflict' })
  ) {}

  class RateLimit extends S.TaggedError<RateLimit>()('RateLimit',
    { ..._base, retryAfterMs: S.Number, limit: S.optional(S.Number) },
    HttpApiSchema.annotations({ status: 429, description: 'Rate limit exceeded' })
  ) {}

  return { Auth, Conflict, NotFound, RateLimit, Validation } as const;
})();

namespace HttpError {
  export type Auth = InstanceType<typeof HttpError.Auth>;
  export type NotFound = InstanceType<typeof HttpError.NotFound>;
  export type Validation = InstanceType<typeof HttpError.Validation>;
  export type Conflict = InstanceType<typeof HttpError.Conflict>;
  export type RateLimit = InstanceType<typeof HttpError.RateLimit>;
  export type Any = Auth | NotFound | Validation | Conflict | RateLimit;
}
```

### Pattern 7: Advanced Group Features

```typescript
import { HttpApi, HttpApiGroup, HttpApiEndpoint, OpenApi } from '@effect/platform';

// middlewareEndpoints: apply middleware only to EXISTING endpoints (not future ones)
const AdminGroup = HttpApiGroup.make('admin')
  .add(listUsersEndpoint)
  .add(getAuditLogEndpoint)
  .middlewareEndpoints(AdminAuth)  // Only applies to listUsers, getAuditLog
  .add(publicStatsEndpoint);       // No AdminAuth on this one

// annotateEndpoints: selective annotation
const DeprecatingGroup = HttpApiGroup.make('legacy')
  .add(oldEndpoint)
  .annotateEndpoints(OpenApi.Deprecated, true)  // Only oldEndpoint marked deprecated
  .add(newEndpoint);                            // newEndpoint NOT deprecated

// addHttpApi: compose entire API definitions
const InternalApi = HttpApi.make('internal').add(AdminGroup);
const PublicApi = HttpApi.make('public').add(UsersGroup).add(HealthGroup);
const CombinedApi = HttpApi.make('combined')
  .addHttpApi(InternalApi)
  .addHttpApi(PublicApi)
  .prefix('/api/v1');

// topLevel: true mounts at root (client access differs)
const Api = HttpApi.make('api')
  .add(HttpApiGroup.make('users'))                           // client.users.getUser()
  .add(HttpApiGroup.make('health', { topLevel: true }));     // client.health() — root level
```

### Pattern 8: Multipart + Binary Responses

```typescript
import { HttpApiEndpoint, HttpApiSchema, Multipart } from '@effect/platform';
import { Schema as S } from 'effect';

// File upload with metadata
const UploadPayload = S.Struct({
  file: Multipart.SingleFileSchema,
  metadata: S.optional(S.Struct({ description: S.String, tags: S.Array(S.String) })),
});

const uploadEndpoint = HttpApiEndpoint.post('upload', '/files')
  .setPayload(UploadPayload)
  .addSuccess(S.Struct({ id: S.UUID, url: S.String }), { status: 201 });

// Binary download response
const downloadEndpoint = HttpApiEndpoint.get('download', '/files/:id')
  .setPath(S.Struct({ id: S.UUID }))
  .addSuccess(S.Uint8Array.pipe(
    HttpApiSchema.withEncoding({ kind: 'Uint8Array', contentType: 'application/octet-stream' })
  ))
  .addError(HttpError.NotFound);

// Empty responses (status-only)
const deleteEndpoint = HttpApiEndpoint.del('delete', '/files/:id')
  .setPath(S.Struct({ id: S.UUID }))
  .addSuccess(HttpApiSchema.NoContent)  // 204
  .addError(HttpError.NotFound);

// URL-encoded form (not multipart)
const formEndpoint = HttpApiEndpoint.post('submit', '/forms')
  .setPayload(S.Struct({ name: S.String, email: S.String }).pipe(
    HttpApiSchema.withEncoding({ kind: 'UrlParams' })
  ))
  .addSuccess(HttpApiSchema.Created);  // 201
```

### Pattern 9: OpenAPI Annotations (Comprehensive)

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from '@effect/platform';
import { Schema as S } from 'effect';

const Api = HttpApi.make('ParametricApi')
  // API-level metadata
  .annotate(OpenApi.Title, 'Parametric Portal API')
  .annotate(OpenApi.Version, '1.0.0')
  .annotate(OpenApi.Description, 'Asset management and collaboration platform')
  .annotate(OpenApi.License, { name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
  .annotate(OpenApi.Servers, [
    { url: 'https://api.parametric.app', description: 'Production' },
    { url: 'https://staging.parametric.app', description: 'Staging' },
  ])
  // Custom extensions
  .annotate(OpenApi.Override, { 'x-rate-limit': { requests: 1000, window: '1h' } })
  .add(
    HttpApiGroup.make('users')
      .annotate(OpenApi.Tag, 'Users')  // Group tag in docs
      .add(
        HttpApiEndpoint.get('getUser', '/users/:id')
          .annotate(OpenApi.Summary, 'Get user by ID')
          .annotate(OpenApi.Description, 'Retrieves user details including profile and preferences')
          .setPath(S.Struct({
            id: S.UUID.annotations({ description: 'User unique identifier', examples: ['123e4567-e89b-12d3-a456-426614174000'] }),
          }))
      )
  )
  .add(
    HttpApiGroup.make('internal', { topLevel: true })
      .annotate(OpenApi.Exclude, true)  // Hidden from public docs
  );
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status mapping | Manual status codes | `HttpApiSchema.annotations({ status: N })` | Auto-populates OpenAPI |
| Error responses | Bare `Effect.fail` | `S.TaggedError + HttpApiSchema.annotations` | Typed across boundary |
| Security extraction | Header parsing | `HttpApiSecurity.bearer/apiKey/basic` | Auto-validates + OpenAPI |
| Client generation | fetch wrappers | `HttpApiClient.make(Api)` | Full type inference |
| Retry policy | Manual retry loops | `Schedule.exponential().pipe(...)` | Composable, testable |
| Duration literals | `30000` (ms) | `Duration.seconds(30)` | Type-safe, readable |
| Config access | `process.env.X` | `Config.string('X').pipe(...)` | Structured, validated |
| Boolean branching | `if (x) {} else {}` | `Boolean.match(x, { onTrue, onFalse })` | Expression-based |
| Multi-error catch | Chained `.catchTag` | `Effect.catchTags({ A: ..., B: ... })` | Single call |
| Optional handling | Null checks | `Option.match(x, { onNone, onSome })` | Explicit handling |
| Web standard export | Express adapter | `HttpApiBuilder.toWebHandler(...)` | Native Web API |
| Per-endpoint middleware | Manual wrapping | `.middlewareEndpoints(Tag)` | Declarative |
| API composition | Manual route merging | `HttpApi.addHttpApi(other)` | Type-safe merge |
| Docs UI | Manual OpenAPI setup | `HttpApiScalar.layer({ path })` | Auto-generated |

## Common Pitfalls

### Pitfall 1: Layer.succeed for Async Middleware
**What goes wrong:** Middleware needs async initialization (DB lookup, token validation) but uses `Layer.succeed`
**Why it happens:** `Layer.succeed` requires static value; async operations need `Layer.effect`
**How to avoid:** Use `Layer.effect(Tag, Effect.gen(...))` for middleware requiring dependencies
**Warning signs:** Type error "Effect is not assignable to Service"

### Pitfall 2: Effect.retry with Bare Number
**What goes wrong:** `Effect.retry({ times: 3 })` — outdated syntax
**Why it happens:** Pre-Effect-3.0 API; now requires Schedule
**How to avoid:** `Effect.retry(Schedule.recurs(3))` or full schedule composition
**Warning signs:** Type error on retry config object

### Pitfall 3: Missing addError on Endpoint
**What goes wrong:** Handler fails with error type not declared on endpoint
**Why it happens:** Contract doesn't include error schema; runtime error won't serialize
**How to avoid:** Every error type in handler must have corresponding `.addError(ErrorSchema)` on endpoint
**Warning signs:** Unhandled error types in handler, client receives 500 instead of typed error

### Pitfall 4: topLevel Group Client Access
**What goes wrong:** Can't find endpoint in generated client
**Why it happens:** `topLevel: true` groups mount at API root, not under group name
**How to avoid:** `topLevel: true` → `client.endpointName()`, `topLevel: false` → `client.groupName.endpointName()`
**Warning signs:** TypeScript error accessing `client.groupName` for topLevel groups

### Pitfall 5: middlewareEndpoints vs middleware Order
**What goes wrong:** Middleware applied to wrong endpoints
**Why it happens:** `.middleware(Tag)` applies to ALL endpoints; `.middlewareEndpoints(Tag)` only to already-added ones
**How to avoid:** Use `.middlewareEndpoints` after adding endpoints that need it, then add public endpoints
**Warning signs:** Auth required on public endpoints or missing on protected ones

### Pitfall 6: Optional Middleware Without Option Type
**What goes wrong:** Type mismatch when accessing optional auth context
**Why it happens:** `optional: true` middleware provides `Option<Session>`, not `Session`
**How to avoid:** `provides` type must be `Option.Option<T>` when `optional: true`
**Warning signs:** Runtime error accessing `.userId` on Option type

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All packages in catalog, verified against @effect/platform 0.94.2
- Architecture patterns: HIGH — 9 patterns covering contract→handler→client→composition
- Effect integration: HIGH — Match, Duration, Config, Schedule, Option, Effect.catchTags
- Pitfalls: HIGH — Common issues from API misuse, middleware ordering, retry syntax

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days — stable APIs)

**Validation passes:**
- HttpApiMiddleware.Tag options verified (provides, failure, security, optional)
- HttpApiBuilder.toWebHandler signature verified
- HttpApiGroup.middlewareEndpoints, annotateEndpoints verified
- HttpApi.addHttpApi composition verified
- Effect.retry requires Schedule (not bare object)
