# [H1][BACKEND_PLAN]
>**Dictum:** *Effect-native backend with per-app APIs and shared infrastructure.*

Unified backend architecture using Effect ecosystem: `@effect/platform-node` for HTTP, `@effect/sql-pg` for PostgreSQL.

---
## [1][ARCHITECTURE]

```
packages/
├── database/           # DONE: Client layer, Model.Class entities, branded IDs
└── server/             # HTTP infrastructure, middleware, errors, security

apps/
├── parametric_icons/   # Existing frontend (port 3001)
└── api/                # Backend API (port 4000)
    └── routes/         # Route handlers by domain
```

**Per-App API Pattern:** Each app gets a route namespace under unified `apps/api`. Shared infrastructure lives in packages.

**Topology:**
- `packages/database` — Connection layer, Model.Class entities, branded IDs (IMPLEMENTED)
- `packages/server` — HTTP middleware, errors, security, OpenAPI (TO BUILD)
- `apps/api` — Route handlers, SqlResolver usage, migrations (TO BUILD)

---
## [2][DEPENDENCIES]

Add to `pnpm-workspace.yaml` catalog:

```yaml
'@effect/platform': 0.94.0
'@effect/platform-node': 0.94.0
'@effect/opentelemetry': 0.49.0
```

[ALREADY IN CATALOG]:
- `@effect/sql`: 0.49.0
- `@effect/sql-pg`: 0.50.0
- `@effect/experimental`: 0.58.0
- `effect`: 3.19.13

---
## [3][PACKAGES/SERVER]

### [3.1][STRUCTURE]

```
packages/server/
├── src/
│   ├── api.ts          # HttpApi utilities, base API factories
│   ├── errors.ts       # Typed API error hierarchy
│   ├── middleware.ts   # CORS, logging, compression, rate limiting
│   ├── security.ts     # Auth middleware, API key validation
│   └── openapi.ts      # OpenAPI/Swagger generation
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### [3.2][API LAYER PATTERNS]

**Use @effect/platform HttpApi for declarative endpoint definitions:**

| API                                         | Purpose                         |
| ------------------------------------------- | ------------------------------- |
| `HttpApi.make(name)`                        | Create named API definition     |
| `HttpApiGroup.make(name)`                   | Group related endpoints         |
| `HttpApiEndpoint.get/post/put/del`          | Define endpoint with method     |
| `HttpApiEndpoint.setPayload(schema)`        | Request body validation         |
| `HttpApiEndpoint.addSuccess(schema)`        | Success response schema         |
| `HttpApiEndpoint.addError(error)`           | Error response schema           |
| `HttpApiBuilder.api(api)`                   | Build API Layer from definition |
| `HttpApiBuilder.group(api, name, handlers)` | Implement group handlers        |
| `HttpApiBuilder.serve()`                    | Create HTTP server from API     |

**Use HttpApiMiddleware for composable middleware:**

| Middleware                          | Purpose                        |
| ----------------------------------- | ------------------------------ |
| `HttpApiMiddleware.cors`            | CORS with configurable origins |
| `HttpApiMiddleware.logger`          | Request/response logging       |
| `HttpApiMiddleware.compression`     | Response compression           |
| `HttpApiMiddleware.securityHeaders` | Security headers               |

**Use HttpApiSecurity for authentication:**

| Security                 | Purpose                   |
| ------------------------ | ------------------------- |
| `HttpApiSecurity.apiKey` | API key header extraction |
| `HttpApiSecurity.bearer` | Bearer token extraction   |
| `HttpApiSecurity.basic`  | Basic auth extraction     |

### [3.3][ERROR HIERARCHY]

**Use Schema.TaggedError for typed errors:**

```typescript
import { Schema as S } from 'effect';

class NotFoundError extends S.TaggedError<NotFoundError>()('NotFoundError', {
    resource: S.String,
    id: S.String,
}) {}

class ValidationError extends S.TaggedError<ValidationError>()('ValidationError', {
    field: S.String,
    message: S.String,
}) {}

class UnauthorizedError extends S.TaggedError<UnauthorizedError>()('UnauthorizedError', {
    reason: S.String,
}) {}

class RateLimitError extends S.TaggedError<RateLimitError>()('RateLimitError', {
    retryAfterMs: S.Number,
}) {}
```

### [3.4][MIDDLEWARE COMPOSITION]

**B constant for all tuning parameters:**

```typescript
const B = Object.freeze({
    cors: {
        origins: ['*'],
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        headers: ['Content-Type', 'Authorization', 'X-API-Key'],
        maxAge: 86400,
    },
    rateLimit: {
        windowMs: 60000,
        maxRequests: 100,
    },
    compression: {
        threshold: 1024,
    },
} as const);
```

### [3.5][OPENAPI GENERATION]

**Use HttpApiSwagger for auto-generated docs:**

```typescript
import { HttpApiSwagger } from '@effect/platform';

const SwaggerLive = HttpApiSwagger.layer({
    path: '/docs',
    format: 'json',
});
```

---
## [4][APPS/API]

### [4.1][STRUCTURE]

```
apps/api/
├── src/
│   ├── main.ts         # Entry point with Layer composition
│   ├── api.ts          # HttpApi definition
│   ├── migrate.ts      # Migration runner
│   └── routes/
│       ├── health.ts   # Health endpoint
│       └── icons.ts    # Icon CRUD + generation
├── Dockerfile
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### [4.2][SQLRESOLVER USAGE]

**[CRITICAL] SqlResolver requires SqlClient in Effect scope — define inside Effect.gen, NOT at module level:**

```typescript
// CORRECT: Inside Effect.gen
Effect.gen(function* () {
    const resolver = yield* SqlResolver.findById('GetAssetById', {
        Id: AssetIdSchema,
        Result: Asset,
        ResultId: (a) => a.id,
        execute: (ids) => sql`SELECT * FROM assets WHERE ${sql.in('id', ids)}`,
    });
    return yield* resolver.execute(assetId);
});

// WRONG: Module level (no SqlClient in scope)
const resolver = SqlResolver.findById(...); // ERROR
```

**SqlResolver patterns:**

| Method                 | Returns            | Use Case                                |
| ---------------------- | ------------------ | --------------------------------------- |
| `SqlResolver.findById` | `Option<A>` per ID | Single entity lookup with batching      |
| `SqlResolver.grouped`  | `Array<A>` per key | N+1 prevention (e.g., assets by userId) |
| `SqlResolver.ordered`  | `A` per request    | Maintain request-result order           |
| `SqlResolver.void`     | `void`             | Side-effect operations                  |

### [4.3][SQLSCHEMA USAGE]

**Type-safe query wrappers with automatic validation:**

```typescript
import { SqlSchema } from '@effect/sql';

// Inside route handler
Effect.gen(function* () {
    const findAll = SqlSchema.findAll({
        Request: S.Struct({ limit: S.Number, offset: S.Number }),
        Result: Asset,
        execute: ({ limit, offset }) => sql`
            SELECT * FROM assets
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `,
    });

    return yield* findAll({ limit: 100, offset: 0 });
});
```

| Method              | Returns                | Use Case                                 |
| ------------------- | ---------------------- | ---------------------------------------- |
| `SqlSchema.findAll` | `Effect<readonly A[]>` | Paginated lists                          |
| `SqlSchema.findOne` | `Effect<Option<A>>`    | Optional single result                   |
| `SqlSchema.single`  | `Effect<A>`            | Exactly one result (throws if not found) |
| `SqlSchema.void`    | `Effect<void>`         | Insert/update/delete                     |

### [4.4][MODEL.CLASS INTEGRATION]

**Import from @parametric-portal/database/models:**

```typescript
import { Asset, User, ApiKey } from '@parametric-portal/database/models';

// Auto-generated variants available:
Asset           // Select schema (query results)
Asset.insert    // Insert schema (excludes Generated fields)
Asset.update    // Update schema
Asset.json      // API response (excludes Sensitive fields)
Asset.jsonCreate // API create payload
Asset.jsonUpdate // API update payload
```

### [4.5][LAYER COMPOSITION]

**Proper dependency injection via Layer:**

```typescript
const ApiLive = HttpApiBuilder.api(AppApi).pipe(
    Layer.provide(HealthLive),
    Layer.provide(IconsLive),
);

const ServerLive = HttpApiBuilder.serve().pipe(
    Layer.provide(ApiLive),
    Layer.provide(SwaggerLive),
    Layer.provide(PgLive),
    Layer.provide(NodeHttpServer.layer(createServer, { port: B.port })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
```

### [4.6][SQL STATEMENT HELPERS]

**Use @effect/sql built-in helpers (NO WRAPPING):**

| Helper               | Purpose                 |
| -------------------- | ----------------------- |
| `sql.in('col', ids)` | IN clause with array    |
| `sql.and([...])`     | AND multiple conditions |
| `sql.or([...])`      | OR multiple conditions  |
| `sql.insert(data)`   | Insert object/array     |
| `sql.update(data)`   | Update with SET clauses |
| `sql.literal(str)`   | Raw SQL (no escaping)   |
| `sql.csv([...])`     | Comma-separated values  |

---
## [5][DOCKER]

**.dockerignore (project root):**
```
node_modules
.git
*.md
dist
.nx
.claude
coverage
*.log
.env*
```

**apps/api/Dockerfile:**
```dockerfile
FROM node:22-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/database/package.json ./packages/database/
COPY packages/server/package.json ./packages/server/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec nx build @parametric-portal/api

FROM node:22-slim AS runtime
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
ENV NODE_ENV=production
EXPOSE 4000
USER node
CMD ["node", "dist/main.js"]
```

**docker-compose.yml (project root):**
```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: parametric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: runtime
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: parametric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

---
## [6][ENVIRONMENT]

**.env (project root):**
```
POSTGRES_PASSWORD=your_secure_password
ANTHROPIC_API_KEY=sk-ant-...
```

**apps/api/.env:**
```
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=parametric
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password
ANTHROPIC_API_KEY=sk-ant-...
API_PORT=4000
```

---
## [7][NX_TARGETS]

Add to `nx.json` targetDefaults:

```json
{
  "migrate": {
    "cache": false,
    "executor": "nx:run-commands",
    "options": {
      "command": "tsx src/migrate.ts",
      "cwd": "{projectRoot}"
    }
  },
  "start": {
    "cache": false,
    "dependsOn": ["build"],
    "executor": "nx:run-commands",
    "options": {
      "command": "node dist/main.js",
      "cwd": "{projectRoot}"
    }
  }
}
```

---
## [8][MIGRATIONS]

**Migrations live in apps/api, use @parametric-portal/database/client:**

```typescript
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { PgMigrator } from '@effect/sql-pg';
import { Effect, Layer } from 'effect';
import { PgLive } from '@parametric-portal/database/client';

const MigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem('./src/migrations'),
}).pipe(Layer.provide(PgLive), Layer.provide(NodeContext.layer));

Effect.gen(function* () {
    yield* Effect.log('[MIGRATE] Running migrations...');
}).pipe(Effect.provide(MigratorLive), NodeRuntime.runMain);
```

**Migration file pattern:**
```typescript
// src/migrations/0001_init.ts
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt TEXT NOT NULL,
    svg TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);
```

---
## [9][IMPLEMENTATION_STEPS]

| [STEP] | [ACTION]                     | [COMMAND]                                      |
| ------ | ---------------------------- | ---------------------------------------------- |
| 1      | Add platform deps to catalog | Edit `pnpm-workspace.yaml`                     |
| 2      | Create `packages/server`     | `mkdir -p packages/server/src`                 |
| 3      | Create `apps/api`            | `mkdir -p apps/api/src/routes`                 |
| 4      | Install dependencies         | `pnpm install`                                 |
| 5      | Build packages               | `pnpm exec nx build @parametric-portal/server` |
| 6      | Start PostgreSQL             | `docker compose up postgres -d`                |
| 7      | Run migrations               | `pnpm exec nx migrate @parametric-portal/api`  |
| 8      | Start API                    | `pnpm exec nx dev @parametric-portal/api`      |
