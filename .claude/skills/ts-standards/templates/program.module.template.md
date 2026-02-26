# [H1][PROGRAM_MODULE_TEMPLATE]
>**Dictum:** *Program modules own orchestration rails: one ingress decode, one use-case graph, one policy-bounded typed failure surface.*

Use when composing capabilities/services into one use-case entrypoint.

Placeholders:
- `${Program}`: exported program object name.
- `${InputSchema}`: ingress schema for unknown input.
- `${OutputSchema}`: canonical success output schema.
- `${ProgramUpstreamError}`: upstream typed error expression produced by `${UseCaseEffect}`.
- `${OperationLiterals}`: bounded operation vocabulary object with required keys `decodeInput`, `run`, `runUpstream`, `decodeOutput`.
- `${SpanLiterals}`: bounded dot-path span-name object with required key `run`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { retryable; idempotent }` table (+ timeout for timeout reason).
- `${DecodeInputReasonLiteral}` / `${DecodeOutputReasonLiteral}` / `${UpstreamReasonLiteral}` / `${TimeoutReasonLiteral}`: reason literals.
- `${RetrySchedule}`: schedule expression combined with reason-policy retry gating.
- `${UseCaseEffect}`: orchestration effect `(input: typeof Input.Type) => Effect.Effect<unknown, ${ProgramUpstreamError}, R>`.
- `${MapUpstreamError}`: mapper `(error: ${ProgramUpstreamError}) => unknown` (cause/details payload only; final `${Program}Failure` construction stays in-template).

Instantiation rules:
- Keep one public entrypoint (`run`) for one concern.
- Decode unknown ingress once and validate output once.
- Retry only for idempotent reasons; non-idempotent reasons must be `retryable: false`.
- Core program flow keeps defects as defects; do not launder defects into typed rails.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Duration, Effect, Match, ParseResult, Schema as S, Schedule, pipe } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const Input =  ${InputSchema};
const Output = ${OutputSchema};

// --- [CONSTANTS] -------------------------------------------------------------

const Operation = ${OperationLiterals} as const satisfies Record<"decodeInput" | "run" | "runUpstream" | "decodeOutput", string>;
const Span =      ${SpanLiterals} as const satisfies Record<"run", string>;
const ParseStrict = {
    errors:           "all",
    onExcessProperty: "error",
} as const;
const reasonPolicy = ${ReasonPolicy} as const satisfies
    Record<Exclude<${ReasonLiterals}, ${DecodeInputReasonLiteral} | ${DecodeOutputReasonLiteral} | ${TimeoutReasonLiteral}>, {
        readonly retryable:  boolean;
        readonly idempotent: boolean;
    }> &
    Record<${DecodeInputReasonLiteral} | ${DecodeOutputReasonLiteral}, {
        readonly retryable:  false;
        readonly idempotent: false;
    }> &
    Record<${TimeoutReasonLiteral}, {
        readonly retryable:  false;
        readonly idempotent: false;
        readonly timeout:    Duration.DurationInput;
    }>;

// --- [ERRORS] ----------------------------------------------------------------

class ${Program}Failure extends Data.TaggedError("${Program}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Program}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Program}Failure), (known) => known),
            Match.when(ParseResult.isParseError, (parseError) =>
                new ${Program}Failure({
                    operation,
                    reason,
                    details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                    cause:   parseError,
                })),
            Match.orElse((unknown) =>
                new ${Program}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const isRetryable = (error: ${Program}Failure) => reasonPolicy[error.reason].retryable && reasonPolicy[error.reason].idempotent;
const withPolicy = <A, R>(program: Effect.Effect<A, ${Program}Failure, R>) =>
    program.pipe(
        Effect.retry(pipe(${RetrySchedule}, Schedule.whileInput(isRetryable))),
        Effect.timeoutFail({
            duration: reasonPolicy[${TimeoutReasonLiteral}].timeout,
            onTimeout: () =>
                new ${Program}Failure({
                    operation: Operation.run,
                    reason:    ${TimeoutReasonLiteral},
                    details:   "policy.timeout",
                }),
        }),
    );
const run = Effect.fn(Span.run)(
    (raw: unknown) =>
        pipe(
            S.decodeUnknown(Input)(raw, ParseStrict),
            Effect.mapError(toFailure(Operation.decodeInput, ${DecodeInputReasonLiteral})),
            Effect.flatMap((input) =>
                (${UseCaseEffect})(input).pipe(
                    Effect.mapError((error) =>
                        pipe(
                            (${MapUpstreamError})(error),
                            toFailure(Operation.runUpstream, ${UpstreamReasonLiteral}),
                        )),
                )),
            Effect.flatMap((result) =>
                S.decodeUnknown(Output)(result, ParseStrict).pipe(
                    Effect.mapError(toFailure(Operation.decodeOutput, ${DecodeOutputReasonLiteral})),
                )),
        ),
    withPolicy,
);

// --- [EXPORT] ----------------------------------------------------------------

const ${Program} = {
    Failure: ${Program}Failure,
    reasonPolicy,
    isRetryable,
    run,
} as const;

export { ${Program} };
```
