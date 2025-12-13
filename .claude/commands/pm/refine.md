---
description: Incorporate boardroom critique into revised plan
argument-hint: [discussion-number]
---

# [H1][PM:REFINE]
>**Dictum:** *Critique incorporation enables convergent planning.*

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

@.claude/skills/refine/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][TASK]
>**Dictum:** *Minimal changes preserve plan coherence.*

<br>

Incorporate boardroom critique into PLAN.md for Discussion #$1. Address all convergent concerns. Document resolutions in REVISION_NOTES. Post refined plan for next boardroom review.

Execute refine skill workflow:
1. **READ** — Get Discussion + locate plan and boardroom comments
2. **ANALYZE** — Extract convergent concerns (2+ agents = mandatory), divergent views (1 agent = consider)
3. **REVISE** — Update plan sections addressing concerns, add REVISION_NOTES section
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

**Concern Priority:**
| [PRIORITY] | [SOURCE]               | [ACTION]                 |
| ---------- | ---------------------- | ------------------------ |
| Mandatory  | Convergent (2+ agents) | Must address in revision |
| Consider   | Divergent (1 agent)    | Address if low-cost      |
| Preserve   | Strengths              | Maintain in revision     |

[CRITICAL]:
- [NEVER] Proceed if boardroom vote is approve or block — refine only on revise.
- [ALWAYS] Address ALL convergent concerns.
- [ALWAYS] Document resolution for each concern in REVISION_NOTES.
- [ALWAYS] Increment cycle number in header.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: refine -->` marker to output.
- [NEVER] Make changes unrelated to boardroom concerns.
