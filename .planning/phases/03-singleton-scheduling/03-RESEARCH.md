# Phase 3: Singleton & Scheduling - Research

**Researched:** 2026-01-29
**Domain:** Cluster singletons, distributed cron, typed state persistence, heartbeat health monitoring
**Confidence:** HIGH

## Summary

Phase 3 implements cluster-wide singleton processes and scheduled tasks using @effect/cluster's `Singleton.make` and `ClusterCron.make`. The existing ClusterService has factory methods (`singleton()`, `cron()`) pre-wired from Phase 1. This phase extends those factories with:

1. **Typed state persistence** via KeyValueStore for singleton state that survives leader migration
2. **Heartbeat gauges** for dead man's switch health integration via Metric.gauge
3. **withinCluster context scoping** for singleton/entity handlers (success criteria #10, #11)
4. **Snowflake ID generation** for cluster-wide collision-free IDs

**Key Design Decisions:**
1. **Externalized state**: Singleton state is DB-backed (KeyValueStore), not in-memory. New leader loads persisted state rather than reconstructing.
2. **Heartbeat-driven health**: `Metric.gauge` tracks last execution timestamp; health check compares against 2x expected interval.
3. **Unified factory**: `ClusterService.cron()` merges Singleton + ClusterCron when schedule provided — single factory for both patterns.

**Primary recommendation:** Extend ClusterService.singleton() to accept optional state schema parameter. Use KeyValueStore backed by PostgreSQL for persistence. Update heartbeat gauge after each singleton execution. Wrap singleton handlers with `Context.Request.withinCluster({ isLeader: true })`.

**Note on `withinCluster`:** This is a **project-local wrapper** implemented in `context.ts` (Phase 2), not an external library API. It uses Effect primitives (`FiberRef`, `Effect.locallyWith`, `dual`) to scope cluster context within handlers.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/cluster` | 0.56.1 | Singleton.make, ClusterCron.make, Snowflake, ClusterMetrics | Official cluster primitives |
| `@effect/platform` | 0.94.2 | KeyValueStore, SchemaStore, layerSchema | Schema-validated persistence |
| `effect` | 3.19.15 | Metric.gauge, Cron, Schema, Duration, Match | Core primitives |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/sql-pg` | 0.50.1 | PostgreSQL-backed KeyValueStore | Production state persistence |
| `@effect/platform-node` | 0.104.1 | NodeKeyValueStore.layerFileSystem | Local development persistence |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PostgreSQL KeyValueStore | Redis Persistence | Redis faster but adds dependency; Postgres already in stack |
| Metric.gauge for heartbeat | Custom timestamp tracking | Gauge integrates with Prometheus/OTLP automatically |
| KeyValueStore.forSchema | Manual JSON serialization | forSchema provides type-safe encode/decode |

**Installation:**
All packages already in pnpm-workspace.yaml catalog. No new dependencies required.

## Architecture Patterns

### Recommended Project Structure
```
packages/server/src/
├── context.ts           # withinCluster accessor (Phase 2 complete)
├── middleware.ts        # Cluster context population (Phase 2 complete)
├── infra/cluster.ts     # EXTEND: Add state persistence to singleton/cron factories
└── observe/health.ts    # EXTEND: Add singleton heartbeat health checks
```

### Pattern 1: Stateful Singleton with DB-Backed Persistence

**What:** Singleton with typed state that persists across leader migrations
**When to use:** Leader-only processes needing durable state (job coordinators, rate aggregators)

```typescript
// Source: @effect/platform/KeyValueStore.ts + @effect/cluster/Singleton.ts
import { KeyValueStore } from '@effect/platform';
import { Entity, Singleton } from '@effect/cluster';
import { Cron, Effect, Layer, Metric, Option, Schema as S } from 'effect';
import { constant } from 'effect/Function';

// Pre-define gauge for reuse (avoid duplicate metric registration)
const coordinatorHeartbeat = Metric.gauge('singleton.coordinator.last_execution');

// Singleton with inline state schema (no separate type alias)
const CoordinatorSingletonLive = Singleton.make(
  'coordinator',
  Effect.gen(function* () {
    const store = (yield* KeyValueStore.KeyValueStore).forSchema(S.Struct({
      lastProcessedId: S.String,
      checkpointTimestamp: S.Number,
    }));

    // Load persisted state or initialize (inline default)
    const state = yield* store.get('state').pipe(
      Effect.map(Option.getOrElse(constant({ lastProcessedId: '', checkpointTimestamp: 0 }))),
    );

    // For long-running work, prevent eviction
    yield* Entity.keepAlive(true);

    // Wrap with leader context + heartbeat update
    yield* Context.Request.withinCluster({ isLeader: true })(
      Effect.gen(function* () {
        const newState = yield* coordinatorWork(state);
        yield* store.set('state', newState);
        yield* Metric.set(coordinatorHeartbeat, Date.now());
        yield* Effect.logInfo('Coordinator checkpoint', { lastProcessedId: newState.lastProcessedId });
      }),
    );

    // CRITICAL: Effect.never must be the final/returned effect to keep singleton alive
    yield* Effect.never;
  }),
);
```

### Pattern 2: ClusterCron with skipIfOlderThan

**What:** Scheduled task that skips accumulated executions after downtime
**When to use:** Cron jobs where catching up on missed runs is undesirable

```typescript
// Source: @effect/cluster/ClusterCron.ts + effect/Cron
import { ClusterCron } from '@effect/cluster';
import { Cron, Duration, Effect, Metric } from 'effect';

const cleanupHeartbeat = Metric.gauge('singleton.cleanup.last_execution');

const CleanupCronLive = ClusterCron.make({
  name: 'daily-cleanup',
  cron: Cron.unsafeParse('0 2 * * *'),  // 2 AM daily — use unsafeParse for static strings
  execute: Context.Request.withinCluster({ isLeader: true })(
    Effect.gen(function* () {
      yield* cleanupOldRecords();
      yield* Metric.set(cleanupHeartbeat, Date.now());
    }),
  ),
  skipIfOlderThan: Duration.hours(1),  // Skip if >1 hour behind schedule
  calculateNextRunFromPrevious: false,  // false = strict schedule, true = minimum gap between runs
});
```

### Pattern 3: Entity Handler with withinCluster Wrapping

**What:** Entity handlers that propagate cluster context for downstream code
**When to use:** All entity handlers (success criteria #10)

```typescript
// Source: Phase 2 research + @effect/cluster/Entity.ts
import { Entity } from '@effect/cluster';
import { Duration, Effect, Ref } from 'effect';
import { Context } from '../context.ts';

const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
  // CurrentAddress provides branded types: ShardId, EntityId, EntityType
  const addr = yield* Entity.CurrentAddress;
  // CurrentRunnerAddress provides network address for inter-pod communication
  const runnerAddr = yield* Entity.CurrentRunnerAddress;
  const stateRef = yield* Ref.make(EntityState.idle());

  return {
    process: (envelope) => Context.Request.withinCluster({
      entityId: addr.entityId,      // EntityId (branded string)
      entityType: addr.entityType,  // EntityType (branded string)
      shardId: addr.shardId,        // ShardId class (Equal/Hash protocols)
    })(Effect.gen(function* () {
      yield* Ref.set(stateRef, EntityState.processing());
      // Handler logic - Context.Request.clusterState available downstream
      const cluster = yield* Context.Request.clusterState;
      yield* Effect.logDebug('Processing', {
        shardId: cluster.shardId?.toString(),
        runnerHost: runnerAddr.host,
      });
    })),
    status: () => Ref.get(stateRef).pipe(Effect.map((s) => new StatusResponse(s))),
  };
}), { maxIdleTime: Duration.minutes(10), concurrency: 1 });
```

### Pattern 4: Heartbeat-Based Health Check with ClusterMetrics

**What:** Health check that fails if singleton hasn't executed recently
**When to use:** Dead man's switch pattern for critical singletons

```typescript
// Source: effect/Metric.ts + @effect/cluster/ClusterMetrics.ts
import { ClusterMetrics } from '@effect/cluster';
import { Array as A, Duration, Effect, Metric, type MetricState, pipe } from 'effect';

// Inline in HealthService — no separate function definition
const checkSingletonHealth = (config: ReadonlyArray<{
  readonly name: string;
  readonly expectedInterval: Duration.DurationInput;
}>) => pipe(
  config,
  A.map(({ name, expectedInterval }) => {
    const gauge = Metric.gauge(`singleton.${name}.last_execution`);
    return Metric.value(gauge).pipe(
      Effect.map((state: MetricState.Gauge<number>) => {
        const threshold = Duration.toMillis(Duration.times(expectedInterval, 2));
        const elapsed = Date.now() - state.value;
        return {
          name,
          healthy: elapsed < threshold,
          lastExecution: state.value > 0 ? new Date(state.value).toISOString() : 'never',
          threshold,
        };
      }),
    );
  }),
  Effect.all,
  Effect.map((results) => ({ singletons: results, healthy: A.every(results, (r) => r.healthy) })),
);

// ClusterMetrics gauges use bigint (defined with { bigint: true })
// Type: MetricState.Gauge<bigint>
const checkClusterHealth = Effect.all({
  entities: Metric.value(ClusterMetrics.entities),      // bigint
  singletons: Metric.value(ClusterMetrics.singletons),  // bigint
  runners: Metric.value(ClusterMetrics.runners),        // bigint
  runnersHealthy: Metric.value(ClusterMetrics.runnersHealthy),  // bigint
  shards: Metric.value(ClusterMetrics.shards),          // bigint
});
```

### Pattern 5: Snowflake ID Generation and Decomposition

**What:** Cluster-wide unique ID generation without collisions
**When to use:** Any place needing globally unique, sortable IDs

```typescript
// Source: @effect/cluster/Snowflake.ts + @effect/cluster/ShardId.ts
import { ShardId, Sharding, Snowflake } from '@effect/cluster';
import { DateTime, Effect } from 'effect';

// Use existing ClusterService.generateId (wraps sharding.getSnowflake)
// Or direct access:
const entityId = yield* Sharding.Sharding.pipe(Effect.flatMap((s) => s.getSnowflake), Effect.map(String));

// Decompose for debugging (inline — no separate function)
const sf = yield* sharding.getSnowflake;
const parts = Snowflake.toParts(sf);
yield* Effect.logDebug('Snowflake', {
  timestamp: parts.timestamp,
  machineId: parts.machineId,
  sequence: parts.sequence,
  datetime: DateTime.formatIso(Snowflake.dateTime(sf)),
});

// ShardId serialization: use built-in methods directly
const str = shardId.toString();          // "default:42"
const parsed = ShardId.fromString(str);  // Parse back
```

### Pattern 6: Scheduled Message Delivery with DeliverAt

**What:** Schedule entity messages for future delivery
**When to use:** Delayed singleton tasks, scheduled notifications

```typescript
// Source: @effect/cluster/DeliverAt.ts + Sharding.makeClient
import { DeliverAt, Sharding } from '@effect/cluster';
import { DateTime, Duration, Effect } from 'effect';

// DeliverAt interface: attach to RPC request for scheduled delivery
// Use sharding.makeClient (not messenger) — returns typed RPC client factory
const scheduleDelayedWork = (entityId: string, delayMinutes: number) =>
  Effect.gen(function* () {
    const sharding = yield* Sharding.Sharding;
    const client = yield* sharding.makeClient(WorkEntity);
    // Create RPC request with DeliverAt symbol for scheduled delivery
    yield* client(entityId).process({
      ...basePayload,
      [DeliverAt.symbol]: () => DateTime.addDuration(DateTime.unsafeNow(), Duration.minutes(delayMinutes)),
    });
  });
```

### Telemetry Integration

Singleton/cron factories wrap execution with `Telemetry.span`. Heartbeat gauges export via OTLP automatically. Follow existing `cluster.ts` pattern: wrap operations with `Telemetry.span` only when they have meaningful latency or failure modes.

**Span naming convention:**
- Singletons: `singleton.{name}`
- Cron jobs: `cron.{name}`
- Entity handlers: `entity.{type}.{rpc}`

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leader election | Custom DB flag polling | `Singleton.make` | Automatic via shard assignment, handles failover |
| Cron scheduling | Custom setTimeout/setInterval | `ClusterCron.make` + `Cron.unsafeParse` | Exactly-once guarantee, skipIfOlderThan support |
| Singleton state | In-memory Ref | `KeyValueStore.forSchema` | Survives leader migration, type-safe |
| Unique IDs | UUID v4 | `sharding.getSnowflake` | Sortable, machine-aware, no collisions |
| Heartbeat tracking | Custom DB timestamp column | `Metric.gauge` | Integrates with Prometheus/OTLP |
| State serialization | Manual JSON.stringify | Schema-based store.forSchema | Type-safe encode/decode, validation |
| Dead man's switch | Custom health polling | Gauge + threshold check | Native observability integration |
| Scheduled delivery | Manual timer + DB queue | `DeliverAt` interface on messages | Built into cluster message dispatch |
| Shutdown detection | Custom signal handling | `sharding.isShutdown` | Cluster-aware, automatic |
| State key namespacing | Manual prefix strings | `KeyValueStore.prefix(store, 'ns:')` | Automatic key prefixing |
| Storage refresh | Manual polling | `sharding.pollStorage` | Force storage read cycle |
| Message state reset | Manual DB cleanup | `sharding.reset(rpc, entityId)` | Clear message state for entity |
| Cluster metrics | Custom gauge definitions | `ClusterMetrics.*` | Pre-built: entities, singletons, runners, shards |
| Long-running eviction | Custom keepalive pings | `Entity.keepAlive(true)` | Prevents maxIdleTime eviction |
| ShardId serialization | Custom format | `shardId.toString()` / `ShardId.fromString()` | Built-in, reversible |
| Entity RPC client | Manual HTTP/socket calls | `sharding.makeClient(entity)` | Typed RPC, automatic routing |
| Shard routing | Manual hash/mod | `sharding.getShardId(entityId, group)` | Consistent, cluster-aware |

**Key insight:** The singleton pattern is fundamentally about externalizing state. Cluster handles leader election; KeyValueStore handles state persistence; Metric.gauge handles health monitoring. No custom coordination logic needed.

## Common Pitfalls

### Pitfall 1: In-Memory Singleton State Lost on Migration

**What goes wrong:** Singleton state stored in Ref/local variable is lost when leader changes
**Why it happens:** New leader starts fresh instance; no state transfer mechanism
**How to avoid:** Always use KeyValueStore for any state that must survive leader migration. Load state at singleton startup, persist after each mutation.
**Warning signs:** Singleton "forgets" progress after pod restart or rebalancing

### Pitfall 2: ClusterCron Burst After Downtime

**What goes wrong:** After cluster downtime, cron executes multiple accumulated runs
**Why it happens:** Default `skipIfOlderThan` is `Duration.days(1)` — may allow catchup for frequent jobs
**How to avoid:** Set `skipIfOlderThan` to appropriate threshold (e.g., `Duration.hours(1)` for daily jobs, shorter for hourly)
**Warning signs:** Logs showing many rapid cron executions after restart

### Pitfall 3: Missing withinCluster Context in Handlers

**What goes wrong:** Downstream code can't access cluster context (shardId, isLeader, etc.)
**Why it happens:** Handler didn't wrap execution with `Context.Request.withinCluster`
**How to avoid:** All entity/singleton handlers must wrap with withinCluster at entry
**Warning signs:** `ClusterContextRequired` errors, missing cluster attributes in traces

### Pitfall 4: Snowflake Collisions From Multiple Generators

**What goes wrong:** Duplicate IDs generated across cluster
**Why it happens:** Each pod using independent Snowflake.Generator without machine ID coordination
**How to avoid:** Use `sharding.getSnowflake` (single generator per cluster) or ensure unique machineId per pod
**Warning signs:** Primary key violations, duplicate entity routing

### Pitfall 5: Heartbeat Not Updated After Execution

**What goes wrong:** Health check shows singleton as unhealthy despite successful runs
**Why it happens:** Forgot to call `Metric.set(gauge, Date.now())` after execution
**How to avoid:** Update heartbeat gauge as final step in singleton execution — factory handles this automatically
**Warning signs:** False unhealthy status in health endpoints

### Pitfall 6: Singleton Exits Without Effect.never

**What goes wrong:** Singleton completes immediately and leader election happens again
**Why it happens:** Singleton effect completes; cluster sees it as finished
**How to avoid:** `Effect.never` MUST be the final/returned effect for long-running singletons. For periodic work, use `Effect.repeat` with schedule. Common mistake: putting Effect.never in wrong scope.
**Warning signs:** Rapid singleton start/stop cycles in logs

### Pitfall 7: KeyValueStore Schema Mismatch After Evolution

**What goes wrong:** Singleton fails to load state after schema change
**Why it happens:** Persisted data doesn't match new schema shape
**How to avoid:** Use `S.optional` for additive changes; version keys for breaking changes (`state-v1`, `state-v2`)
**Warning signs:** Schema decode errors on singleton startup

### Pitfall 8: Cron.parse vs Cron.unsafeParse Confusion

**What goes wrong:** Type error when using `Cron.parse` result directly
**Why it happens:** `Cron.parse` returns `Either<Cron, ParseError>`, not Effect or Cron directly
**How to avoid:** Use `Cron.unsafeParse` for static/compile-time constant cron strings. Use `Either.getOrThrowWith(Cron.parse(...), ...)` for dynamic strings that need validation.
**Warning signs:** "Effect.runSync cannot be used with Either" type errors

## Resolved Technical Decisions

Answers to open questions, verified against @effect/cluster source and codebase patterns:

### Decision 1: State Persistence Strategy — KeyValueStore with forSchema

**Resolution:** Use `KeyValueStore.forSchema(schema)` for type-safe persistence. PostgreSQL-backed via existing SqlClient.

**Why:**
- `forSchema` returns `SchemaStore<A>` with typed `get`/`set`/`modify` operations
- Schema validation on read prevents corrupt state from propagating
- No Redis dependency — PostgreSQL already in stack

**Alternative:** `KeyValueStore.layerSchema(schema, tagIdentifier)` creates complete Layer with Tag:
```typescript
// Creates { tag: Tag<SchemaStore<A>>, layer: Layer<...> }
// REQUIRED: tagIdentifier string for Context.Tag creation
const EntityStateStore = KeyValueStore.layerSchema(EntityStateSchema, 'EntityState');
const store = yield* EntityStateStore.tag;
```

**Error handling:** SchemaStore operations can fail with `ParseResult.ParseError` on malformed data, in addition to `PlatformError.PlatformError`.

**Testing layers:** `KeyValueStore.layerMemory` (unit tests), `NodeKeyValueStore.layerFileSystem('./data/kv')` (local dev)

**Implementation:**
```typescript
// Access typed store from KeyValueStore service
const store = (yield* KeyValueStore.KeyValueStore).forSchema(StateSchema);
const state = yield* store.get(key).pipe(Effect.map(Option.getOrElse(constant(initial))));
```

### Decision 2: Heartbeat Pattern — Metric.gauge with Timestamp

**Resolution:** Store `Date.now()` in gauge after each execution. Health check compares current time vs gauge value. Pre-define gauge reference to avoid duplicate metric registration.

**Why:**
- Gauges auto-export via OTLP — no manual Prometheus integration
- Simple threshold comparison: `elapsed < 2 * expectedInterval`
- Historical tracking via OTLP backend (Grafana, Datadog) — no dual-write needed

**Pattern:**
```typescript
// Pre-define gauge (avoid duplicate registration on each call)
const heartbeat = Metric.gauge(`singleton.${name}.last_execution`);

// Set after execution
yield* Metric.set(heartbeat, Date.now());

// Check in health endpoint (explicit MetricState type)
const state: MetricState.Gauge<number> = yield* Metric.value(heartbeat);
const elapsed = Date.now() - state.value;
const healthy = elapsed < Duration.toMillis(Duration.times(expectedInterval, 2));

// Initial startup: gauge starts at 0, health check treats as "never executed"
// Accept initial unhealthy status until first successful run
```

### Decision 3: Factory Unification — singleton() and cron() Merged

**Resolution:** `ClusterService.cron()` is a superset that combines Singleton + ClusterCron when schedule provided.

**Properties:**
1. **Single factory**: One method for both patterns
2. **Automatic heartbeat**: Factory wraps execution with gauge update
3. **Automatic context**: Factory wraps with `withinCluster({ isLeader: true })`
4. **Automatic telemetry**: Factory wraps with `Telemetry.span`

**Why not separate:**
- Cron jobs ARE singletons (leader-only execution)
- Duplicating heartbeat/context/telemetry logic violates DRY
- Single factory ensures consistent behavior

### Decision 4: Snowflake Access — Via Sharding Service

**Resolution:** Use `sharding.getSnowflake` for all cluster ID generation.

**Why:**
- Single generator per cluster ensures no collisions
- Machine ID derived from runner registration (automatic)
- Existing `ClusterService.generateId` wraps this — use that

**What NOT to do:**
- Don't instantiate `Snowflake.Generator` directly per pod
- Don't use UUID v4 for entity IDs (not sortable, no machine affinity)

### Decision 5: Open Questions Resolution

**KeyValueStore.modify atomicity:**
- `modify` performs read-then-write, NOT atomic across concurrent executions
- For critical sections, wrap in SQL transaction: `SqlClient.withTransaction`

**Heartbeat gauge initial value:**
- Gauge starts at 0 on process startup
- Health check should treat `value === 0` as "never executed"
- Accept initial unhealthy status; initialize gauge to `Date.now()` on singleton startup before main loop if immediate healthy status required

**State schema evolution:**
- Additive changes: Use `S.optional` for new fields
- Breaking changes: Version state keys (`state-v1` → `state-v2`)
- Migration: Load old version, transform, save to new key in singleton startup

## Additional Patterns

### ClusterService Factory Extension (Delta from cluster.ts)

Extend existing `ClusterService.singleton` with optional state persistence. Key changes:

```typescript
// Add to ClusterService static methods (cluster.ts lines 212-224)
static readonly singleton = <State, E, R>(
  name: string,
  run: Effect.Effect<void, E, R>,
  options?: {
    readonly shardGroup?: string;
    readonly state?: { readonly schema: S.Schema<State, unknown>; readonly initial: State };
  },
) => {
  const heartbeat = Metric.gauge(`singleton.${name}.last_execution`);
  const withState = options?.state
    ? Effect.gen(function* () {
        const store = (yield* KeyValueStore.KeyValueStore).forSchema(options.state!.schema);
        const state = yield* store.get(name).pipe(Effect.map(Option.getOrElse(constant(options.state!.initial))));
        yield* run.pipe(Effect.tap(() => store.set(name, state)));
      })
    : run;
  return Singleton.make(
    name,
    Telemetry.span(
      Context.Request.withinCluster({ isLeader: true })(withState.pipe(Effect.tap(() => Metric.set(heartbeat, Date.now())))),
      `singleton.${name}`,
    ),
    { shardGroup: options?.shardGroup },
  ).pipe(Layer.provide(_clusterLayer));
};

// Extend existing cron factory with heartbeat + withinCluster wrapping
static readonly cron = <E, R>(config: { /* existing fields */ }) => {
  const heartbeat = Metric.gauge(`singleton.${config.name}.last_execution`);
  return ClusterCron.make({
    ...config,
    execute: Context.Request.withinCluster({ isLeader: true })(
      Telemetry.span(config.execute.pipe(Effect.tap(() => Metric.set(heartbeat, Date.now()))), `cron.${config.name}`),
    ),
    skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
  }).pipe(Layer.provide(_clusterLayer));
};
```

### SQL-Backed KeyValueStore Layer

```typescript
// Source: @effect/platform/KeyValueStore.ts
import { KeyValueStore } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Array as A, Effect, Layer, Option, pipe } from 'effect';

const SqlKeyValueStoreLive = Layer.effect(
  KeyValueStore.KeyValueStore,
  SqlClient.SqlClient.pipe(Effect.map((sql) => KeyValueStore.make({
    get: (key) => sql`SELECT value FROM kv_store WHERE key = ${key}`.pipe(
      Effect.map(A.head),
      Effect.map(Option.map((row) => row.value)),
      Effect.map(Option.getOrNull),
      Effect.catchAll(() => Effect.succeed(null)),
    ),
    set: (key, value) => sql`
      INSERT INTO kv_store (key, value, updated_at) VALUES (${key}, ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
    `.pipe(Effect.asVoid),
    remove: (key) => sql`DELETE FROM kv_store WHERE key = ${key}`.pipe(Effect.asVoid),
    has: (key) => sql`SELECT 1 FROM kv_store WHERE key = ${key}`.pipe(Effect.map(A.isNonEmptyArray)),
    isEmpty: sql`SELECT COUNT(*) as count FROM kv_store`.pipe(Effect.map((rows) => rows[0]?.count === 0)),
    size: sql`SELECT COUNT(*) as count FROM kv_store`.pipe(Effect.map((rows) => rows[0]?.count ?? 0)),
    clear: sql`DELETE FROM kv_store`.pipe(Effect.asVoid),
    modify: (key, f) => pipe(
      sql`SELECT value FROM kv_store WHERE key = ${key}`,
      Effect.map(A.head),
      Effect.map(Option.map((row) => row.value)),
      Effect.map(Option.getOrNull),
      Effect.flatMap((current) => {
        const next = f(current);
        return sql`
          INSERT INTO kv_store (key, value, updated_at) VALUES (${key}, ${next}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${next}, updated_at = NOW()
        `.pipe(Effect.as([current, next] as const));
      }),
    ),
  }))),
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DB-locked leader election | Shard-based singleton via advisory locks | @effect/cluster v0.51.0+ | Automatic failover, no polling |
| External cron daemon | ClusterCron.make with skipIfOlderThan | @effect/cluster native | Single execution guarantee |
| Manual state serialization | KeyValueStore.forSchema | @effect/platform | Type-safe persistence |
| Custom heartbeat tracking | Metric.gauge + observability stack | Effect metrics | Native Prometheus/OTLP |
| Custom cluster metrics | ClusterMetrics.* pre-built gauges | @effect/cluster | No manual metric definitions |

**Deprecated/outdated:**
- `ShardManager` deployment: Removed in v0.51.0, RunnerStorage handles coordination
- Manual leader election: Singleton.make handles automatically
- UUID for cluster IDs: Snowflake provides sortable, collision-free IDs
- `Cron.parse` for static strings: Use `Cron.unsafeParse` (returns Cron directly)

## Sources

### Primary (HIGH confidence)
- [Singleton.ts API](https://effect-ts.github.io/effect/cluster/Singleton.ts.html) - make signature, options, Layer return
- [ClusterCron.ts API](https://effect-ts.github.io/effect/cluster/ClusterCron.ts.html) - make options, skipIfOlderThan, calculateNextRunFromPrevious
- [ClusterMetrics.ts API](https://effect-ts.github.io/effect/cluster/ClusterMetrics.ts.html) - entities, singletons, runners, runnersHealthy, shards gauges
- [Entity.ts API](https://effect-ts.github.io/effect/cluster/Entity.ts.html) - CurrentAddress, CurrentRunnerAddress, keepAlive
- [ShardId.ts API](https://effect-ts.github.io/effect/cluster/ShardId.ts.html) - toString, fromString, make
- [Snowflake.ts API](https://effect-ts.github.io/effect/cluster/Snowflake.ts.html) - toParts, dateTime, timestamp, machineId
- [Sharding.ts API](https://effect-ts.github.io/effect/cluster/Sharding.ts.html) - getSnowflake, isShutdown, makeClient, pollStorage, reset
- [DeliverAt.ts API](https://effect-ts.github.io/effect/cluster/DeliverAt.ts.html) - symbol for scheduled delivery
- [KeyValueStore.ts API](https://effect-ts.github.io/effect/platform/KeyValueStore.ts.html) - forSchema, layerSchema, layerMemory, prefix, SchemaStore interface
- [Metric.ts API](https://effect-ts.github.io/effect/effect/Metric.ts.html) - gauge, set, value, MetricState
- [Cron.ts API](https://effect-ts.github.io/effect/effect/Cron.ts.html) - parse (Either), unsafeParse (Cron)

### Codebase (HIGH confidence)
- `/packages/server/src/infra/cluster.ts` - ClusterService.singleton/cron factory methods (Phase 1)
- `/packages/server/src/context.ts` - Context.Request.withinCluster accessor (Phase 2)
- `/packages/server/src/observe/metrics.ts` - Metric.gauge usage patterns
- `/packages/server/src/observe/health.ts` - Health check integration patterns

### Secondary (MEDIUM confidence)
- [Akka Cluster Singleton](https://doc.akka.io/docs/akka/current/typed/cluster-singleton.html) - State persistence best practices
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Effect cluster overview

### Tertiary (LOW confidence)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world usage patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, APIs verified against official docs
- Architecture patterns: HIGH - Follows established ClusterService patterns from Phase 1
- Pitfalls: HIGH - Common distributed singleton issues well-documented in industry
- Code examples: HIGH - Verified APIs, composition patterns follow codebase conventions

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable APIs)
**Validation passes:**
- @effect/cluster APIs verified 2026-01-29 (makeClient, not messenger)
- @effect/platform APIs verified 2026-01-29
- effect core APIs verified 2026-01-29 (DateTime.addDuration, not addMinutes)
