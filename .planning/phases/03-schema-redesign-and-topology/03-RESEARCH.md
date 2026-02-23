# Phase 3: Schema Redesign and Topology - Research

**Researched:** 2026-02-23
**Domain:** Effect Schema composition, cross-boundary (TS/C#) contract alignment, schema consolidation patterns
**Confidence:** HIGH

## Summary

Phase 3 is a delete-and-rebuild operation targeting schema/type surface reduction across the TS harness and C# plugin. The current codebase has 881 LOC across 7 contract/schema files (227 LOC in TS, 654 LOC in C#) plus implicit type creation at consumer sites. The legacy `kargadan-schemas.ts` in `packages/types/src/kargadan/` is the deletion target; all schemas move into `apps/kargadan/` colocated with their consumers.

The Effect ecosystem uses `_tag` as its canonical discriminant field for `Data.TaggedError`, `Data.TaggedEnum`, `Match.tag`, `Match.valueTags`, and `Schema.Union` discrimination. The existing codebase already uses `_tag` everywhere on the wire. The C# side uses manual `_tag` field serialization via anonymous objects and `JsonSerializer.SerializeToElement`. System.Text.Json `[JsonPolymorphic]` supports custom `TypeDiscriminatorPropertyName` but the current C# code does NOT use polymorphic attributes -- it uses manual JSON construction with LanguageExt `[Union]` for type safety and manual serialization for wire format. This manual approach is correct for this codebase and should be retained.

**Primary recommendation:** Keep `_tag` as discriminant. Delete `kargadan-schemas.ts` entirely. Rebuild 2-3 root `S.Struct` schemas inside `apps/kargadan/harness/src/` colocated in existing files. Use `Schema.pick`/`Schema.omit`/`Schema.partial` inline at call sites. C# contracts stay as-is (already well-structured); TS schemas collapse from 26 exports to 2-3 root schemas with inline derivation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Everything stays in apps/kargadan -- no extraction to packages/
- Delete packages/types/src/kargadan/ and its contents entirely
- Rhino-specific types (geometry, attributes, etc.) are app-specific -- no packages/rhino
- Transport layer (WebSocket frames, protocol, envelopes) stays app-local
- packages/ai is consumed for services only -- no schema imports from packages/ai
- 2-3 canonical schemas MAX -- all derivation via pick/omit/partial inline at call sites
- No module-level const/schema proliferation -- inline everything
- No standalone schema files -- schemas colocated in the appropriate existing source files
- No new files for schemas -- identify the logical home in existing modules and place there
- packages/types/src/kargadan/ deleted entirely -- zero shared kargadan types
- camelCase in TS, PascalCase in C# -- each language uses its idiomatic casing
- C# handles serialization/deserialization casing transformation (System.Text.Json CamelCase naming policy)
- TS reads/writes natively with no mapping layer
- Action-level abstractions, NOT per-Rhino-API schema mirroring -- TS models what the agent does, not the full RhinoCommon surface
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

### Deferred Ideas (OUT OF SCOPE)
- Universal concept extraction to packages/ (protocol version, telemetry context, failure taxonomy, idempotency) -- defer until a second app genuinely needs them
- JSON Schema CI gate for TS/C# contract drift detection (ADVN-04 in v2 requirements)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHM-01 | Delete packages/types/src/kargadan/kargadan-schemas.ts and redesign from scratch | Catalogue of all 26 exported schemas and their 4 consumer files mapped; deletion + rebuild pattern documented |
| SCHM-02 | Universal concepts extracted to packages/ as reusable schemas | USER OVERRIDE: Deferred. Everything stays in apps/kargadan per CONTEXT.md locked decision |
| SCHM-03 | apps/kargadan consumes packages/ai for all LLM interaction | No schema changes needed -- packages/ai is service-only; no schema imports exist today |
| SCHM-04 | Minimal schema surface -- one canonical schema per entity with pick/omit/partial derivation | Effect Schema composition patterns documented with concrete API patterns for pick/omit/partial/extend |
| SCHM-05 | Consistent semantics across boundaries -- same field names between TS and C# | _tag discriminant analysis completed; CamelCase naming policy interaction documented; field name alignment catalogue produced |
| SCHM-06 | Internal logic is private -- minimal public API surface | Schema colocations strategy determined; no public schema exports from apps/kargadan |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect` (Schema module) | 3.19 | Root schema definitions, pick/omit/partial derivation, S.Union discrimination, branded types | Already in workspace; provides the composition primitives needed for minimal schema surface |
| System.Text.Json | net10.0 built-in | C# serialization with CamelCase naming policy and manual JSON construction | Already in use; CamelCase policy handles TS/C# casing bridge automatically |
| LanguageExt.Core | 5.0.0-beta-77 | C# `[Union]` for discriminated unions, `Fin<T>` for validated construction, `Seq<T>` for immutable collections | Already in use; `[Union]` generates exhaustive `Switch` methods that replace pattern matching |
| Thinktecture.Runtime.Extensions | 10.0.0 | `[SmartEnum<string>]` for string-keyed enums, `[ValueObject<T>]` for branded value objects | Already in use; generates `Map` exhaustive dispatch, `TryGet`, `TryCreate` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| NodaTime | 3.3.0 | Instant type for timestamps in C# contracts | Already in use for all time fields in ProtocolModels.cs |
| `@effect/platform` | workspace | FileSystem for port file access in socket.ts | Already in use; no change needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual _tag JSON in C# | `[JsonPolymorphic(TypeDiscriminatorPropertyName = "_tag")]` | Polymorphic attributes require class hierarchies; current codebase uses records + `[Union]` + manual SerializeToElement. Manual approach is simpler and already working. |
| Effect Schema in C# | JSON Schema contract testing | Deferred to ADVN-04 (v2). No cross-language schema tooling needed for v1. |

## Architecture Patterns

### Recommended Schema Topology (Post-Refactor)

```
apps/kargadan/
  harness/src/
    protocol/
      dispatch.ts      # InboundEnvelopeSchema, OutboundEnvelopeSchema (unions + envelope schemas)
    socket.ts          # Inline decode/encode using schemas from dispatch.ts
    config.ts          # CommandOperationSchema, SceneObjectTypeSchema (literals for config validation)
    runtime/
      agent-loop.ts    # Inline derivation via pick/omit at call sites; no schema imports needed beyond dispatch
    persistence/
      checkpoint.ts    # RunEventSchema, RunSnapshotSchema, RetrievalArtifactSchema (persistence domain)
  plugin/src/
    contracts/         # UNCHANGED -- already well-structured
```

### Pattern 1: Root Schema with Inline Derivation

**What:** Define 2-3 root `S.Struct` schemas. Derive all variants inline at the call site using `pick`/`omit`/`partial`.

**When to use:** Every place that currently imports from `Kargadan` namespace.

**Example:**
```typescript
// In dispatch.ts -- ROOT SCHEMA (one of 2-3)
const EnvelopeIdentitySchema = S.Struct({
    appId:           S.UUID,
    issuedAt:        S.DateFromString,
    protocolVersion: S.Struct({ major: S.Int.pipe(S.greaterThanOrEqualTo(0)), minor: S.Int.pipe(S.greaterThanOrEqualTo(0)) }),
    requestId:       S.UUID,
    runId:           S.UUID,
    sessionId:       S.UUID,
})

// At call site -- INLINE DERIVATION (no module-level declaration)
const decoded = yield* S.decodeUnknown(
    CommandEnvelopeSchema.pick('operation', 'payload', 'identity')
)(rawJson)
```

### Pattern 2: Schema.Union with _tag Discrimination

**What:** Use `S.Literal` on `_tag` field for discriminated unions. Effect's `Match.tag` reads `_tag` by convention.

**When to use:** All envelope types that cross the WebSocket boundary.

**Example:**
```typescript
const InboundEnvelopeSchema = S.Union(
    HandshakeEnvelopeSchema,     // has _tag: 'handshake.init' | 'handshake.ack' | 'handshake.reject'
    HeartbeatEnvelopeSchema,     // has _tag: 'heartbeat'
    EventEnvelopeSchema,         // has _tag: 'event'
    ResultEnvelopeSchema,        // has _tag: 'result'
)

// Consumer discriminates via Match.tag (reads _tag by convention)
Match.value(envelope).pipe(
    Match.tag('event', (e) => ...),
    Match.tag('result', (r) => ...),
    Match.orElse(() => ...),
)
```

### Pattern 3: C# Manual Serialization with _tag

**What:** C# serializes `_tag` as a literal field in anonymous objects. `JsonNamingPolicy.CamelCase` does NOT transform `_tag` (already lowercase with underscore prefix).

**When to use:** All C# -> TS wire serialization.

**Example:**
```csharp
// Current pattern -- KEEP as-is
JsonSerializer.SerializeToElement(new {
    _tag = "event",
    eventId = (Guid)envelope.EventId,
    eventType = envelope.EventType.Key,
    identity = envelope.Identity,
    sourceRevision = envelope.SourceRevision,
    telemetryContext = envelope.TelemetryContext,
}, options: JsonOptions);
// JsonOptions has PropertyNamingPolicy = JsonNamingPolicy.CamelCase
// _tag stays as "_tag" because CamelCase policy only affects PascalCase -> camelCase
```

### Anti-Patterns to Avoid
- **Schema-per-API-endpoint:** Creating `ReadSceneSummaryResponseSchema`, `WriteObjectCreatePayloadSchema`, etc. mirrors the Rhino API surface. Use action-level abstractions instead: `CommandEnvelopeSchema` with `S.Unknown` payload.
- **Module-level schema proliferation:** Declaring `const X = SomeSchema.pick(...)` at module level. Inline at the call site instead.
- **Namespace re-export:** Creating a barrel `Kargadan` namespace object that re-exports all schemas. Each file imports only what it needs directly.
- **Type-only separate declarations:** Declaring `type X = ...` separate from its schema. Always derive: `type X = typeof XSchema.Type`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema subsetting | Manual `S.Struct` with copied fields | `schema.pick('field1', 'field2')` | Maintains schema identity, validation rules, and type inference |
| Optional fields | New `S.Struct` with `S.optional()` on each field | `schema.partial` or `S.partial(schema)` | Single-expression derivation; no field duplication |
| Schema extension | Spread + manual merge | `S.extend(schemaA, schemaB)` | Handles field overlap, preserves annotations |
| Discriminated union decode | Manual `_tag` checking + conditional decode | `S.Union(memberA, memberB)` | Effect evaluates members in order; auto-discrimination on `_tag` |
| C# casing transform | Manual `JsonPropertyName` on every field | `JsonNamingPolicy.CamelCase` on `JsonSerializerOptions` | Global policy; already configured in `WebSocketHost.JsonOptions` and `KargadanPlugin.JsonOptions` |
| C# exhaustive dispatch | `switch` on discriminant string | LanguageExt `[Union]` with generated `.Switch()` | Compiler-enforced exhaustiveness; no missing case at runtime |
| C# string enum validation | Manual string comparison | Thinktecture `[SmartEnum<string>]` with `.TryGet()` | Generated validation, Map exhaustive dispatch, no invalid states |

**Key insight:** The TS side needs aggressive reduction (26 exports -> 2-3 root schemas + inline derivation). The C# side is already well-factored into value objects, smart enums, models, and envelopes -- it needs field alignment and possibly minor consolidation but NOT a full rewrite.

## Common Pitfalls

### Pitfall 1: Breaking imports cascade
**What goes wrong:** Deleting `packages/types/src/kargadan/kargadan-schemas.ts` breaks 4 TS files and the `packages/types` package.json exports entry simultaneously.
**Why it happens:** The import path `@parametric-portal/types/kargadan` is wired in socket.ts, dispatch.ts, checkpoint.ts, config.ts, and agent-loop.ts. The package.json has the entry point, and vite.config.ts has the build alias.
**How to avoid:** Delete the file AND the package.json export entry AND the vite.config entry in the same operation. Then update all 5 consumer imports in one pass.
**Warning signs:** `pnpm exec nx run kargadan-harness:typecheck` fails with "module not found" -- this is expected during rebuild.

### Pitfall 2: _tag naming policy interaction
**What goes wrong:** Someone configures `JsonPolymorphic(TypeDiscriminatorPropertyName = "_tag")` and the discriminator breaks because `PropertyNameCaseInsensitive` does NOT apply to discriminator matching.
**Why it happens:** System.Text.Json discriminator matching is case-sensitive and NOT affected by `PropertyNameCaseInsensitive` (confirmed in dotnet/runtime#86028). Since `_tag` is already lowercase, CamelCase naming policy does not transform it. But if someone changes to `Tag` or `type`, it would break.
**How to avoid:** Do NOT use `[JsonPolymorphic]` attributes. Keep manual JSON construction with `_tag` literal. The current pattern already works correctly.
**Warning signs:** Deserialization fails with `System.NotSupportedException` about discriminator not found.

### Pitfall 3: Schema composition order matters for S.Union
**What goes wrong:** A union member with `_tag: S.Literal('handshake.ack')` is placed after a more general member and never matches.
**Why it happens:** `S.Union` evaluates members in definition order. If a general member (like one with `_tag: S.String`) appears first, it catches everything.
**How to avoid:** Place most specific members first in `S.Union`. The existing code already does this correctly with `HandshakeEnvelopeSchema` (itself a union of init/ack/reject) first.
**Warning signs:** Decode succeeds but returns wrong variant type.

### Pitfall 4: Orphaned types after schema deletion
**What goes wrong:** Types like `Kargadan.CommandOperation` or `Kargadan.FailureClass` are used in type annotations throughout agent-loop.ts and dispatch.ts. After deleting the schema file, these become undefined.
**Why it happens:** The `Kargadan` namespace exports 26 type aliases derived from schemas. Consumers use both schema access (`Kargadan.CommandEnvelopeSchema`) and type access (`Kargadan.CommandEnvelope`).
**How to avoid:** Catalogue every type usage BEFORE deletion. Replace `Kargadan.X` type references with `typeof XSchema.Type` inline at each usage site.
**Warning signs:** `typecheck` fails with "Namespace 'Kargadan' has no exported member" errors.

### Pitfall 5: RunEvent/RunSnapshot/RetrievalArtifact are persistence schemas, not protocol schemas
**What goes wrong:** Lumping persistence schemas with protocol envelope schemas into a single root schema when they have different domains and lifecycles.
**Why it happens:** The legacy file mixes protocol envelope schemas (Handshake, Command, Result, Event, Heartbeat) with persistence orchestration schemas (RunEvent, RunSnapshot, RetrievalArtifact) and execution detail schemas (ScriptResult, EventBatchSummary).
**How to avoid:** Recognize 3 natural groupings: (1) Protocol envelopes -- for dispatch.ts, (2) Persistence orchestration -- for checkpoint.ts, (3) Execution details -- for agent-loop.ts and config.ts. This maps to 2-3 canonical root schemas.
**Warning signs:** A single root schema with 15+ fields that combines unrelated domains.

## Code Examples

### Example 1: Root Protocol Schema (dispatch.ts)

```typescript
// --- [SCHEMA] ----------------------------------------------------------------

const TelemetryContextSchema = S.Struct({
    attempt:      S.Int.pipe(S.greaterThanOrEqualTo(1)),
    operationTag: S.NonEmptyTrimmedString,
    spanId:       S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
    traceId:      S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)),
})

const EnvelopeIdentitySchema = S.Struct({
    appId:           S.UUID,
    issuedAt:        S.DateFromString,
    protocolVersion: S.Struct({ major: S.Int.pipe(S.greaterThanOrEqualTo(0)), minor: S.Int.pipe(S.greaterThanOrEqualTo(0)) }),
    requestId:       S.UUID,
    runId:           S.UUID,
    sessionId:       S.UUID,
})

// Envelope variants share identity + telemetry; _tag discriminates
const CommandEnvelopeSchema = S.Struct({
    _tag:             S.Literal('command'),
    deadlineMs:       S.Int.pipe(S.greaterThan(0)),
    idempotency:      S.optional(S.Struct({ idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)), payloadHash: S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)) })),
    identity:         EnvelopeIdentitySchema,
    objectRefs:       S.optional(S.Array(S.Struct({ objectId: S.UUID, sourceRevision: S.Int.pipe(S.greaterThanOrEqualTo(0)), typeTag: S.Literal('Brep', 'Mesh', 'Curve', 'Surface', 'Annotation', 'Instance', 'LayoutDetail') }))),
    operation:        S.Literal('read.scene.summary', 'read.object.metadata', 'read.object.geometry', 'read.layer.state', 'read.view.state', 'read.tolerance.units', 'write.object.create', 'write.object.update', 'write.object.delete', 'write.layer.update', 'write.viewport.update', 'write.annotation.update', 'script.run'),
    payload:          S.Unknown,
    telemetryContext: TelemetryContextSchema,
    undoScope:        S.optional(S.NonEmptyTrimmedString),
})

// Inline type derivation (no separate type declaration needed)
// Usage: typeof CommandEnvelopeSchema.Type
```

### Example 2: Inline Derivation at Call Site

```typescript
// In config.ts -- derive CommandOperation literal schema inline
const _resolveLoopOperations = _env.loopOperations.pipe(
    Effect.map(_splitCsv),
    Effect.flatMap((operations) =>
        S.decodeUnknown(S.Array(S.Literal(
            'read.scene.summary', 'read.object.metadata', 'read.object.geometry',
            'read.layer.state', 'read.view.state', 'read.tolerance.units',
            'write.object.create', 'write.object.update', 'write.object.delete',
            'write.layer.update', 'write.viewport.update', 'write.annotation.update',
            'script.run',
        )))(operations)),
)
```

### Example 3: Persistence Schema Colocation (checkpoint.ts)

```typescript
// --- [SCHEMA] ----------------------------------------------------------------

const RunEventSchema = S.Struct({
    appId:            S.UUID,
    createdAt:        S.DateFromSelf,
    eventId:          S.UUID,
    eventType:        S.NonEmptyTrimmedString,
    idempotency:      S.optional(S.Struct({ idempotencyKey: S.String.pipe(S.pattern(/^[A-Za-z0-9:_-]{8,128}$/)), payloadHash: S.String.pipe(S.pattern(/^[a-f0-9]{64}$/)) })),
    payload:          S.Unknown,
    requestId:        S.UUID,
    runId:            S.UUID,
    sequence:         S.Int.pipe(S.greaterThanOrEqualTo(1)),
    sessionId:        S.UUID,
    telemetryContext: S.Struct({ attempt: S.Int.pipe(S.greaterThanOrEqualTo(1)), operationTag: S.NonEmptyTrimmedString, spanId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)), traceId: S.String.pipe(S.pattern(/^[A-Fa-f0-9]{8,64}$/)) }),
})
```

## Discriminant Field Analysis: _tag vs type

### Recommendation: Keep `_tag` [HIGH confidence]

**Evidence for `_tag`:**
1. Effect ecosystem convention -- `Data.TaggedError`, `Data.TaggedEnum`, `Data.taggedEnum()` all use `_tag` as their discriminant field
2. `Match.tag()` and `Match.valueTags()` read `_tag` by convention -- using a different name requires custom matcher configuration
3. The codebase already uses `_tag` in all 15+ wire format touchpoints (TS and C#)
4. `_tag` avoids collision with JavaScript's `typeof` semantics and any future `type` fields on payloads
5. The underscore prefix signals "metadata, not domain data" -- clear semantic distinction

**Evidence against `type`:**
1. `type` is a TypeScript reserved word in certain contexts (type declarations, generic constraints)
2. `type` collides with `objectType` / `eventType` domain fields already in the protocol
3. Changing from `_tag` to `type` would require updating all 15+ C# serialization sites, all TS Match.tag usages, all Schema.Literal('...') definitions
4. No ecosystem benefit -- Effect does not use `type` anywhere as a convention

**System.Text.Json interaction:**
- `_tag` is NOT affected by `JsonNamingPolicy.CamelCase` (CamelCase only transforms PascalCase -> camelCase; underscore-prefixed names pass through unchanged)
- Confirmed via codebase: `WebSocketHost.JsonOptions` and `KargadanPlugin.JsonOptions` both use `PropertyNamingPolicy = JsonNamingPolicy.CamelCase`
- C# serializes `_tag = "event"` in anonymous objects; the policy does NOT rename it
- TypeDiscriminatorPropertyName matching is case-sensitive per dotnet/runtime#86028 -- but irrelevant since we are NOT using `[JsonPolymorphic]` attributes

**Decision: `_tag` is the correct and only viable choice. Zero migration cost. Full Effect ecosystem alignment.**

## Schema Consolidation Strategy

### Current Surface (26 exports from kargadan-schemas.ts)

| Category | Schemas | Lines | Consumers |
|----------|---------|-------|-----------|
| Protocol Envelopes | HandshakeEnvelopeSchema, CommandEnvelopeSchema, ResultEnvelopeSchema, EventEnvelopeSchema, HeartbeatEnvelopeSchema, CommandAckSchema | ~70 | socket.ts, dispatch.ts |
| Shared Fragments | EnvelopeIdentitySchema, TelemetryContextSchema, ProtocolVersionSchema, FailureReasonSchema, IdempotencySchema, SceneObjectRefSchema, FailureClassSchema, SceneObjectTypeSchema | ~30 | dispatch.ts (inline construction), config.ts (validation) |
| Execution Details | CommandOperationSchema, CommandExecutionModeSchema, CommandCategorySchema, EventTypeSchema, EventSubtypeSchema, ScriptResultSchema, EventBatchSummarySchema, SubtypeCountSchema, CategoryCountSchema | ~30 | agent-loop.ts (decode batch), config.ts (validate operations) |
| Persistence | RunEventSchema, RunSnapshotSchema, RetrievalArtifactSchema, RunStatusSchema, ArtifactTypeSchema | ~30 | checkpoint.ts |
| Union Wrappers | InboundEnvelopeSchema, OutboundEnvelopeSchema | ~6 | socket.ts |

### Target Surface (3 natural groupings -> 2-3 root schemas)

| Root | Home File | Contains | Consumers |
|------|-----------|----------|-----------|
| Protocol | dispatch.ts | Envelopes (Handshake, Command, Result, Event, Heartbeat) + shared fragments (Identity, Telemetry, FailureReason, Idempotency) + unions (Inbound, Outbound) + CommandAck | socket.ts, agent-loop.ts, config.ts |
| Persistence | checkpoint.ts | RunEvent, RunSnapshot, RetrievalArtifact + inline RunStatus, ArtifactType | agent-loop.ts (via checkpoint service) |
| Execution Literals | Inline at call sites | CommandOperation, EventType, EventSubtype, SceneObjectType, etc. | config.ts, agent-loop.ts |

**Observation:** Category 3 (execution literals) does not need a standalone root schema. `S.Literal(...)` expressions are self-contained and should be inlined wherever used. This means **2 root schemas** (Protocol + Persistence) with all literal types inlined.

### Consumer Dependency Map (Pre-Deletion)

| Consumer File | Imports Used | Strategy |
|---------------|-------------|----------|
| `socket.ts` | InboundEnvelopeSchema, OutboundEnvelopeSchema, EventEnvelope (type), InboundEnvelope (type) | Move schemas to dispatch.ts; socket.ts imports from dispatch.ts |
| `dispatch.ts` | HandshakeEnvelope (type), CommandEnvelope (type), EnvelopeIdentity (type), FailureClass (type), OutboundEnvelope (type) | Root protocol schemas live here; types derived inline |
| `checkpoint.ts` | RetrievalArtifactSchema, RunEventSchema, RunSnapshotSchema, RunEvent (type), RunSnapshot (type), RetrievalArtifact (type) | Root persistence schemas live here; types derived inline |
| `config.ts` | ProtocolVersionSchema, CommandOperationSchema | Inline S.Literal at validation call sites; import ProtocolVersionSchema from dispatch.ts |
| `agent-loop.ts` | CommandEnvelope (type), CommandOperation (type), EnvelopeIdentity (type), EventBatchSummarySchema, EventEnvelope (type), FailureReason (type), HeartbeatEnvelope (type), ProtocolVersion (type), ResultEnvelope (type), RunStatusSchema, TelemetryContext (type) | Import types from dispatch.ts; decode EventBatchSummary inline |

### C# Contract Files (No Structural Changes Needed)

| File | LOC | Purpose | Phase 3 Action |
|------|-----|---------|----------------|
| ProtocolEnvelopes.cs | 116 | Envelope records + [Union] DUs | Review field name alignment only |
| ProtocolModels.cs | 178 | Structs + records with validation factories | Review field name alignment only |
| ProtocolEnums.cs | 156 | SmartEnum definitions | No changes (string keys already match TS literals) |
| ProtocolValueObjects.cs | 102 | Branded value objects | No changes |
| DomainBridge.cs | 36 | Generic parsing bridge | No changes |
| Require.cs | 66 | Validation rules + patterns | No changes |

**C# SmartEnum keys already match TS S.Literal values exactly** (e.g., `CommandOperation.SceneSummary.Key` = `"read.scene.summary"`, `EventType.ObjectsChanged.Key` = `"objects.changed"`). No casing misalignment exists.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Barrel file schema exports | Colocated schemas in consumer files | Effect 3.x convention | No barrel files; each file owns its schemas |
| `S.omit` / `S.pick` as standalone functions | Instance methods on Struct: `schema.pick(...)`, `schema.omit(...)` | Effect 3.17+ | Chainable, better type inference |
| `optional` + `partial` overloaded | Split into `optional`/`optionalWith` + `partial`/`partialWith` | Effect 3.17+ (Schema 0.69 release) | Cleaner pipe composition |
| `@effect/schema` standalone package | Schema module merged into `effect` core | Effect 3.x | Import from `effect` directly: `import { Schema as S } from 'effect'` |

**Deprecated/outdated:**
- `@effect/schema` as standalone package: merged into `effect` core; import `{ Schema as S } from 'effect'`
- `Schema.optionalWith({ as: 'Option' })` syntax: now `Schema.optional(schema, { as: 'Option' })`

## Open Questions

1. **Shared literal duplication between dispatch.ts and config.ts**
   - What we know: `CommandOperationSchema` literals (`'read.scene.summary'`, etc.) are used in both dispatch.ts (command envelope) and config.ts (loop operation validation)
   - What's unclear: Whether to share the literal array via a `const` or duplicate it
   - Recommendation: Define the `S.Literal(...)` once in dispatch.ts as part of CommandEnvelopeSchema; config.ts references it as `CommandEnvelopeSchema.fields.operation`. This avoids duplication without creating a separate export.

2. **TelemetryContext reuse across Protocol and Persistence schemas**
   - What we know: Both envelope schemas and persistence schemas (RunEvent) include identical TelemetryContext structure
   - What's unclear: Whether to extract TelemetryContextSchema as a shared const or inline it in both places
   - Recommendation: Define once in dispatch.ts (natural home for protocol primitives); persistence schemas in checkpoint.ts import it. This is the one cross-file schema reference that is justified.

## Sources

### Primary (HIGH confidence)
- [Effect Schema Basic Usage](https://effect.website/docs/schema/basic-usage/) - Union, Literal, Struct, _tag convention
- [Effect Schema Advanced Usage](https://effect.website/docs/schema/advanced-usage/) - extend, property signatures, composition
- [Effect Schema Projections](https://effect.website/docs/schema/projections/) - typeSchema, encodedSchema
- [System.Text.Json Polymorphism](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) - TypeDiscriminatorPropertyName, JsonPolymorphic attribute
- [dotnet/runtime#86028](https://github.com/dotnet/runtime/issues/86028) - PropertyNameCaseInsensitive does NOT apply to TypeDiscriminatorPropertyName

### Secondary (MEDIUM confidence)
- [Effect Schema 0.69 Release](https://effect.website/blog/releases/schema/069/) - optional/partial API split, pick/omit type refinements
- [Schema.ts API Reference](https://effect-ts.github.io/effect/effect/Schema.ts.html) - pick, omit, partial, extend signatures
- [Effect Data.ts Reference](https://effect-ts.github.io/effect/effect/Data.ts.html) - TaggedEnum, _tag convention

### Tertiary (LOW confidence)
- None. All findings verified against official sources and codebase inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in workspace with exact pinned versions
- Architecture: HIGH -- patterns derived from actual codebase inspection of 15+ files; Effect docs confirm composition APIs
- Pitfalls: HIGH -- all 5 pitfalls derived from concrete code analysis (import paths, serialization behavior, schema ordering)
- Discriminant analysis: HIGH -- `_tag` verified against Effect docs, codebase grep (15+ usage sites), and System.Text.Json docs

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable -- Effect 3.19 and System.Text.Json in net10.0 are mature)
