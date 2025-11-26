# Automation Reference

Comprehensive guide to the agentic automation systems in Parametric Portal.

## AI Agents

| Agent | Role | Trigger | Model | Workflow |
|-------|------|---------|-------|----------|
| **PR Review** | REQUIREMENTS.md compliance + feedback synthesis | pull_request (after CI), /summarize | Claude Opus 4.5 | claude-pr-review.yml |
| **Label Sync** | Declarative label management | labels.yml change | - | auto-labeler.yml |
| **Issue Lifecycle** | Stale handling, validation | issues, schedule | - | issue-lifecycle.yml |
| **Renovate Auto-Merge** | Mutation-gated dependency updates | pull_request, check_suite | - | renovate-automerge.yml |
| **Biome Repair** | Auto-fix style issues | pull_request | - | biome-repair.yml |
| **Dashboard** | Repository health metrics | schedule, /health | - | dashboard.yml |
| **Release** | Conventional commit releases | push to main | - | release.yml |
| **Bundle Analysis** | Bundle size tracking | pull_request | - | bundle-analysis.yml |
| **Security** | Multi-layer security scanning | pull_request, push, schedule | - | security.yml |
| **Semantic Commits** | Conventional commit validation | pull_request | - | semantic-commits.yml |
| **Claude @mention** | Ad-hoc Claude assistance | issue_comment, PR comment | Claude Opus 4.5 | claude.yml |
| **Claude Implement** | Auto-implement labeled issues | issues (implement label) | Claude Opus 4.5 | claude-issues.yml |

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
│  │ CI Pipeline │  │ PR Review   │  │ Issue       │  │ Renovate    ││
│  │             │  │ (claude-pr- │  │ Lifecycle   │  │ Auto-Merge  ││
│  │             │  │ review.yml) │  │             │  │             ││
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
- Posts/updates comment with marker `<!-- PR-REVIEW-SUMMARY -->`

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

---

### `/health` - Dashboard Refresh

**Usage**: Comment `/health` on the pinned dashboard issue (label: `pinned`)

**Effect**:
- Runs health checks: `pnpm typecheck` + `pnpm check`
- Collects metrics: PRs, issues, commits, contributors, Renovate activity
- Updates dashboard issue with structured markdown report
- Includes workflow status badges

---

## PR Lifecycle

```
1. PR Opened
   ├─► Biome Repair (auto-fix style)
   ├─► Semantic Commits (validate title)
   ├─► CI Pipeline (build/test/typecheck)
   └─► Bundle Analysis (compare sizes)

2. CI Complete
   └─► claude-pr-review.yml (REQUIREMENTS.md compliance + synthesize feedback)

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
1. Issue Created (via template)
   └─► Type label applied (bug or feature)

2. Stale Detection (Schedule: Daily)
   ├─► 30 days inactive → stale label
   ├─► 44 days inactive → close
   └─► Exempt: pinned, security, critical

3. Issue Lifecycle
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

## Dashboard

**Auto-Updates**:
- Schedule: Every 6 hours
- On main push
- On `/health` command

**Metrics**:
- Open PRs, merged (7d), stale (>14d)
- Open issues by type
- Renovate PRs (open, merged 7d)
- Commits (7d), contributors (7d)
- Latest release tag

## Labels

Labels are managed declaratively via `.github/labels.yml` and synced automatically on change.

### Type (required, single per issue)
| Label | Color | Description |
|-------|-------|-------------|
| `bug` | #d73a4a | Something isn't working |
| `feature` | #a2eeef | New feature request |
| `docs` | #0075ca | Documentation only |
| `chore` | #d4a373 | Maintenance task |

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

**Total: 15 labels**

## Custom Agent Profiles

10 specialized agents in `.github/agents/*.agent.md` provide domain-specific expertise:

| Agent | Domain | Key Capabilities |
|-------|--------|------------------|
| **typescript-advanced** | TS 6.0-dev | Branded types, Effect pipelines, const generics |
| **react-specialist** | React 19 canary | Compiler optimization, Server Components |
| **vite-nx-specialist** | Vite 7 + Nx 22 | Environment API, Crystal inference |
| **testing-specialist** | Vitest 4.0 | Property-based tests, Effect testing |
| **performance-analyst** | Optimization | Bundle analysis, tree-shaking |
| **refactoring-architect** | Migration | Effect pipelines, dispatch tables |
| **library-planner** | Packages | Research, Nx package creation |
| **integration-specialist** | Consistency | Catalog versions, workspace coherence |
| **documentation-specialist** | Documentation | Cross-project consistency |
| **cleanup-specialist** | Density | Algorithmic optimization (25-30 LOC/feature) |

**Usage**: GitHub Copilot and Claude Code invoke agents via MCP tools. All agents follow REQUIREMENTS.md patterns.

## Claude Dev Integration

`.claude/` directory contains prompts for Claude Dev extension:
- `commands/implement.md` — Implementation workflow
- `commands/refactor.md` — Refactoring workflow
- `commands/review-typescript.md` — TypeScript review
- `commands/test.md` — Testing workflow
- `settings.json` — Extension configuration

## Lefthook: Effect Pattern Validation

**Hook**: `pre-commit` → `effect-check`

**Pattern**: Detects `try {` usage in staged .ts/.tsx files

**Error**:
```
[ERROR] try/catch detected. Use Effect.try, Effect.tryPromise, or Effect.gen
```

**Workaround**: If false positive, use `LEFTHOOK=0 git commit -m "..."` to skip

## Cost Considerations

**GitHub Models API** (used by auto-labeler):
- Free with GITHUB_TOKEN + `models: read` permission
- No additional API keys required

**Claude API Usage**:
- **PR Review**: ~2000 tokens/run (≈$0.06)

**GitHub Actions**:
- Public repos: Free
- Private repos: 2000 minutes/month free (GitHub Free), then $0.008/minute

## Composite Actions

### .github/actions/setup/action.yml

Unified Node.js + pnpm setup used by all workflows. Eliminates ~200 lines of duplicated setup code.

**Inputs**:
- `node-version`: Node.js version (default: `25.2.1`)
- `pnpm-version`: pnpm version (default: `10.23.0`)
- `install-dependencies`: Whether to run `pnpm install` (default: `true`)

**Usage**:
```yaml
- name: Setup Environment
  uses: ./.github/actions/setup
  with:
    install-dependencies: 'false'  # Optional: skip install for lint-only jobs
```

## Tools & Scripts

### Context Generation
- **`pnpm generate:context`** — Executes `tools/generate-context/index.ts`, generates `docs/agent-context/project-map.json` from Nx graph
- **`pnpm parse:context`** — Parses AGENT_CONTEXT from stdin via `tools/parse-agent-context.ts`

## Verification Checklist

- [ ] All workflows pass YAML syntax validation
- [ ] `nx affected -t check,typecheck,test` passes
- [ ] Labels synced via `.github/labels.yml`
- [ ] project-map.json generates successfully via `pnpm generate:context`
- [ ] Biome repair doesn't break tests
- [ ] Dashboard issue created and populated
- [ ] No new secrets required (GITHUB_TOKEN only)
- [ ] Slash commands (/summarize, /health) functional
- [ ] All workflows have concurrency groups
- [ ] First-time contributors receive welcome message
- [ ] Composite action (.github/actions/setup) working in all workflows

## Troubleshooting

**Workflow not triggering?**
- Check workflow file syntax: `yamllint .github/workflows/*.yml`
- Verify trigger paths in `on:` section
- Check branch protection rules

**Slash command not responding?**
- Ensure issue has correct label (e.g., `pinned` for `/health`)
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

---

**Last Updated**: 2025-11-26
