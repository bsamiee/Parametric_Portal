# [H1][TEST_CATEGORIES]
>**Dictum:** *Category routing selects environment, tooling, and patterns per module.*

<br>

[IMPORTANT] Walk routing matrix per module. Most `packages/server/` modules route to Unit PBT. Boundary modules (database, HTTP, Redis) route to Integration. Cross-service orchestration routes to System. User-facing flows route to E2E.

---
## [1][ROUTING_MATRIX]
>**Dictum:** *Single lookup determines category assignment.*

<br>

| [INDEX] | **Category** | [LOCATION]              | [ENV]    | [KEY_TOOLS]                  | [ROUTE_WHEN]                      |
| :-----: | ------------ | ----------------------- | -------- | ---------------------------- | --------------------------------- |
|   [1]   | Unit (PBT)   | `tests/packages/{pkg}/` | node     | @effect/vitest, fast-check   | Pure functions, domain logic.     |
|   [2]   | Integration  | `tests/integration/`    | node     | testcontainers, MSW          | Database, Redis, HTTP boundaries. |
|   [3]   | System       | `tests/system/`         | node     | Full Layer stack, mock edges | Cross-service orchestration.      |
|   [4]   | E2E          | `tests/e2e/`            | chromium | Playwright, agent pipeline   | User-facing flows, visual checks. |

---
## [2][UNIT_PBT]
>**Dictum:** *Unit tests prove algebraic properties of pure domain logic.*

<br>

**Environment:** node (root-tests or packages-node Vitest project).<br>
**Tools:** `@effect/vitest` (`it.effect`, `it.effect.prop`, `layer`), fast-check arbitraries, `node:crypto` (differential oracle).

**Setup:** `tests/setup.ts` registers `addEqualityTesters()` -- structural equality for Effect types in `expect().toEqual()`. No custom matchers -- standard `expect()` via `it.effect()`.

**Layer Scoping:** Compose test layer via `Module.Service.Default.pipe(Layer.provide(...))`. Wrap suite in `layer(_testLayer)('Suite', (it) => { ... })` for automatic service resolution.

**Patterns:**

| [INDEX] | **Pattern**                | [MECHANISM]                                                    |
| :-----: | -------------------------- | -------------------------------------------------------------- |
|   [1]   | Algebraic laws             | Identity, inverse, idempotent, composition, symmetry.          |
|   [2]   | Property packing           | 2-4 laws sharing arbitrary shape in single `it.effect.prop`.   |
|   [3]   | Schema-derived arbitraries | `Arbitrary.make(Schema)` synced with domain types.             |
|   [4]   | Differential testing       | Cross-validate against `node:crypto`, `rfc6902`.               |
|   [5]   | Known-answer vectors       | NIST FIPS 180-4, RFC 4231, RFC 6902 as `as const`.             |
|   [6]   | Statistical properties     | Chi-squared uniformity, batch sampling via `fc.sample`.        |
|   [7]   | Model-based commands       | `fc.commands()` + `fc.asyncModelRun()` for stateful sequences. |
|   [8]   | Metamorphic relations      | Composition law: `f(f(a,b), c) = f(a, f(b,c))`.                |
|   [9]   | Fault injection            | Effect layer wrapping for Nth-call failure, TestClock.         |

**Routing Decision:** Any `packages/server/src/` module exporting pure functions, Effect service methods, schema validation, or error discrimination.

[REFERENCE] Law selection: [→laws.md](./laws.md) — Density techniques: [→density.md](./density.md).

---
## [3][INTEGRATION]
>**Dictum:** *Integration tests verify boundary contracts against real infrastructure.*

<br>

**Environment:** node (root-tests Vitest project).<br>
**Tools:** testcontainers (`GenericContainer`, `Wait`), MSW (`http.get`, `http.post` handlers).

**Container Lifecycle:** Start in `beforeAll` (60s timeout for pull/start). Stop in `afterAll`. Compose real service layer with container-provided connection via `Layer.provide(ConnectionPool.layer({ host, port }))`.

**Vitest Pool:** Prefer `forks` for database tests -- process-level isolation prevents connection pool interference.

**Patterns:**

| [INDEX] | **Pattern**             | [MECHANISM]                                               |
| :-----: | ----------------------- | --------------------------------------------------------- |
|   [1]   | Roundtrip PBT           | Insert, query, compare against real DB.                   |
|   [2]   | HTTP boundary mocking   | MSW handlers intercept outgoing HTTP; verify payloads.    |
|   [3]   | Error path verification | Connection failures, timeouts, constraint violations.     |
|   [4]   | Transaction isolation   | Concurrent writes produce consistent reads.               |
|   [5]   | Schema migration        | Migrate up, verify structure, migrate down, verify clean. |

**Routing Decision:** Modules communicating with PostgreSQL, Redis, or external HTTP services. Verify SQL queries, cache operations, HTTP client behavior.

---
## [4][SYSTEM]
>**Dictum:** *System tests verify cross-service orchestration via Layer composition.*

<br>

**Environment:** node.<br>
**Tools:** Full service stack composed via Effect Layer. Services mock at edges -- no containers.

**Layer Composition:** Merge service layers via `Layer.provideMerge(ServiceA.Default, ServiceB.Default)`. Inject test config via `ConfigProvider.fromMap`. Suppress logs via `Logger.minimumLogLevel(LogLevel.Warning)`.

**Patterns:**

| [INDEX] | **Pattern**               | [MECHANISM]                                          |
| :-----: | ------------------------- | ---------------------------------------------------- |
|   [1]   | Boundary contract         | ServiceA calls ServiceB; verify contract holds.      |
|   [2]   | Error propagation         | Error from ServiceB surfaces correctly in ServiceA.  |
|   [3]   | Multi-step pipelines      | End-to-end Effect workflows across services.         |
|   [4]   | Configuration interaction | Config changes affect cross-service behavior.        |
|   [5]   | Schema contract           | Service input/output schemas validate at boundaries. |

**Routing Decision:** Cross-service interactions. Error propagation chains. API route handlers orchestrating multiple services.

---
## [5][E2E]
>**Dictum:** *E2E tests verify user flows through full application stack.*

<br>

**Environment:** chromium (Playwright).<br>
**Agent Pipeline:** planner (UI exploration) -> generator (spec creation) -> healer (failure remediation). Agents handle E2E spec generation -- do not manually author.

**Triple-App Bootstrap:** api (:4000, `/api/health/liveness`), parametric_icons (:3001), test_harness (:3002).

**Artifacts:** Screenshots (only-on-failure), Videos (retain-on-failure), Traces (retain-on-failure).

**Standards:**

| [INDEX] | **Standard**       | [RULE]                                                     |
| :-----: | ------------------ | ---------------------------------------------------------- |
|   [1]   | Spec scope         | One spec per user flow (login, navigation, CRUD).          |
|   [2]   | Selectors          | `data-testid` attributes only; avoid class names.          |
|   [3]   | Network            | Wait for network idle before data-dependent assertions.    |
|   [4]   | Constants          | Frozen `B` object with routes, selectors, expected values. |
|   [5]   | Failure simulation | `page.route()` for latency injection, response mocking.    |

**Routing Decision:** User-facing flows. Visual verification. Cross-app navigation. Authentication flows. Invoke Playwright agent pipeline.

---
## [6][CROSS_CUTTING]
>**Dictum:** *Cross-cutting techniques apply across categories, not within one.*

<br>

| [INDEX] | **Technique**       | [SCOPE]                | [MECHANISM]                                        |
| :-----: | ------------------- | ---------------------- | -------------------------------------------------- |
|   [1]   | Mutation testing    | All unit + integration | Stryker injects mutants; kill-ratio enforcement.   |
|   [2]   | Security properties | Unit PBT + integration | Proto pollution, tenant isolation, path traversal. |
|   [3]   | TestClock patterns  | Unit + system          | Deterministic time via `TestClock.adjust`.         |
|   [4]   | Schema-derived arbs | Unit PBT + integration | `Arbitrary.make(Schema)` from domain schemas.      |

[REFERENCE] Mutation defense: [→guardrails.md](./guardrails.md) — Validation: [→validation.md](./validation.md).
