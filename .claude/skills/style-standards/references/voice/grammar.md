# [H1][GRAMMAR]
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

---
## [1][PUNCTUATION]
>**Dictum:** *Punctuation concentrates attention.*

<br>

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
[REFERENCE] Usage rules: [→typeset.md§2[PUNCTUATION]](../formatting/typeset.md#2punctuation)

---
## [2][MODALS]
>**Dictum:** *Modals trigger false obligations.*

<br>

[CRITICAL] Modal expressions (`must`, `should`, `ought`) trigger **Deontological Keyword Bias**—>90% false-positive obligation detection regardless of context.

| [INDEX] | [AVOID]  | [USE_INSTEAD]                                   |
| :-----: | -------- | ----------------------------------------------- |
|   [1]   | `must`   | "Include [X]" or "REQUIREMENT: [X]"             |
|   [2]   | `should` | "Incorporate at least [X]" or "[X] recommended" |
|   [3]   | `ought`  | "To achieve [outcome], implement: [steps]"      |

[IMPORTANT] Bracketed directives (`[MUST]`, `[NEVER]`) retain compliance—parsed as format, not prose. Reserve prose modals for: legal, safety-critical, regulatory contexts.

---
## [3][SYNTAX]
>**Dictum:** *Simplicity maximizes accuracy.*

<br>

[IMPORTANT] Simple sentences: 93.7% accuracy vs 46.8% for nested structures.

[IMPORTANT]:
1.  [ALWAYS] **Simple Clauses:** Single subject-verb-object per sentence.
2.  [ALWAYS] **Coordination:** Use FANBOYS (`for`, `and`, `nor`, `but`, `or`, `yet`, `so`) over subordination.
3.  [ALWAYS] **Sequential Decomposition:** "First, [X]. Then, [Y]. Finally, [Z]."

[CRITICAL]:
- [NEVER] **Nested Dependencies:** Center-embedded clauses (clause within clause) cause tracking failure.

[REFERENCE] Compliance metrics: [→SKILL.md§2.2[VOICE]](../../SKILL.md#22voice)
