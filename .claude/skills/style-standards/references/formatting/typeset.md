# [H1][TYPESET]
>**Dictum:** *Typography enforces visual consistency.*

<br>

---
## [1][CASE]
>**Dictum:** *Case signals semantic category.*

| [INDEX] | [CONTEXT]     | [CASE]     | [EXAMPLE]                           |
| :-----: | ------------- | ---------- | ----------------------------------- |
|   [1]   | Sigil Content | UPPERCASE  | `[IMPORTANT]`, `[CODE_FLOW]`        |
|   [2]   | Keyword       | UPPERCASE  | `MUST`, `NEVER`, `ALWAYS`           |
|   [3]   | Table Rubric  | UPPERCASE  | `[INDEX]`, `[TERM]`, `[DEFINITION]` |
|   [4]   | Section Label | UPPERCASE  | `// --- [PURE_FUNCTIONS] ---`       |
|   [5]   | Table Cell    | Title Case | `Sigil Content`, `Factory Function` |
|   [6]   | File Name     | kebab-case | `voice.md`, `pr-hygiene.ts`         |

[IMPORTANT] UPPERCASE reserved for sigils, rubrics, keywords.

---
## [2][PUNCTUATION]
>**Dictum:** *Delimiters govern attention flow.*

| [INDEX] | [MARK]  | [RULE]                                    |
| :-----: | :-----: | ----------------------------------------- |
|   [1]   |   `.`   | Required on every instruction/statement.  |
|   [2]   |   `:`   | No space before, one space after.         |
|   [3]   |   `—`   | Inline elaboration marker.                |
|   [4]   |   `→`   | Surround with spaces ` → `.               |
|   [5]   | `` ` `` | Wrap code identifiers.                    |
|   [6]   |   `;`   | Joins related independent clauses.        |
|   [7]   |   `?`   | Terminal position only. Actual questions. |

[REFERENCE] Cognitive effects and variance metrics: [→grammar.md§1[PUNCTUATION]](../voice/grammar.md#1punctuation)

---
## [3][TABLES]
>**Dictum:** *Alignment optimizes scanning.*

| [INDEX] | [COLUMN_TYPE] | [ALIGNMENT] | [RATIONALE]              |
| :-----: | ------------- | :---------: | ------------------------ |
|   [1]   | Index `[#]`   |   Center    | Visual anchor.           |
|   [2]   | Numeric       |    Right    | Decimal alignment.       |
|   [3]   | Text/prose    |    Left     | Reading direction.       |
|   [4]   | Short labels  |   Center    | Categorical (≤10 chars). |

[IMPORTANT]:
- [ALWAYS] **Index:** Include `[INDEX]` column for all enumerable tables.
- [ALWAYS] **Headers:** Use sigil format `[HEADER]` with UPPERCASE.
- [ALWAYS] **Emphasis:** Bold first column for category emphasis.

---
## [4][CODE_SPANS]
>**Dictum:** *Inline code syntax determines parser interpretation.*

<br>

| [INDEX] | [CONTEXT]              | [CORRECT]                 | [ANTI_PATTERN]           |
| :-----: | ---------------------- | ------------------------- | ------------------------ |
|   [1]   | Bash execution syntax  | `<code>!\`cmd\`</code>`   | `` `!`cmd` `` (triggers) |
|   [2]   | File references        | `<code>@path</code>`      | `` `@path` ``            |
|   [3]   | Variable interpolation | `<code>$ARGUMENTS</code>` | `` `$ARGUMENTS` ``       |

[CRITICAL]:
- [NEVER] Use double-backticks around executable syntax (`` `!`cmd` ``).
- [ALWAYS] Use HTML `<code>` tags with escaped backticks for executable documentation.

Parser interprets double-backtick patterns as execution requests, causing skill loading failures.
