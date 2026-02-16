# [H1][DOMAIN]
>**Dictum:** *Entity-centric modules unify schema, command, failure, and execution.*

<br>

Produces one self-contained domain module: entity, command algebra, failure algebra, projections, and execution.

**Workflow:** Fill placeholders, remove guidance comments, verify `tsc --noEmit`.

**Placeholders:**

| [INDEX] | [PLACEHOLDER]            | [PURPOSE]                                                 | [EXAMPLE]                           |
| :-----: | ------------------------ | --------------------------------------------------------- | ----------------------------------- |
|   [1]   | **`${EntityName}`**      | PascalCase entity name; used for class, tag, namespace.   | `Invoice`                           |
|   [2]   | **`${entity-tag}`**      | Lowercase kebab-case tag string for `Schema.TaggedClass`. | `invoice`                           |
|   [3]   | **`${IdBrand}`**         | PascalCase brand for entity id.                           | `InvoiceId`                         |
|   [4]   | **`${state-literals}`**  | Comma-separated quoted state strings.                     | `'draft', 'issued', 'paid', 'void'` |
|   [5]   | **`${CommandVariants}`** | Tagged enum variant definitions for domain commands.      | See inline guidance.                |
|   [6]   | **`${FailureVariants}`** | Tagged enum variant definitions for domain failures.      | See inline guidance.                |
|   [7]   | **`${domain-fields}`**   | Schema field definitions for entity-specific data.        | See inline guidance.                |
|   [8]   | **`${match-branches}`**  | `Match.tag` branches executing each command variant.      | See inline guidance.                |

```typescript
import { Data, Effect, HashMap, Match, Option, Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type ${EntityName} =   typeof ${EntityName}Schema.Type;
type ${EntityName}Id = typeof ${EntityName}Id.Type;
type Command = Data.TaggedEnum.Value<CommandDef, [${EntityName}Id, ${EntityName}]>;
type Failure = Data.TaggedEnum.Value<FailureDef, [${EntityName}Id]>;

// --- [SCHEMA] ----------------------------------------------------------------

const ${EntityName}Id = S.UUID.pipe(S.brand('${IdBrand}'));
class ${EntityName}Schema extends S.TaggedClass<${EntityName}Schema>()('${entity-tag}', {
    id:        ${EntityName}Id,
    revision:  S.Int.pipe(S.nonNegative()),
    state:     S.Literal(${state-literals}),
    ${domain-fields}
    retiredAt: S.OptionFromNullOr(S.DateTimeUtc),
}) {}

// --- [CONSTANTS] -------------------------------------------------------------

const projection = {
    create: ${EntityName}Schema.pipe(S.pick('state', 'revision'), S.mutable),
    patch:  ${EntityName}Schema.pipe(S.pick('state', 'retiredAt'), S.partial),
    read:   ${EntityName}Schema,
} as const;
// Immutable index by entity id -- structural equality from TaggedClass
const _byId = (entities: ReadonlyArray<${EntityName}>) => HashMap.fromIterable(entities.map((entity) => [entity.id, entity] as const));

// --- [ERRORS] ----------------------------------------------------------------

/* Guidance: define 2-5 failure variants referencing entity fields via FailureDef generics.
   The generic parameter A maps to ${EntityName}Id for typed identity references. */
interface FailureDef extends Data.TaggedEnum.WithGenerics<1> {
    readonly taggedEnum: {
        readonly NotFound: { readonly id: this['A'] };
        readonly Stale: { readonly id: this['A']; readonly expected: number; readonly actual: number };
        ${FailureVariants}
    };
}
const Failure = Data.taggedEnum<FailureDef>();

// --- [FUNCTIONS] -------------------------------------------------------------

/* Guidance: define command variants that carry exactly the data needed to produce
   the next entity state. Generic A = ${EntityName}Id, B = ${EntityName}. */
interface CommandDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: {${CommandVariants}};
}
const Command = Data.taggedEnum<CommandDef>();
const execute = (entity: ${EntityName}, command: Command): Effect.Effect<${EntityName}, Failure> =>
    Match.type<Command>().pipe(
        ${match-branches}
        Match.exhaustive,
    )(command);
const decode = {
    create: S.decodeUnknown(projection.create),
    patch:  S.decodeUnknown(projection.patch),
    read:   S.decodeUnknown(projection.read),
} as const;

// --- [EXPORT] ----------------------------------------------------------------

export {
    Command, decode, execute, Failure,
    ${EntityName}Id, ${EntityName}Schema, projection,
};
export type { ${EntityName} };
```

**Guidance for placeholder expansion:**

`${CommandVariants}` example:
```typescript
readonly Open:  { readonly id: this['A']; readonly entity: this['B'] };
readonly Amend: { readonly id: this['A']; readonly revision: number; readonly delta: Record<string, unknown> };
readonly Close: { readonly id: this['A']; readonly at: Date };
```

`${match-branches}` example:
```typescript
Match.tag('Open', ({ entity }) =>
    Effect.succeed({ ...entity, state: 'active' as const, retiredAt: Option.none() }),
),
Match.tag('Amend', ({ id, revision, delta }) =>
    Effect.succeed(entity).pipe(
        Effect.filterOrFail(
            (current) => current.revision < revision,
            () => Failure.Stale({ id, expected: entity.revision, actual: revision }),
        ),
        Effect.map((current) => ({ ...current, ...delta, revision })),
    ),
),
Match.tag('Close', ({ id, at }) =>
    Effect.succeed({ ...entity, state: 'void' as const, retiredAt: Option.some(S.DateTimeUtcFromDate.make(at)) }),
),
```
