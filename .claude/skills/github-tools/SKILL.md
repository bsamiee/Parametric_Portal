---
name: github-tools
type: complex
depth: base
description: >-
  Executes GitHub operations via gh CLI wrapper. Use when managing issues,
  pull requests, workflows, CI runs, projects, releases, cache, labels, or
  searching repositories and code.
---

# [H1][GITHUB-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute GitHub queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

> [!NOTE]
> **OAuth Scopes**: Most commands work with default `gh` auth. Project commands require additional scope:
> ```bash
> gh auth refresh -s read:project
> ```

<br>

### [1.1][ISSUES]
| [CMD]         | [GH_EQUIVALENT]        | [ARGS]                                   |
| ------------- | ---------------------- | ---------------------------------------- |
| issue-list    | `gh issue list`        | `--state` `--limit`                      |
| issue-view    | `gh issue view <n>`    | `--number` (required)                    |
| issue-create  | `gh issue create`      | `--title` `--body` (required)            |
| issue-comment | `gh issue comment <n>` | `--number` `--body` (required)           |
| issue-close   | `gh issue close <n>`   | `--number` (required)                    |
| issue-edit    | `gh issue edit <n>`    | `--number` `--title` `--body` `--labels` |
| issue-reopen  | `gh issue reopen <n>`  | `--number` (required)                    |
| issue-pin     | `gh issue pin <n>`     | `--number` (required)                    |

### [1.2][PULL_REQUESTS]
| [CMD]     | [GH_EQUIVALENT]               | [ARGS]                                   |
| --------- | ----------------------------- | ---------------------------------------- |
| pr-list   | `gh pr list`                  | `--state` `--limit`                      |
| pr-view   | `gh pr view <n>`              | `--number` (required)                    |
| pr-create | `gh pr create`                | `--title` `--body` `--base`              |
| pr-diff   | `gh pr diff <n>`              | `--number` (required)                    |
| pr-files  | `gh pr view <n> --json=files` | `--number` (required)                    |
| pr-checks | `gh pr checks <n>`            | `--number` (required)                    |
| pr-edit   | `gh pr edit <n>`              | `--number` `--title` `--body` `--labels` |
| pr-close  | `gh pr close <n>`             | `--number` (required)                    |
| pr-ready  | `gh pr ready <n>`             | `--number` (required)                    |
| pr-merge  | `gh pr merge <n> --squash`    | `--number` (required)                    |
| pr-review | `gh pr review <n>`            | `--number` `--event` `--body`            |

### [1.3][WORKFLOWS]
| [CMD]         | [GH_EQUIVALENT]              | [ARGS]                           |
| ------------- | ---------------------------- | -------------------------------- |
| workflow-list | `gh workflow list`           | None                             |
| workflow-view | `gh workflow view <name>`    | `--workflow` (required)          |
| workflow-run  | `gh workflow run <name>`     | `--workflow` `--ref`             |
| run-list      | `gh run list`                | `--limit`                        |
| run-view      | `gh run view <id>`           | `--run-id` (required)            |
| run-logs      | `gh run view <id> --log`     | `--run-id` (required) `--failed` |
| run-rerun     | `gh run rerun <id> --failed` | `--run-id` (required)            |
| run-cancel    | `gh run cancel <id>`         | `--run-id` (required)            |

### [1.4][PROJECTS]
> [!IMPORTANT]
> Requires OAuth scope: `gh auth refresh -s read:project`

| [CMD]             | [GH_EQUIVALENT]            | [ARGS]                           |
| ----------------- | -------------------------- | -------------------------------- |
| project-list      | `gh project list`          | `--owner` (default: @me)         |
| project-view      | `gh project view <n>`      | `--project` (required) `--owner` |
| project-item-list | `gh project item-list <n>` | `--project` (required) `--owner` |

### [1.5][RELEASES]
| [CMD]        | [GH_EQUIVALENT]         | [ARGS]             |
| ------------ | ----------------------- | ------------------ |
| release-list | `gh release list`       | `--limit`          |
| release-view | `gh release view <tag>` | `--tag` (required) |

### [1.6][CACHE_AND_LABELS]
| [CMD]        | [GH_EQUIVALENT]         | [ARGS]                   |
| ------------ | ----------------------- | ------------------------ |
| cache-list   | `gh cache list`         | `--limit`                |
| cache-delete | `gh cache delete <key>` | `--cache-key` (required) |
| label-list   | `gh label list`         | None                     |

### [1.7][SEARCH]
| [CMD]         | [GH_EQUIVALENT]    | [ARGS]               |
| ------------- | ------------------ | -------------------- |
| search-repos  | `gh search repos`  | `--query` (required) |
| search-code   | `gh search code`   | `--query` (required) |
| search-issues | `gh search issues` | `--query` (required) |

### [1.8][UTILITY]
| [CMD]     | [GH_EQUIVALENT]     | [ARGS]                  |
| --------- | ------------------- | ----------------------- |
| repo-view | `gh repo view`      | `--repo` (optional)     |
| api       | `gh api <endpoint>` | `--endpoint` `--method` |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Unified invocation
uv run .claude/skills/github-tools/scripts/gh.py <command> [args]

# Issues
uv run .claude/skills/github-tools/scripts/gh.py issue-list --state open --limit 10
uv run .claude/skills/github-tools/scripts/gh.py issue-view --number 42
uv run .claude/skills/github-tools/scripts/gh.py issue-create --title "Bug" --body "Details"
uv run .claude/skills/github-tools/scripts/gh.py issue-close --number 42
uv run .claude/skills/github-tools/scripts/gh.py issue-edit --number 42 --labels "bug,critical"
uv run .claude/skills/github-tools/scripts/gh.py issue-pin --number 42

# PRs
uv run .claude/skills/github-tools/scripts/gh.py pr-create --title "Feature" --body "Desc" --base main
uv run .claude/skills/github-tools/scripts/gh.py pr-diff --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-edit --number 99 --labels "review"
uv run .claude/skills/github-tools/scripts/gh.py pr-ready --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-review --number 99 --event APPROVE --body "LGTM"

# Workflows & Runs
uv run .claude/skills/github-tools/scripts/gh.py workflow-list
uv run .claude/skills/github-tools/scripts/gh.py workflow-view --workflow ci.yml
uv run .claude/skills/github-tools/scripts/gh.py workflow-run --workflow ci.yml --ref main
uv run .claude/skills/github-tools/scripts/gh.py run-list --limit 10
uv run .claude/skills/github-tools/scripts/gh.py run-view --run-id 12345
uv run .claude/skills/github-tools/scripts/gh.py run-logs --run-id 12345 --failed
uv run .claude/skills/github-tools/scripts/gh.py run-cancel --run-id 12345

# Projects (requires: gh auth refresh -s read:project)
uv run .claude/skills/github-tools/scripts/gh.py project-list --owner bsamiee
uv run .claude/skills/github-tools/scripts/gh.py project-view --project 1 --owner bsamiee
uv run .claude/skills/github-tools/scripts/gh.py project-item-list --project 1 --owner bsamiee

# Releases
uv run .claude/skills/github-tools/scripts/gh.py release-list --limit 5
uv run .claude/skills/github-tools/scripts/gh.py release-view --tag v1.0.0

# Cache & Labels
uv run .claude/skills/github-tools/scripts/gh.py cache-list --limit 10
uv run .claude/skills/github-tools/scripts/gh.py cache-delete --cache-key "node-cache-Linux-..."
uv run .claude/skills/github-tools/scripts/gh.py label-list

# Search
uv run .claude/skills/github-tools/scripts/gh.py search-repos --query "nx monorepo"
uv run .claude/skills/github-tools/scripts/gh.py search-code --query "dispatch table"

# Raw API
uv run .claude/skills/github-tools/scripts/gh.py api --endpoint repos/{owner}/{repo}/branches
```

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Key Response Patterns:**
- List commands — `{items: object[]}`
- View commands — `{item: object}`
- Mutation commands — `{number: int, action: bool}`
- Search commands — `{query: string, results: object[]}`
- Diff commands — `{number: int, diff: string}`
