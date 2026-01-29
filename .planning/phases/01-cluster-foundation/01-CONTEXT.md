# Phase 1: Cluster Foundation - Context

**Gathered:** 2026-01-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Multi-pod coordination via @effect/cluster. Entity sharding, shard ownership via advisory locks, distributed message routing. Infrastructure layer that enables all downstream phases. No UI, no user-facing behavior — pure backend coordination.

Scope: CLUS-01, CLUS-02 from REQUIREMENTS.md.

</domain>

<decisions>
## Implementation Decisions

### Entity design
- **Polymorphic approach** — Single entity type with union message types, routed via `Match.type`. Not domain-specific entity proliferation.
- **Snowflake IDs** — Opaque Snowflake IDs for entity routing. Full context (tenant, domain) passed via `Context.Request` (Phase 2 extends this). Sharding routes by Snowflake; context carries metadata separately.
- **Single facade** — `ClusterService` namespace merges all cluster ops (send/broadcast/singleton) under one import. Consumers use one import, not separate Entity/Sharding/Singleton.
- **Discriminator pattern** — Claude investigates existing discriminator patterns in middleware/telemetry and chooses `Schema.TaggedRequest` vs custom discriminator based on what aligns with current codebase conventions.

### Error surfacing
- **Surgical integration** — ClusterError handling follows existing patterns in `circuit.ts`, `telemetry.ts`, `metrics.ts`, `middleware.ts`, `context.ts`. No new error handling paradigm.
- **Transient vs permanent** — Claude determines professional approach based on existing resilience patterns. No workarounds or hybrid approaches.
- **Telemetry** — Errors surface via existing telemetry/context/metrics/middleware patterns. Both structured spans and log events per current conventions.
- **Metrics by error type** — Fine-grained counters per ClusterError variant (e.g., `cluster_error_total{type="MailboxFull"}`). Enables alerting per error type.

### Claude's Discretion
- Exact discriminator field choice (`_tag` vs custom) based on codebase research
- Transient vs permanent error classification based on resilience pattern analysis
- Internal implementation details of ClusterService facade
- Technical choices within <225 LOC constraint

</decisions>

<specifics>
## Specific Ideas

- "Polymorphic + algorithmic functional programming code" — single function handles all arities, no `get`/`getMany` splits
- "Single facade" — one ClusterService import for all cluster operations
- "Surgical" error integration — follows existing patterns, no new paradigms
- Must align with REQUIREMENTS.md quality standards: <225 LOC, single `const + namespace` merge, branded types, no if/else chains

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-cluster-foundation*
*Context gathered: 2026-01-28*
