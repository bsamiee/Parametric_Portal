---
description: Create new slash command via command-builder workflow (project)
argument-hint: [command-name] [pattern: file|multi|agent|skill|free] [purpose?]
---

# [H1][CREATE-COMMAND]
>**Dictum:** *Parameterized workflow dispatch ensures research-informed command creation.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope workflow execution.*

<br>

Name: $1<br>
Pattern: $2<br>
Purpose: ${3:-unspecified}

---
## [2][UNIVERSAL_CONTEXT]
>**Dictum:** *Context files anchor command infrastructure.*

<br>

@.claude/skills/command-builder/SKILL.md
@.claude/skills/command-builder/index.md
@.claude/skills/command-builder/references/variables.md
@.claude/skills/command-builder/references/hints.md
@.claude/skills/command-builder/templates/command-template.md
@.claude/skills/deep-research/SKILL.md

---
## [3][WORKFLOW]
>**Dictum:** *Workflow file governs phase execution.*

<br>

@.claude/skills/command-builder/references/workflow.md

---
## [4][TASK]
>**Dictum:** *Sequential phase execution with progressive loading.*

<br>

Execute §CREATE workflow with parameters:

1. **[UNDERSTAND]** — Confirm Name=$1, Pattern=$2. Parse Purpose=$3 for triggers/args.
2. **[ACQUIRE]** — Load command-builder sections per Pattern. Invoke `style-summarizer`.
3. **[RESEARCH]** — Invoke `deep-research`. Plan synthesis with 3 agents.
4. **[AUTHOR]** — Create `.claude/commands/$1.md` per Pattern gate.
5. **[VALIDATE]** — Dispatch review agents. Verify quality gate.

[CRITICAL]:
- [ALWAYS] Pattern gates tools AND structure—both derived from $2.
- [ALWAYS] Load sections ON-DEMAND per §ACQUIRE constraint table.
- [ALWAYS] Include style constraints in sub-agent dispatch prompts.
- [NEVER] Exceed 125 LOC—single-file density.
- [NEVER] Mix $ARGUMENTS + $1-$N in same command.
