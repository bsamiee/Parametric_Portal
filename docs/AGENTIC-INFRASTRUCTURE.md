# Agentic Infrastructure Reference

Comprehensive reference for all automation systems, agents, and tooling in Parametric Portal. This documentation reflects the production implementation as of December 2025.

---

## Overview

Parametric Portal implements a **three-paradigm agentic maintenance system**:

- **Active**: Event-triggered automation (PR commits, issue changes, labels)
- **Passive**: Scheduled maintenance (6-hour QC cycles, daily cleanup)
- **AI**: Agentic workflows with Claude Code for complex tasks requiring reasoning

All automation follows the project's core patterns: single B constant configuration, dispatch tables, Effect pipelines, and schema-driven polymorphism.

---

## File Inventory

### Root-Level Protocol Files
- `REQUIREMENTS.md` — Single Source of Truth (SSoT) for all coding standards and agent protocols
- `CLAUDE.md` — Code standards for Claude Code (referenced by Claude in workflows)

### Configuration Files
- `renovate.json` — Renovate dependency update configuration with domain grouping
- `lefthook.yml` — Pre-commit hooks including Effect pattern validation
- `.github/labels.yml` — Declarative label definitions with colors (managed by active-qc + passive-qc workflows)
- `.github/copilot-instructions.md` — IDE agent instructions
- `stryker.config.js` — Mutation testing configuration (80% threshold, Vitest runner)

### GitHub Workflows (10 total)
- `.github/workflows/active-qc.yml` — Event-driven QC: PR sync, PR hygiene, PR/issue metadata validation, label pinning
- `.github/workflows/ai-maintenance.yml` — Weekly AI maintenance + manual tasks via Claude Code
- `.github/workflows/auto-merge.yml` — Dependabot auto-merge for patch/minor/security updates
- `.github/workflows/ci.yml` — Main CI: normalize commits, Biome auto-repair, Nx affected tasks (build/test/lint/typecheck)
- `.github/workflows/claude-code-review.yml` — Claude AI code review with structured summary and inline comments
- `.github/workflows/claude.yml` — Claude Code agentic automation triggered via @claude mentions in issues/PRs
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard (6-hour schedule + checkbox trigger)
- `.github/workflows/passive-qc.yml` — Scheduled QC: stale management, aging report, meta consistency, daily maintenance
- `.github/workflows/security.yml` — Multi-layer: dependency audit, CodeQL, Gitleaks, license check
- `.github/workflows/sonarcloud.yml` — SonarCloud static analysis for code quality and security hotspots

**Note**: Releases are handled via `npx nx release` (configured in nx.json).

### GitHub Scripts (13 total)
Composable infrastructure scripts using schema.ts polymorphic toolkit:

- `.github/scripts/schema.ts` — Core infrastructure: B constant, types, markdown generators, ops factory, mutate handlers
- `.github/scripts/dashboard.ts` — Metrics collector + section renderers for dashboard
- `.github/scripts/probe.ts` — Data extraction layer for issues/PRs/discussions
- `.github/scripts/report.ts` — Config-driven report generator
- `.github/scripts/failure-alert.ts` — CI/security failure alert creator
- `.github/scripts/gate.ts` — Eligibility gating for PRs with mutation score verification
- `.github/scripts/ai-meta.ts` — Universal metadata fixer with AI fallback
- `.github/scripts/label.ts` — Label-triggered behavior executor (pin, unpin, comment)
- `.github/scripts/pr-sync.ts` — PR commit synchronization: analyzes commits to update title/labels on push
- `.github/scripts/pr-hygiene.ts` — Automated PR review cleanup: resolve outdated threads, respond to addressed feedback
- `.github/scripts/maintenance.ts` — Repository maintenance: branch cleanup, draft PR warnings
- `.github/scripts/auto-merge.ts` — Automated merge eligibility checking for Dependabot PRs
- `.github/scripts/env.ts` — Environment configuration (lang, nxCloudWorkspaceId)

### GitHub Composite Actions (6 total)
- `.github/actions/node-env/action.yml` — Node.js + pnpm + Nx setup with caching + distributed execution
- `.github/actions/git-identity/action.yml` — Git user configuration for commits
- `.github/actions/meta-fixer/action.yml` — Universal metadata fixer action using ai-meta.ts
- `.github/actions/normalize-commit/action.yml` — Transform [TYPE!]: to type!: format
- `.github/actions/label/action.yml` — Label-triggered behavior executor (pin, unpin, comment)
- `.github/actions/pr-hygiene/action.yml` — Automated PR review cleanup using pr-hygiene.ts

### GitHub Templates (12 total)
- `.github/ISSUE_TEMPLATE/config.yml` — Template configuration (blank issues disabled)
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Bug report form (label: fix)
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form (label: feat)
- `.github/ISSUE_TEMPLATE/refactor.yml` — Refactor request form (label: refactor)
- `.github/ISSUE_TEMPLATE/perf.yml` — Performance improvement form (label: perf)
- `.github/ISSUE_TEMPLATE/test.yml` — Test request form (label: test)
- `.github/ISSUE_TEMPLATE/docs.yml` — Documentation form (label: docs)
- `.github/ISSUE_TEMPLATE/chore.yml` — Maintenance task form (label: chore)
- `.github/ISSUE_TEMPLATE/build.yml` — Build system form (label: build)
- `.github/ISSUE_TEMPLATE/ci.yml` — CI/CD changes form (label: ci)
- `.github/ISSUE_TEMPLATE/style.yml` — Formatting/style form (label: style)
- `.github/ISSUE_TEMPLATE/help.yml` — Help request form (label: help)
- `.github/PULL_REQUEST_TEMPLATE.md` — PR template with checklist

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

---

## Schema Infrastructure

The `.github/scripts/schema.ts` file is the core of the automation system, implementing:

### Single B Constant
All configuration in one frozen object with nested domains (696 lines, ~15KB):
- `B.algo` — Algorithm thresholds (closeRatio, mutationPct 80%, staleDays 30)
- `B.api` — GitHub API constants (perPage 100, states)
- `B.breaking` — Breaking change detection patterns and label
- `B.dashboard` — Dashboard config (bots, colors, targets, schedule, output)
- `B.hygiene` — PR hygiene config (bot aliases, slash commands, valuable patterns, display limits)
- `B.labels` — Label taxonomy (categories, behaviors, exempt lists, GraphQL mutations)
- `B.meta` — Metadata config (alerts, caps, fmt, infer rules, models, ops)
- `B.patterns` — Regex patterns for parsing (commit, header, placeholder)
- `B.pr` — PR title patterns (bash and JS regex)
- `B.probe` — Data collection defaults (bodyTruncate, shaLength, markers)
- `B.time` — Time constants (day in ms)

### SpecRegistry Type System
Polymorphic spec definitions for type-safe operations (unified discriminated unions):
- `U<'alert'>` — CI/security alert specs with debt categorization
- `U<'dashboard'>` — Dashboard update specs with section renderers
- `U<'filter'>` — Issue filtering (age, label, state)
- `U<'source'>` — Data sources (fetch, params, payload) for report generation
- `U<'output'>` — Output targets (summary, comment, issue) with markdown formatting
- `U<'format'>` — Formatters (table, body) with row builders
- `U<'mutate'>` — Mutation ops (comment, issue, label, review, release) via GitHub API
- `U<'hygiene'>` — PR hygiene specs for review thread management

### Ops Factory
Dispatch table mapping operation keys to GitHub API calls:
- REST API: issues, pulls, repos, actions, checks
- GraphQL: discussions, issue pinning
- Automatic pagination and error handling

### Pure Functions (`fn` object)
Utility functions for common operations:
- `fn.age()` — Calculate days since date
- `fn.body()` — Render BodySpec to markdown
- `fn.filter()` — Apply filter specs to issues
- `fn.report()` — Generate markdown tables
- `fn.diff()` — Calculate size differences
- `fn.size()` — Human-readable byte sizes

---

## Label Taxonomy

Labels are managed declaratively via `.github/labels.yml` and synced automatically.

### Commit Type Labels (issue templates apply these)
| Label | Color | Description |
|-------|-------|-------------|
| `fix` | #f05223 | Bug fix |
| `feat` | #0969da | New feature request |
| `docs` | #0067a6 | Improvements or additions to documentation |
| `style` | #6c3082 | Formatting, no logic change |
| `refactor` | #3a140e | Code restructuring without behavior change |
| `test` | #6f4f38 | Adding or updating tests |
| `chore` | #c4b091 | Maintenance task |
| `perf` | #9aca3c | Performance improvement |
| `ci` | #650e3d | CI/CD pipeline changes |
| `build` | #93c572 | Build system or tooling |

### Issue-Only Type Labels
| Label | Color | Description |
|-------|-------|-------------|
| `help` | #702963 | Question or assistance needed |

### Priority (optional, escalation only)
| Label | Color | Description |
|-------|-------|-------------|
| `critical` | #ff473e | Must be addressed immediately |

### Action (what should happen)
| Label | Color | Description |
|-------|-------|-------------|
| `implement` | #ee3a95 | Ready for implementation |
| `review` | #FFF58A | Needs review |
| `blocked` | #fed700 | Cannot proceed |

### Agent Labels (Mutually Exclusive)
| Label | Color | Description |
|-------|-------|-------------|
| `copilot` | #848482 | Assign to GitHub Copilot |
| `claude` | #848482 | Assign to Claude |
| `gemini` | #848482 | Assign to Gemini |
| `codex` | #848482 | Assign to OpenAI Codex |

### Lifecycle (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `stale` | #2a3439 | No recent activity |
| `pinned` | #123524 | Exempt from stale |

### Special (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `security` | #FF2DD1 | Security issue |
| `dependencies` | #1D2952 | Dependency updates (bot-applied) |
| `breaking` | #701c1c | Breaking change |
| `dashboard` | #00a693 | Repository metrics dashboard |

**Total: 25 labels**

---

## Integration Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                        REQUIREMENTS.md (SSoT)                         │
│                 Coding Standards + Agent Protocols                    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    copilot-instructions                  CLAUDE.md
        (.github/)                       (Claude Code)
          │                                     │
          └──────────────────┬──────────────────┘
                             │
                             ▼
                    Custom Agents (10)
                    (.github/agents/)
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          GitHub Workflows (9)                         │
│  ┌──────────────┐  ┌─────────────────────────────────┐               │
│  │ CI Pipeline  │→│ claude-code-review.yml            │               │
│  │ (ci.yml)     │  │ (AI review + inline comments)    │               │
│  └──────┬───────┘  └──────────────┬──────────────────┘               │
│         │                         │                                   │
│         ▼                         ▼                                   │
│  ┌───────────────────┐     ┌──────────────┐                          │
│  │ active-qc.yml     │     │ AI Maint     │                          │
│  │ + passive-qc.yml  │     │ (weekly)     │                          │
│  │ + pr-sync         │     └──────────────┘                          │
│  └───────────────────┘                                               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Schema Infrastructure (10 scripts)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ schema.ts → dashboard.ts, probe.ts, report.ts, failure-alert.ts ││
│  │ gate.ts, ai-meta.ts, label.ts, pr-sync.ts, env.ts               ││
│  │ B constant + Ops Factory + Mutate Handlers                       ││
│  └──────────────────────────────────────────────────────────────────┘│
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (12)             Dependabot Auto-Merge
    (type labels applied)             (auto-merge.yml)
          │                                     │
          ▼                                     ▼
    Issue Created                       Dependency Updates
```

### Data Flow

1. **Issue Creation**: Templates apply type labels (fix, feat, perf, style, test, docs, refactor, chore, build, ci, help)
2. **PR Lifecycle**: PR opened → CI (Biome auto-repair) → PR Sync (commit analysis) → Code Review → Merge
3. **PR Commit Sync**: Commit pushed → pr-sync.ts analyzes commits → Updates PR title/labels to match reality
4. **Dependency Flow**: Dependabot PR → CI → Auto-Merge gate → Merge/Block
5. **Dashboard**: Schedule/command → schema.ts → collect metrics → render → update + pin issue

---

## Core Components

### Label Sync

### GitHub Scripts

**schema.ts** (Polymorphic Infrastructure)
Complete workflow toolkit providing B constant DSL (alerts, content, gating, generation, labels, patterns, types), SpecRegistry polymorphic type system, `fn` pure functions (classify, body, filter, report, row builders), `ops` GitHub API factory (REST + GraphQL), and `mutate` handlers (comment, issue, label, review, release). All downstream scripts compose these primitives.

**dashboard.ts**
Metrics collector using parallel API calls via `call()`, dispatch table section renderers (badges, activity, ci, health), outputs via `mutate` issue handler. The architecture is extensible - add sections to the dispatch table, metrics to `collect()`.

**probe.ts**
Data extraction layer with `handlers` dispatch table for issue/pr/discussion targets. Each handler fetches related data in parallel (reviews, checks, commits, files, comments), normalizes to typed shapes. Also exports `post()` for marker-based comment upsert.

**report.ts**
Config-driven report generator using `B.content` configs. Pipeline: source dispatch (fetch/params/payload) → row builders (count/diff/list) → format dispatch (table/body) → output dispatch (summary/comment/issue). Fully extensible via new B.content entries.

**failure-alert.ts**
Alert creator using `fn.classifyDebt()` for CI failures (maps job names → debt categories via `B.alerts.ci.rules`). Renders body via `fn.body()` with `B.alerts` templates, upserts issue via `mutate` issue handler.

**gate.ts**
Eligibility gate using `fn.classifyGating()` rules from `B.gating.rules`. Extracts scores from check run summaries via regex, blocks via `mutate` (comment + label), optionally creates migration issues. The gating logic is rule-driven and extensible.

**ai-meta.ts**
Universal metadata fixer with AI fallback. Parses PR/issue titles, validates against commit type patterns, applies appropriate labels, and uses AI when pattern matching fails.

**label.ts**
Label-triggered behavior executor with polymorphic dispatch. Single factory handles labeled/unlabeled events via `B.labels.behaviors` config. Dispatches to pin/unpin/comment handlers based on label name and action type.

**pr-sync.ts**
PR commit synchronization analyzer. On synchronize (commit push) events, fetches PR commits, analyzes them to determine dominant type and breaking changes, updates PR title/labels to reflect reality. Ensures PR titles aren't stale (e.g., `[CHORE]` that's really a `feat`, or missing `!` for breaking changes).

**pr-hygiene.ts**
Automated PR review cleanup with intelligent thread resolution. Resolves outdated review threads when code changes address feedback, replies to valuable feedback acknowledging fixes, deletes owner prompts and slash commands after processing. Uses `B.hygiene` config for valuable pattern detection and bot alias matching. Outputs metrics for resolved threads, replied comments, and deleted prompts.

**maintenance.ts**
Repository maintenance operations with dry-run support. Implements branch cleanup (deletes merged branches >14 days, abandoned >30 days), warns on stale draft PRs, and provides detailed reporting. Uses `M` constant (following project pattern) for maintenance-specific config including thresholds and message templates.

**auto-merge.ts**
Automated merge eligibility checker for Dependabot PRs. Validates PR meets auto-merge criteria: from Dependabot bot, CI passing, semantic version analysis (patch/minor/security only), no breaking changes. Implements comment-based communication for rejected PRs with actionable feedback.

### GitHub Workflows

**ci.yml** (Main CI)
Main CI pipeline with commit normalization, Biome auto-repair, and Nx affected tasks. Handles all build/test/lint operations for PRs and pushes.

**claude-code-review.yml**
Claude AI-powered code review with REQUIREMENTS.md compliance checking, structured summary generation, and inline comment posting. Validates code patterns against standards and provides contextual feedback.

**active-qc.yml** (Event-Driven)
Event-driven quality control for PR/push/issue events with optimized sparse checkouts.

**Triggers**: `pull_request` (opened, edited, synchronize), `issues` (opened, edited, labeled, unlabeled), or `push` to main (labels.yml only)

**Optimizations**:
- Sparse checkout for all jobs (only `.github`, `package.json`, `pnpm-workspace.yaml`)
- Jobs are mutually exclusive via conditions (no wasted parallel runs)
- Concurrency grouping per PR/issue to cancel outdated runs
- Job order: PR jobs → Issue jobs → Label sync (grouped by event type)

Jobs:
1. **pr-sync**: On commit push (synchronize), analyzes PR commits to update title/labels to match reality. Detects breaking changes, infers type from commits, syncs breaking label.
2. **pr-hygiene**: On commit push (synchronize), automated PR review cleanup—resolves outdated threads, replies to addressed feedback, deletes owner prompts.
3. **pr-meta**: On PR opened/edited, validates PR title format, applies type labels via ai-meta.ts.
4. **issue-meta**: Validates issue metadata when opened/edited via ai-meta.ts.
5. **pin-issue**: Pins/unpins issues when the `pinned` label is added/removed (uses GraphQL pinIssue/unpinIssue mutations).
6. **sync-labels**: Syncs labels to repository via `crazy-max/ghaction-github-labeler` on push to main.

**passive-qc.yml** (Scheduled)
Scheduled quality control running every 6 hours with sequential job execution.

**Triggers**: Two separate schedules—QC runs every 6 hours at :15, maintenance runs daily at 03:00 UTC

**Optimizations**:
- Jobs run in sequence via `needs` chain for deterministic execution
- Sparse checkout for label sync (only `.github/labels.yml`)
- Stale management runs before aging report to ensure report reflects current state
- Conditional job execution based on schedule (QC vs maintenance)

QC Jobs (every 6 hours, sequential):
1. **sync-labels**: Backup label sync as safety net (no needs).
2. **stale-management**: 3 days inactive → stale label, then 7 more days → close (10 days total). Exemptions: pinned, security, critical. (needs: sync-labels)
3. **aging-report**: Generates issue metrics report (critical, stale, >3 days, total). (needs: stale-management)
4. **meta-consistency**: Runs ai-meta.ts to fix titles/labels/bodies across up to 10 items. (needs: aging-report)

Maintenance Jobs (daily 03:00 UTC or manual trigger, parallel):
1. **branch-cleanup**: Deletes stale branches using maintenance.ts (merged PRs >14 days, abandoned branches >30 days).
2. **cache-cleanup**: Prunes workflow run artifacts/logs >7 days, deletes stale GitHub Actions caches >7 days.
3. **maintenance-summary**: Aggregates cleanup results into summary table.

**auto-merge.yml**
Dependabot auto-merge for patch/minor/security updates. Automatically merges safe dependency updates after CI passes.

**ai-maintenance.yml**
Weekly AI maintenance + manual tasks via Claude (Mondays at 9am UTC). Handles repository maintenance tasks that benefit from AI assistance.

**dashboard.yml**
Auto-updating repository health dashboard. Triggered by 6-hour schedule (at :00), workflow_dispatch, or checkbox toggle on dashboard issue (Renovate-style `<!-- dashboard-refresh -->` marker). Uses dashboard.ts script to collect metrics and render clickable badges. Excludes skipped/cancelled workflow runs from success rate calculation.

> **Schedule Note**: Dashboard runs at :00 and Passive QC runs at :15 to prevent race conditions on shared resources.

**security.yml**
Multi-layer security scanning with parallel execution for speed.

**Optimizations**:
- Security jobs run in parallel (dependency-audit, codeql, secrets-scan, license-check)
- Sparse checkout for jobs that don't need full repo
- Post-scan jobs (create-security-issue, security-summary) run after all scans complete

Jobs (parallel):
- **dependency-audit**: pnpm audit for critical/high vulnerabilities
- **dependency-review**: New dependency review on PRs
- **codeql**: JavaScript/TypeScript static analysis
- **secrets-scan**: Gitleaks secret detection
- **license-check**: MIT license compliance

Jobs (post-scan):
- **create-security-issue**: Creates issue on failure (non-PR events)
- **security-summary**: Summary table in job output

### Composite Actions

**.github/actions/node-env/action.yml**
Node.js + pnpm + Nx setup with caching and distributed execution. Eliminates duplication across all workflows. Inputs: `node-version` (default: 25.2.1), `node-version-file` (optional), `pnpm-version` (default: 10.23.0), `install` (default: true), `frozen-lockfile` (default: true). Steps: (1) pnpm/action-setup for package manager, (2) actions/setup-node with pnpm cache, (3) conditional `pnpm install --frozen-lockfile`. All workflows reference via `uses: ./.github/actions/node-env`.

**.github/actions/git-identity/action.yml**
Configure git user for commits. Inputs: `name` (default: github-actions[bot]), `email` (default: github-actions[bot]@users.noreply.github.com). Used by ci, auto-merge, and other workflows that commit changes.

**.github/actions/meta-fixer/action.yml**
Universal metadata fixer action using ai-meta.ts. Validates and fixes PR/issue metadata including titles, labels, and descriptions. **Note**: Caller must checkout `.github` and `package.json` before using. Does not perform its own checkout to avoid redundant operations.

**.github/actions/normalize-commit/action.yml**
Transform [TYPE!]: to type!: format. Normalizes commit message formats from different sources to conventional commit style.

**.github/actions/label/action.yml**
Label-triggered behavior executor using label.ts. Handles labeled/unlabeled events and dispatches to appropriate behaviors (pin, unpin, comment) based on `B.labels.behaviors` config. **Note**: Caller must checkout `.github` and `package.json` before using. Inputs: `action` (labeled/unlabeled), `label` (name), `node_id` (GraphQL ID), `number` (issue/PR number).

**.github/actions/pr-hygiene/action.yml**
Automated PR review cleanup using pr-hygiene.ts. Resolves outdated review threads after code changes, replies to addressed feedback, and deletes owner prompts/slash commands. Outputs: `resolved` (thread count), `replied` (comment count), `deleted` (prompt count). Inputs: `pr_number` (required), `owner_logins` (optional, comma-separated).

### GitHub Templates

All issue templates are agent-friendly with JSON-parseable structure. Each field has an `id` attribute that becomes the JSON key when parsed by [github/issue-parser](https://github.com/github/issue-parser) or [issue-ops/parser](https://github.com/issue-ops/parser).

**bug_report.yml** (label: fix)
Fields: description, target, repro_steps, expected_behavior, priority (dropdown), logs (shell).

**feature_request.yml** (label: feat)
Fields: description, target, proposed_solution, acceptance_criteria, priority (dropdown), breaking (dropdown).

**refactor.yml** (label: refactor)
Fields: target, current_pattern, target_pattern, rationale, breaking (dropdown), test_strategy.

**perf.yml** (label: perf)
Fields: perf_type (dropdown), target, current_metrics, target_metrics, analysis, priority (dropdown).

**test.yml** (label: test)
Fields: test_type (dropdown), target, test_scope, coverage_target, priority (dropdown).

**docs.yml** (label: docs)
Fields: doc_type (dropdown), target, current_state, proposed_changes, priority (dropdown).

**chore.yml** (label: chore)
Fields: chore_type (dropdown), description, target, acceptance_criteria, priority (dropdown).

**build.yml** (label: build)
Fields: build_type (dropdown), target, description, acceptance_criteria, priority (dropdown).

**ci.yml** (label: ci)
Fields: ci_type (dropdown), target, description, acceptance_criteria, priority (dropdown).

**style.yml** (label: style)
Fields: style_type (dropdown), target, description, priority (dropdown).

**help.yml** (label: help)
Fields: help_type (dropdown), question, context, attempted_solutions, relevant_files.

**PULL_REQUEST_TEMPLATE.md**
PR template with Summary, Related Issues, Changes, and Human Review Checklist sections. Includes expandable "Automated Checks" section listing CI status checks. Human checklist covers: tests for new behavior, documentation updates, complexity concerns.

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

### Configuration Files

**renovate.json**
Configures Renovate Bot for dependency updates. Domain grouping: effect-ecosystem (Monday 6am), vite-ecosystem (automerge minor/patch), react-ecosystem (stable, automerge), react-canary (manual review), nx-canary (manual review), types (excluding @types/react). Platform automerge enabled, post-update runs `pnpmDedupe`. OSV vulnerability alerts enabled.

**lefthook.yml**
Pre-commit hooks. Two commands: biome (runs `pnpm biome check --write`, auto-stages fixes), effect-check (grep-based detection of `try {` in .ts/.tsx files, rejects if found outside comments). Runs in parallel.

---

## Interactive Triggers

On-demand workflow triggers via comments, checkboxes, and labels:

- **`@claude`** — Mention @claude in issues/PRs to trigger Claude Code agentic automation (claude.yml)
- **`/review`**, **`/fix`**, **`/explain`**, **`/summarize`**, **`/help`**, **`/ask`** — Slash commands for AI agent interaction (automatically cleaned up by pr-hygiene)
- **Dashboard checkbox** — Check the refresh checkbox on dashboard issue footer (`<!-- dashboard-refresh -->`) to trigger update
- **`pinned` label** — Adding this label to any issue pins it to the repository (up to 3 pinned issues)
- **Manual maintenance** — Trigger passive-qc.yml workflow_dispatch with `maintenance: true` for on-demand cleanup

---

## Quality Gates

1. **Pre-commit**: Lefthook runs Biome + Effect pattern validation (blocks commits with `try {` outside comments)
2. **PR opened**: CI auto-fixes style, ai-meta.ts validates title + applies labels
3. **PR sync**: On commit push, pr-sync.ts updates title/labels to match commit reality, pr-hygiene.ts cleans review threads
4. **CI**: Build, test, typecheck via Nx affected (normalize commits, Biome auto-repair)
5. **Code review**: claude-code-review.yml checks REQUIREMENTS.md compliance with inline comments
6. **Merge gate**: All checks green, reviews approved, semantic title validated, no breaking changes for auto-merge
7. **Dependabot gate**: Auto-merge for patch/minor/security updates (auto-merge.ts validates eligibility)
8. **Post-merge**: Dashboard updates every 6 hours, maintenance runs daily at 03:00 UTC

---

## Mutation Testing (Stryker)

Stryker mutation testing is integrated at the tooling level but runs on-demand (not in CI by default due to execution time).

### Configuration
- `stryker.config.js` — Minimal config (Vitest runner, 80% threshold)
- `nx.json` targetDefaults.mutate — Nx target for running mutation tests
- `B.algo.mutationPct: 80` — Schema constant for mutation score threshold

### Running Mutation Tests
```bash
nx mutate <project>  # Run on specific project
```

### Integration Points
- `gate.ts` — PR eligibility gate checks mutation score from check runs
- `failure-alert.ts` — Creates debt issues for mutation test failures
- Expects check named `mutation-score` for eligibility verification

### Threshold
- **Break threshold**: 50% (mutation score below this fails the run)
- **High threshold**: 80% (target for healthy test suites)
- **Low threshold**: 60% (warning level)

---

## Key Patterns

- **Effect Pipelines**: All async/failable operations use Effect, no try/catch
- **Option Monads**: All nullable values use Option, no null checks
- **Single B Constant**: All config in one frozen object per file (schema.ts has ~696 lines)
- **Dispatch Tables**: Replace if/else with type-safe lookup tables (`handlers[key](data)`)
- **Branded Types**: Nominal typing via @effect/schema `S.Brand`
- **Section Separators**: 77-char separators for files >50 LOC
- **Polymorphic Entry Points**: Single function handles all modes via discriminated unions
- **Sparse Checkout**: Workflows use sparse checkout for faster clones (only needed files)
- **Concurrency Groups**: Cancel outdated workflow runs per PR/issue to save resources
- **AI-First Design**: Issue templates, PR formats, and automation optimized for agent parsing

## Agentic Architecture Principles (2025)

Following industry best practices for agentic CI/CD and workflow orchestration:

1. **Multi-Agent Coordination**: Specialized agents (10 custom agents) with explicit delegation rules
2. **Semantic Routing**: Fast intent classification via embedding similarity (label patterns, commit analysis)
3. **Human-in-the-Loop**: AI proposes changes, humans validate via PR reviews and manual triggers
4. **Progressive Refinement**: Agents iterate on feedback (pr-hygiene cleans up after address, meta-consistency fixes errors)
5. **Schema-Driven Automation**: Declarative specs in B constant enable algorithmic behavior without hardcoded logic
6. **Non-Deterministic Testing**: Quality gates based on semantic outcomes, not exact string matches
7. **Cost Optimization**: Token consumption monitored, concurrency cancellation prevents waste
8. **Drift Detection**: Scheduled consistency checks catch degradation before user impact

## Security and Compliance

- **Secrets Management**: API keys stored in GitHub Secrets, never in code
- **Permissions**: Minimal necessary permissions per workflow (contents, issues, pull-requests, models)
- **Supply Chain**: Actions pinned by SHA, not floating tags
- **Code Scanning**: CodeQL + Gitleaks + SonarCloud for multi-layer analysis
- **Dependency Security**: Automated audits, Renovate grouped updates, auto-merge for safe changes
- **Audit Trail**: All automation actions logged, user attribution preserved

---

**Last Updated**: 2025-12-01
**Reflects**: Production implementation as of commit hash in this PR
