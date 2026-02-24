# [H1][ENTITY_MODULE_TEMPLATE]
>**Dictum:** *One module. One schema. One execute. Zero imperative branching.*

Use for bounded domain entities that own state transitions, participate in serialization boundaries, or require codec/Hash/Equal derivation. Not for internal intermediates that never leave a module. Fill `${...}` placeholders, delete guidance comments, run `pnpm exec nx run-many -t typecheck`.

---

## Placeholders

| [INDEX] | [PLACEHOLDER] | [EXAMPLE]              | [NOTES]                                         |
| :-----: | ------------- | ---------------------- | ----------------------------------------------- |
|   [1]   | `${Entity}`   | `Workspace`            | PascalCase entity name; used in namespace merge |
|   [2]   | `${entity}`   | `workspace`            | Lowercase `_tag` for `S.TaggedClass`            |
|   [3]   | `${EntityId}` | `WorkspaceId`          | Brand name for primary key                      |
|   [4]   | `${OwnerId}`  | `UserId`               | Brand name for owning identity                  |
|   [5]   | `${status}`   | `'active', 'archived'` | `S.Literal` variants for lifecycle              |
|   [6]   | `${reasons}`  | `'not_found', ...`     | Polymorphic error `reason` literals             |

---

```typescript
import { Data, DateTime, Effect, Option, Schema as S, pipe } from 'effect';
import { Model } from '@effect/sql';
// --- [TYPES] -----------------------------------------------------------------
const _${EntityId} = S.UUID.pipe(S.brand('${EntityId}'));
const _${OwnerId}  = S.UUID.pipe(S.brand('${OwnerId}'));
// --- [SCHEMA] ----------------------------------------------------------------
// why: TaggedClass -- entity crosses serialization boundary; _tag enables union dispatch
class _${Entity}Schema extends S.TaggedClass<_${Entity}Schema>()(
    '${entity}',
    {
        id:        _${EntityId},
        name:      S.NonEmptyTrimmedString,
        ownerId:   _${OwnerId},
        status:    S.Literal(${status}),
        createdAt: S.DateTimeUtc,
        updatedAt: S.DateTimeUtc,
    },
) {}
// Projections: derive inline -- never a separate class
const _CreateInput = _${Entity}Schema.pipe(S.pick('name', 'ownerId'));
const _UpdateInput = _${Entity}Schema.pipe(S.pick('name'), S.partial);
// --- [TABLES] ----------------------------------------------------------------
// why: Model.Class adds field modifiers for SQL generation; mirrors domain schema
class _${Entity}Record extends Model.Class<_${Entity}Record>('${Entity}Record')({
    id:        Model.Generated(_${EntityId}),
    name:      S.NonEmptyTrimmedString,
    ownerId:   _${OwnerId},
    status:    S.Literal(${status}),
    deletedAt: Model.FieldOption(S.DateFromSelf),
    updatedAt: Model.DateTimeUpdateFromDate,
}) {}
// --- [CONSTANTS] -------------------------------------------------------------
const _LIMITS = { nameMaxLength: 128 } as const;
// --- [ERRORS] ----------------------------------------------------------------
// why: one polymorphic error with reason field collapses 3-5 variants into one class;
//      from() wraps unknown causes while passing through known typed errors
class _${Entity}Error extends Data.TaggedError('${Entity}Error')<{
    readonly operation: string;
    readonly reason:    ${reasons};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {
    override get message() {
        return `${Entity}Error[${this.operation}/${this.reason}]${this.details ? `: ${this.details}` : ''}`;
    }
    static readonly from = (operation: string) => (cause: unknown): _${Entity}Error =>
        cause instanceof _${Entity}Error
            ? cause
            : new _${Entity}Error({ cause, operation, reason: 'unknown' });
    static readonly notFound  = (operation: string, details?: string) =>
        new _${Entity}Error({ details, operation, reason: 'not_found' });
    static readonly conflict  = (operation: string, details: string) =>
        new _${Entity}Error({ details, operation, reason: 'conflict' });
    static readonly forbidden = (operation: string, details: string) =>
        new _${Entity}Error({ details, operation, reason: 'forbidden' });
}
// --- [FUNCTIONS] -------------------------------------------------------------
// why: closed union via Data.TaggedEnum; $match exhausts all variants
type _Command = Data.TaggedEnum<{
    readonly Create:  { readonly name: string; readonly ownerId: typeof _${OwnerId}.Type };
    readonly Rename:  { readonly name: string; readonly actorId: typeof _${OwnerId}.Type };
    readonly Archive: { readonly actorId: typeof _${OwnerId}.Type };
    readonly Restore: { readonly actorId: typeof _${OwnerId}.Type };
}>;
const _Command = Data.taggedEnum<_Command>();
// why: single polymorphic entrypoint -- state + command -> next state or failure;
//      $match enforces exhaustiveness at compile time; zero if/else/switch;
//      Effect.fn provides automatic span for tracing without manual instrumentation
const _execute = Effect.fn('${Entity}.execute')(function* (
    entity: typeof _${Entity}Schema.Type,
    command: _Command,
) {
    return yield* _Command.$match(command, {
        Create: ({ name, ownerId }) =>
            pipe(
                Effect.succeed(name),
                Effect.filterOrFail(
                    (value) => value.length <= _LIMITS.nameMaxLength,
                    () => _${Entity}Error.conflict('create', `name exceeds ${_LIMITS.nameMaxLength} chars`),
                ),
                Effect.map(() => ({ ...entity, name, ownerId, status: 'active' as const })),
            ),
        Rename: ({ name, actorId }) =>
            pipe(
                Effect.succeed(entity),
                Effect.filterOrFail(
                    (current) => current.ownerId === actorId,
                    () => _${Entity}Error.forbidden('rename', 'only the owner may rename'),
                ),
                Effect.map((current) => ({ ...current, name, updatedAt: DateTime.unsafeNow() })),
            ),
        Archive: ({ actorId }) =>
            pipe(
                Effect.succeed(entity),
                Effect.filterOrFail(
                    (current) => current.ownerId === actorId,
                    () => _${Entity}Error.forbidden('archive', 'only the owner may archive'),
                ),
                Effect.filterOrFail(
                    (current) => current.status !== 'archived',
                    () => _${Entity}Error.conflict('archive', 'already archived'),
                ),
                Effect.map((current) => ({
                    ...current, status: 'archived' as const, updatedAt: DateTime.unsafeNow(),
                })),
            ),
        Restore: ({ actorId }) =>
            pipe(
                Effect.succeed(entity),
                Effect.filterOrFail(
                    (current) => current.ownerId === actorId,
                    () => _${Entity}Error.forbidden('restore', 'only the owner may restore'),
                ),
                Effect.map((current) => ({
                    ...current, status: 'active' as const, updatedAt: DateTime.unsafeNow(),
                })),
            ),
    });
});
// --- [EXPORT] ----------------------------------------------------------------
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const ${Entity} = {
    Id:          _${EntityId},
    OwnerId:     _${OwnerId},
    Schema:      _${Entity}Schema,
    Record:      _${Entity}Record,
    CreateInput: _CreateInput,
    UpdateInput: _UpdateInput,
    Command:     _Command,
    Error:       _${Entity}Error,
    execute:     _execute,
    limits:      _LIMITS,
} as const;
namespace ${Entity} {
    export type Id          = typeof _${EntityId}.Type;
    export type OwnerId     = typeof _${OwnerId}.Type;
    export type Type        = typeof _${Entity}Schema.Type;
    export type Record      = typeof _${Entity}Record.Type;
    export type CreateInput = typeof _CreateInput.Type;
    export type UpdateInput = typeof _UpdateInput.Type;
    export type Command     = _Command;
    export type Error       = _${Entity}Error;
}
export { ${Entity} };
```

---

## Post-Scaffold Checklist

- [ ] All `${...}` placeholders replaced with domain-specific values
- [ ] `_tag` string in `S.TaggedClass` matches lowercase entity name
- [ ] Projections derived via `S.pick`/`S.omit`/`S.partial` -- no separate schema classes
- [ ] Polymorphic error uses `reason` literal union -- max 5 reasons per entity
- [ ] `_execute` wrapped in `Effect.fn('${Entity}.execute')` for automatic span tracing
- [ ] `_execute` uses `$match` exhaustively -- zero `if`/`else`/`switch`
- [ ] Guard conditions use `Effect.filterOrFail` -- not ternary chains
- [ ] Namespace types derived from `typeof` runtime values -- no manual declarations
- [ ] `pnpm exec nx run-many -t typecheck` passes
