# [H1][STRUCTURE]
>**Dictum:** *Section ordering and composition enable format reuse.*

<br>

[REFERENCE] Attention weights and ordering algorithm → [→formats.md§2](./formats.md#2weighting).

---
## [1][ORDERING]
>**Dictum:** *Order by cognitive impact, not logical sequence.*

<br>

| [INDEX] | [PATTERN]      | [SEQUENCE]                                    | [USE_CASE]             |
| :-----: | -------------- | --------------------------------------------- | ---------------------- |
|   [1]   | Action-first   | Summary -> Blockers -> Details -> Context     | Immediate execution    |
|   [2]   | Priority-first | Failures -> Warnings -> Confirmations -> Info | Attention optimization |
|   [3]   | Context-first  | Scope -> Findings -> Details -> Action        | Understanding focus    |

---
## [2][HIERARCHY]
>**Dictum:** *Depth limits prevent cognitive overload.*

<br>

[IMPORTANT] Maximum 3-level hierarchy. H4+ prohibited.

| [INDEX] | [LEVEL] | [PURPOSE]           | [CONSTRAINT]           |
| :-----: | :-----: | ------------------- | ---------------------- |
|   [1]   |   L1    | Essential task info | Always visible         |
|   [2]   |   L2    | Supporting details  | Expandable/conditional |
|   [3]   |   L3    | Reference/optional  | Hidden by default      |

**Section Limits:**<br>
- 2-7 items per container.
- 3-5 constraints per level.
- Maximum 10 markers per file.

---
## [3][COMPOSITION]
>**Dictum:** *Inheritance enables format reuse.*

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
>**Dictum:** *Output of one stage feeds input of another.*

<br>

| [INDEX] | [STAGE]   | [INPUT]         | [OUTPUT]        | [EXAMPLE]            |
| :-----: | --------- | --------------- | --------------- | -------------------- |
|   [1]   | Extract   | Raw response    | Structured data | Parse JSON from MD   |
|   [2]   | Transform | Structured data | Reformatted     | Convert JSON to YAML |
|   [3]   | Validate  | Reformatted     | Validated       | Schema compliance    |
|   [4]   | Emit      | Validated       | Final response  | Apply template       |

[CRITICAL] Each stage produces complete, valid output.
