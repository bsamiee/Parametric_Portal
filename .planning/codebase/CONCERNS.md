# Codebase Concerns

**Analysis Date:** 2026-02-22

---

## Tech Debt

**Module Size Cap Violations (225 LOC max per CLAUDE.md):**
- Issue: 35+ source files exceed the 225-line cap established in project memory; several are massively over limit
- Files:
  - `apps/test-harness/vite.config.ts` — 1864 lines (829% over cap)
  - `apps/test-harness/src/app.tsx` — 1253 lines (557% over cap)
  - `packages/components/src/schema.ts` — 927 lines (412% over cap)
  - `packages/server/src/api.ts` — 825 lines (367% over cap)
  - `packages/components/src/selection.ts` — 784 lines (348% over cap)
  - `packages/server/src/infra/jobs.ts` — 586 lines (260% over cap)
  - `packages/server/src/domain/auth.ts` — 499 lines (222% over cap)
  - `packages/server/src/infra/cluster.ts` — 474 lines (211% over cap)
  - `packages/components-next/src/pickers/date-picker.tsx` — 431 lines
  - `packages/components/src/command.ts` — 406 lines
  - `packages/server/src/env.ts` — 382 lines
  - `packages/server/src/platform/websocket.ts` — 362 lines
  - `packages/server/src/platform/cache.ts` — 360 lines
- Impact: Increases cognitive load, complicates diff review, risks introducing cross-concern coupling
- Fix approach: Split by domain boundary; `api.ts` → per-group files; `auth.ts` → oauth/mfa/webauthn sub-modules; `jobs.ts` → entity-dispatch/dlq-watcher sub-modules; `schema.ts` → schema-core + tooltip + builder

**`any` Types in Zustand Store Factory:**
- Issue: 8 `any` suppressions in `packages/runtime/src/stores/factory.ts` required by Zustand/zundo middleware typing limitations
- Files: `packages/runtime/src/stores/factory.ts` lines 18, 20, 60, 70, 150, 185-186, 191-194, 223
- Impact: Type escapes from the middleware chain — `buildMiddlewareChain` return is `any`, allowing silent misuse at call sites
- Fix approach: Create generic wrappers or use `unknown` with type guards at the chain exit point; upstream library typing improvement would eliminate root cause

**`ctx` Abbreviation Not Fully Migrated:**
- Issue: CLAUDE.md memory explicitly flags `ctx` as incomplete migration in `policy.ts` and `telemetry.ts`; both still use `ctx` as a local binding for `Context.Request.current`
- Files:
  - `packages/server/src/security/policy.ts` line 72: `const ctx = yield* Context.Request.current`
  - `packages/server/src/observe/telemetry.ts` line 60: destructuring `{ ctx, fiberId }`
- Impact: Naming inconsistency; new developers will follow this pattern and perpetuate it
- Fix approach: Rename to `requestContext` per CLAUDE.md convention

**`switch` Statements Instead of `Match.type`:**
- Issue: Two `switch` statements remain where `Match.type` is the required pattern per CLAUDE.md
- Files:
  - `packages/types/src/files.ts` line 164: codec `_tag` dispatch — 5-branch switch
  - `packages/components-next/src/inputs/field.tsx` line 298: `props.type` dispatch — 3-branch switch
- Impact: Not exhaustively typed through the Effect Match system; pattern inconsistency
- Fix approach: Replace with `Match.type(codec).pipe(Match.tag('delimited', ...), ...)` pattern

**Unsafe Array Access via `A.unsafeGet`:**
- Issue: `A.unsafeGet(rows, 0)` used in `_scalar` without bounds check; throws at runtime if SQL returns no rows
- Files: `packages/database/src/factory.ts` line 126
- Impact: Unhandled runtime panic from DB queries that return zero rows (e.g., on empty aggregates); bypasses Effect error channel
- Fix approach: Use `A.head(rows)` then `Option.match` or `Effect.filterOrFail(Cause.NoSuchElementException)`

**`Effect.runSync` in Vite Plugin Hot Path:**
- Issue: `Effect.runSync` called inside `regenerate()` in the theme Vite plugin, which runs on every HMR change
- Files: `packages/theme/src/plugin.ts` lines 47-60
- Impact: If theme generation effect ever introduces async (e.g., file I/O), `runSync` will throw a `FiberFailure` at build time with no recovery path
- Fix approach: Accept the constraint explicitly with a comment, or restructure `generate` to return a synchronous computation and enforce it at the type level

**`Option.getOrThrowWith` in React Context Access:**
- Issue: Two uses of `Option.getOrThrowWith` to assert presence of React Providers at render time
- Files:
  - `packages/runtime/src/runtime.ts` line 86: `Runtime.use` context assertion
  - `packages/devtools/src/react.ts` line 177: `Devtools.react.use` context assertion
- Impact: Throws uncaught JS errors when components are used outside their provider, crashing the React tree without `ErrorBoundary`
- Fix approach: Pattern is intentional (similar to React's own `useContext` guards), but document it explicitly; callers should wrap with `ErrorBoundary`

---

## Security Considerations

**Access Token in Response Body (Acknowledged Trade-off):**
- Risk: Access tokens returned in JSON body of `POST /api/auth/...` responses are XSS-extractable; noted explicitly in `apps/api/src/routes/auth.ts` SECURITY_DESIGN comment
- Files: `apps/api/src/routes/auth.ts` lines 1-11
- Current mitigation: Short expiry (7 days), refresh token is HttpOnly-only, session token never exposed; refresh rotation on use
- Recommendations: Consider moving access token to a short-lived HttpOnly cookie pair with CSRF token if same-origin SPA; current model is acceptable for cross-origin API consumption

**CORS Wildcard Default:**
- Risk: `CORS_ORIGINS` env var defaults to `*` in `packages/server/src/env.ts` line 31, allowing any origin in development
- Files: `packages/server/src/env.ts`
- Current mitigation: Only applies when `CORS_ORIGINS` is unset; production deployments must set this explicitly via Doppler
- Recommendations: Add a runtime warning when `NODE_ENV=production` and `CORS_ORIGINS=*`; fail-fast would be safer

**Rate Limit Store Defaults to Redis:**
- Risk: `RATE_LIMIT_STORE` defaults to `'redis'` in `packages/server/src/env.ts` line 48; if Redis is unavailable, `closed` fail-mode services (auth, MFA) will deny all requests
- Files: `packages/server/src/env.ts`, `packages/server/src/platform/cache.ts`
- Current mitigation: Fail-mode dispatch table distinguishes `closed` vs `open` — auth is `closed` by design
- Recommendations: Ensure Redis health is surfaced in `/health/liveness` endpoint; document this fail-closed behavior for ops

---

## Performance Bottlenecks

**`attachSelectors` Uses `Object.keys` + Runtime Reflection:**
- Problem: `packages/runtime/src/stores/factory.ts` `attachSelectors` calls `Object.keys(store.getState())` at store creation time; creates N closures per store
- Files: `packages/runtime/src/stores/factory.ts` lines 112-119
- Cause: Zustand selector pattern requires dynamic key enumeration; unavoidable without schema-driven pre-generation
- Improvement path: Accept cost as one-time at store init; not a hot path

**`_makeKeyRegistry` Uses Mutable `Map` Without Cleanup Guarantees:**
- Problem: `cache.ts` in-process key registry (`refs: Map<string, Map<string, number>>`) uses reference counting but does not guarantee cleanup on abnormal subscriber exit
- Files: `packages/server/src/platform/cache.ts` lines 51-75
- Cause: Reference count decremented in `unregister` but `Effect.forkScoped` teardown order is not guaranteed
- Improvement path: Audit whether registry leaks across store invalidations during pod recycling; add Scope finalizer to drain remaining refs

**Token Estimation in `ai/runtime.ts` Uses Length-Based Heuristic:**
- Problem: `estimatedTokens = Math.ceil(text.length / 4)` is a crude character-count heuristic; real tokenization is model-specific and can vary 2-3x for non-ASCII content
- Files: `packages/ai/src/runtime.ts` line 73
- Cause: Avoids dependency on model-specific tokenizers to keep the budget check cheap
- Improvement path: Use `response.usage.totalTokens` (already present on responses) to correct actual budget consumption post-call; pre-call estimate only blocks at policy enforcement

---

## Fragile Areas

**`packages/server/src/infra/jobs.ts` — Single-File Job System (586 lines):**
- Files: `packages/server/src/infra/jobs.ts`
- Why fragile: Combines entity sharding, DLQ watcher, workflow dispatch, heartbeat, status machine, and handler registry in a single module; tight coupling means any change risks breaking cross-cutting concerns
- Safe modification: Identify the stable interfaces (entity dispatch, handler registry, DLQ watcher) and treat them as separate concerns before touching; run `tests/packages/server/infra/jobs.spec.ts` after each change
- Test coverage: `tests/packages/server/infra/jobs.spec.ts` exists (137 lines) but tests only contract/shape, not actual workflow execution

**`packages/server/src/infra/cluster.ts` — RPC Schema Hand-Rolled Inline (474 lines):**
- Files: `packages/server/src/infra/cluster.ts`
- Why fragile: All RPC schemas are defined inline in `_SCHEMA` constant; adding a new RPC operation requires updating the schema, the RPC group, and the handler dispatch in the same file with no compile-time enforcement of completeness
- Safe modification: Add new RPCs by following the existing `_SCHEMA.Payload`/`_SCHEMA.Response` pattern; verify handler exhaustiveness manually
- Test coverage: `tests/packages/server/infra/cluster.spec.ts` exists

**`packages/server/src/platform/cache.ts` — Dual-Channel Invalidation (360 lines):**
- Files: `packages/server/src/platform/cache.ts`
- Why fragile: Cache invalidation uses both in-memory `_invalidateLocal` and Redis pub/sub; ordering and deduplication between channels is implicit via `Effect.all(concurrency: 'unbounded')` — a race condition window exists between local eviction and cross-pod pub/sub fan-out
- Safe modification: Do not split the `Effect.all` call for invalidation; ensure any new invalidation path goes through both channels atomically
- Test coverage: `tests/packages/server/platform/cache.spec.ts` (139 lines)

**`packages/database/src/factory.ts` — Polymorphic Repo Factory (387 lines):**
- Files: `packages/database/src/factory.ts`
- Why fragile: The `repo()` factory generates all SQL fragments (soft delete, expiry, scoping, OCC, conflict) dynamically via closures; incorrect field name mapping in `Field.resolve` cascades silently to wrong SQL
- Safe modification: Always run `tests/packages/database/factory.spec.ts` (153 lines) and `tests/packages/database/repos.spec.ts` after touching factory or field registry
- Test coverage: Covered but at contract level, not SQL correctness level

---

## Test Coverage Gaps

**`packages/ai` — Zero Test Coverage:**
- What's not tested: `AiRuntime`, `AiRegistry`, `AiRuntimeProvider`, MCP integration, search, token budget enforcement, fallback chain logic
- Files: `packages/ai/src/runtime.ts`, `packages/ai/src/registry.ts`, `packages/ai/src/mcp.ts`, `packages/ai/src/search.ts`, `packages/ai/src/runtime-provider.ts`
- Risk: Fallback chain, budget enforcement, and provider dispatch have no verification; regressions are silent
- Priority: HIGH — budget_exceeded and rate_exceeded logic are security/cost controls

**`apps/kargadan/harness` — Zero Test Coverage:**
- What's not tested: Agent loop state machine (PLAN/EXECUTE/VERIFY/PERSIST/DECIDE), retry/correction/compensation logic, WebSocket protocol dispatch, persistence trace
- Files: `apps/kargadan/harness/src/runtime/agent-loop.ts`, `apps/kargadan/harness/src/runtime/loop-stages.ts`, `apps/kargadan/harness/src/protocol/dispatch.ts`, `apps/kargadan/harness/src/protocol/supervisor.ts`
- Risk: Loop-stages.ts contains pure functions ideal for property-based testing; no coverage means silent behavioral regressions
- Priority: HIGH — `loop-stages.ts` pure functions (`planCommand`, `verifyResult`, `handleDecision`) are directly testable without infrastructure

**`packages/components`, `packages/components-next` — Zero Test Coverage:**
- What's not tested: All component schemas, animation states, gesture system (`gesture.ts` 346 lines), store integrations
- Files: All of `packages/components/src/`, all of `packages/components-next/src/`
- Risk: Theme/schema regressions go undetected; gesture system (`packages/components-next/src/core/gesture.ts`) is complex and has no verification
- Priority: MEDIUM — Visual regression requires Playwright; schema/prop contracts can be unit tested

**`packages/runtime` — Zero Test Coverage:**
- What's not tested: Store factory middleware chain, CSS sync, URL state management, browser utilities, messaging patterns
- Files: `packages/runtime/src/stores/factory.ts`, `packages/runtime/src/css-sync.ts`, `packages/runtime/src/url.ts`, `packages/runtime/src/browser.ts`, `packages/runtime/src/messaging.ts`
- Risk: Middleware ordering in `STORE_FACTORY_TUNING.order` is critical; no tests verify `immer → computed → persist → temporal → subscribeWithSelector → devtools` chain
- Priority: MEDIUM

**`packages/theme` and `packages/devtools` — Zero Test Coverage:**
- What's not tested: Theme generation pipeline, color system, component-wiring, Vite plugin HMR, devtools client/server protocol
- Files: All of `packages/theme/src/`, all of `packages/devtools/src/`
- Risk: Theme color generation failures surface only at build/render time; devtools protocol changes break silently
- Priority: LOW (dev tooling)

**`apps/api/src/routes/admin.ts`, `health.ts`, `users.ts` — No Route-Level Tests:**
- What's not tested: Admin DLQ replay, tenant management endpoints, health check response shapes, user profile operations, notification preferences
- Files: `apps/api/src/routes/admin.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/routes/users.ts`
- Risk: Admin endpoints that modify DLQ, tenant status, or feature flags have no route-level contract tests
- Priority: HIGH for admin; MEDIUM for health/users

**`tests/packages/server/domain/auth.spec.ts` — Minimal Coverage (13 lines, 1 test):**
- What's not tested: OAuth flow (6 providers), TOTP enrollment/verification/backup codes, WebAuthn registration/authentication, session lifecycle, rate limiting, token rotation
- Files: `tests/packages/server/domain/auth.spec.ts` (13 lines vs `packages/server/src/domain/auth.ts` at 499 lines)
- Risk: Auth is the highest-risk service; a single identity-check test provides no meaningful protection
- Priority: CRITICAL — OAuth state machine, TOTP replay guard, and WebAuthn verification are all uncovered

**`tests/e2e/seed.spec.ts` — Only E2E Test (30 lines):**
- What's not tested: Any actual user flow, authenticated API calls, multi-tenant isolation, real OAuth redirect flow
- Files: `tests/e2e/seed.spec.ts`
- Risk: E2E suite is effectively a health check wrapper, not a user-journey validator
- Priority: MEDIUM — depends on broader E2E strategy

**`tests/fixtures/` — Empty:**
- What's missing: No shared test fixtures; each spec creates its own data shapes inline
- Files: `tests/fixtures/.gitkeep`
- Risk: Data shape drift between specs; factories per test file creates maintenance overhead
- Priority: LOW

---

## Fragile Infrastructure

**`tests/system/` — Empty Directory:**
- What's missing: No system-level tests for cluster behavior (sharding, leader election, singleton lifecycle, pod restart recovery)
- Files: `tests/system/` (empty)
- Risk: Cluster service interactions (`ClusterService`, `JobService`, `EventBus`) are tested only at unit/contract level; distributed behavior under failure is untested
- Priority: HIGH — `@effect/cluster` sharding and `SqlEventJournal` durability are core to the system's reliability guarantees

**`packages/components/src/` — Legacy Package Coexists with `components-next/`:**
- Issue: Both `packages/components/` (React Aria + Tailwind) and `packages/components-next/` (React Aria Components) coexist; the archive directory confirms a migration is in progress
- Files: `packages/components/src/` (5,243 LOC total), `packages/components-next/src/` (active target), `.archive/components-next/` (deprecated fragments)
- Impact: Consumers must choose between two component APIs; no deprecation timeline visible in code; `.archive/` directory adds noise and potential confusion
- Fix approach: Establish a migration completion milestone; add `@deprecated` annotations to all `packages/components/` exports; remove `.archive/` once migration is confirmed complete

---

*Concerns audit: 2026-02-22*
