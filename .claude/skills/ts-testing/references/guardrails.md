# [H1][GUARDRAILS]
>**Dictum:** *Automated gates catch structure; design guardrails catch semantics.*

<br>

Two enforcement layers: **automated gates** (machine-checkable, zero-tolerance) and **design guardrails** (require judgment, enforced via review). Together they form defense-in-depth preventing circular, flaky, and implementation-confirming tests.

---
## [1][AUTOMATED_GATES]
>**Dictum:** *PostToolUse hook + Stryker enforce structural correctness without human intervention.*

<br>

### [1.1][HOOK_RULES]

The PostToolUse hook (`.claude/hooks/validate-spec.sh`) validates every `*.spec.ts` edit via single-pass awk. JSON `{"decision":"block","reason":"..."}` with line-specific errors for self-correction.

| [INDEX] | [RULE]             | [PATTERN]                                                      | [FIX]                                               |
| :-----: | ------------------ | -------------------------------------------------------------- | --------------------------------------------------- |
|   [1]   | LOC limit          | File exceeds 175 lines                                         | Pack properties, use `Effect.all` aggregation       |
|   [2]   | No `any`           | `: any`, `as any`, `<any>`, `, any>`                           | Branded types via Schema                            |
|   [3]   | No `let`/`var`     | `let x =`, `var x =`                                           | `const` only                                        |
|   [4]   | No loops           | `for (`, `while (`                                             | `.map`, `.filter`, `Effect.forEach`                 |
|   [5]   | No `try/catch`     | `try {`, `} catch (`                                           | Effect error channel (`.pipe(Effect.flip)`)         |
|   [6]   | No `new Date()`    | `new Date(`                                                    | `as const` constants or `TestClock`                 |
|   [7]   | No `if/else`       | `if (`, `} else`                                               | Ternary, `fc.pre()`, `Effect.fromNullable`          |
|   [8]   | No custom matchers | `.toSucceed(`, `.toBeRight(`, `.toFail(`, `.toBeLeft(`         | `it.effect()` + standard `expect()`                 |
|   [9]   | No default exports | `export default`                                               | Named exports only                                  |
|  [10]   | No Object.freeze   | `Object.freeze(`                                               | `as const` for immutability                         |
|  [11]   | Block syntax       | `Effect.sync/tap(() => expect(...)` without `=> {`             | `=> { expect(...); }` (returns void, not Assertion) |
|  [12]   | Import order       | @effect/vitest -> @parametric-portal/* -> effect -> vitest     | Reorder to match sequence                           |
|  [13]   | Forbidden labels   | `[HELPERS]`, `[HANDLERS]`, `[UTILS]`, `[CONFIG]`, `[DISPATCH]` | Use CONSTANTS, LAYER, ALGEBRAIC, EDGE_CASES         |

### [1.2][MUTATION_THRESHOLDS]

Stryker injects code mutants (operator swaps, conditional negations, statement deletions, string mutations). Circular tests re-derive source logic and compute the same wrong answer as mutated source -- mutant survives.

| [LEVEL] | [SCORE] | [ACTION]                                        |
| :-----: | :-----: | ----------------------------------------------- |
|  high   |   80    | Target -- tests are contract-driven             |
|   low   |   60    | Investigate -- likely mirrors implementation    |
|  break  |   50    | Build fails -- test is circular or tautological |

**Kill strategies by mutant type:**

| [MUTANT_TYPE]            | [WHAT_KILLS_IT]                           |
| ------------------------ | ----------------------------------------- |
| Arithmetic operator swap | Algebraic law with cross-validated result |
| Conditional negation     | Property covering both branches           |
| Statement deletion       | Test that depends on deleted operation    |
| String mutation          | Known-answer vector comparison            |

---
## [2][ANTI_PATTERNS]
>**Dictum:** *Design-level anti-patterns supplement automated hook rules (section 1.1).*

<br>

Hook rules catch syntactic violations. These anti-patterns catch **semantic** issues that require judgment:

| [INDEX] | [FORBIDDEN]              | [REPLACEMENT]                                          |
| :-----: | ------------------------ | ------------------------------------------------------ |
|   [1]   | Hardcoded test arrays    | `it.each(CONSTANT_TABLE)` or `Effect.forEach(VECTORS)` |
|   [2]   | Magic numbers            | Named constants with `as const`                        |
|   [3]   | Re-deriving source logic | Algebraic law or external oracle                       |
|   [4]   | Hand-rolled arbitraries  | `Arbitrary.make(Schema)` from @effect/schema           |

---
## [3][ORACLE_INDEPENDENCE]
>**Dictum:** *Expected values must be external to the implementation under test.*

<br>

A test is **implementation-confirming** when changing internal algorithm (preserving contract) breaks it. These tests create maintenance burden and catch zero real bugs. Six detection signals:

| [INDEX] | [SIGNAL]                              | [FIX]                                        |
| :-----: | ------------------------------------- | -------------------------------------------- |
|   [1]   | Asserts internal data structures      | Assert output shape or behavioral property   |
|   [2]   | Mirrors source code branching logic   | Use algebraic law (identity, inverse, etc.)  |
|   [3]   | Hardcodes expected intermediate state | Generate inputs, assert only final invariant |
|   [4]   | Breaks when refactoring internals     | Test externally observable contract          |
|   [5]   | Tests private function directly       | Test via public API composition              |
|   [6]   | Low mutation score (< 60%)            | Replace with algebraic or oracle-based test  |

**Oracle classification:**

| [ORACLE_TYPE]            | [STATUS]     | [EXAMPLE]                               |
| ------------------------ | ------------ | --------------------------------------- |
| Algebraic law            | Independent  | `g(f(x)) = x` (inverse)                 |
| External reference impl  | Independent  | `createHash('sha256')` from node:crypto |
| Standards vectors        | Independent  | NIST FIPS 180-4, RFC 4231, RFC 6902     |
| Schema-derived arbitrary | Independent  | `Arbitrary.make(Schema)` for inputs     |
| Manually computed        | Verify       | Hand-calculate, document derivation     |
| Source output pasted     | **Circular** | **Replace** with law or oracle          |

---
## [4][DETERMINISM_AND_ISOLATION]
>**Dictum:** *Tests must be deterministic, isolated, and reproducible.*

<br>

### [4.1][TIME_DETERMINISM]

All time-dependent tests use `TestClock.adjust` for virtual time progression. Real wall-clock (`it.scopedLive`) is reserved for integration tests requiring actual delays (container startup, semaphore saturation). Never mix TestClock and real timers in the same test.

### [4.2][ARBITRARY_SAFETY]

Filter arbitraries to exclude dangerous inputs that poison global state:
- **Proto pollution**: `_safeKey.filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k))`
- **JSON injection**: `.filter((o) => !JSON.stringify(o).includes('"__proto__"'))`
- **Length bounds**: `maxLength` on strings prevents OOM; `maxKeys`/`maxDepth` on objects prevents combinatorial explosion

### [4.3][PRECONDITION_DISCIPLINE]

`fc.pre()` rejects invalid samples at generator level. If precondition rejects >5% of generated cases, the arbitrary is too broad -- narrow the generator instead. Excessive `fc.pre()` filtering degrades shrinking quality and wastes generation budget.

### [4.4][RESOURCE_CLEANUP]

Use `it.scoped` for tests requiring `Scope`-managed resources (semaphores, circuit breakers, fibers). The scope automatically releases resources on test completion. For integration tests: `beforeAll`/`afterAll` manage container lifecycle with explicit `60_000` timeout.

### [4.5][TEST_ISOLATION]

Each `it.effect` / `it.effect.prop` runs in a fresh Effect runtime. Shared state between tests must be immutable (`as const`) or re-initialized per test. Layer-scoped suites (`layer(testLayer)('name', ...)`) share a service layer but each test gets isolated fiber execution.

---
## [5][HUMAN_REVIEW]
>**Dictum:** *Automation catches syntax; humans verify semantics.*

<br>

Three criteria automation cannot verify:

1. **Law correctness** -- Algebraic laws accurately model domain contract. A syntactically valid law asserting a vacuous property (identity on a constant) provides false confidence.
2. **Generator quality** -- Arbitraries produce diverse, representative inputs covering edge cases. Schema-derived arbitraries preferred over hand-rolled. Verify generators exercise boundary conditions (empty strings, max-length, unicode, negative numbers).
3. **Coverage completeness** -- Properties cover all exported functions. Walk the law selection matrix per export. Missing functions = missing coverage regardless of per-file percentage.
