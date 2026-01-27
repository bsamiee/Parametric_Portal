# External Integrations

**Analysis Date:** 2026-01-26

## APIs & External Services

**OAuth2/OIDC Providers:**
- GitHub - Social login
  - SDK/Client: `arctic` 3.7.0
  - Auth: OAuth credentials (client ID, client secret)
  - Implementation: `packages/server/src/domain/oauth.ts`
  - Capabilities: PKCE disabled, no OIDC
  - API Endpoint: `https://api.github.com/user` (email fetch)

- Google - Social login via OIDC
  - SDK/Client: `arctic` 3.7.0 + `@effect/ai-google` 0.12.1
  - Auth: OAuth credentials + API key for Gemini
  - Implementation: `packages/server/src/domain/oauth.ts`
  - Capabilities: PKCE enabled, OIDC enabled
  - Scopes: `openid`, `profile`, `email`

- Apple - Social login via OIDC
  - SDK/Client: `arctic` 3.7.0
  - Auth: OAuth credentials (team ID, key ID, private key)
  - Implementation: `packages/server/src/domain/oauth.ts`
  - Capabilities: PKCE enabled, OIDC enabled
  - Scopes: `openid`, `profile`, `email`

- Microsoft Entra ID - Enterprise SSO
  - SDK/Client: `arctic` 3.7.0
  - Auth: OAuth credentials
  - Implementation: `packages/server/src/domain/oauth.ts`
  - Capabilities: PKCE enabled, OIDC enabled
  - Scopes: `openid`, `profile`, `email`

**AI/LLM Services:**
- Anthropic Claude - Generative AI
  - SDK/Client: `@effect/ai-anthropic` 0.23.0
  - Auth: `ANTHROPIC_API_KEY` environment variable
  - Default Model: `claude-sonnet-4-20250514`
  - Implementation: `packages/ai/src/registry.ts`
  - Configuration: Adjustable max tokens (6000), temperature, top_k, top_p

- OpenAI - Generative AI
  - SDK/Client: `@effect/ai-openai` 0.37.2
  - Auth: `OPENAI_API_KEY` environment variable
  - Default Model: `gpt-4o`
  - Implementation: `packages/ai/src/registry.ts`
  - Configuration: Adjustable max tokens (4096), temperature, top_p

- Google Gemini - Generative AI
  - SDK/Client: `@effect/ai-google` 0.12.1
  - Auth: `GEMINI_API_KEY` environment variable
  - Default Model: `gemini-2.0-flash`
  - Implementation: `packages/ai/src/registry.ts`
  - Configuration: Adjustable max tokens (4096), temperature, topK, topP

## Data Storage

**Databases:**
- PostgreSQL 18.1+
  - Connection: Environment variables `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` or `DATABASE_URL`
  - Client: `@effect/sql-pg` 0.50.1 (Effect wrapper)
  - Pool: min 2, max 10 connections; 30s idle timeout, 5s connect timeout
  - Configuration: `packages/database/src/client.ts`
  - Features: Connection pooling, health checks, RLS (Row Level Security), advisory locks, transaction support
  - Tenant Isolation: Via `app.current_tenant` config parameter for RLS

**File Storage:**
- AWS S3 or S3-compatible storage (e.g., MinIO)
  - SDK/Client: `@aws-sdk/client-s3` 3.975.0 + `@effect-aws/client-s3` 1.10.9
  - Auth: `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (redacted)
  - Bucket: `STORAGE_BUCKET` environment variable
  - Endpoint: `STORAGE_ENDPOINT` (optional, defaults to AWS)
  - Region: `STORAGE_REGION` (defaults to `us-east-1`)
  - Configuration: `packages/server/src/infra/storage.ts`
  - Features: Multipart uploads (5MB parts, 10MB threshold), signed URLs, batch operations, tenant isolation via key paths
  - Path Pattern: `system/{key}` for system tenant, `tenants/{tenantId}/{key}` for others

**Caching:**
- Redis (via `ioredis` 5.9.2) - Optional for session storage and distributed caching
  - Connection: Standard Redis connection params (host, port, etc.)
  - Usage: Session storage, rate limit state, job queues
  - Implementation: Integrated via Effect layers

**Client-Side Storage:**
- IndexedDB (via `idb-keyval` 6.2.2) - Browser persistent storage
- In-memory (via `fake-indexeddb` 6.2.5 for testing)

## Authentication & Identity

**Auth Provider:**
- Multi-provider OAuth2/OIDC via `arctic` 3.7.0
  - Implementations: GitHub, Google, Apple, Microsoft Entra ID
  - Implementation: `packages/server/src/domain/oauth.ts`
  - Session Management: Cookie-based with refresh tokens
  - Cookie Names: `oauthState` (PKCE), `refreshToken` (30 days)
  - Session Duration: 7 days
  - MFA: TOTP via `otplib` 13.2.1
  - Implementation: `packages/server/src/domain/mfa.ts`
  - Replay Protection: Time-window based validation

**Token Management:**
- JWT tokens (access, refresh, refresh token rotation)
- Token encryption: Custom crypto via `packages/server/src/security/crypto.ts`
- Refresh mechanism: Via `refreshToken` cookie

## Monitoring & Observability

**Error Tracking:**
- Circuit breakers via `cockatiel` 3.2.1
  - Breakers: OAuth providers, S3, job queue, etc.
  - Implementation: `packages/server/src/security/circuit.ts`
  - States: Closed, Half-Open, Open with exponential backoff

**Logs:**
- Structured logging via Effect
- Log levels: All, Fatal, Error, Warning, Info, Debug, Trace, None (configurable)
- Correlation: via `requestId` context

**Distributed Tracing & Metrics:**
- OpenTelemetry (OTEL) exporter
  - SDK: `@effect/opentelemetry` 0.61.0
  - Endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT` (defaults to `https://alloy.monitoring.svc.cluster.local:4318`)
  - Configuration: `packages/server/src/observe/telemetry.ts`
  - Batch export: 512 items max, 10s interval (production), 64 items max, 2s interval (development)
  - Spans: Annotated with tenant ID, circuit state, request ID
  - Metrics Tracked:
    - Storage operations (duration, count, errors) - `packages/server/src/infra/storage.ts`
    - Job processing (completions, dead letters, retries) - `packages/server/src/infra/jobs.ts`
    - Database queries (via `@effect/sql-pg`)
    - OAuth attempts and state validation

**Audit Logging:**
- Event-based audit trail
  - Implementation: `packages/server/src/observe/audit.ts`
  - Events: User actions, API key operations, OAuth, MFA changes, job completion
  - Storage: PostgreSQL audit log table

## CI/CD & Deployment

**Hosting:**
- Cloud-agnostic via Effect runtime
- Docker containerization support
  - `@nx/docker` 22.4.2 for container builds

**CI Pipeline:**
- GitHub Actions (implicit via `.github/` structure)
- SonarCloud integration via `@sonar/scan` 4.3.4

**Test Automation:**
- Vitest 4.0.18 for unit/integration tests
- Playwright 1.58.0 for E2E tests
- Coverage reporting via `@vitest/coverage-v8`

## Environment Configuration

**Required env vars:**

### Database
- `POSTGRES_HOST` (default: localhost)
- `POSTGRES_PORT` (default: 5432)
- `POSTGRES_DB` (default: parametric)
- `POSTGRES_USER` (default: postgres)
- `POSTGRES_PASSWORD` (required, redacted)
- `DATABASE_URL` (optional, overrides individual params)

### Storage (S3)
- `STORAGE_BUCKET` (required)
- `STORAGE_ACCESS_KEY_ID` (required, redacted)
- `STORAGE_SECRET_ACCESS_KEY` (required, redacted)
- `STORAGE_REGION` (default: us-east-1)
- `STORAGE_ENDPOINT` (optional, for S3-compatible)
- `STORAGE_FORCE_PATH_STYLE` (default: false)

### AI Providers
- `ANTHROPIC_API_KEY` (optional if not using Claude)
- `OPENAI_API_KEY` (optional if not using OpenAI)
- `GEMINI_API_KEY` (optional if not using Gemini)

### OAuth
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Apple: `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`
- Microsoft: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`

### Observability
- `OTEL_EXPORTER_OTLP_ENDPOINT` (default: https://alloy.monitoring.svc.cluster.local:4318)
- `OTEL_SERVICE_NAME` (default: api)
- `LOG_LEVEL` (default: Info)
- `NODE_ENV` (defaults to development if not production)
- `HOSTNAME` (default: random UUID)
- `K8S_NAMESPACE` (default: empty)
- `K8S_POD_NAME` (default: empty)

### Session/Cache
- `REDIS_URL` (optional, for session storage)

### Security
- `API_BASE_URL` - Used to determine if cookies are secure (https://)
- `POSTGRES_SSL` (default: false)

**Secrets location:**
- Environment variables (recommended for production)
- `.env` files (development only, never committed)

## Webhooks & Callbacks

**Incoming:**
- OAuth callback endpoints
  - `GET /api/auth/oauth/github/callback`
  - `GET /api/auth/oauth/google/callback`
  - `GET /api/auth/oauth/apple/callback`
  - `GET /api/auth/oauth/microsoft/callback`

**Outgoing:**
- OpenTelemetry export (gRPC/HTTP to OTEL collector)
- Potential webhooks for job status events via Server-Sent Events (SSE)
  - Implementation: `packages/server/src/infra/jobs.ts` exposes `onStatusChange()` for real-time job dashboards

## Polling & Background Jobs

**Background Job System:**
- Database-backed job queue
  - Implementation: `packages/server/src/infra/jobs.ts`
  - Storage: PostgreSQL `jobs` table with status field
  - Features: Atomic claim (SELECT FOR UPDATE SKIP LOCKED), retry with exponential backoff, circuit breaker protection
  - Concurrency: 5 jobs max (configurable)
  - Retry: Exponential backoff (1s base, 10m cap, 2x factor)
  - Poll intervals: 1s when busy, 10s when idle

**Search Polling:**
- Real-time search via PostgreSQL `LISTEN/NOTIFY`
  - Implementation: `packages/database/src/search.ts`
  - Subscribers: Consumers register poll handlers
  - Use case: Search index updates, entity change notifications

---

*Integration audit: 2026-01-26*
