# [H1][ERRORS_AND_SERVICES]
>**Dictum:** *Errors are values. Services declare interfaces; Layers provide implementations.*

<br>

---
## [1][ERROR_TAXONOMY]
>**Dictum:** *Two error types: `Data.TaggedError` for domain, `Schema.TaggedError` for boundaries.*

<br>

| [TYPE]               | [WHEN]                                    | [KEY_PROPERTY]                  |
| -------------------- | ----------------------------------------- | ------------------------------- |
| `Data.TaggedError`   | Internal domain errors, `catchTag`        | Lightweight, not serializable   |
| `Schema.TaggedError` | Boundary errors (HTTP, RPC, wire)         | Schema-backed, HTTP-annotated   |
| `Effect.die`         | Unrecoverable programmer errors (defects) | Not in `E`, surfaces in `Cause` |

Namespace merge for error grouping:

```typescript
class Auth extends S.TaggedError<Auth>()('Auth', {
    reason: S.String,
}, { status: 401 }) {}

class NotFound extends S.TaggedError<NotFound>()('NotFound', {
    resource: S.String,
    id: S.String,
}, { status: 404 }) {}

const HttpError = { Auth, NotFound } as const;
namespace HttpError { export type Any = Auth | NotFound; }
export { HttpError };
```

[CRITICAL]:
- [NEVER] More than 3-5 error variants per service boundary.
- [NEVER] String errors, generic `Error`, or `try/catch` in Effect code.
- [NEVER] `Data.TaggedError` across network boundaries -- use `Schema.TaggedError`.
- [ALWAYS] `namespace XError { export type Any = ... }` for error union access.

---
## [2][ERROR_COMPOSITION]
>**Dictum:** *Boundary mapping is provably complete. Recovery is per-tag.*

**Boundary mapping** via `Effect.mapError` + `Match.exhaustive`:

```typescript
const toHttpError = <A, R>(
    program: Effect.Effect<A, TenantNotFound | TenantDbError | PermissionDenied, R>,
): Effect.Effect<A, HttpError.Any, R> =>
    program.pipe(Effect.mapError((error) => Match.value(error).pipe(
        Match.tag('TenantNotFound', (e) => HttpError.NotFound.of('tenant', e.tenantId)),
        Match.tag('TenantDbError', (e) => HttpError.Internal.of(`DB: ${e.operation}`, e.cause)),
        Match.tag('PermissionDenied', (e) => HttpError.Auth.of(e.details)),
        Match.exhaustive,
    )));
```

**Per-tag recovery** via `Effect.catchTags`:

```typescript
const withRecovery = <A, R>(program: Effect.Effect<A, NotFound | CacheError | DbError, R>) =>
    program.pipe(Effect.catchTags({
        NotFound: ({ id }) => fetchFromFallback(id),
        CacheError: ({ operation }) => Effect.logWarning(`Cache miss: ${operation}`).pipe(
            Effect.andThen(fetchFromDb(operation))),
    }));
// DbError remains in the error channel -- not caught
```

**Additional patterns:**

| [PATTERN]              | [API]                                                    |
| ---------------------- | -------------------------------------------------------- |
| Error accumulation     | `Effect.partition(items, fn)` -> `[failures, successes]` |
| Full cause inspection  | `Effect.catchAllCause` + `Cause.match`                   |
| Defect (unrecoverable) | `Effect.die` -- not tracked in `E`                       |
| Typed timeout          | `Effect.timeoutFail(new TimeoutError(...))`              |
| Error union collapse   | `Effect.mapError` at boundary to reduce variants         |

[CRITICAL]:
- [NEVER] Non-exhaustive error mapping at boundaries -- `Match.exhaustive` is mandatory.
- [NEVER] Silently drop errors from parallel operations -- use `Effect.partition`.

---
## [3][SERVICE_DEFINITION]
>**Dictum:** *`Effect.Service` declares interface + tag + layer in one class.*

```typescript
class TenantService extends Effect.Service<TenantService>()('app/TenantService', {
    dependencies: [DatabaseService.Default, CacheService.Default],
    scoped: Effect.gen(function* () {
        const db = yield* DatabaseService;
        const cache = yield* CacheService;

        const findById = Effect.fn('TenantService.findById')((id: string) =>
            cache.kv.get(`tenant:${id}`).pipe(
                Effect.flatMap(Option.match({
                    onNone: () => db.tenants.one([{ field: 'id', value: id }]).pipe(
                        Effect.flatMap(Option.match({
                            onNone: () => Effect.fail(new TenantNotFound({ id })),
                            onSome: (tenant) => cache.kv.set(`tenant:${id}`, tenant, '5 minutes').pipe(
                                Effect.as(tenant)),
                        }))),
                    onSome: Effect.succeed,
                }))));

        return { findById } as const;
    }),
}) {}
```

**Three constructors:**

| [MODE]    | [WHEN]                             | [SIGNATURE]                        |
| --------- | ---------------------------------- | ---------------------------------- |
| `succeed` | Static namespace (no dependencies) | `succeed: { method1, method2 }`    |
| `effect`  | Needs deps but no scoped resources | `effect: Effect.gen(function* ())` |
| `scoped`  | Acquires resources needing cleanup | `scoped: Effect.gen(function* ())` |

[IMPORTANT]:
- [ALWAYS] `Effect.Service<T>()('tag', { ... })` -- NOT `Context.Tag`.
- [ALWAYS] `Effect.fn('ServiceName.method')` for all service methods.
- [ALWAYS] `dependencies` field for auto-provision of layer deps.
- [ALWAYS] Service methods return `Effect<Success, Error, never>` -- no dependency leakage in `R`.
- [ALWAYS] Instance access (`R=never`) inside scoped constructors for zero-requirement methods.
- [ALWAYS] Static access (`R=Service`) from external consumers requiring the service tag in `R`.

---
## [4][LAYER_COMPOSITION]
>**Dictum:** *Compose in dependency order: Platform -> Infra -> Domain -> App.*

```typescript
const PlatformLayer = Layer.mergeAll(HttpClient.layer, StorageAdapter.layer);
const InfraLayer = Layer.mergeAll(
    CacheService.Default, DatabaseService.Default, MetricsService.Default,
).pipe(Layer.provideMerge(PlatformLayer));
const AppLayer = Layer.mergeAll(
    TenantService.Default, AuthService.Default,
).pipe(Layer.provideMerge(InfraLayer));
```

**Advanced layer patterns:**

| [PATTERN]             | [API]                                      |
| --------------------- | ------------------------------------------ |
| Runtime-config layers | `Layer.unwrapEffect`                       |
| Fire-and-forget init  | `Layer.effectDiscard`                      |
| Composition root      | `ManagedRuntime.make(AppLayer)`            |
| Test doubles          | `Layer.succeed(ServiceTag, mockImpl)`      |
| Layer naming          | `Default` for production, `Test` for mocks |

[IMPORTANT]:
- [ALWAYS] `Layer.provideMerge` to inject dependencies downward.
- [ALWAYS] `ManagedRuntime.make` at composition root for clean lifecycle.
- [ALWAYS] `Layer.mergeAll` for sibling services at the same tier.

---
## [5][RESOURCE_MANAGEMENT]
>**Dictum:** *Resources are scoped. Cleanup is guaranteed.*

```typescript
const redis = yield* Effect.acquireRelease(
    Effect.sync(() => config.connect()),
    (connection) => Effect.promise(() => connection.quit()),
);

// In Effect.gen -- deterministic cleanup via `using`
using handle = yield* acquireFileHandle(path);

// Scope-bound cleanup registration
yield* Effect.addFinalizer((exit) =>
    Effect.sync(() => { cleanup(exit); }));
```

[IMPORTANT]:
- [ALWAYS] `Effect.acquireRelease` for resources requiring cleanup in scoped constructors.
- [ALWAYS] `using` keyword in `Effect.gen` for deterministic resource disposal.
- [ALWAYS] `Effect.addFinalizer` for registering cleanup to current scope.
- [REFERENCE] Concurrency patterns: [->composition.md](./composition.md)
