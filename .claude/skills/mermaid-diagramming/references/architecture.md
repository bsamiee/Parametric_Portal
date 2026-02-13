# [H1][ARCHITECTURE]
>**Dictum:** *Visualize system structure and temporal flow for infrastructure planning.*

<br>

C4, architecture-beta, packet-beta, timeline, gitGraph, kanban diagrams.

[REFERENCE] Theme, classDef: [->styling.md](./styling.md)
[REFERENCE] Validation: [->validation.md§8](./validation.md#8architecture_diagrams)

---
## [1][C4]
>**Dictum:** *Communicate architecture at multiple abstraction levels.*

<br>

**Levels:** `C4Context` (landscape), `C4Container` (apps/services), `C4Component` (internal), `C4Dynamic` (runtime), `C4Deployment` (infrastructure).

**Elements:** `Person(alias, "Label", ?descr)`, `System(alias, "Label", ?descr)`, `Container(alias, "Label", "Tech", ?descr)`, `Component(alias, "Label", "Tech", ?descr)`. Variants: `_Ext`, `Db`, `Db_Ext`, `Queue`, `Queue_Ext`.
**Boundaries:** `Boundary(alias, "Label")`, `Enterprise_Boundary(...)`, `System_Boundary(...)`, `Container_Boundary(...)` — all use `{ ... }` nesting.
**Deployment:** `Node(alias, "Label", ?type)`, `Deployment_Node(...)`, `Node_L(...)`, `Node_R(...)` — L/R control positioning.
**Named params:** `$` prefix — `$tags`, `$link`, `$sprite`.

**Relationships:** `Rel(from, to, "Label", ?tech)`, `Rel_Back(...)`, `BiRel(...)`, directional `Rel_U/D/L/R(...)`.
**Dynamic indexing:** `RelIndex(idx, from, to, "Label")` — sequence order determines display, `idx` has no effect.
**Styling:** `UpdateRelStyle(from, to, ?textColor, ?lineColor)`, `UpdateElementStyle(alias, ?bgColor, ?fontColor)`, `UpdateLayoutConfig(?c4ShapeInRow, ?c4BoundaryInRow)`.

[CRITICAL] Named parameters use `$` prefix. C4 uses fixed CSS — theme skins have no effect.

---
## [2][INFRASTRUCTURE]
>**Dictum:** *Document deployment topology for operations planning.*

<br>

**Declaration:** `architecture-beta`

**Elements:** `group name(icon)[label]`, `group name(icon)[label] in parent`, `service name(icon)[label] in group`, `junction name` / `junction name in group`.
**Connections:** `name{group}?:DIR ARROW DIR:name{group}?` — Arrows: `--`, `-->`, `<--`, `<-->`. Directions: `T`, `B`, `L`, `R`. `{group}` connects from group boundary.
**Icons (built-in 5):** `cloud`, `database`, `disk`, `internet`, `server`. Extended via iconify.design: `logos:react`.

[CRITICAL] Layout engine non-deterministic — same code renders differently on refresh (known v11.5.0+).

---
## [3][PACKET]
>**Dictum:** *Document bit-level protocol layouts.*

<br>

**Declaration:** `packet-beta`

**Syntax:** `start-end: "Label"` (range), `start: "Flag"` (single), `+N: "Label"` (next N bits, v11.7.0+).
**Config:** `bitWidth` (width per bit), `bitsPerRow` (default 32), `rowHeight`, `showBits` (boolean), `paddingX`, `paddingY`.

[CRITICAL] All bits MUST be defined — gaps or overlaps trigger errors.

---
## [4][TIMELINE]
>**Dictum:** *Track project milestones for roadmap communication.*

<br>

**Declaration:** `timeline`

**Syntax:** `title Text`, `section Period`, `Period : Desc1 : Desc2` (multi-event).
**Styling:** `cScale0`-`cScale11` (backgrounds), `cScaleLabel0`-`cScaleLabel11` (labels). Config: `useMaxWidth`, `disableMulticolor`.

[CRITICAL] `%%{init:...}%%` deprecated v10.5.0; use YAML frontmatter exclusively.

---
## [5][GITGRAPH]
>**Dictum:** *Illustrate branching strategy for team alignment.*

<br>

**Declaration:** `gitGraph` or `gitGraph LR:|TB:|BT:`

**Commands:** `commit` (random ID), `commit id: "msg"`, `commit tag: "v1.0"`, `commit type: NORMAL|REVERSE|HIGHLIGHT`, `branch name`, `checkout name` / `switch name`, `merge name`, `cherry-pick id: "x"` (parent required for merge commits).
**Config:** `showBranches` (true), `showCommitLabel` (true), `mainBranchName` ("main"), `parallelCommits` (false), `rotateCommitLabel` (true).
**Theme:** `git0`-`git7` (branch colors), `commitLabelColor`, `tagLabelColor`, `tagLabelBackground`.

[CRITICAL] `%%{init:...}%%` deprecated v10.5.0; use YAML frontmatter exclusively.

---
## [6][KANBAN]
>**Dictum:** *Track work items for sprint planning.*

<br>

**Declaration:** `kanban`

**Structure:** `columnId[Title]` (workflow stage), indented `taskId[Description]` (work item).
**Metadata:** `taskId[Desc]@{ ticket: "ID", assigned: 'Name', priority: 'High' }`. Priority values: `'Very High'`, `'High'`, `'Low'`, `'Very Low'` — exact strings with single quotes, no `"Medium"`.
**Config:** `ticketBaseUrl` (URL with `#TICKET#` placeholder), `padding`.

[CRITICAL] Tasks MUST be indented under columns. String metadata with spaces MUST use single quotes.
