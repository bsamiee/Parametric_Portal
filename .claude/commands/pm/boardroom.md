---
description: Dispatch 5 critique agents and synthesize votes
argument-hint: [discussion-number]
---

# [H1][PM:BOARDROOM]
>**Dictum:** *Multi-personality critique surfaces blind spots before commitment.*

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

@.claude/skills/boardroom/SKILL.md
@.claude/skills/parallel-dispatch/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][AGENTS]
>**Dictum:** *Five perspectives maximize critique coverage.*

<br>

@.claude/agents/boardroom-strategist.md
@.claude/agents/boardroom-architect.md
@.claude/agents/boardroom-pragmatist.md
@.claude/agents/boardroom-contrarian.md
@.claude/agents/boardroom-integrator.md

---
## [4][TASK]
>**Dictum:** *Majority vote determines pipeline progression.*

<br>

Dispatch 5 boardroom agents in parallel via Task tool for Discussion #$1. Each votes approve/revise/block. Synthesize critique report with majority outcome.

Execute boardroom skill workflow:
1. **READ** — Get Discussion + locate plan comment with `<!-- SKILL_COMPLETE: plan -->` or `<!-- SKILL_COMPLETE: refine -->`
2. **DISPATCH** — Launch ALL 5 critique agents in ONE message block via Task tool
3. **SYNTHESIZE** — Aggregate votes, compile assessments, identify convergent/divergent concerns
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

**Vote Outcomes:**
- **Approved** (3+ approve) — Proceed to decompose
- **Revise** (3+ revise) — Trigger refine skill
- **Blocked** (3+ block) — Halt pipeline, human intervention
- **Mixed** (no majority) — Halt pipeline, human intervention

[CRITICAL]:
- [ALWAYS] Dispatch ALL 5 agents in ONE message block — parallel execution required.
- [ALWAYS] Include full PLAN.md in each agent prompt.
- [ALWAYS] Track cycle count (max 3 cycles).
- [ALWAYS] Append `<!-- SKILL_COMPLETE: boardroom -->` marker to output.
- [NEVER] Chain agent outputs — parallel means independent.
