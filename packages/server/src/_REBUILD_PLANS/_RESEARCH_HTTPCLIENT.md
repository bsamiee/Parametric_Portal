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
| `execute` | `(req) => Effect<Response, HttpClientError, HttpClient>` | Send request |
| `filterStatusOk` | `(client) => HttpClient.With<E \| ResponseError, R>` | Accept 2xx only |
| `filterStatus` | `(f: (status: number) => boolean) => ...` | Custom status filter |
| `mapRequest` | `(f: (req) => req) => (client) => client` | Transform outgoing request |
| `mapRequestEffect` | `(f: (req) => Effect<req>) => ...` | Effectful request transform |
| `transform` | `(f: (effect, req) => Effect) => ...` | Full middleware wrap |
| `retry` | `(schedule) => (client) => client` | Retry with schedule |
| `retryTransient` | `(options) => (client) => client` | Retry 5xx/network errors |

### [2.2] Service Access and Client Pipeline

```typescript
import { HttpClient, HttpClientRequest, FetchHttpClient } from "@effect/platform";
import { Effect, Schedule } from "effect";

const apiClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.example.com")),
    HttpClient.mapRequest(HttpClientRequest.setHeader("User-Agent", "MyApp/1.0")),
    HttpClient.retry(Schedule.exponential("100 millis").pipe(Schedule.intersect(Schedule.recurs(3)))),
  );
});
```

---

## [3] HTTPCLIENTREQUEST

### [3.1] Constructor Functions

```typescript
import { HttpClientRequest } from "@effect/platform";

HttpClientRequest.get("https://api.example.com/users");
HttpClientRequest.post("https://api.example.com/users");
HttpClientRequest.put("https://api.example.com/users/123");
HttpClientRequest.patch("https://api.example.com/users/123");
HttpClientRequest.del("https://api.example.com/users/123");
HttpClientRequest.head("https://api.example.com/users");
HttpClientRequest.options("https://api.example.com/users");
```

### [3.2] Headers and Authentication

```typescript
import { Redacted } from "effect";

const request = HttpClientRequest.get("/api/data").pipe(
  HttpClientRequest.setHeader("X-Request-ID", "abc-123"),
  HttpClientRequest.setHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
  HttpClientRequest.acceptJson,
  HttpClientRequest.bearerToken(Redacted.make("secret-token")),
  // OR: HttpClientRequest.basicAuth("username", Redacted.make("password")),
);
```

### [3.3] URL Construction

```typescript
const request = HttpClientRequest.get("/users").pipe(
  HttpClientRequest.prependUrl("https://api.example.com"),
  HttpClientRequest.appendUrl("/active"),
  HttpClientRequest.setUrlParams({ page: "1", limit: "20", sort: "name" }),
  HttpClientRequest.appendUrlParams({ filter: "active" }),
);
// Result: https://api.example.com/users/active?page=1&limit=20&sort=name&filter=active
```

### [3.4] Body Configuration

```typescript
import { HttpClientRequest } from "@effect/platform";
import { Schema as S } from "effect";

// JSON body (returns Effect<HttpClientRequest, HttpBodyError>)
const jsonRequest = HttpClientRequest.post("/api/users").pipe(
  HttpClientRequest.bodyJson({ name: "John", email: "john@example.com" }),
);

// Unsafe JSON (synchronous, throws on failure)
const unsafeJson = HttpClientRequest.post("/api/users").pipe(
  HttpClientRequest.bodyUnsafeJson({ name: "John" }),
);

// Text/binary body
HttpClientRequest.bodyText("<xml>data</xml>", "application/xml");
HttpClientRequest.bodyUint8Array(new Uint8Array([1, 2, 3]), "application/octet-stream");
HttpClientRequest.bodyFormData(new FormData());

// Schema-validated body (returns Effect<HttpClientRequest, ParseError | HttpBodyError>)
const CreateUserSchema = S.Struct({ name: S.String.pipe(S.minLength(1)), email: S.String });
const encodeBody = HttpClientRequest.schemaBodyJson(CreateUserSchema);
const validatedRequest = HttpClientRequest.post("/api/users").pipe(encodeBody({ name: "John", email: "j@e.com" }));
```

---

## [4] HTTPCLIENTRESPONSE

### [4.1] Raw Response Access

```typescript
import { HttpClientResponse } from "@effect/platform";

const handleResponse = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const status: number = response.status;
    const contentType = response.headers["content-type"];
    const textBody: string = yield* HttpClientResponse.text(response);
    const jsonBody: unknown = yield* HttpClientResponse.json(response);
    const arrayBuffer: ArrayBuffer = yield* HttpClientResponse.arrayBuffer(response);
  });
```

### [4.2] Schema-Validated Parsing

```typescript
import { HttpClientResponse } from "@effect/platform";
import { Schema as S } from "effect";

// Response body schema
const UserSchema = S.Struct({ id: S.Number, name: S.String, email: S.String, createdAt: S.DateFromString });
const parseUser = HttpClientResponse.schemaBodyJson(UserSchema);
// Usage: parseUser(response) => Effect<User, ParseError>

// URL-encoded response (OAuth tokens)
const TokenSchema = S.Struct({ access_token: S.String, token_type: S.String, expires_in: S.optional(S.NumberFromString) });
const parseToken = HttpClientResponse.schemaBodyUrlParams(TokenSchema);

// Header-only validation
const RateLimitSchema = S.Struct({ "x-ratelimit-limit": S.NumberFromString, "x-ratelimit-remaining": S.NumberFromString });
const parseRateLimits = HttpClientResponse.schemaHeaders(RateLimitSchema);

// Full response validation (status + headers + body)
const FullResponseSchema = S.Struct({
  status: S.Literal(200, 201),
  headers: S.Struct({ "content-type": S.String }),
  body: S.Struct({ data: S.Array(UserSchema) }),
});
const parseFullResponse = HttpClientResponse.schemaJson(FullResponseSchema);
```

---

## [5] FETCHHTTPCLIENT

### [5.1] Layer Composition

```typescript
import { FetchHttpClient, HttpClient } from "@effect/platform";
import { Effect, Layer } from "effect";

// Basic usage
const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
});
Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));

// Custom fetch options
const customFetchLayer = Layer.succeed(FetchHttpClient.RequestInit, FetchHttpClient.RequestInit.of({
  credentials: "include",
  mode: "cors",
  cache: "no-store",
}));
const clientLayer = FetchHttpClient.layer.pipe(Layer.provide(customFetchLayer));
```

---

## [6] PRODUCTION PATTERNS

### [6.1] Typed API Client Service

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform";
import { Effect, Schema as S, pipe } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const UserSchema = S.Struct({ id: S.Number, name: S.String, email: S.String });
type User = typeof UserSchema.Type;

const CreateUserSchema = S.Struct({ name: S.String.pipe(S.minLength(1)), email: S.String });
type CreateUser = typeof CreateUserSchema.Type;

// --- [ERRORS] ----------------------------------------------------------------

class ApiClientError extends S.TaggedError<ApiClientError>()("ApiClientError", {
  reason: S.String,
  status: S.optional(S.Number),
  cause: S.optional(S.Unknown),
}) {}

// --- [SERVICE] ---------------------------------------------------------------

class UsersApiClient extends Effect.Service<UsersApiClient>()("UsersApiClient", {
  effect: Effect.gen(function* () {
    const baseClient = yield* HttpClient.HttpClient;
    const client = baseClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.mapRequest(HttpClientRequest.prependUrl("https://api.example.com")),
      HttpClient.mapRequest(HttpClientRequest.setHeader("User-Agent", "MyApp/1.0")),
    );

    const parseUser = HttpClientResponse.schemaBodyJson(UserSchema);
    const encodeCreateUser = HttpClientRequest.schemaBodyJson(CreateUserSchema);

    return {
      getById: (id: number) =>
        pipe(
          HttpClientRequest.get(`/users/${id}`),
          client.execute,
          Effect.scoped,
          Effect.flatMap(parseUser),
          Effect.mapError((e) => new ApiClientError({ reason: "Failed to fetch user", cause: e })),
        ),

      create: (user: CreateUser) =>
        pipe(
          HttpClientRequest.post("/users"),
          encodeCreateUser(user),
          Effect.flatMap(client.execute),
          Effect.scoped,
          Effect.flatMap(parseUser),
          Effect.mapError((e) => new ApiClientError({ reason: "Failed to create user", cause: e })),
        ),
    };
  }),
  dependencies: [FetchHttpClient.layer],
}) {}
```

### [6.2] OAuth Token Exchange

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform";
import { Effect, Schema as S, Redacted } from "effect";

const TokenResponseSchema = S.Struct({
  access_token: S.String,
  token_type: S.String,
  expires_in: S.optional(S.Number),
  refresh_token: S.optional(S.String),
});

const exchangeAuthorizationCode = (
  tokenUrl: string,
  clientId: string,
  clientSecret: Redacted.Redacted<string>,
  code: string,
  redirectUri: string,
) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);

    const formData = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: Redacted.value(clientSecret),
      code,
      redirect_uri: redirectUri,
    });

    const request = HttpClientRequest.post(tokenUrl).pipe(
      HttpClientRequest.setHeader("Content-Type", "application/x-www-form-urlencoded"),
      HttpClientRequest.bodyText(formData.toString()),
    );

    const response = yield* client.execute(request).pipe(Effect.scoped);
    return yield* HttpClientResponse.schemaBodyJson(TokenResponseSchema)(response);
  }).pipe(Effect.provide(FetchHttpClient.layer));
```

### [6.3] GitHub API (From Codebase oauth.ts)

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "@effect/platform";
import { Effect, Schema as S } from "effect";

const GitHubUserSchema = S.Struct({
  id: S.Number,
  login: S.String,
  email: S.NullishOr(S.String),
  avatar_url: S.String,
});

const fetchGitHubUser = (accessToken: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const request = HttpClientRequest.get("https://api.github.com/user").pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "MyApp/1.0",
        Accept: "application/vnd.github+json",
      }),
    );
    const response = yield* client.execute(request).pipe(Effect.scoped);
    return yield* HttpClientResponse.schemaBodyJson(GitHubUserSchema)(response);
  }).pipe(Effect.provide(FetchHttpClient.layer));
```

### [6.4] Middleware Transform Pattern

```typescript
import { HttpClient } from "@effect/platform";
import { Effect, Duration } from "effect";

const withLogging = <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
  HttpClient.transform((effect, request) =>
    Effect.gen(function* () {
      const start = Date.now();
      yield* Effect.logDebug(`HTTP ${request.method} ${request.url}`);
      const response = yield* effect;
      yield* Effect.logDebug(`HTTP ${response.status} ${Date.now() - start}ms`);
      return response;
    }),
  )(client);

const withTimeout = (duration: Duration.DurationInput) =>
  <E, R>(client: HttpClient.HttpClient.With<E, R>) =>
    HttpClient.transform((effect, _request) => Effect.timeout(effect, duration))(client);

// Composition
const configuredClient = Effect.gen(function* () {
  const base = yield* HttpClient.HttpClient;
  return base.pipe(HttpClient.filterStatusOk, withLogging, withTimeout(Duration.seconds(30)));
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
import { HttpClientError } from "@effect/platform";
import { Effect, Match } from "effect";

const handleErrors = <A>(effect: Effect.Effect<A, HttpClientError.HttpClientError>) =>
  effect.pipe(
    Effect.catchTag("RequestError", (e) =>
      Effect.fail(new ApiClientError({ reason: `Network error: ${e.message}`, cause: e })),
    ),
    Effect.catchTag("ResponseError", (e) =>
      Match.value(e.response.status).pipe(
        Match.when(401, () => Effect.fail(new ApiClientError({ reason: "Unauthorized", status: 401 }))),
        Match.when(403, () => Effect.fail(new ApiClientError({ reason: "Forbidden", status: 403 }))),
        Match.when(404, () => Effect.fail(new ApiClientError({ reason: "Not found", status: 404 }))),
        Match.when((s) => s >= 500, () => Effect.fail(new ApiClientError({ reason: "Server error", status: e.response.status }))),
        Match.orElse(() => Effect.fail(new ApiClientError({ reason: "Request failed", status: e.response.status }))),
      ),
    ),
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
} from "@effect/platform";
```

### [8.2] Common Pipelines

```typescript
// GET with schema response
pipe(
  HttpClientRequest.get("/api/data"),
  client.execute,
  Effect.scoped,
  Effect.flatMap(HttpClientResponse.schemaBodyJson(DataSchema)),
);

// POST with schema body and response
pipe(
  HttpClientRequest.post("/api/data"),
  HttpClientRequest.schemaBodyJson(InputSchema)(inputData),
  Effect.flatMap(client.execute),
  Effect.scoped,
  Effect.flatMap(HttpClientResponse.schemaBodyJson(OutputSchema)),
);

// Authenticated request
pipe(
  HttpClientRequest.get("/api/protected"),
  HttpClientRequest.bearerToken(token),
  client.execute,
  Effect.scoped,
  Effect.flatMap(HttpClientResponse.schemaBodyJson(DataSchema)),
);
```

---

## [9] REFERENCES

- [HttpClient API](https://effect-ts.github.io/effect/platform/HttpClient.ts.html)
- [HttpClientRequest API](https://effect-ts.github.io/effect/platform/HttpClientRequest.ts.html)
- [HttpClientResponse API](https://effect-ts.github.io/effect/platform/HttpClientResponse.ts.html)
- [FetchHttpClient API](https://effect-ts.github.io/effect/platform/FetchHttpClient.ts.html)
