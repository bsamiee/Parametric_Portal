---
name: exa-tools
type: complex
depth: base
user-invocable: false
description: >-
  Executes Exa AI search queries via Python CLI. Use when searching the web for
  current information, finding code examples, researching APIs, SDKs, or
  retrieving programming context for any library or framework.
---

# [H1][EXA-TOOLS]
>**Dictum:** *Semantic search surfaces relevant content.*

<br>

Execute Exa AI search queries via Python CLI. API key auto-injected via 1Password.

---
## [1][COMMANDS]

| [CMD]    | [ARGS]                        | [RETURNS]                     |
| -------- | ----------------------------- | ----------------------------- |
| search   | `<query> [type] [num]`        | Web results with text content |
| code     | `<query> [num]`               | GitHub code context           |

---
## [2][USAGE]

```bash
# Web search (default: auto type, 8 results)
uv run .claude/skills/exa-tools/scripts/exa.py search "Vite 7 new features"

# Neural search for concepts
uv run .claude/skills/exa-tools/scripts/exa.py search "Effect-TS best practices" neural

# Keyword search with custom result count
uv run .claude/skills/exa-tools/scripts/exa.py search "React 19 release notes" keyword 15

# Code context search (GitHub)
uv run .claude/skills/exa-tools/scripts/exa.py code "React useState hook examples"

# Code search with custom results
uv run .claude/skills/exa-tools/scripts/exa.py code "Effect pipe examples" 20
```

---
## [3][ARGUMENTS]

**search**: `<query> [type] [num]`
- `query` — Search query (required)
- `type` — Search type: `auto`, `neural`, `keyword` (default: `auto`)
- `num` — Number of results (default: `8`)

**code**: `<query> [num]`
- `query` — Code search query (required)
- `num` — Number of results (default: `10`)

---
## [4][OUTPUT]

Commands return: `{"status": "success|error", ...}`.

| [INDEX] | [CMD]    | [RESPONSE]                     |
| :-----: | -------- | ------------------------------ |
|   [1]   | `search` | `{query: string, results: []}` |
|   [2]   | `code`   | `{query: string, context: []}` |
