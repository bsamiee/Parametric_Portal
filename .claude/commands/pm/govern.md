---
description: Validate stage output vs input requirements
argument-hint: [discussion-number] [stage: explore|plan|boardroom|decompose]
---

# [H1][PM:GOVERN]
>**Dictum:** *Alignment is binary — output addresses input or it does not.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Explicit parameters prevent ambiguity.*

<br>

**Discussion:** `$1`
**Stage:** `$2`

---
## [2][CONTEXT]
>**Dictum:** *Governance rules vary by stage.*

<br>

@.claude/agents/governance.md
@.claude/skills/github-tools/SKILL.md

---
## [3][VALIDATION_RULES]
>**Dictum:** *Stage-specific criteria enable precise validation.*

<br>

| [STAGE]   | [INPUT]                | [OUTPUT_MUST_CONTAIN]                                   |
| --------- | ---------------------- | ------------------------------------------------------- |
| explore   | Discussion goals       | Recommendation + approaches addressing goals            |
| plan      | explore recommendation | Objectives tracing to goals, approach matching recommendation |
| boardroom | PLAN.md                | All 5 agent votes, majority outcome                     |
| decompose | PLAN.md + approve vote | Tasks covering all objectives, sizing within limits     |

---
## [4][TASK]
>**Dictum:** *Binary verdict enables autonomous pipeline progression.*

<br>

Validate $2 stage output for Discussion #$1. Check alignment between input requirements and output claims. Return binary PASS/FAIL verdict with coverage table.

Execute governance validation:
1. **READ** — Get Discussion content (title, body, goals, constraints)
2. **LOCATE** — Find stage output with `<!-- SKILL_COMPLETE: $2 -->` marker
3. **EXTRACT** — Parse input requirements and output claims
4. **MAP** — For each input requirement, identify addressing output
5. **VERDICT** — All requirements addressed = PASS; any unaddressed = FAIL

**Output Format:**
```markdown
## [GOVERNANCE]: $2

**Verdict:** {PASS | FAIL}

### [ASSESSMENT]
{1-2 sentences on alignment status}

### [COVERAGE]
| [REQUIREMENT] | [ADDRESSED] | [EVIDENCE] |
| ------------- | :---------: | ---------- |
| {requirement} | {Yes/No}    | {output section or "Missing"} |

### [UNADDRESSED] (if FAIL)
- {requirement 1}: {why not addressed}
```

[CRITICAL]:
- [NEVER] Score confidence — binary PASS/FAIL only.
- [NEVER] Judge quality, style, or approach — only alignment.
- [NEVER] Suggest improvements — flag for human review on FAIL.
- [ALWAYS] Cite specific requirement on FAIL.
- [ALWAYS] Reference output section as evidence on PASS.
- [ALWAYS] Validate completion marker present before assessment.
