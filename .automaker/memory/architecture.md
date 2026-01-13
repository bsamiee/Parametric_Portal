---
tags: [architecture]
summary: architecture implementation decisions and patterns
relevantTo: [architecture]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 1
  referenced: 1
  successfulFeatures: 1
---
# architecture

#### [Pattern] Option-based config resolution with fallback chains using functional composition (pipe, Option.fromNullable, Option.orElse, Option.getOrElse) (2026-01-12)
- **Problem solved:** Toast system needs to resolve configuration from multiple sources: prop values, CSS variables, and defaults - each source may or may not have a value
- **Why this works:** Option monad elegantly handles nullable/optional values without nested conditionals or null coalescing chains. The pipe pattern creates a clear, readable fallback sequence: prop → CSS var → default. Type-safe - composition prevents accidentally accessing null values
- **Trade-offs:** Easier: Type safety, readability, composability, easy to add validation steps (Option.filter). Harder: Requires understanding Option monad semantics; more verbose than simple nullish coalescing for simple cases

#### [Pattern] Schema-based validation with Effect error mapping - validate unknown input against ToastStyleSpecSchema and map Schema validation errors to domain error type (ThemeError.Validation) (2026-01-12)
- **Problem solved:** generateToastWiring must accept user-provided specs and validate them before generating CSS. Validation errors need to be consistent with rest of theme error handling
- **Why this works:** Decouples validation concern (Schema) from domain error handling (ThemeError). Effect's Schema.decodeUnknown provides exhaustive validation with detailed error messages; mapping to ThemeError.Validation keeps error handling unified across the theme module. Consumers don't need to know about Schema errors
- **Trade-offs:** Easier: Systematic error handling, reusable schema definitions, detailed validation errors. Harder: Requires understanding Effect error mapping; adds abstraction layer between caller and actual validation logic

#### [Gotcha] CSS variable generation for optional type overrides - if a toast type (success, warning, error, info) has partial overrides in the spec, only those overrides are generated, relying on CSS cascade to inherit base values (2026-01-12)
- **Situation:** ToastStyleSpec allows optional per-type styling (types?: Record<ToastType, Partial<BaseStyles>>). Implementation generates only the properties that differ, not all properties for each type
- **Root cause:** Reduces generated CSS size; assumes CSS cascade will inherit base variables. This is correct because CSS custom properties inherit, so specifying only --toast-icon-color in a type rule while base defines --toast-bg works as expected
- **How to avoid:** Easier: Smaller CSS output, more readable specs (only specify what changes). Harder: Requires understanding CSS custom property inheritance; harder to debug if cascade doesn't work as expected (e.g., if --toast-bg is redefined elsewhere)

### Generic test layer builders that avoid service-specific implementations to prevent circular dependencies with @parametric-portal/runtime (2026-01-12)
- **Context:** Initial attempt created service-specific builders (Browser, FileOps, HttpClient) but test-utils package cannot depend on runtime services that depend on test-utils
- **Why:** The test-utils package is a foundational dependency. Creating service-specific builders would create circular dependency: runtime → test-utils → runtime. Generic TestLayers.Custom() builder allows consumers to define their own mocks.
- **Rejected:** Service-specific builders like TestLayers.HttpClient(), TestLayers.Browser() that provided pre-configured mocks with built-in stubs
- **Trade-offs:** Users must write more boilerplate to configure specific services, but the package remains dependency-agnostic and reusable across any Effect service
- **Breaking if changed:** If service-specific builders were added with @effect/platform imports, would create circular dependency at package install time

### Layer composition via TestLayers.merge() and mergeAll() rather than fluent builder pattern (layer.merge(other).merge(third)) (2026-01-12)
- **Context:** Tests often need to combine multiple service layers. Choice between fluent API vs functional composition API
- **Why:** Functional composition is more natural with Effect's Layer.pipe() style and avoids potential ordering confusion in fluent chains. Variadic mergeAll() reduces repetition for many layers.
- **Rejected:** Fluent builder pattern TestLayers.custom(...).merge(...).merge(...) which is common in other libraries but less compatible with Effect ecosystem conventions
- **Trade-offs:** Functional API requires more imports (TestLayers.merge, TestLayers.mergeAll) but aligns with Effect conventions. Easier to compose programmatically with variadic functions.
- **Breaking if changed:** If changed to fluent pattern, would break compatibility with functional composition patterns used in the codebase

#### [Pattern] Role enforcement via Effect.Tag dependency injection with runtime role level comparison against SCHEMA_TUNING.roleLevels hierarchy (2026-01-12)
- **Problem solved:** Needed to gate endpoints by minimum required role while maintaining type safety and dependency injection
- **Why this works:** Effect.Tag enables compile-time role validation with runtime level checking. Centralizing role hierarchy in SCHEMA_TUNING prevents drift between authorization logic and role definitions. Allows middleware to be composable across different handlers.
- **Trade-offs:** Requires fetching user from database on each protected request vs caching. Gained: centralized role authority, type safety, testability. Lost: request performance per protected call.

### Injected MfaSecretsRepository via Effect.Tag rather than direct database access, indicating future Effect-based dependency injection (2026-01-12)
- **Context:** Codebase appears to be migrating toward or using Effect for dependency injection
- **Why:** Testability (can mock repository), loose coupling, enables request-level transaction scoping, consistent with codebase patterns
- **Rejected:** Direct database queries (tight coupling, harder to test), class-based DI (less functional)
- **Trade-offs:** Requires Effect runtime setup; adds abstraction layer; enables composition patterns
- **Breaking if changed:** Removing Effect.Tag requires rewriting all consumers; changing to direct queries loses testing capabilities

#### [Pattern] AppId as branded UUID type in same pattern as other entity IDs (UserId, etc) (2026-01-12)
- **Problem solved:** System already had branded ID types for type safety - extending pattern to new entity
- **Why this works:** Leverages existing infrastructure - same IdFactory pattern, same benefits (compile-time safety prevents mixing IDs, documentation via type name). Consistency reduces cognitive load
- **Trade-offs:** Slight boilerplate to create IdFactory.AppId and add to enums, but pays off with type safety across entire system. Every app reference is now checked by TypeScript

### AppRepository added to DatabaseService as resolver pattern, not passed as parameter (2026-01-12)
- **Context:** Existing DatabaseService pattern where repos are methods on the service, not injected parameters
- **Why:** Maintains consistency with existing repo pattern (UsersRepository, etc). Single DatabaseService instance becomes complete accessor for all repos. Reduces dependency parameter chains
- **Rejected:** Injecting AppRepository as parameter would require updating all DatabaseService consumers, fragmenting the pattern
- **Trade-offs:** All code sees all repos through DatabaseService (less granular dependency control), but simpler service construction and consistency with existing code
- **Breaking if changed:** Code expecting DatabaseService without apps accessor will fail. New repos added later must follow same pattern or require refactoring existing code

### RequestContext implemented as Effect.Tag with shape {appId, userId, sessionId, requestId} rather than passing values through middleware chain (2026-01-12)
- **Context:** Thread app needs to propagate application identity through request lifecycle for telemetry, metrics, and authorization
- **Why:** Effect.Tag provides dependency injection pattern that automatically threads context through all downstream effects without explicit parameter passing. Eliminates threading burden across deeply nested call stacks.
- **Rejected:** Passing context as middleware return value or request property - would require manual threading through every function signature
- **Trade-offs:** Gained: automatic context propagation, clean separation of concerns. Lost: explicit visibility of context dependencies (implicit dependencies harder to discover).
- **Breaking if changed:** Removing Effect.Tag pattern forces all downstream code to accept context as explicit parameter - cascading signature changes across entire codebase

### AppLookupService injected as dependency in middleware rather than passed directly from caller or resolved at request time (2026-01-12)
- **Context:** Middleware needs to resolve app by slug but doesn't own the database layer
- **Why:** Effect Layer pattern allows dependency to be satisfied at application startup. Enables different implementations (MockAppLookup for testing, LiveAppLookup for production) and keeps middleware pure.
- **Rejected:** Direct database call in middleware - would couple middleware to concrete database implementation and make testing harder
- **Trade-offs:** Gained: testability, loose coupling, explicit dependency declaration. Lost: middleware implementation complexity increases (requires Layer composition).
- **Breaking if changed:** If AppLookupService layer isn't provided to ServerLive, entire server fails to start - not a runtime error but a startup constraint

#### [Gotcha] RequestContext Effect.Tag shape includes both userId and sessionId as optional (union with null) despite app-level authorization needing both (2026-01-12)
- **Situation:** Feature extracts X-App-Id from header but userId/sessionId extraction happens separately (presumably in other middleware)
- **Root cause:** RequestContext is app-level context singleton - created once per request when middleware runs. userId/sessionId are only available if auth middleware ran first and provided them. By making optional, context can be created immediately without blocking on auth.
- **How to avoid:** Gained: flexible middleware composition order. Lost: downstream code must handle optional userId/sessionId (require null checks everywhere).