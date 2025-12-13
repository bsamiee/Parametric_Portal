---
description: Create PLAN.md draft from explore output
argument-hint: [discussion-number]
---

# [H1][PM:PLAN]
>**Dictum:** *Structured plans enable context-bounded task decomposition.*

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

@.claude/skills/plan/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][TASK]
>**Dictum:** *Plan structure enables decomposition and governance.*

<br>

Create PLAN.md from explore output for Discussion #$1. Include objectives, architecture decisions, task sizing constraints. Post draft for boardroom critique.

Execute plan skill workflow:
1. **READ** — Get Discussion + locate explore comment with `<!-- SKILL_COMPLETE: explore -->`
2. **STRUCTURE** — Create PLAN.md with all 10 sections from skill template
3. **VALIDATE** — Verify objectives trace to Discussion, approach matches explore recommendation
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

[CRITICAL]:
- [NEVER] Proceed without explore completion marker.
- [ALWAYS] Include TASK_SIZING section — decompose skill depends on it.
- [ALWAYS] Define SCOPE_BOUNDARIES (in/out).
- [ALWAYS] Append `<!-- SKILL_COMPLETE: plan -->` marker to output.
- [ALWAYS] Include "Ready for boardroom critique" status.
