---
description: Whitespace and separator rules for document structure
---

# [H1][FORMATTING]
>**Dictum:** *Whitespace signals structure to agents.*

<br>

[IMPORTANT] Separators encode hierarchy. Whitespace is semantic, not cosmetic.

---
## [1][CATALOG]
>**Dictum:** *Patterns enable rapid reference.*

<br>

| [INDEX] | [PATTERN]          | [FORMAT]                     | [USE_WHEN]                                                            |
| :-----: | ------------------ | ---------------------------- | --------------------------------------------------------------------- |
|   [1]   | Numbered Section   | `[N][LABEL]`                 | Top-level document sections.                                          |
|   [2]   | Nested Section     | `[N.M][LABEL]`               | Subsections within numbered parent.                                   |
|   [3]   | Dictum Declaration | `>**Dictum:** *<statement>*` | First line after H1/H2. Single sentence. Declarative, WHY of section. |
|   [4]   | Index Column       | `[INDEX]`                    | First column, all tables with enumerable rows.                        |
|   [5]   | Numbered List      | `1. Item`                    | Ordered steps, sequences, priorities.                                 |
|   [6]   | Bullet List        | `- Item`                     | Equivalent items, attributes, non-ordered sets.                       |
|   [7]   | Checkbox List      | `- [ ] Item`                 | Pass/fail criteria, validation gates.                                 |

---
## [2][ELEMENTS]
>**Dictum:** *Fixed rules govern element format.*

<br>

[IMPORTANT]:
- [ALWAYS] **Sigils:**
    - *Content:* UPPER_CASE. Max 3 words per sigil.
    - *Compound:* Underscores `_`—never spaces in brackets.
- [ALWAYS] **Titles:**
    - *Compound:* Em-dash ` — ` for subtitles (title context only).
- [ALWAYS] **Dictum:**
    - *Position:* First object after H1/H2 header, directly below header line.
    - *Content:* States WHY, not WHAT.
    - *Prefix:* Blockquote `>`.
    - *Format:* Label bold `**Dictum:**`, content italic `*statement*`.
- [ALWAYS] **Lists:**
    - *Directive:* `[IMPORTANT]:` or `[CRITICAL]:` to introduce.
    - *Modifier:* Each item prefixed with `[ALWAYS]` or `[NEVER]`.
    - *Order:* Positive before negative—`[ALWAYS]` items first, `[NEVER]` items after.
    - *Sections:* Positive list first, negative list second when both in same section.
    - *Spacing:* First item directly below Directive—no blank lines between items.
    - *Punctuation:* Complete sentences end with period; parent labels omit.
    - *Parent:* `**Bold:**` label + colon introducing children.
    - *Children:* `*Italic:*` labels for hierarchy contrast.
    - *Grammar:* Identical grammatical structure (parallel).
    - *Size:* 2–7 items per list—split into categorized sub-lists if larger.

[CRITICAL]:
- [NEVER] `[ALWAYS]:` or `[NEVER]:` as Directive headers—low signal.
- [NEVER] Nest lists beyond 2 levels—use H3 subsections instead.
- [NEVER] Mix grammatical forms within same list level.
- [NEVER] Single items >100 chars without nested structure.
- [NEVER] `*` or `+` for bullets—`-` only.
- [NEVER] Mix bullets and numbers in same logical block.
- [NEVER] Blank lines between list items.
- [NEVER] Single-item lists—use prose instead.

---
## [3][STRUCTURE]
>**Dictum:** *Visual topology defines semantic boundaries.*

<br>

[IMPORTANT] Structure primitives encode document hierarchy.

<br>

### [3.1][DEPTH]

**H1 `[H1][LABEL]`** — Single semantic identity—File Truth.<br>
**H2 `[N][LABEL]`** — Smallest chunk agent reads.<br>
**H3 `[N.M][LABEL]`** — Nesting limit.

[CRITICAL] H4, H5, H6 prohibited. Require H4 → create new file.

---
### [3.2][LISTS]

**Numbered (`1.`)** — Use for Sequence/Priority. Triggers linear execution.<br>
**Bullet (`-`)** — Use for Equivalence/Sets. Triggers parallel processing.

---
### [3.3][SEPARATORS]

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
### [3.4][HEADERS]

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
### [3.5][SPACING]

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
## [4][TYPESET]
>**Dictum:** *Typography enforces visual consistency.*

<br>

### [4.1][CASE]

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
### [4.2][PUNCTUATION]

| [INDEX] | [MARK]  | [RULE]                                    | [EFFECT]                                  |
| :-----: | :-----: | ----------------------------------------- | ----------------------------------------- |
|   [1]   |   `.`   | Required on every instruction/statement.  | Aggregates context. Necessary layers 0-4. |
|   [2]   |   `:`   | No space before, one space after.         | Bridges entity to elaboration.            |
|   [3]   |   `—`   | Inline elaboration marker.                | Expands inline without attention break.   |
|   [4]   |   `→`   | Surround with spaces ` → `.               | Signals transformation or causation.      |
|   [5]   | `` ` `` | Wrap code identifiers.                    | Anchors tokenizer to code domain.         |
|   [6]   |   `;`   | Joins related independent clauses.        | Marks logical relationship.               |
|   [7]   |   `?`   | Terminal position only. Actual questions. | Sufficient layers 7-11. Query resolver.   |

[CRITICAL] Delimiter choice causes 18-29% performance variance. Consistency matters more than choice.

[REFERENCE] Cognitive functions: [→voice.md§2.1[PUNCTUATION]](voice.md#21punctuation)

---
### [4.3][TABLES]

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
### [4.4][CODE_SPANS]

| [INDEX] | [CONTEXT]              | [CORRECT]                 | [ANTI_PATTERN]           |
| :-----: | ---------------------- | ------------------------- | ------------------------ |
|   [1]   | Bash execution syntax  | `<code>!\`cmd\`</code>`   | `` `!`cmd` `` (triggers) |
|   [2]   | File references        | `<code>@path</code>`      | `` `@path` ``            |
|   [3]   | Variable interpolation | `<code>$ARGUMENTS</code>` | `` `$ARGUMENTS` ``       |

[CRITICAL]:
- [NEVER] Use double-backticks around executable syntax (`` `!`cmd` ``).
- [ALWAYS] Use HTML `<code>` tags with escaped backticks for executable documentation.

Parser interprets double-backtick patterns as execution requests, causing skill loading failures.

---
## [5][EXAMPLE]
>**Dictum:** *Example demonstrates standard application.*

<br>

```markdown
# [H1][DOCUMENT_TITLE]                                  ← H1: [H1][LABEL] format
>**Dictum:** *Document purpose statement.*              ← Dictum: WHY (required)

<br>

[IMPORTANT] Preamble—establishes entry context.<BR>     ← Preamble: first marker
Corpus prose with [INLINE] qualifier embedded.          ← Qualifier in prose

---
## [1][FIRST_SECTION]                                   ← H2: [N][LABEL] format
>**Dictum:** *Section purpose.*                         ← Dictum: required on H2

<br>

[IMPORTANT] Directs agent behavior at entry.            ← Preamble (0–3 allowed)

| [INDEX] | [RATE] | [COUNT] |
| :-----: | :----: | ------: |
|   [1]   |  95%   |     128 |
|   [2]   |  87%   |      64 |

Corpus: Input → Transform → Output.                     ← Arrow: sequence flow
Content—elaboration continues here.                     ← Em-dash: inline expansion

[CRITICAL] Reinforces constraint at exit.               ← Terminus: last marker

<br>                                                    ← H2 → H3: soft separator

### [1.1][SUBSECTION]                                   ← H3: [N.M][LABEL] format

**Term A** — First definition.<br>                      ← Inline <br>: tight grouping
**Term B** — Second definition.                         ← No gap between related lines

---                                                     ← H3 → H3: hard separator
### [1.2][SIBLING]

[VERIFY]:                                               ← Gate: Terminus sub-type
- [ ] Criterion one.
- [ ] Criterion two.

---                                                     ← H2 → H2: hard separator
## [2][SECOND_SECTION]
>**Dictum:** *Second section purpose.*

<br>

[IMPORTANT]:                                            ← Directive: high-signal header
1. [ALWAYS] **Validation:** Verify inputs.              ← Modifier + Bold parent
    - *Schema:* Check structure.                        ← Italic child, parallel
    - *Types:* Check constraints.                       ← Italic child, parallel
2. [ALWAYS] **Transform:** Convert to output format.

[CRITICAL]:                                             ← Directive: negative list
- [NEVER] Skip validation on untrusted input.           ← Modifier per item
- [NEVER] Mutate input parameters.                      ← Terminus
```
