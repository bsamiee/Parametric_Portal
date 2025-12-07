# [H1][FRONTMATTER]
>**Dictum:** *Frontmatter structure determines agent discoverability.*

<br>

[IMPORTANT] Session start triggers frontmatter indexing. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Minimal schema reduces configuration overhead.*

<br>

| [INDEX] | [FIELD]       | [TYPE] | [REQ] | [CONSTRAINT]                             |
| :-----: | ------------- | ------ | :---: | ---------------------------------------- |
|   [1]   | `name`        | string |  Yes  | Kebab-case, max 64 chars, match file.    |
|   [2]   | `description` | string |  Yes  | Max 1024 chars, third person voice.      |
|   [3]   | `tools`       | list   |  No   | Comma-separated; omit = all tools.       |
|   [4]   | `model`       | enum   |  No   | `haiku`, `sonnet`, `opus`, `inherit`.    |
|   [5]   | `skills`      | list   |  No   | Skill names for progressive loading.     |
|   [6]   | `color`       | string |  No   | Hex color `#RRGGBB` for terminal output. |

<br>

### [1.1][NAME]

| [INDEX] | [VALID]            | [INVALID]          |
| :-----: | ------------------ | ------------------ |
|   [1]   | `code-reviewer`    | `Code_Reviewer`    |
|   [2]   | `react-specialist` | `react.specialist` |
|   [3]   | `pdf-processor`    | `pdf processor`    |

[IMPORTANT]:
- [ALWAYS] Lowercase letters, numbers, hyphens only.
- [ALWAYS] Match filename exactly—without `.md`.

---
### [1.2][DESCRIPTION]
>**Dictum:** *Description quality determines invocation accuracy.*

<br>

Semantic matching via reasoning—no embeddings, no keyword matching.

**Voice Constraints:**<br>
- Third person: "Analyzes..." never "I analyze".
- Active voice: "Creates data" never "Data is created".
- Present tense: "Validates..." never "Will validate".
- No hedging: reject `might`, `could`, `should`.

**Structure Pattern:**<br>
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

<br>

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
|   [4]   | Quote special chars      | Unquoted `: # [ ] { }`   | Field value corrupted |
|   [5]   | Use `>-` for multi-line  | Literal scalar `\|`      | Indexing error        |

**Multi-line Pattern:**<br>

```yaml
description: >-
  Comprehensive agent creation with support for frontmatter,
  tools, and prompts. Use when building, configuring, or
  validating Claude Code agents.
```

---
## [4][EXAMPLES]
>**Dictum:** *Examples accelerate learning via proven patterns.*

<br>

```yaml
# Minimal:
---
name: code-reviewer
description: Reviews code for quality and security. Use proactively after code changes, when reviewing PRs, or auditing commits.
---

# With tools + proactive trigger:
---
name: react-specialist
description: React 19 + Server Components expert. MUST BE USED when optimizing components, implementing hooks, or debugging renders.
tools: Read, Glob, Grep, Edit
model: sonnet
---

# With inherit model:
---
name: refactoring-architect
description: TypeScript refactoring specialist. Use proactively when reducing LOC, consolidating functions, or optimizing patterns.
tools: Read, Glob, Grep, Edit, TodoWrite
model: inherit
skills: style-standards
---
```

---
## [5][VALIDATION]
>**Dictum:** *Gate checklist prevents discovery failures.*

<br>

[VERIFY] Pre-deployment:
- [ ] Delimiters: `---` on line 1; closing `---` on own line.
- [ ] Syntax: spaces only—no tabs; quote special characters.
- [ ] `name`: lowercase + hyphens; max 64 chars; matches file.
- [ ] `description`: third person, active voice, present tense.
- [ ] `description`: includes "Use when" + 3+ trigger scenarios.
- [ ] `description`: catch-all phrase for broader applicability.
- [ ] Multi-line: folded scalar `>-` only—never `|`.
