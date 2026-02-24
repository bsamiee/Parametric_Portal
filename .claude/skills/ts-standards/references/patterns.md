# [H1][PATTERNS]
>**Dictum:** *Expert knowledge is knowing which landmines to avoid.*

Architectural anti-pattern codex with corrective examples. Each entry: 1-3 line anti-pattern, 1-3 line correct, WHY sentence. Cross-refs: `errors.md` (error handling) -- `matching.md` (dispatch) -- `services.md` (service shape) -- `composition.md` (Layer topology) -- `effects.md` (pipe/gen/retry) -- `concurrency.md` (STM/Ref/Fiber)

```typescript
import { Data, Duration, Effect, Exit, Layer, Match, Option, Ref, Schedule, Schema as S, pipe } from "effect";
```

---
## [1][SCHEMA_DISCIPLINE]
>**Dictum:** *One canonical schema per entity -- derive all projections at call site via pick/omit/partial.*

```typescript
// --- [SCHEMA_SPAM] -----------------------------------------------------------
// [ANTI-PATTERN] -- S.Class for internal config that never serializes
class DbConfig extends S.Class<DbConfig>("DbConfig")({ url: S.String, pool: S.Number }) {}
// [CORRECT] -- plain object + typeof; Schema reserved for boundary codecs
const _CONFIG = { url: process.env.DB_URL ?? "", pool: 5, timeout: 5000 } as const;
type DbConfig = typeof _CONFIG;
```
WHY: `S.Class` adds codec overhead, Hash/Equal derivation, and Class prototype where none is needed. Internal config never serializes -- `typeof` gives the same type for free.

```typescript
// --- [SCHEMA_PROJECTION_COPY] ------------------------------------------------
// [ANTI-PATTERN] -- separate schema files per operation; duplicated fields
class CreateUser extends S.Class<CreateUser>("CreateUser")({ email: S.String, role: S.String }) {}
class UpdateUser extends S.Class<UpdateUser>("UpdateUser")({ role: S.String }) {}
// [CORRECT] -- derive from canonical entity; one schema, N projections
const CreateUser = S.Struct(User.fields).pipe(S.pick("email", "role"));
const PatchUser  = S.partial(S.Struct(User.fields).pipe(S.pick("role")));
```
WHY: Separate classes drift from the canonical entity. `pick`/`omit`/`partial` guarantee field definitions stay in sync -- add a field once, projections update automatically.

```typescript
// --- [AS_CONST_SCATTERING] ---------------------------------------------------
// [ANTI-PATTERN] -- as const per property
const Config = { mode: "production" as const, port: 8080 as const };
// [CORRECT] -- single as const on the object
const _CONFIG = { mode: "production", port: 8080 } as const;
```
WHY: Per-property `as const` is redundant noise. Object-level `as const` narrows all properties to literals in one declaration.

---
## [2][SURFACE_DISCIPLINE]
>**Dictum:** *Minimal export surface -- one or two named exports per module; private internals; capability objects.*

```typescript
// --- [EXPORT_BLOAT] ----------------------------------------------------------
// [ANTI-PATTERN] -- scattered exports; 5+ named exports fragment the surface
export const findUser = (id: string) => /* ... */;
export const validateUser = (user: unknown) => /* ... */;
export const formatUser = (user: { name: string }) => /* ... */;
export type UserConfig = { timeout: number };
// [CORRECT] -- private internals; single const+namespace export
const _find     = (id: string) => /* ... */;
const _validate = (raw: unknown) => /* ... */;
const _format   = (user: { name: string }) => /* ... */;
const User = { find: _find, format: _format, validate: _validate } as const;
type User = typeof UserSchema.Type;
export { User };
```
WHY: Every named export is public API surface that must be maintained. A single `const` namespace collapses N exports to one import site; consumers destructure only what they need.

```typescript
// --- [INDIRECTION_FACTORY] ---------------------------------------------------
// [ANTI-PATTERN] -- wrapper adding zero logic
const makeRepo = (sql: SqlClient) => UserRepo.make(sql);
// [CORRECT] -- call target directly
const repo = UserRepo.make(sql);
```
WHY: Thin wrappers add a navigation hop and an indirection layer with no behavioral difference. Call the target directly.

```typescript
// --- [HELPER_SPAM] -----------------------------------------------------------
// [ANTI-PATTERN] -- detached utility files
import { formatIso } from "../helpers/dateUtils";
// [CORRECT] -- colocate in domain module
const _formatIso = (date: Date): string => date.toISOString();
```
WHY: `helpers.ts` and `utils.ts` are gravity wells that accumulate unrelated functions. Domain logic belongs in the domain module that owns the concept.

---
## [3][NAMESPACE_AS_MODULE]
>**Dictum:** *Const + declare namespace merges runtime values and type-level exports under one symbol.*

```typescript
// --- [NAMESPACE_MERGE] -------------------------------------------------------
// [ANTI-PATTERN] -- type and value exported separately; consumers need 2 imports
export type User = typeof UserSchema.Type;
export const UserOps = { find: _find, validate: _validate } as const;
// [CORRECT] -- const+namespace merge; one import for values and types
const User = { find: _find, validate: _validate } as const;
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
namespace User {
    export type Of = typeof UserSchema.Type;
    export type Tag = Of["_tag"];
}
export { User };
// consumer: import { User } from "./user"; User.find(id); const u: User.Of = ...;
```
WHY: Separate type/value exports force consumers to manage two imports. The merge pattern gives `User.find()` for runtime and `User.Of` for types through a single symbol.

---
## [4][FACTORY_CONSTRUCTION]
>**Dictum:** *One service class with config-driven polymorphism inside the scoped constructor -- not one service class per variant.*

```typescript
// --- [FACTORY_WITH_EFFECT] ---------------------------------------------------
// [ANTI-PATTERN] -- copy-paste service per provider variant
class StripePayment extends Effect.Service<StripePayment>()("pay/Stripe", {
    scoped: /* stripe-specific implementation */
}) {}
class PayPalPayment extends Effect.Service<PayPalPayment>()("pay/PayPal", {
    scoped: /* paypal-specific implementation */
}) {}
// [CORRECT] -- one service; config algebra determines behavior at construction
class PaymentService extends Effect.Service<PaymentService>()("pay/Payment", {
    scoped: Effect.gen(function* () {
        const config = yield* PaymentConfig;
        const provider = Match.valueTags(config, {
            Stripe: (settings) => stripeAdapter(settings),
            PayPal: (settings) => paypalAdapter(settings),
        });
        return { charge: provider.charge, refund: provider.refund } as const;
    }),
}) {}
```
WHY: `Effect.Service` tags are static type-level identifiers -- they cannot be constructed dynamically. One service with `Match.valueTags` on a config algebra selects the adapter at layer construction time. Consumers depend on `PaymentService`, never on a specific provider.

---
## [5][DISPATCH_TABLES]
>**Dictum:** *Object literal + typed key access replaces string switch; Match.valueTags replaces tag inspection.*

```typescript
// --- [POLYMORPHIC_DISPATCH_TABLE] --------------------------------------------
// [ANTI-PATTERN] -- string switch for mode dispatch
const execute = (mode: string, data: unknown) => {
    switch (mode) {
        case "cloud": return deployCloud(data);
        case "selfhosted": return deploySelfHosted(data);
        default: throw new Error(`unknown mode: ${mode}`);
    }
};
// [CORRECT] -- typed object literal; compiler rejects missing keys
type DeployMode = "cloud" | "selfhosted";
const _DEPLOY: Record<DeployMode, (data: unknown) => Effect.Effect<void>> = {
    cloud:      (data) => deployCloud(data),
    selfhosted: (data) => deploySelfHosted(data),
};
const execute = (mode: DeployMode, data: unknown) => _DEPLOY[mode](data);
```
WHY: `switch` is open-ended -- the `default` branch hides missing cases at runtime. A `Record<UnionKey, Handler>` makes the compiler reject missing keys at build time. Adding a variant to the union immediately surfaces every incomplete dispatch table.

---
## [6][RESOURCE_LIFECYCLE]
>**Dictum:** *Scope mismatch is the most common resource leak -- match acquisition site to lifecycle owner.*

```typescript
// --- [SCOPE_MISMATCH] --------------------------------------------------------
// [ANTI-PATTERN] -- acquireRelease in effect mode (no Scope)
class BrokenPool extends Effect.Service<BrokenPool>()("app/BrokenPool", {
    effect: Effect.gen(function* () {
        // acquireRelease needs Scope -- effect mode doesn't provide one
        const pool = yield* Effect.acquireRelease(
            openPool(), (resource) => resource.close(),
        );
        return { pool };
    }),
}) {}
// [CORRECT] -- scoped mode provides Scope for acquireRelease
class ManagedPool extends Effect.Service<ManagedPool>()("app/ManagedPool", {
    scoped: Effect.gen(function* () {
        const pool = yield* Effect.acquireRelease(
            openPool(), (resource) => resource.close(),
        );
        return { pool };
    }),
}) {}
```
WHY: `effect` mode does not provide a `Scope` -- `acquireRelease` compiles but the release function never runs. `scoped` mode pairs acquisition with the Layer's lifecycle, guaranteeing cleanup on shutdown.

```typescript
// --- [MISSING_SCOPED_FOR_FORKSCOPED] -----------------------------------------
// [ANTI-PATTERN] -- forkScoped outside scoped constructor
const worker = Effect.forkScoped(Effect.forever(process()));
// just floating in module scope -- no ambient Scope, fiber leaks
// [CORRECT] -- inside scoped service constructor
class WorkerService extends Effect.Service<WorkerService>()("app/Worker", {
    scoped: Effect.gen(function* () {
        yield* Effect.forkScoped(Effect.forever(process()));
        return { status: () => Effect.succeed("running") };
    }),
}) {}
```
WHY: `forkScoped` ties fiber lifetime to the ambient `Scope`. Outside a scoped constructor, there is no scope -- the fiber escapes and leaks. Inside `scoped`, fiber teardown happens automatically with the Layer.

```typescript
// --- [LAYER_FRESH_IN_PRODUCTION] ---------------------------------------------
// [ANTI-PATTERN] -- Layer.fresh breaks sharing in production
const DbLayer = Layer.fresh(Database.Default);
// [CORRECT] -- Layer.fresh only in test isolation
const TestDbLayer = Layer.fresh(Database.Default); // each test gets fresh instance
const ProdDbLayer = Database.Default; // sharing: one allocation, reused across consumers
```
WHY: `Layer.fresh` defeats Layer memoization -- every consumer allocates a new instance. In production this duplicates connections and state. Reserve for test isolation where independent instances prevent cross-test contamination.

---
## [7][CIRCUIT_BREAKER]
>**Dictum:** *Schedule + Ref compose an algebraic circuit breaker -- no hand-rolled state machine.*

```typescript
// --- [CIRCUIT_BREAKER_VIA_SCHEDULE_AND_REF] ----------------------------------
type CircuitState = "closed" | "open" | "half_open";
const makeCircuitBreaker = (threshold: number, cooldown: Duration.DurationInput) =>
    Effect.gen(function* () {
        const failures = yield* Ref.make(0);
        const state    = yield* Ref.make<CircuitState>("closed");
        const cooldownSchedule = pipe(
            Schedule.spaced(cooldown),
            Schedule.intersect(Schedule.recurs(1)),
        );
        const trip = Ref.set(state, "open" as CircuitState);
        const reset = Effect.all([Ref.set(state, "closed"), Ref.set(failures, 0)]);
        const execute = <A, E>(action: Effect.Effect<A, E>): Effect.Effect<A, E | CircuitOpen> =>
            Effect.gen(function* () {
                const current = yield* Ref.get(state);
                yield* Effect.filterOrFail(
                    Effect.succeed(current),
                    (s): s is "closed" | "half_open" => s !== "open",
                    () => new CircuitOpen(),
                );
                return yield* pipe(
                    action,
                    Effect.tapError(() =>
                        Effect.gen(function* () {
                            const count = yield* Ref.updateAndGet(failures, (n) => n + 1);
                            yield* count >= threshold
                                ? pipe(trip, Effect.andThen(
                                    Effect.sleep(cooldown).pipe(
                                        Effect.andThen(Ref.set(state, "half_open")),
                                        Effect.fork,
                                    ),
                                  ))
                                : Effect.void;
                        }),
                    ),
                    Effect.tap(() => reset),
                );
            });
        return { execute, state: Ref.get(state) } as const;
    });
class CircuitOpen extends Data.TaggedError("CircuitOpen")<{}> {}
```
WHY: Hand-rolled `if (failures > threshold) { isOpen = true; setTimeout(...) }` scatters mutable state across callbacks. `Ref` + `Schedule` compose atomically -- state transitions are pure functions, cooldown is a declarative schedule, and the circuit breaker is testable without timers.

---
## [8][BULKHEAD]
>**Dictum:** *Semaphore bounds concurrent access to a resource -- prevents cascade failures under load.*

```typescript
// --- [BULKHEAD_VIA_SEMAPHORE] ------------------------------------------------
// [ANTI-PATTERN] -- unbounded Promise.all on external service
const results = await Promise.all(ids.map((id) => externalApi.fetch(id)));
// [CORRECT] -- Semaphore-based bounded concurrency
const makeBulkhead = (maxConcurrent: number) =>
    Effect.gen(function* () {
        const semaphore = yield* Effect.makeSemaphore(maxConcurrent);
        const execute = <A, E, R>(action: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
            semaphore.withPermits(1)(action);
        return { execute } as const;
    });
// For one-shot fan-out, Effect.forEach with bounded concurrency is simpler:
const bounded = Effect.forEach(ids, (id) => fetchById(id), { concurrency: 10 });
```
WHY: `Promise.all` with unbounded parallelism exhausts connection pools and triggers cascade failures. `Semaphore.withPermits` queues excess work until a permit frees. For one-shot collections, `Effect.forEach({ concurrency: N })` is the simpler form; `Semaphore` is for long-lived rate gates shared across callers.

---
## [9][SAGA]
>**Dictum:** *Chained acquireRelease with conditional compensation via Exit.isFailure -- no imperative try/finally.*

```typescript
// --- [SAGA_VIA_ACQUIRE_RELEASE] ----------------------------------------------
// [ANTI-PATTERN] -- imperative try/finally compensations
// try { await charge(order); await ship(order); } catch { await refund(order); }
// [CORRECT] -- chained acquireRelease; compensations guaranteed by Scope
const orderSaga = (order: Order) =>
    Effect.gen(function* () {
        const receipt = yield* Effect.acquireRelease(
            charge(order),
            (payment, exit) => Exit.isFailure(exit) ? refund(payment) : Effect.void,
        );
        yield* Effect.acquireRelease(
            ship(order, receipt),
            (shipment, exit) => Exit.isFailure(exit) ? cancelShipment(shipment) : Effect.void,
        );
    });
// MUST run within Effect.scoped or Layer.scoped to trigger release functions
const executeSaga = Effect.scoped(orderSaga(order));
```
WHY: `try/finally` compensations are fragile -- a thrown exception in the finally block silently swallows the original error. `acquireRelease` guarantees the release function runs on scope close (success, failure, or interruption). The `exit` parameter enables conditional compensation: refund only on failure, not on success.

---
## [10][ANTI_PATTERN_GALLERY]
>**Dictum:** *Naming and structure anti-patterns not covered by sibling reference files.*

**ABBREVIATED_PARAMS**

[ANTI-PATTERN]: `const send = (s: Service, ch: string, msg: unknown) => s.publish(ch, msg);`
[CORRECT]: `const send = (service: Service, channel: string, payload: unknown) => service.publish(channel, payload);`
Single-letter params lose domain meaning at the call site and in stack traces. Descriptive names are the cheapest form of documentation.

**COMMENT_WHAT_NOT_WHY**

[ANTI-PATTERN]: `// increment retry count` before `const retries = current + 1;`
[CORRECT]: `// OCC: version must match snapshot taken before optimistic update begins`
Comments restating the code waste vertical space and drift from implementation. Reserve comments for invariants, non-obvious constraints, and the "why" behind a design choice.

**FORWARD_REFERENCE_STATIC**

[ANTI-PATTERN]: `class Svc extends Effect.Service<Svc>()(Svc.TAG, { /* ... */ }) {}`
[CORRECT]:
```typescript
const _TAG = "infra/Cache" as const;
class CacheService extends Effect.Service<CacheService>()(_TAG, { scoped: /* ... */ }) {}
```
WHY: Class statics are not yet available in the `extends` clause -- the reference is a temporal dead zone error. Module-level `const` avoids the forward reference entirely.

**DENSITY_OVER_VOLUME**

[ANTI-PATTERN]: 500-line module with repetitive near-identical handler arms.
[CORRECT]: Extract the varying part into a dispatch table or `Match.valueTags` -- the repetitive structure collapses to a single polymorphic pipeline.
WHY: Volume is not complexity. Repetitive code masks the actual decision points and makes every refactor touch N sites instead of one.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [PATTERN]              | [SYMPTOM]                           | [FIX]                                            |
| :-----: | :--------------------- | :---------------------------------- | :----------------------------------------------- |
|   [1]   | SCHEMA_SPAM            | `S.Class` for internal config       | Plain object + `typeof`                          |
|   [2]   | SCHEMA_PROJECTION_COPY | Separate `CreateX`/`UpdateX`        | `S.pick`/`S.omit`/`S.partial` on canonical       |
|   [3]   | AS_CONST_SCATTERING    | `as const` per property             | Single `as const` on object                      |
|   [4]   | EXPORT_BLOAT           | 5+ named exports per module         | Single `const` namespace + one `export`          |
|   [5]   | INDIRECTION_FACTORY    | Wrapper delegating 1:1              | Call target directly                             |
|   [6]   | HELPER_SPAM            | `helpers.ts`, `utils.ts`            | Colocate in domain module                        |
|   [7]   | NAMESPACE_MERGE        | Type + value exported separately    | Const + `namespace` merge                        |
|   [8]   | FACTORY_WITH_EFFECT    | Copy-paste service per variant      | One service + `Match.valueTags` on config        |
|   [9]   | DISPATCH_TABLE         | `switch` on string key              | `Record<Union, Handler>` typed key access        |
|  [10]   | SCOPE_MISMATCH         | `acquireRelease` in `effect` mode   | Use `scoped` mode for resources                  |
|  [11]   | MISSING_SCOPED         | `forkScoped` at module level        | Inside `scoped` service constructor              |
|  [12]   | LAYER_FRESH_PROD       | `Layer.fresh` in production code    | Default sharing; `fresh` only for test           |
|  [13]   | CIRCUIT_BREAKER        | Hand-rolled if/state machine        | `Schedule` + `Ref` algebraic pattern             |
|  [14]   | BULKHEAD               | Unbounded `Promise.all`             | `Semaphore.withPermits` or `forEach` concurrency |
|  [15]   | SAGA                   | Imperative `try`/`finally` rollback | Chained `acquireRelease` + `Exit.isFailure`      |
|  [16]   | ABBREVIATED_PARAMS     | `(s, ch, d)` single-letter params   | Descriptive names                                |
|  [17]   | COMMENT_WHAT_NOT_WHY   | `// increment counter`              | Comment the "why" only                           |
|  [18]   | FORWARD_REF_STATIC     | Class static in `extends` clause    | Module-level `_CONST`                            |
|  [19]   | DENSITY_OVER_VOLUME    | Repetitive near-identical arms      | Dispatch table or `Match.valueTags`              |
