# Agentic Label System

> **Context:** Machine-readable middle layer for AI agent coordination via GitHub issues

---

## [1][OVERVIEW]

**Purpose:** Enable AI agents to coordinate work via orthogonal label families that express issue state, type, phase, and priority without coupling to conventional commits.

**Design:** Parametric label system with dispatch table validation enforcing invariants.

---

## [2][LABEL_AXES]

### [2.1][KIND_AXIS]

**Purpose:** Classify work unit type

| Label | Description | Outputs |
|-------|-------------|---------|
| `kind:project` | Top-level initiative (e.g., Agentic Framework) | Completed child tasks |
| `kind:task` | Default work unit leading to code changes | Pull request with code |
| `kind:spike` | Research task, time-boxed | Knowledge artifacts (docs, decisions, POCs) |

**Invariant:** Maximum 1 `kind:*` label per issue

---

### [2.2][STATUS_AXIS]

**Purpose:** Track current issue state in workflow

| Label | Description | Next State |
|-------|-------------|------------|
| `status:idea` | Untriaged raw input | `status:triage` |
| `status:triage` | Newly created, being shaped | `status:implement` or `status:planning` |
| `status:planning` | Being shaped into plan | `status:implement` |
| `status:implement` | Ready for implementation (AI/human) | `status:in-progress` |
| `status:in-progress` | Someone is actively working | `status:review` or `status:blocked` |
| `status:review` | Needs review | `status:done` or `status:blocked` |
| `status:blocked` | Cannot proceed | `status:implement` (when unblocked) |
| `status:done` | Completed and merged | Terminal state |

**Invariant:** Maximum 1 `status:*` label per issue

**State Machine:**
```
idea → triage → planning → implement → in-progress → review → done
                     ↑          ↓          ↑
                     └────── blocked ──────┘
```

---

### [2.3][PHASE_AXIS]

**Purpose:** Associate issues with project lifecycle phase

| Label | Description | Focus |
|-------|-------------|-------|
| `phase:0-foundation` | Foundational work | Infrastructure, tooling, setup |
| `phase:1-planning` | Planning and design | Architecture, spike results, ADRs |
| `phase:2-impl-core` | Core implementation | Essential features, happy path |
| `phase:3-impl-extensions` | Extensions | Edge cases, optimizations, polish |
| `phase:4-hardening` | Stabilization | Bug fixes, performance, security |
| `phase:5-release` | Release preparation | Documentation, migration guides, release notes |

**Invariant:** Maximum 1 `phase:*` label per issue

---

### [2.4][PRIORITY_AXIS]

**Purpose:** Express urgency and scheduling preference

| Label | Description | SLA |
|-------|-------------|-----|
| `priority:critical` | Must be addressed immediately | Hours |
| `priority:high` | Important, near-term | Days |
| `priority:medium` | Standard priority | Weeks |
| `priority:low` | Nice to have | Backlog |

**Invariant:** Maximum 1 `priority:*` label per issue

---

## [3][AI_META_BLOCK]

### [3.1][FORMAT]

**Location:** Top of issue body, inside HTML comment

```html
<!-- ai-meta
kind: task
project_id: agentic-framework-001
phase: 2-impl-core
status: implement
agent: claude
effort: 3
-->
```

### [3.2][FIELDS]

| Field | Type | Required | Values |
|-------|------|----------|--------|
| `kind` | string | ✓ | `project`, `task`, `spike`, `refactor` |
| `project_id` | string | ✗ | Parent project identifier |
| `phase` | string | ✗ | `0-foundation`, `1-planning`, `2-impl-core`, `3-impl-extensions`, `4-hardening`, `5-release` |
| `status` | string | ✗ | `triage`, `implement`, `in-progress`, `review`, `blocked`, `done`, `idea`, `planning` |
| `agent` | string | ✗ | `claude`, `copilot`, `gemini`, `codex`, `human` |
| `effort` | number | ✗ | Story points (Fibonacci: 1, 2, 3, 5, 8, 13, 21) |

### [3.3][AUTOMATIC_SYNC]

**Workflow:** `.github/workflows/ai-meta-sync.yml`

**Trigger:** Issue opened/edited

**Behavior:**
1. Parse `<!-- ai-meta ... -->` block from issue body
2. Extract fields and validate against schema
3. Generate label list: `kind:X`, `phase:Y`, `status:Z`, `agent-name`
4. Apply labels via GitHub API
5. Comment on parse errors with usage guide

---

## [4][LABEL_VALIDATION]

### [4.1][WORKFLOW]

**File:** `.github/workflows/label-validator.yml`

**Trigger:** Issue/PR labeled, unlabeled, opened, reopened

**Script:** `.github/scripts/label-validator.ts`

### [4.2][INVARIANTS]

**Rule:** Maximum 1 label per axis (`kind`, `status`, `phase`, `priority`)

**Enforcement:**
1. Group labels by axis (dispatch table keyed by prefix)
2. Detect violations (count > max per axis)
3. Select preferred label (priority order via dispatch table)
4. Remove excess labels
5. Comment on violations

**Priority Order:**
- **kind:** `project` > `task` > `spike`
- **status:** `done` > `review` > `in-progress` > `implement` > `blocked` > `planning` > `triage` > `idea`
- **phase:** `5-release` > `4-hardening` > `3-impl-extensions` > `2-impl-core` > `1-planning` > `0-foundation`
- **priority:** `critical` > `high` > `medium` > `low`

---

## [5][ISSUE_TEMPLATES]

### [5.1][PROJECT_TEMPLATE]

**File:** `.github/ISSUE_TEMPLATE/project.yml`

**Default Labels:** `kind:project`, `status:triage`, `phase:1-planning`

**Fields:** project_id, objective, context, scope, acceptance_criteria, phase, priority, agent, effort

**Use Case:** Top-level initiatives spanning multiple tasks

---

### [5.2][TASK_TEMPLATE]

**File:** `.github/ISSUE_TEMPLATE/task.yml`

**Default Labels:** `kind:task`, `status:triage`

**Fields:** project_id, objective, context, target, acceptance_criteria, priority, agent, effort, technical_notes

**Use Case:** Standard work units producing code changes

---

### [5.3][SPIKE_TEMPLATE]

**File:** `.github/ISSUE_TEMPLATE/spike.yml`

**Default Labels:** `kind:spike`, `status:triage`

**Fields:** project_id, research_question, context, acceptance_criteria (knowledge outputs), priority, agent, effort, research_approach

**Use Case:** Time-boxed research with documented outcomes

---

## [6][SCHEMA_INTEGRATION]

### [6.1][B_CONSTANT]

**File:** `.github/scripts/schema.ts`

**Location:** `B.labels.categories`

```typescript
const B = Object.freeze({
  labels: {
    categories: {
      kind: ['kind:project', 'kind:task', 'kind:spike'] as const,
      status: [
        'status:triage',
        'status:implement',
        'status:in-progress',
        'status:review',
        'status:blocked',
        'status:done',
        'status:idea',
        'status:planning',
      ] as const,
      phase: [
        'phase:0-foundation',
        'phase:1-planning',
        'phase:2-impl-core',
        'phase:3-impl-extensions',
        'phase:4-hardening',
        'phase:5-release',
      ] as const,
      priority: [
        'priority:critical',
        'priority:high',
        'priority:medium',
        'priority:low',
      ] as const,
      // ... other categories
    },
    invariants: {
      maxPerAxis: { kind: 1, status: 1, phase: 1, priority: 1 } as const,
    } as const,
  },
} as const);
```

---

## [7][GITHUB_PROJECT_MAPPING]

### [7.1][PROJECT_FIELDS]

**Status Field:**
- Values: `Triage`, `Ready`, `In Progress`, `Review`, `Blocked`, `Done`
- Maps to: `status:triage`, `status:implement`, `status:in-progress`, `status:review`, `status:blocked`, `status:done`

**Phase Field:**
- Values: `0 – Foundation`, `1 – Planning`, `2 – Implementation (Core)`, `3 – Implementation (Extensions)`, `4 – Hardening`, `5 – Release`
- Maps to: `phase:0-foundation`, `phase:1-planning`, `phase:2-impl-core`, `phase:3-impl-extensions`, `phase:4-hardening`, `phase:5-release`

**Kind Field:**
- Values: `Project`, `Task`, `Spike`
- Maps to: `kind:project`, `kind:task`, `kind:spike`

**Priority Field:**
- Values: `Critical`, `High`, `Medium`, `Low`
- Maps to: `priority:critical`, `priority:high`, `priority:medium`, `priority:low`

---

## [8][AGENT_WORKFLOW_INTEGRATION]

### [8.1][DISPATCH_ROUTING]

**File:** `.github/workflows/gemini-dispatch.yml`

**Label-Based Routing:**
- `claude` label → route to Claude agent
- `copilot` label → route to Copilot agent
- `gemini` label → route to Gemini agent
- `codex` label → route to Codex agent

**Status-Based Gates:**
- `status:implement` → trigger agent implementation workflow
- `status:review` → trigger agent review workflow
- `status:blocked` → notify assigned agent

---

## [9][MIGRATION_GUIDE]

### [9.1][DEPRECATED_LABELS]

**Old Label** | **New Label** | **Status**
---|---|---
`implement` | `status:implement` | Deprecated
`review` | `status:review` | Deprecated
`blocked` | `status:blocked` | Deprecated
`critical` | `priority:critical` | Deprecated

**Action:** Update workflows to use new prefixed labels

---

## [10][EXAMPLES]

### [10.1][PROJECT_ISSUE]

```markdown
<!-- ai-meta
kind: project
project_id: agentic-framework-001
phase: 1-planning
status: planning
agent: human
effort: 21
-->

## Objective
Build an agentic automation framework for GitHub-based AI coordination.

## Context
...

## Scope
**In Scope:**
- Label system
- Issue templates
- Validation workflows

**Out of Scope:**
- Production deployment
- Multi-repository support

## Acceptance Criteria
- [ ] All child tasks closed
- [ ] Documentation complete
- [ ] CI passing
```

**Labels Applied:** `kind:project`, `phase:1-planning`, `status:planning`

---

### [10.2][TASK_ISSUE]

```markdown
<!-- ai-meta
kind: task
project_id: agentic-framework-001
phase: 2-impl-core
status: implement
agent: claude
effort: 3
-->

## Objective
Implement label validation workflow with dispatch table pattern.

## Context
Follows parametric design in schema.ts.

## Target
`.github/workflows/label-validator.yml`, `.github/scripts/label-validator.ts`

## Acceptance Criteria
- [ ] Workflow triggers on label events
- [ ] Enforces max 1 label per axis
- [ ] Uses dispatch table for priority selection
- [ ] Tests pass
```

**Labels Applied:** `kind:task`, `phase:2-impl-core`, `status:implement`, `claude`

---

## [11][REFERENCES]

- **Schema Definition:** `.github/scripts/schema.ts` → `B.labels`
- **Label File:** `.github/labels.yml`
- **Validation Script:** `.github/scripts/label-validator.ts`
- **AI Meta Parser:** `.github/scripts/ai-meta-parser.ts`
- **Workflows:** `.github/workflows/label-validator.yml`, `.github/workflows/ai-meta-sync.yml`
- **Templates:** `.github/ISSUE_TEMPLATE/{project,task,spike}.yml`
