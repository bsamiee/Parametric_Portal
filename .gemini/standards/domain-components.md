# [H1][COMPONENT_AND_LIBRARY_STANDARDS]

## [1][SCOPE]
**Target:** `packages/components/`, `packages/theme/`, Feature Features.

## [2][CONSUMPTION_LAWS]
1.  **No-Handroll Mandate:**
    -   **FORBIDDEN:** Direct definition of `div`, `span`, `button` tags.
    -   **REQUIRED:** Import semantic components from `@parametric/components`.

2.  **B Constant (Config-as-Code):**
    -   Files define `B` constant: `const B = Object.freeze({...})`.
    -   CSS/variants derive from `B`.

3.  **Canonical Section Order (Strict):**
    1.  `Types`
    2.  `Schema`
    3.  `Constants` (B)
    4.  `Pure Functions`
    5.  `Dispatch Tables`
    6.  `Effect Pipeline`
    7.  `Entry Point`
    8.  `Export`

## [3][REFACTORING_PROTOCOL]
1.  **Input:** Read full file.
2.  **Action:** Reorder to Canonical Order.
3.  **Action:** Extract literals to `B`.
4.  **Verify:** `nx run-many -t typecheck`.
