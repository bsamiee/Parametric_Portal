# [H1][TESTING_PHILOSOPHY]
>**Dictum:** *Philosophy governs why we test this way -- laws prevent circularity, generation multiplies coverage, defense-in-depth catches what slips through.*

---
## [1][THESIS]
>**Dictum:** *Three pillars eliminate circular AI-generated tests.*

- **Algebraic PBT as external oracle** -- Laws like identity, inverse, and homomorphism are domain-independent mathematical truths. An AI cannot fabricate a law that "happens to pass" because the law's correctness is provable independent of the implementation. See [->laws.md](laws.md) for the complete law catalog.
- **Parametric generation multiplies coverage** -- A single `it.effect.prop` invocation generates 50-200 cases per run, replacing hundreds of hand-written assertions with a single universally-quantified property. The suite produces 2,500+ generated cases per run across all specs.
- **Defense-in-depth pipeline detects circular tests** -- Stryker mutation testing is the keystone: circular tests that re-derive expected values from source code fail to kill mutants, surfacing as mutation score regressions. See [->guardrails.md](guardrails.md) for enforcement mechanisms.

---
## [2][HARD_CONSTRAINTS]
>**Dictum:** *Numeric thresholds are non-negotiable -- this section is the canonical source of truth.*

[CRITICAL] **Coverage target: 95%** (V8 provider, per-file enforcement)
[CRITICAL] **Mutation score: break=50** (Stryker thresholds: high=80, low=60, break=50)
[CRITICAL] **Test file LOC limit: <125 LOC** (forces density over verbosity; transfer.spec.ts exception at 175)

| [INDEX] | [METRIC]                | [VALUE] | [NOTE]                                      |
| :-----: | ----------------------- | :-----: | ------------------------------------------- |
|   [1]   | Generated cases per run | 2,500+  | Property-based generation across full suite |
|   [2]   | Test-to-source ratio    |  1.19   | 689 LOC tests : 578 LOC source              |
|   [3]   | Spec count              |    6    | Post-consolidation (server package)         |
|   [4]   | Max file LOC            |  <125   | Enforced per spec file (transfer: 175)      |
|   [5]   | Vitest projects         |    4    | Inline projects in root vitest.config.ts    |

All thresholds above are authoritative. Other docs reference this section -- do not duplicate values elsewhere.

---
## [3][DEFENSE_PIPELINE]
>**Dictum:** *Seven layers ensure no circular test survives to merge.*

| [INDEX] | [LAYER]              | [MECHANISM]                         | [STATUS] |
| :-----: | -------------------- | ----------------------------------- | -------- |
|   [1]   | Algebraic PBT        | Laws are external oracles by nature | Active   |
|   [2]   | Model-Based Testing  | fc.commands() stateful verification | Active   |
|   [3]   | Differential Testing | Cross-validation vs reference impls | Active   |
|   [4]   | Mutation Testing     | Stryker kill-ratio enforcement      | Active   |
|   [5]   | External Oracles     | NIST FIPS 180-4, RFC 4231, RFC 6902 | Active   |
|   [6]   | PostToolUse Hook     | `.claude/hooks/validate-spec.sh`    | Active   |
|   [7]   | Human Review         | Final gate for spec correctness     | Always   |

Layers [1]-[3] prevent circularity by construction. Layer [4] detects circularity after the fact. Layers [5]-[7] provide independent validation. See [->guardrails.md](guardrails.md) for enforcement details.

---
## [4][TOPOLOGY]
>**Dictum:** *Directory structure encodes test organization post-consolidation.*

```
/
├── vitest.config.ts              # Root config with 4 inline projects
├── playwright.config.ts          # E2E config with triple-app bootstrap
├── stryker.config.mjs            # Mutation testing (packages/server/src)
├── tests/
│   ├── setup.ts                  # addEqualityTesters() only (9 LOC)
│   ├── package.json              # Test dependencies
│   ├── e2e/
│   │   └── seed.spec.ts          # Bootstrap validation (31 LOC)
│   ├── packages/
│   │   └── server/
│   │       ├── crypto.spec.ts    # 124 LOC -> covers 185 LOC source
│   │       ├── diff.spec.ts      # 104 LOC -> covers 63 LOC source
│   │       ├── transfer.spec.ts  # 159 LOC -> covers 330 LOC source (model-based PBT merged)
│   │       ├── resilience.spec.ts # 121 LOC -> fault injection + halfOpen
│   │       ├── time.spec.ts      # 102 LOC -> TestClock infrastructure
│   │       └── schema-arb.spec.ts # 79 LOC -> schema-derived arbs
│   ├── fixtures/                 # Shared test data
│   ├── integration/              # testcontainers
│   └── system/                   # Full-stack validation
```

[IMPORTANT] Root `vitest.config.ts` is the single source of truth for all inline project definitions.

| [INDEX] | [PROJECT]       | [ENVIRONMENT] | [PATTERN]                             | [STATUS]          |
| :-----: | --------------- | ------------- | ------------------------------------- | ----------------- |
|   [1]   | root-tests      | node          | `tests/**/*.spec.ts`                  | Active (6 specs)  |
|   [2]   | packages-node   | node          | `packages/*/tests/**/*.spec.ts`       | Configured, empty |
|   [3]   | runtime-browser | chromium      | `packages/runtime/tests/**/*.spec.ts` | Configured, empty |
|   [4]   | apps            | jsdom         | `apps/*/tests/**/*.spec.ts`           | Configured, empty |

---
## [5][REFERENCES]
>**Dictum:** *Cross-references enable deep-dive navigation.*

- [->laws.md](laws.md) -- WHAT algebraic laws are enforced and their mathematical basis
- [->standards.md](standards.md) -- HOW to author tests (density patterns, naming, structure)
- [->tooling.md](tooling.md) -- External dependency catalog and version pins
- [->guardrails.md](guardrails.md) -- Enforcement mechanisms (hooks, CI gates, mutation thresholds)
