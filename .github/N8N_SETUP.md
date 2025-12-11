# n8n Orchestrator Setup

n8n Cloud orchestrates GitHub events. VPS executes CLI agents (Claude Code, Gemini CLI).

---

## [1] Architecture

```
GitHub Event (webhook)
       │
       ▼
n8n Cloud (orchestrator)
       │ SSH Execute Command
       ▼
Hostinger VPS (runtime)
  ├── claude (Claude Code CLI)
  ├── gemini (Gemini CLI)
  ├── gh (GitHub CLI)
  └── git, node, pnpm
       │
       ▼
Results → GitHub (via gh CLI)
```

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

# Create workspace directory
mkdir -p ~/workspace
cd ~/workspace
git clone https://github.com/bsamiee/Parametric_Portal.git
```

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

---

## [4] Workflows

### Workflow 1: Agent Dispatch (Full CLI)

**Trigger**: Issue labeled with `claude` or `gemini`

**Purpose**: Run full CLI agent on VPS, not API call.

```
[GitHub Trigger] → [Switch: Label] → [SSH: Run Agent] → [GitHub: Update Issue]
```

#### Node 1: GitHub Trigger
- Events: `Issues`
- Filter: `action === "labeled"`

#### Node 2: Switch (Route by Label)
- `{{ $json.label.name }}` equals `claude` → Output 1
- `{{ $json.label.name }}` equals `gemini` → Output 2

#### Node 3a: SSH Execute Command (Claude)
- Credential: SSH (n8n-agent)
- Command:
```bash
cd ~/workspace/Parametric_Portal && \
claude --print "Issue #{{ $json.issue.number }}: {{ $json.issue.title }}

{{ $json.issue.body }}

Analyze this issue and provide actionable recommendations. If code changes needed, implement them and create a PR." \
2>&1 | tee /tmp/claude-output-{{ $json.issue.number }}.txt && \
gh issue comment {{ $json.issue.number }} --body-file /tmp/claude-output-{{ $json.issue.number }}.txt
```

#### Node 3b: SSH Execute Command (Gemini)
- Credential: SSH (n8n-agent)
- Command:
```bash
cd ~/workspace/Parametric_Portal && \
gemini --prompt "Issue #{{ $json.issue.number }}: {{ $json.issue.title }}

{{ $json.issue.body }}

Analyze this issue and provide actionable recommendations." \
2>&1 | tee /tmp/gemini-output-{{ $json.issue.number }}.txt && \
gh issue comment {{ $json.issue.number }} --body-file /tmp/gemini-output-{{ $json.issue.number }}.txt
```

#### Node 4: GitHub Node (Update Label)
- Operation: Edit Issue
- Remove: agent label
- Add: `in-progress`

---

### Workflow 2: Project Decomposition

**Trigger**: Issue labeled `planning` + has `project` label

**Purpose**: Claude decomposes PROJECT into TASKs.

```
[GitHub Trigger] → [IF: planning + project] → [SSH: Claude Decompose] → [Code: Parse] → [Loop: Create Issues]
```

#### SSH Command (Claude Decomposition)
```bash
cd ~/workspace/Parametric_Portal && \
claude --print "You are decomposing a PROJECT issue into discrete TASK issues.

PROJECT: {{ $json.issue.title }}
{{ $json.issue.body }}

Output ONLY a JSON array of tasks:
[
  {\"title\": \"[TASK]: ...\", \"body\": \"...\", \"labels\": [\"task\", \"implement\"]}
]

No markdown, no explanation, just valid JSON." > /tmp/decompose-{{ $json.issue.number }}.json && \
cat /tmp/decompose-{{ $json.issue.number }}.json
```

#### Code Node (Parse + Create Issues)
```javascript
const output = $input.first().json.stdout;
const tasks = JSON.parse(output);
const issueNumber = $('GitHub Trigger').first().json.issue.number;

// Create issues via gh CLI would be done in next SSH node
return tasks.map(task => ({ json: { ...task, parentIssue: issueNumber } }));
```

#### Loop → SSH (Create Each Task)
```bash
gh issue create \
  --title "{{ $json.title }}" \
  --body "{{ $json.body }}\n\n---\nParent: #{{ $json.parentIssue }}" \
  --label "{{ $json.labels.join(',') }}"
```

---

### Workflow 3: Status Transition

**Trigger**: PR merged

**Purpose**: Mark linked issues as `done`.

```
[GitHub Trigger: PR] → [IF: merged] → [Code: Extract Issues] → [Loop: Close Issues]
```

#### Code Node
```javascript
const body = $json.pull_request.body || '';
const matches = body.match(/(closes|fixes|resolves)\s+#(\d+)/gi) || [];
return matches.map(m => ({ json: { issueNumber: m.match(/\d+/)[0] } }));
```

#### SSH (Close Issue)
```bash
gh issue close {{ $json.issueNumber }} --comment "Closed via PR merge." && \
gh issue edit {{ $json.issueNumber }} --add-label "done" --remove-label "in-progress"
```

---

## [5] Label → Workflow Mapping

| Label      | Workflow          | Execution                        |
| ---------- | ----------------- | -------------------------------- |
| `claude`   | Agent Dispatch    | SSH → Claude Code CLI on VPS     |
| `gemini`   | Agent Dispatch    | SSH → Gemini CLI on VPS          |
| `planning` | Project Decompose | SSH → Claude decomposes to TASKs |
| (PR merge) | Status Transition | SSH → gh issue close             |

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

- [ ] SSH from n8n Cloud to VPS works
- [ ] `claude --version` runs on VPS
- [ ] `gh auth status` shows authenticated
- [ ] Create test issue, add `claude` label → verify CLI runs
- [ ] Create `[PROJECT]` issue, add `planning` label → verify TASKs created
- [ ] Merge PR with `Closes #N` → verify issue closed

---

## [8] Workflow Lifecycle Mapping

| Phase           | GitHub State                    | n8n Trigger     | n8n Action                     |
| --------------- | ------------------------------- | --------------- | ------------------------------ |
| Plan/Brainstorm | `[SPIKE]` + `idea` label        | Issue opened    | (Optional) Auto-triage         |
| Refine Plan     | `[PROJECT]` + `planning` label  | Issue labeled   | SSH → Claude decomposes TASKs  |
| Critique        | (Gemini governance-sentinel)    | (GitHub Action) | (Existing workflow)            |
| Decompose       | `planning` label added          | Workflow 2      | SSH → Create TASK issues       |
| Codify          | `implement` label               | Agent Dispatch  | SSH → AI generates code        |
| Dispatch        | Agent label (`claude`/`gemini`) | Workflow 1      | SSH → Full CLI agent execution |
| Complete        | PR merged                       | Workflow 3      | SSH → Mark `done`, close       |

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
