# Agentic PM System: Implementation Plan

AI-first project management with GitHub as state layer, n8n as orchestrator, CLI agents as executors.

---

## [1] Design Principles

| Principle                | Implementation                                             |
| ------------------------ | ---------------------------------------------------------- |
| ICE Engine Model         | Kickstart once → runs autonomously until completion        |
| Agnostic Intake          | Single n8n normalizer accepts Teams/Slack/GitHub/API       |
| Governance Validation    | `governance` agent validates each stage output vs input    |
| Boardroom Loop           | Multi-personality critique with automated refine cycles    |
| Single Human Gate        | Human reviews decomposition before issue dispatch          |
| Context-Bounded Tasks    | Every task fits single agent context window                |
| Living Plan              | PLAN.md updated after each task, drift measured against it |
| Discussions for Planning | Issues reserved for executable work only                   |

---

## [2] Lifecycle Stages

```
INTAKE → EXPLORE → PLAN → [BOARDROOM ⟷ REFINE]* → DECOMPOSE → [HUMAN] → DISPATCH → IMPLEMENT → DONE
                                ↑       ↓
                                └───────┘ (loop while revise, max 3)
```

**Stage Transitions:** Each skill outputs completion marker. `governance` agent validates output against original input. If valid → auto-proceed. If invalid → flag for review.

| Stage     | Label               | Artifact            | Agent/Skill       |
| --------- | ------------------- | ------------------- | ----------------- |
| Intake    | `idea`              | Discussion created  | n8n workflow      |
| Explore   | `planning`          | Discussion comment  | `explore` skill   |
| Plan      | `planning`          | PLAN.md draft       | `plan` skill      |
| Boardroom | `critique-pending`  | Critique report     | `boardroom` skill |
| Refine    | `refine-pending`    | Refined PLAN.md     | `refine` skill    |
| Decompose | `scope`             | Task plan (comment) | `decompose` skill |
| Approval  | `dispatch-approved` | —                   | Human gate        |
| Dispatch  | `implement`         | GitHub issues       | `dispatch` skill  |
| Implement | `in-progress`       | PR                  | Agent CLI         |
| Done      | `done`              | Deliverables        | —                 |

---

## [3] Build Phases

### Phase 1: Foundation (Labels + Discussions + Tooling) ✓ COMPLETE

**Labels** (`.github/labels.yml`) — 6 added:
- [x] `critique-pending` — Awaiting boardroom review
- [x] `refine-pending` — Boardroom voted revise, awaiting refinement
- [x] `dispatch-approved` — Human approved decomposition
- [x] `scope` — Decomposed with acceptance criteria
- [x] `drift-flagged` — Alignment concerns detected
- [x] `checkpoint-required` — Phase checkpoint needed

**Schema** (`.github/scripts/schema.ts`):
- [x] `B.labels.groups.status` — Added critique-pending, critique-passed, scope
- [x] `B.labels.groups.special` — Added drift-flagged, checkpoint-required

**Documentation**:
- [x] `.github/README.md` — Updated label categories table + governance category
- [x] `.github/ARCHITECTURE.md` — Added labels table to Agentic PM section
- [x] `.github/ISSUE_TEMPLATE/config.yml` — Discussion contact links (Planning, Q&A)

**GitHub Settings** (manual — repo settings):
- [x] Discussions enabled
- [x] `Planning` category — Project brainstorming and ideation
- [x] `Q&A` category — Community support (answers enabled)

**Existing labels reused** (no new labels needed):
- `idea` → Untriaged raw input (intake)
- `planning` → Being shaped into plan (covers brainstorm + refine stages)
- `implement` → Ready for work (post-decomposition)

**Tooling** (`.claude/skills/github-tools/`):
- [x] `discussion-list` — List discussions with category filter
- [x] `discussion-view` — View discussion details + node ID
- [x] `discussion-comment` — Post comment via GraphQL mutation
- [x] `_repo_vars()` helper — GraphQL owner/repo injection

---

### Phase 2: Skills (Claude Code) ✓ COMPLETE

| Skill       | Path                        | Purpose                                      | Priority |
| ----------- | --------------------------- | -------------------------------------------- | -------- |
| `explore`   | `.claude/skills/explore/`   | Research options, recommend approach         | P1       |
| `plan`      | `.claude/skills/plan/`      | Create PLAN.md with objectives, architecture | P1       |
| `boardroom` | `.claude/skills/boardroom/` | Orchestrate multi-personality critique       | P1       |
| `refine`    | `.claude/skills/refine/`    | Incorporate boardroom critique into plan     | P1       |
| `decompose` | `.claude/skills/decompose/` | Break plan into task inventory (no issues)   | P1       |
| `dispatch`  | `.claude/skills/dispatch/`  | Create GitHub issues from approved plan      | P1       |

**Note:** `brainstorm` skill renamed to `explore`. Boardroom→Refine loop replaces human approval gate.

**Skill structure** (each):
```
.claude/skills/{name}/
├── SKILL.md          # Frontmatter + process definition
├── references/       # Supporting docs (optional)
└── scripts/          # Automation scripts (optional)
```

---

### Phase 3: Agents ✓ COMPLETE

| Agent                  | Path              | Personality       | Focus                                     |
| ---------------------- | ----------------- | ----------------- | ----------------------------------------- |
| `boardroom-strategist` | `.claude/agents/` | VP Engineering    | Long-term impact, ROI, business alignment |
| `boardroom-architect`  | `.claude/agents/` | Staff Engineer    | System design, scalability, tech debt     |
| `boardroom-pragmatist` | `.claude/agents/` | Senior Engineer   | Feasibility, timeline, resources          |
| `boardroom-contrarian` | `.claude/agents/` | Devil's Advocate  | Assumptions, edge cases, failure modes    |
| `boardroom-integrator` | `.claude/agents/` | Platform Engineer | Cross-system impact, dependencies         |
| `governance`           | `.claude/agents/` | Alignment Checker | Validates stage output vs input, drift    |

**Boardroom output**: Each agent votes `approve | revise | block` with assessment. Majority vote determines outcome.

**Governance role**: Runs after each stage to validate output addresses original input. Binary pass/fail — no confidence scores.

---

### Phase 4: Commands ✓ COMPLETE

**Purpose:** Commands are thin orchestrator-invokable entry points that enable n8n to dispatch skills consistently via SSH. Each command loads skill context, provides agent guidance, and executes a single lifecycle stage.

**Namespace:** `.claude/commands/pm/` → Commands invoked as `/pm:explore`, `/pm:plan`, etc.

**Quality Standards:**
- LOC < 50 (thin wrapper, not business logic)
- Single `$1` argument (Discussion number)
- Skill context loaded via `@path` references
- Tools scoped to skill requirements
- 1-3 sentence guidance block anchoring agent behavior
- Verb-first description, <80 chars

**Command Template:**
```markdown
---
description: {verb-first, <80 chars, outcome-focused}
argument-hint: [discussion-number]
allowed-tools: {tools scoped to skill pattern}
---

## Context
@.claude/skills/{skill}/SKILL.md

## Guidance
{1-3 sentences describing expected behavior, constraints, and success criteria}

## Task
Execute {skill} skill for Discussion #$1. Follow skill workflow sections sequentially. Post output with completion marker.
```

**Command Roster:**

| [INDEX] | [COMMAND]       | [PATH]                          | [TOOLS]                      | [GUIDANCE]                                                                 |
| :-----: | --------------- | ------------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
|   [1]   | `/pm:explore`   | `.claude/commands/pm/explore`   | Task, Read, Glob, Bash       | Research options for Discussion idea. Recommend approach with trade-offs.  |
|   [2]   | `/pm:plan`      | `.claude/commands/pm/plan`      | Task, Read, Edit, Glob, Bash | Create PLAN.md draft from explore output. Define objectives, architecture. |
|   [3]   | `/pm:boardroom` | `.claude/commands/pm/boardroom` | Task, Read, Glob, Bash       | Dispatch 5 critique agents in parallel. Synthesize votes, post report.     |
|   [4]   | `/pm:refine`    | `.claude/commands/pm/refine`    | Task, Read, Edit, Glob, Bash | Incorporate boardroom critique into revised plan. Track cycle count.       |
|   [5]   | `/pm:decompose` | `.claude/commands/pm/decompose` | Task, Read, Glob, Bash       | Break approved plan into context-bounded tasks. Output plan for review.    |
|   [6]   | `/pm:dispatch`  | `.claude/commands/pm/dispatch`  | Task, Read, Glob, Bash       | Create GitHub issues from approved decomposition. Apply task labels.       |
|   [7]   | `/pm:govern`    | `.claude/commands/pm/govern`    | Task, Read, Glob             | Validate stage output vs input. Binary pass/fail. Flag drift if invalid.   |

**n8n Invocation:** `ssh vps "cd /repo && claude '/pm:explore #42'"`

---

### Phase 5: n8n Workflows

| Workflow                   | Trigger                           | Action                                     |
| -------------------------- | --------------------------------- | ------------------------------------------ |
| **Intake Normalizer**      | Webhook (any source)              | Normalize payload → create Discussion      |
| **Lifecycle Orchestrator** | Skill completion marker           | Run governance check → trigger next skill  |
| **Boardroom Trigger**      | `critique-pending` label          | SSH → `/pm:boardroom #<discussion>`        |
| **Refine Trigger**         | `refine-pending` label            | SSH → `/pm:refine #<discussion>`           |
| **Decompose Trigger**      | Boardroom approve (majority vote) | SSH → `/pm:decompose #<discussion>`        |
| **Dispatch Trigger**       | `dispatch-approved` label         | SSH → `/pm:dispatch #<discussion>`         |
| **Drift Monitor**          | PR merged                         | SSH → `/pm:govern #<discussion> implement` |

**Orchestration Pattern:**
1. Skill completes → posts `<!-- SKILL_COMPLETE: {skill} -->` marker
2. n8n detects marker → triggers `/pm:govern #<discussion> <stage>` to validate
3. Governance passes → n8n triggers next command automatically
4. Governance fails → labels Discussion `drift-flagged` for human review

**Source adapters** (n8n nodes): Teams, Slack, GitHub Discussion, API webhook

---

### Phase 6: Governance & Living Plan

**PLAN.md template** (created per project):
```markdown
# Project: {name}

## Current State
- Phase: {phase}
- Progress: {X}/{Y} tasks
- Updated: {timestamp}

## Objectives
1. {objective}

## Architecture Decisions
- {decision}: {choice} (Rationale: ...)

## Completed Work
| Task | PR  | Aligned | Notes |
| ---- | --- | ------- | ----- |

## Deviation Log
| Task | Expected | Actual | Resolution |
| ---- | -------- | ------ | ---------- |

## Upcoming
- [ ] Task: ...
```

**Governance validation**: `governance` agent compares PR/output against original task + PLAN.md. Binary pass/fail — if output addresses input requirements, proceed. If not, flag for review.

**Drift handling**: When deviation detected, governance agent updates PLAN.md deviation log and determines if deviation is acceptable (scope clarification) or blocking (misalignment).

---

## [4] Task Sizing Rules

```typescript
const TASK_CONSTRAINTS = {
  maxFiles: 10,
  maxLinesChanged: 500,
  maxNewFiles: 3,
  maxDependencies: 5,
  estimatedTurns: 15,
  // Exceeding any → split into subtasks
}
```

---

## [5] Human Gates

| Gate                   | Trigger                   | Action                                 |
| ---------------------- | ------------------------- | -------------------------------------- |
| Decomposition Approval | Decompose skill completes | Review task plan → `dispatch-approved` |

**Single human gate.** Boardroom→Refine loop handles plan refinement automatically. Human reviews final decomposition before any issues are created.

**Escalation**: Governance flags `drift-flagged` when output doesn't address input. Boardroom `block` or no majority halts pipeline for human intervention.

---

## [6] Implementation Order

### Phase 1: Foundation ✓ COMPLETE
- [x] Labels — Add 5 labels to `.github/labels.yml`
- [x] Schema — Update `B.labels.groups` in `schema.ts`
- [x] Docs — Update `README.md`, `ARCHITECTURE.md`
- [x] Config — Update `ISSUE_TEMPLATE/config.yml` with Discussion links
- [x] Discussions — Enabled (`Planning` + `Q&A` categories)
- [x] Tooling — Add Discussion commands to `github-tools` (GraphQL)

### Phase 2: Skills ✓ COMPLETE
- [x] `explore` skill — Research + recommend approach (replaced brainstorm)
- [x] `plan` skill — Create PLAN.md with objectives, architecture
- [x] `boardroom` skill — Orchestrate 5-agent critique
- [x] `decompose` skill — Break plan into context-bounded tasks

### Phase 3: Agents ✓ COMPLETE
- [x] `governance` agent — Validates stage output vs input (runs after each skill)
- [x] `boardroom-strategist` agent — VP Engineering perspective
- [x] `boardroom-architect` agent — Staff Engineer perspective
- [x] `boardroom-pragmatist` agent — Senior Engineer perspective
- [x] `boardroom-contrarian` agent — Devil's Advocate perspective
- [x] `boardroom-integrator` agent — Platform Engineer perspective

### Phase 4: Commands ✓ COMPLETE
- [x] `/pm:explore` — Research options, recommend approach
- [x] `/pm:plan` — Create PLAN.md draft from explore output
- [x] `/pm:boardroom` — Dispatch 5 critique agents, synthesize votes
- [x] `/pm:refine` — Incorporate critique into revised plan
- [x] `/pm:decompose` — Break plan into context-bounded tasks
- [x] `/pm:dispatch` — Create GitHub issues from approved plan
- [x] `/pm:govern` — Validate stage output vs input

### Phase 5: n8n Workflows (External)
- [ ] Intake Normalizer — Webhook receiver → create Discussion
- [ ] Lifecycle Orchestrator — Skill completion → governance → next skill
- [ ] Boardroom Trigger — `critique-pending` → SSH → boardroom skill
- [ ] Refine Trigger — `refine-pending` → SSH → refine skill
- [ ] Decompose Trigger — Boardroom approve → SSH → decompose skill
- [ ] Dispatch Trigger — `dispatch-approved` → SSH → dispatch skill
- [ ] Drift Monitor — PR merged → SSH → governance agent

---

## [7] File Manifest

### Create

| Path                                     | Type    | Status |
| ---------------------------------------- | ------- | ------ |
| `.claude/skills/explore/SKILL.md`        | Skill   | ✓ DONE |
| `.claude/skills/plan/SKILL.md`           | Skill   | ✓ DONE |
| `.claude/skills/boardroom/SKILL.md`      | Skill   | ✓ DONE |
| `.claude/skills/refine/SKILL.md`         | Skill   | ✓ DONE |
| `.claude/skills/decompose/SKILL.md`      | Skill   | ✓ DONE |
| `.claude/skills/dispatch/SKILL.md`       | Skill   | ✓ DONE |
| `.claude/agents/governance.md`           | Agent   | ✓ DONE |
| `.claude/agents/boardroom-strategist.md` | Agent   | ✓ DONE |
| `.claude/agents/boardroom-architect.md`  | Agent   | ✓ DONE |
| `.claude/agents/boardroom-pragmatist.md` | Agent   | ✓ DONE |
| `.claude/agents/boardroom-contrarian.md` | Agent   | ✓ DONE |
| `.claude/agents/boardroom-integrator.md` | Agent   | ✓ DONE |
| `.claude/commands/pm/explore.md`         | Command | ✓ DONE |
| `.claude/commands/pm/plan.md`            | Command | ✓ DONE |
| `.claude/commands/pm/boardroom.md`       | Command | ✓ DONE |
| `.claude/commands/pm/refine.md`          | Command | ✓ DONE |
| `.claude/commands/pm/decompose.md`       | Command | ✓ DONE |
| `.claude/commands/pm/dispatch.md`        | Command | ✓ DONE |
| `.claude/commands/pm/govern.md`          | Command | ✓ DONE |

### Modify

| Path                                        | Change                                    | Status  |
| ------------------------------------------- | ----------------------------------------- | ------- |
| `.github/labels.yml`                        | Add 5 lifecycle/governance labels         | ✓ DONE  |
| `.github/scripts/schema.ts`                 | Update B.labels.groups (status + special) | ✓ DONE  |
| `.github/README.md`                         | Update label categories table             | ✓ DONE  |
| `.github/ARCHITECTURE.md`                   | Reference this plan + labels table        | ✓ DONE  |
| `.github/ISSUE_TEMPLATE/config.yml`         | Discussion contact links (Planning, Q&A)  | ✓ DONE  |
| `.claude/skills/github-tools/scripts/gh.py` | Add Discussion commands (GraphQL)         | ✓ DONE  |
| `.claude/skills/github-tools/SKILL.md`      | Document Discussion commands              | ✓ DONE  |
| `.github/N8N_SETUP.md`                      | Add lifecycle orchestrator workflows      | Phase 5 |

---

## [8] Dependencies

**External**:
- n8n Cloud instance
- Hostinger VPS (existing)
- GitHub Discussions enabled
- Teams/Slack bot (optional, for multi-source)

**Internal**:
- `parallel-dispatch` skill (exists)
- `deep-research` skill (exists)
- `github-tools` skill (exists, Discussion commands added)
- `slash-dispatch` action (exists, prepared)
- Agent frontmatter pattern (exists)
- Skill/command builder patterns (exist)

---

## [9] Success Criteria

- [ ] Discussion created → auto-progresses through explore → plan → boardroom
- [ ] Governance agent validates each stage output vs input (pass/fail)
- [ ] Invalid output → flags for human review (no confidence scoring)
- [ ] Boardroom: 5 agents critique in parallel, majority vote determines outcome
- [ ] Approved plan decomposes into context-bounded tasks automatically
- [ ] Each task PR validated by governance agent against PLAN.md
- [ ] Single human gate at decomposition approval before issue dispatch
- [ ] Works from Teams/Slack/GitHub/API (same flow)
