# [H1][WORKFLOW_CREATE]
>**Dictum:** *Sequential phases with parallel dispatch prevent incomplete skill artifacts.*

<br>

[IMPORTANT] Parameters (`Type`, `Depth`, `Scope`) from §DECISION. Reference throughout for constraint enforcement.

---
## [1][UNDERSTAND]
>**Dictum:** *Requirements clarity prevents rework.*

<br>

Confirm before proceeding:
- `Type` — Simple | Standard | Complex. Gates folder existence.
- `Depth` — Base | Extended | Full. Gates LOC limits + nesting.
- `Purpose` — Task addressed by skill.
- `Triggers` — User intent activating skill.
- `Outputs` — Artifacts produced.

[VERIFY] Requirements captured:
- [ ] Type and Depth explicitly stated.
- [ ] Purpose articulated in one sentence.
- [ ] 3+ trigger scenarios identified.

---
## [2][ACQUIRE]
>**Dictum:** *Context loading precedes research.*

<br>

### [2.1][LOAD_CONSTRAINTS]

Load skill-builder sections per parameters:

| [CONDITION]      | [LOAD]                                  |
| ---------------- | --------------------------------------- |
| All              | §FRONTMATTER, §STRUCTURE, §DEPTH        |
| Standard/Complex | §TEMPLATES (standard.skill.template.md) |
| Complex          | +§SCRIPTING, complex.skill.template.md  |

---
### [2.2][LOAD_STANDARDS]

Invoke `style-summarizer`. Extract:
- Voice constraints (imperative, third person, no hedging).
- Formatting rules (separators, headers, spacing).
- Taxonomy terms (Dictum, Qualifier, Modifier, Gate).

[CRITICAL] Include style constraints in sub-agent prompts.

---
### [2.3][SCAFFOLD]

Compile constraint manifest before research:

```
Type: ${type} | Depth: ${depth}
SKILL.md LOC: <${skill_loc} | Reference LOC: <${ref_loc}
Nesting: ${nesting_rights} | Folders: ${required_folders}
Template: ${template_file}
```

[IMPORTANT] Agnostic scaffold—domain knowledge excluded until §3[RESEARCH]. Scaffold defines CONSTRAINTS, not CONTENT.

---
## [3][RESEARCH]
>**Dictum:** *Delegated research maximizes coverage via specialized agents.*

<br>

### [3.1][DOMAIN_RESEARCH]

Invoke `deep-research`:

| [PARAM]     | [VALUE]                                              |
| ----------- | ---------------------------------------------------- |
| Topic       | `${purpose}` from §1                                 |
| Constraints | Manifest §2.3, style §2.2, AgentCount per Type below |

| [TYPE]   | [ROUND_1] | [ROUND_2] |
| -------- | :-------: | :-------: |
| Simple   |     6     |     3     |
| Standard |     8     |     4     |
| Complex  |    10     |     6     |

[REFERENCE]: [→deep-research](../../deep-research/SKILL.md)

**Post-dispatch:** Receive validated findings per `report.md` format. Proceed to §3.2.

---
### [3.2][PLAN_SYNTHESIS]

Invoke `parallel-dispatch` with 3 planning agents.

**Input:** Research findings (§3.1), constraint manifest (§2.3), skill-builder SKILL.md + sections, template file.<br>
**Deliverable:** File inventory, section structure per file, content framework per section.<br>
**Post-dispatch critique:** Identify constraint violations (LOC, structure, nesting), flag gaps (missing triggers), detect hallucinations (unsupported content), note strengths for integration.<br>
**Golden-path synthesis:** Combine strongest elements from 3 plans with main agent's research. Resolve conflicts via constraint hierarchy: Type → Depth → Style.

[VERIFY] Plan synthesis complete:
- [ ] All files enumerated with section structure.
- [ ] LOC estimates within depth limits.
- [ ] Content framework addresses all triggers.

---
## [4][AUTHOR]
>**Dictum:** *Type-gated creation prevents scope violations.*

<br>

### [4.1][VALIDATE_PLAN]

[VERIFY]: Confirm plan compliance before creation:
- [ ] File count matches Type (Simple: 1, Standard: 4+, Complex: 5+).
- [ ] LOC estimates within Depth limits.
- [ ] Folder structure matches §STRUCTURE requirements.

---
### [4.2][CREATE_ARTIFACTS]

Execute in order. Skip inapplicable steps based on Type.

| [STEP] | [ARTIFACT]      | [TYPE_GATE]      | [ACTION]                                 |
| :----: | --------------- | ---------------- | ---------------------------------------- |
|   1    | SKILL.md        | All              | Apply template, populate from plan.      |
|   2    | index.md        | Standard/Complex | Reference table for all files.           |
|   3    | references/*.md | Standard/Complex | Domain knowledge files from plan.        |
|   4    | templates/*.md  | Standard/Complex | Output scaffold with `${placeholder}`.   |
|   5    | scripts/*.py    | Complex          | Deterministic automation per §SCRIPTING. |

**Cross-reference extraction:** Extract from SKILL.md what belongs in reference files vs. inline. SKILL.md contains Required/Conditional Tasks pointing TO references. References contain deep knowledge.

[CRITICAL]:
- [ALWAYS] Include `type` and `depth` frontmatter—refine workflow requires these fields.
- [ALWAYS] Validate each artifact against template before proceeding.
- [ALWAYS] Cross-reference SKILL.md tasks to reference files—no duplication.
- [NEVER] Create empty folders or placeholder files.

---
## [5][VALIDATE]
>**Dictum:** *Parallel review agents ensure comprehensive quality.*

<br>

Invoke `parallel-dispatch` with 3 review agents.

**Input:** Skill folder, plan + manifest, skill-builder SKILL.md + sections.<br>
**Review scope:** LOC violations, structure/depth breaches, voice non-compliance, content gaps, SKILL.md↔references duplication.<br>
**Post-dispatch:** Compile findings, reject false positives, apply fixes. Re-validate if changes exceed 20%.

[VERIFY] Quality gate:
- [ ] Classification frontmatter: `type` and `depth` present and valid.
- [ ] `type` matches actual folder structure (simple/standard/complex).
- [ ] `depth` matches actual LOC and nesting (base/extended/full).
- [ ] All LOC limits satisfied.
- [ ] Structure matches Type requirements.
- [ ] Voice compliance confirmed.
- [ ] No unresolved review findings.
