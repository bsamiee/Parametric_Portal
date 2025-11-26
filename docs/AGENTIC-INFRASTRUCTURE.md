# Agentic Infrastructure Reference

Concise reference for all automation systems, agents, and tooling in Parametric Portal.

---

## File Inventory

### Root-Level Protocol Files
- `REQUIREMENTS.md` — Single Source of Truth (SSoT) for all coding standards and agent protocols
- `AGENTS.md` — Agent charter for CLI/CI agents (generated from REQUIREMENTS.md)
- `CLAUDE.md` — Code standards for Claude Code (generated from REQUIREMENTS.md)
- `TASK_FINAL.md` — 41-task implementation roadmap for agentic systems
- `ANALYSIS.md` — Architectural strategy and design decisions for agentic automation

### Configuration Files
- `renovate.json` — Renovate dependency update configuration with domain grouping
- `lefthook.yml` — Pre-commit hooks including Effect pattern validation
- `.github/labeler.yml` — Path-to-label mappings for auto-labeler workflow
- `.github/copilot-instructions.md` — IDE agent instructions (generated from REQUIREMENTS.md)

### GitHub Workflows (17 total)
- `.github/workflows/ci.yml` — Main CI pipeline with quality gates
- `.github/workflows/pr-review-aggregator.yml` — Synthesizes AI/CI feedback
- `.github/workflows/auto-labeler.yml` — Path-based and AI-powered labeling
- `.github/workflows/issue-lifecycle.yml` — Triage, stale handling, validation
- `.github/workflows/claude-code-review-enhanced.yml` — REQUIREMENTS.md compliance review
- `.github/workflows/renovate-automerge.yml` — Mutation-gated dependency updates
- `.github/workflows/biome-repair.yml` — Auto-fix style issues before review
- `.github/workflows/semantic-commits.yml` — Enforce conventional commit format
- `.github/workflows/validate-protocols.yml` — Protocol drift detection (REQUIREMENTS.md sync)
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard
- `.github/workflows/release.yml` — Conventional commit-based releases
- `.github/workflows/bundle-analysis.yml` — Bundle size tracking with PR comments
- `.github/workflows/security.yml` — Multi-layer security scanning
- `.github/workflows/claude.yml` — Legacy Claude integration
- `.github/workflows/claude-code-review.yml` — Legacy code review
- `.github/workflows/claude-issues.yml` — Legacy issue automation
- `.github/workflows/claude-maintenance.yml` — Legacy maintenance tasks

### GitHub Templates (4 total)
- `.github/ISSUE_TEMPLATE/config.yml` — Template configuration and contact links
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Bug report form with AGENT_CONTEXT hooks
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form with pattern selection
- `.github/PULL_REQUEST_TEMPLATE.md` — PR template with AGENT_CONTEXT and checklist

### Custom Agent Profiles (10 total)
- `.github/agents/typescript-advanced.agent.md` — TypeScript 6.0-dev, Effect/Option pipelines
- `.github/agents/react-specialist.agent.md` — React 19 canary, Compiler, Server Components
- `.github/agents/vite-nx-specialist.agent.md` — Vite 7 Environment API, Nx 22 Crystal
- `.github/agents/testing-specialist.agent.md` — Vitest, property-based testing with Effect
- `.github/agents/performance-analyst.agent.md` — Bundle optimization, tree-shaking
- `.github/agents/refactoring-architect.agent.md` — Holistic refactoring, pattern migration
- `.github/agents/library-planner.agent.md` — Research and create Nx packages
- `.github/agents/integration-specialist.agent.md` — Workspace consistency, catalog versions
- `.github/agents/documentation-specialist.agent.md` — Cross-project documentation consistency
- `.github/agents/cleanup-specialist.agent.md` — Algorithmic density optimization

### Claude Dev (.claude/ directory)
- `.claude/settings.json` — Claude Dev extension settings
- `.claude/commands/implement.md` — Implementation command prompt
- `.claude/commands/refactor.md` — Refactoring command prompt
- `.claude/commands/review-typescript.md` — TypeScript review command prompt
- `.claude/commands/test.md` — Testing command prompt

### Tools (4 tools, 6 files)
- `tools/generate-context/index.ts` — Nx graph extraction and project map generation (328 lines, Effect)
- `tools/generate-context/schema.ts` — @effect/schema definitions for ProjectMap (90 lines)
- `tools/parse-agent-context.ts` — Parse AGENT_CONTEXT from issue/PR bodies (126 lines, Effect)
- `tools/sync-agent-protocols.ts` — REQUIREMENTS.md → derivative doc sync (287 lines, Effect)

### Scripts (2 total)
- `scripts/create-labels.sh` — Idempotent GitHub label creation (45 labels)
- `scripts/generate-pwa-icons.ts` — PWA icon generation (not agentic, utility)

### Documentation
- `docs/AUTOMATION.md` — Comprehensive automation guide (382 lines)
- `docs/INTEGRATIONS.md` — External integrations and setup
- `docs/agent-context/README.md` — Project map query protocol
- `docs/agent-context/project-map.json` — Nx graph + public APIs (generated)

---

## Integration Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                        REQUIREMENTS.md (SSoT)                         │
│                 Coding Standards + Agent Protocols                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                    tools/sync-agent-protocols.ts
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    AGENTS.md         copilot-instructions    CLAUDE.md
    (CLI/CI)              (.github/)          (Claude Code)
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    validate-protocols.yml              Custom Agents (10)
    (drift detection)                   (.github/agents/)
                                              │
                                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         GitHub Workflows (17)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ CI Pipeline  │→│ PR Aggregator│←│ Code Review  │←│ Biome    │ │
│  │              │  │              │  │ Enhanced     │  │ Repair   │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────────┘ │
│         │                 │                                           │
│         ▼                 ▼                                           │
│  ┌──────────────┐  ┌──────────────┐                                  │
│  │ Auto-Labeler │  │ Issue        │                                  │
│  │              │  │ Lifecycle    │                                  │
│  └──────────────┘  └──────────────┘                                  │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (4)              Renovate Auto-Merge
    (AGENT_CONTEXT hooks)             (mutation-gated)
          │                                     │
          ▼                                     ▼
    Issue/PR Creation                   Dependency Updates
          │                                     │
          └──────────────────┬──────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         Context Generation                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ tools/generate-context/index.ts                              │   │
│  │   ↓ Executes: nx graph --file=.nx/graph.json                 │   │
│  │   ↓ Parses: Nx dependencies, package.json exports            │   │
│  │   ↓ Generates: docs/agent-context/project-map.json           │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
                      Custom Agents
                      (consume project-map.json)
```

### Data Flow

1. **Protocol Sync**: REQUIREMENTS.md → sync-agent-protocols.ts → [AGENTS.md, CLAUDE.md, copilot-instructions.md]
2. **Context Gen**: Nx graph → generate-context → project-map.json → Custom Agents
3. **Issue/PR Creation**: Templates with AGENT_CONTEXT → parse-agent-context.ts → Auto-Labeler
4. **PR Lifecycle**: PR opened → Biome Repair → CI → Code Review → PR Aggregator → Merge
5. **Dependency Flow**: Renovate PR → CI + Mutation → Auto-Merge gate → Merge/Block

---

## Core Components

### Protocol Synchronization

**tools/sync-agent-protocols.ts**
Maintains REQUIREMENTS.md as the single source of truth for all agent protocols and coding standards. Extracts 4 H2 sections (Stack, Dogmatic Rules, Agent Profiles, Quality Targets), generates derivative files with SHA256 hash embeddings for drift detection. Runs in generate mode (`pnpm sync:protocols`) or dry-run mode (`--dry-run`) for CI validation. Integrates with validate-protocols.yml workflow.

**validate-protocols.yml**
CI workflow that enforces protocol synchronization. Triggers on PR changes to `*.md` files, runs `pnpm sync:protocols --dry-run`, exits with code 1 on drift. Posts PR comment with fix instructions when desynchronization detected. Prevents manual edits to AGENTS.md, CLAUDE.md, or copilot-instructions.md.

### Context Generation

**tools/generate-context/index.ts**
Extracts Nx project graph and package metadata to create structured context for agents. Executes `nx graph --file=.nx/graph.json`, parses project dependencies from Nx graph, extracts public APIs from package.json exports, detects circular dependencies. Outputs `docs/agent-context/project-map.json` with workspace info, projects, graph topology, and import aliases. Used by CI workflow and custom agents for workspace-aware code generation.

**tools/parse-agent-context.ts**
Parses AGENT_CONTEXT JSON blocks from issue and PR template bodies. Extracts metadata like type (bug/feature), scope, agents, patterns, priority, and test coverage requirements. Returns default context when missing/invalid. CLI mode accepts body via stdin, outputs structured JSON for workflow consumption.

### GitHub Workflows

**pr-review-aggregator.yml**
Synthesizes all AI and CI feedback into a single structured comment on PRs. Triggered by workflow_run completion, pull_request_review events, or `/summarize` slash command. Collects reviews from claude[bot], copilot[bot], github-actions[bot], and humans; gathers CI check statuses. Uses Claude Sonnet 4.5 to generate risk assessment (LOW/MEDIUM/HIGH), merge readiness (BLOCKED/CAUTION/SAFE), required actions, quality signals, and nits. Posts/updates comment with marker `<!-- PR-AGGREGATOR-SUMMARY -->`.

**auto-labeler.yml**
Applies labels to PRs and issues based on path analysis and AI classification. Triggered by PR/issue events or `/triage` slash command. For PRs: uses actions/labeler for path-based labels (pkg/*, scope/*), analyzes file content for tech labels (react/effect/vite), calculates size labels (XS/S/M/L/XL). For issues: Claude Sonnet 4.5 classifies into type/*, priority/*, scope/*, effort/* categories. Conservative labeling only applies confident classifications.

**issue-lifecycle.yml**
Manages issue triage, stale detection, and validation. Parses AGENT_CONTEXT from issue body, auto-labels based on context, validates format (empty body, title length). Daily schedule runs stale detection: 30 days inactive → stale label, 44 days → close. Exemptions: pinned, security, priority/critical, claude-implement, in-progress labels. Generates aging report in GitHub step summary.

**claude-code-review-enhanced.yml**
Enforces REQUIREMENTS.md compliance for all code changes. Waits for CI completion via workflow_run, reads REQUIREMENTS.md and CI status. Checks compliance: no `any`, no `var`/`let`, no `if`/`else`, no loops, no `try`/`catch`; validates B constant pattern, dispatch tables, Effect/Option patterns, section separators (77 chars) for >50 LOC files. Exemptions: config files (default exports allowed), test files, plugins. Outputs structured review with compliance table, triggers pr-review-aggregator after completion. Uses Claude Opus 4.5.

**renovate-automerge.yml**
Mutation-gated auto-merge for dependency updates. Triggered by Renovate PRs, check_suite completion, or 4-hour schedule. Classifies updates: patch/minor (eligible) vs major/canary (blocked). Gate requirements: all checks green + mutation score ≥ 80%. Auto-merges eligible PRs via `gh pr merge --squash --auto`. For blocked PRs: adds renovate-blocked label, comments with concerns. For major updates: creates migration campaign issue with scope, breaking changes, and migration steps checklist.

**biome-repair.yml**
Auto-fixes style issues before human review. Runs `pnpm biome check --write --unsafe` on PR changes, executes `pnpm test` to verify no semantic breakage. If tests pass: commits "style: biome auto-repair" and pushes. If tests fail: skips commit, adds comment warning of semantic breakage. Skips for main branch and bot authors (except renovate).

**semantic-commits.yml**
Enforces conventional commit format for PR titles. Uses amannn/action-semantic-pull-request to validate type (feat/fix/refactor/style/docs/deps/test/chore), requires scope, validates subject pattern (lowercase, descriptive). Blocks merge on violation.

**dashboard.yml**
Auto-updating repository health dashboard. Triggered by 6-hour schedule, workflow_dispatch, push to main, or `/health` command on dashboard issue. Collects metrics: open PRs, merged (7d), stale (>14d); open issues by type; Renovate activity; commit activity; latest release. Runs `pnpm typecheck && pnpm check` for health status. Creates or updates pinned issue (label: dashboard) with structured markdown report including quick stats, activity, health badges, and workflow status.

**release.yml**
Automated releases based on conventional commits. Triggered by push to main (src paths) or workflow_dispatch. Analyzes commits for release type: `feat!` → major, `feat` → minor, `fix` → patch. Generates changelog grouped by Breaking, Features, Fixes, Refactoring, Docs. Creates git tag and GitHub release. Claude enhances release notes with impact summary.

**bundle-analysis.yml**
Tracks bundle size changes in PRs. Builds all packages, analyzes sizes (raw, gzip, brotli), compares with main branch (cached metrics). Posts/updates PR comment with size report, warns if significant increase (>10KB gzip). Helps prevent bundle bloat regressions.

**security.yml**
Multi-layer security scanning. Jobs: dependency-audit (`pnpm audit`), CodeQL (JavaScript/TypeScript analysis), secrets-scan (Gitleaks), license-check (copyleft detection). Triggered by PR, push to main, or weekly schedule. Creates security issue if critical vulnerabilities found.

**validate-protocols.yml** (detailed above)

### GitHub Templates

**bug_report.yml**
Form-based bug template with AGENT_CONTEXT hook. Embeds `<!-- AGENT_CONTEXT {"type":"bug","agents":["testing-specialist","typescript-advanced"]} -->`. Fields: description, repro steps, expected/actual behavior, severity dropdown, environment, logs. Default labels: type/bug, needs-triage. Requires checkbox: searched existing issues.

**feature_request.yml**
Form-based feature template with pattern selection. Embeds `<!-- AGENT_CONTEXT {"type":"feature","agents":["library-planner","typescript-advanced"]} -->`. Fields: problem statement, proposed solution, alternatives, scope dropdown (multi), effort dropdown, acceptance criteria. Checkboxes for patterns: Effect pipeline, Option monad, Branded types, Dispatch table. Default labels: type/feature, needs-triage.

**PULL_REQUEST_TEMPLATE.md**
PR template with AGENT_CONTEXT hook and checklist. Embeds default context: `{"type":"implementation","scope":[],"breaking":false,"patterns_applied":[],"test_coverage":"required"}`. Includes Claude Code review trigger: `@claude Please review against REQUIREMENTS.md patterns`. Checklist validates: pnpm check/typecheck/test passes, Effect patterns used, B constant followed, tests added.

### Custom Agent Profiles

Each agent is a specialized staff-level engineer with domain expertise. All follow REQUIREMENTS.md patterns: Effect pipelines, single B constant, dispatch tables, branded types, Option monads. Agents are invoked via MCP tools by GitHub Copilot or Claude Code.

**typescript-advanced** — Bleeding-edge TypeScript 6.0-dev specialist. Handles complex type transformations, branded types via @effect/schema, Effect/Option pipeline migrations, const generics, exhaustive pattern matching. Ultra-dense functional code with cognitive complexity ≤25.

**react-specialist** — React 19 canary expert. Specializes in React Compiler automatic optimization, Server Components async patterns, use() hook, bleeding-edge JSX transforms. Ensures compatibility with experimental features.

**vite-nx-specialist** — Vite 7 Environment API and Nx 22 Crystal inference master. Handles build configuration, monorepo orchestration, vite.config.ts factory patterns, Nx target definitions, manifest generation.

**testing-specialist** — Vitest 4.0 and property-based testing expert. Implements fast-check property tests, Effect/Option testing patterns, V8 coverage reporting (80% threshold), happy-dom integration, benchmark suites.

**performance-analyst** — Bundle optimization specialist. Analyzes bundle sizes, tree-shaking effectiveness, code splitting strategies, lazy loading patterns. Uses rollup-plugin-visualizer, compression validation, lighthouse metrics.

**refactoring-architect** — Holistic refactoring expert. Migrates codebases to Effect/Option pipelines, implements dispatch tables to replace if/else, consolidates scattered constants into single B constant, ensures workspace-wide consistency.

**library-planner** — Package research and creation specialist. Researches latest library versions and patterns, creates new Nx packages with proper structure, implements vite.config.ts factories, ensures catalog version consistency.

**integration-specialist** — Workspace consistency enforcer. Validates unified factories across packages, ensures catalog-driven dependencies, verifies file organization compliance, checks cross-package integration points.

**documentation-specialist** — Cross-project documentation expert. Maintains consistency across REQUIREMENTS.md, AGENTS.md, code comments. Ensures 1-line XML comments for complex logic, updates README files, validates cross-references.

**cleanup-specialist** — Algorithmic density optimizer. Consolidates patterns, removes redundancy, maximizes functionality per line of code (25-30 LOC/feature target), reduces cognitive complexity while preserving type safety.

### Scripts

**scripts/create-labels.sh**
Idempotent GitHub label creation using `gh label create --force`. Creates 45 labels across 7 categories: type/ (7), priority/ (4), scope/ (10), effort/ (4), tech/ (3), size/ (5), special (12). Always exits 0 for idempotency. Run via `pnpm labels:create`.

### Configuration Files

**renovate.json**
Configures Renovate Bot for dependency updates. Domain grouping: effect-ecosystem (Monday 6am), vite-ecosystem (automerge minor/patch), react-ecosystem (stable, automerge), react-canary (manual review), nx-canary (manual review), types (excluding @types/react). Platform automerge enabled, post-update runs `pnpmDedupe`. OSV vulnerability alerts enabled.

**lefthook.yml**
Pre-commit hooks. Two commands: biome (runs `pnpm biome check --write`, auto-stages fixes), effect-check (grep-based detection of `try {` in .ts/.tsx files, rejects if found outside comments). Runs in parallel. Known limitations: false positives in strings/comments (line-level filtering applied).

**.github/labeler.yml**
Path-to-label mappings for auto-labeler workflow. Maps file paths to labels: pkg/* for packages, scope/* for functional areas, tech/* requires content analysis. Used by actions/labeler action in auto-labeler.yml.

---

## Slash Commands

Three on-demand workflow triggers via issue/PR comments:

- **`/summarize`** — PR Review Aggregator workflow, synthesizes all feedback
- **`/triage`** — Auto-Labeler workflow, re-classifies issue/PR
- **`/health`** — Dashboard workflow, refreshes metrics (dashboard issue only)

---

## Quality Gates

1. **Pre-commit**: Lefthook runs Biome + Effect pattern validation
2. **PR opened**: Biome Repair auto-fixes style, Semantic Commits validates title
3. **CI**: Build, test, typecheck via Nx affected
4. **Post-CI**: Code Review Enhanced checks REQUIREMENTS.md compliance
5. **Merge gate**: All checks green, reviews approved, semantic title validated
6. **Renovate gate**: Mutation score ≥ 80% for auto-merge

---

## Key Patterns

- **Effect Pipelines**: All async/failable operations use Effect, no try/catch
- **Option Monads**: All nullable values use Option, no null checks
- **Single B Constant**: All config in one frozen object per file
- **Dispatch Tables**: Replace if/else with type-safe lookup tables
- **Branded Types**: Nominal typing via @effect/schema `S.Brand`
- **Section Separators**: 77-char separators for files >50 LOC

---

**Generated**: 2025-11-26
**Maintained**: Auto-updated via sync-agent-protocols.ts
