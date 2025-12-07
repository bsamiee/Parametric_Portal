---
description: Refine existing agent via agent-builder workflow (project)
argument-hint: [agent-path] [goal: optimize|upgrade|audit] [target-type: readonly|write|orchestrator|full?]
---

# [H1][REFINE-AGENT]
>**Dictum:** *Surgical agent refinement improves discovery accuracy and behavioral precision without semantic loss.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope refinement target.*

<br>

Agent: $1<br>
Goal: $2<br>
Target Type: ${3:-current}

---
## [2][REFINEMENT_DIMENSIONS]
>**Dictum:** *Dimensions categorize refinement signals.*

<br>

| [INDEX] | [DIMENSION] | [SIGNALS]                                           | [INTERVENTIONS]                           |
| :-----: | ----------- | --------------------------------------------------- | ----------------------------------------- |
|   [1]   | Discovery   | Missing triggers, vague description, no catch-all   | "Use when" + 3+ scenarios + catch-all     |
|   [2]   | Frontmatter | Name mismatch, wrong voice, missing fields          | kebab-case, third person, complete schema |
|   [3]   | Tools       | Over/under-permissioned, @path without Read         | Scope to minimal per type gate            |
|   [4]   | Model       | Inappropriate for task complexity                   | haiku→sonnet→opus by task type            |
|   [5]   | Prompt      | Missing role line, poor structure, weak constraints | Role → Sections → Constraints → Output    |
|   [6]   | Voice       | Mixed voices, hedging words                         | Third person desc, imperative body        |

---
## [3][SKILL_CONTEXT]
>**Dictum:** *Skill context anchors agent infrastructure.*

<br>

@.claude/skills/agent-builder/SKILL.md
@.claude/skills/agent-builder/index.md

---
## [4][TYPE_GATES]
>**Dictum:** *Type gates scope tools and model selection.*

<br>

| [INDEX] | [TYPE]       | [TOOLS]                       | [MODEL] | [USE_CASE]              |
| :-----: | ------------ | ----------------------------- | :-----: | ----------------------- |
|   [1]   | readonly     | Read, Glob, Grep              | sonnet  | Analysis, review, audit |
|   [2]   | write        | Read, Edit, Write, Glob, Bash | sonnet  | Implementation          |
|   [3]   | orchestrator | Task, Read, Glob, TodoWrite   |  opus   | Agent dispatch          |
|   [4]   | full         | *(omit field)*                | session | General-purpose         |

---
## [5][GOAL_MODES]
>**Dictum:** *Goal modes scope refinement operations.*

<br>

| [INDEX] | [GOAL]   | [SCOPE]     | [OPERATIONS]                                    |
| :-----: | -------- | ----------- | ----------------------------------------------- |
|   [1]   | optimize | Same type   | Discovery, voice, prompt structure, frontmatter |
|   [2]   | upgrade  | Type change | readonly→write→orchestrator→full + optimize     |
|   [3]   | audit    | Read-only   | Violations report, no modifications             |

---
## [6][WORKFLOW]
>**Dictum:** *Phase execution ensures systematic refinement.*

<br>

Execute phases sequentially—ingest, then audit.

### [6.1][INGEST]

Read @$1. Compile inventory:

```
Name: ${name} | Filename: ${filename}
Current Type: ${detected_type} | Target: ${target_type}
Tools: ${tool_list} | Model: ${model}
Description: ${desc_length} chars | Triggers: ${trigger_count}
Prompt LOC: ${loc} | Sections: ${section_list}
```

Auto-detect type from tools field:
- `Read, Glob, Grep` → readonly
- `Read, Edit, Write, Glob, Bash` → write
- `Task, Read, Glob, TodoWrite` → orchestrator
- *(omitted)* → full

---
### [6.2][AUDIT]

Scan violations across dimensions:

| [INDEX] | [DIMENSION] | [SCAN_FOR]                                             |
| :-----: | ----------- | ------------------------------------------------------ |
|   [1]   | Discovery   | Missing "Use when", <3 triggers, no catch-all, hedging |
|   [2]   | Frontmatter | Name≠filename, missing fields, tab chars, wrong voice  |
|   [3]   | Tools       | Type mismatch, @path without Read, over-permissioned   |
|   [4]   | Model       | Inappropriate for task complexity                      |
|   [5]   | Prompt      | Missing role line, poor section order, no constraints  |
|   [6]   | Voice       | Mixed voices, passive constructions, hedging words     |

Dispatch 3 parallel agents via `parallel-dispatch`:

| [INDEX] | [FOCUS]                 | [DELIVERABLE]                                     |
| :-----: | ----------------------- | ------------------------------------------------- |
|   [1]   | Discovery + Frontmatter | Trigger gaps, schema violations, voice issues     |
|   [2]   | Tools + Model           | Permission scope, type alignment, model selection |
|   [3]   | Prompt + Voice          | Structure issues, constraint markers, hedging     |

---
### [6.3][PLAN]

Synthesize findings. Order interventions by priority:

1. **Frontmatter** — Name match, description voice, field completeness
2. **Discovery** — "Use when" clause, trigger scenarios, catch-all
3. **Tools** — Minimal permissions per type gate
4. **Model** — Appropriate for task complexity
5. **Prompt** — Role line, section structure, constraints
6. **Voice** — Consistency, hedging elimination

[VERIFY] Plan complete:
- [ ] All violations addressed.
- [ ] Type gate alignment confirmed.
- [ ] No semantic loss.

---
### [6.4][REFACTOR]

Execute interventions atomically. Validate after each.

**Discovery Optimization:**
- Description: third person, active voice, <1024 chars
- "Use when" clause with 3+ trigger scenarios
- Add catch-all: "or any other {domain} tasks"
- Remove hedging: "might", "could", "should", "probably"

**Frontmatter Optimization:**
- `name`: kebab-case, matches filename exactly
- `tools`: per §TYPE_GATES (omit for full)
- `model`: per task type (omit for session default)
- Multi-line: folded scalar `>-` only

**Prompt Optimization:**
- Role line: imperative, single sentence, concrete deliverable
- Sections: H2 with `[N][SIGIL]` format
- Constraints: [CRITICAL]/[IMPORTANT] markers
- Output: explicit format specification

---
### [6.5][VALIDATE]

[VERIFY] Quality gate:
- [ ] Filename: kebab-case, `.md` extension.
- [ ] `name`: matches filename (without extension).
- [ ] `description`: third person, active, "Use when" clause.
- [ ] `tools`: matches type gate (or omitted for full).
- [ ] YAML: `---` delimiters, spaces only.
- [ ] Role line: imperative, single sentence.

**Regression Gate:**

| [INDEX] | [DIMENSION] | [REQUIREMENT]                           |
| :-----: | ----------- | --------------------------------------- |
|   [1]   | Discovery   | 100% original triggers preserved        |
|   [2]   | Capability  | Same tools/permissions available        |
|   [3]   | Behavior    | Semantic intent unchanged               |
|   [4]   | Type        | Matches target (or current if optimize) |

[CRITICAL]:
- [ALWAYS] Preserve agent capability during refinement.
- [ALWAYS] Validate each transformation atomically.
- [NEVER] Delete triggers to simplify—expand for coverage.
- [NEVER] Over-permission tools—scope to minimal required.
