# [H1][SERVICE_MODULE_TEMPLATE]
>**Dictum:** *Own boundary orchestration with one service contract, scoped resources, and operation-tagged failures.*

Use when a module coordinates persistence, transport, or external APIs.

Placeholders:
- `${Service}`: service/tag class name.
- `${service}`: service identifier string.
- `${table}`: SQL table identifier.
- `${topicPrefix}`: stream/topic prefix.
- `${openResource}`: effect expression that acquires transport client.
- `${ReasonLiterals}`: include `'persist' | 'publish' | 'decode' | 'upstream'`.

Instantiation rules:
- Keep one `Effect.Service` with grouped capability objects.
- Keep `acquireRelease` for resource lifecycle.
- Keep one tagged failure rail and map every boundary operation.

```typescript
import { Data, Effect, Layer, Match, Schedule, Schema as S, Stream, pipe } from 'effect';
import { SqlClient } from '@effect/sql';

const _Envelope = S.Struct({
    recipientId: S.String,
    payload:     S.Unknown,
    sentAt:      S.Number,
});
const _decodeEnvelope = S.decodeUnknown(_Envelope);
class _${Service}Failure extends Data.TaggedError('${Service}Failure')<{
    readonly operation: string;
    readonly reason: ${ReasonLiterals};
    readonly details?: string;
    readonly cause?: unknown;
}> {
    static readonly from = (operation: string) => (cause: unknown): _${Service}Failure =>
        Match.value(cause).pipe(
            Match.when(Match.instanceOf(_${Service}Failure), (known) => known),
            Match.orElse((unknown) => new _${Service}Failure({ operation, reason: 'upstream', cause: unknown })),
        );
}
const _RETRY = Schedule.exponential('50 millis', 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(5)),
    Schedule.upTo('15 seconds'),
);
class ${Service} extends Effect.Service<${Service}>()('${service}', {
    scoped: Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const resource = yield* Effect.acquireRelease(
            (${openResource}).pipe(Effect.mapError(_${Service}Failure.from('resource.open'))),
            (handle) => handle.close.pipe(Effect.orDie),
        );
        const send = Effect.fn('${Service}.send')((recipientId: string, payload: unknown) =>
            pipe(
                Effect.sync(() => JSON.stringify(payload)),
                Effect.flatMap((serialized) =>
                    sql`
                        INSERT INTO ${table} (recipient_id, payload, sent_at)
                        VALUES (${recipientId}, ${serialized}, NOW())
                    `.pipe(Effect.mapError(_${Service}Failure.from('send.persist')), Effect.as(serialized)),
                ),
                Effect.flatMap((serialized) =>
                    resource.publish(`${topicPrefix}:${recipientId}`, serialized).pipe(
                        Effect.retry(_RETRY),
                        Effect.mapError(_${Service}Failure.from('send.publish')),
                    ),
                ),
            ),
        );
        const sendMany = Effect.fn('${Service}.sendMany')(
            (items: ReadonlyArray<{ readonly recipientId: string; readonly payload: unknown }>) =>
                Effect.forEach(items, (item) => send(item.recipientId, item.payload), { concurrency: 8 }),
        );
        const history = Effect.fn('${Service}.history')((recipientId: string, limit: number) =>
            sql<{ readonly id: string; readonly recipient_id: string; readonly payload: string; readonly sent_at: Date }>`
                SELECT id, recipient_id, payload, sent_at
                FROM ${table}
                WHERE recipient_id = ${recipientId}
                ORDER BY sent_at DESC
                LIMIT ${limit}
            `.pipe(Effect.mapError(_${Service}Failure.from('history.query'))),
        );
        const purge = Effect.fn('${Service}.purge')((recipientId: string) =>
            sql<{ readonly id: string }>`
                DELETE FROM ${table}
                WHERE recipient_id = ${recipientId}
                RETURNING id
            `.pipe(Effect.map((rows) => rows.length), Effect.mapError(_${Service}Failure.from('purge.execute'))),
        );
        const observe = Effect.fn('${Service}.observe')((recipientId: string) =>
            pipe(
                resource.subscribe(`${topicPrefix}:${recipientId}`),
                Stream.mapEffect((raw) =>
                    pipe(raw, _decodeEnvelope, Effect.mapError(_${Service}Failure.from('observe.decode'))),
                ),
            ),
        );

        return {
            write: { send, sendMany, purge } as const,
            read: { history } as const,
            observe: { observe } as const,
        };
    }),
}) {}

const ${Service}Live: Layer.Layer<${Service}, never, SqlClient.SqlClient> = ${Service}.Default;

const ${Service}Test: Layer.Layer<${Service}> = Layer.succeed(
    ${Service},
    ${Service}.make({
        write: {
            send: (_recipientId, _payload) => Effect.void,
            sendMany: (_items) => Effect.void,
            purge: (_recipientId) => Effect.succeed(0),
        },
        read: {
            history: (_recipientId, _limit) => Effect.succeed([]),
        },
        observe: {
            observe: (_recipientId) => Effect.succeed(Stream.empty),
        },
    }),
);

const ${Service}Module = {
    Service: ${Service},
    Live: ${Service}Live,
    Test: ${Service}Test,
    Envelope: _Envelope,
    Failure: _${Service}Failure,
} as const;

export { ${Service}, ${Service}Live, ${Service}Test, ${Service}Module };
```
