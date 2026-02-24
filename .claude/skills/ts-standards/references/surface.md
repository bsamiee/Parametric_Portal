# [H1][SURFACE]
>**Dictum:** *HTTP contracts are declarative schemas; one definition serves server, client, and OpenAPI; implementation layers are separate from declaration.*

Cross-references: `errors.md [2]` (Schema.TaggedError), `services.md [2]` (scoped constructors), `composition.md [4]` (Layer merging).

`@effect/platform` HttpApi separates contract from implementation: declare groups and endpoints as typed schemas, implement via `HttpApiBuilder.group`, serve via `HttpApiBuilder.serve`. One definition drives server handlers, `HttpApiClient.make` typed client, and `HttpApiSwagger.layer` OpenAPI docs -- zero duplication.

---
## [1][HTTP_API_DECLARATION]
>**Dictum:** *Endpoint -> Group -> Api; each level scopes errors, middleware, and annotations.*

`HttpApiEndpoint` declares method + path + schema bindings. `HttpApiGroup` collects endpoints under a prefix with shared errors and middleware. `HttpApi.make` assembles groups into a root definition with global prefix and OpenApi annotations.

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema,
         Multipart, OpenApi } from "@effect/platform";
import { Schema as S } from "effect";
// --- [SCHEMA] ----------------------------------------------------------------

// Reusable query schemas -- extend at call site, never duplicate
const _CursorLimitQuery = S.Struct({
    cursor: S.optional(HttpApiSchema.param("cursor", S.String)),
    limit: S.optionalWith(
        HttpApiSchema.param("limit", S.NumberFromString.pipe(S.int(), S.between(1, 100))),
        { default: () => 20 },
    ),
});
const _TemporalQuery = S.extend(_CursorLimitQuery, S.Struct({
    after: S.optional(HttpApiSchema.param("after", S.DateFromString)),
    before: S.optional(HttpApiSchema.param("before", S.DateFromString)),
}));

// --- [GROUPS] ----------------------------------------------------------------

// Mixed-auth group: no group-level middleware; per-endpoint .middleware(AuthTag)
const _PublicGroup = HttpApiGroup.make("auth")
    .prefix("/v1/auth")
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get("oauthStart", "/oauth/:provider")
        .setPath(S.Struct({ provider: S.Literal("github", "google") }))
        .addSuccess(S.Struct({ url: S.String }))
        .addError(HttpError.OAuth)
        .annotate(OpenApi.Summary, "Start OAuth flow")
        .annotate(OpenApi.Description, "Initiates OAuth authorization for the specified provider."))
    .add(HttpApiEndpoint.post("login", "/login")
        .setPayload(S.Struct({ email: S.String, password: S.String }))
        .addSuccess(AuthResponse)
        .annotate(OpenApi.Summary, "Login with credentials"))
    .add(HttpApiEndpoint.del("logout", "/logout")
        .addSuccess(S.Void)
        .middleware(AuthMiddleware)
        .annotate(OpenApi.Summary, "End session"));

// Protected group: group-level middleware covers all endpoints
const _ResourceGroup = HttpApiGroup.make("resources")
    .prefix("/v1/resources")
    .middleware(AuthMiddleware)
    .addError(HttpError.Forbidden)
    .addError(HttpError.Internal)
    .addError(HttpError.RateLimit)
    .add(HttpApiEndpoint.get("list", "/")
        .setUrlParams(S.extend(_CursorLimitQuery, S.Struct({
            sort: S.optionalWith(
                HttpApiSchema.param("sort", S.Literal("asc", "desc")),
                { default: () => "desc" as const },
            ),
            type: S.optional(HttpApiSchema.param("type", S.NonEmptyTrimmedString)),
        })))
        .addSuccess(KeysetResponse(Resource.json))
        .annotate(OpenApi.Summary, "List resources"))
    .add(HttpApiEndpoint.get("getById", "/:id")
        .setPath(S.Struct({ id: S.UUID }))
        .addSuccess(Resource.json)
        .addError(HttpError.NotFound)
        .annotate(OpenApi.Summary, "Get resource by ID"))
    .add(HttpApiEndpoint.post("upload", "/upload")
        .setPayload(S.Struct({
            contentType: S.optional(S.String),
            file: Multipart.SingleFileSchema,
            key: S.optional(S.String),
        }))
        .addSuccess(S.Struct({ etag: S.String, key: S.String, size: S.Int }), { status: 201 })
        .addError(HttpError.Validation)
        .annotate(OpenApi.Summary, "Upload file"))
    .add(HttpApiEndpoint.del("archive", "/:id")
        .setPath(S.Struct({ id: S.UUID }))
        .addSuccess(S.Void)
        .addError(HttpError.NotFound)
        .annotate(OpenApi.Summary, "Archive resource"))
    .add(HttpApiEndpoint.get("subscribe", "/subscribe")
        .addSuccess(S.Void)
        .annotate(OpenApi.Summary, "SSE event stream")
        .annotate(OpenApi.Exclude, true));

// --- [ENTRY_POINT] -----------------------------------------------------------

const MyApi = HttpApi.make("MyApi")
    .add(_PublicGroup)
    .add(_ResourceGroup)
    .add(_AdminGroup.annotate(OpenApi.Exclude, true))
    .prefix("/api")
    .annotate(OpenApi.Identifier, "my-api")
    .annotate(OpenApi.Title, "My API")
    .annotate(OpenApi.Version, "1.0.0")
    .annotate(OpenApi.License, { name: "MIT", url: "https://opensource.org/licenses/MIT" })
    .annotate(OpenApi.ExternalDocs, { description: "Docs", url: "https://docs.example.dev" });
```

**Key distinctions:**
- `setPath` -- path params (`/:id`); schema fields must match route segments.
- `setUrlParams` -- query params (`?cursor=X&limit=20`); use `S.extend` to compose reusable query schemas.
- `setHeaders` -- typed header extraction; schema fields map to header names.
- `setPayload` -- JSON body (default) or multipart via `Multipart.SingleFileSchema`.
- `addSuccess(S.Void)` -- 204 no-content for SSE, WebSocket upgrade, fire-and-forget endpoints.
- `addSuccess(schema, { status: 201 })` -- non-default status; defaults are 200 success, 500 error.
- `OpenApi.Exclude` -- hide internal groups/endpoints from generated docs.

---
## [2][SECURITY_AND_MIDDLEWARE]
>**Dictum:** *Middleware is a typed tag with security schemes; HttpApiSecurity handles token extraction; handlers receive Redacted<string>.*

`HttpApiMiddleware.Tag` declares `failure` (typed error), `provides` (context tag), and `security` (auth scheme map). Each security scheme handler receives `Redacted<string>` -- no manual header parsing.

```typescript
import { HttpApiBuilder, HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { Effect, Layer, Redacted, Schema as S } from "effect";

// --- [MIDDLEWARE] ------------------------------------------------------------

class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()(
    "server/AuthMiddleware",
    {
        failure: S.Union(HttpError.Auth, HttpError.Forbidden, HttpError.Internal),
        security: {
            bearer: HttpApiSecurity.bearer,
            apiKey: HttpApiSecurity.apiKey({ key: "X-API-Key", in: "header" }),
        },
    },
) {}

// Implementation: handler per security scheme, token as Redacted<string>
const AuthMiddlewareLive = Layer.succeed(
    AuthMiddleware,
    AuthMiddleware.of({
        bearer: (token: Redacted.Redacted<string>) =>
            pipe(
                verifyJwt(Redacted.value(token)),
                Effect.mapError(() => HttpError.Auth.of("Invalid token")),
            ),
        apiKey: (token: Redacted.Redacted<string>) =>
            pipe(
                lookupApiKey(Redacted.value(token)),
                Effect.mapError(() => HttpError.Auth.of("Invalid API key")),
            ),
    }),
);
```

**Security schemes:**

| [INDEX] | [SCHEME]                              | [TOKEN_TYPE]            | [EXTRACTS_FROM]              |
| :-----: | ------------------------------------- | ----------------------- | ---------------------------- |
|   [1]   | `HttpApiSecurity.bearer`              | `Redacted<string>`      | `Authorization: Bearer <t>`  |
|   [2]   | `HttpApiSecurity.apiKey({ key, in })` | `Redacted<string>`      | Header, query, or cookie     |
|   [3]   | `HttpApiSecurity.basic`               | `Redacted<Credentials>` | `Authorization: Basic <b64>` |

**Attachment levels:**
- `.middleware(Tag)` on group -- all endpoints in group require auth.
- `.middleware(Tag)` on endpoint -- mixed-auth groups (public + protected in same group).

---
## [3][HANDLER_IMPLEMENTATION]
>**Dictum:** *HttpApiBuilder.group yields services via Effect.gen; handlers are thin adapters delegating to domain services via Middleware.resource DSL.*

`HttpApiBuilder.group(api, groupName, handlersFn)` produces a Layer. The builder receives typed `handlers` with `.handle(name, fn)` where `fn` receives `{ path, payload, urlParams, headers }` -- all typed from endpoint declaration. Return the domain value directly; the framework encodes via the success schema.

```typescript
import { HttpApiBuilder } from "@effect/platform";
import { Effect, Layer, Option, pipe } from "effect";

// --- [LAYERS] ----------------------------------------------------------------

const ResourceGroupLive = HttpApiBuilder.group(MyApi, "resources", (handlers) =>
    Effect.gen(function* () {
        const [database, audit] = yield* Effect.all([DatabaseService, AuditService]);
        const resources = Middleware.resource("resources");
        return handlers
            .handle("list", ({ urlParams }) =>
                resources.api("list", database.resources.page([], {
                    cursor: urlParams.cursor,
                    limit: urlParams.limit,
                })))
            .handle("getById", ({ path }) =>
                resources.api("getById", pipe(
                    database.resources.one([{ field: "id", value: path.id }]),
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(HttpError.NotFound.of("resource")),
                        onSome: Effect.succeed,
                    })),
                )))
            .handle("upload", ({ payload }) =>
                resources.mutation("upload", pipe(
                    storage.upload(payload.file, payload.key),
                    Effect.tap((result) => audit.log("Resource.create", {
                        subjectId: result.key,
                    })),
                )))
            .handle("archive", ({ path }) =>
                resources.mutation("archive", pipe(
                    database.resources.drop(path.id),
                    Effect.as(undefined),
                )));
    }),
).pipe(Layer.provide(AuthMiddlewareLive));
```

**Middleware.resource DSL** -- wraps every handler with permission check, rate limiting, telemetry span, and (for mutations) idempotency:

| [INDEX] | [METHOD]                                    | [PRESET]   | [INCLUDES]                                         |
| :-----: | ------------------------------------------- | ---------- | -------------------------------------------------- |
|   [1]   | `resource("name").api(action, effect)`      | `api`      | Permission + rate limit + span                     |
|   [2]   | `resource("name").mutation(action, effect)` | `mutation` | Permission + rate limit + span + idempotency check |
|   [3]   | `resource("name").realtime(action, effect)` | `realtime` | Permission + rate limit + span (no idempotency)    |

`handleRaw` -- returns raw `HttpServerResponse` instead of typed value; used for OAuth redirects and cookie-setting flows.

---
## [4][SERVER_COMPOSITION]
>**Dictum:** *serve() is the top-level Layer consuming API and middleware layers; pipeline transforms the app before serving.*

`HttpApiBuilder.serve(middleware?)` accepts an optional function `(app) => transformedApp` for global middleware (logging, tenant resolution, CORS). It consumes `HttpApiBuilder.api` and middleware layers via `Layer.provide`.

```typescript
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from "@effect/platform";
import { NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";

// --- [LAYERS] ----------------------------------------------------------------

// Api layer: compose all group implementations
const ApiLive = HttpApiBuilder.api(MyApi).pipe(
    Layer.provide([ResourceGroupLive, AuthGroupLive, AdminGroupLive]),
);

// Server layer: serve() at top, provide layers downward
HttpApiBuilder.serve((application) =>
    Middleware.pipeline(database, {
        tenantAsyncContextPrefixes: AsyncPrefixes,
        tenantExemptPrefixes: ExemptPrefixes,
    })(application).pipe(
        HttpMiddleware.logger,
    ),
).pipe(
    Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
    Layer.provide(ApiLive),
    Layer.provide(AuthMiddlewareLive),
    Layer.provide(HttpApiBuilder.middlewareCors({ allowedOrigins: corsOrigins })),
    HttpServer.withLogAddress,
    Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);
```

**Structural rule:** `serve()` is a top-level Layer that *consumes* API layers -- never place `HttpApiBuilder.serve()` inside `HttpApiBuilder.api().pipe(Layer.provide(...))`.

---
## [5][CLIENT_DERIVATION]
>**Dictum:** *One contract serves server and client -- HttpApiClient.make derives a fully-typed client from the same HttpApi definition.*

```typescript
import { HttpApiClient } from "@effect/platform";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect } from "effect";

const client = yield* HttpApiClient.make(MyApi, {
    baseUrl: "http://localhost:3000",
    transformClient: HttpClient.mapRequest(
        HttpClientRequest.bearerToken("my-token"),
    ),
});
// Fully typed: client.resources.list({ urlParams: { limit: 10 } })
// Fully typed: client.resources.getById({ path: { id: "..." } })
```

`HttpApiBuilder.toWebHandler(api)` returns `{ handler, dispose }` for testing or serverless contexts without starting a server.

---
## [6][RPC_AND_CLUSTER]
>**Dictum:** *RpcGroup declares procedures; toLayer implements; Entity wraps Rpc for distributed lifecycle.*

`Rpc.make` declares payload, success, error, and optional `stream: true`. `RpcGroup.make` groups procedures. `Entity.make` binds to a string type for distributed lifecycle. `Singleton.make` runs leader-elected background work.

```typescript
import { Entity, Singleton } from "@effect/cluster";
import { Rpc, RpcGroup, RpcServer, RpcSerialization } from "@effect/rpc";
import { Effect, Layer, Schedule, Schema as S, Stream } from "effect";

// --- [GROUPS] ----------------------------------------------------------------

const GetOrder = Rpc.make("getOrder", {
    error: OrderError,
    payload: { orderId: S.UUID },
    success: Order,
});
const WatchOrder = Rpc.make("watchOrder", {
    error: OrderError,
    payload: { orderId: S.UUID },
    stream: true,
    success: OrderEvent,
});
const OrderRpcGroup = RpcGroup.make(GetOrder, WatchOrder);

// --- [LAYERS] ----------------------------------------------------------------

const OrderRpcLive = OrderRpcGroup.toLayer(
    Effect.gen(function* () {
        const orders = yield* OrderService;
        return OrderRpcGroup.of({
            getOrder: ({ orderId }) => orders.findById(orderId),
            watchOrder: ({ orderId }) => orders.observe(orderId),
        });
    }),
);
const OrderRpcServerLive = Layer.mergeAll(
    OrderRpcLive,
    RpcServer.layerHttpRouter({ group: OrderRpcGroup, path: "/rpc/orders" }),
    RpcSerialization.layerMsgPack,
).pipe(Layer.provide(OrderService.Default));

// --- [ENTITY] ----------------------------------------------------------------

const OrderEntity = Entity.make("Order", [GetOrder, WatchOrder]);
const OrderEntityLive = OrderEntity.toLayer(
    Effect.gen(function* () {
        const orders = yield* OrderService;
        return OrderEntity.of({
            getOrder: ({ orderId }) => orders.findById(orderId),
            watchOrder: ({ orderId }) => orders.observe(orderId),
        });
    }),
);
// Client: entity.client yields (entityId) => typed RpcClient

// --- [SINGLETON] -------------------------------------------------------------

const DlqWatcherLive = Singleton.make(
    "dlq-watcher",
    pipe(
        dlq.pollAndReprocess,
        Effect.retry(Schedule.exponential("1 second")),
        Effect.catchAll(() => Effect.void),
        Effect.forever,
    ),
);
```

**Stream RPC:** When `stream: true`, the handler returns `Stream<Success, Error>` instead of `Effect`. Client receives a typed `Stream` on the consumer side.

---
## [7][OPENAPI_ANNOTATIONS]
>**Dictum:** *Annotations drive OpenAPI generation -- declare at endpoint, group, and API level.*

| [INDEX] | [ANNOTATION]           | [LEVEL]          | [PURPOSE]                             |
| :-----: | ---------------------- | ---------------- | ------------------------------------- |
|   [1]   | `OpenApi.Summary`      | Endpoint         | Short description in endpoint listing |
|   [2]   | `OpenApi.Description`  | Endpoint / Group | Long-form documentation               |
|   [3]   | `OpenApi.Title`        | Api              | API title in spec header              |
|   [4]   | `OpenApi.Version`      | Api              | API version string                    |
|   [5]   | `OpenApi.Identifier`   | Api              | Unique API identifier                 |
|   [6]   | `OpenApi.License`      | Api              | License name + URL                    |
|   [7]   | `OpenApi.ExternalDocs` | Api              | External documentation link           |
|   [8]   | `OpenApi.Exclude`      | Group / Endpoint | Hide from generated OpenAPI spec      |

Serve docs via `HttpApiSwagger.layer({ path: "/docs" })`. Serve raw `openapi.json` via `HttpApiBuilder.middlewareOpenApi()`.

---
## [8][RULES]

[ALWAYS]:
- Declare contracts (`HttpApiGroup`, `HttpApiEndpoint`) in a file separate from handler implementations.
- Use `S.TaggedError` for all errors crossing HTTP boundaries -- not `Data.TaggedError` (see `errors.md [2]`).
- Use `{ status: N }` on `addSuccess`/`addError` only when non-default (defaults: 200 success, 500 error).
- Use `setPath` for path params (`/:id`), `setUrlParams` for query params (`?cursor=X`).
- Use `HttpApiSchema.param(name, codec)` for path/query params requiring codec validation.
- Derive payload schemas inline via `S.pick`/`S.omit`/`S.extend` on canonical entity -- no separate schema classes.
- Use `S.Void` for fire-and-forget success (SSE, WebSocket upgrade, telemetry ingest).
- Use `Multipart.SingleFileSchema` inside `setPayload` for file upload endpoints.
- Use `HttpApiSecurity` on middleware tag with `security` field -- never raw `Context.GenericTag`.
- Use `Middleware.resource(name).api/mutation/realtime` for route-level middleware DSL.
- Implement handlers via `Effect.gen` that yields services -- never inline async logic.
- Provide `RpcSerialization.layerMsgPack` for binary transport in production RPC.
- Use `OpenApi.Exclude` on internal groups (admin, health, telemetry) and internal endpoints.
- Annotate endpoints with both `OpenApi.Summary` (short) and `OpenApi.Description` (long).

[NEVER]:
- Place `HttpApiBuilder.serve()` inside `HttpApiBuilder.api().pipe(...)` -- `serve()` is a top-level consumer.
- Return raw `HttpServerResponse` from typed handlers -- use `handleRaw` explicitly when needed.
- Use `any` in handler signatures -- let TypeScript derive from schema.
- Attach group-level `.middleware(Tag)` when only some endpoints need auth -- use per-endpoint instead.
- Proliferate schema classes for payloads -- derive via `S.pick`/`S.omit`/`S.partial` at call site.
- Share an `RpcGroup` between HTTP API routes and Cluster entities -- error semantics differ.

---
## [9][QUICK_REFERENCE]

| [INDEX] | [CONSTRUCT]                              | [PACKAGE]          | [USE_WHEN]                                            |
| :-----: | ---------------------------------------- | ------------------ | ----------------------------------------------------- |
|   [1]   | `HttpApi.make`                           | `@effect/platform` | Root API definition -- groups attach here             |
|   [2]   | `HttpApiGroup.make` + `.prefix`          | `@effect/platform` | Route namespace with shared errors and middleware     |
|   [3]   | `HttpApiEndpoint.get/post/put/patch/del` | `@effect/platform` | Single HTTP endpoint declaration                      |
|   [4]   | `HttpApiEndpoint.setPath`                | `@effect/platform` | Path params (`/:id`) with schema validation           |
|   [5]   | `HttpApiEndpoint.setUrlParams`           | `@effect/platform` | Query params (`?k=v`) with schema validation          |
|   [6]   | `HttpApiEndpoint.setHeaders`             | `@effect/platform` | Typed header extraction with schema                   |
|   [7]   | `HttpApiEndpoint.setPayload`             | `@effect/platform` | JSON body or multipart payload schema                 |
|   [8]   | `HttpApiSchema.param`                    | `@effect/platform` | Named path/query param with codec                     |
|   [9]   | `Multipart.SingleFileSchema`             | `@effect/platform` | Single file upload inside `setPayload`                |
|  [10]   | `S.Void`                                 | `effect`           | 204 no-content for SSE/WebSocket/fire-and-forget      |
|  [11]   | `HttpApiBuilder.group`                   | `@effect/platform` | Implement all handlers in a group as a Layer          |
|  [12]   | `HttpApiBuilder.api`                     | `@effect/platform` | Compose group layers into API layer                   |
|  [13]   | `HttpApiBuilder.serve(middleware?)`      | `@effect/platform` | Top-level Layer; optional pipeline transforms app     |
|  [14]   | `HttpApiBuilder.toWebHandler`            | `@effect/platform` | Non-server handler for testing/serverless             |
|  [15]   | `HttpApiBuilder.middlewareOpenApi`       | `@effect/platform` | Serves raw `openapi.json` endpoint                    |
|  [16]   | `HttpApiBuilder.middlewareCors`          | `@effect/platform` | CORS configuration layer                              |
|  [17]   | `HttpApiMiddleware.Tag`                  | `@effect/platform` | Typed middleware: `failure`, `provides`, `security`   |
|  [18]   | `HttpApiSecurity.bearer`                 | `@effect/platform` | Bearer token extraction (`Redacted<string>`)          |
|  [19]   | `HttpApiSecurity.apiKey({ key, in })`    | `@effect/platform` | API key from header/query/cookie (`Redacted<string>`) |
|  [20]   | `HttpApiSecurity.basic`                  | `@effect/platform` | Basic auth credentials (`Redacted<Credentials>`)      |
|  [21]   | `HttpApiSwagger.layer({ path? })`        | `@effect/platform` | Swagger UI at specified path                          |
|  [22]   | `HttpApiClient.make(api, options)`       | `@effect/platform` | Typed client derivation from same API definition      |
|  [23]   | `Middleware.resource(name)`              | workspace          | Route DSL: `.api` / `.mutation` / `.realtime`         |
|  [24]   | `OpenApi.Summary/Description/Exclude`    | `@effect/platform` | Endpoint-level OpenAPI annotations                    |
|  [25]   | `OpenApi.Title/Version/Identifier`       | `@effect/platform` | API-level OpenAPI metadata                            |
|  [26]   | `OpenApi.License/ExternalDocs`           | `@effect/platform` | API-level license and documentation links             |
|  [27]   | `Rpc.make`                               | `@effect/rpc`      | Typed RPC procedure: payload, success, error, stream  |
|  [28]   | `RpcGroup.make`                          | `@effect/rpc`      | Procedure namespace -- basis for Entity or server     |
|  [29]   | `RpcGroup.toLayer`                       | `@effect/rpc`      | Implement all handlers as a Layer                     |
|  [30]   | `RpcServer.layerHttpRouter`              | `@effect/rpc`      | Mount RpcGroup at HTTP path (WS or HTTP)              |
|  [31]   | `Entity.make`                            | `@effect/cluster`  | Distributed actor bound to Rpc definitions            |
|  [32]   | `Entity.client`                          | `@effect/cluster`  | `(entityId) => RpcClient` for entity messaging        |
|  [33]   | `Singleton.make`                         | `@effect/cluster`  | Leader-elected background effect (cron, DLQ)          |
