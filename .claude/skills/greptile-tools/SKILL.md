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

---
## [1][COMMANDS]

| [CMD]   | [ARGS]                   | [PURPOSE]                          |
| ------- | ------------------------ | ---------------------------------- |
| index   | —                        | Trigger repository indexing        |
| status  | —                        | Check indexing progress/completion |
| query   | `<question> [genius]`    | Natural language codebase Q&A      |

---
## [2][USAGE]

```bash
# Check indexing status (run first)
uv run .claude/skills/greptile-tools/scripts/greptile.py status

# Trigger repository indexing
uv run .claude/skills/greptile-tools/scripts/greptile.py index

# Natural language query
uv run .claude/skills/greptile-tools/scripts/greptile.py query "How does authentication work?"

# Deep analysis with genius mode
uv run .claude/skills/greptile-tools/scripts/greptile.py query "Explain Effect pipeline patterns" genius
```

---
## [3][ARGUMENTS]

**index**: (no arguments)
- Triggers indexing on default repo (bsamiee/Parametric_Portal)

**status**: (no arguments)
- Returns indexing status, progress, and readiness

**query**: `<question> [genius]`
- `question` — Natural language query (required)
- `genius` — Pass literal `genius` for deep analysis mode

---
## [4][OUTPUT]

Commands return: `{"status": "success|error", ...}`.

| [INDEX] | [CMD]    | [RESPONSE]                                          |
| :-----: | -------- | --------------------------------------------------- |
|   [1]   | `index`  | `{repo, message}`                                   |
|   [2]   | `status` | `{repo, indexing, sha, progress, ready}`            |
|   [3]   | `query`  | `{query, answer, sources: [{file, lines}]}`         |

Error responses include `retryable: bool` for transient failures.
