# [H1][FORMATTING]
>**Dictum:** *Visual topology defines semantic boundaries.*

<br>

[IMPORTANT] Layout primitives encode document hierarchy. Whitespace: semantic, not cosmetic.

---
## [1][DEPTH]
>**Dictum:** *Depth encodes document granularity.*

<br>

**H1 `[H1][LABEL]`** — Single semantic identity—File Truth.<br>
**H2 `[N][LABEL]`** — Smallest chunk agent reads.<br>
**H3 `[N.M][LABEL]`** — Nesting limit.

[CRITICAL] H4, H5, H6 prohibited. Require H4 → create new file.

---
## [2][LISTS]
>**Dictum:** *List type signals execution mode.*

<br>

**Numbered (`1.`)** — Use for Sequence/Priority. Triggers linear execution.<br>
**Bullet (`-`)** — Use for Equivalence/Sets. Triggers parallel processing.

---
## [3][SEPARATORS]
>**Dictum:** *Separators encode transition type.*

| [INDEX] |  [TRANSITION]   | [SEPARATOR] | [SEMANTIC]                           |
| :-----: | :-------------: | :---------: | ------------------------------------ |
|   [1]   |     H1 → H1     |    None     | Implicit boundary; blank line only.  |
|   [2]   |     H1 → H2     |    `---`    | Hard boundary into subsections.      |
|   [3]   |     H2 → H2     |    `---`    | Hard boundary between sections.      |
|   [4]   |     H2 → H3     |   `<br>`    | Soft transition into subsections.    |
|   [5]   |     H3 → H3     |    `---`    | Sibling boundary within section.     |
|   [6]   |   Code → Code   |   Divider   | Hard boundary between code sections. |
|   [7]   | Hn → Hm (n > m) |    `---`    | Ascending hierarchy reset.           |

[IMPORTANT]:
- [ALWAYS] `<br>` after Dictum—separates anchor from content.
- [ALWAYS] `<br>` after Preamble—separates directive from body.
- [ALWAYS] `<br>` after diagrams (mermaid fences)—separates visual from continuation.
- [ALWAYS] Inline `<br>` for 2–3 related items (definitions, markers, statements)—no blank lines between.

[CRITICAL]:
- [NEVER] Place `---` between H2 and first H3.
- [NEVER] Place `<br>` between sibling H3s.
- [NEVER] Blank lines between consecutive related statements—use inline `<br>` instead.

---
## [4][HEADERS]
>**Dictum:** *Format anchors semantic scope.*

| [INDEX] | [LEVEL] | [FORMAT]                 | [SCOPE]             |
| :-----: | :-----: | ------------------------ | ------------------- |
|   [1]   |   H1    | `# [H1][LABEL]`          | Document Root Only. |
|   [2]   |   H2    | `## [N][LABEL]`          | Primary Section.    |
|   [3]   |   H3    | `### [N.M][LABEL]`       | Atomic Subsection.  |
|   [4]   | Divider | `// --- [LABEL] ---`[^1] | Code Section.       |

[^1]: Pad with dashes to column 80. Comment delimiter is language-dependent (`//`, `#`, `--`, etc.).

[IMPORTANT]:
- [ALWAYS] Headers follow strict bracket syntax; sigils use `_` for compound words.
- [ALWAYS] **`.claude/` infrastructure exception:** H1 label uses kebab-case matching parent folder/file name. Applies to: `skills/*/SKILL.md`, `commands/*.md`, `agents/*.md`. Example: `# [H1][STYLE-STANDARDS]` for `style-standards/SKILL.md`. Hyphens `-` permitted in H1 sigil only for these files.
- [ALWAYS] Reference files within `.claude/skills/*/references/` follow standard sigil rules (`_` for compound words).

[CRITICAL]:
- [NEVER] Skip header levels.

---
## [5][SPACING]
>**Dictum:** *Whitespace encodes boundaries.*

| [INDEX] | [ELEMENT]     | [RULE]                               |
| :-----: | ------------- | ------------------------------------ |
|   [1]   | After header  | 1 blank line.                        |
|   [2]   | After `<br>`  | 1 blank line.                        |
|   [3]   | Around tables | 1 blank line each side.              |
|   [4]   | Around fences | 1 blank line each side.              |
|   [5]   | After `---`   | No blank line—header directly below. |
|   [6]   | List items    | No blank lines between.              |
|   [7]   | Code Divider  | 1 blank line before and after.       |

[IMPORTANT] Whitespace encodes structural boundaries.

---
## [6][CASE]
>**Dictum:** *Case signals semantic category.*

| [INDEX] | [CONTEXT]     | [CASE]     | [EXAMPLE]                           |
| :-----: | ------------- | ---------- | ----------------------------------- |
|   [1]   | Sigil Content | UPPERCASE  | `[IMPORTANT]`, `[CODE_FLOW]`        |
|   [2]   | Keyword       | UPPERCASE  | `MUST`, `NEVER`, `ALWAYS`           |
|   [3]   | Table Rubric  | UPPERCASE  | `[INDEX]`, `[TERM]`, `[DEFINITION]` |
|   [4]   | Section Label | UPPERCASE  | `// --- [CLASSES] ---`              |
|   [5]   | Table Cell    | Title Case | `Sigil Content`, `Factory Function` |
|   [6]   | File Name     | kebab-case | `voice.md`, `pr-hygiene.ts`         |

[IMPORTANT] UPPERCASE reserved for sigils, rubrics, keywords.

---
## [7][PUNCTUATION]
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

---
## [8][TABLES]
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
## [9][CODE_SPANS]
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

Parser interprets double-backtick patterns as execution requests—causes skill loading failures.

---
## [10][EXAMPLE]
>**Dictum:** *Example demonstrates standard application.*

<br>

```markdown
# [H1][DOCUMENT_TITLE]
>**Dictum:** *Document purpose statement.*

<br>

[IMPORTANT] Preamble—establishes entry context.<br>
Corpus prose with [INLINE] qualifier embedded.

---
## [1][FIRST_SECTION]
>**Dictum:** *Section purpose.*

<br>

[IMPORTANT] Directs agent behavior at entry.

| [INDEX] | [RATE] | [COUNT] |
| :-----: | :----: | ------: |
|   [1]   |  95%   |     128 |
|   [2]   |  87%   |      64 |

Corpus: Input → Transform → Output.
Content—elaboration continues here.

[CRITICAL] Reinforces constraint at exit.

<br>

### [1.1][SUBSECTION]

**Term A** — First definition.<br>
**Term B** — Second definition.

---
### [1.2][SIBLING]

[VERIFY]:
- [ ] Criterion one.
- [ ] Criterion two.

---
## [2][SECOND_SECTION]
>**Dictum:** *Second section purpose.*

<br>

[IMPORTANT]:
1. [ALWAYS] **Validation:** Verify inputs.
    - *Schema:* Check structure.
    - *Types:* Check constraints.
2. [ALWAYS] **Transform:** Convert to output format.

[CRITICAL]:
- [NEVER] Skip validation on untrusted input.
- [NEVER] Mutate input parameters.
```
