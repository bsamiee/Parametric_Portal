# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify diagram correctness.*

<br>

Consolidated validation for all Mermaid diagram types; SKILL.md §3 contains high-level gates, this file contains anti-patterns, escaping rules, and verification checklists.

---
## [1][CONFIGURATION]
>**Dictum:** *Global settings control all diagram rendering.*

<br>

[REFERENCE] Configuration details: [→global-config.md](./global-config.md)

### [1.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]              | [SEVERITY] | [FIX]                                   |
| :-----: | --------------------------- | ---------- | --------------------------------------- |
|   [1]   | `%%{init:...}%%` directive  | Critical   | Use YAML frontmatter with `config:` key |
|   [2]   | Missing frontmatter fence   | Critical   | `---` on line 1, `---` before diagram   |
|   [3]   | `init:` root key            | High       | Use `config:` root key                  |
|   [4]   | Misspelled config key       | Medium     | Verify key names in docs                |
|   [5]   | Inconsistent YAML indent    | Critical   | Use consistent spaces                   |
|   [6]   | Security override in config | High       | Use `initialize()` for security         |

### [1.2][VERIFY]

[VERIFY] Config:
- [ ] Valid YAML with `config:` key and `---` fences.
- [ ] Install ELK layout if using `layout: elk`.
- [ ] Markdown escaping with `\*`, `\_`, `\[`, `\]` (v11 default).
- [ ] Increase edge count via `maxEdges` in `initialize()` if >500.
- [ ] Set security level via `initialize()` only.
- [ ] Set look to `classic` or `handDrawn`.
- [ ] Theme uses `base` for `themeVariables`.

---
## [2][SECURITY]
>**Dictum:** *Sandboxing protects against XSS and injection attacks.*

<br>

[REFERENCE] Security levels: [→global-config.md§2.4](./global-config.md#24security)<br>
[REFERENCE] URL validation: [→graph.md§3.4](./graph.md#34security)<br>
[REFERENCE] Secure keys: [→global-config.md§5](./global-config.md#5secure_keys)

### [2.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]                 | [SEVERITY] | [FIX]                                         |
| :-----: | ------------------------------ | ---------- | --------------------------------------------- |
|   [1]   | `securityLevel` in frontmatter | Critical   | Use `initialize()` only (silently ignored)    |
|   [2]   | `javascript:` URLs in hrefs    | Critical   | Blocked by sanitizer, use `https://` only     |
|   [3]   | `data:` URLs in hrefs          | Critical   | Blocked by default, use external assets       |
|   [4]   | Relative callback paths        | High       | Define absolute function names in global code |
|   [5]   | Missing `dompurifyConfig`      | Medium     | Configure DOMPurify for HTML label content    |
|   [6]   | `secure` override in config    | Critical   | Use `initialize()` only (silently ignored)    |
|   [7]   | Unvalidated callback params    | High       | Sanitize nodeId and user input in callbacks   |

### [2.2][VERIFY]

[VERIFY] Security:
- [ ] Set security level via `initialize()` only, not frontmatter.
- [ ] URLs use `https://` protocol only.
- [ ] Sanitize callbacks for nodeId and user input.
- [ ] Never use secure keys in frontmatter (`secure`, `dompurifyConfig`, `maxTextSize`, `maxEdges`).

---
## [3][ACCESSIBILITY]
>**Dictum:** *WCAG 2.1 compliance requires semantic descriptions.*

<br>

[REFERENCE] Styling accessibility details: [→styling.md§6](./styling.md#6accessibility)

### [3.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]                       | [SEVERITY] | [FIX]                                   |
| :-----: | ------------------------------------ | ---------- | --------------------------------------- |
|   [1]   | `accTitle`/`accDescr` before diagram | Critical   | Place after diagram type declaration    |
|   [2]   | Missing `accDescr` on complex graphs | High       | Add description for WCAG 2.1 compliance |
|   [3]   | Accessibility in `block-beta`        | Critical   | Known bug #6524—avoid in `block-beta`   |
|   [4]   | Accessibility in `mindmap`           | Critical   | Known bug #4167—treated as parse error  |
|   [5]   | Empty `accTitle` or `accDescr`       | Medium     | Provide meaningful text content         |

### [3.2][VERIFY]

[VERIFY] Accessibility:
- [ ] Place `accTitle` after diagram type declaration.
- [ ] Provide `accDescr` for WCAG 2.1 compliance.
- [ ] Avoid accessibility in `block-beta` (bug #6524).
- [ ] Avoid accessibility in `mindmap` (bug #4167).

---
## [4][GRAPH_DIAGRAMS]
>**Dictum:** *Node-edge topology requires strict ID and edge syntax.*

<br>

[REFERENCE] Graph details: [→graph.md](./graph.md), Mindmap details: [→graph.md§2](./graph.md#2mindmap)

### [4.1][RESERVED_WORDS]

**List:** `end`, `default`, `subgraph`, `direction`, `style`, `linkStyle`, `classDef`, `class`, `call`, `href`, `click`, `flowchart`, `graph`<br>
**Escaping:** Use quoted labels `id["end"]` or capitalize `End`.

### [4.2][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]              | [SEVERITY] | [FIX]                  | [DIAGRAMS] |
| :-----: | --------------------------- | ---------- | ---------------------- | ---------- |
|   [1]   | Lowercase `end` in label    | Critical   | Use `End` or `"end"`   | Flowchart  |
|   [2]   | `o`/`x` as first char of ID | Critical   | Prefix with letter     | Flowchart  |
|   [3]   | `->` instead of `-->`       | Critical   | Use double dash        | Flowchart  |
|   [4]   | Space before text `A [txt]` | High       | Remove space: `A[txt]` | Flowchart  |
|   [5]   | 50+ nodes slow render       | Medium     | Use ELK renderer       | Flowchart  |
|   [6]   | Mixed indent (spaces/tabs)  | Critical   | Use consistent space   | Mindmap    |
|   [7]   | Missing `columns N`         | Critical   | Declare columns first  | Block      |
|   [8]   | Omitted span `:N`           | High       | Always specify span    | Block      |
|   [9]   | Edge ID with en dash        | Critical   | Use ASCII `-`, not `–` | Flowchart  |

### [4.3][ESCAPING]

| [INDEX] | [METHOD]         | [SYNTAX]       | [USE_CASE]                    |
| :-----: | ---------------- | -------------- | ----------------------------- |
|   [1]   | Double quotes    | `"text"`       | Reserved words, special chars |
|   [2]   | HTML entities    | `#35;`, `#59;` | Hash, semicolon in labels     |
|   [3]   | Bracket notation | `id[label]`    | Separate ID from display text |
|   [4]   | Markdown strings | `` "`text`" `` | Rich formatting (v10.1.0+)    |

### [4.4][NODE_ID_RULES]

**Valid:** Alphanumeric + underscore (`a-z`, `A-Z`, `0-9`, `_`).<br>
**Invalid first:** `o`, `x` (conflict with edges).<br>
**Best:** Descriptive IDs (`userInput`), camelCase/snake_case, prefix numeric (`node1`).

### [4.5][VERSION_GATES]

| [INDEX] | [FEATURE]        | [VERSION] | [SYNTAX]            |
| :-----: | ---------------- | --------- | ------------------- |
|   [1]   | Named shapes     | v11.3.0+  | `@{ shape: name }`  |
|   [2]   | Edge IDs         | v11.6.0+  | `id@-->`            |
|   [3]   | Markdown strings | v10.1.0+  | `` "`text`" ``      |
|   [4]   | Icon shapes      | v11.3.0+  | `@{ shape: icon }`  |
|   [5]   | Image shapes     | v11.3.0+  | `@{ shape: image }` |

### [4.6][VERIFY]

**Flowchart:**
- [ ] Node IDs: alphanumeric + underscore only.
- [ ] Avoid reserved words in node IDs.
- [ ] Subgraph nesting: max 3 levels.
- [ ] Named shapes: `@{ }` syntax (v11.3.0+ only).
- [ ] Edge IDs: `id@-->` syntax (v11.6.0+ only).

**Mindmap:**
- [ ] Consistent indentation: spaces or tabs, not mixed.
- [ ] Declare root node first.
- [ ] Icon syntax: `::icon(library name)` format.
- [ ] Class syntax: `:::className` format.
- [ ] No explicit edges (hierarchy via indentation).

**Block:**
- [ ] Declare `columns N` first.
- [ ] All blocks have explicit span (`:N`).
- [ ] Row spans do not exceed column count.
- [ ] Nested blocks specify width.

**Interactivity:**
- [ ] Define callbacks in JavaScript.
- [ ] URLs absolute with protocol.
- [ ] Targets valid (`_self`, `_blank`, `_parent`, `_top`).

---
## [5][INTERACTION_DIAGRAMS]
>**Dictum:** *Temporal sequencing requires balanced activation and proper aliasing.*

<br>

[REFERENCE] Interaction details: [→interaction.md](./interaction.md)

### [5.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]        | [SEVERITY] | [FIX]                     | [DIAGRAMS] |
| :-----: | --------------------- | ---------- | ------------------------- | ---------- |
|   [1]   | JSON without quotes   | Critical   | `@{ "type": "boundary" }` | Sequence   |
|   [2]   | JSON + `as Alias`     | Critical   | Use one, not both         | Sequence   |
|   [3]   | Unbalanced activation | High       | Match `+` with `-`        | Sequence   |
|   [4]   | Missing `end`         | Critical   | Terminate all blocks      | Sequence   |
|   [5]   | `end` in message      | Critical   | Wrap: `(end)`, `[end]`    | Sequence   |
|   [6]   | Score outside 1-5     | Critical   | Integer 1-5 only          | Journey    |
|   [7]   | Task without section  | High       | Group in `section`        | Journey    |
|   [8]   | Links on `actor`      | Medium     | Use `participant`         | Sequence   |

### [5.2][VERIFY]

[VERIFY] Sequence:
- [ ] JSON types use double quotes.
- [ ] Never mix JSON and `as Alias` syntax.
- [ ] Balance activation with `+`/`-` pairs.
- [ ] End all control blocks with `end`.
- [ ] Arrows use `Sender->>Receiver: Text` format.

[VERIFY] Journey:
- [ ] Scores are integer 1-5 only.
- [ ] Group tasks in `section` blocks.

---
## [6][MODELING_DIAGRAMS]
>**Dictum:** *Structural models require precise relationship syntax and visibility markers.*

<br>

[REFERENCE] Modeling details: [→modeling.md](./modeling.md)

### [6.1][RESERVED_WORDS]

**State:** `end`, `state`.<br>
**ER:** `ONE`, `MANY`, `TO`, `U`, `1` (bug #7093).

### [6.2][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]            | [SEVERITY] | [FIX]                         | [DIAGRAMS]  |
| :-----: | ------------------------- | ---------- | ----------------------------- | ----------- |
|   [1]   | Class `<T>` generics      | Critical   | Use `~T~` syntax              | Class       |
|   [2]   | Comma generics nested     | Critical   | Avoid `~K,V~` in nested types | Class       |
|   [3]   | Missing visibility prefix | High       | Use `+`, `-`, `#`, `~`        | Class       |
|   [4]   | ER empty `{ }`            | Critical   | Omit braces or add attribute  | ER          |
|   [5]   | ER inline styling         | High       | Use `themeCSS`                | ER          |
|   [6]   | Self-loops in state       | Medium     | Use dummy intermediate state  | State       |
|   [7]   | Nested composites >2      | High       | Flatten or use ELK            | State       |
|   [8]   | `classDef` inside compose | High       | Define at diagram root        | State       |
|   [9]   | State styling start/end   | Low        | Not supported (v11)           | State       |
|  [10]   | Requirement missing `id:` | High       | Always include id field       | Requirement |

### [6.3][LIMITATIONS]

**State:**
- History states (H/H*) not supported.
- `--` concurrency only inside composites.
- Cross-composite internal state edges disallowed.
- Note positioning bug #6790: `left of` may render at top.

### [6.4][VERIFY]

**Class:**
- [ ] Relationship types: 8 valid patterns.
- [ ] Generics: `~T~` syntax, not `<T>`.
- [ ] Visibility prefix on all members.
- [ ] Static (`$`) and abstract (`*`) classifiers.
- [ ] Lollipop interface syntax (`()--` or `--()`)
- [ ] Cardinality on relationships.

**ER:**
- [ ] Crow's foot symbols per side.
- [ ] UPPERCASE entity names.
- [ ] `direction` at start of diagram.
- [ ] Identifying (`--`) vs non-identifying (`..`).

**State:**
- [ ] `stateDiagram-v2` (v1 deprecated).
- [ ] Stereotypes: `<<fork>>`, `<<join>>`, `<<choice>>`.
- [ ] `[*]` for both start AND end (context determines).
- [ ] `classDef` at diagram root only.

**Requirement:**
- [ ] `id:` field present for every requirement.
- [ ] Valid relation type between elements.

---
## [7][CHART_DIAGRAMS]
>**Dictum:** *Data visualization requires consistent array lengths and valid ranges.*

<br>

[REFERENCE] Chart details: [→charts.md](./charts.md)

### [7.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]               | [SEVERITY] | [FIX]                  | [DIAGRAMS] |
| :-----: | ---------------------------- | ---------- | ---------------------- | ---------- |
|   [1]   | Pie values sum to 0          | Critical   | Ensure positive values | Pie        |
|   [2]   | Sankey circular flow         | Critical   | DAG structure only     | Sankey     |
|   [3]   | XY mismatched arrays         | Critical   | Equal length arrays    | XYChart    |
|   [4]   | Gantt invalid dates          | Critical   | Match `dateFormat`     | Gantt      |
|   [5]   | Radar axis/value mismatch    | High       | Match array lengths    | Radar      |
|   [6]   | Quadrant coords out of range | High       | Use 0.0-1.0 range      | Quadrant   |
|   [7]   | Treemap mixed indent         | Critical   | Consistent spaces/tabs | Treemap    |
|   [8]   | Treemap non-numeric leaf     | Critical   | Numeric values only    | Treemap    |

### [7.2][VERIFY]

[VERIFY] Charts:
- [ ] Pie: positive value sum.
- [ ] Sankey: DAG structure only, no cycles.
- [ ] XYChart: match X-axis labels to data length, use `horizontal` keyword if needed.
- [ ] Radar: match axis count to values, `max` >= values, `min` <= values.
- [ ] Gantt: match `dateFormat` to dates, reference existing IDs in dependencies.
- [ ] Quadrant: coordinates in 0.0-1.0 range.
- [ ] Treemap: consistent indentation, numeric leaf values only.

---
## [8][ARCHITECTURE_DIAGRAMS]
>**Dictum:** *System architecture diagrams require strict relationship and hierarchy rules.*

<br>

[REFERENCE] Architecture details: [→architecture.md](./architecture.md), C4: [→architecture.md§1](./architecture.md#1c4), Timeline: [→architecture.md§4](./architecture.md#4timeline), Infrastructure: [→architecture.md§2](./architecture.md#2infrastructure)

### [8.1][ANTI_PATTERNS]

| [INDEX] | [ANTI-PATTERN]                  | [SEVERITY] | [FIX]                                                     | [DIAGRAMS]   |
| :-----: | ------------------------------- | ---------- | --------------------------------------------------------- | ------------ |
|   [1]   | C4 missing `Rel()`              | High       | Connect all elements via relationships                    | C4           |
|   [2]   | C4 undefined alias              | Critical   | Declare elements before `Rel()`                           | C4           |
|   [3]   | C4 wrong parameter prefix       | Critical   | Use `$` for named params: `$link`, `$tags`                | C4           |
|   [4]   | Unregistered icon               | Low        | Use built-in or register iconify icons                    | Architecture |
|   [5]   | Missing `in` clause             | Critical   | Services/junctions MUST specify parent group              | Architecture |
|   [6]   | Overlapping bits                | Critical   | Sequential ranges only, no gaps                           | Packet       |
|   [7]   | Incomplete bits                 | Critical   | Define all bits up to max range                           | Packet       |
|   [8]   | Empty section                   | Low        | Each section needs ≥1 event                               | Timeline     |
|   [9]   | Invalid merge                   | Critical   | Branch MUST exist before merge                            | GitGraph     |
|  [10]   | Checkout before branch          | Critical   | Create branch first                                       | GitGraph     |
|  [11]   | Cherry-pick same branch         | Critical   | Cherry-pick from DIFFERENT branch                         | GitGraph     |
|  [12]   | Cherry-pick merge missing param | Critical   | Merge commits require `parent:`                           | GitGraph     |
|  [13]   | Empty column                    | Low        | Add at least one task per column                          | Kanban       |
|  [14]   | Wrong indentation               | Critical   | Tasks MUST be indented under columns                      | Kanban       |
|  [15]   | Wrong priority                  | High       | Use exact: `'Very High'`, `'High'`, `'Low'`, `'Very Low'` | Kanban       |
|  [16]   | Unquoted string metadata        | Critical   | Quote strings with spaces: `assigned: 'Alice'`            | Kanban       |

### [8.2][VERIFY]

**C4:**
- [ ] Declare all aliases before `Rel()` statements.
- [ ] Named parameters use `$` prefix (`$link`, `$tags`, `$sprite`).
- [ ] External variants end with `_Ext` suffix.
- [ ] `UpdateRelStyle`/`UpdateElementStyle` for custom styling.

**Architecture:**
- [ ] All services/junctions specify `in group`.
- [ ] Icons from built-in set OR registered iconify icons.
- [ ] Edge directions valid (T/B/L/R).

**Packet:**
- [ ] Sequential, non-overlapping bit ranges.
- [ ] Bit count ≤ `bitsPerRow`.
- [ ] Define all bits (no gaps).

**Timeline:**
- [ ] Sections have ≥1 event.
- [ ] `themeVariables` use `cScale0`-`cScale11` naming.

**GitGraph:**
- [ ] Branch exists before merge/checkout.
- [ ] Unique commit IDs.
- [ ] Cherry-pick merge commits include `parent:`.
- [ ] Commit types use UPPERCASE: `NORMAL`, `REVERSE`, `HIGHLIGHT`.

**Kanban:**
- [ ] Columns have tasks, tasks indented.
- [ ] Priority exact match with quotes: `'Very High'`, `'High'`, `'Low'`, `'Very Low'`.
- [ ] Metadata strings with spaces use single quotes.

---
## [9][ERROR_SYMPTOMS]
>**Dictum:** *Common failure patterns map to specific fixes.*

<br>

Troubleshooting reference for diagnosing rendering failures.

| [INDEX] | [SYMPTOM]                 | [LIKELY_CAUSE]            | [FIX]                             |
| :-----: | ------------------------- | ------------------------- | --------------------------------- |
|   [1]   | Diagram not rendering     | Frontmatter syntax error  | Check `---` fences, `config:` key |
|   [2]   | Parse error on first line | Reserved word as ID       | Escape with quotes or capitalize  |
|   [3]   | Nodes overlapping         | Too many nodes            | Use `layout: elk`                 |
|   [4]   | Edges not connecting      | Invalid node ID           | Check alphanumeric + underscore   |
|   [5]   | Styles not applying       | `classDef` in wrong scope | Move to diagram root              |
|   [6]   | Config silently ignored   | Misspelled key            | Verify key name spelling          |
|   [7]   | Security setting ignored  | Frontmatter override      | Use `initialize()` instead        |
|   [8]   | Activation bars dangling  | Unbalanced +/-            | Match activate/deactivate pairs   |
|   [9]   | Journey scores rejected   | Out of range              | Use integer 1-5 only              |
|  [10]   | Chart data misaligned     | Array length mismatch     | Ensure equal lengths              |
