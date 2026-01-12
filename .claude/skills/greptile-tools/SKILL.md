---
name: greptile-tools
type: complex
depth: base
user-invocable: false
description: >-
  Queries indexed repositories via Greptile API for codebase-aware answers. Use
  when asking natural language questions about code architecture, searching for
  implementations, understanding how features work, or locating specific code
  patterns across the repository.
---

# [H1][GREPTILE-TOOLS]
>**Dictum:** *Codebase context enables precise answers.*

<br>

Query indexed repositories via Greptile API. Defaults to current repo.

[IMPORTANT] Repository must be indexed before querying. Check `status` first.

```bash
# Check indexing status (defaults to current repo)
uv run .claude/skills/greptile-tools/scripts/greptile.py status
# Trigger repository indexing
uv run .claude/skills/greptile-tools/scripts/greptile.py index
# Natural language query
uv run .claude/skills/greptile-tools/scripts/greptile.py query --query "How does authentication work?"
# Deep analysis with genius mode
uv run .claude/skills/greptile-tools/scripts/greptile.py query --query "Explain Effect pipeline patterns" --genius
```

---
## [1][COMMANDS]

| [INDEX] | [CMD]    | [PURPOSE]                          |
| :-----: | -------- | ---------------------------------- |
|   [1]   | `index`  | Trigger repository indexing        |
|   [2]   | `status` | Check indexing progress/completion |
|   [3]   | `query`  | Natural language codebase Q&A      |

---
## [2][OUTPUT]

All commands return `{"status": "success|error", ...}`. Errors include `retryable: bool`.

| [INDEX] | [CMD]    | [RESPONSE]                                          |
| :-----: | -------- | --------------------------------------------------- |
|   [1]   | `index`  | `{status, repo, message}`                           |
|   [2]   | `status` | `{status, repo, indexing, sha, progress, ready}`    |
|   [3]   | `query`  | `{status, query, answer, sources: [{file, lines}]}` |

### [2.1][STATUS_FIELDS]

| [INDEX] | [FIELD]     | [TYPE] | [PURPOSE]                            |
| :-----: | ----------- | ------ | ------------------------------------ |
|   [1]   | `status`    | `str`  | "success" or "error"                 |
|   [2]   | `indexing`  | `str`  | API status: PROCESSING, COMPLETED    |
|   [3]   | `ready`     | `bool` | True when repo is queryable          |
|   [4]   | `retryable` | `bool` | True for transient errors (on error) |

---
## [3][OPTIONS]

| [INDEX] | [FLAG]     | [DEFAULT]                   | [DESCRIPTION]             |
| :-----: | ---------- | --------------------------- | ------------------------- |
|   [1]   | `--repo`   | `bsamiee/parametric_portal` | Repository owner/name     |
|   [2]   | `--branch` | `main`                      | Branch to query           |
|   [3]   | `--remote` | `github`                    | Remote: github or gitlab  |
|   [4]   | `--genius` | `false`                     | Enable deep analysis mode |
|   [5]   | `--query`  | —                           | Natural language query    |
