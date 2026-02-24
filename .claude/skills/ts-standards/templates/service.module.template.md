# [H1][SERVICE_MODULE_TEMPLATE]
>**Dictum:** *Capability-grouped services own lifecycle, dependencies, and traced methods.*

Use when building a domain service: scoped resource acquisition, traced capability methods, typed error algebra, and layer assembly. One service class per module; 225 LOC cap enforced.

---

## Placeholders

| [INDEX] | [PLACEHOLDER]       | [EXAMPLE]                    | [NOTES]                                      |
| :-----: | ------------------- | ---------------------------- | -------------------------------------------- |
|   [1]   | `${Service}`        | `NotificationService`        | PascalCase service name                      |
|   [2]   | `${namespace}`      | `domain/NotificationService` | Fully qualified service tag string           |
|   [3]   | `${Resource}`       | `NotificationChannel`        | Managed resource type acquired at scope open |
|   [4]   | `${openResource()}` | `openNotificationChannel()`  | Promise/Effect producing the resource handle |
|   [5]   | `${table}`          | `notifications`              | Database table or domain noun                |
|   [6]   | `${reasons}`        | `'persist', 'deliver', ...`  | Polymorphic error `reason` literals          |

---

```typescript
import { Data, Effect, Layer, Match, Option, Schedule, Stream, pipe } from 'effect';
import { SqlClient } from '@effect/sql';
import { EventBusService } from '../platform/event-bus';
// --- [TYPES] -----------------------------------------------------------------
type ${Resource} = {
    readonly push:  (payload: unknown) => Effect.Effect<void>;
    readonly close: Effect.Effect<void>;
};
// --- [ERRORS] ----------------------------------------------------------------
// why: one polymorphic error -- reason field collapses operation-specific failures;
//      from() wraps unknown causes while passing through known typed errors
class ${Service}Error extends Data.TaggedError('${Service}Error')<{
    readonly operation: string;
    readonly reason:    ${reasons};
    readonly details?:  string;
    readonly cause?:    unknown;
}> {
    override get message() {
        return `${Service}Error[${this.operation}/${this.reason}]${this.details ? `: ${this.details}` : ''}`;
    }
    static readonly from = (operation: string) => (cause: unknown): ${Service}Error =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(${Service}Error), (e) => e),
            Match.orElse((e) => new ${Service}Error({ cause: e, operation, reason: 'upstream' })),
        );
}
// --- [CONSTANTS] -------------------------------------------------------------
const _RETRY = Schedule.exponential('100 millis', 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)),
    Schedule.upTo('30 seconds'),
);
// --- [SERVICES] --------------------------------------------------------------
class ${Service} extends Effect.Service<${Service}>()(
    '${namespace}',
    {
        dependencies: [EventBusService.Default],
        scoped: Effect.gen(function* () {
            const sql    = yield* SqlClient.SqlClient;
            const events = yield* EventBusService;
            // why: acquireRelease owns the resource lifecycle -- release on scope exit
            const channel = yield* Effect.acquireRelease(
                Effect.tryPromise({
                    try:   () => ${openResource()},
                    catch: ${Service}Error.from('channel.open'),
                }),
                (handle) => handle.close.pipe(Effect.orDie),
            );
            // --- write capabilities -----------------------------------------
            const send = Effect.fn('${Service}.send')(
                function* (recipientId: string, payload: unknown) {
                    yield* sql`
                        INSERT INTO ${table} (recipient_id, payload, sent_at)
                        VALUES (${recipientId}, ${JSON.stringify(payload)}, NOW())
                    `.pipe(Effect.mapError(${Service}Error.from('send.persist')));
                    yield* channel.push(payload).pipe(
                        Effect.retry(_RETRY),
                        Effect.mapError(${Service}Error.from('send.deliver')),
                    );
                },
            );
            const sendBatch = Effect.fn('${Service}.sendBatch')(
                (items: ReadonlyArray<{ recipientId: string; payload: unknown }>) =>
                    Effect.forEach(
                        items,
                        (item) => send(item.recipientId, item.payload),
                        { concurrency: 10 },
                    ),
            );
            // --- read capabilities ------------------------------------------
            const history = Effect.fn('${Service}.history')(
                function* (recipientId: string, limit: number) {
                    return yield* sql<{
                        id: string; recipient_id: string; payload: string; sent_at: Date;
                    }>`
                        SELECT id, recipient_id, payload, sent_at
                        FROM ${table}
                        WHERE recipient_id = ${recipientId}
                        ORDER BY sent_at DESC
                        LIMIT ${limit}
                    `.pipe(Effect.mapError(${Service}Error.from('history.query')));
                },
            );
            // --- observe capabilities ----------------------------------------
            const observe = Effect.fn('${Service}.observe')(
                function* (recipientId: string) {
                    return yield* pipe(
                        events.subscribe(`${table}:${recipientId}`),
                        Stream.mapEffect((raw) =>
                            Effect.try({
                                try:   () => JSON.parse(raw as string) as unknown,
                                catch: ${Service}Error.from('observe.decode'),
                            }),
                        ),
                        Effect.succeed,
                    );
                },
            const drop = Effect.fn('${Service}.drop')(
                function* (recipientId: string) {
                    return yield* sql<{ count: number }>`
                        DELETE FROM ${table}
                        WHERE recipient_id = ${recipientId}
                        RETURNING 1
                    `.pipe(
                        Effect.map((rows) => rows.length),
                        Effect.mapError(${Service}Error.from('drop.execute')),
                    );
                },
            );
            return {
                write:   { send, sendBatch, drop } as const,
                read:    { history } as const,
                observe: { observe } as const,
            };
            };
        }),
    },
) {}
// --- [LAYERS] ----------------------------------------------------------------
const ${Service}Live: Layer.Layer<${Service}, never, SqlClient.SqlClient> = ${Service}.Default;
// why: test double via Layer.succeed -- no mocks, real typed contract
const ${Service}Test: Layer.Layer<${Service}> = Layer.succeed(
    ${Service},
    ${Service}.make({
        write:   {
            send:      (_recipientId, _payload) => Effect.void,
            sendBatch: (_items) => Effect.void,
        },
        read:    {
            history: (_recipientId, _limit) => Effect.succeed([]),
        },
        observe: {
            observe: (_recipientId) => Effect.succeed(Stream.empty),
            drop:    (_recipientId) => Effect.succeed(0),
        },
    }),
);
// --- [EXPORT] ----------------------------------------------------------------
// biome-ignore lint/correctness/noUnusedVariables: namespace merge pattern -- type-only members
namespace ${Service} {
    // why: InstanceType exposes the yielded shape without re-declaring capability groups
    export type Shape = InstanceType<typeof ${Service}>;
}
export { ${Service}Error, ${Service}, ${Service}Live, ${Service}Test };
```

---

## Post-Scaffold Checklist

- [ ] All `${...}` placeholders replaced with domain-specific values
- [ ] `dependencies` array matches every `yield*` dep in `scoped`
- [ ] `Effect.acquireRelease` wraps every external connection/handle
- [ ] All methods traced via `Effect.fn('ServiceName.method')`
- [ ] Capabilities returned as grouped `{ write, read, observe } as const`
- [ ] Polymorphic error uses `reason` literal union with `from()` factory
- [ ] No `if`/`else`/`switch` -- use `Match.type`, `Option.match`, `Effect.filterOrFail`
- [ ] Namespace merge present on `${Service}` class -- exposes `Shape` type for consumers
- [ ] Layer alias typed explicitly for consumer clarity
- [ ] Test double uses `Layer.succeed(Tag, X.make({...}))` -- no mocks
- [ ] `pnpm exec nx run-many -t typecheck` passes
