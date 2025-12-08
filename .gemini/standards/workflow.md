<!-- RATING: 9.5/10 -->
<!-- CRITIQUE: Strong "Two-Phase Swarm". "Router Pattern" is bleeding-edge. Could benefit from explicit "Interrupt Signals" definition for human-in-the-loop aborts. -->
<!-- INTEGRATION: Orchestrates 'architect-investigator' and 'sequentialthinking' MCP tools directly. -->
# [H1][TWO_PHASE_SWARM_PROTOCOL]

## [1][PLANNING_AND_RESEARCH]
**Trigger:** Task complexity > 1 step or architectural decision.

1.  **Cognitive Priming (MANDATORY):**
    -   **Engine:** EXECUTE `think` command (System 2 Protocol).
    -   **Goal:** Break prompt into atomic verification steps.

2.  **Router Pattern (MANDATORY):**
    -   **Action:** Classify task complexity (Simple | Complex | Research).
    -   **Route:** Assign specific "Specialist Persona" (e.g., `react-specialist`, `refactoring-architect`).
    -   **Constraint:** Do not proceed without a clear "Specialist" assignment.

3.  **Context Deep-Dive:**
    -   **Graph:** READ `nx.json`, `pnpm-workspace.yaml`, `package.json`.
    -   **Codebase:** READ target folders via `list_directory`.
    -   **Docs:** LOAD `@.gemini/standards/mcp-tactics.md`.

4.  **Aggressive Swarming:**
    -   **EXECUTE:** `@.gemini/standards/research-protocol.md`.
    -   **Deploy:** Simulate specialist perspectives.

5.  **Rigorous Synthesis:**
    -   **Refine:** Eliminate "bloat". Focus on surgical value.
    -   **Plan:** Produce "Golden Path" execution plan via `sequentialthinking`.

## [2][SURGICAL_EXECUTION]
**Trigger:** User approval of Phase 1 Plan.

1.  **Pre-Generation Optimization (MANDATORY):**
    -   **Pause:** Stop before writing.
    -   **Check:** Verify minimal code footprint.
    -   **Verify:** Verify coverage by `biome.json` or `vite.config.ts`.
    -   **Refine:** Reduce LOC count.

2.  **Recursive Refinement Loop (MANDATORY):**
    -   **Generate:** Write initial implementation.
    -   **Orchestrate:** Write a *disposable verification script* (Code-as-Action).
    -   **Verify:** Execute script via `verify-script` command.
    -   **Refine:** If script fails, analyze -> fix -> retry.
    -   **Finalize:** Only proceed when verification passes.

3.  **Implementation:**
    -   WRITE final code adhering to `@.gemini/standards/constitution.md`.
    -   VALIDATE via `nx run-many -t typecheck` and `nx run-many -t check`.
