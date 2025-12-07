---
description: Refine existing skill via skill-builder workflow (project)
argument-hint: [skill-path] [goal: optimize|upgrade|audit?]
---

# [H1][REFINE-SKILL]
>**Dictum:** *Classification frontmatter enables automatic state detection.*

<br>

---
## [1][PARAMETERS]
>**Dictum:** *Minimal parameters—classification read from frontmatter.*

<br>

Scope: refine<br>
Skill: $1<br>
Goal: ${2:-optimize}

---
## [2][DETECT_CLASSIFICATION]
>**Dictum:** *Deterministic extraction precedes context loading.*

<br>

[CRITICAL] Execute FIRST—gates subsequent loading, skill `Type` + `Depth` defined in YAML Frontmatter of `Skill.md`:

```bash
grep -A4 '^---' $1/SKILL.md | grep -E '^(type|depth):'
```

Extract: `type` → Current Type | `depth` → Current Depth

**Fallback (missing fields):** Infer from folder structure. Add fields as Priority 0 intervention.

---
## [3][CONDITIONAL_CONTEXT]
>**Dictum:** *Load only what classification + goal require.*

<br>

**Always load:**
@.claude/skills/skill-builder/SKILL.md
@.claude/skills/skill-builder/references/workflows/refine.md

**Load per goal:**

| [GOAL]   | [ADDITIONAL CONTEXT]                              |
| -------- | ------------------------------------------------- |
| optimize | @.claude/skills/skill-builder/references/depth.md |
| upgrade  | +target template, +§STRUCTURE                     |
| audit    | None                                              |

**Load per target type (upgrade only):**

| [TARGET] | [ADDITIONAL CONTEXT]                                  |
| -------- | ----------------------------------------------------- |
| complex  | @.claude/skills/skill-builder/references/scripting.md |

---
## [4][TASK]
>**Dictum:** *Workflow governs execution; command gates context.*

<br>

Execute §REFINE workflow phases:

1. **[UNDERSTAND]** — Classification extracted (§2). Derive mode from Goal=$2.
2. **[ACQUIRE]** — Context loaded (§3). Compile inventory with LOC headroom.
3. **[AUDIT]** — Scan for violations. Dispatch 3 planning agents.
4. **[REFACTOR]** — Execute by priority: classification → violations → density → structure.
5. **[VALIDATE]** — Dispatch 3 review agents. Verify regression gate.

[CRITICAL]:
- [ALWAYS] Extract classification BEFORE loading context.
- [ALWAYS] Fix missing classification as Priority 0.
- [NEVER] Delete content to meet LOC—refactor for density.
