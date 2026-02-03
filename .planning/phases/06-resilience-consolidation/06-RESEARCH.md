# Phase 6: Resilience Consolidation - Research

**Researched:** 2026-02-02
**Domain:** Circuit breaker management, resilience pattern composition, Effect-TS integration
**Confidence:** HIGH

## Summary

This research addresses the consolidation of circuit breaker and resilience patterns in the codebase. The current implementation has two modules: `circuit.ts` (Cockatiel-based with registry) and `resilience.ts` (pipeline orchestration). The primary issue is that `resilience.ts` calls `Circuit.make()` on every invocation, which correctly uses the registry's getOrCreate pattern but lacks visibility into circuit health and cleanup mechanisms.

The recommended approach follows the **Resilience4j registry pattern**: a single registry owns all circuit breaker instances, provides getOrCreate semantics, exposes stats/health for all circuits, and supports TTL-based garbage collection for unused instances. The resilience layer should remain the primary API while delegating all circuit management to the circuit module.

**Primary recommendation:** Keep `circuit.ts` as the single source of truth for circuit instances. Add `Circuit.stats()` for observability and `Circuit.gc()` for TTL cleanup. `resilience.ts` should NOT create circuits directly but always delegate to `Circuit.make()` which handles registry lookup.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Cockatiel | 3.x | Circuit breaker implementation | Used by codebase; production-ready TS library with ConsecutiveBreaker, CountBreaker, SamplingBreaker |
| Effect | 3.x | Effect system, Ref, HashMap, Schedule | Core framework; provides concurrency primitives for registry |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Effect.Schedule | 3.x | Retry backoff strategies | Already used in resilience.ts for retry schedules |
| Effect.Semaphore | 3.x | Bulkhead isolation | Already used for concurrency limits |
| Effect.Cache | 3.x | TTL-based caching | Alternative to manual HashMap+TTL if simpler |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Cockatiel | Hand-rolled Effect-based CB | Cockatiel is battle-tested; no reason to rewrite |
| HashMap registry | Effect.Cache | Cache has built-in LRU+TTL but less control over circuit state persistence |
| Manual GC | Cockatiel dispose | Cockatiel `dispose()` already exists; just need TTL wrapper |

## Architecture Patterns

### Current Structure (Problem)
```
resilience.ts                          circuit.ts
    |                                      |
    +-- Resilience.run() ----------------> Circuit.make() --+
    |   (calls make on every run)              |            |
    |                                          v            |
    |                                    _registry (Ref<HashMap>)
    |                                          |            |
    |                                    [lookup or create] |
    +-- Bulkhead (own _semStore) <-------------------------+
    +-- Memo (own _memoStore)
```

**Issues:**
1. `resilience.ts` has no visibility into circuit health
2. No way to get stats across all circuits
3. No cleanup of unused circuits
4. Three separate registries (_registry, _semStore, _memoStore) - fragmented

### Recommended Structure
```
resilience.ts                          circuit.ts
    |                                      |
    +-- Resilience.run() ----------------> Circuit.get/make()
    |   (uses Circuit module only)             |
    |                                          v
    +-- Circuit.stats() <-------------- _registry (Ref<HashMap>)
    +-- Circuit.gc(ttl) <-------------- [with lastAccess timestamps]
    |
    +-- Bulkhead: use Circuit.bulkhead() or keep _semStore
    +-- Memo: keep _memoStore (different lifecycle)
```

### Pattern 1: Registry with GetOrCreate
**What:** Single registry manages all circuit instances with name-based lookup
**When to use:** Always - circuits must be shared by name across all callers
**Source:** Resilience4j pattern (https://resilience4j.readme.io/docs/circuitbreaker)

```typescript
// circuit.ts - already implements this correctly
const make = (name: string, config: Config) => _registry.pipe(
  Effect.flatMap((ref) => Ref.get(ref).pipe(
    Effect.flatMap((registry) =>
      Option.match(HashMap.get(registry, name), {
        onNone: () => /* create new, add to registry */,
        onSome: Effect.succeed, // return existing
      })
    )
  ))
);
```

### Pattern 2: Circuit Stats Aggregation
**What:** Collect health/state from all registered circuits
**When to use:** Monitoring, health checks, dashboards
**Example:**

```typescript
// Add to circuit.ts
const stats = (): Effect.Effect<Array<{
  name: string;
  state: CircuitState;
  lastFailure: FailureReason<unknown> | undefined;
  lastAccess: number;
}>> => _registry.pipe(
  Effect.flatMap((ref) => Ref.get(ref)),
  Effect.map((registry) =>
    Array.from(HashMap.values(registry)).map((c) => ({
      name: c.name,
      state: c.state,
      lastFailure: c.lastFailure,
      lastAccess: c._lastAccess, // new field
    }))
  )
);
```

### Pattern 3: TTL-Based Garbage Collection
**What:** Remove circuits not accessed within TTL period
**When to use:** Long-running services with dynamic circuit names (e.g., per-shard circuits)
**Source:** Resilience4j Issue #703 (https://github.com/resilience4j/resilience4j/issues/703)

```typescript
// Add to circuit.ts
const gc = (ttl: Duration.Duration): Effect.Effect<number> => {
  const now = Date.now();
  const ttlMs = Duration.toMillis(ttl);
  return _registry.pipe(
    Effect.flatMap((ref) => Ref.modify(ref, (registry) => {
      const toRemove: string[] = [];
      HashMap.forEach(registry, (instance, name) => {
        if (now - instance._lastAccess > ttlMs) {
          instance.dispose();
          toRemove.push(name);
        }
      });
      const updated = toRemove.reduce(
        (acc, name) => HashMap.remove(acc, name),
        registry
      );
      return [toRemove.length, updated];
    }))
  );
};
```

### Pattern 4: Resilience Pipeline Order
**What:** Correct ordering of resilience strategies
**When to use:** Always when composing multiple strategies
**Source:** kmp-resilient (https://github.com/santimattius/kmp-resilient)

**Recommended order (outer to inner):**
```
Fallback -> Cache/Memo -> Timeout -> Retry -> Circuit Breaker -> Bulkhead -> Hedge
```

**Current resilience.ts order:**
```
bulkhead -> timeout -> hedge -> retry -> circuit -> fallback -> memo -> span
```

**Issues with current order:**
1. Bulkhead is outermost - should be inner (protects resources closest to execution)
2. Fallback is after circuit - correct
3. Memo is after fallback - should be early (skip work if cached)
4. Hedge is before retry - questionable (hedge attempts consume retry budget)

**Recommended order:**
```
span -> fallback -> memo -> timeout -> retry -> circuit -> bulkhead -> hedge
```

### Anti-Patterns to Avoid
- **Creating circuits per-call without registry:** Each call would have its own failure count
- **Bulkhead before timeout:** Permits held during long waits, starving others
- **Retry outside circuit:** Retries bypass circuit state, hammering failing services
- **No fallback after circuit:** BrokenCircuitError propagates as-is to caller

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Circuit breaker logic | Custom state machine | Cockatiel | Edge cases: half-open probing, concurrent resets, backoff |
| Registry pattern | Ad-hoc module-level Map | Ref<HashMap> with getOrCreate | Concurrency safety, Effect integration |
| TTL cleanup | setTimeout-based | Effect.schedule with gc() | Fiber-safe, composable with Effect runtime |
| Retry schedules | Manual delay loops | Effect.Schedule | Jitter, capping, composition built-in |
| Bulkhead | Manual counter | Effect.Semaphore | Fairness, timeout, Effect integration |

**Key insight:** Cockatiel handles the hard circuit breaker problems (state transitions, event ordering, concurrent access). Effect handles the hard concurrency problems (Ref atomicity, Semaphore fairness). Don't duplicate either.

## Common Pitfalls

### Pitfall 1: Circuit Per URL Instead of Per Host
**What goes wrong:** Creating circuit `api.example.com/users/123` for each user ID exhausts memory
**Why it happens:** Dynamic names based on full path instead of service identity
**How to avoid:** Use host/service-level names: `api.example.com` or `cluster.shard.5`
**Warning signs:** Circuit count grows unbounded, GC never cleans circuits

### Pitfall 2: Retry Storms Through Open Circuit
**What goes wrong:** Circuit opens but retries continue, hammering the failing service
**Why it happens:** Retry wraps circuit instead of circuit wrapping retry
**How to avoid:** Circuit should be INNER to retry: `retry -> circuit -> action`
**Warning signs:** Open circuit still receiving requests, downstream overwhelmed

### Pitfall 3: Bulkhead Timeout vs Operation Timeout
**What goes wrong:** Bulkhead acquisition times out, but operation still running
**Why it happens:** Two separate timeouts not coordinated
**How to avoid:** Use single timeout wrapping the entire pipeline, or ensure bulkhead timeout < operation timeout
**Warning signs:** BulkheadError when permits available, resource leaks

### Pitfall 4: No Circuit Stats During Outage
**What goes wrong:** Service is failing but no visibility into which circuits are open
**Why it happens:** Circuits fire state change events but no aggregation endpoint
**How to avoid:** Implement `Circuit.stats()` returning all circuit states, expose via health endpoint
**Warning signs:** Blind debugging during incidents

### Pitfall 5: Stale Circuits Never Cleaned
**What goes wrong:** One-off circuits (e.g., migrated shards) accumulate indefinitely
**Why it happens:** No TTL, no GC, circuits created but never disposed
**How to avoid:** Run `Circuit.gc(Duration.hours(1))` periodically via scheduler
**Warning signs:** Memory growth, registry size in thousands

## Code Examples

### Unified Resilience Entry Point

```typescript
// resilience.ts - simplified run() that delegates to circuit.ts
const _run = <A, E, R>(
  op: string,
  eff: Effect.Effect<A, E, R>,
  cfg: Resilience.Config<A, E, R> = {},
): Effect.Effect<A, Resilience.Error<E>, R> => {
  const circuitName = cfg.circuit === false ? undefined : (cfg.circuit ?? op);

  return Effect.gen(function* () {
    // Outer layers: fallback -> memo -> timeout
    const t0 = cfg.timeout === false ? eff : eff.pipe(
      Effect.timeoutFail({ duration: cfg.timeout ?? Duration.seconds(30), onTimeout: () => TimeoutError.of(op) })
    );

    // Middle: retry -> circuit (circuit INSIDE retry)
    const t1 = cfg.retry === false ? t0 : t0.pipe(
      Effect.retry({ schedule: cfg.schedule ?? _defaults.schedule, while: (e) => !_nonRetriable.has(errorTag(e)) })
    );

    // Circuit breaker (uses registry via Circuit.make)
    const t2 = circuitName === undefined ? t1 : yield* Circuit.make(circuitName, {
      breaker: { _tag: 'consecutive', threshold: cfg.threshold ?? 5 },
    }).pipe(Effect.flatMap((c) => c.execute(t1)));

    // Inner: bulkhead -> hedge
    const t3 = cfg.bulkhead === false ? t2 : yield* _withBulkhead(op, cfg.bulkhead ?? 10, t2);
    const t4 = cfg.hedge === false ? t3 : _withHedge(t3, cfg.hedge);

    // Outer: fallback, memo
    const t5 = cfg.fallback === undefined ? t4 : t4.pipe(Effect.catchAll(cfg.fallback));
    return cfg.memoize === undefined ? yield* t5 : yield* _withMemo(op, cfg.memoize, t5);
  });
};
```

### Circuit Stats for Monitoring

```typescript
// circuit.ts - add to Circuit namespace
const stats = (): Effect.Effect<Circuit.Stats[]> => _registry.pipe(
  Effect.flatMap((ref) => Ref.get(ref)),
  Effect.map((registry) =>
    Array.from(HashMap.entries(registry)).map(([name, c]) => ({
      name,
      state: CircuitState[c.state],
      isOpen: c.state === CircuitState.Open,
      isHalfOpen: c.state === CircuitState.HalfOpen,
      lastFailure: c.lastFailure,
    }))
  )
);

// Usage in health check
const circuitHealth = Effect.gen(function* () {
  const circuits = yield* Circuit.stats();
  const open = circuits.filter((c) => c.isOpen);
  return {
    status: open.length === 0 ? 'healthy' : 'degraded',
    circuits: circuits.length,
    open: open.map((c) => c.name),
  };
});
```

### TTL-Based Garbage Collection

```typescript
// circuit.ts - add lastAccess tracking and gc()
interface Instance {
  // ... existing fields ...
  readonly _lastAccess: Ref.Ref<number>;
}

// In make(), before returning instance:
const lastAccess = yield* Ref.make(Date.now());
// In execute(), at start:
yield* Ref.set(lastAccess, Date.now());

const gc = (ttl: Duration.Duration): Effect.Effect<{ removed: number; remaining: number }> => {
  const ttlMs = Duration.toMillis(ttl);
  return Effect.gen(function* () {
    const now = Date.now();
    const ref = yield* _registry;
    const registry = yield* Ref.get(ref);
    const toRemove: string[] = [];

    for (const [name, instance] of HashMap.entries(registry)) {
      const lastAccess = yield* Ref.get(instance._lastAccess);
      if (now - lastAccess > ttlMs) {
        instance.dispose();
        toRemove.push(name);
      }
    }

    if (toRemove.length > 0) {
      yield* Ref.update(ref, (r) => toRemove.reduce((acc, n) => HashMap.remove(acc, n), r));
      yield* Effect.logInfo('Circuit GC', { removed: toRemove.length, names: toRemove });
    }

    const remaining = yield* Ref.get(ref).pipe(Effect.map(HashMap.size));
    return { removed: toRemove.length, remaining };
  });
};

// Schedule periodic GC (e.g., in singleton or app startup)
const circuitGcSchedule = Effect.schedule(
  Circuit.gc(Duration.hours(1)),
  Schedule.fixed(Duration.minutes(10))
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Netflix Hystrix | Resilience4j, Cockatiel | 2018 (Hystrix deprecated) | Lightweight, functional APIs |
| Policy Wrap (Polly v7) | ResiliencePipeline (Polly v8) | 2023 | Integrated composition |
| Per-call circuit creation | Registry with getOrCreate | Best practice | Proper failure tracking |
| No circuit visibility | Stats/health endpoints | Modern observability | Debugging, dashboards |

**Deprecated/outdated:**
- Hystrix: Deprecated by Netflix, no longer maintained
- Polly v7 Policy.Wrap: Replaced by v8 ResiliencePipeline

## Open Questions

1. **Should bulkheads share the circuit registry?**
   - What we know: Bulkheads are currently in `_semStore` (separate from circuits)
   - What's unclear: Whether unifying under one registry simplifies or complicates
   - Recommendation: Keep separate - different lifecycle (bulkheads rarely need GC)

2. **Should circuits track success/failure counts for metrics?**
   - What we know: Cockatiel fires events; we log but don't aggregate counts
   - What's unclear: Whether adding counters to Instance is worth the overhead
   - Recommendation: Use MetricsService counters via events (current approach is fine)

3. **Circuit breaker per shard vs per entity type?**
   - What we know: `cluster.ts` uses `cluster.shard.${shardId}` pattern
   - What's unclear: Whether shard-level granularity is optimal
   - Recommendation: Shard-level is correct (isolates failures to affected shards)

## Sources

### Primary (HIGH confidence)
- [Cockatiel GitHub](https://github.com/connor4312/cockatiel) - circuit breaker API, policy composition, state persistence
- [Resilience4j CircuitBreaker docs](https://resilience4j.readme.io/docs/circuitbreaker) - registry pattern, getOrCreate, configuration
- [Effect-TS Caching docs](https://effect.website/docs/caching/caching-effects/) - cachedWithTTL, Cache module

### Secondary (MEDIUM confidence)
- [kmp-resilient](https://github.com/santimattius/kmp-resilient) - pipeline composition order (Fallback -> Cache -> Timeout -> Retry -> CB -> Bulkhead -> Hedge)
- [Polly docs](https://www.pollydocs.org/strategies/circuit-breaker.html) - composition patterns, named pipelines
- [Resilience4j Issue #703](https://github.com/resilience4j/resilience4j/issues/703) - GC for unused circuit breakers

### Tertiary (LOW confidence)
- WebSearch results for general circuit breaker patterns - validated against primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Cockatiel already in use, Effect APIs verified
- Architecture patterns: HIGH - based on Resilience4j patterns and codebase analysis
- Pipeline order: MEDIUM - kmp-resilient/Polly patterns, needs validation
- Pitfalls: HIGH - derived from official docs and common patterns

**Research date:** 2026-02-02
**Valid until:** 2026-03-02 (30 days - stable domain)
