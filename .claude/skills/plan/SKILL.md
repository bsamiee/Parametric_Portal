---
name: plan
type: simple
depth: base
description: >-
  Creates PLAN.md from explore recommendation. Use when Discussion has
  `<!-- SKILL_COMPLETE: explore -->` marker and needs structured planning
  with objectives, architecture decisions, and task sizing constraints.
---

# [H1][PLAN]
>**Dictum:** *Plans provide decomposition scaffolding for bounded execution.*

<br>

Transform explore recommendation into PLAN.md draft for boardroom critique.

**Workflow:**
1. §READ — Fetch Discussion; locate explore comment.
2. §STRUCTURE — Create PLAN.md per recommendation.
3. §VALIDATE — Verify plan addresses explore output.
4. §POST — Post PLAN.md draft.

**Dependencies:**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output).

**Input:**
- `discussion`: Discussion number with completed explore stage.

**Output:**
- Discussion comment with PLAN.md draft and `<!-- SKILL_COMPLETE: plan -->` marker.

**Exclusions:** Research (→ explore), critique (→ boardroom), decomposition (→ decompose).

---
## [1][READ]
>**Dictum:** *Accurate extraction ensures plan-explore alignment.*

<br>

**Extract Discussion Fields:**
- `title` — Project name.
- `body` — Original idea, constraints, goals.
- `id` — Node ID (§POST requirement).

**Locate Explore Comment:**
- Find comment with `<!-- SKILL_COMPLETE: explore -->`.
- Extract: CONTEXT, APPROACHES, RECOMMENDATION, NEXT_STEPS.

[IMPORTANT]:
- [ALWAYS] Extract node ID—§POST requirement.
- [ALWAYS] Locate explore completion marker.
- [NEVER] Proceed if explore comment missing.

---
## [2][STRUCTURE]
>**Dictum:** *Consistent structure enables downstream decomposition.*

<br>

Create PLAN.md draft per explore recommendation.

**PLAN.md Template:**
```markdown
# Project: {discussion.title}

## [1][CURRENT_STATE]
- Phase: planning
- Progress: 0/0 tasks
- Updated: {ISO timestamp}
- Discussion: #{discussion.number}

## [2][OBJECTIVES]
{derived from explore §CONTEXT and Discussion body}

1. {primary objective}
2. {secondary objective}
3. {tertiary objective} (if applicable)

## [3][APPROACH]
**Selected:** {from explore §RECOMMENDATION}
**Rationale:** {from explore §RECOMMENDATION}
**Trade-offs Accepted:** {from explore §RECOMMENDATION}

### [3.1][ALTERNATIVES_CONSIDERED]
{from explore §APPROACHES — summarize rejected options}

## [4][ARCHITECTURE_DECISIONS]

| [INDEX] | [DECISION] | [CHOICE] | [RATIONALE] |
| :-----: | ---------- | -------- | ----------- |
|   [1]   | {decision} | {choice} | {why}       |

## [5][TASK_SIZING]
Tasks must fit context-bounded constraints:

| [CONSTRAINT]    | [LIMIT] |
| --------------- | ------: |
| Max files       |      10 |
| Max lines       |     500 |
| Max new files   |       3 |
| Max deps        |       5 |
| Estimated turns |      15 |

Exceeding any limit → split into subtasks.

## [6][SCOPE_BOUNDARIES]

### [6.1][IN_SCOPE]
- {from explore NEXT_STEPS}
- {derived from objectives}

### [6.2][OUT_OF_SCOPE]
- {explicitly excluded items}
- {deferred to future work}

## [7][RISKS]

| [INDEX] | [RISK] | [MITIGATION] |
| :-----: | ------ | ------------ |
|   [1]   | {risk} | {mitigation} |

## [8][COMPLETED_WORK]

| [INDEX] | [TASK] | [PR] | [ALIGNED] | [NOTES] |
| :-----: | ------ | ---- | --------- | ------- |
|         |        |      |           |         |

## [9][DEVIATION_LOG]

| [INDEX] | [TASK] | [EXPECTED] | [ACTUAL] | [RESOLUTION] |
| :-----: | ------ | ---------- | -------- | ------------ |
|         |        |            |          |              |

## [10][UPCOMING]
{derived from explore §NEXT_STEPS — high-level tasks, not decomposed}

- [ ] {task 1}
- [ ] {task 2}
- [ ] {task 3}
```

[IMPORTANT]:
- [ALWAYS] Derive objectives from explore CONTEXT and Discussion body.
- [ALWAYS] Include task sizing constraints table.
- [ALWAYS] Define scope boundaries (in/out).
- [ALWAYS] Initialize empty tables for COMPLETED_WORK and DEVIATION_LOG.

---
## [3][VALIDATE]
>**Dictum:** *Validation prevents plan-explore divergence.*

<br>

**Verify Alignment:**
- OBJECTIVES trace to Discussion goals.
- APPROACH matches explore RECOMMENDATION.
- SCOPE_BOUNDARIES align with explore NEXT_STEPS.
- ARCHITECTURE_DECISIONS support selected approach.

**Check Completeness:**
- All 10 sections present.
- No placeholder text remaining.
- Tables have headers (content may be empty).

[CRITICAL]:
- [NEVER] Omit TASK_SIZING section—decompose skill depends on it.
- [NEVER] Leave OBJECTIVES generic—project-specific required.

---
## [4][POST]
>**Dictum:** *Markers enable n8n orchestration state transitions.*

<br>

Post PLAN.md draft to Discussion.

**Format:**
```markdown
## [PLAN_DRAFT]: {project.name}

{PLAN.md content}

---
**Status:** Ready for boardroom critique.

<!-- SKILL_COMPLETE: plan -->
```

**Command:**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Use node ID from §READ—not discussion number.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: plan -->` marker.
- [ALWAYS] Include "Ready for boardroom critique" status.

---
## [5][VALIDATION]
>**Dictum:** *Validation gates prevent decomposition failures.*

<br>

[VERIFY] Completion:
- [ ] §READ: Discussion retrieved; explore comment located.
- [ ] §STRUCTURE: All 10 PLAN.md sections populated.
- [ ] §VALIDATE: Objectives trace to Discussion; approach matches explore.
- [ ] §POST: Comment posted with `<!-- SKILL_COMPLETE: plan -->` marker.

**Governance Validation:**
Post-execution, `governance` agent validates:
- OBJECTIVES address Discussion goals.
- APPROACH matches explore RECOMMENDATION.
- SCOPE_BOUNDARIES clear and bounded.
- TASK_SIZING constraints present.

Binary pass/fail—no confidence scoring.
