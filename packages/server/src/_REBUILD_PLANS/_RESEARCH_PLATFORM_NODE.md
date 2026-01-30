# @effect/platform-node Research

**Researched:** 2026-01-29
**Domain:** Node.js platform implementations for @effect/platform abstractions
**Package:** `@effect/platform-node` (re-exports from `@effect/platform-node-shared`)

---

## Summary

`@effect/platform-node` provides Node.js-specific Layer implementations for platform abstractions. Key modules: NodeHttpServer (HTTP serving), NodeHttpClient (HTTP requests), NodeRuntime (application entry), NodeFileSystem (file operations), NodeKeyValueStore (file-backed KV), NodeSocket/NodeClusterSocket (cluster communication), NodeWorker (background processing).

All APIs follow the Layer pattern: configure once, provide to Effect programs. No manual resource management - layers handle lifecycle.

---

## [1] NodeRuntime - Application Entry Point

### Pattern: runMain Entry
```typescript
import { NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'

// --- [TYPES] -----------------------------------------------------------------
type RunMainOptions = {
  readonly disableErrorReporting?: boolean  // Suppress automatic failure logs
  readonly disablePrettyLogger?: boolean    // Use structured JSON instead
  readonly teardown?: Teardown              // Custom cleanup + exit code
}
type Teardown = (exit: Exit.Exit<unknown, unknown>, onExit: (code: number) => void) => void

// --- [PATTERN] ---------------------------------------------------------------
// Basic entry - handles SIGINT/SIGTERM, sets process.exitCode
NodeRuntime.runMain(program)

// With options - production config
NodeRuntime.runMain(program, {
  disablePrettyLogger: true,  // JSON logs for structured logging
  teardown: (exit, onExit) => Exit.match(exit, {
    onFailure: (cause) => { /* custom error reporting */ onExit(1) },
    onSuccess: () => onExit(0),
  }),
})

// With Layer provision
const AppLive = Layer.mergeAll(DatabaseLive, HttpServerLive, TelemetryLive)
NodeRuntime.runMain(program.pipe(Effect.provide(AppLive)))
```

---

## [2] NodeHttpServer - HTTP Server Layer

### Pattern: Server with Router
```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from '@effect/platform'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { createServer } from 'node:http'

// --- [ROUTER] ----------------------------------------------------------------
const router = HttpRouter.empty.pipe(
  HttpRouter.get('/health', HttpServerResponse.text('ok')),
  HttpRouter.get('/api/users/:id', Effect.gen(function*() {
    const { id } = yield* HttpRouter.RouteContext
    return yield* HttpServerResponse.json({ id })
  })),
  HttpRouter.post('/api/users', Effect.gen(function*() {
    const body = yield* HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((req) => req.json),
    )
    return yield* HttpServerResponse.json(body, { status: 201 })
  })),
)

// --- [LAYER] -----------------------------------------------------------------
// layer: HttpPlatform | Etag.Generator | NodeContext | HttpServer
const ServerLive = NodeHttpServer.layer(createServer, { port: 3000 })

// layerConfig: Reads port from Effect Config
const ServerConfigLive = NodeHttpServer.layerConfig(createServer, {
  port: Config.integer('PORT').pipe(Config.withDefault(3000)),
})

// layerTest: Random port + HttpClient with base URL (for tests)
const TestLive = NodeHttpServer.layerTest(createServer)

// layerContext: HttpPlatform | Etag.Generator | NodeContext (no server)
const ContextLive = NodeHttpServer.layerContext
```

### Pattern: Server with HttpApp
```typescript
import { HttpApp, HttpMiddleware, HttpServer } from '@effect/platform'

// --- [APP] -------------------------------------------------------------------
const app: HttpApp.Default = router.pipe(
  HttpMiddleware.logger,
  HttpMiddleware.cors({ allowedOrigins: ['https://app.example.com'] }),
)

// --- [SERVE] -----------------------------------------------------------------
// serve() returns Layer - use for composition
const serve = HttpServer.serve(app)

// serveEffect() returns Effect - use for imperative control
const serveEffect = HttpServer.serveEffect(app)

// With address logging
const ServeWithLog = HttpServer.serve(app).pipe(HttpServer.withLogAddress)
```

---

## [3] NodeHttpClient - HTTP Client Layer

### Pattern: Standard HTTP Client
```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse } from '@effect/platform'
import { NodeHttpClient } from '@effect/platform-node'
import { Effect, Layer } from 'effect'

// --- [LAYER] -----------------------------------------------------------------
// layer: HttpClient with default agent
const ClientLive = NodeHttpClient.layer

// layerWithoutAgent: Requires HttpAgent (for custom TLS)
const ClientNoAgent = NodeHttpClient.layerWithoutAgent

// Custom agent with HTTPS options
const AgentLive = NodeHttpClient.makeAgentLayer({
  rejectUnauthorized: true,
  ca: fs.readFileSync('/path/to/ca.pem'),
})

// --- [USAGE] -----------------------------------------------------------------
const fetchUser = (id: string) => Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  return yield* client.get(`https://api.example.com/users/${id}`).pipe(
    Effect.flatMap(HttpClientResponse.json),
    Effect.scoped,
  )
})

// Request composition
const request = HttpClientRequest.get('https://api.example.com/users').pipe(
  HttpClientRequest.setHeader('Authorization', 'Bearer token'),
  HttpClientRequest.setUrlParam('limit', '10'),
)
```

### Pattern: Undici (HTTP/2) Client
```typescript
// --- [UNDICI LAYER] ----------------------------------------------------------
// layerUndici: Full Undici stack with dispatcher
const UndiciLive = NodeHttpClient.layerUndici

// Custom dispatcher
const DispatcherLive = NodeHttpClient.makeDispatcher({ connections: 100 })
const UndiciCustom = NodeHttpClient.layerUndiciWithoutDispatcher.pipe(
  Layer.provide(DispatcherLive),
)
```

---

## [4] NodeFileSystem - File Operations Layer

### Pattern: FileSystem Service
```typescript
import { FileSystem, Path } from '@effect/platform'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Effect, Layer, Stream } from 'effect'

// --- [LAYER] -----------------------------------------------------------------
const FsLive = NodeFileSystem.layer  // Layer<FileSystem>
const PathLive = NodePath.layer      // Layer<Path>

// --- [USAGE] -----------------------------------------------------------------
const readConfig = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const configPath = path.join(process.cwd(), 'config.json')
  const content = yield* fs.readFileString(configPath)
  return JSON.parse(content)
})

// Stream large files
const streamFile = (filePath: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  return fs.stream(filePath, { bufferSize: 64 * 1024 })
})

// Write atomically (temp file + rename)
const writeAtomic = (path: string, content: string) => Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const tempPath = `${path}.tmp.${Date.now()}`
  yield* fs.writeFileString(tempPath, content)
  yield* fs.rename(tempPath, path)
})
```

---

## [5] NodeKeyValueStore - File-Backed Storage

### Pattern: KeyValueStore Layer
```typescript
import { KeyValueStore } from '@effect/platform'
import { NodeKeyValueStore } from '@effect/platform-node'
import { Effect, Option, Schema as S } from 'effect'

// --- [LAYER] -----------------------------------------------------------------
const KvLive = NodeKeyValueStore.layerFileSystem('/var/data/kv')

// --- [USAGE] -----------------------------------------------------------------
const cacheUser = (id: string, data: unknown) => Effect.gen(function*() {
  const kv = yield* KeyValueStore.KeyValueStore
  yield* kv.set(`user:${id}`, JSON.stringify(data))
})

const getCachedUser = (id: string) => Effect.gen(function*() {
  const kv = yield* KeyValueStore.KeyValueStore
  const cached = yield* kv.get(`user:${id}`)
  return Option.map(cached, JSON.parse)
})
```

---

## [6] NodeSocket - WebSocket Communication

### Pattern: WebSocket Layer
```typescript
import { Socket } from '@effect/platform'
import { NodeSocket } from '@effect/platform-node'
import { Effect, Layer, Stream } from 'effect'

// --- [LAYER] -----------------------------------------------------------------
// layerWebSocket: Socket from URL
const WsLive = NodeSocket.layerWebSocket('wss://api.example.com/ws', {
  closeCodeIsError: (code) => code !== 1000 && code !== 1001,
})

// layerWebSocketConstructor: WebSocket factory (uses ws package in Node)
const WsConstructorLive = NodeSocket.layerWebSocketConstructor

// --- [USAGE] -----------------------------------------------------------------
const sendMessage = (msg: string) => Effect.gen(function*() {
  const socket = yield* Socket.Socket
  yield* socket.write(new TextEncoder().encode(msg))
})

const receiveMessages = Effect.gen(function*() {
  const socket = yield* Socket.Socket
  return socket.stream.pipe(
    Stream.map((chunk) => new TextDecoder().decode(chunk)),
    Stream.runCollect,
  )
})
```

---

## [7] NodeClusterSocket - Distributed Cluster Communication

### Pattern: Cluster Layer Configuration
```typescript
import { NodeClusterSocket } from '@effect/platform-node'
import { Layer } from 'effect'

// --- [LAYER OPTIONS] ---------------------------------------------------------
type ClusterOptions<ClientOnly, Storage, Health> = {
  readonly clientOnly?: ClientOnly        // true = no shard hosting
  readonly serialization?: 'msgpack' | 'ndjson'
  readonly storage?: Storage              // 'local' | 'sql' | 'byo'
  readonly runnerHealth?: Health          // 'ping' | 'k8s'
  // Kubernetes-specific
  readonly k8sNamespace?: string
  readonly k8sLabelSelector?: string
}

// --- [LAYER] -----------------------------------------------------------------
// Standard cluster (Socket transport, local storage, ping health)
const ClusterLive = NodeClusterSocket.layer({
  serialization: 'msgpack',
  storage: 'local',
  runnerHealth: 'ping',
})

// SQL-backed cluster (persistent message/runner storage)
const ClusterSqlLive = NodeClusterSocket.layer({
  serialization: 'msgpack',
  storage: 'sql',
  runnerHealth: 'ping',
})

// Kubernetes cluster (k8s health checks, service discovery)
const ClusterK8sLive = NodeClusterSocket.layer({
  serialization: 'msgpack',
  storage: 'sql',
  runnerHealth: 'k8s',
  k8sNamespace: 'production',
  k8sLabelSelector: 'app=api-server',
})

// Client-only mode (no shard hosting, only sends messages)
const ClusterClientLive = NodeClusterSocket.layer({
  clientOnly: true,
  serialization: 'msgpack',
})

// --- [K8S HTTP CLIENT] -------------------------------------------------------
// layerK8sHttpClient: Authenticated client using service account
const K8sClientLive = NodeClusterSocket.layerK8sHttpClient
```

---

## [8] NodeWorker - Background Processing

### Pattern: Worker Manager Layer
```typescript
import { Worker } from '@effect/platform'
import { NodeWorker, NodeWorkerRunner } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { Worker as WorkerThread } from 'node:worker_threads'

// --- [MAIN THREAD LAYERS] ----------------------------------------------------
// layerManager: WorkerManager service
const ManagerLive = NodeWorker.layerManager

// layerWorker: PlatformWorker service
const WorkerLive = NodeWorker.layerWorker

// layer: Combined with custom spawn function
const WorkerPoolLive = NodeWorker.layer((id) =>
  new WorkerThread('./worker.js', { workerData: { id } })
)

// layerPlatform: PlatformWorker + Spawner with custom spawn
const PlatformWorkerLive = NodeWorker.layerPlatform((id) =>
  new WorkerThread('./worker.js', { workerData: { id } })
)

// --- [WORKER THREAD] ---------------------------------------------------------
// In worker.js - launches worker runner
import { NodeWorkerRunner } from '@effect/platform-node'
import { Effect, Layer } from 'effect'

const WorkerLive = Layer.effectDiscard(Effect.gen(function*() {
  // Worker initialization logic
}))

NodeWorkerRunner.launch(WorkerLive)
```

---

## [9] NodeContext - Aggregated Platform Services

```typescript
import { NodeContext } from '@effect/platform-node'
import { Layer } from 'effect'

// NodeContext = CommandExecutor | FileSystem | Path | Terminal | WorkerManager
const NodeContextLive = NodeContext.layer

const AppLive = Layer.mergeAll(
  NodeContext.layer,
  NodeHttpServer.layer(createServer, { port: 3000 }),
  NodeHttpClient.layer,
)
```

---

## [10] Integration Patterns

### Pattern: Full HTTP Application
```typescript
import { HttpRouter, HttpServer, HttpServerResponse } from '@effect/platform'
import { NodeContext, NodeHttpServer, NodeRuntime } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { createServer } from 'node:http'

// --- [ROUTER] ----------------------------------------------------------------
const router = HttpRouter.empty.pipe(
  HttpRouter.get('/health', HttpServerResponse.text('ok')),
)

// --- [LAYERS] ----------------------------------------------------------------
const ServerLive = NodeHttpServer.layer(createServer, { port: 3000 })
const AppLive = Layer.mergeAll(NodeContext.layer, ServerLive)

// --- [MAIN] ------------------------------------------------------------------
const main = HttpServer.serve(router).pipe(
  HttpServer.withLogAddress,
  Layer.launch,
  Effect.provide(AppLive),
)

NodeRuntime.runMain(main)
```

### Pattern: Test Server with Client
```typescript
import { HttpClient, HttpRouter, HttpServerResponse } from '@effect/platform'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect } from 'effect'
import { createServer } from 'node:http'

// layerTest: Random port + HttpClient with base URL
const TestLive = NodeHttpServer.layerTest(createServer)

const test = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient
  return yield* client.get('/api/test').pipe(
    Effect.flatMap((r) => r.json),
    Effect.scoped,
  )
}).pipe(Effect.provide(TestLive))
```

---

## [11] Error Handling

```typescript
import { HttpClientError, PlatformError } from '@effect/platform'
import { Effect, Match } from 'effect'

// FileSystem errors - Match on reason
const handleFsError = <A, R>(effect: Effect.Effect<A, PlatformError, R>) =>
  effect.pipe(
    Effect.catchTag('SystemError', (e) => Match.value(e.reason).pipe(
      Match.when('NotFound', () => Effect.succeed(null)),
      Match.when('PermissionDenied', () => Effect.die('Permission denied')),
      Match.orElse(() => Effect.fail(e)),
    )),
  )

// HTTP errors - Match on status
const handleHttpError = <A, R>(effect: Effect.Effect<A, HttpClientError, R>) =>
  effect.pipe(
    Effect.catchTag('ResponseError', (e) =>
      e.response.status === 404 ? Effect.succeed(null) : Effect.fail(e)
    ),
  )
```

---

## Quick Reference

| Module | Primary Export | Provides |
|--------|---------------|----------|
| NodeRuntime | `runMain` | Application entry point |
| NodeHttpServer | `layer`, `layerTest` | HttpServer, HttpPlatform, Etag.Generator |
| NodeHttpClient | `layer`, `layerUndici` | HttpClient |
| NodeFileSystem | `layer` | FileSystem |
| NodeKeyValueStore | `layerFileSystem(dir)` | KeyValueStore |
| NodeSocket | `layerWebSocket(url)` | Socket |
| NodeClusterSocket | `layer(opts)` | Cluster transport |
| NodeWorker | `layer(spawn)` | WorkerManager, Spawner |
| NodeWorkerRunner | `launch(layer)` | Worker thread entry |
| NodeContext | `layer` | FileSystem, Path, Terminal, CommandExecutor, WorkerManager |
