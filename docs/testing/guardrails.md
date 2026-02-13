# [H1][TESTING_GUARDRAILS]
>**Dictum:** *Enforcement mechanisms prevent test quality from degrading over time.*

This document defines the automated and manual guardrails that enforce testing standards across the monorepo. Each layer catches a different class of defect: static analysis catches syntax violations, mutation testing catches circular logic, and human review catches semantic gaps. Together they form the defense-in-depth pipeline described in [philosophy.md](philosophy.md).

---
## [1][IMPLEMENTATION_CONFIRMING]
>**Dictum:** *Tests verify contracts, not algorithms.*

A test is **implementation-confirming** if changing the internal algorithm (while preserving the contract) breaks it. Implementation-confirming tests create a maintenance burden: every refactor breaks them, yet they catch zero real bugs because they only verify that the code does what the code does.

Algebraic tests assert externally observable mathematical properties (identity, inverse, equivalence) rather than replicating source logic. When a signal from the table below is detected, replace the test with the corresponding fix.

| [INDEX] | [SIGNAL]                              | [FIX]                                        |
| :-----: | ------------------------------------- | -------------------------------------------- |
|   [1]   | Asserts internal data structures      | Assert output shape or behavioral property   |
|   [2]   | Mirrors source code branching logic   | Use algebraic law (identity, inverse, etc.)  |
|   [3]   | Hardcodes expected intermediate state | Generate inputs, assert only final invariant |
|   [4]   | Breaks when refactoring internals     | Test externally observable contract          |
|   [5]   | Tests private function directly       | Test via public API composition              |
|   [6]   | Low mutation score (< 60%)            | Replace with algebraic or oracle-based test  |

**Defense-in-depth pipeline:** algebraic PBT -> mutation testing -> external oracles -> PostToolUse hook -> human review. See [philosophy.md](philosophy.md) for pipeline rationale, [standards.md](standards.md) for law taxonomy.

---
## [2][MUTATION_DEFENSE]
>**Dictum:** *Mutation testing exposes circular reasoning.*

Stryker detects circular tests by injecting code mutants (arithmetic operator swaps, conditional negations, statement deletions) into the source. A circular test re-derives source logic, so mutants survive when the test computes the same wrong answer as the mutated source. Low mutation scores are the primary signal that a test mirrors implementation internals rather than verifying an external contract.

**Threshold enforcement** (configured in `stryker.config.mjs`):

| [LEVEL] | [SCORE] | [ACTION]                                               |
| :-----: | :-----: | ------------------------------------------------------ |
|  high   |   80    | Target -- tests are contract-driven                    |
|   low   |   60    | Investigation trigger -- likely mirrors implementation |
|  break  |   50    | Build fails -- test is circular                        |

If a file scores below 60%, investigate whether the test re-derives source branching logic. The fix is typically replacing hardcoded expected values with algebraic laws or external oracle comparisons.

**Command:** `pnpm test:mutate`. See [tooling.md](tooling.md) for Stryker configuration details.

---
## [3][HOOK_ENFORCEMENT]
>**Dictum:** *Automated gates catch violations before commit.*

The PostToolUse hook (`.claude/hooks/validate-spec.sh`) validates every Edit/Write to `*.spec.ts` files via a single-pass awk program. The hook reads the Claude Code PostToolUse JSON event from stdin, extracts `tool_input.file_path`, and only activates for `*.spec.ts` files. All pattern checks run inside the awk native regex engine at C speed with zero forks per line.

**Rules enforced:**

| [INDEX] | [RULE]          | [DETAIL]                                                                                    |
| :-----: | --------------- | ------------------------------------------------------------------------------------------- |
|   [1]   | LOC limit       | 125 lines max per spec file (transfer.spec.ts: 175, model-based PBT merged)                 |
|   [2]   | Anti-patterns   | `any` type, `let`/`var` declarations, `for`/`while` loops, `try/catch` blocks, `new Date()` |
|   [3]   | Expression-form | `Effect.sync`/`Effect.tap` assertions must use block syntax `{ expect(...); }`              |
|   [4]   | Import ordering | `@effect/vitest` -> `@parametric-portal/*` -> `effect` -> `vitest`                          |

**Output:** JSON `{"decision":"block","reason":"..."}` with line-specific errors (e.g., `Line 42: Forbidden 'any' type`) for agent self-correction. The hook only reports the first import-order violation to avoid cascading noise. Registered in `.claude/settings.json`; see [standards.md](standards.md) [5.3] for the full anti-pattern catalog.

---
## [4][HUMAN_REVIEW]
>**Dictum:** *Automation catches syntax; humans verify semantics.*

Three review criteria for spec files that automation cannot fully verify:

1. **Law correctness** -- algebraic laws accurately model the domain contract. A syntactically valid law that asserts a vacuous property (e.g., identity on a constant) provides false confidence.
2. **Generator quality** -- arbitraries produce diverse, representative inputs covering edge cases. Schema-derived arbitraries via `Arbitrary.make(Schema)` are preferred over hand-rolled generators.
3. **Oracle independence** -- test oracles are external to the implementation under test. Reviewers verify that expected values come from domain knowledge, reference implementations, or algebraic properties rather than copy-pasting source logic.

---
## [5][COVERAGE_VERIFICATION]
>**Dictum:** *Coverage confirms completeness within constraints.*

[CRITICAL]: Every spec file MUST achieve **95% per-file coverage** (statements, branches, functions) in <125 LOC. Aggregate coverage across all files is NOT sufficient -- each file is measured independently.

**Command:** `pnpm exec nx test -- --coverage`.

See [philosophy.md](philosophy.md) for threshold rationale and [standards.md](standards.md) [5.2] for coverage constraints.
