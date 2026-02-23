using System.Runtime.InteropServices;
using LanguageExt;
using LanguageExt.Common;
using NodaTime;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [STRUCTS] ---------------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct ProtocolVersion {
    public int Major { get; }
    public int Minor { get; }
    private ProtocolVersion(int major, int minor) {
        Major = major;
        Minor = minor;
    }
    public static Validation<Error, ProtocolVersion> Create(int major, int minor) =>
        (Require.NonNegative(value: major, field: "Major"),
         Require.NonNegative(value: minor, field: "Minor"))
            .Apply(static (int validMajor, int validMinor) =>
                new ProtocolVersion(major: validMajor, minor: validMinor)).As();
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct TelemetryContext {
    public TraceId TraceId { get; }
    public SpanId SpanId { get; }
    public OperationTag OperationTag { get; }
    public int Attempt { get; }
    private TelemetryContext(TraceId traceId, SpanId spanId, OperationTag operationTag, int attempt) {
        TraceId = traceId;
        SpanId = spanId;
        OperationTag = operationTag;
        Attempt = attempt;
    }
    public static Fin<TelemetryContext> Create(TraceId traceId, SpanId spanId, OperationTag operationTag, int attempt) =>
        (attempt < 1) switch {
            true => Fin.Fail<TelemetryContext>(Error.New(message: "Attempt must be >= 1.")),
            false => Fin.Succ(new TelemetryContext(
                traceId: traceId,
                spanId: spanId,
                operationTag: operationTag,
                attempt: attempt))
        };
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct ServerInfo(VersionString RhinoVersion, VersionString PluginRevision);

// --- [RECORDS] ---------------------------------------------------------------

public sealed record EnvelopeIdentity(
    AppId AppId,
    RunId RunId,
    SessionId SessionId,
    RequestId RequestId,
    Instant IssuedAt,
    ProtocolVersion ProtocolVersion);
public sealed record CapabilitySet(Seq<string> Required, Seq<string> Optional);
public sealed record AuthToken {
    public TokenValue Token { get; }
    public Instant IssuedAt { get; }
    public Instant ExpiresAt { get; }
    private AuthToken(TokenValue token, Instant issuedAt, Instant expiresAt) {
        Token = token;
        IssuedAt = issuedAt;
        ExpiresAt = expiresAt;
    }
    public static Fin<AuthToken> Create(TokenValue token, Instant issuedAt, Instant expiresAt) =>
        (expiresAt <= issuedAt) switch {
            true => Fin.Fail<AuthToken>(Error.New(message: "ExpiresAt must be after IssuedAt.")),
            false => Fin.Succ(new AuthToken(token: token, issuedAt: issuedAt, expiresAt: expiresAt))
        };
}
public sealed record FailureReason(ErrorCode Code, string Message) {
    public FailureClass FailureClass => Code.FailureClass;
}
public sealed record SceneObjectRef {
    public ObjectId ObjectId { get; }
    public int SourceRevision { get; }
    public SceneObjectType TypeTag { get; }
    private SceneObjectRef(ObjectId objectId, int sourceRevision, SceneObjectType typeTag) {
        ObjectId = objectId;
        SourceRevision = sourceRevision;
        TypeTag = typeTag;
    }
    public static Fin<SceneObjectRef> Create(ObjectId objectId, int sourceRevision, SceneObjectType typeTag) =>
        Require.NonNegative(value: sourceRevision, field: "SourceRevision")
            .ToFin()
            .Map(validSourceRevision =>
                new SceneObjectRef(
                    objectId: objectId,
                    sourceRevision: validSourceRevision,
                    typeTag: typeTag));
}

// --- [STRUCTS] ---------------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct IdempotencyToken(IdempotencyKey Key, PayloadHash PayloadHash);
[StructLayout(LayoutKind.Auto)]
public readonly record struct ExecutionMetadata {
    public int DurationMs { get; }
    public VersionString PluginRevision { get; }
    public int SourceRevision { get; }
    private ExecutionMetadata(int durationMs, VersionString pluginRevision, int sourceRevision) {
        DurationMs = durationMs;
        PluginRevision = pluginRevision;
        SourceRevision = sourceRevision;
    }
    public static Validation<Error, ExecutionMetadata> Create(
        int durationMs,
        VersionString pluginRevision,
        int sourceRevision) =>
        (Require.NonNegative(value: durationMs, field: "DurationMs"),
         Success<Error, VersionString>(pluginRevision),
         Require.NonNegative(value: sourceRevision, field: "SourceRevision"))
            .Apply(static (int dur, VersionString rev, int srcRev) =>
                new ExecutionMetadata(
                    durationMs: dur,
                    pluginRevision: rev,
                    sourceRevision: srcRev)).As();
}

// --- [RECORDS] ---------------------------------------------------------------

public sealed record DedupeMetadata(DedupeDecision Decision, RequestId OriginalRequestId);

// --- [EXECUTION_MODELS] ------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct ScriptResult {
    public string CommandName { get; }
    public int CommandResult { get; }
    public int ObjectsCreatedCount { get; }
    private ScriptResult(string commandName, int commandResult, int objectsCreatedCount) {
        CommandName = commandName;
        CommandResult = commandResult;
        ObjectsCreatedCount = objectsCreatedCount;
    }
    public static Fin<ScriptResult> Create(string commandName, int commandResult, int objectsCreatedCount) =>
        (string.IsNullOrWhiteSpace(commandName), commandResult is < 0 or > 6, objectsCreatedCount < 0) switch {
            (true, _, _) => Fin.Fail<ScriptResult>(Error.New(message: "CommandName must not be empty.")),
            (_, true, _) => Fin.Fail<ScriptResult>(Error.New(message: "CommandResult must be in 0-6 range.")),
            (_, _, true) => Fin.Fail<ScriptResult>(Error.New(message: "ObjectsCreatedCount must be non-negative.")),
            _ => Fin.Succ(new ScriptResult(
                commandName: commandName,
                commandResult: commandResult,
                objectsCreatedCount: objectsCreatedCount))
        };
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct RawDocEvent(
    EventType Type,
    EventSubtype Subtype,
    Option<Guid> ObjectId,
    Option<Guid> OldObjectId,
    Option<string> ObjectType,
    bool IsUndoRedo);
[StructLayout(LayoutKind.Auto)]
public readonly record struct EventBatchSummary(
    int TotalCount,
    Seq<CategoryCount> Categories,
    bool ContainsUndoRedo,
    int BatchWindowMs);
[StructLayout(LayoutKind.Auto)]
public readonly record struct CategoryCount(
    EventType Category,
    int Count,
    Seq<SubtypeCount> Subtypes);
[StructLayout(LayoutKind.Auto)]
public readonly record struct SubtypeCount(
    EventSubtype Subtype,
    int Count);
[StructLayout(LayoutKind.Auto)]
public readonly record struct AgentUndoState(
    RequestId RequestId,
    uint UndoSerial);
