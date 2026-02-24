# [H1][MATCHING]
>**Dictum:** *Exhaustive dispatch from data shape -- no imperative branching.*

All dispatch is structural and exhaustive. `Data.taggedEnum` + `$match`/`$is` for closed algebraic
unions. `Match.type`/`Match.value`/`Match.valueTags`/`Match.typeTags` for Effect-returning pipelines
and boundary collapse. `Match.instanceOf` for class-based narrowing. `Option.match` / `Either.match`
for functor-level presence/bifurcation. Zero `if` / `switch` / `else` / bare `instanceof`.
Assumes `import { Data, Effect, Either, Match, Option, pipe, flow, identity } from "effect"`
and `import { Schema as S } from "effect"` where schema types appear.

---
## [1][DATA_TAGGED_ENUM]
>**Dictum:** *Data.taggedEnum declares closed unions; $match dispatches exhaustively; $is narrows.*

`Data.taggedEnum` creates a companion with variant constructors, `$match` (exhaustive inline
dispatch), and `$is` (narrowing predicate factory). Generic variants extend
`Data.TaggedEnum.WithGenerics<N>` -- `$match` inherits type parameters without re-annotation.

```typescript
// --- [TYPES] -----------------------------------------------------------------
type AsyncState<A, E> = Data.TaggedEnum<{
    Idle:    {};
    Loading: { readonly startedAt: number };
    Success: { readonly data: A; readonly timestamp: number };
    Failure: { readonly error: E; readonly timestamp: number };
}>;
interface AsyncStateDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: AsyncState<this["A"], this["B"]>;
}
// --- [INTERNAL] --------------------------------------------------------------
const { $is, $match, Failure, Idle, Loading, Success } = Data.taggedEnum<AsyncStateDef>();
// --- [$MATCH -- DATA-FIRST AND CURRIED] --------------------------------------
const render = <A, E>(state: AsyncState<A, E>): string =>
    $match(state, {
        Idle:    ()              => "idle",
        Loading: ({ startedAt }) => `loading since ${startedAt}`,
        Success: ({ data })      => `ok: ${JSON.stringify(data)}`,
        Failure: ({ error })     => `err: ${String(error)}`,
    });
const logState = $match({
    Idle:    ()              => Effect.logDebug("idle"),
    Loading: ({ startedAt }) => Effect.logInfo(`loading since ${startedAt}`),
    Success: ({ data })      => Effect.logInfo(`resolved: ${JSON.stringify(data)}`),
    Failure: ({ error })     => Effect.logError(`failed: ${String(error)}`),
});
// --- [$IS -- NARROWING + FILTER_OR_FAIL] -------------------------------------
const settled = <A, E>(states: ReadonlyArray<AsyncState<A, E>>) =>
    states.filter($is("Success"));
const requireSuccess = <A, E>(state: AsyncState<A, E>, onFail: () => E) =>
    pipe(Effect.succeed(state), Effect.filterOrFail($is("Success"), onFail));
```

---
## [2][MATCH_PIPELINE]
>**Dictum:** *Match.type + Match.value + Match.tag/when/whenOr/whenAnd/not for pipeline dispatch.*

`Match.type<T>()` opens a typed pipeline builder (curried). `Match.value(v)` opens a value
pipeline (immediate). `Match.tag` matches `_tag` variants (variadic). `Match.when` adds
predicate/pattern cases. `Match.whenOr` collapses OR patterns. `Match.whenAnd` requires ALL
patterns. `Match.not` inverts. `Match.exhaustive` finalizes closed unions; `Match.orElse` for
open-set. `Match.withReturnType<R>()` constrains return type -- **must be first in pipeline**
before any `Match.when`/`Match.tag`.

```typescript
// --- [MATCH.TYPE + MATCH.TAG -- EFFECT BRANCHES] -----------------------------
const _Command = S.Union(
    S.Struct({ _tag: S.Literal("provision"), name: S.NonEmptyTrimmedString }),
    S.Struct({ _tag: S.Literal("suspend"),   tenantId: S.UUID }),
    S.Struct({ _tag: S.Literal("resume"),    tenantId: S.UUID }),
    S.Struct({ _tag: S.Literal("archive"),   tenantId: S.UUID }),
);
const transition = Effect.fn("Lifecycle.transition")(
    (command: typeof _Command.Type) =>
        Match.type<typeof _Command.Type>().pipe(
            Match.tag("provision", ({ name }) => pipe(
                Effect.logInfo(`provisioning: ${name}`),
                Effect.andThen(Effect.succeed({ created: true as const })),
            )),
            Match.tag("suspend", "archive", ({ tenantId }) => pipe(
                Effect.logWarning(`deactivating: ${tenantId}`),
                Effect.andThen(Effect.succeed({ deactivated: true as const })),
            )),
            Match.tag("resume", ({ tenantId }) =>
                Effect.succeed({ resumed: true as const, tenantId }),
            ),
            Match.exhaustive,
        )(command),
);
// --- [MATCH.VALUE + WHEN/WHENOR/NOT -- STRUCTURAL] ---------------------------
type Request = {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    readonly path:   string;
    readonly cached?: boolean;
};
const routeRequest = (request: Request): Effect.Effect<string> =>
    Match.value(request).pipe(
        Match.when({ method: "GET", path: "/healthz" }, () => Effect.succeed("health")),
        Match.when({ method: "GET", cached: true },     () => Effect.succeed("cached_read")),
        Match.when({ method: "GET" },                   () => Effect.succeed("fresh_read")),
        Match.whenOr({ method: "POST" }, { method: "PUT" }, () => Effect.succeed("write")),
        Match.when({ method: "DELETE" },                 () => Effect.succeed("delete")),
        Match.orElse(() => Effect.succeed("fallback")),
    );
// --- [MATCH.WHEN PREDICATE + MATCH.NOT] --------------------------------------
type Priority = { readonly level: number; readonly retryable: boolean };
const escalate: (priority: Priority) => Effect.Effect<string> =
    Match.type<Priority>().pipe(
        Match.when({ level: (n) => n >= 9, retryable: false }, () =>
            Effect.fail(new Error("critical non-retryable"))),
        Match.when({ level: (n) => n >= 7 }, ({ level }) =>
            Effect.succeed(`escalate:${level}`)),
        Match.orElse(({ level }) => Effect.succeed(`queue:${level}`)),
    );
const isLarge = (payload: { readonly size: number }): boolean =>
    Match.value(payload).pipe(
        Match.not({ size: (n) => n < 1024 }, () => true),
        Match.orElse(() => false),
    );
// --- [MATCH.WITHRETURNTYPE -- ENFORCE RETURN TYPE] ---------------------------
// why: withReturnType constrains all branch return types to Effect<string>
//      -- MUST be first in pipeline before any Match.when/Match.tag
type Signal = { readonly _tag: "start" | "stop" | "pause" };
const describeSignal: (signal: Signal) => Effect.Effect<string> =
    Match.type<Signal>().pipe(
        Match.withReturnType<Effect.Effect<string>>(),
        Match.tag("start", () => Effect.succeed("starting")),
        Match.tag("stop",  () => Effect.succeed("stopping")),
        Match.tag("pause", () => Effect.succeed("pausing")),
        Match.exhaustive,
    );
```

---
## [3][VALUETAGS_AND_TYPETAGS]
>**Dictum:** *Match.valueTags for direct tag-to-handler dispatch; Match.typeTags for curried type-level.*

`Match.valueTags(input, { Tag: handler })` dispatches in one call -- no pipeline, no finalizer.
Curried `Match.valueTags({ ... })` returns `(input) => R`. `Match.typeTags<Union>()({ ... })`
produces a curried dispatcher from a type parameter (no value needed at definition). Pre-built
dispatch objects scale to large unions (websocket pattern).

```typescript
// --- [VALUETAGS -- INLINE + CURRIED] -----------------------------------------
// why: declare class stubs -- full S.TaggedError definitions in errors.md [2]
declare class NotFound   { readonly _tag: "NotFound";   readonly resource: string; readonly id: string }
declare class Conflict   { readonly _tag: "Conflict";   readonly id: string }
declare class Validation { readonly _tag: "Validation";  readonly field: string; readonly message: string }
declare class RateLimit  { readonly _tag: "RateLimit";   readonly retryAfterMs: number }
type ApiError = NotFound | Conflict | Validation | RateLimit;
const toHttpStatus = (error: ApiError): number =>
    Match.valueTags(error, {
        NotFound: () => 404, Conflict: () => 409,
        Validation: () => 422, RateLimit: () => 429,
    });
const toErrorBody: (error: ApiError) => { status: number; message: string } =
    Match.valueTags({
        NotFound:   ({ resource, id }) => ({ status: 404, message: `${resource} ${id} not found` }),
        Conflict:   ({ id })           => ({ status: 409, message: `conflict on ${id}` }),
        Validation: ({ field, message }) => ({ status: 422, message: `${field}: ${message}` }),
        RateLimit:  ({ retryAfterMs }) => ({ status: 429, message: `retry after ${retryAfterMs}ms` }),
    });
// --- [VALUETAGS -- DISPATCH OBJECT (WEBSOCKET PATTERN)] ----------------------
type InboundMsg = { _tag: "join"; roomId: string }
    | { _tag: "leave"; roomId: string }
    | { _tag: "send"; data: unknown };
const _dispatch = {
    join:  ({ roomId }) => Effect.logInfo(`join:${roomId}`),
    leave: ({ roomId }) => Effect.logInfo(`leave:${roomId}`),
    send:  ({ data })   => Effect.logInfo(`send:${JSON.stringify(data)}`),
} as const;
const handle = (message: InboundMsg): Effect.Effect<void> => Match.valueTags(message, _dispatch);
// --- [TYPETAGS -- TYPE-LEVEL CURRIED DISPATCHER] -----------------------------
const handleApiError = Match.typeTags<ApiError>()({
    NotFound:   ({ resource }) => `missing: ${resource}`,
    Conflict:   ({ id })       => `conflict: ${id}`,
    Validation: ({ field })    => `invalid: ${field}`,
    RateLimit:  ()             => "rate limited",
});
```

---
## [4][INSTANCEOF_AND_REFINEMENTS]
>**Dictum:** *Match.instanceOf for class-based narrowing at boundaries; Match.string/number/boolean for primitive refinement in pipelines.*

`Match.when(Match.instanceOf(X), handler)` narrows to class instance -- primary pattern for cause
normalization at boundaries. `Match.string`, `Match.number`, `Match.boolean` are built-in
refinement predicates for primitive type guards inside `Match.when`. `flow(Match.value, ...)`
composes a point-free error normalizer for `Effect.mapError`.

```typescript
// --- [MATCH.INSTANCEOF -- INLINE CAUSE NORMALIZATION] ------------------------
// why: typed errors pass through; unknown causes wrap with operation context
declare class EmailError extends Data.TaggedError("EmailError")<{
    readonly operation: string; readonly reason: string; readonly cause?: unknown;
}> {
    static readonly from: (reason: string, provider: string, context?: {
        readonly cause?: unknown; readonly statusCode?: number;
    }) => EmailError;
}
declare class HttpResponseError { readonly response: { readonly status: number } }
const sendSafe = (provider: string, payload: unknown) =>
    sendEmail(provider, payload).pipe(
        Effect.mapError((error) =>
            Match.value(error).pipe(
                Match.when(Match.instanceOf(EmailError), identity),
                Match.when(Match.instanceOf(HttpResponseError), (response) =>
                    EmailError.from("ProviderError", provider, {
                        cause: response, statusCode: response.response.status,
                    })),
                Match.orElse((cause) => EmailError.from("ProviderError", provider, { cause })),
            ),
        ),
    );
// --- [FLOW + MATCH -- POINT-FREE ERROR NORMALIZER] --------------------------
// why: point-free composition for Effect.mapError -- no intermediate lambda;
//      Match.value is generic; flow() infers type from call site (Effect.mapError infers E)
declare class AuthError extends Data.TaggedError("AuthError")<{
    readonly operation: string; readonly reason: string; readonly cause?: unknown;
}> {
    static readonly from: (reason: string, context?: Record<string, unknown>) => AuthError;
}
const _normalizeAuth = flow(
    Match.value,
    Match.when(Match.instanceOf(AuthError), identity),
    Match.orElse((cause) => AuthError.from("internal", { cause })),
);
const secured = (userId: string) =>
    fetchProfile(userId).pipe(Effect.mapError(_normalizeAuth));
// --- [MATCH.STRING / MATCH.NUMBER -- BUILT-IN REFINEMENTS] -------------------
// why: built-in refinement predicates narrow primitive types without manual type guards
type MixedInput = string | number | boolean | null;
const classify = (input: MixedInput): string =>
    Match.value(input).pipe(
        Match.when(Match.string, (value) => `text:${value}`),
        Match.when(Match.number, (value) => `num:${value}`),
        Match.when(Match.boolean, (value) => `bool:${value}`),
        Match.orElse(() => "null"),
    );
// why: Match.string in production -- dispatch on heterogeneous config shapes
type RetryConfig = false | string | { readonly attempts: number; readonly delay: string };
const resolveSchedule = (config: RetryConfig) =>
    Match.value(config).pipe(
        Match.when(false, () => undefined),
        Match.when(Match.string, (preset) => lookupPreset(preset)),
        Match.orElse((custom) => custom),
    );
```

---
## [5][OPTION_EITHER_MATCH]
>**Dictum:** *Option.match for typed absence; Either.match for typed bifurcation.*

`Option.match({ onNone, onSome })` handles presence/absence exhaustively. `Either.match({
onLeft, onRight })` handles bifurcated outcomes. `Effect.filterOrFail` propagates absent case
as typed failure.

```typescript
// --- [OPTION.MATCH + EFFECT] -------------------------------------------------
const resolveUser = (
    lookup: (id: string) => Option.Option<{ name: string; role: string }>
) => (id: string): Effect.Effect<string> =>
    pipe(lookup(id), Option.match({
        onNone: () => Effect.succeed("anonymous"),
        onSome: ({ name, role }) => pipe(
            Effect.logDebug(`resolved ${name}`),
            Effect.as(`${name}:${role}`),
        ),
    }));
// --- [FILTER_OR_FAIL -- ABSENT -> TYPED FAILURE] -----------------------------
declare class UserNotFound extends Data.TaggedError("UserNotFound")<{
    readonly id: string;
}>;
const requireUser = (maybeUser: Option.Option<{ id: string; email: string }>, id: string) =>
    pipe(
        Effect.succeed(maybeUser),
        Effect.flatMap(Option.match({
            onNone: () => Effect.fail(new UserNotFound({ id })),
            onSome: Effect.succeed,
        })),
    );
// --- [EITHER.MATCH AT BOUNDARY] ---------------------------------------------
const parseBody = (raw: string): Either.Either<unknown, string> =>
    Either.try({ try: () => JSON.parse(raw), catch: (error) => `parse error: ${String(error)}` });
const ingestPayload = (raw: string): Effect.Effect<{ ok: true; data: unknown }> =>
    pipe(parseBody(raw), Either.match({
        onLeft:  (error) => pipe(
            Effect.logWarning(`rejected: ${error}`),
            Effect.as({ ok: true as const, data: null }),
        ),
        onRight: (data) => Effect.succeed({ ok: true as const, data }),
    }));
```

---
## [6][RULES]
>**Dictum:** *Rules are constraints.*

- [ALWAYS] `Data.taggedEnum` + `$match` for closed enum dispatch -- inline, exhaustive, generic-aware.
- [ALWAYS] `Data.TaggedEnum.WithGenerics<N>` for parameterized enums; `$match` inherits type params.
- [ALWAYS] `Match.valueTags` for `S.TaggedError` / `S.TaggedClass` / `Data.TaggedError` boundary unions.
- [ALWAYS] `Match.typeTags<T>()({...})` for curried type-level dispatch without a value.
- [ALWAYS] `Match.type<T>().pipe(Match.tag(...), Match.exhaustive)` when branches return Effects.
- [ALWAYS] `Match.value(input).pipe(Match.when(...))` for structural dispatch without `_tag`.
- [ALWAYS] `Match.withReturnType<R>()` as **first** pipeline step -- before any `Match.when`/`Match.tag`.
- [ALWAYS] `Match.when(Match.instanceOf(X), handler)` for class-based narrowing -- primary pattern for cause normalization at boundaries.
- [ALWAYS] `Match.string` / `Match.number` / `Match.boolean` for primitive type refinement in `Match.when`.
- [ALWAYS] `flow(Match.value, Match.when(...), Match.orElse(...))` for point-free error normalizers passed to `Effect.mapError`.
- [ALWAYS] `Option.match({ onNone, onSome })` for absence -- never `?.`, `=== undefined`, bare guards.
- [ALWAYS] `Either.match({ onLeft, onRight })` for bifurcated outcomes at boundaries.
- [ALWAYS] `Effect.filterOrFail` when absent/error should propagate as typed domain failure.
- [ALWAYS] `Match.whenOr(p1, p2, handler)` to collapse multiple patterns sharing one handler.
- [ALWAYS] Pre-built dispatch objects for large `Match.valueTags` unions (websocket pattern).
- [NEVER] `if` / `else if` / `switch` / ternary chains / bare `instanceof` -- use match combinators and `Match.instanceOf`.
- [NEVER] Nested `if` inside match handlers -- flatten into additional `Match.when` branches.
- [NEVER] `Match.orElse` to suppress exhaustiveness -- fix missing variants.
- [NEVER] `throw` from handlers -- return `Effect.fail` for failures, `Effect.succeed` for values.
- [NEVER] `any` cast to bypass exhaustiveness check.
- [NEVER] `Match.type` when `$match` suffices -- prefer the tighter API.

---
## [7][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                       | [INPUT]                   | [EXHAUST] | [BEST_FOR]                   |
| :-----: | ------------------------------- | ------------------------- | :-------: | ---------------------------- |
|   [1]   | `Enum.$match(v, {})`            | `Data.taggedEnum`         |    Yes    | Inline pure/Effect dispatch  |
|   [2]   | `Enum.$match({})`               | Curried `(v) => R`        |    Yes    | Reusable dispatch function   |
|   [3]   | `Enum.$is("Tag")`               | `Data.taggedEnum`         |    No     | Narrowing predicate, filters |
|   [4]   | `Match.valueTags(v, {})`        | Any `_tag`-discriminated  |    Yes    | Boundary error/class unions  |
|   [5]   | `Match.valueTags({})`           | Curried `(v) => R`        |    Yes    | Reusable boundary dispatcher |
|   [6]   | `Match.typeTags<T>()({})`       | Type-level curried        |    Yes    | Constrained return type      |
|   [7]   | `Match.type<T>().pipe(...)`     | Any type, Effect branches |    Yes    | Multi-step Effect-returning  |
|   [8]   | `Match.tag("T", handler)`       | In `Match.type` pipeline  |    --     | `_tag` variant handler       |
|   [9]   | `Match.value(v).pipe(...)`      | Concrete value            |    Opt    | Structural shape routing     |
|  [10]   | `Match.when(pat, fn)`           | In any pipeline           |    --     | Partial object / predicate   |
|  [11]   | `Match.whenOr(p1, p2, fn)`      | In any pipeline           |    --     | Multi-pattern OR logic       |
|  [12]   | `Match.whenAnd(p1, p2, fn)`     | In any pipeline           |    --     | Multi-pattern AND logic      |
|  [13]   | `Match.not(pat, fn)`            | In any pipeline           |    --     | Inverted pattern             |
|  [14]   | `Match.instanceOf(Class)`       | In `Match.when` pipeline  |    --     | Class instance narrowing     |
|  [15]   | `Match.string/number/boolean`   | In `Match.when` pipeline  |    --     | Primitive type guard         |
|  [16]   | `Match.exhaustive`              | Pipeline finalizer        |    Yes    | Closed-set compiler-enforced |
|  [17]   | `Match.orElse(fn)`              | Pipeline finalizer        |    No     | Open-set fallback            |
|  [18]   | `Match.option` / `Match.either` | Pipeline finalizer        |    No     | Wrap result in Option/Either |
|  [19]   | `Match.withReturnType<R>()`     | Pipeline constraint       |    --     | Enforce return type (first)  |
|  [20]   | `flow(Match.value, ...)`        | Point-free normalizer     |    No     | Composable with mapError     |
|  [21]   | `Option.match({...})`           | `Option<A>`               |    Yes    | Absence handling             |
|  [22]   | `Either.match({...})`           | `Either<A, E>`            |    Yes    | Success/failure bifurcation  |
|  [23]   | `Effect.filterOrFail`           | `Option` / predicate      |    --     | Absent -> typed failure      |

Cross-references: errors.md [1] (`Data.TaggedError` + `from()` pattern) -- errors.md [2]
(`S.TaggedError` boundary definitions) -- effects.md [2] (`flow` composition) --
types.md [2] (union derivation via `Data.taggedEnum`) -- services.md [5] (command dispatch).
