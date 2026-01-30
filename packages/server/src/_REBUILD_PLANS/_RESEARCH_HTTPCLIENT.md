# @effect/platform HttpClient Research

> **Scope:** Typed HTTP clients for outbound requests using Effect patterns.
> **Version:** @effect/platform ^0.77 (Effect 3.x compatible)

---

## [1] MODULE OVERVIEW

| Module | Purpose |
|--------|---------|
| `HttpClient` | Client composition, filtering, request/response transforms |
| `HttpClientRequest` | Request construction: URL, headers, body, auth |
| `HttpClientResponse` | Response parsing: schema validation, streaming |
| `FetchHttpClient` | Browser/Node.js Fetch API implementation layer |

---

## [2] HTTPCLIENT SERVICE

### [2.1] Core Operations

| Function | Signature | Use Case |
|----------|-----------|----------|
| `execute` | `(req) => Effect<Response, HttpClientError>` | Send request (requires `Effect.scoped`) |
| `filterStatusOk` | `(client) => HttpClient.With<E \| ResponseError, R>` | Accept 2xx only |
| `filterStatus` | `(pred) => (client) => client` | Custom status predicate |
| `filterOrElse` | `(pred, recovery) => (client) => client` | Conditional recovery |
| `mapRequest` | `(f) => (client) => client` | Sync request transform |
| `mapRequestEffect` | `(f) => (client) => client` | Effectful transform (async auth) |
| `transform` | `(f: (effect, req) => Effect) => (client) => client` | Full middleware wrap |
| `retry` | `(schedule) => (client) => client` | Retry with Schedule |
| `retryTransient` | `(opts?) => (client) => client` | Auto-retry 429/5xx/network |
| `tap` | `(f) => (client) => client` | Observe response |
| `tapRequest` | `(f) => (client) => client` | Observe request |
| `tapError` | `(f) => (client) => client` | Observe errors |
| `withTracerDisabledWhen` | `(pred) => (client) => client` | Skip tracing (health checks) |

### [2.2] Client Composition Pipeline

```typescript
import { HttpClient, HttpClientRequest, FetchHttpClient } from '@effect/platform';
import { Clock, Duration, Effect, Metric, Schedule } from 'effect';

// Resilient client: filterStatusOk → retry → observability
const ResilientClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(HttpClientRequest.prependUrl('https://api.example.com')),
    HttpClient.mapRequest(HttpClientRequest.setHeader('User-Agent', 'MyApp/1.0')),
    HttpClient.retryTransient({ schedule: Schedule.exponential('100 millis').pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))) }),
    HttpClient.tapRequest((req) => Effect.logDebug('Outbound', { method: req.method, url: req.url })),
    HttpClient.tap((res) => Clock.currentTimeMillis.pipe(Effect.tap((ts) => Metric.set(Metric.gauge('http_last_success'), ts)))),
  );
});
```

### [2.3] Effectful Request Transform (Async Auth)

```typescript
// mapRequestEffect: async token fetch before each request
const AuthenticatedClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(
    HttpClient.mapRequestEffect((req) =>
      TokenService.getToken().pipe(Effect.map((token) => req.pipe(HttpClientRequest.bearerToken(token)))),
    ),
    HttpClient.retryTransient(),
  );
});
```

---

## [3] HTTPCLIENTREQUEST

### [3.1] Constructor Functions

```typescript
import { HttpClientRequest } from '@effect/platform';

HttpClientRequest.get('https://api.example.com/users');
HttpClientRequest.post('https://api.example.com/users');
HttpClientRequest.put('https://api.example.com/users/123');
HttpClientRequest.patch('https://api.example.com/users/123');
HttpClientRequest.del('https://api.example.com/users/123');
HttpClientRequest.head('https://api.example.com/users');
HttpClientRequest.options('https://api.example.com/users');
```

### [3.2] Headers and Authentication

```typescript
import { Redacted } from 'effect';

HttpClientRequest.get('/api/data').pipe(
  HttpClientRequest.setHeader('X-Request-ID', 'abc-123'),
  HttpClientRequest.setHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
  HttpClientRequest.acceptJson,
  HttpClientRequest.bearerToken(Redacted.make('secret-token')),
  // OR: HttpClientRequest.basicAuth('username', Redacted.make('password')),
);
```

### [3.3] URL Construction

```typescript
HttpClientRequest.get('/users').pipe(
  HttpClientRequest.prependUrl('https://api.example.com'),
  HttpClientRequest.appendUrl('/active'),
  HttpClientRequest.setUrlParams({ page: '1', limit: '20', sort: 'name' }),
  HttpClientRequest.appendUrlParams({ filter: 'active' }),
);
// Result: https://api.example.com/users/active?page=1&limit=20&sort=name&filter=active
```

### [3.4] Body Configuration

```typescript
import { HttpClientRequest } from '@effect/platform';
import { Schema as S } from 'effect';

// Schema-validated body (PREFERRED) — compile-time type safety + runtime validation
HttpClientRequest.post('/api/users').pipe(
  HttpClientRequest.schemaBodyJson(S.Struct({ name: S.String.pipe(S.minLength(1)), email: S.String }))({ name: 'John', email: 'j@e.com' }),
); // => Effect<HttpClientRequest, ParseError | HttpBodyError>

// Unsafe JSON — synchronous, use for trusted internal data only
HttpClientRequest.post('/api/users').pipe(HttpClientRequest.bodyUnsafeJson({ name: 'John' }));

// Alternative body types
HttpClientRequest.bodyText('<xml>data</xml>', 'application/xml');
HttpClientRequest.bodyUint8Array(new Uint8Array([1, 2, 3]), 'application/octet-stream');
HttpClientRequest.bodyFormData(new FormData());
```

---

## [4] HTTPCLIENTRESPONSE

### [4.1] Raw Response Access

```typescript
import { HttpClientResponse } from '@effect/platform';
import { Effect } from 'effect';

// Direct response field access + parsing methods
Effect.gen(function* () {
  const response = yield* /* client.execute(...) */;
  response.status;                                    // number
  response.headers['content-type'];                   // string | undefined
  yield* HttpClientResponse.text(response);           // Effect<string>
  yield* HttpClientResponse.json(response);           // Effect<unknown>
  yield* HttpClientResponse.arrayBuffer(response);    // Effect<ArrayBuffer>
});
```

### [4.2] Schema-Validated Parsing

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from '@effect/platform';
import { Effect, Schema as S } from 'effect';

const UserSchema = S.Struct({ id: S.Number, name: S.String, email: S.String, createdAt: S.DateFromString });

// Inline parsing — no loose const; compose directly in pipeline
Effect.gen(function* () {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const response = yield* client.execute(HttpClientRequest.get('/users/1')).pipe(Effect.scoped);
  return yield* HttpClientResponse.schemaBodyJson(UserSchema)(response);
}).pipe(Effect.provide(FetchHttpClient.layer));

// URL-encoded (OAuth tokens)
HttpClientResponse.schemaBodyUrlParams(S.Struct({ access_token: S.String, token_type: S.String, expires_in: S.optional(S.NumberFromString) }));

// Header-only (rate limits)
HttpClientResponse.schemaHeaders(S.Struct({ 'x-ratelimit-limit': S.NumberFromString, 'x-ratelimit-remaining': S.NumberFromString }));

// Full response (status + headers + body) — validates all three together
HttpClientResponse.schemaJson(S.Struct({
  status: S.Literal(200, 201),
  headers: S.Struct({ 'content-type': S.String }),
  body: S.Struct({ data: S.Array(UserSchema) }),
}));
```

---

## [5] FETCHHTTPCLIENT

### [5.1] Layer Composition

```typescript
import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Effect, Layer } from 'effect';

// Basic: Effect.provide(FetchHttpClient.layer)
Effect.runPromise(
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    // use client...
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);

// Custom fetch options (CORS, credentials, cache)
const CustomFetchLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, FetchHttpClient.RequestInit.of({ credentials: 'include', mode: 'cors', cache: 'no-store' }))),
);
```

---

## [6] PRODUCTION PATTERNS

### [6.1] Typed API Client Service

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from '@effect/platform';
import { Data, Effect, Match, pipe, Schedule, Schema as S } from 'effect';

const UserSchema = S.Struct({ id: S.Number, name: S.String, email: S.String });
const CreateUserSchema = S.Struct({ name: S.String.pipe(S.minLength(1)), email: S.String });

class ApiClientError extends Data.TaggedError('ApiClientError')<{ readonly reason: string; readonly status?: number; readonly cause?: unknown }> {}

class UsersApiClient extends Effect.Service<UsersApiClient>()('UsersApiClient', {
  effect: Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest(HttpClientRequest.prependUrl('https://api.example.com')),
      HttpClient.mapRequest(HttpClientRequest.setHeader('User-Agent', 'MyApp/1.0')),
      HttpClient.retryTransient({ schedule: Schedule.exponential('100 millis').pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(3))) }),
    );
    return {
      getById: (id: number) =>
        pipe(
          HttpClientRequest.get(`/users/${id}`),
          client.execute,
          Effect.scoped,
          Effect.andThen(HttpClientResponse.schemaBodyJson(UserSchema)),
          Effect.mapError((e) => new ApiClientError({ reason: 'Failed to fetch user', cause: e })),
        ),
      create: (user: typeof CreateUserSchema.Type) =>
        pipe(
          HttpClientRequest.post('/users'),
          HttpClientRequest.schemaBodyJson(CreateUserSchema)(user),
          Effect.andThen(client.execute),
          Effect.scoped,
          Effect.andThen(HttpClientResponse.schemaBodyJson(UserSchema)),
          Effect.mapError((e) => new ApiClientError({ reason: 'Failed to create user', cause: e })),
        ),
    };
  }),
  dependencies: [FetchHttpClient.layer],
}) {}
```

### [6.2] OAuth Token Exchange

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from '@effect/platform';
import { Effect, pipe, Redacted, Schema as S } from 'effect';

const TokenResponseSchema = S.Struct({ access_token: S.String, token_type: S.String, expires_in: S.optional(S.Number), refresh_token: S.optional(S.String) });

const exchangeAuthorizationCode = (tokenUrl: string, clientId: string, clientSecret: Redacted.Redacted<string>, code: string, redirectUri: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: Redacted.value(clientSecret), code, redirect_uri: redirectUri });
    return yield* pipe(
      HttpClientRequest.post(tokenUrl),
      HttpClientRequest.setHeader('Content-Type', 'application/x-www-form-urlencoded'),
      HttpClientRequest.bodyText(body.toString()),
      client.execute,
      Effect.scoped,
      Effect.andThen(HttpClientResponse.schemaBodyJson(TokenResponseSchema)),
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
```

### [6.3] GitHub API Pattern

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from '@effect/platform';
import { Effect, pipe, Schema as S } from 'effect';

const GitHubUserSchema = S.Struct({ id: S.Number, login: S.String, email: S.NullishOr(S.String), avatar_url: S.String });

const fetchGitHubUser = (accessToken: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk, HttpClient.retryTransient());
    return yield* pipe(
      HttpClientRequest.get('https://api.github.com/user'),
      HttpClientRequest.setHeaders({ Authorization: `Bearer ${accessToken}`, 'User-Agent': 'MyApp/1.0', Accept: 'application/vnd.github+json' }),
      client.execute,
      Effect.scoped,
      Effect.andThen(HttpClientResponse.schemaBodyJson(GitHubUserSchema)),
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
```

### [6.4] Middleware Transform Pattern

```typescript
import { HttpClient } from '@effect/platform';
import { Clock, Duration, Effect, Metric } from 'effect';

// transform: full middleware (access to request + response effect)
const withObservability = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  client.pipe(
    HttpClient.transform((effect, request) =>
      Effect.gen(function* () {
        const start = yield* Clock.currentTimeMillis;
        yield* Effect.logDebug('Outbound', { method: request.method, url: request.url });
        const response = yield* effect;
        const elapsed = (yield* Clock.currentTimeMillis) - start;
        yield* Metric.set(Metric.gauge('http_request_duration_ms'), elapsed);
        return response;
      }),
    ),
  );

// Composition: filterStatusOk → retry → observability → timeout
const ConfiguredClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(
    HttpClient.filterStatusOk,
    HttpClient.retryTransient(),
    withObservability,
    HttpClient.transformResponse((effect) => Effect.timeoutFail(effect, { duration: Duration.seconds(30), onTimeout: () => new Error('HTTP timeout') })),
  );
});
```

### [6.5] Built-in Tracing Integration

```typescript
import { HttpClient, HttpClientRequest, FetchHttpClient } from '@effect/platform';
import { Effect } from 'effect';

// Built-in OpenTelemetry: auto-creates spans with http.* attributes
const TracedClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(
    HttpClient.withTracerDisabledWhen((req) => req.url.includes('/health')), // Skip health checks
    HttpClient.withTracerPropagation(true), // Inject W3C trace context headers
  );
});

// Span attributes auto-captured: http.request.method, http.response.status_code, server.address, url.full
```

### [6.6] Response Streaming & Binary

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform';
import { Chunk, Effect, pipe, Stream } from 'effect';

// Stream large response — back-pressure aware, no buffering
const streamDownload = (client: HttpClient.HttpClient, url: string) =>
  pipe(HttpClientRequest.get(url), client.execute, Effect.scoped, Effect.andThen((res) => Stream.runCollect(res.stream)), Effect.andThen(Chunk.toReadonlyArray));

// Binary response → ArrayBuffer
const binaryDownload = (client: HttpClient.HttpClient, url: string) =>
  pipe(HttpClientRequest.get(url), client.execute, Effect.scoped, Effect.andThen(HttpClientResponse.arrayBuffer));
```

### [6.7] Stateful Sessions (Cookies + Redirects)

```typescript
import { HttpClient, FetchHttpClient } from '@effect/platform';
import { Cookies } from '@effect/platform/Cookies';
import { Effect, Ref } from 'effect';

// Stateful cookie jar across requests
const SessionClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  const jar = yield* Ref.make(Cookies.empty);
  return base.pipe(
    HttpClient.withCookiesRef(jar), // Auto-send Cookie, auto-update Set-Cookie
    HttpClient.followRedirects(5), // Follow up to 5 3xx redirects
  );
});
```

---

## [7] ERROR HANDLING

### [7.1] Error Types

| Error | When |
|-------|------|
| `HttpClientError.RequestError` | Network failure, DNS, connection refused |
| `HttpClientError.ResponseError` | Non-2xx status (when using filterStatusOk) |
| `ParseError` | Schema validation failure on response |
| `HttpBodyError` | Body serialization failure on request |

### [7.2] Error Recovery Pattern

```typescript
import { HttpClientError } from '@effect/platform';
import { Effect, Match } from 'effect';

// Effect.catchTags: single call handles multiple tagged errors (no chaining)
const handleErrors = <A>(effect: Effect.Effect<A, HttpClientError.HttpClientError>) =>
  effect.pipe(
    Effect.catchTags({
      RequestError: (e) => Effect.fail(new ApiClientError({ reason: `Network error: ${e.message}`, cause: e })),
      ResponseError: (e) =>
        Match.value(e.response.status).pipe(
          Match.when(401, () => Effect.fail(new ApiClientError({ reason: 'Unauthorized', status: 401 }))),
          Match.when(403, () => Effect.fail(new ApiClientError({ reason: 'Forbidden', status: 403 }))),
          Match.when(404, () => Effect.fail(new ApiClientError({ reason: 'Not found', status: 404 }))),
          Match.when((s) => s >= 500, () => Effect.fail(new ApiClientError({ reason: 'Server error', status: e.response.status }))),
          Match.orElse(() => Effect.fail(new ApiClientError({ reason: 'Request failed', status: e.response.status }))),
        ),
    }),
  );
```

---

## [8] QUICK REFERENCE

### [8.1] Import Map

```typescript
import {
  HttpClient,           // Client service and combinators
  HttpClientError,      // Error types (RequestError, ResponseError)
  HttpClientRequest,    // Request construction
  HttpClientResponse,   // Response parsing
  HttpBody,             // Body types
  FetchHttpClient,      // Fetch-based layer
} from '@effect/platform';
```

### [8.2] Common Pipelines

```typescript
// GET with schema response — Effect.andThen auto-unwraps mixed types
pipe(
  HttpClientRequest.get('/api/data'),
  client.execute,
  Effect.scoped,
  Effect.andThen(HttpClientResponse.schemaBodyJson(DataSchema)),
);

// POST with schema body and response
pipe(
  HttpClientRequest.post('/api/data'),
  HttpClientRequest.schemaBodyJson(InputSchema)(inputData),
  Effect.andThen(client.execute),
  Effect.scoped,
  Effect.andThen(HttpClientResponse.schemaBodyJson(OutputSchema)),
);

// Authenticated request
pipe(
  HttpClientRequest.get('/api/protected'),
  HttpClientRequest.bearerToken(token),
  client.execute,
  Effect.scoped,
  Effect.andThen(HttpClientResponse.schemaBodyJson(DataSchema)),
);

// Streaming response — binary downloads, large payloads
pipe(
  HttpClientRequest.get('/api/large-file'),
  client.execute,
  Effect.scoped,
  Effect.andThen((res) => Stream.runCollect(res.stream)),
  Effect.andThen(Chunk.toReadonlyArray),
);
```

---

## [9] DON'T HAND-ROLL

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Status filtering | Manual `response.status === 200` | `HttpClient.filterStatusOk` / `filterStatus` |
| Retry logic | Custom retry loops | `HttpClient.retry(schedule)` / `retryTransient()` |
| Transient retry | 5xx/429 detection | `HttpClient.retryTransient()` — auto-detects transient |
| Request logging | Manual `console.log` | `HttpClient.tapRequest` / `tap` / `tapError` |
| Timeout wrapping | `setTimeout` wrapper | `HttpClient.transformResponse(Effect.timeoutFail)` |
| Base URL prepend | Manual string concat | `HttpClientRequest.prependUrl(base)` |
| Header setting | Manual object spread | `HttpClientRequest.setHeaders({...})` bulk call |
| JSON body | `JSON.stringify` | `HttpClientRequest.schemaBodyJson(schema)` |
| Response parsing | `JSON.parse` | `HttpClientResponse.schemaBodyJson(schema)` |
| Cookie management | Manual header parsing | `HttpClient.withCookiesRef(jar)` |
| Redirect following | Manual 3xx handling | `HttpClient.followRedirects(n)` |
| Tracing spans | Manual span creation | Built-in OTEL via `withTracerPropagation` |
| Error classification | instanceof chains | `Effect.catchTags({ RequestError, ResponseError })` |

---

## [10] REFERENCES

- [HttpClient API](https://effect-ts.github.io/effect/platform/HttpClient.ts.html)
- [HttpClientRequest API](https://effect-ts.github.io/effect/platform/HttpClientRequest.ts.html)
- [HttpClientResponse API](https://effect-ts.github.io/effect/platform/HttpClientResponse.ts.html)
- [FetchHttpClient API](https://effect-ts.github.io/effect/platform/FetchHttpClient.ts.html)

---

## Metadata

**Confidence:** HIGH — APIs verified against @effect/platform 0.94.2
**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days — stable APIs)
**Key patterns:** `Effect.andThen` over `flatMap`, `Effect.catchTags` over chained `catchTag`, `Clock.currentTimeMillis` over `Date.now()`
