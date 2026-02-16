# [H1][MATCHING]
>**Dictum:** *Exhaustive matching dispatches behavior from data shape — concrete or generic.*

<br>

Exhaustive pattern matching over tagged unions via `Data.taggedEnum`, `Match.type`, `Match.value`, `Match.valueTags`. Concrete enums use direct `$match`/`$is`. Generic enums via `Data.TaggedEnum.WithGenerics` propagate type parameters through constructors and built-in matchers. For error-specific matching (boundary collapse), see `errors.md`.

---
## Concrete Tagged Enum

`Data.taggedEnum` returns constructors plus `$match` (exhaustive case object) and `$is` (type guard factory). Prefer `$match` for inline exhaustive dispatch. Prefer `$is` for filtering and conditional streams.

```typescript
import { Data } from 'effect';

type Command = Data.TaggedEnum<{
    readonly Stage:  { readonly payload: ReadonlyArray<number>; readonly revision: number };
    readonly Commit: { readonly id: string; readonly revision: number };
    readonly Retire: { readonly id: string; readonly at: Date };
}>;
const { $is, $match, Stage, Commit, Retire } = Data.taggedEnum<Command>();
const label = (command: Command): string =>
    $match(command, {
        Stage:  ({ revision }) => `stage@${revision}`,
        Commit: ({ id, revision }) => `commit:${id}@${revision}`,
        Retire: ({ id, at }) => `retire:${id}@${at.toISOString()}`,
    });
const isTerminal = $is('Retire');
const pending =    [Stage({ payload: [1, 2], revision: 0 }), Retire({ id: 'x', at: new Date() })];
const terminals =  pending.filter(isTerminal);
```

*`$match`:* Exhaustive case object -- every variant must have a handler. Compiler error on missing branch.
*`$is`:* Returns a type guard `(value: Command) => value is Retire` -- composable with `.filter`, `Array.partition`, `Stream.filter`.

---
## Generic Tagged Enum

`Data.TaggedEnum.WithGenerics<N>` declares N type slots (`this['A']`, `this['B']`, ...) that flow into variant field types. `$match` inherits generic parameters from the constructor and enforces exhaustiveness without explicit type annotation. `$is` returns a type predicate that narrows the generic union to a specific variant.

```typescript
import { Data, Effect } from 'effect';

interface OpDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: {
        readonly Validate:  { readonly input: this['A'] };
        readonly Transform: { readonly input: this['A']; readonly format: string };
        readonly Publish:   { readonly input: this['A']; readonly target: this['B'] };
    };
}
const Op = Data.taggedEnum<OpDef>();
type Op<A, B> = Data.TaggedEnum.Value<OpDef, [A, B]>;
// $match — exhaustive, type params inferred from constructor
const label = Op.$match(Op.Validate({ input: 42 }), {
    Validate:  ({ input }) => `validate:${input}`,
    Transform: ({ format }) => `transform:${format}`,
    Publish:   ({ target }) => `publish:${target}`,
});
// $is — type guard narrowing, composable with filter/filterOrFail
const publishOps = <A, B>(ops: ReadonlyArray<Op<A, B>>) => ops.filter(Op.$is('Publish'));
const requireValidate = <A, B>(op: Op<A, B>) =>
    Effect.succeed(op).pipe(
        Effect.filterOrFail(Op.$is('Validate'), () => new Error('expected Validate')),
    );
```

*`$match` vs `Match.type`:* `$match` is preferred for generic enums because it inherits generic parameters from the constructor. `Match.type<Op<A, B>>()` requires re-specifying generic parameters at every call site.

---
## Match.type Pipeline

`Match.type<T>().pipe(Match.tag(...), Match.exhaustive)` for multi-step dispatch where branches return Effects or require pipeline composition. Use when branches need `Effect.gen`, `pipe`, or intermediate transforms that `$match` cannot express.

```typescript
import { Data, Effect, Match } from 'effect';

type Command = Data.TaggedEnum<{
    readonly Stage:  { readonly payload: ReadonlyArray<number>; readonly revision: number };
    readonly Commit: { readonly id: string; readonly revision: number };
    readonly Retire: { readonly id: string; readonly at: Date };
}>;
const { Stage, Commit, Retire } = Data.taggedEnum<Command>();
const execute = (
    deps: {
        readonly stage:  (payload: ReadonlyArray<number>, revision: number) => Effect.Effect<void>;
        readonly commit: (id: string, revision: number) => Effect.Effect<void>;
        readonly retire: (id: string, at: Date) => Effect.Effect<void>;
    },
    command: Command,
) =>
    Match.type<Command>().pipe(
        Match.tag('Stage',  ({ payload, revision }) => deps.stage(payload, revision)),
        Match.tag('Commit', ({ id, revision }) => deps.commit(id, revision)),
        Match.tag('Retire', ({ id, at }) => deps.retire(id, at)),
        Match.exhaustive,
    )(command);
```

*When to use over `$match`:* Branches return heterogeneous types, need Effect composition, or the matcher is reusable as a standalone function value (since `Match.exhaustive` returns `(input: T) => R`).

---
## Match.value Structural Dispatch

`Match.value(input)` matches a concrete value by structural shape. Use for non-tagged objects, compound conditions, and runtime value routing. Finalizes with `Match.exhaustive` or `Match.orElse`.

```typescript
import { Match, Schema as S } from 'effect';

const Priority = S.Literal('low', 'medium', 'high', 'critical');
type Priority = typeof Priority.Type;
const escalation = (priority: Priority, retryable: boolean): number =>
    Match.value({ priority, retryable }).pipe(
        Match.when({ priority: 'critical' }, () => 4),
        Match.when({ priority: 'high', retryable: false }, () => 3),
        Match.when({ priority: 'high', retryable: true }, () => 2),
        Match.when({ priority: 'medium' }, () => 1),
        Match.orElse(() => 0),
    );
```

*Match.when:* Accepts partial structural patterns or predicate functions. Narrowing applies automatically.
*Match.orElse:* Fallback for open-ended matching. Use `Match.exhaustive` only when the union is fully enumerable.

---
## Match.valueTags

`Match.valueTags(value, cases)` is the most concise API for exhaustive tagged union matching. Equivalent to `$match` but works with any value bearing a `_tag` discriminant -- including `S.TaggedClass`, `S.TaggedError`, and `Data.TaggedError` instances.

```typescript
import { Match, Schema as S } from 'effect';

class Leaf extends   S.TaggedClass<Leaf>()('Leaf', { weight: S.Positive }) {}
class Branch extends S.TaggedClass<Branch>()('Branch', { children: S.Number }) {}
const nodeCount = (tree: Leaf | Branch): number =>
    Match.valueTags(tree, {
        Leaf:   () => 1,
        Branch: ({ children }) => children + 1,
    });
```

*`$match` vs `Match.valueTags`:* `$match` is destructured from `Data.taggedEnum` and bound to that enum's type. `Match.valueTags` works with any `_tag`-discriminated union including schema classes.

---
## Effect Integration with Traced Dispatch

`Effect.fn` wraps the dispatch function with an automatic tracing span. `$match` routes each variant to an Effect pipeline. `Effect.forEach` provides bounded parallelism over a batch of generic commands.

```typescript
// Reuse Op from above — Effect.fn wraps dispatch with tracing span
const execute = Effect.fn('Op.execute')(
    <A, B>(op: Op<A, B>): Effect.Effect<string> =>
        Effect.succeed(Op.$match(op, {
            Validate:  () => 'validated',
            Transform: ({ format }) => `transformed:${format}`,
            Publish:   ({ target }) => `published:${target}`,
        })),
);
const batch = Effect.forEach(
    [Op.Validate({ input: 42 }), Op.Transform({ input: 42, format: 'json' })],
    execute,
    { concurrency: 3 },
);
```

*Reuse:* `Op` is defined once (Generic Tagged Enum section) and dispatched here with `Effect.fn` tracing. One enum definition, multiple dispatch surfaces.

---
## Companion Object

Wrap `taggedEnum` constructors, `$match`, `$is`, and domain-specific factory methods into a `const+namespace` merge. The namespace carries derived type aliases. For const+namespace merge patterns, see `types.md`.

```typescript
import { Data, Option } from 'effect';

interface StateDef extends Data.TaggedEnum.WithGenerics<2> {
    readonly taggedEnum: {
        readonly Idle:    {};
        readonly Loading: { readonly startedAt: number };
        readonly Ready:   { readonly data: this['A'] };
        readonly Failed:  { readonly error: this['B'] };
    };
}
const _enum = Data.taggedEnum<StateDef>();
// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge (see types.md)
const RemoteData = {
    ..._enum,
    idle:    (): RemoteData<never, never> => _enum.Idle(),
    loading: (startedAt: number): RemoteData<never, never> => _enum.Loading({ startedAt }),
    ready:   <A>(data: A): RemoteData<A, never> => _enum.Ready({ data }),
    failed:  <E>(error: E): RemoteData<never, E> => _enum.Failed({ error }),
    getData: <A, E>(state: RemoteData<A, E>): Option.Option<A> =>
        _enum.$match(state, {
            Idle:    () => Option.none(),
            Loading: () => Option.none(),
            Ready:   ({ data }) => Option.some(data),
            Failed:  () => Option.none(),
        }),
} as const;
type RemoteData<A, E> = Data.TaggedEnum.Value<StateDef, [A, E]>;
namespace RemoteData { export type Of<A = unknown, E = unknown> = RemoteData<A, E>; }
```

*`$match` Inside Companion:* `getData` uses `$match` for exhaustive dispatch without importing `Match`. The companion hides raw constructors (`Idle`, `Loading`) behind ergonomic factories that properly constrain unused generic parameters to `never`.

---
## Decision Table

| [INDEX] | [API]                               | [INPUT]                    | [EXHAUSTIVE] | [BEST_FOR]                             |
| :-----: | ----------------------------------- | -------------------------- | :----------: | -------------------------------------- |
|   [1]   | **`$match(value, cases)`**          | `Data.taggedEnum` instance |     Yes      | Inline dispatch, pure transforms       |
|   [2]   | **`$is(tag)`**                      | `Data.taggedEnum` instance |      No      | Type guards, `.filter`, predicates     |
|   [3]   | **`Match.valueTags(value, cases)`** | Any `_tag` union           |     Yes      | Schema classes, error unions           |
|   [4]   | **`Match.type<T>().pipe(...)`**     | Any type                   |     Yes      | Effect branches, reusable matchers     |
|   [5]   | **`Match.value(v).pipe(...)`**      | Any concrete value         |     Opt      | Structural shapes, compound conditions |
|   [6]   | **`WithGenerics<N>` + `$match`**    | Generic tagged enum        |     Yes      | Type-parameterized dispatch            |
|   [7]   | **Companion Object**                | Generic enum + factories   |     N/A      | Unified export, ergonomic constructors |

*Rule:* `$match` or `Match.valueTags` first (most concise). Escalate to `Match.type` when branches return Effects. Use `WithGenerics` when union needs type parameters. Use `Match.value` for non-tagged structural dispatch.
