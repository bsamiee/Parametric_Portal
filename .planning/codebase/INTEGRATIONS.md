# External Integrations

**Analysis Date:** 2026-02-13

## APIs & External Services

**Language Models & AI:**
- OpenAI - Text generation, embeddings (primary AI provider)
  - SDK/Client: `@effect/ai-openai` 0.37.2 via `AiRegistry`
  - Auth: `OPENAI_API_KEY` (redacted config)
  - Implementation: `packages/ai/src/registry.ts`, `packages/ai/src/runtime.ts`

- Anthropic - Text generation (fallback provider)
  - SDK/Client: `@effect/ai-anthropic` 0.23.0
  - Auth: `ANTHROPIC_API_KEY` (redacted config)
  - Usage: Configured as fallback in language model selection

- Google Gemini - Text generation (fallback provider)
  - SDK/Client: `@effect/ai-google` 0.12.1
  - Auth: `GEMINI_API_KEY` (redacted config)
  - Usage: Secondary fallback in multi-provider setup

**Email Services:**
- Resend - Transactional email (primary provider)
  - SDK/Client: Custom HTTP client via @effect/platform
  - Auth: `RESEND_API_KEY` (redacted config)
  - Endpoint: `RESEND_ENDPOINT` (default: `https://api.resend.com/emails`)
  - Implementation: `packages/server/src/infra/email.ts`

- AWS SES (Simple Email Service) - Email backend
  - SDK/Client: `@aws-sdk/client-sesv2` 3.989.0
  - Region: `SES_REGION` (default: us-east-1)
  - Endpoint: `SES_ENDPOINT` (optional override)
  - Implementation: `packages/server/src/infra/email.ts`

- Postmark - Transactional email (alternative provider)
  - SDK/Client: Custom HTTP client
  - Auth: `POSTMARK_TOKEN` (redacted config)
  - Endpoint: `POSTMARK_ENDPOINT` (default: `https://api.postmarkapp.com/email/withTemplate`)

- SMTP - Generic email fallback
  - SDK/Client: `nodemailer` 8.0.1
  - Config: `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASS` (redacted)
  - Flags: `SMTP_SECURE`, `SMTP_REQUIRE_TLS`
  - Implementation: `packages/server/src/infra/email.ts`

## Data Storage

**Databases:**
- PostgreSQL 18.1
  - Connection: `DATABASE_URL` (standard libpq connection string)
  - Client: `@effect/sql-pg` with PgClient pooling
  - Pool config: `POSTGRES_POOL_MIN` (default 2), `POSTGRES_POOL_MAX` (default 10)
  - Connection TTL: `POSTGRES_CONNECTION_TTL_MS` (default 900,000ms)
  - Timeouts: statement (30s), lock (10s), idle in transaction (60s), transaction (120s)
  - SSL config: `POSTGRES_SSL_*` for TLS connections
  - Application: `POSTGRES_APP_NAME` (default: parametric-portal)
  - Full-text search: pg_trgm extension with similarity thresholds
  - Implementation: `packages/database/src/client.ts`

**File Storage:**
- AWS S3 or S3-compatible (primary)
  - SDK/Client: `@effect-aws/client-s3` 1.10.9, `@aws-sdk/client-s3` 3.989.0
  - Auth: `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (redacted)
  - Bucket: `STORAGE_BUCKET`
  - Region: `STORAGE_REGION` (default: us-east-1)
  - Endpoint: `STORAGE_ENDPOINT` (optional, for S3-compatible services)
  - Path style: `STORAGE_FORCE_PATH_STYLE` (default: false)
  - Retry: `STORAGE_MAX_ATTEMPTS` (default 3), `STORAGE_RETRY_MODE` (default: standard)
  - Multipart: 5MB part size, 10MB threshold
  - Tenant isolation: automatic path prefixing (system/ or tenants/{id}/)
  - Implementation: `packages/server/src/infra/storage.ts`
  - Presigned URLs: `@aws-sdk/s3-request-presigner` for secure access

**Caching & Session Storage:**
- Redis (standalone or Sentinel)
  - Client: `ioredis` 5.9.3
  - Config modes: `REDIS_MODE` (standalone or sentinel)
  - Standalone: `REDIS_HOST`, `REDIS_PORT` (default 6379)
  - Sentinel: `REDIS_SENTINEL_NODES`, `REDIS_SENTINEL_NAME` (mymaster), `REDIS_SENTINEL_ROLE`
  - Auth: `REDIS_PASSWORD`, `REDIS_USERNAME` (both redacted, optional)
  - TLS: `REDIS_TLS_*` config, `REDIS_TLS_ENABLED` (default false)
  - Persistence: `@effect/experimental/Persistence/Redis` via PersistenceRedis
  - Namespacing: `CACHE_PREFIX` (default: persist:)
  - Implementation: `packages/server/src/platform/cache.ts`
  - Usage: Session cache, rate limiting store, TOTP replay guard, AI settings cache

**Session & Rate Limiting Store:**
- Redis-backed rate limiter via `@effect/experimental/RateLimiter`
  - Implementation: `layerStoreRedis` for persistent rate limits across instances
  - In-memory fallback: `layerStoreMemory` for development/single-instance deployments

## Authentication & Identity

**Auth Provider:**
- OAuth 2.0 (multi-provider support)
  - Implementation: Arctic SDK (`arctic` 3.7.0)
  - Providers configured: Apple, GitHub, Google, Microsoft Entra ID
  - PKCE flow: Automatic code verifier and state generation
  - Config location: `packages/server/src/domain/auth.ts`

- WebAuthn (Passkeys/FIDO2)
  - SDK/Server: `@simplewebauthn/server` 13.2.2
  - Types: `@simplewebauthn/types` 12.0.0
  - Implementation: `packages/server/src/domain/auth.ts`
  - Challenge storage: Redis with 5-minute TTL
  - Max credentials: 10 per user

- TOTP (Time-based One-Time Password)
  - SDK/Client: `otplib` 13.3.0 for generation/verification
  - Algorithm: SHA-256, 6 digits, 30-second period
  - Replay guard: `packages/server/src/security/totp-replay.ts` (Redis-backed)
  - Backup codes: 10 codes (8 characters, alphanumeric)

- Session Management:
  - Cache: In-memory with Redis persistence (5000 capacity default)
  - TTL: `SESSION_CACHE_TTL_SECONDS` (default 300s)
  - Token formats: Session and refresh tokens (JWT-like via Crypto service)
  - Max sessions: `MAX_SESSIONS_PER_USER` (default 5)

**OAuth Configuration Storage:**
- Encrypted in AppSettings.oauthProviders (database-persisted)
  - Per-provider: `clientId`, `clientSecretEncrypted`, `scopes` (optional)
  - Provider-specific: `teamId` (Apple), `keyId` (Apple)
  - Enabled flag: `enabled` boolean

## Monitoring & Observability

**Error Tracking:**
- Not detected as dedicated service (custom error handling via Domain.TaggedError)
- Error context includes tenant ID, request trace context
- Errors logged via Effect.logError with structured data

**Logs:**
- Approach: Structured logging via Effect runtime
- Integration: `@effect/opentelemetry` 0.61.0 for distributed tracing
- Spans: Automatic via Effect.fn('ServiceName.method') for services
- Request context: HttpTraceContext propagation across async boundaries
- Implementation: `packages/server/src/observe/telemetry.ts`

**Metrics:**
- Collection: Custom MetricsService (`packages/server/src/observe/metrics.ts`)
- Counters: API calls, storage operations, cache hits/misses, email sends, job processing
- Gauges: Request durations, queue depths
- Labels: Tenant ID, operation type, provider

**Audit Trail:**
- Logging: Database-persisted via AuditService
- Operations tracked: Login, create, update, delete, permission_denied, auth_failure, exports
- Storage: `auditLog` table with tenant scoping
- Implementation: `packages/server/src/observe/audit.ts`

## CI/CD & Deployment

**Hosting:**
- Not specific (multi-deployment capable)
- Kubernetes-ready: Cluster service with health checks
- Docker containerization: `@nx/docker` plugin available

**CI Pipeline:**
- Platform: GitHub Actions (workflows in `.github/workflows/`)
- Quality gates: Typecheck, Biome lint, Knip unused deps, Sherif audit, SonarCloud scan
- Mutation testing: Stryker via `pnpm test:mutate`
- e2e tests: Playwright 1.58.2 via `@nx/playwright`
- Test execution: `vitest` with coverage reporting

**Build Tools:**
- Vite 7.3.1 for all packages
- Nx 22.5.0 for task orchestration and caching
- Module federation (experimental): `@module-federation/bridge-react-webpack-plugin` available

## Environment Configuration

**Required env vars (Core):**
- `DATABASE_URL` - PostgreSQL connection string
- `NODE_ENV` - Environment (development/production)
- `STORAGE_BUCKET` - S3 bucket name
- `STORAGE_ACCESS_KEY_ID` - S3 access key (redacted)
- `STORAGE_SECRET_ACCESS_KEY` - S3 secret (redacted)
- `REDIS_HOST` - Redis hostname (default: localhost)
- `REDIS_PORT` - Redis port (default: 6379)
- `EMAIL_PROVIDER` - Provider choice: resend|ses|postmark|smtp (default: resend)

**Required env vars (OAuth):**
- `API_BASE_URL` - API endpoint for OAuth redirects (default: http://localhost:4000)
- Per-provider: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`

**Required env vars (AI):**
- `OPENAI_API_KEY` - OpenAI API key (optional if using other providers)
- `ANTHROPIC_API_KEY` - Anthropic API key (fallback)
- `GEMINI_API_KEY` - Google Gemini API key (fallback)

**Required env vars (Email):**
- Provider-specific (choose one):
  - Resend: `RESEND_API_KEY`
  - SES: (uses S3 credentials + `SES_REGION`)
  - Postmark: `POSTMARK_TOKEN`
  - SMTP: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`

**Optional env vars (documented in codebase):**
- `CORS_ORIGINS` - CORS allowed origins (default: *)
- `PORT` - HTTP server port (default: 4000)
- `REDIS_MODE` - standalone|sentinel (default: standalone)
- `REDIS_SENTINEL_NODES` - Sentinel node addresses
- `WEBHOOK_VERIFY_TIMEOUT_MS` - Webhook timeout (default: 10,000ms)
- `CLUSTER_HEALTH_MODE` - Kubernetes health check mode
- `SESSION_CACHE_CAPACITY` - Session cache size (default: 5000)
- And many others documented in each service's Config setup

**Secrets location:**
- Environment variables at runtime (never committed)
- `.env` file locally (git-ignored)
- CI/CD: GitHub Secrets or equivalent platform mechanism

## Webhooks & Callbacks

**Incoming:**
- Webhook verification endpoints: `packages/server/src/routes/webhooks.ts`
- Endpoint signature: HMAC-SHA256 based on webhook secret
- Retry logic: Configurable max retries, exponential backoff
- Storage: AppWebhook config in AppSettings (database)

**Outgoing:**
- Webhook dispatch: WebhookService (`packages/server/src/infra/webhooks.ts`)
- Event types: Defined per-app in AppSettings.webhooks
- Delivery: HTTPS with signature headers
- Timeout: `WEBHOOK_VERIFY_TIMEOUT_MS` (default 10s)
- Retry attempts: `WEBHOOK_VERIFY_MAX_RETRIES` (default 3)
- Storage: Webhook call history and retry status (implied in jobs/event journal)

## Distributed Features

**Event Bus & Job Queue:**
- System: Effect-based event distribution (EventBus, JobService)
- Implementation: `packages/server/src/infra/events.ts`, `packages/server/src/infra/jobs.ts`
- Storage: Database-backed (job status, dead-letter queue)
- DLQ checker: Configurable interval, max retries
- Crons: PollingService, PurgeService, SearchService embeddings

**Clustering (Distributed Deployment):**
- Service: ClusterService (`packages/server/src/infra/cluster.ts`)
- Kubernetes integration: Label selector queries for peer discovery
- Health checks: Liveness/readiness probes
- Configuration: `K8S_LABEL_SELECTOR`, `K8S_NAMESPACE`

**Search (AI-powered):**
- Embeddings: OpenAI text-embedding-3-small (default, 1536 dims)
- Storage: Database vector columns
- Cron: Scheduled embedding regeneration (SearchService.EmbeddingCron)
- Cache: Embedding cache with 30-minute TTL, 1000 capacity

---

*Integration audit: 2026-02-13*
