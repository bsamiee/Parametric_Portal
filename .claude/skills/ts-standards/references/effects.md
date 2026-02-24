# [H1][EFFECTS]
>**Dictum:** *Effects are described, composed, and eliminated -- construction to schedule algebra in typed pipelines.*

`Effect<A, E, R>` encodes success, typed failure, and required context. All snippets assume `import { Boolean, Data, Duration, Effect, Option, Schedule, pipe } from "effect"`.

---
## [1][CONSTRUCTION]
>**Dictum:** *Constructors lift values, side effects, and promises into the Effect type.*

| [INDEX] | [CONSTRUCTOR]        | [SIGNATURE]               | [WHEN]                                  |
| :-----: | -------------------- | ------------------------- | --------------------------------------- |
|   [1]   | `Effect.succeed(a)`  | `Effect<A, never, never>` | Pure value -- no side effects           |
|   [2]   | `Effect.fail(e)`     | `Effect<never, E, never>` | Typed failure -- domain error           |
|   [3]   | `Effect.sync(fn)`    | `Effect<A, never, never>` | Lazy synchronous side effect            |
|   [4]   | `Effect.promise(fn)` | `Effect<A, never, never>` | Infallible async -- never rejects       |
|   [5]   | `Effect.tryPromise`  | `Effect<A, E, never>`     | Fallible async -- rejection mapped to E |
|   [6]   | `Effect.suspend(fn)` | `Effect<A, E, R>`         | Deferred/recursive construction         |
|   [7]   | `Effect.void`        | `Effect<void>`            | No-op placeholder                       |
|   [8]   | `Effect.never`       | `Effect<never>`           | Infinite suspension -- fiber keep-alive |

```typescript
class FetchError extends Data.TaggedError("FetchError")<{
    readonly url: string;
    readonly cause: unknown;
}> {}
// why: tryPromise maps rejection to typed error -- replaces try/catch + await
const fetchJson = (url: string) =>
    Effect.tryPromise({
        try:   () => fetch(url).then((r) => r.json() as Promise<unknown>),
        catch: (cause) => new FetchError({ url, cause }),
    });
// why: suspend defers construction -- prevents stack overflow in recursive effects
const poll = (url: string): Effect.Effect<unknown, FetchError> =>
    Effect.suspend(() => pipe(
        fetchJson(url),
        Effect.flatMap((data) =>
            data !== null
                ? Effect.succeed(data)
                : pipe(Effect.promise(() => new Promise<void>((r) => setTimeout(r, 1000))),
                    Effect.andThen(poll(url))),
        ),
    ));
```

---
## [2][COMPOSITION]
>**Dictum:** *pipe for linear flows; map/flatMap/tap thread values; zipWith combines two effects.*

`pipe(value, f, g)` left-to-right. `map` transforms A; `flatMap` chains; `tap` observes; `andThen` polymorphic; `zipWith` merges two; `zipRight`/`zipLeft` discard one side.

```typescript
// why: pipe + map/flatMap/tap for linear 1-2 step flows
const enriched = pipe(
    fetchJson("/api/config"),
    Effect.map((raw) => ({ ...(raw as Record<string, unknown>), fetchedAt: Date.now() })),
    Effect.tap((config) => Effect.log(`keys: ${Object.keys(config).length}`)),
    Effect.flatMap((config) => Effect.tryPromise({
        try:   () => fetch("/api/validate", { method: "POST", body: JSON.stringify(config) })
            .then((r) => r.json() as Promise<{ valid: boolean }>),
        catch: (cause) => new FetchError({ url: "/api/validate", cause }),
    })),
);
// why: zipWith combines two independent effects with a merge function
const combined = Effect.zipWith(
    Effect.succeed({ userId: "42" }),
    Effect.sync(() => Date.now()),
    (user, now) => ({ ...user, resolvedAt: now }),
);
```

---
## [3][GEN_AND_FN]
>**Dictum:** *Effect.gen is monadic -- yield* unwraps Effect to A; Effect.fn wraps generators with automatic tracing spans.*

Use `Effect.gen` for 3+ dependent operations. Each `yield*` unwraps `Effect<A, E, R>` to `A`, accumulating `E`/`R`. `Effect.fn('span.name')` wraps with automatic OpenTelemetry span. Pipeline form `Effect.fn(gen, pipeStep, ...)` applies up to 9 pipe steps after span. `Effect.fnUntraced` skips span. See `services.md [2]` for constructors; `observability.md [1]` for span naming.

```typescript
// why: Effect.gen for 3+ dependent operations -- types thread automatically
const provision = Effect.gen(function* () {
    const config = yield* Effect.succeed({ namespace: "acme", quota: 100 });
    const record = yield* pipe(
        fetchJson(`/api/tenants/${config.namespace}`),
        Effect.map((raw) => raw as { id: string; active: boolean }),
    );
    yield* Effect.log(`provisioned ${record.id}`);
    return { tenantId: record.id, quota: config.quota };
});
// why: Effect.fn('name') wraps generator with automatic span + stack trace on error
const activate = Effect.fn("Tenant.activate")(
    function* (tenantId: string, quota: number) {
        yield* Effect.annotateCurrentSpan("tenant.id", tenantId);
        const result = yield* fetchJson(`/api/tenants/${tenantId}/activate`);
        return { ...(result as Record<string, unknown>), quota };
    },
);
// why: pipeline form applies timeout after span wraps body
const activateWithTimeout = Effect.fn(
    function* (tenantId: string) { return yield* activate(tenantId, 100); },
    (effect) => Effect.timeout(effect, Duration.seconds(5)),
);
```

---
## [4][AGGREGATION]
>**Dictum:** *Effect.all aggregates independent effects; Effect.forEach maps effectful functions over collections.*

`Effect.all` accepts tuple, record, or iterable. `mode: "validate"` collects ALL errors (applicative). `mode: "either"` returns `Either` per element. `Effect.forEach` maps effectful function over collection; `{ discard: true }` for side-effect-only.

```typescript
// why: record form preserves field names; concurrency parallelizes
const dashboard = (tenantId: string) =>
    Effect.all({
        profile:  fetchJson(`/api/tenants/${tenantId}`),
        settings: fetchJson(`/api/tenants/${tenantId}/settings`),
        metrics:  fetchJson(`/api/tenants/${tenantId}/metrics`),
    }, { concurrency: "unbounded" });
// why: mode "validate" collects ALL errors -- applicative semantics
const validateAll = Effect.all([
    fetchJson("/api/check/a"), fetchJson("/api/check/b"), fetchJson("/api/check/c"),
], { concurrency: "unbounded", mode: "validate" });
// why: mode "either" returns Either per element -- partial failures preserved
const partial = Effect.all({
    primary: fetchJson("/api/primary"), fallback: fetchJson("/api/fallback"),
}, { concurrency: 2, mode: "either" });
// why: forEach maps effectful fn over collection with bounded concurrency
const processAll = (ids: ReadonlyArray<string>) =>
    Effect.forEach(ids, (id) => fetchJson(`/api/items/${id}`), { concurrency: 10 });
// why: discard true for side-effect-only loops
const notifyAll = (endpoints: ReadonlyArray<string>) =>
    Effect.forEach(endpoints, (url) => pipe(fetchJson(url), Effect.asVoid),
        { concurrency: 5, discard: true });
```

---
## [5][CONTROL_FLOW]
>**Dictum:** *Conditional execution, predicate guards, and effectful loops replace all imperative branching.*

`Effect.filterOrFail` replaces `if/throw`; refinement overload narrows `A` to `B`. `Effect.when`/`Effect.unless` return `Option<A>`. `Boolean.match` or `Option.match` select between effectful branches. `Effect.iterate` returns final state; `Effect.loop` collects body results.

```typescript
type Tenant = { readonly id: string; readonly status: "active" | "suspended"; readonly quota: number };
class SuspendedError extends Data.TaggedError("SuspendedError")<{ readonly tenantId: string }> {}
class QuotaError extends Data.TaggedError("QuotaError")<{
    readonly tenantId: string; readonly limit: number; readonly current: number;
}> {}
// why: filterOrFail with refinement narrows Tenant to active-only downstream
const requireActive = (tenant: Tenant) =>
    pipe(Effect.succeed(tenant), Effect.filterOrFail(
        (row): row is Tenant & { readonly status: "active" } => row.status === "active",
        (row) => new SuspendedError({ tenantId: row.id }),
    ));
// why: filterOrFail with predicate -- guards without narrowing
const checkQuota = (tenant: Tenant, requested: number) =>
    pipe(Effect.succeed(tenant), Effect.filterOrFail(
        (row) => row.quota >= requested,
        (row) => new QuotaError({ tenantId: row.id, limit: row.quota, current: requested }),
    ));
// why: when/unless return Option<A> (Some if executed, None if skipped)
const conditionalLog = (verbose: boolean) =>
    Effect.when(() => verbose)(Effect.log("verbose diagnostics enabled"));
const skipOnDryRun = (dryRun: boolean) =>
    Effect.unless(() => dryRun)(fetchJson("/api/deploy"));
// why: Boolean.match selects between two effects based on boolean -- no Effect.if
const modeDispatch = (production: boolean) =>
    Boolean.match(production, {
        onFalse: () => Effect.succeed({ mock: true }),
        onTrue:  () => fetchJson("/api/prod"),
    });
// why: iterate returns final state -- effectful fold replacing while loops
const retryUntilReady = (tenantId: string) =>
    Effect.iterate({ attempts: 0, ready: false }, {
        while: (state) => !state.ready && state.attempts < 10,
        body:  (state) => pipe(fetchJson(`/api/tenants/${tenantId}/status`),
            Effect.map((raw) => ({ attempts: state.attempts + 1, ready: (raw as { ready: boolean }).ready }))),
    });
// why: loop collects body results into array -- effectful unfold
const paginateAll = (baseUrl: string) =>
    Effect.loop(0 as number, {
        while: (page) => page < 5, step: (page) => page + 1,
        body:  (page) => fetchJson(`${baseUrl}?page=${page}`),
    });
```

---
## [6][MEMOIZATION_AND_TIMING]
>**Dictum:** *cached is two-level (outer sets up, inner reads); race/timeout/timed bound execution with typed failures.*

```typescript
// why: two-level -- outer effect yields the cached reader; inner reads/recomputes
const cachedConfig = Effect.gen(function* () {
    const reader = yield* Effect.cachedWithTTL(fetchJson("/api/remote-config"), Duration.minutes(5));
    return yield* reader;
});
// why: indefinite cache -- value computed once, never recomputed
const permanent = Effect.gen(function* () {
    const reader = yield* Effect.cached(Effect.sync(() => ({ buildId: "abc123", startedAt: Date.now() })));
    return yield* reader;
});
// why: race runs both concurrently; first-wins; loser fiber auto-interrupted
const resilientFetch = (url: string) =>
    pipe(fetchJson(url), Effect.race(pipe(
        Effect.promise(() => new Promise<void>((r) => setTimeout(r, 2000))),
        Effect.andThen(Effect.succeed({ fallback: true })),
    )));
// why: timeoutFail promotes timeout to typed domain error
const strictBounded = pipe(fetchJson("/api/critical"), Effect.timeoutFail({
    duration: Duration.seconds(5),
    onTimeout: () => new FetchError({ url: "/api/critical", cause: "timeout" }),
}));
// why: timed wraps result with elapsed Duration for latency tracking
const measured = pipe(fetchJson("/api/data"), Effect.timed,
    Effect.tap(([duration]) => Effect.log(`elapsed: ${Duration.toMillis(duration)}ms`)),
    Effect.map(([, result]) => result));
```

---
## [7][RESOURCE]
>**Dictum:** *acquireRelease guarantees cleanup on success, failure, or interruption; ensuring/addFinalizer register lightweight teardown.*

`Effect.acquireRelease(acquire, release)` -- release runs on scope close. Requires `Scope` in R. `Effect.ensuring` appends unconditional cleanup. `Effect.addFinalizer` registers in ambient scope. See `composition.md [6]` for Layer-scoped resources.

```typescript
declare const openConnection: () => Promise<{ query: (sql: string) => Promise<unknown>; close: () => Promise<void> }>;
// why: acquireRelease guarantees close() runs -- replaces try/finally
const managedConnection = Effect.acquireRelease(
    Effect.tryPromise({ try: () => openConnection(), catch: (cause) => new FetchError({ url: "db", cause }) }),
    (connection) => Effect.promise(() => connection.close()),
);
// why: ensuring appends unconditional cleanup to any effect
const withCleanup = pipe(fetchJson("/api/data"), Effect.ensuring(Effect.log("cleanup complete")));
// why: addFinalizer registers cleanup in ambient Scope -- use in scoped constructors
const shutdownHook = Effect.addFinalizer(() => Effect.log("finalizer: scope closing"));
```

---
## [8][SCHEDULE_ALGEBRA]
>**Dictum:** *Schedule is algebraic -- compose primitives via pipe, bound with intersect/union, gate with whileInput/whileOutput.*

`Schedule<Out, In, R>` describes recurrence. `exponential` doubles delay. `fibonacci` uses Fibonacci. `spaced` fixed interval. `recurs(n)` caps attempts. `jittered` adds randomness. `upTo` caps wall time. `intersect` = AND (both agree). `union` = OR (either). `andThen` sequences phases. `modifyDelay` transforms computed delay. `whileInput`/`whileOutput` gate on predicate. Apply via `Effect.retry` or `Effect.repeat`.

```typescript
// why: intersect = both policies must agree -- caps at 5 retries AND 30s
const _resilient = pipe(
    Schedule.exponential(Duration.millis(100), 2), Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)), Schedule.upTo(Duration.seconds(30)),
);
// why: union = either policy extends -- shortest delay per iteration wins
const _aggressive = Schedule.union(
    pipe(Schedule.spaced(Duration.millis(50)), Schedule.intersect(Schedule.recurs(3))),
    pipe(Schedule.exponential(Duration.millis(100)), Schedule.intersect(Schedule.recurs(5))),
);
// why: fibonacci backoff with jitter -- gentler growth than exponential
const _fibonacci = pipe(
    Schedule.fibonacci(Duration.millis(100)), Schedule.jittered,
    Schedule.intersect(Schedule.recurs(8)),
);
// why: whileInput gates on error shape -- only retry transient failures
const _transientOnly = pipe(
    Schedule.exponential(Duration.millis(200)), Schedule.jittered,
    Schedule.intersect(Schedule.recurs(3)),
    Schedule.whileInput((err: { readonly retryable: boolean }) => err.retryable),
);
// why: modifyDelay caps individual delays at a ceiling
const _capped = pipe(
    Schedule.exponential(Duration.millis(100)),
    Schedule.modifyDelay((d) => Duration.greaterThan(d, Duration.seconds(10)) ? Duration.seconds(10) : d),
    Schedule.intersect(Schedule.recurs(10)),
);
// why: andThen sequences two schedule phases -- first exhausted, then second begins
const _twoPhase = pipe(
    pipe(Schedule.recurs(3), Schedule.intersect(Schedule.spaced(Duration.millis(100)))),
    Schedule.andThen(pipe(Schedule.recurs(2), Schedule.intersect(Schedule.spaced(Duration.seconds(1))))),
);
// why: Effect.retry applies schedule; Effect.repeat for polling
const resilientCall = (url: string) => pipe(fetchJson(url), Effect.retry(_resilient));
const poller = (url: string) => pipe(fetchJson(url), Effect.repeat(Schedule.spaced(Duration.seconds(30))));
```

---
## [9][TRACING_AND_DI]
>**Dictum:** *Effect.fn names spans; Effect.provide/provideService eliminate R.*

`Effect.fn('name')` creates traced function with automatic span. `Effect.withSpan` wraps inline. `Effect.provide` injects Layer. `Effect.provideService` injects single service. See `services.md [1]` for anatomy; `composition.md [1]` for topology.

```typescript
// why: withSpan wraps existing pipeline inline -- no generator needed
const probed = pipe(fetchJson("/api/health"),
    Effect.map((raw) => (raw as { status: string }).status), Effect.withSpan("Health.probe"));
// why: provideService injects a single service -- test isolation without Layer
declare const TenantRepo: Effect.Tag<typeof TenantRepo, {
    readonly find: (id: string) => Effect.Effect<unknown, FetchError>;
}>;
const testProgram = pipe(
    Effect.gen(function* () { return yield* (yield* TenantRepo).find("t1"); }),
    Effect.provideService(TenantRepo, { find: (id) => Effect.succeed({ id, name: "stub" }) }),
);
```

---
## [10][RULES]
>**Dictum:** *Rules compress into constraints.*

- [ALWAYS] `Effect.gen` for 3+ dependent operations -- `yield*` threads `E` and `R` automatically.
- [ALWAYS] `Effect.fn('Service.method')` for IO methods -- automatic span, stack trace on error.
- [ALWAYS] `pipe` for linear transformations; reserve `flow` for reusable point-free fragments.
- [ALWAYS] `Effect.all` with `{ concurrency }` for independent effects -- record/tuple/iterable.
- [ALWAYS] `Effect.forEach` with `{ concurrency }` for parallel effectful iteration.
- [ALWAYS] `Effect.filterOrFail` with refinement to narrow `A` to `B` with typed failure.
- [ALWAYS] `Effect.when`/`Effect.unless` for conditional execution returning `Option<A>`.
- [ALWAYS] `Effect.tryPromise` with `catch` for fallible async; `Effect.promise` for infallible.
- [ALWAYS] `Effect.suspend` for recursive effect construction -- prevents stack overflow.
- [ALWAYS] Schedule algebra: `exponential` + `jittered` + `recurs` + `upTo` via `intersect`.
- [ALWAYS] `Schedule.whileInput`/`whileOutput` to gate retries on error/result shape.
- [ALWAYS] `Effect.acquireRelease` for scoped resource lifecycle -- release guaranteed.
- [ALWAYS] `Effect.cached`/`cachedWithTTL` for memoization -- two-level semantics.
- [NEVER] `async/await` in Effect pipelines -- use `Effect.promise`/`Effect.tryPromise`.
- [NEVER] `try/catch/throw` in domain code -- errors are typed values in `E`.
- [NEVER] `if/else/switch` -- use `Effect.filterOrFail`, `Option.match`, `Match.valueTags`.
- [NEVER] `Effect.fn` without span name on IO methods -- spans required for observability.
- [NEVER] Ignore effects in `flatMap` chains -- every step must contribute to result.
- [NEVER] `Schedule.union` when both bounds must hold -- use `intersect` for AND.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                               | [WHEN]                         | [KEY_TRAIT]                          |
| :-----: | --------------------------------------- | ------------------------------ | ------------------------------------ |
|   [1]   | `Effect.succeed(a)`                     | Pure value lift                | `E=never, R=never`                   |
|   [2]   | `Effect.fail(e)`                        | Typed domain failure           | `A=never, R=never`                   |
|   [3]   | `Effect.sync(() => a)`                  | Lazy synchronous side effect   | For Date.now, crypto, JSON           |
|   [4]   | `Effect.tryPromise({ try, catch })`     | Fallible async interop         | Maps rejection to typed `E`          |
|   [5]   | `Effect.suspend(() => eff)`             | Deferred/recursive             | Prevents eager stack overflow        |
|   [6]   | `pipe(value, f, g)`                     | Linear left-to-right flow      | Data-first composition               |
|   [7]   | `Effect.gen(function* () { yield* })`   | 3+ dependent ops               | Monadic; types accumulate            |
|   [8]   | `Effect.fn('Svc.method')(gen)`          | Traced service method          | Auto span + stack trace              |
|   [9]   | `Effect.map / flatMap / tap`            | Transform / chain / observe    | Core monadic algebra                 |
|  [10]   | `Effect.all({ a, b }, { conc })`        | Aggregate independent effects  | Record/tuple/iterable                |
|  [11]   | `Effect.all([...], { mode })`           | Validate/either aggregation    | `validate` collects E; `either` per  |
|  [12]   | `Effect.forEach(xs, fn, { conc })`      | Parallel effectful iteration   | `discard: true` for side-effect-only |
|  [13]   | `Effect.filterOrFail(pred, orFail)`     | Guard with typed failure       | Refinement narrows A to B            |
|  [14]   | `Effect.when(() => bool)(eff)`          | Conditional execution          | Returns `Option<A>`                  |
|  [15]   | `Effect.iterate(init, { while, body })` | Effectful state fold           | Returns final state                  |
|  [16]   | `Effect.loop(init, { while, step })`    | Effectful unfold               | Collects body results                |
|  [17]   | `Effect.cached / cachedWithTTL`         | Lazy memoization               | Two-level: outer setup, inner read   |
|  [18]   | `Effect.race(a, b)`                     | First-wins concurrency         | Loser fiber auto-interrupted         |
|  [19]   | `Effect.timeoutFail({ duration })`      | Typed timeout                  | Promotes expiry to domain error      |
|  [20]   | `Effect.timed`                          | Latency measurement            | Wraps with elapsed Duration          |
|  [21]   | `Effect.acquireRelease(acq, rel)`       | Resource lifecycle             | Release guaranteed on scope exit     |
|  [22]   | `Effect.ensuring(cleanup)`              | Unconditional cleanup          | Runs after success or failure        |
|  [23]   | `Schedule.exponential + jittered`       | Transient failure retry        | Compose via pipe + intersect         |
|  [24]   | `Schedule.intersect(a, b)`              | Both policies must allow       | AND -- caps retries AND time         |
|  [25]   | `Schedule.union(a, b)`                  | Either policy extends          | OR -- shortest delay per iter        |
|  [26]   | `Schedule.andThen(a, b)`                | Sequential schedule phases     | First exhausted, then second         |
|  [27]   | `Schedule.whileInput(pred)`             | Gate retries on error shape    | Retry only when predicate holds      |
|  [28]   | `Effect.provide(layer)`                 | Eliminate R via Layer          | Production + test injection          |
|  [29]   | `Effect.provideService(tag, impl)`      | Inline single-service override | Test isolation without full Layer    |
|  [30]   | `Effect.fn('name') / withSpan`          | Tracing                        | OpenTelemetry span + stack trace     |

---
## [CROSS_REFERENCES]

- `errors.md [3]` -- recovery patterns, `catchTag` union narrowing, `tapError`/`mapError`
- `services.md [1]` -- `Effect.Service` anatomy, `Effect.fn` inside capability groups
- `composition.md [1]` -- Layer topology, `provideMerge` chains, `Layer.scoped`
- `concurrency.md [1]` -- STM transactions, TMap, fibers, Ref, Queue
- `matching.md [2]` -- `Match.type`/`Match.valueTags` for exhaustive dispatch
- `observability.md [1]` -- span naming conventions, `Effect.annotateCurrentSpan`
