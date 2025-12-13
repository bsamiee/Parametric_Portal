---
description: Create GitHub issues from approved decomposition
argument-hint: [discussion-number]
---

# [H1][PM:DISPATCH]
>**Dictum:** *Issue creation enables agent assignment and tracking.*

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

@.claude/skills/dispatch/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [3][TASK]
>**Dictum:** *Human approval gate prevents premature dispatch.*

<br>

Create GitHub issues from approved decomposition for Discussion #$1. Verify `dispatch-approved` label. Create issues in dependency order with proper labels. Post dispatch summary.

Execute dispatch skill workflow:
1. **READ** — Get Discussion + locate decomposition comment with `<!-- SKILL_COMPLETE: decompose -->`
2. **VERIFY** — Confirm `dispatch-approved` label present — HALT if missing
3. **CREATE** — Generate GitHub issues in dependency order (blockers first)
4. **POST** — `uv run .claude/skills/github-tools/scripts/gh.py discussion-comment --discussion-id {id} --body "{output}"`

**Issue Creation:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py issue-create \
  --title "{task_title}" \
  --body "{task_structure}" \
  --labels "task,implement,scope"
```

**Ordering:**
1. Create tasks in dependency order (blockers first)
2. Capture issue numbers as created
3. Update subsequent task bodies with actual issue numbers

[CRITICAL]:
- [NEVER] Create issues without `dispatch-approved` label — human gate required.
- [ALWAYS] Apply `task`, `implement`, `scope` labels to each issue.
- [ALWAYS] Create in dependency order.
- [ALWAYS] Map dependencies to actual issue numbers in output.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: dispatch -->` marker to output.
- [NEVER] Create circular dependencies.
