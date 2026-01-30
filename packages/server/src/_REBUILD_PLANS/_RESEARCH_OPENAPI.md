# @effect/platform OpenAPI Research

> **Version**: @effect/platform 0.94.2 | effect 3.19.15
> **Scope**: OpenAPI spec generation, schema annotations, security schemes

---

## [1] ARCHITECTURE OVERVIEW

```
HttpApi (contract) --> OpenApi.fromApi --> OpenAPISpec 3.1.0
      |                                          |
      v                                          v
HttpApiBuilder --> middlewareOpenApi --> /openapi.json
      |                                          v
HttpApiSwagger.layer -----------------> /docs (Swagger UI)
```

---

## [2] OpenApi.fromApi - SPEC GENERATION

```typescript
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "@effect/platform";
import { Schema as S } from "effect";

// Generate OpenAPI 3.1.0 spec from HttpApi instance
const spec: OpenAPISpec = OpenApi.fromApi(api, {
    additionalPropertiesStrategy: "strict", // "strict" | "allow" (default: "strict")
});
```

---

## [3] OpenApi ANNOTATIONS

### [3.1] API-Level Annotations

| Annotation | Type | Purpose |
|------------|------|---------|
| `OpenApi.Identifier` | `string` | Unique API identifier |
| `OpenApi.Title` | `string` | API title in spec |
| `OpenApi.Version` | `string` | API version (semver) |
| `OpenApi.Description` | `string` | Detailed API description |
| `OpenApi.License` | `{ name: string; url?: string }` | License information |
| `OpenApi.ExternalDocs` | `{ url: string; description?: string }` | External docs link |
| `OpenApi.Servers` | `Array<{ url: string; description?: string }>` | Server definitions |

```typescript
const Api = HttpApi.make("api")
    .annotate(OpenApi.Identifier, "parametric-portal-api")
    .annotate(OpenApi.Title, "Parametric Portal API")
    .annotate(OpenApi.Version, "1.0.0")
    .annotate(OpenApi.License, { name: "MIT", url: "https://opensource.org/licenses/MIT" })
    .annotate(OpenApi.ExternalDocs, { description: "Docs", url: "https://docs.parametric.dev" })
    .annotate(OpenApi.Servers, [
        { url: "https://api.parametric.dev", description: "Production" },
    ]);
```

### [3.2] Endpoint-Level Annotations

| Annotation | Type | Purpose |
|------------|------|---------|
| `OpenApi.Summary` | `string` | Short description (title in UI) |
| `OpenApi.Description` | `string` | Detailed documentation |
| `OpenApi.Deprecated` | `boolean` | Marks as deprecated |
| `OpenApi.Exclude` | `boolean` | Excludes from spec |
| `OpenApi.Override` | `Record<string, unknown>` | Raw spec override |
| `OpenApi.Transform` | `(spec) => spec` | Post-process spec |

```typescript
HttpApiEndpoint.post("createUser", "/")
    .setPayload(CreateUserSchema)
    .addSuccess(UserSchema)
    .addError(ValidationError)
    .annotate(OpenApi.Summary, "Create user")
    .annotate(OpenApi.Description, "Creates a new user. Requires admin role.")
    .annotate(OpenApi.Override, {
        requestBody: { content: { "application/json": { examples: { basic: { value: { name: "John" } } } } } },
    });

// Exclude internal endpoints
const HealthGroup = HttpApiGroup.make("health")
    .add(HttpApiEndpoint.get("liveness", "/liveness").addSuccess(S.Struct({ status: S.Literal("ok") })))
    .annotate(OpenApi.Exclude, true);
```

### [3.3] Bundled Annotations

```typescript
const apiAnnotations = OpenApi.annotations({
    identifier: "my-api",
    title: "My API",
    version: "1.0.0",
    description: "Production API",
    license: { name: "MIT" },
    externalDocs: { url: "https://docs.example.com" },
    servers: [{ url: "https://api.example.com" }],
});

const Api = HttpApi.make("api").add(UsersGroup).annotateContext(apiAnnotations);
```

---

## [4] SECURITY SCHEMES

### [4.1] HttpApiSecurity Primitives

```typescript
import { HttpApiSecurity } from "@effect/platform";

const bearerScheme = HttpApiSecurity.bearer;                                    // Authorization: Bearer <token>
const apiKeyHeader = HttpApiSecurity.apiKey({ key: "X-API-Key", in: "header" });
const apiKeyQuery = HttpApiSecurity.apiKey({ key: "api_key", in: "query" });
const apiKeyCookie = HttpApiSecurity.apiKey({ key: "session", in: "cookie" });
const basicScheme = HttpApiSecurity.basic;                                      // Authorization: Basic <base64>
```

### [4.2] Middleware with Security

```typescript
import { HttpApiMiddleware, HttpApiSecurity } from "@effect/platform";
import { Context, Effect, Layer, Redacted } from "effect";

interface AuthContext {
    readonly userId: string;
    readonly tenantId: string;
    readonly mfaVerified: boolean;
}

class AuthMiddleware extends HttpApiMiddleware.Tag<AuthMiddleware>()(
    "AuthMiddleware",
    {
        failure: AuthError,
        provides: Context.GenericTag<AuthContext>("AuthContext"),
        security: { bearer: HttpApiSecurity.bearer },
    },
) {}

const AuthMiddlewareLive = Layer.effect(
    AuthMiddleware,
    Effect.gen(function* () {
        const { bearer } = yield* AuthMiddleware;
        const token = Redacted.value(bearer);
        const session = yield* SessionService.validate(token);
        return { userId: session.userId, tenantId: session.tenantId, mfaVerified: session.mfaVerified };
    }),
);
```

### [4.3] Multiple Security Schemes (OR Logic)

```typescript
class FlexAuthMiddleware extends HttpApiMiddleware.Tag<FlexAuthMiddleware>()(
    "FlexAuthMiddleware",
    {
        failure: AuthError,
        provides: AuthContextTag,
        security: {
            bearer: HttpApiSecurity.bearer,
            apiKey: HttpApiSecurity.apiKey({ key: "X-API-Key", in: "header" }),
        },
    },
) {}
// OpenAPI generates: security: [{ bearer: [] }, { apiKey: [] }] (OR logic)
```

---

## [5] OpenApiJsonSchema

### [5.1] Schema to JSON Schema

```typescript
import { OpenApiJsonSchema } from "@effect/platform";
import { Schema as S } from "effect";

const UserSchema = S.Struct({ id: S.UUID, name: S.String, email: S.String });
const jsonSchema = OpenApiJsonSchema.make(UserSchema);

// Advanced configuration
const schema = OpenApiJsonSchema.makeWithDefs(UserSchema, {
    defs: { Address: addressJsonSchema },
    defsPath: "#/components/schemas/",
    topLevelReferenceStrategy: "skip",        // "skip" | "keep"
    additionalPropertiesStrategy: "strict",   // "strict" | "allow"
});
```

### [5.2] Schema Annotations for OpenAPI

```typescript
const UserSchema = S.Struct({
    id: S.UUID.annotations({ description: "Unique identifier", title: "User ID" }),
    name: S.String.pipe(S.minLength(1), S.maxLength(100)).annotations({
        description: "Display name",
        examples: ["John Doe"],
    }),
    email: S.String.annotations({ description: "Email address", format: "email" }),
    role: S.Literal("admin", "user").annotations({ description: "User role", default: "user" }),
}).annotations({ identifier: "User", title: "User", description: "User entity" });

// Branded types
const UserId = S.UUID.pipe(S.brand("UserId"));
const Email = S.String.pipe(S.pattern(/@/), S.brand("Email"));
```

---

## [6] HttpApiBuilder INTEGRATION

### [6.1] Swagger UI Setup

```typescript
import { HttpApiBuilder, HttpApiSwagger, HttpMiddleware, HttpServer } from "@effect/platform";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Layer } from "effect";
import { createServer } from "node:http";

const HandlersLayer = Layer.mergeAll(
    HttpApiBuilder.group(Api, "users", (handlers) =>
        handlers
            .handle("list", () => UserService.list())
            .handle("getById", ({ path }) => UserService.findById(path.id)),
    ),
);

const ApiLayer = HttpApiBuilder.api(Api).pipe(
    Layer.provide(HttpApiSwagger.layer({ path: "/docs" })),
    Layer.provide(HttpApiBuilder.middlewareOpenApi({ path: "/openapi.json" })),
    Layer.provide(HttpApiBuilder.middlewareCors({ allowedOrigins: ["*"] })),
    Layer.provide(AuthMiddlewareLive),
    Layer.provide(HandlersLayer),
);

const ServerLayer = HttpApiBuilder.serve((app) => app.pipe(HttpMiddleware.logger)).pipe(
    Layer.provide(ApiLayer),
    HttpServer.withLogAddress,
);

NodeRuntime.runMain(Layer.launch(ServerLayer.pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
)));
```

---

## [7] ERROR SCHEMAS

```typescript
import { HttpApiSchema } from "@effect/platform";
import { Schema as S } from "effect";

class NotFoundError extends S.TaggedError<NotFoundError>()("NotFoundError", {
    resource: S.String,
    id: S.String,
}) {}

class ValidationError extends S.TaggedError<ValidationError>()("ValidationError", {
    field: S.String,
    message: S.String,
}) {}

// Annotate with HTTP status codes
const NotFound = NotFoundError.pipe(HttpApiSchema.asHttpError(404), S.annotations({ description: "Not found" }));
const Validation = ValidationError.pipe(HttpApiSchema.asHttpError(400), S.annotations({ description: "Validation failed" }));

HttpApiEndpoint.post("create", "/")
    .setPayload(CreateSchema)
    .addSuccess(EntitySchema)
    .addError(Validation)   // 400
    .addError(NotFound);    // 404
```

---

## [8] PRODUCTION PATTERNS

### [8.1] Keyset Pagination

```typescript
const KeysetResponse = <T extends S.Schema.Any>(itemSchema: T) =>
    S.Struct({
        items: S.Array(itemSchema).annotations({ description: "Page of results" }),
        cursor: S.NullOr(S.String).annotations({ description: "Cursor for next page" }),
        hasNext: S.Boolean.annotations({ description: "More results available" }),
        total: S.Int.annotations({ description: "Total count" }),
    }).annotations({ identifier: `KeysetResponse`, description: "Pagination wrapper" });

HttpApiEndpoint.get("list", "/")
    .setUrlParams(PaginationQuery)
    .addSuccess(KeysetResponse(UserSchema))
    .annotate(OpenApi.Summary, "List with pagination");
```

### [8.2] Multipart Upload

```typescript
import { Multipart } from "@effect/platform";

const UploadRequest = S.Struct({
    file: Multipart.SingleFileSchema.annotations({ description: "File to upload" }),
    metadata: S.optional(S.String).annotations({ description: "Optional metadata" }),
});

HttpApiEndpoint.post("upload", "/upload")
    .setPayload(UploadRequest)
    .addSuccess(UploadResponse)
    .annotate(OpenApi.Summary, "Upload file");
```

### [8.3] Additional Schemas

```typescript
const PaginationMeta = S.Struct({
    page: S.Int,
    total: S.Int,
}).annotations({ identifier: "PaginationMeta" });

const additionalSchemas = Context.make(HttpApi.AdditionalSchemas, [PaginationMeta]);
const Api = HttpApi.make("api").add(UsersGroup).annotateContext(additionalSchemas);
```

---

## [9] OPENAPI OUTPUT STRUCTURE

```typescript
interface OpenAPISpec {
    openapi: "3.1.0";
    info: { title: string; version: string; description?: string; license?: { name: string; url?: string } };
    servers?: Array<{ url: string; description?: string }>;
    paths: Record<string, PathItem>;
    components: { schemas: Record<string, JsonSchema>; securitySchemes?: Record<string, SecurityScheme> };
    security?: Array<Record<string, string[]>>;
    tags: Array<{ name: string; description?: string }>;
    externalDocs?: { url: string; description?: string };
}

// Security scheme output
{
    "components": {
        "securitySchemes": {
            "bearer": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" },
            "apiKey": { "type": "apiKey", "in": "header", "name": "X-API-Key" }
        }
    },
    "security": [{ "bearer": [] }, { "apiKey": [] }]
}
```

---

## [10] REFERENCES

- [OpenApi.ts](https://effect-ts.github.io/effect/platform/OpenApi.ts.html)
- [OpenApiJsonSchema.ts](https://effect-ts.github.io/effect/platform/OpenApiJsonSchema.ts.html)
- [HttpApiBuilder.ts](https://effect-ts.github.io/effect/platform/HttpApiBuilder.ts.html)
- [HttpApiMiddleware.ts](https://effect-ts.github.io/effect/platform/HttpApiMiddleware.ts.html)
- [HttpApiSecurity.ts](https://effect-ts.github.io/effect/platform/HttpApiSecurity.ts.html)
- [HttpApiSwagger.ts](https://effect-ts.github.io/effect/platform/HttpApiSwagger.ts.html)
