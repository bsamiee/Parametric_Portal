# [H1][ARCHITECTURE]
>**Dictum:** *Visualize system structure and temporal flow for infrastructure planning.*

<br>

C4, architecture, packet, timeline, gitgraph, kanban diagrams.

[REFERENCE] Theme, classDef: [→styling.md](./styling.md)<br>
[REFERENCE] Architecture validation: [→validation.md§8](./validation.md#8architecture_diagrams)<br>

---
## [1][C4]
>**Dictum:** *Communicate architecture at multiple abstraction levels for stakeholder clarity.*

<br>

### [1.1][LEVELS]

| [INDEX] | [LEVEL]    | [DECLARATION]  | [DESCRIPTION]                  |
| :-----: | ---------- | -------------- | ------------------------------ |
|   [1]   | Context    | `C4Context`    | System landscape + actors      |
|   [2]   | Container  | `C4Container`  | Applications, stores, services |
|   [3]   | Component  | `C4Component`  | Internal structure             |
|   [4]   | Dynamic    | `C4Dynamic`    | Runtime sequences              |
|   [5]   | Deployment | `C4Deployment` | Infrastructure nodes           |

### [1.2][ELEMENTS]

**Person:** `Person(alias, "Label", ?descr, ?sprite, ?tags, $link)`, `Person_Ext(alias, "Label", ?descr, ?sprite, ?tags, $link)`<br>
**System:** `System(alias, "Label", ?descr, ?sprite, ?tags, $link)`, `System_Ext(...)`, `SystemDb(...)`, `SystemDb_Ext(...)`, `SystemQueue(...)`, `SystemQueue_Ext(...)`<br>
**Container:** `Container(alias, "Label", "Tech", ?descr, ?sprite, ?tags, $link)`, `Container_Ext(...)`, `ContainerDb(...)`, `ContainerDb_Ext(...)`, `ContainerQueue(...)`, `ContainerQueue_Ext(...)`<br>
**Component:** `Component(alias, "Label", "Tech", ?descr, ?sprite, ?tags, $link)`, `Component_Ext(...)`, `ComponentDb(...)`, `ComponentDb_Ext(...)`, `ComponentQueue(...)`, `ComponentQueue_Ext(...)`

**Parameter Assignment:**

| [INDEX] | [METHOD]   | [SYNTAX]                                 | [EXAMPLE]                                               |
| :-----: | ---------- | ---------------------------------------- | ------------------------------------------------------- |
|   [1]   | Positional | `Element(alias, "Label", descr, sprite)` | `System(api, "API", "REST API", "server")`              |
|   [2]   | Named      | `Element(alias, "Label", $param=value)`  | `System(api, "API", $tags="v1.0", $link="https://...")` |

[CRITICAL] Named parameters use `$` prefix—`$tags`, `$link`, `$sprite`.

<br>

### [1.3][BOUNDARIES]

| [INDEX] | [ELEMENT]  | [SYNTAX]                                                    |
| :-----: | ---------- | ----------------------------------------------------------- |
|   [1]   | Generic    | `Boundary(alias, "Label", ?type, ?tags, $link) { ... }`     |
|   [2]   | Enterprise | `Enterprise_Boundary(alias, "Label", ?tags, $link) { ... }` |
|   [3]   | System     | `System_Boundary(alias, "Label", ?tags, $link) { ... }`     |
|   [4]   | Container  | `Container_Boundary(alias, "Label", ?tags, $link) { ... }`  |

### [1.4][DEPLOYMENT]

**Nodes:**<br>
**Layout Variants:** `Node_L` and `Node_R` control left/right positioning in deployment diagrams for precise spatial arrangement.

| [INDEX] | [ELEMENT]       | [SYNTAX]                                                                |
| :-----: | --------------- | ----------------------------------------------------------------------- |
|   [1]   | Generic node    | `Node(alias, "Label", ?type, ?descr, ?sprite, ?tags, $link)`            |
|   [2]   | Deployment node | `Deployment_Node(alias, "Label", ?type, ?descr, ?sprite, ?tags, $link)` |
|   [3]   | Node left       | `Node_L(alias, "Label", ?type, ?descr, ?sprite, ?tags, $link)`          |
|   [4]   | Node right      | `Node_R(alias, "Label", ?type, ?descr, ?sprite, ?tags, $link)`          |

**Nesting:** Use `{ ... }` for nested nodes.

```
Deployment_Node(aws, "AWS", "Cloud") {
    Deployment_Node(region, "us-east-1", "Region") {
        Container(api, "API", "Node.js")
    }
}
```

### [1.5][RELATIONSHIPS]

**Dynamic Indexing:** `RelIndex(idx, from, to, "Label", ?tags, $link)`—sequence order determines display position, `idx` parameter has no effect.

| [INDEX] | [ELEMENT]     | [SYNTAX]                                                             | [DESCRIPTION]        |
| :-----: | ------------- | -------------------------------------------------------------------- | -------------------- |
|   [1]   | Relation      | `Rel(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`       | Basic relationship   |
|   [2]   | Backward      | `Rel_Back(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`  | Reverse direction    |
|   [3]   | Bidirectional | `BiRel(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`     | Two-way              |
|   [4]   | Up            | `Rel_U(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`     | Upward layout hint   |
|   [5]   | Up (alias)    | `Rel_Up(from, to, "Label", ?tech, ?descr, ?splice, ?tags, $link)`    | Upward layout hint   |
|   [6]   | Down          | `Rel_D(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`     | Downward layout hint |
|   [7]   | Down (alias)  | `Rel_Down(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`  | Downward layout hint |
|   [8]   | Left          | `Rel_L(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`     | Left layout hint     |
|   [9]   | Left (alias)  | `Rel_Left(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`  | Left layout hint     |
|  [10]   | Right         | `Rel_R(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)`     | Right layout hint    |
|  [11]   | Right (alias) | `Rel_Right(from, to, "Label", ?tech, ?descr, ?sprite, ?tags, $link)` | Right layout hint    |

[IMPORTANT] Relationships support clickable links via `$link` parameter—invisible path layer detects clicks.

### [1.6][STYLING]

**Defaults:** `c4ShapeInRow=4`, `c4BoundaryInRow=2`<br>
**Shapes:** Default rectangle, octagon (`EightSidedShape`), custom via `?shape` parameter.

| [INDEX] | [FUNCTION]     | [SYNTAX]                                                                                                                         |
| :-----: | -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | Relation style | `UpdateRelStyle(from, to, ?textColor, ?lineColor, ?offsetX, ?offsetY)`                                                           |
|   [2]   | Element style  | `UpdateElementStyle(alias, ?bgColor, ?fontColor, ?borderColor, ?shadowing, ?shape, ?sprite, ?techn, ?legendText, ?legendSprite)` |
|   [3]   | Layout config  | `UpdateLayoutConfig(?c4ShapeInRow, ?c4BoundaryInRow)`                                                                            |

**Styling Notes:**
- C4 uses fixed CSS styling—different skins have no effect on C4 colors.
- Place `UpdateElementStyle`/`UpdateRelStyle` at diagram end.
- Statement order controls layout, not automated algorithms.

```
C4Context
    Person(user, "User", "End user")
    System(web, "Web App", "Frontend", $link="https://app.example.com")
    System_Ext(api, "External API", "Third party", $tags="external")

    Rel(user, web, "Uses", "HTTPS")
    Rel(web, api, "Calls", "REST")

    UpdateRelStyle(user, web, "#000000", "#0000ff")
    UpdateElementStyle(web, "#ffffff", "#000000", "#0000ff")
    UpdateLayoutConfig(3, 2)
```

---
## [2][INFRASTRUCTURE]
>**Dictum:** *Document deployment topology for operations team planning.*

<br>

**Declaration:** `architecture-beta`

<br>

### [2.1][ELEMENTS]

| [INDEX] | [ELEMENT]       | [SYNTAX]                             | [DESCRIPTION]             |
| :-----: | --------------- | ------------------------------------ | ------------------------- |
|   [1]   | Group           | `group name(icon)[label]`            | Container with icon       |
|   [2]   | Nested group    | `group name(icon)[label] in parent`  | Group within parent       |
|   [3]   | Service         | `service name(icon)[label] in group` | Service in group          |
|   [4]   | Junction        | `junction name`                      | Four-way connection point |
|   [5]   | Nested junction | `junction name in group`             | Junction within group     |

### [2.2][CONNECTIONS]

**Syntax:** `name{group}?:DIR ARROW DIR:name{group}?`

**Arrows:**
- `--`—Solid connection
- `-->`—Solid with right arrow
- `<--`—Solid with left arrow
- `<-->`—Solid bidirectional

**Directions:**
- `T`—Top
- `B`—Bottom
- `L`—Left
- `R`—Right

**Group Edge Modifier:** `{group}` connects edge from group boundary, not individual service.

```
architecture-beta
    group api(cloud)[API]
    service gateway(internet)[Gateway] in api

    api{group}:R --> L:gateway
```

### [2.3][ICONS]

**Built-in (5):**

| [INDEX] | [ICON]     | [DESCRIPTION]    |
| :-----: | ---------- | ---------------- |
|   [1]   | `cloud`    | Cloud provider   |
|   [2]   | `database` | Database storage |
|   [3]   | `disk`     | Disk storage     |
|   [4]   | `internet` | External network |
|   [5]   | `server`   | Server instance  |

**Extended Icons:** Reference iconify.design (200,000+ icons) via `name:icon-name` syntax.

```
service web(logos:react)[Frontend] in api
```

### [2.4][JUNCTION_EXAMPLE]

```
architecture-beta
    group infra(cloud)[Infrastructure]
    service api(server)[API] in infra
    service db(database)[Database] in infra
    service cache(disk)[Cache] in infra
    service queue(server)[Queue] in infra
    junction j1 in infra

    api:R --> L:j1
    j1:R --> L:db
    j1:B --> T:cache
    j1:T --> B:queue
```

[IMPORTANT] Architecture diagrams target CI/CD and cloud deployment visualization.

[CRITICAL] Layout engine non-deterministic—same code renders differently on refresh (known issue v11.5.0+).

---
## [3][PACKET]
>**Dictum:** *Document bit-level protocol layouts for specification accuracy.*

<br>

**Declaration:** `packet-beta`

### [3.1][SYNTAX]

| [INDEX] | [PATTERN]    | [SYNTAX]             | [DESCRIPTION]                 | [VERSION] |
| :-----: | ------------ | -------------------- | ----------------------------- | --------- |
|   [1]   | Bit range    | `start-end: "Label"` | Span of bits                  | v11.0.0+  |
|   [2]   | Single bit   | `start: "Flag"`      | Single bit                    | v11.0.0+  |
|   [3]   | Bits (count) | `+N: "Label"`        | Next N bits from previous end | v11.7.0+  |

**Mixing Syntax:** Combine manual ranges and `+count` notation.

```
packet-beta
    0-15: "Source Port"
    16-31: "Destination Port"
    +32: "Sequence Number"
    +32: "Acknowledgment Number"
    96-99: "Data Offset"
    +3: "Reserved"
    +1: "NS"
    +1: "CWR"
    +1: "ECE"
    +1: "URG"
    +1: "ACK"
    +1: "PSH"
    +1: "RST"
    +1: "SYN"
    +1: "FIN"
```

### [3.2][CONFIG]

| [INDEX] | [KEY]        | [TYPE]  | [DESCRIPTION]                    |
| :-----: | ------------ | ------- | -------------------------------- |
|   [1]   | `bitWidth`   | number  | Width per bit                    |
|   [2]   | `bitsPerRow` | number  | Bits before wrap (default: `32`) |
|   [3]   | `rowHeight`  | number  | Height per row                   |
|   [4]   | `showBits`   | boolean | Display bit numbers              |
|   [5]   | `paddingX`   | number  | Horizontal padding               |
|   [6]   | `paddingY`   | number  | Vertical padding                 |

**Example:**

```yaml
---
config:
  packet:
    bitsPerRow: 16
    rowHeight: 40
    showBits: true
---
packet-beta
    0-7: "Type"
    8-15: "Code"
    +16: "Checksum"
```

[CRITICAL] All bits MUST be defined—gaps or overlaps trigger errors.

---
## [4][TIMELINE]
>**Dictum:** *Track project milestones for roadmap communication.*

<br>

**Declaration:** `timeline`

| [INDEX] | [ELEMENT]        | [SYNTAX]                               | [DESCRIPTION]         |
| :-----: | ---------------- | -------------------------------------- | --------------------- |
|   [1]   | Title            | `title Text`                           | Diagram title         |
|   [2]   | Section          | `section Period`                       | Time period grouping  |
|   [3]   | Event            | `Period : Description`                 | Single event          |
|   [4]   | Multi-event      | `Period : Desc1 : Desc2`               | Multiple descriptions |
|   [5]   | Multi-line event | `Period : Desc1` <br> `       : Desc2` | Vertical layout       |

**Event Order:** First event top, last event bottom per period.<br>
**Text Wrapping:** Long text wraps automatically, force line breaks with `<br>`.

```
timeline
    title Product Roadmap 2024
    section Q1
        January : Feature A : Bug fixes
        February : Feature B
        March : Release v1.0
    section Q2
        April : Feature C
        May : Feature D
        June : Release v2.0
```

### [4.1][STYLING]

**themeVariables:**<br>
**Predefined Themes:** `base`, `forest`, `dark`, `default`, `neutral`

| [INDEX] | [VARIABLE]                     | [DESCRIPTION]                       |
| :-----: | ------------------------------ | ----------------------------------- |
|   [1]   | `cScale0`-`cScale11`           | Background colors (12 max sections) |
|   [2]   | `cScaleLabel0`-`cScaleLabel11` | Foreground/label colors             |

**Config:**

| [INDEX] | [KEY]               | [TYPE]  | [DESCRIPTION]          |
| :-----: | ------------------- | ------- | ---------------------- |
|   [1]   | `useMaxWidth`       | boolean | Constrain to container |
|   [2]   | `disableMulticolor` | boolean | Single color mode      |

**Example:**

```yaml
---
config:
  theme: forest
  themeVariables:
    cScale0: "#ff0000"
    cScale1: "#00ff00"
---
timeline
    title Timeline
    section Q1
        Jan : Event
```

[CRITICAL] `%%{init:...}%%` deprecated v10.5.0; use YAML frontmatter exclusively.

[IMPORTANT] Timeline experimental—icon integration unstable, core syntax stable.

---
## [5][GITGRAPH]
>**Dictum:** *Illustrate branching strategy for team workflow alignment.*

<br>

**Declaration:** `gitGraph` or `gitGraph ORIENTATION:`

### [5.1][ORIENTATION]

| [INDEX] | [VALUE] | [DESCRIPTION]           |
| :-----: | ------- | ----------------------- |
|   [1]   | `LR:`   | Left to right (default) |
|   [2]   | `TB:`   | Top to bottom           |
|   [3]   | `BT:`   | Bottom to top           |

```
gitGraph LR:
```

### [5.2][COMMANDS]

| [INDEX] | [COMMAND]         | [SYNTAX]                                        | [DESCRIPTION]                     |
| :-----: | ----------------- | ----------------------------------------------- | --------------------------------- |
|   [1]   | Commit            | `commit`                                        | Add commit with random ID         |
|   [2]   | Commit ID         | `commit id: "msg"`                              | Custom commit ID                  |
|   [3]   | Tag               | `commit tag: "v1.0"`                            | Tagged commit                     |
|   [4]   | Type              | `commit type: NORMAL\|REVERSE\|HIGHLIGHT`       | Commit style                      |
|   [5]   | Combined          | `commit id: "abc" tag: "v1.0" type: HIGHLIGHT`  | All attributes                    |
|   [6]   | Branch            | `branch name`                                   | Create branch (sets as current)   |
|   [7]   | Checkout          | `checkout name`                                 | Switch to existing branch         |
|   [8]   | Switch            | `switch name`                                   | Switch to existing branch (alias) |
|   [9]   | Merge             | `merge name`                                    | Merge branch into current         |
|  [10]   | Merge styled      | `merge name id: "m1" tag: "v2.0" type: REVERSE` | Merge with attributes             |
|  [11]   | Cherry-pick       | `cherry-pick id: "x"`                           | Cherry-pick from another branch   |
|  [12]   | Cherry-pick merge | `cherry-pick id: "x" parent: "y"`               | Cherry-pick merge commit          |

**Commit Types:**
- `NORMAL`—Solid circle (default)
- `REVERSE`—Crossed circle (emphasis)
- `HIGHLIGHT`—Filled rectangle

**Cherry-Pick Requirements:**
- Commit ID MUST exist.
- Current branch needs ≥1 commit.
- CANNOT cherry-pick from same branch.
- Parent commit MANDATORY for merge commits.

```
gitGraph
    commit id: "init"
    branch develop
    checkout develop
    commit id: "feat-1"
    commit id: "feat-2" type: HIGHLIGHT
    checkout main
    merge develop tag: "v1.0"
    commit id: "hotfix" type: REVERSE
    branch release
    checkout release
    cherry-pick id: "hotfix"
```

### [5.3][CONFIG]

| [INDEX] | [KEY]               | [TYPE]  | [DESCRIPTION]                             |
| :-----: | ------------------- | ------- | ----------------------------------------- |
|   [1]   | `showBranches`      | boolean | Display branch labels (default: `true`)   |
|   [2]   | `showCommitLabel`   | boolean | Display commit messages (default: `true`) |
|   [3]   | `mainBranchName`    | string  | Primary branch name (default: `"main"`)   |
|   [4]   | `mainBranchOrder`   | number  | Main branch position (default: `0`)       |
|   [5]   | `parallelCommits`   | boolean | Align parallel commits (default: `false`) |
|   [6]   | `rotateCommitLabel` | boolean | 45° rotation (default: `true`)            |

### [5.4][THEME_VARIABLES]

**GitGraph Themes:** `git0`-`git7` (branch colors), `gitInv0`-`gitInv7` (highlights), `gitBranchLabel0`-`gitBranchLabel7` (labels), `commitLabelColor`, `commitLabelBackground`, `commitLabelFontSize`, `tagLabelColor`, `tagLabelBackground`, `tagLabelBorder`, `tagLabelFontSize`

**Example:**

```yaml
---
config:
  theme: base
  themeVariables:
    git0: "#ff0000"
    commitLabelFontSize: "16px"
---
gitGraph
    commit
```

[CRITICAL] `%%{init:...}%%` deprecated v10.5.0; use YAML frontmatter exclusively.

---
## [6][KANBAN]
>**Dictum:** *Track work items for sprint planning transparency.*

<br>

**Declaration:** `kanban`

### [6.1][STRUCTURE]

| [INDEX] | [ELEMENT] | [SYNTAX]              | [DESCRIPTION]                |
| :-----: | --------- | --------------------- | ---------------------------- |
|   [1]   | Column    | `columnId[Title]`     | Workflow stage               |
|   [2]   | Task      | `taskId[Description]` | Work item (MUST be indented) |

**Hierarchy:** Indent tasks under columns—proper indentation CRITICAL.

### [6.2][METADATA]

**Syntax:** `taskId[Description]@{ key: value, key: value }`

| [INDEX] | [KEY]      | [VALUES]                                 | [DESCRIPTION]  |
| :-----: | ---------- | ---------------------------------------- | -------------- |
|   [1]   | `ticket`   | string or number                         | Ticket ID      |
|   [2]   | `assigned` | string                                   | Assignee name  |
|   [3]   | `priority` | `'Very High'\|'High'\|'Low'\|'Very Low'` | Priority level |

[CRITICAL] Priority values EXACT strings with quotes: `'Very High'`, `'High'`, `'Low'`, `'Very Low'`—NO `"Medium"`.

[IMPORTANT] String values with spaces MUST use single quotes in metadata.

```
kanban
    backlog[Backlog]
        task1[Research API options]@{ ticket: PROJ-101, priority: 'High' }
        task2[Design database schema]@{ ticket: 'PROJ-102', priority: 'Very High' }

    inProgress[In Progress]
        task3[Implement auth]@{ ticket: 123, assigned: 'Alice', priority: 'High' }

    review[Review]
        task4[Code review auth PR]@{ ticket: 'PROJ-104', assigned: 'Bob' }

    done[Done]
        task5[Setup CI/CD]@{ ticket: 'PROJ-100' }
```

### [6.3][CONFIG]

| [INDEX] | [KEY]           | [TYPE] | [DESCRIPTION]                   |
| :-----: | --------------- | ------ | ------------------------------- |
|   [1]   | `ticketBaseUrl` | string | URL with `#TICKET#` placeholder |
|   [2]   | `padding`       | number | Card padding                    |

**Ticket URL example:**
```yaml
---
config:
  kanban:
    ticketBaseUrl: 'https://jira.example.com/browse/#TICKET#'
---
kanban
    todo[Todo]
        task1[Fix bug]@{ ticket: 'PROJ-42' }
```

[IMPORTANT] `#TICKET#` replaced with metadata ticket value—creates clickable links.
