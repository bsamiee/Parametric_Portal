# [H1][TESTING_OVERVIEW]
>
>**Dictum:** *Single-page reference accelerates test infrastructure orientation.*

<br>

Property-based unit testing via Vitest, mutation testing via Stryker, E2E automation via Playwright.

---

## [1][STACK]
>
>**Dictum:** *Version pinning ensures reproducible test runs.*

<br>

| [INDEX] | [LAYER]           | [TOOL]                     | [RATIONALE]                               |
| :-----: | ----------------- | -------------------------- | ----------------------------------------- |
|   [1]   | Unit Testing      | Vitest                     | Vite-native, inline projects, V8 cov      |
|   [2]   | Browser           | @vitest/browser-playwright | Real browser isolation for runtime pkg    |
|   [3]   | E2E               | @playwright/test           | Chromium automation, trace capture        |
|   [4]   | Property-Based    | fast-check                 | Arbitrary generators, shrinking           |
|   [5]   | Model-Based       | fast-check (fc.commands)   | Stateful system testing via command model |
|   [6]   | Effect Testing    | @effect/vitest             | Effect equality testers, `it.effect.prop` |
|   [7]   | Mutation Testing  | @stryker-mutator/core      | Kill-ratio enforcement, circular test det |
|   [8]   | Mocking           | msw                        | Request interception, network mocks       |

<br>

### [1.1][HARD_CONSTRAINTS]

[CRITICAL] **Coverage target: 95%** (V8 provider, per-file enforcement)
[CRITICAL] **Mutation score: break at 50%** (Stryker thresholds: high=80, low=60, break=50)
[CRITICAL] **Test file LOC limit: <125 LOC** (forces density over verbosity)

| [INDEX] | [CONSTRAINT]            | [VALUE] | [NOTE]                                 |
| :-----: | ----------------------- | :-----: | -------------------------------------- |
|   [1]   | Generated cases per run | 2,500+  | Property-based generation across suite |
|   [2]   | Test-to-source ratio    |  0.72   | 418 LOC tests : 578 LOC source         |

---

## [2][TOPOLOGY]
>
>**Dictum:** *Directory structure encodes test organization.*

<br>

```
/
├── vitest.config.ts              # Root config with 4 inline projects
├── playwright.config.ts          # E2E config with triple-app bootstrap
├── stryker.config.mjs            # Mutation testing config (packages/server/src)
├── tests/
│   ├── setup.ts                  # addEqualityTesters() only (9 LOC)
│   ├── package.json              # Test dependencies
│   ├── e2e/
│   │   ├── seed.spec.ts          # Bootstrap validation (31 LOC)
│   │   └── test-results/e2e/     # Artifact output
│   ├── packages/
│   │   ├── database/             # Scaffolded (awaiting DB-layer tests)
│   │   └── server/
│   │       ├── crypto.spec.ts    # 116 LOC -> covers 185 LOC source
│   │       ├── diff.spec.ts      # 90 LOC  -> covers 63 LOC source
│   │       ├── diff-vectors.spec.ts  # 38 LOC -> RFC 6902 external oracle vectors
│   │       ├── transfer.spec.ts  # 103 LOC -> covers 330 LOC source
│   │       └── transfer-model.spec.ts # 71 LOC -> model-based stateful PBT
│   ├── fixtures/                 # Scaffolded (shared test data: JSON, YAML, binary)
│   ├── integration/              # Scaffolded (multi-service: testcontainers, DB, Redis, HTTP)
│   └── system/                   # Scaffolded (full-stack behavioral validation)
```

[IMPORTANT] Root `vitest.config.ts` defines inline projects -- centralized config eliminates per-package duplication.

---

## [3][PROJECTS]
>
>**Dictum:** *Inline projects isolate environments without config duplication.*

<br>

| [INDEX] | [PROJECT]       | [ENVIRONMENT] | [PATTERN]                             | [STATUS]          |
| :-----: | --------------- | ------------- | ------------------------------------- | ----------------- |
|   [1]   | root-tests      | node          | `tests/**/*.spec.ts`                  | Active (5 specs)  |
|   [2]   | packages-node   | node          | `packages/*/tests/**/*.spec.ts`       | Configured, empty |
|   [3]   | runtime-browser | chromium      | `packages/runtime/tests/**/*.spec.ts` | Configured, empty |
|   [4]   | apps            | jsdom         | `apps/*/tests/**/*.spec.ts`           | Configured, empty |

<br>

**Browser Project Features:**

- Viewport: 1280x720
- Trace retention on failure
- Permissions: clipboard-read, clipboard-write
- Fake timers with frozen time (2025-01-15T12:00:00Z)

---

## [4][PLAYWRIGHT]
>
>**Dictum:** *Triple-app bootstrap enables full-stack E2E validation.*

<br>

### [4.1][WEB_SERVERS]

| [INDEX] | [APP]            | [PORT] | [HEALTH_ENDPOINT]      |
| :-----: | ---------------- | :----: | ---------------------- |
|   [1]   | api              |  4000  | `/api/health/liveness` |
|   [2]   | parametric_icons |  3001  | `/` (document load)    |
|   [3]   | test_harness     |  3002  | `/` (document load)    |

<br>

### [4.2][ARTIFACT_RETENTION]

| [INDEX] | [ARTIFACT]  | [STRATEGY]        |
| :-----: | ----------- | ----------------- |
|   [1]   | Screenshots | only-on-failure   |
|   [2]   | Videos      | retain-on-failure |
|   [3]   | Traces      | retain-on-failure |

<br>

### [4.3][AGENT_AUTOMATION]

E2E test authoring via agent pipeline (invoked manually via Claude Code skills):

| [INDEX] | [AGENT]                   | [ROLE]                                    |
| :-----: | ------------------------- | ----------------------------------------- |
|   [1]   | playwright-test-planner   | Design test scenarios from UI exploration |
|   [2]   | playwright-test-generator | Generate tests from plans                 |
|   [3]   | playwright-test-healer    | Debug and fix failing tests               |

**Workflow:** Planner outputs to `docs/specs/` -> Generator creates `tests/e2e/**/*.spec.ts` -> Healer remediates failures.

---

## [5][DEFENSE_PIPELINE]
>
>**Dictum:** *Defense-in-depth detects circular AI-generated tests.*

<br>

| [INDEX] | [LAYER]             | [MECHANISM]                         | [STATUS]     |
| :-----: | ------------------- | ----------------------------------- | ------------ |
|   [1]   | Algebraic PBT       | Laws are external oracles by nature | Active       |
|   [2]   | Model-Based Testing | fc.commands() stateful verification | Active       |
|   [3]   | Mutation Testing     | Stryker kill-ratio enforcement      | Active       |
|   [4]   | External Oracles    | RFC 6902 / NIST CAVP test vectors   | In Progress  |
|   [5]   | PostToolUse Hook    | `.claude/hooks/validate-spec.sh`    | Active       |
|   [6]   | Human Review        | Final gate for spec correctness     | Always       |

---

## [6][QUICK_REFERENCE]
>
>**Dictum:** *Command reference accelerates test execution.*

<br>

### [6.1][NX_COMMANDS]

| [INDEX] | [COMMAND]                       | [PURPOSE]                          |
| :-----: | ------------------------------- | ---------------------------------- |
|   [1]   | `pnpm exec nx test`             | Run all unit tests                 |
|   [2]   | `pnpm exec nx test @scope/pkg`  | Run package-specific tests         |
|   [3]   | `pnpm exec nx e2e`              | Run E2E tests (starts web servers) |
|   [4]   | `pnpm exec nx run-many -t test` | Parallel test across affected      |
|   [5]   | `pnpm test:mutate`              | Run Stryker mutation testing       |

<br>

### [6.2][VITEST_COMMANDS]

| [INDEX] | [COMMAND]                    | [PURPOSE]                 |
| :-----: | ---------------------------- | ------------------------- |
|   [1]   | `pnpm vitest --ui`           | Open Vitest UI dashboard  |
|   [2]   | `pnpm vitest --coverage`     | Generate coverage report  |
|   [3]   | `pnpm vitest --project=apps` | Run specific project only |

<br>

### [6.3][PLAYWRIGHT_COMMANDS]

| [INDEX] | [COMMAND]         | [PURPOSE]                |
| :-----: | ----------------- | ------------------------ |
|   [1]   | `pnpm e2e`        | Run E2E tests            |
|   [2]   | `pnpm e2e:ui`     | Open Playwright UI mode  |
|   [3]   | `pnpm e2e:headed` | Run with visible browser |
|   [4]   | `pnpm e2e:report` | View HTML report         |

<br>

### [6.4][OUTPUT_DIRECTORIES]

| [INDEX] | [PATH]                     | [CONTENT]                  |
| :-----: | -------------------------- | -------------------------- |
|   [1]   | `coverage/`                | V8 coverage reports        |
|   [2]   | `test-results/`            | Vitest JSON, JUnit output  |
|   [3]   | `test-results/e2e/`        | Playwright artifacts       |
|   [4]   | `test-results/e2e-report/` | Playwright HTML report     |
|   [5]   | `test-results/mutation/`   | Stryker mutation HTML report |

---

## [7][REFERENCES]
>
>**Dictum:** *Cross-references enable deep-dive navigation.*

<br>

| [INDEX] | [DOCUMENT]                     | [SCOPE]                            |
| :-----: | ------------------------------ | ---------------------------------- |
|   [1]   | [->standards.md](standards.md) | Authoring standards, guardrails    |
|   [2]   | [->patterns.md](patterns.md)   | Density techniques, algebraic laws |
|   [3]   | [->tooling.md](tooling.md)     | External dependency catalog        |
|   [4]   | `vitest.config.ts`             | Root configuration source          |
|   [5]   | `playwright.config.ts`         | E2E configuration source           |
|   [6]   | `stryker.config.mjs`          | Mutation testing configuration     |
