# Phase 2: Context Integration - Research

**Researched:** 2026-01-29
**Domain:** FiberRef-based request context, cluster state propagation, branded types for shard/runner IDs
**Confidence:** HIGH

## Summary

Phase 2 extends the existing `Context.Request.Data` interface with cluster state (`shardId`, `runnerId`, `isLeader`). The codebase already has a robust FiberRef-based context system in `context.ts` and middleware population in `middleware.ts`. This phase follows the established patterns rather than inventing new ones.

The key insight is that cluster context should be **optional** (`Option<ClusterState>`) since not all requests traverse cluster infrastructure. Middleware populates context at request boundaries; handlers consume via the existing `Context.Request.current` pattern. ShardId and RunnerId require branded types to prevent accidental string mixing.

**Primary recommendation:** Extend `Context.Request.Data` with `cluster: Option.Option<ClusterState>` following the existing circuit/session pattern. Use `Sharding.getShardId` (synchronous) and `sharding.getSnowflake` (for runner identification) within middleware. Define ShardId/RunnerId as branded strings via Schema.brand.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `effect` | 3.19.15 | FiberRef, Context, Option, Schema | Foundation for all context operations |
| `@effect/cluster` | 0.56.1 | Sharding service, EntityId, Snowflake | Cluster state access |
| `@effect/platform` | 0.82.1 | HttpMiddleware, HttpServerRequest | Request context population |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/rpc` | 0.73.0 | RPC context propagation | Cross-pod trace context |

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

### Pattern 1: Extending Context.Request.Data
**What:** Add optional cluster state to existing request context interface
**When to use:** All cluster-aware request handling
**Example:**
```typescript
// Source: context.ts extension following existing pattern
interface ClusterState {
  readonly shardId: Option.Option<ShardId>;      // Branded, not loose string
  readonly runnerId: Option.Option<RunnerId>;    // Branded, not loose string
  readonly isLeader: boolean;                    // Singleton leadership status
  readonly entityType: Option.Option<string>;    // If within entity handler
  readonly entityId: Option.Option<string>;      // Specific entity instance
}

interface Data {
  // ... existing fields unchanged
  readonly cluster: Option.Option<ClusterState>;
}

// Default value includes cluster: Option.none()
const _default: Context.Request.Data = {
  circuit: Option.none(),
  cluster: Option.none(),  // NEW
  ipAddress: Option.none(),
  // ... rest unchanged
};
```

### Pattern 2: Use Official ShardId Class + Branded RunnerId
**What:** Type-safe identifiers using official @effect/cluster types
**When to use:** Internal cluster state (ShardId class) and serialization (branded strings)
**Example:**
```typescript
// Source: @effect/cluster ShardId + existing branded pattern
import { ShardId, Snowflake } from '@effect/cluster';
import { Schema as S } from 'effect';

// RunnerId: Snowflake as branded string (for serialization)
const RunnerId = S.String.pipe(
  S.pattern(/^\d{18,19}$/),  // Snowflake format: 18-19 digit bigint string
  S.brand('RunnerId'),
);
type RunnerId = typeof RunnerId.Type;

// ShardIdString: For Serializable class (cross-pod propagation)
const ShardIdString = S.String.pipe(
  S.pattern(/^[a-zA-Z0-9_-]+:\d+$/),  // "group:id" from ShardId.toString()
  S.brand('ShardIdString'),
);
type ShardIdString = typeof ShardIdString.Type;

// Internal constructors for trusted values from Sharding API
const _makeRunnerId = (snowflake: Snowflake.Snowflake): RunnerId =>
  String(snowflake) as unknown as RunnerId;

// ClusterState uses official ShardId class directly (not string)
interface ClusterState {
  readonly shardId: ShardId | null;        // Official class, null when outside entity
  readonly runnerId: RunnerId | null;      // Branded string from Snowflake
  readonly isLeader: boolean;              // Set when entering singleton scope
  readonly entityType: string | null;      // Set when entering entity handler
  readonly entityId: string | null;        // Set when entering entity handler
}
```

### Pattern 3: Middleware Context Population
**What:** Populate cluster context in HTTP middleware before handlers execute
**When to use:** All HTTP requests that may interact with cluster
**Example:**
```typescript
// Source: middleware.ts makeRequestContext extension
const makeRequestContext = (findByNamespace: ...) =>
  HttpMiddleware.make((app) => Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    // ... existing context population ...

    // Cluster context population (lazy - only if Sharding available)
    const clusterState = yield* Effect.serviceOption(Sharding.Sharding).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeed(Option.none<ClusterState>()),
        onSome: (sharding) => Effect.gen(function* () {
          const snowflake = yield* sharding.getSnowflake;
          const runnerId = _makeRunnerId(Snowflake.toString(snowflake));
          return Option.some({
            shardId: Option.none(),  // Set when entering entity handler
            runnerId: Option.some(runnerId),
            isLeader: false,  // Updated by singleton context
            entityType: Option.none(),
            entityId: Option.none(),
          });
        }),
      })),
    );

    const ctx: Context.Request.Data = {
      // ... existing fields ...
      cluster: clusterState,
    };
    // ... rest of middleware unchanged
  }));
```

### Pattern 4: Handler Access via Static Methods
**What:** Expose cluster context via static methods on Context.Request class
**When to use:** Handler code accessing cluster state
**Example:**
```typescript
// Source: context.ts Request class extension
class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
  // ... existing static methods ...

  /** Access cluster state, fails if not in cluster context */
  static readonly cluster = FiberRef.get(_ref).pipe(
    Effect.flatMap((ctx) => Option.match(ctx.cluster, {
      onNone: () => Effect.die('No cluster context - request not in cluster scope'),
      onSome: Effect.succeed,
    })),
  );

  /** Access shard ID if available */
  static readonly shardId = Request.cluster.pipe(
    Effect.flatMap((c) => Option.match(c.shardId, {
      onNone: () => Effect.succeed(Option.none<ShardId>()),
      onSome: (id) => Effect.succeed(Option.some(id)),
    })),
  );

  /** Access runner ID for observability tagging */
  static readonly runnerId = Request.cluster.pipe(
    Effect.map((c) => c.runnerId),
  );

  /** Check leader status for conditional logic */
  static readonly isLeader = Request.cluster.pipe(
    Effect.map((c) => c.isLeader),
  );
}
```

### Pattern 5: Entity Handler Context Scoping
**What:** Update cluster context when entering entity handler scope
**When to use:** Entity handlers that need full cluster context
**Example:**
```typescript
// Source: cluster.ts entity layer enhancement
const withEntityContext = <A, E, R>(
  entityType: string,
  entityId: string,
  shardId: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.locallyWith(effect, _ref, (ctx) => ({
    ...ctx,
    cluster: Option.some({
      ...Option.getOrElse(ctx.cluster, () => ({
        shardId: Option.none(),
        runnerId: Option.none(),
        isLeader: false,
        entityType: Option.none(),
        entityId: Option.none(),
      })),
      shardId: Option.some(_makeShardId(shardId)),
      entityType: Option.some(entityType),
      entityId: Option.some(entityId),
    }),
  }));
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
| Shard ID type | Branded string schema | `ShardId` class from @effect/cluster | Has Equal/Hash protocols, structural equality |
| Shard ID calculation | Custom consistent hash | `Sharding.getShardId(entityId, group)` | Already computed, synchronous access |
| Shard ID serialization | Custom format | `ShardId.toString()` / `fromString()` | Official bidirectional conversion |
| Runner identification | Environment variable parsing | `sharding.getSnowflake` | Cluster-assigned, globally unique |
| Leader election status | DB-backed flag polling | `Singleton.make` context scope | Automatic via shard assignment |
| Context propagation | Manual parameter threading | FiberRef.locally/locallyWith | Automatic child fiber inheritance |
| Cross-pod serialization | Custom JSON mapping | `Schema.Class` with `fromData` | Automatic encode/decode, validation |
| Cross-pod trace context | Manual header extraction | RPC automatic propagation | Built into @effect/rpc |
| Request-scoped state | Context.Tag with explicit provision | FiberRef with default | No R type pollution, cleaner handlers |

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

## Code Examples

Verified patterns from official sources and codebase conventions:

### Complete ClusterState Schema
```typescript
// Source: context.ts following existing Schema patterns
import { Option, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

// Branded types for cluster identifiers
const ShardId = S.String.pipe(S.pattern(/^shard-\d+$/), S.brand('ShardId'));
const RunnerId = S.String.pipe(S.pattern(/^\d{18,19}$/), S.brand('RunnerId'));

// Internal constructors for trusted values from Sharding API
const _makeShardId = (raw: string): typeof ShardId.Type => raw as unknown as typeof ShardId.Type;
const _makeRunnerId = (raw: string): typeof RunnerId.Type => raw as unknown as typeof RunnerId.Type;

// ClusterState interface following existing pattern
interface ClusterState {
  readonly shardId: Option.Option<typeof ShardId.Type>;
  readonly runnerId: Option.Option<typeof RunnerId.Type>;
  readonly isLeader: boolean;
  readonly entityType: Option.Option<string>;
  readonly entityId: Option.Option<string>;
}

// Default cluster state (used when entering entity context)
const _clusterDefault: ClusterState = {
  entityId: Option.none(),
  entityType: Option.none(),
  isLeader: false,
  runnerId: Option.none(),
  shardId: Option.none(),
};
```

### Context.Request Extension
```typescript
// Source: context.ts Request class with cluster accessors
class Request extends Effect.Tag('server/RequestContext')<Request, Context.Request.Data>() {
  // ... existing methods unchanged ...

  /** Access cluster context. Dies if not in cluster scope (development guard). */
  static readonly cluster = FiberRef.get(_ref).pipe(
    Effect.flatMap((ctx) => Option.match(ctx.cluster, {
      onNone: () => Effect.die('No cluster context'),
      onSome: Effect.succeed,
    })),
  );

  /** Access shard ID if within entity handler. Returns Option.none() outside entity scope. */
  static readonly shardId = FiberRef.get(_ref).pipe(
    Effect.map((ctx) => Option.flatMap(ctx.cluster, (c) => c.shardId)),
  );

  /** Access runner ID for metrics tagging. Returns Option.none() outside cluster scope. */
  static readonly runnerId = FiberRef.get(_ref).pipe(
    Effect.map((ctx) => Option.flatMap(ctx.cluster, (c) => c.runnerId)),
  );

  /** Check leader status for conditional logic. Returns false outside cluster scope. */
  static readonly isLeader = FiberRef.get(_ref).pipe(
    Effect.map((ctx) => Option.match(ctx.cluster, {
      onNone: () => false,
      onSome: (c) => c.isLeader,
    })),
  );

  /** Update cluster context within current fiber scope. */
  static readonly updateCluster = (partial: Partial<ClusterState>) =>
    FiberRef.update(_ref, (ctx) => ({
      ...ctx,
      cluster: Option.some({
        ...Option.getOrElse(ctx.cluster, () => _clusterDefault),
        ...partial,
      }),
    }));

  /** Run effect with scoped cluster context (reverts after). */
  static readonly withinCluster = <A, E, R>(
    partial: Partial<ClusterState>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.locallyWith(effect, _ref, (ctx) => ({
      ...ctx,
      cluster: Option.some({
        ...Option.getOrElse(ctx.cluster, () => _clusterDefault),
        ...partial,
      }),
    }));
}
```

### Middleware Cluster Context Population
```typescript
// Source: middleware.ts makeRequestContext with cluster population
import { Sharding, Snowflake } from '@effect/cluster';

const makeRequestContext = (findByNamespace: ...) =>
  HttpMiddleware.make((app) => Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest;
    const requestId = Option.getOrElse(Headers.get(req.headers, 'x-request-id'), crypto.randomUUID);
    // ... existing tenant/namespace resolution ...

    // Cluster context: lazy initialization, graceful degradation
    const clusterState = yield* Effect.serviceOption(Sharding.Sharding).pipe(
      Effect.flatMap(Option.match({
        onNone: () => Effect.succeed(Option.none<ClusterState>()),
        onSome: (sharding) => Effect.gen(function* () {
          const snowflake = yield* sharding.getSnowflake;
          return Option.some({
            entityId: Option.none(),
            entityType: Option.none(),
            isLeader: false,
            runnerId: Option.some(_makeRunnerId(Snowflake.toString(snowflake))),
            shardId: Option.none(),
          });
        }),
      })),
    );

    const ctx: Context.Request.Data = {
      circuit: Option.none(),
      cluster: clusterState,  // NEW
      ipAddress: _extractClientIp(req.headers, req.remoteAddress),
      rateLimit: Option.none(),
      requestId,
      session: Option.none(),
      tenantId,
      userAgent: Headers.get(req.headers, 'user-agent'),
    };

    // Add cluster annotations to current span
    yield* Option.match(clusterState, {
      onNone: () => Effect.void,
      onSome: (c) => Effect.all([
        Option.match(c.runnerId, {
          onNone: () => Effect.void,
          onSome: (id) => Effect.annotateCurrentSpan('cluster.runner_id', id),
        }),
      ], { discard: true }),
    });

    return yield* Context.Request.within(tenantId, app.pipe(
      Effect.provideService(Context.Request, ctx),
      // ... rest unchanged
    ), ctx);
  }));
```

### Observability Attributes Extension
```typescript
// Source: context.ts toAttrs extension
static readonly toAttrs = (ctx: Context.Request.Data, fiberId: FiberId.FiberId): Record.ReadonlyRecord<string, string> =>
  Record.getSomes({
    // ... existing attributes ...
    'cluster.entity_id': Option.flatMap(ctx.cluster, (c) => c.entityId),
    'cluster.entity_type': Option.flatMap(ctx.cluster, (c) => c.entityType),
    'cluster.is_leader': Option.map(ctx.cluster, (c) => String(c.isLeader)),
    'cluster.runner_id': Option.flatMap(ctx.cluster, (c) => c.runnerId),
    'cluster.shard_id': Option.flatMap(ctx.cluster, (c) => c.shardId),
  });
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

**Question:** Cache at middleware entry or check dynamically?

**Resolution:** Hybrid approach following Effect patterns:
- **runnerId**: Cached at middleware entry via `sharding.getSnowflake` (doesn't change during request)
- **isLeader**: Dynamic — set to `true` when entering singleton handler scope via `Context.Request.withinCluster`
- **shardId**: Dynamic — set when entering entity handler scope

**Why:** Leadership is singleton-scoped, not request-scoped. A request may traverse multiple contexts (HTTP → entity → singleton). The context updates as scope changes via `Effect.locallyWith`.

**Pattern:**
```typescript
// In singleton handler (ClusterService.singleton)
ClusterService.singleton('leader-job', Effect.gen(function* () {
  yield* Context.Request.updateCluster({ isLeader: true });
  yield* leaderOnlyWork;
}));
```

### Decision 2: ShardId Type — Use Official ShardId Class, String Schema for Serialization

**Question:** Better approach for ShardId format validation?

**Resolution:** @effect/cluster exports `ShardId` as a CLASS with rich semantics:

```typescript
// From @effect/cluster/ShardId.ts
class ShardId {
  readonly group: string;     // Entity group name
  readonly id: number;        // Shard number (1 to shardsPerGroup)
  readonly [TypeId]: TypeId;  // Unique symbol for branding
}

// Factory and conversion
ShardId.make(group: string, id: number): ShardId
ShardId.toString(shardId: ShardId): string    // e.g., "default:42"
ShardId.fromString(s: string): ShardId        // Parse back
```

**Implementation:**
- **Internal ClusterState**: Store `ShardId` class directly (implements Equal/Hash for maps/sets)
- **Serializable class**: Convert to string via `ShardId.toString()` with branded schema
- **Context interface**: Use `ShardId | null` (not Option — internal only, avoids Option nesting)

**Branded string schema for serialization:**
```typescript
// For Context.Serializable cross-pod propagation
const ShardIdString = S.String.pipe(
  S.pattern(/^[a-zA-Z0-9_-]+:\d+$/),  // "group:id" format from ShardId.toString()
  S.brand('ShardIdString'),
);
```

**Why not plain string:** ShardId class has:
- Structural equality via `Equal.symbol` (works in Effect maps/sets)
- Hash protocol for efficient lookups
- Type safety preventing accidental mixing with entity IDs

### Decision 3: Cross-Pod Serialization — Extend Existing Serializable Class

**Question:** Best dense/polymorphic solution for cross-pod context?

**Resolution:** Extend the existing `Context.Serializable` class (Schema.Class pattern):

```typescript
// Source: context.ts - extend existing Serializable class
class Serializable extends S.Class<Serializable>('server/Context.Serializable')({
  // Existing fields
  ipAddress: S.optional(S.String),
  requestId: S.String,
  sessionId: S.optional(S.String),
  tenantId: S.String,
  userId: S.optional(S.String),
  // NEW: Cluster fields (optional for backward compatibility)
  runnerId: S.optional(S.String),      // Snowflake as string
  shardId: S.optional(ShardIdString),  // "group:id" format
}) {
  static readonly fromData = (ctx: Context.Request.Data): Serializable =>
    new Serializable({
      // ... existing extraction ...
      runnerId: pipe(ctx.cluster, Option.flatMap((c) => c.runnerId), Option.map(String), Option.getOrUndefined),
      shardId: pipe(ctx.cluster, Option.flatMap((c) => c.shardId), Option.map(ShardId.toString), Option.getOrUndefined),
    });
}
```

**Why this approach:**
1. **Polymorphic**: Same class handles with/without cluster fields
2. **Backward compatible**: Optional fields — old consumers unaffected
3. **No hand-rolling**: Uses Schema.Class automatic serialization
4. **Dense**: Single class, not separate cluster-specific serializable
5. **Established pattern**: Follows existing `fromData` factory method

**What NOT to serialize:**
- `isLeader`: Request-scoped flag, not meaningful across pods
- `entityType`/`entityId`: Context-specific, changes during request lifecycle
- Full ClusterState: Only propagate correlation identifiers (runnerId, shardId)

## Sources

### Primary (HIGH confidence)
- [Effect Fibers Documentation](https://effect.website/docs/concurrency/fibers/) - FiberRef semantics, fork behavior
- [Effect Branded Types](https://effect.website/docs/code-style/branded-types/) - Schema.brand patterns
- [Sharding.ts Source](https://github.com/Effect-TS/effect/blob/main/packages/cluster/src/Sharding.ts) - getShardId, getSnowflake APIs
- [FiberRef ZIO Documentation](https://zio.dev/reference/state-management/fiberref/) - Copy-on-fork semantics (Effect follows same patterns)

### Codebase (HIGH confidence)
- `/packages/server/src/context.ts` - Existing FiberRef pattern, Request class, Data interface
- `/packages/server/src/middleware.ts` - makeRequestContext pattern, context population
- `/packages/server/src/infra/cluster.ts` - Phase 1 implementation, Sharding access patterns
- `/packages/types/src/types.ts` - Branded type companion pattern (Hex8, Hex64, Timestamp)

### Secondary (MEDIUM confidence)
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Sharding service overview
- [DeepWiki Fibers and Concurrency](https://deepwiki.com/Effect-TS/effect/3.1-fibers) - FiberRef propagation

### Tertiary (LOW confidence)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world usage (limited detail)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, APIs verified against source
- Architecture patterns: HIGH - Follows established context.ts/middleware.ts patterns
- Pitfalls: HIGH - FiberRef semantics well-documented, verified against ZIO/Effect docs
- Code examples: HIGH - Synthesized from existing codebase patterns

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable APIs, patterns well-established)
