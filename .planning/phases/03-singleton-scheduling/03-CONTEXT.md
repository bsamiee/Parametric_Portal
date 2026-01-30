# Phase 3: Singleton & Scheduling - Context

**Gathered:** 2026-01-29
**Updated:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Leader election, cluster cron for scheduled tasks, and singleton state persistence with health tracking. Delivers exactly-once execution guarantees, automatic state persistence across leader migrations, and dead man's switch integration for K8s readiness probes. Not wrappers — intelligent coordination that handles state handoff across leader migrations. Pre-wired factories from Phase 1 (`ClusterService.singleton()`, `ClusterService.cron()`) extended with state/health capabilities.

</domain>

<decisions>
## Implementation Decisions

### State Persistence
- Execution metadata only (last run time, run count, last error) — system-managed
- State saves to DB on every change (immediate durability, no periodic flush)
- Configurable TTL per singleton — auto-cleanup after expiry
- Best-effort schema decode: load matching fields, use defaults for new fields, drop unknown
- If decode fails (corruption/incompatible schema), fall back to initial state — singleton runs with fresh state
- State loads from DB on leader startup (no "fresh start" option)
- Storage: Research dual-approach (Postgres + Redis write-through) against existing `cache.ts` and `cluster.ts` patterns; implement canonical professional approach backed by official documentation

### Health & Dead Man's Switch
- Heartbeat-based dead man's switch — unhealthy if no execution in 2x expected interval
- Fixed 30s heartbeat interval regardless of execution frequency
- Staleness threshold: 2x heartbeat interval (60s) — singleton unhealthy if no heartbeat
- Unhealthy singleton causes pod readiness failure (strict health guarantee)
- No grace period after leader migration — health check applies immediately

### Scheduling Behavior
- Allow concurrent executions — jobs must be idempotent (no overlap prevention)
- No default timeout — jobs run until completion, caller manages timeouts
- Cron failures: integrate with existing `packages/server/src/utils/resilience.ts` patterns (circuit breaker, retry policies)
- Backlog after downtime: Claude decides based on `skipIfOlderThan` and @effect/cluster API
- Schedule configuration: Claude decides based on industry standard and @effect/cluster runtime configuration capabilities

### Leader Migration
- In-flight work persists via DurableDeferred checkpoints — new leader can resume mid-execution
- Migration SLA: within 10s after leader death detection (aggressive takeover)
- Split-brain prevention via DB advisory locks (Phase 1 foundation, no additional lease)
- Lifecycle hooks: `onBecomeLeader` + `onLoseLeadership` for explicit setup/cleanup

### Context Propagation
- Entity handlers automatically wrap execution with `withinCluster` — context always available
- Automatic span attributes for observability — shardId, runnerId, entityId auto-added to all spans
- Snowflake generator always available in singleton scope

### Claude's Discretion
- Exact storage implementation (Postgres vs Redis vs dual) based on research findings
- `skipIfOlderThan` default value based on @effect/cluster API
- Cron overlap policy based on professional industry standards
- Cron schedule runtime configurability based on Effect ecosystem capabilities
- Technical implementation of DurableDeferred checkpoint integration

</decisions>

<specifics>
## Specific Ideas

- Leverage existing `resilience.ts` utilities for cron failure handling — don't reinvent circuit breaker patterns
- Aggressive 10s migration target requires faster heartbeat detection than default @effect/cluster settings
- State persistence on every change aligns with "never lose work" philosophy from discussions
- Storage decision requires research into: PostgreSQL 18.1+ features, Redis integration patterns, existing `cache.ts` write-through behavior, and official @effect/cluster KeyValueStore API
- Research needed for industry-standard cron overlap handling (likely skip-if-running)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-singleton-scheduling*
*Context gathered: 2026-01-29*
