# [H1][STYLING]
>**Dictum:** *Theme and visual configuration control diagram appearance.*

<br>

Visual styling includes `themes`, `looks`, `themeVariables`, `classDef`, `linkStyle`, Edge ID, CSS injection, accessibility.

[CRITICAL] Hex colors required—`#RRGGBB` or `#RRGGBBAA` format; named colors NOT recognized; RGB partial support for `sequence` `rect` only.<br>
[REFERENCE] Styling validation: [→validation.md§1](./validation.md#1configuration).

---
## [1][THEMES_LOOKS]
>**Dictum:** *Presets and looks establish visual foundation.*

<br>

| [INDEX] | [THEME]   | [CUSTOMIZABLE] | [USE_CASE]              |
| :-----: | --------- | :------------: | ----------------------- |
|   [1]   | `base`    |      Yes       | Brand customization     |
|   [2]   | `default` |       No       | General purpose         |
|   [3]   | `dark`    |       No       | Dark environments       |
|   [4]   | `forest`  |       No       | Nature/organic themes   |
|   [5]   | `neutral` |       No       | Print-friendly, minimal |

| [INDEX] | [LOOK]      | [ENGINE] | [VERSION] | [DESCRIPTION]              |
| :-----: | ----------- | -------- | --------- | -------------------------- |
|   [1]   | `neo`       | Standard | v11.0+    | Default modern style       |
|   [2]   | `classic`   | Standard | v11.0+    | Traditional appearance     |
|   [3]   | `handDrawn` | Standard | v11.0+    | Sketch-style hand-drawn    |

[IMPORTANT] ONLY `theme: base` accepts `themeVariables`; looks apply to `flowchart`, `state`, `packet` diagrams—expanding coverage.

```yaml
---
config:
  look: handDrawn
  theme: base
  themeVariables:
    primaryColor: "#ff0000"
---
```

```yaml
---
config:
  look: neo
  theme: base
  themeVariables:
    primaryColor: "#ff0000"
---
```

---
## [2][THEMEVARIABLES]
>**Dictum:** *Variables cascade from primaryColor when unset.*

<br>

### [2.1][CORE]

| [INDEX] | [VARIABLE]           | [TYPE]  | [DEFAULT]      | [DESCRIPTION]                        |
| :-----: | -------------------- | ------- | -------------- | ------------------------------------ |
|   [1]   | `background`         | hex     | `#f4f4f4`      | Canvas background                    |
|   [2]   | `darkMode`           | boolean | `false`        | Triggers derived color adjustments   |
|   [3]   | `fontFamily`         | string  | `trebuchet ms` | Font stack                           |
|   [4]   | `fontSize`           | string  | `16px`         | Base text size                       |
|   [5]   | `primaryColor`       | hex     | `#fff4dd`      | Derives secondary, tertiary, borders |
|   [6]   | `primaryTextColor`   | hex     | `Calculated`   | Text on primary fills                |
|   [7]   | `primaryBorderColor` | hex     | `Calculated`   | Border on primary elements           |
|   [8]   | `secondaryColor`     | hex     | `Calculated`   | Hue-shifted from primary             |
|   [9]   | `tertiaryColor`      | hex     | `Calculated`   | Accent coloring                      |
|  [10]   | `lineColor`          | hex     | `Calculated`   | Default edge stroke                  |

### [2.2][DIAGRAM_SPECIFIC]

**Flowchart:** `mainBkg`, `nodeBorder`, `nodeTextColor`, `clusterBkg`, `clusterBorder`, `edgeLabelBackground`, `defaultLinkColor`, `titleColor`.<br>
**Sequence:** `actorBkg`, `actorBorder`, `actorTextColor`, `actorLineColor`, `signalColor`, `signalTextColor`, `labelBoxBkgColor`, `labelBoxBorderColor`, `noteBkgColor`, `noteBorderColor`, `noteTextColor`, `activationBkgColor`, `activationBorderColor`, `sequenceNumberColor`.<br>
**State:** `labelColor`, `stateLabelColor`, `stateBkg`, `altBackground`, `compositeBackground`, `compositeTitleBackground`, `compositeBorder`, `transitionColor`, `transitionLabelColor`, `specialStateColor`, `errorBkgColor`, `errorTextColor`.<br>
**Class:** `classText`.<br>
**Gantt:** `sectionBkgColor`, `altSectionBkgColor`, `taskBkgColor`, `taskBorderColor`, `taskTextColor`, `activeTaskBkgColor`, `activeTaskBorderColor`, `critBkgColor`, `critBorderColor`, `doneTaskBkgColor`, `doneTaskBorderColor`, `gridColor`, `todayLineColor`.<br>
**Pie:** `pie1` through `pie12` for slice colors; `pieStrokeColor`, `pieStrokeWidth`, `pieTitleTextColor`, `pieSectionTextColor`.<br>
**GitGraph:** `git0` through `git7` for branch colors; `gitBranchLabel0` through `gitBranchLabel7`; `commitLabelColor`, `commitLabelBackground`, `tagLabelColor`, `tagLabelBackground`, `tagLabelBorder`.<br>
**Journey:** `fillType0` through `fillType7` for section fills.<br>
**Quadrant:** `quadrant1Fill` through `quadrant4Fill`; `quadrant1TextFill` through `quadrant4TextFill`; `quadrantPointFill`, `quadrantPointTextFill`, `quadrantXAxisTextFill`, `quadrantYAxisTextFill`.<br>
**Radar** (nested `radar:` scope): `axisColor`, `axisStrokeWidth`, `axisLabelFontSize`, `curveOpacity`, `curveStrokeWidth`, `graticuleColor`, `graticuleStrokeWidth`, `legendBoxSize`, `legendFontSize`.<br>
**Timeline/C4:** `cScale0` through `cScale11`; `cScaleInv0` through `cScaleInv11`; `cScalePeer0` through `cScalePeer11`; `cScaleLabel0` through `cScaleLabel11`.<br>
**Requirement:** `requirementBackground`, `requirementBorderColor`, `requirementTextColor`, `relationColor`, `relationLabelBackground`, `relationLabelColor`.<br>
**ER:** `personBorder`, `personBkg`.<br>
**Architecture:** `archEdgeColor`, `archEdgeArrowColor`, `archEdgeWidth`, `archGroupBorderColor`, `archGroupBorderWidth`.<br>
**Apply:** `A:::cssClass --> B`.

---
## [3][CLASSDEF]
>**Dictum:** *Reusable style classes prevent inline repetition.*

<br>

**Declaration:** `classDef name prop:val,prop:val` or `classDef cls1,cls2 prop:val` or `classDef default prop:val`.<br>
**Properties (SVG CSS):** `fill`, `stroke`, `stroke-width`, `stroke-dasharray` (escape commas as `5\,5`), `color`, `font-size`, `font-weight`, `font-style`, `opacity` (range `0` to `1`), `rx`, `ry`.<br>
**Application:** `NodeID:::className` or `class nodeId className` or `class id1,id2 className`.<br>
**Inline Override:** `style nodeId prop:val,prop:val`—place after node definitions.<br>
**Supported:** `flowchart`, `state`, `class`, `requirement`, `quadrant`, `treemap`, `architecture` diagrams.

[CRITICAL] Notes and namespaces NOT styleable; place `classDef` at diagram end; subgraph titles NOT individually styleable.

---
## [4][LINKSTYLE_EDGE_ID]
>**Dictum:** *Edge styling controls link appearance and animation.*

<br>

### [4.1][LINKSTYLE]

**Index-based styling:**

| [INDEX] | [PATTERN]      | [SYNTAX]                                   |
| :-----: | -------------- | ------------------------------------------ |
|   [1]   | Single edge    | `linkStyle 0 stroke:#hex,stroke-width:2px` |
|   [2]   | Multiple edges | `linkStyle 0,1,2 stroke:#hex`              |
|   [3]   | Default style  | `linkStyle default stroke:#hex`            |
|   [4]   | Previous edge  | `linkStyle -` (v11.6.0+)                   |

**Properties:** `stroke`, `stroke-width`, `color` for labels, `stroke-dasharray`, `fill` (set `none`).<br>
**Curves:** `basis`, `bumpX`, `bumpY`, `cardinal`, `catmullRom`, `linear`, `monotoneX`, `monotoneY`, `natural`, `step`, `stepAfter`, `stepBefore`.

[IMPORTANT] Indices are 0-based in declaration order; only `-` references previous edge—no `-1` or `-2` syntax.

### [4.2][EDGE_ID]

**Named edges for animation (v11.6.0+):**

**Declaration:** `A e1@--> B`.<br>
**Properties:** `e1@{ animate: true }` or `e1@{ animation: fast|slow }`.

[CRITICAL] Edge ID cannot style `color` or `stroke` directly—Issue #6784; use `linkStyle` for stroke styling.

### [4.3][ANIMATION_CSS]

| [PROPERTY] | [VALUES] | [PURPOSE] |
| ---------- | -------- | --------- |
| `stroke-dasharray` | `{dash},{gap}` (e.g., `9,5`) | Dash pattern |
| `stroke-dashoffset` | Numeric (e.g., `900`) | Animation start position |
| `animation` | `{name} {dur} {timing} {iter}` | CSS animation declaration |

**Timing Functions:** `linear`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1,y1,x2,y2)`.

[IMPORTANT] Escape commas in `stroke-dasharray` as `\,` (comma is style delimiter in classDef).

---
### [4.4][EDGE_CURVE_ANIMATION]

**Combined syntax (v11.10.0+):** `e1@{ curve: linear, animation: fast }`.

**Curve Values:** `linear`, `basis`, `cardinal`, `catmullRom`, `natural`, `step`, `stepBefore`, `stepAfter`.

---
### [4.5][ANIMATION_SUPPORT]

| [DIAGRAM] | [EDGE] | [NODE] |
| --------- | :----: | :----: |
| Flowchart | [X] | — |
| State | — | — |
| Class | — | — |
| ER | — | — |

---
## [5][CSS_INJECTION]
>**Dictum:** *CSS injection overrides theme defaults via specificity.*

<br>

```css
.cssClass > rect { fill: #ff0000 !important; stroke: #ffff00 !important; }
.er.entityBox { stroke: #0000ff !important; }
```

[CRITICAL] Use `!important`—Mermaid CSS takes precedence; Shadow DOM (MkDocs Material) prevents override; ER requires `themeCSS` config.

---
## [6][ACCESSIBILITY]
>**Dictum:** *Accessibility directives expose diagram semantics to assistive technology.*

<br>

| [INDEX] | [DIRECTIVE]          | [SYNTAX]                       |
| :-----: | -------------------- | ------------------------------ |
|   [1]   | Title                | `accTitle: Title text`         |
|   [2]   | Description (single) | `accDescr: Description text`   |
|   [3]   | Description (multi)  | `accDescr { multi-line text }` |

[IMPORTANT] Place after diagram type; generates `<title>` and `<desc>` with `aria` attributes; known issues for `block-beta` (#6524) and `mindmap` (#4167)—treated as nodes or parse errors.
