# Role: Principal DevOps Architect & Agent Orchestrator

## Context & Objective
We are upgrading a mature monorepo (Nx, Biome, Effect TS, Stryker) from "Agent Siloing" to "Agent Orchestration." Currently, multiple AI tools (Copilot, Codex, Gemini, Claude) operate independently.

**Your Goal:** Generate the specific workflow files and configuration changes required to create a "Lead Engineer" layer that manages these sub-agents, automates decision-making, and visualizes architecture.

## Input Context (Existing Infrastructure)
* **Linting/Formatting:** `biome.json` (Strict rules, no `any`, no `var`).
* **Dependency Management:** `renovate.json` (Grouped updates, highly active).
* **CI/CD:** `ci.yml` (Nx affected graph, pnpm cache).
* **Current Agents:**
    * `claude-code-review.yml` (Reviews PRs against REQUIREMENTS.md).
    * `claude-maintenance.yml` (Weekly tasks).
    * `claude-issues.yml` (Auto-implementation).
* **Testing:** `stryker.config.js` (Mutation testing).

## Execution Tasks

### <task_1> The Judge (Meta-Reviewer Workflow) </task_1>
**Goal:** Eliminate "Review Noise" by synthesizing comments from Copilot, Codex, and Claude into one authoritative report.
**Action:** Create `.github/workflows/agent-judge.yml`.
**Specs:**
* **Trigger:** `workflow_run` (Wait for `Claude Code Review` and `CI` to complete).
* **Permissions:** `pull-requests: write`, `contents: read`.
* **Logic:**
    1.  Use `gh api` to fetch review comments from all bots/users on the PR.
    2.  Use `anthropics/claude-code-action` with a specific prompt to:
        * Ingest all comments.
        * Discard duplicates or hallucinations (e.g., "Ignore Copilot if it contradicts Biome").
        * Group findings into: **Critical (Blocking)** vs. **Nitpicks (Non-blocking)**.
        * Post ONE summary comment titled "🛡️ Principal Architect Consensus".
* **Model:** Use `claude-3-5-sonnet` or `claude-opus` for high-context synthesis.

### <task_2> The Stryker Gate (Safe Automerge) </task_2>
**Goal:** Allow Renovate to auto-merge updates *only* if mutation scores remain high (proving tests actually cover the changes).
**Action:** Create `.github/workflows/renovate-gate.yml` and update `stryker.config.js`.
**Specs:**
* **Trigger:** `pull_request` (Targeting `renovate/**` branches).
* **Update `stryker.config.js`:** Enable `incremental: true` to only mutate changed files for speed.
* **Workflow Steps:**
    1.  Checkout & Install.
    2.  Restore Incremental Cache.
    3.  Run `pnpm stryker run`.
    4.  **Gate:** If score > 80 (or existing threshold), run `gh pr merge --squash --auto`.

### <task_3> Live Architecture Graphing </task_3>
**Goal:** Provide agents with a map of the territory so they don't break dependencies.
**Action:** Modify `ci.yml`.
**Specs:**
* Add a step after "Install dependencies".
* Command: `pnpm nx graph --file=project-graph.json`.
* Action: Upload `project-graph.json` as a build artifact named `architecture-map`.
* *Note:* This artifact will be consumed by future agent runs to understand circular dependencies.

### <task_4> Intelligent Issue Triage (PM Agent) </task_4>
**Goal:** Refine vague issues before code generation begins.
**Action:** Create `.github/workflows/claude-triage.yml`.
**Specs:**
* **Trigger:** `issues: [opened]`.
* **Prompt Strategy:**
    * Read the Issue Title/Body.
    * Read `REQUIREMENTS.md` (assume existence) and `project-graph.json` (if available).
    * **Action 1:** Apply labels (`scope:package-name`, `type:bug`).
    * **Action 2:** If the spec is vague, post a comment: "❓ Clarification Needed: Please define X."
    * **Action 3:** If the spec is clear, add label `ready-for-dev`.

## Constraints & Requirements
1.  **Strict Biome Compliance:** All generated JS/TS must follow the rules in `biome.json` (4 spaces, no semicolons in JSON, specific naming conventions).
2.  **Tooling:** Use `pnpm` exclusively. Use `gh` CLI for GitHub interactions.
3.  **Secrets:** Assume `CLAUDE_CODE_OAUTH_TOKEN` and `GITHUB_TOKEN` are available.
4.  **Formatting:** Return the output as valid, copy-pasteable code blocks with file path headers (e.g., `### .github/workflows/agent-judge.yml`).

## Output Deliverables
Generate the following files in full:
1.  `.github/workflows/agent-judge.yml`
2.  `.github/workflows/renovate-gate.yml`
3.  `.github/workflows/claude-triage.yml`
4.  Updated `stryker.config.js` snippet
5.  Updated `ci.yml` snippet