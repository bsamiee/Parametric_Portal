# 1.0.0 (2025-12-22)

### [BUG_FIXES]

- ⚠️  types and modernize PostgreSQL schema ([#109](https://github.com/bsamiee/Parametric_Portal/pull/109))
- **ci:** resolve Vite 7 SSR build and AI workflow authentication ([e2a6a6a](https://github.com/bsamiee/Parametric_Portal/commit/e2a6a6a))
- **vite:** correct TypeScript types in buildAppHandlers ([a56fb68](https://github.com/bsamiee/Parametric_Portal/commit/a56fb68))

### ⚠️  Breaking Changes

- types and modernize PostgreSQL schema  ([#109](https://github.com/bsamiee/Parametric_Portal/pull/109))
  Removed @parametric-portal/database/schema barrel file.
  Consumers must import from @parametric-portal/types/database directly.
  Major fixes:
  - Remove bracket notation workarounds in auth.ts - use proper dot notation
  - Return branded TokenHash type from hashString instead of string
  - Enforce SHA-256 output length in hex pattern: /^[0-9a-f]{64}$/i
  - Eliminate type alias indirection (Email, Slug imported directly)
  Migration:
  - Migrate all 5 consumers from @parametric-portal/database/schema
    to @parametric-portal/types/database
  - Delete packages/database/src/schema.ts barrel file entirely
  - Update package.json exports and vite.config.ts entries
  - Rename SCHEMA_TUNING to DATABASE_TYPES_TUNING at import sites
  This eliminates the biome-ignore suppression comment and resolves
  all issues raised in Claude's PR review properly at the root.
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix(backend): address Claude review comments with proper root fixes
  BREAKING CHANGE: Migration 0002_sessions.ts updated
  Changes:
  - Fix CHECK constraints: ^[0-9a-f]+$ → ^[0-9a-f]{64}$ (enforce SHA-256 length)
  - Fix partial indexes: remove volatile now() from WHERE clauses
  - Rename OAuthAccountIdSchema → DeleteOAuthAccountParams (clarity)
  - Fix type cast: use Uuidv7Schema in SessionResponseSchema (type safety)
  - Fix hashString: use Effect.tryPromise with HashingError (proper errors)
  - Update middleware: handle HashingError → UnauthorizedError mapping
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix(devtools): resolve safeString edge case and address PR review comments
  - Fix safeString to handle nested objects with non-callable toString
    (e.g., [[{"toString":false}]]) using expression-centric type dispatch
  - Rename DATABASE_TYPES_TUNING to SCHEMA_TUNING for naming consistency
  - Replace Array.from() with spread [...] in crypto.ts
  - Add partial index for active sessions in migrations
  - Use TokenHashSchema for InsertSession/InsertRefreshToken
  - Configure vitest for CI: truncateThreshold=0, verbose reporter,
    github-actions reporter, JSON/JUnit output files
  - Add test-results to nx.json outputs
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix: resolve TypeScript errors and CI test flakiness
  - Change vitest CI reporter from 'verbose' to 'dot' to reduce stdout buffering
  - Remove coverage thresholds that weren't being enforced consistently
  - Fix index signature access: use bracket notation for process.env properties
  - Add optional chaining for potentially undefined array accesses in tests
  - Add explicit type annotation for mockPerformanceObserver return type
  - Fix exactOptionalPropertyTypes compliance in test utilities
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix(devtools): add silent option to logger to prevent stdout in CI
  - Add `silent` option to createLoggerLayer and createCombinedLogger
  - When silent=true, skip Logger.prettyLogger() to prevent console output
  - Update test utilities to use silent=true by default
  - Update logger.spec.ts tests to use silent option
  - Fixes CI flakiness caused by massive stdout from property-based tests
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5
- Copilot @Copilot

## 0.6.13 (2025-12-21)

### [BUG_FIXES]

- -based test suites for types and theme packages ([#108](https://github.com/bsamiee/Parametric_Portal/pull/108))
- **gemini:** remove is_auto_triggered tracking, simplify acknowledgment ([76e91d2](https://github.com/bsamiee/Parametric_Portal/commit/76e91d2))
- **workflows:** remove Claude restrictions, add Gemini synchronize trigger ([b04c999](https://github.com/bsamiee/Parametric_Portal/commit/b04c999))
- **workflows:** remove synchronize trigger from Claude/Gemini reviews ([c20d6a6](https://github.com/bsamiee/Parametric_Portal/commit/c20d6a6))

### [REFACTORING]

- **workflows:** simplify Claude and Gemini review workflows ([bdaa8ea](https://github.com/bsamiee/Parametric_Portal/commit/bdaa8ea))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5
- Copilot @Copilot

## 0.6.12 (2025-12-21)

### [BUG_FIXES]

- **biome:** disable formatter for package.json files ([038c3df](https://github.com/bsamiee/Parametric_Portal/commit/038c3df))

### ❤️ Thank You

- bsamiee
- Claude Opus 4.5

## 0.6.11 (2025-12-21)

### [FEATURES]

- **actions:** add claude-setup composite action for CLI caching ([dcc5686](https://github.com/bsamiee/Parametric_Portal/commit/dcc5686))

### [BUG_FIXES]

- **ci:** use pull_request_target to bypass approval requirements ([c1a0502](https://github.com/bsamiee/Parametric_Portal/commit/c1a0502))
- **ci:** remove broken claude-setup action, fix devtools test issues ([5b48eba](https://github.com/bsamiee/Parametric_Portal/commit/5b48eba))

### ❤️ Thank You

- bsamiee
- Claude Opus 4.5

## 0.6.10 (2025-12-21)

### [BUG_FIXES]

- **hooks:** replace void operator with explicit .catch() for fire-and-forget ([5f52f99](https://github.com/bsamiee/Parametric_Portal/commit/5f52f99))

### ❤️ Thank You

- bsamiee

## 0.6.9 (2025-12-21)

### [REFACTORING]

- scope d.ts ignore to dist/, add biome override for vite-env ([c7630a7](https://github.com/bsamiee/Parametric_Portal/commit/c7630a7))

### ❤️ Thank You

- bsamiee

## 0.6.8 (2025-12-21)

### [BUG_FIXES]

- **github:** pr-hygiene minimize all comments, delete all user chatops ([3ee2d98](https://github.com/bsamiee/Parametric_Portal/commit/3ee2d98))
- **parametric-icons:** track vite-env.d.ts for env type declarations ([7b401b2](https://github.com/bsamiee/Parametric_Portal/commit/7b401b2))
- **workflows:** add GitHub App token minting, fix if: syntax ([b078a54](https://github.com/bsamiee/Parametric_Portal/commit/b078a54))

### [REFACTORING]

- **workflows:** remove GitHub App token minting, simplify auth ([7280765](https://github.com/bsamiee/Parametric_Portal/commit/7280765))

### ❤️ Thank You

- bsamiee

## 0.6.7 (2025-12-21)

### [FEATURES]

- **ci:** add VPS auto-sync workflow ([84f8d14](https://github.com/bsamiee/Parametric_Portal/commit/84f8d14))
- **parametric-icons:** add icon generator app with AI integration ([7abc72f](https://github.com/bsamiee/Parametric_Portal/commit/7abc72f))

### [BUG_FIXES]

- **sonar:** separate resourceKey patterns for S6748 ([25de0b8](https://github.com/bsamiee/Parametric_Portal/commit/25de0b8))
- **sonar:** use universal file pattern for rule exclusions ([8d371ce](https://github.com/bsamiee/Parametric_Portal/commit/8d371ce))

### [REFACTORING]

- **ci:** rename VPS sync to Agentic Server Sync ([dc2eb67](https://github.com/bsamiee/Parametric_Portal/commit/dc2eb67))
- **ci:** rename to n8n Server Sync ([44a3a6c](https://github.com/bsamiee/Parametric_Portal/commit/44a3a6c))

### ❤️ Thank You

- bsamiee
- Claude Opus 4.5
- n8n-agent

## 0.6.6 (2025-12-13)

### [BUG_FIXES]

- **quality:** resolve SonarCloud code smells ([b370575](https://github.com/bsamiee/Parametric_Portal/commit/b370575))

### ❤️ Thank You

- bsamiee

## 0.6.5 (2025-12-11)

### [BUG_FIXES]

- **workflows:** update Claude workflows for TypeScript monorepo ([e66fbd0](https://github.com/bsamiee/Parametric_Portal/commit/e66fbd0))

### ❤️ Thank You

- bsamiee

## 0.6.4 (2025-12-11)

### [REFACTORING]

- **skills:** update tool scripts and configuration ([6a5cb4a](https://github.com/bsamiee/Parametric_Portal/commit/6a5cb4a))

### ❤️ Thank You

- bsamiee

## 0.6.3 (2025-12-11)

### [BUG_FIXES]

- **security:** resolve SonarCloud blockers and refactor style workflow ([f448bcf](https://github.com/bsamiee/Parametric_Portal/commit/f448bcf))

### ❤️ Thank You

- bsamiee

## 0.6.2 (2025-12-11)

This was a version bump only, there were no code changes.

## 0.6.1 (2025-12-09)

### [FEATURES]]

- Advanced architecture templates with optimized ELK layout and enhanced Dracula theme ([#98](https://github.com/bsamiee/Parametric_Portal/pull/98))
- Add orthogonal label system for AI agent coordination ([#100](https://github.com/bsamiee/Parametric_Portal/pull/100))

### [BUG_FIXES]

- integrate marketplace actions, fix PR title normalization, consolidate workflow comments, fix Gemini dispatch permissions, and automate Claude Code Review ([#97](https://github.com/bsamiee/Parametric_Portal/pull/97))
- consolidate PR comments into body, simplify Gemini auth, fix workflow issues ([5b777be](https://github.com/bsamiee/Parametric_Portal/commit/5b777be))
- **ci:** resolve Biome lint errors in label-validator ([7d63a69](https://github.com/bsamiee/Parametric_Portal/commit/7d63a69))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.6.0 (2025-12-08)

### [FEATURES]]

- Add repo-agnostic changed-files workflow with Nx integration and unified PR comments ([#96](https://github.com/bsamiee/Parametric_Portal/pull/96))
- agentic infrastructure overhaul with skill system and style standards ([ad59dc6](https://github.com/bsamiee/Parametric_Portal/commit/ad59dc6))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.5.3 (2025-12-02)

### [BUG_FIXES]

- update ghaction-github-labeler to v5.3.0 (resolve 100% workflow failure) ([#89](https://github.com/bsamiee/Parametric_Portal/pull/89))
- invert negated condition in fallbackStack ternary + fix SonarCloud workflow ([#91](https://github.com/bsamiee/Parametric_Portal/pull/91))
- Issue Helper action for declarative issue automation ([#92](https://github.com/bsamiee/Parametric_Portal/pull/92))
- **renovate:** add collision safeguard and trigger dashboard recreation    2 │    3 │ - Add exclusion filter in schema.ts mutate function to never touch    4 │   Renovate's Dependency Dashboard issue (both share 'dashboard' label)    5 │ - Enable dependencyDashboardApproval to force Renovate to recreate    6 │   the dashboard on next run    7 │    8 │ 🤖 Generated with [Claude Code](https://claude.com/claude-code)    9 │   10 │ Co-Authored-By: Claude <noreply@anthropic.com> ─────┴────────────────────────────────────────────────────────────────────────── ([179393f](https://github.com/bsamiee/Parametric_Portal/commit/179393f))

### [DOCUMENTATION]

- update agentic infrastructure documentation to reflect production implementation ([#88](https://github.com/bsamiee/Parametric_Portal/pull/88))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude
- Copilot @Copilot

## 0.5.2 (2025-12-01)

### [DOCUMENTATION]

- finalize CLAUDE.md and REQUIREMENTS.md agent protocols ([60d13cb](https://github.com/bsamiee/Parametric_Portal/commit/60d13cb))

### ❤️ Thank You

- bsamiee

## 0.5.1 (2025-11-30)

### Refactoring

- comprehensive GitHub workflow infrastructure audit and optimization ([#76](https://github.com/bsamiee/Parametric_Portal/pull/76), [#77](https://github.com/bsamiee/Parametric_Portal/issues/77))

### ❤️ Thank You

- bsamiee @bsamiee
- Copilot @Copilot

## 0.5.0 (2025-11-30)

### Features

- integrate Nx auto-healing with unified CI workflow ([ef2ed70](https://github.com/bsamiee/Parametric_Portal/commit/ef2ed70))
- aggressive biome and Nx auto-healing with force merge ([9b3e93e](https://github.com/bsamiee/Parametric_Portal/commit/9b3e93e))
- add dynamic agent allocation for PR-size-based distribution ([d298ca7](https://github.com/bsamiee/Parametric_Portal/commit/d298ca7))
- **nx:** integrate Nx Release and optimize CI pipeline ([1e5a2af](https://github.com/bsamiee/Parametric_Portal/commit/1e5a2af))

### Bug Fixes

- address reviewer comments for CI workflow ([d520670](https://github.com/bsamiee/Parametric_Portal/commit/d520670))
- remove circular reset target from nx.json ([08ff652](https://github.com/bsamiee/Parametric_Portal/commit/08ff652))
- improve Nx Cloud CI configuration based on official docs ([3bef613](https://github.com/bsamiee/Parametric_Portal/commit/3bef613))
- align messaging to REQUIREMENTS.md standards and add CHANGELOG.md ([f9b978b](https://github.com/bsamiee/Parametric_Portal/commit/f9b978b))
- address reviewer feedback - proper Nx integration and license compliance ([01cce36](https://github.com/bsamiee/Parametric_Portal/commit/01cce36))
- improve license compliance filter logic ([4f47a9d](https://github.com/bsamiee/Parametric_Portal/commit/4f47a9d))
- quote YAML description with colons to prevent parsing error ([2006943](https://github.com/bsamiee/Parametric_Portal/commit/2006943))
- add always() to release job condition for skipped dependency chain ([9455b43](https://github.com/bsamiee/Parametric_Portal/commit/9455b43))
- **claude:** replace UTF-8 >= with ASCII >= for better parsing ([537e1e4](https://github.com/bsamiee/Parametric_Portal/commit/537e1e4))
- **infra:** address PR review feedback and fix CI failures ([c7ad68e](https://github.com/bsamiee/Parametric_Portal/commit/c7ad68e))

### Performance

- optimize TTG by starting Nx Agents before dependencies ([c743eab](https://github.com/bsamiee/Parametric_Portal/commit/c743eab))

### Refactoring

- optimize Nx configuration and CI workflow integration ([aaa41a3](https://github.com/bsamiee/Parametric_Portal/commit/aaa41a3))
- clean Nx Cloud ID handling via env.ts fallback ([57d0aa9](https://github.com/bsamiee/Parametric_Portal/commit/57d0aa9))
- implement official Claude Code Action and standardize workflow versions ([#68](https://github.com/bsamiee/Parametric_Portal/pull/68))
- remove rulesets and simplify CI workflow ([391a8eb](https://github.com/bsamiee/Parametric_Portal/commit/391a8eb))
- **infra:** streamline infrastructure with Nx Cloud caching ([42f17c4](https://github.com/bsamiee/Parametric_Portal/commit/42f17c4))
- **infra:** align commit types across nx.json, labels, and schema ([99e9d02](https://github.com/bsamiee/Parametric_Portal/commit/99e9d02))

### Documentation

- update AGENTIC-INFRASTRUCTURE.md and fix issue pinning workflow ([#67](https://github.com/bsamiee/Parametric_Portal/pull/67))
- **infra:** update AGENTIC-INFRASTRUCTURE.md to match refactored state ([bdfcac3](https://github.com/bsamiee/Parametric_Portal/commit/bdfcac3))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude
- Copilot @Copilot

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- Nx release will auto-generate content below from conventional commits -->
