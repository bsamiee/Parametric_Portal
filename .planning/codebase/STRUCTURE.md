# Codebase Structure

**Analysis Date:** 2026-01-28

## Directory Layout

```
parametric-portal/
├── apps/                    # Application entry points
│   ├── api/                # Backend HTTP API server
│   └── test-harness/       # Integration test application
├── packages/               # Reusable libraries
│   ├── ai/                 # AI/ML utilities (private)
│   ├── components/         # React UI components
│   ├── components-next/    # Next-gen component experiments
│   ├── database/           # Database models, migrations, repos
│   ├── devtools/           # Development tools and debugging
│   ├── runtime/            # Browser runtime utilities
│   ├── server/             # Server-side business logic
│   ├── test-utils/         # Shared testing utilities
│   ├── theme/              # Design system tokens
│   └── types/              # Shared TypeScript types
├── infrastructure/         # Kubernetes manifests, deployment config
├── tools/                  # Build scripts, automation
├── tests/                  # E2E tests (Playwright)
├── .planning/              # GSD agent documentation
│   └── codebase/          # Architecture and analysis docs
├── nx.json                 # Nx workspace configuration
├── pnpm-workspace.yaml     # PNPM catalog and workspace definition
├── tsconfig.base.json      # Shared TypeScript configuration
├── vite.factory.ts         # Shared Vite configuration factory
└── vitest.config.ts        # Shared Vitest test configuration
```

## Directory Purposes

**apps/api:**
- Purpose: Backend HTTP server (Effect + @effect/platform)
- Contains: Main entry point, route handlers, migration script
- Key files: `src/main.ts` (server composition), `src/migrate.ts` (DB migrations), `src/routes/*.ts` (endpoint handlers)

**packages/server:**
- Purpose: Server-side business logic (services, middleware, API contract)
- Contains: Domain services, infrastructure adapters, HTTP middleware
- Key files: `src/api.ts` (HTTP API contract), `src/context.ts` (request context), `src/middleware.ts` (HTTP middleware), `src/domain/*.ts` (business logic services), `src/infra/*.ts` (external adapters), `src/observe/*.ts` (metrics/telemetry), `src/security/*.ts` (crypto/auth), `src/platform/*.ts` (cache/streaming)

**packages/database:**
- Purpose: Database layer (models, repositories, migrations)
- Contains: @effect/sql models, repository factories, Drizzle migrations
- Key files: `src/models.ts` (entity definitions), `src/repos.ts` (repository service), `src/factory.ts` (repo factory pattern), `src/client.ts` (PostgreSQL client), `src/search.ts` (full-text search), `migrations/*.ts` (schema migrations)

**packages/types:**
- Purpose: Shared domain types and schemas
- Contains: Type definitions, branded types, utility schemas
- Key files: `src/types.ts` (primitives), `src/files.ts` (file handling), `src/ui.ts` (UI types)

**packages/components:**
- Purpose: React UI component library
- Contains: Reusable components with React Aria/Stately
- Key files: `src/*.ts` (component groups: data.ts, controls.ts, navigation.ts, overlays.ts, schema.ts, selection.ts)

**packages/theme:**
- Purpose: Design system tokens (CSS variables, color scales)
- Contains: Theme definitions, CSS variable slots
- Key files: Tokens for colors, spacing, typography

**packages/devtools:**
- Purpose: Development-time debugging tools
- Contains: Inspector panels, logging utilities

**infrastructure:**
- Purpose: Kubernetes deployment manifests
- Contains: Kustomize overlays for prod/staging
- Key files: `projects/*/overlays/prod/*.yaml`

**tools:**
- Purpose: Build automation and scripts
- Contains: Token counting, PWA icon generation, workflow helpers
- Key files: `scripts/*.ts`

**tests:**
- Purpose: End-to-end tests
- Contains: Playwright test suites
- Key files: E2E scenarios

## Key File Locations

**Entry Points:**
- `apps/api/src/main.ts`: API server bootstrap and layer composition
- `apps/api/src/migrate.ts`: Database migration runner

**Configuration:**
- `nx.json`: Nx task configuration, build caching, plugin setup
- `pnpm-workspace.yaml`: Dependency catalog, workspace packages
- `tsconfig.base.json`: TypeScript compiler options (TypeScript 6.0-dev)
- `vite.factory.ts`: Shared Vite build configuration
- `vitest.config.ts`: Test runner configuration
- `biome.json`: Code formatting and linting rules
- `lefthook.yml`: Git hooks (pre-commit, pre-push)

**Core Logic:**
- `packages/server/src/api.ts`: HTTP API contract definition (shared with clients)
- `packages/server/src/domain/*.ts`: Business logic services (session, mfa, oauth, storage, search)
- `packages/database/src/repos.ts`: Database service with all repositories
- `packages/database/src/models.ts`: Entity models with schema definitions

**Testing:**
- `vitest.config.ts`: Test configuration
- `packages/test-utils/src/*.ts`: Test helpers and fixtures
- `tests/*.spec.ts`: E2E test suites
- `*.test.ts` (co-located): Unit tests next to source files

## Naming Conventions

**Files:**
- `kebab-case.ts`: Standard for source files (e.g., `user-service.ts`)
- `*.test.ts`: Unit/integration tests (e.g., `session.test.ts`)
- `*.spec.ts`: E2E tests (e.g., `auth.spec.ts`)
- `*.config.ts`: Configuration files (e.g., `vite.config.ts`)
- `UPPERCASE.md`: Documentation files (e.g., `REQUIREMENTS.md`, `CLAUDE.md`)

**Directories:**
- `kebab-case`: Standard for all directories (e.g., `components-next`)
- `src/`: Source code root in all packages and apps
- `dist/`: Build output (generated, not committed)
- `migrations/`: Database schema migrations (in packages/database)

## Where to Add New Code

**New API Endpoint:**
- Primary code: Add HttpApiGroup in `packages/server/src/api.ts` (HTTP contract)
- Handler: Add route handler in `apps/api/src/routes/<group>.ts`
- Service logic: Add domain service in `packages/server/src/domain/<feature>.ts`
- Register: Import handler in `apps/api/src/main.ts` and add to RouteLayer (line 98)
- Tests: Add tests in `apps/api/src/routes/*.test.ts` or `packages/server/src/domain/*.test.ts`

**New Database Entity:**
- Model: Add Model.Class in `packages/database/src/models.ts`
- Repository: Add repo factory in `packages/database/src/repos.ts`
- Migration: Generate migration via Drizzle CLI in `packages/database/migrations/`
- Export: Add to DatabaseService in `packages/database/src/repos.ts` (line 201)

**New Service:**
- Implementation: Create service in `packages/server/src/domain/<feature>.ts` or `packages/server/src/infra/<feature>.ts`
- Pattern: Extend `Effect.Service<T>()('namespace/ServiceName', { effect: ... })`
- Layer: Compose in `apps/api/src/main.ts` at appropriate layer tier
- Tests: Create `packages/server/src/domain/<feature>.test.ts`

**New Component:**
- Implementation: Add to `packages/components/src/<category>.ts` (e.g., `controls.ts`, `data.ts`)
- Exports: Export from category file (no barrel files)
- Tests: Co-locate as `packages/components/src/<category>.test.ts`

**Shared Utilities:**
- Pure functions: Add to `packages/server/src/utils/<feature>.ts`
- Types: Add to `packages/types/src/types.ts`
- Schemas: Add to `packages/types/src/types.ts` or domain-specific file

**New Package:**
- Location: Create in `packages/<name>/`
- Structure: Include `package.json`, `tsconfig.json`, `vite.config.ts`, `src/` directory
- Register: Add to `pnpm-workspace.yaml` workspaces (line 7-8)
- Build: Nx infers build target from `vite.config.ts`

## Special Directories

**.nx:**
- Purpose: Nx computation cache and build artifacts
- Generated: Yes (by Nx)
- Committed: No (in .gitignore)

**node_modules:**
- Purpose: Installed npm dependencies
- Generated: Yes (by pnpm install)
- Committed: No (in .gitignore)

**dist:**
- Purpose: Compiled output (per package/app)
- Generated: Yes (by Vite/tsc)
- Committed: No (in .gitignore)

**migrations:**
- Purpose: Database schema migrations (Drizzle)
- Generated: Partially (via drizzle-kit generate)
- Committed: Yes (source of truth for schema evolution)
- Location: `packages/database/migrations/`

**.vite-inspect:**
- Purpose: Vite plugin inspection output
- Generated: Yes (by vite-plugin-inspect)
- Committed: No (in .gitignore)

**coverage:**
- Purpose: Test coverage reports
- Generated: Yes (by Vitest with v8 coverage provider)
- Committed: No (in .gitignore)

**.planning:**
- Purpose: GSD agent analysis and planning documents
- Generated: By GSD commands (/gsd:map-codebase, /gsd:plan-phase)
- Committed: Yes (enables context reuse across agent sessions)
- Location: `.planning/codebase/` (architecture), `.planning/phases/` (plans)

---

*Structure analysis: 2026-01-28*
