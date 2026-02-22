# Codebase Structure

**Analysis Date:** 2026-02-22

## Directory Layout

```
Parametric_Portal/                    # Monorepo root
├── apps/                             # Deployable applications
│   ├── api/                          # Node.js HTTP API server (TypeScript/Effect)
│   │   └── src/
│   │       ├── main.ts               # Layer composition + server entry point
│   │       ├── migrate.ts            # DB migration runner (run separately)
│   │       └── routes/               # Route group handlers (12 files)
│   ├── cs-analyzer/                  # Roslyn static analyzer (C# — netstandard2.0)
│   │   ├── Contracts/                # Boundary exemption contracts
│   │   ├── Dispatch/                 # Analyzer dispatch infrastructure
│   │   ├── Kernel/                   # Rule catalog, state, symbol facts
│   │   ├── Rules/                    # CSP rule implementations (58 rules)
│   │   └── tests/                    # Analyzer test harness (net10.0)
│   ├── kargadan/                     # AI agent system for CAD integration
│   │   ├── harness/                  # TypeScript WebSocket harness + agent loop
│   │   │   └── src/
│   │   │       ├── protocol/         # Dispatch + supervisor (WS protocol layer)
│   │   │       └── runtime/          # Agent loop, loop stages, persistence trace
│   │   └── plugin/                   # C# Rhino plugin (net10.0)
│   │       └── src/
│   │           ├── boundary/         # Event publisher (outbound boundary)
│   │           ├── contracts/        # Protocol VO, models, envelopes (C# mirrors of TS schemas)
│   │           ├── protocol/         # Failure mapping, router
│   │           └── transport/        # Handshake, heartbeat, session host (WS transport)
│   └── test-harness/                 # Frontend React 19 app for component dev/testing
│       └── src/
│           ├── app.tsx               # Full component demonstration app
│           └── main.tsx              # App mount point
├── packages/                         # Shared libraries (no apps here)
│   ├── ai/                           # AI runtime, LLM provider, semantic search
│   │   └── src/
│   │       ├── errors.ts
│   │       ├── mcp.ts
│   │       ├── registry.ts
│   │       ├── runtime-provider.ts
│   │       ├── runtime.ts
│   │       └── search.ts
│   ├── components/                   # Legacy component library (TypeScript schemas only)
│   │   └── src/
│   │       ├── command.ts, controls.ts, data.ts, elements.ts
│   │       ├── feedback.ts, navigation.ts, overlays.ts, selection.ts
│   │       ├── icons.ts, schema.ts, upload.ts, utility.ts
│   │       └── input-bar.ts
│   ├── components-next/              # Next-gen component library (categorized by role)
│   │   └── src/
│   │       ├── actions/              # Button, icon-button, etc.
│   │       ├── collections/          # Lists, tables, grids
│   │       ├── core/                 # Layout primitives
│   │       ├── feedback/             # Alerts, toast, progress
│   │       ├── inputs/               # Form inputs
│   │       ├── navigation/           # Nav, tabs, breadcrumbs
│   │       ├── overlays/             # Modals, popovers, drawers
│   │       └── pickers/              # Date, color, file pickers
│   ├── database/                     # DB client, models, repos, factory, search
│   │   └── src/
│   │       ├── client.ts             # PgClient Layer + tenant context
│   │       ├── factory.ts            # repo() polymorphic factory
│   │       ├── field.ts              # Field metadata + bidirectional camelCase/snake_case
│   │       ├── migrator.ts           # Migration runner utility
│   │       ├── models.ts             # All Model.Class definitions (single source of truth)
│   │       ├── page.ts               # Keyset pagination (Page.decode, cursor encoding)
│   │       ├── repos.ts              # DatabaseService (batched repositories)
│   │       └── search.ts             # SearchRepo (pgvector + trigram)
│   ├── devtools/                     # Effect devtools integration
│   │   └── src/
│   │       ├── client.ts, devtools.ts, domain.ts, react.ts, relay.ts
│   ├── runtime/                      # Frontend Effect + React runtime hooks
│   │   └── src/
│   │       ├── browser.ts            # Browser-specific utilities
│   │       ├── css-sync.ts           # CSS variable sync from JS
│   │       ├── effect.ts             # React hooks (useEffectRun, useEffectMutate, etc.)
│   │       ├── messaging.ts          # Cross-frame messaging
│   │       ├── runtime.ts            # ManagedRuntime factory
│   │       ├── url.ts                # Type-safe URL construction
│   │       └── stores/               # Zustand-compatible Effect stores
│   ├── server/                       # All server-side business logic (Effect services)
│   │   └── src/
│   │       ├── api.ts                # ParametricApi contract (HttpApi + all groups)
│   │       ├── context.ts            # Context.Request FiberRef (tenant, session, etc.)
│   │       ├── env.ts                # Env.Service — single source of env contracts
│   │       ├── errors.ts             # 11 HttpError types (Schema.TaggedError)
│   │       ├── middleware.ts         # Middleware class (auth + pipeline + CORS DSL)
│   │       ├── domain/               # Business logic services
│   │       │   ├── auth.ts           # OAuth, sessions, MFA, WebAuthn
│   │       │   ├── features.ts       # Feature flags (per-tenant, cache-invalidated)
│   │       │   ├── notifications.ts  # Notification dispatch + preferences
│   │       │   ├── storage.ts        # Asset lifecycle, multipart upload, streaming
│   │       │   └── transfer.ts       # Data export/import (NDJSON)
│   │       ├── infra/                # Infrastructure services
│   │       │   ├── cluster.ts        # @effect/cluster sharding + RPC
│   │       │   ├── email.ts          # Email adapter (transactional)
│   │       │   ├── events.ts         # EventBus (journal → PubSub + LISTEN/NOTIFY)
│   │       │   ├── jobs.ts           # @effect/workflow durable job processing
│   │       │   ├── storage.ts        # S3/Garage object storage adapter
│   │       │   ├── webhooks.ts       # Outbound webhook delivery
│   │       │   └── handlers/
│   │       │       ├── purge.ts      # Tenant data purge cron + sweep
│   │       │       └── tenant-lifecycle.ts  # Tenant status lifecycle events
│   │       ├── observe/              # Observability services
│   │       │   ├── audit.ts          # Structured audit log with DLQ fallback
│   │       │   ├── metrics.ts        # Prometheus metrics via OTLP
│   │       │   ├── polling.ts        # Periodic health polling cron
│   │       │   └── telemetry.ts      # Telemetry.span() wrapper + OTLP export
│   │       ├── platform/             # Platform primitives
│   │       │   ├── cache.ts          # CacheService (Redis ioredis + PersistedCache)
│   │       │   ├── doppler.ts        # DopplerService (secret rotation)
│   │       │   ├── streaming.ts      # SSE streaming service
│   │       │   └── websocket.ts      # WebSocket session management
│   │       ├── security/             # Security services
│   │       │   ├── crypto.ts         # Crypto.Service (hashing, signing, AES)
│   │       │   ├── policy.ts         # PolicyService (RBAC, permission cache)
│   │       │   └── totp-replay.ts    # ReplayGuardService (TOTP code deduplication)
│   │       └── utils/                # Shared utilities (server-side only)
│   │           ├── circuit.ts        # Circuit breaker (TMap state machine)
│   │           ├── diff.ts           # JSON diff for audit snapshots
│   │           ├── resilience.ts     # Resilience.run() composition facade
│   │           └── transfer.ts       # Transfer codec (NDJSON serialization)
│   ├── theme/                        # Design system tokens + Tailwind plugin
│   │   └── src/
│   │       ├── base.css              # Base CSS reset
│   │       ├── colors.ts             # Color token definitions
│   │       ├── component-wiring.ts   # CSS variable wiring for components
│   │       ├── plugin.ts             # Tailwind CSS plugin
│   │       └── theme.ts              # Theme factory (apps invoke with values)
│   └── types/                        # Shared TypeScript types + branded primitives
│       └── src/
│           ├── app-error.ts          # AppError schema
│           ├── async.ts              # AsyncState discriminated union
│           ├── env.d.ts              # Vite env type declarations
│           ├── files.ts              # File-related schemas
│           ├── icons.ts              # Icon type contracts
│           ├── svg.ts                # SVG component types
│           ├── types.ts              # Branded primitives (Hex64, Url, etc.)
│           ├── ui.ts                 # UI state schemas
│           └── kargadan/
│               └── kargadan-schemas.ts  # Kargadan WebSocket protocol schemas (Effect.Schema)
├── tests/                            # Centralized test suite (separate from source)
│   ├── apps/
│   │   └── api/                      # API app tests (main, migrate)
│   ├── e2e/                          # Playwright end-to-end tests
│   ├── fixtures/                     # Shared test fixtures
│   ├── integration/
│   │   ├── api/                      # API integration (route smoke tests)
│   │   └── server-database/          # Full-stack flow tests (auth→job→webhook, tenant lifecycle)
│   ├── packages/
│   │   ├── database/                 # Database package unit tests
│   │   └── server/                   # Server package unit tests
│   │       ├── domain/               # Domain service specs
│   │       ├── infra/                # Infra service specs
│   │       ├── observe/              # Observability specs
│   │       ├── platform/             # Platform service specs
│   │       ├── security/             # Security service specs
│   │       └── utils/                # Utility specs
│   ├── system/                       # System-level tests
│   ├── setup.ts                      # Global test setup
│   └── package.json                  # Test workspace package
├── infrastructure/                   # Pulumi IaC (TypeScript)
│   └── src/
│       ├── deploy.ts                 # Full cloud + self-hosted provisioning
│       └── platform.ts               # Platform abstraction
├── tools/
│   └── scripts/                      # Dev tooling scripts
│       ├── count-tokens.ts           # Token counting for LLM context sizing
│       └── generate-pwa-icons.ts     # PWA icon generation
├── .github/                          # CI/CD workflows + GitHub Actions
│   ├── actions/                      # Reusable composite actions
│   └── workflows/                    # CI pipeline definitions
├── docs/                             # Documentation
│   ├── standards/                    # Coding standards docs
│   └── testing/                      # Testing guidelines
├── biome.json                        # Biome linter/formatter config
├── nx.json                           # Nx workspace config + caching inputs
├── package.json                      # Root workspace package + scripts
├── pnpm-workspace.yaml               # pnpm workspace + dependency catalog
├── tsconfig.base.json                # Base TS config (path aliases)
├── tsconfig.json                     # Root TS config
├── vite.config.ts                    # Root Vite config
├── vite.factory.ts                   # Reusable Vite config factory for packages
├── vitest.config.ts                  # Root Vitest config
├── stryker.config.mjs                # Stryker mutation testing config
├── playwright.config.ts              # Playwright E2E config
├── Directory.Build.props             # MSBuild shared props for .NET projects
├── pyproject.toml                    # Python tooling (uv, ruff, mypy)
└── CLAUDE.md                         # Agent behavior manifest
```

## Directory Purposes

**`apps/api/`:**
- Purpose: The deployed HTTP API server — the only application that runs at runtime
- Contains: Layer composition in `main.ts`, 12 route group files in `routes/`, migration entry point
- Key files: `apps/api/src/main.ts` (entry point), `apps/api/src/routes/auth.ts` (largest route file)

**`apps/cs-analyzer/`:**
- Purpose: Roslyn-based Diagnostic Analyzer enforcing 58 CSP rules on all C# source; distributed as analyzer NuGet package
- Contains: `Kernel/` (core state machine), `Rules/` (4 rule categories), `Contracts/` (exemption attributes), `tests/` (xUnit test harness)
- Key files: `apps/cs-analyzer/Kernel/RuleCatalog.cs`, `apps/cs-analyzer/Rules/ShapeRules.cs`

**`apps/kargadan/harness/`:**
- Purpose: TypeScript WebSocket client harness driving the PLAN→EXECUTE→VERIFY→PERSIST→DECIDE agent loop against the Rhino C# plugin
- Contains: `src/runtime/` (loop logic), `src/protocol/` (WS dispatch and supervisor)
- Key files: `apps/kargadan/harness/src/runtime/agent-loop.ts`, `apps/kargadan/harness/src/runtime/loop-stages.ts`

**`apps/kargadan/plugin/`:**
- Purpose: Rhino .NET plugin — receives commands from harness over WebSocket, executes Rhino API calls, returns results
- Contains: `src/contracts/` (C# mirrors of TS protocol schemas), `src/transport/` (WS session), `src/boundary/`, `src/protocol/`
- Key files: `apps/kargadan/plugin/src/boundary/KargadanPlugin.cs`, `apps/kargadan/plugin/src/transport/SessionHost.cs`

**`packages/server/`:**
- Purpose: All server-side business logic as Effect services; imported by `apps/api`
- Contains: `src/api.ts` (HttpApi contract), `src/domain/`, `src/infra/`, `src/observe/`, `src/platform/`, `src/security/`, `src/utils/`
- Key files: `packages/server/src/api.ts`, `packages/server/src/context.ts`, `packages/server/src/env.ts`

**`packages/database/`:**
- Purpose: PostgreSQL database layer — models, repositories, client pooling, search
- Contains: `src/models.ts` (canonical Model.Class definitions), `src/factory.ts` (repo() factory), `src/repos.ts` (DatabaseService), `migrations/`
- Key files: `packages/database/src/models.ts`, `packages/database/src/factory.ts`, `packages/database/src/repos.ts`

**`packages/types/`:**
- Purpose: Shared TypeScript types, branded primitives, and protocol schemas; no runtime dependencies
- Contains: Branded types, AsyncState, UI schemas, Kargadan WS protocol schemas
- Key files: `packages/types/src/types.ts`, `packages/types/src/kargadan/kargadan-schemas.ts`

**`packages/theme/`:**
- Purpose: Design system tokens; packages export CSS variable slots and the Tailwind plugin; apps provide the actual values
- Contains: `colors.ts`, `theme.ts` (factory), `plugin.ts` (Tailwind), `component-wiring.ts`
- Key files: `packages/theme/src/theme.ts`, `packages/theme/src/plugin.ts`

**`packages/runtime/`:**
- Purpose: Effect runtime integration for browser React apps
- Contains: `effect.ts` (React hooks), `runtime.ts` (ManagedRuntime), `stores/`, `browser.ts`, `messaging.ts`
- Key files: `packages/runtime/src/effect.ts`, `packages/runtime/src/runtime.ts`

**`tests/`:**
- Purpose: Centralized test workspace — all specs separated from source code; mirrors source directory structure under `tests/packages/` and `tests/apps/`
- Contains: Unit specs under `tests/packages/`, integration specs under `tests/integration/`, E2E under `tests/e2e/`
- Key files: `tests/setup.ts`, `tests/integration/server-database/auth-session-job-webhook-flow.spec.ts`

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: HTTP server entry — composes all layers, runs `NodeRuntime.runMain`
- `apps/api/src/migrate.ts`: DB migration entry — run before server on deploy
- `apps/test-harness/src/main.tsx`: Frontend app mount
- `apps/kargadan/harness/src/runtime/agent-loop.ts`: Agent loop service

**Configuration:**
- `packages/server/src/env.ts`: Single source of all environment variable contracts and defaults
- `pnpm-workspace.yaml`: Dependency catalog (check here before adding any dependency)
- `nx.json`: Nx caching inputs and task pipeline
- `biome.json`: Linting and formatting rules (formatter disabled for TS source files — 4-space indentation enforced by VSCode)
- `Directory.Build.props`: .NET project shared MSBuild props (pinned package versions)
- `tsconfig.base.json`: TypeScript path aliases (`@parametric-portal/*`)
- `vite.factory.ts`: Reusable Vite config factory — all packages use this

**API Contract:**
- `packages/server/src/api.ts`: `ParametricApi` — the HttpApi definition that all routes implement and the client derives from

**Database Schema:**
- `packages/database/src/models.ts`: All `Model.Class` definitions — canonical entity shapes
- `packages/database/migrations/0001_initial.ts`: Full initial schema migration

**Core Logic:**
- `packages/server/src/domain/auth.ts`: Unified auth service (OAuth, sessions, MFA, WebAuthn) — largest domain file (~53KB)
- `packages/server/src/infra/jobs.ts`: Durable job processing via `@effect/workflow` (~45KB)
- `packages/server/src/api.ts`: Full API contract (~42KB)
- `packages/server/src/infra/cluster.ts`: Cluster coordination (~33KB)
- `packages/server/src/platform/cache.ts`: Redis cache service (~29KB)

**Protocol Schemas:**
- `packages/types/src/kargadan/kargadan-schemas.ts`: Kargadan WebSocket protocol schemas (TS — Effect.Schema)
- `apps/kargadan/plugin/src/contracts/*.cs`: C# mirrors of protocol schemas

**Testing:**
- `tests/setup.ts`: Global Vitest setup
- `vitest.config.ts`: Root Vitest configuration
- `playwright.config.ts`: E2E configuration
- `stryker.config.mjs`: Mutation testing configuration

## Naming Conventions

**Files:**
- TypeScript source: `kebab-case.ts` (e.g., `totp-replay.ts`, `agent-loop.ts`, `loop-stages.ts`)
- TypeScript specs: `kebab-case.spec.ts` (e.g., `features.spec.ts`, `auth-session-job-webhook-flow.spec.ts`)
- C# source: `PascalCase.cs` (e.g., `KargadanPlugin.cs`, `SessionHost.cs`, `ProtocolEnvelopes.cs`)
- Route files in `apps/api/src/routes/`: domain noun only, no prefix (e.g., `auth.ts`, not `auth-routes.ts`)
- Service files in `packages/server/src/*/`: domain noun only (e.g., `cache.ts`, `cluster.ts`)

**Directories:**
- Packages: `kebab-case` (e.g., `components-next`, `devtools`)
- Apps: `kebab-case` (e.g., `test-harness`, `cs-analyzer`)
- Source subdirectories in `packages/server/src/`: role-based (`domain/`, `infra/`, `observe/`, `platform/`, `security/`, `utils/`)
- Component subdirectories in `packages/components-next/src/`: UI role (`actions/`, `collections/`, `inputs/`)

**Exports:**
- Named exports only — no default exports (exception: `*.config.ts` files)
- No barrel files (`index.ts`) — consumers import directly from source file path
- Classes named after their domain role: `Auth.Service`, `CacheService`, `EventBus`, `DatabaseService`
- Route layers named `XLive` where X is the domain noun: `AuthLive`, `UsersLive`, `AdminLive`

## Where to Add New Code

**New API Endpoint Group:**
- 1. Define endpoint group in `packages/server/src/api.ts` (add `HttpApiGroup` with endpoints)
- 2. Create `apps/api/src/routes/newgroup.ts` with `const NewGroupLive = HttpApiBuilder.group(ParametricApi, 'newgroup', ...)`
- 3. Add `NewGroupLive` to `RouteLayer` in `apps/api/src/main.ts`
- 4. Tests: `tests/packages/server/domain/newgroup.spec.ts` (domain logic) + `tests/integration/api/routes.spec.ts` (route smoke)

**New Domain Service:**
- 1. Create `packages/server/src/domain/newservice.ts`
- 2. Pattern: `class NewService extends Effect.Service<NewService>()('server/NewService', { scoped: Effect.gen(function* () { ... }) }) {}`
- 3. Add `NewService.Default` to `CoreServicesLayer` in `apps/api/src/main.ts`
- 4. Tests: `tests/packages/server/domain/newservice.spec.ts`

**New Infrastructure Service:**
- 1. Create `packages/server/src/infra/newservice.ts`
- 2. Same `Effect.Service` pattern as domain
- 3. Add to `ServiceInfraLayer` in `apps/api/src/main.ts`

**New Database Model:**
- 1. Add `Model.Class` definition to `packages/database/src/models.ts` (single source of truth)
- 2. Add repository factory call to `packages/database/src/repos.ts` using `repo()`
- 3. Add migration to `packages/database/migrations/` (next numbered file)

**New Platform Service (cache, websocket, etc.):**
- 1. Create `packages/server/src/platform/newplatform.ts`
- 2. Add to `ServiceInfraLayer` or `CoreServicesLayer` based on dependency position

**New Shared Type / Schema:**
- 1. Add to `packages/types/src/types.ts` (branded primitives) or create new file in `packages/types/src/`
- 2. Derive TypeScript type via `typeof XSchema.Type` — never declare separately

**New Frontend Component:**
- 1. Add to appropriate category in `packages/components-next/src/` (e.g., `inputs/`, `actions/`)
- 2. No barrel files — component consumers import from `@parametric-portal/components-next/inputs/my-input`

**New Test:**
- Mirror source path under `tests/`: `packages/server/src/domain/auth.ts` → `tests/packages/server/domain/auth.spec.ts`
- Integration tests: `tests/integration/server-database/` for multi-service flows
- E2E: `tests/e2e/`

**New Kargadan Protocol Operation:**
- 1. Add operation literal to `CommandOperationSchema` in `packages/types/src/kargadan/kargadan-schemas.ts`
- 2. Mirror in C#: update `apps/kargadan/plugin/src/contracts/ProtocolEnums.cs`
- 3. Add dispatch case in `apps/kargadan/plugin/src/protocol/Router.cs`

## Special Directories

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents (ARCHITECTURE.md, STRUCTURE.md, etc.)
- Generated: By `/gsd:map-codebase` command
- Committed: Yes

**`.claude/`:**
- Purpose: Claude agent system — skills, commands, hooks, output styles
- Generated: No (manually maintained)
- Committed: Yes (skills and command definitions)

**`.archive/`:**
- Purpose: Archived/superseded code (components-next predecessors, old icon implementation, infrastructure ADRs)
- Generated: No
- Committed: Yes — read-only historical reference; do not modify

**`node_modules/`:**
- Purpose: pnpm hoisted dependencies
- Generated: Yes
- Committed: No

**`dist/`** (per-package):
- Purpose: Vite/tsc build output for each package and app
- Generated: Yes
- Committed: No

**`apps/cs-analyzer/bin/`, `apps/cs-analyzer/obj/`:**
- Purpose: .NET build artifacts
- Generated: Yes
- Committed: No

**`.nx/`:**
- Purpose: Nx cache and workspace metadata
- Generated: Yes
- Committed: No (except `.nx/workspace-data/` if present)

**`infrastructure/`:**
- Purpose: Pulumi TypeScript IaC — provisions cloud (EKS + RDS + ElastiCache + S3) and self-hosted (Docker Compose + Garage) targets from a single codebase
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-02-22*
