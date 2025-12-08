# [H1][INTERACTION]
>**Dictum:** *Interaction diagrams model temporal behavior between participants.*

<br>

Two diagram types: `sequenceDiagram` (message-passing protocols), `journey` (user experience mapping).
---
## [1][SEQUENCE]
>**Dictum:** *Sequence diagrams capture message-passing protocols.*

<br>

### [1.1][PARTICIPANTS]

| [INDEX] | [TYPE]      | [SYNTAX]                                  | [RENDER]           | [UML_SEMANTIC]      |
| :-----: | ----------- | ----------------------------------------- | ------------------ | ------------------- |
|   [1]   | participant | `participant A`                           | Rectangle          | Generic participant |
|   [2]   | actor       | `actor A`                                 | Stick figure       | Human actor         |
|   [3]   | boundary    | `participant A@{ "type": "boundary" }`    | Interface boundary | External interface  |
|   [4]   | control     | `participant A@{ "type": "control" }`     | Controller symbol  | Logic coordinator   |
|   [5]   | entity      | `participant A@{ "type": "entity" }`      | Data object        | Domain data holder  |
|   [6]   | database    | `participant A@{ "type": "database" }`    | Cylinder           | Data storage        |
|   [7]   | queue       | `participant A@{ "type": "queue" }`       | Queue symbol       | Async queue         |
|   [8]   | collections | `participant A@{ "type": "collections" }` | Stack symbol       | Data collection     |

**Aliasing:** `participant LongName as Short`—ID differs from display label.<br>
**Grouping:** `box rgb(r,g,b) Label` ... `end`—supports `transparent` for visual clustering.<br>
**Lifecycle:** `create participant X` spawns mid-diagram; `destroy X` terminates with `X` marker.

[CRITICAL] JSON type requires double quotes; incompatible with `as Alias` syntax.

---
### [1.2][ARROWS]

| [INDEX] | [SYNTAX] | [APPEARANCE]         | [USE_CASE]          |
| :-----: | -------- | -------------------- | ------------------- |
|   [1]   | `->`     | Solid, no arrow      | Basic call          |
|   [2]   | `-->`    | Dotted, no arrow     | Async return        |
|   [3]   | `->>`    | Solid, filled arrow  | Blocking call       |
|   [4]   | `-->>`   | Dotted, filled arrow | Blocking return     |
|   [5]   | `-)`     | Solid, open arrow    | Fire-and-forget     |
|   [6]   | `--)`    | Dotted, open arrow   | Async callback      |
|   [7]   | `-x`     | Solid, X end         | Error/destroy       |
|   [8]   | `--x`    | Dotted, X end        | Async failure       |
|   [9]   | `<<->>>` | Bidirectional solid  | Duplex sync (v11+)  |
|  [10]   | `<<-->>` | Bidirectional dotted | Duplex async (v11+) |

**Format:** `Sender->>Receiver: Message text`—escaping: `#35;` (hash), `#59;` (semicolon), `<br/>` (newline).<br>
**Activation:** `->>+B` (activate), `-->>-B` (deactivate); or explicit `activate B`, `deactivate B`.<br>
**Notes:** `note right of A: text`, `note left of A: text`, `note over A: text`, `note over A,B: spans`.

[CRITICAL] Reserved word `end` in messages wraps as `(end)`, `[end]`, `{end}`.

---
### [1.3][CONTROL_FLOW]

| [INDEX] | [BLOCK]  | [SYNTAX]                                    | [PURPOSE]                  |
| :-----: | -------- | ------------------------------------------- | -------------------------- |
|   [1]   | loop     | `loop Condition` ... `end`                  | Iteration                  |
|   [2]   | alt      | `alt Case1` ... `else Case2` ... `end`      | Conditional (chain `else`) |
|   [3]   | opt      | `opt Condition` ... `end`                   | Optional execution         |
|   [4]   | par      | `par Label1` ... `and Label2` ... `end`     | Parallel (chain `and`)     |
|   [5]   | critical | `critical Label` ... `option Alt` ... `end` | Mutex with fallback        |
|   [6]   | break    | `break Condition` ... `end`                 | Early exit/exception       |
|   [7]   | rect     | `rect rgb(r,g,b)` ... `end`                 | Visual highlight only      |

All blocks nest arbitrarily; multiple `else`, `and`, `option` clauses chain within single block.

```
critical Establish connection
    Service->>DB: connect
option Network timeout
    Service->>Service: Log error
option Credentials rejected
    Service->>Service: Log auth error
end

break When process fails
    API->>Consumer: show failure
end
```

---
### [1.4][FEATURES]

**Autonumber:** `autonumber`—placed after `sequenceDiagram`, before first message; no offset/increment control.<br>
**Links:** `link A: Label @ URL` (single), `links A: {"Label1": "URL1", "Label2": "URL2"}` (multi)—placed after participant declarations; `participant` compatible only; `actor` has known issues.

---
## [2][JOURNEY]

### [2.1][SYNTAX]

**Structure:** `journey` → `title Label` → `section Phase` → `Task: score: Actor1, Actor2`.

| [INDEX] | [SCORE] | [SENTIMENT]   | [COLOR]     |
| :-----: | :-----: | ------------- | ----------- |
|   [1]   |    1    | Very poor     | Red         |
|   [2]   |    2    | Below average | Orange      |
|   [3]   |    3    | Neutral       | Yellow      |
|   [4]   |    4    | Good          | Light green |
|   [5]   |    5    | Excellent     | Green       |

**Actors:** Comma-separated; no declaration needed.<br>
**Sections:** `section Phase Name` groups tasks.

```
journey
    title User Onboarding
    section Discovery
        Visit homepage: 5: User
        Read features: 4: User
    section Signup
        Fill form: 3: User
        Verify email: 2: User, System
    section Activation
        Complete tutorial: 4: User
        First success: 5: User
```
**Theming:** Variables `fillType0`-`fillType9` (sections), `titleColor`/`titleFontFamily`/`titleFontSize` (v11+); actor colors theme-dependent—use `themeCSS` for overrides.

---
## [3][CONFIG]

Comments via `%% text` (single-line only, own line).

### [3.1][SEQUENCE_CONFIG]

| [INDEX] | [KEY]                    | [TYPE]  | [DEFAULT] | [EFFECT]                                 |
| :-----: | ------------------------ | ------- | :-------: | ---------------------------------------- |
|   [1]   | `mirrorActors`           | boolean |   true    | Duplicate actors at bottom               |
|   [2]   | `showSequenceNumbers`    | boolean |   false   | Auto-number messages                     |
|   [3]   | `actorMargin`            | number  |    50     | Horizontal actor spacing                 |
|   [4]   | `messageMargin`          | number  |    35     | Vertical message spacing                 |
|   [5]   | `boxMargin`              | number  |    10     | Box group margin                         |
|   [6]   | `boxTextMargin`          | number  |     5     | Text margin inside boxes                 |
|   [7]   | `noteMargin`             | number  |    10     | Note offset                              |
|   [8]   | `width`                  | number  |    150    | Actor box width                          |
|   [9]   | `height`                 | number  |    50     | Actor box height                         |
|  [10]   | `activationWidth`        | number  |    10     | Activation bar width                     |
|  [11]   | `hideUnusedParticipants` | boolean |   false   | Omit declared actors with zero messages  |
|  [12]   | `messageAlign`           | string  |  center   | Multiline alignment: left, center, right |
|  [13]   | `rightAngles`            | boolean |   false   | 90° message corners vs curves            |
|  [14]   | `wrap`                   | boolean |   false   | Auto-wrap labels                         |
|  [15]   | `wrapPadding`            | number  |    10     | Wrap padding                             |
|  [16]   | `diagramMarginX`         | number  |    50     | Horizontal diagram margin                |
|  [17]   | `diagramMarginY`         | number  |    10     | Vertical diagram margin                  |
|  [18]   | `forceMenus`             | boolean |   false   | Force popup menus visible                |
|  [19]   | `bottomMarginAdj`        | number  |     1     | Bottom edge extension                    |

**Font Properties:** Pattern `{prefix}FontSize`, `{prefix}FontFamily`, `{prefix}FontWeight`.

| [INDEX] | [PREFIX]  | [SIZE_DEFAULT] | [APPLIES_TO]       |
| :-----: | --------- | :------------: | ------------------ |
|   [1]   | `actor`   |       14       | Participant labels |
|   [2]   | `message` |       16       | Message text       |
|   [3]   | `note`    |       14       | Note content       |

---
### [3.2][JOURNEY_CONFIG]

| [INDEX] | [KEY]         | [TYPE]  | [DEFAULT] | [EFFECT]               |
| :-----: | ------------- | ------- | :-------: | ---------------------- |
|   [1]   | `useMaxWidth` | boolean |   true    | Constrain to container |
|   [2]   | `padding`     | number  |    10     | Diagram padding        |

[REFERENCE] Interaction validation: [→validation.md§5](./validation.md#5interaction_diagrams)
