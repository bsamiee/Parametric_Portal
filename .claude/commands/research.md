---
description: Execute deep-research workflow, establish project folder
argument-hint: [topic] [slug?]
---

# [H1][RESEARCH]
>**Dictum:** *Research establishes project context via folder creation.*

<br>

@.claude/skills/deep-research/SKILL.md

---
## [1][PATH]

**Output:** `docs/projects/{slug}/research.md`

| [INDEX] | [SOURCE]     | [SLUG]                                    |
| :-----: | ------------ | ----------------------------------------- |
|   [1]   | `$2` (given) | Use verbatim                              |
|   [2]   | `$1` (topic) | Derive: lowercase, hyphens, 2-3 words max |

**Example:** `/research "Effect Schema Validation"` → `docs/projects/effect-schema-validation/research.md`

---
## [2][TASK]

1. Parse `$1` for topic, `$2` for optional slug override.
2. Generate slug from topic if `$2` not provided.
3. Create `docs/projects/{slug}/` directory.
4. Execute `deep-research` skill workflow with output path: `docs/projects/{slug}/research.md`.
5. Main agent writes SINGLE file to `docs/projects/{slug}/research.md`—sub-agents return text only.

---
## [3][CONSTRAINTS]

[CRITICAL]:
- [ALWAYS] Sources from **2025** only (last 6 months preferred).
- [ALWAYS] Create project folder before writing.
- [ALWAYS] Slug: lowercase, hyphens, 2-3 words max.
- [ALWAYS] Main agent writes single `research.md`—sub-agents return text only.
- [NEVER] Use information older than 2025.
- [NEVER] Nested folders within project.
- [NEVER] Sub-agents write files (Write, Edit, Bash).

---
## [4][TOOLS]

Available research skills: `exa-tools`, `perplexity-tools`, `tavily-tools`
