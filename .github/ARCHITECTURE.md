# Agentic Infrastructure Architecture

GitHub is the state layer. AI agents operate via two execution paths.

```
GitHub (State)              GitHub Actions              n8n Cloud + VPS
───────────────             ──────────────              ───────────────
Issues, Labels, PRs    ──►  Simple API calls       ──►  Full CLI agents
Discussions, Comments       Code review, sync           File access, git, PRs
```

---

## Execution Paths

| Path               | Use Case                          | Examples                                      |
| ------------------ | --------------------------------- | --------------------------------------------- |
| **GitHub Actions** | Fast, single request/response     | Code review, label sync, PR normalization     |
| **n8n + VPS**      | Multi-turn reasoning, file access | Feature implementation, project decomposition |

---

## State Management

Labels drive the state machine. Workflows react to label changes.

| Category   | Labels                                                                | Purpose                 |
| ---------- | --------------------------------------------------------------------- | ----------------------- |
| **Agent**  | `claude`, `gemini`, `copilot`, `codex`                                | Dispatch to specific AI |
| **Status** | `idea` → `planning` → `implement` → `in-progress` → `review` → `done` | Workflow state          |
| **Type**   | `task`, `spike`, `project`, `fix`, `feat`                             | Work classification     |

---

## AI Agents

| Agent       | Code Review   | Full CLI        | Strength                      |
| ----------- | ------------- | --------------- | ----------------------------- |
| **Claude**  | GitHub Action | Claude Code CLI | Deep reasoning, complex tasks |
| **Gemini**  | GitHub Action | Gemini CLI      | Multimodal, fast              |
| **Copilot** | Native        | (planned)       | IDE integration               |
| **Codex**   | Built-in      | (TBD)           | Supplementary                 |

---

## Infrastructure

| Component          | Role                           | Location               |
| ------------------ | ------------------------------ | ---------------------- |
| **GitHub**         | State layer                    | github.com             |
| **GitHub Actions** | Fast event handlers            | `.github/workflows/`   |
| **n8n Cloud**      | Webhook receiver, orchestrator | `bsamie.app.n8n.cloud` |
| **Hostinger VPS**  | CLI agent runtime              | `31.97.131.41`         |

### SSH Access

Three SSH key pairs enable different access patterns:

| Key                           | Location                       | Direction            | Purpose                  |
| ----------------------------- | ------------------------------ | -------------------- | ------------------------ |
| **Github Authentication key** | 1Password                      | Local/n8n → VPS      | Human + n8n SSH into VPS |
| **github-actions key**        | GitHub Secrets (`N8N_SSH_KEY`) | GitHub Actions → VPS | `n8n-sync.yml` code sync |
| **VPS n8n-agent**             | GitHub Deploy Keys             | VPS → GitHub         | VPS git operations       |

**n8n Cloud Credential** (`VPS SSH`):

| Field       | Value                                   |
| ----------- | --------------------------------------- |
| Host        | `31.97.131.41`                          |
| Port        | `22`                                    |
| Username    | `n8n-agent`                             |
| Private Key | 1Password → "Github Authentication key" |

### Webhooks (Active)

| URL                          | Events                           | Status |
| ---------------------------- | -------------------------------- | ------ |
| `.../webhook/pm-discussions` | Discussions, Discussion comments | Active |
| `.../webhook/pm-issues`      | Issues                           | Active |
| `.../webhook/pm-pulls`       | Pull requests                    | Active |

Base URL: `https://bsamie.app.n8n.cloud`

**Note**: Webhooks configured in GitHub. n8n workflows pending.

---

## Agentic PM System

AI-first project management. Discussions for planning, Issues for execution.

```
INTAKE → EXPLORE → PLAN → [BOARDROOM ⟷ REFINE]* → DECOMPOSE → [HUMAN] → DISPATCH → DONE
```

| Skill       | Trigger                   | Output           |
| ----------- | ------------------------- | ---------------- |
| `explore`   | `planning` label          | Recommendation   |
| `plan`      | explore marker            | PLAN.md draft    |
| `boardroom` | plan marker               | 5-agent critique |
| `refine`    | revise vote               | Refined PLAN.md  |
| `decompose` | approve vote              | Task inventory   |
| `dispatch`  | `dispatch-approved` label | GitHub issues    |

**Orchestration**: n8n detects `<!-- SKILL_COMPLETE: {skill} -->` markers → triggers next skill.

**Human Gate**: Review decomposition before issue dispatch.

See [`AGENTIC_PM_PLAN.md`](AGENTIC_PM_PLAN.md) for full specification.

---

## Key Files

| File                 | Purpose                            |
| -------------------- | ---------------------------------- |
| `labels.yml`         | Label definitions                  |
| `scripts/schema.ts`  | Central constants, dispatch tables |
| `N8N_SETUP.md`       | n8n + VPS setup guide              |
| `AGENTIC_PM_PLAN.md` | PM system specification            |
