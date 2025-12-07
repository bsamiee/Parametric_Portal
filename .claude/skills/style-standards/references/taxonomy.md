# [H1][TAXONOMY]
>**Dictum:** *Vocabulary anchors structure; Markers encode state.*

<br>

[IMPORTANT] Signals intent for agent execution. Leverage terms for document traversal.

---
## [1][LEXICON]
>**Dictum:** *Terms anchor document structure patterns.*

<br>

| [INDEX] | [TERM]        | [DEFINITION]                                                                |
| :-----: | ------------- | --------------------------------------------------------------------------- |
|   [1]   | **Index**     | Table row identifier using `[#]`.                                           |
|   [2]   | **Sigil**     | Bracket container: `[...]`.                                                 |
|   [3]   | **Marker**    | Content inside sigil.                                                       |
|   [4]   | **Divider**   | Code section separator. Visual boundary between logical code regions.       |
|   [5]   | **Strata**    | Tripartite section pattern: Preamble → Corpus → Terminus.                   |
|   [6]   | **Dictum**    | Concise "why" statement. Appears directly below H1/H2 headers.              |
|   [7]   | **Preamble**  | First marker(s) after Dictum—directs agent behavior at section entry.       |
|   [8]   | **Corpus**    | Primary section content—prose, lists, tables, blocks.                       |
|   [9]   | **Terminus**  | Final marker(s) in section—reinforces critical information at exit.         |
|  [10]   | **Gate**      | Terminus sub-type. Verification checkpoint enforcing quality criteria.      |
|  [11]   | **Qualifier** | Inline semantic tag `[KEYWORD]`.                                            |
|  [12]   | **Directive** | Block instruction marker `[IMPORTANT]:` or `[CRITICAL]:`. Introduces lists. |
|  [13]   | **Modifier**  | Per-item keyword prefix `[ALWAYS]` or `[NEVER]`. Reinforces each list item. |
|  [14]   | **Reference** | Cross-document link marker `[REFERENCE]`. Signals external dependency.      |

---
## [2][REFERENCES]
>**Dictum:** *Notation for precise cross-reference.*

<br>

| [INDEX] | [TYPE]               | [SYNTAX]                         | [EXAMPLE]                                               |
| :-----: | -------------------- | -------------------------------- | ------------------------------------------------------- |
|   [1]   | **Internal Section** | `[§N.M](#anchor)`                | `[§1.2](#12label)` — links to H3 anchor.                |
|   [2]   | **External File**    | `[→path/file.md](path/file.md)`  | `[→voice.md](voice.md)` — relative link.                |
|   [3]   | **External Section** | `[→file.md§N.M](file.md#anchor)` | `[→voice.md§2.1](voice.md#21punctuation)` — cross-file. |
|   [4]   | **Symbol**           | backticks                        | `createRetry()`, `B.config`.                            |

**Anchor Format:** Headers `### [N.M][LABEL]` generate anchors as `#nmlabel` (lowercase, no brackets, no dots).

[IMPORTANT]:
- [ALWAYS] **Section:** Wrap `§N.M` in markdown link to anchor.
- [ALWAYS] **File:** Wrap `→path` in markdown link to relative path.
- [ALWAYS] **Symbol:** Wrap code identifiers in backticks.

[CRITICAL]:
- [NEVER] Unlinked `§` or `→` notations—link to valid anchors.
- [NEVER] Absolute paths—use relative paths from current file location.

---
## [3][STATI]
>**Dictum:** *Glyph for density, Stasis for clarity.*

<br>

| [INDEX] | [GLYPH] | [GLYPH_SEMANTIC]        | [STASIS]                 | [STASIS_SEMANTIC]         |
| :-----: | :-----: | :---------------------- | :----------------------- | :------------------------ |
|   [1]   |  `[o]`  | Pass—affirmed, valid.   | `[OK]`, `[PASSED]`       | Explicit pass state.      |
|   [2]   |  `[x]`  | Fail—rejected, invalid. | `[FAILED]`, `[ERROR]`    | Explicit fail state.      |
|   [3]   |  `[!]`  | Alert—attention needed. | `[WARNING]`, `[CAUTION]` | Explicit warning state.   |
|   [4]   |  `[?]`  | Unknown—indeterminate.  | `[PENDING]`, `[UNKNOWN]` | Explicit uncertain state. |
|   [5]   |  `[+]`  | Added—new, appended.    | `[ADDED]`, `[NEW]`       | Explicit addition.        |
|   [6]   |  `[-]`  | Removed—deleted, gone.  | `[REMOVED]`, `[DELETED]` | Explicit subtraction.     |
|   [7]   |  `[=]`  | Unchanged—same, static. | `[UNCHANGED]`, `[SAME]`  | Explicit no-change.       |
|   [8]   |  `[/]`  | Skip—not applicable.    | `[NULL]`, `[SKIP]`       | Explicit exclusion.       |
|   [9]   |  `[~]`  | Partial—approximate.    | `[PARTIAL]`, `[APPROX]`  | Explicit incompleteness.  |
|  [10]   |  `[$]`  | Cached—frozen, cost.    | `[CACHED]`, `[SAVED]`    | Explicit cache state.     |

<br>

### [3.1][STATI_EXAMPLE]
>**Dictum:** *Patterns demonstrate marker application.*

```text
[STATUS]
- [o] Passed
- [x] Failed

[DELTA]
- [+] Auth module.
- [-] Legacy adapter.
- [=] Core utils.

[STATUS]
- [?] Review pending.
- [!] Attention required.
- [/] E2E skipped.
- [$] Build cached.

[INLINE] Process [o], review [?].
[REPORT] Build: [PASSED]
```
