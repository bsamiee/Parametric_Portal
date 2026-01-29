# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** Apps deploy multi-pod with zero coordination code
**Current focus:** Phase 1 - Cluster Foundation

## Current Position

Phase: 1 of 8 (Cluster Foundation)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-01-28 — Roadmap revised with expanded success criteria

Progress: [----------] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

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

### Pending Todos

None yet.

### Blockers/Concerns

From research and revision feedback - must address during execution:

- [Phase 1]: Advisory locks require stable DB connections - dedicated connection for RunnerStorage (now explicit criterion)
- [Phase 1]: Entity mailbox overflow risk - set explicit `mailboxCapacity` in toLayer options
- [Phase 1]: `preemptiveShutdown: true` required for K8s graceful shutdown
- [Phase 1]: `ClusterError` type guards - no `instanceof` checks
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

Last session: 2026-01-28
Stopped at: Roadmap revised with expanded success criteria
Resume file: None
