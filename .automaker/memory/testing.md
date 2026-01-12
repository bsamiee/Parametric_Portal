---
tags: [testing]
summary: testing implementation decisions and patterns
relevantTo: [testing]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 1
  referenced: 1
  successfulFeatures: 1
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

#### [Gotcha] Verification script tests deduplication logic in isolation with hardcoded test cases rather than integration tests (2026-01-12)
- **Situation:** Need confidence that batch coalescing telemetry layer works correctly across 14 resolvers
- **Root cause:** Unit-level verification catches calculation bugs before they propagate to production metrics. Tests edge cases (0 original requests) that might not occur in normal operation but would break calculation if they did. Isolated tests run fast for rapid iteration
- **How to avoid:** Unit tests don't prove metrics actually flow through resolvers correctly, but prevent systematic calculation errors. Playwright tests verify end-to-end correctness. Both needed for confidence