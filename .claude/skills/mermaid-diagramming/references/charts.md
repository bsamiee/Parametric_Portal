# [H1][CHARTS]
>**Dictum:** *Enable proportional, spatial, flow, and temporal data representation.*

<br>

Seven chart types: `pie` (proportions), `quadrantChart` (2x2 matrix), `xychart-beta` (Cartesian), `radar-beta` (multi-dimensional), `sankey-beta` (flow), `gantt` (schedules), `treemap-beta` (hierarchy).

[REFERENCE] Theme, classDef: [→styling.md](./styling.md)<br>
[REFERENCE] Chart validation: [→validation.md§7](./validation.md#7chart_diagrams)

---
## [1][SIMPLE_CHARTS]
>**Dictum:** *Visualize proportions and distributions without coordinate systems.*

<br>

### [1.1][PIE]

**Declaration:** `pie`.<br>
**Config:** `textPosition` (`number`, `0.75`, label position `0.0`-`1.0` from center), `useMaxWidth` (`boolean`, `true`, constrain to container).<br>

| [INDEX] | [ELEMENT]   | [SYNTAX]          | [DESCRIPTION]       |
| :-----: | ----------- | ----------------- | ------------------- |
|   [1]   | Declaration | `pie`             | Chart type          |
|   [2]   | Show data   | `showData`        | Display percentages |
|   [3]   | Title       | `title Text`      | Chart title         |
|   [4]   | Slice       | `"Label" : value` | Data segment        |

```
pie showData
    title Browser Market Share
    "Chrome" : 65
    "Safari" : 19
    "Firefox" : 10
    "Other" : 6
```

**ThemeVariables:**

| [INDEX] | [VARIABLE]            | [DESCRIPTION]          |
| :-----: | --------------------- | ---------------------- |
|   [1]   | `pie1`-`pie12`        | Slice colors (12 max)  |
|   [2]   | `pieStrokeColor`      | Slice borders          |
|   [3]   | `pieStrokeWidth`      | Border width           |
|   [4]   | `pieTitleTextSize`    | Title font size        |
|   [5]   | `pieTitleTextColor`   | Title color            |
|   [6]   | `pieSectionTextColor` | Slice label text color |
|   [7]   | `pieSectionTextSize`  | Slice label font size  |

[IMPORTANT] Slice colors apply sequentially: `pie1` → first slice, `pie2` → second slice, etc.<br>
[IMPORTANT] Use hex colors only—theming engine rejects color names.

---
### [1.2][QUADRANT]

**Declaration:** `quadrantChart`.

| [INDEX] | [ELEMENT] | [SYNTAX]              | [DESCRIPTION]          |
| :-----: | --------- | --------------------- | ---------------------- |
|   [1]   | Title     | `title Text`          | Chart title            |
|   [2]   | X-axis    | `x-axis Low --> High` | Horizontal axis        |
|   [3]   | Y-axis    | `y-axis Low --> High` | Vertical axis          |
|   [4]   | Quadrant  | `quadrant-1 Label`    | Quadrant labels (1-4)  |
|   [5]   | Point     | `Item: [x, y]`        | Data point (0-1 range) |

**Quadrant Numbering:** `quadrant-1` (Top-right), `quadrant-2` (Top-left), `quadrant-3` (Bottom-left), `quadrant-4` (Bottom-right).

```
quadrantChart
    title Priority Matrix
    x-axis Low Impact --> High Impact
    y-axis Low Effort --> High Effort
    quadrant-1 Quick Wins
    quadrant-2 Major Projects
    quadrant-3 Fill Ins
    quadrant-4 Thankless Tasks
    Feature A: [0.8, 0.2]
    Feature B: [0.3, 0.7]
    Feature C:::highlight: [0.6, 0.5]
```

**Point Styling:** Direct style `Point A: [0.6, 0.3] radius: 15, color: #ff33f0, stroke-color: #00ff0f, stroke-width: 5px` OR classDef `Item:::className: [x, y]`.<br>
**Style Properties:** `radius` (`number`, default `5`), `color` (`#hex`), `stroke-color` (`#hex`), `stroke-width` (`px`).

[IMPORTANT] Style precedence: Direct styles → Class styles → Theme styles.

**ThemeVariables:**

| [INDEX] | [VARIABLE]                              | [DESCRIPTION]          |
| :-----: | --------------------------------------- | ---------------------- |
|   [1]   | `quadrant1Fill`-`quadrant4Fill`         | Quadrant backgrounds   |
|   [2]   | `quadrant1TextFill`-`quadrant4TextFill` | Quadrant text colors   |
|   [3]   | `quadrantPointFill`                     | Default point fill     |
|   [4]   | `quadrantPointTextFill`                 | Point label text color |
|   [5]   | `quadrantXAxisTextFill`                 | X-axis label color     |
|   [6]   | `quadrantYAxisTextFill`                 | Y-axis label color     |
|   [7]   | `quadrantInternalBorderStrokeFill`      | Internal grid borders  |
|   [8]   | `quadrantExternalBorderStrokeFill`      | External chart borders |
|   [9]   | `quadrantTitleFill`                     | Title text color       |

**Config:**

| [INDEX] | [KEY]                               | [TYPE]   | [DEFAULT] | [DESCRIPTION]                     |
| :-----: | ----------------------------------- | -------- | :-------: | --------------------------------- |
|   [1]   | `chartWidth`                        | `number` |   `500`   | Chart width                       |
|   [2]   | `chartHeight`                       | `number` |   `500`   | Chart height                      |
|   [3]   | `titleFontSize`                     | `number` |   `20`    | Title font size                   |
|   [4]   | `titlePadding`                      | `number` |   `10`    | Title padding                     |
|   [5]   | `quadrantPadding`                   | `number` |    `5`    | Padding outside quadrants         |
|   [6]   | `xAxisLabelFontSize`                | `number` |   `16`    | X-axis label font size            |
|   [7]   | `yAxisLabelFontSize`                | `number` |   `16`    | Y-axis label font size            |
|   [8]   | `xAxisLabelPadding`                 | `number` |    `5`    | X-axis label padding              |
|   [9]   | `yAxisLabelPadding`                 | `number` |    `5`    | Y-axis label padding              |
|  [10]   | `quadrantLabelFontSize`             | `number` |   `16`    | Quadrant label font size          |
|  [11]   | `quadrantTextTopPadding`            | `number` |    `5`    | Quadrant text top padding         |
|  [12]   | `pointTextPadding`                  | `number` |    `5`    | Padding between point and label   |
|  [13]   | `pointLabelFontSize`                | `number` |   `12`    | Point label font size             |
|  [14]   | `pointRadius`                       | `number` |    `5`    | Default point radius              |
|  [15]   | `xAxisPosition`                     | `string` |   `top`   | X-axis position (`top`, `bottom`) |
|  [16]   | `yAxisPosition`                     | `string` |  `left`   | Y-axis position (`left`, `right`) |
|  [17]   | `quadrantInternalBorderStrokeWidth` | `number` |    `1`    | Internal border width             |
|  [18]   | `quadrantExternalBorderStrokeWidth` | `number` |    `2`    | External border width             |

---
## [2][COORDINATE_CHARTS]
>**Dictum:** *Project data onto orthogonal spatial dimensions.*

<br>

### [2.1][XYCHART]

**Declaration:** `xychart-beta`.

| [INDEX] | [ELEMENT]           | [SYNTAX]                     | [DESCRIPTION]              |
| :-----: | ------------------- | ---------------------------- | -------------------------- |
|   [1]   | Orientation         | `horizontal`                 | Horizontal bars (optional) |
|   [2]   | Title               | `title "Text"`               | Chart title                |
|   [3]   | X-axis (categories) | `x-axis [a, b, c]`           | Category labels            |
|   [4]   | X-axis (range)      | `x-axis "Label" min --> max` | Numeric axis               |
|   [5]   | Y-axis              | `y-axis "Label" min --> max` | Value axis                 |
|   [6]   | Bar                 | `bar [values]`               | Bar chart data             |
|   [7]   | Line                | `line [values]`              | Line chart data            |

**Horizontal orientation:**
```
xychart-beta horizontal
    title "Comparison"
    x-axis [A, B, C]
    bar [10, 20, 15]
```

**Multiple series:**
```
xychart-beta
    title "Monthly Sales"
    x-axis [Jan, Feb, Mar, Apr, May]
    y-axis "Revenue (K)" 0 --> 100
    bar [30, 45, 60, 55, 70]
    line [25, 40, 55, 50, 65]
```

[CRITICAL] Array lengths must match x-axis category count.<br>
[IMPORTANT] `plotColorPalette` colors apply sequentially to bars/lines.

**Config:** `width` (`number`, `700`), `height` (`number`, `500`), `titleFontSize` (`number`, `20`), `titlePadding` (`number`, `10`), `showTitle` (`boolean`, `true`), `chartOrientation` (`string`, `vertical` or `horizontal`), `plotReservedSpacePercent` (`number`, `50`, minimum space plots take), `showDataLabel` (`boolean`, `false`, show value within bar).

**ThemeVariables** (nested under `xyChart:` key):

| [INDEX] | [VARIABLE]         | [DESCRIPTION]                   |
| :-----: | ------------------ | ------------------------------- |
|   [1]   | `backgroundColor`  | Background color                |
|   [2]   | `titleColor`       | Title text color                |
|   [3]   | `xAxisLabelColor`  | X-axis label color              |
|   [4]   | `xAxisTitleColor`  | X-axis title color              |
|   [5]   | `xAxisTickColor`   | X-axis tick color               |
|   [6]   | `xAxisLineColor`   | X-axis line color               |
|   [7]   | `yAxisLabelColor`  | Y-axis label color              |
|   [8]   | `yAxisTitleColor`  | Y-axis title color              |
|   [9]   | `yAxisTickColor`   | Y-axis tick color               |
|  [10]   | `yAxisLineColor`   | Y-axis line color               |
|  [11]   | `plotColorPalette` | Series colors (comma-separated) |

**Theme syntax:**
```yaml
---
config:
  themeVariables:
    xyChart:
      titleColor: '#ff0000'
      backgroundColor: '#f0f8ff'
---
```

---
### [2.2][RADAR]

**Declaration:** `radar-beta` (v11.6.0+).

| [INDEX] | [ELEMENT] | [SYNTAX]                    | [DESCRIPTION]                  |
| :-----: | --------- | --------------------------- | ------------------------------ |
|   [1]   | Title     | `title Text`                | Chart title                    |
|   [2]   | Axis      | `axis A, B, C, D, E`        | Dimension labels               |
|   [3]   | Max       | `max value`                 | Axis maximum                   |
|   [4]   | Min       | `min value`                 | Axis minimum                   |
|   [5]   | Ticks     | `ticks N`                   | Grid line count                |
|   [6]   | Graticule | `graticule polygon\|circle` | Grid shape (default: `circle`) |
|   [7]   | Curve     | `"Series": [values]`        | Data series                    |
|   [8]   | Legend    | `showLegend`                | Show/hide legend               |

```
radar-beta
    title Skills Assessment
    max 10
    min 0
    ticks 5
    graticule polygon
    axis Frontend, Backend, DevOps, Security, Testing
    "Developer A": [8, 6, 7, 9, 5]
    "Developer B": [6, 9, 8, 5, 7]
```

**Alternative Curve Syntax:** `curve name{v1,v2,v3,v4,v5}`.

[IMPORTANT] Axis count must match value array length.<br>
[IMPORTANT] Omitting `max` value triggers automatic scaling from data points.<br>
[IMPORTANT] Color scales `cScale${i}` apply to curves sequentially (`i` = `0` to `11`).

**Config:** `width` (`number`, `600`), `height` (`number`, `600`), `marginTop`/`marginBottom`/`marginLeft`/`marginRight` (`number`, `50`), `axisScaleFactor` (`number`, `1`), `axisLabelFactor` (`number`, `1.05`), `curveTension` (`number`, `0.17`).

**ThemeVariables** (nested under `radar:` key):

| [INDEX] | [VARIABLE]             | [DEFAULT] | [DESCRIPTION]         |
| :-----: | ---------------------- | :-------: | --------------------- |
|   [1]   | `axisColor`            |  `black`  | Axis line color       |
|   [2]   | `axisStrokeWidth`      |    `1`    | Axis line width       |
|   [3]   | `axisLabelFontSize`    |  `12px`   | Axis label font size  |
|   [4]   | `curveOpacity`         |   `0.7`   | Data curve opacity    |
|   [5]   | `curveStrokeWidth`     |    `2`    | Curve line width      |
|   [6]   | `graticuleColor`       |  `black`  | Grid line color       |
|   [7]   | `graticuleOpacity`     |   `0.5`   | Grid transparency     |
|   [8]   | `graticuleStrokeWidth` |    `1`    | Grid line width       |
|   [9]   | `legendBoxSize`        |   `10`    | Legend box dimensions |
|  [10]   | `legendFontSize`       |  `14px`   | Legend font size      |

**Color scales:** `cScale0`-`cScale11`—Curve colors (up to 12).

**Theme syntax:**
```yaml
---
config:
  themeVariables:
    cScale0: '#FF0000'
    cScale1: '#00FF00'
    radar:
      axisColor: '#FF0000'
---
```

---
## [3][FLOW_CHARTS]
>**Dictum:** *Quantify movement through directed acyclic networks.*

<br>

### [3.1][SANKEY]

**Declaration:** `sankey-beta`.

**Syntax:** CSV format, one flow per line.

```
sankey-beta

Agricultural,Energy,50
Agricultural,Industrial,30
Energy,Residential,40
Energy,Commercial,10
Industrial,Waste,15
Industrial,Products,15
```

[IMPORTANT] DAG structure only—reject circular flows.<br>
[IMPORTANT] `linkColor: source`—link inherits source node color.<br>
[IMPORTANT] `linkColor: target`—link inherits target node color.<br>
[IMPORTANT] `linkColor: gradient`—smooth transition between source/target.

**Config:**

| [INDEX] | [KEY]           | [TYPE/VALUES] | [DEFAULT]  | [DESCRIPTION]                                          |
| :-----: | --------------- | ------------- | :--------: | ------------------------------------------------------ |
|   [1]   | `width`         | `number`      |   `600`    | Chart width                                            |
|   [2]   | `height`        | `number`      |   `400`    | Chart height                                           |
|   [3]   | `linkColor`     | `string`      | `gradient` | Flow coloring: `source`, `target`, `gradient`, `#hex`  |
|   [4]   | `nodeAlignment` | `string`      | `justify`  | Node positioning: `justify`, `center`, `left`, `right` |
|   [5]   | `useMaxWidth`   | `boolean`     |  `false`   | Use maximum available width                            |
|   [6]   | `showValues`    | `boolean`     |   `true`   | Display values along with title                        |
|   [7]   | `prefix`        | `string`      |    `""`    | Text prepended to values                               |
|   [8]   | `suffix`        | `string`      |    `""`    | Text appended to values                                |

**ThemeVariables:** `fontFamily` (font family for all text).

---
## [4][TEMPORAL_CHARTS]
>**Dictum:** *Sequence tasks and hierarchies across time axis.*

<br>

### [4.1][GANTT]

**Declaration:** `gantt`.

**Structure:**

| [INDEX] | [ELEMENT]   | [SYNTAX]                        | [DESCRIPTION]        |
| :-----: | ----------- | ------------------------------- | -------------------- |
|   [1]   | Title       | `title Text`                    | Chart title          |
|   [2]   | Date format | `dateFormat YYYY-MM-DD`         | Input format         |
|   [3]   | Axis format | `axisFormat %m-%d`              | Display format       |
|   [4]   | Section     | `section Name`                  | Task group           |
|   [5]   | Task        | `Name :id, start, duration`     | Task definition      |
|   [6]   | Milestone   | `Name :milestone, m1, date, 0d` | Zero-duration marker |

**Task Syntax:** `Name :modifiers, id, start, duration|end`.<br>
**Start options:** Explicit date (`2024-01-01`), After dependency (`after taskId`), Until dependency (`until taskId`).<br>
**Duration options:** Days (`7d`), Weeks (`2w`), Months (`1m`), End date (`2024-01-15`).<br>

**Modifiers:**

| [INDEX] | [MODIFIER]  | [EFFECT]          | [APPEARANCE]               |
| :-----: | ----------- | ----------------- | -------------------------- |
|   [1]   | `done`      | Mark complete     | Strikethrough              |
|   [2]   | `active`    | Highlight current | Bold outline               |
|   [3]   | `crit`      | Critical path     | Red highlight              |
|   [4]   | `milestone` | Zero duration     | Diamond marker             |
|   [5]   | `vert`      | Vertical marker   | Vertical line across chart |

```
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    axisFormat %b %d

    section Planning
        Research    :done, a1, 2024-01-01, 7d
        Design      :active, a2, after a1, 5d

    section Development
        Backend     :crit, b1, after a2, 14d
        Frontend    :b2, after a2, 10d

    section Launch
        Deploy      :milestone, m1, after b1, 0d
```

**Exclusions:**

| [INDEX] | [DIRECTIVE]      | [SYNTAX]                          | [DESCRIPTION]                |
| :-----: | ---------------- | --------------------------------- | ---------------------------- |
|   [1]   | Exclude weekends | `excludes weekends`               | Skip Sat/Sun                 |
|   [2]   | Exclude dates    | `excludes 2024-01-15, 2024-01-16` | Skip specific dates          |
|   [3]   | Include dates    | `includes 2024-01-20`             | Re-include excluded          |
|   [4]   | Weekend config   | `weekend friday`                  | Set weekend start (v11.0.0+) |

**Display:**

| [INDEX] | [DIRECTIVE]   | [SYNTAX]                                   | [DESCRIPTION]         |
| :-----: | ------------- | ------------------------------------------ | --------------------- |
|   [1]   | Today marker  | `todayMarker off`                          | Hide marker           |
|   [2]   | Today style   | `todayMarker stroke-width:5px,stroke:#00f` | Custom style          |
|   [3]   | Tick interval | `tickInterval 1day\|1week\|1month`         | Axis ticks            |
|   [4]   | Compact mode  | `displayMode: compact`                     | In frontmatter config |
|   [5]   | Top axis      | `topAxis`                                  | Axis at top           |

[IMPORTANT] Engine accepts hex colors only—reject color names.<br>
[IMPORTANT] Only `base` theme exposes full themeVariables customization.

**Config:**

| [INDEX] | [KEY]                  | [TYPE]    | [DEFAULT]  | [DESCRIPTION]                               |
| :-----: | ---------------------- | --------- | :--------: | ------------------------------------------- |
|   [1]   | `titleTopMargin`       | `number`  |    `25`    | Margin top for title                        |
|   [2]   | `barHeight`            | `number`  |    `20`    | Height of bars                              |
|   [3]   | `barGap`               | `number`  |    `4`     | Margin between activities                   |
|   [4]   | `topPadding`           | `number`  |    `50`    | Spacing between title and diagram           |
|   [5]   | `rightPadding`         | `number`  |    `75`    | Space for section names (right)             |
|   [6]   | `leftPadding`          | `number`  |    `75`    | Space for section names (left)              |
|   [7]   | `gridLineStartPadding` | `number`  |    `35`    | Grid line start position                    |
|   [8]   | `fontSize`             | `number`  |    `11`    | Font size                                   |
|   [9]   | `sectionFontSize`      | `number`  |    `11`    | Section font size                           |
|  [10]   | `numberSectionStyles`  | `number`  |    `4`     | Alternating section styles                  |
|  [11]   | `axisFormat`           | `string`  | `%Y-%m-%d` | Date/time format                            |
|  [12]   | `tickInterval`         | `string`  |    `-`     | Axis tick interval                          |
|  [13]   | `topAxis`              | `boolean` |  `false`   | Date labels at chart top                    |
|  [14]   | `displayMode`          | `string`  |    `-`     | Set to `compact` for multiple tasks per row |
|  [15]   | `weekday`              | `string`  |  `sunday`  | Starting day for week intervals             |

**ThemeVariables:**

| [INDEX] | [VARIABLE]              | [DESCRIPTION]                  |
| :-----: | ----------------------- | ------------------------------ |
|   [1]   | `sectionBkgColor`       | Section background (even rows) |
|   [2]   | `altSectionBkgColor`    | Section background (odd rows)  |
|   [3]   | `sectionBkgColor2`      | Alternative section background |
|   [4]   | `taskBkgColor`          | Task fill                      |
|   [5]   | `taskTextColor`         | Task text                      |
|   [6]   | `taskBorderColor`       | Task border                    |
|   [7]   | `activeTaskBkgColor`    | Active task fill               |
|   [8]   | `activeTaskBorderColor` | Active task border             |
|   [9]   | `critBkgColor`          | Critical task fill             |
|  [10]   | `critBorderColor`       | Critical task border           |
|  [11]   | `doneTaskBkgColor`      | Completed task fill            |
|  [12]   | `doneTaskBorderColor`   | Completed task border          |
|  [13]   | `excludeBkgColor`       | Excluded date background       |
|  [14]   | `gridColor`             | Grid line color                |
|  [15]   | `todayLineColor`        | Today marker                   |

**Theme syntax:**
```
%%{init: {'theme': 'base', 'themeVariables': {
  'activeTaskBkgColor': '#darkblue',
  'activeTaskBorderColor': '#lightgrey',
  'critBkgColor': '#purple',
  'doneTaskBkgColor': '#grey',
  'excludeBkgColor': '#eeeeee',
  'gridColor': '#lightgrey',
  'todayLineColor': '#red'
}}}%%
```

---
### [4.2][TREEMAP]

**Declaration:** `treemap-beta`.

**Hierarchy via indentation:** Section (container) `"Name"` no value, Leaf (data) `"Name": value` numeric value.

```
treemap-beta
    "Company"
        "Engineering"
            "Backend": 45
            "Frontend": 35
            "DevOps": 20
        "Product"
            "Design": 25
            "Research": 15
        "Sales"
            "Enterprise": 40
            "SMB": 30
```

**Styling via classDef:** `"Name":::className: value`.

```
treemap-beta
    "Portfolio"
        "Stocks":::risky: 60
        "Bonds":::safe: 30
        "Cash":::safe: 10
    classDef risky fill:#ff6b6b
    classDef safe fill:#51cf66
```

**Config:**

| [INDEX] | [KEY]            | [TYPE]    | [DEFAULT] | [DESCRIPTION]                  |
| :-----: | ---------------- | --------- | :-------: | ------------------------------ |
|   [1]   | `useMaxWidth`    | `boolean` |  `true`   | Constrain to container         |
|   [2]   | `padding`        | `number`  |   `10`    | Internal spacing between nodes |
|   [3]   | `diagramPadding` | `number`  |    `8`    | Outer margin around diagram    |
|   [4]   | `showValues`     | `boolean` |  `true`   | Display numeric values         |
|   [5]   | `valueFormat`    | `string`  |    `,`    | D3 format specifier            |
|   [6]   | `nodeWidth`      | `number`  |   `100`   | Node width measurement         |
|   [7]   | `nodeHeight`     | `number`  |   `40`    | Node height measurement        |
|   [8]   | `borderWidth`    | `number`  |    `1`    | Node border thickness          |
|   [9]   | `valueFontSize`  | `number`  |   `12`    | Font size for values           |
|  [10]   | `labelFontSize`  | `number`  |   `14`    | Font size for labels           |

**D3 Format Specifiers:** `.2f` (two decimal places), `.0%` (percentage no decimals), `$,.2f` (currency with commas and two decimals).<br>
**ThemeVariables:** `fontFamily` (font family for all text).
