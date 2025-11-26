# Agentic Monorepo Automation Implementation

> **Execution Target**: Claude Code CLI (`claude` command)
> **Estimated Turns**: 30-50
> **Model**: claude-opus-4-5-20251101

## Context

This document contains instructions for Claude Code to implement comprehensive agentic automation for a TypeScript monorepo. The repo already has:

- Nx 22 (canary) monorepo structure
- pnpm workspace with catalog
- Biome for linting/formatting
- Vitest for testing
- Stryker for mutation testing
- Lefthook for git hooks
- Renovate for dependency updates
- Multiple AI reviewers: Copilot, Codex, Gemini (GitHub apps)
- Claude Code workflows for @claude mentions, PR review, issue implementation, maintenance

## Objectives

Implement the following 4 primary features plus supporting infrastructure:

1. **PR Review Aggregation** - Synthesize all AI reviews into a single summary comment
2. **Intelligent Auto-Labeling** - Path-based PR labels + AI-powered issue classification
3. **Renovate Auto-Merge** - Enhanced config + workflow for safe automatic merging
4. **Repository Dashboard** - Auto-updating pinned issue with repo health/status

---

## Execution Instructions

### Phase 1: Repository Analysis

```task
1. Examine the current repository structure:
   - List all files in .github/workflows/
   - Read existing workflow files to understand patterns
   - Check for existing labeler.yml, renovate.json
   - Identify package structure (apps/, packages/)
   - Read REQUIREMENTS.md if present for coding standards

2. Document findings:
   - Current workflow naming conventions
   - Action version pinning style (SHA vs tag)
   - Node.js and pnpm versions used
   - Existing labels in the repository
   - Branch protection settings
```

### Phase 2: PR Review Aggregator

Create `.github/workflows/pr-review-aggregator.yml`:

```yaml
# Requirements:
# - Trigger after Claude Code Review and CI workflows complete
# - Also trigger on pull_request_review (to catch Copilot/Codex/Gemini)
# - Collect all reviews from: claude[bot], copilot[bot], github-actions[bot], and any *[bot] accounts
# - Collect all check run statuses
# - Collect review comments grouped by file
# - Generate structured summary with:
#   - PR metrics (files changed, additions, deletions)
#   - CI status table
#   - AI review summaries (collapsible per reviewer)
#   - Human review status
#   - Review comments count by file
#   - Merge readiness assessment
# - Post as comment with marker: <!-- PR-AGGREGATOR-SUMMARY -->
# - Update existing comment if present (don't create duplicates)
# - Use concurrency group per PR number
# - Permissions: contents:read, pull-requests:write, issues:read, actions:read, checks:read
```

### Phase 3: Intelligent Auto-Labeling

Create `.github/workflows/auto-labeler.yml`:

```yaml
# Requirements:
# - On pull_request: [opened, synchronize, reopened]
#   - Apply path-based labels using actions/labeler
#   - Apply size labels (XS <10, S <50, M <200, L <500, XL >500)
#   - Welcome first-time contributors
# - On issues: [opened, edited]
#   - Use Claude to classify issue and apply labels
#   - Available label categories:
#     - Type: type/bug, type/feature, type/enhancement, type/docs, type/refactor, type/test, type/chore
#     - Priority: priority/critical, priority/high, priority/medium, priority/low
#     - Scope: scope/ui, scope/api, scope/config, scope/deps, scope/perf, scope/security
#     - Effort: effort/trivial, effort/small, effort/medium, effort/large
#     - Special: good-first-issue, help-wanted, claude-implement
#   - Claude should be conservative, only apply confident labels
#   - Use claude-sonnet-4-5-20250929 for cost efficiency
```

Create `.github/labeler.yml`:

```yaml
# Requirements:
# - Map paths to labels based on actual repo structure
# - Include patterns for:
#   - Package-specific labels (pkg/core, pkg/ui, etc. based on packages/ contents)
#   - App labels based on apps/ contents
#   - scope/config for *.json, *.yaml, *.yml, .github/**
#   - scope/ci for .github/workflows/**
#   - scope/deps for package.json, pnpm-lock.yaml, pnpm-workspace.yaml
#   - scope/docs for **/*.md, docs/**
#   - scope/tests for **/*.spec.ts, **/*.test.ts, vitest.config.*
#   - scope/types for **/*.d.ts
#   - scope/ui for **/*.tsx, **/components/**
#   - tech/react for **/*.tsx
#   - tech/effect for Effect-related files
#   - tech/vite for vite.config.*
```

### Phase 4: Renovate Enhancement

Update `renovate.json` (merge with existing):

```json
{
  // Add these settings:
  "platformAutomerge": true,
  "automergeType": "pr",
  "automergeStrategy": "squash",
  "dependencyDashboard": true,
  "dependencyDashboardTitle": "📦 Dependency Dashboard",
  "osvVulnerabilityAlerts": true,
  "postUpdateOptions": ["pnpmDedupe"],
  
  // Ensure these packageRules exist:
  // - Automerge all patches immediately
  // - Automerge minor for stable (non-0.x) deps
  // - Automerge @types/** grouped
  // - Automerge github-actions grouped
  // - Manual review for: major, typescript nightly, react canary, nx canary, biome
  // - Group: effect-ecosystem, vite-ecosystem, tanstack, radix-ui, styling
  // - Security updates: automerge at any time, priority/critical label
}
```

Create `.github/workflows/renovate-automerge.yml`:

```yaml
# Requirements:
# - Triggers: check_suite completed, workflow_run CI completed, schedule every 4 hours
# - Find open Renovate PRs eligible for automerge:
#   - Has automerge label OR
#   - Title matches patch pattern OR
#   - Title matches @types/ pattern
# - For each eligible PR:
#   - Verify all status checks passed
#   - Verify mergeable state is CLEAN or HAS_HOOKS
#   - Attempt gh pr merge --squash --auto
#   - Fall back to direct merge if auto fails
# - Generate step summary with Renovate PR status table
```

### Phase 5: Repository Dashboard

Create `.github/workflows/dashboard.yml`:

```yaml
# Requirements:
# - Triggers: schedule every 6 hours, workflow_dispatch, push to main
# - Collect metrics:
#   - Open PRs, merged in 7 days, stale PRs (>14 days)
#   - Open issues by type (bugs, features, claude-ready)
#   - Renovate PRs (open, merged in 7 days)
#   - Commit activity (7 days), contributors (7 days)
#   - Latest tag/release
#   - Run pnpm typecheck and pnpm check for health status
#   - Package count, TypeScript LOC
# - Find or create issue with label "dashboard" and title containing "Repository Dashboard"
# - Update issue body with structured dashboard:
#   - Quick Stats table
#   - Activity (7 days) table
#   - Pull Requests table with links
#   - Issues table with links
#   - Health Status with badges
#   - AI Agents Status
#   - Workflows table
#   - Quick Actions in collapsible
#   - Timestamp
```

### Phase 6: Issue Lifecycle Management

Create `.github/workflows/issue-lifecycle.yml`:

```yaml
# Requirements:
# - Stale management (schedule daily):
#   - Issues: stale after 30 days, close after 14 more
#   - PRs: stale after 21 days, close after 7 more
#   - Exempt labels: pinned, security, priority/critical, in-progress, claude-implement
#   - Use actions/stale
# - Auto-close linked issues (on PR merge):
#   - Parse PR body for Fixes/Closes/Resolves #N
#   - Close referenced issues with comment
# - Validate new issues:
#   - Check for empty body
#   - Check title length
#   - Suggest bug report format if title contains bug/error/broken
# - Aging report (schedule):
#   - List issues >30 days old
#   - List PRs >14 days old
#   - Output to step summary
```

### Phase 7: Supporting Workflows

Create `.github/workflows/release.yml`:

```yaml
# Requirements:
# - Trigger on push to main (paths: packages/*/src/**, apps/*/src/**)
# - Trigger on workflow_dispatch with release_type choice and dry_run option
# - Analyze commits for release type (conventional commits):
#   - feat!: or BREAKING CHANGE → major
#   - feat: → minor
#   - fix: → patch
# - Calculate new version from package.json
# - Generate changelog grouped by:
#   - Breaking Changes, Features, Bug Fixes, Refactoring, Documentation
# - Create git tag and GitHub release
# - Optionally use Claude to enhance release notes
```

Create `.github/workflows/bundle-analysis.yml`:

```yaml
# Requirements:
# - Trigger on PR to main (source paths)
# - Build all packages
# - Analyze bundle sizes (raw, gzip, brotli)
# - Compare with main branch (cached metrics)
# - Post/update PR comment with size report
# - Warn if significant increase (>10KB gzip)
```

Create `.github/workflows/security.yml`:

```yaml
# Requirements:
# - Trigger on PR, push to main, weekly schedule
# - Jobs:
#   - dependency-audit: pnpm audit, parse vulnerabilities
#   - codeql: JavaScript/TypeScript analysis
#   - secrets-scan: Gitleaks
#   - license-check: Check for copyleft licenses
# - Create security issue if critical vulnerabilities found
```

### Phase 8: Templates

Create `.github/PULL_REQUEST_TEMPLATE.md`:

```markdown
# Requirements:
# - Description section
# - Type of change checkboxes (bug fix, feature, breaking, docs, refactor, test, config, deps)
# - Related issues section with "Fixes #" prompt
# - Code quality checklist referencing REQUIREMENTS.md patterns
# - Testing checklist
# - Documentation checklist
# - Screenshots section
# - Hidden comment for AI reviewers: <!-- @claude Please review against REQUIREMENTS.md -->
```

Create `.github/ISSUE_TEMPLATE/bug_report.yml`:

```yaml
# Requirements:
# - Form-based template
# - Fields: description, reproduction steps, expected, actual, severity dropdown, environment, logs, context
# - Checklist with required "searched existing issues"
# - Tip about claude-implement label
# - Default labels: type/bug, needs-triage
```

Create `.github/ISSUE_TEMPLATE/feature_request.yml`:

```yaml
# Requirements:
# - Form-based template
# - Fields: problem statement, proposed solution, alternatives, scope dropdown (multi), effort dropdown, acceptance criteria, context
# - Automation checkboxes for Claude implementation
# - Default labels: type/feature, needs-triage
```

Create `.github/ISSUE_TEMPLATE/config.yml`:

```yaml
# Requirements:
# - blank_issues_enabled: true
# - Contact links for: Ask Claude, Documentation, Discussions
```

### Phase 9: Documentation

Create `docs/AUTOMATION.md`:

```markdown
# Requirements:
# - Table of contents
# - AI Agents section with table of all agents, roles, triggers
# - Workflow overview with ASCII diagram
# - PR Lifecycle explanation
# - Issue Management explanation
# - Dependency Management explanation
# - Security & Quality explanation
# - Dashboard explanation
# - Configuration files reference
# - Labels quick reference
# - Commands quick reference
```

Create `docs/INTEGRATIONS.md`:

```markdown
# Requirements:
# - GitHub Apps recommendations (Codecov, GitGuardian, Socket.dev, Snyk, ImgBot)
# - Branch protection rules configuration
# - Repository settings recommendations
# - CODEOWNERS template
# - README badges
# - GitHub API/GraphQL examples
# - Cost considerations
```

### Phase 10: Enhanced Claude Review

Create `.github/workflows/claude-code-review-enhanced.yml`:

```yaml
# Requirements:
# - Wait for CI to complete before reviewing
# - Collect CI status, changed files, other reviews
# - Claude review prompt should:
#   - Read REQUIREMENTS.md
#   - Check compliance (no any, no var/let, no if/else, no loops, no try/catch, section separators)
#   - Review architecture (Effect/Option, B constant, dispatch tables)
#   - Assess quality (clarity, tests, performance, security)
#   - Consider other reviewers' feedback (don't repeat, validate or dispute)
#   - Output structured review with compliance table
# - Use claude-opus-4-5-20251101 for deep review
# - Trigger aggregator workflow after completion
```

### Phase 11: Verification & Cleanup

```task
1. Verify all workflows have:
   - Pinned action versions (SHA format for third-party)
   - Appropriate concurrency groups
   - Minimal required permissions
   - Consistent Node.js and pnpm versions matching existing workflows

2. Ensure labels exist:
   - Create any missing labels referenced in workflows
   - Use gh label create command

3. Test workflows:
   - Syntax validation: actionlint if available, or yamllint
   - Dry-run where possible

4. Update CLAUDE.md if it exists:
   - Document new workflows
   - Document new labels
   - Document automation capabilities

5. Commit message format:
   - Use conventional commits
   - feat(ci): add PR review aggregation workflow
   - feat(ci): add intelligent auto-labeling
   - etc.
```

---

## Execution Command

Run this with Claude Code:

```bash
claude --model claude-opus-4-5-20251101 \
  --max-turns 50 \
  --allowedTools Read,Write,Edit,Bash,Glob,Grep \
  "Read IMPLEMENT-AGENTIC-AUTOMATION.md and execute all instructions. 
   Start with Phase 1 repository analysis, then proceed through each phase.
   Create all workflows, configurations, and documentation as specified.
   Verify everything works together. Commit changes with conventional commit messages."
```

Or in an interactive session:

```
@claude Read IMPLEMENT-AGENTIC-AUTOMATION.md and implement all the agentic automation infrastructure for this monorepo. Start with Phase 1.
```

---

## Success Criteria

After execution, the repository should have:

- [ ] 9 new/enhanced workflow files in `.github/workflows/`
- [ ] `.github/labeler.yml` with path mappings
- [ ] Enhanced `renovate.json` with automerge settings
- [ ] PR template in `.github/PULL_REQUEST_TEMPLATE.md`
- [ ] 3 issue templates in `.github/ISSUE_TEMPLATE/`
- [ ] Documentation in `docs/AUTOMATION.md` and `docs/INTEGRATIONS.md`
- [ ] All referenced labels created
- [ ] Dashboard issue created and populated
- [ ] All workflows passing syntax validation

---

## Customization Points

Claude should adapt the following based on repository analysis:

1. **Package labels** - Generate from actual `packages/` and `apps/` directory names
2. **Node.js version** - Match existing workflows
3. **pnpm version** - Match existing workflows
4. **Action SHAs** - Use latest stable SHAs for new actions
5. **Existing labels** - Preserve and extend, don't duplicate
6. **REQUIREMENTS.md patterns** - Reference actual patterns if file exists
7. **Concurrency patterns** - Match existing workflow style

---

## Rollback Instructions

If needed, revert with:

```bash
git revert HEAD~N  # where N is number of commits made
# or
git reset --hard origin/main
```

---

## Notes for Claude

- Prefer creating new files over modifying existing workflows (except renovate.json)
- Use the same action version pinning style as existing workflows
- Test each workflow file with `gh workflow list` after creation
- Create labels before workflows that reference them
- The repository owner has Claude Code OAuth token already configured as `CLAUDE_CODE_OAUTH_TOKEN`
- Existing AI reviewers (Copilot, Codex, Gemini) are GitHub Apps, not workflows
- Be thorough in Phase 1 - understanding the repo structure is critical
- Ask clarifying questions if critical information is missing