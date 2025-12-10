---
name: exa-tools
type: complex
depth: base
description: >-
  Executes Exa AI search queries via unified Python CLI. Use when searching the
  web for current information, finding code examples, researching APIs, SDKs,
  or retrieving programming context for any library or framework.
---
# [H1][EXA-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute Exa AI search queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]  | [MCP_EQUIVALENT]                 | [ARGS]                             |
| ------ | -------------------------------- | ---------------------------------- |
| search | `mcp__exa__web_search_exa`       | `--query` `--num-results` `--type` |
| code   | `mcp__exa__get_code_context_exa` | `--query` `--num-results`          |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Web search (type: auto, neural, keyword)
uv run .claude/skills/exa-tools/scripts/exa.py search --query "Vite 7 new features" --num-results 5

# Neural search
uv run .claude/skills/exa-tools/scripts/exa.py search --query "Effect-TS best practices" --type neural

# Code context (GitHub category)
uv run .claude/skills/exa-tools/scripts/exa.py code --query "React useState hook examples" --num-results 10
```

[IMPORTANT] API key auto-injected via 1Password at shell startup. Manual export not required.

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Response Fields:**
- `search` — `{query: string, results: object[]}`
- `code` — `{query: string, context: object[]}`
