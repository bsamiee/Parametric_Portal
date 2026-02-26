# [H1][SERVICE_MODULE_TEMPLATE]
>**Dictum:** *Service modules own one capability surface with strict boundary decode, scoped lifecycle, and policy-driven typed error behavior.*

Use when a module coordinates boundary dependencies behind one service contract.

Placeholders:
- `${Service}`: exported service module object name.
- `${service}`: service tag identifier string.
- `${Dependencies}`: scoped dependency object type owned by the service.
- `${DependenciesAcquire}`: effect that acquires `${Dependencies}`.
- `${DependenciesRelease}`: release function `(deps: ${Dependencies}) => Effect.Effect<void, unknown, never>`.
- `${SendInputSchema}`: strict write-input schema.
- `${ReadInputSchema}`: strict read-input schema.
- `${ReadRowSchema}`: strict read-result row schema.
- `${ObserveInputSchema}`: strict observe-input schema.
- `${EnvelopeSchema}`: strict stream-envelope schema.
- `${SendEffect}`: boundary rail `(deps: ${Dependencies}, input: typeof ${SendInputSchema}.Type) => Effect.Effect<void, unknown, never>`.
- `${ReadEffect}`: boundary rail `(deps: ${Dependencies}, input: typeof ${ReadInputSchema}.Type) => Effect.Effect<ReadonlyArray<unknown>, unknown, never>`.
- `${ObserveEffect}`: stream rail `(deps: ${Dependencies}, input: typeof ${ObserveInputSchema}.Type) => Stream.Stream<unknown, unknown, never>`.
- `${ObserveLossPolicy}`: stream policy `(stream) => stream` (buffer/backpressure/loss strategy).
- `${OperationLiterals}`: bounded operation vocabulary object with required keys `resourceOpen`, `resourceClose`, `send`, `sendDecode`, `sendUpstream`, `sendMany`, `history`, `historyDecode`, `historyUpstream`, `observe`, `observeDecode`, `observeUpstream`.
- `${SpanLiterals}`: bounded dot-path span-name object with required keys `send`, `sendMany`, `history`, `observe`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { retryable; idempotent; timeout }` table.
- `${DecodeReasonLiteral}` / `${UpstreamReasonLiteral}`: reason literals.
- `${TimeoutReasonByOperation}`: mapping for bounded write/read operations only: `Record<(typeof Operation)["send" | "sendMany" | "history"], ${ReasonLiterals}>`.
- `${RetrySchedule}`: schedule expression combined with reason-policy retry gating.
- `${SendConcurrency}`: bounded numeric concurrency for batch writes.
- `${MetricPrefix}`: metric name prefix (snake_case).

Instantiation rules:
- Keep one ownership surface export.
- Acquire owned resources with `Effect.acquireRelease`.
- Decode all unknown ingress with strict options and local parse mapping.
- Drive retry/timeout policy from one reason-policy table; operation-timeout mapping must project reason keys from that table.
- Retryable reasons must be idempotent; mutating non-idempotent rails must remain `retryable: false`.
- Observe rail policy/telemetry apply to stream consumption strategy.
- Core service flow keeps defects as defects; do not launder defects into typed rails.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Duration, Effect, Exit, Match, Metric, MetricLabel, ParseResult, Schema as S, Schedule, Stream, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const Operation = ${OperationLiterals} as const satisfies Record<
    | "resourceOpen"
    | "resourceClose"
    | "send"
    | "sendDecode"
    | "sendUpstream"
    | "sendMany"
    | "history"
    | "historyDecode"
    | "historyUpstream"
    | "observe"
    | "observeDecode"
    | "observeUpstream",
    string
>;
const Span = ${SpanLiterals} as const satisfies Record<"send" | "sendMany" | "history" | "observe", string>;
const ParseStrict = {
    errors:           "all",
    onExcessProperty: "error",
} as const;
const reasonPolicy = ${ReasonPolicy} as const satisfies Record<${ReasonLiterals}, {
    readonly retryable:  boolean;
    readonly idempotent: boolean;
    readonly timeout:    Duration.DurationInput;
}>;
const timeoutReasonByOperation = ${TimeoutReasonByOperation} as const satisfies Record<
    (typeof Operation)["send" | "sendMany" | "history"],
    ${ReasonLiterals}
>;
const telemetry = {
    label:   { operation: "operation", rail: "rail", outcome: "outcome" },
    rail:    { read: "read", observe: "observe", write: "write" },
    log:     { resourceReleaseFailure: "service.resource.release_failure" },
    outcome: { defect: "defect", error: "error", interrupt: "interrupt", ok: "ok" },
} as const;
const calls =    Metric.counter(`${MetricPrefix}_calls_total`);
const outcomes = Metric.counter(`${MetricPrefix}_outcomes_total`);

// --- [ERRORS] ----------------------------------------------------------------

class ${Service}Failure extends Data.TaggedError("${Service}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Service}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Service}Failure), (known) => known),
            Match.when(ParseResult.isParseError, (parseError) =>
                new ${Service}Failure({
                    operation,
                    reason,
                    details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                    cause:   parseError,
                })),
            Match.orElse((unknown) =>
                new ${Service}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const isRetryable = (error: ${Service}Failure) => reasonPolicy[error.reason].retryable && reasonPolicy[error.reason].idempotent;
const outcomeFromCause = (cause: Cause.Cause<unknown>) =>
    Cause.match(cause, {
        onDie:        () => telemetry.outcome.defect,
        onEmpty:      () => telemetry.outcome.error,
        onFail:       () => telemetry.outcome.error,
        onInterrupt:  () => telemetry.outcome.interrupt,
        onParallel:   () => telemetry.outcome.error,
        onSequential: () => telemetry.outcome.error,
    });
const observeOutcome =
    (rail: (typeof telemetry.rail)[keyof typeof telemetry.rail], operation: (typeof Operation)[keyof typeof Operation]) =>
    <A, R>(program: Effect.Effect<A, ${Service}Failure, R>) =>
        program.pipe(
            Effect.onExit((exit) =>
                Exit.match(exit, {
                    onSuccess: () =>
                        Metric.increment(Metric.taggedWithLabels(outcomes, [
                            MetricLabel.make(telemetry.label.operation, operation),
                            MetricLabel.make(telemetry.label.rail, rail),
                            MetricLabel.make(telemetry.label.outcome, telemetry.outcome.ok),
                        ])),
                    onFailure: (cause) =>
                        Metric.increment(Metric.taggedWithLabels(outcomes, [
                            MetricLabel.make(telemetry.label.operation, operation),
                            MetricLabel.make(telemetry.label.rail, rail),
                            MetricLabel.make(telemetry.label.outcome, outcomeFromCause(cause)),
                        ])),
                })),
        );
const withPolicy = <A, R>(
    operation: (typeof Operation)["send" | "sendMany" | "history"],
    program: Effect.Effect<A, ${Service}Failure, R>,
) =>
    program.pipe(
        Effect.retry(pipe(${RetrySchedule}, Schedule.whileInput(isRetryable))),
        Effect.timeoutFail({
            duration: reasonPolicy[timeoutReasonByOperation[operation]].timeout,
            onTimeout: () =>
                new ${Service}Failure({
                    operation,
                    reason: timeoutReasonByOperation[operation],
                    details: "policy.timeout",
                }),
        }),
    );

// --- [SERVICES] --------------------------------------------------------------

class ${Service}Tag extends Effect.Service<${Service}Tag>()("${service}", {
    scoped: Effect.gen(function* () {
        const deps = yield* Effect.acquireRelease(
            (${DependenciesAcquire}).pipe(Effect.mapError(toFailure(Operation.resourceOpen, ${UpstreamReasonLiteral}))),
            (resource) => (${DependenciesRelease})(resource).pipe(
                Effect.tapErrorCause((cause) =>
                    Effect.logWarning(telemetry.log.resourceReleaseFailure, {
                        operation: Operation.resourceClose,
                        cause: Cause.pretty(cause),
                    })),
                Effect.orDie,
            ),
        );
        const sendCore = (raw: unknown) =>
            pipe(
                S.decodeUnknown(${SendInputSchema})(raw, ParseStrict),
                Effect.mapError(toFailure(Operation.sendDecode, ${DecodeReasonLiteral})),
                Effect.flatMap((input) =>
                    (${SendEffect})(deps, input).pipe(Effect.mapError(toFailure(Operation.sendUpstream, ${UpstreamReasonLiteral})),)),
            );
        const send = Effect.fn(Span.send)(
            (raw: unknown) =>
                pipe(
                    Metric.increment(Metric.tagged(calls, telemetry.label.operation, Operation.send)),
                    Effect.zipRight(sendCore(raw)),
                    observeOutcome(telemetry.rail.write, Operation.send),
                ),
            (program) => withPolicy(Operation.send, program),
        );
        const sendMany = Effect.fn(Span.sendMany)(
            (values: ReadonlyArray<unknown>) =>
                pipe(
                    Metric.increment(Metric.tagged(calls, telemetry.label.operation, Operation.sendMany)),
                    Effect.zipRight(Effect.forEach(values, sendCore, { concurrency: ${SendConcurrency} })),
                    observeOutcome(telemetry.rail.write, Operation.sendMany),
                ),
            (program) => withPolicy(Operation.sendMany, program),
        );
        const history = Effect.fn(Span.history)(
            (raw: unknown) =>
                pipe(
                    Metric.increment(Metric.tagged(calls, telemetry.label.operation, Operation.history)),
                    Effect.zipRight(
                        pipe(
                            S.decodeUnknown(${ReadInputSchema})(raw, ParseStrict),
                            Effect.mapError(toFailure(Operation.historyDecode, ${DecodeReasonLiteral})),
                            Effect.flatMap((input) =>
                                (${ReadEffect})(deps, input).pipe(
                                    Effect.mapError(toFailure(Operation.historyUpstream, ${UpstreamReasonLiteral})),
                                )),
                            Effect.flatMap((rows) =>
                                S.decodeUnknown(S.Array(${ReadRowSchema}))(rows, ParseStrict).pipe(
                                    Effect.mapError(toFailure(Operation.historyDecode, ${DecodeReasonLiteral})),
                                )),
                        ),
                    ),
                    observeOutcome(telemetry.rail.read, Operation.history),
                ),
            (program) => withPolicy(Operation.history, program),
        );
        const observe = Effect.fn(Span.observe)((raw: unknown) =>
            pipe(
                Metric.increment(Metric.tagged(calls, telemetry.label.operation, Operation.observe)),
                Effect.zipRight(
                    pipe(
                        S.decodeUnknown(${ObserveInputSchema})(raw, ParseStrict),
                        Effect.mapError(toFailure(Operation.observeDecode, ${DecodeReasonLiteral})),
                        Effect.map((input) =>
                            (${ObserveLossPolicy})(
                                (${ObserveEffect})(deps, input).pipe(
                                    Stream.mapError(toFailure(Operation.observeUpstream, ${UpstreamReasonLiteral})),
                                    Stream.mapEffect((rawEnvelope) =>
                                        S.decodeUnknown(${EnvelopeSchema})(rawEnvelope, ParseStrict).pipe(
                                            Effect.mapError(toFailure(Operation.observeDecode, ${DecodeReasonLiteral})),
                                        )),
                                    Stream.onDone(() =>
                                        Metric.increment(Metric.taggedWithLabels(outcomes, [
                                            MetricLabel.make(telemetry.label.operation, Operation.observe),
                                            MetricLabel.make(telemetry.label.rail, telemetry.rail.observe),
                                            MetricLabel.make(telemetry.label.outcome, telemetry.outcome.ok),
                                        ]))),
                                    Stream.onError((cause) =>
                                        Metric.increment(Metric.taggedWithLabels(outcomes, [
                                            MetricLabel.make(telemetry.label.operation, Operation.observe),
                                            MetricLabel.make(telemetry.label.rail, telemetry.rail.observe),
                                            MetricLabel.make(telemetry.label.outcome, outcomeFromCause(cause)),
                                        ]))),
                                ),
                            )),
                    ),
                ),
                Effect.tapErrorCause((cause) =>
                    Metric.increment(Metric.taggedWithLabels(outcomes, [
                        MetricLabel.make(telemetry.label.operation, Operation.observe),
                        MetricLabel.make(telemetry.label.rail, telemetry.rail.observe),
                        MetricLabel.make(telemetry.label.outcome, outcomeFromCause(cause)),
                    ]))),
            ));
        return {
            write:   { send, sendMany } as const,
            read:    { history } as const,
            observe: { observe } as const,
        };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

const ${Service} = {
    Tag: ${Service}Tag,
    Live: ${Service}Tag.Default,
    Failure: ${Service}Failure,
    reasonPolicy,
    isRetryable,
} as const;

export { ${Service} };
```
