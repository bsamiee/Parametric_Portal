---
tags: [testing]
summary: testing implementation decisions and patterns
relevantTo: [testing]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# testing

#### [Pattern] Dual spy mechanism: both createServiceSpy() for manual spy wrapping AND optional withSpy flag in TestLayers.Custom() for automatic spy integration (2026-01-12)
- **Problem solved:** Need to verify service calls in tests without requiring Vitest mock functions, but also need flexible spy configuration
- **Why this works:** withSpy flag handles common case of simple spy wrapping within layer creation. Standalone createServiceSpy() handles cases where spy wrapping must be applied selectively or where the service is already created. Dual approach prevents API confusion by providing two clear use cases.
- **Trade-offs:** Two APIs to learn instead of one unified API, but each is simpler and covers distinct use cases without false coupling

#### [Gotcha] TestLayers.effectStub() requires mutable state pattern to configure Effect stubs per-test, rather than using Vitest mocks directly (2026-01-12)
- **Situation:** Effect-based services can't use Vitest mocks directly because Effect wraps the function call. Tests need to configure mock behavior before running effects.
- **Root cause:** Vitest mocks (mockReturnValue, mockRejectedValue) are imperative and don't integrate with Effect's lazy evaluation model. The mutable stub pattern allows configuration at test setup time before the Effect is executed, maintaining Effect's referential transparency during execution.
- **How to avoid:** Must manage stub configuration as mutable state, but this aligns with how test setup works (arrange-act-assert). More explicit than Vitest mocks but safer for Effect's lazy evaluation.

#### [Pattern] Mock helpers (noop(), succeed(), fail()) return functions that create Effects, not Effects themselves, enabling reuse across multiple calls (2026-01-12)
- **Problem solved:** Mocks are called multiple times in tests. Need fresh Effect instance for each call to maintain independent execution
- **Why this works:** Returning Effect directly would cause all calls to share the same Effect instance, violating Effect's referential transparency and causing tests to interfere with each other. Factories enable fresh instances per invocation.
- **Trade-offs:** Users must call the factory function (noop() returns a function that returns Effect), adding one layer of indirection, but ensures test isolation

#### [Gotcha] createServiceSpy() wraps service methods and returns a new service object, not a proxy, so the wrapped object must be explicitly passed to layer builders (2026-01-12)
- **Situation:** Spies must intercept method calls before they reach the layer. Implementation choice: automatic proxy vs explicit wrapping
- **Root cause:** JavaScript Proxy objects don't work reliably with Effect's type system for services that use Context.Tag. Explicit wrapping ensures type safety and predictable behavior across different service interfaces.
- **How to avoid:** Explicit wrapping adds one extra step (spy, then pass to layer) but guarantees type safety and avoids proxy-related pitfalls

#### [Pattern] Call recording stores arguments as-is in arrays without serialization, relying on reference equality for assertion comparisons (2026-01-12)
- **Problem solved:** Tests need to assert services were called with specific arguments. Choice between reference equality vs deep equality comparison
- **Why this works:** Recording raw arguments preserves Effect instances and complex object references needed for verification. Deep equality comparison would require serialization strategy and could be slow.
- **Trade-offs:** Reference equality works well for simple values and Effect instances but fails for equivalent but different object references. Users can use getCalls() and manually inspect for complex assertions.

#### [Gotcha] Vitest setupFiles in monorepo workspace references @parametric-portal/test-utils package that fails to resolve during test runs due to pnpm workspace resolution and Node.js version incompatibility (v22 vs v25 requirement) (2026-01-12)
- **Situation:** Attempted to create unit tests for middleware but vitest config's setupFiles prevented test execution
- **Root cause:** Project specifies Node v25.2.1 in package.json, environment has v22.20.0. Workspace package resolution layers on top of version mismatch, causing import chain failures in setup.
- **How to avoid:** Typecheck passes (uses tsc, version-agnostic). Tests cannot run (requires workspace package import). Implementation verified via typecheck but edge cases cannot be tested.

#### [Gotcha] Playwright E2E tests for MFA endpoints require running database and both services, preventing CI integration without additional setup (2026-01-12)
- **Situation:** MFA is backend-only feature; no UI to test; endpoints require authentication context and database state
- **Root cause:** TOTP verification is time-dependent and cryptographic; needs real service state, not mocked; difficult to test without full stack
- **How to avoid:** Tests are slower and more brittle; require infrastructure; cannot run in lightweight CI; catch real integration issues

#### [Gotcha] Feature validated through TypeScript compilation only, not Playwright integration tests, because it's backend schema/type change (2026-01-12)
- **Situation:** Implementation completed but no UI/browser tests were created
- **Root cause:** AppId type and apps table are pure infrastructure - no UI to test. TypeScript compilation validates type safety and schema correctness which are the actual contract guarantees
- **How to avoid:** Faster validation through typecheck (seconds vs minutes), but no runtime verification that schema actually works with database. Requires integration tests at application level before deployment

#### [Gotcha] Playwright E2E tests created with TODO comments for full validation since middleware not yet integrated into API app - test file later becomes orphaned/stale (2026-01-12)
- **Situation:** Implementation completes at server package level but requires integration in API app for meaningful E2E verification
- **Root cause:** Tests written as placeholder to document expected behavior but marked for deletion since integration incomplete. However, leaving commented tests means actual integration work must remember to implement exact test expectations.
- **How to avoid:** Gained: clear specification of expected behavior. Lost: stale test file creates documentation debt (file marked for deletion but never deleted).

#### [Gotcha] Playwright e2e test required @opentelemetry/sdk-trace-web dependency that wasn't available in environment, preventing test execution (2026-01-13)
- **Situation:** Wanted to verify audit endpoint works end-to-end but server failed to start during test setup
- **Root cause:** Server had missing or broken dependencies unrelated to audit feature. Root cause: pre-existing environment/dependency issues.
- **How to avoid:** Easier: Created test scaffold showing expected behavior. Harder: No actual test execution, relying on typecheck only