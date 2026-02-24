# [H1][UTILITY_MODULE_TEMPLATE]
>**Dictum:** *Branded types, pure transforms, traced pipelines -- no service overhead.*

Use for self-contained domain utilities: branded value types, pure `A -> B` transforms, and optional `Effect.fn` traced IO pipelines. No `Effect.Service`, no Layer, no scoped constructors.

---

## Placeholders

| [INDEX] | [PLACEHOLDER]    | [EXAMPLE]                          | [NOTES]                             |
| :-----: | ---------------- | ---------------------------------- | ----------------------------------- |
|   [1]   | `${Util}`        | `Slug`                             | PascalCase utility export name      |
|   [2]   | `${brand}`       | `'Slug'`                           | String literal for `S.brand()`      |
|   [3]   | `${base}`        | `S.String`                         | Starting schema before pipe chain   |
|   [4]   | `${constraints}` | `S.minLength(1), S.pattern(/.../)` | Comma-separated schema filters      |
|   [5]   | `${reasons}`     | `'parse', 'validation', 'unknown'` | Polymorphic error `reason` literals |

---

```typescript
import { Data, Effect, Option, Schema as S, pipe } from 'effect';
// --- [SCHEMA] ----------------------------------------------------------------
// why: branded type -- zero runtime overhead, distinct at compile time;
//      S.brand() marks the output so raw strings cannot be substituted
const _${Util}Schema = ${base}.pipe(${constraints}, S.brand(${brand}));
// why: decoder for boundary parsing -- returns Effect for composition in Effect pipelines
const _decode = S.decodeUnknown(_${Util}Schema);
// --- [ERRORS] ----------------------------------------------------------------
// why: one polymorphic error with reason field -- collapses parse/validation/IO failures;
//      from() wraps unknown causes for boundary mapError
class _${Util}Error extends Data.TaggedError('${Util}Error')<{
    readonly operation: string;
    readonly reason:    ${reasons};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {
    override get message() {
        return `${Util}Error[${this.operation}/${this.reason}]${this.details ? `: ${this.details}` : ''}`;
    }
    static readonly from = (operation: string) => (cause: unknown): _${Util}Error =>
        cause instanceof _${Util}Error
            ? cause
            : new _${Util}Error({ cause, operation, reason: 'unknown' });
}
// --- [FUNCTIONS] -------------------------------------------------------------
// why: pure A -> B -- NOT wrapped in Effect; trims, lowercases, normalizes separators
const _normalize = (raw: string): string =>
    raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// why: validates normalized string against schema; maps ParseError into domain error
const _parse = (raw: string): Effect.Effect<typeof _${Util}Schema.Type, _${Util}Error> =>
    pipe(
        _normalize(raw),
        _decode,
        Effect.mapError(() => new _${Util}Error({ details: raw, operation: 'parse', reason: 'parse' })),
    );
// why: domain-rule layer on top of structurally valid value;
//      filterOrFail replaces if/else for business constraints
const _validate = (
    value: typeof _${Util}Schema.Type,
): Effect.Effect<typeof _${Util}Schema.Type, _${Util}Error> =>
    pipe(
        value,
        Effect.filterOrFail(
            (candidate) => !candidate.startsWith('-') && !candidate.endsWith('-'),
            (candidate) => new _${Util}Error({ details: candidate, operation: 'validate', reason: 'validation' }),
        ),
    );
// why: full pipeline -- normalize -> parse -> validate; single entrypoint for untrusted input
const _fromString = (raw: string): Effect.Effect<typeof _${Util}Schema.Type, _${Util}Error> =>
    pipe(raw, _parse, Effect.flatMap(_validate));
// why: lifts Option<string> into the same pipeline; Option.match replaces null checks
const _fromOption = (
    option: Option.Option<string>,
): Effect.Effect<typeof _${Util}Schema.Type, _${Util}Error> =>
    pipe(
        option,
        Option.match({
            onNone: () => Effect.fail(new _${Util}Error({ operation: 'fromOption', reason: 'parse', details: 'no value provided' })),
            onSome: (value) => _fromString(value),
        }),
    );
// why: traced IO pipeline -- Effect.fn for any operation reaching outside the module;
//      span name follows 'Namespace.method' convention for tracing
const _resolveFrom = Effect.fn('${Util}.resolveFrom')(
    <R, E>(
        lookup: (value: typeof _${Util}Schema.Type) => Effect.Effect<Option.Option<string>, E, R>,
        raw: string,
    ): Effect.Effect<typeof _${Util}Schema.Type, _${Util}Error | E, R> =>
        pipe(
            raw,
            _fromString,
            Effect.flatMap((value) =>
                pipe(
                    lookup(value),
                    Effect.flatMap(
                        Option.match({
                            onNone: () => Effect.succeed(value),
                            onSome: (canonical) => _fromString(canonical),
                        }),
                    ),
                ),
            ),
        ),
);
// --- [EXPORT] ----------------------------------------------------------------
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const ${Util} = {
    Schema:      _${Util}Schema,
    Error:       _${Util}Error,
    normalize:   _normalize,
    parse:       _parse,
    validate:    _validate,
    fromString:  _fromString,
    fromOption:  _fromOption,
    resolveFrom: _resolveFrom,
} as const;
namespace ${Util} {
    export type Type  = typeof _${Util}Schema.Type;
    export type Error = _${Util}Error;
}
export { ${Util} };
```

---

## Post-Scaffold Checklist

- [ ] All `${...}` placeholders replaced with domain-specific values
- [ ] Branded schema uses `S.brand()` -- not a plain type alias
- [ ] `_normalize` is pure `A -> B` -- NOT wrapped in Effect
- [ ] Effectful operations traced via `Effect.fn('${Util}.method')`
- [ ] Polymorphic error uses `reason` literal union with `from()` factory
- [ ] Zero imperative branching -- `Option.match`, `Effect.filterOrFail` throughout
- [ ] Internal symbols use `_` prefix; single `export { ${Util} }` via namespace merge
- [ ] Namespace types derived from `typeof` runtime values -- no manual declarations
- [ ] `pnpm exec nx run-many -t typecheck` passes
