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
>**Dictum:** *Standardized invocation reduces agent errors.*

<br>

Invokes gh CLI commands through Python wrapper.

[IMPORTANT] Zero-arg commands default to `state=open`, `limit=30`. System auto-configures OAuth scopes.

```bash
# Zero-arg commands
uv run .claude/skills/github-tools/scripts/gh.py issue-list
uv run .claude/skills/github-tools/scripts/gh.py pr-list
uv run .claude/skills/github-tools/scripts/gh.py run-list
uv run .claude/skills/github-tools/scripts/gh.py workflow-list
uv run .claude/skills/github-tools/scripts/gh.py label-list
uv run .claude/skills/github-tools/scripts/gh.py release-list
uv run .claude/skills/github-tools/scripts/gh.py cache-list
uv run .claude/skills/github-tools/scripts/gh.py project-list
uv run .claude/skills/github-tools/scripts/gh.py repo-view
```

---
## [1][ISSUES]

```bash
uv run .claude/skills/github-tools/scripts/gh.py issue-list --state closed
uv run .claude/skills/github-tools/scripts/gh.py issue-view --number 42
uv run .claude/skills/github-tools/scripts/gh.py issue-create --title "Bug report" --body "Details"
uv run .claude/skills/github-tools/scripts/gh.py issue-comment --number 42 --body "Comment"
uv run .claude/skills/github-tools/scripts/gh.py issue-close --number 42
uv run .claude/skills/github-tools/scripts/gh.py issue-edit --number 42 --title "New title" --labels "bug,urgent"
```

---
## [2][PULL_REQUESTS]

```bash
uv run .claude/skills/github-tools/scripts/gh.py pr-list --state closed
uv run .claude/skills/github-tools/scripts/gh.py pr-view --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-create --title "Feature" --body "Description" --base main
uv run .claude/skills/github-tools/scripts/gh.py pr-diff --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-files --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-checks --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-merge --number 99
uv run .claude/skills/github-tools/scripts/gh.py pr-review --number 99 --event APPROVE --body "LGTM"
```

---
## [3][WORKFLOWS]

```bash
uv run .claude/skills/github-tools/scripts/gh.py run-list --limit 10
uv run .claude/skills/github-tools/scripts/gh.py run-view --run-id 12345
uv run .claude/skills/github-tools/scripts/gh.py run-logs --run-id 12345 --failed
uv run .claude/skills/github-tools/scripts/gh.py run-rerun --run-id 12345
uv run .claude/skills/github-tools/scripts/gh.py workflow-view --workflow ci.yml
uv run .claude/skills/github-tools/scripts/gh.py workflow-run --workflow ci.yml --ref main
```

---
## [4][SEARCH]

```bash
uv run .claude/skills/github-tools/scripts/gh.py search-repos --query "nx monorepo" --limit 10
uv run .claude/skills/github-tools/scripts/gh.py search-code --query "dispatch table" --limit 10
uv run .claude/skills/github-tools/scripts/gh.py search-issues --query "is:open label:bug" --limit 10
```

---
## [5][OTHER]

```bash
uv run .claude/skills/github-tools/scripts/gh.py release-view --tag v1.0.0
uv run .claude/skills/github-tools/scripts/gh.py api --endpoint "/repos/{owner}/{repo}/issues" --method GET
```

---
## [6][OUTPUT]

Commands return: `{"status": "success|error", ...}`.

| [INDEX] | [PATTERN]         | [RESPONSE]                           |
| :-----: | ----------------- | ------------------------------------ |
|   [1]   | List commands     | `{items: object[]}`                  |
|   [2]   | View commands     | `{item: object}`                     |
|   [3]   | Mutation commands | `{number: int, action: bool}`        |
|   [4]   | Search commands   | `{query: string, results: object[]}` |
|   [5]   | Diff commands     | `{number: int, diff: string}`        |
