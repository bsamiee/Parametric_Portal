# [H1][BACKEND_PLAN]
>**Dictum:** *Effect-native backend with per-app APIs and shared infrastructure.*

Unified backend architecture using Effect ecosystem: `@effect/platform-node` for HTTP, `@effect/sql-pg` for PostgreSQL.

---
## [1][ARCHITECTURE]

```
packages/
├── database/           # Schema types, client layer, migrations
└── server/             # HTTP middleware, errors, shared layers

apps/
├── parametric_icons/   # Existing frontend (port 3001)
└── api/                # Backend API (port 4000)
    └── routes/         # Route handlers by domain
```

**Per-App API Pattern:** Each app gets a route namespace under unified `apps/api`. Shared infrastructure lives in packages.

---
## [2][DEPENDENCIES]

Add to `pnpm-workspace.yaml` catalog:

```yaml
'@effect/platform-node': 0.96.3
'@effect/sql': 0.44.4
'@effect/sql-pg': 0.46.2
```

[IMPORTANT]:
- `@effect/sql-pg` uses `postgres.js` internally — no separate driver dependency needed.
- Versions must align with `effect: 3.19.9` in existing catalog.
- `tsx` already in catalog (`4.20.6`) for dev/migrate scripts.

---
## [3][PACKAGES]

### [3.1][packages/database]

```
packages/database/
├── src/
│   ├── schema.ts       # Branded types, validation schemas
│   ├── client.ts       # PgClient layer
│   └── migrations/     # Versioned SQL migrations
│       └── 0001_init.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**package.json:**
```json
{
    "name": "@parametric-portal/database",
    "version": "0.1.0",
    "type": "module",
    "exports": {
        "./schema": {
            "types": "./src/schema.ts",
            "import": "./src/schema.ts",
            "default": "./src/schema.ts"
        },
        "./client": {
            "types": "./src/client.ts",
            "import": "./src/client.ts",
            "default": "./src/client.ts"
        }
    },
    "dependencies": {
        "@effect/schema": "catalog:",
        "@effect/sql": "catalog:",
        "@effect/sql-pg": "catalog:",
        "effect": "catalog:"
    },
    "devDependencies": {
        "typescript": "catalog:",
        "vite": "catalog:",
        "vitest": "catalog:"
    },
    "scripts": {
        "build": "vite build",
        "check": "biome check .",
        "test": "vitest run --passWithNoTests",
        "typecheck": "tsc --project tsconfig.json --noEmit"
    }
}
```

**src/schema.ts:**
```typescript
/** Provides branded domain types and validation schemas for database entities. */
import { Schema as S } from '@effect/schema';

// --- [TYPES] -----------------------------------------------------------------

const AssetId = S.String.pipe(S.brand('AssetId'));
type AssetId = typeof AssetId.Type;

const UserId = S.String.pipe(S.brand('UserId'));
type UserId = typeof UserId.Type;

// --- [SCHEMA] ----------------------------------------------------------------

const Asset = S.Struct({
  id: AssetId,
  userId: S.NullOr(UserId),
  prompt: S.String,
  svg: S.String,
  metadata: S.NullOr(S.Struct({ colorMode: S.String, intent: S.String })),
  createdAt: S.DateFromString,
});
type Asset = typeof Asset.Type;

const User = S.Struct({
  id: UserId,
  email: S.String,
  apiKeyHash: S.NullOr(S.String),
  createdAt: S.DateFromString,
});
type User = typeof User.Type;

const ApiKey = S.Struct({
  id: S.String,
  userId: UserId,
  keyHash: S.String,
  name: S.String,
  lastUsedAt: S.NullOr(S.DateFromString),
  expiresAt: S.NullOr(S.DateFromString),
  createdAt: S.DateFromString,
});
type ApiKey = typeof ApiKey.Type;

// --- [EXPORT] ----------------------------------------------------------------

export { ApiKey, Asset, AssetId, User, UserId };
```

**src/client.ts:**
```typescript
/** Provides PostgreSQL client layer with connection pooling via @effect/sql-pg. */
import { PgClient } from '@effect/sql-pg';
import { Config } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    pool: { max: 10, idleTimeout: '30 seconds', connectTimeout: '5 seconds' },
} as const);

// --- [LAYERS] ----------------------------------------------------------------

const PgLive = PgClient.layerConfig({
    database: Config.string('POSTGRES_DB').pipe(Config.withDefault('parametric')),
    host: Config.string('POSTGRES_HOST').pipe(Config.withDefault('localhost')),
    password: Config.redacted('POSTGRES_PASSWORD'),
    port: Config.number('POSTGRES_PORT').pipe(Config.withDefault(5432)),
    username: Config.string('POSTGRES_USER').pipe(Config.withDefault('postgres')),
    maxConnections: Config.succeed(B.pool.max),
    idleTimeout: Config.succeed(B.pool.idleTimeout),
    connectTimeout: Config.succeed(B.pool.connectTimeout),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as DATABASE_TUNING, PgLive };
```

**src/migrations/0001_init.ts:**
```typescript
/** Initial database schema migration: users, assets, api_keys tables. */
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

// --- [MIGRATION] -------------------------------------------------------------

export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  CREATE EXTENSION IF NOT EXISTS "pgcrypto";

  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    api_key_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    svg TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX idx_assets_user_id ON assets(user_id);
  CREATE INDEX idx_assets_created_at ON assets(created_at DESC);
  CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
`);
```

**vite.config.ts:**
```typescript
/** Configure Vite library build for @parametric-portal/database package. */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                client: './src/client.ts',
                schema: './src/schema.ts',
            },
            external: ['effect', '@effect/schema', '@effect/sql', '@effect/sql-pg'],
            mode: 'library',
            name: 'ParametricDatabase',
        }),
    ) as UserConfig,
);
```

**tsconfig.json:**
```json
{
    "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "tsBuildInfoFile": "../../.nx/cache/tsbuildinfo/database.tsbuildinfo"
    },
    "exclude": ["dist", "node_modules"],
    "extends": "../../tsconfig.base.json",
    "include": ["src/**/*"],
    "references": []
}
```

---

### [3.2][packages/server]

```
packages/server/
├── src/
│   ├── errors.ts       # API error types
│   └── middleware.ts   # CORS, logging middleware
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**package.json:**
```json
{
    "name": "@parametric-portal/server",
    "version": "0.1.0",
    "type": "module",
    "exports": {
        "./errors": {
            "types": "./src/errors.ts",
            "import": "./src/errors.ts",
            "default": "./src/errors.ts"
        },
        "./middleware": {
            "types": "./src/middleware.ts",
            "import": "./src/middleware.ts",
            "default": "./src/middleware.ts"
        }
    },
    "dependencies": {
        "@effect/platform": "catalog:",
        "@effect/platform-node": "catalog:",
        "@effect/schema": "catalog:",
        "effect": "catalog:"
    },
    "devDependencies": {
        "typescript": "catalog:",
        "vite": "catalog:",
        "vitest": "catalog:"
    },
    "scripts": {
        "build": "vite build",
        "check": "biome check .",
        "test": "vitest run --passWithNoTests",
        "typecheck": "tsc --project tsconfig.json --noEmit"
    }
}
```

**src/errors.ts:**
```typescript
/** Provides API error types for HTTP endpoints. */
import { HttpApiError } from '@effect/platform';
import { Schema as S } from '@effect/schema';

// --- [TYPES] -----------------------------------------------------------------

class ApiError extends S.TaggedError<ApiError>()('ApiError', {
  code: S.Number,
  message: S.String,
  details: S.optional(S.Unknown),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ApiError, HttpApiError };
```

**src/middleware.ts:**
```typescript
/** Provides CORS and logging middleware for HTTP API endpoints. */
import { HttpMiddleware } from '@effect/platform';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
  cors: {
    headers: 'Content-Type, Authorization, X-API-Key',
    methods: 'GET, POST, PUT, DELETE, OPTIONS',
    origin: '*',
  },
} as const);

// --- [MIDDLEWARE] ------------------------------------------------------------

const corsMiddleware = HttpMiddleware.cors({ allowedOrigins: [B.cors.origin] });

const loggerMiddleware = HttpMiddleware.logger;

// --- [EXPORT] ----------------------------------------------------------------

export { B as SERVER_TUNING, corsMiddleware, loggerMiddleware };
```

**vite.config.ts:**
```typescript
/** Configure Vite library build for @parametric-portal/server package. */
import { Effect } from 'effect';
import type { UserConfig } from 'vite';
import { defineConfig } from 'vite';
import { createConfig } from '../../vite.factory.ts';

// --- [ENTRY_POINT] -----------------------------------------------------------

export default defineConfig(
    Effect.runSync(
        createConfig({
            entry: {
                errors: './src/errors.ts',
                middleware: './src/middleware.ts',
            },
            external: ['effect', '@effect/schema', '@effect/platform', '@effect/platform-node'],
            mode: 'library',
            name: 'ParametricServer',
        }),
    ) as UserConfig,
);
```

**tsconfig.json:**
```json
{
    "compilerOptions": {
        "outDir": "dist",
        "rootDir": "src",
        "tsBuildInfoFile": "../../.nx/cache/tsbuildinfo/server.tsbuildinfo"
    },
    "exclude": ["dist", "node_modules"],
    "extends": "../../tsconfig.base.json",
    "include": ["src/**/*"],
    "references": []
}
```

---
## [4][APPS/API]

```
apps/api/
├── src/
│   ├── main.ts         # Entry point
│   ├── api.ts          # HttpApi definition
│   ├── migrate.ts      # Migration runner
│   └── routes/
│       ├── health.ts   # Health endpoint
│       └── icons.ts    # Icon generation endpoints
├── Dockerfile
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**package.json:**
```json
{
    "name": "@parametric-portal/api",
    "version": "0.1.0",
    "type": "module",
    "scripts": {
        "build": "vite build",
        "check": "biome check .",
        "dev": "tsx watch src/main.ts",
        "migrate": "tsx src/migrate.ts",
        "start": "node dist/main.js",
        "test": "vitest run --passWithNoTests",
        "typecheck": "tsc --project tsconfig.json --noEmit"
    },
    "dependencies": {
        "@anthropic-ai/sdk": "catalog:",
        "@effect/platform": "catalog:",
        "@effect/platform-node": "catalog:",
        "@effect/schema": "catalog:",
        "@effect/sql": "catalog:",
        "@effect/sql-pg": "catalog:",
        "@parametric-portal/database": "workspace:*",
        "@parametric-portal/server": "workspace:*",
        "@parametric-portal/types": "workspace:*",
        "effect": "catalog:"
    },
    "devDependencies": {
        "tsx": "catalog:",
        "typescript": "catalog:",
        "vite": "catalog:",
        "vitest": "catalog:"
    }
}
```

**src/api.ts:**
```typescript
/** Provides HttpApi definition with endpoint schemas for ParametricApi. */
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, HttpApiSchema } from '@effect/platform';
import { Schema as S } from '@effect/schema';

// --- [SCHEMA] ----------------------------------------------------------------

const GenerateRequest = S.Struct({
    prompt: S.String.pipe(S.minLength(1), S.maxLength(1000)),
    colorMode: S.optional(S.Literal('light', 'dark')),
    intent: S.optional(S.Literal('create', 'refine')),
    variantCount: S.optional(S.Number.pipe(S.between(1, 3))),
});

const GenerateResponse = S.Struct({
    id: S.String,
    variants: S.Array(S.Struct({ id: S.String, svg: S.String })),
});

const AssetResponse = S.Struct({
    id: S.String,
    prompt: S.String,
    svg: S.String,
    metadata: S.NullOr(S.Unknown),
    createdAt: S.String,
});

const HealthResponse = S.Struct({
    status: S.Literal('healthy'),
    database: S.Literal('connected'),
    timestamp: S.String,
});

// --- [PATH_PARAMS] -----------------------------------------------------------

const idParam = HttpApiSchema.param('id', S.String);

// --- [ENDPOINTS] -------------------------------------------------------------

const healthEndpoint = HttpApiEndpoint.get('health', '/health').addSuccess(HealthResponse);

const generateEndpoint = HttpApiEndpoint.post('generate', '/icons/generate')
    .setPayload(GenerateRequest)
    .addSuccess(GenerateResponse);

const listAssetsEndpoint = HttpApiEndpoint.get('listAssets', '/icons/assets')
    .addSuccess(S.Struct({ assets: S.Array(AssetResponse) }));

const getAssetEndpoint = HttpApiEndpoint.get('getAsset')`/icons/assets/${idParam}`
    .addSuccess(AssetResponse)
    .addError(HttpApiError.NotFound);

const deleteAssetEndpoint = HttpApiEndpoint.del('deleteAsset')`/icons/assets/${idParam}`
    .addSuccess(S.Struct({ deleted: S.Boolean }))
    .addError(HttpApiError.NotFound);

// --- [GROUPS] ----------------------------------------------------------------

const HealthGroup = HttpApiGroup.make('health').add(healthEndpoint);

const IconsGroup = HttpApiGroup.make('icons')
    .add(generateEndpoint)
    .add(listAssetsEndpoint)
    .add(getAssetEndpoint)
    .add(deleteAssetEndpoint);

// --- [API] -------------------------------------------------------------------

const AppApi = HttpApi.make('ParametricApi').add(HealthGroup).add(IconsGroup);

// --- [EXPORT] ----------------------------------------------------------------

export { AppApi, HealthGroup, IconsGroup };
```

**src/routes/health.ts:**
```typescript
/** Provides health check endpoint handler with database connectivity verification. */
import { HttpApiBuilder } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';
import { AppApi } from '../api.ts';

// --- [HANDLERS] --------------------------------------------------------------

const HealthLive = HttpApiBuilder.group(AppApi, 'health', (handlers) =>
    handlers.handle('health', () =>
        Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const [{ now }] = yield* sql<{ now: Date }>`SELECT now()`;
            return { status: 'healthy' as const, database: 'connected' as const, timestamp: now.toISOString() };
        }),
    ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { HealthLive };
```

**src/routes/icons.ts:**
```typescript
/** Provides icon CRUD endpoint handlers with Anthropic integration for generation. */
import { HttpApiBuilder, HttpApiError } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import Anthropic from '@anthropic-ai/sdk';
import { Effect } from 'effect';
import { AppApi } from '../api.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    model: 'claude-sonnet-4-20250514',
    maxTokens: 24576,
} as const);

// --- [HANDLERS] --------------------------------------------------------------

const IconsLive = HttpApiBuilder.group(AppApi, 'icons', (handlers) =>
    handlers
        .handle('generate', ({ payload }) =>
            Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

                const response = yield* Effect.tryPromise(() =>
                    anthropic.messages.create({
                        model: B.model,
                        max_tokens: B.maxTokens,
                        messages: [{ role: 'user', content: payload.prompt }],
                    }),
                );

                const svg = response.content[0]?.type === 'text' ? response.content[0].text : '';
                const assetId = crypto.randomUUID();

                yield* sql`
                    INSERT INTO assets (id, prompt, svg, metadata)
                    VALUES (${assetId}, ${payload.prompt}, ${svg}, ${JSON.stringify({
                        colorMode: payload.colorMode ?? 'dark',
                        intent: payload.intent ?? 'create',
                    })})
                `;

                return { id: assetId, variants: [{ id: crypto.randomUUID(), svg }] };
            }),
        )
        .handle('listAssets', () =>
            Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                const assets = yield* sql`
                    SELECT id, prompt, svg, metadata, created_at as "createdAt"
                    FROM assets ORDER BY created_at DESC LIMIT 100
                `;
                return { assets: assets.map((a) => ({ ...a, createdAt: String(a.createdAt) })) };
            }),
        )
        .handle('getAsset', ({ path }) =>
            Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                const [asset] = yield* sql`
                    SELECT id, prompt, svg, metadata, created_at as "createdAt"
                    FROM assets WHERE id = ${path.id}
                `;
                return asset
                    ? { ...asset, createdAt: String(asset.createdAt) }
                    : yield* Effect.fail(new HttpApiError.NotFound());
            }),
        )
        .handle('deleteAsset', ({ path }) =>
            Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient;
                yield* sql`DELETE FROM assets WHERE id = ${path.id}`;
                return { deleted: true };
            }),
        ),
);

// --- [EXPORT] ----------------------------------------------------------------

export { B as ICONS_TUNING, IconsLive };
```

**src/main.ts:**
```typescript
/** Provides API server entry point with Layer composition for database and HTTP. */
import { HttpApiBuilder } from '@effect/platform';
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { Layer } from 'effect';
import { createServer } from 'node:http';
import { PgLive } from '@parametric-portal/database/client';
import { AppApi } from './api.ts';
import { HealthLive } from './routes/health.ts';
import { IconsLive } from './routes/icons.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    port: 4000,
    host: '0.0.0.0',
} as const);

// --- [LAYERS] ----------------------------------------------------------------

const ApiLive = HttpApiBuilder.api(AppApi).pipe(
    Layer.provide(HealthLive),
    Layer.provide(IconsLive),
);

const ServerLive = HttpApiBuilder.serve().pipe(
    Layer.provide(ApiLive),
    Layer.provide(PgLive),
    Layer.provide(NodeHttpServer.layer(createServer, { port: B.port, host: B.host })),
);

// --- [ENTRY_POINT] -----------------------------------------------------------

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
```

**src/migrate.ts:**
```typescript
/** Provides database migration runner using PgMigrator with filesystem loader. */
import { NodeContext, NodeRuntime } from '@effect/platform-node';
import { PgMigrator } from '@effect/sql-pg';
import { Effect, Layer } from 'effect';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgLive } from '@parametric-portal/database/client';

// --- [CONSTANTS] -------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../packages/database/src/migrations');

// --- [LAYERS] ----------------------------------------------------------------

const MigratorLive = PgMigrator.layer({
    loader: PgMigrator.fromFileSystem(MIGRATIONS_DIR),
}).pipe(Layer.provide(PgLive), Layer.provide(NodeContext.layer));

// --- [ENTRY_POINT] -----------------------------------------------------------

Effect.gen(function* () {
    yield* Effect.log('[MIGRATE] Starting database migrations...');
}).pipe(Effect.provide(MigratorLive), NodeRuntime.runMain);
```

[IMPORTANT]: `PgMigrator.layer` auto-runs pending migrations when layer is constructed. The `Effect.gen` block executes after migrations complete.

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
## [6][FRONTEND_INTEGRATION]

Update `apps/parametric_icons/src/generation.ts`:

```typescript
/** Provides icon generation API client for frontend integration. */
import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform-browser';
import { Effect, pipe } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    api: { base: import.meta.env.VITE_API_URL ?? 'http://localhost:4000' },
} as const);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const generateIcon = (input: { prompt: string; colorMode?: 'light' | 'dark' }) =>
    pipe(
        HttpClientRequest.post(`${B.api.base}/icons/generate`),
        HttpClientRequest.bodyJson(input),
        Effect.flatMap(HttpClient.fetch),
        Effect.flatMap(HttpClientResponse.json),
        Effect.scoped,
    );

// --- [EXPORT] ----------------------------------------------------------------

export { B as GENERATION_TUNING, generateIcon };
```

Add to `apps/parametric_icons/.env`:
```
VITE_API_URL=http://localhost:4000
```

---
## [7][IMPLEMENTATION_STEPS]

| [STEP] | [ACTION]                    | [COMMAND]                                                                                         |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------- |
| 1      | Add dependencies to catalog | Edit `pnpm-workspace.yaml`                                                                        |
| 2      | Create `packages/database`  | `mkdir -p packages/database/src/migrations`                                                       |
| 3      | Create `packages/server`    | `mkdir -p packages/server/src`                                                                    |
| 4      | Create `apps/api`           | `mkdir -p apps/api/src/routes`                                                                    |
| 5      | Install dependencies        | `pnpm install`                                                                                    |
| 6      | Build packages              | `pnpm exec nx run-many -t build --projects=@parametric-portal/database,@parametric-portal/server` |
| 7      | Start PostgreSQL            | `docker compose up postgres -d`                                                                   |
| 8      | Run migrations              | `pnpm exec nx migrate @parametric-portal/api`                                                     |
| 9      | Start API                   | `pnpm exec nx dev @parametric-portal/api`                                                         |
| 10     | Update frontend             | Replace Anthropic SDK with API calls                                                              |

---
## [8][ENVIRONMENT]

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
## [9][HOSTINGER_DEPLOYMENT]

### [9.1][VPS_SETUP]

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Install Docker (if not installed)
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install Docker Compose plugin
apt update && apt install -y docker-compose-plugin

# Create app directory
mkdir -p /var/www/parametric_icons
```

### [9.2][DEPLOY_BACKEND]

```bash
# Clone repo and start containers
cd /opt && git clone YOUR_REPO_URL parametric
cd /opt/parametric

# Create .env file
cat > .env << 'EOF'
POSTGRES_PASSWORD=GENERATE_SECURE_PASSWORD
ANTHROPIC_API_KEY=sk-ant-...
EOF

# Start services
docker compose up -d
```

### [9.3][DEPLOY_FRONTEND]

```bash
# Build locally, then copy dist to VPS
pnpm exec nx build @parametric-portal/parametric-icons
scp -r apps/parametric_icons/dist/* root@YOUR_VPS_IP:/var/www/parametric_icons/
```

### [9.4][NGINX_CONFIG]

```bash
# Install nginx
apt install -y nginx

# Create config
cat > /etc/nginx/sites-available/parametric << 'EOF'
server {
    listen 80;
    server_name YOUR_DOMAIN;

    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options DENY;

    root /var/www/parametric_icons;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/parametric /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

### [9.5][SSL_SETUP]

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d YOUR_DOMAIN --non-interactive --agree-tos -m YOUR_EMAIL
```

---
## [10][NX_TARGETS]

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

[IMPORTANT]: Migrations are not cacheable (`cache: false`). The `start` target depends on `build` to ensure dist exists.

---
## [11][MIGRATIONS]

**What migrations are:** Version-controlled SQL scripts that manage database schema changes over time.

**Why needed:**
- Track applied schema changes
- Ensure consistent database state across environments
- Enable team collaboration on schema changes
- Support deployment consistency

**How they work:**
1. Migration files are Effect programs that run SQL
2. `PgMigrator` tracks applied migrations in `effect_sql_migrations` table
3. Only unapplied migrations run on each `migrate` command
4. Migrations are forward-only (no automatic rollback)

**Migration file pattern:**
```typescript
// src/migrations/0002_add_column.ts
import { SqlClient } from '@effect/sql';
import { Effect } from 'effect';

export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  ALTER TABLE assets ADD COLUMN tags TEXT[];
`);
```
