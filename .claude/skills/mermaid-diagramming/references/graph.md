# [H1][GRAPH]
>**Dictum:** *Graph diagrams communicate process flow and system structure.*

<br>

Flowchart (directional flow), block-beta (grid composition), mindmap (hierarchical radial). Interactivity via callbacks and URL navigation.

[REFERENCE] classDef, linkStyle: [->styling.md](./styling.md)
[REFERENCE] Validation: [->validation.md§4](./validation.md#4graph_diagrams)

---
## [1][FLOWCHART]
>**Dictum:** *Shape selection clarifies node role in process.*

<br>

**Declaration:** `flowchart LR|TB|RL|BT`

### [1.1][SHAPES]

**Classic (14):** `[text]` (rect), `(text)` (rounded), `([text])` (stadium), `((text))` (circle), `{text}` (diamond), `{{text}}` (hexagon), `[[text]]` (subroutine), `[(text)]` (cylinder), `[/text/]` (parallelogram R), `[\text\]` (parallelogram L), `[/text\]` (trapezoid bottom), `[\text/]` (trapezoid top), `>text]` (asymmetric), `(((text)))` (double circle).

**Named (v11.3.0+):** `NodeID@{ shape: name, label: "text" }` — 46 shapes across categories:
- *Process:* `rect`/`proc`, `rounded`/`event`, `stadium`/`terminal`, `fr-rect`/`subprocess`, `cyl`/`db`, `circle`, `diam`/`decision`, `hex`/`prepare`, `dbl-circ`
- *Flow:* `lean-r`/`in-out`, `lean-l`/`out-in`, `trap-b`/`priority`, `trap-t`/`manual`, `fork`/`join`, `hourglass`/`collate`
- *Documents:* `doc`, `docs`/`st-doc`, `lin-doc`, `tag-doc`
- *Storage:* `h-cyl`/`das`, `lin-cyl`/`disk`, `bow-rect`/`stored-data`
- *Connectors:* `sm-circ`/`start`, `fr-circ`/`stop`, `f-circ`/`junction`, `cross-circ`/`summary`
- *Specialized:* `brace`/`comment`, `bolt`/`com-link`, `delay`, `tri`/`extract`, `flag`/`paper-tape`, `text`, `odd`, `bang`

**Icon:** `@{ shape: icon, icon: "fa:name", form: square|circle|rounded, label: "text", pos: t|b, h: 48 }`
**Image:** `@{ shape: image, img: "url", label: "text", pos: t|b, w: 100, h: 100, constraint: on|off }`
**Markdown:** `` "`**bold** *italic*`" `` — rich formatting in node/edge/subgraph labels.

---
### [1.2][EDGES]

| [INDEX] | [SYNTAX] | [TYPE]        | [SEMANTIC]     |
| :-----: | -------- | ------------- | -------------- |
|   [1]   | `-->`    | Arrow         | Directed flow  |
|   [2]   | `---`    | Open          | Association    |
|   [3]   | `-.->`   | Dotted arrow  | Optional/async |
|   [4]   | `==>`    | Thick arrow   | Primary path   |
|   [5]   | `~~~`    | Invisible     | Layout control |
|   [6]   | `--o`    | Circle end    | Composition    |
|   [7]   | `--x`    | Cross end     | Termination    |
|   [8]   | `<-->`   | Bidirectional | Two-way flow   |

**Length:** Extra dashes extend ranks — `----` (2), `-----` (3). Applies to dotted/thick variants.
**Labels:** `-->|label|`, `-- label -->`, `---|label|`.
**Chaining:** `A --> B & C & D`, `A & B --> C`, `A --> B --> C`.
**Edge IDs (v11.6.0+):** `A e1@--> B`, style via `e1@{ animate: true }`.

[IMPORTANT] Escape commas in `stroke-dasharray` as `\,` (comma is style delimiter).

---
### [1.3][SUBGRAPHS]

**Syntax:** `subgraph ID ["Title"]` ... `end`. Supports `direction TB` inside, inter-subgraph links (`Phase1 --> Phase2`), max 3 nesting levels. External links disable subgraph direction control.

---
### [1.4][CONFIG]

| [INDEX] | [KEY]             | [TYPE]  |    [DEFAULT]    | [DESCRIPTION]                      |
| :-----: | ----------------- | ------- | :-------------: | ---------------------------------- |
|   [1]   | `curve`           | string  |     `basis`     | Edge style (12 curve types)        |
|   [2]   | `nodeSpacing`     | number  |      `50`       | Horizontal gap between nodes       |
|   [3]   | `rankSpacing`     | number  |      `50`       | Vertical gap between ranks         |
|   [4]   | `htmlLabels`      | boolean |     `true`      | Enable HTML in labels              |
|   [5]   | `wrappingWidth`   | number  |      `200`      | Max label width before wrap        |
|   [6]   | `defaultRenderer` | string  | `dagre-wrapper` | `dagre-d3`, `dagre-wrapper`, `elk` |

---
## [2][BLOCK]
>**Dictum:** *Block diagrams expose system architecture through grid composition.*

<br>

**Declaration:** `block-beta`. Manual grid-based positioning.

**Elements:** `columns N` (grid width, must precede all blocks), `id["Label"]` (block), `id["Label"]:N` (span N columns), `space`/`space:N` (empty cells), `block:groupId:N ... end` (nested), `-->|---` (connections), `--"label"-->` (labeled edge).

[IMPORTANT] Missing `:N` suffix causes layout errors. Specify span width explicitly.

---
## [3][MINDMAP]
>**Dictum:** *Mindmaps communicate hierarchical relationships through spatial organization.*

<br>

**Declaration:** `mindmap`. Indentation depth defines parent-child relationships in radial tree layout.

**Shapes (7):** `text` (default), `[text]` (square), `(text)` (rounded), `((text))` (circle), `))text((` (bang), `)text(` (cloud), `{{text}}` (hexagon).
**Icons:** `::icon(fa fa-book)`, `::icon(mdi mdi-name)`. Icon fonts require site-level integration.
**Classes:** `:::className`, multiple via `:::class1 :::class2`.
**Layout:** Default radial; configure `layout: tidy-tree` via frontmatter for hierarchical top-to-bottom.

[IMPORTANT] Indentation creates hierarchy — spaces or tabs, never mixed.

---
## [4][INTERACTIVITY]
>**Dictum:** *Click handlers transform diagrams into navigation interfaces.*

<br>

**Callback:** `click nodeId callback "tooltip"` | `click nodeId call callback()`. Define JS functions before render.
**URL:** `click nodeId "https://url" "tooltip"` | `click nodeId href "https://url" "tooltip" _blank`.
**Targets:** `_self` (default), `_blank` (new tab), `_parent`, `_top`.

**Security levels:** `strict` (no clicks/tooltips), `loose` (all enabled), `antiscript` (clicks, no scripts).

[CRITICAL] ALL interactive features require `securityLevel: 'loose'` or `'antiscript'` via `initialize()`.

**Programmatic binding:**
```javascript
const { svg, bindFunctions } = await mermaid.render('id', def);
container.innerHTML = svg;
bindFunctions?.(container);
```

[CRITICAL] Omitting `bindFunctions()` produces non-functional click handlers.
