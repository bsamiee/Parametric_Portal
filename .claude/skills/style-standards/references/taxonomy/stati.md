# [H1][STATI]
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

---
## [1][EXAMPLE]
>**Dictum:** *Patterns demonstrate marker application.*

<br>

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
