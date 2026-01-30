# @effect/platform-node-shared Infrastructure Research

> **Phase:** Shared Node.js platform internals for stream conversion, socket handling, and runtime integration.

---

## [1] NodeStream — Node.js Stream Bridge

```typescript
import * as NodeStream from "@effect/platform-node-shared/NodeStream"
import type { Stream, PlatformError } from "@effect/platform"
import type { Readable, Duplex } from "node:stream"

// --- [FROM_READABLE] ---------------------------------------------------------
const toEffectStream = <E, A = Uint8Array>(
  evaluate: () => Readable,
  onError: (error: unknown) => E,
  options?: { chunkSize?: number; closeOnDone?: boolean }
): Stream.Stream<A, E> => NodeStream.fromReadable(evaluate, onError, options)

// --- [TO_READABLE] -----------------------------------------------------------
const toNodeReadable = <E, R>(
  stream: Stream.Stream<string | Uint8Array, E, R>
): Effect.Effect<Readable, never, R> => NodeStream.toReadable(stream)

// Synchronous variant when no requirements exist
const syncReadable: Readable = NodeStream.toReadableNever(pureStream)

// --- [DUPLEX_INTEGRATION] ----------------------------------------------------
const duplexChannel = NodeStream.fromDuplex(
  () => createDuplex(),
  (err) => new SystemError({ cause: err })
)

// Transform through Duplex with automatic SystemError wrapping
const compressed: Stream.Stream<Uint8Array, PlatformError, R> =
  NodeStream.pipeThroughSimple(inputStream, () => zlib.createGzip())

// --- [ACCUMULATION] ----------------------------------------------------------
const readAsString = NodeStream.toString(() => readable, {
  onFailure: (err) => new ParseError({ cause: err }),
  encoding: "utf-8",
  maxBytes: 1024 * 1024
})

const readAsBytes = NodeStream.toUint8Array(() => readable, {
  onFailure: (err) => new ReadError({ cause: err })
})

// --- [STDIO] -----------------------------------------------------------------
const stdin: Stream.Stream<Uint8Array> = NodeStream.stdin
const stdout: Stream.Stream<Uint8Array> = NodeStream.stdout
const stderr: Stream.Stream<Uint8Array> = NodeStream.stderr
```

---

## [2] NodeSink — Writable Sinks

```typescript
import * as NodeSink from "@effect/platform-node-shared/NodeSink"
import type { Sink } from "effect"
import type { Writable } from "node:stream"

// --- [FROM_WRITABLE] ---------------------------------------------------------
const fileSink = <E>(
  evaluate: () => Writable,
  onError: (error: unknown) => E,
  options?: { endOnDone?: boolean; encoding?: BufferEncoding }
): Sink.Sink<void, string | Uint8Array, never, E> =>
  NodeSink.fromWritable(evaluate, onError, options)

// --- [STDIO_SINKS] -----------------------------------------------------------
const stdoutSink: Sink.Sink<void, string | Uint8Array, never, PlatformError> = NodeSink.stdout
const stderrSink: Sink.Sink<void, string | Uint8Array, never, PlatformError> = NodeSink.stderr
```

---

## [3] NodeSocket — TCP Client

```typescript
import * as NodeSocket from "@effect/platform-node-shared/NodeSocket"
import { Socket } from "@effect/platform/Socket"
import type * as Net from "node:net"

// --- [MAKE_NET] --------------------------------------------------------------
const tcpSocket: Effect.Effect<Socket, Socket.SocketError> = NodeSocket.makeNet({
  host: "localhost",
  port: 8080,
  openTimeout: 5000
})

// --- [LAYER] -----------------------------------------------------------------
const SocketLayer: Layer.Layer<Socket, Socket.SocketError> =
  NodeSocket.layerNet({ host: "localhost", port: 8080 })

// --- [FROM_DUPLEX] -----------------------------------------------------------
const customSocket = NodeSocket.fromDuplex(
  openDuplexEffect,
  { openTimeout: "5 seconds" }
)

// --- [RAW_SOCKET_ACCESS] -----------------------------------------------------
const withRawSocket = Effect.gen(function* () {
  const raw = yield* NodeSocket.NetSocket
  raw.setNoDelay(true)
  raw.setKeepAlive(true, 60000)
})
```

---

## [4] NodeSocketServer — TCP/WebSocket Server

```typescript
import * as NodeSocketServer from "@effect/platform-node-shared/NodeSocketServer"
import type { SocketServer } from "@effect/platform/SocketServer"

// --- [TCP_SERVER] ------------------------------------------------------------
const tcpServer = NodeSocketServer.make({ port: 8080, host: "0.0.0.0" })
const TcpServerLayer = NodeSocketServer.layer({ port: 8080 })

// --- [WEBSOCKET_SERVER] ------------------------------------------------------
const wsServer = NodeSocketServer.makeWebSocket({ port: 8081 })
const WebSocketLayer = NodeSocketServer.layerWebSocket({ port: 8081 })

// --- [CONNECTION_HANDLER] ----------------------------------------------------
const runServer = Effect.gen(function* () {
  const server = yield* NodeSocketServer.make({ port: 8080 })
  yield* server.run((socket) =>
    Effect.gen(function* () {
      const data = yield* socket.read
      yield* socket.write(processData(data))
    })
  )
})

// --- [WEBSOCKET_HTTP_CONTEXT] ------------------------------------------------
const wsHandler = (socket: Socket) =>
  Effect.gen(function* () {
    const req = yield* NodeSocketServer.IncomingMessage
    const url = req.url
    const headers = req.headers
  })
```

---

## [5] Platform Service Layers

```typescript
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem"
import * as NodePath from "@effect/platform-node-shared/NodePath"
import * as NodeCommandExecutor from "@effect/platform-node-shared/NodeCommandExecutor"
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal"
import * as NodeKeyValueStore from "@effect/platform-node-shared/NodeKeyValueStore"

// --- [FILE_SYSTEM] -----------------------------------------------------------
const FileSystemLayer: Layer.Layer<FileSystem> = NodeFileSystem.layer

// --- [PATH] ------------------------------------------------------------------
const PathLayer: Layer.Layer<Path> = NodePath.layer
const PosixPathLayer: Layer.Layer<Path> = NodePath.layerPosix
const Win32PathLayer: Layer.Layer<Path> = NodePath.layerWin32

// --- [COMMAND_EXECUTOR] ------------------------------------------------------
const CommandLayer: Layer.Layer<CommandExecutor, never, FileSystem> =
  NodeCommandExecutor.layer

// Composed with FileSystem dependency
const ExecutionLayer = NodeCommandExecutor.layer.pipe(
  Layer.provide(NodeFileSystem.layer)
)

// --- [TERMINAL] --------------------------------------------------------------
const terminal = NodeTerminal.make((input) => input.key === "escape")
const TerminalLayer: Layer.Layer<Terminal> = NodeTerminal.layer

// --- [KEY_VALUE_STORE] -------------------------------------------------------
const KVLayer: Layer.Layer<KeyValueStore, PlatformError> =
  NodeKeyValueStore.layerFileSystem("/var/data/cache")
```

---

## [6] NodeMultipart — Form Data Processing

```typescript
import * as NodeMultipart from "@effect/platform-node-shared/NodeMultipart"
import type { Multipart } from "@effect/platform/Multipart"
import type { Readable } from "node:stream"
import type { IncomingHttpHeaders } from "node:http"

// --- [STREAM_PARSING] --------------------------------------------------------
const parseMultipart = (source: Readable, headers: IncomingHttpHeaders):
  Stream.Stream<Multipart.Part, Multipart.MultipartError> =>
    NodeMultipart.stream(source, headers)

// --- [PERSISTED] -------------------------------------------------------------
const persistMultipart = (source: Readable, headers: IncomingHttpHeaders):
  Effect.Effect<Multipart.Persisted, Multipart.MultipartError, FileSystem | Path | Scope> =>
    NodeMultipart.persisted(source, headers)

// --- [FILE_ACCESS] -----------------------------------------------------------
const getFileStream = (file: Multipart.File): Readable =>
  NodeMultipart.fileToReadable(file)
```

---

## [7] NodeRuntime — Application Entry

```typescript
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"
import { NodeContext } from "@effect/platform-node"

// --- [RUN_MAIN] --------------------------------------------------------------
const program = Effect.gen(function* () {
  yield* Effect.log("Application started")
  yield* Effect.never
})

program.pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)

// Features: SIGINT/SIGTERM handling, graceful interruption, exit codes, keep-alive
```

---

## [8] NodeClusterSocket — Distributed Communication

```typescript
import * as NodeClusterSocket from "@effect/platform-node-shared/NodeClusterSocket"
import type { Runners } from "@effect/cluster"
import type { ShardingConfig } from "@effect/cluster/ShardingConfig"
import type { RpcSerialization } from "@effect/rpc/RpcSerialization"

// --- [CLIENT_PROTOCOL] -------------------------------------------------------
const ClientProtocolLayer: Layer.Layer<Runners.RpcClientProtocol, never, RpcSerialization> =
  NodeClusterSocket.layerClientProtocol

// --- [SERVER] ----------------------------------------------------------------
const ServerLayer: Layer.Layer<SocketServer.SocketServer, SocketServer.SocketServerError, ShardingConfig> =
  NodeClusterSocket.layerSocketServer
```

---

## [9] Error Handling

```typescript
import { SystemError } from "@effect/platform/Error"

// --- [ERRNO_MAPPING] ---------------------------------------------------------
// ENOENT     -> NotFound
// EACCES     -> PermissionDenied
// EEXIST     -> AlreadyExists
// EISDIR     -> BadResource
// ENOTDIR    -> BadResource
// EBUSY      -> Busy
// ELOOP      -> BadResource
// (default)  -> Unknown

// --- [SYSTEM_ERROR_STRUCTURE] ------------------------------------------------
interface SystemError {
  readonly reason: "NotFound" | "PermissionDenied" | "AlreadyExists" | "BadResource" | "Busy" | "Unknown"
  readonly module: string
  readonly method: string
  readonly pathOrDescriptor: string | number
  readonly syscall: string
  readonly description: string
  readonly cause: unknown
}
```

---

## [10] Integration Patterns

```typescript
import { NodeContext } from "@effect/platform-node"
import * as NodeRuntime from "@effect/platform-node-shared/NodeRuntime"

// --- [FULL_CONTEXT] ----------------------------------------------------------
const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const executor = yield* CommandExecutor.CommandExecutor
  const path = yield* Path.Path
  const terminal = yield* Terminal.Terminal
})

program.pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain)

// --- [SELECTIVE_COMPOSITION] -------------------------------------------------
const MinimalLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const WithCommandsLayer = Layer.mergeAll(
  MinimalLayer,
  NodeCommandExecutor.layer.pipe(Layer.provide(NodeFileSystem.layer))
)
```

---

## [11] Quick Reference

| Module | Layer/Function | Dependencies | Purpose |
|--------|---------------|--------------|---------|
| `NodeStream` | `fromReadable`, `toReadable`, `pipeThroughSimple` | — | Stream conversion |
| `NodeSink` | `fromWritable`, `stdout`, `stderr` | — | Writable sinks |
| `NodeSocket` | `makeNet`, `layerNet`, `fromDuplex` | — | TCP client sockets |
| `NodeSocketServer` | `make`, `makeWebSocket`, `layer` | Scope | TCP/WS servers |
| `NodeFileSystem` | `layer` | — | File operations |
| `NodePath` | `layer`, `layerPosix`, `layerWin32` | — | Path utilities |
| `NodeCommandExecutor` | `layer` | FileSystem | Process execution |
| `NodeTerminal` | `make`, `layer` | Scope | TTY interaction |
| `NodeMultipart` | `stream`, `persisted`, `fileToReadable` | FileSystem, Path | Form parsing |
| `NodeRuntime` | `runMain` | — | Application entry |
| `NodeKeyValueStore` | `layerFileSystem` | — | File-backed KV |
| `NodeClusterSocket` | `layerClientProtocol`, `layerSocketServer` | RpcSerialization | Cluster comms |
