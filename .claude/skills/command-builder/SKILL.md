---
name: command-builder
type: standard
depth: base
description: Creates and configures Claude Code slash commands with YAML frontmatter, argument handling, and tool permissions. Use when building new commands, adding $ARGUMENTS or $1-$N parameters, configuring allowed-tools, organizing command namespaces, or fixing command failures.
---

# [H1][COMMAND-BUILDER]
>**Dictum:** *Discoverable prompt templates reduce repetitive instruction and enforce consistency.*

<br>

[CRITICAL] Load commands from `.claude/commands/` (project) or `~/.claude/commands/` (user). Filename becomes command name.

[REFERENCE]: [→index.md](./index.md) — Complete reference file listing.

---
## [1][FRONTMATTER]
>**Dictum:** *Frontmatter gates command execution through declarative constraints.*

<br>

```yaml
---
description: Brief description shown in /help menu
argument-hint: [required-arg] [optional-arg?]
allowed-tools: Read, Write, Edit, Glob, Grep, Task, Bash, TodoWrite
model: opus
---
```

| [INDEX] | [FIELD]             | [TYPE] | [PURPOSE]               | [SYNTAX]                                |
| :-----: | ------------------- | ------ | ----------------------- | --------------------------------------- |
|   [1]   | **`description`**   | string | `/help` menu text       | Verb-first. <80 chars. Outcome-focused. |
|   [2]   | **`argument-hint`** | string | Autocomplete guidance   | `[required]` `[optional?]` `[--flag]`.  |
|   [3]   | **`allowed-tools`** | list   | Scoped tool permissions | Comma-separated tool names.             |
|   [4]   | **`model`**         | string | Override default model  | Full model ID or alias.                 |

[IMPORTANT]:
- [ALWAYS] Use `---` delimiters (three dashes, no spaces).
- [ALWAYS] Quote strings containing `:`, `#`, `[`, `]`, `{`, `}`.
- [NEVER] Use tabs; YAML requires spaces.

[CRITICAL]:
- [ALWAYS] Declare `Read` for every `@path` reference.
- [ALWAYS] Declare `Bash` for every `!command` reference.
- [NEVER] Omit required tools—command fails without output.

**Task:**<br>
1. Read [→hints.md](./references/hints.md): Argument-hint syntax, enum patterns, ordering rules.

---
## [2][MODELS]
>**Dictum:** *Model selection controls complexity ceiling and resource allocation.*

<br>

[CRITICAL] Session inherits default model. Override for specific capability requirements.

| [INDEX] | [MODEL_ID]                       | [ALIAS] | [STRENGTH]           | [LATENCY] | [COST] |
| :-----: | -------------------------------- | ------- | -------------------- | :-------: | :----: |
|   [1]   | **`claude-opus-4-5-20251101`**   | opus    | Complex reasoning    |   High    |  High  |
|   [2]   | **`claude-sonnet-4-5-20250929`** | sonnet  | Balanced performance |  Medium   | Medium |
|   [3]   | **`claude-3-5-haiku-20241022`**  | haiku   | Fast, simple tasks   |    Low    |  Low   |

| [INDEX] | [CHARACTERISTIC]         | [OPUS] | [SONNET] | [HAIKU] |
| :-----: | ------------------------ | :----: | :------: | :-----: |
|   [1]   | **Multi-file scope**     |   X    |          |         |
|   [2]   | **Architectural impact** |   X    |          |         |
|   [3]   | **Standard development** |        |    X     |         |
|   [4]   | **Speed priority**       |        |          |    X    |
|   [5]   | **Deep analysis**        |   X    |    X     |         |

---
## [3][VARIABLES]
>**Dictum:** *Dynamic substitution eliminates hardcoding and enables reusable commands.*

<br>

| [INDEX] | [SYNTAX]          | [CAPTURES]            | [REQUIRED_TOOL] | [USE_WHEN]           |
| :-----: | ----------------- | --------------------- | --------------- | -------------------- |
|   [1]   | **`$ARGUMENTS`**  | All args as string    | None            | Free-form input      |
|   [2]   | **`$1`, `$2`...** | Positional parameters | None            | Structured multi-arg |
|   [3]   | **`${1:-val}`**   | Default if missing    | None            | Optional parameters  |
|   [4]   | **`@path`**       | Include file contents | `Read`          | File analysis        |
|   [5]   | **`!command`**    | Shell execution       | `Bash`          | Dynamic context      |

[CRITICAL]:
- [NEVER] Mix `$ARGUMENTS` and `$1-$N` in same command.
- [ALWAYS] Declare required tools for `@path` and `!command`.

[→references/variables.md](./references/variables.md): Complete reference—examples, skill loading, anti-patterns.

---
## [4][PATTERNS]
>**Dictum:** *Canonical patterns accelerate development and prevent structural errors.*

<br>

### [4.1][FILE_ANALYSIS]

```markdown
---
description: Analyze file for issues
argument-hint: [file-path]
allowed-tools: Read
---
## Target
@$1
## Task
Identify security, performance, and code quality issues.
```

---
### [4.2][MULTI_FILE_OPERATION]

```markdown
---
description: Process files matching pattern
argument-hint: [glob-pattern]
allowed-tools: Read, Edit, Glob, TodoWrite
---
## Task
Match files via $1. Analyze content. Apply fixes. Track progress via TodoWrite.
```

---
### [4.3][AGENT_WORKFLOW]

```markdown
---
description: Multi-agent analysis
argument-hint: [target-folder]
allowed-tools: Task, Read, Glob, TodoWrite
---
## Task
1. Match files in $1 via Glob
2. Spawn analysis agents via Task
3. Synthesize findings, track via TodoWrite
```

---
### [4.4][SKILL_CONTEXT]

```markdown
---
description: Validate target against skill standards
argument-hint: [target] [focus?]
allowed-tools: Read, Task, Glob, Edit, TodoWrite
---
## Skill Context
@.claude/skills/[skill-name]/SKILL.md
@.claude/skills/[skill-name]/references/[domain]/*.md
## Task
Load context above. Spawn Task agents. Verify findings against loaded context. Apply corrections.
```

[→templates/command-template.md](./templates/command-template.md) — canonical template.

---
## [5][ORGANIZATION]
>**Dictum:** *Namespaces partition command scope and prevent collision.*

<br>

| [INDEX] | [SCOPE]      | [LOCATION]            | [USE_CASE]            |
| :-----: | ------------ | --------------------- | --------------------- |
|   [1]   | **Personal** | `~/.claude/commands/` | Individual workflows  |
|   [2]   | **Project**  | `.claude/commands/`   | Shared team workflows |

| [INDEX] | [CONVENTION]         | [PATTERN]       | [EXAMPLE]          |
| :-----: | -------------------- | --------------- | ------------------ |
|   [1]   | **Verb-first**       | `action-target` | `create-component` |
|   [2]   | **Lowercase**        | No capitals     | `review-pr`        |
|   [3]   | **Hyphen-separated** | No underscores  | `run-tests`        |
|   [4]   | **Descriptive**      | Clear purpose   | `analyze-coverage` |

```text
.claude/commands/
├── git/
│   ├── commit.md  -> /git:commit
│   └── pr.md      -> /git:pr
└── test/
    └── unit.md    -> /test:unit
```

---
## [6][VALIDATION]
>**Dictum:** *Validation prevents broken command deployment.*

<br>

[IMPORTANT]:
- [ALWAYS] Keep commands under 125 LOC.
- [ALWAYS] Use `Glob` for file discovery, `Read` for content, `Grep` for search.

[CRITICAL]:
- [NEVER] Hardcode paths; use arguments.
- [NEVER] Use generic names: `run`, `do`, `execute`, `go`.
- [NEVER] Use abbreviations without context: `gc`, `rp`, `dt`.

[VERIFY]:
- [ ] *Filename:* Lowercase, hyphens, `.md` extension.
- [ ] *Frontmatter:* Valid YAML, `---` delimiters, description present.
- [ ] *Tools:* All `@path` have `Read`, all `!command` have `Bash`.
- [ ] *Variables:* No `$ARGUMENTS` + `$1-$N` mixing.

| [INDEX] | [ERROR]               | [SYMPTOM]           | [FIX]                       |
| :-----: | --------------------- | ------------------- | --------------------------- |
|   [1]   | **Tab character**     | YAML parse failure  | Replace with spaces.        |
|   [2]   | **Missing delimiter** | Frontmatter ignored | Add `---` before and after. |
|   [3]   | **Unquoted special**  | Field truncated     | Quote the value.            |
|   [4]   | **Missing tool**      | Silent failure      | Add to `allowed-tools`.     |
