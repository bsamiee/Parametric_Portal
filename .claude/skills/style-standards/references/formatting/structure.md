# [H1][STRUCTURE]
>**Dictum:** *Visual topology defines semantic boundaries.*

<br>

[IMPORTANT] Layout primitives encode document hierarchy.

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
