# [H1][SERVICES]
>**Dictum:** *Effect.Service is the sole DI mechanism -- class, constructor, capability groups, lifecycle, namespace.*

Cross-references: `errors.md [1]` (TaggedError) -- `effects.md [1]` (Effect.gen/fn) -- `composition.md [1-2]` (Layer topology, assembly) -- `concurrency.md [5]` (fiber lifecycle) -- `observability.md [1]` (span naming)

---
## [1][SERVICE_ANATOMY]
>**Dictum:** *Four constructor modes -- succeed, sync, effect, scoped -- one class, one Default layer.*

`class X extends Effect.Service<X>()('namespace/X', { ... }) {}` -- canonical form.
`dependencies` accepts any `Layer<Tag>` -- not limited to `.Default`. `X.Default`
auto-wires from `dependencies`; `X.DefaultWithoutDependencies` exposes the unwired layer.

```typescript
import { Data, Duration, Effect, Layer, Option, Schedule, Stream } from 'effect';
import { SqlClient } from '@effect/sql';
// --- [ERRORS] ----------------------------------------------------------------
class IngestError extends Data.TaggedError('IngestError')<{
    readonly operation: string;
    readonly reason:    'channel' | 'normalize' | 'persist' | 'query';
    readonly cause?:    unknown;
}> {
    static readonly from = (operation: string, reason: IngestError['reason']) =>
        (cause: unknown) => new IngestError({ cause, operation, reason });
}
// --- [SERVICES] --------------------------------------------------------------
// [1] succeed -- pure synchronous value; R=never; no deps, no lifecycle
class CodecService extends Effect.Service<CodecService>()('server/Codec', {
    succeed: {
        serialize:   (value: unknown): string => JSON.stringify(value),
        deserialize: (raw: string): unknown   => JSON.parse(raw),
    },
}) {}
// [2] effect -- yields deps, no managed lifecycle
class TransformService extends Effect.Service<TransformService>()(
    'server/Transform',
    {
        dependencies: [CodecService.Default],
        effect: Effect.gen(function* () {
            const codec = yield* CodecService;
            return {
                normalize: (raw: string) =>
                    Effect.try({
                        try:   () => codec.deserialize(raw),
                        catch: IngestError.from('normalize', 'normalize'),
                    }),
            };
        }),
    },
) {}
// [3] scoped -- managed lifecycle; acquireRelease + capability groups
class IngestService extends Effect.Service<IngestService>()(
    'server/Ingest',
    {
        // SqlClient provided at composition root via PgClient.layer or similar
        dependencies: [TransformService.Default],
        scoped: Effect.gen(function* () {
            // phase 1: resolve all deps once
            const sql       = yield* SqlClient.SqlClient;
            const transform = yield* TransformService;
            // phase 2: acquire managed resources
            const channel = yield* Effect.acquireRelease(
                Effect.tryPromise({
                    try:   () => openChannel(),
                    catch: IngestError.from('channel.open', 'channel'),
                }),
                (handle) => Effect.promise(() => handle.close()),
            );
            // phase 3: capability groups as closures
            const read = {
                recent: Effect.fn('IngestService.recent')(
                    function* (tenantId: string, limit: number) {
                        return yield* sql<{ id: string; payload: string }>`
                            SELECT id, payload FROM events
                            WHERE tenant_id = ${tenantId}
                            ORDER BY created_at DESC LIMIT ${limit}
                        `.pipe(Effect.mapError(IngestError.from('recent', 'query')));
                    },
                ),
            } as const;
            const write = {
                ingest: Effect.fn('IngestService.ingest')(
                    function* (tenantId: string, raw: string) {
                        const parsed = yield* transform.normalize(raw);
                        yield* sql`
                            INSERT INTO events (tenant_id, payload)
                            VALUES (${tenantId}, ${JSON.stringify(parsed)})
                        `.pipe(Effect.mapError(IngestError.from('ingest', 'persist')));
                        yield* channel.push(tenantId, parsed).pipe(
                            Effect.mapError(IngestError.from('ingest.push', 'channel')),
                        );
                    },
                ),
            } as const;
            const observe = {
                health: Effect.fn('IngestService.health')(function* () {
                    return yield* channel.ping().pipe(
                        Effect.map(() => ({ status: 'ok' as const })),
                        Effect.orElseSucceed(() => ({ status: 'degraded' as const })),
                    );
                }),
            } as const;
            return { observe, read, write };
        }),
    },
) {}
```

| [INDEX] | [MODE]    | [LIFECYCLE] | [USE_WHEN]                                   |
| :-----: | --------- | ----------- | -------------------------------------------- |
|   [1]   | `succeed` | none        | Pure config, codec tables, crypto utils      |
|   [2]   | `sync`    | lazy        | Deferred pure init (LazyArg)                 |
|   [3]   | `effect`  | none        | Stateful compute, DB repos, needs deps       |
|   [4]   | `scoped`  | yes         | Connections, pools, pub/sub, background work |

---
## [2][SCOPED_CONSTRUCTOR]
>**Dictum:** *Yield deps once at top; acquireRelease owns resources; closures define capabilities; Effect.fn traces every method.*

Three-phase structure: (1) `yield*` all deps at top, (2) `Effect.acquireRelease` for managed resources, (3) capability groups as closures. Key mechanics:
- `yield*` resolves deps once per layer instantiation -- not per call; closures give R=never
- `Effect.acquireRelease` guarantees `release` on scope exit; `Effect.addFinalizer` for lightweight cleanup
- `Effect.forkScoped` launches background fibers torn down with layer scope
- Span convention: `'ServiceName.methodName'`; `Effect.fnUntraced` for tight loops
- [NEVER] `scoped` just to yield deps -- that is `effect`'s job; reserve for lifecycle management
- [NEVER] `Effect.fn` on route handlers -- use `Telemetry.span` directly (request context/metrics)

---
## [3][CAPABILITY_GROUPS]
>**Dictum:** *Group by concern: { read, write, observe } as const; consumers destructure only what they need.*

```typescript
const notifyHandler = Effect.gen(function* () {
    const { write } = yield* IngestService;
    yield* write.ingest('t1', '{"event": "user.created"}');
});
```

| [INDEX] | [GROUP]   | [OPERATIONS]               | [TYPICAL_SIGNATURE]      |
| :-----: | --------- | -------------------------- | ------------------------ |
|   [1]   | `read`    | get, find, list, page      | `Effect<A, E, never>`    |
|   [2]   | `write`   | insert, update, drop, send | `Effect<void, E, never>` |
|   [3]   | `observe` | stream, watch, health      | `Stream<A>` / `Effect`   |

---
## [4][DUAL_ACCESS_AND_CLASS_STATICS]
>**Dictum:** *Instance (R=never) inside scoped constructors; static delegates (R=Service) for layer-provided contexts; class body is a legitimate namespace.*

```typescript
class SomeService extends Effect.Service<SomeService>()(
    'server/SomeService',
    {
        dependencies: [SomeDep.Default],
        scoped: Effect.gen(function* () {
            const dep = yield* SomeDep;
            const read = {
                get: Effect.fn('SomeService.get')((id: string) => dep.query(id)),
            } as const;
            return { read };
        }),
    },
) {
    // [1] static delegate -- R=SomeService
    static readonly get = (id: string) =>
        SomeService.pipe(Effect.flatMap((service) => service.read.get(id)));
    // [2] static layer derivation
    static readonly Layer = SomeService.Default.pipe(
        Layer.provideMerge(ExternalLib.layer),
    );
    // [3] static re-exports -- consumer ergonomics
    static readonly Error = SomeServiceError;
    static readonly Request = SomeRequest;
    // [4] static domain operation -- R=SomeService | DatabaseService
    static readonly replay = (id: string) =>
        SomeService.pipe(Effect.flatMap((service) =>
            Effect.flatMap(DatabaseService, (database) =>
                database.items.one([{ field: 'id', value: id }]).pipe(
                    Effect.flatMap(Option.match({
                        onNone: () => Effect.fail(SomeServiceError.from(id, 'NotFound')),
                        onSome: (entry) => service.write.process(entry),
                    })),
                ),
            ),
        ));
}
```

Codebase: **CacheService** -- `static kv`/`sets` (delegates), `static Persistence`/`Layer`/`cache()`/`rateLimit()`. **NotificationService** -- `static Error`/`Preferences`/`Request`. **JobService** -- `static Error`/`Payload`/`State`/`replay()`/`resetJob()`/`isLocal()`.
**Instance** inside scoped constructors (`cache.kv.set`); **Static** in layer-provided contexts (`CacheService.kv.get`).

---
## [5][NAMESPACE_MERGE]
>**Dictum:** *declare namespace augments the class -- no standalone type aliases.*

```typescript
class CacheService extends Effect.Service<CacheService>()('server/CacheService', {
    scoped: Effect.gen(function* () { /* ... */ }),
}) {
    static readonly _rateLimits = {
        api:      { algorithm: 'token-bucket', limit: 100, window: Duration.minutes(1)  },
        auth:     { algorithm: 'fixed-window', limit: 5,   window: Duration.minutes(15) },
        mutation: { algorithm: 'token-bucket', limit: 100, window: Duration.minutes(1)  },
    } as const;
}
declare namespace CacheService {
    type RateLimitPreset = keyof typeof CacheService._rateLimits;
}
```

---
## [6][BACKGROUND_FIBERS]
>**Dictum:** *Effect.forkScoped inside scoped constructor -- fiber lives and dies with layer scope.*

### [6.1] EventBus subscription

```typescript
class NotificationService extends Effect.Service<NotificationService>()(
    'server/Notifications',
    {
        scoped: Effect.gen(function* () {
            const jobs = yield* JobService;
            yield* jobs.registerHandler(
                'notification.send',
                Effect.fn(function* (raw) {
                    const { notificationId } = yield* S.decodeUnknown(
                        S.Struct({ notificationId: S.UUID }),
                    )(raw);
                    // ... delivery logic
                }, (effect) => effect.pipe(
                    Effect.catchIf(Cause.isNoSuchElementException, () => Effect.void),
                    Telemetry.span('notification.job.handle', { metrics: false }),
                )) as (raw: unknown) => Effect.Effect<void, unknown, never>,
            );
            return { /* capabilities */ } as const;
        }),
    },
) {}
```

### [6.2] Leader-gated cron

```typescript
// inside scoped constructor -- only one pod runs cron at a time
yield* cluster.isLocal('jobs-maintenance:dlq').pipe(
    Effect.flatMap((isLeader) => isLeader ? dlqWatcher : Effect.void),
    Effect.repeat(Schedule.spaced(Duration.millis(dlqCheckIntervalMs))),
    Effect.catchAllCause((cause) =>
        Effect.logWarning('DLQ watcher failed', { cause: String(cause) }),
    ),
    Effect.forkScoped,
);
```

`cluster.isLocal(key)` checks leader election per cycle. `Schedule.spaced` governs interval. `Effect.forkScoped` ties fiber to layer scope. `Effect.catchAllCause` prevents cron failure from tearing down the service.

---
## [7][TENANT_SCOPING]
>**Dictum:** *Context.Request.withinSync for synchronous DB paths; within for async paths.*

```typescript
// scopes database operations to tenant
const _dbRun = <A, E, R>(tenantId: string, effect: Effect.Effect<A, E, R>) =>
    Context.Request.withinSync(tenantId, effect).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
    );
// tenant-scoped job submission
const resubmit = Context.Request.withinSync(
    row.appId,
    jobs.submit('notification.send', { notificationId: row.id }, {
        dedupeKey: `${row.appId}:${row.id}:retry`,
        maxAttempts: 1,
    }),
);
// async cross-pod context
yield* Context.Request.within(
    entry.appId,
    submitFn(entry.type, entry.payload, { priority: 'normal' }),
    Context.Request.system(),
);
```

- [NEVER] Mix `within`/`withinSync` -- async routes use `within`; DB-scoped routes use `withinSync`

---
## [8][SERVICE_COMPOSITION]
>**Dictum:** *Services reference other services via yield* -- dependencies array wires the layers.*

```typescript
class NotificationService extends Effect.Service<NotificationService>()(
    'server/Notifications',
    {
        dependencies: [
            DatabaseService.Default,
            EmailAdapter.Default,
            EventBus.Default,
            JobService.Default,
            MetricsService.Default,
            Resilience.Layer,           // custom layer, not .Default
            WebhookService.Default,
        ],
        scoped: Effect.gen(function* () {
            const [database, email, eventBus, jobs, metrics, webhooks] = yield* Effect.all([
                DatabaseService, EmailAdapter, EventBus,
                JobService, MetricsService, WebhookService,
            ]);
            const resilienceCtx = yield* Effect.context<Resilience.State>();
            return { /* capabilities closing over all deps */ } as const;
        }),
    },
) {}
```

`dependencies` wires arbitrary layers: `.Default`, `Layer.scoped(Tag, ...)`, `.toLayer()`, composed layers. `yield* Effect.all([...])` resolves multiple deps in a single destructured binding.

---
## [9][PARAMETERIZED_CONSTRUCTORS]
>**Dictum:** *Effect 3.16+: effect/scoped accept Effect.fn with input params; params flow to X.Default(args).*

```typescript
class NumberService extends Effect.Service<NumberService>()(
    'server/NumberService',
    {
        effect: Effect.fn(function* (seed: number) {
            return {
                next: Effect.fn('NumberService.next')(function* () {
                    return seed + Math.random();
                }),
            };
        }),
    },
) {}
// parameterized Default -- seed flows through constructor
const layer: Layer.Layer<NumberService> = NumberService.Default(42);
```

---
## [10][RULES]

| [INDEX] | [RULE]                                                                                                                                                           |
| :-----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | [ALWAYS] `class X extends Effect.Service<X>()('namespace/X', { ... }) {}` -- class form only.                                                                    |
|   [2]   | [ALWAYS] `dependencies: [...]` accepts any `Layer<Tag>` -- `.Default`, `Layer.scoped(Tag, ...)`, custom layers.                                                  |
|   [3]   | [ALWAYS] `succeed` for pure stateless; `sync` for deferred init; `effect` for deps without lifecycle; `scoped` for `acquireRelease`/`addFinalizer`/`forkScoped`. |
|   [4]   | [ALWAYS] `yield*` all deps at the top of the scoped generator, once; nested functions capture via closure.                                                       |
|   [5]   | [ALWAYS] `Effect.fn('ServiceName.method')` for every capability group method -- automatic span.                                                                  |
|   [6]   | [ALWAYS] `{ group1, group2 } as const` return shape -- group by concern; `as const` on each group.                                                               |
|   [7]   | [ALWAYS] Instance access (R=never) inside scoped constructors; static delegates (R=Service) for layer-provided contexts.                                         |
|   [8]   | [ALWAYS] `declare namespace X { type T = ... }` for service type exposure -- no standalone type aliases.                                                         |
|   [9]   | [ALWAYS] `Effect.forkScoped` for background subscriptions and crons inside scoped constructors.                                                                  |
|  [10]   | [ALWAYS] `Context.Request.withinSync` for tenant-scoped DB ops; `within` for async paths.                                                                        |
|  [11]   | [NEVER] `Context.Tag` directly -- `Effect.Service` subsumes it.                                                                                                  |
|  [12]   | [NEVER] `scoped` just to yield deps -- that is `effect`'s job. Reserve for lifecycle management.                                                                 |
|  [13]   | [NEVER] `yield*` inside nested `Effect.gen` that already has a dep in scope -- hoist to top.                                                                     |
|  [14]   | [NEVER] Flat object of 10+ methods -- group into `read`/`write`/`observe` first.                                                                                 |
|  [15]   | [NEVER] `Effect.fn` on route handlers -- use `Telemetry.span` directly.                                                                                          |
|  [16]   | [NEVER] Background fibers without `Effect.forkScoped` -- they outlive the layer scope.                                                                           |

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                 | [FORM]                                                                     |
| :-----: | ------------------------- | -------------------------------------------------------------------------- |
|   [1]   | Class declaration         | `class X extends Effect.Service<X>()('ns/X', { ... }) {}`                  |
|   [2]   | succeed mode              | `succeed: { method: (a) => result }`                                       |
|   [3]   | sync mode                 | `sync: () => ({ method: (a) => result })`                                  |
|   [4]   | effect mode               | `effect: Effect.gen(function* () { const d = yield* Dep; return {...}; })` |
|   [5]   | scoped mode               | `scoped: Effect.gen(function* () { yield* acquireRelease(...); ... })`     |
|   [6]   | Arbitrary deps            | `dependencies: [A.Default, Layer.scoped(B, ...), C.toLayer()]`             |
|   [7]   | Traced method             | `Effect.fn('Service.method')(function* (arg) { ... })`                     |
|   [8]   | Unnamed callback          | `Effect.fn(function* (item) { ... })`                                      |
|   [9]   | Capability group          | `const read = { get, list } as const; return { read, write };`             |
|  [10]   | Consumer destructure      | `const { read } = yield* MyService;`                                       |
|  [11]   | Instance (R=never)        | `service.read.get(id)` -- inside scoped constructor                        |
|  [12]   | Static delegate (R=Svc)   | `MyService.pipe(Effect.flatMap((s) => s.read.get(id)))`                    |
|  [13]   | Static re-export          | `static readonly Error = SomeError;`                                       |
|  [14]   | Static layer              | `static readonly Layer = X.Default.pipe(Layer.provideMerge(...))`          |
|  [15]   | Namespace merge           | `declare namespace X { type T = keyof typeof X._statics; }`                |
|  [16]   | Background fiber          | `yield* stream.pipe(Stream.runDrain, Effect.forkScoped);`                  |
|  [17]   | Leader-gated cron         | `cluster.isLocal(key).pipe(..., Effect.repeat(...), Effect.forkScoped)`    |
|  [18]   | Tenant scoping            | `Context.Request.withinSync(tenantId, effect)`                             |
|  [19]   | Parameterized constructor | `effect: Effect.fn(function* (seed: number) { ... })` -> `X.Default(42)`   |
