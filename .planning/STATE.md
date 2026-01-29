# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** Apps deploy multi-pod with zero coordination code
**Current focus:** Phase 1 - Cluster Foundation

## Current Position

Phase: 1 of 8 (Cluster Foundation)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-01-29 - Completed 01-01-PLAN.md

Progress: [#---------] 4%

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: 12 min
- Total execution time: 0.2 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-cluster-foundation | 1 | 12min | 12min |

**Recent Trend:**
- Last 5 plans: 01-01 (12min)
- Trend: N/A (first plan)

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

### Pending Todos

None yet.

### Blockers/Concerns

From research and revision feedback - must address during execution:

- [Phase 1]: Advisory locks require stable DB connections - dedicated connection for RunnerStorage (now explicit criterion)
- [Phase 1]: Entity mailbox overflow risk - set explicit `mailboxCapacity` in toLayer options
- [Phase 1]: `preemptiveShutdown: true` required for K8s graceful shutdown
- [Phase 1]: `ClusterError` type guards - no `instanceof` checks [ADDRESSED in 01-01]
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
- [Phase 8]: ClusterMetrics must integrate with existing MetricsService.label pattern
- [Phase 8]: Effect.timeout on readiness checks to prevent K8s probe failures

## Session Continuity

Last session: 2026-01-29
Stopped at: Completed 01-01-PLAN.md
Resume file: None
