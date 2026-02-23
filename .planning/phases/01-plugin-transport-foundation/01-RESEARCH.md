# Phase 1: Plugin Transport Foundation - Research

**Researched:** 2026-02-22 (re-research)
**Domain:** WebSocket bridge (C#/.NET 9 plugin in Rhino 9 WIP <-> TypeScript/Effect CLI harness) on localhost
**Confidence:** HIGH

## Summary

Phase 1 establishes a reliable WebSocket transport layer between a Rhino 9 WIP plugin (C#, net9.0) and the CLI harness (TypeScript, Effect). The codebase already contains substantial protocol infrastructure on both sides -- the C# plugin has typed envelopes (`CommandEnvelope`, `CommandResultEnvelope`, `HandshakeEnvelope`, `HeartbeatEnvelope`), handshake negotiation (`Handshake.Negotiate`), session state machine (`SessionHost` with `Connected -> Active -> Terminal` phases), command routing (`CommandRouter.Decode`), failure mapping (`FailureMapping`), event publishing (`EventPublisher` with atomic drain), 14 value objects, 9 smart enums, and the full protocol model layer. The TS harness has a WebSocket client (`KargadanSocketClient` with Deferred-correlated request/response), `CommandDispatch` service, `SessionSupervisor` state machine (`idle -> connected -> authenticated -> active -> terminal`), agent loop (`AgentLoop` with `PLAN -> EXECUTE -> VERIFY -> PERSIST -> DECIDE` recursive dispatch), and in-memory `PersistenceTrace` with SHA-256 snapshot hashing.

**What is missing to satisfy Phase 1 requirements:**

1. **No WebSocket server in the C# plugin** -- the plugin has complete protocol logic (session state machine, handshake negotiation, command routing, event publishing) but no actual TCP listener or WebSocket acceptor. The `KargadanPlugin.cs` entry point wires `EventPublisher` and `SessionHost` in `OnLoad` but has no code to accept incoming connections.

2. **No reconnection logic in the harness** -- `KargadanSocketClientLive` composes `Socket.layerWebSocket(socketUrl)` once. Disconnect kills the connection permanently. The `socket.run(_dispatchChunk)` call runs until the socket closes, then the fiber exits. There is no retry, no port re-read, no checkpoint restore.

3. **No port file discovery** -- the harness reads `KARGADAN_PLUGIN_HOST` and `KARGADAN_PLUGIN_PORT` from environment variables via `Config`. There is no mechanism for the plugin to write a dynamically-assigned port and the harness to read it.

4. **No `RhinoApp.InvokeOnUiThread` marshaling** -- `KargadanPlugin.HandleCommand` calls `CommandRouter.Decode` and the provided `onCommand` callback directly. No UI thread dispatch exists. On macOS, any call that touches `RhinoDoc` from the WebSocket receive thread will throw `NSInternalInconsistencyException`.

5. **No PostgreSQL checkpoint storage** -- `PersistenceTrace` is entirely in-memory (`Ref` over arrays). Harness crash or restart loses all session state. The user decision mandates PostgreSQL-backed checkpoints from Phase 1.

6. **csproj targets `net10.0`** -- `Directory.Build.props` sets `<TargetFramework>net10.0</TargetFramework>` globally. The plugin inherits this, but Rhino 9 WIP runs .NET 9 (`NetCoreVersion=v9`). Loading a net10.0 assembly causes `TypeLoadException`. Needs local `<TargetFramework>net9.0</TargetFramework>` override.

7. **`Rhino.Inside` package reference** -- the csproj includes `<PackageReference Include="Rhino.Inside" Version="$(RhinoInsideVersion)" />`. REQUIREMENTS.md explicitly excludes Rhino.Inside ("Windows-only, confirmed unavailable on macOS"). Must be removed.

8. **No CLI setup command** -- no `kargadan setup` command exists to copy the plugin DLL to Rhino's plugin folder and configure auto-load.

**Primary recommendation:** Build the WebSocket server in the C# plugin using `TcpListener` + manual HTTP upgrade + `WebSocket.CreateFromStream` (no ASP.NET/Kestrel dependency). Implement reconnection in the harness using Effect `Schedule.exponential` with jitter and cap. Add `RhinoApp.InvokeOnUiThread` wrapper for all inbound command dispatch. Write port file on listener start, read on harness connect. Replace in-memory `PersistenceTrace` with `@effect/sql-pg` backed checkpoint storage.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- JSON end-to-end as single wire format -- harness, plugin, and DB all speak JSON. No mixed paradigms
- Tagged union message structure with `_tag` discriminator field -- aligns with Effect `Schema.TaggedClass` on TS side and `[JsonPolymorphic]`/`[JsonDerivedType]` on C# side
- Both request-response (commands with `requestId` correlation) and push (events/heartbeat without `requestId`) message patterns -- dispatched by `_tag`
- Protocol version negotiated once at connection handshake -- harness declares version, plugin confirms or rejects. No per-message version field
- Dynamic port discovery via file -- plugin picks an available port, writes it to a known file path, harness reads on connect
- Exponential backoff on disconnect -- start fast (500ms), slow down exponentially (cap ~30s)
- Drop and notify during disconnection -- reject outbound sends with immediate error, agent loop's DECIDE stage handles retry after reconnect
- Auto-start on Rhino launch via `PluginLoadTime.AtStartup` -- WebSocket listener opens immediately on plugin load
- CLI setup command (`kargadan setup`) copies plugin DLL to Rhino's plugin folder and configures auto-load. One-time setup with confirmation
- Fully headless inside Rhino -- no status bar, no tray icon, no visible UI. Status observable only from CLI harness
- **Rhino 9 only** -- single `net9.0` target. No Rhino 8, no multi-target build. Overrides multi-target aspect of TRAN-02
- Checkpoint scope: conversation history AND agent loop state (current stage). On reconnect, loop resumes where it was
- In-flight commands on disconnect: fail and report with disconnection error. No auto-retry (command may have partially executed)
- PostgreSQL checkpoint storage from Phase 1 -- no intermediate local file mechanism. DB connection is a Phase 1 dependency
- Verify on reconnect -- harness queries current scene state and compares to checkpoint. Flags divergence if user made manual changes during disconnect

### Claude's Discretion
- Heartbeat interval and staleness timeout calibration for localhost latency
- Exact exponential backoff parameters (initial delay, multiplier, cap)
- Port file location and format
- Handshake message schema details
- WebSocket frame size limits and chunking strategy for large payloads

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRAN-01 | Plugin opens WebSocket listener on localhost, accepting connections from CLI harness | WebSocket server via `TcpListener` + manual HTTP upgrade handshake + `WebSocket.CreateFromStream` in .NET 9; port file discovery; `PluginLoadTime.AtStartup` auto-start; bind exclusively to `IPAddress.Loopback` |
| TRAN-02 | Plugin targets net9.0 for Rhino 9 WIP (user overrode multi-target to Rhino 9 only) | Rhino 9 WIP runs .NET Core v9; csproj needs local `<TargetFramework>net9.0</TargetFramework>` override of Directory.Build.props `net10.0`; `Rhino.Inside` package reference must be removed |
| TRAN-03 | All incoming WebSocket commands marshaled to UI thread via `RhinoApp.InvokeOnUiThread` | macOS AppKit enforces main-thread-only access to RhinoDoc; `InvokeOnUiThread` delegates to main thread via `new Action(() => { ... })`; pattern confirmed by McNeel forums and developer docs |
| TRAN-04 | Harness detects plugin disconnection and reconnects automatically | Effect `Schedule.exponential` with `Schedule.jittered` for reconnect; `SocketCloseError` detection via `@effect/platform` Socket; port file re-read on reconnect; in-flight commands fail with disconnection error |
| TRAN-05 | Session state survives plugin disconnection -- harness restores from PostgreSQL checkpoint | `@effect/sql-pg` 0.50.3 for PostgreSQL; checkpoint schema with conversation history + loop state (`LoopState.Type`); replay from last snapshot on reconnect; verify scene state hash against checkpoint |
| TRAN-06 | Heartbeat keepalive detects stale connections within configurable timeout | Dual-layer: .NET 9 native PING/PONG via `WebSocketCreationOptions.KeepAliveInterval` + `KeepAliveTimeout` for transport-level; application-level heartbeat via `HeartbeatEnvelope` ping/pong already implemented in harness `CommandDispatch.heartbeat` |
</phase_requirements>

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| `System.Net.WebSockets` (.NET 9) | Built-in | WebSocket server inside Rhino plugin | No ASP.NET dependency; `WebSocket.CreateFromStream(stream, WebSocketCreationOptions)` creates server-side WebSocket from any `Stream`; .NET 9 adds native PING/PONG keep-alive with `KeepAliveTimeout` |
| `System.Net.Sockets.TcpListener` (.NET 9) | Built-in | TCP listener for accepting WebSocket upgrade | Lightweight; no HTTP server overhead; cross-platform (macOS + Windows); bind to `IPAddress.Loopback` for localhost-only access |
| `System.Text.Json` (.NET 9) | Built-in | JSON serialization with `[JsonPolymorphic]`/`[JsonDerivedType]` | Tagged union discriminator support via `_tag` property; aligns with Effect Schema `_tag` pattern; existing `CommandRouter.Decode` uses `JsonElement` throughout |
| `@effect/platform` Socket | 0.94.5 | WebSocket client in harness | Effect-native Socket abstraction; `makeWebSocket(url)`, `socket.run(handler)`, `socket.writer`; typed error handling via `SocketCloseError`; existing `KargadanSocketClient` built on this |
| `@effect/sql-pg` | 0.50.3 | PostgreSQL checkpoint storage | Effect-native SQL client; already in workspace catalog at exact version; `PgClient.layer(config)` for connection pool; `SqlClient` for typed queries |
| `@effect/sql` | 0.49.0 | SQL client abstraction layer | Already in workspace catalog; `SqlClient.SqlClient` provides vendor-agnostic query interface; `sql.insert`, `sql.update` for typed parameter insertion |
| `effect` Schedule | 3.19.18 | Exponential backoff reconnection | `Schedule.exponential(base, factor)` + `Schedule.jittered` + `Schedule.upTo(cap)`; composes with `Effect.retry`; matches existing `Resilience` patterns in monorepo |
| `RhinoCommon` | 9.0.25350.305-wip | Rhino 9 WIP plugin SDK | `RhinoApp.InvokeOnUiThread` for thread marshaling; `PlugIn` base class; `PluginLoadTime` for auto-start; API surface stable across WIP builds for these methods |
| `LanguageExt.Core` | 5.0.0-beta-77 | Functional C# primitives | `Fin<T>` for Result-like error handling; `Option<T>` for nullable fields; `Atom<T>` and `Ref<T>` for lock-free state; `Seq<T>` for immutable sequences; already used throughout plugin |
| `NodaTime` | 3.3.0 | Time handling in C# plugin | `Instant` for timestamps in session lifecycle; already used in `SessionHost`/`Handshake`; `Duration` for heartbeat intervals |
| `Thinktecture.Runtime.Extensions` | 10.0.0 | Value objects and smart enums | `[ValueObject<T>]` for typed protocol primitives (14 VOs already defined); `[SmartEnum<string>]` for closed enum sets (9 already defined); source-generated |

### Supporting

| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `Polly.Core` | 8.6.5 | Resilience in C# (optional) | Circuit breaker on WebSocket accept loop if needed; already in workspace; not strictly required since the listener loop is simple |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `TcpListener` + `WebSocket.CreateFromStream` | ASP.NET Core Kestrel minimal API | Kestrel adds 15+ MB of ASP.NET dependencies to the Rhino plugin; pulls in DI container, hosting abstractions, middleware pipeline; conflicts with Rhino's plugin lifecycle |
| `TcpListener` + `WebSocket.CreateFromStream` | `HttpListener` | Deprecated per dotnet/platform-compat#88; no macOS support path; no new improvements planned; Microsoft recommends alternatives |
| `TcpListener` + `WebSocket.CreateFromStream` | Third-party (Fleck, WebSocketSharp) | External dependency adds version/compat risk inside Rhino; `System.Net.WebSockets` is built-in and maintained by Microsoft |
| Application-level heartbeat only | .NET 9 native WebSocket PING/PONG only | Native PING/PONG detects transport-level dead connections but does not confirm application liveness; both layers needed -- transport PING/PONG catches network-level failures, application heartbeat catches hung application logic |
| `@effect/platform` Socket | Raw `ws` npm package | `@effect/platform` Socket integrates with Effect runtime, error channel, fiber interruption; existing `KargadanSocketClient` is already built on it; raw `ws` would require manual Effect wrapping |

### Installation

**C# side:** No new NuGet packages needed. All APIs (`TcpListener`, `WebSocket.CreateFromStream`, `System.Text.Json`) are built into .NET 9 SDK. The csproj needs two changes:
1. Override target framework: `<TargetFramework>net9.0</TargetFramework>` (replaces inherited `net10.0`)
2. Remove `Rhino.Inside` reference (Windows-only, out of scope)

**TS side:** `@effect/sql` and `@effect/sql-pg` are already in the workspace catalog. Add to harness `package.json`:
```json
"@effect/sql": "catalog:",
"@effect/sql-pg": "catalog:"
```

## Architecture Patterns

### Recommended Project Structure

```
apps/kargadan/
  plugin/                                   # C# Rhino plugin (net9.0)
    src/
      boundary/
        KargadanPlugin.cs                   # PlugIn entry point (EXISTS -- needs WebSocket lifecycle)
        EventPublisher.cs                   # Event queue (EXISTS -- no changes)
      contracts/
        ProtocolEnvelopes.cs                # Typed envelopes (EXISTS -- no changes)
        ProtocolModels.cs                   # Domain models (EXISTS -- no changes)
        ProtocolEnums.cs                    # Smart enums (EXISTS -- no changes)
        ProtocolValueObjects.cs             # Value objects (EXISTS -- no changes)
        Require.cs                          # Validation (EXISTS -- no changes)
        DomainBridge.cs                     # Parsing bridge (EXISTS -- no changes)
        ProtocolContracts.cs                # [NEW] Wire-format message types with [JsonPolymorphic]
      protocol/
        Router.cs                           # Command routing (EXISTS -- no changes)
        FailureMapping.cs                   # Error mapping (EXISTS -- no changes)
      transport/
        SessionHost.cs                      # Session state machine (EXISTS -- no changes)
        Handshake.cs                        # Handshake negotiation (EXISTS -- no changes)
        WebSocketHost.cs                    # [NEW] TcpListener + HTTP upgrade + WebSocket server
        PortFile.cs                         # [NEW] Atomic port file write/read/cleanup
        ThreadMarshaler.cs                  # [NEW] InvokeOnUiThread wrapper with TaskCompletionSource
  harness/                                  # TypeScript CLI harness
    src/
      config.ts                             # Config resolution (EXISTS -- needs port file path config)
      socket.ts                             # WebSocket client (EXISTS -- needs reconnect integration)
      harness.ts                            # Entry point (EXISTS -- needs layer composition update)
      protocol/
        dispatch.ts                         # Command dispatch (EXISTS -- needs disconnect error handling)
        supervisor.ts                       # Session state machine (EXISTS -- no changes)
      runtime/
        agent-loop.ts                       # Agent loop (EXISTS -- needs checkpoint restore on reconnect)
        loop-stages.ts                      # Pure stage functions (EXISTS -- no changes)
        persistence-trace.ts                # In-memory trace (EXISTS -- to be replaced by checkpoint service)
      transport/
        reconnect.ts                        # [NEW] Reconnection supervisor with backoff schedule
        port-discovery.ts                   # [NEW] Port file reader with file watcher
      persistence/
        checkpoint.ts                       # [NEW] PostgreSQL checkpoint service
        schema.ts                           # [NEW] Checkpoint table schema + migration
```

### Pattern 1: WebSocket Server via TcpListener (C# Plugin)

**What:** Standalone WebSocket server inside Rhino plugin without ASP.NET. Uses `TcpListener` bound to `IPAddress.Loopback` to accept TCP connections on a dynamically-assigned port (port 0), performs the HTTP WebSocket upgrade handshake manually (parse `Sec-WebSocket-Key`, compute SHA-1 accept hash, send 101 Switching Protocols), then wraps the stream with `WebSocket.CreateFromStream`.

**When to use:** Hosting a WebSocket server inside a process that cannot use ASP.NET Core (Rhino plugin has its own lifecycle, no DI container, no hosting abstractions).

**Key implementation details:**
- `TcpListener(IPAddress.Loopback, 0)` -- OS assigns a free port; retrieve via `((IPEndPoint)listener.LocalEndpoint).Port`
- HTTP upgrade is approximately 30 lines of well-defined code (RFC 6455 section 4.2.2)
- `WebSocketCreationOptions` enables .NET 9 native PING/PONG: `KeepAliveInterval = 5s`, `KeepAliveTimeout = 15s`
- Background receive loop must remain active for PONG processing (see Pitfall 4)
- Single-connection architecture: plugin accepts one connection at a time (the CLI harness); rejects additional connections
- CancellationToken propagation: `OnShutdown` cancels the listener and cleans up the port file

```csharp
TcpListener listener = new(IPAddress.Loopback, port: 0);
listener.Start();
int assignedPort = ((IPEndPoint)listener.LocalEndpoint).Port;
// Write assignedPort to port file (atomic: write temp, rename)

TcpClient client = await listener.AcceptTcpClientAsync(cancellationToken);
NetworkStream stream = client.GetStream();
// Parse HTTP upgrade request, compute Sec-WebSocket-Accept, send 101 response
WebSocket webSocket = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions
{
    IsServer = true,
    KeepAliveInterval = TimeSpan.FromSeconds(5),
    KeepAliveTimeout = TimeSpan.FromSeconds(15),
});
```

### Pattern 2: HTTP WebSocket Upgrade Handshake (C# Manual)

**What:** The `WebSocket.CreateFromStream` API requires the HTTP upgrade to be completed before it takes over. For a `TcpListener` approach, the upgrade must be done manually: read the HTTP GET request, extract `Sec-WebSocket-Key`, compute the SHA-1 accept hash per RFC 6455 section 4.2.2, and send the 101 Switching Protocols response.

**When to use:** Every incoming TCP connection that intends to upgrade to WebSocket.

**Key facts:**
- The upgrade handshake is stable (RFC 6455, published 2011, unchanged since)
- The accept hash computation is: `Base64(SHA1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`
- This is approximately 30 lines of straightforward code
- The harness's `@effect/platform` `makeWebSocket` handles the client-side upgrade automatically

```csharp
private static async Task<WebSocket?> AcceptWebSocketAsync(
    NetworkStream stream, CancellationToken ct)
{
    byte[] buffer = new byte[4096];
    int bytesRead = await stream.ReadAsync(buffer, ct);
    string request = Encoding.UTF8.GetString(buffer, 0, bytesRead);

    if (!request.Contains("Upgrade: websocket", StringComparison.OrdinalIgnoreCase))
        return null;

    string key = Regex.Match(request, @"Sec-WebSocket-Key:\s*(.+?)\r\n")
        .Groups[1].Value.Trim();

    string acceptHash = Convert.ToBase64String(
        SHA1.HashData(
            Encoding.UTF8.GetBytes(
                key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));

    string response = string.Join("\r\n",
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        $"Sec-WebSocket-Accept: {acceptHash}",
        "", "");

    await stream.WriteAsync(Encoding.UTF8.GetBytes(response), ct);

    return WebSocket.CreateFromStream(stream, new WebSocketCreationOptions
    {
        IsServer = true,
        KeepAliveInterval = TimeSpan.FromSeconds(5),
        KeepAliveTimeout = TimeSpan.FromSeconds(15),
    });
}
```

### Pattern 3: UI Thread Marshaling (C# Plugin)

**What:** All RhinoDoc operations must execute on Rhino's UI thread on macOS. WebSocket messages arrive on background threads. `RhinoApp.InvokeOnUiThread` queues the delegate for main-thread execution. A `TaskCompletionSource<T>` bridges the async gap between the background receive loop and the UI thread result.

**When to use:** Every inbound command that touches `RhinoDoc`, layers, objects, or viewport. Pure geometry computations (`Rhino.Geometry.*`) are thread-safe and do not require marshaling.

**Key implementation details:**
- Decode JSON on background thread (pure, no RhinoDoc access) -- this is safe
- Marshal only the RhinoDoc operation via `InvokeOnUiThread`
- Use `TaskCompletionSource<CommandResultEnvelope>` to capture the result back to the background thread
- Never block the receive loop waiting for UI thread -- the TCS callback fires asynchronously

```csharp
async Task<CommandResultEnvelope> HandleOnUiThread(
    CommandEnvelope command, CancellationToken ct)
{
    TaskCompletionSource<CommandResultEnvelope> tcs = new();
    RhinoApp.InvokeOnUiThread(new Action(() =>
    {
        Fin<CommandResultEnvelope> result = ProcessCommand(command);
        result.Match(
            Succ: response => tcs.SetResult(response),
            Fail: error => tcs.SetException(
                new InvalidOperationException(error.Message)));
    }));
    return await tcs.Task.WaitAsync(ct);
}
```

### Pattern 4: Reconnection with Exponential Backoff (TS Harness)

**What:** Harness wraps the WebSocket connection in a reconnection supervisor. On disconnect, it re-reads the port file (plugin may have restarted on a different port), applies exponential backoff with jitter, and re-establishes the connection with a fresh handshake. In-flight commands fail immediately with a disconnection error (no auto-retry per user decision).

**When to use:** Every connection lifecycle in the harness.

**Key implementation details:**
- `Schedule.exponential(500ms, 2)` starts at 500ms, doubles each attempt
- `Schedule.jittered` adds random variance to prevent thundering herd
- `Schedule.upTo(30s)` caps the maximum delay
- `Schedule.intersect(Schedule.recurs(50))` limits total reconnection attempts
- On reconnect: re-read port file, create new socket, run full handshake, restore from checkpoint, verify scene state

```typescript
const _reconnectSchedule = Schedule.exponential(Duration.millis(500), 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(50)),
    Schedule.upTo(Duration.seconds(30)),
);

const supervise = Effect.gen(function* () {
    const connectionState = yield* Ref.make<'disconnected' | 'connected' | 'reconnecting'>('disconnected');

    const connectOnce = Effect.gen(function* () {
        const port = yield* readPortFile;
        const socket = yield* makeWebSocketConnection(port);
        yield* Ref.set(connectionState, 'connected');
        yield* runProtocolLoop(socket); // blocks until disconnect
    });

    const withReconnect = connectOnce.pipe(
        Effect.tapError(() => Ref.set(connectionState, 'reconnecting')),
        Effect.retry({ schedule: _reconnectSchedule }),
    );

    return yield* withReconnect;
});
```

### Pattern 5: Port File Discovery

**What:** Plugin writes its dynamically assigned port to a known file path. Harness reads this file to discover the connection endpoint. File is overwritten on every plugin start (atomic write prevents partial reads). File is deleted on plugin shutdown (best-effort).

**When to use:** Every connection initiation.

**Recommended location:** `~/.kargadan/port` (simple file, platform-agnostic path)

**Format:** JSON with metadata for validation:
```json
{"port": 9181, "pid": 12345, "startedAt": "2026-02-22T10:00:00Z"}
```

JSON format allows:
- `pid` for process validation -- harness checks if PID is alive before connecting (prevents connecting to a stale port used by another process)
- `startedAt` for staleness detection -- harness can warn if the port file is older than expected
- Future extension without format changes

**Atomic write pattern:** write to `~/.kargadan/port.tmp`, then `File.Move(temp, target, overwrite: true)` -- prevents the harness from reading a partially-written file.

### Pattern 6: PostgreSQL Checkpoint Storage

**What:** Replace in-memory `PersistenceTrace` with `@effect/sql-pg` backed storage. Checkpoint includes conversation history, agent loop state (`LoopState.Type` -- current stage, attempt count, operations remaining, correction cycles), and a SHA-256 state hash for verification. On reconnect, harness loads the last checkpoint and compares its state hash against the current scene state from the plugin.

**When to use:** Every state transition in the agent loop persists to PostgreSQL. On reconnect, the latest checkpoint for the session is loaded and the loop resumes from that point.

**Schema shape (conceptual):**
```sql
CREATE TABLE kargadan_checkpoints (
    session_id   UUID PRIMARY KEY,
    run_id       UUID NOT NULL,
    sequence     INT NOT NULL,
    loop_state   JSONB NOT NULL,     -- serialized LoopState.Type
    history      JSONB NOT NULL,     -- conversation events array
    state_hash   TEXT NOT NULL,      -- SHA-256 of canonical state
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_checkpoint_run ON kargadan_checkpoints(run_id);
```

```typescript
import { PgClient } from '@effect/sql-pg';
import { SqlClient } from '@effect/sql';

const saveCheckpoint = Effect.fn('checkpoint.save')((checkpoint: Checkpoint) =>
    SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) =>
            sql`INSERT INTO kargadan_checkpoints ${sql.insert(checkpoint)}
                ON CONFLICT (session_id) DO UPDATE SET ${sql.update(checkpoint)}`
        ),
    ),
);
```

### Pattern 7: JsonPolymorphic Wire Format (C# Serialization)

**What:** The existing C# codebase uses LanguageExt `[Union]` for internal discriminated unions (`HandshakeEnvelope`, `CommandResultEnvelope`). For the WebSocket wire boundary where `System.Text.Json` handles serialization/deserialization directly, `[JsonPolymorphic]` with `[JsonDerivedType]` provides automatic `_tag` discriminator support that aligns with the Effect `Schema.TaggedClass` pattern on the TS side.

**When to use:** Serialization at the WebSocket boundary. Internal domain logic continues using `[Union]` for pattern matching.

**Coexistence:** `[JsonPolymorphic]` for wire-format types, `[Union]` for internal domain types. The two patterns serve different purposes and do not conflict.

```csharp
[JsonPolymorphic(TypeDiscriminatorPropertyName = "_tag")]
[JsonDerivedType(typeof(HandshakeInit), "handshake.init")]
[JsonDerivedType(typeof(HandshakeAck), "handshake.ack")]
[JsonDerivedType(typeof(HandshakeReject), "handshake.reject")]
[JsonDerivedType(typeof(Command), "command")]
[JsonDerivedType(typeof(Result), "result")]
[JsonDerivedType(typeof(Heartbeat), "heartbeat")]
[JsonDerivedType(typeof(Event), "event")]
public abstract record ProtocolMessage { ... }
```

### Anti-Patterns to Avoid

- **ASP.NET Core in a Rhino plugin:** Adds 15+ MB of dependencies; Kestrel's DI container, hosting abstractions, and middleware pipeline conflict with Rhino's plugin lifecycle. Use raw `TcpListener` + `WebSocket.CreateFromStream` instead.
- **HttpListener for WebSocket hosting:** Deprecated per dotnet/platform-compat#88. No macOS support path. No new improvements planned. Use `TcpListener` + `WebSocket.CreateFromStream`.
- **Accessing RhinoDoc from WebSocket receive thread:** Causes `NSInternalInconsistencyException` on macOS. Always marshal via `InvokeOnUiThread`. Geometry-only computations (`Rhino.Geometry.*`) are thread-safe.
- **Auto-retrying in-flight commands on disconnect:** A command may have partially executed in Rhino (geometry created, layer modified). Auto-retry would double-apply. Fail immediately, let the DECIDE stage handle it after reconnect (user decision).
- **Hardcoded port:** Plugin may conflict with other processes. Always bind to port 0 and discover via port file.
- **In-memory-only session state:** Harness process crash loses all history. PostgreSQL checkpoint from Phase 1 per user decision.
- **Blocking the receive loop with long-running operations:** .NET 9 PING/PONG keep-alive only processes incoming PONG frames while there is an outstanding `ReceiveAsync` call. Long-running operations must be dispatched to the UI thread via `TaskCompletionSource`, not executed inline in the receive loop.
- **Binding WebSocket listener to `0.0.0.0`:** Exposes the listener to the entire LAN. Any process could send arbitrary Rhino commands via `RhinoApp.RunScript`. Bind exclusively to `IPAddress.Loopback` (`127.0.0.1`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket protocol (framing, masking, opcodes) | Custom TCP frame parser | `WebSocket.CreateFromStream` | RFC 6455 compliance is non-trivial; .NET built-in handles fragmentation, masking, control frames, close handshake |
| Exponential backoff with jitter | Manual timer + counter | `Schedule.exponential` + `Schedule.jittered` + `Schedule.upTo` | Effect Schedule composes with retry, handles fiber interruption, tested in monorepo `Resilience` module |
| JSON tagged union discriminator | Custom `_tag` dispatch logic in C# | `[JsonPolymorphic(TypeDiscriminatorPropertyName = "_tag")]` + `[JsonDerivedType]` | System.Text.Json handles serialization/deserialization, round-trip fidelity, error reporting |
| WebSocket keep-alive detection | Application-only ping/pong timer | .NET 9 `KeepAliveInterval` + `KeepAliveTimeout` + application heartbeat | Transport-level PING/PONG is protocol-standard; application heartbeat adds liveness confirmation. Both needed, neither alone sufficient |
| PostgreSQL connection pooling | Custom pool manager | `@effect/sql-pg` `PgClient.layer` | Built-in connection pooling via `postgres.js`; already in workspace catalog; configurable `maxConnections`, `idleTimeout`, `connectTimeout` |
| Port file atomic write | Manual locking / file watching | `File.Move(temp, target, overwrite: true)` | Atomic rename is guaranteed by the OS filesystem; prevents partial reads from the harness |
| SHA-256 state hashing | Custom hash function | `hashCanonicalState` (already exists in `persistence-trace.ts`) | Deterministic JSON serialization with recursive key-sorting already implemented and tested |

**Key insight:** The WebSocket protocol, keep-alive detection, and connection pooling are all areas where the standard library implementations have years of edge-case fixes that hand-rolled solutions will miss (e.g., fragmented messages, partial reads, connection state races, half-open TCP connections).

## Common Pitfalls

### Pitfall 1: NSInternalInconsistencyException on macOS

**What goes wrong:** Plugin receives a WebSocket message on a background thread and directly accesses `RhinoDoc` (creates geometry, modifies layers, queries objects). On macOS, AppKit's layout engine throws `NSInternalInconsistencyException` because it enforces strict main-thread-only access.
**Why it happens:** Rhino on macOS uses Cocoa/AppKit which has stricter threading rules than Windows WPF/WinForms. On Windows the same call succeeds 99.999% of the time and gives "random crashes the remaining 0.001%" (McNeel developer quote). The non-deterministic nature makes it easy to miss in testing.
**How to avoid:** Every inbound command that touches RhinoDoc must be wrapped in `RhinoApp.InvokeOnUiThread(new Action(() => { ... }))`. Decode JSON on the background thread (pure, safe), marshal only the RhinoDoc operation. Geometry-only computations using `Rhino.Geometry.*` are thread-safe and do not require marshaling.
**Warning signs:** Crashes on macOS that don't reproduce on Windows; `NSInternalInconsistencyException` in crash logs; "Modifications to the layout engine must not be performed from a background thread."
**Source:** [McNeel Forum](https://discourse.mcneel.com/t/changing-document-properties-in-async-thread-crashes-mac-but-not-windows/192198), [RhinoCommon API](https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_RhinoApp_InvokeOnUiThread.htm)

### Pitfall 2: Plugin csproj Inheriting net10.0 from Directory.Build.props

**What goes wrong:** `Directory.Build.props` sets `<TargetFramework>net10.0</TargetFramework>` globally. The Kargadan plugin inherits this, but Rhino 9 WIP runs .NET Core v9. Loading a net10.0 assembly in Rhino 9 causes `TypeLoadException` or assembly binding failures.
**Why it happens:** The monorepo targets .NET 10 for its own server infrastructure, but Rhino 9 WIP ships with .NET 9 runtime.
**How to avoid:** Override `<TargetFramework>net9.0</TargetFramework>` in the plugin's own csproj. This is standard MSBuild -- local PropertyGroup wins over imported properties. Also remove the `Rhino.Inside` package reference.
**Warning signs:** `TypeLoadException` on plugin load; "Could not load file or assembly" errors; plugin not appearing in Rhino Plugin Manager.
**Source:** [McNeel Forum](https://discourse.mcneel.com/t/in-rhino9-wip-runtime-netcore-netcoreversion-v9-only-v9/200697)

### Pitfall 3: Port Collision and Stale Port Files

**What goes wrong:** Plugin writes port file, then crashes without cleanup. Next launch reads stale port file pointing to a port now used by another process, or the harness connects to the wrong process.
**Why it happens:** `OnShutdown` may not run if Rhino force-quits or crashes. Port file persists.
**How to avoid:** (1) Include PID in port file; harness validates PID is alive before connecting. (2) Plugin overwrites port file on every start (atomic write: write to temp, rename). (3) Harness treats connection failure after port file read as "port stale, retry" rather than fatal error. (4) The handshake protocol version check will catch connections to wrong processes.
**Warning signs:** Harness connects but handshake fails with unexpected response; harness connects to wrong process.

### Pitfall 4: WebSocket ReceiveAsync Must Be Continuously Active for PONG Processing

**What goes wrong:** .NET 9's PING/PONG keep-alive only processes incoming PONG frames while there is an outstanding `ReceiveAsync` call. If the server is busy processing a command and not reading, PONG frames pile up, `KeepAliveTimeout` fires, and the connection is aborted even though the client is alive.
**Why it happens:** The `WebSocket` internal state machine processes frames only during active `ReceiveAsync`. This is by design but counter-intuitive.
**How to avoid:** Maintain a continuously running receive loop. Dispatch long-running operations to `RhinoApp.InvokeOnUiThread` via `TaskCompletionSource` so the receive loop immediately returns to waiting. Never block the receive loop with command processing.
**Warning signs:** Connections dropping after exactly `KeepAliveTimeout` seconds; false-positive aborts; "The WebSocket didn't receive a Pong frame" errors.
**Source:** [Microsoft Learn - WebSockets in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/websockets)

### Pitfall 5: Reconnect Without State Verification

**What goes wrong:** Harness reconnects after a disconnection and resumes the agent loop without checking whether the Rhino document changed during the gap. Agent operates on stale assumptions (e.g., object it was modifying was deleted by user).
**Why it happens:** Natural to assume document is unchanged after reconnect, but user can interact with Rhino while harness is disconnected.
**How to avoid:** On reconnect, harness queries a scene summary from the plugin and compares against the checkpoint's state hash. If diverged, flag to the agent loop so DECIDE stage can re-plan rather than blindly continue.
**Warning signs:** Agent tries to modify objects that no longer exist; geometry operations fail with "object not found"; undo stack is inconsistent.

### Pitfall 6: RhinoCommon WIP Version Mismatch

**What goes wrong:** Plugin references `RhinoCommon 9.0.25350.305-wip` which may not match the exact Rhino 9 WIP build the user has installed. API changes between WIP builds can cause `MissingMethodException` or `TypeLoadException`.
**Why it happens:** Rhino WIP is not stable -- APIs can change between builds. The NuGet reference is a specific point-in-time snapshot.
**How to avoid:** (1) Use only well-established APIs (`InvokeOnUiThread`, `RunScript`, `PlugIn` base class, `PluginLoadTime`) that are stable across WIP versions. (2) Document the minimum Rhino 9 WIP build version. (3) The `kargadan setup` command should check Rhino version compatibility. (4) The handshake includes `RhinoApp.Version` in the `ServerInfo` response -- the harness can validate compatibility.
**Warning signs:** `MissingMethodException` on plugin load; methods exist in NuGet reference but not in installed Rhino.

### Pitfall 7: In-Flight Command on Disconnect

**What goes wrong:** A command is in-flight (harness sent it, plugin is executing it) when the connection drops. The harness reconnects and re-issues the command, but the first execution may have partially completed (geometry created, layer modified). Result: duplicate geometry or corrupt state.
**Why it happens:** The `KargadanSocketClient` pending map has a Deferred that was never resolved. On disconnect, the fiber interrupts and the Deferred is abandoned.
**How to avoid:** Per user decision: fail in-flight commands immediately with a disconnection error. Do not auto-retry. On reconnect, query the scene state from the plugin, compare to checkpoint, and let the DECIDE stage determine whether to retry, compensate, or skip. The idempotency token system (already in `CommandEnvelope`) provides deduplication if the same command is re-issued after reconnect.
**Warning signs:** Duplicate geometry in the document after reconnect; undo stack containing commands that appear twice; session IDs in loop trace events diverging from plugin session IDs.

## Code Examples

### Port File Operations (C# Plugin)

```csharp
private static readonly string PortFilePath =
    Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".kargadan", "port");

static void WritePortFile(int port)
{
    string directory = Path.GetDirectoryName(PortFilePath)!;
    Directory.CreateDirectory(directory);

    string json = JsonSerializer.Serialize(new
    {
        port,
        pid = Environment.ProcessId,
        startedAt = DateTimeOffset.UtcNow,
    });

    // Atomic write: temp file + rename prevents partial reads
    string tempPath = PortFilePath + ".tmp";
    File.WriteAllText(tempPath, json);
    File.Move(tempPath, PortFilePath, overwrite: true);
}

static void DeletePortFile()
{
    try { File.Delete(PortFilePath); }
    catch (IOException) { /* best-effort cleanup */ }
}
```

### Port File Reader (TS Harness)

```typescript
import { Effect, Schema as S } from 'effect';
import { FileSystem } from '@effect/platform';

const PortFileSchema = S.Struct({
    port: S.Int,
    pid: S.Int,
    startedAt: S.String,
});

const readPortFile = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const portFilePath = `${process.env.HOME}/.kargadan/port`;
    const content = yield* fs.readFileString(portFilePath);
    return yield* S.decodeUnknown(S.parseJson(PortFileSchema))(content);
});
```

### Plugin Installation Path (macOS)

The macOS Rhino plugin installation directory is:
```
~/Library/Application Support/McNeel/Rhinoceros/MacPlugIns/
```
The `kargadan setup` command copies the plugin DLL to this directory. Rhino scans this folder on launch and loads any `.rhp` files found.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `HttpListener` for WebSocket servers | `TcpListener` + `WebSocket.CreateFromStream` or ASP.NET Core Kestrel | HttpListener deprecated (dotnet/platform-compat#88) | HttpListener will not receive updates; new code should use alternatives |
| Unsolicited PONG keep-alive only | PING/PONG keep-alive with `KeepAliveTimeout` | .NET 9 (November 2024) | Bidirectional keep-alive detects unresponsive endpoints; timeout-based abort |
| `WebSocket.CreateFromStream(stream, isServer, subProtocol, keepAlive)` | `WebSocket.CreateFromStream(stream, WebSocketCreationOptions)` | .NET 9 | New overload supports `KeepAliveTimeout` in options object; old 4-parameter overload still works but lacks timeout |
| Manual JSON polymorphism in System.Text.Json | `[JsonPolymorphic]` + `[JsonDerivedType]` attributes | .NET 7 | Automatic discriminator-based polymorphic serialization; no custom converters needed |
| `@effect/platform` Socket without reconnect | Compose `Socket` with `Effect.retry` + `Schedule` | Ongoing | No built-in reconnection in `@effect/platform` Socket; reconnection logic composed externally using Effect Schedule primitives |

**Deprecated/outdated:**
- `HttpListener`: Deprecated per dotnet/platform-compat#88. No macOS path forward. Use `TcpListener` or Kestrel.
- `WebSocket.CreateFromStream` 4-parameter overload: Still works but `WebSocketCreationOptions` overload is preferred for accessing .NET 9 `KeepAliveTimeout`.

## Existing Code Inventory

What exists today and its state relative to Phase 1 needs:

### C# Plugin -- Complete (no changes needed for Phase 1)

| File | Contents | Status |
|------|----------|--------|
| `contracts/ProtocolEnvelopes.cs` | `CommandEnvelope`, `CommandResultEnvelope` ([Union]), `HandshakeEnvelope` ([Union]), `HeartbeatEnvelope`, `EventEnvelope` | Complete |
| `contracts/ProtocolModels.cs` | `ProtocolVersion`, `TelemetryContext`, `ServerInfo`, `EnvelopeIdentity`, `CapabilitySet`, `AuthToken`, `FailureReason`, `SceneObjectRef`, `IdempotencyToken`, `ExecutionMetadata`, `DedupeMetadata` | Complete |
| `contracts/ProtocolValueObjects.cs` | 14 value objects: `AppId`, `RunId`, `SessionId`, `RequestId`, `EventId`, `ObjectId`, `TraceId`, `SpanId`, `OperationTag`, `VersionString`, `TokenValue`, `UndoScope`, `IdempotencyKey`, `PayloadHash` | Complete |
| `contracts/ProtocolEnums.cs` | 9 smart enums: `ErrorCode`, `FailureClass`, `HeartbeatMode`, `SessionLifecycleState`, `CommandOperation`, `SceneObjectType`, `DedupeDecision`, `CommandResultStatus`, `EventType` | Complete |
| `contracts/Require.cs` | Validation rules: `NonEmptyGuid`, `TrimmedNonEmpty`, `TrimmedMatching`, `NonNegative` with `CharSetPattern` | Complete |
| `contracts/DomainBridge.cs` | `ParseValueObject<T,TKey>`, `ParseSmartEnum<T,TKey>` -- Fin-returning parse functions | Complete |
| `protocol/Router.cs` | `CommandRouter.Decode` -- JSON -> `CommandEnvelope` via Fin combinators | Complete |
| `protocol/FailureMapping.cs` | `FromCode`, `FromException`, `ToError` -- error mapping layer | Complete |
| `transport/SessionHost.cs` | Session state machine: `Connected -> Active -> Terminal` with lock-gated transitions | Complete |
| `transport/Handshake.cs` | Pure handshake negotiation: token expiry, version compat, capability coverage | Complete |
| `boundary/EventPublisher.cs` | `Ref<Seq<PublishedEvent>>` queue with atomic `Drain()` | Complete |
| `boundary/KargadanPlugin.cs` | PlugIn entry point: `OnLoad`, `OnShutdown`, `HandleHandshake`, `HandleCommand`, `HandleHeartbeat` | Needs WebSocket lifecycle |

### C# Plugin -- New files needed

| File | Purpose |
|------|---------|
| `transport/WebSocketHost.cs` | TcpListener + HTTP upgrade + WebSocket accept loop + receive/send loop |
| `transport/PortFile.cs` | Atomic port file write/read/cleanup |
| `transport/ThreadMarshaler.cs` | `InvokeOnUiThread` wrapper with `TaskCompletionSource` |
| `contracts/ProtocolContracts.cs` | Wire-format message types with `[JsonPolymorphic]` (separate from internal `[Union]` types) |

### TS Harness -- Complete (no changes needed for Phase 1)

| File | Contents | Status |
|------|----------|--------|
| `protocol/supervisor.ts` | `SessionSupervisor` -- Ref-backed state machine: idle -> connected -> authenticated -> active -> terminal | Complete |
| `runtime/loop-stages.ts` | Pure functions: `planCommand`, `handleDecision`, `verifyResult`, `Verification` tagged enum | Complete |

### TS Harness -- Needs modification

| File | What Needs to Change |
|------|---------------------|
| `socket.ts` | Integrate with reconnection supervisor; surface `SocketCloseError` for disconnect detection |
| `config.ts` | Add port file path config; replace hardcoded host/port with port-file-derived values |
| `protocol/dispatch.ts` | Handle disconnection errors; fail in-flight commands on disconnect |
| `runtime/agent-loop.ts` | Integrate checkpoint restore on reconnect; verify scene state on reconnect |
| `runtime/persistence-trace.ts` | Replace in-memory storage with PostgreSQL-backed service (or keep as fallback) |
| `harness.ts` | Update layer composition with reconnect supervisor, checkpoint service, PgClient |

### TS Harness -- New files needed

| File | Purpose |
|------|---------|
| `transport/reconnect.ts` | Reconnection supervisor with exponential backoff schedule |
| `transport/port-discovery.ts` | Port file reader with PID validation |
| `persistence/checkpoint.ts` | PostgreSQL checkpoint service (save, load, verify) |
| `persistence/schema.ts` | Checkpoint table schema definition |

## Open Questions

1. **Wire-format serialization strategy for existing `[Union]` types**
   - What we know: The C# codebase uses LanguageExt `[Union]` for `HandshakeEnvelope`, `CommandResultEnvelope`, `SessionPhase`. The existing `CommandRouter.Decode` performs manual `JsonElement` field extraction. The user decision mandates `_tag` discriminator with `[JsonPolymorphic]`/`[JsonDerivedType]`.
   - What's unclear: Whether to add `[JsonPolymorphic]` attributes directly to the existing `[Union]` types (may conflict with LanguageExt's source generation) or create separate wire-format types with `[JsonPolymorphic]` and map between them at the boundary.
   - Recommendation: Create separate wire-format types in `ProtocolContracts.cs` with `[JsonPolymorphic]`. Map to/from internal `[Union]` types at the serialization boundary. This avoids attribute conflicts and keeps the wire format decoupled from internal domain types. The mapping is thin (field copy) and isolates the serialization concern.

2. **PostgreSQL availability during development**
   - What we know: User decided "PostgreSQL checkpoint storage from Phase 1." `@effect/sql-pg` 0.50.3 is in the workspace catalog. The monorepo already has `Npgsql` for C# and `@effect/sql-pg` for TypeScript.
   - What's unclear: Whether a PostgreSQL instance is available in the local dev environment or if Docker/Testcontainers should be used.
   - Recommendation: Use `Testcontainers.PostgreSql` (already at version 4.10.0 in workspace) for integration tests. For local development, provide a docker-compose snippet. The checkpoint table is a single-table schema with no foreign keys -- minimal setup.

3. **Exact Rhino 9 WIP build compatibility window**
   - What we know: RhinoCommon NuGet is versioned at `9.0.25350.305-wip`. The APIs needed for Phase 1 (`InvokeOnUiThread`, `PlugIn`, `PluginLoadTime`, `RhinoApp.Version`) are stable across WIP versions.
   - What's unclear: Whether newer Rhino 9 WIP builds introduce breaking changes to these specific APIs.
   - Recommendation: Pin to the workspace version for compilation. Test against the user's installed Rhino 9 WIP. The `kargadan setup` command should validate version compatibility by reading `RhinoApp.Version` at install time. Include `RhinoApp.Version` in the handshake `ServerInfo` so the harness can warn on version drift.

4. **Single-connection vs multi-connection architecture**
   - What we know: The user wants a single CLI harness connected to a single Rhino instance. Multi-document support is explicitly v2 (out of scope).
   - What's unclear: Whether the WebSocket server should reject additional connections or queue them.
   - Recommendation: Accept one connection at a time. If a new connection arrives while one is active, reject the new connection with an HTTP 503 response. This simplifies the state machine and prevents resource contention. If the existing connection is stale (no heartbeat for `KeepAliveTimeout` duration), the transport-level PING/PONG will have already aborted it, freeing the slot.

## Sources

### Primary (HIGH confidence)
- [Microsoft Learn - WebSocket.CreateFromStream](https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocket.createfromstream?view=net-9.0) -- Server-side WebSocket API, .NET 9 features, `WebSocketCreationOptions` overload
- [Microsoft Learn - WebSockets support in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/websockets) -- PING/PONG keep-alive strategy, `KeepAliveTimeout`, `ReceiveAsync` requirement for PONG processing
- [Microsoft Learn - WebSocketCreationOptions.KeepAliveTimeout](https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocketcreationoptions.keepalivetimeout?view=net-9.0) -- Timeout behavior: PONG must arrive within timeout or connection is aborted
- [Microsoft Learn - System.Text.Json Polymorphism](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) -- `[JsonPolymorphic]`, `[JsonDerivedType]`, discriminator configuration
- [RhinoCommon API - InvokeOnUiThread](https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_RhinoApp_InvokeOnUiThread.htm) -- Thread marshaling API; works in both sync and async contexts
- [Rhino Developer Guide - Asynchronous Execution](https://developer.rhino3d.com/guides/scripting/advanced-async/) -- `// async:true` directive for non-UI-thread script execution
- [Rhino Developer Guide - Plugin Installers Mac](https://developer.rhino3d.com/guides/rhinocommon/plugin-installers-mac/) -- macOS plugin path: `~/Library/Application Support/McNeel/Rhinoceros/MacPlugIns/`
- [@effect/platform Socket.ts](https://effect-ts.github.io/effect/platform/Socket.ts.html) -- `makeWebSocket(url, options)`, `Socket.run(handler)`, `Socket.writer`, `SocketCloseError`, `CloseEvent`
- [@effect/sql-pg PgClient.ts](https://effect-ts.github.io/effect/sql-pg/PgClient.ts.html) -- `PgClient.layer(config)`, `PgClient.layerConfig`, `PgClient.layerFromPool`; configuration: `url`, `host`, `port`, `database`, `maxConnections`, `idleTimeout`
- [Effect Schedule.ts](https://effect-ts.github.io/effect/effect/Schedule.ts.html) -- `Schedule.exponential(base, factor)`, `Schedule.jittered`, `Schedule.upTo(duration)`, `Schedule.intersect`

### Secondary (MEDIUM confidence)
- [McNeel Forum - Rhino 9 WIP .NET 9](https://discourse.mcneel.com/t/in-rhino9-wip-runtime-netcore-netcoreversion-v9-only-v9/200697) -- Confirmed .NET Core v9 runtime in Rhino 9 WIP
- [McNeel Forum - macOS thread crash](https://discourse.mcneel.com/t/changing-document-properties-in-async-thread-crashes-mac-but-not-windows/192198) -- NSInternalInconsistencyException from background thread RhinoDoc access; "99.999% works" on Windows, crashes on macOS
- [McNeel Forum - async best practices](https://discourse.mcneel.com/t/best-practices-for-rhino-plugin-development-wrt-async-operations/177773) -- RhinoCommon not thread-safe; InvokeOnUiThread required for all document mutations
- [RhinoMCP - GitHub](https://github.com/jingcheng-chen/rhinomcp) -- Reference implementation validating localhost TCP/WebSocket inside Rhino plugin on macOS; JSON command protocol; `mcpstart` command to initiate socket server
- [dotnet/platform-compat#88 - Deprecate HttpListener](https://github.com/dotnet/platform-compat/issues/88) -- HttpListener deprecation status; no macOS path forward

### Tertiary (LOW confidence)
- [MDN - Writing a WebSocket server in C#](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_server) -- Basic TcpListener WebSocket server example (older, but RFC 6455 protocol is stable)
- [WebSockets in .NET 9 Getting Started Guide](https://medium.com/@vosarat1995/websockets-in-net-9-a-getting-started-guide-3ea5982d3782) -- Practical .NET 9 WebSocket examples

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All libraries are built-in (.NET 9 SDK) or already in workspace catalog at pinned versions; APIs verified via official Microsoft docs and Effect framework docs
- Architecture: HIGH -- Patterns derived from existing monorepo code (`KargadanSocketClient`, `Resilience` module, `PgClient.layer`, repo factory); RhinoMCP validates the localhost WebSocket-inside-Rhino pattern on macOS
- Pitfalls: HIGH -- macOS threading crash confirmed by multiple McNeel forum reports with exact exception names; .NET 9 keep-alive behavior documented by Microsoft with implementation details; port file pattern is straightforward OS-level file I/O
- Code inventory: HIGH -- All existing files read and analyzed; exact gap between current state and Phase 1 requirements enumerated
- Open questions: MEDIUM -- Wire-format serialization strategy has two viable options (both documented); PostgreSQL dev setup is straightforward; Rhino WIP version compat is inherently uncertain but mitigated by using stable APIs

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable domain; .NET 9 and Rhino 9 WIP APIs unlikely to change within 30 days)
