---
name: boardroom
type: simple
depth: base
description: >-
  Orchestrates 5-agent parallel critique of PLAN.md. Use when Discussion has
  `critique-pending` label or `<!-- SKILL_COMPLETE: plan/refine -->` marker.
  Dispatches strategist, architect, pragmatist, contrarian, integrator agents
  with majority vote (approve/revise/block).
---

# [H1][BOARDROOM]
>**Dictum:** *Multi-agent critique surfaces blind spots before commitment.*

<br>

Orchestrate parallel agent critique of PLAN.md draft.

**Workflow**
1. §READ — Get Discussion + locate plan comment.
2. §DISPATCH — Launch 5 critique agents in parallel.
3. §SYNTHESIZE — Aggregate votes, compile assessments.
4. §POST — Post critique report with majority outcome.

**Dependencies**
- `github-tools` — `discussion-view` (input), `discussion-comment` (output).
- `parallel-dispatch` — 5-agent parallel execution.

**Input**
- `discussion` — Discussion number with completed plan stage.

**Output**
- Discussion comment with critique report + majority vote + `<!-- SKILL_COMPLETE: boardroom -->` marker.

**Exclusions**
Research (→ explore), planning (→ plan), decomposition (→ decompose).

---
## [1][READ]
>**Dictum:** *Discussion context enables agent calibration.*

<br>

**Extract from Discussion**
- `title` — Project name.
- `body` — Original idea, constraints, goals.
- `id` — Node ID — §POST requirement.

**Locate Plan Comment**
- Find comment containing `<!-- SKILL_COMPLETE: plan -->`.
- Extract full PLAN.md content.

[IMPORTANT]:
- [ALWAYS] Extract node ID — §POST requirement.
- [ALWAYS] Locate plan completion marker.
- [NEVER] Proceed if plan comment missing.

---
## [2][DISPATCH]
>**Dictum:** *Diverse critique angles surface blind spots single-reviewer misses.*

<br>

Dispatch 5 critique agents via `parallel-dispatch` skill—ALL in ONE message.

**Agent Roster**

| [INDEX] | [AGENT]    | [PERSONALITY]    | [FOCUS]                               |
| :-----: | ---------- | ---------------- | ------------------------------------- |
|   [1]   | Strategist | VP Engineering   | ROI, business alignment, long-term    |
|   [2]   | Architect  | Staff Engineer   | System design, scalability, tech debt |
|   [3]   | Pragmatist | Senior Engineer  | Feasibility, timeline, resources      |
|   [4]   | Contrarian | Devil's Advocate | Assumptions, edge cases, failures     |
|   [5]   | Integrator | Platform Eng     | Cross-system impact, dependencies     |

**Agent Prompt Template**
```
Agent personality: {PERSONALITY}

## Focus
{FOCUS}

## Plan Review
{PLAN.md content}

## Original Discussion
Title: {discussion.title}
Body: {discussion.body}

## Instructions
1. Analyze plan from assigned perspective.
2. Identify strengths relevant to assigned focus.
3. Identify concerns relevant to assigned focus.
4. Cast vote: approve | revise | block.

## Output Format
### [ASSESSMENT]
{2-3 sentences on plan quality from assigned perspective}

### [STRENGTHS]
- {strength 1}
- {strength 2}

### [CONCERNS]
- {concern 1}
- {concern 2}

### [VOTE]
**{approve | revise | block}**
Rationale: {1 sentence justification}
```

[CRITICAL]:
- [ALWAYS] Dispatch ALL 5 agents in ONE message block.
- [ALWAYS] Include full PLAN.md in each agent prompt.
- [ALWAYS] Include original Discussion context.
- [NEVER] Chain agent outputs — parallel means independent.

---
## [3][SYNTHESIZE]
>**Dictum:** *Majority vote determines pipeline progression.*

<br>

Wait for 5 agents. Aggregate outputs.

**Vote Tally**

| [INDEX] | [OUTCOME] | [CONDITION]      | [RESULT]                                 |
| :-----: | --------- | ---------------- | ---------------------------------------- |
|   [1]   | Approved  | 3+ approve votes | → Proceed to decompose.                  |
|   [2]   | Revise    | 3+ revise votes  | → Trigger refine → next boardroom cycle. |
|   [3]   | Blocked   | 3+ block votes   | → Halt pipeline, human intervention.     |
|   [4]   | Mixed     | No majority      | → Halt pipeline, human intervention.     |

**Loop Control**
- Revise triggers `refine-pending` label → refine skill → back to boardroom.
- Max 3 cycles—if no convergence, halt for human intervention.
- Track cycle count in output header.

**Compile Report**
```markdown
## [1][BOARDROOM_CRITIQUE]: {project.name} (Cycle {N})

### [1.1][VOTE_SUMMARY]

| [INDEX] | [AGENT]    | [VOTE] |
| :-----: | ---------- | ------ |
|   [1]   | Strategist | {vote} |
|   [2]   | Architect  | {vote} |
|   [3]   | Pragmatist | {vote} |
|   [4]   | Contrarian | {vote} |
|   [5]   | Integrator | {vote} |

**Outcome:** {Approved | Revise | Blocked | Mixed} ({X}/5 votes)

### [1.2][ASSESSMENTS]

**Strategist** ({vote})
{assessment}
- Strengths: {strengths}
- Concerns: {concerns}

**Architect** ({vote})
{assessment}
- Strengths: {strengths}
- Concerns: {concerns}

**Pragmatist** ({vote})
{assessment}
- Strengths: {strengths}
- Concerns: {concerns}

**Contrarian** ({vote})
{assessment}
- Strengths: {strengths}
- Concerns: {concerns}

**Integrator** ({vote})
{assessment}
- Strengths: {strengths}
- Concerns: {concerns}

### [1.3][CONVERGENT_CONCERNS]
{concerns from 2+ agents}

### [1.4][DIVERGENT_VIEWS]
{concerns from single agent—flag for consideration}

### [1.5][RECOMMENDATION]
{based on majority vote and concern analysis}
```

[IMPORTANT]:
- [ALWAYS] Wait for 5 agents before synthesizing.
- [ALWAYS] Identify convergent concerns (2+ agents).
- [ALWAYS] Flag divergent views separately.

---
## [4][POST]
>**Dictum:** *Critique report enables informed human decision.*

<br>

Post critique report to Discussion comment.

**Format**
```markdown
{Critique report from §SYNTHESIZE}

---
**Outcome:** {Approved | Revise | Blocked | Mixed}
**Cycle:** {N}/3
**Next:** {Proceeding to decompose | Triggering refine cycle {N+1} | Pipeline halted — human intervention required}

<!-- SKILL_COMPLETE: boardroom -->
```

**Command**
```bash
uv run .claude/skills/github-tools/scripts/gh.py discussion-comment \
  --discussion-id {id} \
  --body "{formatted_output}"
```

[CRITICAL]:
- [ALWAYS] Use node ID from §READ.
- [ALWAYS] Append `<!-- SKILL_COMPLETE: boardroom -->` marker.
- [ALWAYS] State outcome and next action clearly.

---
## [5][VALIDATION]
>**Dictum:** *Incomplete critique misses critical perspectives.*

<br>

[VERIFY] Completion:
- [ ] §READ: Discussion retrieved, plan comment located
- [ ] §DISPATCH: All 5 agents launched in ONE message
- [ ] §SYNTHESIZE: All 5 votes received, majority determined
- [ ] §POST: Critique report posted with `<!-- SKILL_COMPLETE: boardroom -->` marker

**Governance Validation**
Post-execution, `governance` agent validates:
- 5 agent perspectives represented.
- Vote tally accurate.
- Outcome matches majority.
- Convergent/divergent concerns identified.

Binary pass/fail—no confidence scoring.

**Loop Behavior**
- Approved → n8n triggers decompose skill.
- Revise → n8n applies `refine-pending` label → refine skill → back to boardroom.
- Blocked/Mixed → Pipeline halts, `drift-flagged` label applied.
