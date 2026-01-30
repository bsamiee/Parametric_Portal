# [H1][EVENT_RESEARCH]
>**Dictum:** *@effect/experimental Event APIs for event-sourced multi-tenant systems.*

---
## [1][OVERVIEW]

| [MODULE]              | [PURPOSE]                                  | [KEY_EXPORTS]                              |
| --------------------- | ------------------------------------------ | ------------------------------------------ |
| `Event`               | Schema-driven event definition             | `Event.make`, `Payload<A>`, `Success<A>`   |
| `EventGroup`          | Domain event aggregation                   | `EventGroup.empty`, `add()`, `addError()`  |
| `EventJournal`        | Local/remote entry persistence             | `Entry`, `EntryId`, `makeMemory`           |
| `EventLog`            | Event sourcing orchestration               | `schema()`, `group()`, `makeClient()`      |
| `EventLogEncryption`  | Tenant-scoped AES-GCM encryption           | `makeEncryptionSubtle`, `EncryptedEntry`   |
| `EventLogRemote`      | WebSocket/Socket client for distributed    | `fromWebSocket`, `layerWebSocketBrowser`   |
| `EventLogServer`      | Server-side handler + storage              | `makeHandler`, `makeStorageMemory`         |

---
## [2][EVENT_DEFINITION]

```typescript
import { Event, EventGroup, Schema as S } from '@effect/experimental';

// --- [SCHEMA] ----------------------------------------------------------------

const UserCreated = Event.make({
  tag: 'UserCreated',
  primaryKey: (p: { userId: string }) => p.userId,
  payload: S.Struct({ userId: S.String, email: S.String, tenantId: S.String }),
  success: S.Struct({ createdAt: S.DateFromSelf }),
});

const UserDeleted = Event.make({
  tag: 'UserDeleted',
  primaryKey: (p: { userId: string }) => p.userId,
  payload: S.Struct({ userId: S.String, reason: S.optional(S.String) }),
});

const UserEvents = EventGroup.empty.add(UserCreated).add(UserDeleted);

// --- [TYPES] -----------------------------------------------------------------

type UserCreatedPayload = Event.Payload<typeof UserCreated>;
type UserEventsUnion = EventGroup.Events<typeof UserEvents>;
```

**[KEY_POINTS]:**
- `primaryKey` derives unique identifier for conflict resolution and compaction
- `payload` encodes via MessagePack; `success`/`error` model handler outcomes
- `EventGroup.Events<G>` extracts discriminated union of all events

---
## [3][EVENT_JOURNAL]

```typescript
import { EventJournal } from '@effect/experimental';
import { Effect } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const entryId = EventJournal.makeEntryId();
const millis = EventJournal.entryIdMillis(entryId);
const remoteId = EventJournal.makeRemoteId();

// --- [LAYERS] ----------------------------------------------------------------

const JournalMemory = EventJournal.layerMemory;
const JournalIndexedDb = EventJournal.layerIndexedDb({ dbName: 'tenant-events' });

// --- [SERVICES] --------------------------------------------------------------

const writeEntry = Effect.gen(function* () {
  const journal = yield* EventJournal.EventJournal;
  yield* journal.write({
    events: [/* serialized events */],
    effect: Effect.succeed({ conflicts: [], commit: true }),
  });
});

const watchChanges = Effect.gen(function* () {
  const journal = yield* EventJournal.EventJournal;
  const queue = yield* journal.changes; // Queue<Entry>
});

const syncFromRemote = (remoteId: EventJournal.RemoteId) =>
  Effect.gen(function* () {
    const journal = yield* EventJournal.EventJournal;
    yield* journal.writeFromRemote({ remoteId, entries: [], compact: true });
  });
```

**[KEY_POINTS]:**
- `Entry` tracks local events; `RemoteEntry` adds sequence/IV for remote sync
- `writeFromRemote` handles multi-source conflict resolution
- `changes` provides `Queue<Entry>` for reactive subscriptions

---
## [4][EVENT_LOG_ORCHESTRATION]

```typescript
import { Event, EventGroup, EventLog } from '@effect/experimental';
import { Effect, Layer, Schema as S } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ProjectEvents = EventGroup.empty
  .add(Event.make({
    tag: 'ProjectCreated',
    primaryKey: (p) => p.projectId,
    payload: S.Struct({ projectId: S.String, tenantId: S.String, name: S.String }),
    success: S.Struct({ createdAt: S.DateFromSelf }),
  }))
  .add(Event.make({
    tag: 'ProjectArchived',
    primaryKey: (p) => p.projectId,
    payload: S.Struct({ projectId: S.String, archivedBy: S.String }),
  }));

const ProjectLogSchema = EventLog.schema(ProjectEvents);

// --- [SERVICES] --------------------------------------------------------------

const ProjectHandlersLayer = EventLog.group(ProjectEvents, (handlers) =>
  handlers
    .handle('ProjectCreated', ({ payload, entry }) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(`Project ${payload.projectId} created`);
        return { createdAt: new Date() };
      }))
    .handle('ProjectArchived', ({ payload, conflicts }) =>
      Effect.gen(function* () {
        if (conflicts.length > 0) yield* Effect.logWarning('Concurrent archive');
        return undefined;
      })),
);

const ProjectCompactionLayer = EventLog.groupCompaction(ProjectEvents, ({ primaryKey, events }) =>
  Effect.sync(() => {
    const latest = events.reduce((acc, e) => ({ ...acc, [primaryKey(e)]: e }), {});
    return Object.values(latest);
  }),
);

const ProjectReactivityLayer = EventLog.groupReactivity(ProjectEvents, (r) =>
  r.on('ProjectCreated', ['tenantId']).on('ProjectArchived', ['projectId']),
);

// --- [FUNCTIONS] -------------------------------------------------------------

const publishProject = Effect.gen(function* () {
  const publish = yield* EventLog.makeClient(ProjectLogSchema);
  yield* publish('ProjectCreated', { projectId: 'proj_123', tenantId: 'tenant_abc', name: 'New' });
});

// --- [LAYERS] ----------------------------------------------------------------

const ProjectEventLogLayer = Layer.mergeAll(
  EventLog.layerEventLog,
  EventLog.layer(ProjectLogSchema),
  ProjectHandlersLayer,
  ProjectCompactionLayer,
  ProjectReactivityLayer,
);
```

**[KEY_POINTS]:**
- `handlers.handle(tag, fn)` receives `payload`, `entry`, `conflicts`
- `groupCompaction` defines cleanup strategy (essential for storage efficiency)
- `groupReactivity` establishes cache invalidation subscriptions
- `makeClient` returns typed publish function for schema events

---
## [5][ENCRYPTION_LAYER]

```typescript
import { EventLogEncryption } from '@effect/experimental';
import { Effect, Layer } from 'effect';
import { Crypto } from '../security/crypto.ts';

// --- [SCHEMA] ----------------------------------------------------------------

// EncryptedEntry: { entryId: Uint8Array, encryptedEntry: Uint8Array }
// EncryptedRemoteEntry: { entryId, encryptedEntry, sequence: number, iv: Uint8Array }

// --- [LAYERS] ----------------------------------------------------------------

const EncryptionLayer = EventLogEncryption.layerSubtle;

// --- [SERVICES] --------------------------------------------------------------

const encryptForTenant = (tenantId: string, plaintext: Uint8Array) =>
  Effect.gen(function* () {
    const svc = yield* Crypto.Service;
    const key = yield* svc.deriveKey(tenantId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = yield* Effect.promise(() =>
      crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext),
    );
    return { ciphertext: new Uint8Array(ciphertext), iv };
  });

const TenantEncryptionLayer = Layer.effect(
  EventLogEncryption.EventLogEncryption,
  Effect.gen(function* () {
    const cryptoSvc = yield* Crypto.Service;
    return {
      encrypt: (tenantId: string, data: Uint8Array) => encryptForTenant(tenantId, data),
      decrypt: (tenantId: string, ciphertext: Uint8Array, iv: Uint8Array) =>
        Effect.gen(function* () {
          const key = yield* cryptoSvc.deriveKey(tenantId);
          const plaintext = yield* Effect.promise(() =>
            crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
          );
          return new Uint8Array(plaintext);
        }),
    };
  }),
);
```

**[KEY_POINTS]:**
- `layerSubtle` uses global SubtleCrypto (Web Crypto API)
- `EncryptedRemoteEntry` includes IV for distributed decryption
- Integrate with tenant key derivation for isolation (HKDF pattern)
- Each entry gets unique IV; tenant key derived from master via HKDF

---
## [6][REMOTE_CLIENT]

```typescript
import { EventLogRemote } from '@effect/experimental';
import { Effect } from 'effect';

// --- [PROTOCOL] --------------------------------------------------------------
// Request: WriteEntries, RequestChanges, StopChanges, ChunkedMessage, Ping
// Response: Hello, Ack, Changes, Pong, ChunkedMessage

// --- [LAYERS] ----------------------------------------------------------------

const RemoteBrowserLayer = EventLogRemote.layerWebSocketBrowser;
const RemoteNodeLayer = EventLogRemote.layerWebSocket;

// --- [SERVICES] --------------------------------------------------------------

const connectToServer = (url: string) =>
  Effect.gen(function* () {
    const remote = yield* EventLogRemote.fromWebSocket(url, {
      ping: { interval: 30_000, timeout: 5_000 },
    });
    const changes = yield* remote.changes(0);
    yield* remote.write([/* entries */]);
    return remote.id;
  });
```

**[KEY_POINTS]:**
- `changes(sequence)` subscribes from specific sequence number
- `write(entries)` persists to remote with Ack response
- MsgPack protocol with automatic chunk fragmentation

---
## [7][SERVER_HANDLER]

```typescript
import { EventLogServer } from '@effect/experimental';
import { Effect, Layer } from 'effect';

// --- [STORAGE] ---------------------------------------------------------------
// PersistedEntry: { sequence, encryptedEntry, entryId }
// Keyed by public key (Identity) for multi-tenant isolation

// --- [LAYERS] ----------------------------------------------------------------

const StorageMemoryLayer = EventLogServer.layerStorageMemory;

// --- [SERVICES] --------------------------------------------------------------

const createHandler = Effect.gen(function* () {
  const handler = yield* EventLogServer.makeHandler;
  return handler; // (socket: Socket) => Effect<void>
});

const createHttpHandler = Effect.gen(function* () {
  return yield* EventLogServer.makeHandlerHttp; // HttpServerResponse
});

const makeCustomStorage = Effect.gen(function* () {
  const storage = yield* EventLogServer.makeStorageMemory;
  return {
    getId: storage.getId,
    write: (pk: Uint8Array, entries: EventLogServer.EncryptedRemoteEntry[]) =>
      storage.write(pk, entries),
    entries: (pk: Uint8Array, seq: number) => storage.entries(pk, seq),
    changes: (pk: Uint8Array) => storage.changes(pk),
  };
});
```

**[KEY_POINTS]:**
- `makeHandler` creates socket handler requiring `Storage` dependency
- `makeHandlerHttp` integrates with Effect Platform HTTP server
- Storage keyed by public key (Identity) enables tenant isolation

---
## [8][MULTI_TENANT_COMPOSITION]

```typescript
import { Event, EventGroup, EventLog, EventLogEncryption, EventLogServer } from '@effect/experimental';
import { Effect, Layer, Schema as S } from 'effect';
import { Crypto } from '../security/crypto.ts';

// --- [SCHEMA] ----------------------------------------------------------------

const TenantEvents = EventGroup.empty
  .add(Event.make({
    tag: 'TenantProvisioned',
    primaryKey: (p) => p.tenantId,
    payload: S.Struct({ tenantId: S.String, plan: S.Literal('free', 'pro', 'enterprise') }),
    success: S.Struct({ provisionedAt: S.DateFromSelf }),
  }))
  .add(Event.make({
    tag: 'TenantSuspended',
    primaryKey: (p) => p.tenantId,
    payload: S.Struct({ tenantId: S.String, reason: S.String }),
  }));

const TenantLogSchema = EventLog.schema(TenantEvents);

// --- [SERVICES] --------------------------------------------------------------

const TenantHandlersLayer = EventLog.group(TenantEvents, (handlers) =>
  handlers
    .handle('TenantProvisioned', ({ payload }) =>
      Effect.gen(function* () {
        yield* Effect.logInfo(`Provisioning: ${payload.tenantId}`);
        return { provisionedAt: new Date() };
      }))
    .handle('TenantSuspended', ({ payload }) =>
      Effect.gen(function* () {
        yield* Effect.logWarning(`Suspending: ${payload.tenantId}`);
        return undefined;
      })),
);

// --- [LAYERS] ----------------------------------------------------------------

const TenantEncryptionLayer = Layer.effect(
  EventLogEncryption.EventLogEncryption,
  Effect.gen(function* () {
    yield* Crypto.Service;
    return EventLogEncryption.makeEncryptionSubtle(crypto);
  }).pipe(Effect.flatten),
);

const MultiTenantEventLogLayer = Layer.mergeAll(
  EventLog.layerEventLog,
  EventLog.layer(TenantLogSchema),
  TenantHandlersLayer,
  TenantEncryptionLayer,
  EventLogServer.layerStorageMemory,
  Crypto.Service.Default,
);

// --- [FUNCTIONS] -------------------------------------------------------------

const provisionTenant = (tenantId: string, plan: 'free' | 'pro' | 'enterprise') =>
  Effect.gen(function* () {
    const publish = yield* EventLog.makeClient(TenantLogSchema);
    const result = yield* publish('TenantProvisioned', { tenantId, plan });
    return result.provisionedAt;
  });

const program = provisionTenant('tenant_abc', 'pro').pipe(
  Effect.provide(MultiTenantEventLogLayer),
);
```

**[KEY_POINTS]:**
- Encryption layer integrates existing `Crypto.Service` for HKDF derivation
- Storage keyed by Identity public key (per-tenant isolation)
- Layer composition enables swappable backends (memory -> PostgreSQL)

---
## [9][REFERENCE]

| [API]                              | [SIGNATURE]                                           | [RETURNS]                   |
| ---------------------------------- | ----------------------------------------------------- | --------------------------- |
| `Event.make`                       | `(options) => Event<Tag,Payload,Success,Error>`       | Event definition            |
| `EventGroup.empty`                 | `EventGroup<never>`                                   | Empty group                 |
| `EventGroup.add`                   | `(event) => EventGroup<Events \| Event>`              | Extended group              |
| `EventJournal.makeEntryId`         | `(options?) => EntryId`                               | Branded Uint8Array          |
| `EventJournal.layerMemory`         | `Layer<EventJournal>`                                 | In-memory journal           |
| `EventJournal.layerIndexedDb`      | `(options?) => Layer<EventJournal>`                   | Browser persistence         |
| `EventLog.schema`                  | `(...groups) => EventLogSchema`                       | Schema from groups          |
| `EventLog.group`                   | `(group, handlers) => Layer`                          | Handler layer               |
| `EventLog.makeClient`              | `(schema) => Effect<PublishFn>`                       | Typed publish function      |
| `EventLogEncryption.layerSubtle`   | `Layer<EventLogEncryption>`                           | SubtleCrypto encryption     |
| `EventLogRemote.fromWebSocket`     | `(url, options?) => Effect<EventLogRemote>`           | WebSocket client            |
| `EventLogRemote.layerWebSocketBrowser` | `Layer<EventLogRemote>`                           | Browser WebSocket layer     |
| `EventLogServer.makeHandler`       | `Effect<(socket) => Effect<void>, Storage>`           | Socket handler              |
| `EventLogServer.makeHandlerHttp`   | `Effect<HttpServerResponse, ..., HttpServerRequest>`  | HTTP upgrade handler        |
| `EventLogServer.layerStorageMemory`| `Layer<Storage>`                                      | In-memory storage           |

---
## [10][INTEGRATION_NOTES]

**[CODEBASE_ALIGNMENT]:**
1. `Crypto.Service` provides HKDF tenant key derivation - reuse for `EventLogEncryption`
2. `Context.Request.tenantId` available in request context - use as primaryKey prefix
3. Existing `Telemetry.span` pattern applies to event handlers
4. `HttpError` namespace can extend with event-specific errors via `Data.TaggedError`

**[LAYER_COMPOSITION]:**
```typescript
const AppLayer = Layer.mergeAll(
  Crypto.Service.Default,
  MultiTenantEventLogLayer,
);
```

**[SCHEMA_ALIGNMENT]:**
- Event payloads derive types via `typeof EventSchema.Type` (per CLAUDE.md)
- Use `S.brand()` for domain primitives (TenantId, ProjectId)
- Decode at boundaries via Schema - events already enforce this pattern

---
## [11][TESTING]

```typescript
import { EventJournal, EventLogServer } from '@effect/experimental';
import { Layer } from 'effect';

const TestEventLogLayer = Layer.mergeAll(
  EventJournal.layerMemory,
  EventLogServer.layerStorageMemory,
);
// Reset state between tests via Scope; journal.destroy cleans up resources
```
