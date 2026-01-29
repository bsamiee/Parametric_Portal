# Phase 2: Context Integration - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Request handlers access shard ID, runner ID, and leader status via standard Context.Request pattern. Middleware populates context; handlers consume. No new cluster capabilities — this phase wires existing cluster state into the request context.

</domain>

<decisions>
## Implementation Decisions

### Context Availability
- Cluster context is **explicitly required** — handlers fail if cluster service unavailable
- Use `ClusterError` with 'Unavailable' reason variant (extends Phase 1 ClusterError)
- Local dev runs **single-node cluster mode** — real shard assignment, not mocks
- Tests must provide cluster context via appropriate layer

### Leader Detection
- `isLeader` = true when this pod hosts the active **Singleton instance**
- Leader acquisition mid-request: research whether @effect/cluster API supports this idiomatically — if yes, include; if workaround-ish, skip
- Freshness and access pattern: Claude's discretion based on Effect idioms

### Serialization Scope
- **All fields** propagate across pod boundaries: shardId, runnerId, isLeader
- **Extend existing** Context.Serializable class — add cluster fields to current structure
- For isLeader across boundaries: research **dual representation** pattern (e.g., `{ originLeader, localLeader }`) — include if API supports cleanly
- Serialization format: Claude's discretion based on existing Context.Serializable patterns

### Handler Ergonomics
- Access via **nested property**: `context.cluster.shardId`, `context.cluster.runnerId`, `context.cluster.isLeader`
- **No convenience accessors** — single way to access cluster context
- Type is **required always**: `cluster: ClusterState` — middleware guarantees presence, handlers don't check
- `ClusterState` as **Schema.Class** — branded fields, serializable, Equal/Hash protocols

### Claude's Discretion
- Test layer design (configurable layer vs mock service)
- Leader freshness strategy (request-scoped cache vs always-fresh)
- isLeader access pattern (boolean property vs Effect-wrapped check)
- Serialization format (JSON vs Schema-encoded)
- Whether dual leader representation is feasible with @effect/cluster API

</decisions>

<specifics>
## Specific Ideas

- User expressed interest in Dual-like pattern for leader status — having both original sender's leader status and local pod's leader status accessible in one structure, not two separate paradigms
- Strong preference for idiomatic @effect/cluster patterns over workarounds — "if this is industry-best practice/capable via the API (truthfully) - then yes, otherwise no"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-context-integration*
*Context gathered: 2026-01-29*
