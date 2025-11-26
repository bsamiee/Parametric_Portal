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
    - Execute `nx graph --file=.nx/graph.json` (intermediate, not uploaded)
    - Parse project dependencies from `.nx/graph.json`
    - Extract public APIs from package.json exports
    - Output processed context to `docs/agent-context/project-map.json` (single source of truth for agents)
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
  <action>Add automation scripts</action>
  <additions>
    "generate:context": "tsx tools/generate-context/index.ts",
    "parse:context": "tsx tools/parse-agent-context.ts",
    "labels:create": "bash scripts/create-labels.sh",
    "sync:protocols": "tsx tools/sync-agent-protocols.ts"
  </additions>
</task>

<task id="1.5">
  <file>tools/parse-agent-context.ts</file>
  <action>Create Effect-based AGENT_CONTEXT parser</action>
  <spec>
    - Export: parseAgentContext(body: string): Effect.Effect<AgentContext, never, never>
    - Pattern: /<!-- AGENT_CONTEXT\n([\s\S]*?)\n-->/
    - Use Option.fromNullable + Schema.decodeUnknown
    - Return DEFAULT_CONTEXT when missing/invalid
    - CLI mode: accept body via stdin, output JSON
  </spec>
  <pattern>Effect pipeline, Option monad</pattern>
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
      - name: Request Claude Implementation
        url: https://github.com/bsamiee/Parametric_Portal/issues/new?labels=claude-implement
  </content>
</task>

<task id="2.2">
  <file>.github/ISSUE_TEMPLATE/bug_report.yml</file>
  <action>Create form-based bug template with AGENT_CONTEXT</action>
  <spec>
    - Embed: <!-- AGENT_CONTEXT {"type":"bug","agents":["testing-specialist","typescript-advanced"]} -->
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
    - claude-implement: (manual label, not path-based)
  </spec>
  <note>Content-based detection (e.g., tech/effect) requires custom scripting in auto-labeler.yml, not actions/labeler</note>
</task>

<task id="2.6">
  <file>scripts/create-labels.sh</file>
  <action>Create idempotent label creation script</action>
  <spec>
    - Use: gh label create "name" --color "hex" --description "desc" --force
    - Categories:
      - type/: bug, feature, enhancement, docs, refactor, test, chore (7)
      - priority/: critical, high, medium, low (4)
      - scope/: ui, api, config, deps, perf, security, ci, docs, tests, types (10)
      - effort/: trivial, small, medium, large (4)
      - tech/: react, effect, vite (3)
      - size/: XS, S, M, L, XL (5)
      - special: claude-implement, dashboard, stale, tech-debt, needs-triage, in-progress, pinned, security, automerge, renovate-blocked, good-first-issue, help-wanted (12)
    - Total: 45 labels
    - Exit 0 always (idempotent, --force handles existing)
  </spec>
</task>

<task id="2.7">
  <file>package.json</file>
  <action>Verify labels:create script exists (added in Task 1.4)</action>
  <validate>pnpm labels:create runs without error</validate>
</task>

---

## Phase 3: Core Workflows

<task id="3.1" priority="critical">
  <file>.github/workflows/pr-review-aggregator.yml</file>
  <action>Create unified AI review synthesis workflow with /summarize command</action>
  <triggers>
    - workflow_run (ci, claude-code-review)
    - pull_request_review
    - issue_comment [created] (for /summarize command)
  </triggers>
  <spec>
    - Parse /summarize command from issue_comment.body
    - Filter: only on PRs (github.event.issue.pull_request exists)
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
  </spec>
  <concurrency>group: pr-aggregator-${{ github.event.pull_request.number || github.event.issue.number }}, cancel-in-progress: true</concurrency>
  <permissions>contents:read, pull-requests:write, checks:read</permissions>
  <model>claude-sonnet-4-5-20250929</model>
</task>

<task id="3.2">
  <file>.github/workflows/auto-labeler.yml</file>
  <action>Create path-based + AI classification labeler with /triage command</action>
  <triggers>
    - pull_request [opened, synchronize]
    - issues [opened, edited]
    - issue_comment [created] (for /triage command)
  </triggers>
  <spec>
    - Parse /triage command from issue_comment.body
    - PR: Apply path labels via actions/labeler, size labels (XS/S/M/L/XL)
    - PR: Apply tech labels based on file content analysis:
      - *.tsx files → tech/react
      - Effect. or pipe( in diff → tech/effect
      - vite.config.* files → tech/vite
    - Issues: Claude classifies → type/*, priority/*, scope/*, effort/*
    - Conservative: only apply confident labels
    - Welcome first-time contributors with actions/first-interaction
  </spec>
  <concurrency>group: auto-labeler-${{ github.event.pull_request.number || github.event.issue.number }}, cancel-in-progress: true</concurrency>
  <model>claude-sonnet-4-5-20250929</model>
</task>

<task id="3.3">
  <file>.github/workflows/issue-lifecycle.yml</file>
  <action>Create comprehensive issue management workflow</action>
  <triggers>issues [opened, labeled], issue_comment, schedule (daily)</triggers>
  <spec>
    - Parse AGENT_CONTEXT from issue body (use tools/parse-agent-context.ts)
    - Auto-label based on context
    - Stale: 30 days → stale label, 44 days → close
    - Exempt: pinned, security, priority/critical, claude-implement, in-progress
    - Validate: check empty body, title length, suggest format for bugs
    - Aging report in step summary
  </spec>
  <concurrency>group: issue-lifecycle-${{ github.event.issue.number || 'scheduled' }}, cancel-in-progress: false</concurrency>
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
    - Exemptions: *.config.ts (default exports allowed), *.spec.ts/*.test.ts (test utilities), plugins/* (side effects)
    - Output structured review with compliance table
    - Trigger pr-review-aggregator after completion
  </spec>
  <concurrency>group: claude-review-${{ github.event.pull_request.number }}, cancel-in-progress: true</concurrency>
  <model>claude-opus-4-5-20251101</model>
</task>

---

## Phase 4: Dependency Management

<task id="4.1">
  <file>renovate.json</file>
  <action>Enhance existing config with automerge settings</action>
  <merge>true</merge>
  <note>Existing groups (effect-ecosystem, vite-ecosystem, types, github-actions, react-canary, nx-canary) already defined. Modify, don't duplicate.</note>
  <additions>
    {
      "platformAutomerge": true,
      "automergeType": "pr",
      "automergeStrategy": "squash",
      "dependencyDashboard": true,
      "dependencyDashboardTitle": "Dependency Dashboard",
      "osvVulnerabilityAlerts": true,
      "postUpdateOptions": ["pnpmDedupe"]
    }
  </additions>
  <modifications>
    - effect-ecosystem: add "schedule": ["before 6am on Monday"]
    - vite-ecosystem: add "automerge": true, "matchUpdateTypes": ["minor", "patch"]
    - types: add "excludePackagePatterns": ["^@types/react"]
  </modifications>
  <new-group>
    {
      "description": "Group React ecosystem (prevents version mismatches)",
      "groupName": "react-ecosystem",
      "matchPackageNames": ["react", "react-dom", "@types/react", "@types/react-dom"],
      "matchCurrentVersion": "!/canary|beta|rc/",
      "automerge": true,
      "matchUpdateTypes": ["minor", "patch"]
    }
  </new-group>
  <note>react-canary already groups canary/beta/rc versions; this new group handles stable releases</note>
</task>

<task id="4.2">
  <file>nx.json</file>
  <action>Enable incremental mutation testing via CLI flag</action>
  <change>Update mutate target: add "--incremental" to stryker command</change>
  <rationale>Speed up Renovate gate by only mutating changed files; --incremental is CLI flag, not config option</rationale>
</task>

<task id="4.3">
  <file>.github/workflows/renovate-automerge.yml</file>
  <action>Create mutation-gated auto-merge workflow</action>
  <triggers>pull_request, check_suite completed, schedule (every 4 hours)</triggers>
  <prerequisite>Branch protection must allow auto-merge; mutation-score check must be required status</prerequisite>
  <spec>
    - Filter: author is renovate[bot]
    - Classify: patch/minor (eligible) vs major/canary (blocked)
    - Gate: all checks green + mutation score >= 80%
    - Auto-merge eligible PRs via gh pr merge --squash --auto (requires branch protection allowing auto-merge)
    - Blocked: add renovate-blocked label, comment with concerns
    - For majors: create/update migration campaign issue:
      - Title: "Migration: {package} v{from} → v{to}"
      - Labels: dependencies, migration, priority/high
      - Body: scope (affected packages), breaking changes, migration steps checklist, linked Renovate PR
  </spec>
  <concurrency>group: renovate-automerge-${{ github.event.pull_request.number || 'scheduled' }}, cancel-in-progress: false</concurrency>
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
    - Run: pnpm test (verify --unsafe didn't break semantics)
    - If tests pass AND changes exist: commit "style: biome auto-repair", push
    - If tests fail: skip commit, add comment warning of semantic breakage
    - Skip for: main branch, bot authors (except renovate)
  </spec>
  <concurrency>group: biome-repair-${{ github.event.pull_request.number }}, cancel-in-progress: true</concurrency>
  <rationale>Zero style noise in human PR reviews; --unsafe requires test validation</rationale>
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
  <concurrency>group: semantic-commits-${{ github.event.pull_request.number }}, cancel-in-progress: true</concurrency>
</task>

<task id="5.3">
  <file>lefthook.yml</file>
  <action>Add Effect pattern validation hook</action>
  <merge>true</merge>
  <additions>
    effect-check:
      glob: "*.{ts,tsx}"
      run: |
        # Use word boundary for better matching (catches "if (x) try {")
        # Exclude comments via grep -v
        if grep -E "\btry\s*\{" {staged_files} | grep -v "^\s*//" | grep -v "^\s*\*"; then
          echo "[ERROR] try/catch detected. Use Effect.try, Effect.tryPromise, or Effect.gen"
          exit 1
        fi
  </additions>
  <limitation>Grep-based detection has false positives in strings/comments; document known edge cases in AUTOMATION.md</limitation>
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
        nx show projects --affected --json | jq -r '.[] | "- " + .' >> $GITHUB_STEP_SUMMARY
  </additions>
</task>

<task id="5.5" priority="high">
  <file>.github/workflows/ci.yml</file>
  <action>Add quality debt issue creation on job failure</action>
  <merge>true</merge>
  <spec>
    - On job failure, determine failure type based on failed step:
      - Stryker/mutation failure → "Mutation Debt: {affected projects}"
      - Lint/typecheck failure → "Quality Debt: {affected paths}"
      - Compression/PWA failure → "Performance Debt: {target}"
    - Search for existing debt issue by title pattern
    - Create or update issue with:
      - Failure details and affected projects/paths
      - Checklist of files/areas to address
      - Link to failed CI run
    - Labels per type: tech-debt + (testing|refactor|performance)
    - One issue per category (update existing, avoid spam)
  </spec>
  <permissions>issues: write</permissions>
  <additions>
    - name: Create Quality Debt Issue
      if: failure()
      uses: actions/github-script@v7
      with:
        script: |
          const stepName = '${{ github.job }}';
          const debtType = stepName.includes('mutate') ? 'Mutation' :
                          stepName.includes('check') ? 'Quality' : 'Performance';
          const title = `${debtType} Debt: CI Failure`;
          const labels = ['tech-debt', debtType === 'Mutation' ? 'testing' :
                         debtType === 'Quality' ? 'refactor' : 'performance'];
          const { data: issues } = await github.rest.issues.listForRepo({
            owner: context.repo.owner, repo: context.repo.repo,
            labels: labels.join(','), state: 'open'
          });
          const existing = issues.find(i => i.title.startsWith(debtType));
          const body = `## CI Failure\n- Run: ${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}\n- Job: ${stepName}`;
          existing
            ? await github.rest.issues.update({ ...context.repo, issue_number: existing.number, body: existing.body + '\n\n' + body })
            : await github.rest.issues.create({ ...context.repo, title, labels, body });
  </additions>
</task>

---

## Phase 6: Dashboard

<task id="6.1">
  <file>.github/workflows/dashboard.yml</file>
  <action>Create auto-updating repo health dashboard with /health command</action>
  <triggers>
    - schedule (every 6 hours)
    - workflow_dispatch
    - push to main
    - issue_comment [created] (for /health command on dashboard issue)
  </triggers>
  <spec>
    - Parse /health command from issue_comment.body
    - Only respond when commented on issue with label: dashboard
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
  <concurrency>group: dashboard, cancel-in-progress: false</concurrency>
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
    - Claude-enhanced release notes summarizing impact
  </spec>
  <concurrency>group: release, cancel-in-progress: false</concurrency>
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
  <concurrency>group: bundle-${{ github.event.pull_request.number }}, cancel-in-progress: true</concurrency>
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
  <concurrency>group: security-${{ github.event.pull_request.number || github.ref }}, cancel-in-progress: true</concurrency>
</task>

---

## Phase 8: Documentation

<task id="8.1">
  <file>docs/AUTOMATION.md</file>
  <action>Create automation reference documentation</action>
  <sections>
    - AI Agents table: name, role, trigger, model
    - Workflow overview with ASCII diagram
    - Slash Commands: /summarize, /triage, /health usage and examples
    - PR Lifecycle explanation
    - Issue Management explanation
    - Dependency Management explanation
    - Dashboard explanation
    - Labels quick reference (45 labels by category)
    - Lefthook effect-check limitations and edge cases
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
  <action>Create REQUIREMENTS.md → derivative docs sync script</action>
  <spec>
    - Read REQUIREMENTS.md as SSoT
    - Extract sections by markdown H2 headers: ## Stack, ## Dogmatic Rules, ## Agent Matrix, ## Quality Targets
    - Generate: AGENTS.md (root), .github/copilot-instructions.md, CLAUDE.md (root)
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
  <concurrency>group: validate-protocols-${{ github.event.pull_request.number }}, cancel-in-progress: true</concurrency>
  <note>sync:protocols script added in Task 1.4</note>
</task>

---

## Verification Checklist

<verification>
  <check id="v1">All workflows pass YAML syntax validation</check>
  <check id="v2">nx affected -t check,typecheck,test passes</check>
  <check id="v3">All labels created via pnpm labels:create (45 labels)</check>
  <check id="v4">project-map.json generates successfully via pnpm generate:context</check>
  <check id="v5">Biome repair workflow doesn't break tests</check>
  <check id="v6">Dashboard issue created and populated</check>
  <check id="v7">No new secrets required</check>
  <check id="v8">Existing workflows unchanged except where specified</check>
  <check id="v9">Slash commands (/summarize, /triage, /health) functional</check>
  <check id="v10">Quality debt issues created on CI failure</check>
  <check id="v11">All workflows have concurrency groups</check>
  <check id="v12">First-time contributors receive welcome message</check>
</verification>

---

## File Inventory

<inventory>
  <category name="workflows" count="12">
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
    .github/workflows/validate-protocols.yml
  </category>

  <category name="templates" count="4">
    .github/ISSUE_TEMPLATE/config.yml
    .github/ISSUE_TEMPLATE/bug_report.yml
    .github/ISSUE_TEMPLATE/feature_request.yml
    .github/PULL_REQUEST_TEMPLATE.md
  </category>

  <category name="config" count="4">
    .github/labeler.yml
    renovate.json (merge)
    nx.json (add --incremental to mutate target)
    lefthook.yml (merge)
  </category>

  <category name="tools" count="4">
    tools/generate-context/index.ts
    tools/generate-context/schema.ts
    tools/parse-agent-context.ts
    tools/sync-agent-protocols.ts
  </category>

  <category name="scripts" count="1">
    scripts/create-labels.sh
  </category>

  <category name="docs" count="4">
    docs/agent-context/project-map.json
    docs/agent-context/README.md
    docs/AUTOMATION.md
    docs/INTEGRATIONS.md
  </category>

  <category name="modified" count="2">
    ci.yml (extend with context gen + quality debt)
    package.json (add 4 scripts)
  </category>
</inventory>

---

## Commit Strategy

<commits>
  <commit phase="1">feat(tools): add agent context generation with Nx graph extraction and parser</commit>
  <commit phase="2.1">feat(github): add semantic issue and PR templates with AGENT_CONTEXT hooks</commit>
  <commit phase="2.2">chore(github): add label creation script (45 labels)</commit>
  <commit phase="3">feat(ci): add PR review aggregator and issue lifecycle workflows with slash commands</commit>
  <commit phase="4">feat(deps): enhance Renovate config with domain grouping and auto-merge gate</commit>
  <commit phase="5">feat(ci): add Biome auto-repair, semantic commits, and quality debt tracking</commit>
  <commit phase="6">feat(ci): add repository dashboard workflow with /health command</commit>
  <commit phase="7">feat(ci): add release, bundle analysis, and security workflows</commit>
  <commit phase="8">docs: add automation and integrations documentation</commit>
  <commit phase="9">feat(tools): add protocol sync with drift validation</commit>
</commits>

---

*End of TASK_FINAL.md*
