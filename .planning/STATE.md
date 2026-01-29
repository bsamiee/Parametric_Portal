# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** Apps deploy multi-pod with zero coordination code
**Current focus:** Phase 2 - Context Integration

## Current Position

Phase: 2 of 8 (Context Integration)
Plan: 0 of TBD in current phase
Status: Research complete, ready to plan
Last activity: 2026-01-29 - Phase 2 research complete

Progress: [##--------] 12%

## Performance Metrics

**Velocity:**
- Total plans completed: 3
- Average duration: 17 min
- Total execution time: 0.83 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-cluster-foundation | 3 | 50min | 17min |

**Recent Trend:**
- Last 5 plans: 01-01 (12min), 01-02 (~30min), 01-03 (8min)
- Trend: Stable (01-02 was larger scope)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: 8 phases derived from 18 requirements with comprehensive depth
- [Roadmap]: Phase 7 consolidates SSE, WebSocket, and Webhook (all real-time delivery)
- [Research]: Gut + replace jobs.ts confirmed (Entity dispatch incompatible with poll-based queue)
- [Revision]: Old code adjusts to fit new patterns (not vice versa) - explicit cross-cutting
- [Revision]: No if/else chains - Match.type required for control flow in Phases 4, 6
- [01-01]: Schema.TaggedError for ClusterError (RPC boundary serialization)
- [01-01]: Single ClusterError with reason discriminant (11 variants)
- [01-01]: Match.value(error.reason) pattern for exhaustive error handling
- [01-02]: Dedicated PgClient for RunnerStorage (advisory lock stability)
- [01-02]: Transport polymorphism via dispatch table (auto/socket/http/websocket)
- [01-02]: EntityState with pendingSignal for DurableDeferred compatibility
- [01-03]: ClusterMetrics gauges auto-provided by Sharding - no duplication needed
- [01-03]: App-specific metrics: counters for messages/errors, histograms for latency/lifetime
- [01-03]: trackCluster uses e.reason for error type discrimination
- [02-Research]: Use official `ShardId` class from @effect/cluster (not branded string)
- [02-Research]: ShardId has Equal/Hash protocols - use directly in ClusterState interface
- [02-Research]: `ShardId.toString()` / `fromString()` for serialization boundary
- [02-Research]: RunnerId as branded string from `Snowflake.toString()`
- [02-Research]: `isLeader` updated dynamically via `Context.Request.withinCluster` on singleton entry
- [02-Research]: Extend existing `Context.Serializable` class (not separate cluster serializable)
- [02-Research]: ClusterState uses `null` (not Option) for internal optionality - simpler nesting

### Pending Todos

None yet.

### Blockers/Concerns

From research and revision feedback - must address during execution:

**Resolved in Phase 1:**
- ~~[Phase 1]: Advisory locks require stable DB connections~~ [ADDRESSED: dedicated PgClient for RunnerStorage]
- ~~[Phase 1]: Entity mailbox overflow risk~~ [ADDRESSED: mailboxCapacity:100 explicit]
- ~~[Phase 1]: `preemptiveShutdown: true` for K8s~~ [ADDRESSED: configured in ShardingConfigLive]
- ~~[Phase 1]: `ClusterError` type guards~~ [ADDRESSED: Match.value(error.reason) pattern]
- ~~[Phase 8]: ClusterMetrics integration~~ [ADDRESSED: trackCluster utility with e.reason labeling]

**Open for future phases:**
- [Phase 3]: `skipIfOlderThan` for ClusterCron to prevent accumulated job burst after downtime
- [Phase 3]: Singleton external state must be DB-backed (not in-memory Effect state)
- [Phase 4]: In-flight job migration during deployment - validate via staging
- [Phase 4]: `defectRetryPolicy` with exponential+jitter via Schedule.compose
- [Phase 5]: Transactional outbox via Activity.make + DurableDeferred (now explicit pattern)
- [Phase 6]: Compensation handlers MUST wrap in Activity.make
- [Phase 6]: Machine state schemas derive types (no separate declarations)
- [Phase 6]: Workflow schema versioning for long-running workflows
- [Phase 7]: RpcGroup as shared contract in packages/shared
- [Phase 7]: RpcMiddleware.Tag for auth context (no manual header parsing)
- [Phase 8]: Effect.timeout on readiness checks to prevent K8s probe failures

## Session Continuity

Last session: 2026-01-29
Stopped at: Phase 1 complete, ready to transition to Phase 2
Resume file: None
