# [H1][CONFIGURATION]
>**Dictum:** *Hierarchical scope governance ensures response style consistency.*

<br>

[IMPORTANT] Configuration hierarchy: global (1) → project (2) → skill (3) → agent (4) → command (5). Higher precedence overrides lower.

[CRITICAL] **DELEGATE** Voice, formatting, constraint rules → `style-standards` skill. Scope hierarchy and embedding patterns covered here.

---
## [1][HIERARCHY]
>**Dictum:** *Five-level scope hierarchy enables granular control.*

<br>

| [INDEX] | [SCOPE] | [LOCATION]                | [PRECEDENCE] | [USE_CASE]           |
| :-----: | ------- | ------------------------- | :----------: | -------------------- |
|   [1]   | Global  | CLAUDE.md                 |      1       | All Claude responses |
|   [2]   | Project | PROJECT.md                |      2       | Project override     |
|   [3]   | Skill   | .claude/skills/*/SKILL.md |      3       | Skill-specific       |
|   [4]   | Agent   | .claude/agents/*.md       |      4       | Agent-specific       |
|   [5]   | Command | .claude/commands/*.md     |      5       | Command-specific     |

**Inheritance:** Base + override merge. Higher precedence wins on conflict.

---
## [2][GLOBAL]
>**Dictum:** *Global defaults require single source configuration.*

<br>

**Location:** `/CLAUDE.md` → `## [N][OUTPUT]` section.

**Constraints:**<br>
- 50-100 LOC for output section.
- Position weight-10 constraints first.
- Reference external files for content exceeding 100 LOC.

**Pattern:**
```markdown
## [4][OUTPUT]
>**Dictum:** *Output format optimizes readability.*

<br>

[IMPORTANT]:
- [ALWAYS] Use `backticks` for file paths, symbols, CLI commands.
- [ALWAYS] Avoid large code blocks—reference file/symbol names.
- [ALWAYS] Markdown: headings for structure, bullets for lists.

[CRITICAL]:
- [NEVER] Use emojis—use `[X]` style markers.
- [NEVER] Meta-commentary: "Sourced from...", "Confirmed with...".
```

[REFERENCE] Voice rules → `style-standards/references/voice/grammar.md`.

---
## [3][PROJECT]
>**Dictum:** *Specialized contexts require project-level overrides.*

<br>

**Location:** `PROJECT.md` or project-specific `.claude/` directories.

**Constraints:**<br>
- Inherit from global CLAUDE.md.
- Document divergence reason explicitly.
- Maximum 30 LOC for override section.

**Pattern:**
```markdown
## [OUTPUT]
>**Dictum:** *API output requires JSON format.*

<br>

[IMPORTANT] Override: All API responses use minified JSON.
- Rationale: Integration partners require machine-parseable output.
```

---
## [4][SKILL_AGENT]
>**Dictum:** *Skill/agent scope isolation enables task-specific output.*

<br>

**Location:** SKILL.md body preamble or agent frontmatter + body.

**Embedding Patterns:**<br>
- *Inline:* Embed full spec in body (single-use).
- *Reference:* `@.claude/styles/{name}.md` (3+ consumers).

**Reference Pattern:**
```markdown
---
name: agent-name
tools: Read, ...
---

[Purpose statement]

**Output Format:** @.claude/styles/{format-name}.md

---
## [1][PROCESS]
```

[IMPORTANT]:
- Include `Read` in agent `tools:` frontmatter for reference pattern.
- Embed format reference in body preamble. Exclude from H2 sections.

---
## [5][COMMAND]
>**Dictum:** *Narrowest scope enables single invocation specialization.*

<br>

**Location:** Command `## [N][AGENT_PROMPT_TEMPLATE]` section.

**Pattern:**
```markdown
## [5][AGENT_PROMPT_TEMPLATE]

@.claude/styles/report.md

[Command-specific instructions...]
```

**Use Case:** Specialized output for single command invocation (reports, API responses, templates).

---
## [6][STORAGE]
>**Dictum:** *Distinct storage directories enable format-style separation.*

<br>

| [INDEX] | [DIRECTORY]              | [SCOPE]     | [CONTENT]                  |
| :-----: | ------------------------ | ----------- | -------------------------- |
|   [1]   | `.claude/styles/`        | Agent-level | Data format definitions    |
|   [2]   | `.claude/output-styles/` | Global      | Response style definitions |

**`.claude/styles/`** — Structured data formats (JSON schema, Markdown-KV, YAML). Embedded via `@` in agent/command body.<br>
**`.claude/output-styles/`** — Prose response styles (voice, tone, structure). Referenced from CLAUDE.md or standalone.

[REFERENCE] Validation checklist: [→validation.md§2](./validation.md#2configuration_gate)
