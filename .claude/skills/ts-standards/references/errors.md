# [H1][ERRORS]
>**Dictum:** *Errors are values, not exceptions; boundaries collapse exhaustively.*

<br>

Use `Data.TaggedError` for internal failure algebras (in-memory, orchestrated via the error channel). Use `Schema.TaggedError` for boundary failure algebras (wire-safe, codec + OpenAPI/status metadata). Keep unions small by collapsing *reasons* into a single tagged error with a closed `S.Literal` field.

For constructor-map union derivation (no manual unions), see `types.md`.

---
## Data.TaggedError
*Internal algebra:* yieldable in `Effect.gen`, minimal overhead, structural `Hash` + `Equal`.

```typescript
import { Data, Effect, Option, Schema as S } from 'effect';

class NotFound extends Data.TaggedError('NotFound')<{
    readonly entity: string;
    readonly id:     S.UUID.Type;
}> {}
class Stale extends Data.TaggedError('Stale')<{
    readonly entity:   string;
    readonly expected: number;
    readonly actual:   number;
}> {}

const requireEntity = Effect.fn('Entity.require')(
    (entity: string, found: Option.Option<{ readonly revision: number }>, id: S.UUID.Type) =>
        Option.match(found, {
            onNone: () => new NotFound({ entity, id }),
            onSome: Effect.succeed,
        }),
);
const requireFresh = Effect.fn('Entity.requireFresh')(
    (entity: string, expected: number, actual: number) =>
        Effect.succeed(actual).pipe(
            Effect.filterOrFail(
                (rev) => rev === expected,
                () => new Stale({ entity, expected, actual }),
            ),
        ),
);
```

*Rule:* internal errors are **data**: tagged variants with only recovery-relevant fields.

---
## Schema.TaggedError
*Boundary algebra:* wire-safe, status-coded, OpenAPI described. Prefer `static of/from` so callers never construct schema payloads directly.

```typescript
import { HttpApiSchema } from '@effect/platform';
import { Option, Schema as S } from 'effect';

class ApiNotFound extends S.TaggedError<ApiNotFound>()('ApiNotFound', {
    resource: S.String,
    id:       S.optional(S.String),
    message:  S.String,
}, HttpApiSchema.annotations({
    description: 'Resource not found',
    status: 404,
})) {
    static readonly of = (resource: string, id?: string) =>
        new ApiNotFound({
            resource,
            id,
            message: Option.fromNullable(id).pipe(
                Option.match({
                    onNone: () => resource,
                    onSome: (x) => `${resource}/${x}`,
                }),
            ),
        });
}

class ApiConflict extends S.TaggedError<ApiConflict>()('ApiConflict', {
    message: S.String,
}, HttpApiSchema.annotations({
    description: 'Revision conflict',
    status: 409,
})) {}
```

---
## Multi-reason Boundary Errors
*Closed reason set:* consumers match on `reason`, not message strings.

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

---
## Boundary Collapse
*Exhaustive mapping:* collapse internal errors into boundary-safe errors at the boundary (HTTP/RPC/cache). Use `Match.valueTags` so any `_tag` union (TaggedError, TaggedClass, taggedEnum values) maps exhaustively.

```typescript
import { Effect, Match } from 'effect';

// NotFound, Stale (Data.TaggedError) collapse to ApiNotFound | ApiConflict (Schema.TaggedError):
const collapse = <A, R>(
    program: Effect.Effect<A, NotFound | Stale, R>,
): Effect.Effect<A, ApiNotFound | ApiConflict, R> =>
    program.pipe(
        Effect.mapError((e) =>
            Match.valueTags(e, {
                NotFound: ({ entity, id }) => ApiNotFound.of(entity, `${id}`),
                Stale: ({ entity, expected, actual }) =>
                    new ApiConflict({ message: `${entity}@${expected}/${actual}` }),
            }),
        ),
    );
```

---
## Selective Recovery
`Effect.catchTag` eliminates one variant; the remaining union narrows automatically.

```typescript
import { Data, Effect } from 'effect';

class Unauthorized extends Data.TaggedError('Unauthorized')<{ readonly reason: string }> {}

const recoverNotFound = <R>(
    program: Effect.Effect<void, NotFound | Unauthorized, R>,
): Effect.Effect<void, Unauthorized, R> =>
    program.pipe(
        Effect.catchTag('NotFound', () => Effect.void),
    );
```

---
## Rules
- Internal: `Data.TaggedError` (small union, yieldable).
- Boundary: `Schema.TaggedError` + `HttpApiSchema.annotations` (status + docs + codec).
- Keep unions small via **reason literals** on a single error instead of many variants.
- Boundary collapse is a **total function**: exhaustive `Match.valueTags` inside `Effect.mapError`.
