# Phase 2: Context Integration - Research

**Researched:** 2026-01-29
**Domain:** FiberRef-based request context, cluster state propagation, branded types for shard/runner IDs
**Confidence:** HIGH

## Summary

Phase 2 extends the existing `Context.Request.Data` interface with cluster state (`shardId`, `runnerId`, `isLeader`). The codebase already has a robust FiberRef-based context system in `context.ts` and middleware population in `middleware.ts`. This phase follows the established patterns rather than inventing new ones.

**Key Design Decisions:**
1. **Outer Option, inner nulls**: `cluster: Option.Option<ClusterState>` where `ClusterState` uses `| null` (not nested Options)
2. **Official ShardId class**: Use `ShardId` from @effect/cluster (implements Equal/Hash) — branded string for serialization only
3. **RunnerId branded**: `Snowflake.toString()` result as branded string via Schema

**Primary recommendation:** Extend `Context.Request.Data` with `cluster: Option.Option<ClusterState>` following the existing circuit/session pattern. ClusterState uses `null` (not `Option`) for internal optionality to avoid nesting. Use official `ShardId` class directly for internal state, branded strings for serialization.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect` | 3.19.15 | FiberRef, Context, Option, Schema, Match | Foundation for all context operations |
| `@effect/cluster` | 0.56.0 | Sharding, ShardId, Entity, Snowflake, SocketRunner | Cluster state access |
| `@effect/platform` | 0.94.2 | HttpMiddleware, HttpServerRequest, HttpTraceContext | Request context population |
| `@effect/platform-node` | 0.104.1 | NodeClusterSocket, NodeSocket, NodeFileSystem | Node-specific cluster transport |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/rpc` | 0.73.0 | RPC context propagation | Cross-pod trace context |
| `@effect/workflow` | 0.16.0 | Workflow context, DurableDeferred | Activity context patterns (Phase 5+) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| FiberRef for cluster context | Effect.Tag service | FiberRef allows default values, no R type pollution |
| Option for cluster state | Nullable fields | Option is established pattern in existing context.ts |
| Branded ShardId | Plain string | Branded prevents accidental mixing with entity IDs |

**Installation:**
All packages already in pnpm-workspace.yaml catalog. No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── context.ts           # EXTEND: Add ClusterState interface, cluster field
├── middleware.ts        # EXTEND: Add cluster context population
└── infra/cluster.ts     # EXISTS: Sharding service (Phase 1 complete)
```

### Canonical ClusterState Definition
**What:** Single source of truth for cluster context types
**Location:** `context.ts` (extends existing Data interface)
```typescript
// --- [IMPORTS] ---------------------------------------------------------------
import { ShardId, Snowflake } from '@effect/cluster';
import { Effect, FiberRef, Option, pipe, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------
// Branded types for serialization boundaries only
const RunnerId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('RunnerId'));
const ShardIdString = S.String.pipe(S.pattern(/^[a-zA-Z0-9_-]+:\d+$/), S.brand('ShardIdString'));

// Type extraction (no separate type declarations)
type RunnerId = typeof RunnerId.Type;
type ShardIdString = typeof ShardIdString.Type;

// --- [CONSTRUCTORS] ----------------------------------------------------------
// Trusted internal constructors: Schema.decodeSync validates, brand preserves
const _makeRunnerId = (snowflake: Snowflake.Snowflake): RunnerId =>
  S.decodeSync(RunnerId)(Snowflake.toString(snowflake));

const _makeShardIdString = (shardId: ShardId): ShardIdString =>
  S.decodeSync(ShardIdString)(shardId.toString());  // Instance method, not static

// --- [STATE] -----------------------------------------------------------------
// ClusterState: outer Option, inner nulls (avoids Option nesting)
interface ClusterState {
  readonly shardId: ShardId | null;     // Official class with Equal/Hash
  readonly runnerId: RunnerId | null;   // Branded string from Snowflake
  readonly isLeader: boolean;           // Dynamic: set on singleton entry
  readonly entityType: string | null;   // Set on entity handler entry
  readonly entityId: string | null;     // Set on entity handler entry
}

const _clusterDefault: ClusterState = {
  entityId: null,
  entityType: null,
  isLeader: false,
  runnerId: null,
  shardId: null,
};

// --- [CONTEXT EXTENSION] -----------------------------------------------------
// Extend existing Data interface (alphabetical field order)
interface Data {
  readonly circuit: Option.Option<Circuit>;
  readonly cluster: Option.Option<ClusterState>;  // NEW
  readonly ipAddress: Option.Option<string>;
  readonly rateLimit: Option.Option<RateLimit>;
  readonly requestId: string;
  readonly session: Option.Option<Session>;
  readonly tenantId: string;
  readonly userAgent: Option.Option<string>;
}

const _default: Data = {
  circuit: Option.none(),
  cluster: Option.none(),  // NEW
  ipAddress: Option.none(),
  rateLimit: Option.none(),
  requestId: crypto.randomUUID(),
  session: Option.none(),
  tenantId: _Id.default,
  userAgent: Option.none(),
};
```

### Pattern: Middleware Context Population
**What:** Populate cluster context in HTTP middleware before handlers execute
**When to use:** All HTTP requests that may interact with cluster
```typescript
// --- [MIDDLEWARE] ------------------------------------------------------------
import { Sharding, Snowflake } from '@effect/cluster';
import { HttpMiddleware, HttpServerRequest } from '@effect/platform';
import { Effect, Option, pipe } from 'effect';

// Cluster state factory: produces ClusterState from Sharding service
const _clusterStateFromSharding = (sharding: Sharding.Sharding) =>
  Effect.map(sharding.getSnowflake, (snowflake): ClusterState => ({
    ..._clusterDefault,
    runnerId: _makeRunnerId(snowflake),
  }));

// Middleware extension (add to existing makeRequestContext)
const makeRequestContext = (findByNamespace: Middleware.RequestContextLookup) =>
  HttpMiddleware.make((app) => Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    // ... existing context population ...

    // Cluster context: graceful degradation via serviceOption
    const cluster = yield* pipe(
      Effect.serviceOption(Sharding.Sharding),
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeed(Option.none<ClusterState>()),
        onSome: (sharding) => Effect.map(_clusterStateFromSharding(sharding), Option.some),
      })),
    );

    const ctx: Context.Request.Data = {
      circuit: Option.none(),
      cluster,  // NEW
      ipAddress: _extractClientIp(req.headers, req.remoteAddress),
      rateLimit: Option.none(),
      requestId,
      session: Option.none(),
      tenantId,
      userAgent: Headers.get(req.headers, 'user-agent'),
    };

    // Span annotation: functional pipeline (no if/else)
    yield* pipe(
      cluster,
      Option.flatMap((c) => Option.fromNullable(c.runnerId)),
      Option.match({
        onNone: () => Effect.void,
        onSome: (id) => Effect.annotateCurrentSpan('cluster.runner_id', id),
      }),
    );

    return yield* Context.Request.within(tenantId, app.pipe(
      Effect.provideService(Context.Request, ctx),
    ), ctx);
  }));
```

### Pattern: Handler Access via Static Methods
**What:** Expose cluster context via static methods on Context.Request class
**When to use:** Handler code accessing cluster state
```typescript
// --- [ACCESSORS] -------------------------------------------------------------
import { Data, Effect, FiberRef, Option, pipe } from 'effect';
import { ShardId } from '@effect/cluster';

// Tagged error for missing cluster context (development guard)
class ClusterContextRequired extends Data.TaggedError('ClusterContextRequired')<{
  readonly operation: string;
}> {}

class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
  // ... existing static methods unchanged ...

  /** Access cluster state, fails with tagged error if not in cluster scope */
  static readonly cluster = pipe(
    FiberRef.get(_ref),
    Effect.flatMap((ctx) => pipe(
      ctx.cluster,
      Option.match({
        onNone: () => Effect.fail(new ClusterContextRequired({ operation: 'cluster' })),
        onSome: Effect.succeed,
      }),
    )),
  );

  /** Access shard ID: Option.none() outside entity scope, Option.some(ShardId) inside */
  static readonly shardId: Effect.Effect<Option.Option<ShardId>, never, never> = pipe(
    FiberRef.get(_ref),
    Effect.map((ctx) => pipe(
      ctx.cluster,
      Option.flatMap((c) => Option.fromNullable(c.shardId)),
    )),
  );

  /** Access runner ID: Option.none() outside cluster, Option.some(RunnerId) inside */
  static readonly runnerId: Effect.Effect<Option.Option<RunnerId>, never, never> = pipe(
    FiberRef.get(_ref),
    Effect.map((ctx) => pipe(
      ctx.cluster,
      Option.flatMap((c) => Option.fromNullable(c.runnerId)),
    )),
  );

  /** Check leader status: false outside cluster/singleton scope */
  static readonly isLeader: Effect.Effect<boolean, never, never> = pipe(
    FiberRef.get(_ref),
    Effect.map((ctx) => pipe(
      ctx.cluster,
      Option.map((c) => c.isLeader),
      Option.getOrElse(() => false),
    )),
  );

  /** Update cluster context within current fiber */
  static readonly updateCluster = (partial: Partial<ClusterState>) =>
    FiberRef.update(_ref, (ctx) => ({
      ...ctx,
      cluster: Option.some({ ...Option.getOrElse(ctx.cluster, () => _clusterDefault), ...partial }),
    }));

  /** Run effect with scoped cluster context (reverts after completion) */
  static readonly withinCluster = <A, E, R>(
    partial: Partial<ClusterState>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.locallyWith(effect, _ref, (ctx) => ({
      ...ctx,
      cluster: Option.some({ ...Option.getOrElse(ctx.cluster, () => _clusterDefault), ...partial }),
    }));
}
```

### Pattern: Entity Handler Context Scoping
**What:** Update cluster context when entering entity handler scope
**When to use:** Entity handlers that need full cluster context
```typescript
// --- [ENTITY CONTEXT] --------------------------------------------------------
import { Entity, ShardId } from '@effect/cluster';
import { Effect, FiberRef, Option } from 'effect';

// Wrap entity handler with cluster context injection
const withEntityContext = <A, E, R>(
  entityType: string,
  entityId: string,
  shardId: ShardId,  // Official class, not string
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.locallyWith(effect, _ref, (ctx) => ({
    ...ctx,
    cluster: Option.some({
      ...Option.getOrElse(ctx.cluster, () => _clusterDefault),
      entityId,
      entityType,
      shardId,
    }),
  }));

// Usage in ClusterEntityLive (from cluster.ts)
const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
  const currentAddress = yield* Entity.CurrentAddress;
  const stateRef = yield* Ref.make(EntityState.idle());
  return {
    process: (envelope) => withEntityContext(
      'Cluster',
      currentAddress.entityId,
      currentAddress.shardId,
      Effect.gen(function* () {
        // Handler logic with full cluster context available
        yield* Ref.set(stateRef, EntityState.processing());
        // ... process payload
      }),
    ),
    status: () => Ref.get(stateRef).pipe(Effect.map((s) => new StatusResponse(s))),
  };
}), { /* toLayer options */ });
```

### Anti-Patterns to Avoid
- **Loose string identifiers for shardId/runnerId:** Use branded types to prevent mixing with entity IDs
- **Mandatory cluster context:** Use `Option` - not all requests traverse cluster
- **Polling for cluster state:** Sharding.getShardId is synchronous, no need for polling
- **Duplicating runner ID calculation:** Cache at middleware entry, propagate via FiberRef
- **Using await in context population:** All operations must use Effect for proper fiber context

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shard ID type | Branded string schema | `ShardId` class from @effect/cluster | Equal/Hash protocols, **cached instances** |
| Shard ID calculation | Custom consistent hash | `sharding.getShardId(entityId, group)` | Synchronous, returns ShardId |
| Shard ID serialization | Custom format | `shardId.toString()` / `ShardId.fromString()` | Instance method for stringify |
| Shard locality check | Custom DB query | `sharding.hasShardId(shardId)` | Synchronous boolean, no I/O |
| Entity address in handler | Manual parameter threading | `Entity.CurrentAddress` context tag | Automatically provides shardId, entityId, entityType |
| Runner network address | Environment parsing | `Entity.CurrentRunnerAddress` | Provides host/port from cluster |
| Runner identification | Environment variable parsing | `sharding.getSnowflake` | Cluster-assigned, globally unique |
| Snowflake timestamp | Manual bit manipulation | `Snowflake.timestamp(sf)` / `Snowflake.toParts(sf)` | Handles epoch correctly |
| Leader election status | DB-backed flag polling | `Singleton.make` context scope | Automatic via shard assignment |
| Context propagation | Manual parameter threading | `FiberRef.locally` / `FiberRef.locallyWith` | Automatic child fiber inheritance |
| Cross-pod serialization | Custom JSON mapping | `Schema.Class` with `fromData` | Automatic encode/decode, validation |
| Cross-pod trace context | Manual header extraction | `HttpTraceContext.toHeaders/fromHeaders` | W3C/B3 format support |
| Request-scoped state | `Context.Tag` with explicit provision | FiberRef with default | No R type pollution |
| Header manipulation | Manual string concat | `HttpServerResponse.setHeaders` | Type-safe, chainable |
| Proxy header extraction | Custom X-Forwarded parsing | `HttpMiddleware.xForwardedHeaders` | Standard compliant |

**Key insight:** The existing FiberRef-based context pattern in context.ts is the correct architecture. Cluster state is just another optional field following the established `circuit`, `session`, `rateLimit` pattern. Use `ShardId` CLASS directly (not string) for internal state — it provides structural equality and hash protocols.

## Common Pitfalls

### Pitfall 1: FiberRef Copy-on-Fork Semantics
**What goes wrong:** Updates in child fibers don't propagate back to parent
**Why it happens:** FiberRef has copy-on-fork semantics - child gets snapshot at fork time
**How to avoid:** Use `Effect.locally/locallyWith` for scoped context updates. If updates must survive fork, use `Fiber.join` which merges FiberRefs back to parent.
**Warning signs:** Entity handler context changes not visible in response middleware

### Pitfall 2: Blocking on Cluster Service Availability
**What goes wrong:** Middleware fails when Sharding service not yet initialized
**Why it happens:** Layer composition order - HTTP server may start before cluster
**How to avoid:** Use `Effect.serviceOption(Sharding.Sharding)` with fallback to `Option.none()`. Cluster context becomes available after cluster layer initializes.
**Warning signs:** Startup failures with "Service not found: Sharding"

### Pitfall 3: Using Await in Context Population
**What goes wrong:** Lost fiber context, trace breaks, FiberRef values lost
**Why it happens:** `await` breaks out of Effect runtime, loses fiber identity
**How to avoid:** All context population must use Effect.gen/Effect.flatMap. Use `Effect.promise` only for external async interop.
**Warning signs:** "Effect is not a Promise" errors, missing trace context

### Pitfall 4: Branded Type Bypass
**What goes wrong:** Type safety violations when casting raw strings to branded types
**Why it happens:** Using `as ShardId` directly instead of validation
**How to avoid:** Define private `_make*` functions for trusted internal use. Always validate untrusted input via Schema.decode.
**Warning signs:** Runtime errors from malformed shard IDs, type narrowing failures

### Pitfall 5: Option.none vs undefined for Missing Context
**What goes wrong:** Inconsistent null handling, type inference failures
**Why it happens:** Mixing `undefined` and `Option.none()` for absent values
**How to avoid:** Always use `Option.none()` - established pattern in existing context.ts. Never use `undefined` for optional context fields.
**Warning signs:** TypeScript errors about `undefined` not assignable to `Option`

### Pitfall 6: Stale Runner ID After Restart
**What goes wrong:** Cached runner ID doesn't update after pod restart
**Why it happens:** Runner ID fetched once at middleware init, not per-request
**How to avoid:** Fetch runner ID per-request from `sharding.getSnowflake`. The operation is fast (no I/O).
**Warning signs:** Multiple pods reporting same runner ID in metrics

### Pitfall 7: FiberRef in Workflow Activities
**What goes wrong:** Context populated via FiberRef at workflow start is lost after suspension
**Why it happens:** Workflow replay reconstructs from persisted state, not memory
**How to avoid:** Capture context in workflow **payload** at submission time, not via FiberRef
**Warning signs:** Null/default context values in resumed workflow activities

## Advanced Effect APIs

### FiberRef Advanced Patterns
```typescript
// --- [FIBERREF ADVANCED] -----------------------------------------------------
import { Effect, FiberRef, Option } from 'effect';

// FiberRef.locallyScoped: modification lasts for duration of Scope
// Useful for entity handlers with explicit Scope lifecycle
const withEntityScope = <A, E, R>(
  partial: Partial<ClusterState>,
  effect: Effect.Effect<A, E, R | Scope>,
): Effect.Effect<A, E, R | Scope> =>
  FiberRef.locallyScoped(_ref, { ..._default, cluster: Option.some({ ..._clusterDefault, ...partial }) })
    .pipe(Effect.zipRight(effect));

// FiberRef.getAndUpdate: atomic get-and-update, returns old value
static readonly markAsLeader = FiberRef.getAndUpdate(_ref, (ctx) => ({
  ...ctx,
  cluster: Option.some({ ...Option.getOrElse(ctx.cluster, () => _clusterDefault), isLeader: true }),
})).pipe(Effect.map((old) => Option.flatMapNullable(old.cluster, (c) => c.isLeader)));

// FiberRef.modify: transform value and return computed result in one atomic operation
static readonly enterEntityScope = (entityType: string, entityId: string, shardId: ShardId) =>
  FiberRef.modify(_ref, (ctx) => {
    const wasInCluster = Option.isSome(ctx.cluster);
    const newCtx = {
      ...ctx,
      cluster: Option.some({ ...Option.getOrElse(ctx.cluster, () => _clusterDefault), entityType, entityId, shardId }),
    };
    return [wasInCluster, newCtx] as const;  // [returnValue, newState]
  });
```

### Dual Pattern for Pipeable APIs
```typescript
// --- [DUAL PATTERN] ----------------------------------------------------------
import { dual } from 'effect/Function';

// dual enables both data-first and data-last (pipeable) signatures
static readonly withinCluster: {
  <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<ClusterState>): Effect.Effect<A, E, R>;
  (partial: Partial<ClusterState>): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
} = dual(
  2,
  <A, E, R>(effect: Effect.Effect<A, E, R>, partial: Partial<ClusterState>): Effect.Effect<A, E, R> =>
    FiberRef.locallyWith(_ref, (ctx) => ({
      ...ctx,
      cluster: Option.some({ ...Option.getOrElse(ctx.cluster, () => _clusterDefault), ...partial }),
    }))(effect)
);

// Usage:
// Data-first: Context.Request.withinCluster(myEffect, { isLeader: true })
// Data-last:  myEffect.pipe(Context.Request.withinCluster({ isLeader: true }))
```

### Option Functional Patterns
```typescript
// --- [OPTION PATTERNS] -------------------------------------------------------
import { Option } from 'effect';

// Option.flatMapNullable: combines flatMap + fromNullable (most common pattern)
const runnerId = Option.flatMapNullable(ctx.cluster, (c) => c.runnerId);

// Option.exists: predicate check returning boolean (no Effect wrapper)
const isCurrentlyLeader = Option.exists(ctx.cluster, (c) => c.isLeader);

// Option.contains: equality check using Equivalence
const isInShard = (targetShardId: ShardId) =>
  Option.flatMapNullable(ctx.cluster, (c) => c.shardId).pipe(
    Option.containsWith(ShardId.Equivalence)(targetShardId)
  );
```

### Match Exhaustive Patterns
```typescript
// --- [MATCH PATTERNS] --------------------------------------------------------
import { Match } from 'effect';

// Match.tagsExhaustive: compile-time exhaustiveness for tagged unions
const handleClusterError = Match.type<ClusterError>().pipe(
  Match.tagsExhaustive({
    MailboxFull: (e) => Effect.logWarning('Backpressure needed', { entityId: e.entityId }),
    SendTimeout: (e) => Effect.logError('SLA exceeded', { entityId: e.entityId }),
    PersistenceError: (e) => Effect.logError('Storage failure', { cause: e.cause }),
    // ... all other variants required at compile time
  })
);

// Match.discriminatorsExhaustive: for non-_tag discriminant fields
const matchByReason = Match.type<ClusterError>().pipe(
  Match.discriminatorsExhaustive('reason')({
    AlreadyProcessingMessage: (e) => /* ... */,
    MailboxFull: (e) => /* ... */,
    // ... compile-time exhaustive
  })
);
```

## Additional Patterns

### Observability Attributes Extension
**What:** Extend `toAttrs` for cluster context in traces
```typescript
// --- [OBSERVABILITY] ---------------------------------------------------------
import { FiberId, Option, pipe, Record } from 'effect';
import { ShardId } from '@effect/cluster';

// Extend existing toAttrs (add to existing Record.getSomes call)
// Use Option.flatMapNullable for concise null-to-Option conversion
static readonly toAttrs = (ctx: Context.Request.Data, fiberId: FiberId.FiberId): Record.ReadonlyRecord<string, string> =>
  Record.getSomes({
    // ... existing attributes unchanged ...
    'cluster.entity_id': Option.flatMapNullable(ctx.cluster, (c) => c.entityId),
    'cluster.entity_type': Option.flatMapNullable(ctx.cluster, (c) => c.entityType),
    'cluster.is_leader': Option.map(ctx.cluster, (c) => String(c.isLeader)),
    'cluster.runner_id': Option.flatMapNullable(ctx.cluster, (c) => c.runnerId),
    'cluster.shard_id': Option.flatMapNullable(ctx.cluster, (c) => c.shardId).pipe(
      Option.map((s) => s.toString()),  // Instance method
    ),
  });
```

### Serializable Class Extension
**What:** Extend existing Context.Serializable for cross-pod trace propagation
```typescript
// --- [SERIALIZABLE] ----------------------------------------------------------
import { ShardId } from '@effect/cluster';
import { Option, pipe, Schema as S } from 'effect';

// Branded schemas for serialization (same as in Canonical ClusterState)
const RunnerId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('RunnerId'));
const ShardIdString = S.String.pipe(S.pattern(/^[a-zA-Z0-9_-]+:\d+$/), S.brand('ShardIdString'));

// Extend existing Serializable class (add fields, preserve fromData pattern)
class Serializable extends S.Class<Serializable>('server/Context.Serializable')({
  // Existing fields unchanged
  ipAddress: S.optional(S.String),
  requestId: S.String,
  sessionId: S.optional(S.String),
  tenantId: S.String,
  userId: S.optional(S.String),
  // NEW: Cluster fields (optional for backward compatibility)
  runnerId: S.optional(RunnerId),
  shardId: S.optional(ShardIdString),
}) {
  static readonly fromData = (ctx: Context.Request.Data): Serializable =>
    new Serializable({
      ipAddress: Option.getOrUndefined(ctx.ipAddress),
      requestId: ctx.requestId,
      tenantId: ctx.tenantId,
      ...pipe(ctx.session, Option.match({
        onNone: () => ({}),
        onSome: (s) => ({ sessionId: s.id, userId: s.userId }),
      })),
      // NEW: Extract cluster fields (null → undefined for S.optional)
      ...Option.match(ctx.cluster, {
        onNone: () => ({}),
        onSome: (c) => ({
          runnerId: c.runnerId ?? undefined,
          shardId: Option.flatMapNullable(Option.some(c), (x) => x.shardId).pipe(
            Option.map((s) => S.decodeSync(ShardIdString)(s.toString())),  // Instance method
            Option.getOrUndefined,
          ),
        }),
      }),
    });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Thread-local storage | FiberRef with Effect | Effect adoption | Type-safe, automatic propagation |
| Manual context threading | Effect.locallyWith | Effect 3.x | No parameter boilerplate |
| Nullable fields | Option monad | Effect convention | Exhaustive matching required |
| String identifiers | Branded types via Schema | Effect Schema | Compile-time type safety |

**Deprecated/outdated:**
- `Context.Tag` for request-scoped state: Use FiberRef (no R type pollution)
- `undefined` for missing values: Use `Option.none()` (Effect convention)
- Manual trace context propagation: Automatic via @effect/rpc

## Resolved Technical Decisions

Answers to open questions, verified against @effect/cluster source and codebase patterns:

### Decision 1: Leader Status Strategy — Dynamic Update on Singleton Entry

**Resolution:** Hybrid approach following Effect patterns:
- **runnerId**: Cached at middleware entry via `sharding.getSnowflake` (doesn't change during request)
- **isLeader**: Dynamic — set to `true` when entering singleton handler scope via `Context.Request.withinCluster`
- **shardId**: Dynamic — set when entering entity handler scope

**Why:** Leadership is singleton-scoped, not request-scoped. A request may traverse multiple contexts (HTTP → entity → singleton). The context updates as scope changes via `Effect.locallyWith`.

```typescript
// Singleton handler wraps work with leader context
ClusterService.singleton('leader-job', Context.Request.withinCluster(
  { isLeader: true },
  Effect.gen(function* () { yield* leaderOnlyWork; }),
));
```

### Decision 2: ShardId Type — Official Class for Internal, Branded String for Serialization

**Resolution:** Use `ShardId` class directly in ClusterState, convert to branded string for serialization.

| Layer | Type | Why |
|-------|------|-----|
| Internal (ClusterState) | `ShardId \| null` | Equal/Hash protocols, structural equality |
| Serialization (Serializable) | `ShardIdString` (branded) | String-safe for JSON/RPC |
| Context field | `Option<ClusterState>` | Outer Option, inner nulls |

**Key APIs from @effect/cluster:**
- `ShardId.make(group, id)` — Factory
- `ShardId.toString(shardId)` — "group:id" string
- `ShardId.fromString(s)` — Parse back
- `ShardId` implements `Equal`, `Hash` — Works in Effect data structures

### Decision 3: Cross-Pod Serialization — Extend Existing Serializable Class

**Resolution:** Extend `Context.Serializable` with optional cluster fields (backward compatible).

**What to serialize:**
- `runnerId` — Correlation for distributed traces
- `shardId` — Routing context for cross-pod calls
- `traceId` / `spanId` — For workflow trace correlation (future phases)

**What NOT to serialize:**
- `isLeader` — Singleton-scoped, not meaningful across pods
- `entityType`/`entityId` — Changes during request lifecycle

**Properties:**
1. **Polymorphic**: Same class handles with/without cluster fields
2. **Backward compatible**: Optional fields — old consumers unaffected
3. **Schema-driven**: Uses `S.Class` automatic encode/decode
4. **Single source**: No separate cluster-specific serializable class

### Decision 4: Workflow Context vs Request Context (Forward-Looking)

**Context lifecycle comparison:**

| Aspect | Request Context | Workflow Context |
|--------|-----------------|------------------|
| **Lifetime** | Single HTTP request (ms-sec) | Minutes to days (across suspensions) |
| **Storage** | FiberRef (in-memory) | Persisted via WorkflowEngine storage |
| **Propagation** | Automatic via FiberRef fork | Explicit via payload/executionId parameters |
| **Serialization** | Optional (`Context.Serializable`) | **MANDATORY** for all cross-boundary types |

**Key insight:** Workflow handlers cannot access `Context.Request` FiberRef directly because:
1. Workflows may resume on different pods after suspension
2. FiberRef state is not serialized across pod boundaries
3. The `executionId` becomes the primary correlation key

**Resolution for Phase 5+:** Capture cluster context in workflow **payload** at submission time:
```typescript
// At workflow submission, serialize context into payload
const submitWorkflow = (domainPayload: DomainPayload) =>
  Effect.gen(function* () {
    const serializable = yield* Context.Request.toSerializable;
    return yield* WorkflowEngine.execute(OrderWorkflow, {
      ...domainPayload,
      context: serializable,  // Captured at submission, available after resumption
    });
  });
```

**Activity context access pattern:**
- **CORRECT:** Access context from workflow payload: `payload.context.tenantId`
- **INCORRECT:** Access via FiberRef: `yield* Context.Request.current` (returns defaults after suspension)

## Sources

### Primary (HIGH confidence)
- [Effect Fibers Documentation](https://effect.website/docs/concurrency/fibers/) - FiberRef semantics, fork behavior
- [Effect Branded Types](https://effect.website/docs/code-style/branded-types/) - Schema.brand patterns
- [Sharding.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/Sharding.ts) - getShardId, getSnowflake, hasShardId APIs
- [ShardId.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/ShardId.ts) - make, toString, fromString, Equal/Hash
- [Entity.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/Entity.ts) - CurrentAddress, CurrentRunnerAddress context tags
- [Snowflake.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/Snowflake.ts) - timestamp, toParts, machineId extraction
- [HttpMiddleware.ts Source](https://effect-ts.github.io/effect/platform/HttpMiddleware.ts.html) - make, logger control, tracer filtering
- [HttpTraceContext.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/platform/src/HttpTraceContext.ts) - toHeaders/fromHeaders, W3C/B3 support
- [FiberRef ZIO Documentation](https://zio.dev/reference/state-management/fiberref/) - Copy-on-fork semantics (Effect follows same patterns)
- [Effect.ts API](https://effect-ts.github.io/effect/effect/Effect.ts.html) - locallyWith, serviceOption, fn patterns
- [Workflow.ts API](https://effect-ts.github.io/effect/workflow/Workflow.ts.html) - Context propagation in workflows
- [DurableDeferred.ts API](https://effect-ts.github.io/effect/workflow/DurableDeferred.ts.html) - Token-based cross-pod signaling

### Codebase (HIGH confidence)
- `/packages/server/src/context.ts` - Existing FiberRef pattern, Request class, Data interface
- `/packages/server/src/middleware.ts` - makeRequestContext pattern, context population
- `/packages/server/src/infra/cluster.ts` - Phase 1 implementation, Sharding access patterns
- `/packages/types/src/types.ts` - Branded type companion pattern (Hex8, Hex64, Timestamp)

### Secondary (MEDIUM confidence)
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Sharding service overview
- [DeepWiki Fibers and Concurrency](https://deepwiki.com/Effect-TS/effect/3.1-fibers) - FiberRef propagation
- [Effect Workflow README](https://github.com/Effect-TS/effect/blob/main/packages/workflow/README.md) - Workflow context patterns

### Tertiary (LOW confidence)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world usage (limited detail)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, APIs verified against official docs
- Architecture patterns: HIGH - Follows established context.ts/middleware.ts patterns
- Pitfalls: HIGH - FiberRef semantics well-documented, verified against ZIO/Effect docs
- Code examples: HIGH - Verified against @effect/cluster, @effect/platform, effect sources
- Don't Hand-Roll: HIGH - Verified APIs (hasShardId, CurrentAddress, flatMapNullable, etc.)

**Research date:** 2026-01-29 (updated with deep library research)
**Valid until:** 2026-02-28 (30 days - stable APIs, patterns well-established)

**Research agents used:**
- @effect/cluster: ShardId class semantics, Entity.CurrentAddress, Snowflake APIs
- @effect/platform: HttpMiddleware patterns, HttpTraceContext
- @effect/platform-node: NodeClusterSocket layer composition
- @effect/workflow: Context lifecycle in workflows, activity context patterns
- Effect core: FiberRef advanced APIs, Option.flatMapNullable, Match.tagsExhaustive, dual pattern
