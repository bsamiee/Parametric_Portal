# Codebase Structure

**Analysis Date:** 2026-01-26

## Directory Layout

```
parametric-portal/
├── apps/                           # Application entry points (Nx "apps")
│   ├── api/                        # HTTP API server
│   │   └── src/
│   │       ├── main.ts             # Layer composition, HTTP server startup
│   │       └── routes/             # HTTP route handlers (request → domain → response)
│   │           ├── auth.ts         # OAuth, session, MFA, API key endpoints
│   │           ├── storage.ts      # S3 operations (sign, upload, delete)
│   │           ├── search.ts       # Full-text search, suggestions
│   │           ├── transfer.ts     # Import/export (CSV, NDJSON, Excel, ZIP)
│   │           ├── users.ts        # User role management
│   │           ├── audit.ts        # Audit log queries
│   │           ├── jobs.ts         # Job status SSE subscription
│   │           ├── health.ts       # Liveness/readiness probes
│   │           └── telemetry.ts    # Trace ingestion endpoint
│   └── test-harness/               # E2E test client
│
├── packages/                       # Shared libraries (Nx "libs")
│   ├── server/                     # Domain, infrastructure, middleware
│   │   └── src/
│   │       ├── api.ts              # HttpApi definition (schema-first API contract)
│   │       ├── context.ts          # Request context (FiberRef, cookies, tenant isolation)
│   │       ├── errors.ts           # Schema.TaggedError definitions for HTTP
│   │       ├── middleware.ts       # Global, auth, context middleware composition
│   │       ├── domain/             # Business logic services
│   │       │   ├── session.ts      # Session lifecycle, MFA verification, token rotation
│   │       │   ├── storage.ts      # Asset/document management via StorageAdapter
│   │       │   ├── search.ts       # Full-text search + indexing
│   │       │   ├── mfa.ts          # TOTP enrollment, verification, backup codes
│   │       │   └── oauth.ts        # OAuth provider integration (Apple, GitHub, Google, Microsoft)
│   │       ├── infra/              # Infrastructure adapters
│   │       │   ├── storage.ts      # S3-compatible storage wrapper (multipart, presigned URLs)
│   │       │   ├── jobs.ts         # Background job execution + polling
│   │       │   └── handlers/
│   │       │       └── purge-assets.ts # Scheduled asset cleanup handler
│   │       ├── observe/            # Observability services
│   │       │   ├── audit.ts        # Audit trail logging
│   │       │   ├── metrics.ts      # Prometheus metrics (auth, storage, rate limit)
│   │       │   ├── polling.ts      # Periodic health checks + status updates
│   │       │   └── telemetry.ts    # OpenTelemetry integration
│   │       ├── security/           # Security services
│   │       │   ├── crypto.ts       # Token generation, hashing, encryption
│   │       │   ├── rate-limit.ts   # Rate limiting + request quota enforcement
│   │       │   ├── totp-replay.ts  # TOTP replay attack prevention
│   │       │   └── circuit.ts      # Circuit breaker state machine
│   │       └── utils/              # Pure utility functions
│   │           ├── diff.ts         # RFC 6902 JSON patch generation
│   │           └── transfer.ts     # Asset format conversion (CSV/NDJSON/Excel/ZIP)
│   │
│   ├── database/                   # Data models + repository factory
│   │   └── src/
│   │       ├── client.ts           # PostgreSQL 18.1 connection pooling via @effect/sql-pg
│   │       ├── factory.ts          # Repository CRUD generator + custom resolver DSL
│   │       ├── models.ts           # Entity schemas (User, Asset, App, Session, etc.) + .json shapes
│   │       ├── field.ts            # Field registry + metadata (types, defaults, labels)
│   │       ├── repos.ts            # DatabaseService with: users, apps, sessions, assets, jobs, etc.
│   │       ├── search.ts           # SearchRepo + full-text indexing service
│   │       ├── page.ts             # Keyset pagination (cursor-based)
│   │       └── migrator.ts         # SQL migration runner
│   │
│   ├── types/                      # Shared type definitions
│   │   └── src/
│   │       ├── types.ts            # Branded types (Uuidv7, Hex64, Url, Timestamp)
│   │       └── files.ts            # File codec enums, transfer format types
│   │
│   ├── components/                 # React UI component library (legacy)
│   ├── components-next/            # React 19 component library (next-gen)
│   ├── theme/                      # Tailwind CSS design tokens
│   ├── ai/                         # AI service integrations (Claude, GPT, Gemini)
│   ├── runtime/                    # Runtime utilities (browser + Node.js)
│   ├── devtools/                   # Development tools + inspectors
│   └── test-utils/                 # Testing utilities + factories
│
├── tests/                          # E2E + integration test suite
├── infrastructure/                 # Kubernetes + deployment configs
│   ├── argocd/                     # GitOps sync configuration
│   └── projects/*/overlays/prod    # Per-project production deployments
├── tools/                          # Build scripts + code generation
├── docs/                           # Architecture docs, standards, HTTP specs
│
├── vite.config.ts                  # Vite build configuration (monorepo root)
├── vitest.config.ts                # Vitest testing configuration
├── playwright.config.ts            # Playwright E2E configuration
├── nx.json                         # Nx workspace configuration
├── pnpm-workspace.yaml             # pnpm monorepo packages + catalog
├── tsconfig.base.json              # TypeScript base configuration
└── biome.json                      # Biome linter/formatter config
```

## Directory Purposes

**apps/api:**
- Purpose: HTTP API server entry point
- Contains: Route handlers, middleware composition, server startup logic
- Key files: `main.ts` (layer composition), `routes/*.ts` (request handlers)

**packages/server:**
- Purpose: Core domain logic, infrastructure, observability
- Contains: All business logic services, middleware, authentication, storage, auditing
- Organization: domain/, infra/, observe/, security/, utils/ subdirectories
- Exports: Granular named exports for composition (no barrel files)

**packages/database:**
- Purpose: Data models, repositories, SQL client configuration
- Contains: Entity schemas, repository factory, search indexing
- Key files: `models.ts` (schemas), `repos.ts` (DatabaseService), `factory.ts` (CRUD generator)

**packages/types:**
- Purpose: Shared type definitions and branded types
- Contains: Uuidv7, Hex64, Url, Timestamp types + file codec definitions
- Usage: Imported by server and database packages for type safety

**infrastructure/:**
- Purpose: Kubernetes deployments, ArgoCD sync, Kustomize overlays
- Contains: Per-project production configurations
- Pattern: `projects/{project}/overlays/prod/` for each deployment variant

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: HTTP server startup, layer composition, Node.js runtime initialization
- `apps/test-harness/`: E2E test client application

**Configuration:**
- `packages/database/src/client.ts`: PostgreSQL connection pooling config
- `packages/server/src/context.ts`: Request context, tenant isolation, cookie management
- `packages/server/src/middleware.ts`: CORS, security headers, trace, metrics middlewares

**Core Logic:**
- `packages/server/src/api.ts`: HttpApi endpoint definitions (schema-first)
- `packages/server/src/domain/`: Business logic services (session, storage, search, oauth, mfa)
- `packages/server/src/infra/`: Infrastructure adapters (S3, jobs, background handlers)

**Testing:**
- `tests/`: E2E test suite (playwright)
- `**/*.test.ts` / `**/*.spec.ts`: Unit tests (vitest) co-located with source

**Build & Config:**
- `vite.config.ts`: Root Vite configuration
- `nx.json`: Nx plugin configuration + target defaults
- `pnpm-workspace.yaml`: Package catalog (exact versions) + workspace definition

## Naming Conventions

**Files:**
- Module files: `lowercase-with-dashes.ts` (e.g., `session.ts`, `rate-limit.ts`)
- Schema/model files: `lowercase.ts` (e.g., `models.ts`, `types.ts`)
- Index/entry files: `index.ts` NOT USED (import directly from source)
- Config files: Match pattern (e.g., `client.ts`, `factory.ts`)

**Directories:**
- Layer groupings: `domain/`, `infra/`, `observe/`, `security/`, `utils/`
- Route groups: `routes/` (one file per endpoint group)
- Internal organization: `handlers/`, `services/` only if 5+ files in directory

**Functions & Exports:**
- Service classes: PascalCase (SessionService, StorageAdapter, OAuthService)
- Factory functions: camelCase (makeUserRepo, makeSessionAuth)
- Type aliases: PascalCase (User, Session, AuthResponse)
- Schemas: PascalCase when exported, lowercase with underscore when private (_AuthResponse)

**Type Patterns:**
- Branded types: `Uuidv7`, `Hex64` (packages/types/src/types.ts)
- Error types: PascalCase with .of() factory (Auth, Forbidden, NotFound)
- Service types: Name.Type inferred from schema (User = typeof User.json.Type)

## Where to Add New Code

**New Feature:**
- HTTP endpoint definition: `packages/server/src/api.ts` (add to appropriate _Group)
- Route handler: `apps/api/src/routes/{groupName}.ts` (new file or add to existing group)
- Domain logic: `packages/server/src/domain/{feature}.ts` (new Effect.Service)
- Database schema: `packages/database/src/models.ts` (new Model definition)
- Repository: `packages/database/src/repos.ts` (add to DatabaseService)
- Tests: `apps/api/src/routes/{groupName}.test.ts` or `packages/server/src/domain/{feature}.test.ts`

**New Domain Service:**
- File: `packages/server/src/domain/{serviceName}.ts`
- Pattern: Class extends Effect.Service, provide .Default static layer
- Export: Named export only (no barrel files)
- Compose: Add to appropriate layer in `apps/api/src/main.ts`

**New Infrastructure Adapter:**
- File: `packages/server/src/infra/{adapterName}.ts` (or `infra/{category}/{adapterName}.ts`)
- Pattern: Class extends Effect.Service with effect: Effect.gen()
- Dependencies: Inject via yield* YourDependency in effect block
- Example: `StorageAdapter`, `JobService`

**New Utility Module:**
- File: `packages/server/src/utils/{utilName}.ts` (pure functions only)
- No external dependencies besides effect and standard lib
- Export: Named function exports
- Usage: Import directly by path (no barrels)

**New Shared Library:**
- Location: `packages/{libName}/src/`
- package.json: Export each public module path via "exports" field
- Example: `@parametric-portal/database`, `@parametric-portal/types`
- Consumers: Import via workspace alias `@parametric-portal/{libName}`

## Special Directories

**node_modules/:**
- Purpose: pnpm symlinked dependencies (strict catalog mode)
- Generated: Yes, auto-generated by pnpm
- Committed: No (ignored in .gitignore)

**.nx/:**
- Purpose: Nx cache + daemon sockets
- Generated: Yes, auto-generated by Nx
- Committed: No (ignored in .gitignore)

**coverage/:**
- Purpose: Test coverage reports (lcov format)
- Generated: Yes, created by vitest --coverage
- Committed: No (ignored in .gitignore)

**dist/:**
- Purpose: Built output (per package/app)
- Generated: Yes, created by `pnpm exec nx build`
- Committed: No (ignored in .gitignore)

**.planning/:**
- Purpose: GSD codebase mapping documents
- Generated: Yes, by `/gsd:map-codebase` orchestrator
- Committed: Yes, for CI/CD planning reference

---

*Structure analysis: 2026-01-26*
