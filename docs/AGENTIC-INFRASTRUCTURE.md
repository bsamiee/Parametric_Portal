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
- `.github/labels.yml` — Declarative label definitions with colors (managed by auto-labeler)
- `.github/copilot-instructions.md` — IDE agent instructions

### GitHub Workflows (13 total)
- `.github/workflows/ci.yml` — Main CI pipeline with quality gates
- `.github/workflows/claude-pr-review.yml` — Consolidated PR review: REQUIREMENTS.md compliance + feedback synthesis + /summarize
- `.github/workflows/auto-labeler.yml` — Declarative label sync
- `.github/workflows/issue-lifecycle.yml` — Stale handling, validation
- `.github/workflows/renovate-automerge.yml` — Mutation-gated dependency updates
- `.github/workflows/biome-repair.yml` — Auto-fix style issues before review
- `.github/workflows/semantic-commits.yml` — Enforce conventional commit format
- `.github/workflows/dashboard.yml` — Repository health metrics dashboard
- `.github/workflows/release.yml` — Conventional commit-based releases
- `.github/workflows/bundle-analysis.yml` — Bundle size tracking with PR comments
- `.github/workflows/security.yml` — Multi-layer security scanning
- `.github/workflows/claude.yml` — Claude @mention integration
- `.github/workflows/claude-issues.yml` — claude-implement label automation

### GitHub Composite Actions (1 total)
- `.github/actions/setup/action.yml` — Unified Node.js + pnpm setup with caching (used by all workflows)

### GitHub Templates (10 total)
- `.github/ISSUE_TEMPLATE/config.yml` — Template configuration (blank issues disabled)
- `.github/ISSUE_TEMPLATE/bug_report.yml` — Bug report form (label: bug)
- `.github/ISSUE_TEMPLATE/feature_request.yml` — Feature request form (label: feature)
- `.github/ISSUE_TEMPLATE/enhancement.yml` — Enhancement form (label: enhancement)
- `.github/ISSUE_TEMPLATE/refactor.yml` — Refactor request form (label: refactor)
- `.github/ISSUE_TEMPLATE/optimize.yml` — Optimization form (label: optimize)
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

### Tools (2 tools, 3 files)
- `tools/generate-context/index.ts` — Nx graph extraction and project map generation (328 lines, Effect)
- `tools/generate-context/schema.ts` — @effect/schema definitions for ProjectMap (90 lines)
- `tools/parse-agent-context.ts` — Parse AGENT_CONTEXT from issue/PR bodies (126 lines, Effect)

### Scripts (1 total)
- `scripts/generate-pwa-icons.ts` — PWA icon generation (utility)

### Documentation
- `docs/AUTOMATION.md` — Comprehensive automation guide
- `docs/INTEGRATIONS.md` — External integrations and setup
- `docs/agent-context/README.md` — Project map query protocol
- `docs/agent-context/project-map.json` — Nx graph + public APIs (generated)

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
| `enhancement` | #84b6eb | Improvement to existing feature |
| `optimize` | #0e8a16 | Performance or code optimization |

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

### Exempt (special handling)
| Label | Color | Description |
|-------|-------|-------------|
| `pinned` | #006b75 | Exempt from stale |
| `security` | #8957e5 | Security issue |
| `dependencies` | #0550ae | Dependency updates |

**Total: 19 labels**

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
│                         GitHub Workflows (13)                         │
│  ┌──────────────┐  ┌─────────────────────────────────┐  ┌──────────┐ │
│  │ CI Pipeline  │→│ claude-pr-review.yml             │←│ Biome    │ │
│  │              │  │ (consolidated: review+synthesis) │  │ Repair   │ │
│  └──────┬───────┘  └──────────────┬──────────────────┘  └──────────┘ │
│         │                         │                                   │
│         ▼                         ▼                                   │
│  ┌──────────────┐          ┌──────────────┐                          │
│  │ Label Sync   │          │ Issue        │                          │
│  │              │          │ Lifecycle    │                          │
│  └──────────────┘          └──────────────┘                          │
└────────────────────────────┬─────────────────────────────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          ▼                                     ▼
    GitHub Templates (10)             Renovate Auto-Merge
    (type labels applied)             (mutation-gated)
          │                                     │
          ▼                                     ▼
    Issue Created                       Dependency Updates
```

### Data Flow

1. **Issue Creation**: Templates apply type labels (bug, feature, enhancement, refactor, optimize, help, docs, chore)
2. **Context Gen**: Nx graph → generate-context → project-map.json → Custom Agents
3. **PR Lifecycle**: PR opened → Biome Repair → CI → Code Review → Merge
4. **Dependency Flow**: Renovate PR → CI + Mutation → Auto-Merge gate → Merge/Block

---

## Core Components

### Label Sync

**auto-labeler.yml**
Declarative label management workflow.

**Trigger**: Changes to `.github/labels.yml`

**Behavior**:
- On push to main: Syncs labels to repository (creates, updates, deletes)
- On PR: Dry-run mode (preview changes without applying)

**Action**: Uses `crazy-max/ghaction-github-labeler` to maintain labels as code

### Context Generation

**tools/generate-context/index.ts**
Extracts Nx project graph and package metadata to create structured context for agents. Executes `nx graph --file=.nx/graph.json`, parses project dependencies from Nx graph, extracts public APIs from package.json exports, detects circular dependencies. Outputs `docs/agent-context/project-map.json` with workspace info, projects, graph topology, and import aliases. Used by CI workflow and custom agents for workspace-aware code generation.

**tools/parse-agent-context.ts**
Parses AGENT_CONTEXT JSON blocks from issue and PR template bodies. Extracts metadata like type (bug/feature), scope, agents, patterns, priority, and test coverage requirements. Returns default context when missing/invalid. CLI mode accepts body via stdin, outputs structured JSON for workflow consumption.

### GitHub Workflows

**claude-pr-review.yml** (Consolidated)
Unified PR review workflow combining REQUIREMENTS.md compliance review, AI/CI feedback synthesis, and /summarize command. Three jobs: (1) requirements-review waits for CI, checks compliance patterns (no `any`, no `var`/`let`, no `if`/`else`, no loops, no `try`/`catch`, B constant pattern, dispatch tables), uses Claude Opus 4.5; (2) synthesize-summary collects all reviews and CI status, posts structured summary with risk assessment; (3) manual-summarize handles /summarize slash command. Posts comments with marker `<!-- PR-REVIEW-SUMMARY -->`.

**issue-lifecycle.yml**
Manages stale detection and validation. Daily schedule runs stale detection: 30 days inactive → stale label, 44 days → close. Exemptions: pinned, security, critical labels. Generates aging report in GitHub step summary.

**renovate-automerge.yml**
Mutation-gated auto-merge for dependency updates. Triggered by Renovate PRs, check_suite completion, or 4-hour schedule. Classifies updates: patch/minor (eligible) vs major/canary (blocked). Gate requirements: all checks green + mutation score ≥ 80%. Auto-merges eligible PRs via `gh pr merge --squash --auto`.

**biome-repair.yml**
Auto-fixes style issues before human review. Runs `pnpm biome check --write --unsafe` on PR changes, executes `pnpm test` to verify no semantic breakage. If tests pass: commits "style: biome auto-repair" and pushes. If tests fail: skips commit, adds comment warning of semantic breakage.

**semantic-commits.yml**
Enforces conventional commit format for PR titles. Uses amannn/action-semantic-pull-request to validate type (feat/fix/refactor/style/docs/deps/test/chore), requires scope, validates subject pattern (lowercase, descriptive). Blocks merge on violation. Ignores: bot, dependencies labels.

**dashboard.yml**
Auto-updating repository health dashboard. Triggered by 6-hour schedule, workflow_dispatch, or `/health` command on dashboard issue. Collects metrics: open PRs, merged (7d), stale (>14d); open issues by type; Renovate activity; commit activity; latest release.

**release.yml**
Automated releases based on conventional commits. Triggered by push to main (src paths) or workflow_dispatch. Analyzes commits for release type: `feat!` → major, `feat` → minor, `fix` → patch. Generates changelog grouped by Breaking, Features, Fixes, Refactoring, Docs.

**bundle-analysis.yml**
Tracks bundle size changes in PRs. Builds all packages, analyzes sizes (raw, gzip, brotli), compares with main branch. Posts/updates PR comment with size report, warns if significant increase (>10KB gzip).

**security.yml**
Multi-layer security scanning. Jobs: dependency-audit (`pnpm audit`), CodeQL (JavaScript/TypeScript analysis), secrets-scan (Gitleaks), license-check (copyleft detection). Creates security issue if critical vulnerabilities found.

### Composite Actions

**.github/actions/setup/action.yml**
Unified Node.js + pnpm setup with caching. Eliminates duplication across all workflows. Inputs: `node-version` (default: 25.2.1), `pnpm-version` (default: 10.23.0), `install-dependencies` (default: true). Steps: (1) pnpm/action-setup for package manager, (2) actions/setup-node with pnpm cache, (3) conditional `pnpm install --frozen-lockfile`. All workflows reference via `uses: ./.github/actions/setup`.

### GitHub Templates

All issue templates are agent-friendly with JSON-parseable structure. Each field has an `id` attribute that becomes the JSON key when parsed by [github/issue-parser](https://github.com/github/issue-parser) or [issue-ops/parser](https://github.com/issue-ops/parser). Templates include embedded `AGENT_CONTEXT` metadata for agent routing.

**bug_report.yml** (label: bug)
Fields: description, repro_steps, expected_behavior, actual_behavior, severity (dropdown), scope (multi-select), environment (yaml), logs (shell), affected_packages. AGENT_CONTEXT routes to testing-specialist and typescript-advanced agents.

**feature_request.yml** (label: feature)
Fields: problem_statement, proposed_solution, alternatives_considered, scope (multi-select), effort_estimate (dropdown), acceptance_criteria, required_patterns (checkboxes), breaking_change. AGENT_CONTEXT routes to library-planner and typescript-advanced agents.

**enhancement.yml** (label: enhancement)
Fields: current_behavior, improved_behavior, rationale, scope (multi-select), target_files, acceptance_criteria, breaking_change, required_patterns (checkboxes). AGENT_CONTEXT routes to refactoring-architect and typescript-advanced agents.

**refactor.yml** (label: refactor)
Fields: target_files, current_pattern, target_pattern, rationale, scope (multi-select), breaking_change, test_strategy, target_patterns (checkboxes). AGENT_CONTEXT routes to refactoring-architect, cleanup-specialist, and typescript-advanced agents.

**optimize.yml** (label: optimize)
Fields: optimization_type (dropdown), target_area, current_metrics (yaml), target_metrics (yaml), proposed_approach, scope (multi-select), acceptance_criteria, breaking_change. AGENT_CONTEXT routes to performance-analyst and cleanup-specialist agents.

**help.yml** (label: help)
Fields: help_category (dropdown), question, context, attempted_solutions, relevant_files, urgency (dropdown), scope (multi-select). AGENT_CONTEXT routes to documentation-specialist and typescript-advanced agents.

**docs.yml** (label: docs)
Fields: documentation_type (dropdown), target_file, current_content, proposed_content, rationale, scope (multi-select), related_files (checkboxes). AGENT_CONTEXT routes to documentation-specialist agent.

**chore.yml** (label: chore)
Fields: chore_type (dropdown), description, target_files, scope (multi-select), acceptance_criteria, breaking_change, urgency (dropdown). AGENT_CONTEXT routes to cleanup-specialist and integration-specialist agents.

**PULL_REQUEST_TEMPLATE.md**
PR template with checklist. Includes Claude Code review trigger: `@claude Please review against REQUIREMENTS.md patterns`. Checklist validates: pnpm check/typecheck/test passes, Effect patterns used, B constant followed, tests added.

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

## Slash Commands

Two on-demand workflow triggers via issue/PR comments:

- **`/summarize`** — PR Review workflow, synthesizes all feedback
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

**Last Updated**: 2025-11-26
