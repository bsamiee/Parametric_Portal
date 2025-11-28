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

### GitHub Workflows (12 total)
- `.github/workflows/ci.yml` — Main CI pipeline with Nx Cloud remote caching and affected commands
- `.github/workflows/active-qc.yml` — PR title validation + label sync (event-driven)
- `.github/workflows/passive-qc.yml` — Stale management + aging report + label sync backup (scheduled)
- `.github/workflows/pr-review.yml` — Consolidated PR review: REQUIREMENTS.md compliance + feedback synthesis + /summarize
- `.github/workflows/auto-merge.yml` — Dependabot PR auto-merge (Renovate uses native platformAutomerge)
- `.github/workflows/biome-repair.yml` — Auto-fix style issues before review
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard
- `.github/workflows/release.yml` — Conventional commit-based releases
- `.github/workflows/bundle-analysis.yml` — Bundle size tracking with PR comments
- `.github/workflows/security.yml` — Multi-layer security scanning
- `.github/workflows/ai-assist.yml` — Claude @mention integration
- `.github/workflows/ai-maintenance.yml` — Weekly AI-driven maintenance tasks

### GitHub Scripts (10 total)
Composable infrastructure scripts using schema.ts polymorphic toolkit:

- `.github/scripts/env.ts` — Environment-driven configuration for multi-language support (ts/cs)
- `.github/scripts/schema.ts` — Polymorphic workflow infrastructure (B constant DSL, SpecRegistry, ops factory, mutate)
- `.github/scripts/dashboard.ts` — Metrics collector with dispatch table section renderers
- `.github/scripts/probe.ts` — Data extraction layer with target-type dispatch (issue/pr/discussion)
- `.github/scripts/report.ts` — Config-driven report generator (source→format→output pipeline)
- `.github/scripts/release.ts` — Commit analyzer using B.types classification (legacy, now using native nx release)
- `.github/scripts/failure-alert.ts` — Alert creator using fn.classifyDebt and B.alerts
- `.github/scripts/gate.ts` — Eligibility gate using fn.classifyGating rules
- `.github/scripts/pr-meta.ts` — Title parser using B.pr.pattern and B.types mapping
- `.github/scripts/bundle-sizes.ts` — Bundle size analyzer for monorepo packages (raw/gzip/brotli)

### GitHub Composite Actions (3 total)
- `.github/actions/node-env/action.yml` — Node.js + pnpm setup with caching (used by all workflows)
- `.github/actions/git-identity/action.yml` — Git user configuration for commits
- `.github/actions/nx-setup/action.yml` — Nx affected command setup via nrwl/nx-set-shas (caching via Nx Cloud)

### GitHub Templates (10 total)
- `.github/ISSUE_TEMPLATE/config.yml` — Template configuration (blank issues disabled)
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Bug report form (label: fix)
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form (label: feat)
- `.github/ISSUE_TEMPLATE/perf.yml` — Performance improvement form (label: perf)
- `.github/ISSUE_TEMPLATE/refactor.yml` — Refactor request form (label: refactor)
- `.github/ISSUE_TEMPLATE/test.yml` — Test request form (label: test)
- `.github/ISSUE_TEMPLATE/style.yml` — Style/formatting form (label: style)
- `.github/ISSUE_TEMPLATE/help.yml` — Help request form (label: help)
- `.github/ISSUE_TEMPLATE/docs.yml` — Documentation form (label: docs)
- `.github/ISSUE_TEMPLATE/chore.yml` — Maintenance task form (label: chore)
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
- `.claude/settings.json` — Claude Dev settings with 10 agents, hooks, and permissions
- `.claude/commands/implement.md` — Implementation command prompt
- `.claude/commands/refactor.md` — Refactoring command prompt
- `.claude/commands/review-typescript.md` — TypeScript review command prompt
- `.claude/commands/test.md` — Testing command prompt

### Scripts (1 total)
- `scripts/generate-pwa-icons.ts` — PWA icon generation (utility)

### Documentation
- `docs/AGENTIC-INFRASTRUCTURE.md` — This file (automation reference)
- `docs/NX-CAPABILITIES.md` — Nx features, Cloud integration, and capabilities reference
- `docs/INTEGRATIONS.md` — External integrations and setup

---

## Nx Cloud Integration

**Workspace ID**: `6929c006315634b45342f623`
**Dashboard**: https://cloud.nx.app

Features enabled:
- Remote caching for build/test/typecheck
- CI pipeline insights
- Flaky task detection and retry
- Affected command optimization via `nrwl/nx-set-shas`

See `docs/NX-CAPABILITIES.md` for full feature reference.

---

## Schema Infrastructure

The `.github/scripts/schema.ts` file is the core of the automation system, implementing:

### Environment Configuration (env.ts)
Repository-agnostic configuration supporting multiple languages:
- `ENV.lang` — Language selector ('ts' | 'cs')
- `ENV.bundleThresholdKb` — Bundle size threshold
- `CMD` — Language-specific commands (build, lint, test)

### Single B Constant
All configuration in one frozen object with nested domains:
- `B.alerts` — CI/security alert templates
- `B.algo` — Algorithm thresholds (stale days, mutation %)
- `B.api` — GitHub API constants (per_page, states)
- `B.bump` — Version bump mapping (breaking→major, feat→minor)
- `B.dashboard` — Dashboard config (bots, colors, targets, schedule)
- `B.gating` — Auto-merge gate rules and messages
- `B.gen` — Markdown generators (badges, shields, links, callouts, sparklines)
- `B.labels` — Label taxonomy (categories, exempt lists)
- `B.patterns` — Regex patterns for parsing
- `B.probe` — Data collection defaults and GraphQL queries
- `B.pr` — PR title pattern for conventional commits
- `B.release` — Conventional commit mapping
- `B.thresholds` — Validation thresholds (bundle size from ENV)
- `B.time` — Time constants (day in ms)
- `B.typeOrder` — Changelog section ordering
- `B.types` — Commit type definitions (breaking, feat, fix, etc.)

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
- `fn.classify()` — Pattern-based classification
- `fn.classifyDebt()` — Classify CI failures into debt categories
- `fn.classifyGating()` — Classify PRs for auto-merge eligibility
- `fn.filter()` — Apply filter specs to issues
- `fn.report()` — Generate markdown tables
- `fn.diff()` — Calculate size differences
- `fn.size()` — Human-readable byte sizes
- `fn.resolveType()` — Resolve commit type from labels or message

---

## Label Taxonomy

Labels are managed declaratively via `.github/labels.yml` and synced automatically.

### Commit Type Labels (applied by pr-meta, maps to conventional commits)
| Label | Color | Description |
|-------|-------|-------------|
| `fix` | #1a7f37 | Bug fix |
| `feat` | #0969da | New feature |
| `docs` | #0891b2 | Documentation only |
| `style` | #6f42c1 | Formatting, no logic change |
| `refactor` | #dbab09 | Code restructuring without behavior change |
| `test` | #f59e0b | Adding or updating tests |
| `chore` | #a1887f | Maintenance task |
| `perf` | #e16f24 | Performance improvement |

### Issue-Only Type Labels
| Label | Color | Description |
|-------|-------|-------------|
| `help` | #d876e3 | Question or assistance needed |

### Priority (optional, escalation only)
| Label | Color | Description |
|-------|-------|-------------|
| `critical` | #b60205 | Must be addressed immediately |

### Action (what should happen)
| Label | Color | Description |
|-------|-------|-------------|
| `implement` | #8957e5 | Ready for implementation |
| `review` | #e16f24 | Needs review |
| `blocked` | #d73a4a | Cannot proceed |

### Agent Labels (Mutually Exclusive)
| Label | Color | Description |
|-------|-------|-------------|
| `copilot` | #6e7781 | Assign to GitHub Copilot |
| `claude` | #6e7781 | Assign to Claude |
| `gemini` | #6e7781 | Assign to Gemini |
| `codex` | #6e7781 | Assign to OpenAI Codex |

### Lifecycle (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `stale` | #57606a | No recent activity |
| `pinned` | #0d9488 | Exempt from stale |

### Special (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `security` | #d73a4a | Security issue |
| `dependencies` | #0550ae | Dependency updates (bot-applied) |
| `breaking` | #b60205 | Breaking change |
| `dashboard` | #0d9488 | Repository metrics dashboard |

**Total: 22 labels**

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
│                         GitHub Workflows (12)                         │
│  ┌──────────────┐  ┌─────────────────────────────────┐  ┌──────────┐ │
│  │ CI Pipeline  │→│ pr-review.yml                    │←│ Biome    │ │
│  │ (Nx Cloud)   │  │ (compliance + feedback synthesis)│  │ Repair   │ │
│  └──────┬───────┘  └──────────────┬──────────────────┘  └──────────┘ │
│         │                         │                                   │
│         ▼                         ▼                                   │
│  ┌──────────────┐          ┌──────────────┐                          │
│  │ Sys Maint    │          │ AI Maint     │                          │
│  │ (labels+stale│          │ (weekly)     │                          │
│  └──────────────┘          └──────────────┘                          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      Schema Infrastructure (9 scripts)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ env.ts → schema.ts → dashboard.ts, probe.ts, report.ts, ...      ││
│  │ B constant + SpecRegistry + Ops Factory + Mutate Handlers        ││
│  └──────────────────────────────────────────────────────────────────┘│
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (10)              Renovate Auto-Merge
    (type labels applied)              (patch/minor only)
          │                                     │
          ▼                                     ▼
    Issue Created                       Dependency Updates
```

### Data Flow

1. **Issue Creation**: Templates apply type labels (fix, feat, perf, style, test, docs, refactor, chore, help)
2. **PR Lifecycle**: PR opened → Biome Repair → CI (Nx Cloud) → Code Review → Merge
3. **Dependency Flow**: Renovate PR → CI → Auto-Merge (patch/minor) or Block (major/canary)
4. **Dashboard**: Schedule/command → schema.ts → collect metrics → render → update issue

---

## Core Components

### GitHub Scripts

**env.ts** (Environment Config)
Minimal environment-driven configuration for repository-agnostic infrastructure. Provides `ENV` object with `lang` and `bundleThresholdKb`, plus `CMD` dispatch with language-specific build/lint/test commands.

**schema.ts** (Polymorphic Infrastructure)
Complete workflow toolkit providing B constant DSL (alerts, content, gating, generation, labels, patterns, types), SpecRegistry polymorphic type system, `fn` pure functions (classify, body, filter, report, row builders), `ops` GitHub API factory (REST + GraphQL), and `mutate` handlers (comment, issue, label, review, release). All downstream scripts compose these primitives.

**dashboard.ts**
Metrics collector using parallel API calls via `call()`, dispatch table section renderers (badges, activity, ci, health), outputs via `mutate` issue handler. Extensible via dispatch table.

**probe.ts**
Data extraction layer with `handlers` dispatch table for issue/pr/discussion targets. Each handler fetches related data in parallel (reviews, checks, commits, files, comments), normalizes to typed shapes. Also exports `post()` for marker-based comment upsert.

**report.ts**
Config-driven report generator. Pipeline: source dispatch → row builders → format dispatch → output dispatch. Extensible via new config entries.

**release.ts**
Commit analyzer using `B.types` patterns for classification and `B.bump` for version determination. Groups commits via `matchesType()`, generates changelog via `fn.body()` with Section specs, creates releases via `mutate` release handler.

**failure-alert.ts**
Alert creator using `fn.classifyDebt()` for CI failures. Maps job names → debt categories via `B.alerts.ci.rules`. Renders body via `fn.body()` with `B.alerts` templates, upserts issue via `mutate` issue handler.

**gate.ts**
Eligibility gate using `fn.classifyGating()` rules from `B.gating.rules`. Extracts scores from check run summaries via regex, blocks via `mutate` (comment + label), optionally creates migration issues.

**pr-meta.ts**
Title parser using `B.pr.pattern` regex and `B.types` commit-to-label mapping. Validates type exists in map, validates scope, applies labels via `mutate` label handler.

### GitHub Workflows

**ci.yml** (Main Pipeline)
Unified CI workflow with Nx Cloud remote caching. Steps: checkout → node-env → nx graph → nx-setup (cache + shas) → biome check → typecheck affected → build affected → test affected. Creates quality debt issue on failure. Uploads coverage and Nx graph artifacts.

**pr-review.yml** (Consolidated)
Unified PR review: REQUIREMENTS.md compliance + feedback synthesis + /summarize. Three jobs: (1) requirements-review using Claude Opus; (2) synthesize-summary with risk assessment; (3) manual-summarize for /summarize command. Posts comments with marker `<!-- PR-REVIEW-SUMMARY -->`.

**active-qc.yml** (Event-Driven)
PR/push quality control. Jobs: pr-title (validates format, applies labels), sync-labels (on push to labels.yml).

**passive-qc.yml** (Scheduled)
Every 6 hours. Jobs: sync-labels (backup), stale-management (3 days → stale, 10 days → close), aging-report.

**auto-merge.yml**
Dependabot auto-merge. Waits for CI, then auto-merges patch/minor. Major updates blocked with warning.

**biome-repair.yml**
Auto-fixes style issues. Runs `biome check --write --unsafe`, validates with tests. Commits on success, warns on failure.

**dashboard.yml**
Repository health dashboard. Triggered by schedule, workflow_dispatch, or checkbox toggle. Uses dashboard.ts for metrics.

**release.yml**
Native Nx Release workflow with conventional commits. Uses `nx release` with git.push enabled. Analyzes commits: `feat!` → major, `feat` → minor, `fix` → patch. Generates changelog and creates GitHub release. Supports dry-run mode and manual version specifiers.

**bundle-analysis.yml**
Bundle size tracking in PRs. Compares raw/gzip/brotli sizes with main. Warns if >10KB gzip increase.

**security.yml**
Multi-layer scanning: dependency-audit, CodeQL, Gitleaks, license-check. Creates security issue on failure.

**ai-assist.yml**
Claude @mention integration. Uses Claude Opus with 15 max turns. Includes 5 configured agents.

**ai-maintenance.yml**
Weekly maintenance (Monday 9 AM UTC). Reviews stale PRs, checks dependencies, runs quality analysis, triages issues.

### Composite Actions

**.github/actions/node-env/action.yml**
Node.js + pnpm setup with caching. Inputs: node-version (25.2.1), pnpm-version (10.23.0), install, frozen-lockfile.

**.github/actions/git-identity/action.yml**
Git user configuration. Inputs: name, email (defaults to github-actions[bot]).

**.github/actions/nx-setup/action.yml**
Nx affected command setup. Uses nrwl/nx-set-shas for base/head SHA determination. Caching handled by Nx Cloud (configured via NX_CLOUD_ACCESS_TOKEN env var). Outputs: base, head.

### GitHub Templates

Agent-friendly with JSON-parseable structure via `id` attributes.

**bug_report.yml** (label: fix) — description, target, repro_steps, expected_behavior, priority, logs
**feature_request.yml** (label: feat) — description, target, proposed_solution, acceptance_criteria, priority, breaking
**perf.yml** (label: perf) — perf_type, target, current_metrics, target_metrics, analysis, priority
**refactor.yml** (label: refactor) — target, current_pattern, target_pattern, rationale, breaking, test_strategy
**test.yml** (label: test) — test_type, target, test_scope, coverage_target, priority
**docs.yml** (label: docs) — doc_type, target, current_state, proposed_changes, priority
**chore.yml** (label: chore) — chore_type, description, target, acceptance_criteria, priority
**style.yml** (label: style) — style_type, target, description, priority
**help.yml** (label: help) — help_type, question, context, attempted_solutions, relevant_files
**PULL_REQUEST_TEMPLATE.md** — Summary, Related Issues, Changes, Human Review Checklist

### Custom Agent Profiles

Each agent is a specialized staff-level engineer with domain expertise following REQUIREMENTS.md patterns.

**typescript-advanced** — TypeScript 6.0-dev, branded types, Effect/Option pipelines, const generics
**react-specialist** — React 19 canary, Compiler, Server Components, use() hook
**vite-nx-specialist** — Vite 7 Environment API, Nx 22 Crystal, factory patterns
**testing-specialist** — Vitest 4.0, property-based testing, V8 coverage (80%)
**performance-analyst** — Bundle optimization, tree-shaking, code splitting
**refactoring-architect** — Pipeline migration, dispatch tables, B constant consolidation
**library-planner** — Package creation, catalog dependencies, vite.config factories
**integration-specialist** — Workspace consistency, catalog-driven dependencies
**documentation-specialist** — Cross-project docs, 1-line XML comments
**cleanup-specialist** — Algorithmic density (25-30 LOC/feature), complexity ≤25

### Claude Dev Configuration

**.claude/settings.json** includes:
- **10 agents** with specialized prompts
- **Model**: claude-opus-4-5-20251101
- **Permissions**: Allow Read, Write, Edit, Bash(pnpm/nx/git/gh/node), Glob, Grep, Task, WebSearch, WebFetch (approved domains), MCP tools
- **Deny**: Destructive commands (rm -rf, git push --force, git reset --hard)
- **Hooks**: SessionStart displays startup message

**Slash Commands** (4 total):
- `/implement` — Feature implementation with agent selection
- `/refactor` — Code transformation to dogmatic patterns
- `/review-typescript` — REQUIREMENTS.md compliance review
- `/test` — Vitest test creation with Effect/Option patterns

### Configuration Files

**renovate.json** — Domain-grouped dependency updates, platformAutomerge, pnpmDedupe, OSV alerts
**lefthook.yml** — Pre-commit: biome check + effect-check (no try/catch)

---

## Interactive Triggers

- **`/summarize`** — PR Review workflow, synthesizes all feedback
- **`@claude`** — AI Assist workflow, Claude responds to mentions
- **Dashboard checkbox** — Check refresh checkbox on dashboard issue to trigger update

---

## Quality Gates

1. **Pre-commit**: Lefthook runs Biome + Effect pattern validation
2. **PR opened**: Biome Repair auto-fixes, pr-meta.yml validates title + applies labels
3. **CI**: Build, test, typecheck via Nx affected with Nx Cloud caching
4. **Post-CI**: pr-review.yml checks REQUIREMENTS.md compliance
5. **Merge gate**: All checks green, reviews approved, semantic title validated
6. **Dependency gate**: Auto-merge for patch/minor, manual review for major/canary

---

## Key Patterns

- **Effect Pipelines**: All async/failable operations use Effect, no try/catch
- **Option Monads**: All nullable values use Option, no null checks
- **Single B Constant**: All config in one frozen object per file
- **Dispatch Tables**: Replace if/else with type-safe lookup tables
- **Branded Types**: Nominal typing via @effect/schema `S.Brand`
- **Section Separators**: 77-char separators for files >50 LOC
- **SpecRegistry**: Polymorphic type system for config-driven operations
- **Conventional Commits**: PR titles use type(scope): description format
- **Nx Cloud**: Remote caching for faster CI and local development

---

**Last Updated**: 2025-11-28
