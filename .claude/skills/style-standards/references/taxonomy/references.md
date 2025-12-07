# [H1][REFERENCES]
>**Dictum:** *Notation for precise cross-reference.*

<br>

| [INDEX] | [TYPE]           | [SYNTAX]                         | [EXAMPLE]                                               |
| :-----: | ---------------- | -------------------------------- | ------------------------------------------------------- |
|   [1]   | Internal Section | `[§N.M](#anchor)`                | `[§1.2](#12label)` — links to H3 anchor.                |
|   [2]   | External File    | `[→path/file.md](path/file.md)`  | `[→voice.md](voice.md)` — relative link.                |
|   [3]   | External Section | `[→file.md§N.M](file.md#anchor)` | `[→voice.md§2.1](voice.md#21punctuation)` — cross-file. |
|   [4]   | Symbol           | backticks                        | `createRetry()`, `B.config`.                            |

**Anchor Format:** Headers `### [N.M][LABEL]` generate anchors as `#nmlabel` (lowercase, no brackets, no dots).

[IMPORTANT]:
- [ALWAYS] **Section:** Wrap `§N.M` in markdown link to anchor.
- [ALWAYS] **File:** Wrap `→path` in markdown link to relative path.
- [ALWAYS] **Symbol:** Wrap code identifiers in backticks.

[CRITICAL]:
- [NEVER] Unlinked `§` or `→` notations—link to valid anchors.
- [NEVER] Absolute paths—use relative paths from current file location.
