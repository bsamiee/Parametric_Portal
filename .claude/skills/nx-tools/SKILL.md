---
name: nx-tools
type: complex
depth: base
description: >-
  Queries Nx workspace metadata, project configurations, affected detection,
  generator schemas, and dependency graphs via unified Python CLI. Use when
  analyzing monorepo structure, inspecting project.json configurations,
  determining affected projects for CI optimization, discovering available
  generators, or visualizing workspace dependencies.
---

# [H1][NX-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute nx workspace queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]      | [NX_EQUIVALENT]               | [ARGS]                          |
| ---------- | ----------------------------- | ------------------------------- |
| workspace  | `nx show projects --json`     | None                            |
| project    | `nx show project <n> --json`  | `--name <project>` (required)   |
| affected   | `nx show projects --affected` | `--base main` (default)         |
| run        | `nx run-many -t <target>`     | `--target <name>` (required)    |
| tokens     | Token counter utility         | `--path <file/dir>` (optional)  |
| path       | Returns workspace root        | None                            |
| generators | `nx list`                     | None                            |
| schema     | `nx g <gen> --help`           | `--generator <name>` (required) |
| graph      | `nx graph --file=<path>`      | `--output .nx/graph.json`       |
| docs       | `nx <topic> --help`           | `--topic <cmd>` (optional)      |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Unified invocation pattern
uv run .claude/skills/nx-tools/scripts/nx.py <command> [args]

# Workspace queries
uv run .claude/skills/nx-tools/scripts/nx.py workspace
uv run .claude/skills/nx-tools/scripts/nx.py project --name parametric-portal
uv run .claude/skills/nx-tools/scripts/nx.py affected --base main

# Run targets
uv run .claude/skills/nx-tools/scripts/nx.py run --target build
uv run .claude/skills/nx-tools/scripts/nx.py run --target typecheck

# Token counting
uv run .claude/skills/nx-tools/scripts/nx.py tokens --path CLAUDE.md
uv run .claude/skills/nx-tools/scripts/nx.py tokens --path .claude/skills

# Generators
uv run .claude/skills/nx-tools/scripts/nx.py generators
uv run .claude/skills/nx-tools/scripts/nx.py schema --generator @nx/react:app

# Utilities
uv run .claude/skills/nx-tools/scripts/nx.py path
uv run .claude/skills/nx-tools/scripts/nx.py graph --output .nx/graph.json
uv run .claude/skills/nx-tools/scripts/nx.py docs --topic affected
```

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON to stdout with `{"status": "success|error", ...}`.

**Response Fields by Command:**
- `workspace` — `{projects: string[]}`
- `project` — `{name: string, project: object}`
- `affected` — `{base: string, affected: string[]}`
- `run` — `{target: string, output: string}`
- `tokens` — `{path: string, output: string}`
- `path` — `{path: string}`
- `generators` — `{generators: string}`
- `schema` — `{generator: string, schema: string}`
- `graph` — `{file: string}`
- `docs` — `{topic: string, docs: string}`
