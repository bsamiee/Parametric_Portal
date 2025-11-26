# TASK_FINAL.md - Agentic Systems Implementation

<agent-directive>
  <role>Principal Agentic Systems Architect</role>
  <model>claude-opus-4-5-20251101</model>
  <max-turns>50</max-turns>
  <objective>Implement self-describing agentic automation for Parametric Portal monorepo</objective>
</agent-directive>

<constraints>
  <rule id="1">Preserve existing CI, Claude, Lefthook, Stryker behavior</rule>
  <rule id="2">Read configs before modifying: nx.json, package.json, existing workflows</rule>
  <rule id="3">Use existing secrets only: CLAUDE_CODE_OAUTH_TOKEN, GITHUB_TOKEN</rule>
  <rule id="4">No new external dependencies or vendors</rule>
  <rule id="5">All TypeScript must follow REQUIREMENTS.md patterns (Effect, Option, no any)</rule>
  <rule id="6">Use pnpm exclusively; use gh CLI for GitHub operations</rule>
  <rule id="7">Pin action versions with SHA for third-party, tag for first-party</rule>
  <rule id="8">Validate: run nx affected -t check,typecheck,test after changes</rule>
</constraints>

---

## Phase 1: Foundation - Context Generation

<task id="1.1" priority="critical">
  <file>tools/generate-context/index.ts</file>
  <action>Create Nx graph extraction script using Effect patterns</action>
  <spec>
    - Execute `nx graph --file=.nx/graph.json`
    - Parse project dependencies from graph
    - Extract public APIs from package.json exports
    - Output to `docs/agent-context/project-map.json`
  </spec>
  <pattern>Effect pipeline, no try/catch</pattern>
</task>

<task id="1.2">
  <file>tools/generate-context/schema.ts</file>
  <action>Define ProjectMapSchema with @effect/schema</action>
  <spec>
    - workspace: { root, packageManager, nxVersion }
    - projects: Record<name, { root, sourceRoot, dependencies, exports, publicApi }>
    - graph: { nodes, edges, cycles }
    - imports: path alias mappings
  </spec>
</task>

<task id="1.3">
  <file>docs/agent-context/project-map.json</file>
  <action>Generate initial project map</action>
  <validate>JSON schema validates, all packages represented</validate>
</task>

<task id="1.4">
  <file>package.json</file>
  <action>Add script: "generate:context": "tsx tools/generate-context/index.ts"</action>
</task>

---

## Phase 2: Templates - Semantic Interfaces

<task id="2.1">
  <file>.github/ISSUE_TEMPLATE/config.yml</file>
  <action>Create template configuration</action>
  <content>
    blank_issues_enabled: false
    contact_links:
      - name: Documentation
        url: https://github.com/bsamiee/Parametric_Portal/wiki
      - name: Ask Claude
        url: https://github.com/bsamiee/Parametric_Portal/issues/new?labels=claude-implement
  </content>
</task>

<task id="2.2">
  <file>.github/ISSUE_TEMPLATE/bug_report.yml</file>
  <action>Create form-based bug template with AGENT_CONTEXT</action>
  <spec>
    - Embed: <!-- AGENT_CONTEXT {"type":"bug","agents":["testing-specialist"]} -->
    - Fields: description, repro steps, expected, actual, severity dropdown, environment, logs
    - Default labels: type/bug, needs-triage
    - Require: searched existing issues checkbox
  </spec>
</task>

<task id="2.3">
  <file>.github/ISSUE_TEMPLATE/feature_request.yml</file>
  <action>Create form-based feature template with AGENT_CONTEXT</action>
  <spec>
    - Embed: <!-- AGENT_CONTEXT {"type":"feature","agents":["library-planner","typescript-advanced"]} -->
    - Fields: problem, solution, alternatives, scope dropdown (multi), effort dropdown, acceptance criteria
    - Checkboxes: Effect pipeline, Option monad, Branded types, Dispatch table
    - Default labels: type/feature, needs-triage
  </spec>
</task>

<task id="2.4">
  <file>.github/PULL_REQUEST_TEMPLATE.md</file>
  <action>Create PR template with AGENT_CONTEXT hook</action>
  <content>
    <!-- AGENT_CONTEXT
    {"type":"implementation","scope":[],"breaking":false,"patterns_applied":[],"test_coverage":"required"}
    -->
    <!-- @claude Please review against REQUIREMENTS.md patterns -->

    ## Summary

    ## Type
    - [ ] Feature / [ ] Bug fix / [ ] Refactor / [ ] Docs / [ ] Dependencies

    ## Related Issues
    Fixes #

    ## Checklist
    - [ ] pnpm check passes
    - [ ] pnpm typecheck passes
    - [ ] pnpm test passes
    - [ ] Effect patterns used (no try/catch)
    - [ ] B constant pattern followed
    - [ ] Tests added/updated
  </content>
</task>

<task id="2.5">
  <file>.github/labeler.yml</file>
  <action>Create path-to-label mappings</action>
  <spec>
    - pkg/components: packages/components/**
    - pkg/theme: packages/theme/**
    - pkg/types: packages/types/**
    - scope/config: *.json, *.yaml, *.yml, .github/**
    - scope/ci: .github/workflows/**
    - scope/deps: package.json, pnpm-lock.yaml, pnpm-workspace.yaml
    - scope/docs: **/*.md, docs/**
    - scope/tests: **/*.spec.ts, **/*.test.ts, vitest.config.*
    - scope/ui: **/*.tsx, **/components/**
    - tech/effect: files importing 'effect'
  </spec>
</task>

---

## Phase 3: Core Workflows

<task id="3.1" priority="critical">
  <file>.github/workflows/pr-review-aggregator.yml</file>
  <action>Create unified AI review synthesis workflow</action>
  <triggers>workflow_run (ci, claude-code-review), pull_request_review</triggers>
  <spec>
    - Collect reviews from: claude[bot], copilot[bot], github-actions[bot], humans
    - Collect all check run statuses
    - Use Claude to synthesize into structured summary:
      ## Overall Assessment
      - Risk: LOW|MEDIUM|HIGH
      - Merge readiness: BLOCKED|CAUTION|SAFE
      ## Required Actions (blocking)
      ## Quality Signals (CI, tests, mutation)
      ## Nits (non-blocking)
      ## Agent Provenance
    - Post/update comment with marker: <!-- PR-AGGREGATOR-SUMMARY -->
    - Use concurrency group per PR
  </spec>
  <permissions>contents:read, pull-requests:write, checks:read</permissions>
  <model>claude-sonnet-4-5-20250929</model>
</task>

<task id="3.2">
  <file>.github/workflows/auto-labeler.yml</file>
  <action>Create path-based + AI classification labeler</action>
  <triggers>pull_request [opened, synchronize], issues [opened, edited]</triggers>
  <spec>
    - PR: Apply path labels via actions/labeler, size labels (XS/S/M/L/XL)
    - Issues: Claude classifies → type/*, priority/*, scope/*, effort/*
    - Conservative: only apply confident labels
    - Welcome first-time contributors
  </spec>
  <model>claude-sonnet-4-5-20250929</model>
</task>

<task id="3.3">
  <file>.github/workflows/issue-lifecycle.yml</file>
  <action>Create comprehensive issue management workflow</action>
  <triggers>issues [opened, labeled], issue_comment, schedule (daily)</triggers>
  <spec>
    - Parse AGENT_CONTEXT from issue body
    - Auto-label based on context
    - Stale: 30 days → stale label, 44 days → close
    - Exempt: pinned, security, priority/critical, claude-implement
    - Validate: check empty body, title length, suggest format for bugs
    - Aging report in step summary
  </spec>
</task>

<task id="3.4">
  <file>.github/workflows/claude-code-review-enhanced.yml</file>
  <action>Create REQUIREMENTS.md compliance reviewer</action>
  <triggers>pull_request (after CI completes)</triggers>
  <spec>
    - Wait for CI via workflow_run
    - Read REQUIREMENTS.md, collect CI status, other reviews
    - Check compliance:
      - no any, no var/let, no if/else, no loops, no try/catch
      - B constant pattern, dispatch tables
      - Effect.Effect<T,E,R>, Option.match
      - Section separators (77 chars) for >50 LOC files
    - Output structured review with compliance table
    - Trigger pr-review-aggregator after completion
  </spec>
  <model>claude-opus-4-5-20251101</model>
</task>

---

## Phase 4: Dependency Management

<task id="4.1">
  <file>renovate.json</file>
  <action>Enhance with domain grouping and automerge config</action>
  <merge>true</merge>
  <additions>
    {
      "platformAutomerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash",
      "dependencyDashboard": true,
      "dependencyDashboardTitle": "Dependency Dashboard",
      "osvVulnerabilityAlerts": true,
      "postUpdateOptions": ["pnpmDedupe"],
      "packageRules": [
        { "groupName": "effect-ecosystem", "matchPackagePatterns": ["^effect$", "^@effect/"], "automerge": false, "schedule": ["before 6am on monday"] },
        { "groupName": "vite-ecosystem", "matchPackagePatterns": ["^vite", "^vitest", "^@vitejs/", "^@vitest/"], "automerge": true, "matchUpdateTypes": ["minor", "patch"] },
        { "groupName": "nx-ecosystem", "matchPackagePatterns": ["^nx$", "^@nx/"], "automerge": false },
        { "groupName": "react-ecosystem", "matchPackagePatterns": ["^react", "^@types/react"], "automerge": false }
      ]
    }
  </additions>
</task>

<task id="4.2">
  <file>stryker.config.js</file>
  <action>Enable incremental mutation testing</action>
  <change>Add: incremental: true</change>
  <rationale>Speed up Renovate gate by only mutating changed files</rationale>
</task>

<task id="4.3">
  <file>.github/workflows/renovate-automerge.yml</file>
  <action>Create mutation-gated auto-merge workflow</action>
  <triggers>pull_request, check_suite completed, schedule (every 4 hours)</triggers>
  <spec>
    - Filter: author is renovate[bot]
    - Classify: patch/minor (eligible) vs major/canary (blocked)
    - Gate: all checks green + mutation score >= 80%
    - Auto-merge eligible PRs via gh pr merge --squash --auto
    - Blocked: add renovate-blocked label, comment with concerns
    - For majors: create/update migration campaign issue
  </spec>
</task>

---

## Phase 5: Quality Gates

<task id="5.1">
  <file>.github/workflows/biome-repair.yml</file>
  <action>Create auto-fix workflow for style issues</action>
  <triggers>pull_request [opened, synchronize]</triggers>
  <spec>
    - Checkout with token for push access
    - Run: pnpm biome check --write --unsafe .
    - If changes: commit "style: biome auto-repair", push
    - Skip for: main branch, bot authors (except renovate)
  </spec>
  <rationale>Zero style noise in human PR reviews</rationale>
</task>

<task id="5.2">
  <file>.github/workflows/semantic-commits.yml</file>
  <action>Enforce conventional commit format</action>
  <triggers>pull_request</triggers>
  <spec>
    - Use amannn/action-semantic-pull-request
    - Allowed types: feat, fix, refactor, style, docs, deps, test, chore
    - Require scope for feat/fix
  </spec>
</task>

<task id="5.3">
  <file>lefthook.yml</file>
  <action>Add Effect pattern validation hook</action>
  <merge>true</merge>
  <additions>
    effect-check:
      glob: "*.{ts,tsx}"
      run: |
        if grep -E "try\s*\{" {staged_files}; then
          echo "[ERROR] try/catch detected. Use Effect.tryPromise"
          exit 1
        fi
  </additions>
</task>

<task id="5.4">
  <file>.github/workflows/ci.yml</file>
  <action>Enhance with context generation and rich summaries</action>
  <merge>true</merge>
  <additions>
    - name: Generate Agent Context
      run: pnpm generate:context

    - name: Generate Nx Graph
      run: nx graph --file=.nx/project-graph.json

    - name: Upload Artifacts
      uses: actions/upload-artifact@v4
      with:
        name: agent-context
        path: |
          docs/agent-context/project-map.json
          .nx/project-graph.json

    - name: Job Summary
      run: |
        echo "## Affected Projects" >> $GITHUB_STEP_SUMMARY
        nx show projects --affected --json | jq -r '.[]' >> $GITHUB_STEP_SUMMARY
  </additions>
</task>

---

## Phase 6: Dashboard

<task id="6.1">
  <file>.github/workflows/dashboard.yml</file>
  <action>Create auto-updating repo health dashboard</action>
  <triggers>schedule (every 6 hours), workflow_dispatch, push to main</triggers>
  <spec>
    - Collect metrics:
      - Open PRs, merged in 7 days, stale PRs (>14 days)
      - Open issues by type (bugs, features, claude-ready)
      - Renovate PRs (open, merged in 7 days)
      - Commit activity, contributors (7 days)
      - Latest tag/release
      - Run pnpm typecheck && pnpm check for health status
    - Find/create issue with label "dashboard", title "Repository Dashboard"
    - Update body with structured dashboard:
      - Quick Stats table
      - Activity (7 days)
      - Pull Requests with links
      - Issues with links
      - Health Status badges
      - Workflows table
      - Timestamp
  </spec>
</task>

---

## Phase 7: Supporting Workflows

<task id="7.1">
  <file>.github/workflows/release.yml</file>
  <action>Create conventional commit release automation</action>
  <triggers>push to main (src paths), workflow_dispatch</triggers>
  <spec>
    - Analyze commits for release type (feat! → major, feat → minor, fix → patch)
    - Calculate new version from package.json
    - Generate changelog grouped by: Breaking, Features, Fixes, Refactoring, Docs
    - Create git tag and GitHub release
    - Optional: Claude-enhanced release notes
  </spec>
</task>

<task id="7.2">
  <file>.github/workflows/bundle-analysis.yml</file>
  <action>Create bundle size tracking workflow</action>
  <triggers>pull_request (source paths)</triggers>
  <spec>
    - Build all packages
    - Analyze bundle sizes (raw, gzip, brotli)
    - Compare with main (cached metrics)
    - Post/update PR comment with size report
    - Warn if significant increase (>10KB gzip)
  </spec>
</task>

<task id="7.3">
  <file>.github/workflows/security.yml</file>
  <action>Create security scanning workflow</action>
  <triggers>pull_request, push to main, schedule (weekly)</triggers>
  <spec>
    Jobs:
    - dependency-audit: pnpm audit
    - codeql: JavaScript/TypeScript analysis
    - secrets-scan: Gitleaks
    - license-check: copyleft detection
    Create security issue if critical vulnerabilities found
  </spec>
</task>

---

## Phase 8: Documentation

<task id="8.1">
  <file>docs/AUTOMATION.md</file>
  <action>Create automation reference documentation</action>
  <sections>
    - AI Agents table: name, role, trigger, model
    - Workflow overview with ASCII diagram
    - PR Lifecycle explanation
    - Issue Management explanation
    - Dependency Management explanation
    - Dashboard explanation
    - Labels quick reference
    - Commands quick reference (/triage, /summarize)
  </sections>
</task>

<task id="8.2">
  <file>docs/INTEGRATIONS.md</file>
  <action>Create integrations guide</action>
  <sections>
    - GitHub Apps recommendations (Codecov, Socket.dev, Snyk)
    - Branch protection configuration
    - CODEOWNERS template
    - README badges
    - Cost considerations
  </sections>
</task>

<task id="8.3">
  <file>docs/agent-context/README.md</file>
  <action>Document agent query protocol</action>
  <content>
    - project-map.json schema explanation
    - jq query examples for CLI agents
    - TypeScript query utilities
    - Update frequency and freshness guarantees
  </content>
</task>

---

## Phase 9: Protocol Sync

<task id="9.1">
  <file>tools/sync-agent-protocols.ts</file>
  <action>Create REQUIREMENTS.md → derivatives sync script</action>
  <spec>
    - Read REQUIREMENTS.md as SSoT
    - Extract sections: stack-versions, dogmatic-rules, agent-matrix, quality-targets
    - Generate: AGENTS.md, copilot-instructions.md, CLAUDE.md
    - Compute SHA256 hash, embed as <!-- SYNC_HASH: xxx -->
    - Dry-run mode for CI validation
  </spec>
  <pattern>Effect pipeline</pattern>
</task>

<task id="9.2">
  <file>.github/workflows/validate-protocols.yml</file>
  <action>Create protocol drift validation</action>
  <triggers>pull_request (*.md in root, .github/)</triggers>
  <spec>
    - Run tools/sync-agent-protocols.ts --dry-run
    - Fail if generated files differ from committed
    - Suggest: "Run pnpm sync:protocols to fix"
  </spec>
</task>

<task id="9.3">
  <file>package.json</file>
  <action>Add script: "sync:protocols": "tsx tools/sync-agent-protocols.ts"</action>
</task>

---

## Verification Checklist

<verification>
  <check id="v1">All workflows pass YAML syntax validation</check>
  <check id="v2">nx affected -t check,typecheck,test passes</check>
  <check id="v3">All referenced labels exist (create with gh label create)</check>
  <check id="v4">project-map.json generates successfully</check>
  <check id="v5">Biome repair workflow doesn't break tests</check>
  <check id="v6">Dashboard issue created and populated</check>
  <check id="v7">No new secrets required</check>
  <check id="v8">Existing workflows unchanged except where specified</check>
</verification>

---

## File Inventory

<inventory>
  <category name="workflows" count="11">
    .github/workflows/pr-review-aggregator.yml
    .github/workflows/auto-labeler.yml
    .github/workflows/issue-lifecycle.yml
    .github/workflows/claude-code-review-enhanced.yml
    .github/workflows/renovate-automerge.yml
    .github/workflows/biome-repair.yml
    .github/workflows/semantic-commits.yml
    .github/workflows/dashboard.yml
    .github/workflows/release.yml
    .github/workflows/bundle-analysis.yml
    .github/workflows/security.yml
  </category>

  <category name="templates" count="4">
    .github/ISSUE_TEMPLATE/config.yml
    .github/ISSUE_TEMPLATE/bug_report.yml
    .github/ISSUE_TEMPLATE/feature_request.yml
    .github/PULL_REQUEST_TEMPLATE.md
  </category>

  <category name="config" count="3">
    .github/labeler.yml
    renovate.json (merge)
    stryker.config.js (modify)
    lefthook.yml (merge)
  </category>

  <category name="tools" count="3">
    tools/generate-context/index.ts
    tools/generate-context/schema.ts
    tools/sync-agent-protocols.ts
  </category>

  <category name="docs" count="4">
    docs/agent-context/project-map.json
    docs/agent-context/README.md
    docs/AUTOMATION.md
    docs/INTEGRATIONS.md
  </category>

  <category name="modified" count="2">
    ci.yml (extend)
    package.json (add scripts)
  </category>
</inventory>

---

## Commit Strategy

<commits>
  <commit phase="1">feat(tools): add agent context generation with Nx graph extraction</commit>
  <commit phase="2">feat(github): add semantic issue and PR templates with AGENT_CONTEXT hooks</commit>
  <commit phase="3">feat(ci): add PR review aggregator and issue lifecycle workflows</commit>
  <commit phase="4">feat(deps): enhance Renovate config with domain grouping and auto-merge gate</commit>
  <commit phase="5">feat(ci): add Biome auto-repair and semantic commit enforcement</commit>
  <commit phase="6">feat(ci): add repository dashboard workflow</commit>
  <commit phase="7">feat(ci): add release, bundle analysis, and security workflows</commit>
  <commit phase="8">docs: add automation and integrations documentation</commit>
  <commit phase="9">feat(tools): add protocol sync with drift validation</commit>
</commits>

---

*End of TASK_FINAL.md*
