# Codebase Structure

**Analysis Date:** 2026-02-13

## Directory Layout

```
parametric-portal/
├── apps/                          # Executable applications
│   ├── api/                       # HTTP server (production backend)
│   │   ├── src/
│   │   │   ├── main.ts            # Layer composition, server startup
│   │   │   ├── migrate.ts         # Database migration runner
│   │   │   └── routes/            # HTTP route groups
│   │   │       ├── admin.ts       # Admin endpoints (tenant, feature, DB diagnostics)
│   │   │       ├── auth.ts        # OAuth, MFA, API key endpoints
│   │   │       ├── health.ts      # Liveness, readiness, cluster health
│   │   │       ├── jobs.ts        # Job subscription (SSE)
│   │   │       ├── search.ts      # Full-text, semantic, suggestion endpoints
│   │   │       ├── storage.ts     # S3 presigned URLs, asset CRUD
│   │   │       ├── transfer.ts    # Data export/import endpoints
│   │   │       ├── users.ts       # User profile, notifications, preferences
│   │   │       ├── webhooks.ts    # Webhook registration, delivery status
│   │   │       └── websocket.ts   # WebSocket upgrade endpoint
│   │   ├── Dockerfile
│   │   └── vite.config.ts
│   └── test-harness/              # Dev UI for component preview
│       └── src/
├── packages/                      # Shared libraries (published or internal)
│   ├── server/                    # Core backend business logic (30KB+ lines)
│   │   ├── src/
│   │   │   ├── api.ts             # HTTP API contract: groups, endpoints, schemas
│   │   │   ├── context.ts         # Request context (tenant, session, rate limit)
│   │   │   ├── errors.ts          # HTTP error types (tagged unions)
│   │   │   ├── middleware.ts      # Auth, CORS, rate limiting, idempotency pipeline
│   │   │   ├── domain/            # Business logic services
│   │   │   │   ├── auth.ts        # OAuth, MFA, passkey, session lifecycle
│   │   │   │   ├── features.ts    # Tenant feature flags
│   │   │   │   ├── notifications.ts # Notification delivery and preferences
│   │   │   │   ├── storage.ts     # Asset storage and soft-delete
│   │   │   │   └── transfer.ts    # Data export/import orchestration
│   │   │   ├── infra/             # Infrastructure concerns
│   │   │   │   ├── cluster.ts     # Cluster coordination (shard info, leader election)
│   │   │   │   ├── events.ts      # EventBus (pub/sub for mutations)
│   │   │   │   ├── handlers/
│   │   │   │   │   ├── tenant-lifecycle.ts # Tenant creation/activation/archival
│   │   │   │   │   └── purge.ts   # Soft-delete cleanup, schedule, sweep
│   │   │   │   ├── jobs.ts        # Job workflow dispatch via @effect/cluster
│   │   │   │   ├── storage.ts     # S3 adapter (presigned URLs, upload)
│   │   │   │   ├── email.ts       # Email sending (SMTP)
│   │   │   │   └── webhooks.ts    # Webhook delivery (with retry queue)
│   │   │   ├── observe/           # Observability
│   │   │   │   ├── audit.ts       # Mutation tracking (user action log)
│   │   │   │   ├── metrics.ts     # Application metrics (RPC latency, errors)
│   │   │   │   ├── polling.ts     # Health polling for alert state
│   │   │   │   └── telemetry.ts   # OTLP tracing, span wrapper, context capture
│   │   │   ├── platform/          # Low-level runtime
│   │   │   │   ├── cache.ts       # Redis KV + rate limit sets
│   │   │   │   ├── streaming.ts   # Server-sent events (SSE) wrapper
│   │   │   │   └── websocket.ts   # WebSocket handler (upgrade, broadcast)
│   │   │   ├── security/          # Cryptography and authorization
│   │   │   │   ├── crypto.ts      # AES-256-GCM encryption/decryption
│   │   │   │   ├── policy.ts      # RBAC (role-based access control)
│   │   │   │   └── totp-replay.ts # TOTP replay protection (nonce cache)
│   │   │   └── utils/             # Domain utilities (not "Helpers")
│   │   │       ├── circuit.ts     # Circuit breaker state machine
│   │   │       ├── diff.ts        # JSON diff for audit trail
│   │   │       ├── resilience.ts  # Retry and timeout helpers
│   │   │       └── transfer.ts    # Data transformation for export/import
│   │   ├── tests/ (if any)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── database/                  # ORM, migrations, models
│   │   ├── src/
│   │   │   ├── client.ts          # PostgreSQL client, connection pool
│   │   │   ├── factory.ts         # Repository factory (users, sessions, apps, etc.)
│   │   │   ├── field.ts           # Field builder helpers (branded types, validations)
│   │   │   ├── models.ts          # Table schemas (drizzle-orm)
│   │   │   ├── repos.ts           # Repository implementations (active record)
│   │   │   ├── search.ts          # Full-text search, semantic search engine
│   │   │   ├── page.ts            # Pagination cursor helpers
│   │   │   └── migrator.ts        # Migration runner
│   │   ├── migrations/
│   │   │   ├── 0001_initial.ts    # Initial schema (users, sessions, etc.)
│   │   │   └── ... (numbered migrations)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   ├── ai/                        # AI runtime, model execution
│   │   ├── src/
│   │   │   ├── runtime.ts         # Model loading and inference wrapper
│   │   │   ├── registry.ts        # Model registry (embeddings, chat)
│   │   │   └── search.ts          # Search service (embedding generation, indexing)
│   │   └── ...
│   ├── types/                     # Shared type definitions
│   │   ├── src/
│   │   │   ├── types.ts           # Common branded types (Hex64, Url, etc.)
│   │   │   └── ...
│   │   └── ...
│   ├── components/                # Legacy React component library
│   │   ├── src/
│   │   └── ...
│   ├── components-next/           # Modern React 19 components
│   │   ├── src/
│   │   └── ...
│   ├── theme/                     # Design tokens, CSS variables
│   │   ├── src/
│   │   └── ...
│   ├── runtime/                   # Runtime utilities for Node/Browser
│   │   ├── src/
│   │   └── ...
│   └── devtools/                  # Development utilities
│       ├── src/
│       └── ...
├── tests/                         # Top-level test directory
│   ├── e2e/                       # Playwright end-to-end tests
│   │   └── *.spec.ts
│   └── packages/
│       └── server/                # Unit tests for packages/server
│           └── *.spec.ts
├── infrastructure/                # Kubernetes manifests, helm charts
│   ├── projects/                  # Per-tenant overlays
│   │   ├── _template/             # Template for new tenants
│   │   └── prod/                  # Production instances
│   └── ...
├── tools/                         # Build scripts, code generation
│   └── scripts/
│       └── generate-pwa-icons.ts
├── .github/                       # CI/CD workflows
│   └── workflows/
├── docs/                          # Documentation
├── nx.json                        # Nx workspace config
├── tsconfig.base.json             # Root TypeScript config
├── vitest.config.ts               # Vitest config (unit + integration tests)
├── playwright.config.ts           # Playwright config (e2e tests)
├── biome.json                     # Code formatter/linter config
├── package.json                   # Root workspace manifest
└── pnpm-workspace.yaml            # pnpm workspace definition
```

## Directory Purposes

**apps/api:**
- Purpose: Production HTTP server entry point.
- Contains: Route implementations, database migrations.
- Key files: `main.ts` (layer composition), `routes/*.ts` (endpoint handlers).

**apps/test-harness:**
- Purpose: Dev environment for manual testing and component preview.
- Contains: Dev UI, live reload setup.

**packages/server:**
- Purpose: Core business logic and infrastructure (never published).
- Contains: Domain services, middleware, observability, security, platform adapters.
- Key files: `api.ts` (HTTP contract), `context.ts` (request state), `middleware.ts` (pipeline).

**packages/database:**
- Purpose: ORM, schema, migrations, repositories.
- Contains: Drizzle models, migration scripts, query builders.
- Key files: `models.ts` (schema definitions), `repos.ts` (repository implementations), `migrations/*.ts` (schema changes).

**packages/ai:**
- Purpose: LLM runtime and search engine.
- Contains: Model registry, embedding generation, semantic search.
- Key files: `runtime.ts` (model wrapper), `search.ts` (multi-channel ranking).

**packages/types:**
- Purpose: Shared type definitions and branded types.
- Contains: Common types for API, domain.
- Key files: `types.ts` (Hex64, Url, etc. branded types).

**packages/components, packages/components-next:**
- Purpose: React component libraries.
- Contains: UI components, hooks.

**packages/theme:**
- Purpose: Design tokens, CSS variables, styling system.
- Contains: Token definitions (colors, spacing, typography).

**packages/runtime:**
- Purpose: Runtime utilities for both Node and Browser.
- Contains: Effect extensions, async utilities.

**packages/devtools:**
- Purpose: Development utilities, code generation, testing helpers.
- Contains: Test factories, mock generators.

**tests/:**
- Purpose: Test suite (separate from package-local tests).
- Contains: End-to-end tests (Playwright), unit tests for packages/server.
- Structure: Mirrors `packages/` directory for organizational clarity.

**infrastructure/:**
- Purpose: Kubernetes and deployment manifests.
- Contains: Helm charts, kustomize overlays, per-tenant configurations.

**tools/:**
- Purpose: Build-time scripts and code generators.
- Contains: PWA icon generation, other Nx tasks.

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts` — HTTP server startup, layer composition.
- `apps/api/src/migrate.ts` — Database migration runner.
- `apps/test-harness/src/` — Dev server for testing.

**Configuration:**
- `tsconfig.base.json` — Shared TypeScript config with path aliases (`@parametric-portal/*`).
- `biome.json` — Code formatter and linter rules.
- `nx.json` — Nx workspace configuration, target definitions, plugins.
- `vitest.config.ts` — Test runner setup.

**Core Logic:**
- `packages/server/src/api.ts` — HTTP API contract (OpenAPI definition).
- `packages/server/src/context.ts` — Unified request context (tenant, session, rate limit).
- `packages/server/src/middleware.ts` — HTTP pipeline (auth, CORS, idempotency).
- `packages/server/src/domain/*.ts` — Business services (auth, storage, notifications, etc.).
- `packages/server/src/infra/*.ts` — Infrastructure (jobs, events, webhooks, email).

**Testing:**
- `tests/e2e/*.spec.ts` — End-to-end tests (Playwright).
- `tests/packages/server/*.spec.ts` — Unit and integration tests for packages/server.
- `playwright.config.ts` — E2E test runner config.

## Naming Conventions

**Files:**
- Lowercase kebab-case: `middleware.ts`, `audit.ts`, `cache.ts`.
- Features as directories: `domain/auth.ts`, `infra/jobs.ts`.
- No suffixes like `*Helper.ts`, `*Util.ts`, `*Handler.ts` — name by purpose: `crypto.ts`, not `cryptoHelper.ts`.
- Test files: `*.spec.ts` or `*.test.ts` (both supported).

**Directories:**
- Lowercase kebab-case: `domain/`, `infra/`, `observe/`, `platform/`, `security/`.
- Plural for collections: `routes/`, `migrations/`, `handlers/`.
- No `utils/` directories — colocate utility functions with their domain module.

**Modules (TypeScript):**
- Named exports only (except `*.config.ts` which may have default exports).
- Export at file end: declare first, export after `// --- [EXPORT]` separator.
- No barrel files (`index.ts`); consumers import directly from source: `import { Auth } from '@parametric-portal/server/domain/auth'`.

**Classes and Services:**
- PascalCase: `AuthService`, `JobService`, `CacheService`.
- Extend `Effect.Service<ServiceName>()` for dependency injection.
- Static `Default` layer: `Auth.Service.Default` provides the implementation.

**Schema and Types:**
- Derived from schema: `type User = typeof User.json['Type']`.
- Branded types via `S.brand()`: `type Hex64 = typeof Hex64`.
- Module-level schema constants prefixed with underscore: `const _OauthLockout = S.Struct(...)`.

**Constants:**
- `as const` for immutable objects: `const CONFIG = { key: 'value' } as const`.
- Uppercase with underscores for private module constants: `const _CONFIG = { ... }`.
- Capitalized for public exports: `const ServerConfig = ...`.

**Functions:**
- camelCase: `submitJob()`, `encryptToken()`.
- Prefixed with underscore for private/internal: `const _makeKey = (input) => ...`.
- Use `Effect.fn('ServiceName.method')` for named spans in telemetry.

## Where to Add New Code

**New Feature (e.g., Notifications Redesign):**
- Primary code: `packages/server/src/domain/notifications.ts`.
- Routes: `apps/api/src/routes/users.ts` (user preferences endpoint).
- Database models: `packages/database/src/models.ts` (add Notification schema).
- Tests: `tests/packages/server/notifications.spec.ts`.

**New Domain Service (e.g., ReportsService):**
- Implementation: `packages/server/src/domain/reports.ts` — Effect.Service extending with methods.
- Registration: Add to `apps/api/src/main.ts` ServicesLayer.
- Routes: `apps/api/src/routes/reports.ts` — new HttpApiGroup.
- Database: `packages/database/src/factory.ts` — add reports repository.
- Tests: `tests/packages/server/reports.spec.ts`.

**New Infrastructure Component (e.g., Cache Invalidation):**
- Implementation: `packages/server/src/infra/cache-invalidation.ts`.
- Integration: Wire into EventBus or PollingService in `packages/server/src/infra/events.ts`.
- Tests: `tests/packages/server/cache-invalidation.spec.ts`.

**New Database Entity (e.g., Audit Reports):**
- Schema: Add to `packages/database/src/models.ts`.
- Migration: Create `packages/database/migrations/NNNN_add_audit_reports.ts`.
- Repository: Add to `packages/database/src/factory.ts`.
- Service: Create service in `packages/server/src/domain/audit-reports.ts`.

**Shared Type (e.g., ReportId branded type):**
- Definition: `packages/types/src/types.ts`.
- Export: Add to `// --- [EXPORT]` section.
- Usage: Import in domain service: `import { ReportId } from '@parametric-portal/types/types'`.

**Utilities and Helpers:**
- **Never** create `utils.ts`, `helpers.ts`, or `common.ts`.
- Colocate utility functions in the module that uses them (e.g., pagination logic in `packages/database/src/repos.ts`).
- If truly shared across multiple domain modules, create a focused module: `packages/server/src/utils/pagination.ts`.

**Observability/Metrics:**
- Span wrapper: Use `Telemetry.span('operation.name')(effect)` in service methods.
- Metrics: Register gauge/counter in `packages/server/src/observe/metrics.ts`, record in service.
- Audit trail: Call `AuditService.log(...)` for user action mutations.

## Special Directories

**node_modules:**
- Auto-generated by pnpm.
- Not committed (in .gitignore).
- Restored via `pnpm install`.

**dist/:**
- Build output directory (per package).
- Not committed.
- Generated via `pnpm nx build`.

**.nx/:**
- Nx cache directory.
- Not committed.
- Safe to delete (rebuilds on next run).

**coverage/:**
- Test coverage reports.
- Not committed.
- Generated via `pnpm nx test -- --coverage`.

**infrastructure/projects/prod/**:**
- Kubernetes production configurations (Kustomize overlays).
- Committed (gitops-style).
- Per-tenant namespace subdirectories.

**.vscode/:**
- VSCode workspace settings.
- Committed for team consistency.
- Contains: editor settings (4-space indent), recommended extensions.

---

*Structure analysis: 2026-02-13*
