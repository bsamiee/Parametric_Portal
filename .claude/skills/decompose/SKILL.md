---
name: decompose
type: simple
depth: base
description: >-
  Breaks approved PLAN.md into context-bounded task plan. Use when (1) boardroom
  vote is `approve`, (2) Discussion has `scope` label, or (3) plan needs
  decomposition into single-agent tasks for human review before dispatch.
---

# [H1][DECOMPOSE]
>**Dictum:** *Context-bounded tasks enable single-agent completion.*

<br>

Transform approved PLAN.md into decomposition plan for human review.

**Workflow**
1. §READ — Get Discussion + locate approved plan.
2. §ANALYZE — Extract objectives, scope, architecture decisions.
3. §DECOMPOSE — Break into context-bounded tasks.
4. §POST — Post decomposition plan to Discussion.

**Dependencies**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output).

**Input**
- `discussion` — Discussion number with boardroom approve vote.

**Output**
- Discussion comment with task plan + `<!-- SKILL_COMPLETE: decompose -->` marker.
- Human reviews → applies `dispatch-approved` → dispatch skill creates issues.

**Exclusions**
Research (→ explore), planning (→ plan), critique (→ boardroom), issue creation (→ dispatch).

---
## [1][READ]
>**Dictum:** *Boardroom consensus governs decomposition scope.*

<br>

**Extract from Discussion**
- `title` — Project name.
- `body` — Original constraints.
- `id` — Node ID — §POST requirement.

**Locate Plan Comment**
- Find most recent plan: `<!-- SKILL_COMPLETE: plan -->` or `<!-- SKILL_COMPLETE: refine -->`.
- Locate boardroom: `<!-- SKILL_COMPLETE: boardroom -->`.
- Verify boardroom outcome is `Approved`.

[IMPORTANT]:
- [ALWAYS] Use most recent plan (may be refined).
- [ALWAYS] Verify boardroom vote is `Approved`.
- [NEVER] Proceed if boardroom vote is `revise` or `block`.

---
## [2][ANALYZE]
>**Dictum:** *Plan structure determines task complexity boundaries.*

<br>

Extract from PLAN.md:

| [INDEX] | [SECTION]              | [EXTRACT]                      |
| :-----: | ---------------------- | ------------------------------ |
|   [1]   | OBJECTIVES             | Primary goals to decompose.    |
|   [2]   | APPROACH               | Selected implementation path.  |
|   [3]   | ARCHITECTURE_DECISIONS | Constraints on task design.    |
|   [4]   | TASK_SIZING            | Limits for each task.          |
|   [5]   | SCOPE_BOUNDARIES       | In-scope items to cover.       |
|   [6]   | UPCOMING               | High-level tasks to decompose. |

**Task Sizing Constraints**

| [INDEX] | [CONSTRAINT]    | [LIMIT] | [VIOLATION_ACTION]   |
| :-----: | --------------- | ------: | -------------------- |
|   [1]   | Max files       |      10 | Split into subtasks. |
|   [2]   | Max lines       |     500 | Split into subtasks. |
|   [3]   | Max new files   |       3 | Split into subtasks. |
|   [4]   | Max deps        |       5 | Split into subtasks. |
|   [5]   | Estimated turns |      15 | Split into subtasks. |

[CRITICAL]:
- [ALWAYS] Apply task sizing constraints.
- [NEVER] Create tasks exceeding any limit.

---
## [3][DECOMPOSE]
>**Dictum:** *Context-bounded tasks prevent agent cognitive overload.*

<br>

Break UPCOMING items into context-bounded tasks.

**Task Structure**
```markdown
## Task: {task_title}

### [1][OBJECTIVE]
{what this task accomplishes — 1-2 sentences}

### [2][CONTEXT]
- Project: {project_name}
- Discussion: #{discussion_number}
- Approach: {selected approach from plan}

### [3][SCOPE]
**Files:** {estimated file count}/{max 10}
**Lines:** {estimated LOC}/{max 500}
**New Files:** {count}/{max 3}
**Dependencies:** {count}/{max 5}

### [4][ACCEPTANCE_CRITERIA]
- [ ] {criterion 1 — testable}
- [ ] {criterion 2 — testable}
- [ ] {criterion 3 — testable}

### [5][ARCHITECTURE_CONSTRAINTS]
{relevant decisions from PLAN.md that affect this task}

### [6][DEPENDENCIES]
- Blocked by: {task IDs or "none"}
- Blocks: {task IDs or "none"}

---
<!-- ai_meta
type: task
project: {project_name}
phase: {from plan}
state: triage
agent:
-->
```

**Decomposition Rules**
1. Each objective → 1-3 tasks.
2. Each task → single agent completion.
3. Tasks form DAG (directed acyclic graph) via dependencies.
4. First task has no blockers.
5. Final task completes objective.

[IMPORTANT]:
- [ALWAYS] Include ai_meta block for agent assignment.
- [ALWAYS] Define acceptance criteria as testable checkboxes.
- [ALWAYS] Estimate scope against sizing limits.
- [ALWAYS] Map task dependencies.

---
## [4][POST]
>**Dictum:** *Decomposition plan enables human review.*

<br>

Post task plan to Discussion for human approval.

**Format**
```markdown
## [1][DECOMPOSITION]: {project.name}

### [1.1][TASK_INVENTORY]

| [INDEX] | [TASK] | [BLOCKED_BY] | [SCOPE] | [ACCEPTANCE_CRITERIA] |
| :-----: | ------ | ------------ | ------- | --------------------- |
|   [1]   | {name} | —            | {X}/10  | {count} criteria      |
|   [2]   | {name} | [1]          | {X}/10  | {count} criteria      |
|   [3]   | {name} | [1], [2]     | {X}/10  | {count} criteria      |

### [1.2][TASK_DETAILS]

{Full task structure for each task from §DECOMPOSE}

### [1.3][DEPENDENCY_GRAPH]

[1] → [2] → [3]
          ↘ [4]

### [1.4][COVERAGE]
- Objectives addressed: {X}/{total}
- Scope items covered: {X}/{total}
- Total estimated files: {sum}
- Total estimated lines: {sum}

---
**Status:** Awaiting human approval
**Next:** Apply `dispatch-approved` label to create issues

<!-- SKILL_COMPLETE: decompose -->

**Command**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Include full task details for human review.
- [ALWAYS] Show dependency graph with task indices.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: decompose -->` marker.

---
## [5][VALIDATION]
>**Dictum:** *Incomplete decomposition leaves objectives unaddressed.*

<br>

[VERIFY] Completion:
- [ ] §READ: Discussion retrieved, boardroom approve verified
- [ ] §ANALYZE: All plan sections extracted, sizing constraints noted
- [ ] §DECOMPOSE: Each task within sizing limits, dependencies mapped
- [ ] §POST: Plan posted with `<!-- SKILL_COMPLETE: decompose -->` marker

**Coverage Check**
- [ ] Every OBJECTIVE has at least one task.
- [ ] Every IN_SCOPE item addressed by task.
- [ ] No task exceeds sizing constraints.
- [ ] Dependency graph is acyclic.
- [ ] First task has no blockers.

**Governance Validation**
Post-execution, `governance` agent validates:
- Objectives have corresponding tasks.
- No task exceeds sizing limits.
- Dependencies form valid DAG.
- Full task details included for human review.

Binary pass/fail—no confidence scoring.
