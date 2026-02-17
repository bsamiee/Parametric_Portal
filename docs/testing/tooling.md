# [H1][TESTING_TOOLING]
>
>**Dictum:** *External tool catalog governs dependency awareness and version tracking.*

All versions managed via `pnpm-workspace.yaml` catalog. Reference: `"pkg": "catalog:"`.

---
## [1][VITEST]
>**Dictum:** *Vitest ecosystem provides unified test execution across environments.*

| [INDEX] | [PACKAGE]                  | [INTEGRATION]                                      |
| :-----: | -------------------------- | -------------------------------------------------- |
|   [1]   | vitest                     | Root config with 4 inline projects, `_CONFIG` knob |
|   [2]   | @vitest/browser-playwright | Real Chromium for runtime-browser project          |
|   [3]   | @vitest/coverage-v8        | V8 provider, per-file thresholds (95% target)      |
|   [4]   | @vitest/ui                 | Dashboard: `pnpm vitest --ui`                      |

| [INDEX] | [PROJECT]       | [ENVIRONMENT] | [PATTERN]                             |
| :-----: | --------------- | ------------- | ------------------------------------- |
|   [1]   | root-tests      | node          | `tests/**/*.spec.ts`                  |
|   [2]   | packages-node   | node          | `packages/*/tests/**/*.spec.ts`       |
|   [3]   | runtime-browser | chromium      | `packages/runtime/tests/**/*.spec.ts` |
|   [4]   | apps            | jsdom         | `apps/*/tests/**/*.spec.ts`           |

[IMPORTANT]:
- [ALWAYS] Run via Nx: `pnpm exec nx test`. [NEVER] create per-package vitest configs.
- **Test tags:** `pbt`, `security`, `chaos`, `statistical`, `differential`, `vectors`, `model-based`.

---
## [2][PROPERTY_TESTING]
>**Dictum:** *Property-based testing discovers edge cases algorithmically.*

| [INDEX] | [PACKAGE]      | [INTEGRATION]                                         |
| :-----: | -------------- | ----------------------------------------------------- |
|   [1]   | fast-check     | Arbitrary generators, shrinking, model-based commands |
|   [2]   | @effect/vitest | `it.effect.prop()`, Effect runtime integration        |

**Integration:** `@effect/vitest` provides `it.effect.prop` bridging fast-check arbitraries with Effect's runtime. No additional adapter packages needed.

**Model-Based:** `fc.commands()` + `fc.asyncModelRun()` for stateful property testing via command sequences. [PLANNED] `Arbitrary.make(MySchema)` replaces hand-rolled arbitraries.

**Setup:** `tests/setup.ts` calls `addEqualityTesters()` -- structural equality for Effect types in Vitest assertions.

---
## [3][MUTATION_TESTING]
>**Dictum:** *Mutation testing detects circular and tautological tests.*

| [INDEX] | [PACKAGE]                           | [INTEGRATION]                          |
| :-----: | ----------------------------------- | -------------------------------------- |
|   [1]   | @stryker-mutator/core               | Mutation engine, threshold enforcement |
|   [2]   | @stryker-mutator/vitest-runner      | Vitest integration for mutant runs     |
|   [3]   | @stryker-mutator/typescript-checker | Type-aware mutant filtering            |

**Config** (`stryker.config.mjs`): incremental mode enabled, ignoreStatic=true, excluded mutators: `UpdateOperator`/`OptionalChaining`, timeoutFactor=2.0, JSON reporter to `test-results/mutation/`.

**Thresholds:** high=80, low=60, break=50. Cross-ref: [->philosophy.md](philosophy.md).

---
## [4][E2E]
>**Dictum:** *Triple-app bootstrap enables full-stack E2E validation.*

| [INDEX] | [PACKAGE]        | [INTEGRATION]                          |
| :-----: | ---------------- | -------------------------------------- |
|   [1]   | @playwright/test | E2E runner, trace capture, screenshots |
|   [2]   | @nx/playwright   | Nx task inference, Atomizer CI         |

| [INDEX] | [APP]            | [PORT] | [HEALTH_ENDPOINT]      |
| :-----: | ---------------- | :----: | ---------------------- |
|   [1]   | api              |  4000  | `/api/health/liveness` |
|   [2]   | parametric_icons |  3001  | `/` (document load)    |
|   [3]   | test_harness     |  3002  | `/` (document load)    |

| [INDEX] | [ARTIFACT]  | [STRATEGY]        |
| :-----: | ----------- | ----------------- |
|   [1]   | Screenshots | only-on-failure   |
|   [2]   | Videos      | retain-on-failure |
|   [3]   | Traces      | retain-on-failure |

**Agent Automation:** planner (UI exploration) -> generator (spec creation) -> healer (failure remediation). Invoked via Claude Code skills; outputs to `tests/e2e/**/*.spec.ts`.

---
## [5][ENVIRONMENT]
>**Dictum:** *Environment packages enable isolated testing contexts.*

| [INDEX] | [PACKAGE]              | [INTEGRATION]                                             |
| :-----: | ---------------------- | --------------------------------------------------------- |
|   [1]   | msw                    | HTTP request interception, network mocks                  |
|   [2]   | fake-indexeddb         | IndexedDB mock for browser tests in Node                  |
|   [3]   | happy-dom              | Lightweight DOM (jsdom alternative)                       |
|   [4]   | @testing-library/react | Component rendering, queries                              |
|   [5]   | vitest-browser-react   | React-specific browser matchers                           |
|   [6]   | testcontainers         | Docker-based services (PostgreSQL, Redis) for integration |

**Directories:** `tests/integration/` (testcontainers), `tests/fixtures/` (data factories), `tests/setup.ts` (equality testers).

---
## [6][QUALITY_TOOLS]
>**Dictum:** *Static analysis tools enforce structural hygiene.*

### [6.1][KNIP]
Dead-code detection: unused files, exports, dependencies. Auto-detects pnpm workspaces and Nx projects.
- `pnpm knip` -- analyze workspace. `pnpm knip:fix` -- auto-remove unused exports.

### [6.2][SHERIF]
Zero-config monorepo linting: root `private: true`, `@types/*` in devDeps, consistent versions, workspace protocol.
- `pnpm sherif` -- validate. `pnpm sherif:fix` -- auto-fix.

### [6.3][NX_PLUGINS]

| [INDEX] | [PLUGIN]               | [INFERRED_TARGETS]         |
| :-----: | ---------------------- | -------------------------- |
|   [1]   | @nx/playwright         | `e2e`, `e2e-ci` (Atomizer) |
|   [2]   | @berenddeboer/nx-biome | `check`, `format`, `lint`  |

Configured in `nx.json` plugins array. No manual target configuration required.

---
## [7][COMMANDS]
>**Dictum:** *Consolidated command reference accelerates execution.*

| [INDEX] | [COMMAND]                       | [PURPOSE]                             |
| :-----: | ------------------------------- | ------------------------------------- |
|   [1]   | `pnpm exec nx test`             | Run all unit tests                    |
|   [2]   | `pnpm exec nx test @scope/pkg`  | Package-specific tests                |
|   [3]   | `pnpm exec nx run-many -t test` | Parallel test across projects         |
|   [4]   | `pnpm vitest --ui`              | Open Vitest UI dashboard              |
|   [5]   | `pnpm vitest --coverage`        | Generate coverage report              |
|   [6]   | `pnpm test:mutate`              | Run Stryker mutation testing          |
|   [7]   | `pnpm e2e`                      | Run E2E tests (`-- --ui` for UI mode) |
|   [8]   | `pnpm e2e:report`               | View Playwright HTML report           |

| [INDEX] | [PATH]                     | [CONTENT]                         |
| :-----: | -------------------------- | --------------------------------- |
|   [1]   | `coverage/`                | V8 coverage reports               |
|   [2]   | `test-results/`            | Vitest JSON, JUnit output         |
|   [3]   | `test-results/e2e/`        | Playwright artifacts              |
|   [4]   | `test-results/e2e-report/` | Playwright HTML report            |
|   [5]   | `test-results/mutation/`   | Stryker mutation HTML/JSON report |
