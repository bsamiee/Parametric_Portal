# [H1][TESTING_OVERVIEW]
>**Dictum:** *Single-page reference accelerates test infrastructure orientation.*

<br>

Property-based unit testing via Vitest, E2E automation via Playwright, mutation testing via Stryker.

---
## [1][STACK]
>**Dictum:** *Version pinning ensures reproducible test runs.*

<br>

| [INDEX] | [LAYER]        | [TOOL]                     | [VERSION] | [RATIONALE]                            |
| :-----: | -------------- | -------------------------- | --------- | -------------------------------------- |
|   [1]   | Unit Testing   | Vitest                     | 4.0.16    | Vite-native, inline projects, V8 cov   |
|   [2]   | Browser        | @vitest/browser-playwright | 4.0.16    | Real browser isolation for runtime pkg |
|   [3]   | E2E            | @playwright/test           | 1.57.0    | Chromium automation, trace capture     |
|   [4]   | Mutation       | @stryker-mutator/core      | 9.4.0     | Mutation score enforcement (80%)       |
|   [5]   | Property-Based | fast-check                 | 4.5.1     | Arbitrary generators, shrinking        |
|   [6]   | Effect Testing | @effect/vitest             | 0.27.0    | Effect matchers, equality testers      |
|   [7]   | Mocking        | msw                        | 2.8.0     | Request interception, network mocks    |
|   [8]   | Accessibility  | @axe-core/playwright       | 4.10.0    | WCAG validation in E2E                 |

<br>

### [1.1][COVERAGE_THRESHOLDS]

| [INDEX] | [METRIC]   | [THRESHOLD] |
| :-----: | ---------- | :---------: |
|   [1]   | Lines      |     80%     |
|   [2]   | Branches   |     80%     |
|   [3]   | Functions  |     80%     |
|   [4]   | Statements |     80%     |
|   [5]   | Mutation   |     80%     |

---
## [2][TOPOLOGY]
>**Dictum:** *Directory structure encodes test organization.*

<br>

```
/
├── vitest.config.ts              # Root config with inline projects
├── playwright.config.ts          # E2E config with dual-app bootstrap
├── stryker.config.js             # Mutation testing thresholds
├── packages/
│   ├── test-utils/               # Shared test infrastructure
│   │   └── src/
│   │       ├── setup.ts          # Global hooks, fake timers
│   │       ├── arbitraries.ts    # FC_ARB generators
│   │       ├── constants.ts      # TEST_CONSTANTS (frozen time)
│   │       ├── harness.ts        # TEST_HARNESS utilities
│   │       ├── matchers/
│   │       │   └── effect.ts     # toBeSuccess, toBeRight, toBeSome
│   │       └── mocks/
│   │           ├── fetch.ts      # FetchMock factory
│   │           └── msw.ts        # MswServer, MswMock
│   └── */tests/                  # Per-package unit tests
│       └── *.spec.ts
├── apps/*/tests/                 # Per-app component tests
│   └── *.spec.ts
└── tests/
    └── e2e/                      # E2E tests
        ├── seed.spec.ts          # Bootstrap validation
        └── apps/                 # Per-app E2E suites
            ├── api/
            └── parametric_icons/
```

[IMPORTANT] Root `vitest.config.ts` defines inline projects—child packages require no config files.

---
## [3][PROJECTS]
>**Dictum:** *Inline projects isolate environments without config duplication.*

<br>

| [INDEX] | [PROJECT]       | [ENVIRONMENT] | [PATTERN]                             | [PURPOSE]                    |
| :-----: | --------------- | ------------- | ------------------------------------- | ---------------------------- |
|   [1]   | packages-node   | node          | `packages/*/tests/**/*.spec.ts`       | Pure logic, Effect pipelines |
|   [2]   | runtime-browser | chromium      | `packages/runtime/tests/**/*.spec.ts` | Browser APIs, storage        |
|   [3]   | apps            | jsdom         | `apps/*/tests/**/*.spec.ts`           | React components, hooks      |

<br>

**Browser Project Features:**
- Viewport: 1280x720
- Trace retention on failure
- Permissions: clipboard-read, clipboard-write
- Fake timers with frozen time (2025-01-15T12:00:00Z)

---
## [4][PLAYWRIGHT]
>**Dictum:** *Dual-app bootstrap enables full-stack E2E validation.*

<br>

### [4.1][WEB_SERVERS]

| [INDEX] | [APP]            | [PORT] | [HEALTH_ENDPOINT]      |
| :-----: | ---------------- | :----: | ---------------------- |
|   [1]   | api              |  4000  | `/api/health/liveness` |
|   [2]   | parametric_icons |  3001  | `/` (document load)    |

<br>

### [4.2][ARTIFACT_RETENTION]

| [INDEX] | [ARTIFACT]  | [STRATEGY]        |
| :-----: | ----------- | ----------------- |
|   [1]   | Screenshots | only-on-failure   |
|   [2]   | Videos      | retain-on-failure |
|   [3]   | Traces      | retain-on-failure |

<br>

### [4.3][AGENT_AUTOMATION]

E2E tests leverage Claude agents for automated test lifecycle:

| [INDEX] | [AGENT]                   | [ROLE]                                    |
| :-----: | ------------------------- | ----------------------------------------- |
|   [1]   | playwright-test-planner   | Design test scenarios from UI exploration |
|   [2]   | playwright-test-generator | Generate tests from plans                 |
|   [3]   | playwright-test-healer    | Debug and fix failing tests               |

**Workflow:** Planner outputs to `docs/specs/` → Generator creates `tests/e2e/**/*.spec.ts` → Healer remediates failures.

---
## [5][QUICK_REFERENCE]
>**Dictum:** *Command reference accelerates test execution.*

<br>

### [5.1][NX_COMMANDS]

| [INDEX] | [COMMAND]                       | [PURPOSE]                          |
| :-----: | ------------------------------- | ---------------------------------- |
|   [1]   | `pnpm exec nx test`             | Run all unit tests                 |
|   [2]   | `pnpm exec nx test @scope/pkg`  | Run package-specific tests         |
|   [3]   | `pnpm exec nx e2e`              | Run E2E tests (starts web servers) |
|   [4]   | `pnpm exec nx mutate`           | Run mutation testing               |
|   [5]   | `pnpm exec nx run-many -t test` | Parallel test across affected      |

<br>

### [5.2][VITEST_COMMANDS]

| [INDEX] | [COMMAND]                    | [PURPOSE]                 |
| :-----: | ---------------------------- | ------------------------- |
|   [1]   | `pnpm vitest --ui`           | Open Vitest UI dashboard  |
|   [2]   | `pnpm vitest --coverage`     | Generate coverage report  |
|   [3]   | `pnpm vitest --project=apps` | Run specific project only |

<br>

### [5.3][PLAYWRIGHT_COMMANDS]

| [INDEX] | [COMMAND]         | [PURPOSE]                |
| :-----: | ----------------- | ------------------------ |
|   [1]   | `pnpm e2e`        | Run E2E tests            |
|   [2]   | `pnpm e2e:ui`     | Open Playwright UI mode  |
|   [3]   | `pnpm e2e:headed` | Run with visible browser |
|   [4]   | `pnpm e2e:report` | View HTML report         |

<br>

### [5.4][OUTPUT_DIRECTORIES]

| [INDEX] | [PATH]                     | [CONTENT]                 |
| :-----: | -------------------------- | ------------------------- |
|   [1]   | `coverage/`                | V8 coverage reports       |
|   [2]   | `test-results/`            | Vitest JSON, JUnit output |
|   [3]   | `test-results/e2e/`        | Playwright artifacts      |
|   [4]   | `test-results/e2e-report/` | Playwright HTML report    |
|   [5]   | `reports/stryker/`         | Mutation testing reports  |

---
## [6][REFERENCES]
>**Dictum:** *Cross-references enable deep-dive navigation.*

<br>

| [INDEX] | [DOCUMENT]                  | [SCOPE]                        |
| :-----: | --------------------------- | ------------------------------ |
|   [1]   | [→patterns.md](patterns.md) | Test code patterns, B constant |
|   [2]   | [→tooling.md](tooling.md)   | External dependency catalog    |
|   [3]   | `vitest.config.ts`          | Root configuration source      |
|   [4]   | `playwright.config.ts`      | E2E configuration source       |
|   [5]   | `packages/test-utils/`      | Shared infrastructure source   |
