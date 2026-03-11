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
                new ProtocolVersion(major: validMajor, minor: validMinor));
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
        attempt switch {
            < 1 => FinFail<TelemetryContext>(Error.New(message: "Attempt must be >= 1.")),
            _ => FinSucc(new TelemetryContext(
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
            true => FinFail<AuthToken>(Error.New(message: "ExpiresAt must be after IssuedAt.")),
            false => FinSucc(new AuthToken(token: token, issuedAt: issuedAt, expiresAt: expiresAt))
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
        Require.NonNegative(value: sourceRevision, field: "SourceRevision").Match(
            Succ: v => FinSucc(new SceneObjectRef(objectId: objectId, sourceRevision: v, typeTag: typeTag)),
            Fail: e => FinFail<SceneObjectRef>(e.Head));
}

// --- [STRUCTS_EXTENDED] ------------------------------------------------------

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
            .Apply(static (int durationMs, VersionString pluginRevision, int sourceRevision) =>
                new ExecutionMetadata(
                    durationMs: durationMs,
                    pluginRevision: pluginRevision,
                    sourceRevision: sourceRevision));
}

// --- [RECORDS_EXTENDED] ------------------------------------------------------

public sealed record DedupeMetadata(DedupeDecision Decision, RequestId OriginalRequestId);

// --- [COMMAND_CATALOG] -------------------------------------------------------

public sealed record CommandCatalogExample(
    string Input,
    string Description);
public sealed record CommandCatalogParameter(
    string Name,
    string Type,
    bool Required,
    string Description);
public sealed record CommandDispatchMetadata(CommandDispatchMode Mode);
public sealed record CommandEnvelopeRequirements(
    bool RequiresTelemetryContext,
    bool RequiresObjectRefs,
    int MinimumObjectRefCount);
public sealed record CommandCatalogEntry(
    string Id,
    string Name,
    string Description,
    string Category,
    bool IsDestructive,
    Seq<string> Aliases,
    CommandDispatchMetadata Dispatch,
    CommandEnvelopeRequirements Requirements,
    Seq<CommandCatalogParameter> Params,
    Seq<CommandCatalogExample> Examples);

// --- [EXECUTION_MODELS] ------------------------------------------------------

[StructLayout(LayoutKind.Auto)]
public readonly record struct CreatedObject(Guid ObjectId, string ObjectType);
[StructLayout(LayoutKind.Auto)]
public readonly record struct SceneObjectDelta {
    public int Before { get; }
    public int After { get; }
    private SceneObjectDelta(int before, int after) {
        Before = before;
        After = after;
    }
    public static Validation<Error, SceneObjectDelta> Create(int before, int after) =>
        (Require.NonNegative(value: before, field: "Before"),
         Require.NonNegative(value: after, field: "After"))
            .Apply(static (int validBefore, int validAfter) =>
                new SceneObjectDelta(before: validBefore, after: validAfter));
}
[StructLayout(LayoutKind.Auto)]
public readonly record struct ScriptResult {
    public string CommandName { get; }
    public int CommandResult { get; }
    public int ObjectsCreatedCount { get; }
    public Seq<CreatedObject> ObjectsCreated { get; }
    public SceneObjectDelta SceneObjectDelta { get; }
    public bool SelectionChanged { get; }
    private ScriptResult(
        string commandName,
        int commandResult,
        int objectsCreatedCount,
        Seq<CreatedObject> objectsCreated,
        SceneObjectDelta sceneObjectDelta,
        bool selectionChanged) {
        CommandName = commandName;
        CommandResult = commandResult;
        ObjectsCreatedCount = objectsCreatedCount;
        ObjectsCreated = objectsCreated;
        SceneObjectDelta = sceneObjectDelta;
        SelectionChanged = selectionChanged;
    }
    public static Validation<Error, ScriptResult> Create(
        string commandName,
        int commandResult,
        int objectsCreatedCount,
        Seq<CreatedObject> objectsCreated,
        SceneObjectDelta sceneObjectDelta,
        bool selectionChanged) =>
        (string.IsNullOrWhiteSpace(commandName) switch {
            true => Fail<Error, string>(Error.New(message: "CommandName must not be empty.")),
            _ => Success<Error, string>(commandName),
        },
         (commandResult is < 0 or > 6) switch {
             true => Fail<Error, int>(Error.New(message: "CommandResult must be in 0-6 range.")),
             _ => Success<Error, int>(commandResult),
         },
         (objectsCreatedCount < 0) switch {
             true => Fail<Error, int>(Error.New(message: "ObjectsCreatedCount must be non-negative.")),
             _ => Success<Error, int>(objectsCreatedCount),
         },
         Success<Error, Seq<CreatedObject>>(objectsCreated),
         Success<Error, SceneObjectDelta>(sceneObjectDelta),
         Success<Error, bool>(selectionChanged))
            .Apply(static (
                string validName,
                int validResult,
                int validCount,
                Seq<CreatedObject> validObjects,
                SceneObjectDelta validDelta,
                bool validSelection) =>
                new ScriptResult(
                    commandName: validName,
                    commandResult: validResult,
                    objectsCreatedCount: validCount,
                    objectsCreated: validObjects,
                    sceneObjectDelta: validDelta,
                    selectionChanged: validSelection));
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
