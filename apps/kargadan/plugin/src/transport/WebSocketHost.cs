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

internal delegate Task<Fin<JsonElement>> MessageDispatcher(
    TransportMessageTag tag,
    JsonElement message,
    Func<JsonElement, Task> sendAckAsync,
    CancellationToken cancellationToken);
internal delegate Seq<EventEnvelope> EventEnvelopeDrain();
internal delegate Unit EventEnvelopeRequeue(Seq<EventEnvelope> envelopes);
internal sealed class WebSocketHost : IDisposable {
    private const string EnvelopeTagField = "_tag";
    private const string EventEnvelopeTag = "event";
    private const int EventPumpIntervalMs = 25;
    private const int ReceiveBufferSize = 16_384;
    private static readonly TimeSpan KeepAliveInterval = TimeSpan.FromSeconds(5);
    private static readonly byte[] Http503Response = Encoding.UTF8.GetBytes(
        string.Join("\r\n", "HTTP/1.1 503 Service Unavailable", "Connection: close", "", ""));
    private static readonly JsonSerializerOptions JsonOptions = new() {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
    private readonly MessageDispatcher _dispatcher;
    private readonly EventEnvelopeDrain _drainPublishedEvents;
    private readonly EventEnvelopeRequeue _requeueEvents;
    private readonly CancellationTokenSource _cts = new();
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private HttpListener? _listener;
    private WebSocket? _activeWebSocket;
    private int _activeConnectionCount;
    private bool _disposed;
    internal WebSocketHost(
        MessageDispatcher dispatcher,
        EventEnvelopeDrain drainPublishedEvents,
        EventEnvelopeRequeue requeueEvents) {
        _dispatcher = dispatcher;
        _drainPublishedEvents = drainPublishedEvents;
        _requeueEvents = requeueEvents;
    }
    internal int Port { get; private set; }
    internal void Start() {
        int port = ReserveLoopbackPort();
        _listener = new HttpListener();
        _listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        _listener.Start();
        Port = port;
        WebSocketPortFile.Write(port: Port);
        RhinoApp.WriteLine($"[Kargadan] WebSocket server listening on 127.0.0.1:{Port}");
        _ = Task.Run(() => AcceptLoopAsync(cancellationToken: _cts.Token));
    }
    internal void Stop() {
        _cts.Cancel();
        WebSocketPortFile.Delete();
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
        _sendGate.Dispose();
        _cts.Dispose();
        return unit;
    }
    private static int ReserveLoopbackPort() {
        using TcpListener listener = new(localaddr: IPAddress.Loopback, port: 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }
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
        } catch (OperationCanceledException) {
            // why: connection cancellation during shutdown is expected
        } catch (WebSocketException exception) {
            RhinoApp.WriteLine($"[Kargadan] Connection scope error: {exception.Message}");
        } catch (IOException exception) {
            RhinoApp.WriteLine($"[Kargadan] Connection scope error: {exception.Message}");
        } catch (ObjectDisposedException exception) {
            RhinoApp.WriteLine($"[Kargadan] Connection scope error: {exception.Message}");
        } catch (InvalidOperationException exception) {
            RhinoApp.WriteLine($"[Kargadan] Connection scope error: {exception.Message}");
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
            default:
                try {
                    return await _listener.GetContextAsync().WaitAsync(cancellationToken).ConfigureAwait(false);
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
    private Task RunConnectionAsync(
        HttpListenerContext context,
        CancellationToken cancellationToken) =>
        context.Request.IsWebSocketRequest switch {
            false => Task.FromResult(RejectNonWebSocket(context: context)),
            true => AcceptConnectionAsync(context: context, cancellationToken: cancellationToken),
        };
    private static Unit RejectNonWebSocket(HttpListenerContext context) {
        context.Response.StatusCode = 400;
        context.Response.Close();
        return unit;
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
        WebSocket webSocket = wsContext.WebSocket;
        _activeWebSocket = webSocket;
        RhinoApp.WriteLine("[Kargadan] Client connected.");
        try {
            using CancellationTokenSource connectionCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            Task receiveLoop = ReceiveLoopAsync(
                webSocket: webSocket,
                cancellationToken: connectionCts.Token);
            Task eventPumpLoop = PumpEventsAsync(
                webSocket: webSocket,
                cancellationToken: connectionCts.Token);
            _ = await Task.WhenAny(receiveLoop, eventPumpLoop).ConfigureAwait(false);
            await connectionCts.CancelAsync().ConfigureAwait(false);
            try {
                await receiveLoop.ConfigureAwait(false);
            } catch (OperationCanceledException) {
                // why: loop cancellation is expected when connection scope closes
            }
            try {
                await eventPumpLoop.ConfigureAwait(false);
            } catch (OperationCanceledException) {
                // why: loop cancellation is expected when connection scope closes
            }
            await CloseWebSocketSafelyAsync(webSocket: webSocket).ConfigureAwait(false);
            RhinoApp.WriteLine("[Kargadan] Client disconnected.");
        } finally {
            webSocket.Dispose();
        }
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
                        default:
                            await ProcessMessageAsync(
                                webSocket: webSocket,
                                messageBytes: messageBytes.AsMemory(),
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
    private async Task PumpEventsAsync(
        WebSocket webSocket,
        CancellationToken cancellationToken) {
        while (webSocket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested) {
            Seq<EventEnvelope> drained = _drainPublishedEvents();
            Seq<EventEnvelope> remaining = drained;
            while (remaining.Count > 0) {
                EventEnvelope current = remaining[0];
                remaining = remaining.Tail;
                try {
                    await SendBytesAsync(
                        webSocket: webSocket,
                        payloadBytes: SerializeEvent(envelope: current),
                        cancellationToken: cancellationToken).ConfigureAwait(false);
                } catch (WebSocketException exception) {
                    RhinoApp.WriteLine($"[Kargadan] Event send failed: {exception.Message}");
                    _ = _requeueEvents(Seq1(current) + remaining);
                    return;
                } catch (IOException exception) {
                    RhinoApp.WriteLine($"[Kargadan] Event send failed: {exception.Message}");
                    _ = _requeueEvents(Seq1(current) + remaining);
                    return;
                }
            }
            await Task.Delay(
                millisecondsDelay: EventPumpIntervalMs,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        }
    }
    private async Task ProcessMessageAsync(
        WebSocket webSocket,
        ReadOnlyMemory<byte> messageBytes,
        CancellationToken cancellationToken) {
        Fin<JsonElement> responseResult = await BuildResponseAsync(
            webSocket: webSocket,
            messageBytes: messageBytes,
            cancellationToken: cancellationToken).ConfigureAwait(false);
        byte[] responseBytes = SerializeResponse(responseResult: responseResult);
        await SendBytesAsync(
            webSocket: webSocket,
            payloadBytes: responseBytes,
            cancellationToken: cancellationToken).ConfigureAwait(false);
    }
    private async Task<Fin<JsonElement>> BuildResponseAsync(
        WebSocket webSocket,
        ReadOnlyMemory<byte> messageBytes,
        CancellationToken cancellationToken) {
        try {
            JsonElement message = JsonSerializer.Deserialize<JsonElement>(messageBytes.Span);
            return await DispatchByTagAsync(
                webSocket: webSocket,
                message: message,
                cancellationToken: cancellationToken).ConfigureAwait(false);
        } catch (JsonException exception) {
            RhinoApp.WriteLine($"[Kargadan] Message parse error: {exception.Message}");
            return FinFail<JsonElement>(Error.New(message: exception.Message));
        }
    }
    private async Task<Fin<JsonElement>> DispatchByTagAsync(
        WebSocket webSocket,
        JsonElement message,
        CancellationToken cancellationToken) =>
        await ParseTransportTag(message: message).Match(
            Succ: tag => _dispatcher(
                tag: tag,
                message: message,
                sendAckAsync: ackPayload => SendAckAsync(webSocket: webSocket, ackPayload: ackPayload),
                cancellationToken: cancellationToken),
            Fail: static error => Task.FromResult(FinFail<JsonElement>(error))).ConfigureAwait(false);
    private Task SendAckAsync(WebSocket webSocket, JsonElement ackPayload) =>
        SendBytesAsync(
            webSocket: webSocket,
            payloadBytes: JsonSerializer.SerializeToUtf8Bytes(
                value: ackPayload,
                options: JsonOptions),
            cancellationToken: CancellationToken.None);
    private async Task SendBytesAsync(
        WebSocket webSocket,
        byte[] payloadBytes,
        CancellationToken cancellationToken) {
        await _sendGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try {
            switch (webSocket.State) {
                case WebSocketState.Open:
                    await webSocket.SendAsync(
                        buffer: payloadBytes.AsMemory(),
                        messageType: WebSocketMessageType.Text,
                        endOfMessage: true,
                        cancellationToken: cancellationToken).ConfigureAwait(false);
                    break;
                default:
                    break;
            }
        } finally {
            _ = _sendGate.Release();
        }
    }
    private static byte[] SerializeResponse(Fin<JsonElement> responseResult) =>
        responseResult.Match(
            Succ: responseElement => JsonSerializer.SerializeToUtf8Bytes(
                value: responseElement,
                options: JsonOptions),
            Fail: static error => JsonSerializer.SerializeToUtf8Bytes(new {
                _tag = TransportMessageTag.Error.Key,
                message = error.Message,
            }, options: JsonOptions));
    private static byte[] SerializeEvent(EventEnvelope envelope) =>
        envelope.CausationRequestId.Match(
            Some: causationRequestId => JsonSerializer.SerializeToUtf8Bytes(new {
                _tag = EventEnvelopeTag,
                causationRequestId = (Guid)causationRequestId,
                delta = envelope.Delta,
                eventId = (Guid)envelope.EventId,
                eventType = envelope.EventType.Key,
                identity = envelope.Identity,
                sourceRevision = envelope.SourceRevision,
                telemetryContext = envelope.TelemetryContext,
            }, options: JsonOptions),
            None: () => JsonSerializer.SerializeToUtf8Bytes(new {
                _tag = EventEnvelopeTag,
                delta = envelope.Delta,
                eventId = (Guid)envelope.EventId,
                eventType = envelope.EventType.Key,
                identity = envelope.Identity,
                sourceRevision = envelope.SourceRevision,
                telemetryContext = envelope.TelemetryContext,
            }, options: JsonOptions));
    private static Fin<TransportMessageTag> ParseTransportTag(JsonElement message) =>
        message.TryGetProperty(EnvelopeTagField, out JsonElement tagElement) switch {
            true when tagElement.ValueKind == JsonValueKind.String =>
                DomainBridge.ParseSmartEnum<TransportMessageTag, string>(
                    candidate: (tagElement.GetString() ?? string.Empty).Trim()),
            true => FinFail<TransportMessageTag>(
                Error.New(message: $"Envelope {EnvelopeTagField} must be a string.")),
            false => FinFail<TransportMessageTag>(
                Error.New(message: $"Envelope {EnvelopeTagField} is required.")),
        };
}
