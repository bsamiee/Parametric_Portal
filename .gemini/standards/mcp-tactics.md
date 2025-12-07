# [H1][MCP_TACTICAL_MANUAL]

## [1][PHILOSOPHY]
Tools as **cognitive extensions**, not features.

## [2][SEQUENTIAL_THINKING] (`sequentialthinking`)
**Role:** Pre-frontal Cortex.
**Trigger:** Tasks >1 step, refactoring, architecture.
**Usage:**
-   **Start:** Initiate planning arc.
-   **Loop:** Update thought stream with new facts.
-   **Conclusion:** Exit only when `nextThoughtNeeded` is false.

## [3][CONTEXT7] (`resolve-library-id` -> `get-library-docs`)
**Role:** Librarian.
**Trigger:** Require accurate API signatures.
**Protocol (Strict 2-Step):**
1.  **Resolve:** `resolve-library-id` -> Returns ID.
2.  **Fetch:** `get-library-docs`.
**Constraint:** **NEVER** hallucinate API methods.

## [4][EXA] (`get_code_context_exa`)
**Role:** Scout.
**Trigger:** Require modern (2025) patterns.
**Usage:**
-   `get_code_context_exa(query: "React 19 pattern", tokens: 2000)`.
-   Grounds `architect-investigator` findings.

## [5][CODE_AS_ACTION] (`run_shell_command`)
**Role:** Orchestrator.
**Trigger:** Multi-step verification, mass-refactoring, complex analysis.
**Usage:**
-   **Write:** Create a temporary `verify-task.ts` script.
-   **Execute:** `pnpm tsx verify-task.ts`.
-   **Analyze:** Read stdout/stderr.
-   **Refine:** Fix code based on script output.
-   **Cleanup:** Delete the script.

## [6][MEM0] (`save_memory`)
**Role:** Long-term Storage.
**Trigger:** User preferences, architectural decisions.
**Usage:** "Remember: project prefers `Effect.gen`."
