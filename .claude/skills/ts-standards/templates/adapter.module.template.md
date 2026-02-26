# [H1][ADAPTER_MODULE_TEMPLATE]
>**Dictum:** *Adapter modules translate boundaries only: strict decode, delegated execution, deterministic transport projection.*

Use when integrating transport edges (HTTP/RPC/queue/CLI) with domain programs/services.

Placeholders:
- `${Adapter}`: exported adapter object name.
- `${RequestSchema}`: strict ingress schema.
- `${SuccessSchema}`: strict success payload schema.
- `${TransportSuccess}`: success transport projection type expression.
- `${TransportFailure}`: failure transport projection type expression.
- `${DelegateError}`: delegated domain error expression.
- `${OperationLiterals}`: bounded operation vocabulary object with required keys `decodeRequest`, `delegate`, `decodeSuccess`, `handle`.
- `${SpanLiterals}`: bounded dot-path span-name object with required key `handle`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { retryable; status; code; priority }` table.
- `${DecodeRequestReasonLiteral}` / `${DecodeSuccessReasonLiteral}` / `${UnknownReasonLiteral}`: reason literals.
- `${MapDelegateError}`: mapper `(error: ${DelegateError}) => { readonly reason: ${ReasonLiterals}; readonly cause?: unknown; readonly details?: string }`.
- `${DelegateEffect}`: delegated domain call `(request: typeof Request.Type) => Effect.Effect<unknown, ${DelegateError}, R>`.
- `${ProjectSuccess}`: projector `(payload: typeof Success.Type) => ${TransportSuccess}`.
- `${ProjectFailure}`: projector `(failure: ${Adapter}Failure, policy: { readonly retryable: boolean; readonly status: number; readonly code: string; readonly priority: number }) => ${TransportFailure}`.

Instantiation rules:
- Decode unknown input once at the edge.
- Keep adapters domain-thin: delegate business rules to services/programs.
- Collapse `Cause` to value-level failure only at adapter boundary.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Effect, Match, ParseResult, Schema as S, pipe } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const Request = ${RequestSchema};
const Success = ${SuccessSchema};

// --- [CONSTANTS] -------------------------------------------------------------

const Operation = ${OperationLiterals} as const satisfies Record<"decodeRequest" | "delegate" | "decodeSuccess" | "handle", string>;
const Span =      ${SpanLiterals} as const satisfies Record<"handle", string>;
const ParseStrict = {
    errors:           "all",
    onExcessProperty: "error",
} as const;
const reasonPolicy = ${ReasonPolicy} as const satisfies Record<${ReasonLiterals}, {
    readonly retryable: boolean;
    readonly status:    number;
    readonly code:      string;
    readonly priority:  number;
}>;

// --- [ERRORS] ----------------------------------------------------------------

class ${Adapter}Failure extends Data.TaggedError("${Adapter}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Adapter}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Adapter}Failure), (known) => known),
            Match.when(ParseResult.isParseError, (parseError) =>
                new ${Adapter}Failure({
                    operation,
                    reason,
                    details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                    cause: parseError,
                })),
            Match.orElse((unknown) =>
                new ${Adapter}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const chooseDominantFailure = (left: ${Adapter}Failure, right: ${Adapter}Failure) =>
    Match.value({ left: reasonPolicy[left.reason], right: reasonPolicy[right.reason] }).pipe(
        Match.when(({ left: l, right: r }) => l.priority > r.priority, () => left),
        Match.when(({ left: l, right: r }) => l.priority < r.priority, () => right),
        Match.when(({ left: l, right: r }) => l.status > r.status, () => left),
        Match.when(({ left: l, right: r }) => l.status < r.status, () => right),
        Match.when(({ left: l, right: r }) => l.code >= r.code, () => left),
        Match.orElse(() => right),
    );
const collapseCause = (cause: Cause.Cause<unknown>): ${Adapter}Failure =>
    Cause.match(cause, {
        onFail: (failure) =>
            Match.value(failure).pipe(
                Match.when(Match.instanceOf(${Adapter}Failure), (known) => known),
                Match.orElse((unknown) => toFailure(Operation.handle, ${UnknownReasonLiteral})(unknown)),
            ),
        onDie:        (defect) => toFailure(Operation.handle,  ${UnknownReasonLiteral})(defect),
        onInterrupt:  (fiberId) => toFailure(Operation.handle, ${UnknownReasonLiteral})(fiberId),
        onEmpty:      () => toFailure(Operation.handle,        ${UnknownReasonLiteral})("cause.empty"),
        onSequential: (left, right) => chooseDominantFailure(collapseCause(left), collapseCause(right)),
        onParallel:   (left, right) => chooseDominantFailure(collapseCause(left), collapseCause(right)),
    });
const handle = Effect.fn(Span.handle)((rawRequest: unknown) =>
    pipe(
        S.decodeUnknown(Request)(rawRequest, ParseStrict),
        Effect.mapError(toFailure(Operation.decodeRequest, ${DecodeRequestReasonLiteral})),
        Effect.flatMap((request) =>
            (${DelegateEffect})(request).pipe(
                Effect.mapError((error) =>
                    pipe(
                        (${MapDelegateError})(error),
                        (mapped) =>
                            new ${Adapter}Failure({
                                operation: Operation.delegate,
                                reason:    mapped.reason,
                                details:   mapped.details,
                                cause:     mapped.cause ?? error,
                            }),
                    )),
            )),
        Effect.flatMap((raw) =>
            S.decodeUnknown(Success)(raw, ParseStrict).pipe(
                Effect.mapError(toFailure(Operation.decodeSuccess, ${DecodeSuccessReasonLiteral})),
            )),
        Effect.sandbox,
        Effect.matchCause({
            onFailure: (cause) =>
                pipe(
                    collapseCause(cause),
                    (failure) => (${ProjectFailure})(failure, reasonPolicy[failure.reason]),
                ),
            onSuccess: (payload) => (${ProjectSuccess})(payload),
        }),
    ));

// --- [EXPORT] ----------------------------------------------------------------

const ${Adapter} = {
    Failure: ${Adapter}Failure,
    reasonPolicy,
    handle,
} as const;

export { ${Adapter} };
```
