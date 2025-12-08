---
description: Refine existing command via command-builder workflow (project)
argument-hint: [command-path] [goal: optimize|upgrade|audit] [target-pattern: file|multi|agent|skill|free?]
---

# [H1][REFINE-COMMAND]
>**Dictum:** *Surgical transformation maximizes capability per LOC without semantic loss.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope refinement target.*

<br>

Command: $1<br>
Goal: $2<br>
Target Pattern: ${3:-current}

---
## [2][REFINEMENT_DIMENSIONS]
>**Dictum:** *Dimensions categorize refinement signals.*

<br>

| [INDEX] | [DIMENSION]      | [SIGNALS]                                          | [INTERVENTIONS]                           |
| :-----: | ---------------- | -------------------------------------------------- | ----------------------------------------- |
|   [1]   | Density          | Prose blocks, redundancy, LOC >100                 | Tables, consolidation, compression        |
|   [2]   | Frontmatter      | Vague description, missing hints, tool gaps        | Verb-first, scoped tools, model selection |
|   [3]   | Variables        | Pattern mixing, missing defaults, undeclared tools | $ARGUMENTS XOR $1-$N, ${N:-default}       |
|   [4]   | Structure        | Missing Dictum, weak constraints, poor ordering    | H1/H2 sigils, [CRITICAL]/[IMPORTANT]      |
|   [5]   | Over-Engineering | Multiple concerns, unused features                 | Single focus, minimal complexity          |

---
## [3][SKILL_CONTEXT]
>**Dictum:** *Skill context anchors command infrastructure.*

<br>

@.claude/skills/command-builder/SKILL.md
@.claude/skills/command-builder/references/variables.md
@.claude/skills/command-builder/references/hints.md

---
## [4][GOAL_MODES]
>**Dictum:** *Goal modes scope refinement operations.*

<br>

| [INDEX] | [GOAL]   | [SCOPE]        | [OPERATIONS]                           |
| :-----: | -------- | -------------- | -------------------------------------- |
|   [1]   | optimize | Same pattern   | Density, voice, variables, frontmatter |
|   [2]   | upgrade  | Pattern change | file→multi→agent→skill + optimize      |
|   [3]   | audit    | Read-only      | Violations report, no modifications    |

---
## [5][WORKFLOW]
>**Dictum:** *Phase execution ensures systematic refinement.*

<br>

Execute phases sequentially. Ingest before audit.

### [5.1][INGEST]

Read @$1. Compile inventory:

```
Current LOC: ${loc} | Limit: <125 | Headroom: ${delta}
Pattern: ${detected_pattern} | Target: ${target_pattern}
Variables: ${var_pattern} | Tools: ${tool_list}
Frontmatter: description | argument-hint | allowed-tools | model
```

Auto-detect pattern from structure:
- `@$1` target → file
- `Glob` + iterate → multi
- `Task` dispatch → agent
- `@skill` + validate → skill
- `$ARGUMENTS` prose → free

---
### [5.2][AUDIT]

Scan for violations across dimensions:

| [INDEX] | [DIMENSION]      | [SCAN_FOR]                                                       |
| :-----: | ---------------- | ---------------------------------------------------------------- |
|   [1]   | Frontmatter      | Missing description, undeclared tools, no model rationale        |
|   [2]   | Variables        | $ARGUMENTS + $1-$N mixing, @path without Read, !cmd without Bash |
|   [3]   | Structure        | Missing Dictum, no [CRITICAL]/[IMPORTANT], poor section order    |
|   [4]   | Density          | Prose >5 lines, redundant instructions, LOC >100                 |
|   [5]   | Over-Engineering | Multiple concerns, unused complexity, feature creep              |

Dispatch 3 parallel agents via `parallel-dispatch`:

| [INDEX] | [FOCUS]                    | [DELIVERABLE]                                         |
| :-----: | -------------------------- | ----------------------------------------------------- |
|   [1]   | Frontmatter + Variables    | Tool/variable violations, declaration gaps            |
|   [2]   | Structure + Density        | Compression candidates, ordering issues               |
|   [3]   | Pattern + Over-Engineering | Pattern appropriateness, simplification opportunities |

---
### [5.3][PLAN]

Synthesize findings. Order interventions by priority:

1. **Violations** — Frontmatter, variables, tool declarations
2. **Density** — Prose→table, redundancy elimination
3. **Structure** — Dictum, constraints, section ordering
4. **Upgrade** — Pattern change (if goal=upgrade)
5. **Simplification** — Remove over-engineering

[VERIFY] Plan complete:
- [ ] All violations addressed.
- [ ] LOC projection <125.
- [ ] No semantic loss.

---
### [5.4][REFACTOR]

Execute interventions atomically. Validate after each.

**Frontmatter Optimization:**
- Description: verb-first, <80 chars, outcome-focused
- argument-hint: `[required]` `[name: opt1|opt2?]` per hints.md
- allowed-tools: minimal permissions per pattern
- model: haiku (fast) | sonnet (balanced) | opus (complex)

**Variable Optimization:**
- Choose ONE: $ARGUMENTS (free-form) XOR $1-$N (structured)
- Add ${N:-default} for all optionals
- Verify: @path → Read declared, !cmd → Bash declared

**Density Compression:**
- Prose blocks → numbered lists or tables
- Inline redundancy → single source of truth
- Static values → manifest block

---
### [5.5][VALIDATE]

[VERIFY] Quality gate:
- [ ] LOC <125.
- [ ] Valid YAML (--- delimiters, spaces only).
- [ ] All tool declarations complete.
- [ ] No variable pattern mixing.
- [ ] Semantic capability preserved.
- [ ] Pattern-appropriate structure.

**Regression Gate:**

| [INDEX] | [DIMENSION] | [REQUIREMENT]                    |
| :-----: | ----------- | -------------------------------- |
|    1    | Capability  | 100% original triggers preserved |
|    2    | Arguments   | All inputs still accepted        |
|    3    | Outputs     | Same deliverables produced       |
|    4    | LOC         | Within <125 limit                |
|    5    | Density     | Meaning per LOC improved         |

[CRITICAL]:
- [ALWAYS] Compress representation, never meaning.
- [ALWAYS] Validate each transformation atomically.
- [NEVER] Delete capability to meet LOC—refactor for density.
- [NEVER] Add complexity during refinement.