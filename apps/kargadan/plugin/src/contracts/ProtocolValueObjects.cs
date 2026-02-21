using System;
using Thinktecture;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [GUID_VALUE_OBJECTS] ----------------------------------------------------

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct AppId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(AppId));
}

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct RunId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(RunId));
}

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct SessionId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(SessionId));
}

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct RequestId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(RequestId));
}

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct EventId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(EventId));
}

[ValueObject<Guid>(KeyMemberName = "Value")]
public readonly partial struct ObjectId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref Guid value) =>
        validationError = Require.NonEmptyGuid(value: value, typeName: nameof(ObjectId));
}

// --- [STRING_VALUE_OBJECTS] --------------------------------------------------

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct TraceId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(TraceId),
            pattern: Require.Patterns.TelemetryHex);
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct SpanId {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(SpanId),
            pattern: Require.Patterns.TelemetryHex);
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct OperationTag {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(OperationTag));
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct VersionString {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(VersionString));
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct TokenValue {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(TokenValue));
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct UndoScope {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedNonEmpty(value: ref value, typeName: nameof(UndoScope));
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct IdempotencyKey {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(IdempotencyKey),
            pattern: Require.Patterns.IdempotencyKey);
}

[ValueObject<string>(KeyMemberName = "Value")]
[KeyMemberEqualityComparer<ComparerAccessors.StringOrdinal, string>]
[KeyMemberComparer<ComparerAccessors.StringOrdinal, string>]
public readonly partial struct PayloadHash {
    static partial void ValidateFactoryArguments(ref ValidationError? validationError, ref string value) =>
        validationError = Require.TrimmedMatching(
            value: ref value,
            typeName: nameof(PayloadHash),
            pattern: Require.Patterns.PayloadHash);
}
