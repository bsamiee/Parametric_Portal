# Technology Stack

**Analysis Date:** 2026-02-13

## Languages

**Primary:**
- TypeScript 6.0.0-dev.20251125 - All source code, applications, and packages
- JavaScript (ECMAScript modules) - Runtime format throughout codebase

**Secondary:**
- YAML - Configuration (Vite, Biome, workspace definitions)
- SQL - PostgreSQL migrations and queries via @effect/sql-pg

## Runtime

**Environment:**
- Node.js 25.2.1 (specified in `package.json` engines)

**Package Manager:**
- pnpm 10.28.2 - Monorepo package management
- Lockfile: `pnpm-lock.yaml` (present, strict catalog mode enforced)

## Frameworks

**Core:**
- Effect 3.19.16 - Functional effect system (type-safe errors, async orchestration, dependency injection)
- @effect/platform 0.94.4 - Cross-platform abstractions for HTTP, file I/O, streams
- @effect/platform-node 0.104.1 - Node.js-specific platform layer

**Web/API:**
- @effect/platform HttpApiBuilder - HTTP server and routing with OpenAPI/Swagger
- React 19.3.0-canary (UI apps) - React compiler enabled via `babel-plugin-react-compiler`
- Vite 7.3.1 - Module bundler and dev server for all packages

**Data Layer:**
- @effect/sql 0.49.0 - Schema-driven SQL layer
- @effect/sql-pg 0.50.3 - PostgreSQL client with connection pooling
- Drizzle ORM (schema inference via @effect/sql Model classes)

**Testing:**
- Vitest 4.0.18 - Unit and integration test runner
- @vitest/coverage-v8 4.0.18 - Code coverage reporting
- @vitest/ui 4.0.18 - Browser-based test UI
- fast-check 4.5.3, @fast-check/vitest 0.2.4 - Property-based testing

**Build/Dev Tools:**
- Nx 22.5.0 - Monorepo task orchestration and caching
- @nx/react 22.5.0, @nx/vite 22.5.0, @nx/vitest 22.5.0 - Nx plugins for React/Vite/tests
- Biome 2.3.15 - Code formatter and linter (primary, @berenddeboer/nx-biome 1.0.2 integration)
- tsx 4.21.0 - TypeScript execution for scripts
- Stryker 9.5.1 - Mutation testing framework

**Code Quality:**
- Knip 5.83.1 - Unused dependency detector
- Sherif 1.10.0 - Dependency audit tool
- SonarCloud 4.3.4 - Code quality and security scanning

**Infrastructure/Deployment:**
- @pulumi/pulumi 3.220.0, @pulumi/aws 7.19.0, @pulumi/kubernetes 4.25.0 - Infrastructure as Code
- @nx/docker 22.5.0 - Docker image building via Nx
- Docker (implied via infrastructure/)

**CSS/Styling:**
- Tailwind CSS 4.1.18, @tailwindcss/vite 4.1.18 - Utility-first CSS framework
- Tailwind Merge 3.4.0 - Merge Tailwind class conflicts
- Lightningcss 1.31.1 - Lightning-fast CSS parser

**Component Libraries:**
- React Aria Components 1.15.1 - Accessible component primitives
- Radix UI (react-aria, react-stately) - Headless UI component library
- lucide-react 0.563.0 - Icon library

**Utilities:**
- zustand 5.0.11 - Lightweight state management
- date-fns 4.1.0 - Date manipulation
- nanoid 5.1.6 - Unique ID generation
- immer 11.1.4 - Immutable state updates
- papaparse 5.5.3 - CSV parsing
- exceljs 4.4.0 - Excel file generation
- jszip 3.10.1, jspdf 4.1.0 - Archive and PDF creation

**Type Utilities:**
- ts-toolbelt 9.6.0 - Advanced TypeScript type operations (quarantined to types/)
- ts-essentials 10.1.1 - Essential TypeScript utility types
- type-fest 5.4.4 - Curated type utilities

**Image Processing:**
- sharp 0.34.5 - Image optimization
- vite-plugin-image-optimizer 2.0.3 - Vite plugin for automatic image optimization

**WebSocket/Real-time:**
- @effect/experimental - WebSocket and reactive patterns
- Native Node.js HTTP/WebSocket

## Configuration

**Environment:**
- Configuration via `Config.string`, `Config.integer`, `Config.boolean`, `Config.redacted` (Effect Config API)
- `.env` files (not committed, configuration from environment variables at runtime)
- Secrets stored in `.env` (required env vars listed in service configs)

**Build:**
- `tsconfig.json` - TypeScript compiler configuration
- `biome.json` - Code formatting and linting rules (formatter disabled for TS sources)
- `vite.config.ts` - Root Vite configuration factory
- `nx.json` - Nx workspace configuration (caching, tasks, plugins)
- `.github/workflows/` - GitHub Actions CI/CD pipeline

**Database:**
- `packages/database/migrations/0001_initial.ts` - Drizzle migration file
- PostgreSQL 18.1 (inferred from connection pooling setup)
- Runtime connection pooling via @effect/sql-pg PgClient

## Platform Requirements

**Development:**
- Node.js 25.2.1 (exact version required)
- pnpm 10.28.2
- Git (for Lefthook pre-commit hooks)
- Ports: 4000 (API server default), 6379 (Redis default)

**Production:**
- Node.js 25.2.1 runtime
- PostgreSQL 18.1 database (configurable via DATABASE_URL)
- Redis 6.0+ (standalone or Sentinel mode, optional for cache)
- AWS S3 or S3-compatible storage (configurable endpoint)
- Email provider: Resend, AWS SES, Postmark, or SMTP
- Kubernetes cluster (optional, for distributed deployments)
- OpenTelemetry collector (optional, for observability)

**Observability Stack:**
- @effect/opentelemetry 0.61.0 - OpenTelemetry integration for distributed tracing
- Metrics collection via custom service (MetricsService)
- Audit logging via AuditService (database-persisted)

---

*Stack analysis: 2026-02-13*
