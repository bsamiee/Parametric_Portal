# [H1][BACKEND_PLAN]
>**Dictum:** *Effect-native backend with per-app APIs and shared infrastructure.*

---
## [1][ARCHITECTURE]

```
packages/
├── database/           # DONE: Client, Models (User, Asset, ApiKey, Session, OAuthAccount, Organization)
└── server/             # DONE: Middleware (SessionAuth, ApiKeyAuth), Errors, HttpApi factories

apps/
├── parametric_icons/   # Existing frontend (port 3001)
└── api/                # TO BUILD: Route handlers, migrations, OAuth callbacks
    └── routes/
```

---
## [2][APPS/API]

### [2.1][STRUCTURE]

```
apps/api/
├── src/
│   ├── main.ts              # Entry point with Layer composition
│   ├── api.ts               # HttpApi definition
│   ├── migrate.ts           # Migration runner
│   └── routes/
│       ├── health.ts        # Health endpoints
│       ├── auth.ts          # OAuth flows (Google, GitHub, Microsoft)
│       └── icons.ts         # Icon CRUD + generation
├── migrations/
│   ├── 0001_users.ts
│   ├── 0002_sessions.ts
│   └── 0003_organizations.ts
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### [2.2][IMPORTS FROM PACKAGES]

```typescript
// From @parametric-portal/database
import { PgLive } from '@parametric-portal/database/client';
import { Asset, User, Session, OAuthAccount, Organization, OrganizationMember } from '@parametric-portal/database/models';
import { UserIdSchema, SessionIdSchema, OAuthProviderSchema } from '@parametric-portal/database/schema';

// From @parametric-portal/server
import { createApi, createGroup, createHealthGroup, addStandardErrors, SwaggerLayer } from '@parametric-portal/server/api';
import { SessionAuth, createSessionAuthLayer, OAuthService, createCorsLayer } from '@parametric-portal/server/middleware';
import { UnauthorizedError, OAuthError, NotFoundError } from '@parametric-portal/server/errors';
```

### [2.3][OAUTH ROUTES]

**Use Arctic for OAuth protocol (already in catalog):**

```typescript
import { GitHub, Google, MicrosoftEntraId } from 'arctic';

const providers = {
    github: new GitHub(config.github.clientId, config.github.clientSecret),
    google: new Google(config.google.clientId, config.google.clientSecret, config.google.redirectUri),
    microsoft: new MicrosoftEntraId(config.microsoft.tenantId, config.microsoft.clientId, config.microsoft.clientSecret, config.microsoft.redirectUri),
} as const;
```

**Route endpoints:**

| Endpoint                         | Method | Purpose                                  |
| -------------------------------- | ------ | ---------------------------------------- |
| `/auth/oauth/:provider`          | GET    | Redirect to provider auth URL            |
| `/auth/oauth/:provider/callback` | GET    | Handle callback, create session          |
| `/auth/refresh`                  | POST   | Refresh session token                    |
| `/auth/logout`                   | POST   | Revoke session                           |
| `/auth/me`                       | GET    | Current user info (requires SessionAuth) |

### [2.4][LAYER COMPOSITION]

```typescript
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { createServer } from 'node:http';

const ApiLive = HttpApiBuilder.api(AppApi).pipe(
    Layer.provide(HealthLive),
    Layer.provide(AuthLive),
    Layer.provide(IconsLive),
);

const ServerLive = HttpApiBuilder.serve().pipe(
    Layer.provide(ApiLive),
    Layer.provide(SwaggerLayer),
    Layer.provide(createCorsLayer()),
    Layer.provide(PgLive),
    Layer.provide(NodeHttpServer.layer(createServer, { port: B.port })),
);

Layer.launch(ServerLive).pipe(NodeRuntime.runMain);
```

### [2.5][SQLRESOLVER PATTERNS]

**[CRITICAL] Define resolvers inside Effect.gen (requires SqlClient in scope):**

```typescript
Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const findSession = SqlSchema.findOne({
        Request: S.String,
        Result: Session,
        execute: (tokenHash) => sql`SELECT * FROM sessions WHERE token_hash = ${tokenHash} AND expires_at > now()`,
    });
    return yield* findSession(tokenHash);
});
```

---
## [3][MIGRATIONS]

**Create tables for auth entities:**

```typescript
// 0001_users.ts
export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    api_key_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

// 0002_sessions.ts
export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE oauth_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    access_token_expires_at TIMESTAMPTZ,
    scope TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(provider, provider_account_id)
  );
  CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`);

// 0003_organizations.ts
export default Effect.flatMap(SqlClient.SqlClient, (sql) => sql`
  CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(organization_id, user_id)
  );
`);
```

---
## [4][DOCKER]

**docker-compose.yml:**
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
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      OAUTH_GITHUB_CLIENT_ID: ${OAUTH_GITHUB_CLIENT_ID}
      OAUTH_GITHUB_CLIENT_SECRET: ${OAUTH_GITHUB_CLIENT_SECRET}
      OAUTH_GOOGLE_CLIENT_ID: ${OAUTH_GOOGLE_CLIENT_ID}
      OAUTH_GOOGLE_CLIENT_SECRET: ${OAUTH_GOOGLE_CLIENT_SECRET}
    ports:
      - "4000:4000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres_data:
```

---
## [5][IMPLEMENTATION]

| [STEP] | [ACTION]                  | [COMMAND]                                          |
| ------ | ------------------------- | -------------------------------------------------- |
| 1      | Create apps/api structure | `mkdir -p apps/api/src/routes apps/api/migrations` |
| 2      | Install dependencies      | `pnpm install`                                     |
| 3      | Start PostgreSQL          | `docker compose up postgres -d`                    |
| 4      | Run migrations            | `pnpm exec nx migrate @parametric-portal/api`      |
| 5      | Start API                 | `pnpm exec nx dev @parametric-portal/api`          |
