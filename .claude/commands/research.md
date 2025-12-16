---
description: Execute deep-research workflow, output research_{slug}.md to target directory
argument-hint: [topic, optional: "save to DIR"]
---

# [H1][RESEARCH]
>**Dictum:** *Delegated research with temporal constraints ensures relevant findings.*

<br>

@.claude/skills/deep-research/SKILL.md

---
## [1][TASK]

1. Parse **$ARGUMENTS** for topic and optional directory from request (default: `.`).
2. Execute `deep-research` skill workflow for topic.
3. Write findings to a SINGLE `{dir}/research_{slug}.md` file — derive 1-2 word slug from topic (e.g., `research_react19.md`).

---
## [2][CONSTRAINTS]

[CRITICAL]:
- [ALWAYS] Sources from **2025** only (last 6 months preferred).
- [ALWAYS] Output to `research_{slug}.md` — slug: lowercase, no spaces, 1-2 words max.
- [NEVER] Use information older than 2025.

---
## [3][TOOLS]

Available research skills: `exa-tools`, `perplexity-tools`, `tavily-tools`
