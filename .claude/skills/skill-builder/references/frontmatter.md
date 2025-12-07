# [H1][FRONTMATTER]
>**Dictum:** *Metadata quality determines invocation accuracy.*

<br>

[IMPORTANT] Frontmatter indexed at session start. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Two Claude Code fields; two classification fields.*

<br>

| [FIELD]       | [TYPE] | [REQ]  | [CONSTRAINT]                                              |
| ------------- | ------ | :----: | --------------------------------------------------------- |
| `name`        | string |  Yes   | Lowercase+numbers+hyphens, max 64, no XML, no reserved^1^ |
| `description` | string |  Yes   | Non-empty, max 1024 chars, no XML tags                    |
| `type`        | enum   | Yes^2^ | `simple`, `standard`,`complex` — see structure.md         |
| `depth`       | enum   | Yes^2^ | `base`,`extended`,`full` — see depth.md                   |
| `model`       | string |   No   | `opus*`, `sonnet`, `haiku`, or `inherit`                  |

^1^Reserved: "anthropic", "claude" — registration fails.
^2^Required by skill-builder for refine workflow.

[CRITICAL]:
- [NEVER] Use `allowed-tools`—strictly forbidden.
- [ALWAYS] Include `type` and `depth`—enables refine classification.

---
### [1.1][NAME]
>**Dictum:** *Identifier enables registration and folder matching.*

<br>

| [VALID]         | [INVALID]       |
| --------------- | --------------- |
| `pdf-processor` | `PDF_Processor` |
| `mcp-builder`   | `mcp.builder`   |
| `code-reviewer` | `code reviewer` |

**Naming Form:** Gerund preferred (`processing-pdfs`), noun phrase (`pdf-processing`), or action verb (`process-pdfs`).

[IMPORTANT]:
- [ALWAYS] Lowercase letters, numbers, hyphens only.
- [ALWAYS] Match containing folder name exactly.

[CRITICAL]:
- [NEVER] XML tags, reserved words (`anthropic`, `claude`), vague names (`helper`, `utils`).

---
### [1.2][DESCRIPTION]
>**Dictum:** *Trigger sentence determines discovery.*

<br>

[CRITICAL] Description is PRIMARY discovery mechanism. LLM reasoning matches user intent—no embeddings, no keyword matching.

**Voice:** Third person, active, present tense. Prohibit: "might", "could", "typically".<br>
**Structure:** `[Capability statement]. Use when [trigger 1], [trigger 2], or [trigger 3].`<br>
**Token Economics:** ~100 tokens at startup (name + description only). SKILL.md loads on relevance match.

---
## [2][TRIGGERS]
>**Dictum:** *Explicit triggers maximize discovery accuracy.*

<br>

### [2.1][PATTERNS]

| [PATTERN]            | [EXAMPLE]                                    | [MECHANISM]               |
| -------------------- | -------------------------------------------- | ------------------------- |
| "Use when" clause    | `Use when building MCP servers`              | Direct activation signal  |
| Enumerated scenarios | `(1) creating, (2) modifying, (3) analyzing` | Parallel pattern matching |
| Technology embedding | `Python (FastMCP) or TypeScript (SDK)`       | Framework-specific        |
| File extension       | `working with PDF files (.pdf)`              | Path-based triggering     |
| Catch-all            | `or any other document tasks`                | Broadens applicability    |

### [2.2][ANTI_PATTERNS]

| [ANTI_PATTERN]       | [PROBLEM]                        | [FIX]                        |
| -------------------- | -------------------------------- | ---------------------------- |
| Vague description    | `Helps with documents`           | Add specifics + "Use when"   |
| Implementation focus | `Uses Python library docx-js...` | Describe WHEN, not HOW       |
| First/second person  | `I help you create...`           | Third person: "Creates..."   |
| Missing file types   | `Work with Word documents`       | Include extension: `(.docx)` |

---
## [3][SYNTAX]
>**Dictum:** *YAML parsing constraints prevent registration failure.*

<br>

| [CONSTRAINT]             | [VIOLATION]                | [RESULT]              |
| ------------------------ | -------------------------- | --------------------- |
| `---` on line 1          | Content before delimiter   | Skill not discovered  |
| `---` closes on own line | Missing closing delimiter  | YAML parse failure    |
| Spaces only (no tabs)    | Tab indentation            | Parse error           |
| Quote special characters | Unquoted `: # @ \| >`      | Field value corrupted |
| Name matches folder      | `name` differs from folder | Registration failure  |
| Use `>-` for multi-line  | Literal scalar `\|`        | Indexing error        |

**Multi-line:** Folded scalar `>-` renders as single line:
```yaml
description: >-
  Comprehensive document processing. Use when working with PDF files,
  Word documents, or spreadsheets.
```

[REFERENCE] Frontmatter validation checklist: [→validation.md§2](./validation.md#2frontmatter)
