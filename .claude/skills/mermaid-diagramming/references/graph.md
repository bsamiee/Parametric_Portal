# [H1][GRAPH]
>**Dictum:** *Graph diagrams communicate process flow and system structure.*

<br>

Two diagram types: `flowchart` (directional flow with nodes/edges), `block-beta` (grid-based composition). Interactive behaviors via callbacks and URL navigation.

**Applies to:** Flowchart, Block, Mindmap diagrams.<br>
**Line types:** Arrow, dotted, thick (12 variants).<br>
**Shapes:** 14 classic brackets + 46 named shapes (v11.3.0+).<br>
**Interactivity:** JavaScript callbacks, URL navigation with target control.

[REFERENCE] classDef, linkStyle: [→styling.md](./styling.md).<br>
[REFERENCE] Graph validation: [→validation.md§4](./validation.md#4graph_diagrams), Mindmap validation: [→validation.md§4](./validation.md#4graph_diagrams).

---
## [1][FLOWCHART]
>**Dictum:** *Shape selection clarifies node role in process.*

<br>

Flowchart diagrams with nodes, edges, and subgraphs. Directed flow visualization.

### [1.1][DECLARATION]

**Syntax:** `flowchart LR` | `flowchart TB` | `flowchart RL` | `flowchart BT`

| [INDEX] | [CODE] | [DIRECTION]   |
| :-----: | ------ | ------------- |
|   [1]   | `LR`   | Left to right |
|   [2]   | `TB`   | Top to bottom |
|   [3]   | `RL`   | Right to left |
|   [4]   | `BT`   | Bottom to top |

---
### [1.2][CLASSIC_SHAPES]

14 classic shapes via bracket notation.

| [INDEX] | [SYNTAX]     | [SHAPE]          | [SEMANTIC]       |
| :-----: | ------------ | ---------------- | ---------------- |
|   [1]   | `[text]`     | Rectangle        | Process, action  |
|   [2]   | `(text)`     | Rounded          | Start/end        |
|   [3]   | `([text])`   | Stadium          | Terminal         |
|   [4]   | `((text))`   | Circle           | Connector        |
|   [5]   | `{text}`     | Diamond          | Decision         |
|   [6]   | `{{text}}`   | Hexagon          | Preparation      |
|   [7]   | `[[text]]`   | Subroutine       | Subprocess       |
|   [8]   | `[(text)]`   | Cylinder         | Database         |
|   [9]   | `[/text/]`   | Parallelogram R  | Input            |
|  [10]   | `[\text\]`   | Parallelogram L  | Output           |
|  [11]   | `[/text\]`   | Trapezoid bottom | Manual operation |
|  [12]   | `[\text/]`   | Trapezoid top    | Manual input     |
|  [13]   | `>text]`     | Asymmetric       | Flag/signal      |
|  [14]   | `(((text)))` | Double circle    | Loop boundary    |

---
### [1.3][NAMED_SHAPES]

Attribute syntax provides 46 named shapes (v11.3.0+). **Syntax:** `NodeID@{ shape: name, label: "text" }`

**Core Process (9):** `rect` (`proc`, `process`, `rectangle`), `rounded` (`event`), `stadium` (`terminal`, `pill`), `fr-rect` (`subprocess`, `subproc`, `framed-rectangle`, `subroutine`), `cyl` (`db`, `database`, `cylinder`), `circle` (`circ`), `diam` (`decision`, `diamond`), `hex` (`hexagon`, `prepare`), `dbl-circ` (`double-circle`).<br>
**Flow Control (6):** `lean-r` (`lean-right`, `in-out`), `lean-l` (`lean-left`, `out-in`), `trap-b` (`priority`, `trapezoid-bottom`), `trap-t` (`manual`, `trapezoid-top`), `fork` (`join`), `hourglass` (`collate`).<br>
**Documents (4):** `doc` (`document`), `docs` (`documents`, `st-doc`, `stacked-document`), `lin-doc` (`lined-document`), `tag-doc` (`tagged-document`).<br>
**Data Storage (3):** `h-cyl` (`das`, `horizontal-cylinder`), `lin-cyl` (`disk`), `bow-rect` (`stored-data`, `bow-tie-rectangle`).<br>
**Process Variants (7):** `notch-rect` (`card`, `notched-rectangle`), `lin-rect` (`lined-rectangle`, `lined-proc`, `lin-proc`, `shaded-process`), `div-rect` (`div-proc`, `divided-rectangle`, `divided-process`), `st-rect` (`procs`, `processes`, `stacked-rect`), `tag-rect` (`tagged-rectangle`, `tag-proc`, `tagged-process`), `win-pane` (`internal-storage`, `window-pane`), `sl-rect` (`manual-input`, `sloped-rectangle`).<br>
**Connectors (4):** `sm-circ` (`start`, `small-circle`), `fr-circ` (`stop`, `framed-circle`), `f-circ` (`junction`, `filled-circle`), `cross-circ` (`summary`, `crossed-circle`).<br>
**Specialized (13):** `brace` (`comment`, `brace-l`), `brace-r`, `braces`, `bolt` (`com-link`, `lightning-bolt`), `delay` (`half-rounded-rectangle`), `curv-trap` (`curved-trapezoid`, `display`), `tri` (`extract`, `triangle`), `flip-tri` (`manual-file`, `flipped-triangle`), `notch-pent` (`loop-limit`, `notched-pentagon`), `flag` (`paper-tape`), `text`, `odd`, `bang`.

---
### [1.4][SPECIAL_SHAPES]

Icon and image shapes embed external content into nodes.

**Icon Shape:** `NodeID@{ shape: icon, icon: "fa:name", form: square, label: "text", pos: t, h: 48 }`

| [INDEX] | [ATTRIBUTE] | [VALUES]                      | [DEFAULT] |
| :-----: | ----------- | ----------------------------- | --------- |
|   [1]   | `icon`      | `fa:name`, `fab:name`         | Required  |
|   [2]   | `form`      | `square`, `circle`, `rounded` | `square`  |
|   [3]   | `label`     | string                        | none      |
|   [4]   | `pos`       | `t` (top), `b` (bottom)       | `b`       |
|   [5]   | `h`         | number (px)                   | `48`      |

**Image Shape:** `NodeID@{ shape: image, img: "url", label: "text", pos: t, w: 100, h: 100, constraint: on }`

| [INDEX] | [ATTRIBUTE]  | [VALUES]                | [DEFAULT] |
| :-----: | ------------ | ----------------------- | --------- |
|   [1]   | `img`        | URL string              | Required  |
|   [2]   | `label`      | string                  | none      |
|   [3]   | `pos`        | `t` (top), `b` (bottom) | `b`       |
|   [4]   | `w`          | number (px)             | auto      |
|   [5]   | `h`          | number (px)             | auto      |
|   [6]   | `constraint` | `on`, `off`             | `on`      |

---
### [1.5][MARKDOWN_STRINGS]

Backtick-quoted strings enable rich formatting. **Syntax:** Enclose text in backtick-quoted strings: `` "`text`" ``

**Formatting:** Bold (`**text**`), Italic (`*text*`), auto text wrapping (no `<br>` tags), newlines via line breaks, Unicode and emoji support.<br>
**Applies to:** Node labels, edge labels, subgraph labels (flowchart); node labels (mindmap).

---
### [1.6][EDGES]

Edge style communicates relationship type between nodes.

**Line Types (12):**

| [INDEX] | [SYNTAX] | [TYPE]        | [SEMANTIC]         |
| :-----: | -------- | ------------- | ------------------ |
|   [1]   | `-->`    | Arrow         | Directed flow      |
|   [2]   | `---`    | Open          | Association        |
|   [3]   | `-.->`   | Dotted arrow  | Optional/async     |
|   [4]   | `-.-`    | Dotted open   | Weak association   |
|   [5]   | `==>`    | Thick arrow   | Primary path       |
|   [6]   | `===`    | Thick open    | Strong association |
|   [7]   | `~~~`    | Invisible     | Layout control     |
|   [8]   | `--o`    | Circle end    | Composition        |
|   [9]   | `--x`    | Cross end     | Termination        |
|  [10]   | `<-->`   | Bidirectional | Two-way flow       |
|  [11]   | `o--o`   | Bidir circle  | Mutual composition |
|  [12]   | `x--x`   | Bidir cross   | Mutual termination |

**Length Control:** Extra dashes extend link length (2+ ranks)—`----` (2 ranks), `-----` (3 ranks). Dotted: `-.-`, `-..-`, `-...-`. Thick: `===`, `====`, `=====`.<br>
**Labels:** Pipe syntax (`-->|label|`), inline syntax (`-- label -->`), on open edge (`---|label|`), with length (`-----|label|-----`).<br>
**Chaining:** Multi-target (`A --> B & C & D`), multi-source (`A & B --> C`), sequence (`A --> B --> C`), mixed (`A --> B & C --> D`).<br>
**Edge IDs (v11.6.0+):** Prepend edge with `id@` to assign ID—`A e1@--> B`, then style via `e1@{ animate: true }`.

**Animation via class:**
```
flowchart LR
    A e1@--> B
    classDef animate stroke-dasharray: 9\,5, animation: dash 25s linear infinite
    class e1 animate
```

[IMPORTANT] Escape commas in `stroke-dasharray` as `\,` (comma is style delimiter).

---
### [1.7][SUBGRAPHS]

Subgraphs organize related nodes into logical containers. **Syntax:** `subgraph ID ["Title"]` ... `end`

```
subgraph Phase1 ["Round 1"]
    direction TB
    A1[Step 1] --> A2[Step 2]
end
subgraph Phase2 ["Round 2"]
    B1 --> B2
end
Phase1 --> Phase2
```

| [INDEX] | [RULE]         | [DESCRIPTION]                                           |
| :-----: | -------------- | ------------------------------------------------------- |
|   [1]   | Direction      | `direction TB` inside overrides parent.                 |
|   [2]   | Inheritance    | Subgraph inherits parent direction by default.          |
|   [3]   | Max nesting    | 3 levels recommended.                                   |
|   [4]   | Inter-subgraph | `Phase1 --> Phase2` links subgraphs.                    |
|   [5]   | External links | External node links disable subgraph direction control. |

---
### [1.8][CONFIG]

| [INDEX] | [KEY]                 | [TYPE]  |      [DEFAULT]      | [DESCRIPTION]                                                                                                                                     |
| :-----: | --------------------- | ------- | :-----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | `curve`               | string  |       `basis`       | Edge style: `linear`, `basis`, `bumpX`, `bumpY`, `cardinal`, `catmullRom`, `monotoneX`, `monotoneY`, `natural`, `step`, `stepBefore`, `stepAfter` |
|   [2]   | `nodeSpacing`         | number  |        `50`         | Horizontal gap between nodes (same level)                                                                                                         |
|   [3]   | `rankSpacing`         | number  |        `50`         | Vertical gap between ranks (different levels)                                                                                                     |
|   [4]   | `diagramPadding`      | number  |        `20`         | Padding around entire diagram                                                                                                                     |
|   [5]   | `padding`             | number  |        `15`         | Space between labels and shapes (experimental renderer only)                                                                                      |
|   [6]   | `htmlLabels`          | boolean |       `true`        | Enable HTML in labels                                                                                                                             |
|   [7]   | `wrappingWidth`       | number  |        `200`        | Max label width before wrap                                                                                                                       |
|   [8]   | `defaultRenderer`     | string  |   `dagre-wrapper`   | Renderer: `dagre-d3`, `dagre-wrapper`, `elk`                                                                                                      |
|   [9]   | `titleTopMargin`      | number  |        `25`         | Title spacing above diagram                                                                                                                       |
|  [10]   | `subGraphTitleMargin` | object  | `{top:0, bottom:0}` | Subgraph title margins                                                                                                                            |
|  [11]   | `inheritDir`          | boolean |       `false`       | Subgraphs inherit parent direction                                                                                                                |

---
## [2][BLOCK]
>**Dictum:** *Block diagrams expose system architecture through grid composition.*

<br>

Manual positioning controls grid-based composition. Beta status.

### [2.1][DECLARATION]

**Declaration:** `block-beta`

---
### [2.2][ELEMENTS]

Grid primitives define layout structure.

| [INDEX] | [ELEMENT] | [SYNTAX]                  | [DESCRIPTION]  |
| :-----: | --------- | ------------------------- | -------------- |
|   [1]   | Columns   | `columns N`               | Grid width     |
|   [2]   | Block     | `id["Label"]`             | Basic block    |
|   [3]   | Spanning  | `id["Label"]:N`           | Span N columns |
|   [4]   | Space     | `space`, `space:N`        | Empty cell(s)  |
|   [5]   | Nested    | `block:groupId:N ... end` | Nested block   |
|   [6]   | Arrow     | `-->`, `---`              | Connections    |
|   [7]   | Label     | `--"label"-->`            | Edge with text |

**Columns:** `columns N`—Defines grid width. Precedes all blocks.<br>
**Block:** `id["Label"]` | `id["Label"]:N`—Default occupies 1 column. `:N` suffix spans N columns.<br>
**Space:** `space` | `space:N`—Empty cell(s) for layout control.<br>
**Nested:** `block:groupId:N ... end`—Container for sub-blocks. `:N` determines width.<br>
**Connections:** `-->` | `---` | `--"label"-->`—Link blocks with arrows or lines.

---
### [2.3][EXAMPLE]

```
block-beta
    columns 3
    A["Input"]:1 space:1 B["Output"]:1
    C["Process"]:3
    block:nested:2
        D["Sub 1"]
        E["Sub 2"]
    end
    A --> C --> B
    C --> nested
```

**Layout:** Row 1—`A` (col 1), `space` (col 2), `B` (col 3); Row 2—`C` spanning all 3 columns; Row 3—`nested` block spanning 2 columns.

---
### [2.4][RULES]

[IMPORTANT] Missing `:N` suffix causes layout errors. Specify span width explicitly.

| [INDEX] | [RULE]         | [DESCRIPTION]                                    |
| :-----: | -------------- | ------------------------------------------------ |
|   [1]   | Columns first  | `columns N` precedes all blocks.                 |
|   [2]   | Automatic wrap | Blocks wrap to new row when column count excess. |
|   [3]   | Author control | Manual positioning replaces `flowchart` auto.    |
|   [4]   | Nested width   | `:N` specifier determines parent block width.    |
|   [5]   | Known bugs     | Omitted spans trigger column counting errors.    |

[IMPORTANT] Block diagrams enable CSS-grid-style custom layouts.

---
### [2.5][CONFIG]

| [INDEX] | [KEY]         | [TYPE]  | [DEFAULT] | [DESCRIPTION]          |
| :-----: | ------------- | ------- | :-------: | ---------------------- |
|   [1]   | `useMaxWidth` | boolean |  `true`   | Constrain to container |
|   [2]   | `padding`     | number  |    `8`    | Block padding          |

---
## [3][MINDMAP]
>**Dictum:** *Mindmaps communicate hierarchical relationships through spatial organization.*

<br>

Indentation depth defines parent-child relationships in radial tree layout. Whitespace replaces explicit edges.

### [3.1][DECLARATION]

**Declaration:** `mindmap`

---
### [3.2][HIERARCHY]

Indentation depth establishes parent-child relationships.

| [INDEX] | [ELEMENT] | [SYNTAX]                    | [DESCRIPTION]                 |
| :-----: | --------- | --------------------------- | ----------------------------- |
|   [1]   | Root      | `root((Central))`           | Any shape syntax applies.     |
|   [2]   | Child     | Indentation                 | Whitespace creates hierarchy. |
|   [3]   | Parent    | Nearest smaller indentation | Auto-selects parent node.     |

**Example:**
```
mindmap
    root((Project))
        Planning
            Requirements
            Timeline
        Execution
            Development
            Testing
```

[IMPORTANT] Indentation creates hierarchy. Parent-child links emerge from whitespace depth.

---
### [3.3][SHAPES]

Bracket notation provides 7 shapes: `text` (default, no border), `[text]` (square), `(text)` (rounded square), `((text))` (circle), `))text((` (bang), `)text(` (cloud), `{{text}}` (hexagon).

**Example:**
```
mindmap
    root((Central Idea))
        Square[Task]
        (Rounded)
        Cloud)Thought(
        {{Hexagon}}
```

---
### [3.4][ICONS]

FontAwesome and MDI icons attach to nodes. **Syntax:** `::icon(fa fa-book)` | `::icon(mdi mdi-skull-outline)`

**Example:**
```
mindmap
    root((Project))
        Research::icon(fa fa-book)
        Design::icon(mdi mdi-palette)
        Development::icon(fa fa-code)
        Testing::icon(mdi mdi-flask)
```

**Supported Libraries:** FontAwesome (`fa fa-name`), Material Design Icons (`mdi mdi-name`).

[CRITICAL] Icon fonts must be integrated by site administrator/integrator.

---
### [3.5][CLASSES]

CSS classes enable node styling. **Syntax:** `:::className` | `:::class1 :::class2`

**Example:**
```
mindmap
    root((Tasks))
        Urgent:::red
        Important:::blue :::large
        Optional:::gray
```

**Multiple Classes:**
```
mindmap
    root((Dashboard))
        Priority:::highlight :::bold
        Normal:::default
```

[IMPORTANT] Site administrator defines classes via `classDef`.

---
### [3.6][LAYOUT]

**Default Radial:** Nodes radiate from center with even distribution around root.<br>
**Tidy Tree:** Configure via frontmatter—

```
---
config:
  layout: tidy-tree
---
mindmap
    root((mindmap))
```

**Behavior:** Hierarchical tree layout, top-to-bottom flow. Supports Tidy Tree layout via `layout: tidy-tree`.

---
### [3.7][CONFIG]

| [INDEX] | [KEY]          | [TYPE]  | [DEFAULT] | [DESCRIPTION]          |
| :-----: | -------------- | ------- | :-------: | ---------------------- |
|   [1]   | `padding`      | number  |   `10`    | Node padding           |
|   [2]   | `maxNodeWidth` | number  |   `200`   | Maximum node width     |
|   [3]   | `useMaxWidth`  | boolean |  `true`   | Constrain to container |

---
## [4][INTERACTIVITY]
>**Dictum:** *Click handlers transform diagrams into navigation interfaces.*

<br>

Graph diagrams support callbacks and URL navigation for interactive behaviors.

### [4.1][CALLBACK]

JavaScript callbacks execute on click. **Syntax:** `click nodeId callback "tooltip"` | `click nodeId call callback()`

**Example:**
```
flowchart LR
    A[Node] --> B[Target]
    click A callback "Click to execute"
    click B call handleClick()
```

**JavaScript Integration:**
```javascript
function callback(nodeId) {
    console.log(`Clicked: ${nodeId}`);
}

function handleClick() {
    alert('Node clicked!');
}
```

[IMPORTANT] JavaScript integration code defines callbacks before diagram rendering.

---
### [4.2][URL_NAVIGATION]

Href attribute creates links to external resources. **Syntax:** `click nodeId "https://url" "tooltip"` | `click nodeId href "https://url" "tooltip"` | `click nodeId "https://url" "tooltip" _blank`

**Example:**
```
flowchart LR
    A[Docs] --> B[GitHub]
    click A "https://mermaid.js.org" "View Documentation"
    click B href "https://github.com" "Open Repository" _blank
```

---
### [4.3][TARGETS]

Target attribute determines navigation context.

| [INDEX] | [TARGET]  | [BEHAVIOR]           |
| :-----: | --------- | -------------------- |
|   [1]   | `_self`   | Same frame (default) |
|   [2]   | `_blank`  | New window/tab       |
|   [3]   | `_parent` | Parent frame         |
|   [4]   | `_top`    | Full window          |

---
### [4.4][SECURITY]

Mermaid sanitizes URLs by default. Callback logic requires separate validation.

**Sanitization:** Safe protocols (`http`, `https`) pass validation, JavaScript URLs (`javascript:`) blocked, Data URLs (`data:`) blocked in default config.<br>
**Custom Security:**

```javascript
mermaid.initialize({
    securityLevel: 'strict', // 'strict' | 'loose' | 'antiscript'
});
```

[IMPORTANT] URL sanitization and callback validation operate independently.

[REFERENCE] Security levels: [→global-config.md§2.4](./global-config.md#24security), URL validation: [→validation.md§2.2](./validation.md#22verify).

---
### [4.5][SECURITY_INTERACTIVITY]

| [LEVEL] | [CLICK] | [TOOLTIP] | [USE_CASE] |
| ------- | :-----: | :-------: | ---------- |
| `strict` | — | — | Untrusted content |
| `loose` | [X] | [X] | Trusted content |
| `antiscript` | [X] | [X] | Semi-trusted |

[CRITICAL] ALL interactive features require `securityLevel: 'loose'` or `'antiscript'` via `initialize()`.

---
### [4.6][PROGRAMMATIC_BINDING]

**`mermaid.render()` API requires explicit binding:**

```javascript
const { svg, bindFunctions } = await mermaid.render('id', def);
container.innerHTML = svg;
bindFunctions?.(container);
```

[CRITICAL] Omitting `bindFunctions()` produces non-functional click handlers.

---
### [4.7][TOOLTIP_CSS]

**Class:** `.mermaidTooltip`

**Properties:** `position`, `max-width`, `padding`, `background`, `border-radius`, `z-index`.

[IMPORTANT] Default positioning unreliable—use `position: fixed !important` for consistency.
