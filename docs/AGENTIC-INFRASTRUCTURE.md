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
- `.github/workflows/ci.yml` — Main CI pipeline with quality gates
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

### GitHub Scripts (8 total)
Composable infrastructure scripts using schema.ts polymorphic toolkit:

- `.github/scripts/schema.ts` — Polymorphic workflow infrastructure (B constant DSL, SpecRegistry, ops factory, mutate)
- `.github/scripts/dashboard.ts` — Metrics collector with dispatch table section renderers
- `.github/scripts/probe.ts` — Data extraction layer with target-type dispatch (issue/pr/discussion)
- `.github/scripts/report.ts` — Config-driven report generator (source→format→output pipeline)
- `.github/scripts/release.ts` — Commit analyzer using B.types classification
- `.github/scripts/failure-alert.ts` — Alert creator using fn.classifyDebt and B.alerts
- `.github/scripts/gate.ts` — Eligibility gate using fn.classifyGating rules
- `.github/scripts/pr-meta.ts` — Title parser using B.pr.pattern and B.types mapping

### GitHub Composite Actions (3 total)
- `.github/actions/node-env/action.yml` — Node.js + pnpm setup with caching (used by all workflows)
- `.github/actions/git-identity/action.yml` — Git user configuration for commits
- `.github/actions/nx-cache/action.yml` — Universal Nx caching and affected command setup

### GitHub Templates (9 total)
- `.github/ISSUE_TEMPLATE/config.yml` — Template configuration (blank issues disabled)
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Bug report form (label: bug)
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form (label: feature)
- `.github/ISSUE_TEMPLATE/enhancement.yml` — Enhancement form (label: enhancement)
- `.github/ISSUE_TEMPLATE/refactor.yml` — Refactor request form (label: refactor)
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
- `B.labels` — Label taxonomy (categories, exempt lists)
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

### Type (required, single per issue)
| Label | Color | Description |
|-------|-------|-------------|
| `bug` | #d73a4a | Something isn't working |
| `feature` | #a2eeef | New feature request |
| `docs` | #0075ca | Documentation only |
| `chore` | #d4a373 | Maintenance task |
| `refactor` | #fbca04 | Code restructuring without behavior change |
| `help` | #d876e3 | Question or assistance needed |

### Priority (optional, escalation only)
| Label | Color | Description |
|-------|-------|-------------|
| `critical` | #b60205 | Must be addressed immediately |

### Action (what should happen)
| Label | Color | Description |
|-------|-------|-------------|
| `implement` | #7057ff | Ready for implementation |
| `review` | #e99695 | Needs review |
| `blocked` | #b60205 | Cannot proceed |

### Provider (who handles - mutually exclusive)
| Label | Color | Description |
|-------|-------|-------------|
| `copilot` | #8b949e | Assign to GitHub Copilot |
| `claude` | #8b949e | Assign to Claude |
| `gemini` | #8b949e | Assign to Gemini |
| `codex` | #8b949e | Assign to OpenAI Codex |

### Lifecycle (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `stale` | #57606a | No recent activity |
| `pinned` | #006b75 | Exempt from stale |

### Special (system-managed)
| Label | Color | Description |
|-------|-------|-------------|
| `security` | #8957e5 | Security issue |
| `dependencies` | #0550ae | Dependency updates |
| `breaking` | #b60205 | Breaking change |
| `dashboard` | #006b75 | Repository health dashboard |

**Total: 21 labels**

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
│  │              │  │ (compliance + feedback synthesis)│  │ Repair   │ │
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
│                      Schema Infrastructure (8 scripts)                │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ schema.ts → dashboard.ts, probe.ts, report.ts, release.ts, ...  ││
│  │ B constant + SpecRegistry + Ops Factory + Mutate Handlers        ││
│  └──────────────────────────────────────────────────────────────────┘│
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (9)              Renovate Auto-Merge
    (type labels applied)             (mutation-gated)
          │                                     │
          ▼                                     ▼
    Issue Created                       Dependency Updates
```

### Data Flow

1. **Issue Creation**: Templates apply type labels (fix, feat, perf, style, test, docs, refactor, chore, help)
2. **PR Lifecycle**: PR opened → Biome Repair → CI → Code Review → Merge
3. **Dependency Flow**: Renovate PR → CI + Mutation → Auto-Merge gate → Merge/Block
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

**release.ts**
Commit analyzer using `B.types` patterns for classification and `B.bump` for version determination. Groups commits via `matchesType()`, generates changelog via `fn.body()` with Section specs, creates releases via `mutate` release handler.

**failure-alert.ts**
Alert creator using `fn.classifyDebt()` for CI failures (maps job names → debt categories via `B.alerts.ci.rules`). Renders body via `fn.body()` with `B.alerts` templates, upserts issue via `mutate` issue handler.

**gate.ts**
Eligibility gate using `fn.classifyGating()` rules from `B.gating.rules`. Extracts scores from check run summaries via regex, blocks via `mutate` (comment + label), optionally creates migration issues. The gating logic is rule-driven and extensible.

**pr-meta.ts**
Title parser using `B.pr.pattern` regex and `B.types` commit-to-label mapping (`commitToLabel` derived map). Validates type exists in map, validates scope against `B.pr.scopes`, applies labels via `mutate` label handler.

### GitHub Workflows

**pr-review.yml** (Consolidated)
Unified PR review workflow combining REQUIREMENTS.md compliance review, AI/CI feedback synthesis, and /summarize command. Three jobs: (1) requirements-review waits for CI, checks compliance patterns (no `any`, no `var`/`let`, no `if`/`else`, no loops, no `try`/`catch`, B constant pattern, dispatch tables), uses Claude Opus 4.5; (2) synthesize-summary collects all reviews and CI status, posts structured summary with risk assessment; (3) manual-summarize handles /summarize slash command. Posts comments with marker `<!-- PR-REVIEW-SUMMARY -->`.

**active-qc.yml** (Event-Driven)
Event-driven quality control for PR/push events.

**Triggers**: `pull_request` (opened, edited, synchronize) or `push` to main (labels.yml only)

Jobs:
1. **pr-title**: Validates PR title format, applies type labels via pr-meta.ts.
2. **sync-labels**: Syncs labels to repository via `crazy-max/ghaction-github-labeler` on push.

**passive-qc.yml** (Scheduled)
Scheduled quality control running every 6 hours.

**Triggers**: Schedule only (every 6 hours)

Jobs:
1. **sync-labels**: Backup label sync as safety net.
2. **stale-management**: 3 days inactive → stale label, then 7 more days → close (10 days total). Exemptions: pinned, security, critical.
3. **aging-report**: Generates issue metrics report (critical, stale, >3 days, total).

**dependency-gate.yml**
Mutation-gated auto-merge for dependency updates. Triggered by Renovate PRs or check_suite completion. Uses gate.ts to classify updates: patch/minor (eligible) vs major/canary (blocked). Gate requirements: all CI checks green + mutation score ≥ 80%. Auto-merges eligible PRs via `gh pr merge --squash --auto`.

**biome-repair.yml**
Auto-fixes style issues before human review. Runs `pnpm biome check --write --unsafe` on PR changes, executes `pnpm test` to verify no semantic breakage. If tests pass: commits "style: biome auto-repair" and pushes. If tests fail: skips commit, adds comment warning of semantic breakage.

**dashboard.yml**
Auto-updating repository health dashboard. Triggered by 6-hour schedule, workflow_dispatch, or checkbox toggle on dashboard issue (Renovate-style `<!-- dashboard-refresh -->` marker). Uses dashboard.ts script to collect metrics and render clickable badges. Excludes skipped/cancelled workflow runs from success rate calculation.

**release.yml**
Automated releases based on conventional commits. Triggered by push to main (src paths) or workflow_dispatch. Analyzes commits for release type: `feat!` → major, `feat` → minor, `fix` → patch. Generates changelog grouped by Breaking, Features, Fixes, Refactoring, Docs.

**bundle-analysis.yml**
Tracks bundle size changes in PRs. Builds all packages, analyzes sizes (raw, gzip, brotli), compares with main branch. Posts/updates PR comment with size report, warns if significant increase (>10KB gzip).

**security.yml**
Multi-layer security scanning. Jobs: dependency-audit (`pnpm audit`), CodeQL (JavaScript/TypeScript analysis), secrets-scan (Gitleaks), license-check (copyleft detection). Creates security issue if critical vulnerabilities found.

### Composite Actions

**.github/actions/node-env/action.yml**
Node.js + pnpm setup with caching. Eliminates duplication across all workflows. Inputs: `node-version` (default: 25.2.1), `node-version-file` (optional), `pnpm-version` (default: 10.23.0), `install` (default: true), `frozen-lockfile` (default: true). Steps: (1) pnpm/action-setup for package manager, (2) actions/setup-node with pnpm cache, (3) conditional `pnpm install --frozen-lockfile`. All workflows reference via `uses: ./.github/actions/node-env`.

**.github/actions/git-identity/action.yml**
Configure git user for commits. Inputs: `name` (default: github-actions[bot]), `email` (default: github-actions[bot]@users.noreply.github.com). Used by release, biome-repair, and other workflows that commit changes.

**.github/actions/nx-cache/action.yml**
Universal Nx monorepo caching and affected command setup. Provides: (1) local cache via GitHub Actions cache for `.nx/cache`, (2) optional Nx Cloud remote caching via `cloud-access-token`, (3) automatic base/head SHA detection via `nrwl/nx-set-shas`. Outputs: `cache-hit`, `base`, `head`. Sets `NX_BASE` and `NX_HEAD` environment variables so `nx affected` commands work without explicit flags.

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

**style.yml** (label: style)
Fields: style_type (dropdown), target, description, priority (dropdown).

**help.yml** (label: help)
Fields: help_type (dropdown), question, context, attempted_solutions, relevant_files.

**PULL_REQUEST_TEMPLATE.md**
PR template with Summary, Related Issues, Changes, and Human Review Checklist sections. Includes expandable "Automated Checks" section listing CI status checks (quality, PR Metadata, requirements-review). Human checklist covers: tests for new behavior, documentation updates, complexity concerns. All automated checks enforced via GitHub Rulesets.

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

On-demand workflow triggers via comments and checkboxes:

- **`/summarize`** — PR Review workflow, synthesizes all feedback (PR comments)
- **Dashboard checkbox** — Check the refresh checkbox on dashboard issue footer to trigger update

---

## Quality Gates

1. **Pre-commit**: Lefthook runs Biome + Effect pattern validation
2. **PR opened**: Biome Repair auto-fixes style, pr-meta.yml validates title + applies labels
3. **CI**: Build, test, typecheck via Nx affected
4. **Post-CI**: claude-pr-review.yml checks REQUIREMENTS.md compliance
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
- **SpecRegistry**: Polymorphic type system for config-driven operations

---

**Last Updated**: 2025-11-28
