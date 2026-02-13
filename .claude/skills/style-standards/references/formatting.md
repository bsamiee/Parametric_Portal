# [H1][FORMATTING]
>**Dictum:** *Visual topology defines semantic boundaries.*

<br>

[IMPORTANT] Layout primitives encode document hierarchy. Whitespace: semantic, not cosmetic.

---
## [1][DEPTH]
>**Dictum:** *Depth encodes document granularity.*

<br>

**H1 `[H1][LABEL]`** -- Single semantic identity; File Truth.<br>
**H2 `[N][LABEL]`** -- Smallest chunk agent reads.<br>
**H3 `[N.M][LABEL]`** -- Nesting limit.

[CRITICAL] H4, H5, H6 prohibited. Require H4 -> create new file.

---
## [2][LISTS]
>**Dictum:** *List type signals execution mode.*

<br>

**Numbered (`1.`)** -- Sequence/Priority. Triggers linear execution.<br>
**Bullet (`-`)** -- Equivalence/Sets. Triggers parallel processing.

---
## [3][SEPARATORS]
>**Dictum:** *Separators encode transition type.*

| [INDEX] |  [TRANSITION]  | [SEPARATOR] | [SEMANTIC]                          |
| :-----: | :------------: | :---------: | ----------------------------------- |
|   [1]   |    H1 -> H2    |    `---`    | Hard boundary into subsections.     |
|   [2]   |    H2 -> H2    |    `---`    | Hard boundary between sections.     |
|   [3]   |    H2 -> H3    |   `<br>`    | Soft transition into subsections.   |
|   [4]   |    H3 -> H3    |    `---`    | Sibling boundary within section.    |
|   [5]   |  Code -> Code  |   Divider   | Hard boundary between code regions. |
|   [6]   | Hn -> Hm (n>m) |    `---`    | Ascending hierarchy reset.          |

[IMPORTANT]:
- [ALWAYS] `<br>` after Dictum, Preamble, and diagrams (mermaid fences).
- [ALWAYS] Inline `<br>` for 2-3 related items -- no blank lines between.

[CRITICAL]:
- [NEVER] `---` between H2 and first H3.
- [NEVER] `<br>` between sibling H3s.
- [NEVER] Blank lines between consecutive related statements -- use inline `<br>`.

---
## [4][HEADERS]
>**Dictum:** *Format anchors semantic scope.*

| [INDEX] | [LEVEL] | [FORMAT]                 | [SCOPE]             |
| :-----: | :-----: | ------------------------ | ------------------- |
|   [1]   |   H1    | `# [H1][LABEL]`          | Document Root Only. |
|   [2]   |   H2    | `## [N][LABEL]`          | Primary Section.    |
|   [3]   |   H3    | `### [N.M][LABEL]`       | Atomic Subsection.  |
|   [4]   | Divider | `// --- [LABEL] ---`[^1] | Code Section.       |

[^1]: Pad with dashes to column 80. Comment delimiter is language-dependent.

**Canonical Code Section Order** (omit unused): TYPES -> SCHEMA -> CONSTANTS -> ERRORS -> SERVICES -> FUNCTIONS -> LAYERS -> EXPORT.<br>
**Domain Extensions:** TABLES (after SCHEMA), REPOSITORIES (after SERVICES), GROUPS (after SCHEMA), MIDDLEWARE (after SERVICES).<br>
**Forbidden Labels:** `Helpers`, `Handlers`, `Utils`, `Config`, `Dispatch_Tables`.

[IMPORTANT]:
- [ALWAYS] Strict bracket syntax; sigils use `_` for compound words.
- [ALWAYS] `.claude/` infrastructure exception: H1 label uses kebab-case matching parent folder/file. Example: `# [H1][STYLE-STANDARDS]`.

[CRITICAL]:
- [NEVER] Skip header levels. H1 -> H2 -> H3 strictly sequential.

---
## [5][SPACING]
>**Dictum:** *Whitespace encodes boundaries.*

| [INDEX] | [ELEMENT]     | [RULE]                                  |
| :-----: | ------------- | --------------------------------------- |
|   [1]   | After header  | 1 blank line.                           |
|   [2]   | After `<br>`  | 1 blank line.                           |
|   [3]   | Around tables | 1 blank line each side.                 |
|   [4]   | Around fences | 1 blank line each side.                 |
|   [5]   | After `---`   | No blank line -- header directly below. |
|   [6]   | List items    | No blank lines between.                 |
|   [7]   | Code Divider  | 1 blank line before and after.          |

---
## [6][CASE_AND_PUNCTUATION]
>**Dictum:** *Case and punctuation signal semantic category.*

| [INDEX] | [CONTEXT]     | [RULE]                                   |
| :-----: | ------------- | ---------------------------------------- |
|   [1]   | Sigils        | UPPERCASE: `[IMPORTANT]`, `[CODE_FLOW]`  |
|   [2]   | Keywords      | UPPERCASE: `MUST`, `NEVER`, `ALWAYS`     |
|   [3]   | Table Rubrics | UPPERCASE: `[INDEX]`, `[TERM]`           |
|   [4]   | Section Label | UPPERCASE: `// --- [CLASSES] ---`        |
|   [5]   | Table Cells   | Title Case: `Sigil Content`              |
|   [6]   | File Names    | kebab-case: `voice.md`, `pr-hygiene.ts`  |
|   [7]   | `.`           | Required on every instruction/statement. |
|   [8]   | `:`           | No space before, one space after.        |
|   [9]   | `—`           | Inline elaboration marker.               |
|  [10]   | `→`           | Surround with spaces ` -> `.             |
|  [11]   | `` ` ``       | Wrap code identifiers.                   |
|  [12]   | `;`           | Joins related independent clauses.       |
|  [13]   | `?`           | Terminal position only.                  |

---
## [7][TABLES]
>**Dictum:** *Alignment optimizes scanning.*

**Alignment:** Center index, right numeric, left prose, center short labels (<=10 chars).

[IMPORTANT]:
- [ALWAYS] Include `[INDEX]` column. Use sigil format `[HEADER]` UPPERCASE. Bold first column.

---
## [8][CODE_SPANS]
>**Dictum:** *Inline code syntax determines parser interpretation.*

| [INDEX] | [CONTEXT]              | [CORRECT]                 | [ANTI_PATTERN]           |
| :-----: | ---------------------- | ------------------------- | ------------------------ |
|   [1]   | Bash execution syntax  | `<code>!\`cmd\`</code>`   | `` `!`cmd` `` (triggers) |
|   [2]   | File references        | `<code>@path</code>`      | `` `@path` ``            |
|   [3]   | Variable interpolation | `<code>$ARGUMENTS</code>` | `` `$ARGUMENTS` ``       |

[CRITICAL]:
- [NEVER] Double-backticks around executable syntax.
- [ALWAYS] HTML `<code>` tags with escaped backticks for executable documentation.

---
## [9][EXAMPLE]
>**Dictum:** *Example demonstrates standard application.*

```markdown
# [H1][DOCUMENT_TITLE]
>**Dictum:** *Document purpose statement.*

<br>

[IMPORTANT] Preamble -- establishes entry context.

---
## [1][FIRST_SECTION]
>**Dictum:** *Section purpose.*

<br>

| [INDEX] | [RATE] | [COUNT] |
| :-----: | :----: | ------: |
|   [1]   |  95%   |     128 |

[CRITICAL] Reinforces constraint at exit.

<br>

### [1.1][SUBSECTION]

**Term A** -- First definition.<br>
**Term B** -- Second definition.

---
## [2][SECOND_SECTION]
>**Dictum:** *Second section purpose.*

<br>

[IMPORTANT]:
1. [ALWAYS] **Validation:** Verify inputs.

[CRITICAL]:
- [NEVER] Skip validation on untrusted input.
```
