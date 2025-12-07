# [H1][STRUCTURE]
>**Dictum:** *Compositional structure enables format reuse across contexts.*

<br>

[REFERENCE] Attention weights and ordering algorithm → [→formats.md§2](./formats.md#2weighting).

---
## [1][ORDERING]
>**Dictum:** *Impact-weighted ordering minimizes cognitive load.*

<br>

| [INDEX] | [PATTERN]      | [SEQUENCE]                                    | [USE_CASE]             |
| :-----: | -------------- | --------------------------------------------- | ---------------------- |
|   [1]   | Action-first   | Summary -> Blockers -> Details -> Context     | Immediate execution    |
|   [2]   | Priority-first | Failures -> Warnings -> Confirmations -> Info | Attention optimization |
|   [3]   | Context-first  | Scope -> Findings -> Details -> Action        | Understanding focus    |

---
## [2][HIERARCHY]
>**Dictum:** *Depth constraints prevent cognitive overload.*

<br>

[IMPORTANT] Limit hierarchy to 3 levels. Prohibit H4+.

| [INDEX] | [LEVEL] | [PURPOSE]           | [CONSTRAINT]           |
| :-----: | :-----: | ------------------- | ---------------------- |
|   [1]   |   L1    | Essential task info | Always visible         |
|   [2]   |   L2    | Supporting details  | Expandable/conditional |
|   [3]   |   L3    | Reference/optional  | Hidden by default      |

**Section Limits:**<br>
- Limit containers to 2-7 items.
- Limit levels to 3-5 constraints.
- Limit files to 10 markers maximum.

---
## [3][COMPOSITION]
>**Dictum:** *Inheritance patterns enable format reuse across outputs.*

<br>

**Base-Override Pattern:**
```yaml
base: ${base-style-name}
override:
  format: json
  sections:
    - name: status
      required: true
```

**Placeholder Syntax:**<br>
- Required: `${variable-name}`
- Optional: `${variable-name:-default}`
- Conditional: `${variable-name?}`

**Merge Semantics:**<br>
- Shallow: Override replaces entirely.
- Deep: Arrays concatenate, objects merge.
- Delete: `${property: null}` removes inherited.

---
## [4][CHAINING]
>**Dictum:** *Explicit stage coupling ensures pipeline reliability.*

<br>

| [INDEX] | [STAGE]   | [INPUT]         | [OUTPUT]        | [EXAMPLE]            |
| :-----: | --------- | --------------- | --------------- | -------------------- |
|   [1]   | Extract   | Raw response    | Structured data | Parse JSON from MD   |
|   [2]   | Transform | Structured data | Reformatted     | Convert JSON to YAML |
|   [3]   | Validate  | Reformatted     | Validated       | Schema compliance    |
|   [4]   | Emit      | Validated       | Final response  | Apply template       |

[CRITICAL] Design each stage to produce complete, valid output.
