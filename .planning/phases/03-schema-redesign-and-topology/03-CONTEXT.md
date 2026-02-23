# Phase 3: Schema Redesign and Topology - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Delete legacy schemas, collapse all type definitions to 2-3 canonical schemas max inside apps/kargadan, refactor both TS harness and C# plugin contracts to match, and delete packages/types/src/kargadan/ entirely. Universal concept extraction to packages/ is explicitly deferred -- everything lives in the app. Net LOC reduction is a hard constraint.

</domain>

<decisions>
## Implementation Decisions

### Schema partitioning
- Everything stays in apps/kargadan -- no extraction to packages/
- Delete packages/types/src/kargadan/ and its contents entirely
- Rhino-specific types (geometry, attributes, etc.) are app-specific -- no packages/rhino
- Transport layer (WebSocket frames, protocol, envelopes) stays app-local
- packages/ai is consumed for services only -- no schema imports from packages/ai
- 2-3 canonical schemas MAX -- all derivation via pick/omit/partial inline at call sites
- No module-level const/schema proliferation -- inline everything

### Package granularity
- No standalone schema files -- schemas colocated in the appropriate existing source files
- No new files for schemas -- identify the logical home in existing modules and place there
- packages/types/src/kargadan/ deleted entirely -- zero shared kargadan types

### Cross-boundary naming
- camelCase in TS, PascalCase in C# -- each language uses its idiomatic casing
- C# handles serialization/deserialization casing transformation (System.Text.Json CamelCase naming policy)
- TS reads/writes natively with no mapping layer
- Discriminant field (_tag vs type): needs investigation during research -- must fully commit to one convention, whichever yields cleanest code aligned with Effect standards and Rhino integration
- Action-level abstractions, NOT per-Rhino-API schema mirroring -- TS models what the agent does, not the full RhinoCommon surface
- Cross-boundary contract simplification: researcher should investigate the logical solution to reduce shapes project-wide with proper polymorphism aligned to real Rhino API

### Migration strategy
- Blank slate with extreme aggression -- no migration paths, no aliases, no workarounds, no bandaids
- Planning phase: catalogue all existing objects/shapes, identify refactoring needed to achieve minimal surface
- Execution phase: delete all legacy schemas first, then rebuild with the plan already in place
- Break Phase 1+2 code freely during restructuring -- everything compiles at the END, not during
- Both TS and C# refactored in one pass -- full alignment, not incremental
- Typecheck gate: apps/kargadan only (not full monorepo)
- Net LOC reduction is a hard success criterion

### Claude's Discretion
- Exact number of canonical schemas (2 or 3) -- determined by what the code actually needs after catalogue
- Which existing source files become the home for schema definitions
- _tag vs type discriminant recommendation (with full implications analysis)
- Specific refactoring patterns to reduce consumers' dependency on removed schemas

</decisions>

<specifics>
## Specific Ideas

- "We needed abstractions for actions" -- the research conclusion was that per-Rhino-API schema mirroring is unsustainable. Action-level abstractions are the path.
- "Extreme focus on REMOVAL" -- the measure of success is how much is deleted, not how much is created
- "No indirection remains, no module level const/schema spam, just inline" -- derivation happens at the call site, not in a separate declaration
- "Identify advanced Effect imports + TS and creating 2-3 schemas MAX and extending surgically" -- leverage Effect's Schema composition (pick/omit/partial/extend) to derive everything from minimal roots

</specifics>

<deferred>
## Deferred Ideas

- Universal concept extraction to packages/ (protocol version, telemetry context, failure taxonomy, idempotency) -- defer until a second app genuinely needs them
- JSON Schema CI gate for TS/C# contract drift detection (ADVN-04 in v2 requirements)

</deferred>

---

*Phase: 03-schema-redesign-and-topology*
*Context gathered: 2026-02-23*
