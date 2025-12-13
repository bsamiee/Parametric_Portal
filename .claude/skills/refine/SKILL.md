---
name: refine
type: simple
depth: base
description: >-
  Incorporates boardroom critique into PLAN.md. Use when (1) boardroom vote
  is `revise`, (2) Discussion has `refine-pending` label, or (3) plan needs
  revision addressing convergent agent concerns.
---

# [H1][REFINE]
>**Dictum:** *Iterative refinement converges plans toward approval.*

<br>

Incorporate boardroom concerns into revised PLAN.md draft.

**Workflow:**
1. §READ — Fetch Discussion; locate plan and boardroom comments.
2. §ANALYZE — Extract convergent concerns and revision requirements.
3. §REVISE — Update plan sections addressing concerns.
4. §POST — Post refined PLAN.md.

**Dependencies:**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output).

**Input:**
- `discussion`: Discussion number with boardroom critique (vote = revise).

**Output:**
- Discussion comment with refined PLAN.md and `<!-- SKILL_COMPLETE: refine -->` marker.

**Exclusions:** Research (→ explore), initial planning (→ plan), decomposition (→ decompose).

---
## [1][READ]
>**Dictum:** *Complete extraction ensures revision accuracy.*

<br>

**Extract Discussion Fields:**
- `title` — Project name.
- `id` — Node ID (§POST requirement).

**Locate Comments:**
- Plan comment: `<!-- SKILL_COMPLETE: plan -->` or `<!-- SKILL_COMPLETE: refine -->`.
- Boardroom comment: `<!-- SKILL_COMPLETE: boardroom -->`.

**Extract Boardroom Data:**
- Vote outcome (require `revise`).
- Convergent concerns (2+ agents).
- Divergent views (single-agent flags).
- Individual agent assessments.

[IMPORTANT]:
- [ALWAYS] Use most recent plan comment (may be prior refine output).
- [ALWAYS] Verify boardroom vote is `revise`.
- [NEVER] Proceed if vote is `approve` or `block`.

---
## [2][ANALYZE]
>**Dictum:** *Prioritization ensures critical concerns receive attention.*

<br>

**Categorize Concerns:**

| [INDEX] | [PRIORITY] | [SOURCE]               | [ACTION]              |
| :-----: | ---------- | ---------------------- | --------------------- |
|   [1]   | Mandatory  | Convergent (2+ agents) | Address in revision.  |
|   [2]   | Consider   | Divergent (1 agent)    | Address if low-cost.  |
|   [3]   | Note       | Strengths              | Preserve in revision. |

**Map to Plan Sections:**
- Scope concerns → §SCOPE_BOUNDARIES.
- Feasibility concerns → §RISKS, §TASK_SIZING.
- Architecture concerns → §ARCHITECTURE_DECISIONS.
- Objective concerns → §OBJECTIVES.

[CRITICAL]:
- [ALWAYS] Address ALL convergent concerns.
- [NEVER] Ignore concerns without explicit rationale.

---
## [3][REVISE]
>**Dictum:** *Minimal changes prevent cascading plan instability.*

<br>

**Revision Rules:**
1. Address each convergent concern with specific plan change.
2. Preserve sections without concerns.
3. Add rationale for each change in ARCHITECTURE_DECISIONS.
4. Update DEVIATION_LOG if scope changed.

**Track Changes:**
```markdown
## [11][REVISION_NOTES]

### Cycle {N}
| [INDEX] | [CONCERN] | [SOURCE] | [RESOLUTION]    |
| :-----: | --------- | -------- | --------------- |
|   [1]   | {concern} | {agents} | {how addressed} |
```

[IMPORTANT]:
- [ALWAYS] Increment cycle number.
- [ALWAYS] Document resolution for each concern.
- [NEVER] Make changes unrelated to boardroom concerns.

---
## [4][POST]
>**Dictum:** *Markers enable n8n orchestration cycle tracking.*

<br>

Post refined PLAN.md to Discussion.

**Format:**
```markdown
## [PLAN_REFINED]: {project.name} (Cycle {N})

{Full PLAN.md with revisions}

## [11][REVISION_NOTES]
{Changes made this cycle}

---
**Status:** Ready for boardroom review (Cycle {N+1}).

<!-- SKILL_COMPLETE: refine -->
```

**Command:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Include cycle number in header.
- [ALWAYS] Include REVISION_NOTES section.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: refine -->` marker.

---
## [5][VALIDATION]
>**Dictum:** *Validation gates prevent infinite revision loops.*

<br>

[VERIFY] Completion:
- [ ] §READ: Plan and boardroom comments located.
- [ ] §ANALYZE: All convergent concerns mapped to plan sections.
- [ ] §REVISE: Each concern has documented resolution.
- [ ] §POST: Refined plan posted with `<!-- SKILL_COMPLETE: refine -->` marker.

**Governance Validation:**
Post-execution, `governance` agent validates:
- All convergent concerns addressed.
- Resolutions documented in REVISION_NOTES.
- Plan sections updated appropriately.

Binary pass/fail—no confidence scoring.
