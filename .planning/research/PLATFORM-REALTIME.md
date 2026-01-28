# @effect/platform Realtime Research

**Version:** @effect/platform 0.94.2, @effect/rpc 0.73.0, @effect/cluster 0.56.1
**Researched:** 2026-01-28
**Confidence:** HIGH (official docs verified)

## Executive Summary

@effect/platform provides production-ready Socket/SocketServer abstractions for WebSocket communication with built-in Effect integration. Combined with @effect/rpc for typed request/response and @effect/cluster for cross-pod messaging, this forms a complete realtime infrastructure. MsgPack provides binary serialization via Channel-based pack/unpack. Worker infrastructure exists but is secondary to the cluster-based distribution model already planned.

**Primary recommendation:** Use `Socket` + `RpcServer.toHttpAppWebsocket` for typed WS communication; delegate cross-pod fan-out to @effect/cluster Sharding.messenger/broadcaster; use MsgPack.duplex for binary message channels.

## Core Imports

| Import Path | What It Provides | When to Use |
|-------------|------------------|-------------|
| `@effect/platform/Socket` | Socket interface, makeWebSocket, toChannel, CloseEvent | Client-side WS, bidirectional streams |
| `@effect/platform/SocketServer` | SocketServer service, Address (TCP/Unix) | Low-level server accept loop |
| `@effect/platform-node/NodeSocket` | layerWebSocket, fromNetSocket | Node.js WebSocket layer |
| `@effect/platform-node/NodeSocketServer` | make, makeWebSocket, layer | Node.js server implementation |
| `@effect/platform/MsgPack` | pack, unpack, duplex, duplexSchema | Binary serialization channels |
| `@effect/platform/Worker` | WorkerPool, makePoolSerialized, Spawner | CPU-bound offload (secondary) |
| `@effect/platform/WorkerRunner` | make, makeSerialized, PlatformRunner | Worker-side execution |
| `@effect/rpc/RpcServer` | toHttpAppWebsocket, layerProtocolWebsocket | Typed WS server endpoints |
| `@effect/rpc/RpcClient` | makeProtocolSocket, layerProtocolSocket | Typed WS client |
| `@effect/cluster/Sharding` | messenger, broadcaster, registerEntity | Cross-pod communication |

## Socket

### Interface

```typescript
interface Socket {
  readonly run: <_, E, R>(
    handler: (data: Uint8Array) => Effect<_, E, R> | void,
    options?: { onOpen?: Effect<void> }
  ) => Effect<void, SocketError | E, R>

  readonly runRaw: <_, E, R>(
    handler: (data: string | Uint8Array) => Effect<_, E, R> | void,
    options?: { onOpen?: Effect<void> }
  ) => Effect<void, SocketError | E, R>

  readonly writer: Effect<
    (chunk: Uint8Array | string | CloseEvent) => Effect<void, SocketError>,
    never, Scope
  >
}
```

### Factory Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `makeWebSocket` | `(url, opts?) => Effect<Socket, never, WebSocketConstructor>` | Create from URL |
| `fromWebSocket` | `(ws: WebSocket) => Socket` | Wrap existing WebSocket |
| `fromTransformStream` | `(stream) => Socket` | Adapt transform stream |

### Options

```typescript
type WebSocketOptions = {
  closeCodeIsError?: (code: number) => boolean  // Default: !1000, !1006
  openTimeout?: DurationInput                    // Connection timeout
  protocols?: string | string[]                  // WS sub-protocols
}
```

### Channel Conversion

```typescript
// Uint8Array bidirectional channel
Socket.toChannel(socket): Channel<Chunk<Uint8Array>, Uint8Array, SocketError>

// String output channel
Socket.toChannelString(socket, encoding?): Channel<Chunk<string>, ...>

// Mapped channel
Socket.toChannelMap(socket, f: (data) => A): Channel<Chunk<A>, ...>
```

### Errors

```typescript
type SocketError = SocketGenericError | SocketCloseError

class SocketGenericError extends Data.TaggedError('SocketGenericError')<{
  reason: 'Write' | 'Read' | 'Open' | 'OpenTimeout'
  cause: unknown
}>

class SocketCloseError extends Data.TaggedError('SocketCloseError')<{
  code: number
  reason: string
}>
// Guards: isSocketError, SocketCloseError.is(), SocketCloseError.isClean()
```

## SocketServer

### Address Types

```typescript
type Address = TcpAddress | UnixAddress
type TcpAddress = { _tag: 'TcpAddress'; hostname: string; port: number }
type UnixAddress = { _tag: 'UnixAddress'; path: string }
```

### Node.js Layers (from @effect/platform-node)

```typescript
// WebSocket upgrade server
NodeSocketServer.makeWebSocket(options): Effect<SocketServer, never, HttpServer>

// TCP socket server
NodeSocketServer.make(options): Effect<SocketServer, never>

// Layer variants
NodeSocketServer.layer(options): Layer<SocketServer>
NodeSocketServer.layerWebSocket(options): Layer<SocketServer, never, HttpServer>
```

## MsgPack

### Channel Operations

```typescript
// Pack unknown values to Uint8Array chunks
MsgPack.pack(): Channel<Chunk<Uint8Array>, unknown, MsgPackError>

// Unpack Uint8Array chunks to unknown values
MsgPack.unpack(): Channel<Chunk<unknown>, Uint8Array, MsgPackError>

// Schema-validated variants
MsgPack.packSchema<A, I, R>(schema): Channel<Chunk<Uint8Array>, A, MsgPackError | ParseError>
MsgPack.unpackSchema<A, I, R>(schema): Channel<Chunk<A>, Uint8Array, MsgPackError | ParseError>
```

### Duplex (Bidirectional)

```typescript
// Object-level bidirectional channel from byte channel
MsgPack.duplex(): (
  channel: Channel<Chunk<Uint8Array>, Uint8Array>
) => Channel<Chunk<unknown>, unknown>

// Schema-typed duplex
MsgPack.duplexSchema(options: {
  input: Schema<AI, II, IR>
  output: Schema<AO, IO, OR>
}): (channel) => Channel<Chunk<AO>, AI, MsgPackError | ParseError>
```

### Integration Pattern

```typescript
// Socket + MsgPack = typed binary messaging
const channel = pipe(
  Socket.toChannel(socket),
  MsgPack.duplexSchema({ input: RequestSchema, output: ResponseSchema })
)
```

## RPC over WebSocket

### Server Setup

```typescript
// Define RPC group
const MyApi = RpcGroup.make('myApi').pipe(
  RpcGroup.add(Rpc.make('getData', {
    payload: Schema.Struct({ id: Schema.String }),
    success: DataSchema,
    error: MyError
  })),
  RpcGroup.add(Rpc.stream('subscribe', {
    payload: Schema.Struct({ topic: Schema.String }),
    success: EventSchema,
    error: MyError
  }))
)

// Create WebSocket HTTP app
const app = RpcServer.toHttpAppWebsocket(MyApi, {
  concurrency: 'unbounded',  // Per-connection concurrency
  spanPrefix: 'rpc'
})

// Or use protocol layer
const serverLayer = RpcServer.layerProtocolWebsocket
```

### Client Setup

```typescript
// Socket-based client protocol
const clientLayer = RpcClient.layerProtocolSocket({
  retryOnTransientErrors: true,  // Reconnect on network errors
  retrySchedule: Schedule.exponential('100 millis')
})

// Create typed client
const client = RpcClient.make(MyApi)
// client.getData({ id: '123' }) => Effect<Data, MyError>
// client.subscribe({ topic: 'events' }) => Stream<Event, MyError>
```

## Worker Infrastructure

### When to Use Workers

| Scenario | Use Workers | Use Cluster |
|----------|-------------|-------------|
| CPU-bound computation | YES | NO |
| I/O-bound distribution | NO | YES |
| Cross-pod messaging | NO | YES |
| Image processing | YES | NO |
| Event fan-out | NO | YES |

### Worker Pool (if needed)

```typescript
// Typed worker pool
const pool = Worker.makePoolSerialized<MyRequests>({
  size: { min: 2, max: 8, timeToLive: '5 minutes' },
  spawn: () => new globalThis.Worker('./worker.js')
})

// Worker runner (in worker file)
WorkerRunner.makeSerialized(MyRequestSchema, {
  ProcessData: (req) => Effect.succeed(process(req.data))
})
```

### WorkerError Variants

```typescript
type WorkerErrorReason = 'spawn' | 'decode' | 'send' | 'encode' | 'unknown'
```

### Transferable

```typescript
// Collect transferables for efficient IPC
Transferable.addAll([buffer1, buffer2])

// Schema-based extraction
const MySchema = Schema.Struct({
  data: Transferable.schema(Transferable.Uint8Array)
})
```

## Cross-Pod Messaging (via @effect/cluster)

### Messenger (Point-to-Point)

```typescript
// Get messenger for entity type
const msg = Sharding.messenger(MyEntityType)

// Send to specific entity
msg.send(entityId, message): Effect<Response, ShardingError>

// Fire-and-forget
msg.sendDiscard(entityId, message): Effect<void, ShardingError>
```

### Broadcaster (Fan-Out)

```typescript
// Get broadcaster
const bc = Sharding.broadcaster(MyEntityType)

// Send to all entities of type
bc.broadcast(message): Effect<Map<EntityId, Response>>

// Broadcast with filter
bc.broadcastWithFilter(message, filter): Effect<Map<...>>
```

### Integration with WebSocket

```typescript
// WS connection entity receives cluster messages
const WsConnection = Entity.define({
  type: 'WsConnection',
  schema: WsMessageSchema,
  handler: (msg, ctx) => pipe(
    ctx.socket.writer,
    Effect.flatMap(write => write(msg.payload))
  )
})

// Cross-pod fan-out
const broadcast = (roomId: string, msg: WsMessage) =>
  Sharding.broadcaster(WsConnection).pipe(
    Effect.flatMap(bc => bc.broadcastWithFilter(msg,
      (id) => id.startsWith(roomId)
    ))
  )
```

## StreamingService Integration

### Current streaming.ts vs Platform Realtime

| Feature | Current StreamingService | Platform Realtime |
|---------|-------------------------|-------------------|
| SSE delivery | StreamingService.sse | Keep as-is |
| HTTP streaming | StreamingService.emit | Keep as-is |
| WS connections | N/A | Socket + RpcServer |
| Pub/sub channels | PubSub-based | Delegate to @effect/cluster |
| Cross-pod | Redis pub/sub manual | Sharding.broadcaster |
| Typed messages | Manual schemas | @effect/rpc Rpc.make |

### Recommended Split

```
StreamingService (keep)
  - sse(): SSE response helper
  - emit(): HTTP streaming response
  - ingest(): Pull-based stream ingestion

WebSocketService (new via platform)
  - RpcServer.toHttpAppWebsocket
  - Room management via entity registry
  - Cross-pod via Sharding.broadcaster

EventBus (new via cluster)
  - Replaces StreamingService.channel
  - Replaces internal PubSub patterns
  - Source of truth for pub/sub
```

## Don't Hand-Roll

| Problem | Platform Provides | Why Not DIY |
|---------|-------------------|-------------|
| WS connection lifecycle | Socket.run with cleanup | Handles reconnect, errors, scope |
| Binary serialization | MsgPack.duplex | Handles chunking, schema validation |
| Typed RPC over WS | RpcServer.toHttpAppWebsocket | Handles routing, tracing, errors |
| Cross-pod fan-out | Sharding.broadcaster | Handles node discovery, routing |
| WS close code handling | SocketCloseError.isClean | Edge cases (1000, 1006, etc.) |
| Backpressure | Socket.currentSendQueueCapacity | FiberRef-based tracking |
| Worker IPC | Transferable.collect | Zero-copy buffer transfer |

## Common Pitfalls

### 1. Manual WebSocket Upgrade

**Wrong:** Using raw `ws` library with manual upgrade
**Right:** `RpcServer.toHttpAppWebsocket` handles upgrade automatically

### 2. Blocking in Message Handler

**Wrong:** `socket.run(data => heavyComputation(data))`
**Right:** `socket.run(data => Effect.fork(heavyComputation(data)))`

### 3. Ignoring Close Codes

**Wrong:** Treating all closes as errors
**Right:** Use `closeCodeIsError` option or `SocketCloseError.isClean()`

### 4. Cross-Pod via Redis Raw

**Wrong:** Manual Redis pub/sub for fan-out
**Right:** `Sharding.broadcaster` with cluster coordination

### 5. MsgPack Without Schema

**Wrong:** `MsgPack.unpack()` returning `unknown`
**Right:** `MsgPack.unpackSchema(MySchema)` for type safety

## Code Patterns

### WebSocket Service with RPC

```typescript
// packages/server/src/platform/websocket.ts
const WsApi = RpcGroup.make('ws').pipe(
  RpcGroup.add(Rpc.make('join', {
    payload: Schema.Struct({ room: Schema.String }),
    success: Schema.Struct({ joined: Schema.Boolean }),
    error: WsError
  })),
  RpcGroup.add(Rpc.stream('messages', {
    payload: Schema.Struct({ room: Schema.String }),
    success: MessageSchema,
    error: WsError
  }))
)

const WsHandlers = WsApi.handlers({
  join: ({ room }) => Effect.gen(function* () {
    yield* Sharding.registerEntity(WsConnection, /* ... */)
    return { joined: true }
  }),
  messages: ({ room }) => Stream.fromPubSub(getRoomHub(room))
})

const wsApp = RpcServer.toHttpAppWebsocket(WsApi).pipe(
  Effect.provide(WsHandlers)
)
```

### MsgPack Binary Channel

```typescript
const binaryChannel = <A, B>(
  socket: Socket,
  inSchema: Schema.Schema<A>,
  outSchema: Schema.Schema<B>
) => pipe(
  Socket.toChannel(socket),
  MsgPack.duplexSchema({ input: inSchema, output: outSchema })
)
```

### Cross-Pod Broadcast

```typescript
const broadcastToRoom = (roomId: string, msg: RoomMessage) =>
  Effect.gen(function* () {
    const bc = yield* Sharding.broadcaster(RoomSubscriber)
    const results = yield* bc.broadcastWithFilter(
      msg,
      (entityId) => EntityId.parse(entityId).room === roomId
    )
    yield* Effect.logDebug('Broadcast complete', {
      room: roomId,
      delivered: results.size
    })
  })
```

## Open Questions

1. **SocketServer.run vs RpcServer.toHttpAppWebsocket**
   - What we know: Both handle WS, RpcServer adds RPC layer
   - What's unclear: When to use raw SocketServer
   - Recommendation: Use RpcServer for typed messaging, SocketServer only for raw binary protocols

2. **Worker vs Cluster for CPU Tasks**
   - What we know: Workers for same-machine parallelism, Cluster for distribution
   - What's unclear: Hybrid patterns
   - Recommendation: Workers for image/video processing; Cluster for everything else

## Sources

### Primary (HIGH confidence)
- https://effect-ts.github.io/effect/platform/Socket.ts.html
- https://effect-ts.github.io/effect/platform/MsgPack.ts.html
- https://effect-ts.github.io/effect/rpc/RpcServer.ts.html
- https://effect-ts.github.io/effect/rpc/RpcClient.ts.html
- https://deepwiki.com/Effect-TS/effect/5.2-cluster-management

### Secondary (MEDIUM confidence)
- https://effect-ts.github.io/effect/platform/Worker.ts.html
- https://effect-ts.github.io/effect/platform/WorkerRunner.ts.html
- https://www.typeonce.dev/snippet/effect-rpc-http-client-complete-example

### Tertiary (LOW confidence)
- Worker-cluster hybrid patterns (no official examples found)

## Metadata

**Confidence breakdown:**
- Socket/MsgPack APIs: HIGH - official docs verified
- RPC WebSocket: HIGH - multiple sources agree
- Cluster integration: HIGH - DeepWiki + official docs
- Worker patterns: MEDIUM - docs exist, less integration guidance

**Research date:** 2026-01-28
**Valid until:** 2026-02-28 (stable packages)
