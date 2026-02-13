# [H1][VALIDATION]
>**Dictum:** *Operational criteria verify diagram correctness.*

<br>

Consolidated validation for all Mermaid diagram types. Anti-patterns, escaping rules, verification checklists.

---
## [1][CONFIGURATION]
>**Dictum:** *Global settings control all diagram rendering.*

<br>

[REFERENCE] Configuration details: [->global-config.md](./global-config.md)

**Anti-patterns:** `%%{init:...}%%` (use YAML frontmatter), `init:` key (use `config:`), missing `---` fences, security override in config (use `initialize()`).

[VERIFY] Config:
- [ ] Valid YAML with `config:` key and `---` fences.
- [ ] ELK layout installed if using `layout: elk`.
- [ ] Look set to `neo` or `classic`.
- [ ] Theme uses `base` for `themeVariables`.
- [ ] Security level via `initialize()` only.

---
## [2][SECURITY]
>**Dictum:** *Sandboxing protects against XSS and injection.*

<br>

**Anti-patterns:** `securityLevel` in frontmatter (silently ignored), `javascript:` URLs, `data:` URLs, missing `dompurifyConfig`, `secure` override in config.

[VERIFY] Security:
- [ ] Security level via `initialize()` only, not frontmatter.
- [ ] URLs use `https://` protocol only.
- [ ] Sanitize callbacks for nodeId and user input.
- [ ] Never use secure keys in frontmatter.

---
## [3][ACCESSIBILITY]
>**Dictum:** *WCAG 2.1 compliance requires semantic descriptions.*

<br>

**Anti-patterns:** `accTitle`/`accDescr` before diagram type (place after), accessibility in `block-beta` (#6524) and `mindmap` (#4167).

[VERIFY] Accessibility:
- [ ] Place `accTitle` after diagram type declaration.
- [ ] Provide `accDescr` for WCAG 2.1 compliance.
- [ ] Avoid accessibility in `block-beta` and `mindmap` (known bugs).

---
## [4][GRAPH_DIAGRAMS]
>**Dictum:** *Node-edge topology requires strict ID and edge syntax.*

<br>

**Reserved words:** `end`, `default`, `subgraph`, `direction`, `style`, `linkStyle`, `classDef`, `class`, `click`, `flowchart`, `graph`. Escape: `id["end"]` or capitalize.
**Node IDs:** Alphanumeric + underscore. Invalid first char: `o`, `x` (edge conflict).
**Version gates:** Named shapes v11.3.0+, Edge IDs v11.6.0+, Markdown strings v10.1.0+.

**Anti-patterns:** `->` instead of `-->`, space before text `A [txt]`, 50+ nodes without ELK, mixed indent in mindmap, missing `columns N` in block, omitted span `:N`.

[VERIFY] Flowchart:
- [ ] Node IDs alphanumeric + underscore; avoid reserved words.
- [ ] Subgraph nesting max 3 levels.
- [ ] Named shapes use `@{ }` syntax (v11.3.0+ only).

[VERIFY] Mindmap:
- [ ] Consistent indentation; root node first; no explicit edges.

[VERIFY] Block:
- [ ] `columns N` first; all blocks have explicit span `:N`.

---
## [5][INTERACTION_DIAGRAMS]
>**Dictum:** *Temporal sequencing requires balanced activation.*

<br>

**Anti-patterns:** JSON without quotes, JSON + `as Alias` mixed, unbalanced `+`/`-` activation, missing `end`, `end` in message text (wrap in brackets), journey score outside 1-5.

[VERIFY] Sequence:
- [ ] JSON types use double quotes; never mix JSON and `as Alias`.
- [ ] Balance activation `+`/`-` pairs; end all control blocks.

[VERIFY] Journey:
- [ ] Scores integer 1-5 only; group tasks in `section` blocks.

---
## [6][MODELING_DIAGRAMS]
>**Dictum:** *Structural models require precise relationship syntax.*

<br>

**Reserved words:** State: `end`, `state`. ER: `ONE`, `MANY`, `TO`, `U`, `1` (bug #7093).
**Anti-patterns:** `<T>` generics (use `~T~`), missing visibility prefix, ER empty `{ }`, `classDef` inside composite, state styling on start/end.

[VERIFY] Class:
- [ ] Generics `~T~` syntax; visibility prefix on all members.
- [ ] Lollipop interface: `()--` or `--()`.

[VERIFY] ER:
- [ ] Crow's foot symbols; UPPERCASE entity names; `direction` at start.

[VERIFY] State:
- [ ] `stateDiagram-v2`; stereotypes `<<fork>>`, `<<join>>`, `<<choice>>`.
- [ ] `classDef` at diagram root only.

[VERIFY] Requirement:
- [ ] `id:` field present; valid relation type.

---
## [7][CHART_DIAGRAMS]
>**Dictum:** *Data visualization requires consistent array lengths.*

<br>

**Anti-patterns:** Pie values sum to 0, sankey circular flow, XY mismatched arrays, gantt invalid dates, radar axis/value mismatch, quadrant coords outside 0-1, treemap mixed indent or non-numeric leaf.

[VERIFY] Charts:
- [ ] Pie: positive value sum.
- [ ] Sankey: DAG only, no cycles.
- [ ] XYChart: match X-axis labels to data length.
- [ ] Radar: match axis count to values.
- [ ] Gantt: match `dateFormat` to dates; reference existing IDs.
- [ ] Quadrant: coordinates 0.0-1.0.
- [ ] Treemap: consistent indentation, numeric leaves.

---
## [8][ARCHITECTURE_DIAGRAMS]
>**Dictum:** *System architecture diagrams require strict hierarchy rules.*

<br>

**Anti-patterns:** C4 missing `Rel()`, undefined alias, wrong `$` prefix; architecture missing `in` clause; overlapping/incomplete bits in packet; gitgraph merge before branch, checkout before branch, cherry-pick same branch; kanban wrong indentation, wrong priority strings.

[VERIFY] C4:
- [ ] Declare aliases before `Rel()`; named params use `$` prefix.

[VERIFY] Architecture:
- [ ] All services/junctions specify `in group`; valid edge directions (T/B/L/R).

[VERIFY] Packet:
- [ ] Sequential non-overlapping bit ranges; no gaps.

[VERIFY] GitGraph:
- [ ] Branch exists before merge/checkout; unique commit IDs; cherry-pick merge includes `parent:`.

[VERIFY] Kanban:
- [ ] Tasks indented under columns; priority exact match with single quotes.

---
## [9][ERROR_SYMPTOMS]
>**Dictum:** *Common failure patterns map to specific fixes.*

<br>

| [INDEX] | [SYMPTOM]           | [FIX]                              |
| :-----: | ------------------- | ---------------------------------- |
|   [1]   | Not rendering       | Check `---` fences, `config:` key  |
|   [2]   | Parse error line 1  | Escape reserved word or capitalize |
|   [3]   | Nodes overlapping   | Use `layout: elk`                  |
|   [4]   | Styles not applying | Move `classDef` to diagram root    |
|   [5]   | Config ignored      | Verify key spelling                |
|   [6]   | Security ignored    | Use `initialize()` instead         |
|   [7]   | Activation dangling | Match +/- pairs                    |
|   [8]   | Data misaligned     | Ensure equal array lengths         |
