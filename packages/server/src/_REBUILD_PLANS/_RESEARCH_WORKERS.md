# @effect/platform Worker API Reference

> **Source:** effect-ts.github.io/effect/platform - Worker.ts, WorkerError.ts, WorkerRunner.ts
> **Version:** @effect/platform@0.94.2, @effect/platform-node@0.104.1

---

## [1] ARCHITECTURE OVERVIEW

The Worker module provides a three-layer abstraction for concurrent background processing:

| Layer | Module | Role |
|-------|--------|------|
| **Pool** | `Worker` | Manages worker lifecycle, load balancing, pooling |
| **Spawner** | `Worker` | Platform-specific worker instantiation |
| **Runner** | `WorkerRunner` | Executes requests inside worker threads |

**Communication Protocol:**
- Request: `[id, 0, payload, trace]` (data) or `[id, 1]` (interrupt)
- Response: `[id, 0, data[]]` (data), `[id, 1]` (end), `[id, 2, E]` (error), `[id, 3, CauseEncoded]` (defect)

---

## [2] WORKER ERROR HANDLING

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
import { WorkerError, isWorkerError } from "@effect/platform/WorkerError"

// WorkerError is a Schema.TaggedError with 5 failure reasons
type WorkerErrorReason = "spawn" | "decode" | "send" | "encode" | "unknown"

// --- [ERRORS] ----------------------------------------------------------------
// Error construction
const spawnError = new WorkerError({ reason: "spawn", cause: new Error("init failed") })
const decodeError = new WorkerError({ reason: "decode", cause: parseError })
const sendError = new WorkerError({ reason: "send", cause: postMessageError })
const encodeError = new WorkerError({ reason: "encode", cause: serializationError })

// Error messages (derived from reason)
// "spawn"   -> "An error occurred while spawning a worker"
// "decode"  -> "An error occurred during decoding"
// "send"    -> "An error occurred calling .postMessage"
// "encode"  -> "An error occurred during encoding"
// "unknown" -> "An unexpected error occurred"

// --- [FUNCTIONS] -------------------------------------------------------------
// Type guard for discrimination
pipe(
  effect,
  Effect.catchIf(isWorkerError, (e) =>
    Match.value(e.reason).pipe(
      Match.when("spawn", () => handleSpawnFailure(e)),
      Match.when("decode", () => handleDecodeFailure(e)),
      Match.when("send", () => handleSendFailure(e)),
      Match.orElse(() => handleUnknownFailure(e))
    )
  )
)

// Cause encoding/decoding for cross-boundary serialization
const encoded = WorkerError.encodeCause(Cause.fail(workerError))
const decoded = WorkerError.decodeCause(encoded)
```

---

## [3] WORKER POOL MANAGEMENT

### [3.1] Fixed-Size Pool

```typescript
// --- [TYPES] -----------------------------------------------------------------
import * as Worker from "@effect/platform/Worker"
import type { WorkerPool, WorkerManager, Spawner } from "@effect/platform/Worker"

// --- [SCHEMA] ----------------------------------------------------------------
// Pool options for fixed worker count
type FixedPoolOptions<I> = {
  readonly size: number                           // Number of workers
  readonly concurrency?: number                   // Concurrent requests per worker
  readonly targetUtilization?: number             // Load balancing target (0-1)
  readonly encode?: (message: I) => Effect.Effect<unknown, WorkerError>
  readonly initialMessage?: LazyArg<I>
  readonly onCreate?: (worker: Worker<I, unknown, unknown>) => Effect.Effect<void, WorkerError>
}

// --- [SERVICES] --------------------------------------------------------------
const ComputePoolTag = Context.GenericTag<WorkerPool<ComputeRequest, ComputeResult, ComputeError>>(
  "ComputePool"
)

// --- [LAYERS] ----------------------------------------------------------------
const ComputePoolLayer = Worker.makePoolLayer(ComputePoolTag, {
  size: 4,
  concurrency: 10,
  targetUtilization: 0.8
})

// --- [FUNCTIONS] -------------------------------------------------------------
const executeComputation = Effect.gen(function*() {
  const pool = yield* ComputePoolTag

  // Single request/response
  const result = yield* pool.executeEffect({ type: "compute", data: payload })

  // Streaming response
  const stream = pool.execute({ type: "stream", data: payload })
  const results = yield* Stream.runCollect(stream)

  // Broadcast to all workers (cache invalidation, config reload)
  yield* pool.broadcast({ type: "invalidate", keys: ["key1", "key2"] })
})
```

### [3.2] Dynamic Pool with TTL

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
// Pool options for auto-scaling worker count
type DynamicPoolOptions<I> = {
  readonly minSize: number                        // Minimum workers
  readonly maxSize: number                        // Maximum workers
  readonly timeToLive: Duration.DurationInput     // Idle worker TTL
  readonly concurrency?: number
  readonly targetUtilization?: number
  readonly encode?: (message: I) => Effect.Effect<unknown, WorkerError>
  readonly initialMessage?: LazyArg<I>
  readonly onCreate?: (worker: Worker<I, unknown, unknown>) => Effect.Effect<void, WorkerError>
}

// --- [LAYERS] ----------------------------------------------------------------
const DynamicPoolLayer = Worker.makePoolLayer(ComputePoolTag, {
  minSize: 2,
  maxSize: 8,
  timeToLive: "30 seconds",
  concurrency: 5,
  targetUtilization: 0.7,
  onCreate: (worker) => Effect.log(`Worker ${worker.id} created`)
})
```

### [3.3] Serialized Pool (Schema-Based)

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
import * as Schema from "effect/Schema"

// Define tagged request with result types
class ProcessDocument extends Schema.TaggedRequest<ProcessDocument>()("ProcessDocument", {
  failure: Schema.String,
  success: Schema.Struct({ processed: Schema.Boolean, output: Schema.String }),
  payload: { document: Schema.String, options: Schema.Struct({ format: Schema.String }) }
}) {}

class ValidateData extends Schema.TaggedRequest<ValidateData>()("ValidateData", {
  failure: Schema.Struct({ code: Schema.String, message: Schema.String }),
  success: Schema.Boolean,
  payload: { data: Schema.Unknown }
}) {}

// Union of all request types
type WorkerRequest = ProcessDocument | ValidateData
const WorkerRequestSchema = Schema.Union(ProcessDocument, ValidateData)

// --- [SERVICES] --------------------------------------------------------------
const SerializedPoolTag = Context.GenericTag<Worker.SerializedWorkerPool<WorkerRequest>>(
  "SerializedPool"
)

// --- [LAYERS] ----------------------------------------------------------------
const SerializedPoolLayer = Worker.makePoolSerializedLayer(SerializedPoolTag, {
  size: 4,
  concurrency: 10
})

// --- [FUNCTIONS] -------------------------------------------------------------
const processWithSerialization = Effect.gen(function*() {
  const pool = yield* SerializedPoolTag

  // Type-safe request/response
  const processResult = yield* pool.executeEffect(
    new ProcessDocument({ document: "content", options: { format: "pdf" } })
  )
  // processResult: { processed: boolean, output: string }

  const validateResult = yield* pool.executeEffect(
    new ValidateData({ data: { field: "value" } })
  )
  // validateResult: boolean
})
```

---

## [4] WORKER SPAWNER CONFIGURATION

### [4.1] Node.js Worker Threads

```typescript
// --- [TYPES] -----------------------------------------------------------------
import * as NodeWorker from "@effect/platform-node/NodeWorker"
import { Worker as WorkerThread } from "node:worker_threads"

// --- [LAYERS] ----------------------------------------------------------------
// Full layer with manager
const NodeWorkerLayer = NodeWorker.layer((id) =>
  new WorkerThread(new URL("./worker.js", import.meta.url), {
    workerData: { workerId: id }
  })
)

// Platform-only layer (use with custom manager)
const NodePlatformLayer = NodeWorker.layerPlatform((id) =>
  new WorkerThread(new URL("./worker.js", import.meta.url))
)

// --- [FUNCTIONS] -------------------------------------------------------------
// Complete pool setup
const program = pipe(
  executeComputation,
  Effect.provide(ComputePoolLayer),
  Effect.provide(NodeWorkerLayer)
)
```

### [4.2] Child Process Workers

```typescript
// --- [TYPES] -----------------------------------------------------------------
import { fork } from "node:child_process"
import type { ChildProcess } from "node:child_process"

// --- [LAYERS] ----------------------------------------------------------------
const ChildProcessLayer = NodeWorker.layer((id) =>
  fork(new URL("./worker.js", import.meta.url).pathname, [], {
    env: { ...process.env, WORKER_ID: String(id) }
  })
)
```

### [4.3] Custom Spawner

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// Custom spawner for specialized worker creation
const CustomSpawnerLayer = Worker.layerSpawner((id: number) => {
  const worker = new WorkerThread(workerPath, {
    workerData: { id },
    resourceLimits: {
      maxOldGenerationSizeMb: 512,
      maxYoungGenerationSizeMb: 128
    }
  })
  return worker
})

// Combine with manager
const CustomWorkerLayer = Layer.merge(
  Worker.layerManager,
  CustomSpawnerLayer
)
```

---

## [5] WORKER RUNNER IMPLEMENTATION

### [5.1] Basic Runner (Effect/Stream)

```typescript
// --- [FILE: worker.ts] -------------------------------------------------------
import * as WorkerRunner from "@effect/platform/WorkerRunner"
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner"

// --- [TYPES] -----------------------------------------------------------------
type WorkerInput = { type: "compute"; data: unknown } | { type: "stream"; count: number }
type WorkerOutput = { result: unknown }

// --- [FUNCTIONS] -------------------------------------------------------------
const processRequest = (request: WorkerInput): Effect.Effect<WorkerOutput> | Stream.Stream<WorkerOutput> =>
  Match.value(request).pipe(
    Match.when({ type: "compute" }, ({ data }) =>
      Effect.succeed({ result: heavyComputation(data) })
    ),
    Match.when({ type: "stream" }, ({ count }) =>
      Stream.range(0, count).pipe(
        Stream.map((n) => ({ result: n * 2 }))
      )
    ),
    Match.exhaustive
  )

// --- [LAYERS] ----------------------------------------------------------------
const runnerLayer = WorkerRunner.layer(processRequest)

// --- [EXECUTION] -------------------------------------------------------------
// Launch worker with platform runner
Effect.runPromise(
  WorkerRunner.launch(
    Layer.provide(runnerLayer, NodeWorkerRunner.layer)
  )
)
```

### [5.2] Serialized Runner (Schema-Based)

```typescript
// --- [FILE: worker.ts] -------------------------------------------------------
import * as WorkerRunner from "@effect/platform/WorkerRunner"
import * as NodeWorkerRunner from "@effect/platform-node/NodeWorkerRunner"

// --- [SCHEMA] ----------------------------------------------------------------
// Reuse request schemas from pool definition
class InitialMessage extends Schema.TaggedRequest<InitialMessage>()("InitialMessage", {
  failure: Schema.Never,
  success: Schema.Void,
  payload: { config: Schema.Struct({ maxMemory: Schema.Number }) }
}) {}

type AllRequests = InitialMessage | ProcessDocument | ValidateData
const AllRequestsSchema = Schema.Union(InitialMessage, ProcessDocument, ValidateData)

// --- [SERVICES] --------------------------------------------------------------
// Service dependencies for handlers
class ConfigService extends Context.Tag("ConfigService")<ConfigService, { maxMemory: number }>() {}

// --- [FUNCTIONS] -------------------------------------------------------------
// Handlers must match request _tag -> return type
const handlers: WorkerRunner.SerializedRunner.Handlers<AllRequests> = {
  // InitialMessage returns Layer to provide context
  InitialMessage: (req) =>
    Layer.succeed(ConfigService, { maxMemory: req.config.maxMemory }),

  // ProcessDocument returns Effect
  ProcessDocument: (req) =>
    Effect.gen(function*() {
      const config = yield* ConfigService
      return { processed: true, output: `Processed with ${config.maxMemory}MB` }
    }),

  // ValidateData returns Effect
  ValidateData: (req) =>
    Effect.succeed(req.data !== null)
}

// --- [LAYERS] ----------------------------------------------------------------
const serializedRunnerLayer = WorkerRunner.layerSerialized(AllRequestsSchema, handlers)

// --- [EXECUTION] -------------------------------------------------------------
Effect.runPromise(
  WorkerRunner.launch(
    Layer.provide(serializedRunnerLayer, NodeWorkerRunner.layer)
  )
)
```

### [5.3] Custom Encoding/Decoding

```typescript
// --- [FUNCTIONS] -------------------------------------------------------------
const runnerWithCustomCodecs = WorkerRunner.layer(
  processRequest,
  {
    decode: (message) =>
      Effect.mapError(
        Schema.decodeUnknown(InputSchema)(message),
        (cause) => new WorkerError({ reason: "decode", cause })
      ),
    encodeOutput: (_request, output) =>
      Effect.mapError(
        Schema.encode(OutputSchema)(output),
        (cause) => new WorkerError({ reason: "encode", cause })
      ),
    encodeError: (_request, error) =>
      Effect.mapError(
        Schema.encode(ErrorSchema)(error),
        (cause) => new WorkerError({ reason: "encode", cause })
      )
  }
)
```

---

## [6] INTEGRATION PATTERNS

### [6.1] Job Queue Processing

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
class ProcessJob extends Schema.TaggedRequest<ProcessJob>()("ProcessJob", {
  failure: Schema.Struct({ code: Schema.String, details: Schema.String }),
  success: Schema.Struct({ jobId: Schema.String, status: Schema.String }),
  payload: {
    jobId: Schema.String,
    payload: Schema.Unknown,
    priority: Schema.Number
  }
}) {}

// --- [SERVICES] --------------------------------------------------------------
const JobPoolTag = Context.GenericTag<Worker.SerializedWorkerPool<ProcessJob>>("JobPool")

// --- [FUNCTIONS] -------------------------------------------------------------
const processJobQueue = Effect.gen(function*() {
  const pool = yield* JobPoolTag
  const queue = yield* JobQueue

  yield* pipe(
    queue.take,
    Effect.flatMap((job) =>
      pool.executeEffect(new ProcessJob(job)).pipe(
        Effect.retry(Schedule.exponential("100 millis").pipe(Schedule.upTo("10 seconds"))),
        Effect.catchAll((error) =>
          queue.failJob(job.jobId, error)
        )
      )
    ),
    Effect.forever
  )
})

// --- [LAYERS] ----------------------------------------------------------------
const JobProcessingLayer = Layer.provide(
  Layer.scoped(JobProcessingService, processJobQueue),
  Layer.mergeAll(
    Worker.makePoolSerializedLayer(JobPoolTag, {
      minSize: 2,
      maxSize: 16,
      timeToLive: "60 seconds",
      concurrency: 1  // One job per worker at a time
    }),
    NodeWorkerLayer
  )
)
```

### [6.2] Heavy Computation Offload

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
class ComputeHash extends Schema.TaggedRequest<ComputeHash>()("ComputeHash", {
  failure: Schema.Never,
  success: Schema.String,
  payload: { data: Schema.Uint8ArrayFromSelf, algorithm: Schema.String }
}) {}

class GenerateReport extends Schema.TaggedRequest<GenerateReport>()("GenerateReport", {
  failure: Schema.String,
  success: Schema.Struct({ pdf: Schema.Uint8ArrayFromSelf }),
  payload: { template: Schema.String, data: Schema.Unknown }
}) {}

type ComputeRequest = ComputeHash | GenerateReport

// --- [SERVICES] --------------------------------------------------------------
const ComputePoolTag = Context.GenericTag<Worker.SerializedWorkerPool<ComputeRequest>>("ComputePool")

// --- [FUNCTIONS] -------------------------------------------------------------
const offloadComputation = <A extends ComputeRequest>(
  request: A
): Effect.Effect<
  Schema.Schema.Type<ReturnType<(typeof request)["successSchema"]>>,
  Schema.Schema.Type<ReturnType<(typeof request)["failureSchema"]>> | WorkerError | ParseResult.ParseError,
  typeof ComputePoolTag.Service
> =>
  Effect.flatMap(ComputePoolTag, (pool) => pool.executeEffect(request))

// Usage
const hashResult = yield* offloadComputation(
  new ComputeHash({ data: new Uint8Array([1, 2, 3]), algorithm: "sha256" })
)
```

### [6.3] Streaming Data Processing

```typescript
// --- [SCHEMA] ----------------------------------------------------------------
class StreamProcess extends Schema.TaggedRequest<StreamProcess>()("StreamProcess", {
  failure: Schema.String,
  success: Schema.Struct({ chunk: Schema.Number, data: Schema.String }),
  payload: { source: Schema.String, chunkSize: Schema.Number }
}) {}

// --- [FILE: worker.ts] -------------------------------------------------------
const handlers: WorkerRunner.SerializedRunner.Handlers<StreamProcess> = {
  StreamProcess: (req) =>
    Stream.range(0, 100).pipe(
      Stream.map((n) => ({ chunk: n, data: `Processed chunk ${n}` })),
      Stream.tap(() => Effect.sleep("10 millis"))  // Simulate work
    )
}

// --- [FILE: main.ts] ---------------------------------------------------------
const processStream = Effect.gen(function*() {
  const pool = yield* StreamPoolTag

  yield* pipe(
    pool.execute(new StreamProcess({ source: "data.csv", chunkSize: 1000 })),
    Stream.tap((result) => Effect.log(`Received chunk ${result.chunk}`)),
    Stream.runDrain
  )
})
```

---

## [7] LIFECYCLE MANAGEMENT

### [7.1] Close Latch

```typescript
// --- [TYPES] -----------------------------------------------------------------
import { CloseLatch } from "@effect/platform/WorkerRunner"

// CloseLatch is a Deferred<void, WorkerError> signaling worker shutdown

// --- [FUNCTIONS] -------------------------------------------------------------
// In worker: access close latch for graceful shutdown
const workerWithShutdown = Effect.gen(function*() {
  const closeLatch = yield* CloseLatch

  // Setup cleanup on close signal
  yield* Deferred.await(closeLatch).pipe(
    Effect.tap(() => cleanupResources),
    Effect.fork
  )

  // Main processing loop
  yield* processRequests
})
```

### [7.2] Launch with Layer

```typescript
// --- [LAYERS] ----------------------------------------------------------------
// WorkerRunner.launch provisions layer until CloseLatch fires
const workerProgram = WorkerRunner.launch(
  Layer.mergeAll(
    runnerLayer,
    DatabaseConnectionLayer,
    CacheLayer
  ).pipe(
    Layer.provide(NodeWorkerRunner.layer)
  )
)

// Run worker
Effect.runPromise(workerProgram).catch(console.error)
```

---

## [8] API QUICK REFERENCE

| Function | Type | Description |
|----------|------|-------------|
| `Worker.makePool` | `Effect<WorkerPool, WorkerError, WorkerManager \| Spawner \| Scope>` | Create untyped worker pool |
| `Worker.makePoolLayer` | `Layer<Tag, WorkerError, WorkerManager \| Spawner>` | Pool as Layer |
| `Worker.makePoolSerialized` | `Effect<SerializedWorkerPool, WorkerError, WorkerManager \| Spawner \| Scope>` | Create schema-typed pool |
| `Worker.makePoolSerializedLayer` | `Layer<Tag, WorkerError, WorkerManager \| Spawner>` | Serialized pool as Layer |
| `Worker.layerManager` | `Layer<WorkerManager, never, PlatformWorker>` | Provide WorkerManager |
| `Worker.layerSpawner` | `Layer<Spawner, never, never>` | Provide custom Spawner |
| `WorkerRunner.make` | `Effect<void, WorkerError, PlatformRunner \| R \| Scope>` | Create basic runner |
| `WorkerRunner.layer` | `Layer<never, WorkerError, PlatformRunner \| R>` | Runner as Layer |
| `WorkerRunner.makeSerialized` | `Effect<void, WorkerError, PlatformRunner \| R \| Scope \| HandlersContext>` | Create schema runner |
| `WorkerRunner.layerSerialized` | `Layer<never, WorkerError, PlatformRunner \| R \| HandlersContext>` | Serialized runner as Layer |
| `WorkerRunner.launch` | `Effect<void, E \| WorkerError, R>` | Execute layer until close |
| `NodeWorker.layer` | `Layer<WorkerManager \| Spawner>` | Node.js worker support |
| `NodeWorkerRunner.layer` | `Layer<PlatformRunner>` | Node.js runner support |
