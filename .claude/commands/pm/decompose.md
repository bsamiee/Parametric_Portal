---
description: Break approved plan into context-bounded tasks
argument-hint: [discussion-number]
---

# [H1][PM:DECOMPOSE]
>**Dictum:** *Context-bounded tasks enable single-agent completion.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Explicit parameters prevent ambiguity.*

<br>

**Discussion:** `$1`

---
## [2][CONTEXT]
>**Dictum:** *Skill context grants orchestration authority.*

<br>

@.claude/skills/decompose/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][SIZING]
>**Dictum:** *Constraints prevent context overflow.*

<br>

| [CONSTRAINT]    | [LIMIT] | [VIOLATION_ACTION]  |
| --------------- | ------: | ------------------- |
| Max files       |      10 | Split into subtasks |
| Max lines       |     500 | Split into subtasks |
| Max new files   |       3 | Split into subtasks |
| Max deps        |       5 | Split into subtasks |
| Estimated turns |      15 | Split into subtasks |

---
## [4][TASK]
>**Dictum:** *Each task fits single agent context window.*

<br>

Decompose approved plan for Discussion #$1 into context-bounded tasks. Enforce sizing limits. Map dependencies. Post task inventory for human review.

Execute decompose skill workflow:
1. **READ** — Get Discussion + locate approved plan (boardroom vote = approve)
2. **ANALYZE** — Extract objectives, scope, architecture decisions, task sizing constraints
3. **DECOMPOSE** — Break UPCOMING items into tasks within sizing limits
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

**Task Structure:**
- OBJECTIVE — What task accomplishes
- CONTEXT — Project, Discussion, approach reference
- SCOPE — File/line/dependency estimates vs limits
- ACCEPTANCE_CRITERIA — Testable checkboxes
- DEPENDENCIES — Blocked by / Blocks (task indices)

[CRITICAL]:
- [NEVER] Proceed if boardroom vote is not approve.
- [ALWAYS] Apply sizing constraints — no task exceeds any limit.
- [ALWAYS] Define dependencies as DAG (directed acyclic graph).
- [ALWAYS] First task has no blockers.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: decompose -->` marker to output.
- [ALWAYS] State "Awaiting human approval" status.
