# ANALYSIS.md - Agentic Systems Architecture Strategy

<metadata>
  <version>2.0.0</version>
  <generated>2025-11-26</generated>
  <sources>TASK_a.md, TASK_b.md, TASK_c.md</sources>
  <target>Self-Describing Agentic Environment</target>
</metadata>

---

## 1. Source Synthesis

### 1.1 Task Stream Inventory

| Source | Focus | Key Deliverables |
|--------|-------|------------------|
| TASK_a | Lead Engineer Layer | agent-judge, renovate-gate, graph artifact, claude-triage |
| TASK_b | Full Automation Blueprint | ai-pr-summary, ai-pr-triage, ai-issue-triage, renovate-automerge, workspace-health, CI UX |
| TASK_c | Claude Code Execution | 11 phases, 9 workflows, templates, docs |

### 1.2 Conflict Resolution

<conflict-resolution>
| Overlap | Resolution | Rationale |
|---------|------------|-----------|
| TASK_a `agent-judge.yml` vs TASK_b `ai-pr-summary.yml` vs TASK_c `pr-review-aggregator.yml` | **Unified:** `pr-review-aggregator.yml` | TASK_c has most complete spec with marker comments, update-in-place |
| TASK_a `claude-triage.yml` vs TASK_b `ai-issue-triage.yml` vs TASK_c `issue-lifecycle.yml` | **Unified:** `issue-lifecycle.yml` | TASK_c adds stale handling, validation, aging reports |
| TASK_b `workspace-health.yml` vs TASK_c `dashboard.yml` | **Unified:** `dashboard.yml` | TASK_c specifies pinned issue with metrics, richer output |
| TASK_a `renovate-gate.yml` vs TASK_b/C `renovate-automerge.yml` | **Merged:** `renovate-automerge.yml` with Stryker gate | Combine mutation scoring from A with orchestration from B/C |
</conflict-resolution>

### 1.3 Final Workflow Inventory

<deliverables type="workflows">
| Workflow | Purpose | Trigger |
|----------|---------|---------|
| `pr-review-aggregator.yml` | Synthesize all AI/CI feedback into single comment | `workflow_run`, `pull_request_review` |
| `auto-labeler.yml` | Path-based PR labels + AI issue classification | `pull_request`, `issues` |
| `issue-lifecycle.yml` | Triage, stale handling, validation, aging | `issues`, `issue_comment`, `schedule` |
| `renovate-automerge.yml` | Mutation-gated auto-merge for deps | `pull_request`, `check_suite`, `schedule` |
| `dashboard.yml` | Auto-updating pinned issue with repo health | `schedule`, `workflow_dispatch`, `push` |
| `release.yml` | Conventional commit releases | `push` to main, `workflow_dispatch` |
| `bundle-analysis.yml` | Bundle size tracking with PR comments | `pull_request` |
| `security.yml` | Audit, CodeQL, secrets scan, license check | `pull_request`, `push`, `schedule` |
| `claude-code-review-enhanced.yml` | REQUIREMENTS.md compliance review | `pull_request` (after CI) |
| `biome-repair.yml` | Auto-fix style before human review | `pull_request` |
| `semantic-commits.yml` | Enforce conventional commits | `pull_request` |
</deliverables>

<deliverables type="config">
| File | Changes |
|------|---------|
| `renovate.json` | Enhance existing groups (schedule, automerge), add platformAutomerge settings |
| `nx.json` | Add --incremental flag to mutate target |
| `lefthook.yml` | Effect pattern validation (word boundary regex, limitations noted) |
| `.github/labeler.yml` | Path-to-label mappings (content-based requires custom scripting) |
</deliverables>

<deliverables type="templates">
| File | Purpose |
|------|---------|
| `.github/PULL_REQUEST_TEMPLATE.md` | Semantic hooks + checklist |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Form-based with AGENT_CONTEXT |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Form-based with pattern selection |
| `.github/ISSUE_TEMPLATE/config.yml` | Disable blank, add contact links |
</deliverables>

<deliverables type="docs">
| File | Purpose |
|------|---------|
| `docs/AUTOMATION.md` | Workflow overview, agent table, commands |
| `docs/INTEGRATIONS.md` | GitHub Apps, branch protection, badges |
| `docs/agent-context/project-map.json` | Nx graph + public APIs for agents |
| `docs/agent-context/README.md` | Query protocol for agents |
</deliverables>

<deliverables type="tools">
| File | Purpose |
|------|---------|
| `tools/generate-context/` | Nx graph extraction + API surface generation |
| `tools/sync-agent-protocols.ts` | REQUIREMENTS.md → derivative doc generation |
</deliverables>

---

## 2. Architecture Design

### 2.1 Agent Context Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REQUIREMENTS.md                              │
│                    (Single Source of Truth)                          │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ tools/sync-agent-protocols.ts
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
   AGENTS.md             copilot-instructions      CLAUDE.md
   (CLI/CI)                   (IDE)               (Claude Code)
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ ci.yml      │  │ pr-review-  │  │ issue-      │  │ renovate-   │ │
│  │ +context    │  │ aggregator  │  │ lifecycle   │  │ automerge   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         └────────────────┴────────────────┴────────────────┘        │
│                                   │                                  │
│                                   ▼                                  │
│         ┌─────────────────────────────────────────────────┐         │
│         │           project-map.json (Nx Graph)           │         │
│         │  - Package deps  - Public APIs  - Import paths  │         │
│         └─────────────────────────────────────────────────┘         │
│                                   │                                  │
│         ┌─────────────────────────┴─────────────────────────┐       │
│         ▼                         ▼                         ▼       │
│  ┌─────────────┐          ┌─────────────┐          ┌─────────────┐  │
│  │ Issue       │          │ PR Template │          │ Agent       │  │
│  │ Templates   │          │ + CONTEXT   │          │ Matrix      │  │
│  │ + CONTEXT   │          │             │          │ (10 agents) │  │
│  └─────────────┘          └─────────────┘          └─────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Local Development                             │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                      lefthook.yml                            │    │
│  │  - biome check --write  - validate-imports  - effect-check  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Semantic Template Design

**AGENT_CONTEXT Hook Format:**
```html
<!-- AGENT_CONTEXT
{
  "type": "feature",
  "scope": ["packages/components"],
  "agents": ["typescript-advanced", "testing-specialist"],
  "patterns": ["Effect-pipeline", "Option-monad", "B-constant"],
  "priority": "p1",
  "breaking": false,
  "test_coverage": "required"
}
-->
```

**Parsing (Effect-compliant):**
```typescript
const parseAgentContext = (body: string) =>
  pipe(
    O.fromNullable(body.match(/<!-- AGENT_CONTEXT\n([\s\S]*?)\n-->/)?.[1]),
    O.flatMap(json => O.tryCatch(() => JSON.parse(json) as AgentContext)),
    O.getOrElse(() => DEFAULT_CONTEXT)
  );
```

### 2.3 Renovate Domain Strategy

Existing groups in renovate.json to be modified (not duplicated):

| Group | Modification |
|-------|--------------|
| `effect-ecosystem` | Add `schedule: ["before 6am on Monday"]` |
| `vite-ecosystem` | Add `automerge: true`, `matchUpdateTypes: ["minor", "patch"]` |
| `types` | Add `excludePackagePatterns: ["^@types/react"]` |
| `react-canary`, `nx-canary`, `github-actions` | No changes (already configured) |

### 2.4 CI Quality → Issue Pipeline

From TASK_b Section 5 - convert persistent failures to tracked issues:

| Source | Issue Title | Labels |
|--------|-------------|--------|
| Stryker < 80% | "Mutation Debt: {project}" | `tech-debt`, `testing` |
| Repeated lint failures | "Quality Debt: {paths}" | `tech-debt`, `refactor` |
| Compression/PWA failures | "Performance Debt: {target}" | `tech-debt`, `performance` |

---

## 3. Operating Principles

<principles source="TASK_b Section 0">
1. **Preserve Existing Behavior** - Extend, don't replace working workflows
2. **Read Before Acting** - Ingest nx.json, package.json, existing workflows before changes
3. **Idempotent Operations** - Use marker comments, predictable labels, safe reruns
4. **High Assurance** - Run `nx affected -t check,typecheck,test` after changes
5. **Minimal Dependencies** - Reuse existing Actions and secrets
</principles>

---

## 4. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Agent context load | ~30s (file search) | <1s (JSON query) |
| PR style comments | ~15/PR | 0 (Biome pre-fix) |
| Dep update PRs | ~20/week | ~5/week (grouped) |
| Review synthesis | Manual | Automated summary |
| Issue triage | Manual | Auto-labeled |
| Stale issues | Untracked | 30-day lifecycle |

---

## 5. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Template hooks ignored | Provide sensible defaults, validate in workflows |
| project-map.json stale | Regenerate on every main push |
| Protocol drift | Hash-based CI validation |
| Biome --unsafe breaks code | Run pnpm test after auto-fix; skip commit if tests fail |
| Auto-merge introduces bugs | Stryker mutation gate (80% threshold) |
| Workflow proliferation | Consolidate overlapping workflows |

---

## 6. Implementation Sequence

<execution-order>
| Phase | Focus | Deliverables | Dependencies |
|-------|-------|--------------|--------------|
| 1 | Foundation | `tools/generate-context/`, `project-map.json` | None |
| 2 | Templates | Issue templates, PR template with hooks | Phase 1 |
| 3 | Core Workflows | `pr-review-aggregator`, `issue-lifecycle`, `auto-labeler` | Phase 2 |
| 4 | Dep Management | `renovate.json` update, `renovate-automerge.yml` | CI passing |
| 5 | Quality Gates | `biome-repair`, `semantic-commits`, CI enhancements | Phase 3 |
| 6 | Dashboard | `dashboard.yml`, pinned issue | All workflows |
| 7 | Supporting | `release`, `bundle-analysis`, `security` | Phase 5 |
| 8 | Documentation | `AUTOMATION.md`, `INTEGRATIONS.md` | All phases |
| 9 | Protocol Sync | `tools/sync-agent-protocols.ts`, validation | Phase 8 |
</execution-order>

---

*End of ANALYSIS.md*
