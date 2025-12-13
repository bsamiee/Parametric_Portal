---
description: Research options for Discussion and recommend approach
argument-hint: [discussion-number]
---

# [H1][PM:EXPLORE]
>**Dictum:** *Research-backed recommendations enable autonomous progression.*

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

@.claude/skills/explore/SKILL.md
@.claude/skills/deep-research/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][TASK]
>**Dictum:** *Deep research surfaces competing approaches.*

<br>

Research options for Discussion #$1 via deep-research skill. Synthesize 2-3 competing approaches with trade-offs. Post recommendation with completion marker.

Execute explore skill workflow:
1. **READ** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-view --number $1`
2. **RESEARCH** — Invoke `deep-research` skill with Discussion content as topic
3. **SYNTHESIZE** — Produce recommendation with APPROACHES, RECOMMENDATION, NEXT_STEPS
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

[CRITICAL]:
- [ALWAYS] Extract node ID from Discussion — required for posting.
- [ALWAYS] Retain 2-3 competing approaches for trade-off analysis.
- [ALWAYS] End with concrete NEXT_STEPS (not open questions).
- [ALWAYS] Append `<!-- SKILL_COMPLETE: explore -->` marker to output.
- [NEVER] Post if output contains unresolved questions.
