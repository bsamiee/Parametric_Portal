# [H1][GLOBAL-CONFIG]
>**Dictum:** *Universal configuration governs all diagram rendering.*

<br>

Mermaid v11+ configuration via YAML frontmatter; ELK layout engine for advanced graph positioning; hand-drawn and classic looks for visual variety.
[CRITICAL] v10.5.0 deprecates `%%{init:...}%%`; use YAML frontmatter with `config:` key exclusively.

---
## [1][FRONTMATTER]
>**Dictum:** *YAML frontmatter precedes all diagram declarations.*

<br>

```yaml
---
config:
  layout: elk
  look: handDrawn
  theme: base
  elk:
    mergeEdges: true
    nodePlacementStrategy: BRANDES_KOEPF
  flowchart:
    curve: basis
---
flowchart LR
    A --> B
```

**Hierarchy:** Mermaid defaults → Site `initialize()` → Diagram frontmatter (lowest to highest precedence).<br>
**Structure:** Opening `---` (line 1), `config:` root key (not `init:`), nested diagram-specific settings (optional), closing `---` (before diagram).

[IMPORTANT] Frontmatter requires consistent indentation; settings are case-sensitive; misspellings silently ignored; malformed YAML breaks diagram.

---
## [2][APPEARANCE]
>**Dictum:** *Appearance settings control visual presentation.*

<br>

| [INDEX] | [KEY]            | [TYPE]  | [DEFAULT] | [DESCRIPTION]                                                        |
| :-----: | ---------------- | ------- | :-------: | -------------------------------------------------------------------- |
|   [1]   | `look`           | string  | `classic` | Visual style: `classic`, `handDrawn`                                 |
|   [2]   | `handDrawnSeed`  | number  |    `0`    | RNG seed for `handDrawn` (`0` = random)                              |
|   [3]   | `theme`          | string  | `default` | Color scheme: `default`, `base`, `dark`, `forest`, `neutral`, `null` |
|   [4]   | `themeVariables` | object  |   `{}`    | Custom theme overrides (`base` theme only)                           |
|   [5]   | `themeCSS`       | string  |  `null`   | Direct CSS injection                                                 |
|   [6]   | `darkMode`       | boolean |  `false`  | Enable dark mode                                                     |

[IMPORTANT] `handDrawn` uses rough.js for sketch-like rendering; `themeVariables` modifies `base` theme exclusively; look configuration supports flowcharts and state diagrams only.

---
## [3][TYPOGRAPHY]
>**Dictum:** *Typography controls text rendering.*

<br>

**Fonts:** `fontFamily` (`trebuchet ms`, `verdana`, `arial`), `altFontFamily` (`null`), `fontSize` (`16px`).<br>
**Wrapping:** `markdownAutoWrap` (`true`, v10.1.0+), `wrap` (`false`, global text wrapping).

---
## [4][RUNTIME]
>**Dictum:** *Runtime settings control execution behavior.*

<br>

| [INDEX] | [KEY]                    | [TYPE]        | [DEFAULT] | [DESCRIPTION]                                                                               |
| :-----: | ------------------------ | ------------- | :-------: | ------------------------------------------------------------------------------------------- |
|   [1]   | `logLevel`               | string/number |    `5`    | Verbosity: `trace`(`0`), `debug`(`1`), `info`(`2`), `warn`(`3`), `error`(`4`), `fatal`(`5`) |
|   [2]   | `maxTextSize`            | number        |  `50000`  | Maximum diagram text characters (DoS protection)                                            |
|   [3]   | `maxEdges`               | number        |   `500`   | Maximum edge count (DoS protection)                                                         |
|   [4]   | `suppressErrorRendering` | boolean       |  `false`  | Hide syntax error diagrams                                                                  |
|   [5]   | `deterministicIds`       | boolean       |  `false`  | Reproducible SVG ID generation                                                              |
|   [6]   | `deterministicIDSeed`    | string        |  `null`   | Static seed for ID generation                                                               |
|   [7]   | `htmlLabels`             | boolean       |  `true`   | Allow HTML tags in labels (global fallback)                                                 |
|   [8]   | `arrowMarkerAbsolute`    | boolean       |  `false`  | Arrow marker absolute positioning                                                           |
|   [9]   | `legacyMathML`           | boolean       |  `false`  | KaTeX fallback for MathML                                                                   |
|  [10]   | `forceLegacyMathML`      | boolean       |  `false`  | Force KaTeX rendering                                                                       |

---
## [5][SECURITY]
>**Dictum:** *Security settings enforce trust boundaries.*

<br>

| [INDEX] | [KEY]             | [TYPE]  | [DEFAULT] | [DESCRIPTION]                                           |
| :-----: | ----------------- | ------- | :-------: | ------------------------------------------------------- |
|   [1]   | `securityLevel`   | string  | `strict`  | Trust level: `strict`, `loose`, `antiscript`, `sandbox` |
|   [2]   | `secure`          | array   |   `[]`    | Restricted config keys (initialize-only)                |
|   [3]   | `startOnLoad`     | boolean |  `true`   | Auto-render on page load                                |
|   [4]   | `dompurifyConfig` | object  |   `{}`    | DOMPurify sanitization options                          |

**Security Levels:**

| [INDEX] | [VALUE]      | [BEHAVIOR]                                                     |
| :-----: | ------------ | -------------------------------------------------------------- |
|   [1]   | `strict`     | Default; tags encoded, scripts disabled, no clicks.            |
|   [2]   | `antiscript` | HTML allowed (no script tags), clicks enabled, links disabled. |
|   [3]   | `loose`      | HTML + scripts allowed, clicks + links enabled.                |
|   [4]   | `sandbox`    | Isolated iframe rendering, no JavaScript execution.            |

[CRITICAL] Frontmatter ignores `securityLevel` overrides—use `initialize()` only.

---
## [6][LAYOUT]
>**Dictum:** *Layout algorithms control node positioning.*

<br>

**Algorithms:** Dagre (`layout: dagre`, default, classic hierarchical layout), ELK (`layout: elk`, advanced layered layout, needs `@mermaid-js/layout-elk`).

### [6.1][ELK_PHASES]

| [INDEX] | [PHASE] | [NAME]                | [PURPOSE]                              |
| :-----: | :-----: | --------------------- | -------------------------------------- |
|   [1]   |    1    | Cycle Breaking        | Reverses edges to create DAG.          |
|   [2]   |    2    | Layer Assignment      | Assigns nodes to hierarchical levels.  |
|   [3]   |    3    | Crossing Minimization | Reorders nodes to reduce crossings.    |
|   [4]   |    4    | Node Placement        | Calculates coordinates within layers.  |
|   [5]   |    5    | Edge Routing          | Calculates edge paths and bend points. |

---
### [6.2][ELK_STRATEGIES]

**Node Placement** (`nodePlacementStrategy`): `BRANDES_KOEPF` (default, balanced compact), `LINEAR_SEGMENTS` (minimizes edge bends), `NETWORK_SIMPLEX` (optimizes edge length, slower), `SIMPLE` (fast basic positioning).<br>
**Cycle Breaking** (`cycleBreakingStrategy`): `GREEDY_MODEL_ORDER` (default, greedy with model order tiebreaker), `GREEDY` (fast heuristic), `DEPTH_FIRST` (DFS-based ordering), `INTERACTIVE` (user-driven cycle resolution), `MODEL_ORDER` (respects input order).<br>
**Model Order** (`considerModelOrder`): `NODES_AND_EDGES` (default, consider both), `NONE` (ignore model order), `PREFER_NODES` (prioritize node order), `PREFER_EDGES` (prioritize edge order).

---
### [6.3][ELK_OPTIONS]

**Configuration:** `mergeEdges` (`false`, edges share paths when possible), `forceNodeModelOrder` (`false`, strict node ordering without reordering).

[IMPORTANT] `mergeEdges` creates compact diagrams but reduces readability.

---
## [7][DIRECTION]
>**Dictum:** *Direction controls diagram flow orientation.*

<br>

**Values:** `LR` (left to right), `RL` (right to left), `TB` (top to bottom), `BT` (bottom to top).<br>
**Applies to:** flowchart, ER, class, state (`TB` also supports subgraphs).

[IMPORTANT] Sequence diagrams: `TB` implicit—direction declaration ignored.

---
## [8][SECURE_KEYS]
>**Dictum:** *Secure keys prevent malicious configuration override.*

<br>

**Keys Restricted to `initialize()` Only** (frontmatter ignores overrides):

**DoS Prevention:** `maxTextSize`, `maxEdges`.<br>
**Security Control:** `secure`, `securityLevel`, `dompurifyConfig`.<br>
**Runtime Control:** `startOnLoad`, `suppressErrorRendering`.

[CRITICAL] Frontmatter ignores these keys; configure via `mermaid.initialize()` at site level.

[REFERENCE] Configuration validation: [→validation.md§1](./validation.md#1configuration).
