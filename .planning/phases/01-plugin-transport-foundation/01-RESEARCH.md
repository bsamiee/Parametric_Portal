# Phase 1: Plugin Transport Foundation - Research

**Researched:** 2026-02-22
**Domain:** WebSocket bridge (C#/.NET 9 plugin in Rhino 9 WIP <-> TypeScript/Effect CLI harness) on localhost
**Confidence:** HIGH

## Summary

Phase 1 establishes a reliable WebSocket transport layer between a Rhino 9 WIP plugin (C#, net9.0) and the CLI harness (TypeScript, Effect). The codebase already contains substantial protocol infrastructure: the C# plugin has typed envelopes, handshake negotiation, session state machine, command routing, and event publishing. The TS harness has WebSocket client wiring, dispatch, session supervisor, agent loop, and persistence trace. Both sides share a common schema definition in `packages/types/src/kargadan/kargadan-schemas.ts`.

**What is missing** to satisfy Phase 1 requirements: (1) the C# plugin has no WebSocket server -- it has protocol logic but no actual listener accepting connections; (2) the harness has no reconnection logic -- it connects once and dies on disconnect; (3) no port file discovery mechanism exists; (4) no `RhinoApp.InvokeOnUiThread` marshaling is implemented; (5) no PostgreSQL checkpoint storage exists (currently in-memory `PersistenceTrace`); (6) the csproj targets `net10.0` (inheriting from Directory.Build.props) but Rhino 9 WIP runs .NET 9 -- needs a local override to `net9.0`; (7) no CLI setup command (`kargadan setup`) for plugin installation.

**Primary recommendation:** Build the WebSocket server in the C# plugin using `TcpListener` + `WebSocket.CreateFromStream` (no ASP.NET/Kestrel dependency, keeps the plugin lightweight). Implement reconnection in the harness using Effect `Schedule.exponential` with jitter and cap. Add `RhinoApp.InvokeOnUiThread` wrapper for all inbound command dispatch. Write port file on listener start, read on harness connect. Replace in-memory `PersistenceTrace` with `@effect/sql-pg` backed checkpoint storage.

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
| TRAN-01 | Plugin opens WebSocket listener on localhost, accepting connections from CLI harness | WebSocket server via `TcpListener` + `WebSocket.CreateFromStream` in .NET 9; port file discovery; `PluginLoadTime.AtStartup` for auto-start |
| TRAN-02 | Plugin targets net9.0 for Rhino 9 WIP (user overrode multi-target to Rhino 9 only) | Rhino 9 WIP runs .NET Core v9; csproj needs local `<TargetFramework>net9.0</TargetFramework>` override of Directory.Build.props `net10.0` |
| TRAN-03 | All incoming WebSocket commands marshaled to UI thread via `RhinoApp.InvokeOnUiThread` | macOS AppKit enforces main-thread-only access to RhinoDoc; `InvokeOnUiThread` delegates to main thread; pattern documented by McNeel |
| TRAN-04 | Harness detects plugin disconnection and reconnects automatically | Effect `Schedule.exponential` with jitter for reconnect; `SocketCloseError` detection via `@effect/platform` Socket; port file re-read on reconnect |
| TRAN-05 | Session state survives plugin disconnection -- harness restores from PostgreSQL checkpoint | `@effect/sql-pg` for PostgreSQL; checkpoint schema with conversation history + loop state; replay from last snapshot on reconnect |
| TRAN-06 | Heartbeat keepalive detects stale connections within configurable timeout | .NET 9 native PING/PONG via `WebSocketCreationOptions.KeepAliveInterval` + `KeepAliveTimeout`; application-level heartbeat already implemented in harness |
</phase_requirements>

## Standard Stack

### Core

| Library / API | Version | Purpose | Why Standard |
|---------------|---------|---------|--------------|
| `System.Net.WebSockets` (.NET 9) | Built-in | WebSocket server inside Rhino plugin | No ASP.NET dependency; `WebSocket.CreateFromStream` creates server-side WebSocket from any `Stream`; .NET 9 adds native PING/PONG keep-alive |
| `System.Net.Sockets.TcpListener` (.NET 9) | Built-in | TCP listener for accepting WebSocket upgrade | Lightweight; no HTTP server overhead; cross-platform (macOS + Windows) |
| `System.Text.Json` (.NET 9) | Built-in | JSON serialization with `[JsonPolymorphic]`/`[JsonDerivedType]` | Tagged union discriminator support via `_tag` property; aligns with Effect Schema `_tag` pattern |
| `@effect/platform` Socket | 0.94.5 | WebSocket client in harness | Effect-native Socket abstraction; `makeWebSocket`, `run`, `writer`; typed error handling via `SocketCloseError` |
| `@effect/sql-pg` | 0.50.3 | PostgreSQL checkpoint storage | Effect-native SQL client; already in workspace catalog; `PgClient.layer` for connection pool |
| `effect` Schedule | 3.19.18 | Exponential backoff reconnection | `Schedule.exponential` with `Schedule.jittered` and `Schedule.upTo` for cap; matches existing `Resilience` patterns in monorepo |
| `RhinoCommon` | 9.0.25350.305-wip | Rhino 9 WIP plugin SDK | `RhinoApp.InvokeOnUiThread` for thread marshaling; `PlugIn` base class; `PluginLoadTime.AtStartup` |
| `LanguageExt.Core` | 5.0.0-beta-77 | Functional C# primitives | `Fin<T>`, `Option<T>`, `Atom<T>`, `Ref<T>` already used throughout plugin; workspace-pinned version |

### Supporting

| Library / API | Version | Purpose | When to Use |
|---------------|---------|---------|-------------|
| `NodaTime` | 3.3.0 | Time handling in C# plugin | `Instant` for timestamps in session lifecycle; already used in SessionHost/Handshake |
| `Thinktecture.Runtime.Extensions` | 10.0.0 | Value objects and smart enums | `[ValueObject<T>]`, `[SmartEnum<string>]` for typed protocol primitives; already used throughout contracts |
| `Polly.Core` | 8.6.5 | Resilience in C# (optional) | Circuit breaker / retry on C# side if WebSocket accept loop needs resilience; already in workspace |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `TcpListener` + `WebSocket.CreateFromStream` | ASP.NET Core Kestrel minimal API | Kestrel adds 15+ MB of ASP.NET dependencies to the Rhino plugin; TcpListener is zero-dependency and lighter |
| `TcpListener` + `WebSocket.CreateFromStream` | `HttpListener` | `HttpListener` is deprecated (.NET platform-compat issue #88); no new improvements planned; Kestrel or raw TCP recommended |
| `TcpListener` + `WebSocket.CreateFromStream` | Third-party (Fleck, WebSocketSharp) | External dependency adds version/compat risk inside Rhino; `System.Net.WebSockets` is built-in and maintained |
| Application-level heartbeat | .NET 9 native WebSocket PING/PONG only | Native PING/PONG detects transport-level stale connections but does not confirm application liveness; both layers needed |

### Installation

C# side: no new NuGet packages -- all APIs are built into .NET 9 SDK. The csproj needs `<TargetFramework>net9.0</TargetFramework>` override and removal of `Rhino.Inside` package reference (not needed for this architecture; plugin runs inside Rhino natively).

TS side: `@effect/sql-pg` is already in the workspace catalog. Add to harness `package.json`:
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
        KargadanPlugin.cs                   # PlugIn entry point (exists)
        EventPublisher.cs                   # Event queue (exists)
      contracts/
        ProtocolEnvelopes.cs                # Typed envelopes (exists)
        ProtocolModels.cs                   # Domain models (exists)
        ProtocolEnums.cs                    # Smart enums (exists)
        ProtocolValueObjects.cs             # Value objects (exists)
        Require.cs                          # Validation (exists)
        DomainBridge.cs                     # Parsing bridge (exists)
      protocol/
        Router.cs                           # Command routing (exists)
        FailureMapping.cs                   # Error mapping (exists)
      transport/
        SessionHost.cs                      # Session state machine (exists)
        Handshake.cs                        # Handshake negotiation (exists)
        WebSocketHost.cs                    # [NEW] TcpListener + WebSocket server
        PortFile.cs                         # [NEW] Port file write/read
        ThreadMarshaler.cs                  # [NEW] InvokeOnUiThread wrapper
  harness/                                  # TypeScript CLI harness
    src/
      config.ts                             # Config resolution (exists)
      socket.ts                             # WebSocket client (exists, needs reconnect)
      harness.ts                            # Entry point (exists)
      protocol/
        dispatch.ts                         # Command dispatch (exists)
        supervisor.ts                       # Session state machine (exists)
      runtime/
        agent-loop.ts                       # Agent loop (exists)
        loop-stages.ts                      # Pure stage functions (exists)
        persistence-trace.ts                # In-memory trace (exists, replace with PG)
      transport/
        reconnect.ts                        # [NEW] Reconnection supervisor with backoff
        port-discovery.ts                   # [NEW] Port file reader + file watcher
      persistence/
        checkpoint.ts                       # [NEW] PostgreSQL checkpoint service
        schema.ts                           # [NEW] Checkpoint table schemas
```

### Pattern 1: WebSocket Server via TcpListener (C# Plugin)

**What:** Standalone WebSocket server inside Rhino plugin without ASP.NET. Uses `TcpListener` to accept TCP connections, performs the HTTP upgrade handshake manually, then wraps the stream with `WebSocket.CreateFromStream`.
**When to use:** When hosting a WebSocket server inside a process that cannot use ASP.NET Core (like a Rhino plugin).

```csharp
// Source: https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocket.createfromstream
// Pattern: TcpListener accepts connection, HTTP upgrade handshake, then WebSocket.CreateFromStream

TcpListener listener = new(IPAddress.Loopback, port: 0); // OS picks available port
listener.Start();
int assignedPort = ((IPEndPoint)listener.LocalEndpoint).Port;
// Write assignedPort to port file

TcpClient client = await listener.AcceptTcpClientAsync(cancellationToken);
NetworkStream stream = client.GetStream();
// Perform HTTP WebSocket upgrade handshake (read HTTP request, send 101 response)
WebSocket webSocket = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions
{
    IsServer = true,
    KeepAliveInterval = TimeSpan.FromSeconds(5),
    KeepAliveTimeout = TimeSpan.FromSeconds(15),
});
```

### Pattern 2: UI Thread Marshaling (C# Plugin)

**What:** All RhinoDoc operations must execute on Rhino's UI thread on macOS. WebSocket messages arrive on background threads. `RhinoApp.InvokeOnUiThread` queues the delegate for main-thread execution.
**When to use:** Every inbound command that touches `RhinoDoc`, layers, objects, or viewport.

```csharp
// Source: https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_RhinoApp_InvokeOnUiThread.htm
// Source: https://discourse.mcneel.com/t/changing-document-properties-in-async-thread-crashes-mac-but-not-windows/192198

// Background WebSocket receive thread
async Task HandleMessage(WebSocket ws, CancellationToken ct)
{
    // Decode JSON message on background thread (pure, no RhinoDoc access)
    CommandEnvelope command = Decode(buffer);

    // Marshal to UI thread for RhinoDoc operations
    TaskCompletionSource<CommandResultEnvelope> tcs = new();
    RhinoApp.InvokeOnUiThread(new Action(() =>
    {
        // SAFE: now on UI thread
        Fin<CommandResultEnvelope> result = ProcessCommand(command);
        result.Match(
            Succ: r => tcs.SetResult(r),
            Fail: e => tcs.SetException(new InvalidOperationException(e.Message)));
    }));

    CommandResultEnvelope response = await tcs.Task;
    // Send response back on WebSocket (can be any thread)
}
```

### Pattern 3: Reconnection with Exponential Backoff (TS Harness)

**What:** Harness wraps the WebSocket connection in a reconnection supervisor. On disconnect, it re-reads the port file (plugin may have restarted on a different port), applies exponential backoff, and re-establishes the connection with a fresh handshake.
**When to use:** Every connection lifecycle in the harness.

```typescript
// Pattern: Effect Schedule.exponential with jitter and cap
import { Duration, Effect, Schedule } from 'effect';

const reconnectSchedule = Schedule.exponential(Duration.millis(500), 2).pipe(
    Schedule.jittered,
    Schedule.upTo(Duration.seconds(30)),
);

// Reconnect loop: re-read port file, attempt connection, restore from checkpoint
const reconnectLoop = Effect.retry(
    connectAndHandshake,
    { schedule: reconnectSchedule },
);
```

### Pattern 4: Port File Discovery

**What:** Plugin writes its dynamically assigned port to a known file path. Harness reads this file to discover the connection endpoint. File is deleted on plugin shutdown.
**When to use:** Every connection initiation.

Recommended location: `~/.kargadan/port` (simple text file containing the port number).

Format:
```json
{"port": 9181, "pid": 12345, "startedAt": "2026-02-22T10:00:00Z"}
```

JSON format allows future extension (pid for process validation, timestamp for staleness detection) while remaining trivially parseable.

### Pattern 5: PostgreSQL Checkpoint Storage

**What:** Replace in-memory `PersistenceTrace` with `@effect/sql-pg` backed storage. Checkpoint includes conversation history, loop state (current stage, attempt count, operations remaining), and a SHA-256 state hash for verification.
**When to use:** Every state transition in the agent loop persists to PostgreSQL.

```typescript
// Pattern: @effect/sql for checkpoint CRUD
import { PgClient } from '@effect/sql-pg';
import { SqlClient } from '@effect/sql';

// Checkpoint table: session_id, sequence, state_json, state_hash, created_at
const saveCheckpoint = Effect.fn('checkpoint.save')((checkpoint: Checkpoint) =>
    SqlClient.SqlClient.pipe(
        Effect.flatMap((sql) =>
            sql`INSERT INTO kargadan_checkpoints ${sql.insert(checkpoint)}
                ON CONFLICT (session_id) DO UPDATE SET ${sql.update(checkpoint)}`
        ),
    ),
);
```

### Anti-Patterns to Avoid

- **ASP.NET Core in a Rhino plugin:** Adds massive dependency footprint; Kestrel's DI container conflicts with Rhino's plugin lifecycle. Use raw `TcpListener` instead.
- **HttpListener for WebSocket hosting:** Deprecated in .NET; no macOS support path. Use `TcpListener` + `WebSocket.CreateFromStream`.
- **Accessing RhinoDoc from WebSocket receive thread:** Causes `NSInternalInconsistencyException` on macOS. Always marshal via `InvokeOnUiThread`.
- **Auto-retrying in-flight commands on disconnect:** A command may have partially executed in Rhino (geometry created, layer modified). Auto-retry would double-apply. Fail immediately, let the DECIDE stage handle it after reconnect.
- **Hardcoded port:** Plugin may conflict with other processes. Always bind to port 0 and discover via port file.
- **In-memory-only session state:** Harness process crash loses all history. PostgreSQL checkpoint from Phase 1 per user decision.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket protocol (framing, masking, opcodes) | Custom TCP frame parser | `WebSocket.CreateFromStream` | RFC 6455 compliance is non-trivial; .NET built-in handles fragmentation, masking, control frames, close handshake |
| Exponential backoff with jitter | Manual timer + counter | `Schedule.exponential` + `Schedule.jittered` + `Schedule.upTo` | Effect Schedule composes with retry, handles fiber interruption, tested extensively in monorepo `Resilience` module |
| JSON tagged union discriminator | Custom `_tag` dispatch logic on C# | `[JsonPolymorphic(TypeDiscriminatorPropertyName = "_tag")]` + `[JsonDerivedType]` | System.Text.Json handles serialization/deserialization, round-trip fidelity, and error reporting |
| WebSocket keep-alive detection | Application-only ping/pong timer | .NET 9 `KeepAliveInterval` + `KeepAliveTimeout` + application heartbeat | Transport-level PING/PONG is protocol-standard; application heartbeat adds liveness confirmation. Both needed, neither alone sufficient |
| HTTP WebSocket upgrade handshake | Manual HTTP header parsing | `WebSocket.CreateFromStream` accepts the stream after manual upgrade response | The upgrade response is simple (fixed headers), but the `WebSocket` instance handles everything after that |
| PostgreSQL connection pooling | Custom pool manager | `@effect/sql-pg` PgClient.layer | Built-in connection pooling via postgres.js; already used in monorepo infrastructure |

**Key insight:** The WebSocket protocol, keep-alive detection, and connection pooling are all areas where the standard library implementations have years of edge-case fixes that hand-rolled solutions will miss (e.g., fragmented messages, partial reads, connection state races).

## Common Pitfalls

### Pitfall 1: NSInternalInconsistencyException on macOS

**What goes wrong:** Plugin receives a WebSocket message on a background thread and directly accesses `RhinoDoc` (creates geometry, modifies layers, queries objects). On macOS, AppKit's layout engine throws `NSInternalInconsistencyException` because it enforces strict main-thread-only access.
**Why it happens:** Rhino on macOS uses Cocoa/AppKit which has stricter threading rules than Windows WPF/WinForms. Windows may appear to "work" but is also unsafe.
**How to avoid:** Every inbound command that touches RhinoDoc must be wrapped in `RhinoApp.InvokeOnUiThread(new Action(() => { ... }))`. Decode JSON on the background thread (pure, safe), marshal only the RhinoDoc operation.
**Warning signs:** Crashes on macOS that don't reproduce on Windows; `NSInternalInconsistencyException` in crash logs; "Modifications to the layout engine must not be performed from a background thread."
**Source:** [McNeel Forum](https://discourse.mcneel.com/t/changing-document-properties-in-async-thread-crashes-mac-but-not-windows/192198)

### Pitfall 2: Plugin csproj Inheriting net10.0 from Directory.Build.props

**What goes wrong:** `Directory.Build.props` sets `<TargetFramework>net10.0</TargetFramework>` globally. The Kargadan plugin inherits this, but Rhino 9 WIP runs .NET Core v9. Loading a net10.0 assembly in Rhino 9 causes `TypeLoadException` or assembly binding failures.
**Why it happens:** The monorepo targets .NET 10 for its own server infrastructure, but Rhino 9 WIP ships with .NET 9 runtime.
**How to avoid:** Override `<TargetFramework>net9.0</TargetFramework>` in the plugin's own csproj, overriding the global default. This is a standard MSBuild pattern -- local PropertyGroup wins.
**Warning signs:** `TypeLoadException` on plugin load; "Could not load file or assembly" errors; Rhino log showing framework version mismatch.
**Source:** [McNeel Forum](https://discourse.mcneel.com/t/in-rhino9-wip-runtime-netcore-netcoreversion-v9-only-v9/200697)

### Pitfall 3: Port Collision and Stale Port Files

**What goes wrong:** Plugin writes port file, then crashes without cleanup. Next launch reads stale port file pointing to a port now used by another process, or the harness connects to the wrong process.
**Why it happens:** `OnShutdown` may not run if Rhino force-quits or crashes. Port file persists.
**How to avoid:** (1) Include PID in port file; harness validates PID is alive before connecting. (2) Plugin overwrites port file on every start (atomic write: write to temp, rename). (3) Harness treats connection failure after port file read as "port stale, retry" rather than fatal error.
**Warning signs:** Harness connects but handshake fails with unexpected response; harness connects to wrong process.

### Pitfall 4: WebSocket Server Requires Pending ReceiveAsync for PONG Processing

**What goes wrong:** .NET 9's PING/PONG keep-alive only processes incoming PONG frames while there is an outstanding `ReceiveAsync` call. If the server is busy processing a command and not reading, PONG frames pile up, `KeepAliveTimeout` fires, and the connection is aborted even though the client is alive.
**Why it happens:** `WebSocket` internal state machine processes frames only during active `ReceiveAsync`. This is by design but counter-intuitive.
**How to avoid:** Maintain a continuously running receive loop (`while` receiving in background). Process messages asynchronously. Never block the receive loop with long-running operations (those go to `InvokeOnUiThread` with `TaskCompletionSource`).
**Warning signs:** Connections dropping after exactly `KeepAliveTimeout` seconds; false-positive aborts; "The WebSocket didn't receive a Pong frame" errors.
**Source:** [Microsoft Learn - WebSockets in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/websockets)

### Pitfall 5: Reconnect Without State Verification

**What goes wrong:** Harness reconnects after a disconnection and resumes the agent loop without checking whether the Rhino document changed during the gap. Agent operates on stale assumptions (e.g., object it was modifying was deleted by user).
**Why it happens:** Natural to assume document is unchanged after reconnect, but user can interact with Rhino while harness is disconnected.
**How to avoid:** On reconnect, harness queries a scene summary from the plugin and compares against the checkpoint's state hash. If diverged, flag to the agent loop so DECIDE stage can re-plan rather than blindly continue.
**Warning signs:** Agent tries to modify objects that no longer exist; geometry operations fail with "object not found"; undo stack is inconsistent.

### Pitfall 6: RhinoCommon Version Mismatch

**What goes wrong:** Plugin references `RhinoCommon 9.0.25350.305-wip` which may not match the exact Rhino 9 WIP build the user has installed. API changes between WIP builds can cause `MissingMethodException` or `TypeLoadException`.
**Why it happens:** Rhino WIP is not stable -- APIs can change between builds. The NuGet reference is a specific point-in-time snapshot.
**How to avoid:** (1) Document the minimum Rhino 9 WIP build version. (2) Use only well-established APIs (`InvokeOnUiThread`, `RunScript`, `PlugIn` base class) that are unlikely to change. (3) The setup command should check Rhino version compatibility.
**Warning signs:** `MissingMethodException` on plugin load; methods exist in NuGet reference but not in installed Rhino.

## Code Examples

### HTTP WebSocket Upgrade Handshake (C# Server)

The `WebSocket.CreateFromStream` API assumes the HTTP upgrade has already been performed. For a `TcpListener` approach, the upgrade handshake must be done manually:

```csharp
// Source: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_server
// Source: https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocket.createfromstream

private static async Task<WebSocket?> AcceptWebSocketAsync(
    NetworkStream stream,
    CancellationToken ct)
{
    byte[] buffer = new byte[4096];
    int bytesRead = await stream.ReadAsync(buffer, ct);
    string request = Encoding.UTF8.GetString(buffer, 0, bytesRead);

    // Validate it's a WebSocket upgrade request
    if (!request.Contains("Upgrade: websocket", StringComparison.OrdinalIgnoreCase))
        return null;

    // Extract Sec-WebSocket-Key
    string key = Regex.Match(request, @"Sec-WebSocket-Key:\s*(.+?)\r\n")
        .Groups[1].Value.Trim();

    // Compute accept hash per RFC 6455
    string acceptHash = Convert.ToBase64String(
        SHA1.HashData(
            Encoding.UTF8.GetBytes(
                key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));

    // Send upgrade response
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

### Effect Reconnection Supervisor (TS Harness)

```typescript
// Pattern: Reconnection supervisor wrapping socket lifecycle
import { Duration, Effect, Fiber, Ref, Schedule } from 'effect';

const _reconnectSchedule = Schedule.exponential(Duration.millis(500), 2).pipe(
    Schedule.jittered,
    Schedule.intersect(Schedule.recurs(50)),
    Schedule.upTo(Duration.seconds(30)),
);

// Supervisor maintains connection state and restarts on disconnect
const supervise = Effect.gen(function* () {
    const connectionState = yield* Ref.make<'disconnected' | 'connected' | 'reconnecting'>('disconnected');

    const connectOnce = Effect.gen(function* () {
        const port = yield* readPortFile;
        const socket = yield* makeWebSocketConnection(port);
        yield* Ref.set(connectionState, 'connected');
        yield* runProtocolLoop(socket); // blocks until disconnect
    });

    // On disconnect, restore checkpoint and reconnect
    const withReconnect = connectOnce.pipe(
        Effect.tapError(() => Ref.set(connectionState, 'reconnecting')),
        Effect.retry({ schedule: _reconnectSchedule }),
    );

    return yield* withReconnect;
});
```

### Port File Operations (C# Plugin)

```csharp
// Pattern: Atomic port file write with PID validation
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

### JsonPolymorphic Tagged Union (C# Serialization)

```csharp
// Source: https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism
// Pattern: _tag discriminator aligning with Effect Schema tagged unions

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

Note: The existing C# codebase uses LanguageExt `[Union]` for internal discriminated unions (e.g., `HandshakeEnvelope`, `CommandResultEnvelope`) and manual JSON parsing in `CommandRouter.Decode`. The `[JsonPolymorphic]` pattern would be used for the WebSocket wire format where `System.Text.Json` handles serialization/deserialization directly. These two patterns can coexist: `[JsonPolymorphic]` for the wire boundary, `[Union]` for internal domain logic.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `HttpListener` for WebSocket servers | `TcpListener` + `WebSocket.CreateFromStream` or ASP.NET Core Kestrel | HttpListener deprecated (dotnet/platform-compat#88) | HttpListener will not receive updates; new code should use alternatives |
| Unsolicited PONG keep-alive only | PING/PONG keep-alive with `KeepAliveTimeout` | .NET 9 (November 2024) | Bidirectional keep-alive detects unresponsive endpoints; timeout-based abort |
| `WebSocket.CreateFromStream(stream, isServer, subProtocol, keepAlive)` | `WebSocket.CreateFromStream(stream, WebSocketCreationOptions)` | .NET 9 | New overload supports `KeepAliveTimeout` and `IsServer` in options object |
| Manual JSON polymorphism in System.Text.Json | `[JsonPolymorphic]` + `[JsonDerivedType]` attributes | .NET 7 | Automatic discriminator-based polymorphic serialization; no custom converters needed |

**Deprecated/outdated:**
- `HttpListener`: Deprecated per dotnet/platform-compat#88. No macOS path forward. Use `TcpListener` or Kestrel.
- `WebSocket.CreateFromStream` 4-parameter overload: Still works but `WebSocketCreationOptions` overload is preferred for accessing .NET 9 features.

## Open Questions

1. **HTTP WebSocket upgrade handshake complexity**
   - What we know: `WebSocket.CreateFromStream` requires the HTTP upgrade to be completed before creating the WebSocket instance. For a `TcpListener` approach, this means manually parsing the HTTP GET request and sending the 101 Switching Protocols response with the `Sec-WebSocket-Accept` hash.
   - What's unclear: Whether there is a lighter-weight built-in API in .NET 9 that handles the upgrade automatically without pulling in ASP.NET Core. The MDN and Microsoft docs suggest manual handling is the standard approach for raw TCP.
   - Recommendation: The upgrade handshake is approximately 30 lines of well-understood code (RFC 6455 section 4.2.2). Implement it directly; it's stable and unlikely to change. The code example above covers it.

2. **Rhino.Inside package reference in existing csproj**
   - What we know: The existing `ParametricPortal.Kargadan.Plugin.csproj` references `Rhino.Inside`. REQUIREMENTS.md explicitly excludes Rhino.Inside ("Windows-only, confirmed unavailable on macOS").
   - What's unclear: Whether this reference was intentional for future use or is a leftover.
   - Recommendation: Remove the `Rhino.Inside` reference. The plugin runs inside Rhino natively via `PlugIn` base class; `Rhino.Inside` is for embedding Rhino in external processes, which is out of scope.

3. **Exact Rhino 9 WIP build compatibility window**
   - What we know: RhinoCommon NuGet is versioned at `9.0.25350.305-wip`. Rhino WIP builds change frequently. API surface for `InvokeOnUiThread`, `RunScript`, `PlugIn` base class is stable across versions.
   - What's unclear: Whether the specific NuGet version constraint will cause issues with newer Rhino 9 WIP builds.
   - Recommendation: Use the pinned version for compilation. Test against the user's installed Rhino 9 WIP. The setup command should validate version compatibility.

4. **PostgreSQL availability during development**
   - What we know: User decided "PostgreSQL checkpoint storage from Phase 1". `@effect/sql-pg` is in the catalog. The monorepo already has Npgsql for C# and `@effect/sql-pg` for TypeScript.
   - What's unclear: Whether a PostgreSQL instance is available in the local dev environment or if Docker/Testcontainers should be used for development.
   - Recommendation: Use `Testcontainers.PostgreSql` (already in workspace at version 4.10.0) for integration tests. For local development, document that a PostgreSQL instance is required and provide a docker-compose snippet.

## Sources

### Primary (HIGH confidence)
- [Microsoft Learn - WebSocket.CreateFromStream](https://learn.microsoft.com/en-us/dotnet/api/system.net.websockets.websocket.createfromstream?view=net-9.0) - Server-side WebSocket API, .NET 9 features
- [Microsoft Learn - WebSockets support in .NET](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/websockets) - PING/PONG keep-alive strategy, KeepAliveTimeout, code examples
- [Microsoft Learn - System.Text.Json Polymorphism](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/polymorphism) - JsonPolymorphic, JsonDerivedType, discriminator configuration
- [RhinoCommon API - InvokeOnUiThread](https://developer.rhino3d.com/api/RhinoCommon/html/M_Rhino_RhinoApp_InvokeOnUiThread.htm) - Thread marshaling API
- [RhinoCommon API - PlugIn.LoadTime](https://mcneel.github.io/rhinocommon-api-docs/api/RhinoCommon/html/P_Rhino_PlugIns_PlugIn_LoadTime.htm) - AtStartup loading
- [@effect/platform Socket.ts](https://effect-ts.github.io/effect/platform/Socket.ts.html) - WebSocket client API, SocketCloseError, makeWebSocket
- [@effect/sql-pg PgClient.ts](https://effect-ts.github.io/effect/sql-pg/PgClient.ts.html) - PostgreSQL client Layer, configuration

### Secondary (MEDIUM confidence)
- [McNeel Forum - Rhino 9 WIP .NET 9](https://discourse.mcneel.com/t/in-rhino9-wip-runtime-netcore-netcoreversion-v9-only-v9/200697) - Confirmed .NET Core v9 runtime in Rhino 9 WIP
- [McNeel Forum - macOS thread crash](https://discourse.mcneel.com/t/changing-document-properties-in-async-thread-crashes-mac-but-not-windows/192198) - NSInternalInconsistencyException from background thread RhinoDoc access
- [McNeel Forum - async best practices](https://discourse.mcneel.com/t/best-practices-for-rhino-plugin-development-wrt-async-operations/177773) - RhinoCommon not thread-safe; InvokeOnUiThread required
- [Rhino Developer Guide - Plugin Installers Mac](https://developer.rhino3d.com/guides/rhinocommon/plugin-installers-mac/) - macOS plugin path: ~/Library/Application Support/McNeel/Rhinoceros/MacPlugIns/
- [dotnet/platform-compat#88 - Deprecate HttpListener](https://github.com/dotnet/platform-compat/issues/88) - HttpListener deprecation status

### Tertiary (LOW confidence)
- [MDN - Writing a WebSocket server in C#](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_server) - Basic TcpListener WebSocket server example (older, but protocol is stable)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All libraries are built-in (.NET 9) or already in workspace catalog; APIs verified via official Microsoft docs
- Architecture: HIGH - Patterns derived from existing monorepo code (WebSocketService, Resilience module) and official RhinoCommon documentation
- Pitfalls: HIGH - macOS threading crash confirmed by multiple McNeel forum reports; .NET 9 keep-alive behavior documented by Microsoft; port file pattern is straightforward
- Open questions: MEDIUM - HTTP upgrade handshake is well-documented but implementation needs validation; Rhino version compat window is inherently uncertain with WIP builds

**Research date:** 2026-02-22
**Valid until:** 2026-03-22 (stable domain; .NET 9 and Rhino 9 WIP APIs unlikely to change within 30 days)
