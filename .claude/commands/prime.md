---
description: Initialize session with codebase context and style standards.
---

# [H1][PRIME]
>**Dictum:** *Context initialization enables informed execution.*

<br>

Execute all tasks in sequence.

---
## [1][TASKS]
>**Dictum:** *Repository mapping reveals structure.*

<br>

1. Run `eza . --tree --git-ignore` mapping repository structure.
2. Run skill index hook:
```bash
uv run .claude/hooks/load-skill-index.py
```
3. Read `REQUIREMENTS.md`, extract all standards, constraints, quality expectations, bleeding-edge approach, and file organization structure.
4. Read `.claude/skills/style-standards/SKILL.md`
5. [IMPORTANT] always do full refactoring/clean code implementation, never maintain legacy/stale code or patterns, never implement workarounds/hacky code, never create barrel files (`index.ts`), never re-export symbols, always use explicit exports at file end.

[IMPORTANT] Always write code in Functional Programming style, fully maximize `effect` external lib functionality.

[CRITICAL] Summarize architecture, packages, tooling, style domains, code philosophy.
