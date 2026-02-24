# [H1][ERRORS]
>**Dictum:** *Errors are values -- typed, discriminated, and translated at boundaries; never thrown.*

`Data.TaggedError` for domain errors (yieldable, Hash/Equal, zero-overhead). `Schema.TaggedError`
for boundary errors (codec-derived, OpenAPI-annotated). One polymorphic error class with a `reason`
literal union replaces 3-9 loose classes. Defects bypass the E channel entirely.

```typescript
import { Cause, Data, Effect, Match, Option, Schedule, Schema as S, pipe } from "effect";
import { HttpApiSchema } from "@effect/platform";
```

---
## [1][POLYMORPHIC_DOMAIN_ERROR]
>**Dictum:** *One error class per boundary -- reason field collapses variants; from() factory unifies cause intake; _props enriches without branching.*

```typescript
// --- [ERRORS] ----------------------------------------------------------------
// why: one class collapses not_found + conflict + validation + upstream + rate_limited
//      into a single type; _props enriches each reason with behavioral metadata
class OrderError extends Data.TaggedError("OrderError")<{
    readonly operation: string;
    readonly reason:    "not_found" | "conflict" | "validation" | "upstream" | "rate_limited";
    readonly details?:  string;
    readonly cause?:    unknown;
}> {
    static readonly _props = {
        conflict:     { retryable: false, terminal: false },
        not_found:    { retryable: false, terminal: false },
        rate_limited: { retryable: true,  terminal: false },
        upstream:     { retryable: true,  terminal: false },
        validation:   { retryable: false, terminal: true  },
    } as const;
    override get message() {
        return `OrderError[${this.operation}/${this.reason}]${this.details ? `: ${this.details}` : ""}`;
    }
    // why: adding a reason without _props entry is a compile-time error
    get isRetryable(): boolean { return OrderError._props[this.reason].retryable; }
    get isTerminal(): boolean  { return OrderError._props[this.reason].terminal; }
    // why: boundary collapse -- known typed errors pass through; unknowns wrap with operation context
    static readonly from = (operation: string) => (cause: unknown): OrderError =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(OrderError), (existing) => existing),
            Match.orElse((unknown) => new OrderError({ cause: unknown, operation, reason: "upstream" })),
        );
    // why: named constructors prevent misaligned field assignment at 4+ call sites
    static readonly notFound   = (operation: string, details?: string) =>
        new OrderError({ details, operation, reason: "not_found" });
    static readonly conflict   = (operation: string, details: string) =>
        new OrderError({ details, operation, reason: "conflict" });
    static readonly validation = (operation: string, details: string) =>
        new OrderError({ details, operation, reason: "validation" });
}
// usage: Effect.tryPromise({ catch: OrderError.from("syncInventory") })
// usage: Effect.fail(OrderError.notFound("findOrder", id))
```

---
## [2][BOUNDARY_ERRORS]
>**Dictum:** *Schema.TaggedError at HTTP/RPC seams -- codec + OpenAPI status + static of() in one declaration; const+namespace merge exports all variants as one symbol.*

```typescript
// --- [BOUNDARY_ERRORS] -------------------------------------------------------
// why: Schema.TaggedError derives codec + equality + OpenAPI in one declaration
class NotFound extends S.TaggedError<NotFound>()(
    "NotFound",
    { cause: S.optional(S.Unknown), id: S.optional(S.String), resource: S.String },
    HttpApiSchema.annotations({ description: "Resource not found", status: 404 }),
) {
    static readonly of = (resource: string, id?: string, cause?: unknown) =>
        new NotFound({ cause, id, resource });
    override get message() {
        return this.id ? `NotFound: ${this.resource}/${this.id}` : `NotFound: ${this.resource}`;
    }
}
// pattern repeats for: Auth(401), Conflict(409), Forbidden(403), GatewayTimeout(504),
// Gone(410), Internal(500), OAuth(400), RateLimit(429), ServiceUnavailable(503), Validation(400)
// all share: S.optional(S.Unknown) cause, static of(), override get message()
```

```typescript
// --- [CONST_NAMESPACE_MERGE] -------------------------------------------------
// why: one export symbol for all boundary errors + guard + mapTo; callers use
//      HttpError.NotFound.of(resource, id) and HttpError.mapTo('label')
const _errors = { Auth, Conflict, Forbidden, Internal, NotFound /* ... */ } as const;
const _isHttpError = <E>(error: E): error is Extract<E, { readonly _tag: keyof typeof _errors }> =>
    error !== null && typeof error === "object" && "_tag" in error &&
    typeof (error as { readonly _tag: unknown })._tag === "string" &&
    (error as { readonly _tag: string })._tag in _errors;
const _mapToHttpError = (label: string) =>
    Effect.mapError((error: unknown) => _isHttpError(error) ? error : Internal.of(label, error));
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const HttpError = { ..._errors, is: _isHttpError, mapTo: _mapToHttpError } as const;
namespace HttpError {
    type _I<K extends keyof typeof _errors> = InstanceType<(typeof _errors)[K]>;
    export type Any = _I<keyof typeof _errors>;
    export type NotFound = _I<"NotFound">;
    export type Internal = _I<"Internal">;
    // ... one type alias per error class
}
// --- [EXPORT] ----------------------------------------------------------------
export { HttpError };
```

---
## [3][DOMAIN_TO_BOUNDARY_TRANSLATION]
>**Dictum:** *Domain error reason maps to distinct HTTP responses at the route seam; HttpError.mapTo wraps unknowns as Internal.*

```typescript
// --- [TRANSLATION] -----------------------------------------------------------
// why: Match.value on reason string is exhaustive -- new reasons get compile-time error
const getOrderHandler = (id: string) =>
    findOrder(id).pipe(
        Effect.mapError((err) =>
            Match.value(err.reason).pipe(
                Match.when("not_found",    () => HttpError.NotFound.of("order", id, err)),
                Match.when("conflict",     () => HttpError.Conflict.of("order", err.details ?? "version mismatch", err)),
                Match.when("validation",   () => HttpError.Validation.of("order", err.details ?? "invalid input", err)),
                Match.when("upstream",     () => HttpError.Internal.of("order.upstream", err)),
                Match.when("rate_limited", () => HttpError.Internal.of("order.rate_limited", err)),
                Match.exhaustive,
            ),
        ),
        HttpError.mapTo("order.get"),
    );
// HttpError.mapTo('label') is the catch-all safety net:
// typed HTTP errors pass through; unknowns wrap as Internal.of(label, error)

---
## [4][DEFECTS_VS_FAILURES]
>**Dictum:** *Defects are programming errors that bypass the E channel -- only Cause-level handlers observe them.*

`Effect.die`/`Effect.dieMessage` for invariant violations (impossible state, broken preconditions).
Defects produce `Cause.Die` -- invisible to `catchTag`/`catchAll`/`catchTags`. Only
`Effect.catchAllCause` and `Effect.tapErrorCause` observe them. Use `Cause.isInterrupted`
inside `catchAllCause` to distinguish graceful shutdown from real failures.

```typescript
// --- [DEFECTS] ---------------------------------------------------------------
// why: invariant violation -- query must return rows; if not, fiber should crash
const requireRow = <A>(rows: ReadonlyArray<A>): Effect.Effect<A> =>
    pipe(
        Option.fromNullable(rows[0]),
        Option.match({
            onNone: () => Effect.dieMessage("Query returned no rows -- invariant violated"),
            onSome: Effect.succeed,
        }),
    );
// why: filterOrDie for inline assertion -- defect when precondition breaks
const ensurePositive = (amount: number): Effect.Effect<number> =>
    pipe(
        Effect.succeed(amount),
        Effect.filterOrDie(
            (n) => n > 0,
            () => new Error("Amount must be positive -- programming error"),
        ),
    );
// --- [SHUTDOWN_GUARD] --------------------------------------------------------
// why: catchAllCause MUST check Cause.isInterrupted to avoid swallowing shutdown signals;
//      interrupts are graceful teardown, not failures
const safeCleanup = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    pipe(
        effect,
        Effect.catchAllCause((cause) =>
            Cause.isInterrupted(cause)
                ? Effect.void
                : Effect.logError("Unexpected failure", { cause: Cause.pretty(cause) }),
        ),
    );
```

---
## [5][ERROR_CHANNEL_NARROWING]
>**Dictum:** *catchTag removes one variant from E at the type level; catchTags removes multiple; progressive narrowing reaches never.*

```typescript
// --- [NARROWING] -------------------------------------------------------------
declare const fetchResource: (
    id: string,
) => Effect.Effect<{ data: string }, NotFoundError | TimeoutError | ServiceError>;
// why: each catchTag/catchTags call removes variants from the error union at compile time;
//      the final type reflects only the unhandled variants
const getResource = (id: string) =>
    pipe(
        fetchResource(id),
        // E = NotFoundError | TimeoutError | ServiceError
        Effect.tapError((err) => Effect.logWarning("resource.error", { tag: err._tag })),
        // [1] catchTag removes ONE variant -- E narrows
        Effect.catchTag("NotFoundError", () => fetchFallback(id)),
        // E = TimeoutError | ServiceError
        // [2] catchTags removes MULTIPLE variants via record form
        Effect.catchTags({
            TimeoutError: () => pipe(fetchFallback(id), Effect.retry(_resilientRetry)),
        }),
        // E = ServiceError (sole remaining variant)
    );
// type: Effect<{ data: string }, ServiceError>
// if all variants handled: Effect<{ data: string }, never>
```

`catchTags` record form is more ergonomic than chaining `catchTag` for 2+ variants. Missing
a tag key in the record is a compile-time error when the union is closed.

---
## [6][RETRY_WITH_ERROR_REFINEMENT]
>**Dictum:** *Retry predicates gate on error shape -- connect _props.retryable metadata to Effect.retry({while}).*

```typescript
// --- [RETRY_GATING] ----------------------------------------------------------
// why: while predicate uses polymorphic _props metadata -- only retryable reasons trigger retry;
//      terminal/non-retryable failures fail fast without wasting retry budget
const _retryPolicy = pipe(
    Schedule.exponential("200 millis", 2),
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(3)),
    Schedule.upTo("30 seconds"),
);
const resilientOrder = (id: string) =>
    pipe(
        findOrder(id),
        Effect.retry({ schedule: _retryPolicy, while: (err) => err.isRetryable }),
    );
// while: Predicate<E> -- continue retrying while predicate holds
// until: Predicate<E> -- stop retrying once predicate holds (inverse of while)
// times: number        -- simple N-times retry without schedule

// --- [ACTIVITY_RETRY_PATTERN] ------------------------------------------------
// why: production pattern -- Activity.retry gates on isRetryable computed from _props;
//      non-retryable errors (SignatureError, NotFound) fail immediately to DLQ
// deliverActivity.pipe(Activity.retry({ times: maxAttempts, while: (err) => err.isRetryable }))
```

---
## [7][ERROR_ACCUMULATION]
>**Dictum:** *Accumulate ALL failures for batch validation instead of short-circuiting on first.*

```typescript
// --- [ACCUMULATION] ----------------------------------------------------------
// why: validateAll collects ALL failures instead of fail-fast;
//      error channel is E[] (array), NOT Cause -- each failure preserved as element
declare const OrderSchema: S.Schema<{ id: string; total: number }>;
const validateBatch = (items: ReadonlyArray<unknown>) =>
    Effect.validateAll(items, (item) =>
        S.decodeUnknown(OrderSchema)(item).pipe(
            Effect.mapError((parseError) => OrderError.validation("batch", String(parseError))),
        ),
    );
// type: Effect<Array<{ id: string; total: number }>, Array<OrderError>>
// if ANY item fails, ALL successes are lost
// use Effect.all(items.map(fn), { mode: 'either' }) when partial success needed --
// returns Array<Either<A, E>> with per-element Right(success) or Left(failure)
```

---
## [8][CROSS_SERVICE_ERROR_COMPOSITION]
>**Dictum:** *When ServiceA calls ServiceB, ServiceB's errors translate into ServiceA's error channel at the call boundary.*

```typescript
// --- [SERVICE_COMPOSITION] ---------------------------------------------------
// why: from(operation) wraps unknown causes as upstream; typed ServiceB errors
//      translate explicitly via catchTag before from() sees them
class InventoryError extends Data.TaggedError("InventoryError")<{
    readonly operation: string;
    readonly reason:    "stock_depleted" | "upstream" | "warehouse_offline";
    readonly cause?:    unknown;
}> {
    static readonly from = (operation: string) => (cause: unknown): InventoryError =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(InventoryError), (existing) => existing),
            Match.orElse((unknown) => new InventoryError({ cause: unknown, operation, reason: "upstream" })),
        );
}
// why: OrderService calls InventoryService -- typed translation at call boundary
const fulfillOrder = Effect.fn("OrderService.fulfillOrder")(function* (orderId: string) {
    const inventory = yield* InventoryService;
    return yield* pipe(
        inventory.reserve(orderId),
        Effect.catchTag("InventoryError", (err) =>
            Match.value(err.reason).pipe(
                Match.when("stock_depleted", () =>
                    Effect.fail(OrderError.conflict("fulfillOrder", "insufficient stock"))),
                Match.orElse(() =>
                    Effect.fail(new OrderError({ operation: "fulfillOrder", reason: "upstream", cause: err }))),
            ),
        ),
    );
});
// type: Effect<ReserveResult, OrderError, InventoryService>
// at the route handler: Effect.mapError + HttpError.mapTo collapses to boundary errors
```

---
## [9][CAUSE_INSPECTION]
>**Dictum:** *Cause<E> is the full failure tree -- inspect at observability boundaries only; see observability.md [1] for span middleware.*

```typescript
// --- [CAUSE_SKELETON] --------------------------------------------------------
// why: Cause.match deconstructs the full failure tree -- Empty/Fail/Die/Interrupt/Sequential/Parallel;
// why: Cause.match deconstructs the full failure tree -- Empty/Fail/Die/Interrupt/Sequential/Parallel;
//      use only in telemetry/observability middleware via Effect.tapErrorCause
const _inspectCause = Effect.tapErrorCause((cause: Cause.Cause<unknown>) =>
    pipe(
        Cause.match(cause, {
            onEmpty:      {} as Record<string, unknown>,
            onFail:       (error) => ({ "error.type": (error as { _tag?: string })._tag ?? "DomainError" }),
            onDie:        (defect) => Match.value(defect).pipe(
                Match.when(Match.instanceOf(Error), (e) => ({ "error.type": e.constructor.name })),
                Match.orElse(() => ({ "error.type": "Defect" })),
            ),
            onInterrupt:  (_fiberId) => ({ "error.type": "FiberInterrupted" }),
            onSequential: (left, right) => ({ ...left, ...right }),
            onParallel:   (left, right) => ({ ...left, ...right }),
        }),
        (attrs) => Effect.annotateCurrentSpan({ error: true, ...attrs }),
    ),
);
// see observability.md [1] for the full pattern
```

---
## [10][RULES]

- [ALWAYS] One polymorphic `Data.TaggedError` per service boundary with `reason` literal union -- collapse 3-9 loose classes into one.
- [ALWAYS] `static readonly _props` dispatch table when reasons carry behavioral metadata (retryability, terminal); computed getters derive via property access.
- [ALWAYS] `static from(operation)` returning `(cause: unknown) => Error` -- pass-through typed, wrap unknown.
- [ALWAYS] Named constructors (`notFound`, `conflict`) when 4+ call sites per reason variant.
- [ALWAYS] `Schema.TaggedError` + `HttpApiSchema.annotations({ status })` for boundary errors -- codec + OpenAPI in one declaration.
- [ALWAYS] `static readonly of` on boundary errors -- callers never invoke constructors directly.
- [ALWAYS] Const+namespace merge for boundary error collections -- one `HttpError` export, not 11 classes.
- [ALWAYS] Override `get message()` on all error classes for structured `Error.message`.
- [ALWAYS] Keep error unions at 3-5 variants per service boundary; collapse related causes via `reason`.
- [ALWAYS] Translate domain errors to boundary errors via `Effect.mapError` at the outermost seam (route handler or RPC endpoint).
- [ALWAYS] `Effect.catchTags({...})` for multi-variant recovery -- prefer over chaining `catchTag` for 2+ variants.
- [ALWAYS] `Effect.retry({ schedule, while: (err) => err.isRetryable })` to gate retries on polymorphic `_props` metadata.
- [ALWAYS] `Effect.validateAll` for batch validation collecting all errors (returns `E[]` in error channel).
- [ALWAYS] `Effect.die`/`Effect.dieMessage` for invariant violations -- defects bypass E channel entirely.
- [ALWAYS] `Cause.isInterrupted(cause)` guard in `catchAllCause` handlers to distinguish shutdown from failure.
- [ALWAYS] `Cause.match` only in telemetry/observability layers via `Effect.tapErrorCause` -- never in domain code.
- [NEVER] Proliferate loose error classes (`UserNotFound`, `UserConflict`, `UserValidation`) -- use one class with `reason`.
- [NEVER] `throw` anywhere in domain code -- construct typed errors and `Effect.fail`.
- [NEVER] Untyped string errors or generic `new Error(message)` in Effect pipelines.
- [NEVER] `Effect.catchAll` as primary recovery -- name each `_tag` explicitly via `catchTag`/`catchTags`.
- [NEVER] `Effect.catchAllCause` without checking `Cause.isInterrupted` first -- swallows shutdown signals.
- [NEVER] `Effect.die` for recoverable business errors -- die is for programming defects only.

---
## [11][QUICK_REFERENCE]

| [INDEX] | [API]                                     | [WHEN]                            | [NOTE]                                       |
| :-----: | ----------------------------------------- | --------------------------------- | -------------------------------------------- |
|   [1]   | `Data.TaggedError("Tag")<Fields>`         | Internal domain errors            | Yieldable, Hash/Equal, no codec              |
|   [2]   | `reason: "a" \| "b" \| "c"` field         | Collapse N causes into one class  | Keep 3-5; dispatch via Match at boundary     |
|   [3]   | `static from(op)(cause)`                  | Polymorphic cause intake          | Pass-through typed; wrap unknown             |
|   [4]   | `static _props` dispatch table            | Behavioral metadata per reason    | Computed getters; compile-time completeness  |
|   [5]   | `S.TaggedError<Self>()(tag, fields, ann)` | Boundary errors (HTTP, RPC)       | Codec + OpenAPI; `HttpApiSchema.annotations` |
|   [6]   | `static readonly of`                      | Boundary error construction       | Encapsulates payload; callers skip ctor      |
|   [7]   | Const+namespace merge                     | Boundary error collection         | One `HttpError` export, not 11 classes       |
|   [8]   | `HttpError.mapTo('label')`                | Boundary catch-all                | Pass-through typed; wrap unknown as Internal |
|   [9]   | `Effect.mapError(fn)`                     | Translate errors without recovery | Domain -> HTTP at boundary seam              |
|  [10]   | `Effect.catchTag("Tag", handler)`         | Recover one variant               | Union narrows post-recovery                  |
|  [11]   | `Effect.catchTags({ Tag: handler })`      | Recover multiple variants         | Record form; missing tag = type error        |
|  [12]   | `Effect.tapError(fn)`                     | Observe without recovery          | Error propagates unchanged                   |
|  [13]   | `Effect.die(defect)`                      | Invariant violation               | Bypasses E; only catchAllCause sees it       |
|  [14]   | `Effect.dieMessage(msg)`                  | Invariant with string             | Shorthand for die(RuntimeException)          |
|  [15]   | `Effect.retry({ while })`                 | Conditional retry                 | Gate on error shape (retryable flag)         |
|  [16]   | `Effect.validateAll(xs, fn)`              | Batch accumulation                | Error channel is `E[]`; all-or-nothing       |
|  [17]   | `Effect.all({}, { mode: "either" })`      | Partial success                   | Per-element `Either<A, E>` results           |
|  [18]   | `Cause.isInterrupted(cause)`              | Shutdown guard                    | Distinguishes interrupt from real failure    |
|  [19]   | `Cause.match(cause, handlers)`            | Full failure tree                 | Empty/Fail/Die/Interrupt/Seq/Par             |
|  [20]   | `Exit<A, E>`                              | Inspect completed effect          | Success(value) or Failure(Cause)             |

---

Cross-references: `effects.md [3]` Schedule composition and recovery pipeline -- `matching.md [3]` Match.valueTags for multi-error dispatch -- `services.md [3]` error propagation through service dependencies -- `observability.md [1]` Cause inspection in span middleware -- `surface.md [2]` HttpApiBuilder.group handler wiring.
