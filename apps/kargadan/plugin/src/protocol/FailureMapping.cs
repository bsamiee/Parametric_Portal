using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;
namespace ParametricPortal.Kargadan.Plugin.src.protocol;

internal static class FailureMapping {
    private readonly record struct FailureDefault(
        ErrorCode Code,
        string Fallback);
    internal static FailureReason FromCode(ErrorCode code, string message) =>
        BuildFailure(
            code: code,
            message: message,
            fallback: code.Key);
    internal static FailureReason FromError(Error error) {
        string normalizedMessage = Normalize(
            message: error.Message,
            fallback: "Unhandled execution failure.");
        ReadOnlySpan<char> span = normalizedMessage.AsSpan();
        int firstColon = span.IndexOf(':');
        int secondColon = firstColon >= 0
            ? span[(firstColon + 1)..].IndexOf(':')
            : -1;
        int absoluteSecond = secondColon >= 0 ? firstColon + 1 + secondColon : -1;
        string parsedCode = firstColon > 0
            ? span[..firstColon].ToString()
            : string.Empty;
        string parsedMessage = absoluteSecond > firstColon
            ? span[(absoluteSecond + 1)..].ToString()
            : normalizedMessage;
        return (firstColon > 0, absoluteSecond > firstColon) switch {
            (true, true) => DomainBridge.ParseSmartEnum<ErrorCode, string>(
                    candidate: parsedCode)
                .Map((ErrorCode code) => FailureMapping.FromCode(
                    code: code,
                    message: parsedMessage))
                .IfFail(FailureMapping.FromCode(
                    code: ErrorCode.UnexpectedRuntime,
                    message: normalizedMessage)),
            _ => FailureMapping.FromCode(
                code: ErrorCode.UnexpectedRuntime,
                message: normalizedMessage),
        };
    }
    internal static FailureReason FromException(Exception exception) {
        FailureDefault template = SelectDefault(exception: exception);
        return BuildFailure(
            code: template.Code,
            message: exception.Message,
            fallback: template.Fallback);
    }
    internal static Error ToError(FailureReason reason) =>
        Error.New(message: $"{reason.Code.Key}:{reason.FailureClass.Key}:{reason.Message}");
    private static FailureDefault SelectDefault(Exception exception) =>
        exception switch {
            JsonException => new FailureDefault(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid JSON envelope."),
            TimeoutException => new FailureDefault(
                Code: ErrorCode.TransientIo,
                Fallback: "Operation timed out."),
            FormatException => new FailureDefault(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid formatted payload value."),
            ArgumentException => new FailureDefault(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid argument in protocol envelope."),
            InvalidOperationException => new FailureDefault(
                Code: ErrorCode.PayloadMalformed,
                Fallback: "Invalid protocol operation."),
            _ => new FailureDefault(
                Code: ErrorCode.UnexpectedRuntime,
                Fallback: "Unhandled transport/runtime exception."),
        };
    private static FailureReason BuildFailure(
        ErrorCode code,
        string message,
        string fallback) =>
        new(
            Code: code,
            Message: Normalize(message: message, fallback: fallback));
    private static string Normalize(string message, string fallback) =>
        Optional(message)
            .Map(static m => m.Trim())
            .Bind(static trimmed => trimmed.Length switch {
                0 => None,
                _ => Some(trimmed),
            })
            .IfNone(fallback);
}
