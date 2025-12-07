# [H1][MODELING]
>**Dictum:** *Enable precise communication of architectural contracts and data flows.*

<br>

Four diagram types—`classDiagram` (OO structure), `erDiagram` (data relationships), `stateDiagram-v2` (state machines), `requirementDiagram` (traceability).

[REFERENCE] classDef, styling → [→styling.md](./styling.md)<br>
[REFERENCE] Modeling validation → [→validation.md§6](./validation.md#6modeling_diagrams)<br>

---
## [1][CLASS_DIAGRAMS]
>**Dictum:** *Visualize type hierarchies and object relationships for architecture decisions.*

<br>

**Declaration:** `classDiagram`.

### [1.1][MEMBERS_VISIBILITY]

**Visibility:** `+` (public), `-` (private), `#` (protected), `~` (package/internal).<br>
**Classifiers:** `method()*` (abstract), `method()$` (static), `field$` (static field).<br>
**Annotations:** `<<interface>>`, `<<abstract>>`, `<<service>>`, `<<enumeration>>`—inline or post-declaration.

```
class Animal {
    +String name
    +int age
    +makeSound() void
    -digestFood() void
    +someAbstractMethod()*
    +someStaticMethod()$
    +String staticField$
}
```

---
### [1.2][RELATIONSHIPS]

| [INDEX] | [SYNTAX] | [LINE] | [END]          | [MEANING]   |
| :-----: | -------- | ------ | -------------- | ----------- |
|   [1]   | `<\|--`  | Solid  | Triangle       | Inheritance |
|   [2]   | `*--`    | Solid  | Filled diamond | Composition |
|   [3]   | `o--`    | Solid  | Open diamond   | Aggregation |
|   [4]   | `-->`    | Solid  | Arrow          | Association |
|   [5]   | `--`     | Solid  | None           | Link        |
|   [6]   | `..>`    | Dotted | Arrow          | Dependency  |
|   [7]   | `..\|>`  | Dotted | Triangle       | Realization |
|   [8]   | `..`     | Dotted | None           | Dashed link |

**Lollipop Interface:** `ClassA ()-- ClassB` (interface on A), `ClassA --() ClassB` (interface on B).<br>
**Two-way:** `Type1 "1" <--> "1" Type2`.<br>
**Cardinality:** `1` (exactly one), `0..1` (zero or one), `1..*` (one or more), `*` (many), `n` (N instances), `0..n` (zero to N), `1..n` (one to N).

---
### [1.3][FEATURES]

**Generics:** `class List~T~`—use `~T~` NOT `<T>`; nested → `List~List~int~~`.<br>
**Namespace:** `namespace Name { class A; class B }`.<br>
**Notes:** `note "text"`, `note for ClassName "text"`.<br>
**Interactions:** `click ClassName callback "tooltip"`, `link ClassName "URL" "tooltip"`.

[CRITICAL] Generic type NOT part of class name for references; comma-separated generics (`~K,V~`) NOT supported in nested contexts.

---
## [2][ENTITY_RELATIONSHIP]
>**Dictum:** *Clarify data dependencies and enforce schema integrity.*

<br>

**Declaration:** `erDiagram`.

### [2.1][ENTITIES]

**Syntax:** `ENTITY { type name PK|FK|UK "comment" }`.<br>
**Keys:** `PK` (primary key), `FK` (foreign key), `UK` (unique key); multiple keys via comma-separated (`PK, FK`).<br>
**Aliases:** Entity name aliases via square brackets; accepts Unicode and markdown.

---
### [2.2][CARDINALITY]

**Crow's Foot Notation (Left):** `||` (exactly one), `|o` (zero or one), `}|` (one or more), `}o` (zero or more).<br>
**Crow's Foot Notation (Right):** `||` (exactly one), `o|` (zero or one), `|{` (one or more), `o{` (zero or more).<br>
**Text Aliases:** `only one` (`||`), `zero or one` (`|o`/`o|`), `one or more`/`1+`/`many(1)` (`}|`/`|{`), `zero or more`/`0+`/`many(0)` (`}o`/`o{`).

---
### [2.3][RELATIONSHIPS]

**Line Types:** `--` identifying (strong), `..` non-identifying (weak); aliases → `to`, `optionally to`.<br>
**Syntax:** `ENTITY1 cardinality--cardinality ENTITY2 : label`.

```
CUSTOMER ||--o{ ORDER : places
ORDER ||--|{ LINE_ITEM : contains
PRODUCT ||--o{ LINE_ITEM : "ordered in"
PERSON }o..o| CAR : drives
```

**Direction:** `direction LR|TB|RL|BT` at diagram start.<br>
**Multi-line Labels:** Use `<br />` (v11.1.0+).

[IMPORTANT] Entity names UPPERCASE by convention; reserved words → `ONE`, `MANY`, `TO`, `U`, `1` (bug #7093).

---
## [3][STATE_DIAGRAMS]
>**Dictum:** *Track system behavior and validate transition logic.*

<br>

**Declaration:** `stateDiagram-v2` (v1 deprecated).

### [3.1][ELEMENTS]

| [INDEX] | [ELEMENT]  | [SYNTAX]                   | [DESCRIPTION]                 |
| :-----: | ---------- | -------------------------- | ----------------------------- |
|   [1]   | Start      | `[*]`                      | Initial state (filled circle) |
|   [2]   | End        | `[*]`                      | Final state (bullseye)        |
|   [3]   | State      | `StateName`                | Simple state                  |
|   [4]   | Labeled    | `State : Description`      | State with description        |
|   [5]   | Transition | `S1 --> S2`                | State change                  |
|   [6]   | Event      | `S1 --> S2 : event`        | Labeled transition            |
|   [7]   | Direction  | `direction LR\|TB\|RL\|BT` | Flow orientation              |

**Notes:** `note left of S : text`, `note right of S : text`.<br>
**Comments:** `%% comment text` (single-line, own line).

---
### [3.2][COMPOSITES_STEREOTYPES]

| [INDEX] | [ELEMENT] | [SYNTAX]                        | [DESCRIPTION]          |
| :-----: | --------- | ------------------------------- | ---------------------- |
|   [1]   | Nested    | `state A { state B { } }`       | Multi-level nesting    |
|   [2]   | Parallel  | `--` separator inside composite | Concurrent substates   |
|   [3]   | Fork      | `state Name <<fork>>`           | Horizontal bar (split) |
|   [4]   | Join      | `state Name <<join>>`           | Horizontal bar (merge) |
|   [5]   | Choice    | `state Name <<choice>>`         | Diamond decision point |

```
state Processing {
    [*] --> Validate
    Validate --> Execute
    --
    [*] --> Monitor
    Monitor --> Log
}
```

```
state fork_state <<fork>>
[*] --> fork_state
fork_state --> State1
fork_state --> State2
state join_state <<join>>
State1 --> join_state
State2 --> join_state
```

**Styling:** `classDef className property:value` at diagram root.<br>
**Application:** `class StateName className` or `StateName:::className`.

[CRITICAL] Place `classDef` at diagram root, not inside composites; Start/End `[*]` and composite containers reject styling (v11).

---
## [4][REQUIREMENT_DIAGRAMS]
>**Dictum:** *Verify requirement satisfaction and maintain audit trails.*

<br>

**Declaration:** `requirementDiagram`.

### [4.1][TYPES_SYNTAX]

**Types:** `requirement`, `functionalRequirement`, `interfaceRequirement`, `performanceRequirement`, `physicalRequirement`, `designConstraint`.<br>
**Requirement Block:** `requirement name { id: REQ-001; text: Description; risk: low|medium|high; verifymethod: analysis|inspection|test|demonstration }`.<br>
**Element Block:** `element name { type: module|component|system; docref: URL }`.<br>
**Markdown:** Surround text fields in quotes to enable markdown.

---
### [4.2][RELATIONS]

| [INDEX] | [RELATION] | [SYNTAX]             | [MEANING]        |
| :-----: | ---------- | -------------------- | ---------------- |
|   [1]   | contains   | `A - contains -> B`  | A contains B     |
|   [2]   | copies     | `A - copies -> B`    | A copies B       |
|   [3]   | derives    | `A - derives -> B`   | A derives from B |
|   [4]   | satisfies  | `A - satisfies -> B` | A satisfies B    |
|   [5]   | verifies   | `A - verifies -> B`  | A verifies B     |
|   [6]   | refines    | `A - refines -> B`   | A refines B      |
|   [7]   | traces     | `A - traces -> B`    | A traces to B    |

**Reverse:** `dest <- relation - src`.

```
requirementDiagram
    requirement auth {
        id: REQ-001
        text: System shall authenticate users
        risk: high
        verifymethod: test
    }

    functionalRequirement login {
        id: REQ-002
        text: Provide login form
        risk: low
        verifymethod: inspection
    }

    element loginModule {
        type: module
        docref: /docs/auth.md
    }

    auth - contains -> login
    loginModule - satisfies -> login
    loginModule - verifies -> auth
```

**Direction:** `direction TB|BT|LR|RL` at diagram start.<br>
**Styling:** `style nodeName property:value` (direct), `classDef className property:value`, `class node1,node2 className`, `node:::className`.<br>
**Default Class:** `classDef default property:value`—targets all nodes except overridden.

---
## [5][CONFIG]
>**Dictum:** *Tune layout and spacing for optimal visual hierarchy.*

<br>


| [INDEX] | [KEY]                 | [TYPE]  | [DEFAULT] | [APPLIES_TO] | [DESCRIPTION]                |
| :-----: | --------------------- | ------- | :-------: | ------------ | ---------------------------- |
|   [1]   | `nodeSpacing`         | number  |    50     | Class, State | Horizontal gap between nodes |
|   [2]   | `rankSpacing`         | number  |    50     | Class, State | Vertical gap between ranks   |
|   [3]   | `padding`             | number  |   8-15    | All          | Internal element padding     |
|   [4]   | `fontSize`            | number  |   12-16   | All          | Label font size              |
|   [5]   | `useMaxWidth`         | boolean |   true    | All          | Constrain to container       |
|   [6]   | `layoutDirection`     | string  |    TB     | ER           | LR, RL, TB, BT               |
|   [7]   | `entityPadding`       | number  |    15     | ER           | Padding inside entities      |
|   [8]   | `minEntityWidth`      | number  |    100    | ER           | Minimum entity width         |
|   [9]   | `minEntityHeight`     | number  |    75     | ER           | Minimum entity height        |
|  [10]   | `labelCompactMode`    | boolean |   false   | State        | Compact state labels         |
|  [11]   | `dividerMargin`       | number  |    10     | State        | Space around dividers        |
|  [12]   | `hideEmptyMembersBox` | boolean |   false   | Class        | Suppress empty compartments  |
