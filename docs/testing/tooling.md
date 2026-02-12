# [H1][TESTING_TOOLING]
>
>**Dictum:** *Dependency catalog enables version tracking and integration awareness.*

<br>

All versions managed via `pnpm-workspace.yaml` catalog. Reference: `"pkg": "catalog:"`.

---

## [1][UNIT_TESTING]
>
>**Dictum:** *Vitest ecosystem provides unified test execution.*

<br>

| [INDEX] | [PACKAGE]                  | [INTEGRATION]                                                                     |
| :-----: | -------------------------- | --------------------------------------------------------------------------------- |
|   [1]   | vitest                     | Root config, 4 inline projects (root-tests, packages-node, runtime-browser, apps) |
|   [2]   | @vitest/browser-playwright | runtime-browser project, real Chromium                                            |
|   [3]   | @vitest/coverage-v8        | V8 provider, thresholds configured, currently disabled pending activation         |
|   [4]   | @vitest/ui                 | Dashboard: `pnpm vitest --ui`                                                     |

<br>

**Configuration:** `vitest.config.ts` exports `_CONFIG` constant (aliased as `VITEST_TUNING`).

[IMPORTANT]:

- [ALWAYS] Run via Nx: `pnpm exec nx test`.
- [NEVER] Create per-package vitest.config.ts -- use inline projects.

---

## [2][PROPERTY_BASED]
>
>**Dictum:** *Property-based testing discovers edge cases algorithmically.*

<br>

| [INDEX] | [PACKAGE]          | [INTEGRATION]                                        |
| :-----: | ------------------ | ---------------------------------------------------- |
|   [1]   | fast-check         | Arbitrary generators, shrinking, model-based commands |
|   [2]   | @fast-check/vitest | Available, unused (redundant with @effect/vitest)    |
|   [3]   | @effect/vitest     | `it.effect.prop()`, equality testers                 |

<br>

**Integration:** `@effect/vitest` provides `it.effect.prop` which integrates fast-check with Effect's runtime. `@fast-check/vitest` is redundant for Effect-based tests and not imported anywhere.

**Model-Based Testing:** `fc.commands()` + `fc.asyncModelRun()` enables stateful property testing via command sequences. Used in `transfer-model.spec.ts`. [PLANNED] `Arbitrary.make(MySchema)` from `@effect/schema` replaces hand-rolled arbitraries.

**Setup:** `tests/setup.ts` calls `addEqualityTesters()` -- enables structural equality for Effect types in Vitest assertions.

---

## [3][MUTATION_TESTING]
>
>**Dictum:** *Mutation testing detects circular and tautological tests.*

<br>
v
| [INDEX] | [PACKAGE]                              | [INTEGRATION]                          |
| :-----: | -------------------------------------- | -------------------------------------- |
|   [1]   | @stryker-mutator/core (9.5.1)          | Mutation engine, threshold enforcement |
|   [2]   | @stryker-mutator/vitest-runner (9.5.1) | Vitest integration for mutant runs     |v
|   [3]   | @stryker-mutator/typescript-checker    | Type-aware mutant filtering            |

**Configuration:** `stryker.config.mjs` -- targets `packages/server/src/**/*.ts`, thresholds high=80/low=60/break=50, reports to `test-results/mutation/`. Command: `pnpm test:mutate`. Keystone defense against AI-generated circular tests -- tautological assertions fail to kill mutants.

---

## [4][E2E_TESTING]
>
>**Dictum:** *Playwright enables cross-browser E2E automation.*

<br>

| [INDEX] | [PACKAGE]        | [INTEGRATION]                          |
| :-----: | ---------------- | -------------------------------------- |
|   [1]   | @playwright/test | E2E runner, trace capture, screenshots |
|   [2]   | @nx/playwright   | Nx plugin: task inference, Atomizer CI |

<br>

**Configuration:** `playwright.config.ts` exports frozen `B` constant with app configs.

**Nx Integration:**

- Plugin infers `e2e` target from `playwright.config.ts`
- CI target `e2e-ci` enables Atomizer for parallel test sharding
- Configured in `nx.json` plugins array

**Agent Automation:**

- `playwright-test-planner.md` -- MCP tools for UI exploration
- `playwright-test-generator.md` -- Test code generation from plans
- `playwright-test-healer.md` -- Failure debugging and remediation

[IMPORTANT] E2E tests require three apps running concurrently: API server (port 4000), icons catalog (port 3001), test harness (port 3002). Started via `pnpm exec nx run-many -t dev`.

---

## [5][ENVIRONMENT]
>
>**Dictum:** *Environment packages enable isolated testing contexts.*

<br>

| [INDEX] | [PACKAGE]              | [INTEGRATION]                                                            |
| :-----: | ---------------------- | ------------------------------------------------------------------------ |
|   [1]   | msw                    | HTTP request interception (available, unused)                            |
|   [2]   | fake-indexeddb         | IndexedDB mock for browser tests in Node environment                     |
|   [3]   | happy-dom              | Lightweight DOM for jsdom alternative                                    |
|   [4]   | @testing-library/react | Component rendering, queries                                             |
|   [5]   | vitest-browser-react   | React-specific browser matchers                                          |
|   [6]   | testcontainers         | Docker-based services for `tests/integration/` (PostgreSQL, Redis, etc.) |

<br>

**Directory Usage:**

- `tests/integration/` -- testcontainers for Docker-based service dependencies
- `tests/fixtures/` -- Test data factories, shared test utilities
- `tests/setup.ts` -- Global test configuration, equality testers

---

## [6][QUALITY_TOOLS]
>
>**Dictum:** *Static analysis and hooks prevent dead code and enforce test hygiene.*

<br>

### [6.1][DEAD_CODE_DETECTION]

| [INDEX] | [PACKAGE] | [INTEGRATION]                       |
| :-----: | --------- | ----------------------------------- |
|   [1]   | knip      | Unused files, exports, dependencies |

<br>

**Zero-Config:** Knip auto-detects:

- pnpm workspaces via `pnpm-workspace.yaml`
- Nx projects via built-in Nx plugin (activates on `nx` or `@nx/*` deps)
- Parses `nx.json`, `project.json` files automatically

**Commands:**

- `pnpm knip` -- Analyze workspace for dead code
- `pnpm knip:fix` -- Auto-remove unused exports

[IMPORTANT] Run `pnpm knip` before major refactors to identify cleanup targets.

---

### [6.2][MONOREPO_LINTING]

| [INDEX] | [PACKAGE] | [INTEGRATION]                       |
| :-----: | --------- | ----------------------------------- |
|   [1]   | sherif    | Zero-config monorepo best practices |

<br>

**Enforces:**

- Root `private: true`
- `@types/*` in devDependencies
- Consistent dependency versions
- Workspace protocol usage

**Commands:**

- `pnpm sherif` -- Validate monorepo structure
- `pnpm sherif:fix` -- Auto-fix violations

---

### [6.3][POSTTOOLUSE_HOOK]

| [INDEX] | [TOOL]                          | [INTEGRATION]                              |
| :-----: | ------------------------------- | ------------------------------------------ |
|   [1]   | `.claude/hooks/validate-spec.sh` | PostToolUse hook on Edit/Write operations |

**Validates:** LOC limit (125), anti-patterns (`any`/`let`/`var`/`for`/`while`/`try-catch`/`new Date`), expression-form assertions, import ordering. Outputs JSON `decision: "block"` with line-specific errors. Registered in `.claude/settings.json`.

---

### [6.4][NX_PLUGINS]

| [INDEX] | [PACKAGE]              | [INTEGRATION]                       |
| :-----: | ---------------------- | ----------------------------------- |
|   [1]   | @nx/playwright         | E2E task inference, Atomizer CI     |
|   [2]   | @berenddeboer/nx-biome | Biome task inference (check/format) |

<br>

**Plugin Configuration:** `nx.json` plugins array

- `@nx/playwright` infers `e2e` and `e2e-ci` targets
- `@berenddeboer/nx-biome` infers `check`, `format`, `lint` targets

[IMPORTANT] Plugins provide automatic task inference -- no manual target configuration required.

---

## [7][REFERENCES]
>
>**Dictum:** *Cross-references enable navigation.*

<br>

| [INDEX] | [DOCUMENT]                     | [SCOPE]                           |
| :-----: | ------------------------------ | --------------------------------- |
|   [1]   | [->standards.md](standards.md) | Authoring standards, guardrails   |
|   [2]   | [->patterns.md](patterns.md)   | Density techniques, code patterns |
|   [3]   | [->overview.md](overview.md)   | Architecture, topology, commands  |
