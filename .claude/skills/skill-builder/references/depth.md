# [H1][DEPTH]
>**Dictum:** *Depth gates LOC—scales with selection.*

<br>

[IMPORTANT] Depth prevents bloat through hard caps. Each level adds +50 LOC to SKILL.md, +25 LOC to reference files (cumulative).

---
## [1][LIMITS]
>**Dictum:** *Hard caps enforce quality through constraint.*

<br>

| [INDEX] | [DEPTH]  | [SKILL.MD] | [REF_FILE] |
| :-----: | -------- | :--------: | :--------: |
|   [1]   | Base     |    <300    |    <150    |
|   [2]   | Extended |    <350    |    <175    |
|   [3]   | Full     |    <400    |    <200    |

[CRITICAL] Exceeding limits requires refactoring, not justification. No exceptions.

[REFERENCE] File count limit: Max 7 files in references/ — see [→structure.md§2](./structure.md#2folder_purpose)

---
## [2][UNLOCKS]
>**Dictum:** *Each depth level scales content density.*

<br>

| [INDEX] | [DEPTH]  | [NESTING]      | [GUIDANCE] | [BEST-PRACTICES] |
| :-----: | -------- | -------------- | :--------: | :--------------: |
|   [1]   | Base     | Flat only      | 1-2 items  |    1-2 items     |
|   [2]   | Extended | 1 subfolder    | 2-4 items  |    3-4 items     |
|   [3]   | Full     | 1-3 subfolders |  4+ items  |  Comprehensive   |

### [2.1][NESTING]

Nesting rights apply to Standard/Complex types only. Simple type has no folders.

**Flat (Base):**
- All reference files directly at `references/` root.
- No subfolders permitted.

**Nested (Extended):**
- ONE subfolder permitted.
- Identify most essential domain (becomes subfolder).

**Nested (Full):**
- 1-3 subfolders permitted.
- Subfolder requires 3+ related files OR distinct domain concern.

[CRITICAL] Folder creation requires semantic grouping. Content volume alone: insufficient.

---
### [2.2][SECTIONS]

All domain sections include Guidance and Best-Practices. Depth scales content density.

**Base:**
- Guidance: 1-2 core concepts. Essential "why" only.
- Best-Practices: 1-2 critical constraints. No exhaustive lists.

**Extended:**
- Guidance: 2-4 concepts with moderate rationale.
- Best-Practices: 3-4 items covering primary patterns.

**Full:**
- Guidance: Comprehensive coverage with detailed rationale.
- Best-Practices: Exhaustive patterns and constraints.

[IMPORTANT] Simple type: All content inline in sections. Standard/Complex: Guidance in SKILL.md, detailed content in references/.

---
## [3][LOC_OPTIMIZATION]
>**Dictum:** *Density over deletion—retain all semantic value.*

<br>

[CRITICAL] Brute-force trimming is PROHIBITED. Cutting content to meet LOC limits without optimization destroys value.

**Optimization sequence:**
1. **Consolidate** — Identify repeated information across files; keep in ONE location, remove elsewhere
2. **Restructure** — Find better organization to reduce redundant tables, headers, boilerplate
3. **Densify** — Rewrite lines for maximum information per token; explicit, no filler
4. **Prune** — Remove ONLY low-impact/low-value content after above steps exhausted

**Quality signals:**
- Every line provides unique value
- No repeated concepts across sections
- Tables consolidated where patterns overlap
- Instructions dense, explicit, no filler phrasing

[IMPORTANT] High-quality skills achieve maximum value within LOC limits. Constraint drives density, not reduction.

---
## [4][CONTENT_SEPARATION]
>**Dictum:** *SKILL.md builds ON references—never copies.*

<br>

**SKILL.md contains:**
- Tasks — Sequential actions with links
- Domain sections — WHY (rationale, guidance, best-practices)
- Summary-level information that references detailed content

**Reference files contain:**
- HOW — Detailed specifications, tables, schemas
- Deep knowledge — Implementation details, patterns, examples
- Content exceeding 10 lines in SKILL.md

**Section quality gate:**
- Guidance = core concepts explaining WHY something matters
- Best-Practices = constraints/patterns that BUILD ON reference content
- NEVER copy/re-iterate reference content verbatim
- ALWAYS provide additive value beyond what references contain

[CRITICAL] Even simple skills without references: sections must be high-impact, crafted with care. No boilerplate. Every item earns its LOC.

[REFERENCE] Depth validation checklist: [→validation.md§4](./validation.md#4depth)
