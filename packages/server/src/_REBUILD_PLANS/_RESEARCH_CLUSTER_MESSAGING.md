# @effect/cluster Message and Storage APIs Research

**Version:** 0.56.1+ | **Updated:** 2026-01-30 | **Scope:** Message persistence, deduplication, and at-least-once delivery for entity-based job processing

---

## [1] Core Exports

```typescript
import { MessageStorage, SqlMessageStorage } from '@effect/cluster'
import { Message, Reply, Envelope, Snowflake, MachineId, SocketRunner } from '@effect/cluster'
import type { SaveResult, ReplyWithContext, OutgoingRequest, IncomingRequest } from '@effect/cluster'
```

| Export | Description |
|--------|-------------|
| `MessageStorage` | Interface contract for message persistence operations |
| `SqlMessageStorage` | SQL-backed implementation with deduplication support |
| `Message` | Outgoing/Incoming message types for entity communication |
| `Reply` | Response types: `WithExit` (terminal) or `Chunk` (streaming) |
| `Envelope` | Request envelope with address, tag, payload, and tracing metadata |
| `Snowflake` | Distributed unique ID generator (42-bit timestamp, 10-bit machine, 12-bit sequence) |
| `MachineId` | Branded integer for machine identification in Snowflake generation |
| `SocketRunner` | Socket-based transport layer for entity communication |

---

## [2] MessageStorage

**Purpose:** Interface contract for persistent message storage enabling at-least-once delivery and deduplication.

### Type Signatures

```typescript
// --- [SaveResult] ------------------------------------------------------------
type SaveResult<R extends Rpc.Any> = SaveResult.Success | SaveResult.Duplicate<R>

interface Success {
  readonly _tag: "Success"
}

interface Duplicate<R extends Rpc.Any> {
  readonly _tag: "Duplicate"
  readonly originalId: Snowflake.Snowflake
  readonly lastReceivedReply: Option.Option<Reply.Reply<R>>
}

// --- [MessageStorage Service] ------------------------------------------------
interface MessageStorage {
  readonly saveRequest: <R extends Rpc.Any>(
    envelope: Message.OutgoingRequest<R>
  ) => Effect.Effect<SaveResult<R>, PersistenceError | MalformedMessage>

  readonly saveEnvelope: (
    envelope: Message.OutgoingEnvelope
  ) => Effect.Effect<void, PersistenceError | MalformedMessage>

  readonly saveReply: <R extends Rpc.Any>(
    reply: Reply.ReplyWithContext<R>
  ) => Effect.Effect<void, PersistenceError | MalformedMessage>

  readonly requestIdForPrimaryKey: (options: {
    readonly address: EntityAddress
    readonly tag: string
    readonly id: string
  }) => Effect.Effect<Option.Option<Snowflake.Snowflake>, PersistenceError>

  readonly unprocessedMessages: (
    shards: ReadonlySet<ShardId>
  ) => Effect.Effect<ReadonlyArray<Message.Incoming<Rpc.Any>>, PersistenceError>

  readonly unprocessedMessagesById: (
    ids: ReadonlyArray<Snowflake.Snowflake>
  ) => Effect.Effect<ReadonlyArray<Message.Incoming<Rpc.Any>>, PersistenceError>

  readonly clearReplies: (
    requestIds: ReadonlyArray<Snowflake.Snowflake>
  ) => Effect.Effect<void, PersistenceError>

  readonly repliesFor: (
    requestIds: ReadonlyArray<Snowflake.Snowflake>
  ) => Effect.Effect<ReadonlyArray<Reply.Reply<Rpc.Any>>, PersistenceError>

  readonly resetAddress: (address: EntityAddress) => Effect.Effect<void, PersistenceError>
  readonly clearAddress: (address: EntityAddress) => Effect.Effect<void, PersistenceError>
  readonly resetShards: (shards: ReadonlySet<ShardId>) => Effect.Effect<void, PersistenceError>
}
```

### Integration Pattern

```typescript
import { MessageStorage } from '@effect/cluster'
import { Effect, Match, Option } from 'effect'

const processJobRequest = <R extends Rpc.Any>(
  storage: MessageStorage,
  request: Message.OutgoingRequest<R>
) => Effect.gen(function* () {
  const result = yield* storage.saveRequest(request)

  return yield* Match.value(result).pipe(
    Match.tag('Success', () =>
      // New request - proceed with execution
      executeJob(request)
    ),
    Match.tag('Duplicate', ({ originalId, lastReceivedReply }) =>
      // Duplicate detected - return cached reply or re-execute
      Option.match(lastReceivedReply, {
        onNone: () => executeJob(request), // No reply yet, re-execute
        onSome: (reply) => Effect.succeed(reply) // Return cached reply
      })
    ),
    Match.exhaustive
  )
})
```

### Gotchas

- `saveRequest` returns `Duplicate` with `originalId` even if the original request is still processing (no reply yet)
- `unprocessedMessages` only returns messages without `WithExit` replies - streaming `Chunk` replies are considered incomplete
- `resetAddress` clears mailbox state but preserves messages; `clearAddress` removes everything

---

## [3] SqlMessageStorage

**Purpose:** SQL-backed MessageStorage implementation providing durable persistence with automatic deduplication via primary key constraints.

### Type Signatures

```typescript
// --- [Database Schema] -------------------------------------------------------
type MessageRow = {
  readonly id: string | bigint
  readonly message_id: string | null        // primaryKey from payload (for dedup)
  readonly shard_id: string
  readonly entity_type: string
  readonly entity_id: string
  readonly kind: 0 | 1 | 2                  // Request | AckChunk | Interrupt
  readonly tag: string | null               // RPC method tag
  readonly payload: string | null           // JSON-encoded payload
  readonly headers: string | null
  readonly trace_id: string | null
  readonly span_id: string | null
  readonly sampled: boolean | number | bigint | null
  readonly request_id: string | bigint | null
  readonly reply_id: string | bigint | null
  readonly deliver_at: number | bigint | null
}

type ReplyRow = {
  readonly id: string | bigint
  readonly kind: 0 | null                   // WithExit = 0, Chunk = null
  readonly request_id: string | bigint
  readonly payload: string
  readonly sequence: number | bigint | null // For Chunk replies
}

// --- [Make Function] ---------------------------------------------------------
declare const make: (options?: {
  readonly prefix?: string  // Table name prefix (default: "effect_cluster_")
}) => Layer.Layer<MessageStorage, never, SqlClient>
```

### Deduplication Mechanism

The `message_id` column stores the business-level primary key extracted from the RPC payload. When `saveRequest` is called:

1. Attempt INSERT with `message_id` constraint
2. On constraint violation, query existing message and last reply
3. Return `SaveResult.Duplicate({ originalId, lastReceivedReply })`

```sql
-- Deduplication query (conceptual)
SELECT m.id, r.id as reply_id, r.payload as reply_payload
FROM messages m
LEFT JOIN replies r ON r.id = m.last_reply_id
WHERE m.message_id = $primaryKey
```

### Integration Pattern

```typescript
import { SqlMessageStorage } from '@effect/cluster'
import { PgClient } from '@effect/sql-pg'

// Layer composition
const MessageStorageLayer = SqlMessageStorage.make({ prefix: "jobs_" }).pipe(
  Layer.provide(PgClient.layer({
    host: "localhost",
    database: "jobs",
    username: "postgres"
  }))
)
```

### Gotchas

- `message_id` is nullable - messages without `primaryKey` in payload are NOT deduplicated
- The `kind` column discriminates message types: 0=Request, 1=AckChunk, 2=Interrupt
- Reply `sequence` enables ordered streaming chunk reassembly
- Table prefix allows multiple cluster deployments in same database

---

## [4] Message

**Purpose:** Type definitions for messages exchanged between entities, including outgoing requests and incoming envelopes.

### Type Signatures

```typescript
// --- [Outgoing Types] --------------------------------------------------------
type Outgoing<R extends Rpc.Any> = OutgoingRequest<R> | OutgoingEnvelope

class OutgoingRequest<R extends Rpc.Any> {
  readonly envelope: Envelope.Request<R>
  readonly context: Context<Rpc.Context<R>>
  readonly lastReceivedReply: Option.Option<Reply.Reply<R>>
  readonly rpc: R
  readonly respond: (reply: Reply.Reply<R>) => Effect.Effect<void>
  readonly encodedCache?: Envelope.Request.PartialEncoded
}

class OutgoingEnvelope {
  readonly envelope: Envelope.AckChunk | Envelope.Interrupt
}

// --- [Incoming Types] --------------------------------------------------------
type Incoming<R extends Rpc.Any> = IncomingRequest<R> | IncomingEnvelope

class IncomingRequest<R extends Rpc.Any> {
  readonly envelope: Envelope.Request.PartialEncoded
  readonly lastSentReply: Option.Option<ReplyEncoded<R>>
  readonly respond: (reply: ReplyWithContext<R>) => Effect.Effect<void, MalformedMessage | PersistenceError>
}

// --- [Serialization] ---------------------------------------------------------
declare const serialize: <R extends Rpc.Any>(
  message: Outgoing<R>
) => Effect.Effect<Outgoing.PartialEncoded<R>>

declare const deserializeLocal: <R extends Rpc.Any>(
  encoded: Incoming.Encoded<R>,
  rpc: R
) => Effect.Effect<IncomingLocal<R>, MalformedMessage>

declare const incomingLocalFromOutgoing: <R extends Rpc.Any>(
  message: OutgoingRequest<R>
) => IncomingRequestLocal<R>
```

### Integration Pattern

```typescript
import { Message } from '@effect/cluster'
import { Effect } from 'effect'

// Creating outgoing request (typically handled by Sharding internally)
const createJobMessage = <R extends Rpc.Any>(
  rpc: R,
  envelope: Envelope.Request<R>,
  context: Context<Rpc.Context<R>>
): Message.OutgoingRequest<R> => ({
  envelope,
  context,
  lastReceivedReply: Option.none(),
  rpc,
  respond: (reply) => Effect.void // Actual respond callback from Sharding
})

// Processing incoming request
const handleIncoming = <R extends Rpc.Any>(
  incoming: Message.IncomingRequest<R>
) => Effect.gen(function* () {
  const { envelope, lastSentReply, respond } = incoming

  // Check if already replied (idempotency)
  if (Option.isSome(lastSentReply)) {
    return // Already processed
  }

  // Process and respond
  const result = yield* processRequest(envelope)
  yield* respond(Reply.ReplyWithContext.make(result))
})
```

### Gotchas

- `OutgoingRequest.encodedCache` is an optimization - avoid re-encoding for local delivery
- `IncomingRequest.lastSentReply` enables handlers to detect re-delivery and skip re-processing
- `incomingLocalFromOutgoing` converts without serialization for same-process entities

---

## [5] Envelope

**Purpose:** Message envelope containing routing metadata, tracing context, and primary key extraction for deduplication.

### Type Signatures

```typescript
// --- [Envelope Types] --------------------------------------------------------
type Envelope<R extends Rpc.Any> = Request<R> | AckChunk | Interrupt

interface Request<in out Rpc extends Rpc.Any> {
  readonly [TypeId]: TypeId
  readonly _tag: "Request"
  readonly requestId: Snowflake
  readonly address: EntityAddress      // { entityType, entityId, shardId }
  readonly tag: Rpc.Tag<Rpc>           // RPC method name
  readonly payload: Rpc.Payload<Rpc>   // Decoded payload
  readonly headers: Headers.Headers
  readonly traceId?: string
  readonly spanId?: string
  readonly sampled?: boolean
}

class AckChunk extends Schema.TaggedClass("AckChunk")<{
  readonly id: Snowflake
  readonly address: EntityAddress
  readonly requestId: Snowflake
  readonly replyId: Snowflake
}> {}

class Interrupt extends Schema.TaggedClass("Interrupt")<{
  readonly id: Snowflake
  readonly address: EntityAddress
  readonly requestId: Snowflake
}> {}

// --- [Primary Key Functions] -------------------------------------------------
declare const primaryKey: <R extends Rpc.Any>(
  envelope: Envelope<R>
) => string | null

declare const primaryKeyByAddress: (options: {
  readonly address: EntityAddress
  readonly tag: string
  readonly id: string
}) => string
// Returns: `${entityType}/${entityId}/${tag}/${id}`
```

### Integration Pattern

```typescript
import { Envelope } from '@effect/cluster'
import { Effect, Option } from 'effect'

// Extract primary key for deduplication lookup
const checkDuplicate = (
  storage: MessageStorage,
  envelope: Envelope.Request<Rpc.Any>
) => Effect.gen(function* () {
  const pk = Envelope.primaryKey(envelope)
  if (pk === null) {
    return Option.none() // No primaryKey, can't deduplicate
  }

  const compositeKey = Envelope.primaryKeyByAddress({
    address: envelope.address,
    tag: envelope.tag,
    id: pk
  })
  // compositeKey = "JobProcessor/job-123/SubmitJob/abc-def-ghi"

  return yield* storage.requestIdForPrimaryKey({
    address: envelope.address,
    tag: envelope.tag,
    id: pk
  })
})
```

### Gotchas

- `primaryKey` returns `null` if payload doesn't implement `PrimaryKey.symbol`
- `primaryKeyByAddress` creates composite key format: `{entityType}/{entityId}/{tag}/{id}`
- `AckChunk` acknowledges streaming reply chunks to prevent re-delivery
- `Interrupt` signals cancellation of in-flight requests

---

## [6] Reply

**Purpose:** Response types for RPC requests, supporting both terminal (complete) and streaming (chunked) delivery patterns.

### Type Signatures

```typescript
// --- [Reply Union] -----------------------------------------------------------
type Reply<R extends Rpc.Any> = WithExit<R> | Chunk<R>

// --- [WithExit: Terminal Response] -------------------------------------------
class WithExit<R extends Rpc.Any> extends Data.TaggedClass("WithExit")<{
  readonly requestId: Snowflake
  readonly id: Snowflake
  readonly exit: Rpc.Exit<R>  // Success<R> | Failure<R>
}> {
  withRequestId(requestId: Snowflake): WithExit<R>
  static schema<R extends Rpc.Any>(rpc: R): Schema<WithExit<R>>
}

// --- [Chunk: Streaming Response] ---------------------------------------------
class Chunk<R extends Rpc.Any> extends Data.TaggedClass("Chunk")<{
  readonly requestId: Snowflake
  readonly id: Snowflake
  readonly sequence: number           // Ordering for reassembly
  readonly values: NonEmptyReadonlyArray<Rpc.SuccessChunk<R>>
}> {
  static emptyFrom(requestId: Snowflake): Chunk<Rpc.Any>
  static schema<R extends Rpc.Any>(rpc: R): Schema<Chunk<R>>
}

// --- [ReplyWithContext: For Handlers] ----------------------------------------
class ReplyWithContext<R extends Rpc.Any> extends Data.TaggedClass("ReplyWithContext")<{
  readonly reply: Reply<R>
  readonly context: Context.Context<Rpc.Context<R>>
  readonly rpc: R
}> {
  static fromDefect(defect: unknown): ReplyWithContext<Rpc.Any>
  static interrupt(requestId: Snowflake): ReplyWithContext<Rpc.Any>
}

// --- [Serialization] ---------------------------------------------------------
declare const serialize: <R extends Rpc.Any>(
  reply: ReplyWithContext<R>
) => Effect.Effect<ReplyEncoded<R>>

declare const serializeLastReceived: <R extends Rpc.Any>(
  request: OutgoingRequest<R>
) => Effect.Effect<Option.Option<ReplyEncoded<R>>>
```

### Integration Pattern

```typescript
import { Reply } from '@effect/cluster'
import { Effect, Exit, Match } from 'effect'

// Job handler returning terminal reply
const handleJobRequest = <R extends Rpc.Any>(
  request: Message.IncomingRequest<R>,
  execute: (payload: Rpc.Payload<R>) => Effect.Effect<Rpc.Success<R>, Rpc.Error<R>>
) => Effect.gen(function* () {
  const exit = yield* Effect.exit(execute(request.envelope.payload))

  const reply = new Reply.WithExit({
    requestId: request.envelope.requestId,
    id: yield* Snowflake.next,
    exit: Exit.match(exit, {
      onSuccess: (value) => ({ _tag: "Success", value }),
      onFailure: (cause) => ({ _tag: "Failure", cause })
    })
  })

  yield* request.respond(new Reply.ReplyWithContext({
    reply,
    context: Context.empty(),
    rpc: request.rpc
  }))
})

// Streaming handler with chunks
const handleStreamingJob = <R extends Rpc.Any>(
  request: Message.IncomingRequest<R>,
  stream: Stream.Stream<Rpc.SuccessChunk<R>, Rpc.Error<R>>
) => Effect.gen(function* () {
  let sequence = 0

  yield* Stream.runForEach(stream, (values) =>
    Effect.gen(function* () {
      const chunk = new Reply.Chunk({
        requestId: request.envelope.requestId,
        id: yield* Snowflake.next,
        sequence: sequence++,
        values: NonEmptyArray.fromArray(values) // Must be non-empty
      })
      yield* request.respond(new Reply.ReplyWithContext({ reply: chunk, ... }))
    })
  )
})
```

### Gotchas

- `WithExit` signals request completion - storage considers request "processed"
- `Chunk` replies require client-side `AckChunk` to prevent re-delivery
- `sequence` on Chunks enables ordered reassembly even with out-of-order delivery
- `ReplyWithContext.fromDefect` wraps unexpected exceptions as defect exits

---

## [7] Snowflake

**Purpose:** Distributed unique ID generator using Twitter Snowflake algorithm (64-bit: timestamp + machine + sequence).

### Type Signatures

```typescript
// --- [Snowflake Type] --------------------------------------------------------
type Snowflake = Brand.Branded<bigint, TypeId>

// --- [Constructor] -----------------------------------------------------------
declare const Snowflake: (input: string | bigint) => Snowflake

// --- [Generator] -------------------------------------------------------------
declare const makeGenerator: Effect.Effect<Snowflake.Generator>

interface Generator {
  readonly unsafeNext: () => Snowflake
  readonly setMachineId: (machineId: MachineId) => void
}

// --- [Make From Parts] -------------------------------------------------------
declare const make: (options: {
  readonly machineId: MachineId
  readonly sequence: number
  readonly timestamp: number
}) => Snowflake

// --- [Extraction Functions] --------------------------------------------------
declare const timestamp: (snowflake: Snowflake) => number   // Milliseconds since 2025-01-01
declare const machineId: (snowflake: Snowflake) => number   // 10-bit machine ID (0-1023)
declare const sequence: (snowflake: Snowflake) => number    // 12-bit sequence (0-4095)
declare const toParts: (snowflake: Snowflake) => Snowflake.Parts

interface Parts {
  readonly timestamp: number
  readonly machineId: number
  readonly sequence: number
}
```

### ID Structure

| Bits | Component | Range | Description |
|------|-----------|-------|-------------|
| 42 | Timestamp | ~139 years | Milliseconds since 2025-01-01 epoch |
| 10 | Machine ID | 0-1023 | Cluster node identifier |
| 12 | Sequence | 0-4095 | Per-millisecond counter |

### Integration Pattern

```typescript
import { Snowflake, MachineId } from '@effect/cluster'
import { Effect, Layer } from 'effect'

// Create generator with machine ID from environment
const SnowflakeGeneratorLayer = Layer.effect(
  Snowflake.Generator,
  Effect.gen(function* () {
    const generator = yield* Snowflake.makeGenerator
    const machineId = MachineId.make(parseInt(process.env.MACHINE_ID ?? "0"))
    generator.setMachineId(machineId)
    return generator
  })
)

// Generate IDs in service
const generateJobId = Effect.gen(function* () {
  const generator = yield* Snowflake.Generator
  return generator.unsafeNext()
})

// Extract components for debugging
const debugSnowflake = (id: Snowflake) => {
  const parts = Snowflake.toParts(id)
  return {
    generatedAt: new Date(parts.timestamp + EPOCH_2025),
    machine: parts.machineId,
    sequence: parts.sequence
  }
}
```

### Gotchas

- Epoch starts at 2025-01-01, not Unix epoch - extraction functions return offset from this date
- `unsafeNext()` is synchronous but may throw if sequence exhausted within same millisecond
- Machine ID must be unique per cluster node to avoid collisions
- 4096 IDs/ms/machine theoretical maximum throughput

---

## [8] MachineId

**Purpose:** Branded integer type for machine identification in Snowflake ID generation.

### Type Signatures

```typescript
// --- [Type Definition] -------------------------------------------------------
type MachineId = typeof MachineId.Type

// --- [Schema] ----------------------------------------------------------------
const MachineId = Schema.Int.pipe(
  Schema.brand("MachineId"),
  Schema.annotations({
    pretty: () => (machineId) => `MachineId(${machineId})`
  })
)

// --- [Factory] ---------------------------------------------------------------
declare const make: (shardId: number) => MachineId
```

### Integration Pattern

```typescript
import { MachineId } from '@effect/cluster'

// From environment variable
const machineId = MachineId.make(parseInt(process.env.POD_INDEX ?? "0"))

// From Kubernetes pod name (e.g., "job-processor-2" → 2)
const machineIdFromPodName = (podName: string): MachineId => {
  const match = podName.match(/-(\d+)$/)
  return MachineId.make(match ? parseInt(match[1]) : 0)
}

// Validate range (10 bits = 0-1023)
const validateMachineId = (id: number): MachineId => {
  if (id < 0 || id > 1023) {
    throw new Error(`MachineId must be 0-1023, got ${id}`)
  }
  return MachineId.make(id)
}
```

### Gotchas

- Valid range is 0-1023 (10 bits) - exceeding causes Snowflake bit overflow
- Typically derived from Kubernetes StatefulSet pod ordinal or container index
- Must be unique within cluster to avoid ID collisions

---

## [9] SocketRunner

**Purpose:** Socket-based transport layer for entity communication, providing efficient binary message transfer between cluster nodes.

### Type Signatures

```typescript
// --- [Full Layer] ------------------------------------------------------------
declare const layer: Layer.Layer<
  Sharding.Sharding | Runners.Runners,
  never,
  | Runners.RpcClientProtocol
  | ShardingConfig
  | RpcSerialization.RpcSerialization
  | SocketServer
  | MessageStorage
  | RunnerStorage.RunnerStorage
  | RunnerHealth
>

// --- [Client-Only Layer] -----------------------------------------------------
declare const layerClientOnly: Layer.Layer<
  Sharding.Sharding | Runners.Runners,
  never,
  | Runners.RpcClientProtocol
  | ShardingConfig
  | MessageStorage
  | RunnerStorage.RunnerStorage
>
```

### Layer Dependencies

| Dependency | Purpose |
|------------|---------|
| `RpcClientProtocol` | Protocol for encoding/decoding RPC messages |
| `ShardingConfig` | Cluster configuration (shard count, timeouts) |
| `RpcSerialization` | Serialization format (JSON, MessagePack, etc.) |
| `SocketServer` | Underlying socket server implementation |
| `MessageStorage` | Message persistence for durability |
| `RunnerStorage` | Runner state tracking for shard assignment |
| `RunnerHealth` | Health checks for runner liveness |

### Integration Pattern

```typescript
import { SocketRunner, SqlMessageStorage, ShardingConfig } from '@effect/cluster'
import { NodeSocketServer } from '@effect/platform-node'
import { Layer } from 'effect'

// Full runner layer for server nodes
const RunnerLayer = SocketRunner.layer.pipe(
  Layer.provide(NodeSocketServer.layer({ port: 9000 })),
  Layer.provide(SqlMessageStorage.make()),
  Layer.provide(ShardingConfig.layer({
    numberOfShards: 256,
    entityTerminationTimeout: Duration.seconds(30)
  }))
)

// Client-only layer for API servers that only send messages
const ClientOnlyLayer = SocketRunner.layerClientOnly.pipe(
  Layer.provide(SqlMessageStorage.make()),
  Layer.provide(ShardingConfig.layer({ numberOfShards: 256 }))
)
```

### Gotchas

- `layer` includes `SocketServer` dependency - use for runner nodes that receive messages
- `layerClientOnly` excludes `SocketServer` and `RunnerHealth` - use for API servers that only send
- Socket transport is more efficient than HTTP for high-frequency entity communication
- Requires consistent `ShardingConfig.numberOfShards` across all cluster nodes

---

## [10] Message Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MESSAGE LIFECYCLE                                 │
└─────────────────────────────────────────────────────────────────────────┘

1. SUBMIT
   Client → Sharding.send(entityId, rpc)
   ├── Generate requestId (Snowflake)
   ├── Extract primaryKey from payload (if Rpc.make({ primaryKey }))
   └── Create OutgoingRequest with envelope

2. PERSIST
   Sharding → MessageStorage.saveRequest(request)
   ├── IF primaryKey exists:
   │   ├── Check message_id constraint
   │   ├── IF duplicate: return SaveResult.Duplicate({ originalId, lastReceivedReply })
   │   └── IF new: INSERT and return SaveResult.Success
   └── IF no primaryKey: INSERT and return SaveResult.Success

3. ROUTE
   Sharding → Runner (via SocketRunner or HttpRunner)
   ├── Lookup shard assignment
   ├── Serialize envelope + context
   └── Transport to target runner

4. EXECUTE
   Runner → Entity.handle(incomingRequest)
   ├── Deserialize to IncomingRequest
   ├── Check lastSentReply for idempotency
   └── Execute handler logic

5. REPLY
   Entity → IncomingRequest.respond(replyWithContext)
   ├── Create Reply.WithExit (terminal) or Reply.Chunk (streaming)
   ├── MessageStorage.saveReply(reply)
   └── Transport reply back to caller

6. COMPLETE
   Caller receives reply
   ├── Match on Reply type (WithExit vs Chunk)
   ├── IF Chunk: send AckChunk envelope
   └── Request considered processed
```

---

## [11] Deduplication via Rpc.make({ primaryKey })

**Purpose:** Enable business-level deduplication by extracting a unique key from request payloads.

### Type Signature

```typescript
declare const make: <
  const Tag extends string,
  Payload extends Schema.Schema.Any | Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Error extends Schema.Schema.All,
  const Stream extends boolean
>(tag: Tag, options?: {
  payload?: Payload
  success?: Success
  failure?: Error
  stream?: Stream
  primaryKey?: (payload: Schema.Simplify<Schema.Struct.Type<NoInfer<Payload>>>) => string
}): Rpc<...>
```

### Integration Pattern

```typescript
import { Rpc, RpcGroup } from '@effect/rpc'
import { Schema as S } from 'effect'

// Define RPC with primaryKey extractor
class SubmitJob extends S.TaggedRequest<SubmitJob>()('SubmitJob', {
  failure: JobError,
  success: S.Struct({ jobId: S.String, status: S.String }),
  payload: {
    idempotencyKey: S.String,  // Client-provided dedup key
    type: S.Literal('render', 'export'),
    params: S.Record({ key: S.String, value: S.Unknown })
  }
}) {}

const JobRpc = Rpc.make('SubmitJob', {
  payload: SubmitJob.fields.payload,
  success: SubmitJob.fields.success,
  failure: SubmitJob.fields.failure,
  // Extract idempotencyKey for deduplication
  primaryKey: (payload) => payload.idempotencyKey
})

// Group for entity
const JobProcessorGroup = RpcGroup.make('JobProcessor').add(JobRpc)
```

### Deduplication Flow

```
1. Client sends: SubmitJob({ idempotencyKey: "abc-123", type: "render", ... })
2. primaryKey extracts: "abc-123"
3. Envelope.primaryKey returns: "abc-123"
4. Envelope.primaryKeyByAddress creates: "JobProcessor/job-42/SubmitJob/abc-123"
5. SqlMessageStorage checks message_id = "abc-123" for this address
6. IF exists: return Duplicate with original requestId and cached reply
7. IF new: INSERT with message_id = "abc-123"
```

### Gotchas

- `primaryKey` function receives decoded payload, returns string
- Composite key includes entityType, entityId, and tag - same primaryKey on different entities are NOT duplicates
- If `primaryKey` option omitted, messages are NOT deduplicated (message_id = null)
- Re-delivery after pod restart triggers duplicate detection via persisted message_id

---

## [12] At-Least-Once Delivery Recovery

**Purpose:** Messages survive pod restarts through the storage read loop in Sharding service.

### Recovery Mechanism

```typescript
// Sharding service internal loop (conceptual)
const storageReadLoop = Effect.gen(function* () {
  const storage = yield* MessageStorage
  const shards = yield* getAcquiredShards()

  // Poll for unprocessed messages
  const unprocessed = yield* storage.unprocessedMessages(shards)

  for (const message of unprocessed) {
    yield* Match.value(message).pipe(
      Match.tag('IncomingRequest', (req) =>
        // Route to entity, which may return cached reply if duplicate
        routeToEntity(req)
      ),
      Match.tag('IncomingEnvelope', (env) =>
        // Handle control messages (AckChunk, Interrupt)
        handleControlMessage(env)
      ),
      Match.exhaustive
    )
  }
})

// Runs periodically while shards are assigned
const runStorageLoop = storageReadLoop.pipe(
  Effect.repeat(Schedule.fixed(Duration.seconds(1))),
  Effect.race(shardReleased)
)
```

### Recovery Guarantees

| Scenario | Behavior |
|----------|----------|
| Pod crash during execution | Message persisted, re-delivered on restart |
| Network partition | Message persisted, re-delivered when connectivity restored |
| Entity timeout | Message remains unprocessed, re-delivered by storage loop |
| Duplicate re-delivery | Handler receives `lastSentReply`, can skip re-execution |

### Integration Pattern

```typescript
import { MessageStorage, Sharding } from '@effect/cluster'
import { Effect, Option } from 'effect'

// Entity handler with idempotency check
const handleJobRequest = (request: Message.IncomingRequest<SubmitJob>) =>
  Effect.gen(function* () {
    // Check if we already replied (re-delivery scenario)
    if (Option.isSome(request.lastSentReply)) {
      // Already processed, respond with cached reply
      yield* request.respond(request.lastSentReply.value)
      return
    }

    // First-time processing
    const result = yield* executeJob(request.envelope.payload)

    // Persist reply (survives restarts)
    yield* request.respond(new Reply.ReplyWithContext({
      reply: new Reply.WithExit({
        requestId: request.envelope.requestId,
        id: yield* Snowflake.next,
        exit: Exit.succeed(result)
      }),
      context: Context.empty(),
      rpc: request.rpc
    }))
  })
```

### Gotchas

- `unprocessedMessages` returns messages without `WithExit` reply - incomplete `Chunk` streams are re-delivered
- Storage loop only runs for acquired shards - shard reassignment triggers recovery on new runner
- `lastSentReply` is populated from MessageStorage during deserialization
- Long-running jobs may receive duplicate delivery if they don't checkpoint progress

---

## [13] Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Unique request IDs | `crypto.randomUUID()` | `Snowflake.makeGenerator` |
| Message persistence | Custom SQL tables | `SqlMessageStorage.make()` |
| Deduplication | Manual HashMap tracking | `Rpc.make({ primaryKey })` |
| Request correlation | Thread-local storage | `Reply.requestId` field |
| Streaming responses | Manual chunking | `Reply.Chunk` with sequence |
| Machine identification | `os.hostname()` hash | `MachineId.make(podIndex)` |
| Timestamp extraction | `Date.now()` comparison | `Snowflake.timestamp(id)` |

---

## [14] Common Pitfalls

| Pitfall | Symptom | Solution |
|---------|---------|----------|
| Missing primaryKey | Duplicates not detected | Add `primaryKey` option to `Rpc.make` |
| MachineId collision | Duplicate Snowflake IDs | Ensure unique MachineId per cluster node |
| Ignoring lastSentReply | Re-execution on re-delivery | Check `Option.isSome(request.lastSentReply)` |
| Forgetting AckChunk | Streaming chunks re-delivered | Send `AckChunk` envelope for each `Chunk` reply |
| Wrong shard count | Inconsistent routing | Use same `numberOfShards` across all nodes |
| No message persistence | Lost messages on crash | Use `SqlMessageStorage`, not `MemoryMessageStorage` |
| Exceeding sequence | Snowflake generation fails | Throttle to <4096 IDs/ms/machine |

---

## [15] Sources

- [MessageStorage.ts API](https://effect-ts.github.io/effect/cluster/MessageStorage.ts.html)
- [SqlMessageStorage.ts API](https://effect-ts.github.io/effect/cluster/SqlMessageStorage.ts.html)
- [Message.ts API](https://effect-ts.github.io/effect/cluster/Message.ts.html)
- [Reply.ts API](https://effect-ts.github.io/effect/cluster/Reply.ts.html)
- [Envelope.ts API](https://effect-ts.github.io/effect/cluster/Envelope.ts.html)
- [Snowflake.ts API](https://effect-ts.github.io/effect/cluster/Snowflake.ts.html)
- [MachineId.ts API](https://effect-ts.github.io/effect/cluster/MachineId.ts.html)
- [SocketRunner.ts API](https://effect-ts.github.io/effect/cluster/SocketRunner.ts.html)
- [Rpc.ts API](https://github.com/Effect-TS/effect/blob/main/packages/rpc/src/Rpc.ts)
- [Cluster and Sharding DeepWiki](https://deepwiki.com/Effect-TS/effect/5.2-cluster-management)
- [@effect/cluster npm](https://www.npmjs.com/package/@effect/cluster)
