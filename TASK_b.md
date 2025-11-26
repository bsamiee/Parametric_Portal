# Monorepo Automation + Orchestration Setup  
_Target: Nx / TS / React / Vite monorepo with multi-agent PR review_

You are a senior DevEx / CI-CD / AI-automation engineer.  
Your task is to **design and implement** all missing automation to make this monorepo “alive” and agent-managed, using the existing Nx/Biome/CI/Claude/Copilot/Codex/Gemini setup.

You must not write feature code. Your scope is:

- GitHub Actions workflows
- Renovate config
- Repo docs and metadata for agents
- Labels and governance around CI / AI / dependencies

Treat this as a **full implementation job**, not a suggestion exercise.

---

## 0. Operating Principles

1. **Do not break existing workflows.**
   - Preserve all current CI, Claude, Codex, Copilot, Gemini, Stryker, Lefthook behavior.
   - Only extend and refactor in backward-compatible ways.

2. **Read before acting.**
   Before changing anything, read at least:
   - `nx.json`
   - `package.json` and lockfile(s)
   - `stryker.config.js`
   - `renovate.json`
   - Existing workflows:  
     `.github/workflows/ci.yml`,  
     `.github/workflows/claude*.yml`,  
     and any other automation workflows.
   - Any existing `.github/agents/*.md` or similar.

3. **Idempotent and reversible changes.**
   - Design workflows so reruns are safe (use comment markers, predictable labels, and no destructive actions without checks).
   - Do not delete human comments/labels; only manage your own.
   - Prefer adding new files over large edits unless a refactor is clearly beneficial.

4. **High assurance.**
   - After your changes, run all relevant Nx targets (at least `lint/check`, `typecheck`, `test` for affected projects).
   - Ensure all workflows parse and pass `act` / `gh workflow run` style dry-runs where possible.
   - Do not introduce “TODO” placeholders; implement fully.

5. **Minimal new dependencies.**
   - When invoking LLMs in workflows, reuse existing GitHub Actions and secrets (e.g., the same Anthropic/OpenAI/Gemini actions already used in `claude*.yml`).
   - Do not introduce new vendors or secrets; compose with what is already present.

---

## 1. Reconnaissance and Design Notes (Phase 1)

Execute this phase first:

1. Map the repo:
   - Infer project structure from `nx.json` and `workspace` layout (apps, packages/libs).
   - Extract any Nx `targetDefaults`, especially:
     - `build`, `test`, `typecheck`, `check`
     - `mutate` (Stryker)
     - `validate:compression`
     - PWA-related targets (e.g., `pwa:icons`, `pwa:icons:watch`).

2. Survey CI & agents:
   - Understand how `ci.yml` runs Nx & quality checks.
   - Understand how each `claude-*.yml` workflow functions (review, issues, maintenance).
   - Understand how Codex, Copilot, Gemini are wired into the PR lifecycle.
   - Identify what LLM Actions are already available (names of Actions, inputs, env variables, secrets).

3. Survey Renovate and Stryker:
   - Understand the current strategy in `renovate.json` (automerge rules, groups, major vs minor behavior).
   - Understand Stryker thresholds and integration path: how/where mutation tests are triggered, what reports are produced.

4. Create a brief design plan (as a local note for yourself) stating:
   - Exact new files you intend to add under `.github/workflows/`.
   - Any changes to `renovate.json`.
   - Any new docs (e.g., `docs/HEALTH.md`, `docs/workspace-map.json`).
   - Which existing workflows will be extended and how.

Only proceed when this plan is internally consistent and requires no new secrets.

---

## 2. Multi-Agent PR Review Summarization Workflow

Create a new workflow:

- Path: `.github/workflows/ai-pr-summary.yml`

### 2.1 Purpose

After all existing reviewers (Copilot, Codex, Claude, Gemini) and CI checks have run on a PR, this workflow:

- Collects all AI and CI feedback.
- Produces a single canonical AI review summary.
- Keeps this summary **continuously updated** as the PR changes.

### 2.2 Triggering

Configure triggers to balance coverage and noise:

- `on: pull_request` with types: `opened`, `reopened`, `synchronize`, `ready_for_review`.
- Optionally `on: issue_comment` to respond to `/summarize`.
- Optionally `on: workflow_run` or `check_suite` completed for `ci.yml` and `claude-code-review.yml` if needed.

### 2.3 Behavior

1. **Collect context**
   - Use the GitHub API (via `actions/github-script` or equivalent) to gather:
     - PR metadata (title, description, author, base/head).
     - List of changed files and line stats.
     - Reviews and comments from AI and bot users (Copilot, Claude, Codex, Gemini, Renovate, etc.).
     - Status of all checks and workflows on the PR.
   - Optionally run `nx print-affected` to list affected projects and include that in the prompt to the LLM.

2. **Call LLM action**
   - Use the same LLM Action and secret configuration already used by `claude-code-review.yml` or equivalent.
   - Pass the collected context with a prompt that instructs the LLM to:
     - Cluster findings by file and severity.
     - Deduplicate repeated comments across agents.
     - Highlight contradictions (e.g., one approves, another flags severe issues).
     - Output a predictable Markdown structure, e.g.:

       ```markdown
       <!-- ai-review-summary -->
       # AI Review Summary

       ## 1. Overall Assessment
       - **Risk**: LOW | MEDIUM | HIGH
       - **Merge readiness**: BLOCKED | CAUTION | SAFE IF CHECKS STAY GREEN

       ## 2. Required Actions Before Merge
       - [ ] (BLOCKER) `path/to/file.ts:line` — concise description
       - [ ] (HIGH) `other/file.ts:line` — concise description

       ## 3. Quality & Safety Signals
       - Build / typecheck: ...
       - Tests: ...
       - Mutation testing (if applicable): ...
       - Compression/PWA/other Nx targets: ...

       ## 4. Nits & Improvements (Optional)
       - Non-blocking suggestions grouped by file.

       ## 5. Agent & Tool Provenance
       - Copilot: ...
       - Claude: ...
       - Codex: ...
       - Gemini: ...
       - CI: ...

       ---
       _Last updated automatically; safe to rerun on new commits._
       ```

3. **Post / update comment**
   - Search for an existing comment containing `<!-- ai-review-summary -->`.
   - If found, update that comment body.
   - If not found, create a new comment.
   - Additionally, write a short, high-level summary to `GITHUB_STEP_SUMMARY` for the Checks tab.

Ensure this workflow is stateless and safe to run multiple times per PR.

---

## 3. PR Triage + Labeling Workflow

Create a new workflow:

- Path: `.github/workflows/ai-pr-triage.yml`

### 3.1 Purpose

- Automatically label PRs by type, area, and risk.
- Provide a `/triage` command for on-demand re-triage.

### 3.2 Triggering

- `on: pull_request` with types: `opened`, `reopened`, `ready_for_review`.
- `on: issue_comment` where the body starts with `/triage`.

### 3.3 Behavior

1. Collect:
   - PR title, description, branch, author.
   - File paths changed.
   - Nx affected projects (via `nx print-affected` or equivalent).
2. Call LLM Action to infer:
   - `type:*` label (`type:feature`, `type:bugfix`, `type:refactor`, `type:chore`, `type:docs`).
   - `area:*` label based on paths and Nx projects (derive a stable naming convention).
   - `risk:*` label (`risk:low`, `risk:medium`, `risk:high`) based on:
     - Size and nature of change.
     - Critical subsystems touched.
3. Apply labels:
   - Add missing labels.
   - Do not remove human governance labels (`do-not-merge`, `security`, etc.) unless a future policy explicitly says so.
4. For `/triage` comments:
   - Post a short comment summarizing what labels were added/updated.

---

## 4. Issue Triage + Labeling Workflow

Create a new workflow:

- Path: `.github/workflows/ai-issue-triage.yml`

### 4.1 Purpose

- Auto-classify new and updated issues.
- Attach structure (type, area, priority, size).
- Provide a `/triage` command on issues.

### 4.2 Triggering

- `on: issues` with types: `opened`, `edited`, `reopened`.
- `on: issue_comment` with `/triage` on issues (not PRs).

### 4.3 Behavior

1. Read issue title, body, and any form fields.
2. Call LLM Action with instructions to:
   - Classify into `type:*` (`bug`, `feature`, `tech-debt`, `chore`, `docs`).
   - Infer `area:*` from references to files or domains.
   - Set `priority:*` (`priority:p0`–`priority:p3`).
   - Optionally set `size:*` (`size:xs`–`size:xl`).
3. Apply labels and, if crucial information is missing (e.g., repro steps for bugs), post a brief comment with a checklist template for the reporter to fill in.
4. Be conservative where uncertain; add fewer labels rather than more.

---

## 5. CI/Quality-Driven Issue Creation Workflow

Extend existing CI or create a focused workflow to:

- Convert persistent technical quality problems into tracked issues instead of letting them linger in logs.

### 5.1 Integration points

You must wire this into:

- Mutation testing (Stryker): thresholds from `stryker.config.js`.
- Lint/typecheck failures if patterned and repeated.
- `validate:compression` and PWA/icon generation failures.

### 5.2 Behavior

For each area:

1. **Mutation testing**
   - When mutation score drops below configured thresholds (especially below `low` or `break`), parse reports and:
     - Aggregate by project/package.
     - Summarize weak points.
     - Create or update a “Mutation Debt” issue with:
       - A short explanation.
       - Per-project checklists of files or areas to strengthen.
       - Link to relevant CI run.

2. **Lint/Typecheck**
   - Detect repeated failures on same paths.
   - Create or update a “Quality Debt” issue summarizing recurring problems and recommended refactors.

3. **Compression/PWA**
   - When compression or PWA-related Nx targets fail, open or update a “Performance/Delivery” issue with:
     - Which bundles or artifacts are missing or non-compliant.
     - Concrete suggested next steps.

To avoid spam:

- Use one issue per category+scope (e.g., one global “Mutation Debt” issue with sections per project).
- Update existing issues instead of creating new ones when possible.

---

## 6. Renovate Auto-Merge Orchestration

Reuse `renovate.json` and adjust or extend **only if needed** to support automation semantics.

Create a new workflow:

- Path: `.github/workflows/renovate-automerge.yml`

### 6.1 Purpose

- Automatically merge safe Renovate PRs after all checks pass.
- Gate or “campaignize” risky upgrades.

### 6.2 Triggering

- `on: pull_request` with:
  - `types: [opened, synchronize, reopened, ready_for_review]`
  - A condition to only run if `author` is `renovate[bot]`.

### 6.3 Behavior

1. Classify Renovate PR:
   - Based on `renovate.json` rules, determine if this PR is:
     - Patch / minor update for stable packages (eligible for auto-merge).
     - Major or special category (TS dev/nightly, React/Nx canary, Biome, etc.), which must **never** be auto-merged.

2. Check gates:
   - All required checks (CI, tests, typecheck, etc.) must be green.
   - No “manual block” labels (e.g., `do-not-merge`, `security-review`, `renovate-blocked`).

3. Optional LLM risk filter:
   - For eligible PRs, call the LLM Action with:
     - package diffs,
     - changelog snippets if available,
     - tests run summary.
   - Ask for a simple `SAFE` vs `UNSAFE` classification and a one-paragraph rationale.

4. Auto-merge path:
   - If classification is safe:
     - Merge the PR via CLI (`gh pr merge`) or the REST API, using the repo’s preferred merge strategy.
     - Optionally delete the branch.
     - Comment succinctly describing that the PR was automerged and why.

5. Blocked path:
   - If major, special, or LLM says “unsafe”:
     - Add a label like `renovate-blocked` or `needs-manual-review`.
     - Leave a comment summarizing the concern and suggested manual checks.

### 6.4 Migration Campaign Issues (for majors)

For Renovate PRs that are major or touching critical ecosystems (Nx, React, TS, etc.):

- Do **not** auto-merge.
- Instead, create or update a “migration campaign” issue with:
  - Scope (which libs/apps/packages are impacted).
  - High-level risks.
  - Phased plan with checklists.
  - Acceptance criteria (all Nx targets and quality thresholds satisfied).

Link Renovate PR(s) to this issue and vice versa.

---

## 7. Workspace Health & Reporting

Create a new scheduled workflow:

- Path: `.github/workflows/workspace-health.yml`

### 7.1 Purpose

- Periodically assess workspace health.
- Surface a concise report in GitHub (Checks summary and optional doc).

### 7.2 Triggering

- `on: schedule` (e.g., daily or weekly).
- Optional `/health` command on an issue to run on demand.

### 7.3 Behavior

1. Use Nx and current tooling to compute:
   - Projects without tests or with minimal coverage.
   - Projects regularly affected by PRs (hotspots).
   - Projects with frequent CI failures.
   - Overall CI success rate over a recent window if feasible.

2. Call LLM Action to summarize into a compact Markdown report with sections:
   - Summary status (`HEALTHY`, `WATCH`, `AT RISK`).
   - Top 3–5 risks.
   - Testing & quality insights.
   - Dependencies & upgrades insights.
   - Recommended next actions.

3. Output report:
   - Write to `GITHUB_STEP_SUMMARY`.
   - Optionally (if acceptable for repo policy) update or create `docs/HEALTH.md`.

Ensure this workflow is read-only by default except for an explicit, intentional commit step if you implement `docs/HEALTH.md`.

---

## 8. CI UX Enhancements (Checks Tab and Artifacts)

Extend `ci.yml` minimally to:

1. Emit **rich step summaries**:
   - Use `GITHUB_STEP_SUMMARY` to show:
     - Which Nx projects were affected in a PR.
     - Status of `build`, `test`, `typecheck`, `mutate`, `validate:compression` per project.
   - Prefer concise tables to verbose prose.

2. Generate **Nx graph artifacts** for PRs:
   - For PR workflows, generate a focused Nx graph for affected projects (HTML or SVG).
   - Upload as an artifact.
   - Optionally link in a PR comment so humans and agents can quickly understand blast radius.

Do not change the core logic of CI; only add reporting and artifacts.

---

## 9. Implementation Protocol (How to Actually Change the Repo)

Follow this execution sequence:

1. **Plan**: produce a short local outline of files and edits (as described in §1).
2. **Implement in small steps**:
   - For each new workflow or config change:
     - Create/edit the file.
     - Validate YAML syntax.
     - Cross-reference with existing Actions and secrets.
   - Keep commits focused (e.g., “add ai-pr-summary workflow”, “add renovate-automerge workflow”).
3. **Validate**:
   - Run Nx targets locally or via CI on a test branch (`nx affected -t lint,typecheck,test` at minimum).
   - For workflows, use `act` or GitHub’s dry-run facilities if available.
4. **Open PR**:
   - In the PR description, summarize:
     - New workflows and their triggers.
     - Any changes to Renovate or other config.
     - How humans and agents are expected to use the new capabilities (e.g., `/summarize`, `/triage`, `/health`).
5. **Self-review**:
   - Use the existing AI code reviewer(s) to review your changes.
   - Incorporate critical feedback, rerun checks, and ensure final PR is clean and fully passing before merge.

---

## 10. Non-Goals and Constraints

- Do **not**:
  - Introduce new external vendors or secrets.
  - Disable or weaken existing CI, Stryker, Lefthook, or code-review safeguards.
  - Add speculative workflows that are unused or untriggered.
  - Rewrite feature code.

- Your work must:
  - Integrate seamlessly with the current monorepo architecture.
  - Be understandable to human maintainers by reading the workflows alone.
  - Provide clear, structured outputs that other agents can reliably parse and build upon.

---
