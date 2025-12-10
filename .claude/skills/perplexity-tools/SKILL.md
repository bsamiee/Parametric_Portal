---
name: perplexity-tools
type: complex
depth: base
description: >-
   Executes Perplexity AI queries via unified Python CLI. Use when conducting
   web research, asking questions with citations, deep research tasks, reasoning
   problems, or searching for up-to-date information.
---

# [H1][PERPLEXITY-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute Perplexity AI queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]    | [MCP_EQUIVALENT]                       | [ARGS]                                |
| -------- | -------------------------------------- | ------------------------------------- |
| ask      | `mcp__perplexity__perplexity_ask`      | `--query` (required)                  |
| research | `mcp__perplexity__perplexity_research` | `--query` `--strip-thinking`          |
| reason   | `mcp__perplexity__perplexity_reason`   | `--query` `--strip-thinking`          |
| search   | `mcp__perplexity__perplexity_search`   | `--query` `--max-results` `--country` |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Quick question with citations
uv run .claude/skills/perplexity-tools/scripts/perplexity.py ask --query "What is Effect-TS?"

# Deep research
uv run .claude/skills/perplexity-tools/scripts/perplexity.py research --query "React 19 new features" --strip-thinking

# Reasoning task
uv run .claude/skills/perplexity-tools/scripts/perplexity.py reason --query "Compare Vite vs Webpack performance"

# Web search
uv run .claude/skills/perplexity-tools/scripts/perplexity.py search --query "Nx 22 Crystal release" --max-results 5
```

[IMPORTANT] API key auto-injected via 1Password at shell startup. Manual export not required.

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Response Fields:**
- `ask` — `{query: string, response: string, citations: string[]}`
- `research` — `{query: string, response: string, citations: string[]}`
- `reason` — `{query: string, response: string}`
- `search` — `{query: string, results: object[]}`
