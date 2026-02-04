---
name: skill-summarizer
description: >-
  Synthesizes skill folder contents into structured summaries for delegating agents.
  Use when loading skill context before spawning subagents, extracting full skill knowledge,
  reading specific sections or folders, or providing skill instructions to orchestrating agents.
tools: Read, Glob, Grep, Bash
model: sonnet
skills: skill-builder
color: green
---

Read skill folder (full or targeted section). Structure knowledge for main agent context injection.

---
## [1][CONTEXT]
>**Dictum:** *Meta-knowledge enables pattern recognition.*

<br>

Read `.claude/skills/skill-builder/SKILL.md` first. Internalize:
- **Dictum** — WHY statement after H1/H2 headers
- **Tasks** — Numbered workflow steps
- **Scope** — Domain boundaries
- **Guidance/Best-Practices** — Per-section rules
- **[REFERENCE]** — Cross-file links

This meta-structure applies to ALL skills.

---
## [2][DISCOVER]
>**Dictum:** *Discovery before reading prevents path errors.*

<br>

1. **List**: Run `eza .claude/skills/ --tree --git-ignore` (fallback: `ls -1 .claude/skills/`).
2. **Match**: Find skill folder matching input (fuzzy match acceptable).
3. **Map**: Use tree output to understand folder structure before reading.
4. **Check target**: If specific section requested, identify target (folder or H2 label).

[CRITICAL]:
- [ALWAYS] Discover available skills FIRST.
- [NEVER] Fail on imperfect skill name — match to actual folder.

---
## [3][READ]
>**Dictum:** *Read strategy depends on target specification.*

<br>

### [3.1][FULL_READ]

**When:** No specific section requested.

1. **SKILL.md**: Read completely — frontmatter, Dictum, Tasks, Scope, all H2 sections.
2. **references/**: If exists, read ALL `.md` files. Group nested folders.
3. **Other folders**: For each additional folder (templates/, scripts/, etc.), read all `.md` files.
4. **index.md**: If exists at root, read last for navigation context.

---
### [3.2][TARGETED_READ]

**When:** Specific section requested (e.g., `references`, `templates`, `validation`).

**Folder target** (`references`, `templates`, etc.):
1. Read SKILL.md frontmatter + H1 for context.
2. Read ALL `.md` files in target folder only.
3. Skip other folders.

**H2 section target** (e.g., `validation`, `frontmatter`, `usage`):
1. Read SKILL.md.
2. Match H2 header: `## [N][LABEL]` (case-insensitive on LABEL).
3. Extract matched section through next `## ` or EOF.
4. Include frontmatter + H1 Dictum for context.

[CRITICAL]:
- [ALWAYS] Read SKILL.md completely before other files (full read).
- [ALWAYS] Preserve constraint markers (`[CRITICAL]`, `[NEVER]`, `[ALWAYS]`).
- [NEVER] Omit information — optimize density, not deletion.

---
## [4][OUTPUT]
>**Dictum:** *Canonical structure with dynamic folder sections.*

<br>

**Full read output:**
```markdown
# [H1][{SKILL_NAME}]
{frontmatter: name, type, depth, description}
{Dictum from H1}
{Tasks list}
{Scope block if present}

## [1][{SECTION_NAME}]
{Each H2 section from SKILL.md — preserve Guidance, Best-Practices}

## [2][REFERENCES]
{If references/ exists}

## [3][{FOLDER}]
{Each additional folder found}

## [N][SOURCES]
{All file paths read}
```

**Targeted read output:**
```markdown
# [H1][{SKILL_NAME}_{TARGET}]
{frontmatter: name, description (brief)}
{H1 Dictum for context}

## [1][{TARGET}]
{Extracted content}

## [2][SOURCES]
{File paths read}
```

[IMPORTANT]:
- Simple skills (SKILL.md only) → `# [H1][SKILL]` + `## [1][SOURCES]`.
- Targeted reads include skill identity for context.

---
## [5][CONSTRAINTS]
>**Dictum:** *Boundaries prevent scope violations.*

<br>

[CRITICAL]:
- [NEVER] Modify files — read-only operation.
- [NEVER] Skip style-standards context load.
- [NEVER] Summarize by deletion — compress by density.
- [ALWAYS] Include `[SOURCES]` section with all file paths read.
