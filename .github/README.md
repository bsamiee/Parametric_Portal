# [H1][GITHUB_AUTOMATION]
>**Dictum:** *AI-first framework using GitHub as state management layer.*

---
## [1][FILE_INVENTORY]

| [INDEX] | [PATH]                     | [PURPOSE]                                                                              |
| :-----: | -------------------------- | -------------------------------------------------------------------------------------- |
|   [1]   | `labels.yml`               | 39 labels across 7 categories (type, agentic, status, phase, priority, agent, special) |
|   [2]   | `dependabot.yml`           | Security-only patches (version updates delegated to Renovate)                          |
|   [3]   | `copilot-instructions.md`  | AI assistant guidelines enforcing REQUIREMENTS.md standards                            |
|   [4]   | `PULL_REQUEST_TEMPLATE.md` | PR template with Summary, Related Issues, Changes sections                             |

<br>

### [1.1][WORKFLOWS]

| [INDEX] | [WORKFLOW]             | [TYPE]  | [TRIGGER]           | [PURPOSE]                                                  |
| :-----: | ---------------------- | ------- | ------------------- | ---------------------------------------------------------- |
|   [1]   | **active-qc.yml**      | Active  | PR/Issue events     | Event-driven metadata fixes, label sync, duplicate marking |
|   [2]   | **passive-qc.yml**     | Passive | 6h + daily schedule | Stale management, aging reports, branch/cache cleanup      |
|   [3]   | **ai-maintenance.yml** | AI      | Weekly Monday 09:00 | Claude-powered PR review, dependency audit, code quality   |
|   [4]   | **ci.yml**             | CI      | Push/PR + weekly    | Quality gates, security scans, Biome auto-fix, Nx release  |
|   [5]   | sonarcloud.yml         | CI      | PR/Push + dispatch  | SonarCloud analysis with PR decoration + job summary       |
|   [6]   | dashboard.yml          | Passive | 6h schedule         | Repository metrics dashboard                               |
|   [7]   | claude.yml             | Agent   | @claude mention     | Interactive Claude Code with 4 specialist agents           |
|   [8]   | claude-code-review.yml | Agent   | PR opened/sync      | Automated PR review against REQUIREMENTS.md                |
|   [9]   | gemini-dispatch.yml    | Agent   | @gemini-cli mention | Routes to review or invoke workflows                       |
|  [10]   | gemini-review.yml      | Agent   | workflow_call       | Gemini CLI PR review with MCP GitHub                       |
|  [11]   | gemini-invoke.yml      | Agent   | workflow_call       | General Gemini CLI invocation                              |
|  [12]   | n8n-sync.yml           | Infra   | Push to main        | Sync code to VPS for n8n agent operations                  |

---
### [1.2][ACTIONS]

| [INDEX] | [ACTION]           | [PURPOSE]                                                   |
| :-----: | ------------------ | ----------------------------------------------------------- |
|   [1]   | `node-env`         | Node.js + pnpm setup from package.json                      |
|   [2]   | `meta-fixer`       | AI-powered title/label/body normalization (Claude fallback) |
|   [3]   | `issue-ops`        | Unified issue operations (stale, duplicate, labels)         |
|   [4]   | `label`            | Label-triggered behaviors (pin/unpin/comment)               |
|   [5]   | `pr-hygiene`       | Resolve outdated review threads, cleanup prompts            |
|   [6]   | `auto-fix`         | Run fixers (Biome), commit, push                            |
|   [7]   | `git-identity`     | Configure git user for commits                              |
|   [8]   | `slash-dispatch`   | Slash command dispatcher (prepared, not active)             |

---
### [1.3][SCRIPTS]

| [INDEX] | [SCRIPT]            | [PURPOSE]                                             | [CALLED_BY]               |
| :-----: | ------------------- | ----------------------------------------------------- | ------------------------- |
|   [1]   | `schema.ts`         | Central B constant, types, dispatch tables, utilities | All scripts               |
|   [2]   | `ai-meta.ts`        | Metadata fixer with AI fallback                       | meta-fixer action         |
|   [3]   | `ai-meta-parser.ts` | Parse `ai_meta` YAML from issue bodies                | active-qc issue-meta      |
|   [4]   | `pr-sync.ts`        | Sync PR title/labels from commits                     | active-qc pr-sync         |
|   [5]   | `pr-hygiene.ts`     | Review thread cleanup                                 | pr-hygiene action         |
|   [6]   | `label.ts`          | Label behavior dispatcher (pin/unpin)                 | label action              |
|   [7]   | `dashboard.ts`      | Repository metrics collection                         | dashboard workflow        |
|   [8]   | `report.ts`         | Aging report generation                               | passive-qc aging-report   |
|   [9]   | `maintenance.ts`    | Branch pruning, cache cleanup                         | passive-qc branch-cleanup |
|  [10]   | `probe.ts`          | Entity data extraction (issues, PRs, discussions)     | ai-meta, pr-hygiene       |
|  [11]   | `failure-alert.ts`  | CI failure issue creation                             | security workflow         |
|  [12]   | `env.ts`            | Environment config (lang, Nx Cloud ID)                | dashboard                 |

---
### [1.4][ISSUE_TEMPLATES]

| [INDEX] | [TEMPLATE]          | [PREFIX]      | [LABELS]                    | [AI_META] |
| :-----: | ------------------- | ------------- | --------------------------- | :-------: |
|   [1]   | project.yml         | `[PROJECT]:`  | project, triage, 1-planning |    Yes    |
|   [2]   | task.yml            | `[TASK]:`     | task, triage                |    Yes    |
|   [3]   | refactor.yml        | `[REFACTOR]:` | refactor, triage            |    Yes    |
|   [4]   | feature_request.yml | `[FEAT]:`     | feat                        |    No     |
|   [5]   | bug_report.yml      | `[FIX]:`      | fix                         |    No     |
|   [6]   | docs.yml            | `[DOCS]:`     | docs                        |    No     |
|   [7]   | test.yml            | `[TEST]:`     | test                        |    No     |
|   [8]   | perf.yml            | `[PERF]:`     | perf                        |    No     |
|   [9]   | style.yml           | `[STYLE]:`    | style                       |    No     |
|  [10]   | chore.yml           | `[CHORE]:`    | chore                       |    No     |
|  [11]   | ci.yml              | `[CI]:`       | ci                          |    No     |
|  [12]   | build.yml           | `[BUILD]:`    | build                       |    No     |
|  [13]   | help.yml            | `[HELP]:`     | help                        |    No     |

---
## [2][ARCHITECTURE]
>**Dictum:** *Three pillars separate event, schedule, and AI operations.*

<br>

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

<br>

**Active QC** — Reacts to events (PR opened, issue labeled, comment created).<br>
**Passive QC** — Runs on schedule (stale detection, cleanup, reports).<br>
**AI Maintenance** — Uses Claude for complex analysis humans cannot automate.

<br>

### [2.1][WORKFLOW_ORCHESTRATION]

```mermaid
graph TD
    PR[Pull Request] --> ActiveQC[active-qc.yml]
    PR --> CI[ci.yml]
    PR --> ClaudeReview[claude-code-review.yml]
    PR --> Gemini[gemini-dispatch.yml]
    PR --> Sonar[sonarcloud.yml]

    Gemini -->|workflow_call| GeminiReview[gemini-review.yml]
    Gemini -->|workflow_call| GeminiInvoke[gemini-invoke.yml]

    Schedule6h[6h Schedule] --> PassiveQC[passive-qc.yml]
    Schedule6h --> Dashboard[dashboard.yml]
    ScheduleDaily[Daily 03:00] --> PassiveQC
    ScheduleWeekly[Weekly Mon 09:00] --> AI[ai-maintenance.yml]
    ScheduleWeekly --> CI

    Push[Push to main] --> ActiveQC
    Push --> CI
    Push --> N8N[n8n-sync.yml]
    Push --> Sonar

    Comment[@claude/@gemini-cli] --> Claude[claude.yml]
    Comment --> Gemini

    style CI fill:#e1f5e1
    style PassiveQC fill:#fff4e1
    style AI fill:#ffe1f0
    style Sonar fill:#e1e5ff
```

**Legend:**<br>
🟢 **CI (green)** — Quality + Security gates<br>
🟡 **Passive QC (yellow)** — Scheduled maintenance<br>
🩷 **AI (pink)** — Agent-powered workflows<br>
🔵 **Sonar (blue)** — Code analysis

---
## [3][PIPELINE]
>**Dictum:** *Schema flows through scripts, actions, and workflows.*

<br>

```text
schema.ts (B constant, fn, call, mutate, md)
    ↓
scripts/*.ts (import schema, implement logic)
    ↓
actions/*.yml (wrap scripts via github-script + tsx)
    ↓
workflows/*.yml (orchestrate actions on triggers)
```

<br>

### [3.1][B_CONSTANT]

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

---
### [3.2][EXPORTS]

| [INDEX] | [EXPORT]    | [PURPOSE]                                                       |
| :-----: | ----------- | --------------------------------------------------------------- |
|   [1]   | `B`         | Frozen config object (single source of truth)                   |
|   [2]   | `fn`        | Pure utility functions (classify, body, report, trunc)          |
|   [3]   | `md`        | Markdown generators (badge, shield, alert, progress, sparkline) |
|   [4]   | `call`      | GitHub API dispatcher (50+ operations)                          |
|   [5]   | `mutate`    | State mutation handler (comment, issue, label, review, release) |
|   [6]   | `createCtx` | Context factory for script execution                            |

---
## [4][LABELS]
>**Dictum:** *Labels encode workflow state and trigger behaviors.*

<br>

### [4.1][CATEGORIES]

| [INDEX] | [CATEGORY]   | [LABELS]                                                             | [PURPOSE]                             |
| :-----: | ------------ | -------------------------------------------------------------------- | ------------------------------------- |
|   [1]   | **type**     | fix, feat, docs, style, refactor, test, chore, perf, ci, build, help | Commit type correlation               |
|   [2]   | **agentic**  | task, project                                                        | Work unit classification              |
|   [3]   | **status**   | triage, implement, in-progress, review, blocked, done                | Workflow state                        |
|   [4]   | **phase**    | 0-foundation → 5-release                                             | Project phase tracking                |
|   [5]   | **priority** | critical, high, medium, low                                          | Urgency ranking                       |
|   [6]   | **agent**    | claude, gemini, copilot, codex                                       | Agent assignment (mutually exclusive) |
|   [7]   | **special**  | security, breaking, dependencies, dashboard, stale, pinned           | Cross-cutting concerns                |

---
### [4.2][BEHAVIORS]

| [INDEX] | [LABEL]  | [ON_ADD]                | [ON_REMOVE] |
| :-----: | -------- | ----------------------- | ----------- |
|   [1]   | `pinned` | Pin issue (GraphQL)     | Unpin issue |
|   [2]   | `stale`  | Post inactivity comment | —           |

---
### [4.3][STALE_MANAGEMENT]

**Check interval** — 3 days inactive.<br>
**Close threshold** — 7 days after stale label.<br>
**Exempt labels** — critical, implement, pinned, security.

---
## [5][CHATOPS]
>**Dictum:** *Triggers enable agent invocation via comments.*

<br>

### [5.1][CLAUDE]

```text
Triggers: issue_comment, pr_review_comment, pr_review, issues
Condition: Body/title contains @claude
Model: claude-opus-4-5-20251101
Max turns: 15
Permissions: contents:write, pull-requests:write, issues:write
```

---
### [5.2][GEMINI]

```text
Triggers: pr_review_comment, pr_review, pull_request, issue_comment
Condition: startsWith(@gemini-cli) AND (OWNER|MEMBER|COLLABORATOR)
Commands: /review → gemini-review.yml, default → gemini-invoke.yml
Model: Gemini with 25 session turns
MCP: github-mcp-server (Docker)
```

---
### [5.3][DUPLICATE]

```text
Trigger: issue_comment containing /duplicate
Handler: issue-ops action → mark-duplicate operation
Behavior: Apply duplicate label, close issue, add reaction
Permission: write
```

---
## [6][WORKFLOW_DETAILS]
>**Dictum:** *Jobs map triggers to handler logic.*

<br>

### [6.1][ACTIVE_QC]

| [INDEX] | [JOB]                  | [TRIGGER]            | [ACTION_SCRIPT]                |
| :-----: | ---------------------- | -------------------- | ------------------------------ |
|   [1]   | pr-meta                | PR opened/edited     | meta-fixer → ai-meta.ts        |
|   [2]   | pr-sync                | PR synchronize       | github-script → pr-sync.ts     |
|   [3]   | pr-hygiene             | PR synchronize       | pr-hygiene → pr-hygiene.ts     |
|   [4]   | issue-meta             | Issue opened/edited  | meta-fixer + ai-meta-parser.ts |
|   [5]   | pin-issue              | Issue labeled pinned | label → label.ts               |
|   [6]   | pin-renovate-dashboard | Renovate dashboard   | label → label.ts               |
|   [7]   | mark-duplicate         | /duplicate comment   | issue-ops                      |
|   [8]   | sync-labels            | Push to main         | ghaction-github-labeler        |

---
### [6.2][PASSIVE_QC]

| [INDEX] | [JOB]            | [SCHEDULE]  | [PURPOSE]                       |
| :-----: | ---------------- | ----------- | ------------------------------- |
|   [1]   | sync-labels      | 6h          | Backup label sync               |
|   [2]   | stale-management | 6h          | Mark inactive, close stale      |
|   [3]   | aging-report     | 6h          | Generate metrics report         |
|   [4]   | meta-consistency | 6h          | AI fix up to 10 items           |
|   [5]   | branch-cleanup   | Daily 03:00 | Prune merged/stale branches     |
|   [6]   | cache-cleanup    | Daily 03:00 | Delete old workflow runs/caches |

---
### [6.3][AI_MAINTENANCE]

| [INDEX] | [JOB]              | [TRIGGER]         | [CLAUDE_TASKS]                                                             |
| :-----: | ------------------ | ----------------- | -------------------------------------------------------------------------- |
|   [1]   | weekly-maintenance | Monday 09:00      | Stale PR review, dependency check, code quality, issue triage              |
|   [2]   | manual-task        | workflow_dispatch | dependency-audit, stale-pr-review, code-quality-report, documentation-sync |

**Allowed tools**: Read, Grep, Glob, Bash(pnpm:*), Bash(gh:*), Bash(git:*)

---
## [7][CONVENTIONS]
>**Dictum:** *Naming patterns ensure consistency across artifacts.*

<br>

| [INDEX] | [CONTEXT]       | [FORMAT]      | [EXAMPLE]                        |
| :-----: | --------------- | ------------- | -------------------------------- |
|   [1]   | Issue/PR title  | `[TYPE]:`     | `[FEAT]: Add dark mode`          |
|   [2]   | Commit message  | `type!:`      | `feat!: breaking change`         |
|   [3]   | Dashboard issue | `[DASHBOARD]` | `[DASHBOARD] Repository Metrics` |

**Note**: Commits use lowercase, no scope required. Exclamation mark indicates breaking change.

---
## [8][INFRASTRUCTURE]
>**Dictum:** *External services enable agent runtime and orchestration.*

<br>

| [INDEX] | [COMPONENT]        | [ROLE]                         | [LOCATION]             |
| :-----: | ------------------ | ------------------------------ | ---------------------- |
|   [1]   | **GitHub**         | State layer                    | github.com             |
|   [2]   | **GitHub Actions** | Fast event handlers            | `.github/workflows/`   |
|   [3]   | **n8n Cloud**      | Webhook receiver, orchestrator | `bsamie.app.n8n.cloud` |
|   [4]   | **Hostinger VPS**  | CLI agent runtime              | `31.97.131.41`         |

**VPS Repo Path** — `~/workspace/Parametric_Portal` auto-syncs on push to `main` via `n8n-sync.yml`.<br>
**VPS Environment** — `~/.env` sourced by `~/.bashrc`, contains API tokens (no 1Password on VPS).<br>
**Auto-cd** — Configured in `~/.bashrc`: `[[ -n "$SSH_CONNECTION" ]] && cd ~/workspace/Parametric_Portal`.

<br>

### [8.1][SSH_ACCESS]

**Quick Connect:** `ssh n8n` (configured in Parametric Forge)

| [INDEX] | [KEY]                         | [LOCATION]                     | [DIRECTION]          | [PURPOSE]                |
| :-----: | ----------------------------- | ------------------------------ | -------------------- | ------------------------ |
|   [1]   | **Github Authentication key** | 1Password                      | Local/n8n → VPS      | Human + n8n SSH into VPS |
|   [2]   | **github-actions key**        | GitHub Secrets (`N8N_SSH_KEY`) | GitHub Actions → VPS | `n8n-sync.yml` code sync |
|   [3]   | **VPS n8n-agent**             | GitHub Deploy Keys             | VPS → GitHub         | VPS git operations       |

**SSH File Transfer** — `scp` = `rsync -ahzPX -e ssh`.<br>
**SSH Config Location** — `Parametric_Forge/modules/home/programs/shell-tools/ssh.nix`.

[IMPORTANT] **SSH Config**:

```text
Host n8n
  User n8n-agent
  HostName 31.97.131.41
  LocalForward 9000 localhost:9000  # webhook
  LocalForward 6800 localhost:6800  # aria2 RPC
  LocalForward 1455 localhost:1455  # Codex OAuth callback
  IdentityAgent ~/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock
```

[IMPORTANT] **n8n Cloud Credential** (`VPS SSH`):

| [INDEX] | [FIELD]     | [VALUE]                                 |
| :-----: | ----------- | --------------------------------------- |
|   [1]   | Host        | `31.97.131.41`                          |
|   [2]   | Port        | `22`                                    |
|   [3]   | Username    | `n8n-agent`                             |
|   [4]   | Private Key | 1Password → "Github Authentication key" |

---
### [8.2][WEBHOOKS]

[CRITICAL] **Base URL:** `https://bsamie.app.n8n.cloud`

| [INDEX] | [URL]                        | [EVENTS]                         | [STATUS] |
| :-----: | ---------------------------- | -------------------------------- | :------: |
|   [1]   | `.../webhook/pm-discussions` | Discussions, Discussion comments |  Active  |
|   [2]   | `.../webhook/pm-issues`      | Issues                           |  Active  |
|   [3]   | `.../webhook/pm-pulls`       | Pull requests                    |  Active  |

**Local Webhook Server** — `adnanh/webhook` on port 9000.<br>
**Config** — `~/.config/webhook/hooks.json`.<br>
**Scripts** — `~/.config/webhook/scripts/`.<br>
**Start Alias** — `whs` = `webhook -hooks $WEBHOOK_HOOKS_DIR/hooks.json -verbose`.<br>
**Environment** — `$WEBHOOK_HOOKS_DIR`, `$WEBHOOK_PORT`.<br>
**Webhook Config Location** — `Parametric_Forge/modules/home/programs/shell-tools/webhook.nix`.

Used for local services, workflows, n8n development, and testing.

---
### [8.3][1PASSWORD]

Tokens injected via `op inject` during shell startup:

| [INDEX] | [VARIABLE]           | [PURPOSE]           |
| :-----: | -------------------- | ------------------- |
|   [1]   | `GH_TOKEN`           | GitHub CLI          |
|   [2]   | `GH_PROJECTS_TOKEN`  | GitHub Projects API |
|   [3]   | `HOSTINGER_TOKEN`    | VPS API             |
|   [4]   | `EXA_API_KEY`        | Code search         |
|   [5]   | `PERPLEXITY_API_KEY` | AI research         |
|   [6]   | `TAVILY_API_KEY`     | Web crawl           |

SSH keys served via 1Password agent socket (no disk keys).

**1Password Config Location** — `Parametric_Forge/modules/home/programs/shell-tools/1password.nix`.
