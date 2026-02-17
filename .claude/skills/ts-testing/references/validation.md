# [H1][VALIDATION]
>**Dictum:** *Validation gates verify spec quality at structural, semantic, and statistical layers.*

<br>

[IMPORTANT] Three validation layers run in sequence: structural (fast, syntactic), semantic (coverage + oracle), statistical (mutation score). A spec must pass all three before submission. Each layer catches a distinct defect class -- structural catches formatting violations, semantic catches coverage gaps, statistical catches circular reasoning.

---
## [1][STRUCTURAL_GATE]
>**Dictum:** *Syntactic conformance is the prerequisite for semantic evaluation.*

<br>

The PostToolUse hook enforces 13 structural rules on every `*.spec.ts` edit. Structural violations block further validation -- fix before proceeding.

[REFERENCE] Full rule table with patterns and fixes: [→guardrails.md](./guardrails.md) section 1.1.

---
## [2][SEMANTIC_GATE]
>**Dictum:** *Coverage validates completeness; oracle independence validates correctness.*

<br>

### [2.1][COVERAGE]

**Command:** `pnpm exec nx test -- --coverage`

[CRITICAL] **95% per-file** on statements, branches, and functions. Measured independently per source module -- aggregate scores are insufficient.

| [INDEX] | [SIGNAL]            | [INTERPRETATION]                     | [REMEDIATION]                                       |
| :-----: | ------------------- | ------------------------------------ | --------------------------------------------------- |
|   [1]   | Uncovered branches  | Missing edge case or error path      | Add `[EDGE_CASES]` section with boundary conditions |
|   [2]   | Uncovered function  | Public API method untested           | Add property or Effect.all aggregation covering it  |
|   [3]   | Uncovered statement | Dead code or missed conditional path | Verify code reachability; add targeted assertion    |

**Remediation pattern:** Identify uncovered branches in HTML report -> add `Effect.all` aggregation for boundary enumeration -> re-run coverage -> confirm improvement above 95%.

### [2.2][ORACLE_INDEPENDENCE]

Every assertion must derive its expected value from a source **external** to the implementation under test.

[CRITICAL] If an expected value was obtained by running the implementation and copying the output, the test is circular. It passes today but cannot detect regressions.

[REFERENCE] Oracle classification table and detection signals: [→guardrails.md](./guardrails.md) section 3.

### [2.3][GENERATOR_QUALITY]

Arbitraries must produce diverse, representative inputs covering the domain's edge topology. Schema-derived arbitraries (`Arbitrary.make(Schema)`) preferred over hand-rolled.

[REFERENCE] Arbitrary safety filters and precondition discipline: [→guardrails.md](./guardrails.md) sections 4.2-4.3.

---
## [3][STATISTICAL_GATE]
>**Dictum:** *Mutation score separates contract-driven tests from circular ones.*

<br>

### [3.1][MUTATION_ANALYSIS]

**Command:** `pnpm test:mutate`

Run Stryker after semantic gate passes. Analyze surviving mutants to determine if they are equivalent (semantically identical to original) or genuine test gaps.

[REFERENCE] Mutation thresholds, kill strategies, and equivalent mutant handling: [→guardrails.md](./guardrails.md) section 1.2.

---
## [4][VALIDATION_PIPELINE]
>**Dictum:** *Sequential gates with early termination minimize wasted effort.*

<br>

| [INDEX] | [GATE] | [CHECK]                 | [ON_FAIL]                            |
| :-----: | :----: | ----------------------- | ------------------------------------ |
|   [1]   |   1    | Hook structural rules   | Fix line-specific error, re-edit     |
|   [2]   |   2    | Coverage (>= 95%)       | Add EDGE_CASES section               |
|   [3]   |   3    | Oracle independence     | Replace with algebraic law or vector |
|   [4]   |   4    | Generator quality       | Switch to Arbitrary.make(Schema)     |
|   [5]   |   5    | Mutation score (>= 80%) | Analyze survivors, strengthen tests  |

[REFERENCE] Thresholds: SKILL.md section 2. Hook rules: [→guardrails.md](./guardrails.md) section 1.1.

---
## [5][ERROR_DIAGNOSIS]
>**Dictum:** *Known symptoms map to deterministic fixes.*

<br>

| [INDEX] | [SYMPTOM]                       | [ROOT_CAUSE]                               | [FIX]                                                 |
| :-----: | ------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
|   [1]   | Hook blocks edit                | One of 13 structural rules violated        | Read error message, fix specific line                 |
|   [2]   | Mutation score < 60%            | Test re-derives source logic               | Replace with algebraic law or external oracle         |
|   [3]   | Property flaky                  | Generator produces inconsistent edge cases | Add `fc.pre()` constraint or tighten arbitrary bounds |
|   [4]   | Coverage below 95%              | Missing branch or edge case                | Add `[EDGE_CASES]` with boundary conditions           |
|   [5]   | False positive assertion        | Expression-form returns Assertion object   | Switch to block syntax `{ expect(...); }`             |
|   [6]   | Import order violation          | Imports not in canonical sequence          | Reorder: @effect/vitest -> @pp/* -> effect -> vitest  |
|   [7]   | LOC exceeds 175                 | Spec too verbose                           | Pack properties, use Effect.all aggregation           |
|   [8]   | Schema-derived arb type error   | Schema has unsupported combinator          | Fall back to hand-rolled `fc.*` arbitrary             |
|   [9]   | Model-based timeout             | Command sequences too long                 | Reduce `numRuns` to 15-30, limit `maxCommands`        |
|  [10]   | TestClock test hangs            | Effect not forked before clock adjustment  | `Effect.fork` -> `TestClock.adjust` -> `Fiber.await`  |
|  [11]   | Shrinking produces large output | Arbitrary space too broad for domain       | Add `maxLength`, `maxDepth`, `filter()` constraints   |
|  [12]   | Surviving mutant (equivalent)   | Mutant is semantically identical           | Verify equivalence, exclude from score analysis       |
