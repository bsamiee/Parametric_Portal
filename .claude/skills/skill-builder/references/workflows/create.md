# [H1][WORKFLOW_CREATE]
>**Dictum:** *Sequential phases prevent incomplete artifacts.*

<br>

Create scope: author new skill artifacts from `deep-research` findings.

[CRITICAL] `deep-research` MUST complete fully before authoring. Sub-agents use `report.md` output format per SKILL.md Task 7.

---
## [1][AGENT_SCALING]
>**Dictum:** *Type complexity determines research depth.*

<br>

Scale `deep-research` agent count by Type:

| [TYPE]   | [ROUND_1] | [ROUND_2] |
| -------- | :-------: | :-------: |
| Simple   | 6 agents  | 6 agents  |
| Standard | 8 agents  | 8 agents  |
| Complex  | 10 agents | 10 agents |

---
## [2][ARTIFACT_ORDER]
>**Dictum:** *Type gates artifact existence.*

<br>

| [ARTIFACT]      | [TYPE_GATE]      | [PURPOSE]                              |
| --------------- | ---------------- | -------------------------------------- |
| SKILL.md        | All              | Main skill file with Tasks + Guidance  |
| index.md        | Standard/Complex | Reference table for all files          |
| validation.md   | Standard/Complex | Operational checklists, error symptoms |
| references/*.md | Standard/Complex | Domain knowledge files                 |
| templates/*.md  | Standard/Complex | Output scaffolds with `${placeholder}` |
| scripts/*.py    | Complex          | Deterministic automation               |

---
## [3][CROSS_REFERENCE]
>**Dictum:** *SKILL.md builds FROM references—no duplication.*

<br>

**Extraction logic:**
- SKILL.md contains Tasks + domain sections with Guidance/Best-Practices
- References contain deep knowledge, tables, detailed specifications
- If content exceeds 10 lines → extract to reference file
- Domain sections summarize; references elaborate

[CRITICAL]:
- [ALWAYS] Include `type` and `depth` frontmatter
- [NEVER] Create empty folders or placeholder files
