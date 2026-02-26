# [H1][ENTITY_MODULE_TEMPLATE]
>**Dictum:** *Entity modules own one aggregate rail: one schema anchor, one command algebra, one policy-bounded typed failure surface.*

Use when a module owns aggregate transitions and command evolution.

Placeholders:
- `${Entity}`: exported module object name.
- `${EntitySchemaFields}`: canonical `S.Class` field definition object.
- `${CommandVariants}`: `S.Union` command variants using `_tag` discriminators.
- `${CommandHandlersForState}`: function `(state) => ({ ...handlers })` passed to `Match.valueTags`; each handler returns `Effect.Effect<typeof ${Entity}Schema.Type, ${Entity}Failure, never>`.
- `${OperationLiterals}`: bounded operation vocabulary object with required keys `decodeState`, `decodeCommand`, `evolve`.
- `${SpanLiterals}`: bounded dot-path span-name object with required key `evolve`.
- `${ReasonLiterals}`: bounded reason union.
- `${ReasonPolicy}`: canonical `reason -> { retryable }` table.
- `${DecodeStateReasonLiteral}` / `${DecodeCommandReasonLiteral}` / `${EvolveReasonLiteral}`: reason literals.

Instantiation rules:
- Keep one aggregate anchor (`S.Class`) and one exported ownership surface.
- Keep immediate tagged dispatch with `Match.valueTags`.
- Keep one tagged typed failure rail and one policy table.
- Decode rails must be deterministic; avoid racey dual-decode fan-in.
- Core entity flow keeps defects as defects; do not launder defects into typed rails.
- Keep exports direct; avoid alias indirection (`x: _x`).

```typescript
import { Cause, Data, Effect, Match, ParseResult, Schema as S, pipe } from "effect";

// --- [CONSTANTS] -------------------------------------------------------------

const Operation = ${OperationLiterals} as const satisfies Record<"decodeState" | "decodeCommand" | "evolve", string>;
const Span = ${SpanLiterals} as const satisfies Record<"evolve", string>;
const ParseStrict = {
    errors:           "all",
    onExcessProperty: "error",
} as const;
const reasonPolicy = ${ReasonPolicy} as const satisfies Record<${ReasonLiterals}, {
    readonly retryable: boolean;
}>;

// --- [SCHEMA] ----------------------------------------------------------------

class ${Entity}Schema extends S.Class<${Entity}Schema>("${Entity}")(${EntitySchemaFields}) {}
const Command = S.Union(${CommandVariants});

// --- [ERRORS] ----------------------------------------------------------------

class ${Entity}Failure extends Data.TaggedError("${Entity}Failure")<{
    readonly operation: (typeof Operation)[keyof typeof Operation];
    readonly reason:    ${ReasonLiterals};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const toFailure =
    (operation: (typeof Operation)[keyof typeof Operation], reason: ${ReasonLiterals}) =>
    (cause: unknown): ${Entity}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Entity}Failure), (known) => known),
            Match.when(ParseResult.isParseError, (parseError) =>
                new ${Entity}Failure({
                    operation,
                    reason,
                    details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                    cause:   parseError,
                })),
            Match.orElse((unknown) =>
                new ${Entity}Failure({
                    operation,
                    reason,
                    details: Match.value(unknown).pipe(
                        Match.when(Match.instanceOf(Error), (error) => `${error.name}: ${error.message}`),
                        Match.orElse((value) => Cause.pretty(Cause.die(value))),
                    ),
                    cause: unknown,
                })),
        );
const isRetryable = (error: ${Entity}Failure) => reasonPolicy[error.reason].retryable;
const evolve = Effect.fn(Span.evolve)((rawState: unknown, rawCommand: unknown) =>
    pipe(
        S.decodeUnknown(${Entity}Schema)(rawState, ParseStrict),
        Effect.mapError(toFailure(Operation.decodeState, ${DecodeStateReasonLiteral})),
        Effect.flatMap((state) =>
            S.decodeUnknown(Command)(rawCommand, ParseStrict).pipe(
                Effect.mapError(toFailure(Operation.decodeCommand, ${DecodeCommandReasonLiteral})),
                Effect.flatMap((command) =>
                    Match.valueTags(
                        command,
                        ${CommandHandlersForState}(state) as const satisfies {
                            readonly [Tag in (typeof Command.Type)["_tag"]]:
                                (input: Extract<typeof Command.Type, { readonly _tag: Tag }>) =>
                                    Effect.Effect<typeof ${Entity}Schema.Type, ${Entity}Failure, never>;
                        },
                    ),
                ),
            )),
        Effect.mapError(toFailure(Operation.evolve, ${EvolveReasonLiteral})),
    ));

// --- [EXPORT] ----------------------------------------------------------------

const ${Entity} = {
    Schema: ${Entity}Schema,
    Command,
    Failure: ${Entity}Failure,
    reasonPolicy,
    isRetryable,
    evolve,
} as const;

export { ${Entity} };
```

Optional persistence belongs in a dedicated persistence module. When co-located, anchor on `Model.Class` projections (`jsonCreate`, `jsonUpdate`, generated fields) and keep persistence rails separate from aggregate transition ownership.
