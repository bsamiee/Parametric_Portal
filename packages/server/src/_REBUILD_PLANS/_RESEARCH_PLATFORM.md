# @effect/platform Infrastructure Research

> **Phase:** Platform primitives for command execution, filesystem, headers, config, and URL handling.

---

## [1] Command Execution

```typescript
import { Command, CommandExecutor } from "@effect/platform"
import { Effect, pipe } from "effect"

// --- [CONSTRUCTION] ----------------------------------------------------------
const listFiles = Command.make("ls", "-la", "/tmp")

const configured = pipe(
  Command.make("node", "script.js"),
  Command.env({ NODE_ENV: "production" }),
  Command.workingDirectory("/app"),
  Command.runInShell(true) // or Command.runInShell("/bin/bash")
)

// --- [EXECUTION] -------------------------------------------------------------
// String output (UTF-8), fails on non-zero exit
const output = Command.string(Command.make("cat", "/etc/hostname"))

// Array of lines
const lines = Command.lines(Command.make("git", "log", "--oneline", "-5"))

// Exit code only
const exitCode = Command.exitCode(Command.make("test", "-f", "/path"))

// Stream output
const stream = Command.stream(Command.make("tail", "-f", "/var/log/app.log"))
const streamLines = Command.streamLines(Command.make("journalctl", "-f"))

// --- [PROCESS_CONTROL] -------------------------------------------------------
const runProcess = Effect.gen(function* () {
  const process = yield* Command.start(Command.make("long-task"))
  const pid = process.pid
  const running = yield* process.isRunning
  const code = yield* process.exitCode
  yield* process.kill("SIGTERM") // SIGTERM, SIGKILL, SIGINT
})

// --- [PIPING] ----------------------------------------------------------------
const feedInput = pipe(Command.make("wc", "-l"), Command.feed("line1\nline2\n"))

const pipeline = pipe(
  Command.make("cat", "/var/log/app.log"),
  Command.pipeTo(Command.make("grep", "ERROR")),
  Command.pipeTo(Command.make("wc", "-l"))
)
```

---

## [2] Headers Management

```typescript
import { Headers } from "@effect/platform"
import { Option, pipe } from "effect"

// --- [CONSTRUCTION] ----------------------------------------------------------
const empty = Headers.empty

const headers = Headers.fromInput({
  "content-type": "application/json",
  "authorization": "Bearer token123"
})

const fromTuples = Headers.fromInput([["accept", "application/json"]])

// --- [OPERATIONS] ------------------------------------------------------------
const contentType: Option.Option<string> = Headers.get(headers, "content-type")
const hasAuth: boolean = Headers.has(headers, "authorization")
const updated = Headers.set(headers, "x-custom", "value")
const merged = Headers.merge(baseHeaders, overrideHeaders)

// Remove by string, regex, or array
const sanitized = Headers.remove(headers, ["authorization", "cookie"])
const withoutInternal = Headers.remove(headers, /^x-internal-/)

// --- [REDACTION] -------------------------------------------------------------
const redacted = Headers.redact(headers, "authorization")
const redactedMultiple = Headers.redact(headers, ["authorization", "x-api-key"])
```

---

## [3] FileSystem Operations

```typescript
import { FileSystem, PlatformError } from "@effect/platform"
import { Effect, Stream, pipe } from "effect"

// --- [FILE_OPS] --------------------------------------------------------------
const fileOps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  // Read
  const binary: Uint8Array = yield* fs.readFile("/path/to/file")
  const text: string = yield* fs.readFileString("/path/to/file.txt", "utf-8")

  // Write
  yield* fs.writeFile("/path/output", new Uint8Array([1, 2, 3]))
  yield* fs.writeFileString("/path/output.txt", "Hello, World!")

  // Copy/Truncate
  yield* fs.copyFile("/source.txt", "/dest.txt")
  yield* fs.truncate("/path/to/file", 1024n)
})

// --- [DIRECTORY_OPS] ---------------------------------------------------------
const dirOps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem

  const entries = yield* fs.readDirectory("/path/to/dir")
  const recursive = yield* fs.readDirectory("/path", { recursive: true })
  yield* fs.makeDirectory("/new/dir", { recursive: true })

  // Temp directories (scoped = auto-cleanup)
  const tempDir = yield* fs.makeTempDirectory({ prefix: "app-" })
})

// --- [METADATA] --------------------------------------------------------------
const metadata = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const info = yield* fs.stat("/path/to/file")
  // info.type: File | Directory | SymbolicLink | ...
  // info.size: Size (branded bigint)
  // info.mtime: Date

  const exists: boolean = yield* fs.exists("/path/to/file")
  const absolute: string = yield* fs.realPath("./relative/path")
})

// --- [WATCH] -----------------------------------------------------------------
const watchFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  yield* pipe(
    fs.watch("/watched/dir", { recursive: true }),
    Stream.tap((event) => Effect.log(`${event._tag}: ${event.path}`)),
    // event._tag: "Create" | "Update" | "Remove"
    Stream.runDrain
  )
})

// --- [STREAMING_IO] ----------------------------------------------------------
const streamingIO = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const readStream = fs.stream("/large/file.bin", { chunkSize: FileSystem.KiB(64) })
  const writeSink = fs.sink("/output/file.bin")
})

// --- [SIZE_HELPERS] ----------------------------------------------------------
const size = FileSystem.Size(1024n)
const kb = FileSystem.KiB(64)
const mb = FileSystem.MiB(128)
const gb = FileSystem.GiB(2)
```

---

## [4] PlatformConfigProvider

```typescript
import { PlatformConfigProvider, FileSystem } from "@effect/platform"
import { Config, Effect, Layer } from "effect"

// --- [DOTENV] ----------------------------------------------------------------
// Replace ConfigProvider with .env values
const DotEnvLayer = PlatformConfigProvider.layerDotEnv(".env")

// Use .env as fallback (silent if not found)
const DotEnvFallbackLayer = PlatformConfigProvider.layerDotEnvAdd(".env")

// --- [FILE_TREE] -------------------------------------------------------------
// Directory structure as config: /config/database/host -> "localhost"
const FileTreeLayer = PlatformConfigProvider.layerFileTree({ rootDirectory: "/config" })
const FileTreeFallbackLayer = PlatformConfigProvider.layerFileTreeAdd({ rootDirectory: "/config" })

// --- [USAGE] -----------------------------------------------------------------
const AppConfig = Config.all({
  host: Config.string("DATABASE_HOST"),
  port: Config.number("DATABASE_PORT"),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
})

const program = Effect.gen(function* () {
  const config = yield* AppConfig
  return config // { host: string, port: number, debug: boolean }
})
```

---

## [5] PlatformLogger

```typescript
import { PlatformLogger, FileSystem } from "@effect/platform"
import { Logger, Effect, Layer } from "effect"

// --- [FILE_LOGGER] -----------------------------------------------------------
const FileLoggerLayer = Layer.unwrapScoped(
  Effect.gen(function* () {
    const logger = yield* PlatformLogger.toFile(
      Logger.logfmtLogger,
      "/var/log/app.log",
      { batchWindow: "100 millis" }
    )
    return Logger.replace(Logger.defaultLogger, logger)
  })
)

const JsonFileLoggerLayer = Layer.unwrapScoped(
  Effect.gen(function* () {
    const logger = yield* PlatformLogger.toFile(Logger.jsonLogger, "/var/log/app.json")
    return Logger.replace(Logger.defaultLogger, logger)
  })
)
```

---

## [6] URL Manipulation

```typescript
import { Url, UrlParams } from "@effect/platform"
import { Either, Redacted, pipe } from "effect"

// --- [PARSING] ---------------------------------------------------------------
const parsed: Either.Either<URL, IllegalArgumentException> =
  Url.fromString("https://api.example.com/v1/users?page=1")

const relative = Url.fromString("/api/users", "https://api.example.com")

// --- [MODIFICATION] ----------------------------------------------------------
const modified = pipe(
  url,
  Url.setPathname("/v2/users"),
  Url.setPort("8080"),
  Url.setHash("section-1")
)

// Clone and mutate for complex changes
const mutated = Url.mutate(url, (u) => {
  u.pathname = "/api/v2"
  u.port = "3000"
})

// Credentials (supports Redacted)
const withAuth = pipe(url, Url.setUsername("user"), Url.setPassword(Redacted.make("secret")))

// --- [PARAMS_INTEGRATION] ----------------------------------------------------
const params = Url.urlParams(url)
const withParams = Url.modifyUrlParams(url, (p) => UrlParams.set(p, "page", "2"))
```

---

## [7] UrlParams Operations

```typescript
import { UrlParams } from "@effect/platform"
import { Option, Schema } from "effect"

// --- [CONSTRUCTION] ----------------------------------------------------------
const params = UrlParams.fromInput({
  page: 1,        // number -> "1"
  limit: "20",
  active: true,   // boolean -> "true"
  deleted: null   // null -> excluded
})

const fromTuples = UrlParams.fromInput([
  ["tag", "typescript"],
  ["tag", "effect"]  // Multiple values for same key
])

// --- [QUERYING] --------------------------------------------------------------
const first: Option.Option<string> = UrlParams.getFirst(params, "page")
const last: Option.Option<string> = UrlParams.getLast(params, "tag")
const all: ReadonlyArray<string> = UrlParams.getAll(params, "tag")

// --- [MODIFICATION] ----------------------------------------------------------
const withPage = UrlParams.set(params, "page", "2")           // Replaces all
const withTag = UrlParams.append(params, "tag", "functional") // Adds to existing
const withoutPage = UrlParams.remove(params, "page")

// --- [CONVERSION] ------------------------------------------------------------
const queryString = UrlParams.toString(params) // "page=1&limit=20"
const record = UrlParams.toRecord(params)      // { page: "1", tag: ["ts", "effect"] }
const fullUrl = UrlParams.makeUrl("https://api.example.com/search", params, "results")

// --- [SCHEMA_PARSING] --------------------------------------------------------
const SearchParams = Schema.Struct({
  page: Schema.NumberFromString,
  limit: Schema.NumberFromString
})
const parsed = UrlParams.schemaStruct(SearchParams)(params)
// Effect<{ page: number, limit: number }, ParseError>
```

---

## [8] Layer Composition

```typescript
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, pipe } from "effect"
import { Command, CommandExecutor, FileSystem, PlatformConfigProvider } from "@effect/platform"

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const config = yield* fs.readFileString("/app/config.json")

  const output = yield* pipe(
    Command.make("process-data", "--config", "/app/config.json"),
    Command.env({ DATA_PATH: "/data" }),
    Command.string
  )
  return output
})

const MainLayer = Layer.mergeAll(
  NodeContext.layer,
  PlatformConfigProvider.layerDotEnvAdd(".env")
)

const main = program.pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
```

---

## [9] Quick Reference

| Module | Key Functions | Use Case |
|--------|--------------|----------|
| `Command` | `make`, `string`, `lines`, `exitCode`, `start`, `pipeTo` | Subprocess execution |
| `CommandExecutor` | Service tag, `Process.pid/kill/exitCode` | Process management |
| `Headers` | `fromInput`, `get`, `set`, `merge`, `redact`, `remove` | HTTP header handling |
| `FileSystem` | `readFile`, `writeFile`, `stat`, `watch`, `stream`, `sink` | File operations |
| `PlatformConfigProvider` | `layerDotEnv`, `layerFileTree`, `*Add` variants | Config sources |
| `PlatformLogger` | `toFile` | File-based logging |
| `Url` | `fromString`, `set*`, `mutate`, `modifyUrlParams` | URL manipulation |
| `UrlParams` | `fromInput`, `get*`, `set`, `append`, `toString`, `schemaStruct` | Query parameters |
