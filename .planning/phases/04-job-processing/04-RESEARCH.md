# Phase 4: Job Processing - Research

**Researched:** 2026-01-30
**Implemented:** 2026-01-30
**Domain:** @effect/cluster Entity-based job dispatch, priority routing, deduplication, dead-letter handling
**Confidence:** HIGH

## Summary

Phase 4 replaces poll-based job queue with Entity mailbox dispatch. Current `jobs.ts` uses `SELECT FOR UPDATE SKIP LOCKED` with 1-10s polling; Entity mailboxes provide instant dispatch via consistent-hash routing.

**Architecture:** JobEntity with polymorphic messages (`submit`, `status`, `progress`, `cancel`), `Rpc.make({ primaryKey })` for deduplication, `RpcMiddleware.Tag` for context injection, priority via `toLayerMailbox` or weighted pool routing, DLQ as DB table with replay capability.

## Standard Stack

| Library | Version | Purpose |
|---------|---------|---------|
| `@effect/cluster` | 0.56.1 | Entity, Rpc, RpcMiddleware, Sharding, SqlMessageStorage |
| `@effect/workflow` | 0.2.0 | DurableQueue, DurableDeferred, DurableRateLimiter |
| `effect` | 3.19.15 | Schema, Match, Duration, Ref, FiberMap, Chunk, Supervisor, Schedule |
| `@effect/sql-pg` | 0.50.1 | job_dlq table persistence |

All packages in pnpm-workspace.yaml catalog. No new dependencies.

## Architecture

```
packages/server/src/infra/
├── cluster.ts    # ClusterService (unchanged)
└── jobs.ts       # JobService (gut + replace with Entity dispatch)

packages/database/src/
├── models.ts     # Add JobDlq model
└── repos.ts      # Add jobDlq repo methods
```

## Schema & Errors

```typescript
// --- [SCHEMA] ----------------------------------------------------------------

const JobPriority = S.Literal('critical', 'high', 'normal', 'low');
const JobStatus = S.Literal('queued', 'processing', 'complete', 'failed', 'cancelled');
class JobPayload extends S.Class<JobPayload>('JobPayload')({
	batchId: S.optional(S.String),
	dedupeKey: S.optional(S.String),
	duration: S.optionalWith(S.Literal('short', 'long'), { default: () => 'short' }),
	maxAttempts: S.optionalWith(S.Number, { default: () => 3 }),
	payload: S.Unknown,
	priority: S.optionalWith(JobPriority, { default: () => 'normal' }),
	type: S.String,
}) {}
class JobStatusResponse extends S.Class<JobStatusResponse>('JobStatusResponse')({
	attempts: S.Number,
	history: S.Array(S.Struct({ error: S.optional(S.String), status: JobStatus, timestamp: S.Number })),
	result: S.optional(S.Unknown),
	status: JobStatus,
}) {}
class JobStatusEvent extends S.Class<JobStatusEvent>('JobStatusEvent')({
	appId: S.String,
	error: S.optional(S.String),
	id: S.String, // UUIDv7 - timestamp extractable via uuid_extract_timestamp()
	jobId: S.String,
	status: JobStatus,
	type: S.String,
}) {}

// --- [ERRORS] ----------------------------------------------------------------

class JobError extends Data.TaggedError('JobError')<{
  readonly cause?: unknown;
  readonly jobId?: string;
  readonly reason: 'NotFound' | 'AlreadyCancelled' | 'HandlerMissing' | 'Validation' | 'Processing' | 'MaxRetries' | 'RunnerUnavailable' | 'Timeout';
}> {
  static readonly fromNotFound = (jobId: string) => new JobError({ jobId, reason: 'NotFound' });
  static readonly fromCancelled = (jobId: string) => new JobError({ jobId, reason: 'AlreadyCancelled' });
  static readonly fromHandlerMissing = (jobId: string, type: string) => new JobError({ cause: { type }, jobId, reason: 'HandlerMissing' });
  static readonly fromValidation = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'Validation' });
  static readonly fromProcessing = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'Processing' });
  static readonly fromMaxRetries = (jobId: string, cause: unknown) => new JobError({ cause, jobId, reason: 'MaxRetries' });
  static readonly fromRunnerUnavailable = (jobId: string, cause?: unknown) => new JobError({ cause, jobId, reason: 'RunnerUnavailable' });
  static readonly fromTimeout = (jobId: string, cause?: unknown) => new JobError({ cause, jobId, reason: 'Timeout' });
  // Set-based classification — O(1) lookup, scales with more reasons
  static readonly _terminal: ReadonlySet<JobError['reason']> = new Set(['Validation', 'HandlerMissing', 'AlreadyCancelled', 'NotFound']);
  static readonly _transient: ReadonlySet<JobError['reason']> = new Set(['Timeout', 'RunnerUnavailable']);
  static readonly isTerminal = (e: JobError): boolean => JobError._terminal.has(e.reason);
  static readonly isTransient = (e: JobError): boolean => JobError._transient.has(e.reason);
}
```

## JobState

```typescript
class JobState extends S.Class<JobState>('JobState')({
  attempts: S.Number,
  completedAt: S.optional(S.Number),
  createdAt: S.Number,
  lastError: S.optional(S.String),
  result: S.optional(S.Unknown),
  status: JobStatus,
}) {
  static readonly queued = (ts: number) => new JobState({ attempts: 0, createdAt: ts, status: 'queued' });
  static readonly processing = (state: JobState, ts: number) => new JobState({ ...state, status: 'processing' });
  static readonly completed = (state: JobState, result: unknown, ts: number) => new JobState({ ...state, completedAt: ts, result, status: 'complete' });
  static readonly failed = (state: JobState, error: string, ts: number) => new JobState({ ...state, attempts: state.attempts + 1, completedAt: ts, lastError: error, status: 'failed' });
  static readonly cancelled = (state: JobState, ts: number) => new JobState({ ...state, completedAt: ts, status: 'cancelled' });
}
```

## JobEntity & Layer

```typescript
import { Entity, Rpc, RpcMiddleware, Sharding } from '@effect/cluster';
import { Chunk, Clock, Data, Duration, Effect, FiberMap, HashMap, Match, Metric, Option, Ref, Schedule, Schema as S } from 'effect';
import { Context } from '../context.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';
import { Resilience } from '../utils/resilience.ts';
import { DatabaseService } from '@parametric-portal/database/repos';

// --- [CONFIG] ----------------------------------------------------------------

const _CONFIG = {
  entity: { concurrency: 1, mailboxCapacity: 100, maxIdleTime: Duration.minutes(5) },
  pools: { critical: 4, high: 3, normal: 2, low: 1 } as const,
  retry: Schedule.exponential(Duration.millis(100)).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)),
    Schedule.upTo(Duration.seconds(30)),
    Schedule.whileInput((e: JobError) => !JobError.isTerminal(e)),  // Skip terminal errors
    Schedule.resetAfter(Duration.minutes(5)),
    Schedule.collectAllInputs,
  ),
} as const;

// --- [MIDDLEWARE] ------------------------------------------------------------

class JobContext extends Effect.Tag('JobContext')<JobContext, {
  readonly jobId: string;
  readonly tenantId: string;
  readonly priority: typeof JobPriority.Type;
}>() {}

class JobMiddleware extends RpcMiddleware.Tag<JobMiddleware>()('JobMiddleware', { provides: JobContext }) {}

// --- [ENTITY] ----------------------------------------------------------------

const JobEntity = Entity.make('Job', [
  Rpc.make('submit', {
    error: JobError,
    payload: JobPayload.fields,
    primaryKey: (p) => p.dedupeKey ?? null,  // null = no deduplication for non-idempotent jobs
    success: S.Struct({ jobId: S.String, duplicate: S.Boolean }),
  }),
  Rpc.make('status', { payload: S.Struct({ jobId: S.String }), success: JobStatusResponse }),
  Rpc.make('progress', { payload: S.Struct({ jobId: S.String }), success: S.Struct({ pct: S.Number, message: S.String }), stream: true }),
  Rpc.make('cancel', { error: JobError, payload: S.Struct({ jobId: S.String }), success: S.Void }),
]);

// --- [ENTITY LAYER] ----------------------------------------------------------

const JobEntityLive = JobEntity.toLayer(Effect.gen(function* () {
  const currentAddress = yield* Entity.CurrentAddress;
  const handlers = yield* Ref.make(HashMap.empty<string, (payload: unknown) => Effect.Effect<unknown, unknown, never>>());
  const runningJobs = yield* FiberMap.make<string>();
  const jobStates = yield* Ref.make(HashMap.empty<string, typeof JobStatusResponse.Type>());
  const db = yield* DatabaseService;
  const metrics = yield* MetricsService;

  const processJob = (jobId: string, envelope: typeof JobPayload.Type) => Context.Request.withinCluster({
    entityId: currentAddress.entityId,
    entityType: currentAddress.entityType,
    shardId: currentAddress.shardId,
  })(Effect.gen(function* () {
    const handler = yield* Ref.get(handlers).pipe(
      Effect.map(HashMap.get(envelope.type)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(JobError.fromHandlerMissing(jobId, envelope.type)),
        onSome: Effect.succeed,
      })),
    );
    const ts = yield* Clock.currentTimeMillis;
    yield* Ref.update(jobStates, HashMap.set(jobId, new JobStatusResponse({
      attempts: 1, history: [{ status: 'processing', timestamp: ts }], status: 'processing',
    })));
    const longJob = envelope.duration === 'long';
    yield* Effect.when(Entity.keepAlive(true), () => longJob);
    yield* MetricsService.trackEffect(
      handler(envelope.payload).pipe(Effect.mapError((e) => JobError.fromProcessing(jobId, e))),
      { duration: metrics.jobs.duration, errors: metrics.errors, labels: MetricsService.label({ jobType: envelope.type, priority: envelope.priority }) },
    ).pipe(Effect.ensuring(Effect.when(Entity.keepAlive(false), () => longJob)));
    const completeTs = yield* Clock.currentTimeMillis;
    yield* Ref.update(jobStates, HashMap.modify(jobId, (s) => new JobStatusResponse({ ...s, history: [...s.history, { status: 'complete', timestamp: completeTs }], status: 'complete' })));
    yield* Metric.increment(metrics.jobs.completions);
  }).pipe(
    Effect.catchTag('JobError', (e) => JobError.isTerminal(e)
      ? db.jobDlq.insert({ appId: envelope.appId ?? 'system', attempts: 1, errorHistory: [{ error: String(e.cause), timestamp: Date.now() }], errorReason: e.reason, originalJobId: jobId, payload: envelope.payload, type: envelope.type }).pipe(Effect.zipRight(Metric.increment(metrics.jobs.deadLettered)), Effect.zipRight(Effect.fail(e)))
      : Effect.fail(e)),
  ));

  return {
    cancel: (envelope) => FiberMap.get(runningJobs, envelope.payload.jobId).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(JobError.fromNotFound(envelope.payload.jobId)),
        onSome: (fiber) => FiberMap.remove(runningJobs, envelope.payload.jobId).pipe(Effect.asVoid),
      })),
    ),
    status: (envelope) => Ref.get(jobStates).pipe(
      Effect.map(HashMap.get(envelope.payload.jobId)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeed(new JobStatusResponse({ attempts: 0, history: [], status: 'queued' })),
        onSome: Effect.succeed,
      })),
    ),
    submit: (envelope) => Effect.gen(function* () {
      const sharding = yield* Sharding.Sharding;
      const jobId = yield* sharding.getSnowflake.pipe(Effect.map(String));
      yield* Metric.increment(metrics.jobs.enqueued);
      yield* FiberMap.run(runningJobs, jobId)(processJob(jobId, envelope.payload).pipe(Effect.onInterrupt(() => Effect.logInfo('Job cancelled', { jobId }))));
      return { jobId, duplicate: false };
    }),
  };
}), {
  concurrency: _CONFIG.entity.concurrency,
  defectRetryPolicy: _CONFIG.retry,
  mailboxCapacity: _CONFIG.entity.mailboxCapacity,
  maxIdleTime: _CONFIG.entity.maxIdleTime,
  spanAttributes: { 'entity.service': 'job-processing', 'entity.version': 'v1' },
});
```

## JobService

```typescript
class JobService extends Effect.Service<JobService>()('server/Jobs', {
  dependencies: [JobEntityLive, DatabaseService.Default, MetricsService.Default],
  scoped: Effect.gen(function* () {
    const sharding = yield* Sharding.Sharding;
    const getClient = yield* sharding.makeClient(JobEntity);
    const handlers = yield* Ref.make(HashMap.empty<string, JobService.Handler>());
    const metrics = yield* MetricsService;
    const db = yield* DatabaseService;

    const routeByPriority = (jobId: string, p: keyof typeof _CONFIG.pools) => {
      const hash = jobId.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
      return `job-${p}-${Math.abs(hash) % _CONFIG.pools[p]}`;
    };

    const submit = <T>(type: string, payloads: T | readonly T[], opts?: {
      dedupeKey?: string;
      maxAttempts?: number;
      priority?: typeof JobPriority.Type;
    }) => Effect.gen(function* () {
      const items = Array.isArray(payloads) ? payloads : [payloads];
      const priority = opts?.priority ?? 'normal';
      const batchId = items.length > 1 ? crypto.randomUUID() : undefined;
      // Priority separation via Chunk.partition
      const chunks = Chunk.fromIterable(items.map((payload, idx) => ({ payload, idx })));
      const results = yield* Effect.forEach(Chunk.toArray(chunks), ({ payload, idx }) =>
        Context.Request.withinCluster({ entityId: routeByPriority(priority), entityType: 'Job' })(
          getClient(routeByPriority(priority)).submit({
            batchId,
            dedupeKey: opts?.dedupeKey ? `${opts.dedupeKey}:${idx}` : undefined,
            maxAttempts: opts?.maxAttempts,
            payload,
            priority,
            type,
          }).pipe(Effect.map((r) => r.jobId)),
        ),
        { concurrency: 'unbounded' },
      );
      yield* Metric.incrementBy(metrics.jobs.enqueued, items.length);
      return Array.isArray(payloads) ? results : results[0];
    });

    // Batch validation with Effect.all mode: 'validate'
    const validateBatch = <T>(items: readonly T[], validator: (item: T) => Effect.Effect<void, JobError>) =>
      Effect.all(items.map((item, idx) => validator(item).pipe(Effect.mapError((e) => ({ idx, error: e })))), { mode: 'validate', concurrency: 'unbounded' });

    const replay = (dlqId: string) => Effect.gen(function* () {
      const entry = yield* db.jobDlq.get(dlqId);
      yield* Option.match(entry, {
        onNone: () => Effect.fail(JobError.fromNotFound(dlqId)),
        onSome: (e) => submit(e.type, e.payload, { priority: 'normal' }).pipe(Effect.zipRight(db.jobDlq.markReplayed(dlqId))),
      });
    });

    return {
      cancel: (jobId: string) => getClient(jobId).cancel({ jobId }),
      registerHandler: <T>(type: string, handler: (payload: T) => Effect.Effect<void, unknown, never>) => Ref.update(handlers, HashMap.set(type, handler as JobService.Handler)),
      replay,
      status: (jobId: string) => getClient(jobId).status({ jobId }),
      submit,
      validateBatch,
    };
  }),
}) {
  // Static properties for value access (matching cluster.ts pattern)
  static readonly Config = _CONFIG;
  static readonly Context = JobContext;
  static readonly Error = JobError;
  static readonly Payload = JobPayload;
  static readonly Response = { Status: JobStatusResponse } as const;
}

namespace JobService {
  export type Handler = (payload: unknown) => Effect.Effect<void, unknown, never>;
  export type Priority = typeof JobPriority.Type;
  export type Status = typeof JobStatus.Type;
  export type Error = InstanceType<typeof JobError>;
  export type Context = Effect.Effect.Context<typeof JobContext>;
}

export { JobService };
```

## JobDlq Model & Repo

```typescript
// models.ts — add to existing models (follows existing Model.Class patterns)
class JobDlq extends Model.Class<JobDlq>('JobDlq')({
  id: Model.Generated(S.UUID),
  originalJobId: S.UUID,
  appId: S.UUID,
  type: S.String,
  payload: Model.JsonFromString(S.Unknown),
  errorReason: S.String,  // 'MaxRetries' | 'Validation' | 'HandlerMissing' | 'RunnerUnavailable'
  attempts: S.Number,
  errorHistory: Model.JsonFromString(S.Array(S.Struct({ error: S.String, timestamp: S.Number }))),
  dlqAt: Model.DateTimeInsertFromDate,
  replayedAt: Model.FieldOption(S.DateFromSelf),
  requestId: Model.FieldOption(S.UUID),  // For cross-pod trace correlation
  userId: Model.FieldOption(S.UUID),     // Audit trail
}) {}

// repos.ts — add to DatabaseService
jobDlq: {
  get: (id: string) => sql`SELECT * FROM job_dlq WHERE id = ${id}`.pipe(Effect.map(A.head)),
  insert: (data: typeof JobDlq.insert.Type) => sql`INSERT INTO job_dlq ${sql.insert(data)}`.pipe(Effect.asVoid),
  markReplayed: (id: string) => sql`UPDATE job_dlq SET replayed_at = NOW() WHERE id = ${id}`.pipe(Effect.asVoid),
  listPending: (opts?: { type?: string; limit?: number }) => sql`
    SELECT * FROM job_dlq WHERE replayed_at IS NULL
    ${opts?.type ? sql`AND type = ${opts.type}` : sql``}
    ORDER BY failed_at DESC LIMIT ${opts?.limit ?? 100}
  `,
}
```

## Migration SQL

```sql
CREATE TABLE job_dlq (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  original_job_id UUID NOT NULL,
  app_id UUID NOT NULL,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  error_reason TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  error_history JSONB NOT NULL,
  dlq_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replayed_at TIMESTAMPTZ,
  request_id UUID,
  user_id UUID,
  CONSTRAINT job_dlq_error_history_array CHECK (jsonb_typeof(error_history) = 'array')
);
CREATE INDEX idx_job_dlq_type ON job_dlq(type) WHERE replayed_at IS NULL;
CREATE INDEX idx_job_dlq_dlq_at ON job_dlq(dlq_at) WHERE replayed_at IS NULL;
CREATE INDEX idx_job_dlq_request ON job_dlq(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_job_dlq_app_id_fk ON job_dlq(app_id);
CREATE TRIGGER job_dlq_updated_at BEFORE UPDATE ON job_dlq FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION purge_job_dlq(p_older_than_days INT DEFAULT 30)
RETURNS INT LANGUAGE sql AS $$
    WITH purged AS (
        DELETE FROM job_dlq WHERE replayed_at IS NOT NULL
          AND replayed_at < NOW() - (p_older_than_days || ' days')::interval
        RETURNING id
    )
    SELECT COUNT(*)::int FROM purged
$$;
```

## Codebase Refinements

**Preserve API Contracts** (existing consumers):
| API | Signature | Consumers |
|-----|-----------|-----------|
| `enqueue` | `<T>(type, payloads, opts?) => Effect<string \| string[]>` | `purge-assets.ts` |
| `registerHandler` | `(type, handler) => Effect<void>` | `purge-assets.ts` |
| `submit` | Alias for `enqueue` | New callers (Phase 4 terminology) |

**Files to Create/Modify**:
| File | Change | Priority |
|------|--------|----------|
| `packages/database/src/models.ts` | Add `JobDlq` model | CRITICAL |
| `packages/database/src/repos.ts` | Add `makeJobDlqRepo` | CRITICAL |
| `packages/database/migrations/0002_*.ts` | Add `job_dlq` table | CRITICAL |
| `packages/server/src/infra/jobs.ts` | Gut + replace with Entity | CRITICAL |
| `packages/server/src/utils/resilience.ts` | Add `job` schedule | HIGH |

**Integration Points**:
| From | To | Pattern |
|------|----|---------|
| `jobs.ts` | `cluster.ts` | `JobEntityLive.pipe(Layer.provide(ClusterService.Layer))` |
| `jobs.ts` | `context.ts` | `Context.Request.withinCluster({ entityId, entityType, shardId })` |
| `jobs.ts` | `metrics.ts` | `MetricsService.trackEffect` for duration/errors |
| `jobs.ts` | `resilience.ts` | `Resilience.schedules.job` for retry policy |
| `jobs.ts` | `repos.ts` | `DatabaseService.jobDlq` for DLQ operations |

## Metrics Integration

```typescript
// Add to MetricsService in observe/metrics.ts
jobs: {
  cancellations: Metric.counter('jobs_cancelled_total'),
  completions: Metric.counter('jobs_completed_total'),
  deadLettered: Metric.counter('jobs_dead_lettered_total'),
  dlqSize: Metric.gauge('jobs_dlq_size'),
  duration: Metric.timerWithBoundaries('jobs_duration_seconds', _boundaries.jobs),
  enqueued: Metric.counter('jobs_enqueued_total'),
  failures: Metric.counter('jobs_failed_total'),
  processingSeconds: Metric.timerWithBoundaries('jobs_processing_seconds', _boundaries.jobs),
  queueDepth: Metric.gauge('jobs_queue_depth'),
  retries: Metric.counter('jobs_retried_total'),
  waitDuration: Metric.timerWithBoundaries('jobs_wait_duration_seconds', _boundaries.jobs),
}
```

## Don't Hand-Roll

| Problem | Use Instead | Why |
|---------|-------------|-----|
| Per-job resources | `EntityResource.make` | Lifecycle-scoped resources with auto-cleanup on idle |
| Job ID generation | `sharding.getSnowflake` | Sortable, machine-aware, no collisions |
| Job deduplication | `Rpc.make({ primaryKey })` | `SaveResult.Duplicate` returns existing jobId automatically |
| Duplicate detection | `requestIdForPrimaryKey(address, tag, key)` | Direct dedupeKey → Snowflake lookup, no scan |
| Message persistence | `SqlMessageStorage.layer` | Built-in at-least-once delivery |
| Context propagation | `Envelope.headers` | Cross-pod tenant/session via request headers |
| Priority scheduling | Weighted entity pool routing | Mailboxes are FIFO; pool sizing achieves priority |
| Job cancellation | `OutgoingEnvelope.interrupt(address, id, requestId)` | Native cancellation persisted across restarts |
| Startup recovery | `unprocessedMessages(shards)` | Shard-filtered recovery; no full table scan |
| Progress streaming | `Reply.Chunk` with `stream: true` on Rpc | Sequence numbers ensure ordered delivery |
| Failure categorization | `Reply.WithExit.fromDefect()` / `.interrupt()` | Structured failure replies for DLQ |
| External API rate limiting | `DurableRateLimiter.rateLimit` | Cluster-wide, replay-safe rate limiting |
| Webhook job completion | `DurableDeferred.tokenFromPayload` | External systems complete jobs via token |
| Retry backoff | `Resilience.run` or `resilience.ts` schedules | Exponential + jitter + cap + circuit + bulkhead |
| Status tracking | `Ref` in Entity state | In-memory state, persisted via SqlMessageStorage |
| Long job eviction | `Entity.keepAlive(true/false)` | Prevents maxIdleTime deactivation |
| Batch splitting | `Chunk.partition` | Priority separation in single pass |
| Batch validation | `Effect.all({ mode: 'validate' })` | Collect ALL errors, not fail-fast |
| Concurrent processing | `Effect.forEach({ concurrency })` | Built-in concurrency control |
| Batched status lookup | `Request/RequestResolver.makeBatched` | Auto-batch identical requests in same tick |
| Automatic tracing | `Effect.fn('name')` | Named spans without manual Telemetry.span |
| Priority pools | `Pool.makeWithTTL` | Dynamic worker pools with TTL lifecycle |
| Progress streaming | `Queue.sliding(capacity)` | Drop old progress when subscriber is slow |
| Fiber monitoring | `Supervisor.track` + `supervisor.value` | Auto-track forked fibers; no manual Ref |
| Fiber lifecycle | `supervisor.onStart` / `onEnd` | Hook job launch/completion for metrics |
| Retry state reset | `Schedule.resetAfter(duration)` | Clear retry count after recovery window |
| Error history | `Schedule.collectAllInputs` | Accumulate all retry errors for DLQ |
| Schedule observability | `Schedule.onDecision` + `ScheduleDecision.isDone` | Hook Continue/Done for metrics, detect exhaustion |
| Terminal error filter | `Schedule.whileInput((e) => !isTerminal(e))` | Skip retry for validation/not-found errors |
| Phased retry | `Schedule.andThen` | Aggressive-then-gentle without manual if/else |
| Conditional reset | `Schedule.resetWhen((error) => isTransient(error))` | Reset on successful transient recovery |

## Pitfalls

| Pitfall | Symptom | Solution |
|---------|---------|----------|
| FIFO blocks priority | High-priority latency equals low-priority | Route to priority-specific entity pools (4:3:2:1 ratio) |
| Long jobs deactivate | Jobs fail with interruption after ~5min | Call `Entity.keepAlive(true)` at start, disable after |
| Duplicate submissions | Same job executes multiple times | Always provide `dedupeKey` for idempotent jobs |
| Validation errors retry forever | ParseError jobs stuck retrying | Skip retry for Validation/ParseError, DLQ immediately |
| Interface changes break callers | Compile errors in imports | Preserve `JobService.submit(type, payload, opts)` signature |
| Partial side effects persist | Inconsistent data after failure | Use `Context.Request.withinSync` for SQL transaction wrap |
| Missing `primaryKey` on submit RPC | Duplicates processed multiple times | Always define `primaryKey` extractor |
| Handler throws sync exception | Unhandled defect | Wrap in `Effect.try` or use `Effect.gen` |
| Runner dies mid-job | Jobs stuck in-flight | Wire `Runners.onRunnerUnavailable` → auto-DLQ/retry |
| No health pre-check | High-priority jobs routed to unhealthy workers | Use `Runners.ping()` before priority routing |

## Runner System (Already in cluster.ts)

| API | Status | Job Processing Note |
|-----|--------|---------------------|
| `RunnerHealth.layerK8s` | ✓ Used | Pod liveness for failover |
| `SqlRunnerStorage.layer` | ✓ Used | Dedicated PgClient (prevents lock loss) |
| `SocketRunner.layerClientOnly` | ✓ Used | Transport layer |
| `Runners.ping` | Available | Pre-submit health validation for priority jobs |
| `Runners.onRunnerUnavailable` | **GAP** | Hook for immediate job failure handling |
| `RunnerStorage.makeMemory` | Available | Test acceleration (skip SQL) |

## Durable APIs (Phase 4 Capabilities)

| Module | Function | Signature | Phase 4 Use |
|--------|----------|-----------|-------------|
| `DurableQueue` | `make` | `({ name, payload, success, idempotencyKey })` | Define queue with typed schemas |
| `DurableQueue` | `process` | `(queue, payload) => Effect<Success>` | Submit + block until complete |
| `DurableQueue` | `worker` | `(queue, handler, { concurrency }) => Layer` | Continuous worker layer |
| `DurableDeferred` | `token` | `(deferred) => Effect<string>` | Generate unique token for webhooks |
| `DurableDeferred` | `await` | `(deferred) => Effect<Success>` | Suspend until external resolution |
| `DurableDeferred` | `succeed` | `(deferred, token, value) => Effect<void>` | External completion signal |
| `DurableRateLimiter` | `rateLimit` | `({ name, algorithm, window, limit, key })` | Acquire cluster-wide token |
| `DurableClock` | `sleep` | `({ name, duration, inMemoryThreshold? })` | Durable sleep; skip DB for short waits |

**DurableRateLimiter Algorithms:**
- `'fixed-window'` — Reset at window boundary
- `'token-bucket'` — Continuous refill

**Decision Matrix:**
| Use Case | Entity Dispatch | DurableQueue |
|----------|-----------------|--------------|
| Fire-and-forget | YES | NO |
| Return results to caller | NO (status polling) | YES (blocks) |
| External webhook completion | With DurableDeferred | Built-in |
| Sub-second latency | YES | NO |
| Cluster-wide rate limiting | NO | YES (DurableRateLimiter) |
| Long retry delays | defectRetryPolicy | DurableClock (survives restart) |

## Workflow APIs (Future Phase 6)

| Module | Key Functions | When to Use |
|--------|---------------|-------------|
| `Workflow` | `make`, `execute`, `withCompensation` | Multi-step saga with rollback |
| `Activity` | `make`, `idempotencyKey({ includeAttempt })` | Retry-aware non-deterministic steps |

## State of the Art

| Deprecated | Replacement | Impact |
|------------|-------------|--------|
| `SELECT FOR UPDATE SKIP LOCKED` | Entity mailbox dispatch | No poll latency, reduced DB load |
| `db.jobs.claimBatch()` | Entity message routing | Instant dispatch |
| `Circuit` wrapper in jobs | `defectRetryPolicy` | Unified retry in entity config |
| Poll loop with `Schedule.spaced` | Mailbox subscription | No polling overhead |
| Manual `_delay` function | `Resilience.schedules.default` | Consistent backoff patterns |

## Effect Core APIs (Job-Relevant)

### Pool (Priority Worker Management)

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Pool.make` | `({ acquire, size, concurrency?, targetUtilization? })` | Fixed-size worker pools for predictable workloads |
| `Pool.makeWithTTL` | `({ acquire, min, max, timeToLive, timeToLiveStrategy?, ... })` | **Elastic pools**: shrink during idle, expand under load |
| `Pool.get` | `Pool<A> => Effect<A, never, Scope>` | Acquire worker within scope; auto-release on scope exit |
| `Pool.invalidate` | `(pool, value) => Effect<void>` | Remove faulty workers; lazy replacement |

**TTL Strategies:**
- `'creation'` — Workers expire based on age (predictable turnover)
- `'usage'` — Workers expire after inactivity (resource-efficient)

**Priority Pool Pattern:**
```typescript
const priorityPools = {
  critical: yield* Pool.makeWithTTL({ min: 4, max: 8, timeToLive: Duration.minutes(30) }),
  high: yield* Pool.makeWithTTL({ min: 3, max: 6, timeToLive: Duration.minutes(20) }),
  normal: yield* Pool.makeWithTTL({ min: 2, max: 4, timeToLive: Duration.minutes(10) }),
  low: yield* Pool.makeWithTTL({ min: 1, max: 2, timeToLive: Duration.minutes(5) }),
};
```

### Request/RequestResolver (Batched Lookups)

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Request.tagged` | `<Tag>(tag) => Request.Constructor` | Define `JobStatusRequest` with discriminant |
| `Request.Class` | `class extends Request.Class<Success, Error, Props>` | Typed request definition |
| `RequestResolver.makeBatched` | `(handler: NonEmptyArray<A> => Effect<void>)` | **Batch status lookups**: single DB query for N requests |
| `RequestResolver.fromEffectTagged` | `({ Tag1: handler1, ... })` | Discriminated union handlers |
| `RequestResolver.batchN` | `(resolver, n) => Resolver` | Limit concurrent batch size |
| `RequestResolver.around` | `(resolver, before, after)` | Resource setup/teardown per batch |

**Batched Status Lookup Pattern:**
```typescript
class JobStatusRequest extends Request.TaggedClass('JobStatusRequest')<
  typeof JobStatusResponse.Type,
  JobError,
  { readonly jobId: string }
>() {}

const statusResolver = RequestResolver.makeBatched((requests: NonEmptyArray<JobStatusRequest>) =>
  Effect.gen(function* () {
    const jobIds = requests.map((r) => r.jobId);
    const results = yield* db.jobs.getStatusBatch(jobIds);
    yield* Effect.forEach(requests, (req) => {
      const status = results.get(req.jobId);
      return status
        ? Request.succeed(req, status)
        : Request.fail(req, JobError.fromNotFound(req.jobId));
    });
  })
);
```

### Effect Batch & Concurrency Operations

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.all` | `(effects, { mode?, concurrency? })` | Aggregate independent effects |
| `Effect.all` (mode: 'validate') | Collects ALL errors via Option | **Batch validation**: don't fail-fast |
| `Effect.all` (mode: 'either') | Collects results as Either | Mixed success/failure handling |
| `Effect.forEach` | `(items, fn, { concurrency?, batching? })` | **Parallel job processing** with configurable concurrency |
| `Effect.filter` | `(predicate: (a) => Effect<boolean>)` | Effectful filtering (e.g., permission checks) |
| `Effect.partition` | `(predicate: (a) => Effect<boolean>)` | Split into [falses, trues] groups |
| `Effect.validateAll` | `(items, fn) => Effect<A[], E[]>` | Run ALL, accumulate ALL errors |
| `Effect.validateFirst` | `(items, fn) => Effect<A, E[]>` | Find first success, collect failures |

**Validation Pattern:**
```typescript
// mode: 'validate' wraps success/failure in Option (no short-circuit)
const results = yield* Effect.all(
  jobs.map((job) => validateJob(job)),
  { mode: 'validate', concurrency: 'unbounded' }
);
const [failures, successes] = A.partition(results, Option.isNone);
```

### Effect Timeout & Race Patterns

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.timeout` | `(effect, duration) => Effect<A, E \| TimeoutException>` | **Job deadlines**: fail if processing exceeds limit |
| `Effect.timeoutTo` | `({ onTimeout, onSuccess })` | Graceful degradation on timeout (return cached/default) |
| `Effect.timeoutFail` | `(effect, { duration, onTimeout })` | Custom timeout error |
| `Effect.race` | `(effect1, effect2) => Effect` | First completion wins |
| `Effect.raceAll` | `(effects) => Effect` | First of N completions |
| `Effect.raceFirst` | `(effects) => Effect` | Optimized first-success |

**Deadline Pattern:**
```typescript
const processWithDeadline = (job: Job) =>
  processJob(job).pipe(
    Effect.timeout(Duration.seconds(30)),
    Effect.catchTag('TimeoutException', () =>
      Effect.fail(JobError.fromTimeout(job.id, { deadline: '30s' }))
    )
  );
```

### Effect Interruption Control

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.interruptible` | `(effect) => Effect` | Allow cancellation at checkpoints |
| `Effect.uninterruptible` | `(effect) => Effect` | **Critical sections**: state commits, finalizers |
| `Effect.uninterruptibleMask` | `(restore => effect) => Effect` | Fine-grained: atomic with interruptible subsections |
| `Effect.onInterrupt` | `(effect, cleanup)` | **Cancel-only cleanup**: DLQ insert, lock release (NOT on success/failure) |
| `Effect.ensuring` | `(effect, finalizer)` | **All paths cleanup**: logging, metrics (runs on success, failure, AND interrupt) |
| `Effect.disconnect` | `(effect) => Effect` | Isolate effect from parent interruption |

### Cancellation Pattern (Comprehensive)

```typescript
const processJob = (jobId: string, payload: JobPayload) => Effect.gen(function* () {
  const ts = yield* Clock.currentTimeMillis;
  yield* Ref.update(stateRef, JobState.processing(ts));      // State transition
  yield* Effect.interruptible(executeHandler(payload));      // [CANCELLABLE] Main work
  yield* Effect.uninterruptible(Effect.gen(function* () {    // [CRITICAL] Commit result
    const completeTs = yield* Clock.currentTimeMillis;
    yield* Ref.update(stateRef, JobState.completed(completeTs));
    yield* Metric.increment(metrics.jobs.completions);
  }));
}).pipe(
  Effect.onInterrupt(() => Effect.gen(function* () {         // [INTERRUPT-ONLY] Cleanup
    const ts = yield* Clock.currentTimeMillis;
    yield* Ref.update(stateRef, JobState.cancelled(ts));
    yield* db.jobDlq.insert({ jobId, reason: 'Cancelled' });
    yield* Metric.increment(metrics.jobs.cancellations);
  })),
  Effect.ensuring(Effect.logDebug('Job finalized', { jobId })), // [ALL PATHS] Logging
);

// --- [CANCEL HANDLER] ---
cancel: (envelope) => Effect.gen(function* () {
  const { jobId } = envelope.payload;
  const fiberOpt = yield* FiberMap.get(runningJobs, jobId);
  yield* Option.match(fiberOpt, {
    onNone: () => Ref.get(jobStates).pipe(
      Effect.map(HashMap.get(jobId)),
      Effect.flatMap(Option.match({
        onNone: () => Effect.fail(JobError.fromNotFound(jobId)),
        onSome: (state) => Match.value(state.status).pipe(
          Match.when('cancelled', () => Effect.fail(JobError.fromCancelled(jobId))),
          Match.when('complete', () => Effect.fail(JobError.fromCancelled(jobId))),
          Match.when('failed', () => Effect.fail(JobError.fromCancelled(jobId))),
          Match.orElse(() => Effect.fail(JobError.fromNotFound(jobId))),
        ),
      })),
    ),
    onSome: (_fiber) => FiberMap.remove(runningJobs, jobId).pipe(Effect.asVoid),
    // FiberMap.remove handles both interrupt AND removal atomically
  });
}),
```

### Cancellation Edge Cases

| Scenario | Handling |
|----------|----------|
| Job already complete | `FiberMap.get` returns `None`; check `jobStates` for terminal status; return `JobError.fromCancelled` |
| Job not started (queued) | Fiber not yet in FiberMap; reject with `NotFound` or allow "pre-cancel" |
| Partial DB write | `Effect.uninterruptible` defers interrupt; `onInterrupt` inserts DLQ for audit |
| Double cancel | First `FiberMap.remove` succeeds; second returns `None`; idempotent success |
| Client disconnects | @effect/cluster does NOT propagate disconnect as interrupt; client must send explicit `cancel` RPC |

### Key API Clarifications

| Aspect | `onInterrupt` | `ensuring` |
|--------|---------------|------------|
| Runs on success | No | Yes |
| Runs on failure | No | Yes |
| Runs on interrupt | Yes | Yes |
| Use case | Cancel-specific (DLQ, locks) | Universal (logging, metrics) |

### Effect Resource Management

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.acquireRelease` | `(acquire, release)` | Connection/lock with guaranteed cleanup |
| `Effect.acquireUseRelease` | `(acquire, use, release)` | Scoped resource lifecycle |
| `Effect.ensuring` | `(effect, finalizer)` | Post-job cleanup (metrics, logging) |
| `Effect.addFinalizer` | `(finalizer) => Effect<void, never, Scope>` | Add cleanup to current scope |

### Effect Retry & Repeat

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.retry` | `(effect, schedule)` | **Transient failure recovery** (network, rate limits) |
| `Effect.repeat` | `(effect, schedule)` | Periodic execution (polling, heartbeats) |
| `Effect.retryWhile` | `(effect, predicate)` | Retry while error matches condition |
| `Effect.retryUntil` | `(effect, predicate)` | Retry until success condition |

### Effect Fiber Management

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.fork` | `(effect) => Effect<Fiber>` | Background job execution |
| `Effect.forkScoped` | `(effect) => Effect<Fiber, never, Scope>` | Scoped fiber with auto-cleanup |
| `Effect.forkDaemon` | `(effect) => Effect<Fiber>` | Independent fiber (monitoring, metrics) |
| `Effect.awaitAllChildren` | `Effect<void>` | Wait for all spawned jobs |
| `Effect.supervised` | `(effect, supervisor)` | Custom fiber tracking (job counts) |

### Effect Caching

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.cached` | `(effect) => Effect<Effect<A>>` | One-time expensive computation |
| `Effect.cachedWithTTL` | `(effect, duration)` | **Cached status lookups**: refresh after TTL |
| `Effect.cachedInvalidateWithTTL` | `(effect, duration)` | Manual invalidation + TTL |

**Cached Status Pattern:**
```typescript
const getJobConfig = yield* Effect.cachedWithTTL(
  loadJobConfigFromDb,
  Duration.minutes(5)
);
// First call: loads from DB
// Subsequent calls within 5min: returns cached
```

### Effect Observability

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.withSpan` | `(effect, name, { attributes? })` | **Distributed tracing** for job execution |
| `Effect.annotateCurrentSpan` | `(key, value)` | Add runtime attributes to active span |
| `Effect.annotateLogs` | `(effect, annotations)` | Contextual logging (jobId, type) |
| `Effect.annotateLogsScoped` | `(annotations)` | Scoped log annotations |
| `Effect.fn` | `(name)(effect)` | Named function with automatic span |

### Effect Error Handling

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Effect.catchTag` | `(tag, handler)` | Handle specific `JobError` reasons |
| `Effect.catchTags` | `({ Tag1: handler1, ... })` | Multi-reason recovery |
| `Effect.tapError` | `(effect, onError)` | Error logging without changing error |
| `Effect.tapBoth` | `({ onFailure, onSuccess })` | Divergent side effects |
| `Effect.catchAllCause` | `(effect, handler)` | Handle full Cause (defects, interrupts) |

### ExecutionStrategy

| Strategy | Constructor | Job Processing Use |
|----------|-------------|-------------------|
| `Sequential` | `ExecutionStrategy.sequential` | Ordered job dependencies |
| `Parallel` | `ExecutionStrategy.parallel` | Max throughput, unbounded concurrency |
| `ParallelN` | `ExecutionStrategy.parallelN(n)` | **Controlled parallelism**: protect DB connections |

### Chunk Batch Operations

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Chunk.fromIterable` | `(iterable) => Chunk` | Convert job array to Chunk |
| `Chunk.chunksOf` | `(chunk, n) => Chunk<Chunk>` | **Batch splitting**: process in groups of N |
| `Chunk.partition` | `(chunk, predicate) => [falses, trues]` | Priority separation |
| `Chunk.splitAt` | `(chunk, n) => [left, right]` | Take first N for immediate processing |
| `Chunk.flatten` | `(chunk) => Chunk` | Flatten nested batches |
| `Chunk.groupBy` | `(chunk, f) => HashMap<K, NonEmptyChunk>` | Group jobs by type/priority |

**Batch Splitting Pattern:**
```typescript
const jobs = Chunk.fromIterable(incomingJobs);
const batches = Chunk.chunksOf(jobs, 10);  // Process in batches of 10
yield* Effect.forEach(Chunk.toArray(batches), processBatch, { concurrency: 4 });
```

### Data.TaggedError Patterns

| Function | Signature | Job Processing Use |
|----------|-----------|-------------------|
| `Data.TaggedError(tag)` | `<Props>() => ErrorClass` | Define `JobError` with discriminant |
| `Data.TaggedEnum` | `<{ Variant: Props }>()` | Discriminated union for job states |
| `Data.case` | `() => Class with structural equality` | Immutable job payloads |

**TaggedError Pattern:**
```typescript
class JobError extends Data.TaggedError('JobError')<{
  readonly reason: 'NotFound' | 'Timeout' | 'Validation';
  readonly jobId?: string;
  readonly cause?: unknown;
}> {
  // Static factories for ergonomic construction
  static readonly fromNotFound = (jobId: string) => new JobError({ jobId, reason: 'NotFound' });
  static readonly fromTimeout = (jobId: string, cause?: unknown) => new JobError({ cause, jobId, reason: 'Timeout' });
  // Set-based classification for O(1) lookup
  static readonly _terminal = new Set(['NotFound', 'Validation']);
  static readonly isTerminal = (e: JobError) => JobError._terminal.has(e.reason);
}
```

## Sources

**@effect/cluster:**
- [Entity.ts](https://effect-ts.github.io/effect/cluster/Entity.ts.html) - Entity.make, toLayer, toLayerMailbox, keepAlive
- [EntityResource.ts](https://effect-ts.github.io/effect/cluster/EntityResource.ts.html) - Per-entity lifecycle resources
- [Rpc.ts](https://effect-ts.github.io/effect/cluster/Rpc.ts.html) - primaryKey, stream, annotate
- [RpcMiddleware.ts](https://effect-ts.github.io/effect/rpc/RpcMiddleware.ts.html) - Context injection
- [SqlMessageStorage.ts](https://effect-ts.github.io/effect/cluster/SqlMessageStorage.ts.html) - Message persistence

**@effect/workflow:**
- [DurableQueue.ts](https://effect-ts.github.io/effect/workflow/DurableQueue.ts.html) - Result-returning jobs
- [DurableDeferred.ts](https://effect-ts.github.io/effect/workflow/DurableDeferred.ts.html) - Webhook completion
- [DurableRateLimiter.ts](https://effect-ts.github.io/effect/workflow/DurableRateLimiter.ts.html) - Cluster-wide rate limiting

**effect core:**
- [Effect.ts](https://effect-ts.github.io/effect/effect/Effect.ts.html) - all, forEach, timeout, retry, fork, withSpan, catchTag
- [Pool.ts](https://effect-ts.github.io/effect/effect/Pool.ts.html) - make, makeWithTTL, get, invalidate
- [Request.ts](https://effect-ts.github.io/effect/effect/Request.ts.html) - tagged, Class, succeed, fail
- [RequestResolver.ts](https://effect-ts.github.io/effect/effect/RequestResolver.ts.html) - makeBatched, fromEffectTagged, batchN, around
- [RequestBlock.ts](https://effect-ts.github.io/effect/effect/RequestBlock.ts.html) - Batch execution ordering
- [ExecutionStrategy.ts](https://effect-ts.github.io/effect/effect/ExecutionStrategy.ts.html) - sequential, parallel, parallelN
- [Data.ts](https://effect-ts.github.io/effect/effect/Data.ts.html) - TaggedError, TaggedEnum, case
- [Chunk.ts](https://effect-ts.github.io/effect/effect/Chunk.ts.html) - chunksOf, partition, groupBy, flatten
- [Schedule.ts](https://effect-ts.github.io/effect/effect/Schedule.ts.html) - resetAfter, collectAllInputs, onDecision
- [Supervisor.ts](https://effect-ts.github.io/effect/effect/Supervisor.ts.html) - Fiber tracking

**Codebase:**
- `/packages/server/src/infra/cluster.ts` - ClusterEntity pattern, ClusterError static factories
- `/packages/server/src/utils/resilience.ts` - Retry schedules
- `/packages/server/src/observe/metrics.ts` - MetricsService patterns
- `/packages/server/src/context.ts` - withinCluster, Context.Request.Id.job

**Research date:** 2026-01-30
**Valid until:** 2026-02-28

## Entity System API

| API | Signature | Phase 4 Use |
|-----|-----------|-------------|
| `Entity.make` | `(type, protocol[]) => Entity` | Define JobEntity with submit/status/cancel RPCs |
| `Entity.toLayer` | `(handlers, opts) => Layer` | Register entity, configure concurrency=1, mailbox=100, defectRetryPolicy |
| `Entity.CurrentAddress` | `Tag<EntityAddress>` | Access shardId/entityId for Context.Request.withinCluster |
| `Entity.keepAlive` | `(enabled) => Effect<void>` | Prevent eviction for `duration === 'long'` jobs |
| `Entity.makeTestClient` | `(entity, layer) => Effect<Client>` | Unit test handlers without full cluster |
| `EntityResource.make` | `({ acquire, idleTimeToLive }) => Effect<Resource>` | Per-job resources surviving restarts, auto-cleanup on idle |
| `EntityResource.CloseScope` | Branded `Scope` | Resources survive shard movement (NOT standard Scope) |
| `EntityProxy.toRpcGroup` | `(entity) => RpcGroup` | Convert Entity to RpcGroup; auto-generates `{rpc}Discard` variants |
| `EntityProxy.toHttpApiGroup` | `(name, entity) => HttpApiGroup` | Generate `POST /{name}/{entityId}/{rpc}` endpoints |
| `EntityProxyServer.layerHttpApi` | `(api, name, entity) => Layer` | Wire JobEntity into HTTP API |

**Entity.toLayer Options:**
| Option | Value | Purpose |
|--------|-------|---------|
| `maxIdleTime` | `Duration.minutes(5)` | Eviction timeout for idle entities |
| `concurrency` | `1` | Ordered message processing per entity |
| `mailboxCapacity` | `100` | Queue size before MailboxFull error |
| `defectRetryPolicy` | `Schedule.exponential(...).pipe(Schedule.jittered)` | Defect recovery |
| `spanAttributes` | `{ 'entity.service': 'job-processing' }` | OTEL metadata |

**Avoid for Phase 4:**
| API | Reason |
|-----|--------|
| `Entity.toLayerMailbox` | FIFO sufficient; custom dequeue adds complexity |
| `ClusterWorkflowEngine` | Phase 6 saga scope |
| `EntityResource.makeK8sPod` | Advanced K8s not needed |

## @effect/rpc API (Job Processing Focus)

### Rpc.make Options (CRITICAL)

| Option | Type | Job Processing Use |
|--------|------|-------------------|
| `tag` | `string` | RPC identifier: `'submit'`, `'status'`, `'cancel'`, `'progress'` |
| `payload` | `Schema.Struct.Fields \| Schema.Schema.Any` | Request schema; struct fields auto-wrapped in `Schema.Struct()` |
| `success` | `Schema.Schema.Any` | Response schema; `JobStatusResponse`, `{ jobId, duplicate }` |
| `error` | `Schema.Schema.All` | Typed error; use `JobError` with discriminated reasons |
| `stream` | `boolean` | When `true`, success becomes `Stream<Success, Error>`; use for `progress` RPC |
| `primaryKey` | `(payload) => string \| null` | **CRITICAL**: Deduplication key extractor; `null` disables for non-idempotent jobs |

**primaryKey Semantics:**
- When provided: `SaveResult.Duplicate` returns existing result instead of re-executing
- When `null` returned: No deduplication (fire-and-forget jobs)
- Internal: Implements `PrimaryKey.symbol` protocol on payload class
- Pattern: `(p) => p.dedupeKey ?? null` — optional deduplication per-job

### RpcClient Generation

| Function | Job Processing Use |
|----------|-------------------|
| `RpcClient.make(group)` | Not used directly; Entity provides client via `sharding.makeClient(Entity)` |
| `withHeaders(headers)` | Propagate tenant context via `Envelope.headers` |
| `withHeadersEffect(effect)` | Dynamic header injection from `Context.Request.toSerializable` |

**Entity vs RpcClient:**
- Entity jobs use `sharding.makeClient(JobEntity)` — handles shard routing automatically
- RpcClient is for non-clustered RPC (HTTP, WebSocket); Entity client wraps RpcClient internally

### RpcClientError

| Type | Discrimination | Job Processing Use |
|------|----------------|-------------------|
| `RpcClientError` | `TypeId` symbol | Base error for transport failures |

**Pattern:** Map to `JobError.fromRunnerUnavailable` in ClusterService error mapper:
```typescript
Match.when(RpcClientError.TypeId in e, () => JobError.fromRunnerUnavailable(jobId, e))
```

### RpcGroup Composition

| Function | Job Processing Use |
|----------|-------------------|
| `RpcGroup.make(...rpcs)` | Construct JobEntity protocol array |
| `add(rpc)` | Extend group incrementally (not used; Entity takes array) |
| `merge(groups)` | Combine multiple RPC groups (future: job types as separate groups) |
| `middleware(tag)` | Apply `JobMiddleware` to all RPCs in group |
| `prefix(string)` | Namespace collision avoidance (not needed for Entity) |
| `annotate(key, value)` | Attach metadata to group |
| `annotateRpcs(key, value)` | Attach metadata to individual RPCs |
| `toLayer(handlers)` | Convert to Layer; Entity uses `Entity.toLayer` instead |
| `toHandlersContext()` | Direct handler access (testing) |

### RpcMiddleware (Context Injection)

| Option | Type | Job Processing Use |
|--------|------|-------------------|
| `provides` | `Context.Tag<any, any>` | Inject `JobContext` (jobId, tenantId, priority) into handlers |
| `failure` | `Schema.Schema.All` | Typed middleware failure; use `JobError` with `'Validation'` reason |
| `requiredForClient` | `boolean` | Force client-side middleware (auth headers) |
| `optional` | `boolean` | When `true`, failures default to `Schema.Never` |
| `wrap` | `boolean` | Use `RpcMiddlewareWrap` interface for request transformation |

**JobMiddleware Pattern:**
```typescript
class JobContext extends Effect.Tag('JobContext')<JobContext, {
  readonly jobId: string;
  readonly tenantId: string;
  readonly priority: JobPriority;
}>() {}

class JobMiddleware extends RpcMiddleware.Tag<JobMiddleware>()('JobMiddleware', {
  provides: JobContext,
  failure: JobError,
}) {}
```

**Client Middleware:**
```typescript
RpcMiddleware.layerClient(JobMiddleware, Effect.gen(function* () {
  const ctx = yield* Context.Request.current;
  return {
    handler: ({ rpc, request }) => Effect.succeed({
      ...request,
      headers: request.headers.set('x-tenant-id', ctx.tenantId),
    }),
  };
}))
```

### RpcWorker (Background Processing)

| Function | Job Processing Use |
|----------|-------------------|
| `InitialMessage` | Structured message for worker initialization |
| `makeInitialMessage` | Serialize Effect to worker-transferable data |
| `initialMessage` | Decode incoming worker message |
| `layerInitialMessage` | Layer for worker message handling |

**Note:** RpcWorker is for browser/Node worker threads, NOT cluster job workers. Entity mailbox dispatch replaces worker pool patterns for distributed jobs.

### RpcSchema (Streaming)

| Type | Job Processing Use |
|------|-------------------|
| `RpcSchema.Stream<A, E>` | Progress streaming: `Rpc.make('progress', { stream: true })` |
| `isStreamSchema(schema)` | Type guard for stream detection |
| `getStreamSchemas(ast)` | Extract success/failure schemas from AST |

**Progress Streaming Pattern:**
```typescript
Rpc.make('progress', {
  payload: S.Struct({ jobId: S.String }),
  success: S.Struct({ pct: S.Number, message: S.String }),
  stream: true,  // Handler returns Stream<{ pct, message }, JobError>
})

// Handler implementation:
progress: ({ jobId }) => Stream.fromQueue(progressQueue).pipe(
  Stream.filter((p) => p.jobId === jobId),
  Stream.map(({ pct, message }) => ({ pct, message })),
)
```

### RpcSerialization

| Layer | Job Processing Use |
|-------|-------------------|
| `layerMsgPack` | **RECOMMENDED**: Binary efficiency for Entity messages (already in cluster.ts) |
| `layerJson` | Not recommended; larger payloads |
| `layerNdjson` | HTTP streaming only |

**Note:** `RpcSerialization.layerMsgPack` is already configured in `cluster.ts` transport layers.

## RPC Gaps & Workarounds

| Gap | Workaround |
|-----|------------|
| `primaryKey` duplicate returns no jobId | Track in Entity state: `HashMap<dedupeKey, jobId>` |
| No built-in priority mailbox | Route to priority-specific entity pools (4:3:2:1 ratio) |
| `stream: true` error channel is `Schema.Never` | Errors flow through stream failure schema |

## RpcMessage Types (Cancellation)

| Type | Job Processing Use |
|------|-------------------|
| `RpcMessage.Interrupt` | Client cancellation with `requestId` + `interruptors: FiberId[]` |
| `RpcServer.fiberIdClientInterrupt` | Distinguish user cancellation from system interrupt |
| `ResponseDefect` | Unhandled defect → DLQ entry |
