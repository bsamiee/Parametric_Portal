# Environment Variables Reference

Complete catalog of environment variables used across the Parametric Portal codebase.

---

## Summary

| Service       | Current Vars | Potential Additions | Source File                                |
| ------------- | ------------ | ------------------- | ------------------------------------------ |
| PostgreSQL    | 12           | 3                   | `packages/database/src/client.ts`          |
| Redis         | 16           | 7                   | `packages/server/src/platform/cache.ts`    |
| S3 Storage    | 6            | 3                   | `packages/server/src/infra/storage.ts`     |
| OpenTelemetry | 7            | 12                  | `packages/server/src/observe/telemetry.ts` |
| OAuth         | 12           | 0                   | `packages/server/src/domain/auth.ts`       |
| AI Providers  | 3            | 0                   | `packages/ai/src/registry.ts`              |
| Cluster       | 2            | 1                   | `packages/server/src/infra/cluster.ts`     |
| Security      | 1            | 0                   | `packages/server/src/security/crypto.ts`   |
| Server        | 4            | 2                   | `apps/api/src/main.ts`, `middleware.ts`    |
| **Total**     | **63**       | **28**              |                                            |

---

## PostgreSQL (`@effect/sql-pg`)

**Source:** [packages/database/src/client.ts](../packages/database/src/client.ts)

### Currently Implemented

| Variable                      | Type     | Default          | Required | Description                              |
| ----------------------------- | -------- | ---------------- | -------- | ---------------------------------------- |
| `DATABASE_URL`                | Redacted | —                | No       | Full connection URL (alternative config) |
| `POSTGRES_HOST`               | string   | `localhost`      | No       | Database hostname                        |
| `POSTGRES_PORT`               | number   | `5432`           | No       | Database port                            |
| `POSTGRES_DB`                 | string   | `parametric`     | No       | Database name                            |
| `POSTGRES_USER`               | string   | `postgres`       | No       | Username                                 |
| `POSTGRES_PASSWORD`           | Redacted | —                | Yes      | Password (Config.redacted)               |
| `POSTGRES_SSL`                | boolean  | `false`          | No       | Enable SSL connection                    |
| `POSTGRES_APP_NAME`           | string   | `parametric-api` | No       | Application name for pg_stat_activity    |
| `POSTGRES_POOL_MAX`           | number   | `20`             | No       | Maximum connections in pool              |
| `POSTGRES_POOL_MIN`           | number   | `2`              | No       | Minimum connections in pool              |
| `POSTGRES_IDLE_TIMEOUT_MS`    | number   | `30000`          | No       | Idle connection timeout (ms)             |
| `POSTGRES_CONNECT_TIMEOUT_MS` | number   | `5000`           | No       | Connection timeout (ms)                  |
| `POSTGRES_CONNECTION_TTL_MS`  | number   | `3600000`        | No       | Connection TTL (1 hour default)          |

### Missing from API

Based on `@effect/sql-pg` PgClientConfig interface:

| Variable            | Type   | Description                    |
| ------------------- | ------ | ------------------------------ |
| `POSTGRES_SSL_CA`   | string | Path to CA certificate for SSL |
| `POSTGRES_SSL_CERT` | string | Path to client certificate     |
| `POSTGRES_SSL_KEY`  | string | Path to client private key     |

> **Note:** The `ssl` option accepts `boolean | ConnectionOptions`. For mTLS, extend config to accept certificate paths.

---

## Redis (`ioredis`)

**Source:** [packages/server/src/platform/cache.ts](../packages/server/src/platform/cache.ts)

### Currently Implemented

| Variable                        | Type     | Default     | Required | Description                      |
| ------------------------------- | -------- | ----------- | -------- | -------------------------------- |
| `REDIS_HOST`                    | string   | `localhost` | No       | Redis hostname                   |
| `REDIS_PORT`                    | number   | `6379`      | No       | Redis port                       |
| `REDIS_PASSWORD`                | Redacted | —           | No       | Password (empty = no auth)       |
| `REDIS_USERNAME`                | string   | `default`   | No       | Username (Redis 6+ ACL)          |
| `REDIS_DB`                      | number   | `0`         | No       | Database index (0-15)            |
| `REDIS_TLS`                     | boolean  | `false`     | No       | Enable TLS                       |
| `REDIS_TLS_CA`                  | string   | —           | No       | Path to CA certificate           |
| `REDIS_TLS_CERT`                | string   | —           | No       | Path to client certificate       |
| `REDIS_TLS_KEY`                 | string   | —           | No       | Path to client private key       |
| `REDIS_TLS_SERVERNAME`          | string   | —           | No       | TLS server name (SNI)            |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | boolean  | `true`      | No       | Reject unauthorized certificates |
| `REDIS_CONNECT_TIMEOUT`         | number   | `10000`     | No       | Connection timeout (ms)          |
| `REDIS_SOCKET_TIMEOUT`          | number   | `0`         | No       | Socket timeout (0 = none)        |
| `REDIS_COMMAND_TIMEOUT`         | number   | `0`         | No       | Command timeout (0 = none)       |
| `REDIS_MAX_RETRIES`             | number   | `3`         | No       | Max reconnection attempts        |
| `CACHE_PREFIX`                  | string   | `pp:`       | No       | Key prefix for namespacing       |

### Missing from API

Based on ioredis CommonRedisOptions:

| Variable                        | Type    | Default | Description                               |
| ------------------------------- | ------- | ------- | ----------------------------------------- |
| `REDIS_READY_CHECK`             | boolean | `true`  | Wait for server ready before commands     |
| `REDIS_LAZY_CONNECT`            | boolean | `false` | Delay connection until first command      |
| `REDIS_ENABLE_OFFLINE_QUEUE`    | boolean | `true`  | Queue commands when disconnected          |
| `REDIS_MAX_RETRIES_PER_REQUEST` | number  | `20`    | Max retries per command (null = infinite) |
| `REDIS_AUTO_RESUBSCRIBE`        | boolean | `true`  | Auto-resubscribe after reconnect          |
| `REDIS_AUTO_RESEND_UNFULFILLED` | boolean | `true`  | Resend pending commands after reconnect   |
| `REDIS_KEEP_ALIVE`              | number  | `0`     | TCP keep-alive interval (ms)              |

---

## S3 Storage (`@effect-aws/client-s3`)

**Source:** [packages/server/src/infra/storage.ts](../packages/server/src/infra/storage.ts)

### Currently Implemented

| Variable                    | Type     | Default                    | Required | Description                 |
| --------------------------- | -------- | -------------------------- | -------- | --------------------------- |
| `STORAGE_ACCESS_KEY_ID`     | string   | —                          | Yes      | AWS access key ID           |
| `STORAGE_SECRET_ACCESS_KEY` | Redacted | —                          | Yes      | AWS secret access key       |
| `STORAGE_BUCKET`            | string   | `parametric`               | No       | S3 bucket name              |
| `STORAGE_ENDPOINT`          | string   | `https://s3.amazonaws.com` | No       | S3 endpoint (MinIO etc.)    |
| `STORAGE_REGION`            | string   | `us-east-1`                | No       | AWS region                  |
| `STORAGE_FORCE_PATH_STYLE`  | boolean  | `false`                    | No       | Use path-style URLs (MinIO) |

### Missing from API

Based on AWS SDK S3ClientConfig:

| Variable                | Type   | Default    | Description                                  |
| ----------------------- | ------ | ---------- | -------------------------------------------- |
| `STORAGE_SESSION_TOKEN` | string | —          | Temporary credential session token           |
| `STORAGE_MAX_ATTEMPTS`  | number | `3`        | Max retry attempts                           |
| `STORAGE_RETRY_MODE`    | string | `standard` | Retry mode: `standard`, `adaptive`, `legacy` |

---

## OpenTelemetry (OTLP)

**Source:** [packages/server/src/observe/telemetry.ts](../packages/server/src/observe/telemetry.ts)

### Currently Implemented

| Variable                      | Type   | Default                 | Required | Description                   |
| ----------------------------- | ------ | ----------------------- | -------- | ----------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | `http://localhost:4318` | No       | OTLP collector endpoint       |
| `OTEL_EXPORTER_OTLP_HEADERS`  | string | —                       | No       | Comma-separated headers       |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | string | `http/protobuf`         | No       | Protocol: grpc, http/protobuf |
| `OTEL_SERVICE_NAME`           | string | `parametric-api`        | No       | Service name for traces       |
| `LOG_LEVEL`                   | string | `info`                  | No       | Logging level                 |
| `TELEMETRY_LOG_SINK`          | string | `console`               | No       | Log sink: console, otlp, none |
| `NODE_ENV`                    | string | `development`           | No       | Environment name              |

### Missing from OpenTelemetry Spec

Standard OTEL environment variables not yet exposed:

| Variable                         | Type   | Default                 | Description                         |
| -------------------------------- | ------ | ----------------------- | ----------------------------------- |
| `OTEL_EXPORTER_OTLP_TIMEOUT`     | number | `10000`                 | Export timeout (ms)                 |
| `OTEL_EXPORTER_OTLP_COMPRESSION` | string | —                       | Compression: `none`, `gzip`         |
| `OTEL_TRACES_EXPORTER`           | string | `otlp`                  | Trace exporter: otlp, console, none |
| `OTEL_METRICS_EXPORTER`          | string | `otlp`                  | Metrics exporter                    |
| `OTEL_LOGS_EXPORTER`             | string | `otlp`                  | Logs exporter                       |
| `OTEL_TRACES_SAMPLER`            | string | `parentbased_always_on` | Sampler strategy                    |
| `OTEL_TRACES_SAMPLER_ARG`        | string | `1.0`                   | Sampler argument (ratio)            |
| `OTEL_BSP_MAX_QUEUE_SIZE`        | number | `2048`                  | Batch span processor queue size     |
| `OTEL_BSP_SCHEDULE_DELAY`        | number | `5000`                  | Batch export delay (ms)             |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | number | `512`                   | Max spans per batch                 |
| `OTEL_RESOURCE_ATTRIBUTES`       | string | —                       | Extra resource attributes           |
| `OTEL_PROPAGATORS`               | string | `tracecontext,baggage`  | Context propagators                 |

---

## OAuth Providers (Arctic)

**Source:** [packages/server/src/domain/auth.ts](../packages/server/src/domain/auth.ts)

| Variable                        | Type     | Required | Description                   |
| ------------------------------- | -------- | -------- | ----------------------------- |
| `API_BASE_URL`                  | string   | Yes      | Base URL for OAuth callbacks  |
| `OAUTH_GITHUB_CLIENT_ID`        | string   | No*      | GitHub OAuth client ID        |
| `OAUTH_GITHUB_CLIENT_SECRET`    | Redacted | No*      | GitHub OAuth client secret    |
| `OAUTH_GOOGLE_CLIENT_ID`        | string   | No*      | Google OAuth client ID        |
| `OAUTH_GOOGLE_CLIENT_SECRET`    | Redacted | No*      | Google OAuth client secret    |
| `OAUTH_MICROSOFT_CLIENT_ID`     | string   | No*      | Microsoft OAuth client ID     |
| `OAUTH_MICROSOFT_CLIENT_SECRET` | Redacted | No*      | Microsoft OAuth client secret |
| `OAUTH_MICROSOFT_TENANT_ID`     | string   | No       | Azure AD tenant ID (optional) |
| `OAUTH_APPLE_CLIENT_ID`         | string   | No*      | Apple OAuth client ID         |
| `OAUTH_APPLE_KEY_ID`            | string   | No*      | Apple key ID                  |
| `OAUTH_APPLE_PRIVATE_KEY`       | Redacted | No*      | Apple private key (PEM)       |
| `OAUTH_APPLE_TEAM_ID`           | string   | No*      | Apple team ID                 |

> **\*** At least one provider required for OAuth functionality.

---

## AI Providers

**Source:** [packages/ai/src/registry.ts](../packages/ai/src/registry.ts)

| Variable            | Type     | Required | Description           |
| ------------------- | -------- | -------- | --------------------- |
| `OPENAI_API_KEY`    | Redacted | No*      | OpenAI API key        |
| `ANTHROPIC_API_KEY` | Redacted | No*      | Anthropic API key     |
| `GEMINI_API_KEY`    | Redacted | No*      | Google Gemini API key |

> **\*** At least one provider required for AI functionality.

---

## Cluster (`@effect/cluster`)

**Source:** [packages/server/src/infra/cluster.ts](../packages/server/src/infra/cluster.ts)

| Variable              | Type   | Default   | Required | Description                 |
| --------------------- | ------ | --------- | -------- | --------------------------- |
| `CLUSTER_HEALTH_MODE` | string | `local`   | No       | Mode: `local`, `kubernetes` |
| `K8S_LABEL_SELECTOR`  | string | `app=api` | No       | K8s pod label selector      |
| `K8S_NAMESPACE`       | string | `default` | No       | Kubernetes namespace        |

### Missing

| Variable       | Type   | Description                          |
| -------------- | ------ | ------------------------------------ |
| `K8S_POD_NAME` | string | Pod name (injected via Downward API) |

---

## Security

**Source:** [packages/server/src/security/crypto.ts](../packages/server/src/security/crypto.ts)

| Variable         | Type     | Required | Description                            |
| ---------------- | -------- | -------- | -------------------------------------- |
| `ENCRYPTION_KEY` | Redacted | Yes      | Base64-encoded 256-bit key for AES-GCM |

---

## Server / HTTP

**Sources:**
- [apps/api/src/main.ts](../apps/api/src/main.ts)
- [packages/server/src/middleware.ts](../packages/server/src/middleware.ts)

| Variable       | Type    | Default | Required | Description                     |
| -------------- | ------- | ------- | -------- | ------------------------------- |
| `PORT`         | number  | `4000`  | No       | HTTP server port                |
| `CORS_ORIGINS` | string  | `*`     | No       | Comma-separated allowed origins |
| `TRUST_PROXY`  | boolean | `false` | No       | Trust X-Forwarded-* headers     |
| `PROXY_HOPS`   | number  | `1`     | No       | Number of trusted proxy hops    |

### Missing

| Variable              | Type   | Description                          |
| --------------------- | ------ | ------------------------------------ |
| `GRACEFUL_TIMEOUT_MS` | number | Graceful shutdown timeout            |
| `MAX_REQUEST_SIZE`    | string | Max request body size (e.g., `10mb`) |

---

## Integration Recommendations

### 1. PostgreSQL SSL Certificates

Add SSL certificate configuration for production mTLS:

```typescript
// packages/database/src/client.ts
const sslConfig = Config.all({
  ca: Config.string('POSTGRES_SSL_CA').pipe(Config.withDefault('')),
  cert: Config.string('POSTGRES_SSL_CERT').pipe(Config.withDefault('')),
  key: Config.string('POSTGRES_SSL_KEY').pipe(Config.withDefault('')),
}).pipe(
  Config.map(({ ca, cert, key }) =>
    ca ? { ca: fs.readFileSync(ca), cert: cert ? fs.readFileSync(cert) : undefined, key: key ? fs.readFileSync(key) : undefined } : true
  )
);
```

### 2. OpenTelemetry Sampler

Add trace sampling configuration for production cost control:

```typescript
// packages/server/src/observe/telemetry.ts
const samplerConfig = Config.all({
  sampler: Config.string('OTEL_TRACES_SAMPLER').pipe(Config.withDefault('parentbased_always_on')),
  arg: Config.number('OTEL_TRACES_SAMPLER_ARG').pipe(Config.withDefault(1.0)),
});
```

### 3. Redis Connection Resilience

Add offline queue and retry configuration:

```typescript
// packages/server/src/platform/cache.ts
const resilienceConfig = Config.all({
  enableOfflineQueue: Config.boolean('REDIS_ENABLE_OFFLINE_QUEUE').pipe(Config.withDefault(true)),
  maxRetriesPerRequest: Config.number('REDIS_MAX_RETRIES_PER_REQUEST').pipe(Config.withDefault(20)),
  lazyConnect: Config.boolean('REDIS_LAZY_CONNECT').pipe(Config.withDefault(false)),
});
```

### 4. S3 Retry Configuration

Add retry mode for reliability:

```typescript
// packages/server/src/infra/storage.ts
const retryConfig = Config.all({
  maxAttempts: Config.number('STORAGE_MAX_ATTEMPTS').pipe(Config.withDefault(3)),
  retryMode: Config.literal('standard', 'adaptive', 'legacy')('STORAGE_RETRY_MODE').pipe(Config.withDefault('standard')),
});
```

### 5. Graceful Shutdown

Add server shutdown configuration:

```typescript
// apps/api/src/main.ts
const serverConfig = Config.all({
  gracefulTimeout: Duration.millis(Config.number('GRACEFUL_TIMEOUT_MS').pipe(Config.withDefault(30000))),
});
```

---

## .env Template

```bash
# ═══════════════════════════════════════════════════════════════════════════
# CORE INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════════════════

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=parametric
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password
POSTGRES_SSL=false
POSTGRES_APP_NAME=parametric-api
POSTGRES_POOL_MAX=20
POSTGRES_POOL_MIN=2

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_TLS=false

# S3 / MinIO
STORAGE_ACCESS_KEY_ID=minioadmin
STORAGE_SECRET_ACCESS_KEY=minioadmin
STORAGE_BUCKET=parametric
STORAGE_ENDPOINT=http://localhost:9000
STORAGE_REGION=us-east-1
STORAGE_FORCE_PATH_STYLE=true

# ═══════════════════════════════════════════════════════════════════════════
# OBSERVABILITY
# ═══════════════════════════════════════════════════════════════════════════

OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_SERVICE_NAME=parametric-api
LOG_LEVEL=info
NODE_ENV=development

# ═══════════════════════════════════════════════════════════════════════════
# SECURITY
# ═══════════════════════════════════════════════════════════════════════════

ENCRYPTION_KEY=base64-encoded-256-bit-key-here

# ═══════════════════════════════════════════════════════════════════════════
# OAUTH PROVIDERS (configure at least one)
# ═══════════════════════════════════════════════════════════════════════════

API_BASE_URL=http://localhost:4000

# GitHub
OAUTH_GITHUB_CLIENT_ID=
OAUTH_GITHUB_CLIENT_SECRET=

# Google
OAUTH_GOOGLE_CLIENT_ID=
OAUTH_GOOGLE_CLIENT_SECRET=

# Microsoft
OAUTH_MICROSOFT_CLIENT_ID=
OAUTH_MICROSOFT_CLIENT_SECRET=
OAUTH_MICROSOFT_TENANT_ID=

# Apple
OAUTH_APPLE_CLIENT_ID=
OAUTH_APPLE_KEY_ID=
OAUTH_APPLE_PRIVATE_KEY=
OAUTH_APPLE_TEAM_ID=

# ═══════════════════════════════════════════════════════════════════════════
# AI PROVIDERS (configure at least one)
# ═══════════════════════════════════════════════════════════════════════════

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

# ═══════════════════════════════════════════════════════════════════════════
# SERVER
# ═══════════════════════════════════════════════════════════════════════════

PORT=4000
CORS_ORIGINS=*
TRUST_PROXY=false
```

---

## Doppler Configuration

For production, use Doppler to manage secrets:

```bash
# Initialize project
doppler setup

# List all configs
doppler secrets

# Run with injected secrets
doppler run -- pnpm start

# Sync to .env (development only)
doppler secrets download --no-file --format env > .env.local
```
