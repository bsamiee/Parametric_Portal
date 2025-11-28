# Nx Capabilities Reference

Complete inventory of Nx features: what's enabled, what's available, and configuration details.

**Last Updated**: 2025-11-28

---

## Current Status

| Feature | Status | Config Location |
|---------|--------|-----------------|
| Nx 22.2.0-canary | ✅ | nx.json L97-101 |
| @nx/js, @nx/react, @nx/vite | ✅ | nx.json plugins |
| Crystal inference | ✅ | nx.json L173 |
| Local cache (GitHub Actions) | ✅ | .github/actions/nx-setup/ |
| Affected commands | ✅ | ci.yml |
| nrwl/nx-set-shas | ✅ | nx-setup/action.yml |
| 12 target defaults | ✅ | nx.json L161-271 |
| Named inputs | ✅ | nx.json L103-141 |
| Parallel execution (4) | ✅ | nx.json L144 |
| Project graph artifact | ✅ | ci.yml |
| **Nx Cloud Remote Cache** | ✅ | nx.json nxCloudId |
| **CI Pipeline Insights** | ✅ | Automatic with Cloud |
| **Self-Healing CI** | ✅ | ci.yml (nx fix-ci) |
| **Nx Release** | ✅ | nx.json L5-95 |
| **Conventional Commits** | ✅ | nx.json release.conventionalCommits |
| **GitHub Release Creation** | ✅ | nx.json createRelease: "github" |
| **Changelog Generation** | ✅ | nx.json workspaceChangelog |
| **Command Recording** | ✅ | ci.yml (nx-cloud record) |
| **Optimized Checkout** | ✅ | ci.yml (filter: tree:0) |

**Workspace ID**: `6929c006315634b45342f623`
**Dashboard**: https://cloud.nx.app

---

## Nx Release Configuration

The full release configuration in `nx.json`:

```json
{
  "release": {
    "projects": ["packages/*"],
    "projectsRelationship": "fixed",
    "releaseTagPattern": "v{version}",
    "git": {
      "commit": true,
      "commitMessage": "chore(release): v{version}",
      "tag": true,
      "stageChanges": true
    },
    "version": {
      "conventionalCommits": true,
      "preVersionCommand": "pnpm exec nx run-many -t build --parallel=4"
    },
    "changelog": {
      "workspaceChangelog": {
        "file": "CHANGELOG.md",
        "createRelease": "github",
        "renderOptions": {
          "authors": true,
          "applyUsernameToAuthors": true,
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
        "perf": { "semverBump": "patch", "changelog": { "title": "Performance Improvements" } },
        "refactor": { "semverBump": "none", "changelog": { "title": "Code Refactoring" } },
        "docs": { "semverBump": "none", "changelog": { "title": "Documentation" } },
        "test": { "semverBump": "none", "changelog": { "hidden": true } },
        "chore": { "semverBump": "none", "changelog": { "hidden": true } },
        "style": { "semverBump": "none", "changelog": { "hidden": true } },
        "ci": { "semverBump": "none", "changelog": { "hidden": true } },
        "build": { "semverBump": "none", "changelog": { "hidden": true } }
      }
    }
  }
}
```

### Commit Type → Version Bump Mapping

| Commit Type | Version Bump | Changelog Section |
|-------------|--------------|-------------------|
| `feat` | minor | Features |
| `fix` | patch | Bug Fixes |
| `perf` | patch | Performance Improvements |
| `refactor` | none | Code Refactoring |
| `docs` | none | Documentation |
| `test` | none | (hidden) |
| `chore` | none | (hidden) |
| `style` | none | (hidden) |
| `ci` | none | (hidden) |
| `build` | none | (hidden) |
| `BREAKING CHANGE` / `!` | major | Breaking Changes |

### Release Workflow

The release workflow (`.github/workflows/release.yml`) uses Nx Release:

```yaml
# Auto release (conventional commits)
pnpm exec nx release --skip-publish --yes

# Manual release with specific bump
pnpm exec nx release --skip-publish --specifier=minor --yes

# Dry run preview
pnpm exec nx release --skip-publish --dry-run --verbose
```

---

## CI Pipeline Features

### Self-Healing CI

Enabled via `nx fix-ci` command that runs after all tasks (even on failure):

```yaml
- name: Self-Healing CI
  if: always()
  run: pnpm exec nx fix-ci
  continue-on-error: true
```

Provides AI-powered recommendations for fixing CI failures (requires Nx Cloud AI features).

### Command Recording

Key commands are recorded to Nx Cloud for debugging:

```yaml
- name: Generate Nx Graph
  run: pnpm exec nx-cloud record -- pnpm exec nx graph --file=.nx/project-graph.json

- name: Check code style and linting
  run: pnpm exec nx-cloud record -- pnpm check
```

### Optimized Checkout

Uses `filter: tree:0` for faster partial clone:

```yaml
- name: Checkout
  uses: actions/checkout@v6
  with:
    fetch-depth: 0
    filter: tree:0
```

---

## Available Capabilities

### Free (Already Available)

| Capability | Description | Status |
|------------|-------------|--------|
| **Nx Console** | VS Code/JetBrains extension for graph UI, generators | Optional |
| **Developer Login** | Local remote cache access via `nx login` | Optional |
| **Flaky Task Detection** | Auto-identify flaky tests in Cloud dashboard | ✅ |
| **Personal Access Tokens** | Developer auth for local remote cache | Optional |

### Nx Cloud Pro ($249/mo) - Future

| Capability | Description | Benefit |
|------------|-------------|---------|
| **Nx Agents (DTE)** | Distribute tasks across 5+ machines | 3-10x faster CI |
| **Dynamic Agents** | Scale agent count by PR size | Cost optimization |
| **AI Self-Healing** | Enhanced AI-powered fix suggestions | Reduced PR friction |

### Built-in (No External Setup)

| Capability | Description | Status |
|------------|-------------|--------|
| **Nx Release** | Built-in versioning, changelog, GitHub releases | ✅ Configured |
| **Module Boundaries** | Enforce dependency rules via tags | Not configured |
| **Local Generators** | Custom scaffolding for new packages | Not configured |
| **Nx MCP Server** | LLM workspace context for Claude/Cursor | Optional |
| **Task Graph** | Visualize task dependencies | Available |

---

## External Setup Guide

### Step 1: Developer Local Cache Access

Each developer runs once:

```bash
# Authenticate with Nx Cloud
pnpm exec nx login

# Verify connection
pnpm exec nx cloud whoami
```

### Step 2: Install Nx Console (Optional)

**VS Code:**
```bash
code --install-extension nrwl.angular-console
```

**JetBrains:**
- Open **Preferences** → **Plugins** → **Marketplace**
- Search "Nx Console" → Install

### Step 3: Configure Nx MCP Server (Optional)

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

---

## Module Boundaries (Optional)

To enforce dependency rules, add project tags:

**In package.json:**
```json
{
  "nx": {
    "tags": ["scope:shared", "type:util"]
  }
}
```

**In nx.json (targetDefaults):**
```json
{
  "targetDefaults": {
    "lint": {
      "inputs": ["default", "{workspaceRoot}/biome.json"]
    }
  }
}
```

---

## Nx Agents Distribution (Pro Only)

When CI exceeds 10 minutes, consider enabling distributed task execution:

```yaml
- name: Start CI Run
  run: npx nx-cloud start-ci-run --distribute-on="3 linux-medium-js" --stop-agents-after="build"

- name: Run Tasks
  run: pnpm exec nx affected -t lint test build --parallel=3

- name: Self-Healing
  if: always()
  run: pnpm exec nx fix-ci
```

---

## Implementation Checklist

### Completed ✅
- [x] Nx Cloud workspace connected (`nxCloudId` in nx.json)
- [x] `NX_CLOUD_ACCESS_TOKEN` in GitHub secrets
- [x] Token configured in ci.yml env block
- [x] Workspace data caching enabled
- [x] Flaky task retry configured in Cloud
- [x] Nx Release fully configured in nx.json
- [x] Release workflow using `nx release`
- [x] Self-Healing CI with `nx fix-ci`
- [x] Command recording with `nx-cloud record`
- [x] Optimized checkout with `filter: tree:0`
- [x] Conventional commits type configuration
- [x] GitHub release creation enabled
- [x] Changelog generation configured

### Optional (Developer Choice)
- [ ] Install Nx Console extension
- [ ] Run `pnpm exec nx login` on dev machine
- [ ] Configure Nx MCP for Claude/Cursor
- [ ] Enable AI features in Nx Cloud settings

### Future (When Needed)
- [ ] Add module boundary tags to packages
- [ ] Evaluate Nx Pro for Agents if CI > 10 min
- [ ] Create local generators for package scaffolding

---

## Command Reference

```bash
# Nx Cloud
pnpm exec nx login              # Developer authentication
pnpm exec nx cloud whoami       # Verify connection

# Project Graph
pnpm exec nx graph              # View project graph
pnpm exec nx graph --targets    # View task graph

# Release
pnpm exec nx release --dry-run                    # Preview release
pnpm exec nx release --skip-publish --yes         # Execute release
pnpm exec nx release --specifier=minor --dry-run  # Preview minor bump

# Affected Commands
pnpm exec nx affected -t build    # Build affected projects
pnpm exec nx affected -t test     # Test affected projects
pnpm exec nx affected -t typecheck # Typecheck affected projects

# Show Projects
pnpm exec nx show projects --affected   # List affected projects
pnpm exec nx show project <name>        # Show project details

# Self-Healing
pnpm exec nx fix-ci               # Get AI fix recommendations
```

---

## Nx Cloud Pricing

| Plan | Cost | Key Features |
|------|------|--------------|
| **Hobby** | Free | 500 CI hrs/mo, remote cache, insights, flaky detection |
| **Pro** | $249/mo | Unlimited hours, 5 Nx Agents, AI Self-Healing |
| **Business** | Custom | Unlimited agents, SSO, priority support |

Free tier is sufficient for most projects. Pro recommended when CI > 10 min.

---

## Reference Links

- [Nx Cloud Features](https://nx.dev/ci/features)
- [Nx Cloud CI Setup](https://nx.dev/docs/guides/nx-cloud/setup-ci)
- [Nx Cloud AI Features](https://nx.dev/docs/guides/nx-cloud/enable-ai-features)
- [Nx Release Guide](https://nx.dev/docs/guides/nx-release)
- [Conventional Commits Types](https://nx.dev/docs/guides/nx-release/customize-conventional-commit-types)
- [GitHub Releases](https://nx.dev/docs/guides/nx-release/automate-github-releases)
- [Nx Agents (DTE)](https://nx.dev/docs/features/ci-features/distribute-task-execution)
- [Self-Healing CI](https://nx.dev/docs/features/ci-features/self-healing-ci)
- [Flaky Tasks](https://nx.dev/docs/features/ci-features/flaky-tasks)
- [Nx MCP/LLM](https://nx.dev/docs/features/enhance-ai)
- [Module Boundaries](https://nx.dev/docs/recipes/enforce-module-boundaries)
- [Nx Console](https://nx.dev/docs/getting-started/editor-setup)
