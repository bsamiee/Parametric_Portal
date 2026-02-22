# Technology Stack

**Analysis Date:** 2026-02-22

## Languages

**Primary:**
- TypeScript 6.0.0-dev.20251125 - All packages and apps (`packages/`, `apps/api/`, `apps/kargadan/harness/`)
- C# net10.0 - Rhino3D plugin and custom Roslyn analyzer (`apps/kargadan/plugin/`, `apps/cs-analyzer/`)
- Python >=3.14 - AI/scientific tooling, agent scripts (`pyproject.toml` root workspace)

**Secondary:**
- CSS - Component theming via Tailwind CSS v4 (`packages/theme/`, `packages/components/`)

## Runtime

**Environment:**
- Node.js 25.6.1 (pinned via `engines.node` in `package.json`)
- .NET 10.0 (pinned via `TargetFramework` in `Directory.Build.props`)
- Python 3.14 (pinned via `requires-python` in `pyproject.toml`)

**Package Manager:**
- pnpm 10.30.1 (pinned via `packageManager` in `package.json`)
- uv (Python, `cache-dir = ".cache/uv"` in `pyproject.toml`)
- NuGet with lock files (`RestorePackagesWithLockFile=true` in `Directory.Build.props`)
- Lockfile: `pnpm-lock.yaml` present; `packages.lock.json` per .NET project; `uv.lock` for Python

## Frameworks

**Core (TypeScript — Backend):**
- Effect 3.19.18 - Functional effect system; the central runtime for all backend services
- `@effect/platform-node` 0.104.1 - Node.js HTTP server, filesystem, process
- `@effect/sql` + `@effect/sql-pg` 0.49.0/0.50.3 - Type-safe SQL with PostgreSQL driver
- `@effect/cluster` 0.56.4 - Distributed actor model for leader election, durable execution
- `@effect/workflow` 0.16.0 - Durable workflow execution
- `@effect/rpc` 0.73.2 - Type-safe RPC protocol

**Core (TypeScript — Frontend):**
- React 19.3.0-canary-f93b9fd4-20251217 - UI framework with React Compiler enabled
- Vite 7.3.1 - Build tool and dev server
- Tailwind CSS 4.2.0 - Utility-first CSS
- React Aria Components 1.15.1 + react-stately 3.44.0 - Accessible primitives (Adobe)
- Zustand 5.0.11 - Client state management
- TanStack Table 8.21.3 + TanStack Virtual 3.13.18 - Tabular data and virtualization

**Core (C#):**
- LanguageExt.Core 5.0.0-beta-77 - Functional programming primitives (private pre-release feed)
- Thinktecture.Runtime.Extensions 10.0.0 - Value object source generation
- FluentValidation 12.1.1 - Input validation
- Polly.Core 8.6.5 - Resilience and retry policies
- NodaTime 3.3.0 - Immutable date/time
- Npgsql 10.0.1 - PostgreSQL client for .NET
- Serilog (AspNetCore 10.0.0 + OpenTelemetry sink) - Structured logging
- OpenTelemetry 1.15.0 - Observability instrumentation

**Core (Python):**
- anyio - Async I/O (asyncio replacement)
- pydantic + pydantic-settings - Schema validation and typed config
- msgspec - High-performance serialization
- structlog - Structured logging
- returns + expression - Railway-oriented programming (FP primitives)
- stamina - Retry/resilience
- opentelemetry-sdk - Observability
- beartype - Runtime type enforcement

**AI:**
- `@effect/ai` 0.33.2 - Effect-native AI orchestration
- `@effect/ai-anthropic` 0.23.0 - Anthropic Claude integration
- `@effect/ai-google` 0.12.1 - Google Gemini integration
- `@effect/ai-openai` 0.37.2 - OpenAI integration
- `@effect/ai` McpServer - MCP (Model Context Protocol) server layer

**Testing:**
- Vitest 4.0.18 - Primary test runner for TypeScript
- `@effect/vitest` 0.27.0 - Effect-aware test utilities (`it.effect`, `it.effect.prop`)
- fast-check 4.5.3 - Property-based testing (algebraic PBT)
- Stryker 9.5.1 + vitest-runner - Mutation testing
- `@playwright/test` 1.58.2 - E2E browser testing
- happy-dom 20.7.0 + jsdom 28.1.0 - DOM simulation environments
- testcontainers 11.12.0 - Docker-based integration test dependencies (declared, used in .NET tests via `Testcontainers.PostgreSql`)
- FsCheck 3.3.2 - Property-based testing for .NET
- pytest + hypothesis - Python testing and PBT

**Build/Dev:**
- Nx 22.5.2 - Monorepo task orchestration with caching
- Biome 2.4.4 - Linting and formatting (TypeScript/JavaScript)
- ruff + ty - Python linting and type checking
- SWC (`@swc/core` 1.15.11) - TypeScript transpilation for Nx
- Pulumi (3.223.0) - Infrastructure as code (TypeScript)
- Lefthook 2.1.1 - Git hooks
- Knip 5.84.1 - Dead code and unused dependency detection
- sherif 1.10.0 - Monorepo package constraint enforcement
- lightningcss 1.31.1 - CSS processing

## Key Dependencies

**Critical:**
- `effect` 3.19.18 - Used in every TypeScript package; the Effect runtime is the primary composition mechanism
- `@effect/sql-pg` 0.50.3 - All database access routes through this; no raw query escape hatches
- `ioredis` 5.9.3 - Redis client (`packages/server/src/platform/cache.ts`); supports standalone and Sentinel modes
- `@effect/cluster` 0.56.4 - Leader election and distributed job scheduling
- `arctic` 3.7.0 - OAuth 2.0 client (GitHub, Google, Apple, Microsoft Entra ID)
- `@simplewebauthn/server` 13.2.2 - WebAuthn passkey registration and assertion
- `otplib` 13.3.0 - TOTP MFA
- `nanoid` 5.1.6 - ID generation

**Infrastructure:**
- `@pulumi/aws` 7.20.0, `@pulumi/awsx` 3.2.0 - AWS EKS, RDS, ElastiCache, S3 provisioning
- `@pulumi/kubernetes` 4.26.0 - Kubernetes resource management
- `@pulumi/docker` 4.11.0 - Docker image builds in IaC
- `@aws-sdk/client-s3` 3.995.0 + `@effect-aws/client-s3` 1.10.9 - S3 object storage (cloud mode)
- `@aws-sdk/client-sesv2` 3.995.0 - AWS SES email (one of four email providers)
- `@dopplerhq/node-sdk` 1.3.0 - Secrets management (`packages/server/src/platform/doppler.ts`)
- `@effect/opentelemetry` 0.61.0 - OTLP trace/metric/log export

**UI:**
- `lucide-react` 0.575.0 - Icon library
- `motion` 12.34.3 - Animation
- `@floating-ui/react` 0.27.18 - Tooltip/popover positioning
- `@gltf-transform/core` 4.3.0 - 3D mesh processing (parametric/Rhino integration)
- `cmdk` 1.1.1 - Command palette
- `vaul` 1.1.2 - Drawer component
- `class-variance-authority` 0.7.1 + `clsx` 2.1.1 + `tailwind-merge` 3.5.0 - Class composition
- `nuqs` 2.8.8 - URL search param state
- `date-fns` 4.1.0 - Date utilities
- `jspdf` 4.2.0 + `jszip` 3.10.1 + `exceljs` 4.4.0 + `papaparse` 5.5.3 - Document export
- `RhinoCommon` 9.0.25350.305-wip + `Rhino.Inside` 9.0.26013.15500-beta - Rhino3D geometry engine (C# plugin)

## Configuration

**Environment:**
- All runtime environment parsed and typed in `packages/server/src/env.ts` via Effect `Config` module
- Two deployment modes: `cloud` (EKS + RDS + ElastiCache + S3) and `selfhosted` (Docker Compose + Garage + Traefik)
- Secrets managed via Doppler; runtime secrets projected by `Env.runtimeProjection()` into config vs secret buckets
- Key required vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `REDIS_PASSWORD`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `DOPPLER_TOKEN`
- Dev defaults for all optional vars (port 4000, localhost Redis, etc.)

**Build:**
- `tsconfig.base.json` - Root TypeScript config; `module: "preserve"`, `moduleResolution: "bundler"`, `erasableSyntaxOnly: true`
- `vite.config.ts` + `vite.factory.ts` - Shared Vite configuration factory
- `biome.json` - Linting/formatting (formatter disabled for TS source to preserve manual inlining)
- `Directory.Build.props` - Global NuGet package versions and analyzer configuration
- `pyproject.toml` - Python tooling config (ruff, ty, mypy, pytest)
- `nx.json` - Monorepo task graph, caching inputs/outputs, plugin registration

## Platform Requirements

**Development:**
- Node.js 25.6.1 + pnpm 10.30.1
- .NET 10.0 SDK
- Python 3.14 + uv
- Docker (for Dockerfiles and self-hosted mode)

**Production:**
- Cloud: AWS EKS (Kubernetes), RDS PostgreSQL 18.2, ElastiCache Redis 8.6.0, S3
- Self-hosted: Docker Compose with Traefik reverse proxy, Garage (S3-compatible), PostgreSQL 18.2-alpine, Redis 8.6.0-alpine
- Observability: Grafana Alloy (OTLP receiver) → Prometheus → Grafana
- Container registry: `ghcr.io` (GitHub Container Registry), built via `.github/workflows/deploy.yml`

---

*Stack analysis: 2026-02-22*
