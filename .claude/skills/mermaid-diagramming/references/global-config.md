# [H1][GLOBAL-CONFIG]
>**Dictum:** *Universal configuration governs all diagram rendering.*

<br>

Mermaid v11+ configuration via YAML frontmatter; ELK layout engine for advanced graph positioning.

[CRITICAL] v10.5.0 deprecates `%%{init:...}%%`; use YAML frontmatter with `config:` key exclusively.

---
## [1][FRONTMATTER]
>**Dictum:** *YAML frontmatter precedes all diagram declarations.*

<br>

**Structure:** Opening `---` (line 1), `config:` root key (not `init:`), nested diagram-specific settings, closing `---` (before diagram).
**Precedence:** Mermaid defaults -> Site `initialize()` -> Diagram frontmatter (lowest to highest).

[IMPORTANT] Consistent indentation required; case-sensitive keys; misspellings silently ignored; malformed YAML breaks diagram.

---
## [2][APPEARANCE]
>**Dictum:** *Appearance settings control visual presentation.*

<br>

| [INDEX] | [KEY]            | [TYPE]  | [DEFAULT] | [DESCRIPTION]                                  |
| :-----: | ---------------- | ------- | :-------: | ---------------------------------------------- |
|   [1]   | `look`           | string  |   `neo`   | `neo`, `classic` (flowcharts/state only)       |
|   [2]   | `theme`          | string  | `default` | `default`, `base`, `dark`, `forest`, `neutral` |
|   [3]   | `themeVariables` | object  |   `{}`    | Custom overrides (`base` theme only)           |
|   [4]   | `themeCSS`       | string  |  `null`   | Direct CSS injection                           |
|   [5]   | `darkMode`       | boolean |  `false`  | Dark mode color adjustments                    |

---
## [3][TYPOGRAPHY]
>**Dictum:** *Typography controls text rendering.*

<br>

**Fonts:** `fontFamily` (trebuchet ms), `altFontFamily` (null), `fontSize` (16px).
**Wrapping:** `markdownAutoWrap` (true, v10.1.0+), `wrap` (false, global).

---
## [4][RUNTIME]
>**Dictum:** *Runtime settings control execution behavior.*

<br>

| [INDEX] | [KEY]                    | [TYPE]  | [DEFAULT] | [DESCRIPTION]                     |
| :-----: | ------------------------ | ------- | :-------: | --------------------------------- |
|   [1]   | `logLevel`               | number  |    `5`    | 0=trace, 1=debug, 2=info, 5=fatal |
|   [2]   | `maxTextSize`            | number  |  `50000`  | Max diagram text chars (DoS)      |
|   [3]   | `maxEdges`               | number  |   `500`   | Max edge count (DoS)              |
|   [4]   | `suppressErrorRendering` | boolean |  `false`  | Hide syntax error diagrams        |
|   [5]   | `deterministicIds`       | boolean |  `false`  | Reproducible SVG IDs              |
|   [6]   | `htmlLabels`             | boolean |  `true`   | Allow HTML tags in labels         |

---
## [5][SECURITY]
>**Dictum:** *Security settings enforce trust boundaries.*

<br>

| [INDEX] | [LEVEL]      | [BEHAVIOR]                                         |
| :-----: | ------------ | -------------------------------------------------- |
|   [1]   | `strict`     | Default; tags encoded, scripts disabled, no clicks |
|   [2]   | `antiscript` | HTML allowed (no scripts), clicks enabled          |
|   [3]   | `loose`      | HTML + scripts allowed, clicks + links enabled     |
|   [4]   | `sandbox`    | Isolated iframe, no JavaScript                     |

**Config:** `securityLevel` (strict), `secure` (restricted keys), `startOnLoad` (true), `dompurifyConfig` ({}).

[CRITICAL] Frontmatter ignores `securityLevel` overrides — use `initialize()` only.

---
## [6][LAYOUT]
>**Dictum:** *Layout algorithms control node positioning.*

<br>

**Algorithms:** Dagre (`layout: dagre`, default hierarchical), ELK (`layout: elk`, requires `@mermaid-js/layout-elk`).

**ELK options:** `mergeEdges` (false), `nodePlacementStrategy` (BRANDES_KOEPF | NETWORK_SIMPLEX | LINEAR_SEGMENTS | SIMPLE), `cycleBreakingStrategy` (GREEDY_MODEL_ORDER | MODEL_ORDER | GREEDY | DEPTH_FIRST | INTERACTIVE), `forceNodeModelOrder` (false), `considerModelOrder` (NODES_AND_EDGES).

---
## [7][DIRECTION]
>**Dictum:** *Direction controls diagram flow orientation.*

<br>

**Values:** `LR`, `RL`, `TB`, `BT`. Applies to flowchart, ER, class, state. Sequence diagrams: `TB` implicit — direction ignored.

---
## [8][SECURE_KEYS]
>**Dictum:** *Secure keys prevent malicious configuration override.*

<br>

**Restricted to `initialize()` only:** `maxTextSize`, `maxEdges` (DoS), `secure`, `securityLevel`, `dompurifyConfig` (security), `startOnLoad`, `suppressErrorRendering` (runtime).

[CRITICAL] Frontmatter ignores these keys; configure via `mermaid.initialize()` at site level.
