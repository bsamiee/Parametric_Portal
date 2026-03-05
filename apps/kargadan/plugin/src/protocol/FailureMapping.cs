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
        return SplitCodedMessage(normalizedMessage.AsSpan())
            .Bind((SplitResult split) => DomainBridge.ParseSmartEnum<ErrorCode, string>(
                candidate: split.Code)
                .Map((ErrorCode code) => FailureMapping.FromCode(
                    code: code,
                    message: split.Message)))
            .IfFail(FailureMapping.FromCode(
                code: ErrorCode.UnexpectedRuntime,
                message: normalizedMessage));
    }
    private static Fin<SplitResult> SplitCodedMessage(ReadOnlySpan<char> span) {
        Span<Range> segments = stackalloc Range[4];
        int count = span.Split(segments, separator: ':', StringSplitOptions.None);
        return count switch {
            >= 3 => FinSucc(new SplitResult(
                Code: span[segments[0]].ToString(),
                Message: span[segments[2].Start..].ToString())),
            _ => FinFail<SplitResult>(Error.New(message: "Not a coded error message.")),
        };
    }
    [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Auto)]
    private readonly record struct SplitResult(string Code, string Message);
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
