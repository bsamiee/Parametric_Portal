# TASK_FINAL.md - Agentic Systems Execution Checklist

> **Objective:** Transform Parametric Portal into a Self-Describing Agentic Environment
> **Total Tasks:** 47 | **Layers:** 4

---

## Protocol Layer

*Standardizing agent behavior, Effect TS rules, and documentation sync*

### P1: Requirements SSoT Promotion

- [ ] **P1.1** Audit `REQUIREMENTS.md` for completeness against `AGENTS.md` and `copilot-instructions.md`
- [ ] **P1.2** Add `$schema` header to `REQUIREMENTS.md` for validation
- [ ] **P1.3** Extract stack-versions section into structured YAML frontmatter
- [ ] **P1.4** Define `<!-- SYNC_HASH: sha256 -->` markers for drift detection

### P2: Protocol Sync Tooling

- [ ] **P2.1** Create `tools/sync-agent-protocols.ts`:
  ```typescript
  // Effect pipeline: Read REQUIREMENTS.md → Generate derivatives → Write files
  ```
- [ ] **P2.2** Implement hash-based change detection
- [ ] **P2.3** Add dry-run mode for CI validation
- [ ] **P2.4** Create `pnpm sync:protocols` script in root `package.json`

### P3: Agent Specification Files

- [ ] **P3.1** Create `.github/agents/agent-manifest.json`:
  ```json
  {
    "agents": [
      { "id": "typescript-advanced", "triggers": ["*.ts", "*.tsx"], "priority": 1 }
    ]
  }
  ```
- [ ] **P3.2** Add agent selection algorithm documentation
- [ ] **P3.3** Define agent handoff protocol for multi-agent tasks

### P4: Effect TS Enforcement

- [ ] **P4.1** Add `biome.json` rule: `noTryCatch` (via GritQL plugin when stable)
- [ ] **P4.2** Create `.github/workflows/effect-validation.yml`:
  ```yaml
  - name: Validate Effect patterns
    run: |
      grep -r "try\s*{" packages/ && exit 1 || true
      grep -r "catch\s*(" packages/ && exit 1 || true
  ```
- [ ] **P4.3** Add `lefthook.yml` pre-commit hook for Effect pattern validation
- [ ] **P4.4** Document approved Effect patterns in `docs/patterns/effect-ts.md`

---

## Interface Layer

*Semantic templates and machine-readable PR/Issue interfaces*

### I1: Issue Templates with Semantic Hooks

- [ ] **I1.1** Create `.github/ISSUE_TEMPLATE/config.yml`:
  ```yaml
  blank_issues_enabled: false
  contact_links:
    - name: Documentation
      url: https://github.com/bsamiee/Parametric_Portal/wiki
  ```

- [ ] **I1.2** Create `.github/ISSUE_TEMPLATE/feature_request.yml`:
  ```yaml
  name: Feature Request
  description: Propose a new feature
  body:
    - type: markdown
      attributes:
        value: |
          <!-- AGENT_CONTEXT
          {"type":"feature","agents":["library-planner","typescript-advanced"]}
          -->
    - type: dropdown
      id: scope
      attributes:
        label: Affected Package
        options:
          - "@parametric-portal/components"
          - "@parametric-portal/theme"
          - "@parametric-portal/types"
          - "New package required"
    - type: checkboxes
      id: patterns
      attributes:
        label: Required Patterns
        options:
          - label: Effect pipeline
          - label: Option monad
          - label: Branded types
          - label: Dispatch table
  ```

- [ ] **I1.3** Create `.github/ISSUE_TEMPLATE/bug_report.yml` with semantic hooks
- [ ] **I1.4** Create `.github/ISSUE_TEMPLATE/refactor.yml` with complexity estimation

### I2: PR Template with Agent Context

- [ ] **I2.1** Create `.github/pull_request_template.md`:
  ```markdown
  <!-- AGENT_CONTEXT
  {
    "type": "implementation",
    "scope": [],
    "breaking": false,
    "patterns_applied": [],
    "test_coverage": "required"
  }
  -->

  ## Summary
  <!-- Brief description -->

  ## Type
  - [ ] Feature
  - [ ] Bug fix
  - [ ] Refactor
  - [ ] Documentation
  - [ ] Dependencies

  ## Checklist
  - [ ] `pnpm check` passes
  - [ ] `pnpm typecheck` passes
  - [ ] `pnpm test` passes
  - [ ] Effect patterns used (no try/catch)
  - [ ] B constant pattern followed
  ```

- [ ] **I2.2** Add agent context parser utility in workflow
- [ ] **I2.3** Create PR labeler based on AGENT_CONTEXT.type

### I3: Semantic Commit Convention

- [ ] **I3.1** Create `.github/workflows/semantic-commits.yml`:
  ```yaml
  - uses: amannn/action-semantic-pull-request@v5
    with:
      types: |
        feat
        fix
        refactor
        style
        docs
        deps
        test
        chore
  ```
- [ ] **I3.2** Add commit-msg hook to `lefthook.yml` for local validation

---

## Context Layer

*Nx graph extraction, TypeDoc context, and agent query interfaces*

### C1: Context Generation Script

- [ ] **C1.1** Create `tools/generate-context/index.ts`:
  ```typescript
  import { Effect, pipe } from 'effect';

  const generateProjectMap = pipe(
    readNxGraph(),
    Effect.flatMap(parseProjectDependencies),
    Effect.flatMap(extractPublicApis),
    Effect.flatMap(writeProjectMap)
  );
  ```

- [ ] **C1.2** Create `tools/generate-context/nx-graph.ts`:
  - Execute `nx graph --file=.nx/graph.json`
  - Parse nodes and edges
  - Detect circular dependencies

- [ ] **C1.3** Create `tools/generate-context/public-api.ts`:
  - Parse package.json exports
  - Extract TypeScript public types
  - Generate API surface map

- [ ] **C1.4** Create `tools/generate-context/schema.ts`:
  - Define `ProjectMapSchema` with Effect Schema
  - Validate output structure

### C2: Project Map Output

- [ ] **C2.1** Create `docs/agent-context/` directory
- [ ] **C2.2** Generate `docs/agent-context/project-map.json`
- [ ] **C2.3** Create `docs/agent-context/project-map.schema.json`
- [ ] **C2.4** Add `.gitignore` entry: `docs/agent-context/*.json` (generated)

### C3: CI Integration

- [ ] **C3.1** Update `ci.yml` to generate and upload context:
  ```yaml
  - name: Generate Agent Context
    run: pnpm generate:context

  - name: Upload Context Artifact
    uses: actions/upload-artifact@v4
    with:
      name: agent-context
      path: docs/agent-context/project-map.json
  ```

- [ ] **C3.2** Add `generate:context` script to root `package.json`
- [ ] **C3.3** Cache context generation with Nx

### C4: Agent Query Protocol

- [ ] **C4.1** Document context query patterns in `docs/agent-context/README.md`
- [ ] **C4.2** Add jq examples for CLI-based agents
- [ ] **C4.3** Create TypeScript query utilities for workflow scripts

---

## CI/CD Layer

*Renovate grouping, Biome auto-fix, and quality gates*

### D1: Renovate Domain Grouping

- [ ] **D1.1** Update `renovate.json` with agentic grouping:
  ```json
  {
    "packageRules": [
      {
        "groupName": "effect-ecosystem",
        "matchPackagePatterns": ["^effect$", "^@effect/"],
        "automerge": false,
        "labels": ["dependencies", "effect"],
        "schedule": ["before 6am on monday"]
      },
      {
        "groupName": "vite-ecosystem",
        "matchPackagePatterns": ["^vite", "^vitest", "^@vitejs/", "^@vitest/"],
        "automerge": true,
        "automergeType": "pr",
        "requiredStatusChecks": ["ci"]
      },
      {
        "groupName": "nx-ecosystem",
        "matchPackagePatterns": ["^nx$", "^@nx/"],
        "automerge": false,
        "labels": ["dependencies", "nx"]
      },
      {
        "groupName": "react-ecosystem",
        "matchPackagePatterns": ["^react", "^@types/react"],
        "automerge": false,
        "labels": ["dependencies", "react"]
      }
    ]
  }
  ```

- [ ] **D1.2** Add Stryker mutation gate for auto-merge:
  ```json
  {
    "matchPackagePatterns": ["*"],
    "automerge": true,
    "requiredStatusChecks": ["ci", "mutation-score"]
  }
  ```

- [ ] **D1.3** Configure vulnerability alert handling

### D2: Renovate Auto-Merge Workflow

- [ ] **D2.1** Create `.github/workflows/renovate-automerge.yml`:
  ```yaml
  name: Renovate Auto-Merge Gate
  on:
    pull_request:
      branches: [main]

  jobs:
    gate:
      if: contains(github.head_ref, 'renovate/')
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - run: pnpm install
        - run: pnpm test
        - run: |
            SCORE=$(pnpm mutate --json | jq '.mutationScore')
            if (( $(echo "$SCORE < 80" | bc -l) )); then
              echo "Mutation score $SCORE below threshold"
              exit 1
            fi
  ```

- [ ] **D2.2** Add mutation score badge to README
- [ ] **D2.3** Configure branch protection for auto-merge

### D3: Biome Repair Protocol

- [ ] **D3.1** Create `.github/workflows/biome-repair.yml`:
  ```yaml
  name: Biome Auto-Repair
  on:
    pull_request:
      types: [opened, synchronize]

  jobs:
    repair:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            token: ${{ secrets.GITHUB_TOKEN }}
            ref: ${{ github.head_ref }}

        - run: pnpm install
        - run: pnpm biome check --write --unsafe .

        - name: Commit repairs
          run: |
            git config user.name "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git add -A
            git diff --staged --quiet || git commit -m "style: biome auto-repair"
            git push
  ```

- [ ] **D3.2** Add `--unsafe` justification to docs
- [ ] **D3.3** Configure skip conditions for trusted branches

### D4: Enhanced CI Pipeline

- [ ] **D4.1** Update `ci.yml` with Nx graph artifact:
  ```yaml
  - name: Generate Nx Graph
    run: nx graph --file=.nx/project-graph.json

  - name: Upload Graph
    uses: actions/upload-artifact@v4
    with:
      name: nx-graph
      path: .nx/project-graph.json
  ```

- [ ] **D4.2** Add job summary with affected projects
- [ ] **D4.3** Enable parallel test execution across packages
- [ ] **D4.4** Add bundle size tracking with fail threshold

### D5: PR Review Aggregator

- [ ] **D5.1** Create `.github/workflows/pr-review-aggregator.yml`:
  ```yaml
  name: PR Review Aggregator
  on:
    pull_request_review:
      types: [submitted]

  jobs:
    aggregate:
      runs-on: ubuntu-latest
      steps:
        - name: Collect Reviews
          uses: actions/github-script@v7
          with:
            script: |
              const reviews = await github.rest.pulls.listReviews({
                owner: context.repo.owner,
                repo: context.repo.repo,
                pull_number: context.issue.number
              });
              // Aggregate and post summary
  ```

- [ ] **D5.2** Integrate Claude review synthesis
- [ ] **D5.3** Add review state machine (pending → approved → merged)

### D6: Issue Lifecycle Automation

- [ ] **D6.1** Create `.github/workflows/issue-lifecycle.yml`:
  ```yaml
  name: Issue Lifecycle
  on:
    issues:
      types: [opened, labeled]
    issue_comment:
      types: [created]

  jobs:
    triage:
      runs-on: ubuntu-latest
      steps:
        - name: Parse AGENT_CONTEXT
          id: context
          run: |
            # Extract JSON from issue body

        - name: Auto-label
          uses: actions/github-script@v7
  ```

- [ ] **D6.2** Add stale issue handling
- [ ] **D6.3** Create issue→PR linking automation

---

## Validation Checklist

### Pre-Deployment

- [ ] All `P*` tasks complete (Protocol Layer)
- [ ] All `I*` tasks complete (Interface Layer)
- [ ] All `C*` tasks complete (Context Layer)
- [ ] All `D*` tasks complete (CI/CD Layer)

### Integration Tests

- [ ] Create test issue with AGENT_CONTEXT hook
- [ ] Verify context parsing in workflow logs
- [ ] Run `pnpm generate:context` and validate output
- [ ] Submit test PR with Biome violations, verify auto-repair
- [ ] Trigger Renovate update, verify domain grouping

### Documentation

- [ ] Update README with agentic workflow badges
- [ ] Document agent selection algorithm
- [ ] Create troubleshooting guide for workflow failures

---

## Priority Order

| Phase | Layer | Task Groups | Effort |
|-------|-------|-------------|--------|
| 1 | Context | C1, C2, C3 | Medium |
| 2 | Interface | I1, I2 | Low |
| 3 | CI/CD | D1, D3, D4 | Medium |
| 4 | Protocol | P1, P2 | Medium |
| 5 | CI/CD | D2, D5, D6 | High |
| 6 | Protocol | P3, P4 | Low |
| 7 | Interface | I3 | Low |
| 8 | Context | C4 | Low |

---

## Definition of Done

Each task is complete when:

1. **Code Changes:** Committed to feature branch
2. **Tests:** Existing tests pass, new tests added where applicable
3. **Documentation:** Inline comments, README updates if user-facing
4. **Validation:** Manual verification in PR description
5. **Review:** Approved by code owner or passing CI

---

*Generated: 2025-11-26 | Execution Model: Claude Code CLI | Session: claude/agentic-systems-plan*
