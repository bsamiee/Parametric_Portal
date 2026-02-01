# Phase 5: EventBus & Reliability - Context

**Gathered:** 2026-01-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Typed domain events publish reliably with at-least-once delivery and automatic deduplication. EventBus replaces `StreamingService.channel()` for cross-pod pub/sub. Transactional outbox via Activity.make + DurableDeferred.

**In scope:**
- Domain events with typed contracts via VariantSchema
- At-least-once delivery with event-level deduplication
- Transactional outbox pattern (emit + write in same transaction)
- `StreamingService.channel()` deprecation → `EventBus.subscribe()`
- Integration with existing cluster.ts, context.ts, resilience.ts

**Out of scope:**
- Workflows/sagas (Phase 6)
- WebSocket/SSE delivery (Phase 7)
</domain>

<decisions>
## Implementation Decisions

### Event Schema Design
- Single polymorphic VariantSchema for all domain events — NOT individual Schema.TaggedRequest per event
- Domain.Action format naming: `user.created`, `order.placed` (dot-notation hierarchy)
- Full payload (fat events) — subscribers don't need to fetch; event contains all data
- Event location: `packages/server/src/events/` — server-only concern
- Schema-level versioning via `S.optional` for backward compatibility — NOT version suffix in tag

### Event Metadata
- eventId (UUID v7) contains timestamp — NO discrete timestamp field
- Include correlationId + causationId for trace context
- aggregateVersion NOT included — events are immutable facts, version tracking is subscriber concern
- Single envelope approach — metadata injected at emit, NOT base class extension
- Research advanced VariantSchema patterns for dense, non-verbose code

### Event Grouping
- Claude's Discretion: Domain-grouped vs flat with prefix

### Reference Pattern
- Research modern professional standards congruent with dense/polymorphic single shapes
- Evaluate AWS EventBridge, Kafka patterns for best fit

### Subscription API
- Leverage @effect/cluster broadcaster API fully — refactor cluster.ts if needed
- Type-safe subscription with algorithmic matching from VariantSchema types
- Single dense/intelligent polymorphic object for emit → subscribe link

### Subscription Durability
- Durable by default — subscriptions persist, resume from last offset on restart
- Opt-OUT durability modifier available for ephemeral subscriptions

### Ordering & Distribution
- Single dense polymorphic object handles all aggregation with internal intelligence
- Research unified distribution method that handles fan-out + competing consumers automatically
- Consumers shouldn't need to specify .compete() vs .fanout() — EventBus determines

### Subscription Filtering
- Unified filter function integrated into shared object import
- Composable filtering, not verbose `EventBus.subscribe(UserCreated, e => e.role === 'admin')`
- Filter types derive from VariantSchema — type is available by default, beyond-type filtering composable

### Replay Capability
- Replay supported — integrated with database UUID timestamp + offset capabilities
- Reference: `packages/database/migrations/`, `models.ts`, `factory.ts`, `repos.ts`

### Backpressure & Rate Limiting
- Refactor `packages/server/src/utils/resilience.ts` for agnostic rate-limiting capability
- Add "event" or "action" agnostic terminology
- Add cap capability + per "X" capability for polymorphic/algorithmic rate control
- Integrate improved resilience.ts into EventBus

### Subscription Health
- Research cluster.ts + cache.ts + event/rpc API for appropriate solution
- Consider existing functionality before adding new patterns

### Deduplication
- Event-level idempotency key — duplicates detected and skipped by EventBus
- Dedupe window: Claude's Discretion based on API capabilities + pg18.1 features
- Research SQL-side integration for holistic approach

### Storage & Delivery Timing
- Outbox pattern: emit + write in same transaction
- Also persisted for replay capability
- Async delivery after commit
- Research advanced Effect async capabilities + pg18.1 for combined approach

### Transactional Commit
- Auto-publish on transaction commit — NO explicit EventBus.flush() call

### Delivery Metadata
- Claude's Discretion: include attemptCount/firstDeliveryAt in envelope or keep internal

### Retry & DLQ
- Capped retries then dead-letter
- Integrate into resilience.ts refactoring — agnostic capped concept with dead-letter integration
- Reference: audit.ts has similar patterns

### Priority Delivery
- Yes — use official import value/object directly, no re-wrapping custom levels

### Batching
- **CRITICAL:** One function handles all arities — NO emit/emitBatch split
- Auto-batch within configurable window
- Single events work without ceremony/different methodology
- Polymorphic: single or array, same function

### Failure Categorization
- Retryable vs Terminal errors
- Terminal errors bypass resilience, dead-letter immediately
- Integrate universally with resilience.ts — no separate/loose retry logic

### DLQ Storage
- Unified DLQ table with jobs (from Phase 4)
- Refactor fields to flatten semantic differentiation
- Single discriminating source, leverage pg18.1

### DLQ Replay
- Both automatic + manual retry
- Automatic: opt-in with configurable delay, integrated with resilience.ts
- Manual: single agnostic function in repos.ts

### Error Propagation
- Research async write + transmit integration
- Advanced SQL/pg18.1 capabilities for polymorphic function
- Effect native capabilities for awaiting acknowledgment

### Claude's Discretion
- Event grouping (domain-grouped vs flat)
- Dedupe window duration
- Delivery metadata visibility
- Subscription health cleanup strategy
- Best professional reference pattern for dense/polymorphic design
</decisions>

<specifics>
## Specific Ideas

**Core Philosophy (stated multiple times):**
- "One properly made VariantSchema — we CANNOT have loose const or derivations"
- "100% of experimental effect for VariantSchema to do this properly — one polymorphic, well-made VariantSchema"
- "Single dense, polymorphic object/shape that handles all aggregation with control — internal intelligence"
- "Do NOT want single/batch capability, just always have it be intelligent, auto-batch, configurable window"
- "One function handles all arities, No `get`/`getMany`, `emit`/`emitBatch`"

**Integration Points:**
- Research quality must match `.planning/phases/03-singleton-scheduling/03-RESEARCH.md` and `.planning/phases/04-job-processing/04-RESEARCH.md`
- Refactor resilience.ts with agnostic terminology + cap + per-X capabilities
- Unified DLQ table — refactor Phase 4's job_dlq schema

**Database References:**
- `packages/database/migrations/` (2 files)
- `packages/database/src/models.ts`
- `packages/database/src/factory.ts`
- `packages/database/src/repos.ts`
- pg18.1 UUID v7 timestamp integration

**Existing Code to Review:**
- cluster.ts — broadcaster API, transport
- cache.ts — existing patterns
- context.ts — request context
- middleware.ts — population patterns
- audit.ts — DLQ/replay patterns
- resilience.ts — rate limiting refactor target
</specifics>

<prerequisite>
## Prerequisite: Full Runner Layer Migration

**Issue:** Current cluster.ts uses `SocketRunner.layerClientOnly` / `HttpRunner.layerClient` which are client-only layers for sending messages. The API server hosts entities (ClusterEntity, JobEntity) which requires full runner layers that provide `CurrentAddress` at entity activation time.

**Current State:**
- `_transports.auto` uses `SocketRunner.layerClientOnly`
- `_transports.http` uses `HttpRunner.layerClient`
- Entity.toLayer handlers yield `Entity.CurrentAddress` — not available with client-only layers
- main.ts Layer.launch produces Effect with unsatisfied `Sharding | CurrentAddress | ShardingConfig` requirements

**Required Fix (do as part of Phase 5 Plan 01):**
1. Import `NodeSocketServer` from `@effect/platform-node`
2. Change `SocketRunner.layerClientOnly` → `SocketRunner.layer`
3. Add `NodeSocketServer.layer({ port: configurable })` as dependency
4. Update `HttpRunner.layerClient` → `HttpRunner.layer` equivalently
5. Use `Layer.provideMerge` instead of `Layer.provide` to expose Sharding/ShardingConfig
6. Update main.ts to include ClusterService.Layer in ServicesLayer

**Reference:** `.planning/phases/04-job-processing/04-RESEARCH.md` section 10 (Runner Layers)
</prerequisite>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope
</deferred>

---

*Phase: 05-eventbus-reliability*
*Context gathered: 2026-01-31*
