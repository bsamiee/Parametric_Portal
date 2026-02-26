# [H1][UTILITY_MODULE_TEMPLATE]
>**Dictum:** *Utility modules are canonical value rails: strict ingress decode once, typed canonicalization, bounded policy failures, explicit bulk semantics.*

Use for reusable canonicalization modules that do not own transport/resource lifecycles.

Placeholders:
- `${Utility}`: exported module object name.
- `${CanonicalSchema}`: canonical runtime schema anchor.
- `${OperationLiterals}`: bounded operation vocabulary object with required keys `decode`, `canonicalize`, `canonicalizeMany`, `resolve`.
- `${SpanLiterals}`: bounded dot-path span-name object with required keys `canonicalize`, `canonicalizeMany`, `resolve`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { retryable }` table.
- `${ParseReasonLiteral}` / `${CanonicalizeReasonLiteral}` / `${LookupReasonLiteral}`: reason literals.
- `${CanonicalizeEffect}`: effectful canonicalization function `(value: typeof ${CanonicalSchema}.Type) => Effect.Effect<typeof ${CanonicalSchema}.Type, unknown, R>`.
- `${BatchConcurrency}`: bounded numeric concurrency.
- `${BatchMode}`: explicit aggregation mode (`"default" | "either" | "validate"`).

Instantiation rules:
- Decode unknown ingress exactly once with strict options.
- Keep one ownership surface export.
- Keep aggregation mode explicit and compare modes on the same graph shape.
- Keep lookup reconciliation explicit; pass `Effect.succeed(Option.none())` when no lookup exists.
- Core utility flow keeps defects as defects; do not launder defects into typed rails.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Effect, Match, Option, ParseResult, Schema as S, pipe } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const Schema = ${CanonicalSchema};

// --- [CONSTANTS] -------------------------------------------------------------

const Operation = ${OperationLiterals} as const satisfies Record<"decode" | "canonicalize" | "canonicalizeMany" | "resolve", string>;
const Span =      ${SpanLiterals} as const satisfies Record<"canonicalize" | "canonicalizeMany" | "resolve", string>;
const ParseStrict = {
    errors:           "all",
    onExcessProperty: "error",
} as const;
const reasonPolicy = ${ReasonPolicy} as const satisfies Record<${ReasonLiterals}, {
    readonly retryable: boolean;
}>;
const batchOptions = {
    default:  { concurrency: ${BatchConcurrency}                   },
    either:   { concurrency: ${BatchConcurrency}, mode: "either"   },
    validate: { concurrency: ${BatchConcurrency}, mode: "validate" },
} as const;

// --- [ERRORS] ----------------------------------------------------------------

class ${Utility}Failure extends Data.TaggedError("${Utility}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Utility}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Utility}Failure), (known) => known),
            Match.when(ParseResult.isParseError, (parseError) =>
                new ${Utility}Failure({
                    operation,
                    reason,
                    details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                    cause:   parseError,
                })),
            Match.orElse((unknown) =>
                new ${Utility}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const isRetryable = (error: ${Utility}Failure) => reasonPolicy[error.reason].retryable;
const canonicalize = Effect.fn(Span.canonicalize)((raw: unknown) =>
    pipe(
        S.decodeUnknown(Schema)(raw, ParseStrict),
        Effect.mapError(toFailure(Operation.decode, ${ParseReasonLiteral})),
        Effect.flatMap((decoded) =>
            (${CanonicalizeEffect})(decoded).pipe(Effect.mapError(toFailure(Operation.canonicalize, ${CanonicalizeReasonLiteral})),)),
    ));
const canonicalizeMany = Effect.fn(Span.canonicalizeMany)((values: ReadonlyArray<unknown>) =>
    pipe(
        Effect.all(values.map(canonicalize), batchOptions[${BatchMode}]),
        Effect.mapError((failure) =>
            Match.value(failure).pipe(
                Match.when(Match.instanceOf(${Utility}Failure), (known) =>
                    new ${Utility}Failure({
                        operation: Operation.canonicalizeMany,
                        reason:    known.reason,
                        details:   known.details,
                        cause:     known.cause,
                    })),
                Match.orElse(toFailure(Operation.canonicalizeMany, ${CanonicalizeReasonLiteral})),
            )),
    ));
const resolve = Effect.fn(Span.resolve)(
    <R, E>(lookup: (value: typeof Schema.Type) => Effect.Effect<Option.Option<typeof Schema.Type>, E, R>, raw: unknown) =>
        pipe(
            canonicalize(raw),
            Effect.flatMap((canonical) =>
                pipe(
                    lookup(canonical),
                    Effect.mapError(toFailure(Operation.resolve, ${LookupReasonLiteral})),
                    Effect.flatMap(Option.match({ onNone: () => Effect.succeed(canonical), onSome: Effect.succeed })),
                )),
        ));

// --- [EXPORT] ----------------------------------------------------------------

const ${Utility} = {
    Schema,
    Failure: ${Utility}Failure,
    reasonPolicy,
    isRetryable,
    canonicalize,
    canonicalizeMany,
    resolve,
} as const;

export { ${Utility} };
```
