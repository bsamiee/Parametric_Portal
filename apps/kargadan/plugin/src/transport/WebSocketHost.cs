// HttpListener-based WebSocket server with typed message-tag dispatch and single active client policy.
// Binds exclusively to 127.0.0.1 and rejects additional concurrent clients with HTTP 503.
using System;
using System.Buffers;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [TYPES] -----------------------------------------------------------------

internal delegate Task<Fin<JsonElement>> MessageDispatcher(
    TransportMessageTag tag,
    JsonElement message,
    CancellationToken cancellationToken);

// --- [ADAPTER] ---------------------------------------------------------------

internal sealed class WebSocketHost : IDisposable {
    // --- [CONSTANTS] ---------------------------------------------------------
    private const int ReceiveBufferSize = 16_384;
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(5);
    private static readonly byte[] Http503Response = Encoding.UTF8.GetBytes(
        string.Join("\r\n", "HTTP/1.1 503 Service Unavailable", "Connection: close", "", ""));
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    // --- [STATE] -------------------------------------------------------------
    private readonly MessageDispatcher _dispatcher;
    private readonly CancellationTokenSource _cts = new();
    private HttpListener? _listener;
    private WebSocket? _activeWebSocket;
    private int _activeConnectionCount;
    private bool _disposed;

    // --- [LIFECYCLE] ---------------------------------------------------------
    internal WebSocketHost(MessageDispatcher dispatcher) =>
        _dispatcher = dispatcher;

    internal int Port { get; private set; }

    internal void Start() {
        int port = ReserveLoopbackPort();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        _listener.Start();
        Port = port;
        PortFile.WritePortFile(port: Port);
        RhinoApp.WriteLine($"[Kargadan] WebSocket server listening on 127.0.0.1:{Port}");
        _ = Task.Run(() => AcceptLoopAsync(cancellationToken: _cts.Token));
    }

    internal void Stop() {
        _cts.Cancel();
        PortFile.DeletePortFile();
        _activeWebSocket?.Dispose();
        _listener?.Close();
        RhinoApp.WriteLine("[Kargadan] WebSocket server stopped.");
    }

    public void Dispose() {
        _ = _disposed switch {
            true => unit,
            false => DisposeCore(),
        };
    }

    private Unit DisposeCore() {
        _disposed = true;
        Stop();
        _cts.Dispose();
        return unit;
    }

    private static int ReserveLoopbackPort() {
        using TcpListener listener = new(localaddr: IPAddress.Loopback, port: 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    // --- [ACCEPT_LOOP] -------------------------------------------------------
    private async Task AcceptLoopAsync(CancellationToken cancellationToken) {
        while (!cancellationToken.IsCancellationRequested) {
            HttpListenerContext? context = await TryGetContextAsync(cancellationToken: cancellationToken).ConfigureAwait(false);
            await (context switch {
                null => Task.CompletedTask,
                _ when Interlocked.CompareExchange(ref _activeConnectionCount, 1, 0) != 0 =>
                    RejectContextAsync(context: context, cancellationToken: cancellationToken),
                _ => RunConnectionScopeAsync(context: context, cancellationToken: cancellationToken),
            }).ConfigureAwait(false);
        }
    }

    private async Task RunConnectionScopeAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken) {
        try {
            await RunConnectionAsync(context: context, cancellationToken: cancellationToken).ConfigureAwait(false);
        } finally {
            _ = Interlocked.Exchange(ref _activeConnectionCount, 0);
            _activeWebSocket = null;
        }
    }

    private async Task<HttpListenerContext?> TryGetContextAsync(CancellationToken cancellationToken) {
        switch (_listener) {
            case null:
            case { IsListening: false }:
                return null;
            case HttpListener listener:
                try {
                    return await listener.GetContextAsync().WaitAsync(cancellationToken).ConfigureAwait(false);
                } catch (OperationCanceledException) {
                    return null;
                } catch (HttpListenerException) when (cancellationToken.IsCancellationRequested) {
                    return null;
                } catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested) {
                    return null;
                } catch (HttpListenerException exception) {
                    RhinoApp.WriteLine($"[Kargadan] Accept loop error: {exception.Message}");
                    return null;
                }
        }
    }

    private static async Task RejectContextAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken) {
        context.Response.StatusCode = 503;
        try {
            await context.Response.OutputStream.WriteAsync(Http503Response.AsMemory(), cancellationToken).ConfigureAwait(false);
        } catch (OperationCanceledException) {
            // why: cancellation during shutdown should not escalate
        } catch (IOException) {
            // why: peer may disconnect before 503 body write completes
        }

        context.Response.Close();
    }

    // --- [CONNECTION] --------------------------------------------------------
    private Task RunConnectionAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken) =>
        context.Request.IsWebSocketRequest switch {
            false => RejectNonWebSocketAsync(context: context),
            true => AcceptConnectionAsync(context: context, cancellationToken: cancellationToken),
        };

    private static Task RejectNonWebSocketAsync(HttpListenerContext context) {
        context.Response.StatusCode = 400;
        context.Response.Close();
        return Task.CompletedTask;
    }

    private async Task AcceptConnectionAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken) {
        HttpListenerWebSocketContext wsContext;
        try {
            wsContext = await context.AcceptWebSocketAsync(
                subProtocol: null,
                receiveBufferSize: ReceiveBufferSize,
                keepAliveInterval: KeepAliveInterval).ConfigureAwait(false);
        } catch (WebSocketException exception) {
            RhinoApp.WriteLine($"[Kargadan] WebSocket upgrade failed: {exception.Message}");
            context.Response.Close();
            return;
        }

        using WebSocket webSocket = wsContext.WebSocket;
        _activeWebSocket = webSocket;
        RhinoApp.WriteLine("[Kargadan] Client connected.");
        await ReceiveLoopAsync(webSocket: webSocket, cancellationToken: cancellationToken).ConfigureAwait(false);
        await CloseWebSocketSafelyAsync(webSocket: webSocket).ConfigureAwait(false);
        RhinoApp.WriteLine("[Kargadan] Client disconnected.");
    }

    private static async Task CloseWebSocketSafelyAsync(WebSocket webSocket) {
        switch (webSocket.State) {
            case WebSocketState.Open:
            case WebSocketState.CloseReceived:
                try {
                    await webSocket.CloseAsync(
                        closeStatus: WebSocketCloseStatus.NormalClosure,
                        statusDescription: "shutdown",
                        cancellationToken: CancellationToken.None).ConfigureAwait(false);
                } catch (WebSocketException) {
                    // why: network closure race is expected during shutdown
                }
                break;
            default:
                break;
        }
    }

    // --- [RECEIVE] -----------------------------------------------------------
    private async Task ReceiveLoopAsync(WebSocket webSocket, CancellationToken cancellationToken) {
        byte[] frameBuffer = new byte[ReceiveBufferSize];
        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested) {
            ValueWebSocketReceiveResult? firstFrame = await TryReceiveAsync(
                webSocket: webSocket,
                buffer: frameBuffer.AsMemory(),
                cancellationToken: cancellationToken).ConfigureAwait(false);
            switch (firstFrame) {
                case null:
                case { MessageType: WebSocketMessageType.Close }:
                    return;
                case { MessageType: WebSocketMessageType.Text } frame:
                    byte[]? messageBytes = await ReadTextMessageAsync(
                        webSocket: webSocket,
                        firstFrame: frame,
                        frameBuffer: frameBuffer,
                        cancellationToken: cancellationToken).ConfigureAwait(false);
                    switch (messageBytes) {
                        case null:
                            return;
                        case byte[] bytes:
                            await ProcessMessageAsync(
                                webSocket: webSocket,
                                messageBytes: bytes.AsMemory(),
                                cancellationToken: cancellationToken).ConfigureAwait(false);
                            break;
                    }
                    break;
                default:
                    break;
            }
        }
    }

    private static async Task<ValueWebSocketReceiveResult?> TryReceiveAsync(
        WebSocket webSocket,
        Memory<byte> buffer,
        CancellationToken cancellationToken) {
        try {
            return await webSocket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
        } catch (OperationCanceledException) {
            return null;
        } catch (WebSocketException) {
            return null;
        }
    }

    private static async Task<byte[]?> ReadTextMessageAsync(
        WebSocket webSocket,
        ValueWebSocketReceiveResult firstFrame,
        byte[] frameBuffer,
        CancellationToken cancellationToken) {
        ArrayBufferWriter<byte> messageBuffer = new();
        ValueWebSocketReceiveResult frame = firstFrame;
        messageBuffer.Write(frameBuffer.AsSpan(0, frame.Count));
        while (!frame.EndOfMessage) {
            ValueWebSocketReceiveResult? nextFrame = await TryReceiveAsync(
                webSocket: webSocket,
                buffer: frameBuffer.AsMemory(),
                cancellationToken: cancellationToken).ConfigureAwait(false);
            switch (nextFrame) {
                case { MessageType: WebSocketMessageType.Text } next:
                    frame = next;
                    messageBuffer.Write(frameBuffer.AsSpan(0, frame.Count));
                    break;
                default:
                    return null;
            }
        }

        return messageBuffer.WrittenMemory.ToArray();
    }

    // --- [DISPATCH] ----------------------------------------------------------
    private async Task ProcessMessageAsync(
        WebSocket webSocket,
        ReadOnlyMemory<byte> messageBytes,
        CancellationToken cancellationToken) {
        Fin<JsonElement> responseResult = await BuildResponseAsync(
            messageBytes: messageBytes,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        byte[] responseBytes = SerializeResponse(responseResult: responseResult);
        await webSocket.SendAsync(
            buffer: responseBytes.AsMemory(),
            messageType: WebSocketMessageType.Text,
            endOfMessage: true,
            cancellationToken: cancellationToken).ConfigureAwait(false);
    }

    private async Task<Fin<JsonElement>> BuildResponseAsync(
        ReadOnlyMemory<byte> messageBytes,
        CancellationToken cancellationToken) {
        try {
            JsonElement message = JsonSerializer.Deserialize<JsonElement>(messageBytes.Span);
            return await DispatchByTagAsync(message: message, cancellationToken: cancellationToken).ConfigureAwait(false);
        } catch (JsonException exception) {
            RhinoApp.WriteLine($"[Kargadan] Message parse error: {exception.Message}");
            return Fin.Fail<JsonElement>(Error.New(message: exception.Message));
        }
    }

    private Task<Fin<JsonElement>> DispatchByTagAsync(
        JsonElement message,
        CancellationToken cancellationToken) =>
        ParseTransportTag(message: message).Match(
            Succ: tag => _dispatcher(
                tag: tag,
                message: message,
                cancellationToken: cancellationToken),
            Fail: static error => Task.FromResult(Fin.Fail<JsonElement>(error)));

    private static byte[] SerializeResponse(Fin<JsonElement> responseResult) =>
        responseResult.Match(
            Succ: responseElement => JsonSerializer.SerializeToUtf8Bytes(
                value: responseElement,
                options: JsonOptions),
            Fail: static error => JsonSerializer.SerializeToUtf8Bytes(new {
                _tag = TransportMessageTag.Error.Key,
                message = error.Message,
            }, options: JsonOptions));

    private static Fin<TransportMessageTag> ParseTransportTag(JsonElement message) =>
        message.TryGetProperty("_tag", out JsonElement tagElement) switch {
            true when tagElement.ValueKind == JsonValueKind.String =>
                DomainBridge.ParseSmartEnum<TransportMessageTag, string>(
                    candidate: tagElement.GetString() ?? string.Empty),
            true => Fin.Fail<TransportMessageTag>(
                Error.New(message: "Envelope _tag must be a string.")),
            false => Fin.Fail<TransportMessageTag>(
                Error.New(message: "Envelope _tag is required.")),
        };
}
