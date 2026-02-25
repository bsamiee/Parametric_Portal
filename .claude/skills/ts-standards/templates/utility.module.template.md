# [H1][UTILITY_MODULE_TEMPLATE]
>**Dictum:** *Keep utility modules runtime-first: canonical schema, explicit parse rail, and composable transforms.*

Use for reusable value transforms that do not own service lifecycle.

Placeholders:
- `${Utility}`: export object name.
- `${BaseSchema}`: canonical runtime schema (`S.NonEmptyTrimmedString`, etc.).
- `${Constraints}`: additional schema constraints.
- `${ReasonLiterals}`: include `'parse' | 'validation' | 'lookup' | 'unknown'`.
- `${MaxLength}`: canonical length cap.

Instantiation rules:
- Keep one canonical schema; derive all projections from it.
- Keep one tagged failure rail for parse/validation/lookup operations.
- Keep transforms expression-only and side-effect free except explicit lookups.

```typescript
import { Data, Effect, Match, Option, Schema as S, pipe } from 'effect';

const _${Utility}Schema = ${BaseSchema}.pipe(${Constraints});
const _decode = S.decodeUnknown(_${Utility}Schema);
const _LIMITS = { maxLength: ${MaxLength} } as const;

class _${Utility}Failure extends Data.TaggedError('${Utility}Failure')<{
    readonly operation: string;
    readonly reason: ${ReasonLiterals};
    readonly details?: string;
    readonly cause?: unknown;
}> {
    static readonly from = (operation: string) => (cause: unknown): _${Utility}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(_${Utility}Failure), (known) => known),
            Match.orElse((unknown) => new _${Utility}Failure({ operation, reason: 'unknown', cause: unknown })),
        );
}

const _normalize = (raw: string) =>
    raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const _split = (value: string) => value.split('-').filter((segment) => segment.length > 0);

const _parse = Effect.fn('${Utility}.parse')((raw: unknown) =>
    pipe(raw, _decode, Effect.mapError(_${Utility}Failure.from('parse'))),
);

const _validate = Effect.fn('${Utility}.validate')((value: typeof _${Utility}Schema.Type) =>
    pipe(
        Effect.succeed(value),
        Effect.filterOrFail(
            (candidate) => candidate.length <= _LIMITS.maxLength,
            () => new _${Utility}Failure({ operation: 'validate.length', reason: 'validation', details: 'too-long' }),
        ),
        Effect.filterOrFail(
            (candidate) => _split(String(candidate)).length > 0,
            () => new _${Utility}Failure({ operation: 'validate.segments', reason: 'validation', details: 'empty' }),
        ),
    ),
);

const _fromString = Effect.fn('${Utility}.fromString')((raw: string) =>
    pipe(raw, _normalize, _parse, Effect.flatMap(_validate), Effect.mapError(_${Utility}Failure.from('fromString'))),
);

const _fromOption = Effect.fn('${Utility}.fromOption')((value: Option.Option<string>) =>
    Option.match(value, {
        onNone: () => Effect.fail(new _${Utility}Failure({ operation: 'fromOption', reason: 'parse', details: 'missing' })),
        onSome: _fromString,
    }),
);

const _canonicalizeMany = Effect.fn('${Utility}.canonicalizeMany')((values: ReadonlyArray<string>) =>
    Effect.forEach(values, _fromString, { concurrency: 'unbounded' }),
);

const _resolveCanonical = Effect.fn('${Utility}.resolveCanonical')(
    <R, E>(
        lookup: (value: typeof _${Utility}Schema.Type) => Effect.Effect<Option.Option<string>, E, R>,
        raw: string,
    ) =>
        pipe(
            raw,
            _fromString,
            Effect.flatMap((parsed) =>
                pipe(
                    lookup(parsed),
                    Effect.flatMap(
                        Option.match({
                            onNone: () => Effect.succeed(parsed),
                            onSome: _fromString,
                        }),
                    ),
                ),
            ),
            Effect.mapError((cause) =>
                Match.value(cause).pipe(
                    Match.when(Match.instanceOf(_${Utility}Failure), (known) => known),
                    Match.orElse(
                        (unknown) => new _${Utility}Failure({ operation: 'resolve.lookup', reason: 'lookup', cause: unknown }),
                    ),
                ),
            ),
        ),
);

const ${Utility} = {
    Schema: _${Utility}Schema,
    Failure: _${Utility}Failure,
    limits: _LIMITS,
    normalize: _normalize,
    split: _split,
    parse: _parse,
    validate: _validate,
    fromString: _fromString,
    fromOption: _fromOption,
    canonicalizeMany: _canonicalizeMany,
    resolveCanonical: _resolveCanonical,
} as const;

export { ${Utility} };
```
