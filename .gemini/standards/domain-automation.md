# [H1][AUTOMATION_AND_INFRASTRUCTURE_STANDARDS]

## [1][SCOPE]
**Target:** `.github/` (Workflows, Actions), `nx.json`, Root Scripts.
**Exclusion:** `.github/agents/` (Managed by Swarm).

## [2][ARCHITECTURAL_LAWS]
1.  **Middleware Pattern (Immutable):**
    -   **Logic:** Resides in `.github/scripts/*.ts`.
    -   **Config:** Resides in `.github/scripts/schema.ts`.
    -   **Execution:** Workflows (`.yml`) call scripts only. **NO** inline Bash.

2.  **Single Source of Truth:**
    -   `schema.ts` acts as database for automation constants.
    -   Missing value -> **ADD TO SCHEMA FIRST**.

## [3][WORKFLOW_PROTOCOL]
1.  **Analysis:** `read_file .github/scripts/schema.ts`.
2.  **Parametrization:** Parameterize logic in script.
3.  **Validation:** Run `nx run-many -t typecheck` on script **BEFORE** committing YAML.

## [4][PATH_MAPPING]
-   **Schema:** `.github/scripts/schema.ts`
-   **Scripts:** `.github/scripts/`
-   **Workflows:** `.github/workflows/`
