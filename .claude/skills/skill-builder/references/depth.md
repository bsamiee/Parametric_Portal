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
>**Dictum:** *Each depth level unlocks capabilities progressively.*

<br>

| [INDEX] | [DEPTH]  | [NESTING]      | [SECTIONS]           |
| :-----: | -------- | -------------- | -------------------- |
|   [1]   | Base     | Flat only      | Tasks, References    |
|   [2]   | Extended | 1 subfolder    | +Guidance, sparse BP |
|   [3]   | Full     | 1-3 subfolders | +Full Best-Practices |

### [2.1][NESTING]

Nesting rights apply to Standard/Complex types only. Simple type has no folders.

**Flat (Base):**<br>
- All reference files directly at `references/` root.
- No subfolders permitted.

**Nested (Extended):**<br>
- ONE subfolder permitted.
- Identify most essential domain (becomes subfolder).

**Nested (Full):**<br>
- 1-3 subfolders permitted.
- Subfolder requires 3+ related files OR distinct domain concern.

[CRITICAL] Folder creation requires semantic grouping. Content volume alone insufficient.

---
### [2.2][SECTIONS]

Depth gates section availability in SKILL.md domain sections.

**Base:**<br>
- Required Task, Conditional Task, References only.
- No Guidance or Best-Practices sections.

**Extended:**<br>
- Guidance section permitted.
- Sparse Best-Practices: 3-4 critical items. No exhaustive lists.

**Full:**<br>
- Full Best-Practices section permitted.
- Detailed Guidance with multiple concepts permitted.

[IMPORTANT] Simple type: All content inline in sections. Standard/Complex: Guidance in SKILL.md, detailed content in references/.

---
## [3][VALIDATION]
>**Dictum:** *Gate checklist enforces compliance.*

<br>

[VERIFY]:
- [ ] Depth selected: Base | Extended | Full.
- [ ] SKILL.md within LOC limit for depth.
- [ ] All reference files within LOC limit for depth.
- [ ] Subfolder count matches depth (Base: 0; Extended: 1; Full: 1-3).
- [ ] Sections match depth gate (Base: no Guidance/BP; Extended: sparse BP; Full: full).
