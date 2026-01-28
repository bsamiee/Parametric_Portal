# Technology Stack

**Analysis Date:** 2026-01-28

## Languages

**Primary:**
- TypeScript 6.0.0-dev.20251125 - All application code (bleeding-edge)

**Secondary:**
- JavaScript - Configuration files only (Stryker, build scripts)

## Runtime

**Environment:**
- Node.js 25.2.1 (enforced via `engines.nodeStrict: true`)

**Package Manager:**
- pnpm 10.27.0 (workspace with catalog mode)
- Lockfile: `pnpm-lock.yaml` (present)
- Catalog: `pnpm-workspace.yaml` (strict mode, 145+ managed versions)

## Frameworks

**Core:**
- Effect 3.19.15 - Functional effects system (application architecture)
- React 19.3.0-canary-f93b9fd4-20251217 - UI library
- Vite 7.3.1 - Build tool and dev server
- Nx 22.4.2 - Monorepo orchestration

**Testing:**
- Vitest 4.0.18 - Unit and integration tests
- Playwright 1.58.0 - End-to-end tests
- Stryker 9.4.0 - Mutation testing
- fast-check 4.5.3 - Property-based testing

**Build/Dev:**
- tsx 4.21.0 - TypeScript execution
- @swc/core 1.15.10 - Fast TypeScript/JavaScript compiler
- @biomejs/biome 2.3.13 - Linting and formatting
- @rollup/plugin-typescript 12.3.0 - TypeScript bundling

## Key Dependencies

**Critical:**
- effect 3.19.15 - Core programming model (all packages)
- @effect/platform 0.94.2 - Cross-platform abstractions
- @effect/platform-node 0.104.1 - Node.js runtime integration
- @effect/sql 0.49.0 - SQL client abstraction
- @effect/sql-pg 0.50.1 - PostgreSQL adapter
- @effect/opentelemetry 0.61.0 - Observability integration

**Infrastructure:**
- @aws-sdk/client-s3 3.975.0 - S3 storage client
- @effect-aws/client-s3 1.10.9 - Effect-wrapped S3 client
- ioredis 5.9.2 - Redis client for caching
- arctic 3.7.0 - OAuth provider library
- otplib 13.2.1 - TOTP/2FA generation
- cockatiel 3.2.1 - Circuit breaker and resilience

**AI/LLM:**
- @effect/ai 0.33.2 - LLM abstraction
- @effect/ai-anthropic 0.23.0 - Claude integration
- @effect/ai-google 0.12.1 - Gemini integration
- @effect/ai-openai 0.37.2 - OpenAI integration

**Data Processing:**
- exceljs 4.4.0 - Excel file manipulation
- jszip 3.10.1 - ZIP archive handling
- papaparse 5.5.3 - CSV parsing
- sax 1.4.4 - XML streaming
- yaml 2.8.2 - YAML parsing

**Frontend State:**
- zustand 5.0.10 - State management
- zundo 2.3.0 - Undo/redo for Zustand
- immer 11.1.3 - Immutable updates

**UI Components:**
- react-aria-components 1.14.0 - Accessible UI primitives
- @tanstack/react-table 8.21.3 - Table component
- lucide-react 0.563.0 - Icon library
- tailwindcss 4.1.18 - Utility CSS framework
- @tailwindcss/vite 4.1.18 - Vite plugin

## Configuration

**Environment:**
- Effect Config system (`Config.string`, `Config.redacted`)
- No `.env` files in workspace (config via environment variables)
- Runtime validation at startup via Effect Config

**Build:**
- `tsconfig.base.json` - TypeScript project references, strict mode
- `vite.config.ts` - Shared Vite configuration
- `vitest.config.ts` - Test runner configuration
- `nx.json` - Task orchestration and caching
- `biome.json` - Linting and formatting rules

## Platform Requirements

**Development:**
- Node.js 25.2.1 (exact)
- pnpm 10.27.0 (corepack)
- TypeScript 6.0.0-dev (bleeding-edge)
- Nx CLI 22.4.2

**Production:**
- Docker container (`apps/api/Dockerfile`)
- Node.js 22-slim-bookworm (runtime image)
- Kubernetes deployment (infrastructure manifests present)
- PostgreSQL 16+ (via CloudNativePG operator)
- Redis 7+ (session/cache store)
- S3-compatible storage (MinIO or AWS S3)

---

*Stack analysis: 2026-01-28*
