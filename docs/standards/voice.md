---
description: Context Engineering & Agentic Voice Standards
---

# [H1][VOICE]
>**Dictum:** *Structured context maximizes agent comprehension.*

<br>

Universal standards for LLM-optimized context, documentation, and agentic instructions.

---
## [1][ORDERING]
>**Dictum:** *Position determines attention weight.*

<br>

[CRITICAL] Primacy effects peak at 150-200 instructions. Earlier items receive up to 5.79× higher attention.

[IMPORTANT]:
1.  [ALWAYS] **Critical-First:** Place highest-priority constraints at sequence start.
2.  [ALWAYS] **Saturation Awareness:** Beyond 300 instructions, uniform failure emerges.

[CRITICAL]:
- [NEVER] **Middle Burial:** Middle positions suffer U-shaped attention loss.

[REFERENCE] Structure (depth, lists): [→formatting.md§3[STRUCTURE]](formatting.md#3structure)

---
## [2][GRAMMAR]
>**Dictum:** *Grammar maximizes signal density.*

<br>

[IMPORTANT] Imperative, mechanical, domain-specific. No hedging, no self-reference.

*Actions:* Imperative. *Context/Facts:* Declarative.

[IMPORTANT]:
1.  [ALWAYS] **Drop Stopwords:** Remove `the`, `a`, `an`, `please`, `kindly`.
    -   *Bad:* "The function returns a user."
    -   *Good:* "Returns User."
2.  [ALWAYS] **Imperative Actions:** Start instructions with Verbs.
    -   *Bad:* "You should validate."
    -   *Good:* "Validate."
3.  [ALWAYS] **Declarative Facts:** State context as absolute truth.
    -   *Bad:* "This seems to be the config."
    -   *Good:* "Config source."

[CRITICAL]:
- [NEVER] Self-referential: "This file...", "We do...", "You should..."
- [NEVER] Capability disclaimers: "can handle", "is able to"
- [NEVER] Hedging: "might", "could", "probably", "should"
- [NEVER] Meta-commentary: "Sourced from...", "Confirmed with..."

<br>

### [2.1][PUNCTUATION]

[IMPORTANT] Punctuation tokens act as **attention sinks**—absorb 20-40% of attention weight despite minimal semantic content.

| [INDEX] | [MARK]  | [COGNITIVE_FUNCTION] | [MECHANISM]                                                                          |
| :-----: | :-----: | -------------------- | ------------------------------------------------------------------------------------ |
|   [1]   |   `.`   | Hard Attention Reset | Information aggregation checkpoint. Context consolidates before next reasoning step. |
|   [2]   |   `:`   | Attention Bridge     | Links entity to elaboration. Signals specification relationship.                     |
|   [3]   |   `—`   | Inline Expansion     | Introduces elaboration without breaking attention flow.                              |
|   [4]   |   `→`   | Conditional Flow     | Signals transformation, sequence progression, or causation.                          |
|   [5]   | `` ` `` | Type Boundary        | Signals semantic shift to code/symbol domain. Anchors tokenizer.                     |
|   [6]   |   `;`   | Clause Conjunction   | Joins independent but related clauses. Logical relationship marker.                  |
|   [7]   |   `?`   | Attention Shift      | Triggers expectation state. Late-layer necessity for query resolution.               |

**Softmax Constraint:** Attention weights sum to 1 across positions. Models concentrate excess weight on punctuation to satisfy normalization; this preserves semantic token differentiation.

**Layer Specialization:**<br>
*Early (0-4):* Period segments input—necessary for structure, insufficient for retrieval.<br>
*Late (7-11):* Period + question mark store concentrated information—necessary and sufficient.

[CRITICAL] Single delimiter changes produce 18-29% performance swings. Consistency matters more than choice.<br>
[REFERENCE] Usage rules: [→formatting.md§4.2[PUNCTUATION]](formatting.md#42punctuation)

---
### [2.2][MODALS]

[CRITICAL] Modal expressions (`must`, `should`, `ought`) trigger **Deontological Keyword Bias**—>90% false-positive obligation detection regardless of context.

| [INDEX] | [AVOID]  | [USE_INSTEAD]                                   |
| :-----: | -------- | ----------------------------------------------- |
|   [1]   | `must`   | "Include [X]" or "REQUIREMENT: [X]"             |
|   [2]   | `should` | "Incorporate at least [X]" or "[X] recommended" |
|   [3]   | `ought`  | "To achieve [outcome], implement: [steps]"      |

[IMPORTANT] Bracketed directives (`[MUST]`, `[NEVER]`) retain compliance—parsed as format, not prose. Reserve prose modals for: legal, safety-critical, regulatory contexts.

---
### [2.3][SYNTAX]

[IMPORTANT] Simple sentences achieve 93.7% accuracy vs 46.8% for complex nested structures.

[IMPORTANT]:
1.  [ALWAYS] **Simple Clauses:** Single subject-verb-object per sentence.
2.  [ALWAYS] **Coordination:** Use FANBOYS (`for`, `and`, `nor`, `but`, `or`, `yet`, `so`) over subordination.
3.  [ALWAYS] **Sequential Decomposition:** "First, [X]. Then, [Y]. Finally, [Z]."

[CRITICAL]:
- [NEVER] **Nested Dependencies:** Center-embedded clauses (clause within clause) cause tracking failure.

**Voice Effect:** Active voice achieves 56% token reduction and 12-28% higher compliance than passive.

---
## [3][DENSITY]
>**Dictum:** *Visuals compress beyond text capacity.*

<br>

[IMPORTANT] Tabular structures yield 40% average performance gain over unstructured text. Markdown format achieves 60.7% accuracy—16 points ahead of CSV (44.3%).

| [INDEX] | [FORMAT]    | [ACCURACY] | [TOKEN_EFFICIENCY] |
| :-----: | ----------- | :--------: | :----------------: |
|   [1]   | Markdown-KV |   60.7%    |   2.7× baseline    |
|   [2]   | XML         |   56.0%    |   1.8× baseline    |
|   [3]   | JSON        |   52.3%    |   0.85× baseline   |
|   [4]   | CSV         |   44.3%    |   1.0× baseline    |

<br>

### [3.1][TABLES]

**Use When:** Comparing > 2 entities on > 2 dimensions.<br>
**Format:** Align columns. Keep cell content concise.

---
### [3.2][DIAGRAMS]

**Use When:** Describing flows > 3 steps or hierarchies > 2 levels.<br>
**Optimization:** Use `graph TD` (Top-Down) for flow. Use `classDiagram` for architecture.<br>
**Context Value:** `1 Diagram ≈ 500 Text Tokens`.

---
## [4][COMMENTS]
>**Dictum:** *Comments explain why, not what.*

<br>

[IMPORTANT] Comment augmentation yields 40-53% accuracy improvement. Early-program documentation receives 4.6× more comprehension than late-program (60% vs 13% fault detection).

**Accuracy Tradeoff:**<br>
*Incorrect comments:* 78% accuracy loss—worse than missing comments.<br>
*Missing comments:* Minimal impact—models rely on code structure.

[CRITICAL] Front-load architectural decisions and domain semantics where attention peaks.

<br>

### [4.1][RULES]

[IMPORTANT]:
1.  [ALWAYS] **Why > What:** Explaining *logic* (Redundant) = Noise. Explaining *intent* (Grounding) = Signal.
    -   *Noise:* `// Increment i`
    -   *Signal:* `// Optimization: Bitshift faster`
2.  [ALWAYS] **Anchor-First:** Start JSDoc with **Action Verb**.
3.  [ALWAYS] **Mechanical Voice:** Domain-specific, no hedging.

[CRITICAL]:
- [NEVER] **Type-Lite:** Duplicate TS types in comments (e.g., `@param {string} name`). Type system is single source of truth.
- [NEVER] **Obvious:** Comment only when code cannot express intent.

```typescript
// Wrap to 0-360 range for OKLCH hue normalization
const normalizedHue = ((h % 360) + 360) % 360;
```

---
### [4.2][JSDOC]

```typescript
/**
 * [Imperative_Verb] [Outcome].
 * [Grounding]: [Why_this_exists].
 */
```

| [INDEX] | [COMPONENT] | [REQUIREMENT]                    |
| :-----: | ----------- | -------------------------------- |
|   [1]   | Verb        | Start with imperative verb.      |
|   [2]   | Object      | State what is acted upon.        |
|   [3]   | Mechanism   | Include domain context.          |
|   [4]   | Details     | Mechanical behavior, not intent. |

**Tag Order:** `@param` → `@returns` → `@throws` → `@example`

---
## [5][KEYWORDS]
>**Dictum:** *Keyword choice determines compliance.*

<br>

| [INDEX] | [KEYWORD]       | [COMPLIANCE] | [DEFINITION]                                              |
| :-----: | :-------------- | :----------- | :-------------------------------------------------------- |
|   [1]   | **`CRITICAL`**  | **99%**      | **Security/Data Risk.** Non-negotiable.                   |
|   [2]   | **`NEVER`**     | **98%**      | **Negative Constraint.** Higher compliance than `ALWAYS`. |
|   [3]   | **`MUST`**      | **95%**      | **Architecture Rule.** Binary verifiable.                 |
|   [4]   | **`IMPORTANT`** | **92%**      | **Emphasis Marker.** Anthropic-recommended.               |
|   [5]   | **`ALWAYS`**    | **90%**      | **Style Convention.** Consistency.                        |
|   [6]   | **`[VERIFY]`**  | **Agentic**  | **Self-Correction.** Triggers agent verification.         |

[IMPORTANT] Max 2-3 keywords per section. Diminishing returns after 5.<br>
[IMPORTANT] Positive framing outperforms negative by 8-15%. Negation blindness causes 39% accuracy.

---
## [6][NAMING]
>**Dictum:** *Consistent naming enables pattern recognition.*

<br>

### [6.1][FILES]

[PENDING] File naming conventions.

---
### [6.2][CODE]

[IMPORTANT] Strict naming taxonomy. Enforce exact prefixes/suffixes.

| [INDEX] | [CATEGORY]       | [PATTERN]             | [EXAMPLE]                                |
| :-----: | ---------------- | --------------------- | ---------------------------------------- |
|   [1]   | Config constant  | `B`                   | `const B = Object.freeze({...})`         |
|   [2]   | Schema           | `*Schema`             | `InputSchema`, `UserSchema`              |
|   [3]   | Factory function | `create*`             | `createConfig`, `createHandler`          |
|   [4]   | Action function  | Verb-noun             | `validate*`, `transform*`, `dispatch*`   |
|   [5]   | Dispatch table   | `*Handlers`           | `modeHandlers`, `labelHandlers`          |
|   [6]   | Effect pipeline  | `*Pipeline`           | `validationPipeline`                     |
|   [7]   | Type parameter   | Single uppercase      | `<T>`, `<M>`, `<const T>`                |
|   [8]   | Branded type     | PascalCase noun       | `UserId`, `IsoDate`, `HexColor`          |
|   [9]   | Error type       | `*Error`              | `ValidationError`, `TransformError`      |
|  [10]   | Boolean          | `is*`, `has*`, `can*` | `isValid`, `hasPermission`, `canExecute` |

[CRITICAL]:
- [NEVER] `utils`, `helpers`, `misc`—too vague.
- [NEVER] `config` as variable—conflicts with `B` pattern.
- [NEVER] Abbreviations: `cfg`, `opts`, `params`.
- [NEVER] Generic suffixes: `Data`, `Info`, `Manager`, `Service`.

---
## [7][CONSTRAINTS]
>**Dictum:** *Quantity thresholds bound comprehension.*

<br>

[CRITICAL] Performance degrades from 77.67% (Level I) to 32.96% (Level IV) as constraint nesting increases.

<br>

### [7.1][DENSITY]

[IMPORTANT]:
1.  [ALWAYS] **Limit Per Level:** Maximum 3-5 constraints per instruction level.
2.  [ALWAYS] **Hierarchical Ordering:** PRIMARY → SECONDARY → TERTIARY.
3.  [ALWAYS] **Decomposition:** Break complex requirements into sequential simple steps.

[CRITICAL]:
- [NEVER] **Constraint Saturation:** Simultaneous 6+ constraints cause <25% satisfaction.

---
### [7.2][FEW_SHOT]

[IMPORTANT] Few-shot performance peaks at 5-25 examples. Hundreds cause functional correctness collapse.

[IMPORTANT]:
1.  [ALWAYS] **Selection Over Quantity:** Distinctive examples (TF-IDF: term frequency × inverse document frequency) reduce count by 60%.
2.  [ALWAYS] **Diversity:** 2-3 high-quality examples > 10 mediocre examples.

[CRITICAL]:
- [NEVER] **Many-Shot:** 100+ examples cause functional correctness collapse.

---
## [8][VALIDATION]
>**Dictum:** *Checklists enforce standard compliance.*

<br>

[VERIFY]:
1.  **Structure:**
    - [ ] *Depth:* Nesting ≤ H3.
    - [ ] *Visuals:* Complex logic (>3 steps) diagrammed.
    - [ ] *Ordering:* Critical constraints at sequence start.
2.  **Voice:**
    - [ ] *Active:* All content uses active voice—no passive constructions.
    - [ ] *Stopwords:* All `the`, `a`, `an`, `please`, `kindly` removed.
    - [ ] *Hedging:* No `seems`, `might`, `probably`, `could`.
    - [ ] *Modals:* No prose `must`, `should`, `ought`—use bracketed directives.
    - [ ] *Self-Reference:* No "This file...", "We do...", "Sourced from...", "You should...".
3.  **Tone:**
    - [ ] *Actions:* Instructions use imperative—verb-first (e.g., "Validate input.").
    - [ ] *Context:* Facts use declarative—state as truth (e.g., "Config source.").
4.  **Syntax:**
    - [ ] *Periods:* Complete instructions end `.`
    - [ ] *Anchors:* Variables/paths backticked.
    - [ ] *Constraints:* `NEVER`/`MUST` binary verifiable.
5.  **Density:**
    - [ ] *Limits:* 3-5 constraints per instruction level.
    - [ ] *Clauses:* Single subject-verb-object per sentence.
