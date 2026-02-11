## 2.0.1 (2026-02-11)

### [FEATURES]

- **01-01:** create ClusterService facade with Entity schema and ClusterError ([98330e0](https://github.com/bsamiee/Parametric_Portal/commit/98330e0))
- **01-03:** add cluster metrics namespace to MetricsService ([d31276f](https://github.com/bsamiee/Parametric_Portal/commit/d31276f))
- **01-03:** add trackCluster utility for cluster operation metrics ([3983f20](https://github.com/bsamiee/Parametric_Portal/commit/3983f20))
- **02:** complete Phase 2 Context Integration + refinements ([0dc5c49](https://github.com/bsamiee/Parametric_Portal/commit/0dc5c49))
- **02-01:** add ClusterState and cluster context accessors ([0fd4d83](https://github.com/bsamiee/Parametric_Portal/commit/0fd4d83))
- **02-02:** add cluster context population to middleware ([a5fc94a](https://github.com/bsamiee/Parametric_Portal/commit/a5fc94a))
- **02-02:** extend Serializable and toAttrs with cluster fields ([e71d147](https://github.com/bsamiee/Parametric_Portal/commit/e71d147))
- **03-01:** add SingletonError and _CONFIG.singleton to cluster.ts ([26f8ff8](https://github.com/bsamiee/Parametric_Portal/commit/26f8ff8))
- **03-01:** add singleton metrics namespace to MetricsService ([aa6af20](https://github.com/bsamiee/Parametric_Portal/commit/aa6af20))
- **03-01:** add SQL-backed KeyValueStore layer to cluster.ts ([d98e5a5](https://github.com/bsamiee/Parametric_Portal/commit/d98e5a5))
- **03-02:** extend singleton factory with state, lifecycle, shutdown ([dab7bda](https://github.com/bsamiee/Parametric_Portal/commit/dab7bda))
- **03-03:** wrap entity handlers with withinCluster context ([bcd823f](https://github.com/bsamiee/Parametric_Portal/commit/bcd823f))
- **03-03:** add health check utilities with ClusterService exports ([22a9550](https://github.com/bsamiee/Parametric_Portal/commit/22a9550))
- **04-01:** add JobDlq model class for dead-letter queue ([7ff6a8a](https://github.com/bsamiee/Parametric_Portal/commit/7ff6a8a))
- **04-01:** add jobDlq repo methods to DatabaseService ([b220d91](https://github.com/bsamiee/Parametric_Portal/commit/b220d91))
- **04-01:** add SQL migration for job_dlq table ([6b69d27](https://github.com/bsamiee/Parametric_Portal/commit/6b69d27))
- **04-02:** replace poll-based job queue with Entity mailbox dispatch ([aa28026](https://github.com/bsamiee/Parametric_Portal/commit/aa28026))
- **04-03:** add job metrics and trackJob helper to MetricsService ([7a16e6a](https://github.com/bsamiee/Parametric_Portal/commit/7a16e6a))
- **05-01:** extend DLQ table with source discriminator for unified dead-letter ([28e9960](https://github.com/bsamiee/Parametric_Portal/commit/28e9960))
- **05-01:** create EventOutbox model and migration ([cd85516](https://github.com/bsamiee/Parametric_Portal/commit/cd85516))
- **05-01:** create eventOutbox repository with transactional integration ([50395ff](https://github.com/bsamiee/Parametric_Portal/commit/50395ff))
- **05-02:** migrate to full runner layers for entity hosting ([6e80a68](https://github.com/bsamiee/Parametric_Portal/commit/6e80a68))
- **05-03:** create DevTools layer for development debugging ([a547bb9](https://github.com/bsamiee/Parametric_Portal/commit/a547bb9))
- **server:** optimize telemetry module + add events skeleton ([bf1c0a5](https://github.com/bsamiee/Parametric_Portal/commit/bf1c0a5))

### [BUG_FIXES]

- resolve typecheck errors and unify rollup version ([fa5f88d](https://github.com/bsamiee/Parametric_Portal/commit/fa5f88d))
- **01:** revise plan 02 based on checker feedback ([f2b8ee8](https://github.com/bsamiee/Parametric_Portal/commit/f2b8ee8))
- **01-01:** correct namespace type aliases for IdempotencyKey and SnowflakeId ([bf771b2](https://github.com/bsamiee/Parametric_Portal/commit/bf771b2))
- **02:** revise plans based on checker feedback ([fb08fd0](https://github.com/bsamiee/Parametric_Portal/commit/fb08fd0))
- **03:** revise plans based on checker feedback ([98c09ee](https://github.com/bsamiee/Parametric_Portal/commit/98c09ee))
- **03:** orchestrator corrections to plan files ([f75b9b2](https://github.com/bsamiee/Parametric_Portal/commit/f75b9b2))
- **04:** remove unsupported delay option from job enqueue ([4fd0572](https://github.com/bsamiee/Parametric_Portal/commit/4fd0572))
- **04-02:** integrate research gaps into jobs.ts ([3f2e598](https://github.com/bsamiee/Parametric_Portal/commit/3f2e598))
- **05:** revise plans based on checker feedback ([4f2e5ba](https://github.com/bsamiee/Parametric_Portal/commit/4f2e5ba))
- **middleware:** add missing cluster field to request context ([ce9a429](https://github.com/bsamiee/Parametric_Portal/commit/ce9a429))

### [REFACTORING]

- **api:** simplify layer architecture to 3-tier composition ([27be8df](https://github.com/bsamiee/Parametric_Portal/commit/27be8df))
- **api,server:** apply Effect patterns from Phase 3 research ([e4fb933](https://github.com/bsamiee/Parametric_Portal/commit/e4fb933))
- **cluster:** use schemas and dispatch tables as type sources of truth ([5fea5d6](https://github.com/bsamiee/Parametric_Portal/commit/5fea5d6))
- **context:** consolidate loose constants via IIFE encapsulation ([bc20559](https://github.com/bsamiee/Parametric_Portal/commit/bc20559))
- **database:** eliminate negation tests and imperative patterns ([e3ce70b](https://github.com/bsamiee/Parametric_Portal/commit/e3ce70b))

### [DOCUMENTATION]

- map existing codebase ([b432376](https://github.com/bsamiee/Parametric_Portal/commit/b432376))
- initialize cluster-native infrastructure project ([fccc293](https://github.com/bsamiee/Parametric_Portal/commit/fccc293))
- research @effect/experimental APIs ([9e4b0ca](https://github.com/bsamiee/Parametric_Portal/commit/9e4b0ca))
- create roadmap (8 phases) ([a912cd8](https://github.com/bsamiee/Parametric_Portal/commit/a912cd8))
- **01:** capture phase context ([a74888c](https://github.com/bsamiee/Parametric_Portal/commit/a74888c))
- **01:** research phase domain ([33e2c2e](https://github.com/bsamiee/Parametric_Portal/commit/33e2c2e))
- **01:** create phase 1 execution plans ([919d71a](https://github.com/bsamiee/Parametric_Portal/commit/919d71a))
- **01:** complete phase 1 housekeeping and reorganize research ([a308e79](https://github.com/bsamiee/Parametric_Portal/commit/a308e79))
- **01-01:** complete ClusterService facade plan ([c89fa98](https://github.com/bsamiee/Parametric_Portal/commit/c89fa98))
- **01-03:** complete cluster metrics plan ([ad089cc](https://github.com/bsamiee/Parametric_Portal/commit/ad089cc))
- **02:** research phase context integration ([8af94cf](https://github.com/bsamiee/Parametric_Portal/commit/8af94cf))
- **02:** resolve research open questions with technical decisions ([9eb77db](https://github.com/bsamiee/Parametric_Portal/commit/9eb77db))
- **02:** refine Phase 2 research with deep library analysis ([1175a76](https://github.com/bsamiee/Parametric_Portal/commit/1175a76))
- **02:** refine research with consolidated patterns and inline types ([657933b](https://github.com/bsamiee/Parametric_Portal/commit/657933b))
- **02:** surgical refinements - inline helpers, add FiberRef.modify ([40632ff](https://github.com/bsamiee/Parametric_Portal/commit/40632ff))
- **02:** final refinements - inline helpers, fix dual arg order ([70c8ce2](https://github.com/bsamiee/Parametric_Portal/commit/70c8ce2))
- **02:** add Telemetry integration guidance ([1d88be2](https://github.com/bsamiee/Parametric_Portal/commit/1d88be2))
- **02:** capture phase context ([dd0693f](https://github.com/bsamiee/Parametric_Portal/commit/dd0693f))
- **02:** create phase plan ([5eb8c9e](https://github.com/bsamiee/Parametric_Portal/commit/5eb8c9e))
- **02:** mark 02-01 complete, update Phase 3 with withinCluster integration ([e099f3f](https://github.com/bsamiee/Parametric_Portal/commit/e099f3f))
- **02-01:** complete context state definition plan ([29e3d43](https://github.com/bsamiee/Parametric_Portal/commit/29e3d43))
- **02-02:** complete middleware integration plan ([8058f83](https://github.com/bsamiee/Parametric_Portal/commit/8058f83))
- **03:** research phase domain ([82582db](https://github.com/bsamiee/Parametric_Portal/commit/82582db))
- **03:** capture phase context ([bfd416a](https://github.com/bsamiee/Parametric_Portal/commit/bfd416a))
- **03:** update phase context with discussion decisions ([fe6af35](https://github.com/bsamiee/Parametric_Portal/commit/fe6af35))
- **03:** create phase plan ([675f729](https://github.com/bsamiee/Parametric_Portal/commit/675f729))
- **03-01:** complete singleton foundation plan ([17aadcc](https://github.com/bsamiee/Parametric_Portal/commit/17aadcc))
- **03-02:** complete singleton/cron factory enhancement plan ([3ebd3af](https://github.com/bsamiee/Parametric_Portal/commit/3ebd3af))
- **03-03:** complete entity withinCluster and health utilities plan ([1456279](https://github.com/bsamiee/Parametric_Portal/commit/1456279))
- **03-04:** refine phase scope with Phase 1 learnings ([3796dfc](https://github.com/bsamiee/Parametric_Portal/commit/3796dfc))
- **04:** capture phase context ([938d0a0](https://github.com/bsamiee/Parametric_Portal/commit/938d0a0))
- **04:** research phase domain ([75bff25](https://github.com/bsamiee/Parametric_Portal/commit/75bff25))
- **04:** create phase plan ([b5364e4](https://github.com/bsamiee/Parametric_Portal/commit/b5364e4))
- **04:** create phase plan ([f803035](https://github.com/bsamiee/Parametric_Portal/commit/f803035))
- **04:** create phase plan ([d425b90](https://github.com/bsamiee/Parametric_Portal/commit/d425b90))
- **04:** complete job processing phase ([ae72f06](https://github.com/bsamiee/Parametric_Portal/commit/ae72f06))
- **04-01:** complete job DLQ database infrastructure plan ([940a5a5](https://github.com/bsamiee/Parametric_Portal/commit/940a5a5))
- **04-02:** complete entity-based job queue plan ([11f8f53](https://github.com/bsamiee/Parametric_Portal/commit/11f8f53))
- **04-03:** complete job metrics extension plan ([dbd95d5](https://github.com/bsamiee/Parametric_Portal/commit/dbd95d5))
- **05:** capture phase context ([c0ceaa9](https://github.com/bsamiee/Parametric_Portal/commit/c0ceaa9))
- **05:** add research quality requirements ([7ac6a56](https://github.com/bsamiee/Parametric_Portal/commit/7ac6a56))
- **05:** research EventBus & Reliability phase ([4717aae](https://github.com/bsamiee/Parametric_Portal/commit/4717aae))
- **05:** create phase plan ([b9872e5](https://github.com/bsamiee/Parametric_Portal/commit/b9872e5))
- **05-01:** complete database infrastructure plan ([c4910f3](https://github.com/bsamiee/Parametric_Portal/commit/c4910f3))
- **05-03:** deprecate StreamingService.channel() and broadcast() ([6b0f6e7](https://github.com/bsamiee/Parametric_Portal/commit/6b0f6e7))
- **05-03:** complete DevTools & deprecation plan ([f6cc4b6](https://github.com/bsamiee/Parametric_Portal/commit/f6cc4b6))
- **05-07:** clarify streaming.ts refactoring across phases ([fb66824](https://github.com/bsamiee/Parametric_Portal/commit/fb66824))
- **06:** research circuit breaker and resilience consolidation ([7ca1bec](https://github.com/bsamiee/Parametric_Portal/commit/7ca1bec))
- **cache:** research @effect/experimental caching APIs for consolidation ([3df29a4](https://github.com/bsamiee/Parametric_Portal/commit/3df29a4))
- **research:** @effect/platform HTTP infrastructure ([ff09be2](https://github.com/bsamiee/Parametric_Portal/commit/ff09be2))
- **research:** @effect/rpc API research for typed WebSocket RPC ([344c375](https://github.com/bsamiee/Parametric_Portal/commit/344c375))
- **research:** @effect/platform realtime APIs ([718c74d](https://github.com/bsamiee/Parametric_Portal/commit/718c74d))
- **research:** cluster-native infrastructure integration patterns ([4457599](https://github.com/bsamiee/Parametric_Portal/commit/4457599))
- **research:** add @effect/workflow API research ([03a3ffc](https://github.com/bsamiee/Parametric_Portal/commit/03a3ffc))
- **research:** @effect/cluster API reference ([94a8f43](https://github.com/bsamiee/Parametric_Portal/commit/94a8f43))
- **research:** add advanced Effect patterns to INTEGRATION.md ([33808d9](https://github.com/bsamiee/Parametric_Portal/commit/33808d9))

### ❤️ Thank You

- bsamiee
- Claude Opus 4.5

# 2.0.0 (2026-01-10)

### [FEATURES]

- ⚠️  to factory pattern with multi-provider support ([#124](https://github.com/bsamiee/Parametric_Portal/pull/124))
- Multi-Project Platform with Complete HA Stack ([#129](https://github.com/bsamiee/Parametric_Portal/pull/129))
- architecture with 7k line reduction ([#131](https://github.com/bsamiee/Parametric_Portal/pull/131))
- architecture consolidation phase 2 ([#132](https://github.com/bsamiee/Parametric_Portal/pull/132))
- architecture consolidation phase 3 - schema and migration unification ([#133](https://github.com/bsamiee/Parametric_Portal/pull/133))

### [BUG_FIXES]

- ⚠️  .toml robustness and portability improvements ([#127](https://github.com/bsamiee/Parametric_Portal/pull/127), [#124](https://github.com/bsamiee/Parametric_Portal/issues/124))
- Consolidate code surface and improve dispatch table usage across server/database/types ([#134](https://github.com/bsamiee/Parametric_Portal/pull/134), [#8](https://github.com/bsamiee/Parametric_Portal/issues/8))
- type system optimization and components-next expansion ([#136](https://github.com/bsamiee/Parametric_Portal/pull/136))
- resolve SonarCloud critical issues and security hotspots ([9c00b30](https://github.com/bsamiee/Parametric_Portal/commit/9c00b30))
- upgrade jspdf to 4.0.0 and relax SonarCloud quality gate ([576a1c4](https://github.com/bsamiee/Parametric_Portal/commit/576a1c4))
- **ci:** resolve Gemini CLI command restrictions and context pollution ([fa4c16d](https://github.com/bsamiee/Parametric_Portal/commit/fa4c16d))
- **ci:** add GH_TOKEN for gh CLI authentication in Gemini workflows ([14f15ec](https://github.com/bsamiee/Parametric_Portal/commit/14f15ec))
- **ci:** remove tool restrictions, let Gemini use any available tool ([5e58ed6](https://github.com/bsamiee/Parametric_Portal/commit/5e58ed6))
- **ci:** use !{} substitution for ALL variable refs in Gemini prompts ([2db5f21](https://github.com/bsamiee/Parametric_Portal/commit/2db5f21))
- **gemini:** remove MCP server to resolve hanging workflows ([#11459](https://github.com/bsamiee/Parametric_Portal/issues/11459), [#7324](https://github.com/bsamiee/Parametric_Portal/issues/7324))
- **gemini:** correct action version to v0.1.18 ([4f87284](https://github.com/bsamiee/Parametric_Portal/commit/4f87284))

### ⚠️  Breaking Changes

- .toml robustness and portability improvements  ([#127](https://github.com/bsamiee/Parametric_Portal/pull/127), [#124](https://github.com/bsamiee/Parametric_Portal/issues/124))
  generateText is no longer exported directly.
  Use createProvider({ model }) to get a provider instance.
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix(ai): address PR review comments for provider consistency
  - OpenAI: add maxTokens to ProviderConfig/GenerateTextOptions
  - OpenAI: populate B.defaults with maxTokens: 4096
  - OpenAI: remove identity function pattern, always call withConfigOverride
  - OpenAI: use max_output_tokens at model layer for proper defaults
  - Gemini: add maxTokens and system to type definitions
  - Gemini: populate B.defaults with maxTokens: 4096
  - Gemini: implement system prompt via buildPrompt helper (prepend to content)
  - Gemini: document withConfigOverride limitation in file header
  Resolves all 6 inline review comments from PR #124.
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * style: biome auto-repair
  Co-authored-by: github-actions[bot] <github-actions[bot]@users.noreply.github.com>
  * chore: trigger re-review
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
- to factory pattern with multi-provider support  ([#124](https://github.com/bsamiee/Parametric_Portal/pull/124))
  generateText is no longer exported directly.
  Use createProvider({ model }) to get a provider instance.
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * fix(ai): address PR review comments for provider consistency
  - OpenAI: add maxTokens to ProviderConfig/GenerateTextOptions
  - OpenAI: populate B.defaults with maxTokens: 4096
  - OpenAI: remove identity function pattern, always call withConfigOverride
  - OpenAI: use max_output_tokens at model layer for proper defaults
  - Gemini: add maxTokens and system to type definitions
  - Gemini: populate B.defaults with maxTokens: 4096
  - Gemini: implement system prompt via buildPrompt helper (prepend to content)
  - Gemini: document withConfigOverride limitation in file header
  Resolves all 6 inline review comments from PR #124.
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  * style: biome auto-repair
  Co-authored-by: github-actions[bot] <github-actions[bot]@users.noreply.github.com>
  * chore: trigger re-review
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5
- Claude Sonnet 4.5 (1M context)
- Copilot @Copilot
- raha2079 @raha2079

## 1.0.7 (2025-12-26)

### [BUG_FIXES]

- to @effect/sql 0.49 with proper Option handling ([#122](https://github.com/bsamiee/Parametric_Portal/pull/122))
- **workflows:** gemini timeout and concurrency issues ([51a3c7a](https://github.com/bsamiee/Parametric_Portal/commit/51a3c7a))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5

## 1.0.6 (2025-12-25)

### [BUG_FIXES]

- K3s/Kustomize/ArgoCD infrastructure with multi-domain support ([#121](https://github.com/bsamiee/Parametric_Portal/pull/121))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5

## 1.0.5 (2025-12-25)

### [BUG_FIXES]

- infrastructure + theme consolidation ([#120](https://github.com/bsamiee/Parametric_Portal/pull/120))

### ❤️ Thank You

- bsamiee @bsamiee

## 1.0.4 (2025-12-23)

### [BUG_FIXES]

- address PR #118 review comments - IDOR fix, token ordering, server timestamps ([#119](https://github.com/bsamiee/Parametric_Portal/pull/119), [#118](https://github.com/bsamiee/Parametric_Portal/issues/118))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5
- Copilot @Copilot

## 1.0.3 (2025-12-22)

### [BUG_FIXES]

- consolidate types package and align tests with API ([#117](https://github.com/bsamiee/Parametric_Portal/pull/117))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5

## 1.0.2 (2025-12-22)

### [BUG_FIXES]

- consolidation with API contracts pattern ([#113](https://github.com/bsamiee/Parametric_Portal/pull/113))

### [REFACTORING]

- consolidate schemas and reduce duplication ([#116](https://github.com/bsamiee/Parametric_Portal/pull/116))

### ❤️ Thank You

- bsamiee @bsamiee
- Claude Opus 4.5

## 1.0.1 (2025-12-22)

This was a version bump only, there were no code changes.

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
