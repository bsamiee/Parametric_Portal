# Agentic Infrastructure Reference

Concise reference for all automation systems, agents, and tooling in Parametric Portal.

---

## File Inventory

### Root-Level Protocol Files
- `REQUIREMENTS.md` — Single Source of Truth (SSoT) for all coding standards and agent protocols
- `AGENTS.md` — Agent charter for CLI/CI agents
- `CLAUDE.md` — Code standards for Claude Code

### Configuration Files
- `renovate.json` — Renovate dependency update configuration with domain grouping
- `lefthook.yml` — Pre-commit hooks including Effect pattern validation
- `.github/labels.yml` — Declarative label definitions with colors (managed by active-qc + passive-qc workflows)
- `.github/copilot-instructions.md` — IDE agent instructions

### GitHub Workflows (8 total)
- `.github/workflows/active-qc.yml` — Event-driven QC: PR title/label validation, label sync on push
- `.github/workflows/ai-maintenance.yml` — Weekly AI maintenance + manual tasks via Claude
- `.github/workflows/auto-merge.yml` — Dependabot auto-merge for patch/minor/security
- `.github/workflows/ci.yml` — Main CI: normalize commits, Biome auto-repair, Nx affected tasks
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard (6-hour schedule + checkbox trigger)
- `.github/workflows/passive-qc.yml` — Scheduled QC: stale management, aging report, meta consistency
- `.github/workflows/pr-review.yml` — REQUIREMENTS.md compliance + feedback synthesis + /summarize
- `.github/workflows/security.yml` — Multi-layer: dependency audit, CodeQL, Gitleaks, license check

**Note**: Releases are handled via `npx nx release` (configured in nx.json).

### GitHub Scripts (9 total)
Composable infrastructure scripts using schema.ts polymorphic toolkit:

- `.github/scripts/schema.ts` — Core infrastructure: B constant, types, markdown generators, ops factory, mutate handlers
- `.github/scripts/dashboard.ts` — Metrics collector + section renderers for dashboard
- `.github/scripts/probe.ts` — Data extraction layer for issues/PRs/discussions
- `.github/scripts/report.ts` — Config-driven report generator
- `.github/scripts/failure-alert.ts` — CI/security failure alert creator
- `.github/scripts/gate.ts` — Eligibility gating for PRs
- `.github/scripts/ai-meta.ts` — Universal metadata fixer with AI fallback
- `.github/scripts/label.ts` — Label-triggered behavior executor (pin, unpin, comment)
- `.github/scripts/env.ts` — Environment configuration (lang, bundleThresholdKb, nxCloudWorkspaceId)

### GitHub Composite Actions (5 total)
- `.github/actions/node-env/action.yml` — Node.js + pnpm + Nx setup with caching + distributed execution
- `.github/actions/git-identity/action.yml` — Git user configuration for commits
- `.github/actions/meta-fixer/action.yml` — Universal metadata fixer action using ai-meta.ts
- `.github/actions/normalize-commit/action.yml` — Transform [TYPE!]: to type!: format
- `.github/actions/label/action.yml` — Label-triggered behavior executor (pin, unpin, comment)

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

### Scripts (1 total)
- `scripts/generate-pwa-icons.ts` — PWA icon generation (utility)

### Documentation
- `docs/AUTOMATION.md` — Comprehensive automation guide
- `docs/INTEGRATIONS.md` — External integrations and setup

---

## Schema Infrastructure

The `.github/scripts/schema.ts` file is the core of the automation system, implementing:

### Single B Constant
All configuration in one frozen object with nested domains:
- `B.alerts` — CI/security alert templates
- `B.algo` — Algorithm thresholds (stale days, mutation %)
- `B.api` — GitHub API constants (per_page, states)
- `B.content` — Report configurations (aging, bundle)
- `B.dashboard` — Dashboard config (bots, colors, targets, schedule)
- `B.gen` — Markdown generators (badges, shields, links, callouts)
- `B.labels` — Label taxonomy (categories, behaviors, exempt lists, GraphQL mutations)
- `B.patterns` — Regex patterns for parsing
- `B.probe` — Data collection defaults
- `B.release` — Conventional commit mapping
- `B.thresholds` — Validation thresholds (bundle size)
- `B.time` — Time constants (day in ms)

### SpecRegistry Type System
Polymorphic spec definitions for type-safe operations:
- `U<'alert'>` — CI/security alert specs
- `U<'dashboard'>` — Dashboard update specs
- `U<'filter'>` — Issue filtering (age, label)
- `U<'source'>` — Data sources (fetch, params, payload)
- `U<'output'>` — Output targets (summary, comment, issue)
- `U<'format'>` — Formatters (table, body)
- `U<'mutate'>` — Mutation ops (comment, issue, label, review, release)

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
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    AGENTS.md         copilot-instructions    CLAUDE.md
    (CLI/CI)              (.github/)          (Claude Code)
          │                  │                  │
          └──────────────────┴──────────────────┘
                             │
                             ▼
                    Custom Agents (10)
                    (.github/agents/)
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          GitHub Workflows (8)                         │
│  ┌──────────────┐  ┌─────────────────────────────────┐               │
│  │ CI Pipeline  │→│ pr-review.yml                    │               │
│  │ (ci.yml)     │  │ (compliance + feedback synthesis)│               │
│  └──────┬───────┘  └──────────────┬──────────────────┘               │
│         │                         │                                   │
│         ▼                         ▼                                   │
│  ┌───────────────────┐     ┌──────────────┐                          │
│  │ active-qc.yml     │     │ AI Maint     │                          │
│  │ + passive-qc.yml  │     │ (weekly)     │                          │
│  └───────────────────┘     └──────────────┘                          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Schema Infrastructure (8 scripts)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ schema.ts → dashboard.ts, probe.ts, report.ts, failure-alert.ts ││
│  │ B constant + SpecRegistry + Ops Factory + Mutate Handlers        ││
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
2. **PR Lifecycle**: PR opened → CI (Biome auto-repair) → Code Review → Merge
3. **Dependency Flow**: Dependabot PR → CI → Auto-Merge gate → Merge/Block
4. **Dashboard**: Schedule/command → schema.ts → collect metrics → render → update issue

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

### GitHub Workflows

**ci.yml** (Main CI)
Main CI pipeline with commit normalization, Biome auto-repair, and Nx affected tasks. Handles all build/test/lint operations for PRs and pushes.

**pr-review.yml**
REQUIREMENTS.md compliance checking, feedback synthesis, and /summarize command. Validates code patterns against standards and provides structured review feedback.

**active-qc.yml** (Event-Driven)
Event-driven quality control for PR/push/issue events.

**Triggers**: `pull_request` (opened, edited, synchronize), `issues` (opened, edited, labeled), or `push` to main (labels.yml only)

Jobs:
1. **pr-meta**: Validates PR title format, applies type labels via ai-meta.ts.
2. **issue-meta**: Validates issue metadata when opened/edited.
3. **sync-labels**: Syncs labels to repository via `crazy-max/ghaction-github-labeler` on push.
4. **pin-issue**: Pins issues when the `pinned` label is added (uses GraphQL pinIssue mutation).

**passive-qc.yml** (Scheduled)
Scheduled quality control running every 6 hours.

**Triggers**: Schedule only (every 6 hours)

Jobs:
1. **sync-labels**: Backup label sync as safety net.
2. **stale-management**: 3 days inactive → stale label, then 7 more days → close (10 days total). Exemptions: pinned, security, critical.
3. **aging-report**: Generates issue metrics report (critical, stale, >3 days, total).

**auto-merge.yml**
Dependabot auto-merge for patch/minor/security updates. Automatically merges safe dependency updates after CI passes.

**ai-maintenance.yml**
Weekly AI maintenance + manual tasks via Claude. Handles repository maintenance tasks that benefit from AI assistance.

**dashboard.yml**
Auto-updating repository health dashboard. Triggered by 6-hour schedule, workflow_dispatch, or checkbox toggle on dashboard issue (Renovate-style `<!-- dashboard-refresh -->` marker). Uses dashboard.ts script to collect metrics and render clickable badges. Excludes skipped/cancelled workflow runs from success rate calculation.

**security.yml**
Multi-layer security scanning. Jobs: dependency-audit (`pnpm audit`), CodeQL (JavaScript/TypeScript analysis), secrets-scan (Gitleaks), license-check (copyleft detection). Creates security issue if critical vulnerabilities found.

### Composite Actions

**.github/actions/node-env/action.yml**
Node.js + pnpm + Nx setup with caching and distributed execution. Eliminates duplication across all workflows. Inputs: `node-version` (default: 25.2.1), `node-version-file` (optional), `pnpm-version` (default: 10.23.0), `install` (default: true), `frozen-lockfile` (default: true). Steps: (1) pnpm/action-setup for package manager, (2) actions/setup-node with pnpm cache, (3) conditional `pnpm install --frozen-lockfile`. All workflows reference via `uses: ./.github/actions/node-env`.

**.github/actions/git-identity/action.yml**
Configure git user for commits. Inputs: `name` (default: github-actions[bot]), `email` (default: github-actions[bot]@users.noreply.github.com). Used by ci, auto-merge, and other workflows that commit changes.

**.github/actions/meta-fixer/action.yml**
Universal metadata fixer action using ai-meta.ts. Validates and fixes PR/issue metadata including titles, labels, and descriptions.

**.github/actions/normalize-commit/action.yml**
Transform [TYPE!]: to type!: format. Normalizes commit message formats from different sources to conventional commit style.

**.github/actions/label/action.yml**
Label-triggered behavior executor using label.ts. Handles labeled/unlabeled events and dispatches to appropriate behaviors (pin, unpin, comment) based on `B.labels.behaviors` config. Inputs: `action` (labeled/unlabeled), `label` (name), `node_id` (GraphQL ID), `number` (issue/PR number).

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

- **`/summarize`** — PR Review workflow, synthesizes all feedback (PR comments)
- **Dashboard checkbox** — Check the refresh checkbox on dashboard issue footer to trigger update
- **`pinned` label** — Adding this label to any issue pins it to the repository (up to 3 pinned issues)

---

## Quality Gates

1. **Pre-commit**: Lefthook runs Biome + Effect pattern validation
2. **PR opened**: CI auto-fixes style, ai-meta.ts validates title + applies labels
3. **CI**: Build, test, typecheck via Nx affected
4. **Post-CI**: pr-review.yml checks REQUIREMENTS.md compliance
5. **Merge gate**: All checks green, reviews approved, semantic title validated
6. **Dependabot gate**: Auto-merge for patch/minor/security updates

---

## Key Patterns

- **Effect Pipelines**: All async/failable operations use Effect, no try/catch
- **Option Monads**: All nullable values use Option, no null checks
- **Single B Constant**: All config in one frozen object per file
- **Dispatch Tables**: Replace if/else with type-safe lookup tables
- **Branded Types**: Nominal typing via @effect/schema `S.Brand`
- **Section Separators**: 77-char separators for files >50 LOC
- **SpecRegistry**: Polymorphic type system for config-driven operations

---

**Last Updated**: 2025-11-30
