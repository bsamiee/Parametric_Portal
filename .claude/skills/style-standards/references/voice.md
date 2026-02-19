# [H1][VOICE]
>**Dictum:** *Grammar maximizes signal density.*

<br>

[IMPORTANT] Imperative, mechanical, domain-specific. No hedging, no self-reference.

*Actions:* Imperative. *Context/Facts:* Declarative.

---
## [1][GRAMMAR]
>**Dictum:** *Grammar rules optimize LLM comprehension.*

<br>

[IMPORTANT]:
1.  [ALWAYS] **Drop Stopwords:** Remove `the`, `a`, `an`, `please`, `kindly`. *Bad:* "The function returns a user." *Good:* "Returns User."
2.  [ALWAYS] **Imperative Actions:** Start instructions with verbs. *Bad:* "You should validate." *Good:* "Validate."
3.  [ALWAYS] **Declarative Facts:** State context as truth. *Bad:* "This seems to be the config." *Good:* "Config source."

[CRITICAL]:
- [NEVER] Self-referential: "This file...", "We do...", "You should..."
- [NEVER] Capability disclaimers: "can handle", "is able to"
- [NEVER] Hedging: "might", "could", "probably", "should"
- [NEVER] Meta-commentary: "Sourced from...", "Confirmed with..."

---
## [2][PUNCTUATION]
>**Dictum:** *Punctuation concentrates attention.*

<br>

[IMPORTANT] Punctuation tokens act as **attention sinks** -- absorb 20-40% weight despite minimal semantic content.

| [INDEX] | [MARK]  | [FUNCTION]                                             |
| :-----: | :-----: | ------------------------------------------------------ |
|   [1]   |   `.`   | Hard Attention Reset. Consolidation checkpoint.        |
|   [2]   |   `:`   | Attention Bridge. Entity-to-elaboration link.          |
|   [3]   |   `—`   | Inline Expansion. Elaboration without flow break.      |
|   [4]   |   `→`   | Conditional Flow. Transformation or sequence.          |
|   [5]   | `` ` `` | Type Boundary. Shift to code/symbol domain.            |
|   [6]   |   `;`   | Clause Conjunction. Joins related independent clauses. |
|   [7]   |   `?`   | Attention Shift. Query resolution trigger.             |

[CRITICAL] Single delimiter changes produce 18-29% swings. Consistency over choice.

---
## [3][MODALS]
>**Dictum:** *Modals trigger false obligations.*

<br>

[CRITICAL] Modal expressions (`must`, `should`, `ought`) trigger **Deontological Keyword Bias** -- >90% false-positive obligation detection regardless of context.

| [INDEX] | [AVOID]  | [USE_INSTEAD]                                   |
| :-----: | -------- | ----------------------------------------------- |
|   [1]   | `must`   | "Include [X]" or "REQUIREMENT: [X]"             |
|   [2]   | `should` | "Incorporate at least [X]" or "[X] recommended" |
|   [3]   | `ought`  | "To achieve [outcome], implement: [steps]"      |

[IMPORTANT] Bracketed directives (`[MUST]`, `[NEVER]`) retain compliance -- parsed as format, not prose.

---
## [4][SYNTAX]
>**Dictum:** *Simplicity maximizes accuracy.*

<br>

[IMPORTANT] Simple sentences: 93.7% accuracy vs 46.8% for nested structures.

[IMPORTANT]:
1.  [ALWAYS] **Simple Clauses:** Single subject-verb-object per sentence.
2.  [ALWAYS] **Coordination:** Use FANBOYS (`for`, `and`, `nor`, `but`, `or`, `yet`, `so`) over subordination.
3.  [ALWAYS] **Sequential Decomposition:** "First, [X]. Then, [Y]. Finally, [Z]."

[CRITICAL]:
- [NEVER] **Nested Dependencies:** Center-embedded clauses cause tracking failure.

---
## [5][ORDERING]
>**Dictum:** *Position determines attention weight.*

<br>

[CRITICAL] Primacy effects peak at 150-200 instructions. Earlier items receive up to 5.79x higher attention.

[IMPORTANT]:
1.  [ALWAYS] **Critical-First:** Highest-priority constraints at sequence start.
2.  [ALWAYS] **Saturation Awareness:** Beyond 300 instructions, uniform failure emerges.

[CRITICAL]:
- [NEVER] **Middle Burial:** Middle positions suffer U-shaped attention loss.

---
## [6][COMMENTS]
>**Dictum:** *Comments explain why, not what.*

<br>

[IMPORTANT] Comment augmentation: 40-53% accuracy gain. Incorrect comments: 78% accuracy loss -- worse than none.

[IMPORTANT]:
1.  [ALWAYS] **Why > What:** *Logic* = Noise. *Intent* = Signal.
2.  [ALWAYS] **Anchor-First:** Start JSDoc with **Action Verb**.

[CRITICAL]:
- [NEVER] Duplicate TS types in comments (e.g., `@param {string} name`).
- [NEVER] Comment obvious logic -- only when code cannot express intent.

**JSDoc Template:** `/** [Verb] [Outcome]. [Grounding]: [Why]. */`<br>
**Tag Order:** `@param` -> `@returns` -> `@throws` -> `@example`

---
## [7][CONSTRAINTS]
>**Dictum:** *Quantity thresholds bound comprehension.*

<br>

[CRITICAL] Performance degrades from 77.67% (Level I) to 32.96% (Level IV) as constraint nesting increases.

[IMPORTANT]:
1.  [ALWAYS] **Limit Per Level:** Maximum 3-5 constraints per instruction level.
2.  [ALWAYS] **Hierarchical Ordering:** PRIMARY -> SECONDARY -> TERTIARY.
3.  [ALWAYS] **Decomposition:** Break complex requirements into sequential simple steps.

[CRITICAL]:
- [NEVER] **Constraint Saturation:** 6+ simultaneous constraints cause <25% satisfaction.

<br>

### [7.1][FEW_SHOT]
>**Dictum:** *Quality outweighs quantity.*

<br>

[IMPORTANT] Few-shot performance peaks at 5-25 examples. 100+ cause functional correctness collapse. Distinctive examples (TF-IDF) reduce count by 60%.

---
## [8][NAMING]
>**Dictum:** *Consistent naming enables pattern recognition.*

<br>

| [INDEX] | [CATEGORY]       | [PATTERN]             | [EXAMPLE]                              |
| :-----: | ---------------- | --------------------- | -------------------------------------- |
|   [1]   | Config constant  | `B`                   | `const B = Object.freeze({...})`       |
|   [2]   | Schema           | `*Schema`             | `InputSchema`, `UserSchema`            |
|   [3]   | Factory function | `create*`             | `createConfig`, `createHandler`        |
|   [4]   | Action function  | Verb-noun             | `validate*`, `transform*`, `dispatch*` |
|   [5]   | Dispatch table   | `*Handlers`           | `modeHandlers`, `labelHandlers`        |
|   [6]   | Effect pipeline  | `*Pipeline`           | `validationPipeline`                   |
|   [7]   | Type parameter   | Single uppercase      | `<T>`, `<M>`, `<const T>`              |
|   [8]   | Branded type     | PascalCase noun       | `UserId`, `IsoDate`, `HexColor`        |
|   [9]   | Error type       | `*Error`              | `ValidationError`, `TransformError`    |
|  [10]   | Boolean          | `is*`, `has*`, `can*` | `isValid`, `hasPermission`             |

[CRITICAL]:
- [NEVER] `utils`, `helpers`, `misc` -- too vague.
- [NEVER] `config` as variable -- conflicts with `B` pattern.
- [NEVER] Abbreviations: `cfg`, `opts`, `params`.
- [NEVER] Generic suffixes: `Data`, `Info`, `Manager`, `Service`.

---
## [9][DENSITY]
>**Dictum:** *Visuals compress beyond text capacity.*

<br>

[IMPORTANT] Tabular structures yield 40% gain over unstructured text. Markdown: 60.7% accuracy vs CSV 44.3%.

**Use Tables When:** Comparing >2 entities on >2 dimensions.<br>
**Use Diagrams When:** Flows >3 steps or hierarchies >2 levels. `1 Diagram ~ 500 Text Tokens`.
