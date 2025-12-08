---
name: context7-tools
type: complex
depth: base
description: >-
  Queries Context7 library documentation via unified Python CLI. Use when
  resolving library IDs, fetching API references, code examples, or conceptual
  guides for any programming library or framework.
---

# [H1][CONTEXT7-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute Context7 library queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]   | [MCP_EQUIVALENT]                    | [ARGS]                              |
| ------- | ----------------------------------- | ----------------------------------- |
| resolve | `mcp__context7__resolve-library-id` | `--library` (required)              |
| docs    | `mcp__context7__get-library-docs`   | `--library-id` `--tokens` `--topic` |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Resolve library name to ID
uv run .claude/skills/context7-tools/scripts/context7.py resolve --library "react"

# Fetch documentation with topic filter
uv run .claude/skills/context7-tools/scripts/context7.py docs --library-id "/facebook/react" --topic "hooks" --tokens 5000

# Fetch full docs (default 5000 tokens)
uv run .claude/skills/context7-tools/scripts/context7.py docs --library-id "/vercel/next.js"
```

[IMPORTANT] API key optional for public libraries. Auto-injected via 1Password if set.

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Response Fields:**
- `resolve` — `{library: string, matches: object[]}`
- `docs` — `{library_id: string, topic: string, documentation: object}`
