---
name: dispatch
type: simple
depth: base
description: >-
  Creates GitHub issues from approved decomposition plan. Use when Discussion
  has `dispatch-approved` label and `<!-- SKILL_COMPLETE: decompose -->` marker.
  Generates task issues with `task`, `implement`, `scope` labels and dependencies.
---

# [H1][DISPATCH]
>**Dictum:** *Structured issues enable parallel agent execution.*

<br>

Transform approved decomposition into GitHub issues.

**Workflow:**
1. §READ — Fetch Discussion; locate decomposition comment.
2. §VERIFY — Confirm `dispatch-approved` label.
3. §CREATE — Generate GitHub issues per task inventory.
4. §POST — Post dispatch summary.

**Dependencies:**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output), `issue-create` (tasks).

**Input:**
- `discussion`: Discussion number with `dispatch-approved` label.

**Output:**
- GitHub issues with `task`, `implement`, `scope` labels.
- Discussion comment with issue links and `<!-- SKILL_COMPLETE: dispatch -->` marker.

**Exclusions:** Planning (→ plan), decomposition (→ decompose), refinement (→ refine).

---
## [1][READ]
>**Dictum:** *Accurate extraction prevents downstream failures.*

<br>

**Extract Discussion Fields:**
- `title` — Project name.
- `id` — Node ID (§POST requirement).

**Locate Decomposition Comment:**
- Find comment with `<!-- SKILL_COMPLETE: decompose -->`.
- Extract task inventory table.
- Extract dependency graph.

[IMPORTANT]:
- [ALWAYS] Extract node ID—§POST requirement.
- [ALWAYS] Parse full task inventory.
- [NEVER] Proceed without decomposition comment.

---
## [2][VERIFY]
>**Dictum:** *Human gate ensures deliberate execution timing.*

<br>

**Check Labels:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-view --number {discussion}
```

**Require:** `dispatch-approved` label.

[CRITICAL]:
- [NEVER] Create issues without `dispatch-approved` label.
- [ALWAYS] Halt; report if label missing.

---
## [3][CREATE]
>**Dictum:** *Atomic issues enable independent agent execution.*

<br>

Create GitHub issue per task.

**Issue Structure (Decompose Plan):**
```markdown
## Task: {task_title}

### [1][OBJECTIVE]
{from decomposition plan}

### [2][CONTEXT]
- Project: {project_name}
- Discussion: #{discussion_number}

### [3][SCOPE]
{from decomposition plan}

### [4][ACCEPTANCE_CRITERIA]
{from decomposition plan}

### [5][DEPENDENCIES]
- Blocked by: {issue numbers or "none"}
- Blocks: {issue numbers or "none"}

---
<!-- ai_meta
type: task
project: {project_name}
state: triage
agent:
-->
```

**Command:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py issue-create \
  --title "{task_title}" \
  --body "{task_structure}" \
  --labels "task,implement,scope"
```

**Ordering:**
1. Create tasks in dependency order (blockers first).
2. Capture issue numbers on creation.
3. Update subsequent task bodies with actual issue numbers.

[CRITICAL]:
- [ALWAYS] Apply `task`, `implement`, `scope` labels.
- [ALWAYS] Create in dependency order.
- [NEVER] Create circular dependencies.

---
## [4][POST]
>**Dictum:** *Summary consolidates execution state for stakeholders.*

<br>

Post issue summary to Discussion.

**Format:**
```markdown
## [1][DISPATCH]: {project.name}

### [1.1][ISSUES_CREATED]

| [INDEX] | [TASK] | [ISSUE] | [BLOCKED_BY] | [LABELS]               |
| :-----: | ------ | ------- | ------------ | ---------------------- |
|   [1]   | {name} | #{num}  | —            | task, implement, scope |
|   [2]   | {name} | #{num}  | #{prev}      | task, implement, scope |

### [1.2][DEPENDENCY_GRAPH]
```
#{1} → #{2} → #{3}
           ↘ #{4}
```

### [1.3][NEXT_STEPS]
- n8n monitors `implement` label for agent dispatch.
- Agent assignment via agent labels (claude, gemini, etc.).

---
**Status:** Issues created; ready for agent dispatch.

<!-- SKILL_COMPLETE: dispatch -->
```

**Command:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Include actual issue numbers.
- [ALWAYS] Show dependency graph with issue numbers.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: dispatch -->` marker.

---
## [5][VALIDATION]
>**Dictum:** *Validation ensures complete execution state.*

<br>

[VERIFY] Completion:
- [ ] §READ: Decomposition comment located; task inventory parsed.
- [ ] §VERIFY: `dispatch-approved` label confirmed.
- [ ] §CREATE: All issues created with correct labels and dependencies.
- [ ] §POST: Summary posted with `<!-- SKILL_COMPLETE: dispatch -->` marker.

**Governance Validation:**
Post-execution, `governance` agent validates:
- All decomposition tasks have corresponding issues.
- Dependencies map to issue numbers.
- All issues have required labels.

Binary pass/fail—no confidence scoring.
