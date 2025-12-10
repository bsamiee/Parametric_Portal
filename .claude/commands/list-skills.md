---
description: List available skills with triggers and routing rules
allowed-tools: Bash
---

# [H1][LIST-SKILLS]
>**Dictum:** *Hook-driven discovery minimizes file reads.*

<br>

Execute sections in sequence. Format output as definition list.

---
## [1][EXECUTE]
>**Dictum:** *Hook parses all skill frontmatter.*

<br>

Run skill index hook:

```bash
uv run "$CLAUDE_PROJECT_DIR/.claude/hooks/load-skill-index.py"
```

---
## [2][FORMAT]
>**Dictum:** *Structured output enables scanning.*

<br>

Parse `<skills>` XML output. Format as definition list:

**`{name}`** — {trigger phrase}

---
## [3][ROUTING]
>**Dictum:** *Skill scripts replace direct CLI.*

<br>

**Invocation:** `uv run .claude/skills/{skill}/scripts/{script}.py {command} [args]`

[CRITICAL]:
- [NEVER] `gh` directly → [ALWAYS] `github-tools` skill.
- [NEVER] `nx show` directly → [ALWAYS] `nx-tools` skill.
- [NEVER] MCP tool calls → [ALWAYS] Skill script invocation.

[REFERENCE] Use `/learn-skill {name}` for complete skill knowledge.