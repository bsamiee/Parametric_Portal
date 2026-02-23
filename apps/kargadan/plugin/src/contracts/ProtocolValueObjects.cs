using System;
using Thinktecture;
namespace ParametricPortal.Kargadan.Plugin.src.contracts;

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct AppId : ITryCreateFactory<AppId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(AppId));
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct RunId : ITryCreateFactory<RunId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(RunId));
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct SessionId : ITryCreateFactory<SessionId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(SessionId));
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct RequestId : ITryCreateFactory<RequestId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(RequestId));
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct EventId : ITryCreateFactory<EventId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(EventId));
}
[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct ObjectId : ITryCreateFactory<ObjectId, Guid> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(ObjectId));
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct TraceId : ITryCreateFactory<TraceId, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(TraceId),
            pattern: Require.Patterns.TelemetryHex);
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct SpanId : ITryCreateFactory<SpanId, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(SpanId),
            pattern: Require.Patterns.TelemetryHex);
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct OperationTag : ITryCreateFactory<OperationTag, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(OperationTag));
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct VersionString : ITryCreateFactory<VersionString, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(VersionString));
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct TokenValue : ITryCreateFactory<TokenValue, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(TokenValue));
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct UndoScope : ITryCreateFactory<UndoScope, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(UndoScope));
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct IdempotencyKey : ITryCreateFactory<IdempotencyKey, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(IdempotencyKey),
            pattern: Require.Patterns.IdempotencyKey);
}
[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct PayloadHash : ITryCreateFactory<PayloadHash, string> {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(PayloadHash),
            pattern: Require.Patterns.PayloadHash);
}
