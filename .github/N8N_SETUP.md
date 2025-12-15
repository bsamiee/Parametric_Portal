# n8n Orchestrator Setup

n8n Cloud orchestrates GitHub Discussions through PM lifecycle. VPS executes Claude Code CLI via SSH.

---

## Quick Start

### 1. Create SSH Credential in n8n

**Settings → Credentials → Add Credential → SSH**

| Field       | Value          |
| ----------- | -------------- |
| Name        | `VPS SSH`      |
| Host        | `31.97.131.41` |
| Port        | `22`           |
| Username    | `n8n-agent`    |
| Auth Type   | Private Key    |
| Private Key | From 1Password |

### 2. Import Workflows

Import these 3 files from `.github/n8n-workflows/`:
- `PM-Discussions.json`
- `PM-Issues.json`
- `PM-Pulls.json`

For each: n8n → Workflows → Import → select `VPS SSH` credential on SSH nodes → Activate

### 3. Create GitHub Webhooks

**Repo Settings → Webhooks → Add webhook** (create 3)

| Payload URL | Events |
|-------------|--------|
| `https://bsamie.app.n8n.cloud/webhook/pm-discussions` | Discussions |
| `https://bsamie.app.n8n.cloud/webhook/pm-issues` | Issues |
| `https://bsamie.app.n8n.cloud/webhook/pm-pulls` | Pull requests |

All: Content type = `application/json`, Secret = (empty)

---

## Architecture

```
GitHub Webhook Events
       │
       ├─ Discussions → https://bsamie.app.n8n.cloud/webhook/pm-discussions
       │                      │
       │                      ▼
       │                PM-Discussions workflow
       │                      │
       │                      ├─ labeled "planning" → SSH: /pm:explore
       │                      ├─ labeled "critique-pending" → SSH: /pm:boardroom
       │                      ├─ labeled "refine-pending" → SSH: /pm:refine
       │                      ├─ labeled "dispatch-approved" → SSH: /pm:dispatch
       │                      └─ comment with marker → SSH: next skill
       │
       ├─ Issues → https://bsamie.app.n8n.cloud/webhook/pm-issues
       │                 │
       │                 ▼
       │           PM-Issues workflow
       │                 │
       │                 └─ labeled "claude"/"gemini" → SSH: agent implementation
       │
       └─ Pull Requests → https://bsamie.app.n8n.cloud/webhook/pm-pulls
                               │
                               ▼
                         PM-Pulls workflow
                               │
                               └─ closed + merged → SSH: gh issue close
```

---

## Setup Checklist

### Prerequisites (Complete)

- [x] Hostinger VPS KVM 2 (Ubuntu 24.04) — `31.97.131.41`
- [x] n8n Cloud account — `bsamie.app.n8n.cloud`
- [x] VPS user `n8n-agent` with SSH key access
- [x] Repo synced to `~/workspace/Parametric_Portal` (via `n8n-sync.yml`)
- [x] Environment file at `~/.env` (sourced by bashrc, contains API tokens)
- [x] Claude Code, Gemini CLI, Copilot CLI, Codex CLI installed on VPS
- [x] GitHub CLI authenticated on VPS

### n8n Configuration

- [ ] Create `VPS SSH` credential
- [ ] Test SSH: `echo "connected" && whoami` → shows `n8n-agent`
- [ ] Import PM-Discussions.json
- [ ] Import PM-Issues.json
- [ ] Import PM-Pulls.json
- [ ] Activate all 3 workflows

### GitHub Configuration

- [ ] Create webhook for Discussions → `/webhook/pm-discussions`
- [ ] Create webhook for Issues → `/webhook/pm-issues`
- [ ] Create webhook for Pull requests → `/webhook/pm-pulls`

---

## Lifecycle Flow

| Stage     | Trigger                      | SSH Command         |
| --------- | ---------------------------- | ------------------- |
| Explore   | `planning` label             | `/pm:explore {N}`   |
| Plan      | `explore` marker in comment  | `/pm:plan {N}`      |
| Boardroom | `plan` marker OR label       | `/pm:boardroom {N}` |
| Refine    | boardroom revise OR label    | `/pm:refine {N}`    |
| Decompose | boardroom approve            | `/pm:decompose {N}` |
| Dispatch  | `dispatch-approved` label    | `/pm:dispatch {N}`  |
| Implement | `claude`/`gemini` label      | Agent CLI           |
| Done      | PR merged                    | `gh issue close`    |

**Boardroom Loop:** plan → boardroom → [approve→decompose | revise→refine→boardroom]

**Human Gate:** Only `dispatch-approved` requires human action.

---

## Testing

### Test SSH Connectivity

1. Create test workflow with SSH node
2. Command: `echo "connected" && whoami`
3. Expect: `n8n-agent`

### Test Full Flow

1. Create Discussion in Planning category
2. Add `planning` label
3. Watch n8n Executions
4. Verify comment with `<!-- SKILL_COMPLETE: explore -->` appears

---

## Timeouts

| Plan  | Max Duration | Notes                    |
| ----- | ------------ | ------------------------ |
| Start | 3 min        | May timeout on boardroom |
| Pro   | 5 min        | Recommended              |
| Power | 10 min       | Enterprise workloads     |

Boardroom (5 parallel agents) may require Pro plan.
