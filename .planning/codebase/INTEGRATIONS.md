# External Integrations

**Analysis Date:** 2026-02-22

## APIs & External Services

**AI Providers (multi-provider, tenant-configurable):**
- Anthropic Claude - Language models via `@effect/ai-anthropic`
  - SDK/Client: `@effect/ai-anthropic` 0.23.0
  - Auth: `ANTHROPIC_API_KEY` (redacted, required secret)
  - Config: `packages/ai/src/registry.ts`, model/temperature/maxTokens per tenant app settings
- OpenAI - Language models + embeddings via `@effect/ai-openai`
  - SDK/Client: `@effect/ai-openai` 0.37.2
  - Auth: `OPENAI_API_KEY` (redacted, required secret)
  - Default embedding model: `text-embedding-3-small`
- Google Gemini - Language model fallback via `@effect/ai-google`
  - SDK/Client: `@effect/ai-google` 0.12.1
  - Auth: `GEMINI_API_KEY` (redacted, required secret)
- All three configured in `packages/ai/src/registry.ts`; provider selected per tenant with fallback chain

**MCP (Model Context Protocol):**
- Effect-native MCP server layer via `@effect/ai` McpServer
  - Transports: Stdio, Http, HttpRouter
  - Implementation: `packages/ai/src/mcp.ts`

**Secrets Management:**
- Doppler - Runtime secrets provisioning with auto-refresh
  - SDK/Client: `@dopplerhq/node-sdk` 1.3.0
  - Auth: `DOPPLER_TOKEN` (redacted), `DOPPLER_PROJECT`, `DOPPLER_CONFIG`
  - Implementation: `packages/server/src/platform/doppler.ts`
  - Refresh interval: configurable via `DOPPLER_REFRESH_MS` (default 300,000ms)

**Code Quality & Analysis:**
- SonarCloud - Static analysis, security scanning
  - Config: `sonar-project.properties`
  - CI: `.github/workflows/sonarcloud.yml`
  - Project key: `bsamiee_Parametric_Portal`, org: `bsamiee`

**Workflow Automation:**
- n8n - Server-side workflow automation (SSH-deployed)
  - Sync: `.github/workflows/n8n-sync.yml` deploys via SSH on push to main
  - Auth: `N8N_HOST`, `N8N_USER`, `N8N_SSH_KEY` GitHub secrets

**Load Testing:**
- k6 - Grafana k6 load tests (types declared, `@types/k6` in devDeps)
  - Declared in root `package.json` devDependencies but test files not yet populated

## Data Storage

**Databases:**
- PostgreSQL 18.2 (primary datastore)
  - Connection: `DATABASE_URL` (redacted, required)
  - Client: `@effect/sql-pg` 0.50.3 + `@effect/sql` 0.49.0 (Effect-native SQL)
  - .NET client: Npgsql 10.0.1 (for C# services)
  - Pool: 2–10 connections (configurable via `POSTGRES_POOL_MIN`/`POSTGRES_POOL_MAX`)
  - Extensions: pg_trgm (trigram search), configurable shared_preload_libraries
  - Migrations: `packages/database/src/migrator.ts`
  - Tenant isolation: row-level via `set_config('app.current_tenant', tenantId, true)`
  - Schema: `packages/database/src/models.ts`, `packages/database/src/repos.ts`

**File / Object Storage:**
- S3-compatible (dual-mode):
  - Cloud: AWS S3 via `@aws-sdk/client-s3` 3.995.0 + `@effect-aws/client-s3` 1.10.9
  - Self-hosted: Garage v2.2.0 (S3-compatible object store deployed via Docker Compose)
  - Auth: `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` (redacted, required)
  - Config: `STORAGE_BUCKET` (default `parametric`), `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_FORCE_PATH_STYLE`
  - Implementation: `packages/server/src/infra/storage.ts`, `packages/server/src/domain/storage.ts`
  - Pre-signed URL generation: `@aws-sdk/s3-request-presigner` 3.995.0

**Caching:**
- Redis 8.6.0 (ioredis 5.9.3)
  - Connection: `REDIS_HOST`/`REDIS_PORT` (standalone) or `REDIS_SENTINEL_NODES`/`REDIS_SENTINEL_NAME` (Sentinel)
  - Auth: `REDIS_PASSWORD` (redacted, required), optional `REDIS_USERNAME`
  - Modes: `standalone` (default) or `sentinel` (configurable via `REDIS_MODE`)
  - TLS: supported via `REDIS_TLS`, `REDIS_TLS_CA`/`REDIS_TLS_CERT`/`REDIS_TLS_KEY`
  - Implementation: `packages/server/src/platform/cache.ts`
  - Uses: session cache, rate limiting, pub/sub for WebSocket broadcast, TOTP replay prevention
  - Rate limit stores: `redis` (default) or `memory` (configurable via `RATE_LIMIT_STORE`)
  - Rate limit fail modes: `closed` (auth/MFA — deny on failure) vs `open` (API — allow on failure)
  - Cross-pod sync: PostgreSQL LISTEN/NOTIFY + Redis pub/sub fallback

## Authentication & Identity

**Session Management:**
- Custom session service with configurable max sessions per user
  - Config: `MAX_SESSIONS_PER_USER` (default 5), `SESSION_CACHE_CAPACITY` (default 5000), `SESSION_CACHE_TTL_SECONDS` (default 300)
  - Implementation: `packages/server/src/domain/auth.ts`

**OAuth 2.0 (via `arctic` 3.7.0):**
- GitHub OAuth - `OAUTH_GITHUB_CLIENT_SECRET`
- Google OAuth - `OAUTH_GOOGLE_CLIENT_SECRET`
- Apple Sign In - `OAUTH_APPLE_PRIVATE_KEY` (requires `teamId`, `keyId`)
- Microsoft Entra ID - `OAUTH_MICROSOFT_CLIENT_SECRET`
- PKCE flow with state verification; provider config stored per-tenant in database
- Implementation: `packages/server/src/domain/auth.ts`

**WebAuthn / Passkeys:**
- `@simplewebauthn/server` 13.2.2 - Passkey registration and assertion
  - Config: `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`
  - Implementation: `packages/server/src/domain/auth.ts`

**TOTP / MFA:**
- `otplib` 13.3.0 - Time-based OTP generation/verification
  - Replay prevention via Redis (`packages/server/src/security/totp-replay.ts`)

**Encryption:**
- Custom AES-GCM encryption service (`packages/server/src/security/crypto.ts`)
  - Key rotation: `ENCRYPTION_KEY` (single) or `ENCRYPTION_KEYS` (rotation set)
  - Version tracking: `ENCRYPTION_KEY_VERSION`

## Email

**Multi-provider abstraction** (`packages/server/src/infra/email.ts`); provider selected via `EMAIL_PROVIDER`:

- **Resend** (default) - HTTP REST via `@effect/platform` FetchHttpClient
  - Auth: `RESEND_API_KEY`
  - Endpoint: `RESEND_ENDPOINT` (default `https://api.resend.com/emails`)

- **Postmark** - HTTP REST via FetchHttpClient
  - Auth: `POSTMARK_TOKEN`
  - Endpoint: `POSTMARK_ENDPOINT` (default `https://api.postmarkapp.com/email/withTemplate`)

- **AWS SES** - `@aws-sdk/client-sesv2` 3.995.0
  - Auth: inherits storage credentials (AWS SDK default chain)
  - Config: `SES_REGION`, optional `SES_ENDPOINT`

- **SMTP** - `nodemailer` 8.0.1
  - Config: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`

## Monitoring & Observability

**Tracing / Metrics / Logs:**
- OpenTelemetry OTLP export (`@effect/opentelemetry` 0.61.0)
  - Endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT`
  - Per-signal overrides: `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT`, `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`
  - Protocol: `http/protobuf` (default) or `http/json`
  - Implementation: `packages/server/src/observe/telemetry.ts`

**Self-hosted Observability Stack** (Pulumi-provisioned, `infrastructure/src/deploy.ts`):
- Grafana Alloy v1.13.0 - OTLP receiver (gRPC port 4317, HTTP port 4318); forwards to Prometheus
- Prometheus v3.5.1 - Metrics storage and scraping
- Grafana v12.3.3 - Dashboard and visualization
  - Auth: `GRAFANA_ADMIN_PASSWORD` (required for self-hosted mode)
  - Storage: configurable via `GRAFANA_STORAGE_GB`, `PROMETHEUS_STORAGE_GB`

**Application Metrics:**
- Custom metrics service: `packages/server/src/observe/metrics.ts`
- Polling health monitor: `packages/server/src/observe/polling.ts`
- Audit logging: `packages/server/src/observe/audit.ts`

**Code Quality Monitoring:**
- SonarCloud - Static analysis via `@sonar/scan` 4.3.4 (`.github/workflows/sonarcloud.yml`)

## CI/CD & Deployment

**CI Pipeline:**
- GitHub Actions (`.github/workflows/ci.yml`) — triggers on PR + push to main + weekly schedule
- Quality gate: Biome check, TypeScript typecheck, Knip, sherif
- Docker builds via `@nx-tools/nx-container`
- Container registry: GitHub Container Registry (`ghcr.io`)

**Deployment:**
- Pulumi (TypeScript, `infrastructure/`) — IaC for both cloud and self-hosted
- Cloud: AWS EKS + RDS + ElastiCache + S3 (via `@pulumi/aws`, `@pulumi/awsx`, `@pulumi/kubernetes`)
- Self-hosted: Docker Compose with Traefik v3.6.8 (HTTPS via ACME/Let's Encrypt, `ACME_EMAIL`)
- Triggered by `.github/workflows/deploy.yml` — runs after CI passes on main

**Container Images** (pinned in `infrastructure/src/deploy.ts`):
- Grafana Alloy `grafana/alloy:v1.13.0`
- Garage `dxflrs/garage:v2.2.0`
- Grafana `grafana/grafana:12.3.3`
- PostgreSQL `postgres:18.2-alpine`
- Prometheus `prom/prometheus:v3.5.1`
- Redis `redis:8.6.0-alpine`
- Traefik `traefik:v3.6.8`

**Kubernetes:**
- Nginx ingress controller (SSL redirect, 50MB body limit)
- Health probes: `/api/health/liveness` + `/api/health/readiness` on port 4000
- HPA: configurable CPU/memory targets (`HPA_CPU_TARGET`, `HPA_MEMORY_TARGET`)
- Cluster leadership: `packages/server/src/infra/cluster.ts` (K8s or ping mode)

## Webhooks & Callbacks

**Outgoing (User-configurable):**
- Durable webhook delivery via `@effect/workflow` (`packages/server/src/infra/webhooks.ts`)
- HMAC-SHA256 signature on `X-Webhook-Signature` header
- Endpoints: tenant-configurable HTTPS URLs (enforced by regex: `^https://[a-zA-Z0-9]`)
- Delivery: idempotent by `payload.id:endpoint.url`; retryable errors back off, terminal errors go to DLQ
- Timeout: configurable per-endpoint (default 5000ms)
- Config: `WEBHOOK_VERIFY_MAX_RETRIES`, `WEBHOOK_VERIFY_TIMEOUT_MS`

**Incoming:**
- OAuth callbacks: `GET /api/auth/oauth/{provider}/callback` for each enabled OAuth provider
- WebSocket endpoint for real-time subscriptions (`packages/server/src/platform/websocket.ts`)

## Rhino3D / CAD Integration

**Rhino.Inside (C# plugin — `apps/kargadan/`):**
- RhinoCommon 9.0.25350.305-wip - Rhino3D geometry API
- Rhino.Inside 9.0.26013.15500-beta - Embeds Rhino runtime in external .NET process
- Plugin: `apps/kargadan/plugin/src/boundary/KargadanPlugin.cs`
- Harness: TypeScript side in `apps/kargadan/harness/src/` using `@effect/platform-node` WebSocket/RPC
- Protocol models: `apps/kargadan/plugin/src/contracts/ProtocolModels.cs`
- 3D asset processing: `@gltf-transform/core` 4.3.0 for GLTF/GLB mesh transforms on TypeScript side

## Environment Configuration

**Required env vars (all runtime):**
- `DATABASE_URL` - PostgreSQL connection string
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` - AI providers
- `REDIS_PASSWORD` - Redis auth
- `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` - Object storage
- `DOPPLER_TOKEN`, `DOPPLER_PROJECT`, `DOPPLER_CONFIG` - Secrets service
- `DEPLOYMENT_MODE` - `cloud` or `selfhosted`
- `ENCRYPTION_KEY` or `ENCRYPTION_KEYS` - Data encryption

**Required only for cloud mode:**
- `API_CPU`, `API_MEMORY`, `API_DOMAIN`, `API_REPLICAS`, `API_MIN_REPLICAS`, `API_MAX_REPLICAS`
- `AZ_COUNT`, `CACHE_NODE_TYPE`, `DB_CLASS`, `DB_STORAGE_GB`
- `HPA_CPU_TARGET`, `HPA_MEMORY_TARGET`, `OBSERVE_RETENTION_DAYS`, `PROMETHEUS_STORAGE_GB`, `GRAFANA_STORAGE_GB`

**Required only for self-hosted mode:**
- `ACME_EMAIL` - Let's Encrypt certificate provisioning
- `GRAFANA_ADMIN_PASSWORD`
- `OBSERVE_RETENTION_DAYS`

**Secrets location:**
- Production: Doppler project secrets, injected via `DopplerService` at runtime
- Local dev: `.env` file (never committed); defaults applied for all optional vars

---

*Integration audit: 2026-02-22*
