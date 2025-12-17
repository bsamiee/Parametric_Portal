---
description: Extract work units from plan and create sequenced GitHub issues
argument-hint: [plan-file]
---

# [H1][DECOMPOSE]
>**Dictum:** *Work units become issues; issues enable parallel agent execution.*

<br>

@.claude/skills/plan-decompose/SKILL.md
@.claude/skills/github-tools/SKILL.md

---
## [1][PATH]

**Input:** `$1` (plan file path)<br>
**Output:** GitHub Issues (no file artifact)

**Example:** `@docs/projects/foo/plan.md` → Issues created in repository

---
## [2][TASK]

1. Parse `$1` for plan file path.
2. Execute `plan-decompose` workflow (PARSE → VALIDATE → CREATE → LINK → OUTPUT).
3. Return summary table of created issues.

---
## [3][CONSTRAINTS]

[CRITICAL]:
- [ALWAYS] Parse ALL work units before creating issues.
- [ALWAYS] Create in dependency order (WU-1 before WU-2 if depends).
- [ALWAYS] Include validation checklist in every issue.
- [ALWAYS] Include PR_WORKFLOW section (branch → work → push → PR).
- [ALWAYS] Use `[TASK]:` prefix for titles.
- [NEVER] Create issues if Work Units section missing.
- [NEVER] Skip label validation.
