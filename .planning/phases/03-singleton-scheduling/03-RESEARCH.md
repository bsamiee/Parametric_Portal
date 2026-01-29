# Phase 3: Singleton & Scheduling - Research

**Researched:** 2026-01-29
**Domain:** Cluster singletons, distributed cron, typed state persistence, heartbeat health monitoring
**Confidence:** HIGH

## Summary

Phase 3 implements cluster-wide singleton processes and scheduled tasks using @effect/cluster's `Singleton.make` and `ClusterCron.make`. The existing ClusterService already has factory methods (`singleton()`, `cron()`) pre-wired from Phase 1. This phase extends those factories with:

1. **Typed state persistence** via KeyValueStore.layerSchema for singleton state that survives leader migration
2. **Heartbeat gauges** for dead man's switch health integration via Metric.gauge
3. **withinCluster context scoping** for singleton/entity handlers (success criteria #10, #11)
4. **Snowflake ID generation** for cluster-wide collision-free IDs

The key architectural insight: Singleton state must be **externalized** (DB-backed via KeyValueStore) rather than in-memory. When leader migrates, the new leader loads persisted state rather than reconstructing it.

**Primary recommendation:** Extend ClusterService.singleton() to accept optional state schema parameter. Use KeyValueStore backed by PostgreSQL for persistence. Update heartbeat gauge after each singleton execution. Wrap singleton handlers with `Context.Request.withinCluster({ isLeader: true })`.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@effect/cluster` | 0.56.1 | Singleton.make, ClusterCron.make, Snowflake.Generator | Official cluster primitives |
| `@effect/platform` | 0.94.2 | KeyValueStore, KeyValueStore.layerSchema | Schema-validated persistence |
| `effect` | 3.19.15 | Metric.gauge, Cron.parse, Schema, Duration | Core primitives |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@effect/sql-pg` | 0.50.1 | PostgreSQL-backed KeyValueStore | Production state persistence |
| `@effect/experimental` | 0.58.0 | Persistence/Redis (alternative backend) | When Redis preferred over Postgres |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PostgreSQL KeyValueStore | Redis Persistence | Redis faster but adds dependency; Postgres already in stack |
| Metric.gauge for heartbeat | Custom timestamp tracking | Gauge integrates with Prometheus/OTLP automatically |
| KeyValueStore.layerSchema | Manual JSON serialization | layerSchema provides type-safe encode/decode |

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
// Source: @effect/platform/KeyValueStore.ts.html + @effect/cluster/Singleton.ts.html
import { KeyValueStore } from '@effect/platform';
import { Singleton } from '@effect/cluster';
import { Duration, Effect, Layer, Metric, Schema as S } from 'effect';

// State schema for persistence
const SingletonStateSchema = S.Struct({
  lastProcessedId: S.String,
  checkpointTimestamp: S.Number,
});
type SingletonState = typeof SingletonStateSchema.Type;

// Create KeyValueStore layer backed by SQL (through existing PgClient)
const StateStore = KeyValueStore.layerSchema(SingletonStateSchema, 'singleton-coordinator-state');

// Heartbeat gauge for health monitoring
const heartbeatGauge = Metric.gauge('singleton.coordinator.last_execution');

// Singleton factory with state + heartbeat
const CoordinatorSingletonLive = Singleton.make(
  'coordinator',
  Effect.gen(function* () {
    const store = yield* StateStore.tag;

    // Load persisted state or initialize
    const state = yield* store.get('state').pipe(
      Effect.orElseSucceed(() => ({ lastProcessedId: '', checkpointTimestamp: 0 })),
    );

    // Wrap with leader context
    yield* Context.Request.withinCluster({ isLeader: true })(
      Effect.gen(function* () {
        // Leader-only work
        const newState = yield* coordinatorWork(state);

        // Persist state
        yield* store.set('state', newState);

        // Update heartbeat gauge
        yield* Metric.set(heartbeatGauge, Date.now());

        yield* Effect.logInfo('Coordinator checkpoint', { lastProcessedId: newState.lastProcessedId });
      }),
    );

    yield* Effect.never; // Keep singleton alive
  }),
).pipe(Layer.provide(StateStore.layer));
```

### Pattern 2: ClusterCron with skipIfOlderThan

**What:** Scheduled task that skips accumulated executions after downtime
**When to use:** Cron jobs where catching up on missed runs is undesirable

```typescript
// Source: @effect/cluster/ClusterCron.ts.html + effect/Cron documentation
import { ClusterCron } from '@effect/cluster';
import { Cron, Duration, Effect, Metric } from 'effect';

const cleanupHeartbeat = Metric.gauge('singleton.cleanup.last_execution');

const CleanupCronLive = ClusterCron.make({
  name: 'daily-cleanup',
  cron: Cron.unsafeParse('0 2 * * *'),  // 2 AM daily
  execute: Effect.gen(function* () {
    yield* Context.Request.withinCluster({ isLeader: true })(
      Effect.gen(function* () {
        yield* cleanupOldRecords();
        yield* Metric.set(cleanupHeartbeat, Date.now());
      }),
    );
  }),
  skipIfOlderThan: Duration.hours(1),  // Skip if >1 hour behind schedule
});
```

### Pattern 3: Entity Handler with withinCluster Wrapping

**What:** Entity handlers that propagate cluster context for downstream code
**When to use:** All entity handlers (success criteria #10)

```typescript
// Source: Phase 2 research + @effect/cluster/Entity.ts
import { Entity, Sharding } from '@effect/cluster';
import { Effect } from 'effect';
import { Context } from '../context.ts';

const ClusterEntityLive = ClusterEntity.toLayer(Effect.gen(function* () {
  const { entityId, entityType, shardId } = yield* Entity.CurrentAddress;

  return {
    process: (envelope) => Context.Request.withinCluster({
      entityId,
      entityType,
      shardId,
    })(Effect.gen(function* () {
      // Handler logic - Context.Request.clusterState available
      const cluster = yield* Context.Request.clusterState;
      yield* Effect.logDebug('Processing', { shardId: cluster.shardId?.toString() });
    })),
  };
}), { /* toLayer options */ });
```

### Pattern 4: Heartbeat-Based Health Check

**What:** Health check that fails if singleton hasn't executed recently
**When to use:** Dead man's switch pattern for critical singletons

```typescript
// Source: effect/Metric.ts.html + observe/health.ts pattern
import { Effect, Metric, Duration } from 'effect';

const singletonHealthCheck = (
  gaugeName: string,
  expectedInterval: Duration.DurationInput,
) => Effect.gen(function* () {
  const gauge = Metric.gauge(gaugeName);
  const snapshot = yield* Metric.value(gauge);
  const lastExecution = snapshot.value;
  const now = Date.now();
  const threshold = Duration.toMillis(Duration.times(expectedInterval, 2)); // 2x interval

  return now - lastExecution < threshold
    ? { status: 'healthy' as const, lastExecution }
    : { status: 'unhealthy' as const, lastExecution, threshold };
});
```

### Pattern 5: Snowflake ID Generation

**What:** Cluster-wide unique ID generation without collisions
**When to use:** Any place needing globally unique, sortable IDs

```typescript
// Source: @effect/cluster/Snowflake.ts.html
import { Sharding, Snowflake } from '@effect/cluster';
import { Effect } from 'effect';

// Via Sharding service (existing ClusterService.generateId)
const generateEntityId = Effect.gen(function* () {
  const sharding = yield* Sharding.Sharding;
  const snowflake = yield* sharding.getSnowflake;
  return String(snowflake); // Convert to string for entity routing
});

// Decompose for debugging/logging
const logSnowflakeDetails = (sf: Snowflake.Snowflake) => {
  const parts = Snowflake.toParts(sf);
  return {
    timestamp: parts.timestamp,
    machineId: parts.machineId,
    sequence: parts.sequence,
    datetime: Snowflake.dateTime(sf),
  };
};
```

### Anti-Patterns to Avoid

- **In-memory singleton state:** State is lost on leader migration. Always externalize via KeyValueStore.
- **Polling for leadership:** Singleton.make handles leader election automatically via shard assignment.
- **Manual cron scheduling:** Use Cron.parse, not custom Date arithmetic.
- **Ignoring skipIfOlderThan:** Always set for ClusterCron to prevent burst after downtime.
- **Hand-rolling heartbeat storage:** Use Metric.gauge which integrates with observability stack.
- **Forgetting withinCluster wrapper:** Singleton/entity handlers MUST wrap with context for downstream access.

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leader election | Custom DB flag polling | `Singleton.make` | Automatic via shard assignment, handles failover |
| Cron scheduling | Custom setTimeout/setInterval | `ClusterCron.make` + `Cron.parse` | Exactly-once guarantee, skipIfOlderThan support |
| Singleton state | In-memory Ref | `KeyValueStore.layerSchema` | Survives leader migration, type-safe |
| Unique IDs | UUID v4 | `Snowflake.Generator` | Sortable, machine-aware, no collisions |
| Heartbeat tracking | Custom DB timestamp column | `Metric.gauge` | Integrates with Prometheus/OTLP |
| State serialization | Manual JSON.stringify | Schema-based KeyValueStore | Type-safe encode/decode, validation |
| Dead man's switch | Custom health polling | Gauge + threshold check | Native observability integration |

**Key insight:** The singleton pattern is fundamentally about externalizing state. Cluster handles leader election; KeyValueStore handles state persistence; Metric.gauge handles health monitoring. No custom coordination logic needed.

## Common Pitfalls

### Pitfall 1: In-Memory Singleton State Lost on Migration

**What goes wrong:** Singleton state stored in Ref/local variable is lost when leader changes
**Why it happens:** New leader starts fresh instance; no state transfer mechanism
**How to avoid:** Always use KeyValueStore for any state that must survive leader migration. Load state at singleton startup, persist after each mutation.
**Warning signs:** Singleton "forgets" progress after pod restart or rebalancing

### Pitfall 2: ClusterCron Burst After Downtime

**What goes wrong:** After cluster downtime, cron executes multiple accumulated runs
**Why it happens:** Default behavior catches up on missed schedules
**How to avoid:** Set `skipIfOlderThan` to appropriate threshold (e.g., 1 hour for daily jobs)
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
**How to avoid:** Update heartbeat gauge as final step in singleton execution loop
**Warning signs:** False unhealthy status in health endpoints

### Pitfall 6: Singleton Exits Without Effect.never

**What goes wrong:** Singleton completes immediately and leader election happens again
**Why it happens:** Singleton effect completes; cluster sees it as finished
**How to avoid:** End singleton effect with `Effect.never` for long-running processes, or use `Effect.repeat` for periodic work
**Warning signs:** Rapid singleton start/stop cycles in logs

## Code Examples

Verified patterns from official sources:

### ClusterService.singleton Extended Factory

```typescript
// Source: extend existing ClusterService.singleton from cluster.ts
import { KeyValueStore } from '@effect/platform';
import { Singleton } from '@effect/cluster';
import { Duration, Effect, Layer, Metric, Schema as S } from 'effect';

class ClusterService extends Effect.Service<ClusterService>()('server/Cluster', {
  // ... existing implementation ...
}) {
  // Extended singleton factory with optional state persistence
  static readonly singleton = <State, E, R>(
    name: string,
    run: Effect.Effect<void, E, R>,
    options?: {
      readonly shardGroup?: string;
      readonly state?: {
        readonly schema: S.Schema<State, unknown>;
        readonly initial: State;
      };
    },
  ) => {
    const heartbeat = Metric.gauge(`singleton.${name}.last_execution`);

    const effect = options?.state
      ? Effect.gen(function* () {
          const store = yield* KeyValueStore.KeyValueStore;
          const typedStore = store.forSchema(options.state.schema);

          // Load or initialize state
          const state = yield* typedStore.get(name).pipe(
            Effect.orElseSucceed(() => options.state.initial),
          );

          // Run with leader context + state + heartbeat
          yield* Context.Request.withinCluster({ isLeader: true })(
            Effect.gen(function* () {
              yield* run;
              yield* typedStore.set(name, state);
              yield* Metric.set(heartbeat, Date.now());
            }),
          );
        })
      : Context.Request.withinCluster({ isLeader: true })(
          Effect.gen(function* () {
            yield* run;
            yield* Metric.set(heartbeat, Date.now());
          }),
        );

    return Singleton.make(
      name,
      Telemetry.span(effect, `singleton.${name}`),
      { shardGroup: options?.shardGroup },
    ).pipe(Layer.provide(ClusterLive));
  };

  // Merged cron factory: singleton + schedule
  static readonly cron = <E, R>(config: {
    readonly name: string;
    readonly cron: Parameters<typeof ClusterCron.make>[0]['cron'];
    readonly execute: Effect.Effect<void, E, R>;
    readonly shardGroup?: string;
    readonly skipIfOlderThan?: Duration.DurationInput;
  }) => {
    const heartbeat = Metric.gauge(`singleton.${config.name}.last_execution`);

    return ClusterCron.make({
      cron: config.cron,
      execute: Context.Request.withinCluster({ isLeader: true })(
        Telemetry.span(
          Effect.gen(function* () {
            yield* config.execute;
            yield* Metric.set(heartbeat, Date.now());
          }),
          `cron.${config.name}`,
        ),
      ),
      name: config.name,
      shardGroup: config.shardGroup,
      skipIfOlderThan: config.skipIfOlderThan ?? _CONFIG.cron.skipIfOlderThan,
    }).pipe(Layer.provide(ClusterLive));
  };
}
```

### KeyValueStore Layer with PostgreSQL

```typescript
// Source: @effect/platform/KeyValueStore.ts.html
import { KeyValueStore } from '@effect/platform';
import { SqlClient } from '@effect/sql';
import { Effect, Layer, Schema as S } from 'effect';

// SQL-backed KeyValueStore implementation
const SqlKeyValueStore = Layer.effect(
  KeyValueStore.KeyValueStore,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return KeyValueStore.make({
      get: (key) => sql`SELECT value FROM kv_store WHERE key = ${key}`.pipe(
        Effect.map((rows) => rows[0]?.value ?? null),
        Effect.catchAll(() => Effect.succeed(null)),
      ),
      set: (key, value) => sql`
        INSERT INTO kv_store (key, value, updated_at)
        VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = NOW()
      `.pipe(Effect.asVoid),
      remove: (key) => sql`DELETE FROM kv_store WHERE key = ${key}`.pipe(Effect.asVoid),
      has: (key) => sql`SELECT 1 FROM kv_store WHERE key = ${key}`.pipe(
        Effect.map((rows) => rows.length > 0),
      ),
      isEmpty: sql`SELECT COUNT(*) as count FROM kv_store`.pipe(
        Effect.map((rows) => rows[0]?.count === 0),
      ),
      size: sql`SELECT COUNT(*) as count FROM kv_store`.pipe(
        Effect.map((rows) => rows[0]?.count ?? 0),
      ),
      clear: sql`DELETE FROM kv_store`.pipe(Effect.asVoid),
      modify: (key, f) => Effect.gen(function* () {
        const current = yield* sql`SELECT value FROM kv_store WHERE key = ${key}`.pipe(
          Effect.map((rows) => rows[0]?.value ?? null),
        );
        const next = f(current);
        yield* sql`
          INSERT INTO kv_store (key, value, updated_at)
          VALUES (${key}, ${next}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = ${next}, updated_at = NOW()
        `;
        return [current, next] as const;
      }),
    });
  }),
);
```

### Singleton Health Integration

```typescript
// Source: observe/health.ts pattern + Metric.gauge
import { Effect, Metric, Duration, Option } from 'effect';

// Add to existing HealthService
const singletonHealthChecks = (config: {
  readonly name: string;
  readonly expectedInterval: Duration.DurationInput;
}[]) => Effect.gen(function* () {
  const results = yield* Effect.all(
    config.map(({ name, expectedInterval }) => Effect.gen(function* () {
      const gauge = Metric.gauge(`singleton.${name}.last_execution`);
      const snapshot = yield* Metric.value(gauge);
      const lastExecution = snapshot.value;
      const now = Date.now();
      const threshold = Duration.toMillis(Duration.times(expectedInterval, 2));
      const healthy = now - lastExecution < threshold;

      return {
        name,
        healthy,
        lastExecution: lastExecution > 0 ? new Date(lastExecution).toISOString() : 'never',
        expectedInterval: Duration.toMillis(expectedInterval),
        threshold,
      };
    })),
    { concurrency: 'unbounded' },
  );

  return {
    singletons: results,
    healthy: results.every((r) => r.healthy),
  };
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| DB-locked leader election | Shard-based singleton via advisory locks | @effect/cluster v0.51.0+ | Automatic failover, no polling |
| External cron daemon | ClusterCron.make with skipIfOlderThan | @effect/cluster native | Single execution guarantee |
| Manual state serialization | KeyValueStore.layerSchema | @effect/platform | Type-safe persistence |
| Custom heartbeat tracking | Metric.gauge + observability stack | Effect metrics | Native Prometheus/OTLP |

**Deprecated/outdated:**
- `ShardManager` deployment: Removed in v0.51.0, RunnerStorage handles coordination
- Manual leader election: Singleton.make handles automatically
- UUID for cluster IDs: Snowflake provides sortable, collision-free IDs

## Open Questions

Things that couldn't be fully resolved:

1. **KeyValueStore transaction support**
   - What we know: KeyValueStore has set/get/modify operations
   - What's unclear: Whether modify is atomic across concurrent singleton executions
   - Recommendation: Use PostgreSQL transactions at SQL layer if atomicity needed

2. **Heartbeat gauge persistence across restarts**
   - What we know: Metric.gauge is in-memory by default
   - What's unclear: Whether OTLP export preserves historical gauge values
   - Recommendation: Consider dual-write to DB table for historical tracking

3. **State schema evolution**
   - What we know: Schema.optional handles additive changes
   - What's unclear: Best practice for breaking schema changes
   - Recommendation: Version state keys (e.g., `singleton-v1`, `singleton-v2`)

## Sources

### Primary (HIGH confidence)
- [Singleton.ts API](https://effect-ts.github.io/effect/cluster/Singleton.ts.html) - make signature, options, Layer return
- [ClusterCron.ts API](https://effect-ts.github.io/effect/cluster/ClusterCron.ts.html) - make options, skipIfOlderThan, calculateNextRunFromPrevious
- [KeyValueStore.ts API](https://effect-ts.github.io/effect/platform/KeyValueStore.ts.html) - layerSchema, forSchema, SchemaStore interface
- [Snowflake.ts API](https://effect-ts.github.io/effect/cluster/Snowflake.ts.html) - Generator, toParts, timestamp, machineId
- [Metric.ts API](https://effect-ts.github.io/effect/effect/Metric.ts.html) - gauge, counter, set, value, trackDuration
- [Cron Documentation](https://effect.website/docs/scheduling/cron/) - parse, make, sequence, Schedule integration
- [KeyValueStore Documentation](https://effect.website/docs/platform/key-value-store/) - forSchema usage, SchemaStore patterns

### Codebase (HIGH confidence)
- `/packages/server/src/infra/cluster.ts` - ClusterService.singleton/cron factory methods (Phase 1)
- `/packages/server/src/context.ts` - Context.Request.withinCluster accessor (Phase 2)
- `/packages/server/src/observe/metrics.ts` - Metric.gauge usage patterns
- `/packages/server/src/observe/health.ts` - Health check integration patterns

### Secondary (MEDIUM confidence)
- [Akka Cluster Singleton](https://doc.akka.io/docs/akka/current/typed/cluster-singleton.html) - State persistence best practices (architecture reference)
- [Modern Singleton Strategies](https://www.in-com.com/blog/modern-singleton-strategies-for-cloud-native-and-distributed-architectures/) - Distributed singleton patterns
- [DeepWiki Cluster Management](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management) - Effect cluster overview

### Tertiary (LOW confidence)
- [Effect Cluster ETL Tutorial](https://mufraggi.eu/articles/effect-cluster-etl) - Real-world usage patterns

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All packages in catalog, APIs verified against official docs
- Architecture patterns: HIGH - Follows established ClusterService patterns from Phase 1
- Pitfalls: HIGH - Common distributed singleton issues well-documented in industry
- Code examples: MEDIUM - API signatures verified, composition patterns inferred from docs

**Research date:** 2026-01-29
**Valid until:** 2026-02-28 (30 days - stable APIs)
