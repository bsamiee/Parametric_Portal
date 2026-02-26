# [H1][RUNTIME_MODULE_TEMPLATE]
>**Dictum:** *Runtime modules compose once at the root: one layer graph and one lifecycle run bridge.*

Use when building composition roots (`main`, worker bootstrap, scheduled runner entrypoint).

Placeholders:
- `${Runtime}`: exported runtime object name.
- `${RuntimeLayer}`: root `Layer` expression merged from feature layers.
- `${ProgramEffect}`: main program effect to run.
- `${ProgramReasonFromError}`: mapper `(error: Effect.Effect.Error<typeof ${ProgramEffect}>) => ${ReasonLiterals}`.
- `${ObserveRun}`: observability wrapper `(operation: (typeof Operation)[keyof typeof Operation], span: (typeof Span)[keyof typeof Span], program) => program`.
- `${ApplyRuntimeBridge}`: lifecycle bridge `(program) => program` for launch-only concerns (supervision/shutdown/platform flags).
- `${OperationLiterals}`: bounded operation vocabulary object with required key `run`.
- `${SpanLiterals}`: bounded dot-path span-name object with required key `run`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { exitCode }` table.

Instantiation rules:
- Compose roots once; feature modules never own root `provide` composition.
- Runtime bridge owns lifecycle wiring only; retry/timeout remain in program/service rails.
- Core runtime flow keeps defects as defects; do not launder defects into typed rails.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Effect, Match, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const Operation =    ${OperationLiterals} as const satisfies Record<"run", string>;
const Span =         ${SpanLiterals} as const satisfies Record<"run", string>;
const reasonPolicy = ${ReasonPolicy} as const satisfies Record<${ReasonLiterals}, {
    readonly exitCode: number;
}>;

// --- [ERRORS] ----------------------------------------------------------------

class ${Runtime}Failure extends Data.TaggedError("${Runtime}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Runtime}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Runtime}Failure), (known) => known),
            Match.orElse((unknown) =>
                new ${Runtime}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const toExitCode = (error: ${Runtime}Failure) => reasonPolicy[error.reason].exitCode;
const run = Effect.fn(Span.run)(
    () =>
        pipe(
            ${ProgramEffect},
            Effect.provide(${RuntimeLayer}),
            Effect.mapError((error) => toFailure(Operation.run, (${ProgramReasonFromError})(error))(error),),
            (program) => (${ObserveRun})(Operation.run, Span.run, program),
            (program) => (${ApplyRuntimeBridge})(program),
        ),
);

// --- [EXPORT] ----------------------------------------------------------------

const ${Runtime} = {
    Failure: ${Runtime}Failure,
    reasonPolicy,
    toExitCode,
    run,
} as const;

export { ${Runtime} };
```
