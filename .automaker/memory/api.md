---
tags: [api]
summary: api implementation decisions and patterns
relevantTo: [api]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 4
  referenced: 3
  successfulFeatures: 3
---
# api

### Minimalist public API export strategy - only export useToast hook and ToastConfig type, keeping all internal types and utilities private (2026-01-12)
- **Context:** Toast module had 8 exports including internal constants (B, ConfigResolver, globalQueue, POSITION_STYLES) and 5 type exports that consumers don't directly use
- **Why:** Reduces cognitive load on consumers and prevents them from depending on implementation details that should be encapsulated. Matches established pattern in floating.tsx (useTooltip + TooltipConfig only). Internal consumers access what they need within the module; external consumers only need the hook and its configuration shape
- **Rejected:** Exporting all types and constants for 'flexibility' or 'in case consumers need them' - this violates single responsibility and creates maintenance burden when refactoring internals
- **Trade-offs:** Easier: Consumers have clear contract; easier to refactor internals without breaking external code. Harder: Consumers can't directly inspect internal positioning types or override internal utilities directly (but they shouldn't need to)
- **Breaking if changed:** If external code depends on TOAST_TUNING, ConfigResolver, globalQueue, POSITION_STYLES, or the exported types (ToastPayload, ToastPosition, ToastResult, ToastType), they will break. However, grep showed these are only used internally within toast.tsx, indicating they weren't actually being consumed externally

### Spy's assertCalledWith() accepts variadic arguments to match flexible call patterns, not a single array parameter (2026-01-12)
- **Context:** Services get called with varying numbers of arguments. API design choice between assertCalledWith([...args]) vs assertCalledWith(...args)
- **Why:** Variadic signature assertCalledWith(method, arg1, arg2) reads more naturally at call sites and matches Jest/Vitest assertion patterns. Consumers expect (method, ...expectedArgs) not (method, [expectedArgs])
- **Rejected:** Single array parameter assertCalledWith(method, [...args]) would be more uniform but less readable and breaks user familiarity with standard assertion libraries
- **Trade-offs:** Variadic signature requires spread operator in internal implementation but provides better DX at call sites
- **Breaking if changed:** If changed to array parameter, all existing assertCalledWith() calls would break

### UserLookupService is separate injectable tag rather than calling user repository directly from middleware (2026-01-12)
- **Context:** Middleware needed to fetch user record to check role, but had to abstract the data access layer
- **Why:** Follows Effect dependency injection pattern in codebase. Allows different implementations (database, cache, service) to be swapped via Layer composition. Makes middleware testable in isolation.
- **Rejected:** Direct repository call from middleware - would couple middleware to data layer. Harder to mock/test.
- **Trade-offs:** Gained: testability, loose coupling, impl flexibility. Lost: one extra layer of indirection, requires layer provider setup.
- **Breaking if changed:** If UserLookupService is not provided in layers, requireRole fails at runtime with Service not found. User endpoint works fine - only protected endpoints fail.

### Split MFA into separate endpoints (enroll, verify, recover, disable) rather than single state-machine endpoint (2026-01-12)
- **Context:** MFA has multiple distinct operations with different request/response shapes and business logic
- **Why:** Clearer semantics, easier to version independently, matches REST principles, simpler error handling per operation, allows rate-limiting per operation
- **Rejected:** Single endpoint with action parameter (less RESTful, harder to document, conflates concerns)
- **Trade-offs:** More endpoints to maintain; client must handle multiple endpoints; easier to add MFA-specific middleware (rate limiting, audit logging)
- **Breaking if changed:** Combining into single endpoint requires version bump; loses granular metrics/monitoring per operation

#### [Pattern] AppRepository methods (findById, findBySlug, create, updateSettings) follow Effect-TS pattern with withDbOps for metrics and tracing (2026-01-12)
- **Problem solved:** Existing repository pattern in DatabaseService used Effect for error handling and observability
- **Why this works:** withDbOps wraps queries with metrics collection and distributed tracing - essential for observability in multi-tenant system where you need to track app-specific performance. Consistent with existing patterns
- **Trade-offs:** Effect wrapper adds small overhead but provides production debugging capability. Requires Effect knowledge from developers but enforced by existing codebase

### X-App-Id header validation returns 400 (Validation error) for missing header and 404 (NotFound) for invalid slug - different error codes for different failure modes (2026-01-12)
- **Context:** Middleware needs to communicate why app context establishment failed
- **Why:** 400 signals client error (missing required header - caller should fix). 404 signals data error (app slug doesn't exist in system - app was deleted or misconfigured). Allows caller to distinguish recoverable from permanent failures.
- **Rejected:** Using single error code (400 or 404 for both) - loses semantic information about failure mode
- **Trade-offs:** Gained: caller can distinguish between client config issue vs deleted resource. Lost: slight API complexity (two error codes for one validation step).
- **Breaking if changed:** If error codes changed (both become 400), callers cannot distinguish between 'fix the header' vs 'app was deleted' failure modes