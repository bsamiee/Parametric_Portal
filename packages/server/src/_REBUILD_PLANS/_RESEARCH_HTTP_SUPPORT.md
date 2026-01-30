# @effect/platform HTTP Support Infrastructure

> Research: Body handling, middleware, multiplexing, distributed tracing.

---

## [1] HTTP BODY CONSTRUCTION

### [1.1] Core Type

`HttpBody` discriminated union: `Empty | Raw | Uint8Array | FormData | Stream`.

### [1.2] Constructors

```typescript
import { HttpBody, HttpBodyError } from "@effect/platform";

// --- [STRUCTURED] ------------------------------------------------------------
// Schema-validated JSON (recommended)
HttpBody.jsonSchema(schema)(body);  // Effect<HttpBody.Uint8Array, HttpBodyError, R>

// Unchecked JSON
HttpBody.json(body);                // Effect<HttpBody.Uint8Array, HttpBodyError>

// URL-encoded form
HttpBody.urlParams(params);         // HttpBody.Uint8Array

// UTF-8 text
HttpBody.text(body, contentType?);  // HttpBody.Uint8Array

// --- [STREAMING] -------------------------------------------------------------
// Chunked stream
HttpBody.stream(stream, contentType?, contentLength?);  // HttpBody.Stream

// Server file (requires FileSystem)
HttpBody.file(path, { contentType?, chunkSize? });      // Effect<HttpBody.Stream, PlatformError, FileSystem>

// Browser File/Blob
HttpBody.fileWeb(file);                                 // HttpBody.Stream

// --- [FORM_DATA] -------------------------------------------------------------
HttpBody.formData(nativeFormData);                      // HttpBody.FormData
HttpBody.formDataRecord({ key: stringOrBlob });         // HttpBody.FormData
```

### [1.3] Error Handling

```typescript
// HttpBodyError: JsonError | SchemaError
const makeJsonResponse = <A>(schema: Schema<A, unknown>) =>
  Effect.fn("makeJsonResponse")((data: A) =>
    HttpBody.jsonSchema(schema)(data).pipe(
      Effect.map(HttpServerResponse.fromBody)
    )
  );
```

---

## [2] HTTP INCOMING MESSAGE

### [2.1] Body Parsing

```typescript
import { HttpIncomingMessage, HttpServerRequest } from "@effect/platform";

// Interface methods on ServerRequest/ClientResponse
interface HttpIncomingMessage<E> {
  readonly json: Effect<unknown, E>;
  readonly text: Effect<string, E>;
  readonly urlParamsBody: Effect<UrlParams, E>;
  readonly arrayBuffer: Effect<ArrayBuffer, E>;
  readonly stream: Stream<Uint8Array, E>;
}

// --- [SCHEMA_PARSING] --------------------------------------------------------
const parseJsonBody = HttpIncomingMessage.schemaBodyJson(PayloadSchema);
const parseUrlParams = HttpIncomingMessage.schemaBodyUrlParams(ParamsSchema);
const parseHeaders = HttpIncomingMessage.schemaHeaders(HeadersSchema);

// Usage
const handler = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest;
  const payload = yield* req.pipe(parseJsonBody);  // Fully typed
});

// --- [SIZE_LIMITS] -----------------------------------------------------------
HttpIncomingMessage.withMaxBodySize(effect, "10mb");  // DoS prevention
```

---

## [3] HTTP METHOD

```typescript
import { HttpMethod } from "@effect/platform";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
type NoBody = "GET" | "HEAD" | "OPTIONS";
type WithBody = Exclude<HttpMethod, NoBody>;

HttpMethod.isHttpMethod("GET");   // true (case-sensitive)
HttpMethod.hasBody("POST");       // true
HttpMethod.all;                   // ReadonlySet<HttpMethod>
```

---

## [4] HTTP MIDDLEWARE

### [4.1] Pattern

```typescript
import { HttpMiddleware, HttpApp } from "@effect/platform";

// Transforms HttpApp -> HttpApp
const make = <E, R>(
  f: (app: HttpApp.Default<E, R>) => Effect<HttpServerResponse, E, R>
): Middleware => HttpMiddleware.make(f);
```

### [4.2] Built-in Middleware

```typescript
// --- [CORS] ------------------------------------------------------------------
HttpMiddleware.cors({
  allowedOrigins: ["https://app.example.com"],
  allowedMethods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
});

// --- [LOGGING] ---------------------------------------------------------------
HttpMiddleware.logger;
HttpMiddleware.withLoggerDisabled;  // Disable for specific requests

// --- [PROXY] -----------------------------------------------------------------
HttpMiddleware.xForwardedHeaders;   // Parse X-Forwarded-* headers

// --- [SEARCH_PARAMS] ---------------------------------------------------------
HttpMiddleware.searchParamsParser;  // Pre-parse query string
```

### [4.3] Custom Middleware

```typescript
// --- [TIMING] ----------------------------------------------------------------
const serverTiming = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const start = yield* Clock.currentTimeMillis;
    const response = yield* app;
    const duration = (yield* Clock.currentTimeMillis) - start;
    return HttpServerResponse.setHeader(response, "server-timing", `total;dur=${duration}`);
  })
);

// --- [SECURITY_HEADERS] ------------------------------------------------------
const security = (hsts: { maxAge: number; includeSubDomains?: boolean }) =>
  HttpMiddleware.make((app) =>
    app.pipe(Effect.map((res) =>
      HttpServerResponse.setHeaders(res, {
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "strict-transport-security": `max-age=${hsts.maxAge}${hsts.includeSubDomains ? "; includeSubDomains" : ""}`,
      })
    ))
  );

// --- [REQUEST_ID] ------------------------------------------------------------
const requestId = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const id = Option.getOrElse(Headers.get(req.headers, "x-request-id"), crypto.randomUUID);
    return yield* app.pipe(
      Effect.annotateLogs({ "request.id": id }),
      Effect.map((res) => HttpServerResponse.setHeader(res, "x-request-id", id))
    );
  })
);
```

### [4.4] Tracing Control

```typescript
// Customize span names
HttpMiddleware.withSpanNameGenerator((req) => `${req.method} ${new URL(req.url).pathname}`);

// Disable for health probes
HttpMiddleware.withTracerDisabledForUrls(["/health", "/ready", "/metrics"]);

// Predicate-based
HttpMiddleware.withTracerDisabledWhen((req) => req.url.startsWith("/internal/"));
```

### [4.5] Composition

```typescript
// Middleware composes via pipe (outer to inner)
const app = pipe(baseApp, cors, logger, xForwardedHeaders, security, timing);

// Layer-level for HttpApiBuilder
HttpApiBuilder.serve((app) => pipe(app, trace, security, logger));
```

---

## [5] HTTP TRACE CONTEXT

### [5.1] W3C Trace Propagation

```typescript
import { HttpTraceContext } from "@effect/platform";

// Extract from incoming headers
HttpTraceContext.fromHeaders(headers);  // Option<Tracer.ExternalSpan>

// Inject into outgoing headers
HttpTraceContext.toHeaders(span);       // Headers.Headers

// Formats: W3C (traceparent/tracestate), B3 (X-B3-*), X-B3 (single header)
```

### [5.2] Middleware Pattern

```typescript
const trace = HttpMiddleware.make((app) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const parent = HttpTraceContext.fromHeaders(req.headers);

    const response = yield* Option.match(parent, {
      onNone: () => Effect.withSpan(app, "http.request", {
        attributes: { "http.method": req.method, "http.target": req.url },
      }),
      onSome: (p) => Effect.withParentSpan(app, p),
    });

    const span = yield* Effect.optionFromOptional(Effect.currentSpan);
    return Option.match(span, {
      onNone: () => response,
      onSome: (s) => HttpServerResponse.setHeaders(response, HttpTraceContext.toHeaders(s)),
    });
  })
);
```

### [5.3] Outbound Propagation

```typescript
const callDownstream = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const span = yield* Effect.currentSpan;
  return yield* client.execute(
    HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeaders(HttpTraceContext.toHeaders(span))
    )
  );
});
```

---

## [6] HTTP MULTIPLEX

### [6.1] Routing Combinators

```typescript
import { HttpMultiplex } from "@effect/platform";

// --- [HOST_ROUTING] ----------------------------------------------------------
HttpMultiplex.empty.pipe(
  HttpMultiplex.hostExact("api.example.com", apiApp),
  HttpMultiplex.hostStartsWith("tenant-", tenantApp),
  HttpMultiplex.hostEndsWith(".internal", internalApp),
  HttpMultiplex.hostRegex(/^cdn-\d+\.example\.com$/, cdnApp),
);

// --- [HEADER_ROUTING] --------------------------------------------------------
HttpMultiplex.empty.pipe(
  HttpMultiplex.headerExact("x-api-version", "v2", v2App),
  HttpMultiplex.headerStartsWith("accept", "application/json", jsonApp),
  HttpMultiplex.headerRegex("authorization", /^Bearer /, authenticatedApp),
);

// --- [CUSTOM_PREDICATE] ------------------------------------------------------
HttpMultiplex.add(multiplex, (req) => req.url.startsWith("/ws"), wsApp);
```

### [6.2] WebSocket Upgrade

```typescript
const isWebSocketUpgrade = (req: HttpServerRequest.HttpServerRequest) =>
  pipe(
    Headers.get(req.headers, "upgrade"),
    Option.map((v) => v.toLowerCase() === "websocket"),
    Option.getOrElse(() => false)
  );

const withWebSocket = <E, R>(httpApp: HttpApp.Default<E, R>, wsApp: HttpApp.Default<E, R>) =>
  HttpMultiplex.empty.pipe(
    HttpMultiplex.add(isWebSocketUpgrade, wsApp),
    HttpMultiplex.add(() => true, httpApp),  // Fallback
  );
```

### [6.3] Error Handling

```typescript
// RouteNotFound when no predicate matches
// Always provide fallback
HttpMultiplex.add(multiplex, () => true, defaultApp);
```

---

## [7] HTTP PLATFORM

```typescript
import { HttpPlatform } from "@effect/platform";

interface HttpPlatform {
  readonly fileResponse: (path: string, options?: {
    status?: number; headers?: Headers; contentType?: string;
  }) => Effect<HttpServerResponse, PlatformError>;

  readonly fileWebResponse: (file: File | Blob, options?: {
    status?: number; headers?: Headers;
  }) => Effect<HttpServerResponse>;
}

// Layer provision
const PlatformLayer = HttpPlatform.layer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(Etag.layer),
);

// Static file serving
const serveStatic = (basePath: string) => Effect.gen(function* () {
  const platform = yield* HttpPlatform.HttpPlatform;
  const req = yield* HttpServerRequest.HttpServerRequest;
  return yield* platform.fileResponse(`${basePath}${new URL(req.url).pathname}`);
});
```

---

## [8] PRODUCTION STACK

```typescript
// Complete middleware composition
const ServerLayer = HttpApiBuilder.serve((app) =>
  pipe(
    app,
    traceMiddleware,                                    // [1] Trace propagation
    security({ maxAge: 31536000, includeSubDomains: true }),  // [2] Security headers
    serverTiming,                                       // [3] Server timing
    requestContext,                                     // [4] Request ID/tenant
    HttpMiddleware.logger,                              // [5] Logging (innermost)
  )
).pipe(Layer.provide(ApiLayer));

// Multiplex with WebSocket and versioning
const Multiplex = HttpMultiplex.empty.pipe(
  HttpMultiplex.add(isWebSocketUpgrade, WebSocketApp),
  HttpMultiplex.headerExact("x-api-version", "v2", ApiV2App),
  HttpMultiplex.hostStartsWith("api.", ApiApp),
  HttpMultiplex.add(() => true, DefaultApp),
);
```

---

## [9] REFERENCE

| Module | Key Exports | Purpose |
|--------|-------------|---------|
| `HttpBody` | `json`, `jsonSchema`, `stream`, `file`, `formData` | Response body construction |
| `HttpIncomingMessage` | `schemaBodyJson`, `schemaHeaders`, `withMaxBodySize` | Request body parsing |
| `HttpMethod` | `HttpMethod`, `isHttpMethod`, `hasBody` | Method type utilities |
| `HttpMiddleware` | `make`, `cors`, `logger`, `xForwardedHeaders` | Cross-cutting concerns |
| `HttpMultiplex` | `hostExact`, `headerExact`, `add` | Request routing/switching |
| `HttpPlatform` | `fileResponse`, `layer` | Platform file serving |
| `HttpTraceContext` | `fromHeaders`, `toHeaders` | W3C/B3 trace propagation |
