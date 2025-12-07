---
description: Create new slash command via command-builder workflow (project)
argument-hint: [command-name] [pattern: file|multi|agent|skill|free] [purpose?]
---

# [H1][CREATE-COMMAND]
>**Dictum:** *Research-informed command creation maximizes capability per LOC.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope command creation.*

<br>

Name: $1<br>
Pattern: $2<br>
Purpose: ${3:-unspecified}

---
## [2][CONSTRAINTS]
>**Dictum:** *Constraints enforce command specification limits.*

<br>

| [INDEX] |  [LIMIT]  | [VALUE]     | [RATIONALE]                |
| :-----: | :-------: | ----------- | -------------------------- |
|   [1]   |    LOC    | <125        | Single-file density        |
|   [2]   | Variables | ONE pattern | $ARGUMENTS XOR $1-$N       |
|   [3]   |   Tools   | Minimal     | Scope to pattern needs     |
|   [4]   |  Naming   | verb-first  | `action-target` convention |
|   [5]   |   Focus   | Single      | One concern per command    |

---
## [3][SKILL_CONTEXT]
>**Dictum:** *Skill context anchors command infrastructure.*

<br>

@.claude/skills/command-builder/SKILL.md
@.claude/skills/command-builder/references/variables.md
@.claude/skills/command-builder/references/hints.md
@.claude/skills/command-builder/templates/command-template.md

---
## [4][WORKFLOW]
>**Dictum:** *Phase execution ensures research-informed creation.*

<br>

Execute phases sequentially. Research before authoring.

### [4.1][UNDERSTAND]

Confirm before proceeding:
- `Name` — Verb-first, lowercase, hyphens. Reject: run, do, execute, go.
- `Pattern` — file|multi|agent|skill|free. Gates structure.
- `Arguments` — What inputs? Structured ($1-$N) or free-form ($ARGUMENTS)?
- `Tools` — What permissions? Match @path→Read, !cmd→Bash.
- `Triggers` — What user intent activates this command?

---
### [4.2][ACQUIRE]

Invoke `style-summarizer` for voice constraints. Compile manifest:

```
Name: ${name} | Pattern: ${pattern}
LOC: <125 | Variables: ${var_pattern}
Tools: ${tool_list} | Arguments: ${arg_structure}
```

---
### [4.3][RESEARCH]

Invoke `deep-research`:

| [PARAM] | [VALUE] |
| --- | --- |
| Topic | Slash command design for ${pattern} pattern: ${purpose} |
| Constraints | Manifest §4.2, style from style-summarizer, AgentCount: 6/4 |

@.claude/skills/deep-research/SKILL.md

Post-dispatch: Extract validated findings, synthesize golden path.

---
### [4.4][AUTHOR]

Create `.claude/commands/$1.md`:

1. **Frontmatter** — description (verb-first, <80 chars), argument-hint, allowed-tools, model.
2. **Header** — H1 with Dictum anchoring command purpose.
3. **Parameters** — Display arguments with defaults.
4. **Context** — Skill @paths or !shell as needed.
5. **Task** — Numbered steps, pattern-appropriate structure.
6. **Constraints** — [CRITICAL]/[IMPORTANT] guards.

**Model Selection:**

| [INDEX] | [PATTERN] | [MODEL] | [RATIONALE]               |
| :-----: | --------- | :-----: | ------------------------- |
|   [1]   | file      |  haiku  | Fast single-file analysis |
|   [2]   | multi     | sonnet  | Balanced iteration        |
|   [3]   | agent     |  opus   | Complex orchestration     |
|   [4]   | skill     | sonnet  | Validation + edits        |
|   [5]   | free      | session | Inherit default           |

---
### [4.5][VALIDATE]

[VERIFY] Pre-deployment:
- [ ] LOC < 125.
- [ ] Valid YAML (---delimiters, no tabs).
- [ ] All @path have Read declared.
- [ ] All !cmd have Bash declared.
- [ ] No $ARGUMENTS + $1-$N mixing.
- [ ] Name: lowercase, hyphens, verb-first.

---
## [5][PATTERN_GATES]
>**Dictum:** *Pattern gates scope structure and tools.*

<br>

| [INDEX] | [PATTERN] | [STRUCTURE]                    | [TOOLS]                     | [SCOPE]           |
| :-----: | --------- | ------------------------------ | --------------------------- | ----------------- |
|   [1]   | file      | @$1 target, analyze, report    | Read                        | Read-only         |
|   [2]   | multi     | Glob $1, iterate, apply        | Read, Edit, Glob, TodoWrite | Write-capable     |
|   [3]   | agent     | Dispatch Task, synthesize      | Task, Read, Glob, TodoWrite | Orchestration     |
|   [4]   | skill     | Load @skill, validate, correct | Read, Task, Edit, TodoWrite | Validation        |
|   [5]   | free      | $ARGUMENTS prose, flexible     | Varies                      | Context-dependent |

---
## [6][NAMESPACE]
>**Dictum:** *Namespace organization enables discovery.*

<br>

Organize related commands in subdirectories:

```
.claude/commands/
├── git/commit.md    → /git:commit
├── test/unit.md     → /test:unit
└── review/pr.md     → /review:pr
```

[CRITICAL]:
- [ALWAYS] Research before authoring—Exa queries inform structure.
- [ALWAYS] Dispatch parallel agents for comprehensive coverage.
- [ALWAYS] Scope tools minimally—read-only unless writes required.
- [NEVER] Skip validation—broken commands fail silently.
- [NEVER] Add features beyond single concern—avoid over-engineering.
