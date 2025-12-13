# Agentic Infrastructure Architecture

GitHub is the state layer. AI agents operate on that state via two execution paths.

---

## Core Concept

```
GitHub (State)          Execution Path A              Execution Path B
─────────────────       ─────────────────             ─────────────────
Issues                  GitHub Actions                n8n Cloud + VPS
Labels                  (event-driven, fast)          (full CLI agents)
Pull Requests           │                             │
Comments                ▼                             ▼
                        Simple operations             Claude Code CLI
                        API calls (adequate)          Gemini CLI
                        Code review                   Full tool use
                        Label sync                    File access, git, PRs
                        Meta fixes                    Multi-turn sessions
```

---

## Two Execution Paths

| Path               | When to Use                    | Example                                                  |
| ------------------ | ------------------------------ | -------------------------------------------------------- |
| **GitHub Actions** | Fast, simple, event-driven     | PR title normalization, label sync, code review comments |
| **n8n + VPS**      | Full agent capabilities needed | Implement features, decompose projects, complex analysis |

**GitHub Actions** = adequate for simple API calls (single request/response).
**n8n + VPS** = required when agents need tool use, file access, multi-turn reasoning.

---

## State Management (Labels)

Labels are the state machine. Workflows react to label changes.

| Category   | Labels                                                                           | Purpose                 |
| ---------- | -------------------------------------------------------------------------------- | ----------------------- |
| **Agent**  | `claude`, `gemini`, `copilot`, `codex`                                           | Dispatch to specific AI |
| **Status** | `idea` → `triage` → `planning` → `implement` → `in-progress` → `review` → `done` | Workflow state          |
| **Type**   | `task`, `spike`, `project`, `fix`, `feat`, etc.                                  | Work classification     |

---

## AI Agents (4 Active)

All four agents are used. Each has code review capability + varying strengths.

| Agent       | Code Review              | Full CLI (n8n+VPS)    | Strength                         |
| ----------- | ------------------------ | --------------------- | -------------------------------- |
| **Claude**  | GitHub Action (API)      | Claude Code CLI       | Deep reasoning, complex tasks    |
| **Gemini**  | GitHub Action (API)      | Gemini CLI            | Multimodal, fast, cost-efficient |
| **Copilot** | Native (Copilot Pro)     | Copilot CLI (planned) | IDE integration, suggestions     |
| **Codex**   | Built-in review function | (TBD)                 | Weakest of four, supplementary   |

**Code review** = API calls via GitHub Actions (adequate, all 4 support this).
**Full CLI** = n8n + VPS execution for implementation work (Claude, Gemini primary).

Copilot Pro provides native code review without custom workflows. Codex review is supplementary.

---

## Workflow Lifecycle

```
[SPIKE] idea           Human brainstorms
    ↓
[PROJECT] planning     n8n → Claude CLI decomposes into TASKs
    ↓
[TASK] implement       n8n → Agent label triggers CLI execution
    ↓
[TASK] in-progress     Agent working (CLI on VPS)
    ↓
PR created             Agent pushes code
    ↓
PR merged              n8n → Mark issues done, close
```

---

## Infrastructure Components

| Component          | Role                                    | Location             |
| ------------------ | --------------------------------------- | -------------------- |
| **GitHub**         | State layer (issues, labels, PRs)       | github.com           |
| **GitHub Actions** | Fast event handlers, simple API calls   | `.github/workflows/` |
| **n8n Cloud**      | Orchestrator, webhook receiver, routing | n8n.cloud            |
| **Hostinger VPS**  | Runtime for CLI agents                  | Remote server        |
| **CLI Tools**      | Claude Code, Gemini CLI, gh             | Installed on VPS     |

---

## Key Files

| File                 | Purpose                                        |
| -------------------- | ---------------------------------------------- |
| `README.md`          | Detailed workflow/action inventory             |
| `N8N_SETUP.md`       | n8n + VPS setup for CLI agent execution        |
| `AGENTIC_PM_PLAN.md` | AI-first PM lifecycle implementation plan      |
| `labels.yml`         | 43 labels across 7 categories                  |
| `scripts/schema.ts`  | Central B constant, dispatch tables, utilities |

---

## Why Two Paths?

**API calls are fine for:**
- Code review (read diff, post comments)
- Label management
- Metadata normalization
- Simple Q&A responses

**CLI agents required for:**
- Implementing features (file writes, git commits)
- Project decomposition (multi-step reasoning)
- Complex refactoring (codebase-wide changes)
- Any task needing tool use beyond text generation

---

## Agentic PM System

AI-first project management. Discussions for planning, Issues for execution.

```
INTAKE → EXPLORE → PLAN → [BOARDROOM ⟷ REFINE]* → DECOMPOSE → [HUMAN] → DISPATCH → IMPLEMENT → DONE
                                ↑       ↓
                                └───────┘ (loop while revise, max 3)
```

### Skills (Claude Code)

| Skill       | Input                  | Output                  | Marker                               |
| ----------- | ---------------------- | ----------------------- | ------------------------------------ |
| `explore`   | Discussion             | Recommendation          | `<!-- SKILL_COMPLETE: explore -->`   |
| `plan`      | explore output         | PLAN.md draft           | `<!-- SKILL_COMPLETE: plan -->`      |
| `boardroom` | PLAN.md                | 5-agent critique + vote | `<!-- SKILL_COMPLETE: boardroom -->` |
| `refine`    | PLAN.md + critique     | Refined PLAN.md         | `<!-- SKILL_COMPLETE: refine -->`    |
| `decompose` | PLAN.md (approved)     | Task plan (no issues)   | `<!-- SKILL_COMPLETE: decompose -->` |
| `dispatch`  | Task plan + human gate | GitHub issues           | `<!-- SKILL_COMPLETE: dispatch -->`  |

### Orchestration

n8n detects completion markers → triggers `governance` agent → pass → next skill.

| Label               | Purpose                               |
| ------------------- | ------------------------------------- |
| `critique-pending`  | Triggers boardroom skill              |
| `refine-pending`    | Boardroom voted revise → refine skill |
| `dispatch-approved` | Human approved → dispatch skill       |
| `scope`             | Tasks decomposed                      |
| `drift-flagged`     | Governance detected misalignment      |

### Design

- **ICE Engine**: Kickstart once → runs autonomously until human gate
- **Governance**: Validates stage output vs input (binary pass/fail)
- **Boardroom Loop**: 5-personality critique → refine → repeat until approve (max 3)
- **Single Human Gate**: Review decomposition before issue dispatch

See [`AGENTIC_PM_PLAN.md`](AGENTIC_PM_PLAN.md) for full specification.
