# .github/ Automation System

AI-first automation framework using GitHub as state management. Issues exist for AI consumption.

---

## File Inventory

| Path                       | Purpose                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `labels.yml`               | 39 labels across 7 categories (type, agentic, status, phase, priority, agent, special) |
| `dependabot.yml`           | Security-only patches (version updates delegated to Renovate)                          |
| `copilot-instructions.md`  | AI assistant guidelines enforcing REQUIREMENTS.md standards                            |
| `PULL_REQUEST_TEMPLATE.md` | PR template with Summary, Related Issues, Changes sections                             |

### workflows/

| Workflow               | Type    | Trigger             | Purpose                                                    |
| ---------------------- | ------- | ------------------- | ---------------------------------------------------------- |
| **active-qc.yml**      | Active  | PR/Issue events     | Event-driven metadata fixes, label sync, duplicate marking |
| **passive-qc.yml**     | Passive | 6h + daily schedule | Stale management, aging reports, branch/cache cleanup      |
| **ai-maintenance.yml** | AI      | Weekly Monday 09:00 | Claude-powered PR review, dependency audit, code quality   |
| ci.yml                 | CI      | Push/PR to main     | Quality gates, Biome auto-fix, Nx release                  |
| security.yml           | CI      | Push/PR + weekly    | Dependency audit, CodeQL, secrets scan                     |
| sonarcloud.yml         | CI      | Push/PR             | SonarCloud analysis                                        |
| dashboard.yml          | Passive | 6h schedule         | Repository metrics dashboard                               |
| claude.yml             | Agent   | @claude mention     | Interactive Claude Code with 4 specialist agents           |
| claude-code-review.yml | Agent   | PR opened/sync      | Automated PR review against REQUIREMENTS.md                |
| gemini-dispatch.yml    | Agent   | @gemini-cli mention | Routes to review or invoke workflows                       |
| gemini-review.yml      | Agent   | workflow_call       | Gemini CLI PR review with MCP GitHub                       |
| gemini-invoke.yml      | Agent   | workflow_call       | General Gemini CLI invocation                              |

### actions/

| Action             | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `node-env`         | Node.js + pnpm setup from package.json                      |
| `meta-fixer`       | AI-powered title/label/body normalization (Claude fallback) |
| `issue-ops`        | Unified issue operations (stale, duplicate, labels)         |
| `label`            | Label-triggered behaviors (pin/unpin/comment)               |
| `pr-hygiene`       | Resolve outdated review threads, cleanup prompts            |
| `auto-fix`         | Run fixers (Biome), commit, push                            |
| `git-identity`     | Configure git user for commits                              |
| `normalize-commit` | Transform `[TYPE!]:` to `type!:` format                     |
| `slash-dispatch`   | Slash command dispatcher (prepared, not active)             |

### scripts/

| Script              | Purpose                                               | Called By                 |
| ------------------- | ----------------------------------------------------- | ------------------------- |
| `schema.ts`         | Central B constant, types, dispatch tables, utilities | All scripts               |
| `ai-meta.ts`        | Metadata fixer with AI fallback                       | meta-fixer action         |
| `ai-meta-parser.ts` | Parse `ai_meta` YAML from issue bodies                | active-qc issue-meta      |
| `pr-sync.ts`        | Sync PR title/labels from commits                     | active-qc pr-sync         |
| `pr-hygiene.ts`     | Review thread cleanup                                 | pr-hygiene action         |
| `label.ts`          | Label behavior dispatcher (pin/unpin)                 | label action              |
| `dashboard.ts`      | Repository metrics collection                         | dashboard workflow        |
| `report.ts`         | Aging report generation                               | passive-qc aging-report   |
| `maintenance.ts`    | Branch pruning, cache cleanup                         | passive-qc branch-cleanup |
| `probe.ts`          | Entity data extraction (issues, PRs, discussions)     | ai-meta, pr-hygiene       |
| `failure-alert.ts`  | CI failure issue creation                             | security workflow         |
| `env.ts`            | Environment config (lang, Nx Cloud ID)                | dashboard                 |

### ISSUE_TEMPLATE/

| Template            | Prefix        | Labels                      | ai_meta |
| ------------------- | ------------- | --------------------------- | ------- |
| project.yml         | `[PROJECT]:`  | project, triage, 1-planning | Yes     |
| task.yml            | `[TASK]:`     | task, triage                | Yes     |
| refactor.yml        | `[REFACTOR]:` | refactor, triage            | Yes     |
| feature_request.yml | `[FEAT]:`     | feat                        | No      |
| bug_report.yml      | `[FIX]:`      | fix                         | No      |
| docs.yml            | `[DOCS]:`     | docs                        | No      |
| test.yml            | `[TEST]:`     | test                        | No      |
| perf.yml            | `[PERF]:`     | perf                        | No      |
| style.yml           | `[STYLE]:`    | style                       | No      |
| chore.yml           | `[CHORE]:`    | chore                       | No      |
| ci.yml              | `[CI]:`       | ci                          | No      |
| build.yml           | `[BUILD]:`    | build                       | No      |
| help.yml            | `[HELP]:`     | help                        | No      |

---

## Architecture: Three Pillars

```text
[ACTIVE-QC]          [PASSIVE-QC]         [AI-MAINTENANCE]
Event-triggered      Timer-based          Weekly AI operations
     |                    |                     |
PR/Issue events      6h + daily           Monday 09:00 UTC
     |                    |                     |
meta-fixer           stale-management     Claude Sonnet
pr-sync              aging-report         dependency-audit
pr-hygiene           branch-cleanup       stale-pr-review
pin-issue            cache-cleanup        code-quality
mark-duplicate       meta-consistency     documentation-sync
sync-labels          maintenance-summary
```

**Active QC** reacts to events (PR opened, issue labeled, comment created).
**Passive QC** runs on schedule (stale detection, cleanup, reports).
**AI Maintenance** uses Claude for complex analysis humans can't automate.

---

## Pipeline: schema.ts to Workflows

```
schema.ts (B constant, fn, call, mutate, md)
    ↓
scripts/*.ts (import schema, implement logic)
    ↓
actions/*.yml (wrap scripts via github-script + tsx)
    ↓
workflows/*.yml (orchestrate actions on triggers)
```

### B Constant Structure

```typescript
B = Object.freeze({
  algo:     { staleDays, closeRatio, mutationPct },
  api:      { perPage, state },
  breaking: { pattern, label },
  dashboard:{ schedule, targets, metrics },
  helper:   { duplicateCmd, inactiveDays },
  hygiene:  { botAliases, slashCommands, valuablePatterns },
  labels:   { behaviors, exempt, groups, mutations },
  meta:     { infer, models, markers, ops },
  patterns: { commit, header, placeholder },
  pr:       { pattern },
  probe:    { gql, bodyTruncate, markers },
  time:     { day }
})
```

### Key Exports

| Export      | Purpose                                                         |
| ----------- | --------------------------------------------------------------- |
| `B`         | Frozen config object (single source of truth)                   |
| `fn`        | Pure utility functions (classify, body, report, trunc)          |
| `md`        | Markdown generators (badge, shield, alert, progress, sparkline) |
| `call`      | GitHub API dispatcher (50+ operations)                          |
| `mutate`    | State mutation handler (comment, issue, label, review, release) |
| `createCtx` | Context factory for script execution                            |

---

## Label System

### Categories

| Category       | Labels                                                                                       | Purpose                               |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| **type**       | fix, feat, docs, style, refactor, test, chore, perf, ci, build, help                         | Commit type correlation               |
| **agentic**    | task, project                                                                                | Work unit classification              |
| **status**     | triage, implement, in-progress, review, blocked, done                                        | Workflow state                        |
| **phase**      | 0-foundation → 5-release                                                                     | Project phase tracking                |
| **priority**   | critical, high, medium, low                                                                  | Urgency ranking                       |
| **agent**      | claude, gemini, copilot, codex                                                               | Agent assignment (mutually exclusive) |
| **special**    | security, breaking, dependencies, dashboard, stale, pinned                                   | Cross-cutting concerns                |

### Label Behaviors

| Label    | On Add                  | On Remove   |
| -------- | ----------------------- | ----------- |
| `pinned` | Pin issue (GraphQL)     | Unpin issue |
| `stale`  | Post inactivity comment | —           |

### Stale Management

- **Check interval**: 3 days inactive
- **Close threshold**: 7 days after stale label
- **Exempt labels**: critical, implement, pinned, security

---

## Chatops & Agent Triggers

### @claude (claude.yml)

```
Triggers: issue_comment, pr_review_comment, pr_review, issues
Condition: Body/title contains @claude
Model: claude-opus-4-5-20251101
Max turns: 15
Permissions: contents:write, pull-requests:write, issues:write
```

### @gemini-cli (gemini-dispatch.yml)

```
Triggers: pr_review_comment, pr_review, pull_request, issue_comment
Condition: startsWith(@gemini-cli) AND (OWNER|MEMBER|COLLABORATOR)
Commands: /review → gemini-review.yml, default → gemini-invoke.yml
Model: Gemini with 25 session turns
MCP: github-mcp-server (Docker)
```

### /duplicate (active-qc.yml)

```
Trigger: issue_comment containing /duplicate
Handler: issue-ops action → mark-duplicate operation
Behavior: Apply duplicate label, close issue, add reaction
Permission: write
```

---

## Workflow Details

### active-qc.yml

| Job                    | Trigger              | Action/Script                  |
| ---------------------- | -------------------- | ------------------------------ |
| pr-meta                | PR opened/edited     | meta-fixer → ai-meta.ts        |
| pr-sync                | PR synchronize       | github-script → pr-sync.ts     |
| pr-hygiene             | PR synchronize       | pr-hygiene → pr-hygiene.ts     |
| issue-meta             | Issue opened/edited  | meta-fixer + ai-meta-parser.ts |
| pin-issue              | Issue labeled pinned | label → label.ts               |
| pin-renovate-dashboard | Renovate dashboard   | label → label.ts               |
| mark-duplicate         | /duplicate comment   | issue-ops                      |
| sync-labels            | Push to main         | ghaction-github-labeler        |

### passive-qc.yml

| Job              | Schedule    | Purpose                         |
| ---------------- | ----------- | ------------------------------- |
| sync-labels      | 6h          | Backup label sync               |
| stale-management | 6h          | Mark inactive, close stale      |
| aging-report     | 6h          | Generate metrics report         |
| meta-consistency | 6h          | AI fix up to 10 items           |
| branch-cleanup   | Daily 03:00 | Prune merged/stale branches     |
| cache-cleanup    | Daily 03:00 | Delete old workflow runs/caches |

### ai-maintenance.yml

| Job                | Trigger           | Claude Tasks                                                               |
| ------------------ | ----------------- | -------------------------------------------------------------------------- |
| weekly-maintenance | Monday 09:00      | Stale PR review, dependency check, code quality, issue triage              |
| manual-task        | workflow_dispatch | dependency-audit, stale-pr-review, code-quality-report, documentation-sync |

**Allowed tools**: Read, Grep, Glob, Bash(pnpm:*), Bash(gh:*), Bash(git:*)

---

## Naming Conventions

| Context         | Format        | Example                          |
| --------------- | ------------- | -------------------------------- |
| Issue/PR title  | `[TYPE]:`     | `[FEAT]: Add dark mode`          |
| Commit message  | `type!:`      | `feat!: breaking change`         |
| Dashboard issue | `[DASHBOARD]` | `[DASHBOARD] Repository Metrics` |

**Note**: Commits use lowercase, no scope required. Exclamation mark indicates breaking change.

---

## Integration Points

| System         | Integration                             |
| -------------- | --------------------------------------- |
| **Claude API** | meta-fixer, ai-maintenance, claude.yml  |
| **Gemini CLI** | gemini-dispatch/review/invoke workflows |
| **SonarCloud** | sonarcloud.yml for code quality metrics |
| **Nx Cloud**   | Dashboard links via env.ts              |

---

## Related Files

| File              | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `REQUIREMENTS.md` | Code standards (no any, const only, dispatch tables) |
| `CLAUDE.md`       | Agent execution protocol                             |
| `.claude/`        | Claude Code CLI related files                        |
| `.gemini/`        | Gemini CLI related files                             |
