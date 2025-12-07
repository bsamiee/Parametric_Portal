# [H1][RESEARCH_AND_INVESTIGATION_PROTOCOL]

## [1][PHILOSOPHY]
**"Maximize Signal, Minimize Noise."** Do not guess. Do not assume. Verify via aggressive, multi-vector swarming.

## [2][MANDATORY_WORKFLOW]

### [2.1][RESEARCH_ROUND_1]
-   **Action:** Spawn 5+ specialized sub-agents via `/subagents run-parallel`.
-   **Vectors:**
    1.  **Docs (Context7):** MUST use `resolve-library-id` -> `get-library-docs`.
    2.  **Patterns (Exa):** MUST use `get_code_context_exa` for 2025 patterns.
    3.  **Codebase:** `list_directory` / `read_file` (Ground Truth).
-   **Constraint:** Sources **MUST** be from 2025 (last 6 months).

### [2.2][CRITIQUE_ROUND_1]
-   **Action:** Ruthlessly audit Agent outputs.
-   **Checklist:**
    -   [ ] Verify Context7 usage for libs.
    -   [ ] Verify Exa patterns <6 months old.
    -   [ ] Verify info actionability.

### [2.3][RESEARCH_ROUND_2]
-   **Action:** Spawn 5+ specialized sub-agents via `/subagents run-parallel`.
-   **Vectors:**
    1.  **Docs (Context7):** MUST use `resolve-library-id` -> `get-library-docs`.
    2.  **Patterns (Exa):** MUST use `get_code_context_exa` for 2025 patterns.
    3.  **Codebase:** `list_directory` / `read_file` (Ground Truth).
-   **Constraint:** Sources **MUST** be from 2025 (last 6 months).
-   **MUST:** Prompt all sub-agents with information/lessons learned from [1][RESEARCH_ROUND_1]

### [2.4][CRITIQUE_ROUND_2]
-   **Action:** Ruthlessly audit Agent outputs.
-   **Checklist:**
    -   [ ] Verify Context7 usage for libs.
    -   [ ] Verify Exa patterns <6 months old.
    -   [ ] Verify info actionability.

### [2.5][FINAL_SYNTHESIS]
-   **Action:** Merge R1 + C1 + R2 + C@. Define Golden Path.
-   **Conflict Resolution:** Context7 (Docs) > Exa (Code) > Blogs.
-   **Output:** Comprehensive "Context Payload".
