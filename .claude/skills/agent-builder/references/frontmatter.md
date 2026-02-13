# [H1][FRONTMATTER]
>**Dictum:** *Frontmatter structure determines agent discoverability and capability.*

<br>

[IMPORTANT] Session start triggers frontmatter indexing. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Complete schema enables full agent configuration.*

<br>

| [INDEX] | [FIELD]           | [TYPE] | [REQ] | [DEFAULT] | [CONSTRAINT]                                                                 |
| :-----: | ----------------- | ------ | :---: | :-------: | ---------------------------------------------------------------------------- |
|   [1]   | `name`            | string |  Yes  |     —     | Kebab-case, max 64 chars, match filename without `.md`                       |
|   [2]   | `description`     | string |  Yes  |     —     | Max 1024 chars, third person voice, "Use when" clause                        |
|   [3]   | `tools`           | list   |  No   | all tools | Comma-separated allowlist; omit = inherit all                                |
|   [4]   | `disallowedTools` | list   |  No   |     —     | Comma-separated denylist; removed from inherited/tools                       |
|   [5]   | `model`           | enum   |  No   | `inherit` | `haiku`, `sonnet`, `opus`, `inherit`                                         |
|   [6]   | `permissionMode`  | enum   |  No   | `default` | `default`, `acceptEdits`, `delegate`, `dontAsk`, `bypassPermissions`, `plan` |
|   [7]   | `maxTurns`        | number |  No   |     —     | Maximum agentic turns before subagent stops                                  |
|   [8]   | `skills`          | list   |  No   |     —     | Skill names preloaded into subagent context at startup                       |
|   [9]   | `mcpServers`      | object |  No   |     —     | MCP servers available to this subagent                                       |
|  [10]   | `hooks`           | object |  No   |     —     | Scoped lifecycle hooks (all 14 event types supported)                        |
|  [11]   | `memory`          | enum   |  No   |     —     | `user`, `project`, or `local` — persistent memory scope                      |

[IMPORTANT] Agent background color set interactively via `/agents` UI — not frontmatter field.

**Tool restriction:** `Task(worker, researcher)` in `tools` restricts spawnable subagent types. Only applies to main thread via `claude --agent`.<br>
**Permission modes:** `default` (standard prompts), `acceptEdits` (auto-accept edits), `dontAsk` (auto-deny prompts), `delegate` (coordination-only), `bypassPermissions` (skip all checks), `plan` (read-only).<br>
**Memory scopes:** `user` (~/.claude/agent-memory/), `project` (.claude/agent-memory/, versioned), `local` (.claude/agent-memory-local/, gitignored). Enables memory instructions, first 200 lines of MEMORY.md injected, Read/Write/Edit auto-enabled.<br>
**Name rules:** Lowercase letters, numbers, hyphens only. Match filename exactly without `.md`.

---
## [2][DESCRIPTION]
>**Dictum:** *Description quality determines invocation accuracy.*

<br>

Semantic matching via reasoning. No embeddings. No keyword matching.

**Voice:** Third person ("Analyzes..."), active ("Creates data"), present tense ("Validates..."), no hedging (`might`, `could`, `should`).<br>
**Structure:** `[Capability statement]. Use when [trigger-1], [trigger-2], or [trigger-3].`<br>
**Trigger patterns:** "Use when" clause (direct), proactive trigger ("after code changes"), imperative ("MUST BE USED"), enumerated list, technology embed, file extension, temporal signal, catch-all ("or any other...").<br>
**Anti-patterns:** Vague description, implementation details, first person, name restating, no catch-all.

---
## [3][SYNTAX]
>**Dictum:** *YAML constraints prevent registration failure.*

<br>

| [INDEX] | [CONSTRAINT]             | [VIOLATION]              | [RESULT]             |
| :-----: | ------------------------ | ------------------------ | -------------------- |
|   [1]   | `---` on line 1          | Content before delimiter | Agent not discovered |
|   [2]   | `---` closes on own line | Missing delimiter        | YAML parse failure   |
|   [3]   | Spaces only (no tabs)    | Tab indentation          | Parse error          |
|   [4]   | Quote special chars      | Unquoted `: # [ ] { }`   | Value corrupted      |
|   [5]   | Use `>-` for multi-line  | Literal newlines         | Indexing error       |

---
## [4][EXAMPLES]
>**Dictum:** *Examples accelerate learning via proven patterns.*

<br>

```yaml
# Read-only with memory:
---
name: code-reviewer
description: >-
  Reviews code for quality and security. Use proactively after code changes,
  when reviewing PRs, or auditing commits.
tools: Read, Glob, Grep, Bash
model: sonnet
memory: user
---

# Write-capable with skills:
---
name: refactoring-architect
description: >-
  TypeScript refactoring specialist. Use proactively when reducing LOC,
  consolidating functions, or optimizing patterns.
tools: Read, Glob, Grep, Edit, Write
skills:
  - style-standards
  - ts-standards
---

# Orchestrator with restricted spawning:
---
name: team-coordinator
description: >-
  Coordinates work across specialized agents. Use when delegating complex
  multi-agent tasks or managing parallel workflows.
tools: Task(worker, researcher), Read, Glob
model: opus
permissionMode: delegate
---
```

[REFERENCE] Validation checklist: [→validation.md§3](./validation.md#3frontmatter_gate).
