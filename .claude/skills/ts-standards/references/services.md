# [H1][SERVICES]
>**Dictum:** *Services declare grouped capabilities; scoped constructors compose transactional state, resilience, and lifecycle.*

<br>

`Effect.Service` centralizes tag, constructor mode, and layer generation. Scoped constructors manage resources via `acquireRelease`, transactional state via STM/TMap, and retry via Schedule. Layer topology mirrors dependency direction. For schema definitions see `objects.md`. For error design see `errors.md`. For command dispatch see `matching.md`.

---
## Effect.Service Constructor Modes

*Mode Selection:* `succeed` when no dependencies or lifecycle. `effect` when yielding other services. `scoped` when `Effect.acquireRelease` manages a resource handle.

```typescript
import { Duration, Effect, Option, Schedule, STM, TMap } from 'effect';

class ConfigService extends Effect.Service<ConfigService>()('app/ConfigService', {
    succeed: { get: (key: string) => Effect.succeed(`value:${key}`) },
}) {}

class StorageService extends Effect.Service<StorageService>()('app/StorageService', {
    effect: Effect.gen(function* () {
        const config = yield* ConfigService;
        const basePath = yield* config.get('storage.path');
        return {
            read: Effect.fn('StorageService.read')(
                (path: string) => Effect.succeed(`${basePath}/${path}`),
            ),
            write: Effect.fn('StorageService.write')(
                (path: string, data: Uint8Array) =>
                    Effect.succeed({ path: `${basePath}/${path}`, bytes: data.length }).pipe(
                        Effect.retry({ schedule: Schedule.exponential(Duration.millis(50)).pipe(
                            Schedule.jittered, Schedule.intersect(Schedule.recurs(3)),
                        ) }),
                    ),
            ),
        } as const;
    }),
}) {}

class DatabaseService extends Effect.Service<DatabaseService>()('app/DatabaseService', {
    scoped: Effect.gen(function* () {
        const pool = yield* Effect.acquireRelease(
            Effect.sync(() => createConnection()),
            (handle) => Effect.promise(() => handle.close()),
        );
        const cache = yield* STM.commit(
            TMap.empty<string, ReadonlyArray<Record<string, unknown>>>(),
        );
        yield* Effect.addFinalizer(() => Effect.log('DatabaseService released'));
        const query = Effect.fn('DatabaseService.query')(function* (sql: string) {
            const cached = yield* STM.commit(TMap.get(cache, sql));
            return yield* Option.match(cached, {
                onNone: () => Effect.tryPromise(() => pool.query(sql)).pipe(Effect.tap((rows) => STM.commit(TMap.set(cache, sql, rows)))),
                onSome: Effect.succeed,
            });
        });
        const execute = Effect.fn('DatabaseService.execute')(function* (sql: string) {
            yield* Effect.tryPromise(() => pool.execute(sql));
            yield* STM.commit(TMap.removeIf(cache, () => true));
        });
        return { read: { query }, write: { execute } } as const;
    }),
}) {}
```

*Capability Groups:* Named method constants composed into `{ read, write }` at return. `as const` preserves literal types. *Traced Methods:* Generator-form `Effect.fn('Service.method')(function* (...) {...})` wraps with tracing span and flattens sequential operations. *STM/TMap:* `yield* STM.commit(TMap.get(...))` extracts the `Option` directly -- `Option.match` at the yield boundary eliminates nested `flatMap` chains. *Schedule:* Retry via `exponential + jittered + intersect(recurs)` prevents thundering herd.

---
## Scoped Constructor Patterns

*Nested classes capture outer dependencies without polluting module scope. `S.TaggedRequest` defines the cache contract; `PrimaryKey.symbol` provides deterministic key computation.*

```typescript
import { Duration, Effect, Hash, PrimaryKey, Schema as S, Sink, Stream } from 'effect';

class FeatureService extends Effect.Service<FeatureService>()('app/Features', {
    dependencies: [DataStore.Default, CacheService.Default, EventBus.Default],
    scoped: Effect.gen(function* () {
        const [store, eventBus] = yield* Effect.all([DataStore, EventBus]);
        class FlagCacheKey extends S.TaggedRequest<FlagCacheKey>()('FlagCacheKey', {
            failure: ServiceError, payload: { tenantId: S.String }, success: FlagsSchema,
        }) {[PrimaryKey.symbol]() {return `flags:${this.tenantId}`;}}
        const cache = yield* CacheService.cache<FlagCacheKey, never, never>({
            lookup: (key) => store.loadFlags(key.tenantId),
            storeId: 'features',
            timeToLive: Duration.minutes(5),
        });
        const invalidateFlag = (event: { tenantId: string }) => cache.invalidate(new FlagCacheKey({ tenantId: event.tenantId }));
        yield* Effect.forkScoped(eventBus.subscribe('settings.updated').pipe(
            Stream.groupedWithin(32, Duration.seconds(1)),
            Stream.mapEffect((batch) => Effect.forEach(batch, invalidateFlag, { concurrency: 'inherit', discard: true })),
            Stream.catchAll(() => Stream.empty), Stream.run(Sink.drain),
        ));
        const isEnabled = Effect.fn('FeatureService.isEnabled')(function* (flagName: string) {
            const { tenantId } = yield* Context.Request.current;
            const flags = yield* cache.get(new FlagCacheKey({ tenantId }));
            return Math.abs(Hash.string(`${tenantId}:${flagName}`) % 100) < flags[flagName];
        });
        return { isEnabled } as const;
    }),
}) {}
```

*Nested class in scoped:* `FlagCacheKey` captures closure dependencies -- no module-level pollution. *PrimaryKey.symbol:* Deterministic cache key for storage and invalidation routing. *Named callbacks:* `invalidateFlag` extracts the per-event handler -- reduces nesting inside `Stream.mapEffect`. *Stream.groupedWithin:* Batches events by count (32) or time (1s) -- prevents per-event overhead. *Stream.catchAll* precedes `Stream.run` because `run` converts stream to Effect. *Effect.forkScoped:* Ties subscription fiber to service scope -- automatic cleanup on shutdown.

---
## Dual-Mode Service Access

*Module-level factories bind to a captured resource -- instance methods have `R=never`. Static delegates pipe through the service tag -- callers get `R=Service`. Module-level placement is required because TypeScript cannot forward-reference class statics from the `extends` clause.*

```typescript
import { Duration, Effect, Option, Schema as S } from 'effect';

const _makeKv = (redis: RedisConnection) => ({
    get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) =>
        _runRedis('get', () => redis.get(key)).pipe(
            Effect.andThen((raw) => raw === null
                ? Effect.succeed(Option.none<A>())
                : S.decode(S.parseJson(schema))(raw).pipe(Effect.map(Option.some))),
            Effect.catchAll(() => Effect.succeed(Option.none<A>())),
        ),
    set: (key: string, value: unknown, ttl: Duration.Duration) =>
        S.encode(S.parseJson(S.Unknown))(value).pipe(
            Effect.andThen((json) => _runRedis('set', () => redis.set(key, json, 'PX', Duration.toMillis(ttl)))),
            Effect.ignore,
        ),
}) as const;

class CacheService extends Effect.Service<CacheService>()('app/CacheService', {
    scoped: Effect.gen(function* () {
        const redis = yield* Effect.acquireRelease(
            Effect.sync(() => createConnection()), (conn) => Effect.promise(() => conn.quit()),
        );
        return { kv: _makeKv(redis) } as const;
    }),
}) {
    static readonly kv = {
        get: <A, I = A, R = never>(key: string, schema: S.Schema<A, I, R>) => CacheService.pipe(Effect.andThen((s) => s.kv.get(key, schema))),
        set: (key: string, value: unknown, ttl: Duration.Duration) => CacheService.pipe(Effect.andThen((s) => s.kv.set(key, value, ttl))),
    } as const;
}
```

*Instance access (R=never):* Scoped constructor internals use instance directly. *Static access (R=CacheService):* Route handlers use `CacheService.kv.get(...)`. *Module-level factory:* `_makeKv` returns bound capabilities that pipe via `Effect.andThen` for linear transforms. Required outside class body because TypeScript cannot forward-reference statics from `extends` clause.

---
## Layer Topology

*Provision Direction:* `Layer.mergeAll` aggregates independent siblings. `Layer.provideMerge` chains layers where output satisfies input. `dependencies` bakes provision into `Default`.

```typescript
import { Effect, Layer } from 'effect';

// --- [LAYERS] ----------------------------------------------------------------
// Sibling aggregation -- independent layers
const PlatformLayer = Layer.mergeAll(DatabaseService.Default, ConfigService.Default);
// Dependency chain -- output satisfies input
const InfraLayer = StorageService.Default.pipe(Layer.provideMerge(PlatformLayer));
// Inline dependencies -- sugar for Default provision
class FeatureService extends Effect.Service<FeatureService>()('app/FeatureService', {
    dependencies: [DatabaseService.Default, ConfigService.Default],
    effect: Effect.gen(function* () {
        const database = yield* DatabaseService;
        // Parameterized query: `$1` placeholder + `[id]` param array prevents SQL injection; always prefer this over string interpolation
        return { query: Effect.fn('FeatureService.query')((id: string) => database.read.query('SELECT * FROM features WHERE id = $1', [id])) } as const;
    }),
}) {}
// Composition root -- single assembly point, each service constructed once
const LiveLayer = FeatureService.Default.pipe(Layer.provideMerge(InfraLayer));
// Test override -- replace any layer without lifecycle overhead
const TestLayer = FeatureService.Default.pipe(Layer.provideMerge(Layer.mergeAll(
    Layer.succeed(DatabaseService, { read: { query: (_sql: string, _params?: ReadonlyArray<unknown>) => Effect.succeed([]) }, write: { execute: (_sql: string) => Effect.void } }),
    ConfigService.Default,
)));
```

---
## Quick Reference

| [INDEX] | [PATTERN]                       | [WHEN]                                 | [KEY_TRAIT]                           |
| :-----: | ------------------------------- | -------------------------------------- | ------------------------------------- |
|   [1]   | **`succeed: {...}`**            | Pure values, no dependencies           | No lifecycle overhead                 |
|   [2]   | **`effect: Effect.gen(...)`**   | Yields other services                  | Dependency resolution via yield*      |
|   [3]   | **`scoped: Effect.gen(...)`**   | Managed resources + finalizers         | `acquireRelease`, STM/TMap state      |
|   [4]   | **Nested Class in Scoped**      | Schema types only inside service       | Closure captures, no module pollution |
|   [5]   | **Dual-Mode Access**            | Same API for scoped vs layer consumers | Instance R=never, static R=Service    |
|   [6]   | **`Layer.mergeAll(A, B)`**      | Independent sibling layers             | Parallel provision                    |
|   [7]   | **`Layer.provideMerge(dep)`**   | Output satisfies input                 | Dependency chain                      |
|   [8]   | **`dependencies: [X.Default]`** | Inline provision sugar                 | Baked into Default                    |
|   [9]   | **`Layer.succeed(Tag, mock)`**  | Test replacement                       | No lifecycle, no resource acquisition |
|  [10]   | **Schedule Retry**              | Transient error recovery               | `exponential + jittered + recurs`     |
|  [11]   | **Stream.groupedWithin**        | Batched event processing               | Count + time windowing                |
