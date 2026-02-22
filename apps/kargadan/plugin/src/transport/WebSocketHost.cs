// TcpListener-based WebSocket server with accept loop, RFC 6455 HTTP upgrade handshake, and continuous receive loop.
// Binds exclusively to IPAddress.Loopback — never 0.0.0.0 — to ensure only local processes (CLI harness) can connect.
// Single-connection architecture: rejects additional connections with HTTP 503 while one is active.
using System;
using System.Diagnostics.CodeAnalysis;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using LanguageExt;
using LanguageExt.Common;
using Rhino;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [TYPES] -----------------------------------------------------------------

internal delegate Task<Fin<JsonElement>> MessageDispatcher(
    string tag,
    JsonElement message,
    CancellationToken cancellationToken);

// --- [ADAPTER] ---------------------------------------------------------------

[SuppressMessage("Microsoft.Design", "CA1812:AvoidUninstantiatedInternalClasses",
    Justification = "Instantiated by KargadanPlugin.OnLoad in Task 2")]
internal sealed partial class WebSocketHost : IDisposable {
    // --- [CONSTANTS] ---------------------------------------------------------
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan KeepAliveTimeout = TimeSpan.FromSeconds(15);
    private const string WebSocketMagicGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static readonly byte[] Http503Response = Encoding.UTF8.GetBytes(
        string.Join("\r\n", "HTTP/1.1 503 Service Unavailable", "Connection: close", "", ""));
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
    // --- [STATE] -------------------------------------------------------------
    private readonly MessageDispatcher _dispatcher;
    private readonly CancellationTokenSource _cts = new();
    private TcpListener? _listener;
    private WebSocket? _activeWebSocket;
    private int _activeConnectionCount;
    private bool _disposed;
    // --- [REGEX] -------------------------------------------------------------
    [GeneratedRegex(@"Sec-WebSocket-Key:\s*(?<key>.+?)\r\n", RegexOptions.ExplicitCapture, matchTimeoutMilliseconds: 1000)]
    private static partial Regex WebSocketKeyPattern();
    // --- [LIFECYCLE] ---------------------------------------------------------
    internal WebSocketHost(MessageDispatcher dispatcher) =>
        _dispatcher = dispatcher;
    internal int Port { get; private set; }
    internal void Start() {
        _listener = new TcpListener(localaddr: IPAddress.Loopback, port: 0);
        _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        PortFile.WritePortFile(port: Port);
        RhinoApp.WriteLine($"[Kargadan] WebSocket server listening on 127.0.0.1:{Port}");
        _ = Task.Run(() => AcceptLoopAsync(cancellationToken: _cts.Token));
    }
    internal void Stop() {
        _cts.Cancel();
        PortFile.DeletePortFile();
        _activeWebSocket?.Dispose();
        _listener?.Stop();
        _listener?.Dispose();
        RhinoApp.WriteLine("[Kargadan] WebSocket server stopped.");
    }
    public void Dispose() {
        if (_disposed) {
            return;
        }
        _disposed = true;
        Stop();
        _cts.Dispose();
    }
    // --- [ACCEPT_LOOP] -------------------------------------------------------
    // [BOUNDARY ADAPTER -- async accept loop with cancellation guard and try/catch for socket lifecycle]
    private async Task AcceptLoopAsync(CancellationToken cancellationToken) {
        while (!cancellationToken.IsCancellationRequested) {
            try {
                TcpClient client = await _listener!.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
                if (Interlocked.CompareExchange(ref _activeConnectionCount, 1, 0) != 0) {
                    await RejectConnectionAsync(client: client, cancellationToken: cancellationToken).ConfigureAwait(false);
                    continue;
                }
                try {
                    await HandleConnectionAsync(client: client, cancellationToken: cancellationToken).ConfigureAwait(false);
                } finally {
                    _ = Interlocked.Exchange(ref _activeConnectionCount, 0);
                    _activeWebSocket = null;
                }
            } catch (OperationCanceledException) {
                break;
            } catch (SocketException) when (cancellationToken.IsCancellationRequested) {
                break;
            } catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested) {
                break;
            } catch (IOException exception) {
                RhinoApp.WriteLine($"[Kargadan] Accept loop I/O error: {exception.Message}");
            } catch (SocketException exception) {
                RhinoApp.WriteLine($"[Kargadan] Accept loop socket error: {exception.Message}");
            }
        }
    }
    // --- [HTTP_UPGRADE] ------------------------------------------------------
    // [BOUNDARY ADAPTER -- raw TCP stream I/O for RFC 6455 HTTP upgrade handshake]
#pragma warning disable CA5350 // SHA1 is mandated by RFC 6455 section 4.2.2 — not a security weakness
    private static async Task<WebSocket?> TryUpgradeToWebSocketAsync(
        NetworkStream stream,
        CancellationToken cancellationToken) {
        byte[] buffer = new byte[4096];
        int bytesRead = await stream.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
        string request = Encoding.UTF8.GetString(buffer, index: 0, count: bytesRead);
        if (!request.Contains("Upgrade: websocket", StringComparison.OrdinalIgnoreCase)) {
            return null;
        }
        Match keyMatch = WebSocketKeyPattern().Match(input: request);
        if (!keyMatch.Success) {
            return null;
        }
        string key = keyMatch.Groups["key"].Value.Trim();
        string acceptHash = Convert.ToBase64String(
            SHA1.HashData(Encoding.UTF8.GetBytes(key + WebSocketMagicGuid)));
        string response = string.Join("\r\n",
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            $"Sec-WebSocket-Accept: {acceptHash}",
            "", "");
        await stream.WriteAsync(Encoding.UTF8.GetBytes(response).AsMemory(), cancellationToken).ConfigureAwait(false);
        return WebSocket.CreateFromStream(stream, new WebSocketCreationOptions {
            IsServer = true,
            KeepAliveInterval = KeepAliveInterval,
            KeepAliveTimeout = KeepAliveTimeout,
        });
    }
#pragma warning restore CA5350
    // --- [CONNECTION_HANDLER] ------------------------------------------------
    // [BOUNDARY ADAPTER -- async WebSocket lifecycle with try/finally for resource cleanup]
    private async Task HandleConnectionAsync(TcpClient client, CancellationToken cancellationToken) {
        using TcpClient _ = client;
        NetworkStream stream = client.GetStream();
        WebSocket? webSocket = await TryUpgradeToWebSocketAsync(stream: stream, cancellationToken: cancellationToken).ConfigureAwait(false);
        if (webSocket is null) {
            return;
        }
        _activeWebSocket = webSocket;
        RhinoApp.WriteLine("[Kargadan] Client connected.");
        try {
            await ReceiveLoopAsync(webSocket: webSocket, cancellationToken: cancellationToken).ConfigureAwait(false);
        } finally {
            if (webSocket.State is WebSocketState.Open or WebSocketState.CloseReceived) {
                try {
                    await webSocket.CloseAsync(
                        closeStatus: WebSocketCloseStatus.NormalClosure,
                        statusDescription: "shutdown",
                        cancellationToken: CancellationToken.None).ConfigureAwait(false);
                } catch (WebSocketException) {
                    // connection may already be broken
                }
            }
            webSocket.Dispose();
            RhinoApp.WriteLine("[Kargadan] Client disconnected.");
        }
    }
    // --- [RECEIVE_LOOP] ------------------------------------------------------
    // [BOUNDARY ADAPTER -- continuous receive loop; must stay active for .NET PING/PONG processing]
    private async Task ReceiveLoopAsync(WebSocket webSocket, CancellationToken cancellationToken) {
        byte[] buffer = new byte[16384];
        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested) {
            try {
                ValueWebSocketReceiveResult result = await webSocket.ReceiveAsync(
                    buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) {
                    break;
                }
                if (result.MessageType == WebSocketMessageType.Text) {
                    await ProcessMessageAsync(
                        webSocket: webSocket,
                        messageBytes: buffer.AsMemory(0, result.Count),
                        cancellationToken: cancellationToken).ConfigureAwait(false);
                }
            } catch (WebSocketException) {
                break;
            } catch (OperationCanceledException) {
                break;
            }
        }
    }
    // --- [MESSAGE_PROCESSING] ------------------------------------------------
    private async Task ProcessMessageAsync(
        WebSocket webSocket,
        ReadOnlyMemory<byte> messageBytes,
        CancellationToken cancellationToken) {
        try {
            JsonElement message = JsonSerializer.Deserialize<JsonElement>(messageBytes.Span);
            string tag = message.TryGetProperty("_tag", out JsonElement tagElement)
                && tagElement.ValueKind == JsonValueKind.String
                ? tagElement.GetString() ?? string.Empty
                : string.Empty;
            Fin<JsonElement> responseResult = await _dispatcher(
                tag, message, cancellationToken).ConfigureAwait(false);
            JsonElement response = responseResult.Match(
                Succ: static responseElement => responseElement,
                Fail: error => JsonSerializer.SerializeToElement(new {
                    _tag = "error",
                    message = error.Message,
                }, options: JsonOptions));
            byte[] responseBytes = JsonSerializer.SerializeToUtf8Bytes(
                value: response, options: JsonOptions);
            await webSocket.SendAsync(
                buffer: responseBytes.AsMemory(),
                messageType: WebSocketMessageType.Text,
                endOfMessage: true,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        } catch (JsonException exception) {
            RhinoApp.WriteLine($"[Kargadan] Message parse error: {exception.Message}");
        }
    }
    // --- [REJECTION] ---------------------------------------------------------
    private static async Task RejectConnectionAsync(TcpClient client, CancellationToken cancellationToken) {
        using TcpClient _ = client;
        try {
            NetworkStream stream = client.GetStream();
            await stream.WriteAsync(Http503Response.AsMemory(), cancellationToken).ConfigureAwait(false);
        } catch (IOException) {
            // best-effort rejection
        } catch (SocketException) {
            // best-effort rejection
        }
    }
}
