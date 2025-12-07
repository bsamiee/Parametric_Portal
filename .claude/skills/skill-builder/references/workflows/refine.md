# [H1][WORKFLOW_REFINE]
>**Dictum:** *Surgical transformation preserves semantic content while improving density.*

<br>

[IMPORTANT] Classification from frontmatter `type` and `depth` fields. Command extracts before workflow invocation.

---
## [1][UNDERSTAND]
>**Dictum:** *Command provides classification; workflow derives mode.*

<br>

Classification extracted by command (§DETECT_CLASSIFICATION). Derive mode:

| [INDEX] | [GOAL]   | [MODE]   | [TARGET]        | [OPERATIONS]                      |
| :-----: | -------- | -------- | --------------- | --------------------------------- |
|   [1]   | optimize | Optimize | Same type/depth | Density, voice, frontmatter fixes |
|   [2]   | upgrade  | Upgrade  | Higher type     | Add folders, redistribute content |
|   [3]   | upgrade  | Expand   | Higher depth    | Add nesting, sections, LOC budget |
|   [4]   | audit    | Audit    | —               | Report findings only, no changes  |

[CRITICAL] Missing classification → Legacy skill. Add `type`/`depth` as Priority 0 intervention.

[VERIFY] State captured:
- [ ] Current type/depth from command extraction.
- [ ] Mode derived from goal.
- [ ] Target type/depth set (upgrade only).

---
## [2][ACQUIRE]
>**Dictum:** *Conditional loading minimizes context overhead.*

<br>

### [2.1][LOAD_CONTEXT]

Command loads base context. Workflow loads per mode:

| [MODE]   | [LOAD]                       |
| -------- | ---------------------------- |
| Optimize | §DEPTH (LOC limits)          |
| Upgrade  | §STRUCTURE + target template |
| Expand   | §DEPTH (nesting rights)      |
| Audit    | None additional              |

| [TARGET_TYPE] | [ADDITIONAL] |
| ------------- | ------------ |
| complex       | §SCRIPTING   |

Invoke `style-summarizer`—extract voice/formatting constraints for sub-agent prompts.

---
### [2.2][COMPILE_INVENTORY]

Read skill folder. Compile inventory:

```
Current: ${type}/${depth} | Target: ${target_type}/${target_depth} | Mode: ${mode}
Files: [list with LOC] | Headroom: SKILL.md ${current}/${limit} | Refs ${current}/${limit}
```

[IMPORTANT] Positive headroom → enrichment possible. Negative → density surgery required.

---
## [3][AUDIT]
>**Dictum:** *Diagnosis informs surgical planning.*

<br>

### [3.1][SCAN]

| [INDEX] | [CATEGORY]     | [SIGNALS]                                     |
| :-----: | -------------- | --------------------------------------------- |
|   [1]   | Classification | Missing/mismatched `type`/`depth` frontmatter |
|   [2]   | Density        | Prose→table, list→table, diagram-worthy       |
|   [3]   | Violations     | Voice, structure, depth, naming               |
|   [4]   | Duplication    | SKILL.md↔references overlap                   |
|   [5]   | Upgrade gaps   | Missing folders/sections for target tier      |

---
### [3.2][PLAN]

Invoke `parallel-dispatch` with 3 planning agents.

**Input:** Scan findings, inventory, skill-builder sections, target template.<br>
**Deliverable:** Ordered intervention list with LOC projections.<br>
**Golden-path synthesis:** Priority: Classification → Correctness → Density → Enrichment.

[VERIFY] Plan complete:
- [ ] Interventions ordered by priority.
- [ ] LOC projections within limits.
- [ ] No semantic content loss.

---
## [4][REFACTOR]
>**Dictum:** *Atomic transformations enable validation between changes.*

<br>

Execute interventions by priority:

| [PRIORITY] | [CLASS]               | [GATE]                 |
| :--------: | --------------------- | ---------------------- |
|     0      | Classification fix    | `type`/`depth` present |
|     1      | Constraint violations | All resolved           |
|     2      | Format transforms     | LOC delta validated    |
|     3      | Content consolidation | No duplication         |
|     4      | Structural additions  | Upgrade folders exist  |
|     5      | Content enrichment    | Headroom utilized      |

[IMPORTANT]:
- [ALWAYS] Fix classification FIRST—enables future refine.
- [ALWAYS] Compress representation, not meaning.
- [NEVER] Delete content—refactor for density.

---
## [5][VALIDATE]
>**Dictum:** *Parallel review ensures no regression.*

<br>

Invoke `parallel-dispatch` with 3 review agents.

**Input:** Refined skill, original, plan, constraint manifest.<br>
**Review scope:** Classification, LOC, structure, voice, semantic preservation.

**Regression Gate:**

| [INDEX] | [DIMENSION]    | [REQUIREMENT]                       |
| :-----: | -------------- | ----------------------------------- |
|   [1]   | Classification | `type`/`depth` present and accurate |
|   [2]   | Triggers       | 100% preserved                      |
|   [3]   | Domains        | 100% addressed                      |
|   [4]   | Semantics      | 100% retained                       |
|   [5]   | LOC            | Within target limits                |

[VERIFY] Quality gate:
- [ ] Classification present and accurate.
- [ ] LOC limits satisfied.
- [ ] Structure matches target.
- [ ] Semantic preservation verified.
