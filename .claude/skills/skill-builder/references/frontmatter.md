# [H1][FRONTMATTER]
>**Dictum:** *Metadata quality determines invocation accuracy.*

<br>

[IMPORTANT] Frontmatter indexed at session start. Description quality determines invocation accuracy.

---
## [1][SCHEMA]
>**Dictum:** *Eleven Claude Code fields; two skill-builder classification fields.*

<br>

| [INDEX] | [FIELD]                    | [TYPE]  | [REQ]  | [DEFAULT] | [CONSTRAINT]                                              |
| :-----: | -------------------------- | ------- | :----: | :-------: | --------------------------------------------------------- |
|   [1]   | `name`                     | string  |  Yes   |  dirname  | Lowercase+numbers+hyphens, max 64, no XML, no reserved^1^ |
|   [2]   | `description`              | string  |  Rec   |  para 1   | Non-empty, max 1024 chars, no XML tags                    |
|   [3]   | `type`                     | enum    | Yes^2^ |     —     | `simple`, `standard`, `complex` — see structure.md        |
|   [4]   | `depth`                    | enum    | Yes^2^ |     —     | `base`, `extended`, `full` — see depth.md                 |
|   [5]   | `argument-hint`            | string  |   No   |     —     | Autocomplete hint: `[required]` `[optional?]`             |
|   [6]   | `disable-model-invocation` | boolean |   No   |  `false`  | `true` prevents Claude auto-loading, user-only invocation |
|   [7]   | `user-invocable`           | boolean |   No   |  `true`   | `false` hides from `/` menu, Claude-only invocation       |
|   [8]   | `allowed-tools`            | list    |   No   |     —     | Comma-separated tools permitted without approval          |
|   [9]   | `model`                    | string  |   No   | `inherit` | `opus`, `sonnet`, `haiku`, or `inherit`                   |
|  [10]   | `context`                  | enum    |   No   |     —     | `fork` — run skill in isolated subagent context           |
|  [11]   | `agent`                    | string  |   No   | general   | Subagent type when `context: fork` set                    |
|  [12]   | `hooks`                    | object  |   No   |     —     | Scoped lifecycle hooks (all 14 event types supported)     |
|  [13]   | `version`                  | string  |   No   |     —     | Metadata for tracking skill versions (e.g., `"1.0.0"`)   |

^1^Reserved: "anthropic", "claude" — registration fails.
^2^Required by skill-builder for refine workflow; not required by Claude Code itself.

---
### [1.1][INVOCATION_CONTROL]
>**Dictum:** *Two boolean fields gate who can invoke a skill.*

<br>

| [FRONTMATTER]                      | [USER] | [CLAUDE] | [CONTEXT_LOADING]                                |
| :--------------------------------- | :----: | :------: | :----------------------------------------------- |
| (default)                          |  Yes   |   Yes    | Description always loaded; full skill on invoke  |
| `disable-model-invocation: true`   |  Yes   |    No    | Description NOT in context; loads on user invoke |
| `user-invocable: false`            |   No   |   Yes    | Description always loaded; full skill on invoke  |

[IMPORTANT] `user-invocable` controls menu visibility only, NOT Skill tool access. Use `disable-model-invocation: true` to block programmatic invocation.

---
### [1.2][NAME]
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
- [ALWAYS] Match containing folder name exactly. Omitting `name` defaults to dirname.

[CRITICAL]:
- [NEVER] XML tags, reserved words (`anthropic`, `claude`), vague names (`helper`, `utils`).

---
### [1.3][DESCRIPTION]
>**Dictum:** *Trigger sentence determines discovery.*

<br>

[CRITICAL] Description is PRIMARY discovery mechanism. LLM reasoning matches user intent — no embeddings, no keyword matching.

**Voice:** Third person, active, present tense. Prohibit: "might", "could", "typically".<br>
**Structure:** `[Capability statement]. Use when [trigger 1], [trigger 2], or [trigger 3].`<br>
**Token Economics:** ~100 tokens at startup (name + description only). SKILL.md loads on relevance match.

---
## [2][SUBSTITUTIONS]
>**Dictum:** *Dynamic values enable reusable skill content.*

<br>

| [INDEX] | [VARIABLE]             | [DESCRIPTION]                                                          |
| :-----: | ---------------------- | ---------------------------------------------------------------------- |
|   [1]   | `$ARGUMENTS`           | All text after `/skill-name`; appended as `ARGUMENTS:` if not present  |
|   [2]   | `$ARGUMENTS[N]`        | 0-based positional access: `$ARGUMENTS[0]` = first arg                 |
|   [3]   | `$N`                   | Shorthand for `$ARGUMENTS[N]`: `$0` = first, `$1` = second            |
|   [4]   | `${CLAUDE_SESSION_ID}` | Current session ID for logging or session-specific files               |
|   [5]   | `` !`command` ``       | Shell preprocessing — command output replaces placeholder before Claude sees it |

[IMPORTANT]:
- [ALWAYS] Use `$ARGUMENTS` for free-form input; `$ARGUMENTS[N]` for structured multi-arg.
- [ALWAYS] If `$ARGUMENTS` is absent from skill content, args are appended as `ARGUMENTS: <value>`.

---
## [3][TRIGGERS]
>**Dictum:** *Explicit triggers maximize discovery accuracy.*

<br>

### [3.1][PATTERNS]

| [INDEX] | [PATTERN]            | [EXAMPLE]                                    | [MECHANISM]               |
| :-----: | -------------------- | -------------------------------------------- | ------------------------- |
|   [1]   | "Use when" clause    | `Use when building MCP servers`              | Direct activation signal  |
|   [2]   | Enumerated scenarios | `(1) creating, (2) modifying, (3) analyzing` | Parallel pattern matching |
|   [3]   | Technology embedding | `Python (FastMCP) or TypeScript (SDK)`       | Framework-specific        |
|   [4]   | File extension       | `working with PDF files (.pdf)`              | Path-based triggering     |
|   [5]   | Catch-all            | `or any other document tasks`                | Broadens applicability    |

### [3.2][ANTI_PATTERNS]

| [INDEX] | [ANTI_PATTERN]       | [PROBLEM]                        | [FIX]                        |
| :-----: | -------------------- | -------------------------------- | ---------------------------- |
|   [1]   | Vague description    | `Helps with documents`           | Add specifics + "Use when"   |
|   [2]   | Implementation focus | `Uses Python library docx-js...` | Describe WHEN, not HOW       |
|   [3]   | First/second person  | `I help you create...`           | Third person: "Creates..."   |
|   [4]   | Missing file types   | `Work with Word documents`       | Include extension: `(.docx)` |

---
## [4][ALLOWED_TOOLS]
>**Dictum:** *Tool restriction scopes skill permissions.*

<br>

Available tool names for the `allowed-tools` field:

| [INDEX] | [TOOL]       | [CAPABILITY]                           |
| :-----: | ------------ | -------------------------------------- |
|   [1]   | `Read`       | Read file contents                     |
|   [2]   | `Glob`       | File pattern matching                  |
|   [3]   | `Grep`       | Content search with regex              |
|   [4]   | `Edit`       | String replacement in files            |
|   [5]   | `Write`      | Create or overwrite files              |
|   [6]   | `Bash`       | Execute shell commands                 |
|   [7]   | `Task`       | Spawn subagents                        |
|   [8]   | `WebFetch`   | Fetch and process URLs                 |
|   [9]   | `WebSearch`  | Web search                             |
|  [10]   | `NotebookEdit` | Edit Jupyter notebook cells          |
|  [11]   | `mcp__*`     | MCP server tools (regex pattern)       |

**Common patterns:**
- Read-only: `allowed-tools: Read, Glob, Grep`
- Write-capable: `allowed-tools: Read, Edit, Write, Glob, Grep, Bash`
- Scoped Bash: `allowed-tools: Bash(npm *), Bash(pnpm *)` — prefix matching

---
## [5][SYNTAX]
>**Dictum:** *YAML parsing constraints prevent registration failure.*

<br>

| [INDEX] | [CONSTRAINT]             | [VIOLATION]                | [RESULT]              |
| :-----: | ------------------------ | -------------------------- | --------------------- |
|   [1]   | `---` on line 1          | Content before delimiter   | Skill not discovered  |
|   [2]   | `---` closes on own line | Missing closing delimiter  | YAML parse failure    |
|   [3]   | Spaces only (no tabs)    | Tab indentation            | Parse error           |
|   [4]   | Quote special characters | Unquoted `: # @ | >`      | Field value corrupted |
|   [5]   | Name matches folder      | `name` differs from folder | Registration failure  |
|   [6]   | Use `>-` for multi-line  | Literal scalar `|`         | Indexing error        |

**Multi-line:** Folded scalar `>-` renders as single line:
```yaml
description: >-
  Comprehensive document processing. Use when working with PDF files,
  Word documents, or spreadsheets.
```

[REFERENCE] Frontmatter validation checklist: [->validation.md§2](./validation.md#2frontmatter)
