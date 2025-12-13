# n8n Orchestrator Setup

n8n Cloud orchestrates GitHub Discussions through PM lifecycle. VPS executes Claude Code CLI via SSH.

---

## [1] Architecture

```
GitHub Discussion (webhook)
       │
       ▼
n8n Cloud (orchestrator) ◄─────────────────┐
       │ Detect completion marker          │ Tool events (PostToolUse)
       ▼                                   │
SSH Execute Command                        │
       │                                   │
       ▼                                   │
Hostinger VPS (runtime)                    │
  └── claude '/pm:{skill} {discussion}'    │
       │                                   │
       ├── Results → GitHub Discussion     │
       └── webhook-emit.py ────────────────┘
```

**Bidirectional Flow:**
- **Inbound**: GitHub → n8n → SSH → Claude CLI → GitHub
- **Outbound**: Claude CLI → webhook-emit.py → n8n (real-time tool events)

---

## [2] VPS Setup (Hostinger)

### [2.1] Provision

1. Hostinger VPS: KVM 2 (2 vCPU, 8GB RAM, ~$8.99/mo)
2. OS: Ubuntu 24.04 LTS
3. Note the IP address and set up SSH key access

### [2.2] Install CLI Tools

```bash
# Connect to VPS
ssh root@YOUR_VPS_IP

# Create non-root user for n8n execution
useradd -m -s /bin/bash n8n-agent
mkdir -p /home/n8n-agent/.ssh
cp ~/.ssh/authorized_keys /home/n8n-agent/.ssh/
chown -R n8n-agent:n8n-agent /home/n8n-agent/.ssh

# Switch to agent user
su - n8n-agent

# Install Node.js (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22

# Install pnpm
corepack enable
corepack prepare pnpm@latest --activate

# Install Claude Code CLI
npm install -g @anthropic-ai/claude-code

# Install Gemini CLI
npm install -g @anthropic-ai/gemini-cli  # TODO: verify actual package name

# Install GitHub CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh -y

# Authenticate GitHub CLI
gh auth login
```

### [2.3] Configure Environment

```bash
# /home/n8n-agent/.bashrc (append)
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="..."
export GITHUB_TOKEN="ghp_..."

# n8n webhook integration (tool event emission)
export N8N_WEBHOOK_URL="https://your-n8n.app.n8n.cloud/webhook/tool-events"
export N8N_AUTH_TOKEN="your-secret-token"  # Optional: header auth

# Create workspace directory
mkdir -p ~/workspace
cd ~/workspace
git clone https://github.com/bsamiee/Parametric_Portal.git
```

**Webhook URL**: Obtain from n8n Cloud after creating the Tool Event Receiver workflow (see Workflow 7).

---

## [3] n8n Cloud Credentials

### [3.1] SSH Credential

**Type**: SSH Password or SSH Private Key

| Field       | Value                                 |
| ----------- | ------------------------------------- |
| Host        | Your VPS IP                           |
| Port        | 22                                    |
| Username    | n8n-agent                             |
| Private Key | Your SSH private key (paste full key) |

### [3.2] GitHub Credential

**Type**: GitHub API

| Field        | Value             |
| ------------ | ----------------- |
| Access Token | GitHub PAT (repo) |

### [3.3] Webhook Auth Credential

**Type**: Header Auth (for Tool Event Receiver)

| Field        | Value                                  |
| ------------ | -------------------------------------- |
| Name         | X-Auth-Token                           |
| Value        | Shared secret (matches `N8N_AUTH_TOKEN` on VPS) |

---

## [4] PM Lifecycle Workflows

### [4.1] Discussion Webhook Setup

**Critical:** n8n has NO native GitHub Discussions trigger. Use generic Webhook node.

**GitHub Configuration:**

1. Repo Settings → Webhooks → Add webhook
2. Payload URL: n8n Webhook production URL
3. Content type: `application/json`
4. Events: Select "Discussions" and "Discussion comments"
5. Secret: Store in n8n credentials for HMAC validation

**n8n Webhook Node:**

- Authentication: Header Auth (X-Hub-Signature-256)
- HTTP Method: POST
- Path: `/pm-lifecycle`

---

### [4.2] Completion Marker Detection

**Code Node Pattern:**

```javascript
const body = $json.comment?.body || $json.discussion?.body || "";
const markerMatch = body.match(/<!-- SKILL_COMPLETE: (\w+) -->/);

if (markerMatch) {
  return {
    json: {
      ...$json,
      skill_complete: markerMatch[1],
      discussion_number: $json.discussion.number,
      node_id: $json.discussion.node_id
    }
  };
}
return { json: { ...$json, skill_complete: null } };
```

---

### [4.3] PM Command Invocation

**SSH Command Format:**

```bash
cd ~/workspace/Parametric_Portal && \
claude '/pm:{{ $json.next_skill }} {{ $json.discussion_number }}'
```

**Skill Routing (Switch Node):**

| Detected Marker | Next Command | Condition |
|-----------------|--------------|-----------|
| `explore` | `/pm:plan` | Always |
| `plan` | `/pm:boardroom` | Always |
| `boardroom` | `/pm:decompose` | Vote = approve |
| `boardroom` | `/pm:refine` | Vote = revise |
| `refine` | `/pm:boardroom` | Always (cycle N+1) |
| `decompose` | `/pm:dispatch` | `dispatch-approved` label |

---

### Workflow 1: Lifecycle Orchestrator

**Trigger:** Discussion comment created (webhook)

**Purpose:** Detect completion markers → run governance → trigger next PM skill

```
[Webhook] → [Code: Extract Marker] → [IF: Marker Found?]
  → YES → [SSH: Governance Check] → [IF: PASS?]
            → YES → [Switch: Route to Next Skill] → [SSH: Run PM Command]
            → NO  → [GitHub: Add drift-flagged label]
  → NO  → [No Operation]
```

**SSH: Governance Check:**

```bash
cd ~/workspace/Parametric_Portal && \
claude '/pm:govern {{ $json.discussion_number }} {{ $json.skill_complete }}'
```

---

### Workflow 2: Boardroom Trigger

**Trigger:** Discussion labeled `critique-pending`

**Purpose:** Initiate 5-agent boardroom critique

```
[GitHub Trigger: Label Added] → [IF: critique-pending?]
  → [SSH: claude '/pm:boardroom {{ $json.discussion.number }}']
```

**SSH Command:**

```bash
cd ~/workspace/Parametric_Portal && \
claude '/pm:boardroom {{ $json.discussion.number }}'
```

---

### Workflow 3: Refine Trigger

**Trigger:** Discussion labeled `refine-pending`

**Purpose:** Incorporate boardroom critique into plan

```
[GitHub Trigger: Label Added] → [IF: refine-pending?]
  → [SSH: claude '/pm:refine {{ $json.discussion.number }}']
```

**SSH Command:**

```bash
cd ~/workspace/Parametric_Portal && \
claude '/pm:refine {{ $json.discussion.number }}'
```

---

### Workflow 4: Dispatch Trigger

**Trigger:** Discussion labeled `dispatch-approved`

**Purpose:** Create GitHub issues from approved decomposition

```
[GitHub Trigger: Label Added] → [IF: dispatch-approved?]
  → [SSH: claude '/pm:dispatch {{ $json.discussion.number }}']
```

**SSH Command:**

```bash
cd ~/workspace/Parametric_Portal && \
claude '/pm:dispatch {{ $json.discussion.number }}'
```

---

### Workflow 5: Agent Implementation

**Trigger:** Issue labeled `claude` or `gemini`

**Purpose:** Execute implementation work on approved tasks

```
[GitHub Trigger: Issue Labeled] → [Switch: Agent Label]
  → claude → [SSH: Implement with Claude]
  → gemini → [SSH: Implement with Gemini]
```

**SSH Command (Claude):**

```bash
cd ~/workspace/Parametric_Portal && \
claude "Implement issue #{{ $json.issue.number }}: {{ $json.issue.title }}

{{ $json.issue.body }}

Follow acceptance criteria. Create PR when complete."
```

---

### Workflow 6: Status Transition

**Trigger:** PR merged

**Purpose:** Mark linked issues as `done`

```
[GitHub Trigger: PR] → [IF: merged] → [Code: Extract Issues] → [Loop: Close Issues]
```

**Code Node:**

```javascript
const body = $json.pull_request.body || '';
const matches = body.match(/(closes|fixes|resolves)\s+#(\d+)/gi) || [];
return matches.map(m => ({ json: { issueNumber: m.match(/\d+/)[0] } }));
```

**SSH (Close Issue):**

```bash
gh issue close {{ $json.issueNumber }} --comment "Closed via PR merge." && \
gh issue edit {{ $json.issueNumber }} --add-label "done" --remove-label "in-progress"
```

---

### Workflow 7: Tool Event Receiver

**Trigger:** Webhook (POST from Claude Code `webhook-emit.py` hook)

**Purpose:** Receive real-time tool execution events from Claude CLI for observability, metrics, and dashboards.

```
[Webhook: /tool-events] → [Code: Validate Event] → [Switch: Route by Tool]
  → Bash|Task → [Aggregate: Session Metrics]
  → Edit|Write → [Counter: File Changes]
  → * → [Log: General Events]
```

**Webhook Node Configuration:**

- HTTP Method: POST
- Path: `/tool-events`
- Authentication: Header Auth (`X-Auth-Token`)
- Response Mode: Immediately (fire-and-forget from Claude)

**Event Schema (from webhook-emit.py):**

```typescript
interface ToolEvent {
  timestamp: string;      // ISO 8601 UTC
  session_id: string;     // Claude session ID
  tool_name: string;      // "Bash", "Edit", "Write", "Task", etc.
  tool_input: object;     // Tool parameters
  success: boolean;       // Execution result
  project: string;        // "Parametric_Portal"
}
```

**Code Node (Validate Event):**

```javascript
const required = ['timestamp', 'session_id', 'tool_name', 'success', 'project'];
const missing = required.filter(k => !$json[k]);

if (missing.length > 0) {
  throw new Error(`Missing fields: ${missing.join(', ')}`);
}

return {
  json: {
    ...$json,
    received_at: new Date().toISOString(),
    event_type: $json.tool_name.toLowerCase()
  }
};
```

**Metrics Use Cases:**

| Metric | Calculation | Use |
|--------|-------------|-----|
| Tool frequency | Count by `tool_name` | Agent behavior analysis |
| Session duration | Max - Min `timestamp` per `session_id` | Execution time tracking |
| Success rate | `success=true` / total | Quality monitoring |
| File changes | Count `Edit`/`Write` events | Code velocity |
| Subagent spawns | Count `Task` events | Parallelization metrics |

**Storage Options:**

- **Google Sheets**: Quick dashboards, no setup
- **PostgreSQL**: Production-grade, complex queries
- **Prometheus**: Time-series metrics, Grafana integration

---

## [5] PM Label → Workflow Mapping

| Label | Workflow | SSH Command |
|-------|----------|-------------|
| `critique-pending` | Boardroom Trigger | `claude '/pm:boardroom {N}'` |
| `refine-pending` | Refine Trigger | `claude '/pm:refine {N}'` |
| `dispatch-approved` | Dispatch Trigger | `claude '/pm:dispatch {N}'` |
| `claude` | Agent Implementation | `claude 'Issue #{N}'` |
| `gemini` | Agent Implementation | `gemini 'Issue #{N}'` |
| (marker detected) | Lifecycle Orchestrator | `claude '/pm:{next} {N}'` |
| (PR merged) | Status Transition | `gh issue close` |

**Governance Labels:**

| Label | Applied By | Meaning |
|-------|------------|---------|
| `drift-flagged` | Governance agent | Output failed alignment check |
| `scope` | Decompose skill | Tasks have acceptance criteria |

---

## [6] VPS Maintenance

### Keep Repo Updated
```bash
# Cron job on VPS (as n8n-agent)
crontab -e

# Add:
0 * * * * cd ~/workspace/Parametric_Portal && git pull origin main
```

### Monitor Disk Space
```bash
# SSH command from n8n (optional health check workflow)
df -h /home/n8n-agent && rm -f /tmp/claude-output-*.txt /tmp/gemini-output-*.txt
```

---

## [7] Testing Checklist

### [7.1] Infrastructure

- [ ] SSH from n8n Cloud to VPS works
- [ ] `claude --version` returns 1.0.0+ on VPS
- [ ] `gh auth status` shows authenticated
- [ ] Discussion webhook receives events in n8n

### [7.2] PM Lifecycle

- [ ] Completion marker detection extracts skill name correctly
- [ ] `/pm:explore` command runs via SSH
- [ ] `/pm:plan` command runs via SSH
- [ ] `/pm:boardroom` dispatches 5 agents
- [ ] `/pm:govern` returns PASS/FAIL verdict
- [ ] Boardroom trigger fires on `critique-pending` label
- [ ] Refine trigger fires on `refine-pending` label
- [ ] Dispatch trigger fires on `dispatch-approved` label
- [ ] `drift-flagged` label applied on governance FAIL

### [7.3] Implementation

- [ ] Agent implementation runs on `claude` label
- [ ] PR merge closes linked issues
- [ ] `done` label applied after merge

### [7.4] Tool Event Emission

- [ ] `N8N_WEBHOOK_URL` configured on VPS
- [ ] Webhook endpoint responds (200 OK)
- [ ] Events received in n8n on tool execution
- [ ] Event schema validated (timestamp, session_id, tool_name, success, project)
- [ ] Header auth token validated (`X-Auth-Token`)

**Manual Test:**

```bash
# From VPS, test webhook connectivity
curl -X POST "$N8N_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: $N8N_AUTH_TOKEN" \
  -d '{"timestamp":"2025-12-13T00:00:00Z","session_id":"test","tool_name":"Bash","tool_input":{},"success":true,"project":"Parametric_Portal"}'
```

---

## [8] PM Lifecycle Mapping

| Stage | GitHub State | n8n Trigger | SSH Command |
|-------|--------------|-------------|-------------|
| Intake | Discussion created | (Manual) | — |
| Explore | `planning` label | Lifecycle Orchestrator | `/pm:explore {N}` |
| Plan | `<!-- SKILL_COMPLETE: explore -->` | Lifecycle Orchestrator | `/pm:plan {N}` |
| Boardroom | `critique-pending` label | Boardroom Trigger | `/pm:boardroom {N}` |
| Refine | `refine-pending` label | Refine Trigger | `/pm:refine {N}` |
| Decompose | Boardroom approve vote | Lifecycle Orchestrator | `/pm:decompose {N}` |
| Dispatch | `dispatch-approved` label | Dispatch Trigger | `/pm:dispatch {N}` |
| Implement | Issue + `claude` label | Agent Implementation | Agent CLI |
| Done | PR merged | Status Transition | `gh issue close` |

**Boardroom Loop:**

```
plan → boardroom → [approve] → decompose
                → [revise]  → refine → boardroom (cycle N+1, max 3)
                → [block]   → HALT (human intervention)
```

**Human Gate:** Only `dispatch-approved` requires human action. All other transitions are autonomous.

---

## [9] Comparison: API vs CLI

| Aspect     | API Call (old)          | CLI Agent (new)              |
| ---------- | ----------------------- | ---------------------------- |
| Tool use   | None                    | Full (file access, git, etc) |
| Multi-turn | Single request/response | Interactive session          |
| Context    | Prompt only             | Full codebase access         |
| Actions    | Response text only      | Can create PRs, edit files   |
| Cost       | Per token               | Per token (same)             |
| Latency    | Fast (single call)      | Slower (agent runs)          |

---

## [10] Security Requirements

### [10.1] n8n Version

**Minimum:** 1.119.2+

**CVE-2025-65964** (December 2025):

- Critical RCE vulnerability in Git node
- CVSS: 9.4 (Critical)
- Affected: 0.123.1 - 1.119.1
- Mitigation: Upgrade to 1.119.2+ immediately

### [10.2] n8n 2.0 Changes (December 2025)

- Task runners enabled by default (Code node isolation)
- Execute Command node disabled by default (self-hosted only)
- Environment variable access blocked from Code nodes
- Publish/Save paradigm for workflow deployment

### [10.3] SSH Security

- Use private key authentication (not passwords)
- Dedicated `n8n-agent` user with minimal permissions
- Credentials stored in n8n encrypted credential manager
- Rotate keys periodically

### [10.4] Webhook Security

**HMAC Validation (recommended):**

```javascript
const crypto = require('crypto');
const secret = $credentials.webhookSecret;
const signature = $request.headers['x-hub-signature-256'];
const payload = JSON.stringify($json);

const expected = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(payload)
  .digest('hex');

if (signature !== expected) {
  throw new Error('Invalid webhook signature');
}
```

---

## [11] Cloud Constraints

### [11.1] Timeout Limits

| Plan | Max Workflow Duration |
|------|----------------------|
| Start | 3 minutes |
| Pro | 5 minutes |
| Power | 10 minutes |

**Implication:** PM commands must complete within plan limit. Boardroom skill (5 parallel agents) may require Pro or Power plan.

### [11.2] Available Nodes

| Node | n8n Cloud | Self-Hosted |
|------|-----------|-------------|
| SSH | ✓ Available | ✓ Available |
| Execute Command | ✗ Blocked | ✓ (disabled by default in 2.0) |
| Webhook | ✓ Available | ✓ Available |
| GitHub Trigger | ✓ (Issues/PRs only) | ✓ (Issues/PRs only) |

**Note:** GitHub Discussions trigger requires generic Webhook node on all platforms.

### [11.3] Concurrency

- Concurrent executions limited by plan tier
- Executions exceeding limit queued FIFO
- Consider workflow execution time for capacity planning
