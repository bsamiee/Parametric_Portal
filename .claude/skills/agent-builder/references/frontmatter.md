# [H1][FRONTMATTER]
>**Dictum:** *Frontmatter structure determines agent discoverability and capability.*

<br>

[IMPORTANT] Session start triggers frontmatter indexing. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Complete schema enables full agent configuration.*

<br>

| [INDEX] | [FIELD]          | [TYPE]  | [REQ] | [DEFAULT] | [CONSTRAINT]                                           |
| :-----: | ---------------- | ------- | :---: | :-------: | ------------------------------------------------------ |
|   [1]   | `name`           | string  |  Yes  |     —     | Kebab-case, max 64 chars, match filename without `.md` |
|   [2]   | `description`    | string  |  Yes  |     —     | Max 1024 chars, third person voice, "Use when" clause  |
|   [3]   | `tools`          | list    |  No   | all tools | Comma-separated allowlist; omit = inherit all          |
|   [4]   | `disallowedTools`| list    |  No   |     —     | Comma-separated denylist; removed from inherited/tools |
|   [5]   | `model`          | enum    |  No   | `inherit` | `haiku`, `sonnet`, `opus`, `inherit`                   |
|   [6]   | `permissionMode` | enum    |  No   | `default` | `default`, `acceptEdits`, `delegate`, `dontAsk`, `bypassPermissions`, `plan` |
|   [7]   | `maxTurns`       | number  |  No   |     —     | Maximum agentic turns before subagent stops            |
|   [8]   | `skills`         | list    |  No   |     —     | Skill names preloaded into subagent context at startup |
|   [9]   | `mcpServers`     | object  |  No   |     —     | MCP servers available to this subagent                 |
|  [10]   | `hooks`          | object  |  No   |     —     | Scoped lifecycle hooks (all 14 event types supported)  |

|  [11]   | `memory`         | enum    |  No   |     —     | `user`, `project`, or `local` — persistent memory scope |


[IMPORTANT] Agent background color is set interactively via `/agents` UI — not a frontmatter field.

### [1.1][TOOLS_FIELD]
>**Dictum:** *Tool allowlist and denylist work together for precise scoping.*

`tools` is an allowlist; `disallowedTools` is a denylist. If both are specified, disallowed tools are removed from the allowed set.

**Task tool restriction:** Use `Task(agent_type)` syntax in `tools` to restrict which subagent types can be spawned:
```yaml
tools: Task(worker, researcher), Read, Bash
```
This only applies to agents running as main thread via `claude --agent`. Subagents cannot spawn other subagents.

### [1.2][PERMISSION_MODES]

| [INDEX] | [MODE]              | [BEHAVIOR]                                               |
| :-----: | ------------------- | -------------------------------------------------------- |
|   [1]   | `default`           | Standard permission checking with prompts                |
|   [2]   | `acceptEdits`       | Auto-accept file edits                                   |
|   [3]   | `dontAsk`           | Auto-deny permission prompts (explicitly allowed tools work) |
|   [4]   | `delegate`          | Coordination-only for agent team leads                   |
|   [5]   | `bypassPermissions` | Skip all permission checks (use with caution)            |
|   [6]   | `plan`              | Read-only exploration mode                               |

### [1.3][MEMORY_FIELD]

| [INDEX] | [SCOPE]   | [LOCATION]                                     | [USE_WHEN]                          |
| :-----: | --------- | ---------------------------------------------- | ----------------------------------- |
|   [1]   | `user`    | `~/.claude/agent-memory/<agent-name>/`          | Cross-project learnings             |
|   [2]   | `project` | `.claude/agent-memory/<agent-name>/`            | Project-specific, version-controlled |
|   [3]   | `local`   | `.claude/agent-memory-local/<agent-name>/`      | Project-specific, gitignored        |

When memory is enabled: subagent system prompt includes memory instructions, first 200 lines of `MEMORY.md` are injected, and Read/Write/Edit tools are auto-enabled.

---
### [1.4][NAME]

| [INDEX] | [VALID]            | [INVALID]          |
| :-----: | ------------------ | ------------------ |
|   [1]   | `code-reviewer`    | `Code_Reviewer`    |
|   [2]   | `react-specialist` | `react.specialist` |
|   [3]   | `pdf-processor`    | `pdf processor`    |

[IMPORTANT]:
- [ALWAYS] Lowercase letters, numbers, hyphens only.
- [ALWAYS] Match filename exactly — without `.md`.

---
### [1.5][DESCRIPTION]
>**Dictum:** *Description quality determines invocation accuracy.*

<br>

Semantic matching via reasoning. No embeddings. No keyword matching.

Voice constraints:<br>
- Third person: "Analyzes..." not "I analyze".
- Active voice: "Creates data" not "Data is created".
- Present tense: "Validates..." not "Will validate".
- No hedging: Reject `might`, `could`, `should`.

Structure pattern:<br>
`[Capability statement]. Use when [trigger-1], [trigger-2], or [trigger-3].`

---
## [2][TRIGGERS]
>**Dictum:** *Explicit triggers maximize discovery accuracy.*

<br>

| [INDEX] | [PATTERN]           | [EXAMPLE]                            | [MECHANISM]              |
| :-----: | ------------------- | ------------------------------------ | ------------------------ |
|   [1]   | "Use when" clause   | `Use when building agents`           | Direct activation        |
|   [2]   | Proactive trigger   | `Use proactively after code changes` | Encourages auto-invoke   |
|   [3]   | Imperative emphasis | `MUST BE USED before committing`     | Strong delegation signal |
|   [4]   | Enumerated list     | `(1) creating, (2) configuring`      | Parallel matching        |
|   [5]   | Technology embed    | `React 19 or TypeScript`             | Framework match          |
|   [6]   | File extension      | `working with .md files`             | Path-based trigger       |
|   [7]   | Temporal signal     | `before writing prompts`             | Workflow position        |
|   [8]   | Catch-all           | `or any other agent tasks`           | Broadens applicability   |

### [2.1][ANTI_PATTERNS]

| [INDEX] | [ANTI_PATTERN]    | [PROBLEM]                  | [FIX]                      |
| :-----: | ----------------- | -------------------------- | -------------------------- |
|   [1]   | Vague description | `Helps with agents`        | Add specifics + "Use when" |
|   [2]   | Implementation    | `Uses YAML parsing...`     | Describe triggers, not HOW |
|   [3]   | First person      | `I help you create...`     | Third person: "Creates..." |
|   [4]   | Name restating    | `Agent builder for agents` | Describe triggers only     |
|   [5]   | No catch-all      | Lists only 3 scenarios     | Add "or related tasks"     |

---
## [3][SYNTAX]
>**Dictum:** *YAML constraints prevent registration failure.*

<br>

| [INDEX] | [CONSTRAINT]             | [VIOLATION]              | [RESULT]              |
| :-----: | ------------------------ | ------------------------ | --------------------- |
|   [1]   | `---` on line 1          | Content before delimiter | Agent not discovered  |
|   [2]   | `---` closes on own line | Missing delimiter        | YAML parse failure    |
|   [3]   | Spaces only (no tabs)    | Tab indentation          | Parse error           |
|   [4]   | Quote special chars      | Unquoted `: # [ ] { }`  | Field value corrupted |
|   [5]   | Use `>-` for multi-line  | Literal scalar `|`       | Indexing error        |

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
model: inherit
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

# With hooks:
---
name: security-reviewer
description: >-
  Security audit specialist. Use proactively when reviewing code changes,
  scanning for vulnerabilities, or auditing dependencies.
tools: Read, Glob, Grep, Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-bash.sh"
          timeout: 10
---
```

[REFERENCE] Validation checklist: [->validation.md§3](./validation.md#3frontmatter_gate)
