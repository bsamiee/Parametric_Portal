# Phase 3: Singleton & Scheduling - Context

**Gathered:** 2026-01-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Leader election, cluster cron for scheduled tasks, and singleton state persistence with health tracking. Delivers exactly-once execution guarantees, automatic state persistence across leader migrations, and dead man's switch integration for K8s readiness probes. Not wrappers — intelligent coordination that handles state handoff across leader migrations.

</domain>

<decisions>
## Implementation Decisions

### State Persistence
- State saves to DB on every change (immediate durability, no periodic flush)
- Best-effort schema decode: load matching fields, use defaults for new fields, drop unknown
- If decode fails (corruption/incompatible schema), fall back to initial state — singleton runs with fresh state
- State loads from DB on leader startup (no "fresh start" option)

### Health & Dead Man's Switch
- Fixed 30s heartbeat interval regardless of execution frequency
- Staleness threshold: 2x heartbeat interval (60s) — singleton unhealthy if no heartbeat
- Unhealthy singleton causes pod readiness failure (strict health guarantee)
- 2x interval grace period on startup before enforcing staleness (prevents startup flapping)

### Scheduling Behavior
- Allow concurrent executions — jobs must be idempotent (no overlap prevention)
- No default timeout — jobs run until completion, caller manages timeouts
- Cron failures: integrate with existing `packages/server/src/utils/resilience.ts` patterns (circuit breaker, retry policies)

### Leader Migration
- In-flight work persists via DurableDeferred checkpoints — new leader can resume mid-execution
- Migration SLA: within 10s after leader death detection (aggressive takeover)
- Split-brain prevention via DB advisory locks (Phase 1 foundation, no additional lease)
- Lifecycle hooks: `onBecomeLeader` + `onLoseLeadership` for explicit setup/cleanup

### Claude's Discretion
- State load behavior on new leader (always load vs configurable fresh start)
- Missed cron execution handling (skipIfOlderThan semantics)
- Technical implementation of DurableDeferred checkpoint integration

</decisions>

<specifics>
## Specific Ideas

- Leverage existing `resilience.ts` utilities for cron failure handling — don't reinvent circuit breaker patterns
- Aggressive 10s migration target requires faster heartbeat detection than default @effect/cluster settings
- State persistence on every change aligns with "never lose work" philosophy from discussions

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-singleton-scheduling*
*Context gathered: 2026-01-29*
