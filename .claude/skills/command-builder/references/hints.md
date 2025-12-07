# [H1][ARGUMENT_HINTS]
>**Dictum:** *Discoverable parameters prevent invocation failure.*

<br>

[CRITICAL] Hints display in `/help` menu and tab completion. Pattern choice affects user discovery.

---
## [1][SYNTAX_PATTERNS]
>**Dictum:** *Type conventions eliminate runtime parameter errors.*

<br>

| [INDEX] | [PATTERN]         | [SYNTAX]                    | [EXAMPLE]                          | [USE_WHEN]         |
| :-----: | ----------------- | --------------------------- | ---------------------------------- | ------------------ |
|   [1]   | **Required**      | `[name]`                    | `[file-path]`                      | Mandatory input    |
|   [2]   | **Optional**      | `[name?]`                   | `[focus?]`                         | Can be omitted     |
|   [3]   | **Enum**          | `[name: opt1\|opt2\|opt3]`  | `[goal: optimize\|upgrade\|audit]` | Fixed valid values |
|   [4]   | **Optional Enum** | `[name: opt1\|opt2\|opt3?]` | `[type: readonly\|write?]`         | Optional with enum |
|   [5]   | **Flag**          | `[--flag]`                  | `[--verbose]`                      | Boolean switches   |

---
## [2][ENUM_HINTS]
>**Dictum:** *Constrained inputs eliminate validation overhead.*

<br>

Display valid values inline via pipe separator. Options display during tab completion:

```yaml
argument-hint: [goal: optimize|upgrade|audit] [target-type?]
```

[CRITICAL]:
- [ALWAYS] Use enum hints when parameter has 2-6 fixed values.
- [ALWAYS] Place `?` AFTER closing bracket for optional enums.
- [NEVER] Exceed 6 enum values—switch to prose description.

---
## [3][ORDERING]
>**Dictum:** *Predictable sequences maximize recall accuracy.*

<br>

| [PRIORITY] | [PATTERN]                 | [RATIONALE]      |
| :--------: | ------------------------- | ---------------- |
|     1      | Required parameters       | Must be provided |
|     2      | Frequently-used optionals | Common workflow  |
|     3      | Rarely-used optionals     | Edge cases       |

---
## [4][EXAMPLES]
>**Dictum:** *Concrete patterns encode abstract rules.*

<br>

**Valid:**
```yaml
# Enum with required first
argument-hint: [file-path] [goal: optimize|upgrade|audit]

# Optional enum at end
argument-hint: [target] [type: simple|standard|complex?]

# Multiple enums
argument-hint: [type: simple|standard|complex] [depth: base|extended|full] [context?]
```

**Invalid:**
```yaml
# Wrong: Optional before required
argument-hint: [focus?] [file-path]

# Wrong: Missing enum values for constrained input
argument-hint: [type] [depth]

# Wrong: Too many enum values
argument-hint: [option: a|b|c|d|e|f|g|h|i]
```

---
## [5][ANTI_PATTERNS]
>**Dictum:** *Negative examples establish boundary constraints.*

<br>

| [INDEX] | [ANTI_PATTERN]               | [SYMPTOM]                 | [FIX]                      |
| :-----: | ---------------------------- | ------------------------- | -------------------------- |
|   [1]   | **Optional before required** | Confusing invocation      | Required parameters first  |
|   [2]   | **Missing enum values**      | User guesses valid inputs | Add pipe-separated options |
|   [3]   | **Too many enum values**     | Hint unreadable           | Max 6 values, else prose   |
|   [4]   | **Abbreviations**            | Unclear meaning           | Full descriptive names     |
|   [5]   | **Missing `?` marker**       | Required/optional unclear | Add `?` for all optionals  |
