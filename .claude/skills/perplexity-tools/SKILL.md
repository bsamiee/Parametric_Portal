---
name: perplexity-tools
type: complex
depth: base
user-invocable: false
description: >-
  Executes Perplexity AI queries via Python CLI. Use when conducting web
  research, asking questions with citations, deep research tasks, reasoning
  problems, or searching for up-to-date information.
---

# [H1][PERPLEXITY-TOOLS]
>**Dictum:** *Specialized models optimize response quality.*

<br>

Execute Perplexity AI queries via Python CLI. API key auto-injected via 1Password.

---
## [1][COMMANDS]

| [CMD]     | [ARGS]                         | [MODEL]               |
| --------- | ------------------------------ | --------------------- |
| ask       | `<query>`                      | sonar                 |
| research  | `<query> [strip]`              | sonar-deep-research   |
| reason    | `<query> [strip]`              | sonar-reasoning-pro   |
| search    | `<query> [max] [country]`      | sonar                 |

---
## [2][USAGE]

```bash
# Quick question with citations
uv run .claude/skills/perplexity-tools/scripts/perplexity.py ask "What is Effect-TS?"

# Deep research (10min timeout)
uv run .claude/skills/perplexity-tools/scripts/perplexity.py research "React 19 new features"

# Deep research, strip thinking tags
uv run .claude/skills/perplexity-tools/scripts/perplexity.py research "Vite 7 migration" strip

# Reasoning task
uv run .claude/skills/perplexity-tools/scripts/perplexity.py reason "Compare Effect vs RxJS"

# Web search with max results
uv run .claude/skills/perplexity-tools/scripts/perplexity.py search "Nx Crystal" 5
```

---
## [3][ARGUMENTS]

**ask**: `<query>`
- `query` — Question to ask (required)

**research**: `<query> [strip]`
- `query` — Research topic (required)
- `strip` — Pass `strip` to remove `<think>` tags from response

**reason**: `<query> [strip]`
- `query` — Reasoning problem (required)
- `strip` — Pass `strip` to remove `<think>` tags from response

**search**: `<query> [max] [country]`
- `query` — Search query (required)
- `max` — Max results (default: `10`)
- `country` — Country code to focus results

---
## [4][OUTPUT]

Commands return: `{"status": "success|error", ...}`.

| [INDEX] | [CMD]      | [RESPONSE]                       |
| :-----: | ---------- | -------------------------------- |
|   [1]   | `ask`      | `{query, response, citations[]}` |
|   [2]   | `research` | `{query, response, citations[]}` |
|   [3]   | `reason`   | `{query, response}`              |
|   [4]   | `search`   | `{query, results[]}`             |
