# [H1][ENTITY_MODULE_TEMPLATE]
>**Dictum:** *Own one aggregate with one runtime anchor, one command union, and one tagged failure rail.*

Use when a module owns entity transitions and optional persistence row shape.

Placeholders:
- `${Entity}`: module export object name.
- `${EntityId}` / `${OwnerId}`: ID field labels.
- `${StatusLiterals}`: status literals (`'draft', 'active', 'archived'`).
- `${ReasonLiterals}`: include `'validation' | 'conflict' | 'forbidden' | 'unknown'`.

Instantiation rules:
- Keep exactly one aggregate class and one command union.
- Keep one transition entrypoint (`evolve`) with exhaustive command routing.
- Keep one module failure type and map unknown causes immediately.

```typescript
import { Data, DateTime, Effect, Match, ParseResult, Schema as S, pipe } from 'effect';
import { Model } from '@effect/sql';

const _${Entity}Id = S.UUID;
const _${OwnerId} = S.UUID;
const _STATUS = [${StatusLiterals}] as const;
const _Status = S.Literal(..._STATUS);

class _${Entity} extends S.Class<_${Entity}>('${Entity}')({
    id: _${Entity}Id,
    ownerId: _${OwnerId},
    title: S.NonEmptyTrimmedString,
    status: _Status,
    revision: S.Number.pipe(S.int(), S.nonNegative()),
    createdAt: S.DateTimeUtc,
    updatedAt: S.DateTimeUtc,
}) {}

class _${Entity}Row extends Model.Class<_${Entity}Row>('${Entity}Row')({
    id: Model.Generated(_${Entity}Id),
    ownerId: _${OwnerId},
    title: S.NonEmptyTrimmedString,
    status: _Status,
    revision: S.Number.pipe(S.int(), S.nonNegative()),
    deletedAt: Model.FieldOption(S.DateFromSelf),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}

class _${Entity}Failure extends Data.TaggedError('${Entity}Failure')<{
    readonly operation: string;
    readonly reason: ${ReasonLiterals};
    readonly details?: string;
    readonly cause?: unknown;
}> {
    static readonly from = (operation: string) => (cause: unknown): _${Entity}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(_${Entity}Failure), (known) => known),
            Match.orElse((unknown) => new _${Entity}Failure({ operation, reason: 'unknown', cause: unknown })),
        );
}

const _Command = S.Union(
    S.Struct({ _tag: S.Literal('Create'), ownerId: _${OwnerId}, title: S.NonEmptyTrimmedString }),
    S.Struct({ _tag: S.Literal('Rename'), actorId: _${OwnerId}, title: S.NonEmptyTrimmedString }),
    S.Struct({ _tag: S.Literal('Archive'), actorId: _${OwnerId} }),
);

const _decodeState = S.decodeUnknown(_${Entity});
const _decodeCommand = S.decodeUnknown(_Command);
const _LIMITS = { maxTitleLength: 160 } as const;

const _decodeFailure = (operation: string) => (cause: unknown) =>
    Match.value(cause).pipe(
        Match.when({ _tag: 'ParseError' } as const, (parseError) =>
            new _${Entity}Failure({
                operation,
                reason: 'validation',
                details: ParseResult.TreeFormatter.formatErrorSync(parseError),
                cause: parseError,
            }),
        ),
        Match.orElse(_${Entity}Failure.from(operation)),
    );

const _next = (state: typeof _${Entity}.Type, patch: Partial<typeof _${Entity}.Type>) => ({
    ...state,
    ...patch,
    revision: state.revision + 1,
    updatedAt: DateTime.unsafeNow(),
});

const _evolve = Effect.fn('${Entity}.evolve')((rawState: unknown, rawCommand: unknown) =>
    pipe(
        Effect.all({ state: _decodeState(rawState), command: _decodeCommand(rawCommand) }),
        Effect.mapError(_decodeFailure('decode')),
        Effect.flatMap(({ state, command }) =>
            Match.valueTags(command).pipe(
                Match.tag('Create', ({ ownerId, title }) =>
                    pipe(
                        Effect.succeed(state),
                        Effect.filterOrFail(
                            (current) => current.revision === 0,
                            () => new _${Entity}Failure({ operation: 'create', reason: 'conflict', details: 'already-created' }),
                        ),
                        Effect.filterOrFail(
                            () => title.length <= _LIMITS.maxTitleLength,
                            () =>
                                new _${Entity}Failure({ operation: 'create', reason: 'validation', details: 'title-too-long' }),
                        ),
                        Effect.map(() => _next(state, { ownerId, title, status: _STATUS[0] as typeof _Status.Type })),
                    ),
                ),
                Match.tag('Rename', ({ actorId, title }) =>
                    pipe(
                        Effect.succeed(state),
                        Effect.filterOrFail(
                            (current) => current.ownerId === actorId,
                            () => new _${Entity}Failure({ operation: 'rename', reason: 'forbidden', details: 'owner-only' }),
                        ),
                        Effect.filterOrFail(
                            () => title.length <= _LIMITS.maxTitleLength,
                            () =>
                                new _${Entity}Failure({ operation: 'rename', reason: 'validation', details: 'title-too-long' }),
                        ),
                        Effect.map((current) => _next(current, { title })),
                    ),
                ),
                Match.tag('Archive', ({ actorId }) =>
                    pipe(
                        Effect.succeed(state),
                        Effect.filterOrFail(
                            (current) => current.ownerId === actorId,
                            () => new _${Entity}Failure({ operation: 'archive', reason: 'forbidden', details: 'owner-only' }),
                        ),
                        Effect.map((current) =>
                            _next(current, { status: _STATUS[_STATUS.length - 1] as typeof _Status.Type }),
                        ),
                    ),
                ),
                Match.exhaustive,
            ),
        ),
        Effect.mapError(_${Entity}Failure.from('evolve')),
    ),
);

const ${Entity} = {
    Id: _${Entity}Id,
    OwnerId: _${OwnerId},
    Status: _Status,
    Schema: _${Entity},
    Row: _${Entity}Row,
    Command: _Command,
    decodeCommand: _decodeCommand,
    Failure: _${Entity}Failure,
    limits: _LIMITS,
    evolve: _evolve,
} as const;

export { ${Entity} };
```
