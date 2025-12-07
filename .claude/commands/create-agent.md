---
description: Create new agent via agent-builder workflow (project)
argument-hint: [agent-name] [type: readonly|write|orchestrator|full] [purpose?]
---

# [H1][CREATE-AGENT]
>**Dictum:** *Parameterized workflow dispatch ensures research-informed agent creation.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Parameters scope workflow execution.*

<br>

Name: $1<br>
Type: $2<br>
Purpose: ${3:-unspecified}

---
## [2][UNIVERSAL_CONTEXT]
>**Dictum:** *Context files anchor agent infrastructure.*

<br>

@.claude/skills/agent-builder/SKILL.md
@.claude/skills/agent-builder/index.md
@.claude/skills/agent-builder/references/frontmatter.md
@.claude/skills/agent-builder/references/prompt.md
@.claude/skills/agent-builder/templates/agent.template.md
@.claude/skills/deep-research/SKILL.md

---
## [3][WORKFLOW]
>**Dictum:** *Workflow file governs phase execution.*

<br>

@.claude/skills/agent-builder/references/workflow.md

---
## [4][TASK]
>**Dictum:** *Sequential phase execution with progressive loading.*

<br>

Execute §CREATE workflow with parameters:

1. **[UNDERSTAND]** — Confirm Name=$1, Type=$2. Parse Purpose=$3 for triggers/deliverable.
2. **[ACQUIRE]** — Load agent-builder sections per Type. Invoke `style-summarizer`.
3. **[RESEARCH]** — Invoke `deep-research`. Plan synthesis with 3 agents.
4. **[AUTHOR]** — Create `.claude/agents/$1.md` per Type gate.
5. **[VALIDATE]** — Dispatch review agents. Verify quality gate.

[CRITICAL]:
- [ALWAYS] Type gates tools AND model—both derived from $2.
- [ALWAYS] Load sections ON-DEMAND per §ACQUIRE constraint table.
- [ALWAYS] Include style constraints in sub-agent dispatch prompts.
- [NEVER] Vague descriptions—"Use when" + triggers required.
- [NEVER] Skip phases or create without research.
