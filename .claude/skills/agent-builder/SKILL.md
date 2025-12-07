---
name: agent-builder
type: standard
depth: base
description: Creates and configures Claude Code agent files (.claude/agents/*.md) with YAML frontmatter, tool permissions, model selection, and system prompt structure. Use when building new agents, configuring agent frontmatter, designing discovery triggers, setting tool permissions, writing system prompts, or selecting agent models.
---

# [H1][AGENT-BUILDER]
>**Dictum:** *Discoverable agents extend capabilities via structured frontmatter, scoped tools, and behavioral prompts.*

<br>

Agent files encode specialized execution contexts for main Claude agent invocation. Frontmatter controls discovery; markdown body encodes behavior.

**Location:** `.claude/agents/` (project) or `~/.claude/agents/` (user). Project agents override user agents on name collision.

**Navigation:** [→index.md](./index.md) | [→frontmatter.md](./references/frontmatter.md) | [→prompt.md](./references/prompt.md) | [→workflow.md](./references/workflow.md)

---
## [1][FRONTMATTER]
>**Dictum:** *Metadata enables discovery before loading.*

<br>

```yaml
---
name: agent-name
description: >-
  Capability statement. Use when scenario-1, scenario-2, or scenario-3.
tools: Read, Glob, Grep
model: sonnet
skills: style-standards
---
```

| [INDEX] | [FIELD]       | [TYPE] | [REQ] | [CONSTRAINT]                              |
| :-----: | ------------- | ------ | :---: | ----------------------------------------- |
|   [1]   | `name`        | string |  Yes  | Kebab-case, max 64 chars, match filename  |
|   [2]   | `description` | string |  Yes  | Third person, active voice, "Use when"    |
|   [3]   | `tools`       | list   |  No   | Comma-separated; omit = inherit all tools |
|   [4]   | `model`       | enum   |  No   | `haiku`, `sonnet`, `opus`, `inherit`      |
|   [5]   | `skills`      | list   |  No   | Skill names agent can invoke              |

**Required Task:** Consult [→frontmatter.md](./references/frontmatter.md)—schema details, trigger patterns, validation.

---
## [2][DISCOVERY]
>**Dictum:** *Description quality determines invocation accuracy.*

<br>

LLM reasoning matches description—no embeddings, no keyword matching.

| [INDEX] | [PATTERN]           | [EXAMPLE]                            | [MECHANISM]                |
| :-----: | ------------------- | ------------------------------------ | -------------------------- |
|   [1]   | "Use when" clause   | `Use when building MCP servers`      | Direct activation signal   |
|   [2]   | Proactive trigger   | `Use proactively after code changes` | Encourages auto-invocation |
|   [3]   | Imperative emphasis | `MUST BE USED before committing`     | Strong delegation signal   |
|   [4]   | Enumerated list     | `(1) creating, (2) modifying`        | Parallel pattern matching  |
|   [5]   | Technology embed    | `Python (FastMCP) or TypeScript`     | Framework-specific match   |
|   [6]   | File extension      | `working with PDF files (.pdf)`      | Path-based triggering      |
|   [7]   | Catch-all           | `or any other agent tasks`           | Broadens applicability     |

[CRITICAL]:
- [NEVER] Hedging words: `might`, `could`, `should`, `probably`.
- [ALWAYS] Include "Use when" clause—3+ trigger scenarios.
- [ALWAYS] Third person, active voice, present tense.

---
## [3][TOOLS]
>**Dictum:** *Tool declarations scope agent permissions.*

<br>

| [INDEX] | [PATTERN]     | [TOOLS]                         | [USE_CASE]         |
| :-----: | ------------- | ------------------------------- | ------------------ |
|   [1]   | Read-only     | `Read, Glob, Grep`              | Analysis, review   |
|   [2]   | Write-capable | `Read, Edit, Write, Glob, Bash` | Implementation     |
|   [3]   | Orchestration | `Task, Read, Glob, TodoWrite`   | Agent dispatch     |
|   [4]   | Full access   | *(omit field)*                  | Inherits all tools |

[IMPORTANT]:
- [NEVER] Reference `@path` without `Read` in tools list.
- [ALWAYS] Omit `tools` field for general-purpose agents.
- [ALWAYS] Scope tools for specialized agents—reviewers require read-only.

---
## [4][MODELS]
>**Dictum:** *Model selection balances capability, latency, and cost.*

<br>

| [INDEX] | [MODEL] | [ALIAS] | [STRENGTH]              | [LATENCY] | [COST]  |
| :-----: | ------- | ------- | ----------------------- | :-------: | :-----: |
|   [1]   | opus    | opus    | Complex reasoning       |   High    |  High   |
|   [2]   | sonnet  | sonnet  | Balanced performance    |  Medium   | Medium  |
|   [3]   | haiku   | haiku   | Fast, simple tasks      |    Low    |   Low   |
|   [4]   | inherit | inherit | Match main conversation |  Session  | Session |

| [INDEX] | [TASK_TYPE]             | [MODEL] |
| :-----: | ----------------------- | :-----: |
|   [1]   | Multi-file scope        |  opus   |
|   [2]   | Architectural decisions |  opus   |
|   [3]   | Standard development    | sonnet  |
|   [4]   | Fast lookups, filtering |  haiku  |

[IMPORTANT] Omit `model` field to inherit session default.

---
## [5][SYSTEM_PROMPT]
>**Dictum:** *Structured prompts constrain agent execution.*

<br>

Markdown body after frontmatter encodes agent behavior. Structure determines effectiveness.

**Required Task:** Consult [→prompt.md](./references/prompt.md)—structure patterns, section ordering, constraint markers.

---
## [6][NAMING]
>**Dictum:** *Naming conventions enable rapid discovery.*

<br>

| [INDEX] | [PATTERN]       | [EXAMPLE]            | [USE_CASE]            |
| :-----: | --------------- | -------------------- | --------------------- |
|   [1]   | Role-based      | `code-reviewer`      | Specialized function  |
|   [2]   | Action-based    | `generating-commits` | Gerund form preferred |
|   [3]   | Domain-specific | `react-specialist`   | Technology expertise  |

[CRITICAL]:
- [NEVER] Generic names: `helper`, `processor`, `agent`.
- [NEVER] Underscores or mixed case.
- [ALWAYS] Kebab-case—lowercase, hyphens only.
- [ALWAYS] Filename matches `name` field exactly.

---
## [7][TEMPLATES]
>**Dictum:** *Templates accelerate creation via proven patterns.*

<br>

**Reference:** [→agent.template.md](./templates/agent.template.md) — Standard agent scaffold.

---
## [8][WORKFLOW]
>**Dictum:** *Workflow governs phase execution for agent creation.*

<br>

**Required Task:** Consult [→workflow.md](./references/workflow.md)—5-phase creation process (UNDERSTAND, ACQUIRE, RESEARCH, AUTHOR, VALIDATE).

---
## [9][VALIDATION]
>**Dictum:** *Gate checklist prevents registration failures.*

<br>

[VERIFY] Pre-deployment:
- [ ] YAML: `---` delimiters, spaces only—no tabs.
- [ ] `name`: matches filename, without extension.
- [ ] `description`: third person, active, includes "Use when" clause.
- [ ] `tools`: includes `Read` for every `@path` reference.
- [ ] Multi-line descriptions: folded scalar `>-` only.
- [ ] Filename: kebab-case, `.md` extension.

| [INDEX] | [ERROR]           | [SYMPTOM]           | [FIX]                      |
| :-----: | ----------------- | ------------------- | -------------------------- |
|   [1]   | Tab character     | YAML parse failure  | Replace with spaces        |
|   [2]   | Missing delimiter | Frontmatter ignored | Add `---` before and after |
|   [3]   | Name mismatch     | Registration fails  | Match filename exactly     |
|   [4]   | Vague description | Discovery fails     | Add "Use when" + triggers  |
