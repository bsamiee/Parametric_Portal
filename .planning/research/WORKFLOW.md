# @effect/workflow Research

**Version:** 0.16.0 (from pnpm catalog)
**Researched:** 2026-01-28
**Confidence:** MEDIUM (alpha package, limited official documentation)

## Executive Summary

`@effect/workflow` provides durable execution primitives for TypeScript: workflows survive restarts, activities execute at-most-once, compensation handles rollback. Integrates with `@effect/cluster` for distributed execution via PostgreSQL persistence.

**Primary recommendation:** Use `@effect/workflow` for saga orchestration with `ClusterWorkflowEngine.layer`. Use existing `@effect/experimental` RateLimiter (already in cache.ts) for API rate limiting; `DurableRateLimiter` is workflow-context only.

## Core Imports

| Import Path | Provides | When to Use |
|-------------|----------|-------------|
| `@effect/workflow` | `Workflow`, `Activity`, `DurableClock`, `DurableDeferred`, `DurableQueue` | Workflow definition and durable primitives |
| `@effect/workflow/WorkflowEngine` | `WorkflowEngine`, `WorkflowInstance` | Engine configuration, custom storage |
| `@effect/workflow/WorkflowProxy` | `toHttpApiGroup`, `toRpcGroup` | HTTP/RPC endpoint generation |
| `@effect/workflow/WorkflowProxyServer` | `layerHttpApi`, `layerRpcHandlers` | Server-side workflow handlers |
| `@effect/cluster` | `ClusterWorkflowEngine` | Distributed execution with persistence |

## Workflow Definition

### Workflow.make API

```typescript
// Source: github.com/Effect-TS/effect/packages/workflow/README.md
import { Activity, DurableClock, DurableDeferred, Workflow } from '@effect/workflow'
import { Effect, Schema as S } from 'effect'

// --- [SCHEMA] ----------------------------------------------------------------

const OrderPayload = S.Struct({ orderId: S.String, amount: S.Number, userId: S.String })
const OrderResult = S.Struct({ transactionId: S.String, status: S.Literal('completed', 'compensated') })
class OrderError extends S.TaggedError<OrderError>()('OrderError', { message: S.String }) {}

// --- [WORKFLOW] --------------------------------------------------------------

const OrderWorkflow = Workflow.make({
  name: 'ProcessOrder',
  payload: OrderPayload,
  success: OrderResult,
  error: OrderError,
  idempotencyKey: (payload) => payload.orderId, // Deduplication key
})
```

**Required options:**
- `name`: Unique workflow identifier (string)
- `payload`: Schema for input data
- `idempotencyKey`: Function deriving dedupe key from payload

**Optional options:**
- `success`: Schema for success result (default: `Schema.Void`)
- `error`: Schema for failure type (default: `Schema.Never`)
- `annotations`: Context metadata via `CaptureDefects`, `SuspendOnFailure`

### Workflow Implementation

```typescript
// Source: github.com/Effect-TS/effect/packages/workflow/README.md
const OrderWorkflowLayer = OrderWorkflow.toLayer(
  Effect.fn(function* (payload, executionId) {
    // Activity 1: Reserve inventory
    const reserved = yield* reserveInventory(payload)

    // Activity 2: Charge payment (with compensation)
    const payment = yield* chargePayment(payload).pipe(
      OrderWorkflow.withCompensation(
        Effect.fn(function* (paymentResult, cause) {
          yield* refundPayment(paymentResult.transactionId)
          yield* Effect.log('Refunded payment due to workflow failure', { cause })
        })
      )
    )

    // Durable sleep (survives restarts)
    yield* DurableClock.sleep({ name: 'confirmation-delay', duration: '5 seconds' })

    return { transactionId: payment.transactionId, status: 'completed' as const }
  })
)
```

## Activity Definition

Activities are idempotent work units. Execute once unless explicitly retried.

```typescript
// Source: effect-ts.github.io/effect/workflow/Activity.ts.html
import { Activity } from '@effect/workflow'

class PaymentError extends S.TaggedError<PaymentError>()('PaymentError', {
  code: S.String,
  message: S.String
}) {}

const chargePayment = (payload: typeof OrderPayload.Type) =>
  Activity.make({
    name: 'ChargePayment',
    error: PaymentError,
    execute: Effect.gen(function* () {
      const attempt = yield* Activity.CurrentAttempt
      yield* Effect.log('Charging payment', { orderId: payload.orderId, attempt })
      // External call here
      return { transactionId: `txn_${payload.orderId}` }
    }),
    interruptRetryPolicy: Schedule.exponential('100 millis'), // Optional
  }).pipe(
    Activity.retry({ times: 3 }), // Retry up to 3 times
  )
```

**Activity.make options:**
- `name`: Activity identifier (string)
- `execute`: Effect to run
- `error`: Schema for typed failures
- `success`: Schema for typed result
- `interruptRetryPolicy`: Schedule for interrupt handling

**Activity composition:**
- `Activity.retry({ times: N })`: Retry N times on failure
- `Activity.raceAll([...activities])`: First to complete wins
- `Activity.CurrentAttempt`: Access current attempt number

## Durable Primitives

### DurableClock

Time operations that survive workflow restarts.

```typescript
// Sleep without consuming resources
yield* DurableClock.sleep({
  name: 'wait-for-confirmation',
  duration: '30 minutes',
  inMemoryThreshold: '5 seconds' // Use in-memory for short sleeps
})
```

### DurableDeferred

Async signaling across workflow suspensions. Use for external completion triggers.

```typescript
// Source: effect-ts.github.io/effect/workflow/DurableDeferred.ts.html
const PaymentConfirmation = DurableDeferred.make({
  name: 'payment-webhook',
  success: S.Struct({ webhookId: S.String }),
  error: S.String,
})

// In workflow: await external signal
const confirmation = yield* DurableDeferred.await(PaymentConfirmation)

// From external handler: complete the deferred
const token = DurableDeferred.tokenFromPayload(PaymentConfirmation, OrderWorkflow, payload)
yield* DurableDeferred.succeed(PaymentConfirmation, token, { webhookId: 'wh_123' })
// Or: yield* DurableDeferred.fail(PaymentConfirmation, token, 'webhook_timeout')
```

### DurableQueue

Persistent work distribution with worker processing.

```typescript
// Source: effect-ts.github.io/effect/workflow/DurableQueue.ts.html
const EmailQueue = DurableQueue.make({
  name: 'email-queue',
  payload: S.Struct({ to: S.String, subject: S.String, body: S.String }),
  idempotencyKey: (p) => `${p.to}:${p.subject}`,
  success: S.Struct({ messageId: S.String }),
  error: S.String,
})

// Producer: enqueue work (blocks until worker completes)
const result = yield* DurableQueue.process(EmailQueue, emailPayload)

// Consumer: worker layer
const EmailWorkerLayer = DurableQueue.worker(EmailQueue, {
  concurrency: 5,
  execute: (payload) => Effect.gen(function* () {
    yield* sendEmail(payload)
    return { messageId: `msg_${Date.now()}` }
  }),
})
```

## Saga & Compensation Patterns

### Compensation Registration

`withCompensation` registers cleanup that executes on workflow failure.

```typescript
// Source: github.com/Effect-TS/effect/packages/workflow/README.md
const sagaStep = (stepName: string, forward: Effect.Effect<A>, backward: (a: A) => Effect.Effect<void>) =>
  forward.pipe(
    MyWorkflow.withCompensation(
      Effect.fn(function* (successValue, failureCause) {
        yield* Effect.log(`Compensating ${stepName}`, { cause: failureCause })
        yield* backward(successValue)
      })
    )
  )

// Usage in workflow
yield* sagaStep(
  'reserve-inventory',
  reserveInventory(payload),
  (reservation) => releaseInventory(reservation.reservationId)
)
yield* sagaStep(
  'charge-payment',
  chargePayment(payload),
  (payment) => refundPayment(payment.transactionId)
)
```

**Compensation execution order:** LIFO (last registered, first compensated).

**Callback signature:** `(successValue: A, cause: Cause<E>) => Effect<void>`

### Multi-Step Saga Example

```typescript
const TransferWorkflow = Workflow.make({
  name: 'BankTransfer',
  payload: S.Struct({ from: S.String, to: S.String, amount: S.Number }),
  idempotencyKey: (p) => `${p.from}:${p.to}:${p.amount}:${Date.now()}`,
})

const TransferWorkflowLayer = TransferWorkflow.toLayer(
  Effect.fn(function* (payload) {
    // Step 1: Debit source account
    const debit = yield* Activity.make({
      name: 'DebitAccount',
      execute: debitAccount(payload.from, payload.amount),
    }).pipe(
      TransferWorkflow.withCompensation(
        Effect.fn(function* (_, cause) {
          yield* creditAccount(payload.from, payload.amount) // Rollback debit
        })
      )
    )

    // Step 2: Credit destination (if this fails, Step 1 compensates)
    yield* Activity.make({
      name: 'CreditAccount',
      execute: creditAccount(payload.to, payload.amount),
    })

    return { status: 'completed' }
  })
)
```

## WorkflowEngine Configuration

### In-Memory (Development/Testing)

```typescript
import { WorkflowEngine } from '@effect/workflow/WorkflowEngine'

const TestLayer = pipe(
  OrderWorkflowLayer,
  Layer.provide(WorkflowEngine.layerMemory),
)
```

### Cluster with PostgreSQL (Production)

```typescript
// Source: deepwiki.com/Effect-TS/effect/5.2-cluster-management
import { ClusterWorkflowEngine } from '@effect/cluster'
import { NodeClusterSocket } from '@effect/cluster-node'
import { PgClient } from '@effect/sql-pg'

const ProductionLayer = pipe(
  OrderWorkflowLayer,
  Layer.provide(ClusterWorkflowEngine.layer),
  Layer.provide(NodeClusterSocket.layer({ host: 'localhost', port: 9000 })),
  Layer.provide(PgClient.layer({
    database: 'workflows',
    username: 'postgres',
    password: Config.redacted('PG_PASSWORD')
  })),
)
```

**Storage backends:**
- PostgreSQL: Full advisory lock support, production recommended
- MySQL: Advisory lock via `GET_LOCK()`, connection-pooling compatible
- SQLite: Single-runner only, testing/development

## Proxy Pattern (HTTP/RPC)

### HTTP API Exposure

```typescript
// Source: effect-ts.github.io/effect/workflow/WorkflowProxy.ts.html
import { WorkflowProxy } from '@effect/workflow/WorkflowProxy'
import { WorkflowProxyServer } from '@effect/workflow/WorkflowProxyServer'
import { HttpApi, HttpApiGroup } from '@effect/platform'

// Client-side: Generate API group
class WorkflowApi extends HttpApi.make('workflows')
  .add(WorkflowProxy.toHttpApiGroup('orders', [OrderWorkflow])) {}

// Generates endpoints:
// - POST /orders/ProcessOrder (execute)
// - POST /orders/ProcessOrderDiscard (fire-and-forget)
// - POST /orders/ProcessOrderResume (resume suspended)

// Server-side: Handler layer
const ApiHandlerLayer = WorkflowProxyServer.layerHttpApi(
  WorkflowApi,
  'orders',
  [OrderWorkflow]
)
```

### RPC Exposure

```typescript
import { WorkflowProxy } from '@effect/workflow/WorkflowProxy'
import { WorkflowProxyServer } from '@effect/workflow/WorkflowProxyServer'

// Client-side: Generate RPC group
class WorkflowRpcs extends WorkflowProxy.toRpcGroup([OrderWorkflow], { prefix: 'workflow_' }) {}

// Server-side: Handler layer
const RpcHandlerLayer = WorkflowProxyServer.layerRpcHandlers([OrderWorkflow], { prefix: 'workflow_' })
```

## Rate Limiting Analysis

### Existing cache.ts Implementation

Uses `@effect/experimental/RateLimiter`:
- Algorithms: `token-bucket`, `fixed-window`
- Stores: `layerStoreMemory`, `layerStoreRedis`
- Cluster-aware via Redis store
- NOT workflow-context aware

### DurableRateLimiter (@effect/workflow)

```typescript
// Source: effect-ts.github.io/effect/workflow/DurableRateLimiter.ts.html
import { DurableRateLimiter } from '@effect/workflow'

// INSIDE workflow only
const rateLimited = yield* DurableRateLimiter.rateLimit({
  name: 'api-calls',
  algorithm: 'token-bucket',
  window: '1 minute',
  limit: 100,
  key: `user:${payload.userId}`,
  tokens: 1,
})
```

**Critical difference:**
- `DurableRateLimiter`: Workflow-context, survives workflow replay, NOT for HTTP middleware
- `@effect/experimental/RateLimiter`: General-purpose, Redis-backed, USE for HTTP middleware

**Recommendation:** Keep existing cache.ts rate-limiting for API layer. Use `DurableRateLimiter` only within workflow activities that need replay-safe throttling (e.g., external API calls inside workflows).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Workflow state persistence | Custom DB schema | `ClusterWorkflowEngine.layer` | Handles replay, deduplication, sharding |
| Activity idempotency | Manual dedupe logic | `Activity.make` + idempotencyKey | Built-in at-most-once semantics |
| Compensation ordering | Manual rollback stack | `Workflow.withCompensation` | LIFO execution guaranteed |
| Distributed coordination | Custom locking | `DurableDeferred` | Token-based signaling |
| Work distribution | Manual queue polling | `DurableQueue` + worker | Persistent, resumable processing |
| Durable timers | setTimeout with DB | `DurableClock.sleep` | Resource-free suspension |
| HTTP workflow endpoints | Manual route handlers | `WorkflowProxy.toHttpApiGroup` | Schema-derived, typed endpoints |

## Common Pitfalls

### Pitfall 1: Non-Deterministic Workflow Code

**What goes wrong:** Random values, timestamps, UUIDs in workflow body cause replay divergence.
**Why it happens:** Workflow replays must produce identical execution path.
**How to avoid:** Use activities for non-deterministic operations.
```typescript
// BAD: In workflow
const id = crypto.randomUUID()

// GOOD: Via activity
const id = yield* Activity.make({ name: 'GenerateId', execute: Effect.sync(() => crypto.randomUUID()) })
```

### Pitfall 2: Missing Idempotency Keys

**What goes wrong:** Duplicate workflow executions on retry.
**Why it happens:** Idempotency key not unique per logical operation.
**How to avoid:** Include all discriminating payload fields.
```typescript
// BAD: Same key for different amounts
idempotencyKey: (p) => p.orderId

// GOOD: Include amount if it varies
idempotencyKey: (p) => `${p.orderId}:${p.amount}`
```

### Pitfall 3: Compensation Without Activities

**What goes wrong:** Compensation side-effects re-execute on replay.
**Why it happens:** Compensation logic not wrapped in activity.
**How to avoid:** Wrap compensating effects in activities.
```typescript
// BAD: Direct effect in compensation
withCompensation(Effect.fn(function* (v, c) {
  yield* refundPayment(v.transactionId) // Re-executes on replay!
}))

// GOOD: Activity-wrapped compensation
withCompensation(Effect.fn(function* (v, c) {
  yield* Activity.make({
    name: `Compensate:${v.transactionId}`,
    execute: refundPayment(v.transactionId)
  })
}))
```

### Pitfall 4: Blocking Workflow Thread

**What goes wrong:** Long-running sync operations block workflow executor.
**Why it happens:** Heavy computation in workflow body.
**How to avoid:** Offload to activities, use DurableQueue for heavy work.

## Integration with @effect/cluster

```typescript
// Source: deepwiki.com/Effect-TS/effect/5.2-cluster-management

// Cluster provides:
// - Shard management with consistent hashing
// - Entity lifecycle (create, route, deactivate)
// - Message storage with at-least-once delivery
// - Runner failover and rebalancing

// Workflow entities hash to shards:
// entityId -> shardId (modulo arithmetic)
// shardId -> runnerId (shard assignment)

// On runner failure:
// 1. Shard reassigned to healthy runner
// 2. Workflow instance recreated
// 3. Execution replays from persisted state
// 4. Resumes at last completed activity
```

## Open Questions

1. **DurableRateLimiter cluster behavior**
   - What we know: Returns Activity with RateLimiter, uses workflow context
   - What's unclear: Whether state shared across cluster or per-workflow-instance
   - Recommendation: Test in cluster setup before relying on cross-instance coordination

2. **Transactional outbox integration**
   - What we know: Workflow activities are idempotent, DurableQueue provides at-least-once
   - What's unclear: No explicit outbox pattern in @effect/workflow docs
   - Recommendation: Implement outbox as activity + DurableDeferred for acknowledgment

3. **Schema versioning for long-running workflows**
   - What we know: Payload/success/error use Schema
   - What's unclear: Migration strategy for in-flight workflows when schemas change
   - Recommendation: Use Schema versioning with backward compatibility

## Sources

### Primary (HIGH confidence)
- [effect-ts.github.io/effect/workflow/Workflow.ts.html](https://effect-ts.github.io/effect/workflow/Workflow.ts.html) - Workflow API
- [effect-ts.github.io/effect/workflow/Activity.ts.html](https://effect-ts.github.io/effect/workflow/Activity.ts.html) - Activity API
- [effect-ts.github.io/effect/workflow/WorkflowEngine.ts.html](https://effect-ts.github.io/effect/workflow/WorkflowEngine.ts.html) - Engine API
- [github.com/Effect-TS/effect/packages/workflow/README.md](https://github.com/Effect-TS/effect/blob/main/packages/workflow/README.md) - Official README

### Secondary (MEDIUM confidence)
- [deepwiki.com/Effect-TS/effect/5.2-cluster-management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Cluster integration
- [effect.website/blog/effect-2025-year-in-review](https://effect.website/blog/effect-2025-year-in-review/) - Package status

### Tertiary (LOW confidence)
- DurableRateLimiter cluster behavior - inferred from API docs, not verified
- Transactional outbox patterns - general pattern knowledge, not @effect/workflow specific

## Metadata

**Confidence breakdown:**
- Workflow/Activity API: HIGH - Official docs
- Compensation patterns: HIGH - README examples
- ClusterWorkflowEngine: MEDIUM - DeepWiki, not primary docs
- DurableRateLimiter specifics: LOW - Limited documentation

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (alpha package, may change rapidly)
