# [H1][FRONTMATTER]
>**Dictum:** *Schema and trigger optimization for skill discovery.*

<br>

[IMPORTANT] Frontmatter indexed at session start. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Two Claude Code fields; two classification fields.*

<br>

| [INDEX] | [FIELD]       | [TYPE] | [REQ]  | [CONSTRAINT]                                              |
| :-----: | ------------- | ------ | :----: | --------------------------------------------------------- |
|   [1]   | `name`        | string |  Yes   | Lowercase+numbers+hyphens, max 64, no XML, no reserved^1^ |
|   [2]   | `description` | string |  Yes   | Non-empty, max 1024 chars, no XML tags                    |
|   [3]   | `type`        | enum   | Yes^2^ | `simple` \| `standard` \| `complex`                       |
|   [4]   | `depth`       | enum   | Yes^2^ | `base` \| `extended` \| `full`                            |
|   [5]   | `model`       | string |   No   | `opus*`, `sonnet`, `haiku`, or `inherit`                  |

^1^Reserved words: "anthropic", "claude" — registration fails if present.
^2^Required by skill-builder for refine workflow. Not required by Claude Code itself.

[CRITICAL]:
- [NEVER] Use `allowed-tools`—strictly forbidden.
- [ALWAYS] Include `type` and `depth`—enables refine workflow classification detection.

<br>

### [1.1][NAME]
>**Dictum:** *Identifier enables registration and folder matching.*

<br>

| [INDEX] | [VALID]         | [INVALID]       |
| :-----: | --------------- | --------------- |
|   [1]   | `pdf-processor` | `PDF_Processor` |
|   [2]   | `mcp-builder`   | `mcp.builder`   |
|   [3]   | `code-reviewer` | `code reviewer` |

**Naming Form:**<br>
- *Gerund (preferred):* `processing-pdfs`, `analyzing-data`, `building-agents`
- *Noun phrase:* `pdf-processing`, `data-analysis`, `agent-builder`
- *Action verb:* `process-pdfs`, `analyze-data`, `build-agents`

[IMPORTANT]:
- [ALWAYS] Lowercase letters, numbers, hyphens only.
- [ALWAYS] Match containing folder name exactly.

[CRITICAL]:
- [NEVER] XML tags (`<tag>`, `</tag>`) in name field.
- [NEVER] Reserved words: `anthropic`, `claude`.
- [NEVER] Vague names: `helper`, `utils`, `tools`, `misc`.

---
### [1.2][TYPE]
>**Dictum:** *Type gates folder structure.*

<br>

| [INDEX] | [VALUE]    | [FOLDERS]                          | [USE CASE]           |
| :-----: | ---------- | ---------------------------------- | -------------------- |
|   [1]   | `simple`   | SKILL.md only                      | Focused, single-file |
|   [2]   | `standard` | +references/, templates/, index.md | Multi-domain         |
|   [3]   | `complex`  | +scripts/                          | Automation-enabled   |

[IMPORTANT] Type matches folder structure. Mismatch blocks validation.

---
### [1.3][DEPTH]
>**Dictum:** *Depth gates LOC and nesting.*

<br>

| [INDEX] | [VALUE]    | [SKILL.MD] | [REF_FILE] | [NESTING]      |
| :-----: | ---------- | :--------: | :--------: | -------------- |
|   [1]   | `base`     |    <300    |    <150    | Flat only      |
|   [2]   | `extended` |    <350    |    <175    | 1 subfolder    |
|   [3]   | `full`     |    <400    |    <200    | 1-3 subfolders |

[IMPORTANT] Depth matches LOC and nesting. Exceeding limits requires refactoring.

---
### [1.4][DESCRIPTION]
>**Dictum:** *Trigger sentence determines discovery.*

<br>

[CRITICAL] Description is PRIMARY discovery mechanism. LLM reasoning matches user intent—no embeddings, no keyword matching.

**Voice Requirements:**<br>
- *Third person:* "Analyzes..." not "I analyze" or "You can analyze".
- *Active voice:* "Retrieves data" not "Data can be retrieved".
- *Present tense:* "Creates..." not "Will create...".
- *No hedging:* Prohibit "might", "could", "typically".

**Structure Pattern:**<br>
`[Capability statement]. Use when [trigger 1], [trigger 2], or [trigger 3].`

**Token Economics:**<br>
- *Startup load:* ~100 tokens (name + description only).
- *Trigger load:* SKILL.md body on relevance match. Keep <500 lines.
- *Challenge:* "Does Claude need this? Does this token justify its cost?"

[CRITICAL]:
- [NEVER] XML tags (`<tag>`, `</tag>`) in description field.

---
## [2][TRIGGERS]
>**Dictum:** *Explicit triggers maximize discovery accuracy.*

<br>

### [2.1][PATTERNS]
>**Dictum:** *Proven patterns improve matching.*

<br>

| [INDEX] | [PATTERN]            | [EXAMPLE]                                    | [MECHANISM]               |
| :-----: | -------------------- | -------------------------------------------- | ------------------------- |
|   [1]   | "Use when" clause    | `Use when building MCP servers`              | Direct activation signal  |
|   [2]   | Enumerated scenarios | `(1) creating, (2) modifying, (3) analyzing` | Parallel pattern matching |
|   [3]   | Technology embedding | `Python (FastMCP) or TypeScript (SDK)`       | Framework-specific        |
|   [4]   | File extension       | `working with PDF files (.pdf)`              | Path-based triggering     |
|   [5]   | Temporal trigger     | `before writing implementation code`         | Workflow position signal  |
|   [6]   | Catch-all            | `or any other document tasks`                | Broadens applicability    |

---
### [2.2][ANTI_PATTERNS]
>**Dictum:** *Common failures reduce discoverability.*

<br>

| [INDEX] | [ANTI_PATTERN]       | [PROBLEM]                        | [FIX]                           |
| :-----: | -------------------- | -------------------------------- | ------------------------------- |
|   [1]   | Vague description    | `Helps with documents`           | Add specifics + "Use when"      |
|   [2]   | Implementation focus | `Uses Python library docx-js...` | Describe WHEN, not HOW          |
|   [3]   | First/second person  | `I help you create...`           | Third person: "Creates..."      |
|   [4]   | Missing file types   | `Work with Word documents`       | Include extension: `(.docx)`    |
|   [5]   | Name restating       | `PDF processor for PDFs`         | Describe triggers, not identity |
|   [6]   | No catch-all         | Only lists 3 specific scenarios  | Add "or related tasks"          |

---
## [3][SYNTAX]
>**Dictum:** *YAML parsing constraints prevent registration failure.*

<br>

| [INDEX] | [CONSTRAINT]             | [VIOLATION]                | [RESULT]                 |
| :-----: | ------------------------ | -------------------------- | ------------------------ |
|   [1]   | `---` on line 1          | Content before delimiter   | Skill not discovered     |
|   [2]   | `---` closes on own line | Missing closing delimiter  | YAML parse failure       |
|   [3]   | Spaces only (no tabs)    | Tab indentation            | Parse error              |
|   [4]   | Quote special characters | Unquoted `: # @ \| >`      | Field value corrupted    |
|   [5]   | Name matches folder      | `name` differs from folder | Registration failure     |
|   [6]   | Use `>-` for multi-line  | Literal scalar `\|`        | Discovery indexing error |

**Multi-line:** Folded scalar `>-` renders as single line.

```yaml
description: >-
  Comprehensive document processing with support for extraction,
  transformation, and validation. Use when working with PDF files,
  Word documents, or spreadsheets.
```

---
## [4][EXAMPLES]
>**Dictum:** *Canonical patterns demonstrate optimization.*

<br>

```yaml
# Simple/Base:
---
name: generating-commit-messages
type: simple
depth: base
description: Generates clear commit messages from git diffs. Use when writing commit messages or reviewing staged changes.
---

# Standard/Base:
---
name: pdf-processing
type: standard
depth: base
description: Extract text, fill forms, merge PDFs. Use when working with PDF files (.pdf) for: (1) text extraction, (2) form filling, (3) document merging, or any other PDF tasks.
---

# Standard/Full:
---
name: skill-builder
type: standard
depth: full
description: Create and manage Claude Code skills following best practices. Use when creating new skills, understanding trigger patterns, working with frontmatter, debugging skill activation, or implementing progressive disclosure.
---
```

---
## [5][VALIDATION]
>**Dictum:** *Gate checklist prevents discovery failures.*

<br>

[VERIFY] Pre-deployment:
- [ ] Delimiters: `---` line 1; closing `---` before markdown.
- [ ] `name`: lowercase+hyphens; max 64 chars; matches folder.
- [ ] `name`: no XML tags; no reserved words (`anthropic`, `claude`).
- [ ] `description`: non-empty; max 1024 chars; no XML tags.
- [ ] `description`: third person, active, present tense; no hedging.
- [ ] `description`: "Use when" clause + file types/extensions.
- [ ] `type`: valid enum; matches folder structure.
- [ ] `depth`: valid enum; matches LOC and nesting.
- [ ] SKILL.md body: <500 lines for optimal performance.
- [ ] Syntax: spaces only; special characters quoted; `>-` for multi-line.
