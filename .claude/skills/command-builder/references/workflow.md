# [H1][WORKFLOW_CREATE]
>**Dictum:** *Sequential phases ensure research-informed command creation.*

<br>

[IMPORTANT] Parameters (`Name`, `Pattern`, `Purpose`) from command. Reference throughout for constraint enforcement.

---
## [1][UNDERSTAND]
>**Dictum:** *Clear requirements prevent rework.*

<br>

Confirm before proceeding:
- `Name` — Verb-first, lowercase, hyphens. Reject: run, do, execute, go.
- `Pattern` — file|multi|agent|skill|free. Gates structure + tools.
- `Arguments` — Structured ($1-$N) or free-form ($ARGUMENTS)?
- `Tools` — What permissions? Match @path→Read, !cmd→Bash.
- `Triggers` — What user intent activates this command?

[REFERENCE] Requirements gate: [→validation.md§1](./validation.md#1requirements_gate)

---
## [2][ACQUIRE]
>**Dictum:** *Context loading enables informed research.*

<br>

### [2.1][LOAD_CONSTRAINTS]

Load command-builder sections per Pattern:

| [CONDITION] | [LOAD]                                |
| ----------- | ------------------------------------- |
| All         | §FRONTMATTER, §VARIABLES, §VALIDATION |
| file        | Single-file pattern focus             |
| multi       | Glob iteration patterns               |
| agent       | Task dispatch patterns                |
| skill       | Skill @path patterns                  |
| free        | $ARGUMENTS handling                   |

---
### [2.2][LOAD_STANDARDS]

Invoke `skill-summarizer` with skill `style-standards`. Extract:
- Voice constraints (verb-first descriptions, imperative tasks).
- Formatting rules (H2 sections, constraint markers).

[CRITICAL] Include style constraints in sub-agent prompts.

---
### [2.3][SCAFFOLD]

Compile constraint manifest before research:

```
Name: ${name} | Pattern: ${pattern}
LOC: <125 | Variables: ${var_pattern}
Tools: ${tool_list} | Arguments: ${arg_structure}
```

---
## [3][RESEARCH]
>**Dictum:** *Specialized agents maximize research coverage.*

<br>

Invoke `deep-research`:

| [PARAM]     | [VALUE]                                                   |
| ----------- | --------------------------------------------------------- |
| Topic       | Slash command design for ${pattern} pattern: ${purpose}   |
| Constraints | Manifest §2.3, style §2.2, AgentCount: 6 Round1, 4 Round2 |

[REFERENCE]: [→deep-research](../../deep-research/SKILL.md)

**Post-dispatch:** Receive validated findings. Proceed to §3.1.

---
### [3.1][PLAN_SYNTHESIS]

Invoke `parallel-dispatch` with 3 planning agents.

**Input:** Research findings, constraint manifest, command-builder SKILL.md + references, template.<br>
**Deliverable:** Frontmatter fields, section structure, tool list.<br>
**Golden-path synthesis:** Combine strongest elements. Resolve conflicts via Pattern hierarchy.

[REFERENCE] Plan gate: [→validation.md§2](./validation.md#2plan_gate)

---
## [4][AUTHOR]
>**Dictum:** *Pattern gates prevent scope violations.*

<br>

### [4.1][CREATE_ARTIFACT]

Create `.claude/commands/${name}.md`:

| [STEP] | [COMPONENT] | [ACTION]                                  |
| :----: | ----------- | ----------------------------------------- |
|   1    | Frontmatter | description, argument-hint, allowed-tools |
|   2    | Header      | H1 with Dictum anchoring command purpose  |
|   3    | Parameters  | Display arguments with defaults           |
|   4    | Context     | Skill @paths or !shell as needed          |
|   5    | Task        | Numbered steps, pattern-appropriate       |
|   6    | Constraints | [CRITICAL]/[IMPORTANT] guards             |

**Pattern Gates:**

| [PATTERN] | [TOOLS]                     | [MODEL] | [STRUCTURE]                 |
| --------- | --------------------------- | :-----: | --------------------------- |
| file      | Read                        |  haiku  | @$1 target, analyze, report |
| multi     | Read, Edit, Glob, TodoWrite | sonnet  | Glob $1, iterate, apply     |
| agent     | Task, Read, Glob, TodoWrite |  opus   | Dispatch Task, synthesize   |
| skill     | Read, Task, Edit, TodoWrite | sonnet  | Load @skill, validate       |
| free      | Varies                      | session | $ARGUMENTS prose            |

[CRITICAL]:
- [ALWAYS] Validate artifact against template before completion.
- [ALWAYS] Verb-first description, <80 chars.
- [NEVER] Exceed 125 LOC—single-file density.

---
## [5][VALIDATE]
>**Dictum:** *Parallel review ensures comprehensive quality.*

<br>

Invoke `parallel-dispatch` with 3 review agents.

**Input:** Command file, plan + manifest, command-builder SKILL.md + references.<br>
**Review scope:** Frontmatter validity, tool declarations, variable consistency, LOC compliance.<br>
**Post-dispatch:** Compile findings, reject false positives, apply fixes.

[REFERENCE] Artifact gate: [→validation.md§3](./validation.md#3artifact_gate)
