# [H1][COMPOSITION]
>**Dictum:** *Compose effects in stable layers; integrate internals automatically.*

<br>

Use compositional patterns that keep public APIs minimal while making internal functionality self-integrating.

---
## [1][COMBINATOR_SELECTION]
>**Dictum:** *Each combinator communicates intent; choose explicitly.*

<br>

| [INDEX] | [COMBINATOR]     | [WHEN]                                       |
| :-----: | ---------------- | -------------------------------------------- |
|   [1]   | `pipe()`         | linear composition                           |
|   [2]   | `Effect.map`     | sync transform (`A -> B`)                    |
|   [3]   | `Effect.flatMap` | dependent effect chaining                    |
|   [4]   | `Effect.andThen` | mixed source chaining                        |
|   [5]   | `Effect.all`     | independent effect aggregation               |
|   [6]   | `Effect.gen`     | multi-step dependent orchestration           |
|   [7]   | `Effect.fn`      | named service methods (tracing + readability) |

[CRITICAL]:
- [NEVER] mix `async/await` in Effect code paths.
- [NEVER] wrap pure transformations in Effect.

---
## [2][LAYER_TOPOLOGY]
>**Dictum:** *Platform -> Infra -> Domain -> App remains the composition backbone.*

<br>

```typescript
const PlatformLayer = Layer.mergeAll(Client.layer, StorageAdapter.S3ClientLayer);
const InfraLayer = Layer.mergeAll(DatabaseService.Default, MetricsService.Default)
    .pipe(Layer.provideMerge(PlatformLayer));
const AppLayer = Layer.mergeAll(AuthService.Default, FeatureService.Default)
    .pipe(Layer.provideMerge(InfraLayer));
```

[IMPORTANT]:
- [ALWAYS] Put registration layers inside the owning service module.
- [ALWAYS] Prefer `Layer.mergeAll` + `Layer.provideMerge` for deterministic assembly.

---
## [3][AUTO_REGISTRATION_COMPOSITION]
>**Dictum:** *Registries reduce manual composition edits and drift.*

<br>

Use [SNIP-02](./snippets.md#snip-02auto_integration_registry) as the default registration form.

[IMPORTANT]:
- [ALWAYS] Keep the registry readonly and local to module scope.
- [ALWAYS] Perform registration in `Layer.effectDiscard`.
- [ALWAYS] Iterate registry keys with `Effect.forEach`.

---
## [4][CONCURRENCY_PRIMITIVES]
>**Dictum:** *Use Effect concurrency modules instead of ad hoc state machines.*

<br>

| [INDEX] | [CONCERN]                 | [API]                        |
| :-----: | ------------------------- | ---------------------------- |
|   [1]   | transactional shared map  | `STM.commit(TMap.*)`         |
|   [2]   | keyed background work     | `FiberMap.make/run/remove`   |
|   [3]   | buffered stream pipelines | `Stream.buffer`              |
|   [4]   | time-window batching      | `Stream.groupedWithin`       |
|   [5]   | async retry policy        | `Schedule` composition       |

[CRITICAL]:
- [NEVER] maintain manual `Map<string, Fiber>` lifecycle logic.
- [NEVER] hand-roll transactional lock layers around mutable maps.

---
## [5][NO_IF_BRANCHING]
>**Dictum:** *Closed control flow uses algebraic matchers and options, not `if`.*

<br>

```typescript
const classify = (value: Option.Option<string>) =>
    Option.match(value, {
        onNone: () => 'missing',
        onSome: (text) => text,
    });
```

```typescript
const route = (event: Event) => Match.type<Event>().pipe(
    Match.tag('Started', () => onStarted),
    Match.tag('Stopped', () => onStopped),
    Match.exhaustive,
)(event);
```

[CRITICAL]:
- [NEVER] `if (...)` for variant dispatch.
- [NEVER] `Effect.if(...)`.

---
## [6][SURFACE_STABILITY]
>**Dictum:** *Composition should increase behavior, not public method count.*

<br>

Use [SNIP-03](./snippets.md#snip-03capability_groups) for stable capability facades while evolving internals through registrations and command variants.
