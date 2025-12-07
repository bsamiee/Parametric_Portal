---
description: Create new skill via skill-builder workflow (project)
argument-hint: [type: simple|standard|complex] [depth: base|extended|full] [context?]
---

# [H1][CREATE-SKILL]
>**Dictum:** *Parameterized workflow dispatch ensures structured skill creation.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope workflow execution.*

<br>

Scope: create<br>
Type: $1<br>
Depth: $2<br>
Context: ${3:-none}

---
## [2][UNIVERSAL_CONTEXT]
>**Dictum:** *Context files anchor skill infrastructure.*

<br>

@.claude/skills/skill-builder/SKILL.md
@.claude/skills/skill-builder/index.md
@.claude/skills/skill-builder/references/frontmatter.md
@.claude/skills/deep-research/SKILL.md

---
## [3][WORKFLOW]
>**Dictum:** *Workflow file governs phase execution.*

<br>

@.claude/skills/skill-builder/references/workflows/create.md

---
## [4][TASK]
>**Dictum:** *Sequential phase execution with progressive loading.*

<br>

Execute §CREATE workflow with parameters:

1. **[UNDERSTAND]** — Confirm Type=$1, Depth=$2. Parse Context=$3 for purpose/triggers/outputs.
2. **[ACQUIRE]** — Load skill-builder sections per constraint table. Invoke `style-summarizer`.
3. **[RESEARCH]** — Invoke `deep-research`. Plan synthesis with 3 agents.
4. **[AUTHOR]** — Create artifacts per Type gate.
5. **[VALIDATE]** — Dispatch review agents. Verify quality gate.

[CRITICAL]:
- [ALWAYS] Include `type` and `depth` frontmatter—refine workflow requires these fields.
- [ALWAYS] Load sections ON-DEMAND per §ACQUIRE constraint table.
- [ALWAYS] Include style constraints in sub-agent dispatch prompts.
- [NEVER] Skip phases or create empty folders.
