# [H1][FRONTMATTER]
>**Dictum:** *Metadata quality determines invocation accuracy.*

<br>

[IMPORTANT] Frontmatter indexed at session start. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Two Claude Code fields; two classification fields.*

<br>

| [INDEX] | [FIELD]          | [TYPE]  | [REQ]  | [CONSTRAINT]                                              |
| :-----: | ---------------- | ------- | :----: | --------------------------------------------------------- |
|   [1]   | `name`           | string  |  Yes   | Lowercase+numbers+hyphens, max 64, no XML, no reserved^1^ |
|   [2]   | `description`    | string  |  Yes   | Non-empty, max 1024 chars, no XML tags                    |
|   [3]   | `type`           | enum    | Yes^2^ | `simple`, `standard`, `complex` — see structure.md        |
|   [4]   | `depth`          | enum    | Yes^2^ | `base`, `extended`, `full` — see depth.md                 |
|   [5]   | `model`          | string  |   No   | `opus*`, `sonnet`, `haiku`, or `inherit`                  |
|   [6]   | `context`        | enum    |   No   | `fork` — isolated execution, no shared parent state       |
|   [7]   | `agent`          | string  |   No   | Execution agent type override                             |
|   [8]   | `user-invocable` | boolean |   No   | `false` hides from slash menu                             |
|   [9]   | `hooks`          | object  |   No   | Scoped PreToolUse, PostToolUse, Stop hooks                |

^1^Reserved: "anthropic", "claude" — registration fails.
^2^Required by skill-builder for refine workflow.

[CRITICAL]:
- [NEVER] Use `allowed-tools`—strictly forbidden.
- [ALWAYS] Include `type` and `depth`—enables refine classification.

---
### [1.1][NAME]
>**Dictum:** *Identifier enables registration and folder matching.*

<br>

| [INDEX] | [VALID]         | [INVALID]       |
| :-----: | --------------- | --------------- |
|   [1]   | `pdf-processor` | `PDF_Processor` |
|   [2]   | `mcp-builder`   | `mcp.builder`   |
|   [3]   | `code-reviewer` | `code reviewer` |

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

| [INDEX] | [PATTERN]            | [EXAMPLE]                                    | [MECHANISM]               |
| :-----: | -------------------- | -------------------------------------------- | ------------------------- |
|   [1]   | "Use when" clause    | `Use when building MCP servers`              | Direct activation signal  |
|   [2]   | Enumerated scenarios | `(1) creating, (2) modifying, (3) analyzing` | Parallel pattern matching |
|   [3]   | Technology embedding | `Python (FastMCP) or TypeScript (SDK)`       | Framework-specific        |
|   [4]   | File extension       | `working with PDF files (.pdf)`              | Path-based triggering     |
|   [5]   | Catch-all            | `or any other document tasks`                | Broadens applicability    |

### [2.2][ANTI_PATTERNS]

| [INDEX] | [ANTI_PATTERN]       | [PROBLEM]                        | [FIX]                        |
| :-----: | -------------------- | -------------------------------- | ---------------------------- |
|   [1]   | Vague description    | `Helps with documents`           | Add specifics + "Use when"   |
|   [2]   | Implementation focus | `Uses Python library docx-js...` | Describe WHEN, not HOW       |
|   [3]   | First/second person  | `I help you create...`           | Third person: "Creates..."   |
|   [4]   | Missing file types   | `Work with Word documents`       | Include extension: `(.docx)` |

---
## [3][SYNTAX]
>**Dictum:** *YAML parsing constraints prevent registration failure.*

<br>

| [INDEX] | [CONSTRAINT]             | [VIOLATION]                | [RESULT]              |
| :-----: | ------------------------ | -------------------------- | --------------------- |
|   [1]   | `---` on line 1          | Content before delimiter   | Skill not discovered  |
|   [2]   | `---` closes on own line | Missing closing delimiter  | YAML parse failure    |
|   [3]   | Spaces only (no tabs)    | Tab indentation            | Parse error           |
|   [4]   | Quote special characters | Unquoted `: # @ \| >`      | Field value corrupted |
|   [5]   | Name matches folder      | `name` differs from folder | Registration failure  |
|   [6]   | Use `>-` for multi-line  | Literal scalar `\|`        | Indexing error        |

**Multi-line:** Folded scalar `>-` renders as single line:
```yaml
description: >-
  Comprehensive document processing. Use when working with PDF files,
  Word documents, or spreadsheets.
```

[REFERENCE] Frontmatter validation checklist: [→validation.md§2](./validation.md#2frontmatter)
