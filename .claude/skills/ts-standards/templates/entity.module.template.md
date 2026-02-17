# [H1][ENTITY_MODULE]
>**Dictum:** *Entity-centric modules unify schema, command algebra, failure algebra, projections, and execution.*

<br>

Produces one self-contained domain module: schema, projections, command constructors, failure constructors, and a single polymorphic entrypoint (`execute`).

**Budget:** 225 LOC cap per module. See SKILL.md section 2 for contracts.
**References:** `objects.md` (schema), `matching.md` (dispatch), `errors.md` (failure algebra), `types.md` (const+namespace merge).
**Workflow:** fill placeholders, remove guidance blocks, verify `pnpm exec nx run-many -t typecheck`.

**Placeholders**

| [INDEX] | [PLACEHOLDER]        | [EXAMPLE]                           |
| :-----: | -------------------- | ----------------------------------- |
|   [1]   | `${EntityName}`      | `Invoice`                           |
|   [2]   | `${entity-tag}`      | `invoice`                           |
|   [3]   | `${IdBrand}`         | `InvoiceId`                         |
|   [4]   | `${state-literals}`  | `'draft', 'issued', 'paid', 'void'` |
|   [5]   | `${domain-fields}`   | `amount: S.Positive, ...`           |
|   [6]   | `${CommandVariants}` | See guidance below                  |
|   [7]   | `${FailureVariants}` | See guidance below                  |
|   [8]   | `${match-cases}`     | `$match` case object entries        |

```typescript
import { Data, Effect, HashMap, Option, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ${EntityName}Id = S.UUID.pipe(S.brand('${IdBrand}'));

class ${EntityName}Schema extends S.TaggedClass<${EntityName}Schema>()('${entity-tag}', {
    id:        ${EntityName}Id,
    revision:  S.Int.pipe(S.nonNegative()),
    state:     S.Literal(${state-literals}),
    ${domain-fields}
    retiredAt: S.OptionFromNullOr(S.DateTimeUtc),
}) {}

// --- [PROJECTIONS] -----------------------------------------------------------

const projection = {
    create: ${EntityName}Schema.pipe(S.pick('state', 'revision'), S.mutable),
    patch:  ${EntityName}Schema.pipe(S.pick('state', 'retiredAt'), S.partial),
    read:   ${EntityName}Schema,
} as const;
const decode = {
    create: S.decodeUnknown(projection.create),
    patch:  S.decodeUnknown(projection.patch),
    read:   S.decodeUnknown(projection.read),
} as const;
// Immutable index by id (Hash + Equal derived from TaggedClass)
const byId = (entities: ReadonlyArray<typeof ${EntityName}Schema.Type>) => HashMap.fromIterable(entities.map((e) => [e.id, e] as const));

// --- [FAILURES] --------------------------------------------------------------

// Guidance: define 2–5 internal failures as Data.TaggedError classes.
// Keep the union small; use reason literals on a single error when needed.

class NotFound extends Data.TaggedError('NotFound')<{ readonly id: typeof ${EntityName}Id.Type }> {}
class Stale extends Data.TaggedError('Stale')<{ readonly id: typeof ${EntityName}Id.Type; readonly expected: number; readonly actual: number }> {}
${FailureVariants}

const Failure = { NotFound, Stale } as const;

// --- [COMMANDS] --------------------------------------------------------------

// Guidance: generic A = id, generic B = entity.
interface CommandDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: {${CommandVariants}};
}
const Command = Data.taggedEnum<CommandDef>();

// --- [EXECUTION] -------------------------------------------------------------

const execute = (
    entity: typeof ${EntityName}Schema.Type,
    command: Data.TaggedEnum.Value<CommandDef, [typeof ${EntityName}Id.Type, typeof ${EntityName}Schema.Type]>,
): Effect.Effect<typeof ${EntityName}Schema.Type, InstanceType<(typeof Failure)[keyof typeof Failure]>> =>
    Command.$match(command, {${match-cases}});

// --- [EXPORT] ----------------------------------------------------------------

export const ${EntityName} = {
    Id: ${EntityName}Id, Schema: ${EntityName}Schema, projection, decode, byId,
    Command, Failure, execute,
} as const;

export namespace ${EntityName} {
    export type Id = typeof ${EntityName}Id.Type;
    export type Type = typeof ${EntityName}Schema.Type;
    export type Command = Data.TaggedEnum.Value<CommandDef, [Id, Type]>;
    export type Failure = InstanceType<(typeof Failure)[keyof typeof Failure]>;
}
```

**Guidance: `${CommandVariants}`**
```typescript
readonly Open:  { readonly id: this['A']; readonly entity: this['B'] };
readonly Amend: { readonly id: this['A']; readonly revision: number; readonly delta: Record<string, unknown> };
readonly Close: { readonly id: this['A']; readonly at: Date };
```

**Guidance: `${FailureVariants}`**
```typescript
class Malformed extends Data.TaggedError('Malformed')<{ readonly issues: ReadonlyArray<string> }> {}
// then add it to Failure map:
// const Failure = { NotFound, Stale, Malformed } as const;
```

**Guidance: `${match-cases}`**
```typescript
Open:  ({ entity }) => Effect.succeed({ ...entity, state: 'active' as const, retiredAt: Option.none() }),
Close: ({ at }) => Effect.succeed({ ...entity, state: 'void' as const, retiredAt: Option.some(S.DateTimeUtcFromDate.make(at)) }),
Amend: ({ id, revision, delta }) =>
    Effect.succeed(entity).pipe(
        Effect.filterOrFail(
            (current) => current.revision < revision,
            () => new Failure.Stale({ id, expected: entity.revision, actual: revision }),
        ),
        Effect.map((current) => ({ ...current, ...delta, revision })),
    ),
```
