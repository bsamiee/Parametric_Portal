# [H1][SERVICE]
>**Dictum:** *Capability-grouped services centralize dependency, lifecycle, and composition.*

<br>

Produces one self-contained service module: dependency tag(s), scoped resource acquisition, traced methods, stream batch processing, retry policy, and a single layer assembly point.

**Workflow:** fill placeholders, remove guidance comments, verify `tsc --noEmit`.

**Placeholders**

| [INDEX] | [PLACEHOLDER]           | [PURPOSE]                                             |
| :-----: | ----------------------- | ----------------------------------------------------- |
|   [1]   | `${ServiceName}`        | PascalCase service class name                         |
|   [2]   | `${service-tag}`        | Fully qualified service tag string                    |
|   [3]   | `${DepTag}`             | Primary dependency context tag (PascalCase)           |
|   [4]   | `${dep-tag}`            | String identifier for dependency tag                  |
|   [5]   | `${dep-interface}`      | Dependency interface fields (read/write capabilities) |
|   [6]   | `${resource-acquire}`   | Effect producing managed resource handle              |
|   [7]   | `${resource-release}`   | Finalizer effect consuming resource handle            |
|   [8]   | `${service-methods}`    | Traced service method definitions (`Effect.fn`)       |
|   [9]   | `${stream-source-type}` | Type of elements in inbound stream                    |
|  [10]   | `${stream-process}`     | Element-to-Effect function for batch processing       |
|  [11]   | `${dep-layer}`          | Layer expression providing the dependency             |
|  [12]   | `${read-return}`        | Destructured read methods for return object           |
|  [13]   | `${write-return}`       | Destructured write methods for return object          |
|  [14]   | `${static-delegate}`    | Static delegate name                                  |
|  [15]   | `${static-body}`        | Effect expression accessing instance method           |

```typescript
import { Context, Data, Duration, Effect, Layer, Option, Schedule, STM, Stream, TMap, Schema as S } from 'effect';

// --- [ERRORS] ----------------------------------------------------------------

class ${ServiceName}Error extends Data.TaggedError('${ServiceName}Error')<{
    readonly operation: string;
    readonly cause:     unknown;
}> {}

// --- [DEPENDENCY] ------------------------------------------------------------

const ${DepTag} = Context.GenericTag<{${dep-interface}}>('${dep-tag}');

// --- [SERVICE] ---------------------------------------------------------------

class ${ServiceName} extends Effect.Service<${ServiceName}>()('${service-tag}', {
    dependencies: [${DepTag}],
    scoped: Effect.gen(function* () {
        const store = yield* ${DepTag};
        const resource = yield* Effect.acquireRelease(
            ${resource-acquire},
            (handle) => ${resource-release},
        );
        const state = yield* STM.commit(TMap.empty<string, unknown>());
        ${service-methods}
        const processBatch = (batch: Iterable<${stream-source-type}>) => Effect.forEach(batch, ${stream-process}, { concurrency: 12, discard: true });
        const drain = Effect.fn('${ServiceName}.drain')(function* (source: Stream.Stream<${stream-source-type}>) {
            yield* source.pipe(
                Stream.groupedWithin(64, Duration.seconds(1)),
                Stream.mapEffect(processBatch, { concurrency: 4 }),
                Stream.runDrain,
                Effect.retry({
                    schedule: Schedule.exponential(Duration.millis(80), 2).pipe(
                        Schedule.jittered,
                        Schedule.intersect(Schedule.recurs(5)),
                        Schedule.upTo(Duration.seconds(10)),
                    ),
                }),
            );
        });
        yield* Effect.addFinalizer(() => Effect.log('${ServiceName} shutting down'));
        yield* Effect.log('${ServiceName} initialized');
        return { observe: { drain }, read: { ${read-return} }, write: { ${write-return} } } as const;
    }),
}) {
    static readonly ${static-delegate} = ${ServiceName}.pipe(Effect.andThen((s) => ${static-body}),);
}

// --- [LAYER] -----------------------------------------------------------------

const ${ServiceName}Layer = ${ServiceName}.Default.pipe(Layer.provideMerge(${dep-layer}),);

export { ${ServiceName}, ${ServiceName}Error };
```

**Guidance: `${dep-interface}`**
```typescript
readonly findById: (id: string) => Effect.Effect<Option.Option<Record<string, unknown>>>;
readonly persist:  (id: string, data: Record<string, unknown>) => Effect.Effect<void>;
readonly remove:   (id: string) => Effect.Effect<void>;
```

**Guidance: `${service-methods}`**
```typescript
const findOne = Effect.fn('${ServiceName}.findOne')(function* (id: string) {
    const cached = yield* STM.commit(TMap.get(state, id));
    return yield* Option.match(cached, { onNone: () => store.findById(id), onSome: Effect.succeed });
});
const save = Effect.fn('${ServiceName}.save')(function* (id: string, data: Record<string, unknown>) {
    yield* store.persist(id, data);
    yield* STM.commit(TMap.set(state, id, data));
});
```
