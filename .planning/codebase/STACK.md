# Technology Stack

**Analysis Date:** 2026-01-26

## Languages

**Primary:**
- TypeScript 6.0-dev.20251125 - Used throughout monorepo for type safety; dev dependency enforced in `pnpm-workspace.yaml`

**Secondary:**
- JavaScript (Node.js) - Runtime for backend services

## Runtime

**Environment:**
- Node.js 25.2.1 - Enforced via `engines.node` in root `package.json`

**Package Manager:**
- pnpm 10.27.0 - Monorepo package manager with workspace support
- Lockfile: `pnpm-lock.yaml` (present)

## Frameworks

**Core:**
- Effect 3.19.15 - Functional effect system for async, error handling, and dependency injection
  - `@effect/platform` 0.94.2 - HTTP server, cookies, multipart handling
  - `@effect/platform-node` 0.104.1 - Node.js runtime integration
  - `@effect/sql` 0.49.0 - SQL query builder
  - `@effect/sql-pg` 0.50.1 - PostgreSQL driver via `PgClient`
  - `@effect/opentelemetry` 0.61.0 - Distributed tracing and observability
  - `@effect/rpc` 0.73.0 - RPC framework
  - `@effect/cluster` 0.56.1 - Cluster coordination
  - `@effect/workflow` 0.16.0 - Workflow orchestration
  - `@effect/experimental` 0.58.0 - Experimental Effect APIs
  - `@effect/ai` 0.33.2 - AI provider abstraction

**AI/LLM:**
- `@effect/ai-anthropic` 0.23.0 - Claude API integration
- `@effect/ai-openai` 0.37.2 - OpenAI API integration
- `@effect/ai-google` 0.12.1 - Google Gemini API integration

**Web Framework:**
- `@effect/platform` with `HttpApi` - Effect-based HTTP API definition
  - Schema-driven API endpoints with automatic validation

**Frontend:**
- React 19.3.0-canary (cutting-edge canary build) - UI framework
- React DOM 19.3.0-canary - DOM rendering
- React Aria 3.45.0 - Accessible component library
- React Compiler Runtime 1.0.0 - Babel React compiler support

**Styling:**
- Tailwind CSS 4.1.18 - Utility-first CSS framework
- `@tailwindcss/vite` 4.1.18 - Vite plugin for Tailwind
- Tailwind Merge 3.4.0 - Merge Tailwind classes dynamically

**Build/Dev:**
- Vite 7.3.1 - Fast module bundler
  - `@vitejs/plugin-react` 5.1.2 - React JSX transform
  - `vite-plugin-compression` 0.5.1 - Asset compression
  - `vite-plugin-csp` 1.1.2 - Content Security Policy plugin
  - `vite-plugin-image-optimizer` 2.0.3 - Image optimization
  - `vite-plugin-inspect` 11.3.3 - Vite module inspection
  - `vite-plugin-pwa` 1.2.0 - Progressive Web App support
  - `vite-plugin-svgr` 4.5.0 - SVGR import support
  - `vite-plugin-webfont-dl` 3.11.1 - Web font download plugin
- Nx 22.4.2 - Monorepo build orchestration
  - `@nx/vite` 22.4.2 - Vite integration
  - `@nx/react` 22.4.2 - React tooling
  - `@nx/js` 22.4.2 - JavaScript/TypeScript support
  - `@nx/docker` 22.4.2 - Docker support
  - `@nx/playwright` 22.4.2 - E2E testing

**Testing:**
- Vitest 4.0.18 - Unit/integration test runner
  - `@effect/vitest` 0.27.0 - Effect-Vitest integration
  - `@vitest/browser-playwright` 4.0.18 - Browser testing
  - `@vitest/coverage-v8` 4.0.18 - Code coverage reporting
  - `@vitest/ui` 4.0.18 - Test UI dashboard
  - `@fast-check/vitest` 0.2.4 - Property-based testing
- Playwright 1.58.0 - E2E testing framework
  - `@nx/playwright` 22.4.2 - Nx integration
- MSW 2.12.7 - Mock Service Worker for API mocking

**Mutation Testing:**
- `@stryker-mutator/core` 9.4.0 - Mutation testing
- `@stryker-mutator/vitest-runner` 9.4.0 - Vitest runner for Stryker

**Code Quality:**
- Biome 2.3.13 - Unified linter and formatter (replaces ESLint/Prettier)
  - `@berenddeboer/nx-biome` 1.0.2 - Nx integration for Biome
- SonarCloud 4.3.4 - Code quality and security scanning
- Knip 5.82.1 - Find unused dependencies
- Sherif 1.10.0 - TypeScript import linter

## Key Dependencies

**Critical:**
- `effect` 3.19.15 - Core functional programming runtime; all async/error handling flows through Effect
- `@effect/sql-pg` 0.50.1 - PostgreSQL driver via Effect; critical for all data access
- `@aws-sdk/client-s3` 3.975.0 - AWS S3 client
- `@effect-aws/client-s3` 1.10.9 - Effect wrapper for S3; drives all file storage operations

**Authentication & Authorization:**
- `arctic` 3.7.0 - OAuth2/OIDC library supporting GitHub, Google, Apple, Microsoft Entra ID
- `otplib` 13.2.1 - TOTP/MFA support
- `cockatiel` 3.2.1 - Circuit breaker pattern for resilience

**UI Components:**
- `lucide-react` 0.563.0 - Icon library
- `cmdk` 1.1.1 - Command palette component
- `vaul` 1.1.2 - Drawer component
- `@floating-ui/react` 0.27.16 - Floating UI positioning
- `motion` 12.29.2 - Animation library

**Data & State:**
- `zustand` 5.0.10 - Lightweight state management
  - `zustand-computed` 2.1.1 - Computed state support
  - `zustand-slices` 0.4.0 - Sliced store organization
- `zundo` 2.3.0 - Undo/redo middleware for Zustand
- `immer` 11.1.3 - Immutable state updates
- `@tanstack/react-table` 8.21.3 - Headless table library
- `@tanstack/react-virtual` 3.13.18 - Virtual scrolling

**File Handling:**
- `exceljs` 4.4.0 - Excel file generation/parsing
- `jszip` 3.10.1 - ZIP file manipulation
- `papaparse` 5.5.3 - CSV parsing
- `jspdf` 4.0.0 - PDF generation
- `sharp` 0.34.5 - Image processing
- `@xmldom/xmldom` 0.8.11 - XML DOM implementation
- `sax` 1.4.4 - XML parser

**Storage & Caching:**
- `ioredis` 5.9.2 - Redis client for caching/sessions
- `idb-keyval` 6.2.2 - IndexedDB wrapper for client storage
- `fake-indexeddb` 6.2.5 - In-memory IndexedDB for testing

**Utilities:**
- `nanoid` 5.1.6 - Tiny UUID generator
- `uuid` 13.0.0 - UUID generation
- `date-fns` 4.1.0 - Date manipulation
- `clsx` 2.1.1 - Classname utility
- `class-variance-authority` 0.7.1 - CSS variant system
- `tailwind-merge` 3.4.0 - Tailwind class merging
- `rfc6902` 5.1.2 - JSON Patch RFC 6902
- `yaml` 2.8.2 - YAML parser
- `ipaddr.js` 2.3.0 - IP address validation

**Type Utilities:**
- `ts-toolbelt` 9.6.0 - Advanced TypeScript types
- `ts-essentials` 10.1.1 - Essential TypeScript utilities
- `type-fest` 5.4.1 - Collection of useful types

**Observability:**
- `@effect/opentelemetry` 0.61.0 - OTEL integration
- `@effect/printer` 0.47.0 - Pretty printing
- `@effect/printer-ansi` 0.47.0 - ANSI color support

**Testing Utilities:**
- `@testing-library/react` 16.3.2 - React component testing
- `happy-dom` 20.3.9 - Lightweight DOM for testing
- `fast-check` 4.5.3 - Property-based testing

**Infrastructure & Tools:**
- `tsx` 4.21.0 - TypeScript execution for scripts
- `@swc/core` 1.15.10 - SWC compiler (used by Biome)
- `@swc-node/register` 1.11.1 - SWC Node.js register
- `@rollup/plugin-typescript` 12.3.0 - TypeScript Rollup plugin
- `@mermaid-js/mermaid-cli` 11.12.0 - Mermaid diagram generation
- `rollup-plugin-visualizer` 6.0.5 - Bundle visualization
- `lightnin-css` 1.31.1 - Fast CSS parser
- `lefthook` 2.0.15 - Git hooks
- `@octokit/rest` 22.0.1 - GitHub API client
- `@anthropic-ai/tokenizer` 0.0.4 - Anthropic token counting

## Configuration

**Environment:**
- Configured via standard Node.js environment variables
- Redacted fields: `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `POSTGRES_PASSWORD`, `DATABASE_URL`, API keys for AI providers
- Key configs in `packages/server/src/context.ts`, `packages/database/src/client.ts`, `packages/server/src/infra/storage.ts`

**Build:**
- Root: `vite.config.ts` (apps and packages)
- TypeScript: `tsconfig.json` (project references), `tsconfig.base.json` (shared config)
- Biome: `biome.json` - Linting and formatting rules
- Nx: `nx.json` - Build system configuration
- pnpm: `pnpm-workspace.yaml` - Workspace and catalog configuration

## Platform Requirements

**Development:**
- Node.js 25.2.1
- pnpm 10.27.0
- TypeScript 6.0-dev.20251125 (canary build)

**Production:**
- Node.js 25.2.1
- PostgreSQL 18.1+ (for `@effect/sql-pg`)
- Redis (optional, for session storage via `ioredis`)
- AWS S3 or S3-compatible storage (required for file storage)
- OpenTelemetry Collector (optional, for OTEL export)

**Runtime Support:**
- ESM (ES Modules) - enforced via `"type": "module"` in all package.json files
- Target: ESNext (modern JavaScript)

---

*Stack analysis: 2026-01-26*
