# @effect/platform HttpApi Research

> Dense reference for typed API building, middleware composition, and schema integration.

---

## [1] HttpApiEndpoint — Endpoint Definition

```typescript
import { HttpApiEndpoint, HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

// Method constructors: get, post, put, patch, del, head, options
const endpoint = HttpApiEndpoint.get('getUser', '/users/:id')
  .setPath(S.Struct({ id: S.UUID }))                    // Path params (string-encodeable)
  .setUrlParams(S.Struct({ include: S.optional(S.String) }))
  .setHeaders(S.Struct({ 'x-api-version': S.String }))
  .addSuccess(UserSchema)                               // Success response schema
  .addSuccess(UserSchema, { status: 200 })              // Explicit status
  .addError(NotFoundError)                              // Error response schema
  .prefix('/api/v1')                                    // Path prefix
  .middleware(AuthMiddleware)                           // Attach middleware tag
  .annotate(OpenApi.Summary, 'Get user by ID');

// POST/PUT/PATCH payload
HttpApiEndpoint.post('createUser', '/users')
  .setPayload(S.Struct({ name: S.String, email: S.String }));
```

**Constraints**: Path/headers must encode to strings. GET/HEAD/OPTIONS payloads become query params.

---

## [2] HttpApiGroup — Endpoint Grouping

```typescript
import { HttpApiGroup } from '@effect/platform';

const UsersGroup = HttpApiGroup.make('users')
  .prefix('/users')                                     // Shared prefix
  .add(getEndpoint)
  .addError(AuthError)                                  // Shared error (all endpoints)
  .middleware(RateLimitMiddleware)                      // Shared middleware
  .annotate(OpenApi.Tag, 'Users');

// Top-level group (no prefix nesting)
const HealthGroup = HttpApiGroup.make('health', { topLevel: true }).add(livenessEndpoint);
```

| Method | Purpose |
|--------|---------|
| `add(endpoint)` | Include endpoint |
| `addError(schema)` | Shared error type |
| `prefix(path)` | Prepend to endpoints (before call) |
| `middleware(tag)` | Apply to all endpoints |

---

## [3] HttpApi — API Composition

```typescript
import { HttpApi, OpenApi } from '@effect/platform';

const MyApi = HttpApi.make('MyApi')
  .add(UsersGroup).add(HealthGroup)
  .prefix('/api')
  .addError(InternalError)
  .annotate(OpenApi.Title, 'My API')
  .annotate(OpenApi.Version, '1.0.0')
  .annotate(OpenApi.License, { name: 'MIT', url: 'https://opensource.org/licenses/MIT' });
```

---

## [4] HttpApiBuilder — Server Implementation

```typescript
import { HttpApiBuilder } from '@effect/platform';
import { Layer, Effect } from 'effect';

// Group handlers
const UsersHandlers = HttpApiBuilder.group(MyApi, 'users', (handlers) =>
  handlers
    .handle('getUser', ({ path }) => Effect.gen(function* () {
      const user = yield* UserService.findById(path.id);
      return user;  // Must match addSuccess schema
    }))
    .handle('createUser', ({ payload }) => UserService.create(payload))
);
// Handler receives: { path, urlParams, payload, headers, request: HttpServerRequest }

// API layer composition
const ApiLive = HttpApiBuilder.api(MyApi).pipe(
  Layer.provide(UsersHandlers),
  Layer.provide(HealthHandlers),
);

// Serve with global middleware
const ServerLive = HttpApiBuilder.serve((httpApp) =>
  httpApp.pipe(HttpMiddleware.cors(), HttpMiddleware.logger)
).pipe(
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
);
```

**Handler Variants**: `handle()` returns success schema, `handleRaw()` returns HttpServerResponse.

---

## [5] HttpApiMiddleware — Typed Middleware

```typescript
import { HttpApiMiddleware, HttpApiSecurity, HttpServerRequest } from '@effect/platform';
import { Context, Effect, Layer, Redacted } from 'effect';

// Basic middleware (no provides/failure = passthrough)
class Logger extends HttpApiMiddleware.Tag<Logger>()('Logger', {}) {}
const LoggerLive = Layer.succeed(Logger, Logger.of(
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    yield* Effect.log(`${req.method} ${req.url}`);
  })
));

// Context provider middleware
class RequestContext extends HttpApiMiddleware.Tag<RequestContext>()('RequestContext', {
  provides: Context.Tag<RequestContext.Service>()('RequestContext.Service'),
}) {}
namespace RequestContext {
  export interface Service { readonly requestId: string; readonly tenantId: string; }
}
const RequestContextLive = Layer.effect(RequestContext, Effect.gen(function* () {
  return RequestContext.of(Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    return { requestId: crypto.randomUUID(), tenantId: req.headers['x-tenant-id'] ?? 'default' };
  }));
}));

// Auth with security schemes
class Auth extends HttpApiMiddleware.Tag<Auth>()('Auth', {
  failure: AuthError,
  provides: Context.Tag<Auth.Session>()('Auth.Session'),
  security: {
    bearer: HttpApiSecurity.bearer,
    apiKey: HttpApiSecurity.apiKey({ in: 'header', key: 'X-API-Key' }),
  },
}) {}
namespace Auth {
  export interface Session { readonly userId: string; readonly roles: ReadonlyArray<string>; }
}
const AuthLive = Layer.effect(Auth, Effect.gen(function* () {
  const userService = yield* UserService;
  return Auth.of({
    bearer: (token: Redacted.Redacted<string>) => Effect.gen(function* () {
      const decoded = yield* JwtService.verify(Redacted.value(token));
      const user = yield* userService.findById(decoded.sub);
      return { userId: user.id, roles: user.roles };
    }),
    apiKey: (key: Redacted.Redacted<string>) => Effect.gen(function* () {
      const apiKey = yield* ApiKeyService.validate(Redacted.value(key));
      return { userId: apiKey.userId, roles: ['api'] };
    }),
  });
}));
```

| Security Scheme | Factory |
|-----------------|---------|
| Bearer | `HttpApiSecurity.bearer` |
| API Key | `HttpApiSecurity.apiKey({ in: 'header' \| 'query' \| 'cookie', key: string })` |
| Basic | `HttpApiSecurity.basic` |

**Apply**: `.middleware(Auth)` on endpoint or group.

---

## [6] HttpApiSchema — HTTP Annotations

```typescript
import { HttpApiSchema, Multipart } from '@effect/platform';
import { Schema as S } from 'effect';

// Status annotations
const Created = S.Struct({ id: S.UUID }).pipe(HttpApiSchema.annotations({ status: 201 }));
class NotFoundError extends S.TaggedError<NotFoundError>()('NotFound',
  { resource: S.String },
  HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })
) {}

// Empty responses
HttpApiSchema.NoContent;                                // 204
HttpApiSchema.Created;                                  // 201 void body
HttpApiSchema.Accepted;                                 // 202
const NotModified = HttpApiSchema.EmptyError(304);      // Custom empty error

// Path params with validation
const IdParam = HttpApiSchema.param('id', S.UUID);
HttpApiEndpoint.get('getBySlug', '/items/:slug')
  .setPath(S.Struct({ slug: HttpApiSchema.param('slug', S.NonEmptyTrimmedString) }));

// Encoding control
const BinaryResponse = S.Uint8Array.pipe(
  HttpApiSchema.withEncoding({ kind: 'Uint8Array', contentType: 'application/octet-stream' })
);
const TextResponse = S.String.pipe(HttpApiSchema.withEncoding({ kind: 'Text', contentType: 'text/plain' }));
const UrlEncodedBody = S.Struct({ field: S.String }).pipe(HttpApiSchema.withEncoding({ kind: 'UrlParams' }));

// Multipart uploads
const UploadPayload = S.Struct({
  file: Multipart.SingleFileSchema,
  metadata: S.optional(S.String),
});
HttpApiEndpoint.post('upload', '/upload').setPayload(UploadPayload);
```

| Encoding Kind | Use Case |
|---------------|----------|
| `Json` | Default JSON |
| `UrlParams` | Form data |
| `Text` | Plain text |
| `Uint8Array` | Binary |

---

## [7] HttpApiClient — Client Generation

```typescript
import { HttpApiClient } from '@effect/platform';

// Full client
const client = yield* HttpApiClient.make(MyApi, { baseUrl: 'https://api.example.com' });
const user = yield* client.users.getUser({ path: { id: '123' } });

// Group client
const usersClient = yield* HttpApiClient.group(MyApi, 'users', { baseUrl: 'https://api.example.com' });
const user = yield* usersClient.getUser({ path: { id: '123' } });

// Single endpoint
const getUser = yield* HttpApiClient.endpoint(MyApi, 'users', 'getUser', { baseUrl: '...' });

// With transforms
const client = yield* HttpApiClient.make(MyApi, {
  baseUrl: 'https://api.example.com',
  transformClient: (c) => c.pipe(HttpClient.mapRequest(HttpClientRequest.bearerToken('token'))),
  transformResponse: (e) => e.pipe(Effect.retry({ times: 3 })),
});
```

**Signature**: `(req: { path?, urlParams?, payload?, headers? }) => Effect<Success, Error | HttpClientError | ParseError, R>`

---

## [8] HttpApiScalar — Documentation UI

```typescript
import { HttpApiScalar } from '@effect/platform';

const DocsLive = HttpApiScalar.layer({ path: '/docs' });
const DocsCdnLive = HttpApiScalar.layerCdn({ path: '/docs', version: '1.25.0' });
const DocsApiLive = HttpApiScalar.layerHttpLayerRouter(MyApi, { path: '/docs' });

HttpApiScalar.layer({
  path: '/docs',
  configuration: { theme: 'moon', layout: 'modern', darkMode: true, showSidebar: true },
});
```

**Themes**: `default`, `moon`, `purple`, `solarized`, `bluePlanet`, `saturn`, `deepSpace`, `kepler`, `mars`, `alternate`, `none`

---

## [9] OpenAPI Annotations

```typescript
import { OpenApi } from '@effect/platform';

// API-level
HttpApi.make('MyApi')
  .annotate(OpenApi.Title, 'My API')
  .annotate(OpenApi.Version, '1.0.0')
  .annotate(OpenApi.Description, 'API description')
  .annotate(OpenApi.License, { name: 'MIT', url: '...' })
  .annotate(OpenApi.ExternalDocs, { description: 'Docs', url: '...' })
  .annotate(OpenApi.Identifier, 'my-api');

// Group-level
HttpApiGroup.make('users')
  .annotate(OpenApi.Tag, 'Users')
  .annotate(OpenApi.Exclude, true);                     // Hide from docs

// Endpoint-level
HttpApiEndpoint.get('getUser', '/users/:id')
  .annotate(OpenApi.Summary, 'Get user by ID')
  .annotate(OpenApi.Description, 'Detailed description')
  .annotate(OpenApi.Deprecated, true);

// Schema-level
S.Struct({
  id: S.UUID.annotations({ description: 'Unique identifier' }),
  name: S.String.annotations({ description: 'User name', examples: ['Alice'] }),
}).annotations({ title: 'User', description: 'User entity' });
```

---

## [10] Error Patterns

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

class NotFoundError extends S.TaggedError<NotFoundError>()('NotFound',
  { resource: S.String, id: S.optional(S.String), cause: S.optional(S.Unknown) },
  HttpApiSchema.annotations({ status: 404, description: 'Resource not found' })
) {
  static readonly of = (resource: string, id?: string, cause?: unknown) =>
    new NotFoundError({ resource, id, cause });
  override get message() {
    return this.id ? `NotFound: ${this.resource}/${this.id}` : `NotFound: ${this.resource}`;
  }
}

class ValidationError extends S.TaggedError<ValidationError>()('Validation',
  { field: S.String, details: S.String, cause: S.optional(S.Unknown) },
  HttpApiSchema.annotations({ status: 400, description: 'Validation failed' })
) {
  static readonly of = (field: string, details: string, cause?: unknown) =>
    new ValidationError({ field, details, cause });
  override get message() { return `Validation: ${this.field} - ${this.details}`; }
}

class RateLimitError extends S.TaggedError<RateLimitError>()('RateLimit',
  { retryAfterMs: S.Number, limit: S.optional(S.Number), remaining: S.optional(S.Number) },
  HttpApiSchema.annotations({ status: 429, description: 'Rate limit exceeded' })
) {
  static readonly of = (retryAfterMs: number, opts?: { limit?: number; remaining?: number }) =>
    new RateLimitError({ retryAfterMs, ...opts });
}

// Namespace pattern
const HttpError = { NotFound: NotFoundError, Validation: ValidationError, RateLimit: RateLimitError } as const;
namespace HttpError { export type Any = NotFoundError | ValidationError | RateLimitError; }
```

---

## [11] Complete Example

```typescript
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware, HttpApiSchema, HttpApiSecurity, OpenApi } from '@effect/platform';
import { NodeHttpServer } from '@effect/platform-node';
import { Context, Effect, Layer, Redacted, Schema as S } from 'effect';

// Errors
class AuthError extends S.TaggedError<AuthError>()('Auth',
  { details: S.String }, HttpApiSchema.annotations({ status: 401 })) {}
class NotFoundError extends S.TaggedError<NotFoundError>()('NotFound',
  { resource: S.String }, HttpApiSchema.annotations({ status: 404 })) {}

// Auth middleware
class Auth extends HttpApiMiddleware.Tag<Auth>()('Auth', {
  failure: AuthError,
  provides: Context.Tag<Auth.Session>()('Auth.Session'),
  security: { bearer: HttpApiSecurity.bearer },
}) {}
namespace Auth { export interface Session { readonly userId: string; } }
const AuthLive = Layer.succeed(Auth, Auth.of({
  bearer: (token: Redacted.Redacted<string>) =>
    Redacted.value(token) === 'valid-token'
      ? Effect.succeed({ userId: '123' })
      : Effect.fail(new AuthError({ details: 'Invalid token' })),
}));

// API definition
const UserSchema = S.Struct({ id: S.UUID, name: S.String });
const getUser = HttpApiEndpoint.get('getUser', '/users/:id')
  .middleware(Auth)
  .setPath(S.Struct({ id: S.UUID }))
  .addSuccess(UserSchema)
  .addError(NotFoundError);
const UsersGroup = HttpApiGroup.make('users').add(getUser);
const Api = HttpApi.make('Api').add(UsersGroup).prefix('/api').annotate(OpenApi.Title, 'Example API');

// Handlers
const UsersHandlers = HttpApiBuilder.group(Api, 'users', (handlers) =>
  handlers.handle('getUser', ({ path }) => Effect.gen(function* () {
    const session = yield* Auth.Session;
    yield* Effect.log(`User ${session.userId} requested ${path.id}`);
    return { id: path.id, name: 'Alice' };
  }))
);

// Composition
const ApiLive = HttpApiBuilder.api(Api).pipe(Layer.provide(UsersHandlers), Layer.provide(AuthLive));
const ServerLive = HttpApiBuilder.serve().pipe(
  Layer.provide(ApiLive),
  Layer.provide(NodeHttpServer.layer(() => createServer(), { port: 3000 })),
);
```

---

## [INDEX] Quick Reference

| Module | Key Exports |
|--------|-------------|
| HttpApiEndpoint | `get`, `post`, `put`, `patch`, `del`, `setPath`, `setPayload`, `setUrlParams`, `setHeaders`, `addSuccess`, `addError`, `middleware` |
| HttpApiGroup | `make`, `add`, `addError`, `prefix`, `middleware` |
| HttpApi | `make`, `add`, `addError`, `prefix`, `annotate` |
| HttpApiBuilder | `api`, `group`, `serve`, `middlewareCors`, `toWebHandler` |
| HttpApiClient | `make`, `group`, `endpoint` |
| HttpApiMiddleware | `Tag` (with `provides`, `failure`, `security` options) |
| HttpApiSchema | `annotations`, `param`, `withEncoding`, `NoContent`, `Created`, `EmptyError` |
| HttpApiSecurity | `bearer`, `apiKey`, `basic` |
| HttpApiScalar | `layer`, `layerCdn`, `layerHttpLayerRouter` |
