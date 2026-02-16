# [H1][ERRORS]
>**Dictum:** *Errors are values, not exceptions; boundaries collapse exhaustively.*

<br>

`Data.TaggedError` for internal orchestration (in-memory, no serialization). `Schema.TaggedError` when errors cross wire boundaries (HTTP, RPC, cache). Error unions stay small (3-5 per service). Boundary collapse is always exhaustive via `Match.tag` inside `Effect.mapError`. For union type derivation from constructor maps, see `types.md`.

---
## Data.TaggedError -- Internal Failures

*Domain Algebra:* Small union of tagged variants. Each carries only the data needed for recovery or logging. Yieldable in `Effect.gen` without `Effect.fail`.

```typescript
import { Data, Effect, Schema as S } from 'effect';

class NotFound extends Data.TaggedError('NotFound')<{
    readonly entity: string;
    readonly id:     S.UUID.Type;
}> {}

class Stale extends Data.TaggedError('Stale')<{
    readonly entity:   string;
    readonly expected: number;
    readonly actual:   number;
}> {}

class Malformed extends Data.TaggedError('Malformed')<{
    readonly issues: ReadonlyArray<S.NonEmptyTrimmedString.Type>;
}> {}

const program = Effect.gen(function* () {
    const entity = yield* loadEntity('abc');
    yield* new Stale({ entity: 'Invoice', expected: 3, actual: entity.revision });
});
```

*Yieldable:* `yield* new Stale({...})` short-circuits the generator into the error channel -- no `Effect.fail` wrapper needed. Both `Data.TaggedError` and `Schema.TaggedError` support this.

---
## Schema.TaggedError -- Boundary Failures

*Wire-Safe Algebra:* `Schema.TaggedError` with `HttpApiSchema.annotations` as third argument. The platform reads `status` for HTTP responses and `description` for OpenAPI generation. Static factory hides the full schema payload.

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

class ApiNotFound extends S.TaggedError<ApiNotFound>()('ApiNotFound', {
    message:  S.String,
    resource: S.String,
    id:       S.optional(S.String),
}, HttpApiSchema.annotations({description: 'Resource not found', status: 404,})
) {
    static readonly of = (resource: string, id?: string) =>
        new ApiNotFound({ message: `${resource}${id ? `/${id}` : ''}`, resource, id });
}

class ApiConflict extends S.TaggedError<ApiConflict>()('ApiConflict', {
    message: S.String,
}, HttpApiSchema.annotations({description: 'Revision conflict', status: 409,})
) {}

class ApiValidation extends S.TaggedError<ApiValidation>()('ApiValidation', {
    message: S.String,
}, HttpApiSchema.annotations({description: 'Validation failure', status: 422,})
) {}
```

*Discriminated Reason:* `S.Literal` creates a closed set of failure reasons. Consumers match on `error.reason` instead of parsing message strings.

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Schema as S } from 'effect';

class AuthError extends S.TaggedError<AuthError>()('AuthError', {
    cause:   S.optional(S.Unknown),
    context: S.optional(S.Record({ key: S.String, value: S.Unknown })),
    reason:  S.Literal(
        'config_failed', 'token_invalid', 'token_expired',
        'rate_limited', 'user_not_found', 'internal',
    ),
}, HttpApiSchema.annotations({
    description: 'Authentication failure',
    status: 401,
})) {
    static readonly from = (
        reason:   AuthError['reason'],
        context?: Record<string, unknown>,
        cause?:   unknown,
    ) => new AuthError({ cause, context, reason });
}
```

*`static of` vs `static from`:* `of` takes positional args (simple errors). `from` takes a discriminated `reason` as first arg (multi-reason errors). Both hide the full schema payload from consumers.

---
## Boundary Collapse

*Exhaustive Mapping:* `Effect.mapError` + `Match.exhaustive` transforms internal domain unions into boundary-safe unions. No variant leaks -- the compiler enforces coverage of every `_tag`.

```typescript
import { Effect, Match, Schema as S } from 'effect';
import { HttpApiSchema } from '@effect/platform';

// NotFound and Stale defined above — collapse to boundary-safe union:

class ApiNotFound extends S.TaggedError<ApiNotFound>()('ApiNotFound', {
    message: S.String,
}, HttpApiSchema.annotations({ status: 404 })) {}

class ApiConflict extends S.TaggedError<ApiConflict>()('ApiConflict', {
    message: S.String,
}, HttpApiSchema.annotations({ status: 409 })) {}

const collapse = <A, R>(program: Effect.Effect<A, NotFound | Stale, R>,
): Effect.Effect<A, ApiNotFound | ApiConflict, R> =>
    program.pipe(
        Effect.mapError(
            Match.type<NotFound | Stale>().pipe(
                Match.tag('NotFound', ({ entity, id }) =>
                    new ApiNotFound({ message: `${entity}:${id}` }),
                ),
                Match.tag('Stale', ({ entity, expected, actual }) =>
                    new ApiConflict({ message: `${entity}@${expected}/${actual}` }),
                ),
                Match.exhaustive,
            ),
        ),
    );
```

*Selective Recovery:* `Effect.catchTag` removes one variant from the error union. The remaining union narrows automatically.

```typescript
import { Data, Effect } from 'effect';

class NotFound extends Data.TaggedError('NotFound')<{
    readonly entity: string;
}> {}

class Unauthorized extends Data.TaggedError('Unauthorized')<{
    readonly reason: string;
}> {}

const recover = <R>(
    program: Effect.Effect<void, NotFound | Unauthorized, R>,
): Effect.Effect<void, Unauthorized, R> =>
    program.pipe(
        Effect.catchTag('NotFound', () => Effect.void),
    );
```

---
## Quick Reference

| [INDEX] | [PATTERN]                                     | [WHEN]                             | [KEY_TRAIT]                                        |
| :-----: | --------------------------------------------- | ---------------------------------- | -------------------------------------------------- |
|   [1]   | `Data.TaggedError`                            | Internal orchestration             | Yieldable, structural equality, no schema overhead |
|   [2]   | `S.TaggedError` + `HttpApiSchema.annotations` | Wire boundaries (HTTP, RPC)        | Status code, OpenAPI description, encode/decode    |
|   [3]   | `S.Literal` Reason Field                      | Multi-reason error with closed set | Match on `error.reason`, not message strings       |
|   [4]   | `static of` / `static from`                   | Ergonomic construction             | Hides full schema payload from consumers           |
|   [5]   | `Effect.mapError` + `Match.exhaustive`        | Boundary collapse                  | Transforms domain union->boundary union, no leaks  |
|   [6]   | `Effect.catchTag`                             | Selective recovery                 | Removes one variant, narrows remaining union       |
