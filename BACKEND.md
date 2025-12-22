# [H1][BACKEND_INTEGRATION]
>**Dictum:** *Backend complete. Frontend integration required.*

---
## [1][STATUS]

| Component                | State                  | Notes                                                    |
| ------------------------ | ---------------------- | -------------------------------------------------------- |
| `packages/database/`     | **DONE**               | 8 models, 3 migrations, repositories, PgLive             |
| `packages/server/`       | **DONE**               | SessionAuth, ApiKeyAuth, CORS, errors, API factories     |
| `apps/api/`              | **DONE**               | OAuth (3 providers), sessions, icons CRUD, health checks |
| `apps/parametric_icons/` | **INTEGRATION NEEDED** | Calls Anthropic directly, localStorage only              |

**Problem:** Frontend exposes `VITE_ANTHROPIC_API_KEY` in browser. All data ephemeral.

---
## [2][API_ENDPOINTS]

Base URL: `http://localhost:4000/api`

### [2.1][AUTH]

| Endpoint                         | Method | Auth   | Response                                   |
| -------------------------------- | ------ | ------ | ------------------------------------------ |
| `/auth/oauth/:provider`          | GET    | -      | `{ url }` redirect URL                     |
| `/auth/oauth/:provider/callback` | GET    | -      | `{ accessToken, refreshToken, expiresAt }` |
| `/auth/refresh`                  | POST   | Bearer | `{ accessToken, refreshToken, expiresAt }` |
| `/auth/logout`                   | POST   | Bearer | `{ success }`                              |
| `/auth/me`                       | GET    | Bearer | `{ id, email }`                            |

Providers: `github`, `google`, `microsoft`

### [2.2][ICONS]

| Endpoint | Method | Auth   | Response                                  |
| -------- | ------ | ------ | ----------------------------------------- |
| `/icons` | GET    | Bearer | `{ data: Asset[], total, limit, offset }` |
| `/icons` | POST   | Bearer | `{ id, svg }`                             |

Body for POST: `{ prompt: string }`

### [2.3][HEALTH]

| Endpoint            | Method | Response                                       |
| ------------------- | ------ | ---------------------------------------------- |
| `/health/liveness`  | GET    | `{ status: 'ok' }`                             |
| `/health/readiness` | GET    | `{ status: 'ok', checks: { database: bool } }` |

---
## [3][FRONTEND_INTEGRATION]

### [3.1][REQUIRED_CHANGES]

1. **Remove** `VITE_ANTHROPIC_API_KEY` from frontend
2. **Add** auth state management (token storage, refresh logic)
3. **Replace** direct Anthropic calls with `/api/icons` POST
4. **Replace** localStorage persistence with API calls
5. **Add** OAuth login flow (redirect to `/api/auth/oauth/:provider`)

### [3.2][AUTH_FLOW]

```
User clicks "Login with GitHub"
    ↓
Frontend redirects to: GET /api/auth/oauth/github
    ↓
API redirects to GitHub OAuth consent
    ↓
GitHub redirects to: /api/auth/oauth/github/callback?code=X&state=Y
    ↓
API creates session, returns: { accessToken, refreshToken, expiresAt }
    ↓
Frontend stores tokens, attaches Bearer header to all requests
```

### [3.3][API_CLIENT]

```typescript
const B = Object.freeze({
  baseUrl: 'http://localhost:4000/api',
  endpoints: {
    oauthStart: (provider: string) => `/auth/oauth/${provider}`,
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    icons: '/icons',
  },
} as const);

const createApiClient = (getToken: () => string | null) => ({
  get: <T>(path: string) =>
    fetch(`${B.baseUrl}${path}`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    }).then((r) => r.json() as Promise<T>),

  post: <T>(path: string, body: unknown) =>
    fetch(`${B.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      },
      body: JSON.stringify(body),
    }).then((r) => r.json() as Promise<T>),
});
```

### [3.4][TOKEN_REFRESH]

```typescript
const refreshTokens = async (refreshToken: string) => {
  const response = await fetch(`${B.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
  return response.json(); // { accessToken, refreshToken, expiresAt }
};
```

---
## [4][SETUP]

### [4.1][ENVIRONMENT]

Create `.env` at project root:

```env
# Database
POSTGRES_PASSWORD=your_secure_password

# OAuth (register apps at each provider)
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=
OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT_ID=common

# API
API_BASE_URL=http://localhost:4000
```

### [4.2][DOCKER]

```yaml
# docker-compose.yml
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

volumes:
  postgres_data:
```

### [4.3][COMMANDS]

| Step             | Command                                                |
| ---------------- | ------------------------------------------------------ |
| Start PostgreSQL | `docker compose up postgres -d`                        |
| Run migrations   | `pnpm exec nx migrate @parametric-portal/api`          |
| Start API (dev)  | `pnpm exec nx dev @parametric-portal/api`              |
| Start frontend   | `pnpm exec nx dev @parametric-portal/parametric_icons` |

---
## [5][IMPLEMENTATION_CHECKLIST]

### [5.1][BACKEND] (Already Done)

- [x] Database models (User, Asset, Session, OAuthAccount, etc.)
- [x] Migrations (users, sessions, organizations)
- [x] Repositories (CRUD operations)
- [x] OAuth service (GitHub, Google, Microsoft via Arctic)
- [x] Session management (create, refresh, revoke)
- [x] Anthropic integration (server-side SVG generation)
- [x] Health checks (liveness, readiness)

### [5.2][FRONTEND] (Required)

- [ ] Create `authSlice` in stores.ts (tokens, user, isAuthenticated)
- [ ] Create `apiClient` service with token injection
- [ ] Add login buttons (GitHub, Google, Microsoft)
- [ ] Handle OAuth callback redirect (parse tokens from URL or response)
- [ ] Replace `generateIcon()` Anthropic call with `POST /api/icons`
- [ ] Replace localStorage history with `GET /api/icons` + cache
- [ ] Add token refresh interceptor (auto-refresh before expiry)
- [ ] Remove `VITE_ANTHROPIC_API_KEY` from environment
- [ ] Add logout button calling `POST /api/auth/logout`
- [ ] Show user email from `GET /api/auth/me`
