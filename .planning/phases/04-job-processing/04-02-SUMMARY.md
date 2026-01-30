---
phase: 04-job-processing
plan: 02
subsystem: job-processing
tags: [entity, rpc, cluster, jobs, mailbox]
requires: [04-01]
provides:
  - JobService with Entity-based dispatch
  - JobEntity with submit/status/progress/cancel RPCs
  - Schema.TaggedError JobError for RPC serialization
  - JobContext for handler context injection
affects: [04-03, 04-04, 06-saga-orchestration]
tech-stack:
  added: []
  patterns: [Entity mailbox dispatch, priority-based routing, FiberMap job tracking]
key-files:
  created: []
  modified: [packages/server/src/infra/jobs.ts]
decisions:
  - Schema.TaggedError for JobError (RPC boundary serialization requires schema)
  - primaryKey uses crypto.randomUUID() fallback for non-idempotent jobs
  - FiberMap.get with catchTag pattern (returns Effect, not Option)
  - dlqAt: undefined for auto-generation via Model.DateTimeInsertFromDate
metrics:
  duration: 12min
  completed: 2026-01-30
---

# Phase 4 Plan 2: Entity-Based Job Queue Summary

**Entity-based JobService with instant consistent-hash routing, replacing poll-based queue with @effect/cluster mailbox dispatch**

## Performance

- Duration: 12 minutes
- Tasks completed: 4/4 (combined into single implementation)
- Lines of code: 170 (target was <275)

## Accomplishments

- Complete jobs.ts rewrite with Entity mailbox dispatch
- JobEntity with 4 RPCs: submit, status, progress (streaming), cancel
- Schema.TaggedError for JobError (required for RPC serialization)
- JobContext with jobId, priority, reportProgress for handler injection
- Telemetry.span wraps processJob for distributed tracing
- Context.Request.tenantId used for DLQ tenant isolation
- Entity.keepAlive toggling for long-duration jobs (beyond 5min idle timeout)
- Fiber.interrupt + cancellations metric in cancel handler
- Schedule.collectAllInputs accumulates retry errors for DLQ history
- validateBatch with mode: 'validate' for parallel validation (no fail-fast)
- Priority-based routing with weighted pools (4:3:2:1 ratio)
- Single export pattern: JobService (const + namespace merge)

## Commits

1. **Task 1-4: Complete jobs.ts rewrite** - `aa28026` (feat)

## Key Implementation Details

### Entity Definition
```typescript
const JobEntity = Entity.make('Job', [
  Rpc.make('submit', { error: JobError, payload: JobPayload.fields, primaryKey, success }),
  Rpc.make('status', { payload, success: JobStatusResponse }),
  Rpc.make('progress', { payload, stream: true, success }),
  Rpc.make('cancel', { error: JobError, payload, success: S.Void }),
]);
```

### Priority Routing
```typescript
const _CONFIG = {
  pools: { critical: 4, high: 3, normal: 2, low: 1 } as const,
};
const routeByPriority = (p) => `job-${p}-${n % _CONFIG.pools[p]}`;
```

### DLQ Integration
- Uses Context.Request.tenantId for appId (not hardcoded)
- dlqAt: undefined triggers Model.DateTimeInsertFromDate auto-generation
- replayedAt, requestId, userId use Option.none() for optional fields

### Cancel Handler
```typescript
cancel: FiberMap.get(runningJobs, jobId).pipe(
  Effect.catchTag('NoSuchElementException', () => Effect.fail(JobError.fromNotFound(jobId))),
  Effect.flatMap((fiber) => Effect.gen(function* () {
    yield* Fiber.interrupt(fiber);
    yield* Metric.increment(metrics.jobs.cancellations);
  })),
);
```

## Deviations from Plan

### [Rule 3 - Blocking] Schema.TaggedError vs Data.TaggedError

- **Found during:** Task 1 (Entity definition)
- **Issue:** Plan used Data.TaggedError for JobError, but Rpc.make `error` parameter requires Schema.TaggedError for RPC boundary serialization
- **Fix:** Changed `class JobError extends Data.TaggedError` to `class JobError extends S.TaggedError<JobError>()`
- **Rationale:** RPC errors cross the serialization boundary, unlike SingletonError (03-01) which stays internal

### [Rule 3 - Blocking] primaryKey return type

- **Found during:** Task 2 (Entity RPC setup)
- **Issue:** Plan showed `primaryKey: (p) => p.dedupeKey ?? null` but Rpc.make requires string return type
- **Fix:** Changed to `p.dedupeKey ?? crypto.randomUUID()` for non-idempotent job uniqueness
- **Rationale:** Without dedupeKey, each job should be unique (no deduplication)

### [Rule 3 - Blocking] FiberMap.get API

- **Found during:** Task 3 (cancel handler)
- **Issue:** Plan showed FiberMap.get returning Option, but actual API returns Effect<Fiber, NoSuchElementException>
- **Fix:** Changed from `Option.match(fiberOpt, {...})` to `Effect.catchTag('NoSuchElementException', ...)`
- **Files modified:** packages/server/src/infra/jobs.ts

### [Rule 3 - Blocking] JobDlq insert signature

- **Found during:** Task 3 (DLQ insert)
- **Issue:** Model.DateTimeInsertFromDate for dlqAt requires explicit undefined for auto-generation
- **Fix:** Added `dlqAt: undefined` to insert call
- **Rationale:** TypeScript requires explicit property for Overrideable fields

## Next Phase Readiness

- [x] JobService facade available with submit/enqueue/cancel/status/replay methods
- [x] registerHandler allows job type handlers to be added
- [x] Priority routing distributes load across entity pool
- [x] Progress streaming via progress RPC with stream: true
- [x] DLQ integration with tenant isolation

Ready for Phase 4 Plan 3 (Job Metrics Extension).
