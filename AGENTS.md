# [H1][AGENT_RULES]

Read @CLAUDE.md

---

## [2][AGENTIC_LABEL_SYSTEM]

**Context:** Machine-readable middle layer for AI coordination via GitHub issues

**Documentation:** [docs/agentic-labels.md](docs/agentic-labels.md)

**Label Families:**
- `kind:*` — Work unit type (project, task, spike)
- `status:*` — Current state in workflow (8 states: triage → done)
- `phase:*` — Project lifecycle phase (0-foundation → 5-release)
- `priority:*` — Urgency level (critical, high, medium, low)

**AI-Meta Block:**
```html
<!-- ai-meta
kind: task
project_id: xxx
phase: 2-impl-core
status: implement
agent: claude
effort: 3
-->
```

**Workflows:**
- `label-validator.yml` — Enforces max 1 label per axis
- `ai-meta-sync.yml` — Auto-applies labels from ai-meta blocks

**Templates:**
- `project.yml` — Top-level initiatives
- `task.yml` — Standard work units
- `spike.yml` — Research with knowledge outputs