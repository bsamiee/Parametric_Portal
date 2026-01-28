# External Integrations

**Analysis Date:** 2026-01-28

## APIs & External Services

**AI/LLM Providers:**
- Anthropic Claude - Text generation, tool use
  - SDK/Client: `@effect/ai-anthropic` 0.23.0
  - Auth: `ANTHROPIC_API_KEY`
  - Registry: `packages/ai/src/registry.ts`

- Google Gemini - Text generation
  - SDK/Client: `@effect/ai-google` 0.12.1
  - Auth: `GEMINI_API_KEY`
  - Registry: `packages/ai/src/registry.ts`

- OpenAI - Text generation
  - SDK/Client: `@effect/ai-openai` 0.37.2
  - Auth: `OPENAI_API_KEY`
  - Registry: `packages/ai/src/registry.ts`

**OAuth Providers:**
- GitHub OAuth - User authentication
  - SDK/Client: `arctic` 3.7.0
  - Auth: `OAUTH_GITHUB_CLIENT_ID`, `OAUTH_GITHUB_CLIENT_SECRET`
  - Implementation: `packages/server/src/domain/oauth.ts`

- Google OAuth - User authentication
  - SDK/Client: `arctic` 3.7.0
  - Auth: `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`
  - Implementation: `packages/server/src/domain/oauth.ts`

- Microsoft Entra ID - User authentication
  - SDK/Client: `arctic` 3.7.0
  - Auth: `OAUTH_MICROSOFT_CLIENT_ID`, `OAUTH_MICROSOFT_CLIENT_SECRET`, `OAUTH_MICROSOFT_TENANT_ID`
  - Implementation: `packages/server/src/domain/oauth.ts`

- Apple ID - User authentication
  - SDK/Client: `arctic` 3.7.0
  - Auth: `OAUTH_APPLE_CLIENT_ID`, `OAUTH_APPLE_KEY_ID`, `OAUTH_APPLE_PRIVATE_KEY`, `OAUTH_APPLE_TEAM_ID`
  - Implementation: `packages/server/src/domain/oauth.ts`

## Data Storage

**Databases:**
- PostgreSQL 18+
  - Connection: `DATABASE_URL` (redacted Config)
  - Client: `@effect/sql-pg` 0.50.1
  - ORM: Custom Effect-based repositories
  - Migration: `packages/database/src/migrator.ts`
  - Location: `packages/database/src/client.ts`

**Object Storage:**
- S3-compatible (AWS S3 or MinIO)
  - Connection: `STORAGE_ENDPOINT` (optional), `STORAGE_REGION`, `STORAGE_BUCKET`
  - Credentials: `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`
  - Client: `@effect-aws/client-s3` 1.10.9, `@aws-sdk/client-s3` 3.975.0
  - Features: Multipart uploads, presigned URLs, tenant isolation
  - Location: `packages/server/src/infra/storage.ts`

**Caching:**
- Redis 7+
  - Connection: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
  - Client: `ioredis` 5.9.2
  - Features: Session storage, rate limiting, TOTP replay prevention, pub/sub
  - Location: `packages/server/src/platform/cache.ts`

## Authentication & Identity

**Auth Provider:**
- Custom session-based authentication
  - Implementation: Effect service-based
  - Session store: Redis
  - Multi-factor: TOTP via `otplib` 13.2.1
  - OAuth integration: GitHub, Google, Microsoft, Apple
  - Locations:
    - Sessions: `packages/server/src/domain/session.ts`
    - MFA: `packages/server/src/domain/mfa.ts`
    - OAuth: `packages/server/src/domain/oauth.ts`

## Monitoring & Observability

**OpenTelemetry:**
- OTLP Exporter
  - Endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT`
  - SDK: `@effect/opentelemetry` 0.61.0
  - Traces, metrics, logs
  - Location: `packages/server/src/observe/telemetry.ts`

**Metrics:**
- Prometheus-compatible metrics
  - Custom Effect metrics service
  - Counters, gauges, histograms for storage, cache, HTTP operations
  - Location: `packages/server/src/observe/metrics.ts`

**Error Tracking:**
- OpenTelemetry traces (can export to any OTLP-compatible backend)

**Logs:**
- Effect logger with configurable levels
  - Level: `LOG_LEVEL` (Debug, Info, Warning, Error)
  - Format: Structured JSON via Effect logger
  - Location: `packages/server/src/observe/telemetry.ts`

**Audit:**
- Custom audit log service
  - Storage: Database (audit events table)
  - Location: `packages/server/src/observe/audit.ts`

## CI/CD & Deployment

**Hosting:**
- Kubernetes (self-hosted or cloud)
  - Manifests: `infrastructure/projects/parametric-portal/`
  - Platform services: `infrastructure/platform/`

**Container Registry:**
- Docker images via GitHub Actions
  - Dockerfile: `apps/api/Dockerfile`
  - Base: `node:22-slim-bookworm`

**CI Pipeline:**
- GitHub Actions
  - Workflow: `.github/workflows/ci.yml`
  - Jobs: Quality checks, dependency audit, CodeQL, secrets scan
  - Nx affected tasks for incremental builds
  - Playwright browser testing

**Deployment Tools:**
- ArgoCD (GitOps)
  - Config: `infrastructure/argocd/`
- Kustomize (manifest templating)
  - Overlays: `infrastructure/projects/*/overlays/prod/`

**Infrastructure Services:**
- CloudNativePG operator (PostgreSQL clusters)
  - Config: `infrastructure/platform/postgres/cluster.yaml`
- MinIO operator (S3-compatible storage)
  - Config: `infrastructure/platform/minio/tenant.yaml`
- Cert-manager (TLS certificates)
  - Config: `infrastructure/platform/cert-manager/`
- Kyverno (policy enforcement)
  - Config: `infrastructure/platform/kyverno/`

## Environment Configuration

**Required env vars:**
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT` - Redis connection
- `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` - S3 credentials
- `OAUTH_*_CLIENT_ID`, `OAUTH_*_CLIENT_SECRET` - OAuth providers
- `PORT` - HTTP server port (default: 4000)
- `CORS_ORIGINS` - Allowed CORS origins (comma-separated)

**Optional env vars:**
- `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY` - AI providers
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OpenTelemetry collector
- `LOG_LEVEL` - Logging verbosity
- `STORAGE_ENDPOINT` - Custom S3 endpoint (for MinIO)
- `REDIS_PASSWORD` - Redis authentication

**Secrets location:**
- Kubernetes Secrets (managed via Kustomize)
- Development: Environment variables (no `.env` files checked in)

## Webhooks & Callbacks

**Incoming:**
- OAuth callback endpoints (GitHub, Google, Microsoft, Apple)
  - Pattern: `/api/oauth/{provider}/callback`
  - Handler: `packages/server/src/domain/oauth.ts`

**Outgoing:**
- Webhook delivery system (in development)
  - Design: `packages/server/src/infra/webhooks.ts`
  - Features: Retry, signatures, dead-letter queue, circuit breaker
  - Queue: JobService via database
  - Dependencies: `@effect/workflow` for saga pattern

## Real-time Communication

**WebSocket:**
- Effect platform WebSocket support
  - Design: `packages/server/src/platform/websocket.ts`
  - Features: Rooms, pub/sub, cross-instance via Redis
  - RPC: `@effect/rpc` for typed messages
  - State machine: `@effect/experimental` Machine

**Streaming:**
- Server-Sent Events (SSE)
  - Design: `packages/server/src/platform/streaming.ts`
  - Use case: Real-time updates, long-polling alternative

## Background Jobs

**Job Queue:**
- Custom Effect-based job service
  - Storage: PostgreSQL (job queue table)
  - Features: Scheduling, retry, concurrency control
  - Workers: Polling service via `packages/server/src/observe/polling.ts`
  - Location: `packages/server/src/infra/jobs.ts`

---

*Integration audit: 2026-01-28*
