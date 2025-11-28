# Nx Capabilities Reference

Complete inventory of Nx features: what's enabled, what's missing, and how to enable everything.

**Last Updated**: 2025-11-28

---

## Current Status

| Feature | Status | Config Location |
|---------|--------|-----------------|
| Nx 22.2.0-canary | ✅ | nx.json L2-12 |
| @nx/js, @nx/react, @nx/vite | ✅ | nx.json plugins |
| Crystal inference | ✅ | nx.json L138 |
| Local cache (GitHub Actions) | ✅ | .github/actions/nx-cache/ |
| Affected commands | ✅ | ci.yml |
| nrwl/nx-set-shas | ✅ | nx-cache/action.yml |
| 12 target defaults | ✅ | nx.json L54-136 |
| Named inputs | ✅ | nx.json L13-38 |
| Parallel execution (4) | ✅ | nx.json L40 |
| Project graph artifact | ✅ | ci.yml |

---

## Missing Capabilities

### Priority 1: Immediate (Free, High Impact)

| Capability | Description | Effort |
|------------|-------------|--------|
| **Nx Cloud Remote Cache** | Share cache across CI/developers, 10-50% faster builds | 15 min |
| **Nx Console** | VS Code/JetBrains extension for graph UI, generators | 2 min |
| **CI Pipeline Insights** | Task timing, cache hit rates in dashboard | Automatic with Cloud |

### Priority 2: Nx Cloud Free Tier

| Capability | Description | Effort |
|------------|-------------|--------|
| **Flaky Task Detection** | Auto-identify flaky tests, see analytics | Config change |
| **Flaky Task Retry** | Auto-retry failed tasks on different agent | Config change |
| **Personal Access Tokens** | Developer auth for local remote cache | Developer action |

### Priority 3: Nx Cloud Pro ($249/mo)

| Capability | Description | Benefit |
|------------|-------------|---------|
| **Nx Agents (DTE)** | Distribute tasks across 5+ machines | 3-10x faster CI |
| **Self-Healing CI** | AI auto-fix lint/test failures | Reduced PR friction |
| **Dynamic Agents** | Scale agent count by PR size | Cost optimization |

### Priority 4: Built-in (No External Setup)

| Capability | Description | Effort |
|------------|-------------|--------|
| **Nx Release** | Built-in versioning, changelog, GitHub releases | Config + workflow |
| **Module Boundaries** | Enforce dependency rules via tags | Config change |
| **Local Generators** | Custom scaffolding for new packages | Create plugin |
| **Nx MCP Server** | LLM workspace context for Claude/Cursor | MCP config |
| **Task Graph** | Visualize task dependencies | `nx graph --targets` |

---

## Code Changes Required

### 1. Enable Nx Cloud Remote Cache

Add to `nx.json` after running `npx nx connect`:

```json
{
  "nxCloudId": "YOUR_CLOUD_ID"
}
```

### 2. CI Workflow Token

Add to `.github/workflows/ci.yml`:

```yaml
jobs:
  main:
    runs-on: ubuntu-latest
    env:
      NX_CLOUD_ACCESS_TOKEN: ${{ secrets.NX_CLOUD_ACCESS_TOKEN }}
```

### 3. Enable Flaky Task Retry

Add to `nx.json`:

```json
{
  "tasksRunnerOptions": {
    "default": {
      "options": {
        "useDaemonProcess": true
      }
    }
  }
}
```

Configure retry count in Nx Cloud workspace settings.

### 4. Nx Release Configuration

Add to `nx.json` (replaces custom release.ts):

```json
{
  "release": {
    "projects": ["packages/*"],
    "version": {
      "conventionalCommits": true
    },
    "changelog": {
      "workspaceChangelog": {
        "createRelease": "github",
        "renderOptions": {
          "authors": true,
          "commitReferences": true,
          "versionTitleDate": true
        }
      },
      "projectChangelogs": false
    },
    "conventionalCommits": {
      "types": {
        "feat": { "semverBump": "minor", "changelog": { "title": "Features" } },
        "fix": { "semverBump": "patch", "changelog": { "title": "Bug Fixes" } },
        "perf": { "semverBump": "patch", "changelog": { "title": "Performance" } },
        "refactor": { "semverBump": "patch", "changelog": { "title": "Refactoring" } },
        "docs": { "semverBump": "none", "changelog": { "title": "Documentation" } },
        "chore": { "changelog": false },
        "test": { "changelog": false },
        "style": { "changelog": false }
      }
    },
    "git": {
      "commit": true,
      "tag": true,
      "commitMessage": "chore(release): {version}"
    }
  }
}
```

### 5. Release Workflow Migration

Replace custom release.ts in `.github/workflows/release.yml`:

```yaml
- name: Version and Changelog
  run: |
    npx nx release version --skip-publish
    npx nx release changelog

- name: Create GitHub Release
  run: npx nx release publish --dry-run
  # Remove --dry-run when ready
```

### 6. Module Boundaries (Optional)

Add to `nx.json`:

```json
{
  "targetDefaults": {
    "lint": {
      "inputs": ["default", "{workspaceRoot}/.eslintrc.json"]
    }
  }
}
```

Add project tags to each `package.json`:

```json
{
  "nx": {
    "tags": ["scope:shared", "type:util"]
  }
}
```

### 7. Nx Agents (Pro Plan Only)

Add to CI workflow:

```yaml
- name: Start CI Run
  run: npx nx-cloud start-ci-run --distribute-on="3 linux-medium-js"

- name: Run Tasks
  run: |
    npx nx affected -t lint test build --parallel=3
```

### 8. Self-Healing CI (Pro Plan Only)

Add to start-ci-run:

```yaml
- name: Start CI Run with Self-Healing
  run: |
    npx nx-cloud start-ci-run \
      --distribute-on="3 linux-medium-js" \
      --fix-tasks="lint,test"
```

---

## External Setup Guide

### Step 1: Create Nx Cloud Account

```bash
# Open Nx Cloud
open https://cloud.nx.app

# Connect workspace (interactive)
npx nx connect

# This adds nxCloudId to nx.json automatically
```

### Step 2: Get CI Access Token

1. Go to [cloud.nx.app](https://cloud.nx.app)
2. Select your workspace
3. Navigate to **Workspace Settings** → **CI Access Tokens**
4. Click **Generate Token** (read-write for CI)
5. Copy the token

### Step 3: Add GitHub Secret

1. Go to your GitHub repository
2. **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `NX_CLOUD_ACCESS_TOKEN`
5. Value: paste the token from Step 2

### Step 4: Install Nx Console

**VS Code:**
```bash
code --install-extension nrwl.angular-console
```

**JetBrains:**
- Open **Preferences** → **Plugins** → **Marketplace**
- Search "Nx Console" → Install

### Step 5: Developer Local Cache Access

Each developer runs once:

```bash
# Authenticate with Nx Cloud
npx nx login

# Verify connection
npx nx cloud whoami
```

### Step 6: Configure Nx MCP Server (LLM Integration)

For Claude Code, add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "nx": {
      "command": "npx",
      "args": ["nx", "mcp"]
    }
  }
}
```

For Cursor, add to MCP settings:

```json
{
  "nx": {
    "command": "npx",
    "args": ["nx", "mcp"]
  }
}
```

---

## Nx Cloud Pricing

| Plan | Cost | Key Features |
|------|------|--------------|
| **Hobby** | Free | 500 CI hrs/mo, remote cache, insights, flaky detection |
| **Pro** | $249/mo | Unlimited hours, 5 Nx Agents, Self-Healing CI |
| **Business** | Custom | Unlimited agents, SSO, priority support |

Free tier is sufficient for most projects. Pro recommended when CI > 10 min.

---

## Implementation Checklist

### Immediate (Do Now)
- [ ] Run `npx nx connect` to create Nx Cloud workspace
- [ ] Add `NX_CLOUD_ACCESS_TOKEN` to GitHub secrets
- [ ] Add token to ci.yml env block
- [ ] Install Nx Console extension

### This Week
- [ ] Run `npx nx login` on dev machine
- [ ] Add Nx Release config to nx.json
- [ ] Test release with `npx nx release --dry-run`
- [ ] Configure Nx MCP for Claude/Cursor

### Future (When Needed)
- [ ] Add module boundary tags to packages
- [ ] Evaluate Nx Pro for Agents if CI > 10 min
- [ ] Create local generators for package scaffolding

---

## Command Reference

```bash
# Connect to Nx Cloud
npx nx connect

# Developer login
npx nx login
npx nx cloud whoami

# View project graph
npx nx graph

# View task graph
npx nx graph --targets

# Release (dry-run)
npx nx release --dry-run

# Release (actual)
npx nx release

# Affected commands
npx nx affected -t build
npx nx affected -t test
npx nx affected -t lint

# Show affected projects
npx nx show projects --affected
```

---

## Reference Links

- [Nx Cloud Features](https://nx.dev/ci/features)
- [Nx Release Guide](https://nx.dev/docs/guides/nx-release)
- [Nx Agents (DTE)](https://nx.dev/docs/features/ci-features/distribute-task-execution)
- [Self-Healing CI](https://nx.dev/docs/features/ci-features/self-healing-ci)
- [Flaky Tasks](https://nx.dev/docs/features/ci-features/flaky-tasks)
- [Nx MCP/LLM](https://nx.dev/docs/features/enhance-ai)
- [Module Boundaries](https://nx.dev/docs/recipes/enforce-module-boundaries)
- [Local Generators](https://nx.dev/docs/extending-nx/local-generators)
- [Nx Console](https://nx.dev/docs/getting-started/editor-setup)
