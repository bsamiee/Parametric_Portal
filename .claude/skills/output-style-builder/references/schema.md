# [H1][SCHEMA]
>**Dictum:** *Delimiter syntax and examples anchor format implementation.*

<br>

[REFERENCE] Format selection and metrics → [→formats.md§1](./formats.md#1selection).

---
## [1][DELIMITERS]
>**Dictum:** *Delimiter consistency prevents parsing failures.*

<br>

[IMPORTANT] Delimiter consistency prevents 18-29% performance variance.

| [INDEX] | [DELIMITER]  | [SYNTAX]          | [PURPOSE]                          |
| :-----: | ------------ | ----------------- | ---------------------------------- |
|   [1]   | Code fence   | ` ``` ` + lang    | Block boundary, language hint      |
|   [2]   | Separator    | `---`             | Section boundary (H2 to H2)        |
|   [3]   | Soft break   | `<br>`            | Transition (after Dictum/Preamble) |
|   [4]   | Inline code  | `` ` ``           | Symbol/path boundary               |
|   [5]   | Boundary tag | `[START]`/`[END]` | Explicit parse anchors             |

[CRITICAL] Single output prohibits mixed delimiter styles.

---
## [2][EXAMPLES]
>**Dictum:** *Canonical examples demonstrate format application.*

<br>

**JSON:**
```json
{
  "status": "success",
  "data": { "key": "value" },
  "errors": []
}
```

**Markdown-KV:**
```markdown
Status: success
Data:
  - key: value
Errors: none
```

**YAML:**
```yaml
status: success
data:
  key: value
errors: []
```
