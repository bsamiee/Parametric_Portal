# Agentic Infrastructure Reference

Comprehensive reference for all automation systems, agents, and tooling in Parametric Portal. This documentation reflects the production implementation as of December 2025.

**Quick Navigation**:
- [Overview](#overview) — Three-paradigm system (Active, Passive, AI)
- [File Inventory](#file-inventory) — 10 workflows, 13 scripts, 6 actions, 10 agents, 12 templates
- [Schema Infrastructure](#schema-infrastructure) — Single B constant, SpecRegistry types, Ops factory
- [GitHub Workflows](#github-workflows) — Detailed workflow descriptions
- [GitHub Scripts](#github-scripts) — Script implementations and patterns
- [Agentic Architecture](#agentic-architecture-principles-2025) — Modern patterns for AI-driven CI/CD
- [Cost Optimization](#cost-optimization-and-monitoring) — Resource management and monitoring
- [Security](#security-and-compliance) — Security practices and compliance

---

## Overview

Parametric Portal implements a **three-paradigm agentic maintenance system** aligned with industry-leading practices for AI-driven workflow orchestration in 2025:

- **Active**: Event-triggered automation (PR commits, issue changes, labels) — responds within seconds
- **Passive**: Scheduled maintenance (6-hour QC cycles, daily cleanup) — continuous drift detection
- **AI**: Agentic workflows with Claude Code for complex tasks requiring reasoning — human-in-the-loop

All automation follows the project's core patterns: single B constant configuration, dispatch tables, Effect pipelines, and schema-driven polymorphism.

### Architecture Philosophy

The agentic infrastructure is designed around four key principles:

1. **Semantic Routing**: Fast intent classification via pattern matching and embedding similarity (label taxonomy, commit analysis)
2. **Progressive Refinement**: Agents iterate on feedback loops (pr-hygiene cleans after fixes, meta-consistency corrects errors)
3. **Multi-Agent Coordination**: Specialized agents (10 custom profiles) with explicit delegation rules via dispatch tables
4. **Schema-Driven Declarative Automation**: Behavior encoded in B constant enables algorithmic adaptation without code changes

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
- `.github/workflows/active-qc.yml` — Event-driven QC: PR sync, PR hygiene, PR/issue metadata validation, label pinning, duplicate detection
- `.github/workflows/ai-maintenance.yml` — Weekly AI maintenance + manual tasks via Claude Code
- `.github/workflows/auto-merge.yml` — Dependabot auto-merge for patch/minor/security updates
- `.github/workflows/ci.yml` — Main CI: normalize commits, Biome auto-repair, Nx affected tasks (build/test/lint/typecheck)
- `.github/workflows/claude-code-review.yml` — Claude AI code review with structured summary and inline comments
- `.github/workflows/claude.yml` — Claude Code agentic automation triggered via @claude mentions in issues/PRs
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard (6-hour schedule + checkbox trigger)
- `.github/workflows/passive-qc.yml` — Scheduled QC: stale management via Issue Helper, aging report, meta consistency, daily maintenance
- `.github/workflows/security.yml` — Multi-layer: dependency audit, CodeQL, Gitleaks, license check
- `.github/workflows/sonarcloud.yml` — SonarCloud static analysis for code quality and security hotspots

**Note**: Releases are handled via `npx nx release` (configured in nx.json).

### GitHub Scripts (14 total)
Composable infrastructure scripts using schema.ts polymorphic toolkit:

- `.github/scripts/schema.ts` — Core infrastructure: B constant (includes B.helper config), types, markdown generators, ops factory, mutate handlers
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
- `.github/scripts/issue-ops.ts` — Complex Issue Helper queries (find-stale, report-inactive) for aging reports and analytics
- `.github/scripts/env.ts` — Environment configuration (lang, nxCloudWorkspaceId)

### GitHub Composite Actions (7 total)
- `.github/actions/node-env/action.yml` — Node.js + pnpm + Nx setup with caching + distributed execution
- `.github/actions/git-identity/action.yml` — Git user configuration for commits
- `.github/actions/meta-fixer/action.yml` — Universal metadata fixer action using ai-meta.ts
- `.github/actions/normalize-commit/action.yml` — Transform [TYPE!]: to type!: format
- `.github/actions/label/action.yml` — Label-triggered behavior executor (pin, unpin, comment)
- `.github/actions/pr-hygiene/action.yml` — Automated PR review cleanup using pr-hygiene.ts
- `.github/actions/issue-ops/action.yml` — Unified issue operations via Issue Helper with parametric dispatch

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
All configuration in one frozen object with nested domains (713 lines, ~16KB):
- `B.algo` — Algorithm thresholds (closeRatio, mutationPct 80%, staleDays 30)
- `B.api` — GitHub API constants (perPage 100, states)
- `B.breaking` — Breaking change detection patterns and label
- `B.dashboard` — Dashboard config (bots, colors, targets, schedule, output)
- `B.helper` — Issue Helper config (commands, inactivity thresholds, messages for duplicate/stale)
- `B.hygiene` — PR hygiene config (bot aliases, slash commands including /duplicate, valuable patterns, display limits)
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
│                          GitHub Workflows (10)                        │
│  ┌──────────────┐  ┌─────────────────────────────────┐               │
│  │ CI Pipeline  │→│ claude-code-review.yml            │               │
│  │ (ci.yml)     │  │ (AI review + inline comments)    │               │
│  └──────┬───────┘  └──────────────┬──────────────────┘               │
│         │                         │                                   │
│         ▼                         ▼                                   │
│  ┌───────────────────┐     ┌──────────────┐                          │
│  │ active-qc.yml     │     │ AI Maint     │                          │
│  │ + passive-qc.yml  │     │ (weekly)     │                          │
│  │ + pr-sync/hygiene │     └──────────────┘                          │
│  └───────────────────┘                                               │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     Schema Infrastructure (13 scripts)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ schema.ts → dashboard.ts, probe.ts, report.ts, failure-alert.ts ││
│  │ gate.ts, ai-meta.ts, label.ts, pr-sync.ts, pr-hygiene.ts        ││
│  │ maintenance.ts, auto-merge.ts, env.ts                            ││
│  │ B constant (696L) + Ops Factory + Mutate Handlers                ││
│  └──────────────────────────────────────────────────────────────────┘│
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (12)             Dependabot Auto-Merge
    (type labels applied)             (auto-merge.yml)
    + 6 Composite Actions            + auto-merge.ts gate
          │                                     │
          ▼                                     ▼
    Issue Created                       Dependency Updates
```

### Data Flow and Agentic Orchestration

The system implements **handoff orchestration** and **sequential refinement** patterns where specialized agents assess tasks and delegate to appropriate handlers:

1. **Issue Creation**: Templates apply type labels (fix, feat, perf, style, test, docs, refactor, chore, build, ci, help) → Agent routing via label classification
2. **PR Lifecycle**: 
   - PR opened → CI (Biome auto-repair) → PR Sync (commit analysis) → Code Review (Claude) → Merge
   - Each push triggers: pr-sync (metadata sync) + pr-hygiene (thread cleanup) in parallel
3. **PR Commit Sync**: Commit pushed → pr-sync.ts analyzes commits → Semantic routing determines type → Updates PR title/labels to match reality
4. **PR Review Hygiene**: Commit pushed → pr-hygiene.ts extracts review threads → Pattern matching detects addressed feedback → Auto-resolves outdated threads, replies to valuable feedback
5. **Dependency Flow**: Dependabot PR → CI → Auto-Merge gate (semantic version check) → Merge/Block with actionable feedback
6. **Dashboard**: Schedule/command → schema.ts dispatch tables → Parallel API calls → Section renderers → Markdown assembly → Issue upsert + pin
7. **AI Maintenance**: Weekly schedule → Claude Code agent → Natural language task decomposition → Execution with tool calls → Summary issue creation

### Agentic Decision Trees

```
Issue/PR Event
    │
    ├─ Label Change? ──→ label.ts dispatch table ──→ B.labels.behaviors[label][action]
    │                                                     ├─ pin/unpin (GraphQL mutation)
    │                                                     └─ comment (template from B)
    │
    ├─ PR Synchronize? ──→ Parallel Execution
    │                        ├─ pr-sync.ts: Commit analysis → Title/label sync
    │                        └─ pr-hygiene.ts: Review analysis → Thread resolution
    │
    ├─ Metadata Invalid? ──→ ai-meta.ts
    │                           ├─ Pattern matching (B.meta.infer)
    │                           └─ AI fallback (Claude) if no match
    │
    ├─ Stale? ──→ Scheduled check → B.algo.staleDays threshold → Label + comment
    │
    └─ @claude mention? ──→ Claude Code Action
                               ├─ Context assembly (CLAUDE.md + files)
                               ├─ Tool execution (allowed via claude_args)
                               └─ Response generation (inline/summary)
```

### Semantic Routing Implementation

The system implements fast semantic routing patterns (sub-100ms) to avoid expensive LLM calls:

1. **Label-Based Routing**: `B.labels.categories` provides pre-classified taxonomies for instant dispatch
2. **Pattern-Based Classification**: `B.meta.infer` uses regex patterns for commit type inference before AI fallback
3. **Dispatch Tables**: All handlers organized as `handlers[discriminant](data)` for O(1) routing
4. **Embedding-Free**: Uses algorithmic pattern matching instead of vector embeddings for speed and cost optimization

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

**.github/actions/issue-ops/action.yml**
Unified issue/PR operations via Issue Helper (actions-cool/issues-helper@v3.7.2) with parametric dispatch. Supports 14 operations: check-inactive, close-issues, find-issues, find-comments, mark-duplicate, add-labels, remove-labels, toggle-labels, create-comment, update-comment, create-issue, update-issue, close-issue, open-issue. All inputs are optional except `operation`. Configuration values defined in B.helper (schema.ts) provide defaults but workflows specify actual values for GitHub Actions compatibility.

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

---

## Issue Helper Integration Strategy

The repository integrates [Issue Helper](https://github.com/marketplace/actions/issues-helper) v3.7.2 to leverage battle-tested GitHub issue automation while maintaining our schema-driven architecture. Integration follows the project's core patterns: parametric configuration, dispatch tables, and algorithmic operations.

### Architecture (Three-Layer Pattern)

**Layer 1: Configuration** (`B.helper` in schema.ts)
- Centralized constants for commands, thresholds, messages
- Single source of truth following project patterns
- `B.helper.commands` — Command triggers (e.g., `/duplicate`)
- `B.helper.inactivity` — Thresholds for stale detection (3 days check, 7 days close)
- `B.helper.messages` — Message templates (stale, duplicate)

**Layer 2: Composite Action** (`.github/actions/issue-ops/action.yml`)
- Wraps Issue Helper v3.7.2 with parametric dispatch
- Handles SIMPLE atomic operations: check-inactive, close-issues, mark-duplicate, add-labels
- 15 operations via single `operation` parameter
- Direct workflow usage for basic automation

**Layer 3: TSX Script** (`.github/scripts/issue-ops.ts`)
- Handles COMPLEX query operations beyond Issue Helper's capabilities
- `find-stale`: Custom filtering with label exclusions and age calculation
- `report-inactive`: Sorted aging reports for analytics
- **Note**: Currently implemented but not invoked in workflows - reserved for future aging report features
- Returns typed results for downstream processing when integrated

### Operations Leveraged

**Stale Management** (replaces actions/stale):
- `check-inactive`: Marks issues/PRs inactive for 3+ days with stale label
- `close-issues`: Closes items with stale label inactive for 7+ more days (10 days total)
- More granular control via `inactive-mode`: 'comment', 'issue', 'issue-created', 'comment-created'
- Respects exempt labels: pinned, security, critical (via `exclude-labels`)

**Duplicate Detection**:
- `mark-duplicate`: `/duplicate` command support with automatic labeling and closing

**Label Management**:
- `toggle-labels`: State-based toggling (add if absent, remove if present)
- `add-labels`, `remove-labels`: Explicit label operations

**Query Operations** (future use):
- `find-issues`, `find-comments`: Structured JSON responses for downstream processing
- Enable complex batch operations and reporting

### What NOT Replaced

**GraphQL Operations** (Issue Helper uses REST only):
- Pin/unpin issues: Custom label.ts uses GraphQL mutations
- Issue transfers, repository queries

**AI-Powered Operations**:
- Meta-fixer (ai-meta.ts): Pattern inference with Claude fallback
- Code review (claude-code-review.yml): Context-aware analysis

**Complex Multi-Step Workflows**:
- PR hygiene (pr-hygiene.ts): Review thread analysis with valuable pattern detection
- Branch maintenance (maintenance.ts): Git operations, draft PR warnings
- Dashboard (dashboard.ts): Multi-source metrics aggregation with parallel API calls

### Workflow Integration

**passive-qc.yml** — Stale management refactored to use Issue Helper:
```yaml
- Check Inactive Items: check-inactive (3 days, comment/issue mode)
- Close Stale Items: close-issues (7 days, stale label, not_planned reason)
```

**active-qc.yml** — Duplicate detection added to event-driven workflow:
```yaml
- Duplicate Detection: mark-duplicate on /duplicate command (write permission required)
```

### Layer Selection Guide

**Use Composite Action** (`.github/actions/issue-ops`) when:
- Simple atomic operation (mark duplicate, add label, check inactive)
- No custom filtering or business logic required
- Standard Issue Helper operation suffices
- Example: Marking duplicates, applying stale labels

**Use TSX Script** (`issue-ops.ts`) when:
- Need structured data for downstream processing
- Custom filtering logic (age calculations, label exclusions)
- Sorted/aggregated results required
- Example: Aging reports with metrics, custom stale analysis

**Configuration in both** via `B.helper` - thresholds, messages, command triggers all centralized

### Benefits

**Reduced Maintenance**: Battle-tested action (3.7.2, actively maintained) vs custom code for common operations.

**Consistency**: Standard GitHub Actions marketplace action familiar to contributors.

**Flexibility**: Parametric action design allows extending operations without new action files.

**Schema-Driven**: All configuration in B.helper enables algorithmic adaptation without code changes.

**Delegation**: Frees custom scripts for complex logic requiring reasoning, multi-step workflows, or AI integration.

### Cost Optimization

- **Public Repos**: Unlimited Issue Helper usage (zero cost)
- **Private Repos**: 2,000 executions/month (typically sufficient for <500 PRs/month)
- **API Efficiency**: Issue Helper batches operations, respects rate limits, includes retry logic

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
- **`/duplicate`** — Mark issue as duplicate (requires write permission, handled by Issue Helper via active-qc.yml)
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

## Cost Optimization and Monitoring

The agentic infrastructure implements modern cost optimization strategies aligned with 2025 best practices:

### GitHub Actions Minutes
- **Concurrency Groups**: Cancel outdated workflow runs per PR/issue (`group: active-qc-${{ github.event_name }}-${{ github.event.pull_request.number }}`)
- **Sparse Checkout**: Only clone needed files (`.github/`, `package.json`, `pnpm-workspace.yaml`) — 90% faster
- **Conditional Jobs**: Mutually exclusive conditions prevent wasted parallel runs
- **Caching**: pnpm store + Nx cache via composite actions reduce build times by 50-80%
- **Affected Tasks**: `nx affected` runs only changed projects, not entire monorepo

### AI/LLM Cost Management
- **Token Monitoring**: Track consumption via Claude API usage dashboards
- **Pattern Matching First**: Use `B.meta.infer` regex patterns before expensive AI fallback (ai-meta.ts)
- **Max Turns Limit**: Claude workflows capped at 8-10 turns to prevent runaway costs
- **Semantic Routing**: Dispatch tables provide O(1) routing without embedding/LLM calls
- **Incremental Processing**: pr-hygiene and pr-sync analyze diffs, not full codebase

### Resource Cleanup
- **Artifact Retention**: Default 7 days for build artifacts, 30 days for coverage
- **Cache Pruning**: Daily cleanup of stale caches >7 days old (passive-qc maintenance job)
- **Branch Cleanup**: Automated deletion of merged branches >14 days, abandoned >30 days
- **Workflow Run Cleanup**: Logs and artifacts pruned after retention period

### Monitoring Metrics
- **Dashboard Refresh**: 6-hour schedule tracks workflow success rates, stale PRs, issue metrics
- **Success Rate Targets**: 90% workflow success, 70% warning threshold (B.dashboard.targets)
- **Drift Detection**: Scheduled meta-consistency checks catch degradation before user impact
- **Failure Alerts**: Creates issues for CI/security failures with categorized debt tracking

**Cost Estimate (100 PRs/month + 50 issues)**:
- GitHub Actions: ~500 minutes/month (within free tier for public repos)
- Claude API: ~$10-15/month (depends on review complexity and turns)
- Nx Cloud: Free tier (500 hours/month) for distributed caching

## Security and Compliance

- **Secrets Management**: API keys stored in GitHub Secrets, never in code
- **Permissions**: Minimal necessary permissions per workflow (contents, issues, pull-requests, models)
- **Supply Chain**: Actions pinned by SHA, not floating tags (e.g., `@11bd71901bbe5b1630ceea73d27597364c9af683`)
- **Code Scanning**: CodeQL + Gitleaks + SonarCloud for multi-layer analysis
- **Dependency Security**: Automated audits, Renovate grouped updates, auto-merge for safe changes
- **Audit Trail**: All automation actions logged, user attribution preserved
- **Human-in-the-Loop**: AI proposes, humans approve via PR reviews and manual triggers

---

## Workflow: Change Detection

### Change Detection in CI

The `changed-detection` action provides intelligent file change detection with Nx integration:

```yaml
- name: Detect Changes
  id: changes
  uses: ./.github/actions/changed-detection
  with:
    mode: fast
    globs_pattern: 'apps/**,packages/**,.github/**'
    
- name: Conditional Build
  if: steps.changes.outputs.affected_projects != '[]'
  run: pnpm exec nx affected -t build
```

**Modes**:
- `fast` — Git API, cached, 0-5s (PR validation)
- `comprehensive` — REST API with dependencies, 5-15s (releases)
- `matrix` — Parallel job generation, up to 256 jobs (monorepo)

**Outputs**: `changed_files`, `affected_projects`, `stats_json`, `matrix_json`, `has_changes`

### Unified PR Comments

The `pr-comment` action consolidates multiple workflow outputs:

```yaml
- name: Unified PR Comment
  if: github.event_name == 'pull_request' && always()
  uses: ./.github/actions/pr-comment
  with:
    pr_number: ${{ github.event.pull_request.number }}
    sections_data: |
      {
        "changes": ${{ toJSON(steps.changes.outputs) }},
        "quality": { "lint": "${{ steps.lint.outcome }}" }
      }
```

**Features**:
- Marker-based update-or-create (`<!-- UNIFIED-CI-REPORT -->`)
- Conditional sections (changes, affected, quality, biome)
- Single comment, not per-job spam

### Matrix Job Generation

Generate parallel jobs based on affected projects:

```yaml
detect:
  outputs:
    matrix: ${{ steps.changes.outputs.matrix_json }}
  steps:
    - uses: ./.github/actions/changed-detection
      with:
        mode: matrix

build-matrix:
  needs: detect
  strategy:
    matrix: ${{ fromJSON(needs.detect.outputs.matrix) }}
  steps:
    - run: pnpm exec nx build ${{ matrix.project }}
```

**Integration**: Uses `nx show projects --affected --json` + `nrwl/nx-set-shas` for base/head SHA detection. Security: step-security/changed-files v4.3.0 (SHA-pinned, OpenSSF 10/10).

---

**Last Updated**: 2025-12-02
**Reflects**: Production implementation with changed-files integration
