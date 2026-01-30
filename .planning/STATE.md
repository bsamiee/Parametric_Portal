# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-28)

**Core value:** Apps deploy multi-pod with zero coordination code
**Current focus:** Phase 4 - Job Processing

## Current Position

Phase: 4 of 8 (Job Processing)
Plan: 2 of 4 in current phase
Status: In progress
Last activity: 2026-01-30 - Completed 04-02-PLAN.md

Progress: [######----] 67%

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 8 min
- Total execution time: 1.6 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-cluster-foundation | 3 | 50min | 17min |
| 02-context-integration | 2 | 8min | 4min |
| 03-singleton-scheduling | 3 | 22min | 7min |
| 04-job-processing | 2 | 18min | 9min |

**Recent Trend:**
- Last 5 plans: 03-02 (8min), 03-03 (6min), 04-01 (6min), 04-02 (12min)
- Trend: Consistent execution pace

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
- [02-Plan]: `_makeRunnerId` inlined into `Request.makeRunnerId` static method (single usage site)
- [02-Plan]: `_clusterDefault` inlined into `withinCluster` via Option.getOrElse (single usage site)
- [02-Plan]: `updateCluster` pattern not needed — `withinCluster` covers all practical cases
- [02-Plan]: `enterEntityScope` deferred to Phase 3+ (useful for nested call metrics, not Phase 2 scope)
- [02->03]: Entity handlers wrap with `withinCluster({ entityId, entityType, shardId })` — Phase 3 success criteria #10
- [02->03]: Singleton handlers wrap with `withinCluster({ isLeader: true })` — Phase 3 success criteria #11
- [Refinement]: Phase 3 singleton adds typed state persistence + heartbeat health tracking
- [Refinement]: Phase 4 jobs adds priority, deduplication, DLQ, cancellation, status query
- [Refinement]: Phase 8 uses auto-exported effect_cluster_* gauges (no manual integration)
- [02-01]: ClusterContextRequired local error (avoids circular import)
- [02-01]: Accessor named 'clusterState' not 'cluster' (TypeScript class conflict)
- [02-01]: String(snowflake) for conversion (Snowflake has no toString method)
- [02-01]: Type imports only for ShardId/Snowflake (namespace type references)
- [02-02]: Effect.serviceOption(Sharding.Sharding) for graceful degradation
- [02-02]: Span annotation with cluster.runner_id for trace correlation
- [02-02]: S.optional for backward compatible Serializable extension
- [03-01]: Data.TaggedError for SingletonError (not Schema.TaggedError) - internal errors don't cross RPC
- [03-01]: PlatformError.SystemError with reason 'Unknown' for SqlError mapping
- [03-01]: Layer.effect pattern for KeyValueStore to access SqlClient dependency
- [03-02]: Effect.repeat(Schedule.recurWhile) for condition-based shutdown detection (Effect.repeatWhile doesn't exist)
- [03-02]: Local variable binding (stateOpts) for type narrowing in closures (non-null assertions rejected by linter)
- [03-02]: Error tags BadArgument, ParseError, SystemError for KeyValueStore.SchemaStore operations
- [03-03]: withinCluster wraps ENTIRE handler (gen body + ensuring + matchCauseEffect) for complete context propagation
- [03-03]: DateTime.distanceDuration for Duration-based staleness calculation
- [03-03]: ClusterService static exports for health check utilities (Phase 8 integration)
- [04-01]: listPending uses page() method with keyset pagination (find() lacks limit/order options)
- [04-01]: error_history stored as JSONB array with CHECK constraint validation
- [04-02]: Schema.TaggedError for JobError (RPC boundary serialization requires schema)
- [04-02]: primaryKey uses crypto.randomUUID() fallback for non-idempotent jobs
- [04-02]: FiberMap.get with catchTag pattern (returns Effect, not Option)
- [04-02]: dlqAt: undefined for auto-generation via Model.DateTimeInsertFromDate

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

**Resolved in Phase 2:**
- ~~[02-01]: Circular import from cluster.ts~~ [ADDRESSED: local ClusterContextRequired error]
- ~~[02-02]: Middleware cluster context population~~ [ADDRESSED: Effect.serviceOption graceful degradation]

**Resolved in Phase 3:**
- ~~[Phase 3]: Singleton state persistence via KeyValueStore.layerSchema~~ [ADDRESSED: _kvStoreLayers in 03-01]
- ~~[Phase 3]: Heartbeat gauge pattern for dead man's switch health integration~~ [ADDRESSED: checkSingletonHealth in 03-03]

**Resolved in Phase 3:**
- ~~[Phase 3]: `skipIfOlderThan` for ClusterCron to prevent accumulated job burst after downtime~~ [ADDRESSED: cron factory includes skipIfOlderThan config option in 03-02]

**Resolved in Phase 4 Research:**
- ~~[Phase 4]: Priority scheduling pattern — weighted mailbox or external scheduler~~ [ADDRESSED: Entity-prefix routing with pool sizing (4:3:2:1); no official priority mailbox API exists]
- ~~[Phase 4]: Dead-letter table schema and retry exhaustion flow~~ [ADDRESSED: Schedule.onDecision + ScheduleDecision.isDone for exhaustion detection; terminal errors immediate DLQ]
- ~~[Phase 4]: Job cancellation via Effect.interrupt — validate entity handles gracefully~~ [ADDRESSED: Effect.onInterrupt for cancel cleanup + Effect.uninterruptible for critical sections + FiberMap.remove atomic]
- ~~[Phase 4]: Machine.makeSerializable for job state~~ [ADDRESSED: NO - JobState too simple; use Schema.Class + Ref pattern; reserve Machine for Phase 6 sagas]

**Resolved in Phase 4 Plan 1:**
- ~~[Phase 4]: JobDlq database infrastructure~~ [ADDRESSED: Model.Class, repo methods, SQL migration with RLS in 04-01]

**Resolved in Phase 4 Plan 2:**
- ~~[Phase 4]: Entity-based job dispatch~~ [ADDRESSED: JobEntity with mailbox routing, priority pools, FiberMap tracking]

**Open for future phases:**
- [Phase 4]: In-flight job migration during deployment - validate via staging
- [Phase 5]: Verify Ndjson.pack/unpackSchema API exists in @effect/cluster 0.56.1
- [Phase 5]: Verify EventLog.schema API exists for optional event sourcing
- [Phase 5]: Transactional outbox via Activity.make + DurableDeferred
- [Phase 6]: Research Machine.makeSerializable integration with Entity pattern
- [Phase 6]: Verify VariantSchema API in @effect/experimental current version
- [Phase 6]: Compensation handlers MUST wrap in Activity.make
- [Phase 6]: Machine state schemas derive types (no separate declarations)
- [Phase 7]: Verify Entity.fromRpcGroup API for shared RPC contracts
- [Phase 7]: RpcGroup as shared contract in packages/shared
- [Phase 7]: RpcMiddleware.Tag for auth context (no manual header parsing)
- [Phase 8]: Effect.timeout on readiness checks to prevent K8s probe failures
- [Phase 8]: Singleton dead man's switch feeds into readiness probe

## Session Continuity

Last session: 2026-01-30
Stopped at: Completed 04-02-PLAN.md
Resume file: None
