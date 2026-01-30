# Phase 3 Research Analysis Report

**Date:** 2026-01-29
**Scope:** Singleton & Scheduling Research Document Refinement
**Objective:** Dense, optimized code patterns aligned with existing `cluster.ts`, `circuit.ts`, `telemetry.ts`

---

## Executive Summary

The research document is solid but contains several opportunities for optimization:
1. **Loose type/const spam** that can be inlined or consolidated
2. **Underutilized Effect APIs** that would reduce boilerplate
3. **Hand-rolled patterns** that have official library equivalents
4. **Unnecessary wrapping** that adds no semantic value

---

## 1. Underutilized Imports from `effect`

| Import | Purpose | Current Usage Gap | Optimization |
|--------|---------|-------------------|--------------|
| `Data.TaggedEnum` | ADT construction | Research uses separate classes | Single `Data.taggedEnum` for state machines |
| `Telemetry.span` | Named tracing with context | Codebase uses extensively | **Use Telemetry.span NOT Effect.fn** — codebase pattern |
| `Effect.gen` + `yield*` shorthand | Generator with auto-inferring | Verbose `Effect.gen(function* () {})` | Use `Effect.gen` with `Telemetry.span` wrapping |
| `Effect.zipWith` | Parallel combination | Uses `Effect.all` everywhere | More expressive for binary combinations |
| `Option.fromNullable` | Nullable → Option | Used but underutilized | Replace ternary null checks |
| `Schedule.addDelay` | Dynamic delay addition | Not mentioned | Heartbeat jitter without full Schedule rebuild |
| `Schedule.tapInput` | Logging before schedule run | Not mentioned | Debug scheduling without wrapper |
| `Metric.trackDuration` | Auto-timer metric | Manual `Date.now()` diff | Built-in duration tracking |
| `Metric.trackDurationWith` | Timer with labels | Not used | Labeled heartbeat tracking |
| `Config.secret` / `Config.redacted` | Sensitive config | Hardcoded redacted pattern | Cleaner sensitive value handling |
| `Layer.effectDiscard` | Layer from discarded effect | Verbose Layer.effect for logging | Simpler init-time logging |
| `Layer.scopedDiscard` | Scoped resource without result | Manual resource cleanup | Cleaner finalizer pattern |

### Additional `effect` Imports Worth Considering

```typescript
// effect 3.19 APIs not in research:
import {
  Struct,           // Struct.omit, Struct.pick for schema field manipulation
  Tuple,            // Tuple.make for type-safe tuples
  Number as N,      // N.clamp, N.between for numeric constraints
  DateTime,         // DateTime.formatIso (already used but DateTime.now not Effect)
  Exit,             // Exit.match for explicit success/failure handling
  SynchronizedRef,  // Atomic Ref operations (alternative to Ref + lock)
  SubscriptionRef,  // Reactive state for singleton heartbeats
  PrimaryKey,       // Built-in primary key derivation for entities
} from 'effect';
```

---

## 2. Underutilized Imports from `@effect/cluster`

| Import | Purpose | Current Usage Gap | Optimization |
|--------|---------|-------------------|--------------|
| `ClusterMetrics.singletons` | Pre-built singleton gauge | Research defines custom gauges | Use official metric directly |
| `ClusterMetrics.entities` | Pre-built entity gauge | Not leveraged in health checks | Single source of truth |
| `Entity.CurrentRunnerAddress` | Runner network info | Mentioned but underused | Cross-pod debugging |
| `Sharding.isShutdown` | Graceful shutdown detection | Not in research | Leader handoff signaling |
| `Sharding.pollStorage` | Force storage refresh | Not mentioned | Manual leader sync |
| `Sharding.reset` | Message state cleanup | Not mentioned | Entity recovery |
| `DeliverAt.symbol` | Scheduled message delivery | Mentioned but pattern verbose | Inline schedule pattern |
| `EntityId.make` | Branded entity ID creation | Uses raw strings in examples | Type-safe ID creation |
| `ShardId.toString/fromString` | Serialization | Mentioned but not inlined | Use in Serializable directly |
| `Snowflake.toParts` | ID decomposition | Shown but verbose | Inline debug pattern |
| `RecipientType` | Entity type discrimination | Not used | Type-safe entity dispatch |
| `MessageState` | Message lifecycle tracking | Phase 4 mention only | State machine validation |

### Missing `@effect/cluster` APIs

```typescript
// Not in research but valuable:
import {
  Activity,              // Activity.make for workflow steps
  DurableDeferred,       // Checkpoint persistence
  Workflow,              // Workflow.make for sagas
  SingletonManager,      // Direct singleton access (vs Singleton.make)
  RunnerHealth,          // Health layer (already in cluster.ts)
  EntityResource,        // Per-entity resource management
} from '@effect/cluster';
```

---

## 3. Underutilized Imports from `@effect/platform`

| Import | Purpose | Current Usage Gap | Optimization |
|--------|---------|-------------------|--------------|
| `KeyValueStore.prefix` | Key namespacing | Mentioned but verbose pattern | `prefix(store, 'singleton:')` |
| `KeyValueStore.layerMemory` | Test layer | Listed but not emphasized | Default for unit tests |
| `KeyValueStore.forSchema` | Schema-validated store | Primary pattern but verbose | Inline schema access |
| `SchemaStore` interface | Typed KV operations | Type not imported directly | Direct interface use |
| `PlatformError.PlatformError` | Error type | Not imported in patterns | Proper error typing |
| `ParseResult.ParseError` | Schema error type | Not in error unions | Complete error handling |
| `FileSystem.exists` | File existence check | Not used | State file validation |
| `Path.join` | Path construction | Hardcoded strings | Portable paths |
| `Terminal` | Interactive prompts | Not relevant here | N/A |
| `HttpClient.filterStatusOk` | HTTP response filtering | Not in scope | N/A |
| `Worker` / `WorkerRunner` | Background workers | Phase 4 relevant | Future consideration |
| `Command` | Process execution | Not in scope | N/A |

### Platform APIs for State Persistence

```typescript
// Cleaner KeyValueStore pattern:
import { 
  KeyValueStore,
  type SchemaStore,       // Import type directly
} from '@effect/platform';

// For SQL-backed store:
import { SqlKeyValueStore } from '@effect/sql';  // If exists, verify API
```

---

## 4. Loose Types to Inline

### Research Document Issues

| Location | Loose Definition | Inline Alternative |
|----------|------------------|-------------------|
| Pattern 1 | Separate `StateSchema` type alias | Inline in `forSchema(S.Struct({...}))` |
| Pattern 1 | `const coordinatorHeartbeat = ...` outside | Move to factory IIFE scope |
| Pattern 3 | `EntityState` class + factory methods | Inline state construction |
| Pattern 4 | `readonly name: string; readonly expectedInterval: ...` | Inline in `checkSingletonHealth` param |
| Factory Extension | `State` generic with separate schema param | Combine into single config object |

### Recommended Pattern (Matches `cluster.ts` Style)

```typescript
// BEFORE (research pattern):
const StateSchema = S.Struct({ lastProcessedId: S.String, checkpointTimestamp: S.Number });
type State = typeof StateSchema.Type;
const heartbeat = Metric.gauge('singleton.coordinator.last_execution');

// AFTER (dense pattern):
static readonly singleton = <E, R>(name: string, run: Effect.Effect<void, E, R>, opts?: {
  readonly shardGroup?: string;
  readonly state?: S.Schema<unknown, unknown>;  // Inline schema, derive type via typeof
}) => {
  const hb = Metric.gauge(`singleton.${name}.last_execution`);
  // ... rest inlined
};
```

---

## 5. Hand-Rolled Patterns to Replace

### 5.1 Manual Heartbeat Timestamp (Use `Metric.trackDurationWith`)

```typescript
// RESEARCH (hand-rolled):
yield* Metric.set(heartbeat, Date.now());

// OPTIMIZED (Effect native):
yield* Metric.trackDurationWith(heartbeat, MetricsService.label({ singleton: name }))(
  singletonWork,
);
// Or for just last-execution timestamp (gauge doesn't track duration):
const trackHeartbeat = <A, E, R>(name: string) => (eff: Effect.Effect<A, E, R>) =>
  Effect.ensuring(eff, Metric.set(Metric.gauge(`singleton.${name}.last_execution`), Date.now()));
```

### 5.2 Manual Option.getOrElse with constant

```typescript
// RESEARCH:
Option.getOrElse(constant({ lastProcessedId: '', checkpointTimestamp: 0 }))

// OPTIMIZED (use schema default):
const StateSchema = S.Struct({
  lastProcessedId: S.optional(S.String, { default: () => '' }),
  checkpointTimestamp: S.optional(S.Number, { default: () => 0 }),
});
// Then just use Schema.decode with defaults
```

### 5.3 SQL KeyValueStore (Don't Hand-Roll)

```typescript
// RESEARCH shows manual SQL implementation
// SHOULD USE: @effect/sql already has KeyValueStore integration patterns
// Verify if SqlKeyValueStore exists in @effect/sql-pg or implement via Layer.effect
```

### 5.4 Health Check Threshold Calculation

```typescript
// RESEARCH (verbose):
const threshold = Duration.toMillis(Duration.times(expectedInterval, 2));
const elapsed = Date.now() - state.value;
const healthy = elapsed < threshold;

// OPTIMIZED (cleaner):
const checkHealth = (interval: Duration.DurationInput, lastExec: number) =>
  Date.now() - lastExec < Duration.toMillis(interval) * 2;
```

---

## 6. Unnecessary Wrapping Identified

### 6.1 Double-Wrapped Factory in Research

```typescript
// RESEARCH extends ClusterService.singleton with state handling
// But existing factory already wraps with:
// - Telemetry.span
// - Layer.provide(_clusterLayer)

// Adding state should NOT re-wrap with Telemetry.span
// It should compose at the same level
```

### 6.2 Redundant `Effect.gen` in Simple Cases

```typescript
// RESEARCH:
Effect.gen(function* () {
  const store = (yield* KeyValueStore.KeyValueStore).forSchema(schema);
  const state = yield* store.get(key);
  return state;
});

// OPTIMIZED (pipe):
KeyValueStore.KeyValueStore.pipe(
  Effect.map((kv) => kv.forSchema(schema)),
  Effect.flatMap((store) => store.get(key)),
);
```

---

## 7. Const Spam Consolidation

### Research Has Scattered Constants

```typescript
// Scattered in research:
const coordinatorHeartbeat = Metric.gauge('singleton.coordinator.last_execution');
const cleanupHeartbeat = Metric.gauge('singleton.cleanup.last_execution');

// CONSOLIDATED (factory creates gauge):
// No pre-defined gauges - factory dynamically creates:
const mkGauge = (name: string) => Metric.gauge(`singleton.${name}.last_execution`);
```

### Config Consolidation (Like `_CONFIG` in cluster.ts)

```typescript
// Research patterns lack central config
// SHOULD mirror cluster.ts pattern:
const _CONFIG = {
  health: { graceMs: Duration.toMillis(Duration.seconds(60)), threshold: 2 },
  state: { keyPrefix: 'singleton-state:', version: 1 },
  singleton: { heartbeatInterval: Duration.seconds(30) },
} as const;
```

---

## 8. API Verification Issues

### 8.1 `DateTime.addDuration` Correct

Research uses `DateTime.addDuration(DateTime.unsafeNow(), Duration.minutes(delayMinutes))` — **verified correct**.

### 8.2 `Cron.unsafeParse` vs `Cron.parse`

Research correctly distinguishes:
- `Cron.unsafeParse` for static strings (returns `Cron`)
- `Cron.parse` returns `Either<Cron, ParseError>` — needs unwrapping

### 8.3 Missing: `Schedule.fromCron` Alternative

`Schedule.cron(cronInstance)` is correct, but consider `Schedule.fromCron` if it exists in newer Effect versions.

---

## 9. Type Derivation Improvements

### Current Research Pattern

```typescript
// Separate type declaration:
type Status = typeof EntityStatus.Type;
export type SnowflakeId = typeof SnowflakeId.Type;
```

### Optimized (Namespace Merge Only)

```typescript
// In namespace (like cluster.ts):
namespace ClusterService {
  export type Status = S.Schema.Type<typeof EntityStatus>;  // Derive inline
}
// No separate `type Status = ...` line needed
```

---

## 10. Section Order Alignment

Research patterns don't follow REQUIREMENTS.md section order:

**Required Order:**
```
[TYPES] → [SCHEMA] → [CONSTANTS] → [ERRORS] → [SERVICES] 
→ [FUNCTIONS] → [LAYERS] → [ENTRY_POINT] → [NAMESPACE] → [EXPORT]
```

**Research Patterns Violate:**
- Gauges defined before services (should be in [CONSTANTS] or dynamically created)
- Separate `Effect.gen` blocks outside service definition

---

## 11. Recommended Refinements for 03-RESEARCH.md

### Critical Changes

1. **Remove loose type aliases** — derive from schemas in namespace
2. **Consolidate gauge definitions** — factory-created, not pre-defined
3. **Add `_CONFIG` constant** — mirror cluster.ts pattern
4. **Use `KeyValueStore.prefix`** — for singleton state namespacing
5. **Add `ClusterMetrics.*` imports** — don't redefine built-in gauges
6. **Inline state schema** — no separate `StateSchema` definition
7. **Add error types** — `PlatformError`, `ParseResult.ParseError` in unions

### Minor Changes

8. **Use `Telemetry.span`** — for named tracing (codebase pattern, NOT Effect.fn)
9. **Add `Sharding.isShutdown`** — leader handoff detection
10. **Use `EntityId.make`** — branded ID creation
11. **Add `SubscriptionRef`** — reactive heartbeat state (optional)
12. **Verify SQL KeyValueStore** — use official layer if exists

---

## 12. Import Checklist Summary

### `effect` (12 imports to add/verify)

| # | Import | Status |
|---|--------|--------|
| 1 | `Data.taggedEnum` | ADD — for state ADTs |
| 2 | `Telemetry.span` | USED — codebase pattern (NOT Effect.fn) |
| 3 | `Schedule.addDelay` | VERIFY — jitter addition |
| 4 | `Schedule.tapInput` | ADD — debug logging |
| 5 | `Metric.trackDuration` | VERIFY — auto-timing |
| 6 | `Metric.trackDurationWith` | ADD — labeled timing |
| 7 | `Config.redacted` | USED (cluster.ts) — verify consistency |
| 8 | `Layer.effectDiscard` | ADD — init logging |
| 9 | `SynchronizedRef` | CONSIDER — atomic state |
| 10 | `SubscriptionRef` | CONSIDER — reactive heartbeat |
| 11 | `Struct.omit` | ADD — schema field manipulation |
| 12 | `PrimaryKey` | VERIFY — entity key derivation |

### `@effect/cluster` (12 imports to add/verify)

| # | Import | Status |
|---|--------|--------|
| 1 | `ClusterMetrics.singletons` | ADD — official gauge |
| 2 | `ClusterMetrics.entities` | ADD — official gauge |
| 3 | `ClusterMetrics.runners` | ADD — health checks |
| 4 | `ClusterMetrics.runnersHealthy` | ADD — health checks |
| 5 | `Entity.CurrentRunnerAddress` | USED — verify complete |
| 6 | `Sharding.isShutdown` | ADD — shutdown detection |
| 7 | `Sharding.pollStorage` | ADD — manual sync |
| 8 | `Sharding.reset` | ADD — recovery |
| 9 | `EntityId.make` | ADD — branded IDs |
| 10 | `ShardId.fromString` | USED — verify serialization |
| 11 | `RecipientType` | CONSIDER — type dispatch |
| 12 | `Activity.make` | PHASE 5+ — verify API |

### `@effect/platform` (12 imports to add/verify)

| # | Import | Status |
|---|--------|--------|
| 1 | `KeyValueStore.prefix` | ADD — namespacing |
| 2 | `KeyValueStore.layerMemory` | ADD — testing |
| 3 | `KeyValueStore.layerFileSystem` | ADD — local dev |
| 4 | `KeyValueStore.forSchema` | USED — verify pattern |
| 5 | `SchemaStore` | ADD TYPE — interface import |
| 6 | `PlatformError.PlatformError` | ADD — error typing |
| 7 | `ParseResult.ParseError` | ADD — schema errors |
| 8 | `FileSystem.exists` | CONSIDER — state validation |
| 9 | `Path.join` | CONSIDER — portable paths |
| 10 | `HttpClient.filterStatusOk` | N/A — out of scope |
| 11 | `Worker` | PHASE 4+ — background jobs |
| 12 | `Terminal` | N/A — out of scope |

---

## 13. Code Density Comparison

### cluster.ts Characteristics (Target)
- Single `_CONFIG` constant with all tunables
- IIFE for complex layer construction (`_storageLayers`)
- Dispatch table for transport selection (`_transports`)
- Dense service definition with inline logic
- Namespace-only type exports
- ~225 LOC for full ClusterService

### Research Patterns Currently
- Scattered constants (heartbeat gauges defined per-pattern)
- Verbose `Effect.gen` blocks
- Separate type aliases
- Repetitive wrapping patterns

### Gap: ~40% reduction achievable via consolidation

---

## 14. Actionable Next Steps

1. **Update 03-RESEARCH.md** with import additions
2. **Create unified `_CONFIG`** for singleton/cron settings
3. **Document factory signature** with inlined state schema
4. **Add ClusterMetrics usage** to health check pattern
5. **Remove redundant type aliases** — use namespace exports only
6. **Verify SQL KeyValueStore** — official or custom Layer
7. **Add error type unions** — complete error handling

---

*Analysis complete. Ready for planning phase.*
