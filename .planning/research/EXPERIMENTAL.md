# @effect/experimental Research

**Version:** 0.58.0 (from pnpm catalog)
**Researched:** 2026-01-28
**Confidence:** MEDIUM (API docs verified, limited real-world examples)

## Executive Summary

`@effect/experimental` provides production-ready primitives for state machines (Machine), event sourcing (Event/EventJournal/EventLog), persistence (Persistence/Redis), rate limiting (RateLimiter/Redis), and discriminated union schemas (VariantSchema). The package complements `@effect/cluster` for distributed systems and `@effect/workflow` for durable orchestration.

**Primary recommendation:** Use Machine for complex entity lifecycles with serializable state, PersistedCache + Persistence/Redis for multi-tenant caching, and the existing RateLimiter/Redis integration already in CacheService.

---

## Core Imports

| Import Path | Provides | When to Use |
|-------------|----------|-------------|
| `@effect/experimental` | PersistedCache, Reactivity, DevTools | Top-level re-exports |
| `@effect/experimental/Machine` | Machine, procedures, serializable | State machines with typed requests |
| `@effect/experimental/Persistence/Redis` | layer, layerResult, layerConfig | Redis-backed persistence |
| `@effect/experimental/RateLimiter` | RateLimiter, RateLimitExceeded, layerStoreMemory | Rate limiting core |
| `@effect/experimental/RateLimiter/Redis` | layerStore, layerStoreConfig | Distributed rate limiting |
| `@effect/experimental/VariantSchema` | make, Struct, Field, Class, Union | Discriminated union schemas |
| `@effect/experimental/Event` | make, EventHandler, isEvent | Event definition with schemas |
| `@effect/experimental/EventGroup` | empty, isEventGroup | Domain event collections |
| `@effect/experimental/EventLog` | schema, Handlers, makeClient | Event sourcing infrastructure |
| `@effect/experimental/EventJournal` | Service, Entry, layerMemory, layerIndexedDb | Journal persistence |

---

## Machine (FSM)

Machines provide typed request/response patterns with state management, serialization, and Effect integration.

### Definition Pattern

```typescript
import { Machine } from '@effect/experimental/Machine'
import { Data, Effect, Schema as S } from 'effect'

// Tagged requests extend Data.TaggedClass for discrimination
class StartRequest extends Data.TaggedClass('Start')<{ readonly id: string }> {}
class StopRequest extends Data.TaggedClass('Stop')<{ readonly reason: string }> {}
type PublicRequest = StartRequest | StopRequest

// State schema for serialization
const StateSchema = S.Struct({ status: S.Literal('idle', 'running', 'stopped'), startedAt: S.OptionFromNullOr(S.DateTimeUtc) })
type State = typeof StateSchema.Type

// Machine definition
const EntityMachine = Machine.makeSerializable({
  stateSchema: StateSchema,
  initialState: Effect.succeed({ status: 'idle' as const, startedAt: Option.none() }),
})(
  Machine.procedures.make<PublicRequest>()('Start', (ctx) =>
    Effect.gen(function* () {
      const now = yield* DateTime.nowUtc
      return [{ started: true }, { status: 'running' as const, startedAt: Option.some(now) }] as const
    })
  ),
  Machine.procedures.make<PublicRequest>()('Stop', (ctx) =>
    Effect.succeed([{ stopped: true }, { ...ctx.state, status: 'stopped' as const }] as const)
  ),
)
```

### Procedure.Context API

| Method | Signature | Purpose |
|--------|-----------|---------|
| `send` | `<Req>(req: Req) => Effect<void>` | Fire-and-forget dispatch |
| `sendAwait` | `<Req>(req: Req) => Effect<Response>` | Dispatch and await response |
| `forkWith` | `(state: State) => <A,E,R>(eff: Effect<A,E,R>) => Effect<Fiber<A,E>>` | Background work with state |
| `forkOneWith` | `(id: string, state: State) => ...` | Keyed background work |
| `forkReplaceWith` | `(id: string, state: State) => ...` | Replace existing keyed work |
| `state` | Current state value | Read-only access |
| `request` | Current request object | Handler input |

### Runtime

```typescript
// Boot machine as Actor
const actor = yield* Machine.boot(EntityMachine)

// Send requests
const result = yield* actor.send(new StartRequest({ id: '123' }))

// Serialize for persistence
const snapshot = yield* Machine.snapshot(actor)

// Restore from persistence
const restored = yield* Machine.restore(EntityMachine, snapshot)
```

### NoReply Pattern

Return `Machine.NoReply` from handlers that should not respond (fire-and-forget internal transitions).

---

## Event Sourcing

Three-tier architecture: Event (definition) -> EventGroup (domain) -> EventLog (infrastructure).

### Event Definition

```typescript
import { Event } from '@effect/experimental/Event'
import { Schema as S } from 'effect'

const UserCreated = Event.make({
  tag: 'UserCreated',
  primaryKey: (payload) => payload.userId,
  payload: S.Struct({ userId: S.String, email: S.String, tenantId: S.String }),
  success: S.Struct({ created: S.Boolean }),
  error: S.Never,
})

const UserUpdated = Event.make({
  tag: 'UserUpdated',
  primaryKey: (payload) => payload.userId,
  payload: S.Struct({ userId: S.String, changes: S.Record(S.String, S.Unknown) }),
  success: S.Struct({ updated: S.Boolean }),
  error: S.TaggedError<{ readonly _tag: 'UserNotFound' }>('UserNotFound'),
})
```

### EventGroup Pattern

```typescript
import { EventGroup } from '@effect/experimental/EventGroup'

const UserEvents = EventGroup.empty
  .add(UserCreated)
  .add(UserUpdated)
  .addError(S.TaggedError<{ readonly _tag: 'DomainError' }>('DomainError'))
```

### EventLog Schema & Handlers

```typescript
import { EventLog } from '@effect/experimental/EventLog'

const AppSchema = EventLog.schema(UserEvents, OtherEvents)

const handlers = AppSchema.handlers
  .handle('UserCreated', (payload, entry, conflict) =>
    Effect.gen(function* () {
      yield* UserRepo.create(payload)
      return { created: true }
    })
  )
  .handle('UserUpdated', (payload, entry, conflict) =>
    Effect.gen(function* () {
      yield* UserRepo.update(payload.userId, payload.changes)
      return { updated: true }
    })
  )

// Client for dispatching
const dispatch = EventLog.makeClient(AppSchema)
yield* dispatch('UserCreated', { userId: '123', email: 'x@y.com', tenantId: 't1' })
```

### EventJournal (Client-Side)

```typescript
import { EventJournal } from '@effect/experimental/EventJournal'

// Browser: IndexedDB persistence
const JournalLayer = EventJournal.layerIndexedDb({ dbName: 'app-journal' })

// Server: Memory (use Redis for production)
const JournalLayer = EventJournal.layerMemory

// Operations
const journal = yield* EventJournal.Service
const entries = yield* journal.entries
yield* journal.write(events, sideEffect)
const changes = yield* journal.changes // Dequeue stream
```

---

## Redis Integration

### Persistence/Redis

Already integrated in codebase via `PersistenceRedis.layerResult`. Key patterns:

```typescript
import * as PersistenceRedis from '@effect/experimental/Persistence/Redis'

// Layer providing ResultPersistence
const PersistenceLayer = PersistenceRedis.layerResult({
  host: 'localhost',
  port: 6379,
  password: undefined, // Redacted.value if present
  prefix: 'persist:',
})

// Config-driven layer (recommended)
const PersistenceLayerConfig = PersistenceRedis.layerResultConfig({
  host: Config.string('REDIS_HOST'),
  port: Config.integer('REDIS_PORT'),
  password: Config.redacted('REDIS_PASSWORD').pipe(Config.option),
  prefix: Config.string('CACHE_PREFIX'),
})
```

### Multi-Tenant Key Patterns

Use prefix hierarchy for tenant isolation:

```typescript
const tenantPrefix = (tenantId: string) => `tenant:${tenantId}:`
const cacheKey = (tenantId: string, entity: string, id: string) =>
  `${tenantPrefix(tenantId)}${entity}:${id}`

// Example: tenant:t123:user:u456
```

### RateLimiter/Redis

Already in CacheService. Pattern reference:

```typescript
import { layerStore as layerStoreRedis } from '@effect/experimental/RateLimiter/Redis'
import { layer as rateLimiterLayer, RateLimiter } from '@effect/experimental/RateLimiter'

const RateLimitLayer = Layer.provide(
  rateLimiterLayer,
  layerStoreRedis({ host: 'localhost', port: 6379, prefix: 'rl:' })
)

// Usage
const limiter = yield* RateLimiter
const result = yield* limiter.consume({
  algorithm: 'token-bucket', // or 'fixed-window'
  key: `api:${tenantId}:${userId}`,
  limit: 100,
  window: Duration.minutes(1),
  tokens: 1,
  onExceeded: 'fail', // or 'delay'
})
```

---

## VariantSchema

Build discriminated unions with variant-specific field schemas.

```typescript
import { VariantSchema } from '@effect/experimental/VariantSchema'
import { Schema as S } from 'effect'

const EventVariant = VariantSchema.make({
  variants: ['Created', 'Updated', 'Deleted'] as const,
  defaultVariant: 'Created',
})

const EventSchema = EventVariant.Struct({
  id: S.String,
  timestamp: S.DateTimeUtc,
  // Variant-specific fields
  data: EventVariant.Field({
    Created: S.Struct({ initialValue: S.Unknown }),
    Updated: S.Struct({ previousValue: S.Unknown, newValue: S.Unknown }),
    Deleted: S.Struct({ reason: S.String }),
  }),
})

// Extract specific variant schema
const CreatedSchema = EventVariant.extract(EventSchema, 'Created')
```

---

## Rate Limiting Comparison

| Feature | @effect/experimental/RateLimiter | @effect/workflow/DurableRateLimiter |
|---------|----------------------------------|-------------------------------------|
| **Persistence** | Redis store (distributed) | Workflow engine (durable) |
| **Scope** | Standalone service | Within workflow context |
| **Recovery** | Redis availability | Full workflow replay |
| **Use When** | API rate limiting, auth throttling | Workflow step throttling |
| **Codebase** | CacheService.rateLimit | Not currently used |

**Recommendation:** Continue using experimental/RateLimiter for API-level rate limiting. Consider workflow/DurableRateLimiter only for orchestrated workflow steps requiring durable execution guarantees.

---

## DevTools

Already integrated via `packages/devtools/src/experimental.ts`. Pattern:

```typescript
import { DevTools } from '@effect/experimental'

// Browser layer with connection test
const DevToolsLayer = DevTools.layer('ws://localhost:3333')

// Safe mode (test before connect)
const SafeDevToolsLayer = Layer.unwrapEffect(
  testConnection(url, timeoutMs).pipe(
    Effect.map((ok) => ok ? DevTools.layer(url) : Layer.empty)
  )
)
```

### Server (for custom tooling)

```typescript
import * as DevToolsServer from '@effect/experimental/DevTools/Server'

DevToolsServer.run((client) =>
  Effect.gen(function* () {
    const request = yield* client.queue.take
    // Handle Domain.Request types
    yield* client.request(responseData)
  })
)
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State machines | Custom FSM with if/switch | Machine.makeSerializable | Typed requests, serialization, Effect integration |
| L1/L2 cache | Manual Redis + memory tier | PersistedCache | Stampede prevention, TTL, schema validation |
| Cross-instance invalidation | Custom pub/sub | Reactivity + Redis bridge | Already integrated in CacheService |
| Rate limiting | Token counters | RateLimiter with Redis store | Algorithms, distributed, metrics |
| Event schema unions | Manual tagged types | VariantSchema | Compile-time variant discrimination |
| Discriminated unions | Large switch statements | Match.type + VariantSchema | Exhaustiveness checking |

---

## Code Patterns

### PersistedCache Factory (from CacheService)

```typescript
const userCache = yield* CacheService.cache({
  storeId: 'users',
  lookup: (key: UserCacheKey) => UserRepo.findById(key.id),
  timeToLive: Duration.minutes(10),
  inMemoryCapacity: 500,
  inMemoryTTL: Duration.seconds(30),
})
```

### Rate Limit Middleware (from CacheService)

```typescript
// Preset-based rate limiting
const handler = CacheService.rateLimit('api', actualHandler)

// Within effect
yield* limiter.consume({
  algorithm: 'token-bucket',
  key: `${preset}:${tenantId}:${ip}`,
  limit: 100,
  window: Duration.minutes(1),
  tokens: 1,
  onExceeded: 'fail',
})
```

### Machine with Entity Lifecycle

```typescript
const OrderMachine = Machine.makeSerializable({
  stateSchema: OrderStateSchema,
  initialState: Effect.succeed({ status: 'draft', items: [], total: 0 }),
})(
  Machine.procedures.make<OrderRequest>()('AddItem', (ctx) =>
    pipe(
      ctx.state,
      (s) => ({ ...s, items: [...s.items, ctx.request.item] }),
      (s) => [{ itemAdded: true }, s] as const,
      Effect.succeed,
    )
  ),
  Machine.procedures.make<OrderRequest>()('Submit', (ctx) =>
    Effect.gen(function* () {
      yield* validateOrder(ctx.state)
      return [{ submitted: true }, { ...ctx.state, status: 'submitted' }] as const
    })
  ),
)
```

---

## Sources

### Primary (HIGH confidence)
- https://effect-ts.github.io/effect/experimental/Machine.ts.html
- https://effect-ts.github.io/effect/experimental/Persistence/Redis.ts.html
- https://effect-ts.github.io/effect/experimental/RateLimiter.ts.html
- https://effect-ts.github.io/effect/experimental/RateLimiter/Redis.ts.html
- https://effect-ts.github.io/effect/experimental/VariantSchema.ts.html
- https://effect-ts.github.io/effect/experimental/Event.ts.html
- https://effect-ts.github.io/effect/experimental/EventGroup.ts.html
- https://effect-ts.github.io/effect/experimental/EventLog.ts.html
- https://effect-ts.github.io/effect/experimental/EventJournal.ts.html
- https://effect-ts.github.io/effect/workflow/DurableRateLimiter.ts.html

### Codebase (HIGH confidence)
- `packages/server/src/platform/cache.ts` - CacheService with PersistedCache, RateLimiter/Redis
- `packages/devtools/src/experimental.ts` - DevTools integration pattern
- `packages/server/src/utils/circuit.ts` - Code style reference

### Secondary (MEDIUM confidence)
- https://effect-ts.github.io/effect/docs/experimental - Package overview
- https://effect.website/blog/this-week-in-effect/2025/11/14/ - Feature announcements

---

## Metadata

**Confidence breakdown:**
- Machine API: MEDIUM (docs verified, limited examples in wild)
- Persistence/Redis: HIGH (codebase already uses it)
- RateLimiter: HIGH (codebase already uses it)
- VariantSchema: MEDIUM (docs verified, no codebase usage)
- Event sourcing: MEDIUM (docs verified, complex integration)
- DevTools: HIGH (codebase already uses it)

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (30 days, experimental but stable APIs)
