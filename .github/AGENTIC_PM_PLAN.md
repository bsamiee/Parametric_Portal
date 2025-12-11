# Agentic PM System: Implementation Plan

AI-first project management with GitHub as state layer, n8n as orchestrator, CLI agents as executors.

---

## [1] Design Principles

| Principle                | Implementation                                             |
| ------------------------ | ---------------------------------------------------------- |
| Agnostic Intake          | Single n8n normalizer accepts Teams/Slack/GitHub/API       |
| Boardroom Critique       | Multi-personality agent debate with automated convergence  |
| Minimal Human Gates      | Human at: plan direction, plan approval, final delivery    |
| Context-Bounded Tasks    | Every task fits single agent context window                |
| Living Plan              | PLAN.md updated after each task, drift measured against it |
| Discussions for Planning | Issues reserved for executable work only                   |

---

## [2] Lifecycle Stages

```
INTAKE → BRAINSTORM → REFINE → PLAN → [HUMAN: Direction]
    → BOARDROOM → [HUMAN: Approval] → DECOMPOSE
    → IMPLEMENT → DRIFT CHECK → [CHECKPOINT] → DONE → [HUMAN: Delivery]
```

| Stage       | Label                 | Artifact             | Agent/Skill         |
| ----------- | --------------------- | -------------------- | ------------------- |
| Intake      | `idea`                | Discussion created   | n8n workflow        |
| Brainstorm  | `planning`            | Discussion           | `brainstorm` skill  |
| Refine      | `planning`            | Discussion (updated) | `refine` skill      |
| Plan        | `planning`            | PLAN.md draft        | `plan` skill        |
| Boardroom   | `critique-pending`    | Critique report      | `boardroom` skill   |
| Approved    | `critique-passed`     | PLAN.md finalized    | —                   |
| Decompose   | `scope`               | Task issues          | `decompose` skill   |
| Implement   | `implement`           | PR                   | Agent CLI           |
| Drift Check | `drift-flagged`       | PLAN.md updated      | `drift-check` skill |
| Checkpoint  | `checkpoint-required` | Progress report      | `checkpoint` skill  |
| Done        | `done`                | Deliverables         | —                   |

---

## [3] Build Phases

### Phase 1: Foundation (Labels + Discussions + Tooling) ✓ COMPLETE

**Labels** (`.github/labels.yml`) — 5 added:
- [x] `critique-pending` — Awaiting boardroom review
- [x] `critique-passed` — Boardroom approved, ready to decompose
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

### Phase 2: Skills (Claude Code) — IN PROGRESS

| Skill         | Path                          | Purpose                                      | Priority |
| ------------- | ----------------------------- | -------------------------------------------- | -------- |
| `brainstorm`  | `.claude/skills/brainstorm/`  | Explore possibilities, generate options      | P1       |
| `refine`      | `.claude/skills/refine/`      | Narrow scope, define problem                 | P1       |
| `plan`        | `.claude/skills/plan/`        | Create PLAN.md with objectives, architecture | P1       |
| `boardroom`   | `.claude/skills/boardroom/`   | Orchestrate multi-personality critique       | P1       |
| `decompose`   | `.claude/skills/decompose/`   | Break plan into context-bounded tasks        | P1       |
| `drift-check` | `.claude/skills/drift-check/` | PR alignment against task + project          | P2       |
| `checkpoint`  | `.claude/skills/checkpoint/`  | Phase-level progress review                  | P2       |

**Skill structure** (each):
```
.claude/skills/{name}/
├── SKILL.md          # Frontmatter + process definition
├── references/       # Supporting docs (optional)
└── scripts/          # Automation scripts (optional)
```

---

### Phase 3: Boardroom Agents

| Agent                  | Path              | Personality       | Focus                                     |
| ---------------------- | ----------------- | ----------------- | ----------------------------------------- |
| `boardroom-strategist` | `.claude/agents/` | VP Engineering    | Long-term impact, ROI, business alignment |
| `boardroom-architect`  | `.claude/agents/` | Staff Engineer    | System design, scalability, tech debt     |
| `boardroom-pragmatist` | `.claude/agents/` | Senior Engineer   | Feasibility, timeline, resources          |
| `boardroom-contrarian` | `.claude/agents/` | Devil's Advocate  | Assumptions, edge cases, failure modes    |
| `boardroom-integrator` | `.claude/agents/` | Platform Engineer | Cross-system impact, dependencies         |
| `governance`           | `.claude/agents/` | Alignment Checker | Drift detection, plan updates             |

**Agent output schema**:
```typescript
{
  vote: "approve" | "revise" | "block",
  confidence: 0-100,
  assessment: string,
  concerns: [{ severity, description, suggestion }],
  strengths: string[],
  questions: string[]
}
```

---

### Phase 4: Commands

| Command        | Path                              | Usage                           | Invokes           |
| -------------- | --------------------------------- | ------------------------------- | ----------------- |
| `/brainstorm`  | `.claude/commands/brainstorm.md`  | `/brainstorm <topic>`           | brainstorm skill  |
| `/refine`      | `.claude/commands/refine.md`      | `/refine #<discussion>`         | refine skill      |
| `/plan`        | `.claude/commands/plan.md`        | `/plan #<discussion>`           | plan skill        |
| `/boardroom`   | `.claude/commands/boardroom.md`   | `/boardroom #<project>`         | boardroom skill   |
| `/decompose`   | `.claude/commands/decompose.md`   | `/decompose #<project>`         | decompose skill   |
| `/drift-check` | `.claude/commands/drift-check.md` | `/drift-check #<pr> #<project>` | drift-check skill |

---

### Phase 5: n8n Workflows

| Workflow                   | Trigger                  | Action                                      |
| -------------------------- | ------------------------ | ------------------------------------------- |
| **Intake Normalizer**      | Webhook (any source)     | Normalize payload → route by intent         |
| **Discussion Router**      | `discussion_opened`      | Classify → trigger brainstorm or fast-track |
| **Lifecycle Orchestrator** | Label transitions        | Trigger appropriate skill on VPS            |
| **Boardroom Trigger**      | `critique-pending` added | SSH → run boardroom skill                   |
| **Drift Monitor**          | PR merged                | SSH → run drift-check, update PLAN.md       |
| **Checkpoint Trigger**     | N tasks complete         | SSH → generate checkpoint report            |
| **Response Router**        | Skill output             | Route response back to source               |

**Source adapters** (n8n nodes):
- Teams adapter
- Slack adapter
- GitHub Discussion adapter
- API webhook adapter

---

### Phase 6: Governance & Drift

**PLAN.md template** (created per project):
```markdown
# Project: {name}

## Current State
- Phase: {phase}
- Progress: {X}/{Y} tasks
- Drift Score: {score}%
- Updated: {timestamp}

## Objectives
1. {objective}

## Architecture Decisions
- {decision}: {choice} (Rationale: ...)

## Completed Work
| Task | PR  | Alignment | Notes |
| ---- | --- | --------- | ----- |

## Deviation Log
| Task | Expected | Actual | Impact |
| ---- | -------- | ------ | ------ |

## Upcoming
- [ ] Task: ...
```

**Drift thresholds**:
- ≥90%: Auto-approve
- 70-89%: Flag for human
- <70%: Block merge

**Checkpoint triggers**:
- Every 5 tasks OR phase boundary
- Cumulative drift <80%

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

| Gate             | Trigger                   | Action                         |
| ---------------- | ------------------------- | ------------------------------ |
| Plan Direction   | Plan created after refine | Approve objectives or redirect |
| Plan Approval    | Boardroom confidence ≥80% | Sign off or request revision   |
| Phase Checkpoint | N tasks OR phase boundary | Optional progress review       |
| Final Delivery   | All tasks complete        | Accept deliverables            |

**Escalation**:
- Boardroom confidence <60% → Immediate escalation
- Drift score <70% → Block + notify
- Task blocked >48h → Notify
- Unanimous blocker → Halt

---

## [6] Implementation Order

### Phase 1: Foundation ✓
- [x] Labels — Add 5 labels to `.github/labels.yml`
- [x] Schema — Update `B.labels.groups` in `schema.ts`
- [x] Docs — Update `README.md`, `ARCHITECTURE.md`
- [x] Config — Update `ISSUE_TEMPLATE/config.yml` with Discussion links
- [x] Discussions — Enabled (`Planning` + `Q&A` categories)
- [x] Tooling — Add Discussion commands to `github-tools` (GraphQL)

### Phase 2: Claude Code Skills — IN PROGRESS
- [x] `brainstorm` skill — Explore possibilities, generate options
- [ ] `refine` skill — Narrow scope, define problem
- [ ] `plan` skill — Create PLAN.md with objectives, architecture
- [ ] `boardroom` skill — Orchestrate multi-personality critique
- [ ] `decompose` skill — Break plan into context-bounded tasks

### Phase 3: Boardroom Agents
- [ ] `boardroom-strategist` agent — VP Engineering perspective
- [ ] `boardroom-architect` agent — Staff Engineer perspective
- [ ] `boardroom-pragmatist` agent — Senior Engineer perspective
- [ ] `boardroom-contrarian` agent — Devil's Advocate perspective
- [ ] `boardroom-integrator` agent — Platform Engineer perspective
- [ ] `governance` agent — Drift detection, alignment checks

### Phase 4: Commands
- [ ] `/brainstorm` command
- [ ] `/refine` command
- [ ] `/plan` command
- [ ] `/boardroom` command
- [ ] `/decompose` command
- [ ] `/drift-check` command

### Phase 5: P2 Skills
- [ ] `drift-check` skill — PR alignment against task + project
- [ ] `checkpoint` skill — Phase-level progress review

### Phase 6: n8n Workflows (External)
- [ ] Intake Normalizer — Webhook receiver, payload normalization
- [ ] Discussion Router — Classify intent, trigger skills
- [ ] Lifecycle Orchestrator — Label transition handlers
- [ ] Boardroom Trigger — `critique-pending` → SSH → boardroom skill
- [ ] Drift Monitor — PR merged → SSH → drift-check
- [ ] Checkpoint Trigger — N tasks complete → checkpoint report

---

## [7] File Manifest

### Create

| Path                                     | Type    | Status |
| ---------------------------------------- | ------- | ------ |
| `.claude/skills/brainstorm/SKILL.md`     | Skill   | ✓ DONE |
| `.claude/skills/refine/SKILL.md`         | Skill   |        |
| `.claude/skills/plan/SKILL.md`           | Skill   |        |
| `.claude/skills/boardroom/SKILL.md`      | Skill   |        |
| `.claude/skills/decompose/SKILL.md`      | Skill   |        |
| `.claude/skills/drift-check/SKILL.md`    | Skill   |        |
| `.claude/skills/checkpoint/SKILL.md`     | Skill   |        |
| `.claude/agents/boardroom-strategist.md` | Agent   |        |
| `.claude/agents/boardroom-architect.md`  | Agent   |        |
| `.claude/agents/boardroom-pragmatist.md` | Agent   |        |
| `.claude/agents/boardroom-contrarian.md` | Agent   |        |
| `.claude/agents/boardroom-integrator.md` | Agent   |        |
| `.claude/agents/governance.md`           | Agent   |        |
| `.claude/commands/brainstorm.md`         | Command |        |
| `.claude/commands/refine.md`             | Command |        |
| `.claude/commands/plan.md`               | Command |        |
| `.claude/commands/boardroom.md`          | Command |        |
| `.claude/commands/decompose.md`          | Command |        |
| `.claude/commands/drift-check.md`        | Command |        |

### Modify

| Path                                        | Change                                     | Status  |
| ------------------------------------------- | ------------------------------------------ | ------- |
| `.github/labels.yml`                        | Add 5 lifecycle/governance labels          | ✓ DONE  |
| `.github/scripts/schema.ts`                 | Update B.labels.groups (status + special)  | ✓ DONE  |
| `.github/README.md`                         | Update label categories table              | ✓ DONE  |
| `.github/ARCHITECTURE.md`                   | Reference this plan + labels table         | ✓ DONE  |
| `.github/ISSUE_TEMPLATE/config.yml`         | Discussion contact links (Planning, Q&A)   | ✓ DONE  |
| `.claude/skills/github-tools/scripts/gh.py` | Add Discussion commands (GraphQL)          | ✓ DONE  |
| `.claude/skills/github-tools/SKILL.md`      | Document Discussion commands               | ✓ DONE  |
| `.github/N8N_SETUP.md`                      | Add intake + lifecycle workflows           | Phase 6 |

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

- [ ] Discussion created → auto-progresses through brainstorm/refine/plan
- [ ] Plan triggers boardroom → 5 agents critique in parallel
- [ ] Boardroom outputs confidence score + concerns
- [ ] Approved plan decomposes into context-bounded tasks
- [ ] Each task PR checked for drift against PLAN.md
- [ ] Cumulative drift tracked, checkpoints triggered
- [ ] Human gates only at: direction, approval, delivery
- [ ] Works from Teams/Slack/GitHub/API (same flow)
