# n8n Orchestrator Setup

n8n Cloud orchestrates GitHub Discussions through PM lifecycle. VPS executes Claude Code CLI via SSH.

---

## [0] Implementation Tasks

### Phase A: Accounts & Prerequisites

| #   | Task                                          | Owner  | Prereq | Status |
| --- | --------------------------------------------- | ------ | ------ | ------ |
| A1  | Sign up for Hostinger VPS (KVM 2)             | Human  | —      | [ ]    |
| A2  | Sign up for n8n Cloud                         | Human  | —      | [ ]    |
| A3  | Create GitHub PAT with `repo` + `admin:org`   | Human  | —      | [ ]    |
| A4  | Generate SSH key pair (for n8n→VPS)           | Human  | —      | [ ]    |
| A5  | Add `checkpoint-required` label to labels.yml | Claude | —      | [x]    |

### Phase B: VPS Setup (Requires A1, A4)

| #   | Task                                        | Owner | Prereq | Status |
| --- | ------------------------------------------- | ----- | ------ | ------ |
| B1  | First SSH to VPS, update system             | Human | A1     | [ ]    |
| B2  | Add SSH public key to VPS root              | Human | A4, B1 | [ ]    |
| B3  | Create `n8n-agent` user with SSH access     | Human | B2     | [ ]    |
| B4  | Install CLI tools (Node 22, 4 AI CLIs)      | Human | B3     | [ ]    |
| B5  | Install and authenticate GitHub CLI         | Human | A3, B4 | [ ]    |
| B6  | Clone repository to `~/workspace/`          | Human | B5     | [ ]    |
| B7  | Set API keys in `.bashrc`                   | Human | B3     | [ ]    |
| B8  | Authenticate AI CLIs (claude, copilot, etc) | Human | B4, B7 | [ ]    |

### Phase C: n8n Setup (Requires A2, B1)

| #   | Task                                            | Owner | Prereq     | Status |
| --- | ----------------------------------------------- | ----- | ---------- | ------ |
| C1  | Create SSH credential (needs VPS IP)            | Human | A2, A4, B1 | [ ]    |
| C2  | Create GitHub API credential                    | Human | A2, A3     | [ ]    |
| C3  | Create GitHub Webhook Secret credential         | Human | A2         | [ ]    |
| C4  | Create Webhook Auth credential                  | Human | A2         | [ ]    |
| C5  | Test SSH connectivity from n8n to VPS           | Human | C1, B3     | [ ]    |

### Phase D: Connect Services (Requires C3)

| #   | Task                                            | Owner | Prereq | Status |
| --- | ----------------------------------------------- | ----- | ------ | ------ |
| D1  | Set `N8N_WEBHOOK_URL` + `N8N_AUTH_TOKEN` on VPS | Human | C4     | [ ]    |
| D2  | Configure GitHub webhook for Discussions        | Human | C3     | [ ]    |
| D3  | Test webhook event reception in n8n             | Human | D2     | [ ]    |

### Phase E: Build PM Workflows (Requires C5)

| #   | Task                                                        | Owner | Prereq | Status |
| --- | ----------------------------------------------------------- | ----- | ------ | ------ |
| E1  | Build Workflow 0: Explore Trigger (`planning` label)        | Human | C5     | [ ]    |
| E2  | Build Workflow 1: Lifecycle Orchestrator (marker detection) | Human | C5, D2 | [ ]    |
| E3  | Build Workflow 2: Boardroom Trigger (`critique-pending`)    | Human | C5     | [ ]    |
| E4  | Build Workflow 3: Refine Trigger (`refine-pending`)         | Human | C5     | [ ]    |
| E5  | Build Workflow 4: Dispatch Trigger (`dispatch-approved`)    | Human | C5     | [ ]    |
| E6  | Build Workflow 5: Agent Implementation (`claude`/`gemini`)  | Human | C5     | [ ]    |
| E7  | Build Workflow 6: Status Transition (PR merged)             | Human | C5     | [ ]    |

### Phase F: Validation

| #   | Task                                                   | Owner | Prereq | Status |
| --- | ------------------------------------------------------ | ----- | ------ | ------ |
| F1  | Test: `planning` label triggers explore                | Human | E1     | [ ]    |
| F2  | Test: Completion marker triggers next skill            | Human | E2     | [ ]    |
| F3  | Test: Boardroom dispatches 5 agents                    | Human | E3     | [ ]    |
| F4  | Test: `dispatch-approved` creates issues               | Human | E5     | [ ]    |
| F5  | End-to-end: Create Discussion → observe full lifecycle | Human | E1-E7  | [ ]    |

---

## [1] Architecture

```
GitHub Discussion (webhook)
       │
       ▼
n8n Cloud (orchestrator)
       │ Detect marker / label
       ▼
SSH Execute Command
       │
       ▼
Hostinger VPS (runtime)
  └── claude '/pm:{skill} {discussion}'
       │
       └── Results → GitHub Discussion
```

**Flow:** GitHub → n8n → SSH → Claude CLI → GitHub (results)

---

## [2] Prerequisites

### `[A1]` Sign Up for Hostinger VPS

1. Go to [hostinger.com/vps-hosting](https://www.hostinger.com/vps-hosting)
2. Select **KVM 2** plan (~$6.49/mo for 24mo: 2 vCPU, 8GB RAM, 100GB NVMe)
3. Choose **Ubuntu 24.04** as OS
4. Complete purchase
5. Open **hPanel** dashboard → note the **IP address**

### `[A2]` Sign Up for n8n Cloud

1. Go to [app.n8n.cloud/register](https://app.n8n.cloud/register)
2. Sign up for **Starter** (free trial) or **Pro** ($50/mo, recommended for boardroom timeouts)
3. Note your instance URL: `https://your-name.app.n8n.cloud`

### `[A3]` Create GitHub PAT

1. Go to [github.com/settings/tokens?type=beta](https://github.com/settings/tokens?type=beta)
2. Click **Generate new token** (fine-grained)
3. Expiration: 90 days recommended
4. Repository access: Select **Parametric_Portal**
5. Permissions:
   - **Repository**: Contents, Issues, Pull requests, Discussions (Read/Write)
   - **Organization**: Members (Read) — if using org features
6. Copy token (starts with `github_pat_`)

### `[A4]` Generate SSH Key Pair

```bash
# Run on your local machine
ssh-keygen -t ed25519 -C "n8n-vps" -f ~/.ssh/n8n-vps
# Press Enter twice (no passphrase for automation)

# View public key (add to VPS)
cat ~/.ssh/n8n-vps.pub

# View private key (add to n8n credential)
cat ~/.ssh/n8n-vps
```

---

## [3] VPS Setup

### `[B1]` First SSH Connection

```bash
# SSH into VPS as root (use password from Hostinger email)
ssh root@YOUR_VPS_IP

# Update system packages
apt update && apt upgrade -y

# Set timezone
timedatectl set-timezone UTC
```

### `[B2]` Add SSH Public Key

```bash
# Still as root on VPS
mkdir -p ~/.ssh
echo "YOUR_PUBLIC_KEY_FROM_A4" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys
```

### `[B3]` Create n8n-agent User

```bash
# As root on VPS
useradd -m -s /bin/bash n8n-agent
mkdir -p /home/n8n-agent/.ssh
cp ~/.ssh/authorized_keys /home/n8n-agent/.ssh/
chown -R n8n-agent:n8n-agent /home/n8n-agent/.ssh
chmod 700 /home/n8n-agent/.ssh
chmod 600 /home/n8n-agent/.ssh/authorized_keys
```

### `[B4]` Install CLI Tools

```bash
# Switch to n8n-agent
su - n8n-agent

# Install nvm + Node.js 22
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc && nvm install 22 && nvm use 22
corepack enable && corepack prepare pnpm@latest --activate

# Install AI CLI agents
npm install -g @anthropic-ai/claude-code  # Claude Code
npm install -g @github/copilot            # GitHub Copilot CLI
npm install -g @openai/codex              # OpenAI Codex CLI
npm install -g @google/gemini-cli         # Google Gemini CLI
```

### `[B5]` Install GitHub CLI

```bash
# As n8n-agent on VPS (requires sudo)
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh -y

# Authenticate with PAT from A3
gh auth login --with-token <<< "YOUR_GITHUB_PAT_FROM_A3"
```

### `[B6]` Clone Repository

```bash
# As n8n-agent
mkdir -p ~/workspace && cd ~/workspace
git clone https://github.com/bsamiee/Parametric_Portal.git

# Cron: auto-pull hourly
(crontab -l 2>/dev/null; echo "0 * * * * cd ~/workspace/Parametric_Portal && git pull origin main") | crontab -
```

### `[B7]` Set API Keys

```bash
# Append to ~/.bashrc
cat >> ~/.bashrc << 'EOF'

# AI CLI API Keys
export ANTHROPIC_API_KEY="sk-ant-..."     # Claude Code
export OPENAI_API_KEY="sk-..."            # Codex CLI
export GEMINI_API_KEY="..."               # Gemini CLI (optional, OAuth available)
export GITHUB_TOKEN="ghp_..."             # GitHub CLI
EOF

source ~/.bashrc
```

### `[B8]` Authenticate AI CLIs

| CLI         | Auth Command              | Requirement                     |
| ----------- | ------------------------- | ------------------------------- |
| Claude Code | `claude` (follow prompts) | Anthropic API key or Claude Pro |
| Copilot CLI | `copilot` → `/login`      | Copilot Pro/Business/Enterprise |
| Codex CLI   | `codex` (follow prompts)  | ChatGPT Plus/Pro/Business       |
| Gemini CLI  | `gemini` (follow prompts) | Google account (free tier)      |

---

## [4] n8n Credentials

### `[C1]` SSH Credential

1. In n8n: Settings → Credentials → Add Credential → **SSH Private Key**
2. Configure:
   - **Name**: `VPS SSH`
   - **Host**: Your VPS IP (from A1)
   - **Port**: `22`
   - **Username**: `n8n-agent`
   - **Private Key**: Paste from `cat ~/.ssh/n8n-vps`

### `[C2]` GitHub API Credential

1. In n8n: Settings → Credentials → Add Credential → **GitHub API**
2. Configure:
   - **Name**: `GitHub API`
   - **Access Token**: Your PAT from A3

### `[C3]` GitHub Webhook Secret

1. In n8n: Settings → Credentials → Add Credential → **Generic**
2. Configure:
   - **Name**: `GitHub Webhook Secret`
   - **Secret**: Generate secure value (use same in GitHub webhook)

### `[C4]` Webhook Auth Credential

1. In n8n: Settings → Credentials → Add Credential → **Header Auth**
2. Configure:
   - **Name**: `Webhook Auth`
   - **Header Name**: `X-Auth-Token`
   - **Header Value**: Generate secure token (save for D1)

---

## [5] Connect Services

### `[D1]` Set Webhook Environment Variables on VPS

```bash
# As n8n-agent, add to ~/.bashrc
cat >> ~/.bashrc << 'EOF'
export N8N_WEBHOOK_URL="https://your-n8n.app.n8n.cloud/webhook/pm-lifecycle"
export N8N_AUTH_TOKEN="your-token-from-C4"
EOF

source ~/.bashrc
```

### `[D2]` Configure GitHub Webhook

See **[7] GitHub Webhook Setup** for full instructions.

### `[D3]` Test Webhook Reception

1. Create a test Discussion in GitHub repo
2. Add any label to trigger webhook
3. Check n8n executions: `https://your-n8n.app.n8n.cloud/executions`
4. Verify payload contains `discussion.number` and `label.name`

---

## [6] Workflows

### SSH Command Format

```bash
cd ~/workspace/Parametric_Portal && claude '/pm:{command} {discussion_number}'
```

### Governance Check (run before skill execution)

```bash
claude '/pm:govern {N} {stage}'  # Returns PASS or FAIL
```

On FAIL → add `drift-flagged` label, halt pipeline.

---

### `[E1]` Workflow 0: Explore Trigger

**Trigger:** Discussion labeled `planning`

```
[GitHub Trigger: Label Added] → [IF: planning?]
  → [SSH: claude '/pm:explore {N}']
```

---

### `[E2]` Workflow 1: Lifecycle Orchestrator

**Trigger:** Discussion comment created (webhook)

```
[Webhook: /pm-lifecycle] → [Code: Extract Marker] → [IF: Marker?]
  → YES → [SSH: Governance] → [IF: PASS?]
            → YES → [Switch: Route] → [SSH: Next Skill]
            → NO  → [GitHub: Add drift-flagged]
  → NO  → [No-Op]
```

**Marker Detection (Code Node):**

```javascript
const body = $json.comment?.body || $json.discussion?.body || "";
const match = body.match(/<!-- SKILL_COMPLETE: (\w+) -->/);
return match
  ? { json: { ...$json, skill: match[1], discussion: $json.discussion.number } }
  : { json: { ...$json, skill: null } };
```

**Routing Table:**

| Marker      | Next Command    | Condition                       |
| ----------- | --------------- | ------------------------------- |
| `explore`   | `/pm:plan`      | Always                          |
| `plan`      | `/pm:boardroom` | Always                          |
| `boardroom` | `/pm:decompose` | Vote = approve                  |
| `boardroom` | `/pm:refine`    | Vote = revise                   |
| `refine`    | `/pm:boardroom` | Always (cycle N+1)              |
| `decompose` | —               | Await `dispatch-approved` label |

---

### `[E3]` Workflow 2: Boardroom Trigger

**Trigger:** Discussion labeled `critique-pending`

```
[GitHub Trigger] → [IF: critique-pending?]
  → [SSH: Governance] → [IF: PASS?]
    → [SSH: claude '/pm:boardroom {N}']
```

---

### `[E4]` Workflow 3: Refine Trigger

**Trigger:** Discussion labeled `refine-pending`

```
[GitHub Trigger] → [IF: refine-pending?]
  → [SSH: claude '/pm:refine {N}']
```

---

### `[E5]` Workflow 4: Dispatch Trigger

**Trigger:** Discussion labeled `dispatch-approved`

```
[GitHub Trigger] → [IF: dispatch-approved?]
  → [SSH: claude '/pm:dispatch {N}']
```

---

### `[E6]` Workflow 5: Agent Implementation

**Trigger:** Issue labeled `claude` or `gemini`

```
[GitHub Trigger: Issue Labeled] → [Switch: Agent]
  → claude → [SSH: Claude implementation]
  → gemini → [SSH: Gemini implementation]
```

**SSH (Claude):**

```bash
claude "Implement issue #{N}: {title}\n\n{body}\n\nFollow acceptance criteria. Create PR when complete."
```

---

### `[E7]` Workflow 6: Status Transition

**Trigger:** PR merged

```
[GitHub Trigger: PR] → [IF: merged] → [Code: Extract Issues] → [Loop: Close]
```

**Extract Issues (Code Node):**

```javascript
const body = $json.pull_request.body || '';
const matches = body.match(/(closes|fixes|resolves)\s+#(\d+)/gi) || [];
return matches.map(m => ({ json: { issue: m.match(/\d+/)[0] } }));
```

**Close Issue:**

```bash
gh issue close {N} --comment "Closed via PR merge." && \
gh issue edit {N} --add-label "done" --remove-label "in-progress"
```

---

## [7] GitHub Webhook Setup

**Note:** n8n has no native Discussions trigger. Use generic Webhook.

1. Repo Settings → Webhooks → Add webhook
2. Payload URL: `https://your-n8n.app.n8n.cloud/webhook/pm-lifecycle`
3. Content type: `application/json`
4. Secret: Use value from C3
5. Events: Select "Discussions" + "Discussion comments"

**HMAC Validation (Code Node):**

```javascript
const crypto = require('crypto');
const secret = $credentials.webhookSecret;
const sig = $request.headers['x-hub-signature-256'];
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify($json)).digest('hex');
if (sig !== expected) throw new Error('Invalid signature');
```

---

## [8] Lifecycle Summary

| Stage     | Trigger                     | Workflow              | SSH Command         |
| --------- | --------------------------- | --------------------- | ------------------- |
| Explore   | `planning` label            | E1: Explore Trigger   | `/pm:explore {N}`   |
| Plan      | `explore` marker            | E2: Orchestrator      | `/pm:plan {N}`      |
| Boardroom | `plan` marker               | E2: Orchestrator      | `/pm:boardroom {N}` |
| Refine    | `boardroom` marker (revise) | E2: Orchestrator      | `/pm:refine {N}`    |
| Decompose | `boardroom` marker (approve)| E2: Orchestrator      | `/pm:decompose {N}` |
| Dispatch  | `dispatch-approved` label   | E5: Dispatch Trigger  | `/pm:dispatch {N}`  |
| Implement | `claude`/`gemini` label     | E6: Agent Impl        | Agent CLI           |
| Done      | PR merged                   | E7: Status Transition | `gh issue close`    |

**Boardroom Loop:** `plan → boardroom → [approve→decompose | revise→refine→boardroom]` (max 3 cycles)

**Human Gate:** Only `dispatch-approved` requires human action.

---

## [9] Security

- **SSH:** Private key auth only, dedicated `n8n-agent` user
- **n8n Cloud:** Minimum version 1.119.2+ (critical patches)
- **Timeouts:** Boardroom (5 parallel agents) may require Pro+ plan

| Plan  | Max Duration | Notes                    |
| ----- | ------------ | ------------------------ |
| Start | 3 min        | May timeout on boardroom |
| Pro   | 5 min        | Recommended              |
| Power | 10 min       | Enterprise workloads     |

---

## [10] Validation Commands

### `[C5]` SSH Connectivity Test

```bash
# In n8n SSH node
cd ~/workspace/Parametric_Portal && git status
# Expect: On branch main, clean working tree
```

### VPS Health Check

```bash
# Run on VPS as n8n-agent
node --version            # Expect: v22.x.x
claude --version          # Expect: 1.x.x
copilot --version         # Expect: 0.x.x
codex --version           # Expect: 0.x.x
gemini --version          # Expect: 0.x.x
gh auth status            # Expect: Logged in
echo $N8N_WEBHOOK_URL     # Expect: https://...
```

### `[F1]` Test Explore Trigger

1. Create Discussion in **Planning** category
2. Add `planning` label
3. Verify: E1 executes, SSH runs `/pm:explore {N}`
4. Verify: Comment posted with `<!-- SKILL_COMPLETE: explore -->`

### `[F2]` Test Lifecycle Orchestrator

1. After F1 completes, E2 should auto-trigger
2. Verify: Marker detected → governance runs → `/pm:plan {N}` executes
3. Verify: Comment posted with `<!-- SKILL_COMPLETE: plan -->`

### `[F3]` Test Boardroom

1. After plan completes, boardroom should auto-trigger
2. Verify: 5 agent tasks spawn in parallel
3. Verify: Vote summary posted (approve/revise/block)
4. Verify: `<!-- SKILL_COMPLETE: boardroom -->` marker

### `[F4]` Test Dispatch

1. After decompose completes, manually add `dispatch-approved` label
2. Verify: E5 triggers `/pm:dispatch {N}`
3. Verify: GitHub issues created with `task` + `implement` labels
