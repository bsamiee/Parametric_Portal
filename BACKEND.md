# [H1][BACKEND_INTEGRATION]
>**Dictum:** *Production deployment on Hostinger VPS with full API migration.*

---
## [1][STATUS]

| Component                | State             | Issue                                                        |
| ------------------------ | ----------------- | ------------------------------------------------------------ |
| `packages/database/`     | **DONE**          | —                                                            |
| `packages/server/`       | **DONE**          | —                                                            |
| `apps/api/`              | **INCOMPLETE**    | Generation logic is stub (9-line prompt vs 83-line frontend) |
| `apps/parametric_icons/` | **SECURITY RISK** | Exposes `VITE_ANTHROPIC_API_KEY` in browser                  |

**Critical Gap:** `apps/api/src/anthropic.ts` lacks: variants, refine mode, attachments, color mode, SVG sanitization, CAD prompt.

---
## [2][GENERATION_MIGRATION]

### [2.1][FEATURE_GAP]

| Feature          | Frontend (`generation.ts`)          | API (`anthropic.ts`) | Action       |
| ---------------- | ----------------------------------- | -------------------- | ------------ |
| System prompt    | 83 lines, CAD-specific              | 9 lines, generic     | **PORT**     |
| Variants         | 1-3 per request                     | Single output        | **PORT**     |
| Refine mode      | `intent: 'refine'` + `referenceSvg` | None                 | **PORT**     |
| Attachments      | `ReferenceAttachment[]`             | None                 | **PORT**     |
| Color mode       | `dark` / `light` palettes           | None                 | **PORT**     |
| SVG sanitization | DOMPurify + scope IDs               | Regex extraction     | **PORT**     |
| Max tokens       | 6000                                | 4096                 | **INCREASE** |
| Output format    | `{"variants":[...]}`                | Plain string         | **PORT**     |

### [2.2][API_CHANGES]

**New POST `/api/icons` body:**

```typescript
type GenerateRequest = {
  prompt: string;
  colorMode?: 'dark' | 'light';       // default: dark
  intent?: 'create' | 'refine';       // default: create
  variantCount?: 1 | 2 | 3;           // default: 1
  referenceSvg?: string;              // required if intent=refine
  attachments?: Array<{               // style references
    id: string;
    name: string;
    svg: string;
  }>;
};

type GenerateResponse = {
  variants: Array<{
    id: string;
    name: string;
    svg: string;  // sanitized, scoped IDs
  }>;
};
```

### [2.3][FILE_CHANGES]

| File                                      | Change                                                             |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `apps/api/src/anthropic.ts`               | Replace with `generation.ts` logic (prompt builders, sanitization) |
| `apps/api/src/routes/icons.ts`            | Update schema to accept full GenerateRequest                       |
| `apps/api/src/api.ts`                     | Update IconsGroup endpoint schemas                                 |
| `apps/api/package.json`                   | Add `dompurify` dependency                                         |
| `apps/parametric_icons/src/generation.ts` | Remove Anthropic client, export only sanitization + types          |

---
## [3][ENVIRONMENT_VARIABLES]

### [3.1][CURRENT_STATE] (Fragmented)

- `.env` in `apps/parametric_icons/` exposes API key to browser
- No `.env.example` templates
- Database uses Effect Config API, Vite uses `define` injection
- No validation at startup

### [3.2][TARGET_STATE]

**Single `.env` at repo root**, loaded by API only:

```env
# Database (Effect Config reads these)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=parametric
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_SSL=false

# API Server
API_PORT=4000
API_BASE_URL=http://localhost:4000

# Anthropic (server-side only)
ANTHROPIC_API_KEY=sk-ant-...

# OAuth (register apps at each provider)
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT_ID=common
```

**Frontend `.env` (apps/parametric_icons):**

```env
# API URL only - no secrets
VITE_API_URL=http://localhost:4000/api
```

### [3.3][FILE_CHANGES]

| File                                 | Change                                    |
| ------------------------------------ | ----------------------------------------- |
| `.env.example` (root)                | Create with all server vars               |
| `apps/parametric_icons/.env.example` | Create with `VITE_API_URL` only           |
| `apps/parametric_icons/.env`         | Remove `VITE_ANTHROPIC_API_KEY`           |
| `apps/api/src/anthropic.ts`          | Use `Config.string('ANTHROPIC_API_KEY')`  |
| `vite.factory.ts`                    | Remove `VITE_ANTHROPIC_API_KEY` injection |

---
## [4][HOSTING_ON_HOSTINGER]

### [4.1][VPS_REQUIREMENTS]

| Plan                    | vCPU | RAM  | Storage     | Price    |
| ----------------------- | ---- | ---- | ----------- | -------- |
| **KVM 2** (recommended) | 2    | 8 GB | 100 GB NVMe | $6.99/mo |

- **Template:** Ubuntu 24.04 with Docker
- **No managed PostgreSQL** — self-hosted in Docker

### [4.2][DOCKER_COMPOSE]

```yaml
# docker-compose.yml (repo root)
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: parametric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: parametric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      API_PORT: 4000
      API_BASE_URL: ${API_BASE_URL}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      OAUTH_GITHUB_CLIENT_ID: ${OAUTH_GITHUB_CLIENT_ID}
      OAUTH_GITHUB_CLIENT_SECRET: ${OAUTH_GITHUB_CLIENT_SECRET}
      OAUTH_GOOGLE_CLIENT_ID: ${OAUTH_GOOGLE_CLIENT_ID}
      OAUTH_GOOGLE_CLIENT_SECRET: ${OAUTH_GOOGLE_CLIENT_SECRET}
    ports:
      - "4000:4000"

  frontend:
    build:
      context: .
      dockerfile: apps/parametric_icons/Dockerfile
    restart: unless-stopped
    depends_on:
      - api
    environment:
      VITE_API_URL: ${API_BASE_URL}/api
    ports:
      - "3001:80"

volumes:
  postgres_data:
```

### [4.3][DOCKERFILES]

**`apps/api/Dockerfile`:**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build @parametric-portal/api

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 4000
CMD ["node", "dist/main.js"]
```

**`apps/parametric_icons/Dockerfile`:**

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages packages
COPY apps/parametric_icons apps/parametric_icons
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile
RUN pnpm exec nx build @parametric-portal/parametric_icons

FROM nginx:alpine
COPY --from=builder /app/apps/parametric_icons/dist /usr/share/nginx/html
COPY apps/parametric_icons/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### [4.4][DEPLOYMENT]

**GitHub Actions (`.github/workflows/deploy.yml`):**

```yaml
name: Deploy to Hostinger
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to VPS
        uses: hostinger/deploy-on-vps@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/parametric-portal
            git pull origin main
            docker compose pull
            docker compose up -d --build
            docker compose exec api pnpm exec nx migrate @parametric-portal/api
```

**GitHub Secrets required:**
- `VPS_HOST` — Hostinger VPS IP
- `VPS_SSH_KEY` — Private SSH key
- `POSTGRES_PASSWORD`
- `ANTHROPIC_API_KEY`
- `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`
- `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`

---
## [5][FRONTEND_INTEGRATION]

### [5.1][API_CLIENT]

Create `apps/parametric_icons/src/api.ts`:

```typescript
import { Effect, pipe } from 'effect';
import type { ApiError, ApiResponse } from '@parametric-portal/types/api';

const B = Object.freeze({
  baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
  storage: {
    accessToken: 'pp:accessToken',
    refreshToken: 'pp:refreshToken',
  },
} as const);

const getTokens = () => ({
  access: localStorage.getItem(B.storage.accessToken),
  refresh: localStorage.getItem(B.storage.refreshToken),
});

const setTokens = (access: string, refresh: string) => {
  localStorage.setItem(B.storage.accessToken, access);
  localStorage.setItem(B.storage.refreshToken, refresh);
};

const clearTokens = () => {
  localStorage.removeItem(B.storage.accessToken);
  localStorage.removeItem(B.storage.refreshToken);
};

const request = <T>(path: string, options?: RequestInit): Effect.Effect<T, ApiError> =>
  Effect.tryPromise({
    try: async () => {
      const { access } = getTokens();
      const res = await fetch(`${B.baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
          ...options?.headers,
        },
      });
      if (!res.ok) throw await res.json();
      return res.json() as Promise<T>;
    },
    catch: (e) => e as ApiError,
  });

export const api = {
  auth: {
    getOAuthUrl: (provider: 'github' | 'google' | 'microsoft') =>
      request<{ url: string }>(`/auth/oauth/${provider}`),
    me: () => request<{ id: string; email: string }>('/auth/me'),
    logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  },
  icons: {
    list: (limit = 20, offset = 0) =>
      request<{ data: Array<{ id: string; prompt: string }>; total: number }>(
        `/icons?limit=${limit}&offset=${offset}`
      ),
    generate: (body: {
      prompt: string;
      colorMode?: 'dark' | 'light';
      intent?: 'create' | 'refine';
      variantCount?: 1 | 2 | 3;
      referenceSvg?: string;
      attachments?: Array<{ id: string; name: string; svg: string }>;
    }) => request<{ variants: Array<{ id: string; name: string; svg: string }> }>('/icons', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  },
  setTokens,
  clearTokens,
  getTokens,
};
```

### [5.2][AUTH_SLICE]

Add to `apps/parametric_icons/src/stores.ts`:

```typescript
type AuthState = {
  user: { id: string; email: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
};

const authSlice: StateCreator<AuthState> = (set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
});
```

### [5.3][LOGIN_COMPONENT]

Sidebar avatar/login in bottom-left — use existing `SessionAuth` endpoints:

```typescript
// In sidebar component
const handleLogin = (provider: 'github' | 'google' | 'microsoft') => {
  Effect.runPromise(api.auth.getOAuthUrl(provider)).then(({ url }) => {
    window.location.href = url; // Redirect to OAuth provider
  });
};

// After OAuth callback redirects back, parse tokens from URL or response
// Store via api.setTokens(accessToken, refreshToken)
```

**No account page needed** — `/auth/me` returns `{ id, email }`, display in avatar dropdown.

### [5.4][GENERATION_REFACTOR]

Replace direct Anthropic call in `generation.ts`:

```typescript
// Before: Anthropic client in browser
const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
const result = await client.messages.create({...});

// After: API call
import { api } from './api.ts';

const generateIcon = (input: GenerateInput) =>
  pipe(
    decodeGenerateInput(input),
    Effect.flatMap((ctx) =>
      api.icons.generate({
        prompt: ctx.prompt,
        colorMode: ctx.colorMode,
        intent: ctx.intent,
        variantCount: ctx.variantCount,
        referenceSvg: ctx.referenceSvg,
        attachments: ctx.attachments,
      })
    ),
    Effect.map((response) => apiFactory.success(response)),
    Effect.catchAll((err) => Effect.succeed(apiFactory.error(500, 'API_ERROR', String(err)))),
  );
```

---
## [6][IMPLEMENTATION_ORDER]

| Phase                      | Tasks                                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| **1. API Generation**      | Port `generation.ts` logic to `apps/api/src/anthropic.ts`, update schemas |
| **2. Environment**         | Create `.env.example` files, remove browser API key exposure              |
| **3. Frontend API Client** | Create `api.ts`, add `authSlice`, refactor `generateIcon()`               |
| **4. Auth UI**             | Add login buttons to sidebar, handle OAuth callback                       |
| **5. Docker**              | Create Dockerfiles, `docker-compose.yml`, `nginx.conf`                    |
| **6. Deploy**              | Set up Hostinger VPS, configure GitHub Actions, add secrets               |

---
## [7][LOCAL_DEVELOPMENT]

```bash
# Start database
docker compose up postgres -d

# Run migrations
pnpm exec nx migrate @parametric-portal/api

# Start API (terminal 1)
pnpm exec nx dev @parametric-portal/api

# Start frontend (terminal 2)
pnpm exec nx dev @parametric-portal/parametric_icons
```

Frontend at `http://localhost:3001`, API at `http://localhost:4000`, Swagger at `http://localhost:4000/docs`.
