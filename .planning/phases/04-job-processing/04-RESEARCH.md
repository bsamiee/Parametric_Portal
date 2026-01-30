# Phase 4: Job Processing - Research

**Researched:** 2026-01-30
**Domain:** @effect/cluster Entity-based job dispatch, priority scheduling, deduplication, dead-letter handling
**Confidence:** HIGH

## Summary

Phase 4 replaces the poll-based job queue in jobs.ts with Entity-based message dispatch. The current implementation uses `SELECT FOR UPDATE SKIP LOCKED` with a poll loop (1-10 second intervals), which wastes resources and adds latency. Entity mailboxes provide instant dispatch with consistent-hash routing, removing the need for DB polling entirely.

The architecture follows the ClusterEntity pattern established in Phase 1-3: `Entity.make("Job", [...])` with typed RPC messages, `defectRetryPolicy` for transient failures, and `Context.Request.withinCluster` for cluster context propagation. Priority scheduling requires external coordination since @effect/cluster mailboxes are FIFO by default — the recommended pattern is priority-weighted entity routing where different priority levels route to different entity pools.

**Primary recommendation:** Create a JobEntity with polymorphic messages (`submit`, `status`, `cancel`), use `Rpc.make({ primaryKey })` for deduplication via optional `dedupeKey`, implement priority as weighted routing to priority-specific entity pools, and leverage `Entity.keepAlive` for batch jobs exceeding `maxIdleTime`. DLQ is a separate DB table with `replayJob` capability.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/cluster` | 0.56.1 | Entity sharding, message dispatch | Official Effect cluster package, SqlMessageStorage persistence |
| `effect` | 3.19.15 | Core runtime, Schedule, Match, Schema, Ref | Foundation for all Effect code |
| `@effect/sql-pg` | 0.50.1 | PostgreSQL for job_dlq table | Already in catalog, consistent with existing repos |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/rpc` | 0.73.0 | RPC protocol with primaryKey deduplication | Already used for Entity message contracts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Entity mailbox dispatch | Keep poll-based queue | Polling wastes CPU, adds 1-10s latency vs instant dispatch |
| Weighted entity routing | Single mailbox with priority reordering | @effect/cluster mailboxes are FIFO; external priority needed |
| DB-based DLQ table | Redis dead-letter queue | DB aligns with existing job schema, enables replay without data migration |

**Installation:**
All packages already in pnpm-workspace.yaml catalog. No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/infra/
├── cluster.ts           # ClusterService (unchanged from Phase 1-3)
└── jobs.ts              # JobService (gut + replace, Entity-based dispatch)

packages/database/src/
├── models.ts            # Add JobDlq model
└── repos.ts             # Add jobDlq repo methods
```

### Pattern 1: Job Entity with Polymorphic Messages
**What:** Single Job entity handling submit, status, and cancel operations
**When to use:** All job processing flows
**Example:**
```typescript
// Source: Phase 1 ClusterEntity pattern + CONTEXT.md decisions
const JobPayload = S.Struct({
  type: S.String,
  payload: S.Unknown,
  priority: S.optional(S.Literal('high', 'normal', 'low')),
  dedupeKey: S.optional(S.String),
  batchId: S.optional(S.String),
});
const JobStatusResponse = S.Struct({
  status: S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled'),
  attempts: S.Number,
  history: S.Array(S.Struct({ status: S.String, timestamp: S.Number, error: S.optional(S.String) })),
  result: S.optional(S.Unknown),
});

const JobEntity = Entity.make("Job", [
  Rpc.make("submit", {
    payload: JobPayload,
    success: S.Struct({ jobId: S.String }),
    error: JobError,
    primaryKey: (p) => p.dedupeKey ?? crypto.randomUUID(), // Deduplication via primaryKey
  }),
  Rpc.make("status", { payload: S.Struct({ jobId: S.String }), success: JobStatusResponse }),
  Rpc.make("cancel", { payload: S.Struct({ jobId: S.String }), success: S.Void, error: JobError }),
]);
```

### Pattern 2: Priority-Weighted Entity Routing
**What:** Route jobs to priority-specific entity IDs for weighted scheduling
**When to use:** Jobs with high/normal/low priority levels
**Example:**
```typescript
// Source: Distributed Weighted Round-Robin research + @effect/cluster patterns
const _priorityWeights = { critical: 4, high: 3, normal: 2, low: 1 } as const;
const _priorityQueues = {
  critical: Array.from({ length: 4 }, (_, i) => `job-critical-${i}`),
  high: Array.from({ length: 3 }, (_, i) => `job-high-${i}`),
  normal: Array.from({ length: 2 }, (_, i) => `job-normal-${i}`),
  low: ['job-low-0'],
} as const;

const routeByPriority = (priority: keyof typeof _priorityWeights) => {
  const pool = _priorityQueues[priority];
  return pool[Math.floor(Math.random() * pool.length)]; // Random within priority pool
};

// Higher priority = more entity instances = more parallel capacity
const submit = (payload: JobPayload) =>
  client(routeByPriority(payload.priority ?? 'normal')).submit(payload);
```

### Pattern 3: Entity.keepAlive for Long-Running Jobs
**What:** Prevent entity deactivation during batch processing
**When to use:** Jobs exceeding `maxIdleTime` (5 minutes default)
**Example:**
```typescript
// Source: Entity.ts API research + EntityResource documentation
const JobEntityLive = JobEntity.toLayer(Effect.gen(function*() {
  const currentAddress = yield* Entity.CurrentAddress;
  return {
    submit: ({ type, payload }) => Effect.gen(function*() {
      const estimatedDuration = estimateJobDuration(type);
      // Enable keepAlive for jobs exceeding idle threshold
      yield* Effect.when(
        Entity.keepAlive(true),
        () => estimatedDuration > Duration.toMillis(_CONFIG.entity.maxIdleTime)
      );
      // ... job processing
      yield* Entity.keepAlive(false); // Disable after completion
    }),
  };
}), {
  maxIdleTime: Duration.minutes(5),
  concurrency: 1,
  mailboxCapacity: 100,
  defectRetryPolicy: _retryPolicy,
});
```

### Pattern 4: Deduplication via Rpc.make primaryKey
**What:** SqlMessageStorage checks primaryKey, returns existing result for duplicates
**When to use:** Jobs with optional `dedupeKey` field
**Example:**
```typescript
// Source: SqlMessageStorage research + @effect/cluster docs
// Rpc.make primaryKey enables SqlMessageStorage deduplication
Rpc.make("submit", {
  payload: JobPayload,
  success: JobResult,
  primaryKey: (p) => p.dedupeKey ?? p.jobId, // Unique per job or dedupe key
});

// SqlMessageStorage.saveRequest returns Success | Duplicate
// Duplicate case returns original request ID + last reply
// Entity handler receives deduplicated requests only
```

### Pattern 5: Dead-Letter Queue with Replay
**What:** Failed jobs move to job_dlq table after max retries; replayable
**When to use:** Jobs exceeding maxAttempts or with unrecoverable errors
**Example:**
```typescript
// Source: CONTEXT.md decisions + existing repos.ts patterns
// DLQ table: original job data + error history + replay metadata
const JobDlq = Model.Class('JobDlq')({
  id: Model.Generated(S.UUID),
  originalJobId: S.UUID,
  appId: S.UUID,
  type: S.String,
  payload: Model.JsonFromString(S.Unknown),
  attempts: S.Number,
  errorHistory: Model.JsonFromString(S.Array(S.Struct({ error: S.String, timestamp: S.Number }))),
  failedAt: S.DateFromSelf,
  replayedAt: Model.FieldOption(S.DateFromSelf),
});

// Replay moves DLQ entry back to queue, preserving history
const replayJob = (dlqId: string) => Effect.gen(function*() {
  const dlqEntry = yield* db.jobDlq.get(dlqId);
  yield* client(routeByPriority('normal')).submit({
    type: dlqEntry.type,
    payload: dlqEntry.payload,
    // Original job metadata preserved for audit trail
  });
  yield* db.jobDlq.set(dlqId, { replayedAt: new Date() });
});
```

### Pattern 6: Effect.interrupt for Job Cancellation
**What:** Cancel in-flight jobs via fiber interruption
**When to use:** `JobService.cancel(jobId)` API
**Example:**
```typescript
// Source: Effect Fibers documentation + Entity handler patterns
const JobEntityLive = JobEntity.toLayer(Effect.gen(function*() {
  const runningJobs = yield* Ref.make(HashMap.empty<string, Fiber.RuntimeFiber<void, JobError>>());
  return {
    submit: ({ jobId, type, payload }) => Effect.gen(function*() {
      const fiber = yield* processJob(type, payload).pipe(
        Effect.onInterrupt(() => Effect.logInfo('Job cancelled', { jobId })),
        Effect.fork,
      );
      yield* Ref.update(runningJobs, HashMap.set(jobId, fiber));
      yield* Fiber.join(fiber);
      yield* Ref.update(runningJobs, HashMap.remove(jobId));
    }),
    cancel: ({ jobId }) => Ref.get(runningJobs).pipe(
      Effect.flatMap((map) => Option.match(HashMap.get(map, jobId), {
        onNone: () => Effect.fail(new JobError({ reason: 'NotFound' })),
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      })),
    ),
  };
}));
```

### Anti-Patterns to Avoid
- **Poll loops for job claiming:** Entity mailboxes provide instant dispatch; polling wastes resources
- **In-memory priority queues:** Lost on pod restart; use Entity routing for weighted scheduling
- **`SELECT FOR UPDATE SKIP LOCKED`:** Replaced by shard-based message routing
- **Separate submit/submitBatch APIs:** Single polymorphic submit handles `T | readonly T[]`
- **Ignoring `maxIdleTime`:** Long jobs need `Entity.keepAlive` or they deactivate mid-processing

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job deduplication | Manual Redis/DB lookup | `Rpc.make({ primaryKey })` | SqlMessageStorage returns Duplicate automatically |
| Message persistence | Custom DB queue | `SqlMessageStorage.layer` | Built-in at-least-once delivery |
| Priority scheduling | Manual reordering in mailbox | Weighted entity pool routing | Mailboxes are FIFO; external routing achieves priority |
| Job cancellation | Custom cancel flag polling | `Effect.interrupt` + Fiber reference | Fiber model handles cleanup automatically |
| Retry backoff | Custom delay calculation | `resilience.ts` patterns | Already has exponential + jitter + cap |
| Status tracking | DB polling for status | `Ref` in Entity state + RPC query | In-memory state, persisted via SqlMessageStorage |

**Key insight:** The existing `resilience.ts` module provides production-ready retry patterns — use `Resilience.schedules.default` or compose with `Schedule.intersect` for job-specific policies. Don't reinvent backoff logic.

## Common Pitfalls

### Pitfall 1: Mailbox FIFO Blocks Priority Processing
**What goes wrong:** High-priority jobs wait behind low-priority jobs in same entity mailbox.
**Why it happens:** @effect/cluster mailboxes process messages in FIFO order.
**How to avoid:** Route jobs to priority-specific entity pools (more instances for higher priority). Critical jobs get 4 entities, high gets 3, normal gets 2, low gets 1.
**Warning signs:** High-priority job latency equals low-priority latency.

### Pitfall 2: Long-Running Jobs Deactivate Mid-Processing
**What goes wrong:** Entity shuts down after `maxIdleTime` while job still processing.
**Why it happens:** `maxIdleTime: Duration.minutes(5)` triggers deactivation even during active processing.
**How to avoid:** Call `Entity.keepAlive(true)` at start of long jobs, disable after completion. For batch jobs, track estimated duration and enable keepAlive conditionally.
**Warning signs:** Jobs fail with interruption errors after ~5 minutes.

### Pitfall 3: Duplicate Job Submissions Without dedupeKey
**What goes wrong:** Same job submits multiple times, executes multiple times.
**Why it happens:** Fire-and-forget pattern without idempotency key.
**How to avoid:** Always provide `dedupeKey` for jobs that must be idempotent. `primaryKey` in Rpc.make uses this for SqlMessageStorage deduplication.
**Warning signs:** Duplicate side effects, double-processing in logs.

### Pitfall 4: Validation Errors Retry Instead of DLQ
**What goes wrong:** ParseError jobs retry forever, never reaching DLQ.
**Why it happens:** Generic retry policy catches all errors including validation.
**How to avoid:** Skip retries for `ParseError`/`ValidationError` tags — DLQ immediately. Use `Effect.catchTag` to route validation errors directly to dead-letter.
**Warning signs:** Jobs stuck in pending with ParseError, retry count climbing.

### Pitfall 5: JobService Interface Changes
**What goes wrong:** Existing callers break when jobs.ts is replaced.
**Why it happens:** New Entity-based API uses different method signatures.
**How to avoid:** Preserve `JobService.enqueue(type, payload, opts)` signature exactly. New implementation wraps Entity dispatch internally. Success criteria requires unchanged interface.
**Warning signs:** Compile errors in files importing JobService.

### Pitfall 6: Missing Transaction Rollback on Job Failure
**What goes wrong:** Partial side effects persist when job fails mid-execution.
**Why it happens:** Job handlers don't wrap in database transaction.
**How to avoid:** Use `Context.Request.withinSync` which wraps in SQL transaction. Auto-rollback on Effect failure.
**Warning signs:** Inconsistent data states after job failures.

## Code Examples

### Complete JobEntity Setup (Dense Style)
```typescript
// Source: Phase 1 patterns + CONTEXT.md decisions + resilience.ts integration
import { Entity, Rpc, Sharding, SqlMessageStorage } from '@effect/cluster';
import { Duration, Effect, HashMap, Metric, Option, Ref, Schedule, Schema as S } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Resilience } from '../utils/resilience.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const JobPayload = S.Struct({
  batchId: S.optional(S.String),
  dedupeKey: S.optional(S.String),
  payload: S.Unknown,
  priority: S.optional(S.Literal('critical', 'high', 'normal', 'low')),
  type: S.String,
});
const JobStatus = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
const JobStatusResponse = S.Struct({
  attempts: S.Number,
  history: S.Array(S.Struct({ error: S.optional(S.String), status: JobStatus, timestamp: S.Number })),
  result: S.optional(S.Unknown),
  status: JobStatus,
});

// --- [ERRORS] ----------------------------------------------------------------

class JobError extends S.TaggedError<JobError>()('JobError', {
  cause: S.optional(S.Unknown),
  reason: S.Literal('NotFound', 'AlreadyCancelled', 'HandlerMissing', 'Validation', 'Processing'),
}) {}

// --- [ENTITY] ----------------------------------------------------------------

const JobEntity = Entity.make("Job", [
  Rpc.make("submit", {
    error: JobError,
    payload: JobPayload,
    primaryKey: (p) => p.dedupeKey ?? crypto.randomUUID(),
    success: S.Struct({ jobId: S.String }),
  }),
  Rpc.make("status", { payload: S.Struct({ jobId: S.String }), success: JobStatusResponse }),
  Rpc.make("cancel", { error: JobError, payload: S.Struct({ jobId: S.String }), success: S.Void }),
]);
```

### JobService Facade (Interface Preservation)
```typescript
// Source: CONTEXT.md requirement - interface unchanged for existing callers
class JobService extends Effect.Service<JobService>()('server/Jobs', {
  dependencies: [ClusterService.Layer],
  scoped: Effect.gen(function* () {
    const sharding = yield* Sharding.Sharding;
    const getClient = yield* sharding.makeClient(JobEntity);
    const handlers = yield* Ref.make(HashMap.empty<string, JobService.Handler>());
    const metrics = yield* MetricsService;

    // Priority routing: more entity instances for higher priority
    const _pools = { critical: 4, high: 3, low: 1, normal: 2 } as const;
    const routeByPriority = (p: keyof typeof _pools) =>
      `job-${p}-${Math.floor(Math.random() * _pools[p])}`;

    // Polymorphic submit: single job or batch array
    const submit = <T>(type: string, payloads: T | readonly T[], opts?: {
      delay?: Duration.Duration;
      maxAttempts?: number;
      priority?: 'critical' | 'high' | 'low' | 'normal';
    }) => Effect.gen(function* () {
      const items = Array.isArray(payloads) ? payloads : [payloads];
      const priority = opts?.priority ?? 'normal';
      const batchId = items.length > 1 ? crypto.randomUUID() : undefined;

      const results = yield* Effect.forEach(items, (payload) =>
        getClient(routeByPriority(priority)).submit({
          batchId,
          payload,
          priority,
          type,
        }).pipe(Effect.map((r) => r.jobId)),
        { concurrency: 'unbounded' }
      );

      yield* MetricsService.inc(metrics.jobs.enqueued, MetricsService.label({ priority, type }), items.length);
      return Array.isArray(payloads) ? results : results[0];
    });

    return {
      cancel: (jobId: string) => getClient(jobId).cancel({ jobId }),
      registerHandler: (type: string, handler: JobService.Handler) =>
        Ref.update(handlers, HashMap.set(type, handler)),
      status: (jobId: string) => getClient(jobId).status({ jobId }),
      submit,
    };
  }),
}) {}

namespace JobService {
  export type Handler = (payload: unknown) => Effect.Effect<void, unknown, never>;
}
```

### Metrics Integration (job.* namespace)
```typescript
// Source: CONTEXT.md success criteria #12 + existing MetricsService patterns
// Add to MetricsService in observe/metrics.ts
jobs: {
  completions: Metric.counter('jobs_completed_total'),
  deadLettered: Metric.counter('jobs_dead_lettered_total'),
  dlqSize: Metric.gauge('jobs_dlq_size'),              // NEW: DLQ depth
  duration: Metric.timerWithBoundaries('jobs_duration_seconds', _boundaries.jobs),
  enqueued: Metric.counter('jobs_enqueued_total'),
  failures: Metric.counter('jobs_failed_total'),
  processingSeconds: Metric.timerWithBoundaries('jobs_processing_seconds', _boundaries.jobs), // NEW
  queueDepth: Metric.gauge('jobs_queue_depth'),
  retries: Metric.counter('jobs_retried_total'),
  waitDuration: Metric.timerWithBoundaries('jobs_wait_duration_seconds', _boundaries.jobs),
}
```

### DLQ Table Schema
```sql
-- Source: CONTEXT.md decisions + existing jobs table pattern
CREATE TABLE job_dlq (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    original_job_id UUID NOT NULL,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE RESTRICT,
    type TEXT NOT NULL,
    payload JSONB NOT NULL,
    attempts INTEGER NOT NULL,
    error_history JSONB NOT NULL, -- Array of { error, timestamp }
    failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    replayed_at TIMESTAMPTZ,
    CONSTRAINT job_dlq_error_history_array CHECK (jsonb_typeof(error_history) = 'array')
);

CREATE INDEX idx_job_dlq_app ON job_dlq(app_id) WHERE replayed_at IS NULL;
CREATE INDEX idx_job_dlq_type ON job_dlq(type) WHERE replayed_at IS NULL;
CREATE INDEX idx_job_dlq_failed ON job_dlq(failed_at) WHERE replayed_at IS NULL;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `SELECT FOR UPDATE SKIP LOCKED` | Entity mailbox dispatch | Phase 4 | Eliminates poll latency, reduces DB load |
| DB row as queue | SqlMessageStorage persistence | @effect/cluster | Built-in durability, deduplication |
| Manual retry with _delay function | `Resilience.schedules` + `defectRetryPolicy` | Phase 4 | Unified retry patterns across codebase |
| `onStatusChange` via pg.listen | Entity state + RPC query | Phase 4 | No separate postgres listener needed |
| Semaphore for concurrency | Entity `concurrency` option | Phase 4 | Per-entity concurrency control |

**Deprecated/outdated:**
- `db.jobs.claimBatch()`: Replaced by Entity message routing
- `Circuit` wrapper in job processing: `defectRetryPolicy` handles transient failures
- `poll` loop with `Schedule.spaced`: Instant dispatch via mailbox
- `_delay` function: Use `Resilience.schedules.default`

## Open Questions

### 1. Priority Scheduling Implementation
- What we know: @effect/cluster mailboxes are FIFO; no built-in priority support
- What's unclear: Optimal entity pool sizing for priority levels
- Recommendation: Start with ratio 4:3:2:1 (critical:high:normal:low), tune based on job metrics

### 2. Entity.keepAlive Duration Tracking
- What we know: `Entity.keepAlive(true)` prevents deactivation; must disable when done
- What's unclear: How to automatically detect job completion for disabling
- Recommendation: Wrap job handler in Effect that ensures `keepAlive(false)` in finalizer

### 3. Batch Atomicity Semantics (Claude's Discretion)
- What we know: All jobs in batch get shared batchId
- What's unclear: Should batch fail atomically or allow partial success?
- Recommendation: Partial success — each job independent, batchId for correlation only

### 4. Job Result Storage
- What we know: `status().result` should return completed job results
- What's unclear: How long to retain results, storage mechanism
- Recommendation: Store in Entity state (SqlMessageStorage), 7-day TTL matches CONTEXT.md decision

### 5. DLQ Replay Rate Limiting
- What we know: `replayJob(dlqId)` moves job back to queue
- What's unclear: Should replay have rate limiting to prevent thundering herd?
- Recommendation: Use normal priority for replays, no special rate limiting

## Sources

### Primary (HIGH confidence)
- [Entity.ts documentation](https://effect-ts.github.io/effect/cluster/Entity.ts.html) - toLayer options, keepAlive, CurrentAddress
- [Rpc.ts documentation](https://effect-ts.github.io/effect/cluster/Rpc.ts.html) - primaryKey deduplication mechanism
- [SqlMessageStorage source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/SqlMessageStorage.ts) - saveRequest returns Success | Duplicate
- [Effect Fibers documentation](https://effect.website/docs/concurrency/fibers/) - interrupt, join, fiber lifecycle
- [Effect 3.19 Release Notes](https://effect.website/blog/releases/effect/319/) - Cluster updates, RunnerStorage

### Secondary (MEDIUM confidence)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world Entity patterns, workflow deduplication
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Entity configuration, storage backends
- [Distributed Weighted Round-Robin](https://www.researchgate.net/publication/221643481) - Priority scheduling algorithm research

### Codebase (HIGH confidence)
- `/packages/server/src/infra/jobs.ts` - Current poll-based implementation (to be replaced)
- `/packages/server/src/infra/cluster.ts` - Phase 1-3 ClusterEntity pattern, withinCluster
- `/packages/server/src/utils/resilience.ts` - Retry schedules, circuit breaker integration
- `/packages/server/src/observe/metrics.ts` - MetricsService.label, counter/gauge patterns
- `/packages/server/src/context.ts` - Context.Request.withinSync, withinCluster
- `/packages/database/src/repos.ts` - Existing job repo methods (claimBatch, deadLetter)
- `/packages/database/src/models.ts` - Job model structure
- `.planning/phases/01-cluster-foundation/01-RESEARCH.md` - Entity.toLayer options, defectRetryPolicy
- `.planning/research/INTEGRATION.md` - Jobs migration strategy, Effect.fn patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, versions verified
- Architecture patterns: HIGH - Verified against Phase 1-3 patterns and official docs
- Priority scheduling: MEDIUM - Weighted routing is standard pattern; optimal sizing needs tuning
- Entity.keepAlive: MEDIUM - API confirmed in source; exact usage pattern from docs
- DLQ schema: HIGH - Follows existing repo patterns, standard audit trail design
- Pitfalls: HIGH - Based on existing jobs.ts analysis + Entity documentation

**Research date:** 2026-01-30
**Valid until:** 2026-02-28 (30 days - stable package, active development)
