# [H1][BACKEND_INTEGRATION]
>**Dictum:** *Packages export mechanisms; apps define values. Anthropic client is mechanism, CAD prompts are values.*

---
## [1][STATUS]

| Component                | State    | Notes                                           |
| ------------------------ | -------- | ----------------------------------------------- |
| `packages/database/`     | **DONE** | PG17 patterns, Effect/SQL client                |
| `packages/server/`       | **DONE** | Middleware, errors, API builder                 |
| `packages/ai/`           | **DONE** | Generic Anthropic client (`anthropic.ts`)       |
| `apps/api/`              | **DONE** | Routes + Services separation, Layer composition |
| `apps/parametric_icons/` | **DONE** | API client, no browser secrets                  |

---
## [2][ARCHITECTURE]

```
packages/ai/src/anthropic.ts          ← Generic Anthropic client (mechanism)
                                        - Config.redacted('ANTHROPIC_API_KEY')
                                        - send(system, messages, options)
                                        - Provider-agnostic interface

apps/api/src/
├── api.ts                            ← HTTP API schema (endpoints, payloads)
├── main.ts                           ← Layer composition entry point
├── services/icons.ts                 ← Domain logic (CAD prompts, SVG sanitization)
└── routes/icons.ts                   ← HTTP handlers (calls service, stores to DB)

apps/parametric_icons/src/
├── api.ts                            ← Fetch wrapper for backend API
└── generation.ts                     ← Client-side utilities (sanitizeSvg, scoping)
```

**Future AI providers**: Add `packages/ai/src/openai.ts`, `packages/ai/src/gemini.ts` with same interface.

---
## [3][ENVIRONMENT_VARIABLES]

### [3.1][ROOT_ENV]

```env
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=parametric
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
POSTGRES_SSL=false

# API Server
API_PORT=4000
API_BASE_URL=http://localhost:4000

# AI (server-side only)
ANTHROPIC_API_KEY=sk-ant-...

# OAuth
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT_ID=common
```

### [3.2][FRONTEND_ENV]

```env
# API URL only - no secrets
VITE_API_URL=http://localhost:4000/api
```

### [3.3][FILE_CHANGES]

| File                         | Status   | Change                                  |
| ---------------------------- | -------- | --------------------------------------- |
| `.env.example` (root)        | TODO     | Create with all server vars             |
| `apps/parametric_icons/.env` | **DONE** | Removed `VITE_ANTHROPIC_API_KEY`        |
| `vite.factory.ts`            | **DONE** | Removed `VITE_ANTHROPIC_API_KEY`        |
| `pnpm-workspace.yaml`        | **DONE** | Added `isomorphic-dompurify` to catalog |

---
## [4][HOSTING_ON_HOSTINGER]

### [4.1][VPS_REQUIREMENTS]

| Plan      | vCPU | RAM  | Storage     | Price    |
| --------- | ---- | ---- | ----------- | -------- |
| **KVM 2** | 2    | 8 GB | 100 GB NVMe | $6.99/mo |

Template: Ubuntu 24.04 with Docker. Self-hosted PostgreSQL.

### [4.2][DOCKER_COMPOSE]

```yaml
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
    env_file: .env
    ports:
      - "4000:4000"

  frontend:
    build:
      context: .
      dockerfile: apps/parametric_icons/Dockerfile
      args:
        VITE_API_URL: ${API_BASE_URL}/api
    restart: unless-stopped
    depends_on:
      - api
    ports:
      - "3001:80"

volumes:
  postgres_data:
```

### [4.3][GITHUB_ACTIONS]

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hostinger/deploy-on-vps@v1
        with:
          host: ${{ secrets.VPS_HOST }}
          username: root
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd /opt/parametric-portal
            git pull origin main
            docker compose up -d --build
            docker compose exec api pnpm exec nx migrate @parametric-portal/api
```

---
## [5][REMAINING_WORK]

| Task                  | Status | Notes                                |
| --------------------- | ------ | ------------------------------------ |
| `.env.example` (root) | TODO   | Create with all server vars          |
| Auth UI               | TODO   | Login buttons in sidebar             |
| Docker + Deploy       | TODO   | Dockerfiles, compose, GitHub Actions |

---
## [6][LOCAL_DEVELOPMENT]

```bash
docker compose up postgres -d
pnpm exec nx migrate @parametric-portal/api
pnpm exec nx dev @parametric-portal/api          # port 4000
pnpm exec nx dev @parametric-portal/parametric_icons  # port 3001
```

Swagger: `http://localhost:4000/docs`
