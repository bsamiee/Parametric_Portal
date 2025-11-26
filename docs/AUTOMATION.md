# Automation Reference

Comprehensive guide to the agentic automation systems in Parametric Portal.

## AI Agents

| Agent | Role | Trigger | Model | Workflow |
|-------|------|---------|-------|----------|
| **PR Review Aggregator** | Synthesize all AI/CI feedback | workflow_run, pull_request_review, /summarize | Claude Sonnet 4.5 | pr-review-aggregator.yml |
| **Auto-Labeler** | Path-based + AI classification | pull_request, issues, /triage | Claude Sonnet 4.5 | auto-labeler.yml |
| **Issue Lifecycle** | Triage, stale handling, validation | issues, schedule | - | issue-lifecycle.yml |
| **Code Review Enhanced** | REQUIREMENTS.md compliance | pull_request (after CI) | Claude Opus 4.5 | claude-code-review-enhanced.yml |
| **Renovate Auto-Merge** | Mutation-gated dependency updates | pull_request, check_suite | - | renovate-automerge.yml |
| **Biome Repair** | Auto-fix style issues | pull_request | - | biome-repair.yml |
| **Dashboard** | Repository health metrics | schedule, /health | - | dashboard.yml |
| **Release** | Conventional commit releases | push to main | - | release.yml |
| **Bundle Analysis** | Bundle size tracking | pull_request | - | bundle-analysis.yml |
| **Security** | Multi-layer security scanning | pull_request, push, schedule | - | security.yml |

## Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Events                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐│
│  │ PR Open  │  │ Issue    │  │ Push     │  │ Schedule │  │ Comment││
│  │          │  │ Created  │  │ to Main  │  │          │  │        ││
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘│
│       │             │             │             │             │     │
└───────┼─────────────┼─────────────┼─────────────┼─────────────┼─────┘
        │             │             │             │             │
        ▼             ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Workflow Orchestration                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐│
│  │ CI Pipeline │  │ PR Review   │  │ Issue Triage│  │ Renovate    ││
│  │             │  │ Aggregator  │  │             │  │ Auto-Merge  ││
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘│
│         │                │                │                │        │
│         └────────────────┴────────────────┴────────────────┘        │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Quality Gates                              │  │
│  │  • Biome Repair  • Semantic Commits  • Effect Patterns       │  │
│  │  • Bundle Size   • Security Scan     • Mutation Testing      │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Outcomes                                   │  │
│  │  • Auto-merged PRs  • Security Issues  • Quality Debt Issues │  │
│  │  • Release Tags     • Dashboard Update • PR Comments         │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Slash Commands

Slash commands provide on-demand workflow triggers via issue/PR comments.

### `/summarize` - PR Review Synthesis

**Usage**: Comment `/summarize` on any pull request

**Effect**: 
- Collects all reviews from claude[bot], copilot[bot], github-actions[bot], and humans
- Gathers CI check statuses
- Synthesizes into structured summary with risk assessment
- Posts/updates comment with marker `<!-- PR-AGGREGATOR-SUMMARY -->`

**Output Structure**:
```markdown
## Overall Assessment
- Risk: LOW|MEDIUM|HIGH
- Merge readiness: BLOCKED|CAUTION|SAFE

## Required Actions (blocking)
- ...

## Quality Signals (CI, tests, mutation)
- ...

## Nits (non-blocking)
- ...

## Agent Provenance
- ...
```

**Model**: Claude Sonnet 4.5

---

### `/triage` - Issue/PR Classification

**Usage**: Comment `/triage` on any issue or pull request

**Effect**:
- **On PR**: Re-applies path labels, tech labels (react/effect/vite), size labels (XS/S/M/L/XL)
- **On Issue**: AI classifies into type/*, priority/*, scope/*, effort/* categories
- Conservative labeling: only confident classifications applied

**Path Labels**:
- `pkg/components` → packages/components/**
- `pkg/theme` → packages/theme/**
- `pkg/types` → packages/types/**
- `scope/config` → *.json, *.yaml, .github/**
- `scope/ci` → .github/workflows/**
- `scope/deps` → package.json, pnpm-lock.yaml
- `scope/docs` → **/*.md, docs/**
- `scope/tests` → **/*.spec.ts, **/*.test.ts
- `scope/ui` → **/*.tsx, **/components/**

**Tech Labels** (content-based):
- `tech/react` → *.tsx files
- `tech/effect` → Effect. or pipe( in diff
- `tech/vite` → vite.config.* files

**Model**: Claude Sonnet 4.5

---

### `/health` - Dashboard Refresh

**Usage**: Comment `/health` on the pinned dashboard issue (label: `dashboard`)

**Effect**:
- Runs health checks: `pnpm typecheck` + `pnpm check`
- Collects metrics: PRs, issues, commits, contributors, Renovate activity
- Updates dashboard issue with structured markdown report
- Includes workflow status badges

**Dashboard Sections**:
- 🎯 Quick Stats
- 📈 Activity (Last 7 Days)
- 🔧 Pull Requests
- 🐛 Issues
- ✅ Health Status
- 🔄 Workflows

---

## PR Lifecycle

```
1. PR Opened
   ├─► Auto-labeler (path + tech labels)
   ├─► Biome Repair (auto-fix style)
   ├─► Semantic Commits (validate title)
   ├─► CI Pipeline (build/test/typecheck)
   └─► Bundle Analysis (compare sizes)

2. CI Complete
   ├─► Code Review Enhanced (REQUIREMENTS.md compliance)
   └─► PR Review Aggregator (synthesize feedback)

3. Ready to Merge
   ├─► All checks green
   ├─► Reviews approved
   ├─► Semantic title validated
   └─► (If Renovate) Auto-merge gate checks mutation score

4. Merged
   ├─► Release workflow (if main branch)
   └─► Dashboard update
```

## Issue Management

```
1. Issue Opened
   ├─► Parse AGENT_CONTEXT from body
   ├─► Auto-label based on context
   └─► First-time contributor welcome

2. Stale Detection (Schedule: Daily)
   ├─► 30 days inactive → stale label
   ├─► 44 days inactive → close
   └─► Exempt: pinned, security, critical, claude-implement, in-progress

3. Issue Lifecycle
   ├─► Validate format (empty body, title length)
   ├─► Suggest bug/feature templates
   └─► Aging report in step summary
```

## Dependency Management

### Renovate Strategy

**Domain Grouping**:
- `effect-ecosystem`: Effect + @effect/*, schedule Monday 6am
- `vite-ecosystem`: Vite + Vitest + @vitejs/*, automerge minor/patch
- `react-ecosystem`: Stable React releases, automerge minor/patch
- `react-canary`: Canary/beta/rc releases, manual review
- `nx-canary`: Nx canary releases, manual review
- `types`: Type definitions (excluding @types/react)
- `tanstack`, `radix-ui`, `styling`: Component libraries

**Auto-Merge Eligibility**:
- ✅ Patch/minor updates
- ✅ Stable versions (not canary/beta/rc)
- ✅ All CI checks green
- ✅ Mutation score ≥ 80%
- ❌ Major updates → Manual review
- ❌ Canary/beta/rc → Manual review
- ❌ Failed tests → Blocked

**Migration Campaign** (Major Updates):
- Automatically creates migration issue
- Title: "Migration: {package} v{version}"
- Labels: `dependencies`, `migration`, `priority/high`
- Checklist: scope, breaking changes, migration steps
- Linked to Renovate PR

## Dashboard

**Auto-Updates**:
- Schedule: Every 6 hours
- On main push
- On `/health` command

**Metrics**:
- Open PRs, merged (7d), stale (>14d)
- Open issues, bugs, features, claude-ready
- Renovate PRs (open, merged 7d)
- Commits (7d), contributors (7d)
- Latest release tag

**Pinned Issue**: Automatically created with `dashboard` and `pinned` labels

## Labels Quick Reference

### Categories (45 total)

**type/** (7):
- `bug`, `feature`, `enhancement`, `docs`, `refactor`, `test`, `chore`

**priority/** (4):
- `critical`, `high`, `medium`, `low`

**scope/** (10):
- `ui`, `api`, `config`, `deps`, `perf`, `security`, `ci`, `docs`, `tests`, `types`

**effort/** (4):
- `trivial`, `small`, `medium`, `large`

**tech/** (3):
- `react`, `effect`, `vite`

**size/** (5):
- `XS`, `S`, `M`, `L`, `XL`

**special** (12):
- `claude-implement`, `dashboard`, `stale`, `tech-debt`, `needs-triage`, `in-progress`, `pinned`, `security`, `automerge`, `renovate-blocked`, `good-first-issue`, `help-wanted`

**Creation**: Run `pnpm labels:create` (idempotent)

## Lefthook: Effect Pattern Validation

**Hook**: `pre-commit` → `effect-check`

**Pattern**: Detects `try {` usage in staged .ts/.tsx files

**Error**:
```
[ERROR] try/catch detected. Use Effect.try, Effect.tryPromise, or Effect.gen
```

**Known Limitations** (grep-based):
- False positives in strings/comments (line-level filtering applied)
- Cannot detect complex nested patterns
- Edge cases: multi-line try statements, minified code

**Workaround**: If false positive, use `LEFTHOOK=0 git commit -m "..."` to skip

## Cost Considerations

**Claude API Usage**:
- **PR Review Aggregator**: ~500 tokens/run (≈$0.01)
- **Code Review Enhanced**: ~2000 tokens/run (≈$0.06)
- **Auto-Labeler**: ~300 tokens/issue (≈$0.005)

**Estimated Monthly**:
- 100 PRs × $0.07 = $7
- 50 issues × $0.005 = $0.25
- **Total**: ~$10/month (Claude Sonnet 4.5 pricing)

**GitHub Actions**:
- Public repos: Free
- Private repos: 2000 minutes/month free (GitHub Free), then $0.008/minute

## Verification Checklist

- [ ] All workflows pass YAML syntax validation
- [ ] `nx affected -t check,typecheck,test` passes
- [ ] All 45 labels created via `pnpm labels:create`
- [ ] project-map.json generates successfully via `pnpm generate:context`
- [ ] Biome repair doesn't break tests
- [ ] Dashboard issue created and populated
- [ ] No new secrets required (GITHUB_TOKEN only)
- [ ] Slash commands (/summarize, /triage, /health) functional
- [ ] Quality debt issues created on CI failure
- [ ] All workflows have concurrency groups
- [ ] First-time contributors receive welcome message

## Troubleshooting

**Workflow not triggering?**
- Check workflow file syntax: `yamllint .github/workflows/*.yml`
- Verify trigger paths in `on:` section
- Check branch protection rules

**Slash command not responding?**
- Ensure issue has correct label (e.g., `dashboard` for `/health`)
- Verify command is exact (case-sensitive)
- Check workflow permissions (issues: write)

**Auto-merge not working?**
- Verify branch protection allows auto-merge
- Check mutation score requirement (≥80%)
- Ensure all required status checks pass

**Biome repair breaking tests?**
- `--unsafe` flag can change semantics
- Review suggested fixes manually
- Skip auto-commit if tests fail

**Lefthook false positives?**
- Known grep limitation
- Use `LEFTHOOK=0 git commit` to bypass
- Document edge cases in this file

---

**Last Updated**: 2025-11-26
**Maintained By**: Parametric Portal Team
