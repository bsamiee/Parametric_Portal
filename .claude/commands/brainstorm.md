---
description: Synthesize research into design direction via autonomous exploration
argument-hint: [research-file] [request-context]
---

# [H1][BRAINSTORM]
>**Dictum:** *Autonomous synthesis bridges research to implementation planning.*

<br>

@.claude/skills/design-synthesis/SKILL.md
@.claude/skills/parallel-dispatch/SKILL.md

---
## [1][PATH]

**Input:** `$1` (research file path)<br>
**Output:** `dirname($1)/brainstorm.md`

**Example:** `@docs/projects/foo/research.md` → `docs/projects/foo/brainstorm.md`

---
## [2][TASK]

1. Parse `$1` for research file, `$2` for request context.
2. Execute `design-synthesis` workflow (INGEST → SCAN → EXPLORE → SELECT → OUTPUT).
3. Write findings to `dirname($1)/brainstorm.md`.

---
## [3][CONSTRAINTS]

[CRITICAL]:
- [ALWAYS] Write to same directory as input research file.
- [ALWAYS] Commit to ONE approach—no hedging.
- [ALWAYS] Apply YAGNI—cut unnecessary scope.
- [NEVER] Deep-dive into file contents—plan does that.
- [NEVER] Defer decisions to downstream phases.
