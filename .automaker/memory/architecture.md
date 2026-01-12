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