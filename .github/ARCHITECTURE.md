# [H1][AGENTIC_INFRASTRUCTURE_ARCHITECTURE]
>**Dictum:** *GitHub serves as state layer; agents execute via Actions or VPS.*

<br>

GitHub is the state layer. AI agents operate via two execution paths.

**Agentic VPS Management:** `.claude/skills/hostinger-tools/` — API wrapper for programmatic VPS control (start/stop, firewall, DNS, snapshots, Docker).

```
GitHub (State)                    GitHub Actions                n8n Cloud + VPS
───────────────                   ──────────────                ───────────────
Issues, Labels, PRs       ──►     Simple API calls       ──►    Full CLI agents
Discussions, Comments             Code review, sync             File access, git, PRs
```

---
## [1][EXECUTION_PATHS]

| [INDEX] | [PATH]             | [USE_CASE]                    | [EXAMPLES]                                    |
| ------- | ------------------ | ----------------------------- | --------------------------------------------- |
| [1]     | **GitHub Actions** | Fast, single request/response | Code review, label sync, PR normalization     |
| [2]     | **n8n + VPS**      | Multi-turn reasoning          | Feature implementation, project decomposition |

---
## [2][STATE_MANAGEMENT]

Labels drive the state machine. Workflows react to label changes.

| [INDEX] | [CATEGORY] | [LABELS]                                                              | [PURPOSE]               |
| ------- | ---------- | --------------------------------------------------------------------- | ----------------------- |
| [1]     | **Agent**  | `claude`, `gemini`, `copilot`, `codex`                                | Dispatch to specific AI |
| [2]     | **Status** | `idea` → `planning` → `implement` → `in-progress` → `review` → `done` | Workflow state          |
| [3]     | **Type**   | `task`, `spike`, `project`, `fix`, `feat`                             | Work classification     |

---
## [3][AI_AGENTS]

| [INDEX] | [AGENT]     | [CODE_REVIEW] | [VPS_CLI]       | [STRENGTH]                    |
| ------- | ----------- | ------------- | --------------- | ----------------------------- |
| [1]     | **Claude**  | GitHub Action | Claude Code CLI | Deep reasoning, complex tasks |
| [2]     | **Gemini**  | GitHub Action | Gemini CLI      | Multimodal, fast              |
| [3]     | **Copilot** | Native        | Copilot CLI     | IDE integration               |
| [4]     | **Codex**   | GitHub Action | Codex CLI       | Supplementary                 |

All four CLI agents are installed on the Hostinger VPS and available to n8n workflows.

---
## [4][INFRASTRUCTURE]

| [INDEX] | [COMPONENT]        | [ROLE]                         | [LOCATION]             |
| ------- | ------------------ | ------------------------------ | ---------------------- |
| [1]     | **GitHub**         | State layer                    | github.com             |
| [2]     | **GitHub Actions** | Fast event handlers            | `.github/workflows/`   |
| [3]     | **n8n Cloud**      | Webhook receiver, orchestrator | `bsamie.app.n8n.cloud` |
| [4]     | **Hostinger VPS**  | CLI agent runtime              | `31.97.131.41`         |

**VPS Repo Path:** `~/workspace/Parametric_Portal` — auto-syncs on push to `main` via `n8n-sync.yml`<br>
**VPS Environment:** `~/.env` — sourced by `~/.bashrc`, contains API tokens (no 1Password on VPS)<br>
**Auto-cd:** Configured in `~/.bashrc`: `[[ -n "$SSH_CONNECTION" ]] && cd ~/workspace/Parametric_Portal`

### [4.1][SSH_ACCESS]

**Quick Connect:** `ssh n8n` (configured in Parametric Forge)

Three SSH key pairs enable different access patterns:

| [INDEX] | [KEY]                         | [LOCATION]                     | [DIRECTION]          | [PURPOSE]                |
| ------- | ----------------------------- | ------------------------------ | -------------------- | ------------------------ |
| [1]     | **Github Authentication key** | 1Password                      | Local/n8n → VPS      | Human + n8n SSH into VPS |
| [2]     | **github-actions key**        | GitHub Secrets (`N8N_SSH_KEY`) | GitHub Actions → VPS | `n8n-sync.yml` code sync |
| [3]     | **VPS n8n-agent**             | GitHub Deploy Keys             | VPS → GitHub         | VPS git operations       |

**SSH File Transfer:**  `scp` = `rsync -ahzPX -e ssh`<br>
**SSH Config Location:** `/Users/bardiasamiee/Documents/99.Github/Parametric_Forge/modules/home/programs/shell-tools/ssh.nix`

[IMPORTANT] **SSH Config** (from `Parametric_Forge/modules/home/programs/shell-tools/ssh.nix`):

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
| ------- | ----------- | --------------------------------------- |
| [1]     | Host        | `31.97.131.41`                          |
| [2]     | Port        | `22`                                    |
| [3]     | Username    | `n8n-agent`                             |
| [4]     | Private Key | 1Password → "Github Authentication key" |

### [4.2][WEBHOOKS]

| [INDEX] | [URL]                        | [EVENTS]                         | [STATUS] |
| ------- | ---------------------------- | -------------------------------- | -------- |
| [1]     | `.../webhook/pm-discussions` | Discussions, Discussion comments | Active   |
| [2]     | `.../webhook/pm-issues`      | Issues                           | Active   |
| [3]     | `.../webhook/pm-pulls`       | Pull requests                    | Active   |

**Local Alias:** `whs` = `webhook -hooks $WEBHOOK_HOOKS_DIR/hooks.json -verbose`, Start webhook server

[CRITICAL] **Base URL:** `https://bsamie.app.n8n.cloud`

---
## [5][AGENTIC_PM_SYSTEM]

AI-first project management. Discussions for planning, Issues for execution.

```
INTAKE → EXPLORE → PLAN → [BOARDROOM ⟷ REFINE]* → DECOMPOSE → [HUMAN] → DISPATCH → DONE
```

| [INDEX] | [SKILL]     | [TRIGGER]                 | [OUTPUT]         |
| ------- | ----------- | ------------------------- | ---------------- |
| [1]     | `explore`   | `planning` label          | Recommendation   |
| [2]     | `plan`      | explore marker            | PLAN.md draft    |
| [3]     | `boardroom` | plan marker               | 5-agent critique |
| [4]     | `refine`    | revise vote               | Refined PLAN.md  |
| [5]     | `decompose` | approve vote              | Task inventory   |
| [6]     | `dispatch`  | `dispatch-approved` label | GitHub issues    |

**Orchestration**: n8n detects `<!-- SKILL_COMPLETE: {skill} -->` markers → triggers next skill.<br>
**Human Gate**: Review decomposition before issue dispatch.

---
## [6][WEBHOOK_SERVER]

Local webhook receiver via `adnanh/webhook` (port 9000):
- Config: `~/.config/webhook/hooks.json`
- Scripts: `~/.config/webhook/scripts/`
- Start: `whs` alias
- Env: `$WEBHOOK_HOOKS_DIR`, `$WEBHOOK_PORT`

Used for local services, workflows, n8n development, and testing.

**Webhook Config Location:** `/Users/bardiasamiee/Documents/99.Github/Parametric_Forge/modules/home/programs/shell-tools/webhook.nix`

## [7][1PASSWORD_INTEGRATION]

Tokens injected via `op inject` during shell startup:

| [INDEX] | [VARIABLE]           | [PURPOSE]   |
| ------- | -------------------- | ----------- |
| [1]     | `GH_TOKEN`           | GitHub CLI  |
| [2]     | `HOSTINGER_TOKEN`    | VPS API     |
| [3]     | `EXA_API_KEY`        | Code search |
| [4]     | `PERPLEXITY_API_KEY` | AI research |
| [5]     | `TAVILY_API_KEY`     | Web crawl   |

SSH keys served via 1Password agent socket (no disk keys).

**1Password Config Location:** `/Users/bardiasamiee/Documents/99.Github/Parametric_Forge/modules/home/programs/shell-tools/1password.nix`

---
## [7][KEY_FILES]

| [INDEX] | [FILE]               | [PURPOSE]                          |
| ------- | -------------------- | ---------------------------------- |
| [1]     | `labels.yml`         | Label definitions                  |
| [2]     | `scripts/schema.ts`  | Central constants, dispatch tables |
| [3]     | `N8N_SETUP.md`       | n8n + VPS setup guide              |
| [4]     | `AGENTIC_PM_PLAN.md` | PM system specification            |
