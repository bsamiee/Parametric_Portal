# [H1][TESTING_TOOLING]
>**Dictum:** *Dependency catalog enables version tracking and integration awareness.*

<br>

All versions managed via `pnpm-workspace.yaml` catalog. Reference: `"pkg": "catalog:"`.

---
## [1][UNIT_TESTING]
>**Dictum:** *Vitest ecosystem provides unified test execution.*

<br>

| [INDEX] | [PACKAGE]                  | [VERSION] | [INTEGRATION]                          |
| :-----: | -------------------------- | --------- | -------------------------------------- |
|   [1]   | vitest                     | 4.0.16    | Root config, inline projects           |
|   [2]   | @vitest/browser-playwright | 4.0.16    | runtime-browser project, real Chromium |
|   [3]   | @vitest/coverage-v8        | 4.0.16    | Coverage provider, 80% thresholds      |
|   [4]   | @vitest/ui                 | 4.0.16    | Dashboard: `pnpm vitest --ui`          |

<br>

**Configuration:** `vitest.config.ts` exports frozen `B` constant with tuning parameters.

[IMPORTANT]:
- [ALWAYS] Run via Nx: `pnpm exec nx test`.
- [NEVER] Create per-package vitest.config.ts—use inline projects.

---
## [2][PROPERTY_BASED]
>**Dictum:** *Property-based testing discovers edge cases algorithmically.*

<br>

| [INDEX] | [PACKAGE]          | [VERSION] | [INTEGRATION]                            |
| :-----: | ------------------ | --------- | ---------------------------------------- |
|   [1]   | fast-check         | 4.5.2     | Arbitrary generators, shrinking          |
|   [2]   | @fast-check/vitest | 0.2.4     | `it.prop()` syntax, Vitest integration   |
|   [3]   | @effect/vitest     | 0.27.0    | Effect equality testers, custom matchers |

<br>

**Integration Points:**
- `FC_ARB` namespace exports domain arbitraries (`test-utils/arbitraries.ts`)
- `TEST_CONSTANTS.fc` configures global runs (50 local, 100 CI)
- Effect matchers registered via `test-utils/matchers/effect.ts`

---
## [3][E2E_TESTING]
>**Dictum:** *Playwright enables cross-browser E2E automation.*

<br>

| [INDEX] | [PACKAGE]            | [VERSION] | [INTEGRATION]                             |
| :-----: | -------------------- | --------- | ----------------------------------------- |
|   [1]   | @playwright/test     | 1.57.0    | E2E runner, trace capture, screenshots    |
|   [2]   | @axe-core/playwright | 4.10.0    | Accessibility assertions, WCAG compliance |
|   [3]   | @nx/playwright       | 22.3.3    | Nx plugin: task inference, Atomizer CI    |

<br>

**Configuration:** `playwright.config.ts` exports frozen `B` constant with app configs.

**Nx Integration:**
- Plugin infers `e2e` target from `playwright.config.ts`
- CI target `e2e-ci` enables Atomizer for parallel test sharding
- Configured in `nx.json` plugins array

**Agent Automation:**
- `playwright-test-planner.md` — MCP tools for UI exploration
- `playwright-test-generator.md` — Test code generation from plans
- `playwright-test-healer.md` — Failure debugging and remediation

[IMPORTANT] Dual-app bootstrap: API (4000) + Icons (3001) started via Nx dev.

---
## [4][MUTATION]
>**Dictum:** *Mutation testing validates test quality via fault injection.*

<br>

| [INDEX] | [PACKAGE]                      | [VERSION] | [INTEGRATION]                             |
| :-----: | ------------------------------ | --------- | ----------------------------------------- |
|   [1]   | @stryker-mutator/core          | 9.4.0     | Mutation runner, incremental caching      |
|   [2]   | @stryker-mutator/vitest-runner | 9.4.0     | Vitest integration, root config reference |

<br>

**Configuration:** `stryker.config.js`
- Thresholds: break=80, high=90, low=70
- Incremental file: `.nx/cache/stryker-incremental.json`
- Reports: `reports/stryker/mutation-report.{html,json}`

[CRITICAL] Mutation score below 80% fails CI build.

---
## [5][MOCKING]
>**Dictum:** *Mock utilities enable isolated unit testing.*

<br>

| [INDEX] | [PACKAGE]      | [VERSION] | [INTEGRATION]                             |
| :-----: | -------------- | --------- | ----------------------------------------- |
|   [1]   | msw            | 2.12.4    | Request interception, `MswServer` factory |
|   [2]   | fake-indexeddb | 6.2.5     | IndexedDB mock for Node environment       |
|   [3]   | happy-dom      | 20.0.11   | Lightweight DOM for jsdom alternative     |

<br>

**Factories:**
- `MswServer` — Singleton MSW server API (`test-utils/mocks/msw.ts`)
- `MswMock` — Type-safe request handler factory (get, post, put, patch, delete)
- `FetchMock` — vi.fn-based fetch mock (`test-utils/mocks/fetch.ts`)

**Setup:** `test-utils/setup.ts` imports fake-indexeddb in Node, clears storage.

---
## [6][VISUAL_REGRESSION]
>**Dictum:** *Visual and accessibility testing validates UI correctness.*

<br>

| [INDEX] | [PACKAGE]            | [VERSION] | [INTEGRATION]                         |
| :-----: | -------------------- | --------- | ------------------------------------- |
|   [1]   | lost-pixel           | 3.27.0    | Visual regression screenshots         |
|   [2]   | vitest-axe           | 0.1.0     | Axe accessibility matchers for Vitest |
|   [3]   | snapshot-diff        | 0.10.0    | Enhanced snapshot diffing             |
|   [4]   | vitest-browser-react | 2.0.2     | React-specific browser matchers       |

<br>

**React Testing:**

| [INDEX] | [PACKAGE]              | [VERSION] | [INTEGRATION]                |
| :-----: | ---------------------- | --------- | ---------------------------- |
|   [1]   | @testing-library/react | 16.3.1    | Component rendering, queries |

---
## [7][UTILITY]
>**Dictum:** *Supporting packages enable test infrastructure.*

<br>

| [INDEX] | [PACKAGE] | [VERSION] | [INTEGRATION]                             |
| :-----: | --------- | --------- | ----------------------------------------- |
|   [1]   | supertest | 7.1.0     | HTTP assertion library for API tests      |
|   [2]   | effect    | 3.19.13   | Monadic composition, Effect/Option/Either |

---
## [8][CATALOG_REFERENCE]
>**Dictum:** *Centralized versions prevent drift.*

<br>

All test dependencies in `pnpm-workspace.yaml`:

```yaml
catalog:
  '@effect/vitest': 0.27.0
  '@fast-check/vitest': 0.2.4
  '@playwright/test': 1.57.0
  '@stryker-mutator/core': 9.4.0
  '@stryker-mutator/vitest-runner': 9.4.0
  '@testing-library/react': 16.3.1
  '@vitest/browser-playwright': 4.0.16
  '@vitest/coverage-v8': 4.0.16
  '@vitest/ui': 4.0.16
  '@axe-core/playwright': 4.10.0
  fake-indexeddb: 6.2.5
  fast-check: 4.5.1
  happy-dom: 20.0.11
  lost-pixel: 3.27.0
  msw: 2.8.0
  snapshot-diff: 0.10.0
  supertest: 7.1.0
  vitest: 4.0.16
  vitest-axe: 0.1.0
  vitest-browser-react: 2.0.2
```

[IMPORTANT]:
- [ALWAYS] Add new test dependencies to catalog first.
- [ALWAYS] Reference via `"pkg": "catalog:"` in package.json.
- [NEVER] Pin versions directly in package.json.

---
## [9][QUALITY_TOOLS]
>**Dictum:** *Static analysis prevents dead code and enforces monorepo hygiene.*

<br>

### [9.1][DEAD_CODE_DETECTION]

| [INDEX] | [PACKAGE] | [VERSION] | [INTEGRATION]                       |
| :-----: | --------- | --------- | ----------------------------------- |
|   [1]   | knip      | latest    | Unused files, exports, dependencies |

<br>

**Zero-Config:** Knip auto-detects:
- pnpm workspaces via `pnpm-workspace.yaml`
- Nx projects via built-in Nx plugin (activates on `nx` or `@nx/*` deps)
- Parses `nx.json`, `project.json` files automatically

**Commands:**
- `pnpm knip` — Analyze workspace for dead code
- `pnpm knip:fix` — Auto-remove unused exports

[IMPORTANT] Run `pnpm knip` before major refactors to identify cleanup targets.

---
### [9.2][MONOREPO_LINTING]

| [INDEX] | [PACKAGE] | [VERSION] | [INTEGRATION]                       |
| :-----: | --------- | --------- | ----------------------------------- |
|   [1]   | sherif    | latest    | Zero-config monorepo best practices |

<br>

**Enforces:**
- Root `private: true`
- `@types/*` in devDependencies
- Consistent dependency versions
- Workspace protocol usage

**Commands:**
- `pnpm sherif` — Validate monorepo structure
- `pnpm sherif:fix` — Auto-fix violations

---
### [9.3][NX_PLUGINS]

| [INDEX] | [PACKAGE]              | [VERSION] | [INTEGRATION]                       |
| :-----: | ---------------------- | --------- | ----------------------------------- |
|   [1]   | @nx/playwright         | 22.3.3    | E2E task inference, Atomizer CI     |
|   [2]   | @berenddeboer/nx-biome | latest    | Biome task inference (check/format) |

<br>

**Plugin Configuration:** `nx.json` plugins array
- `@nx/playwright` infers `e2e` and `e2e-ci` targets
- `@berenddeboer/nx-biome` infers `check`, `format`, `lint` targets

**Replaces Manual Targets:**
- Removed: manual `e2e`, `check`, `lint`, `fix` targetDefaults
- Added: Plugin inference with proper caching

[IMPORTANT] Plugins provide automatic task inference—no manual target configuration required.
