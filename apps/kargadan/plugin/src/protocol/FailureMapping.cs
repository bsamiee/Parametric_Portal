// Maps ErrorCode, Exception, and LanguageExt Error to FailureReason with normalized, non-empty messages.
// Single mapping layer prevents failure vocabulary drift across transport, handshake, and domain boundaries.
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.protocol;

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class FailureMapping {
    internal static FailureReason FromCode(ErrorCode code, string message) =>
        BuildFailure(
            code: code,
            message: message,
            fallback: code.Key);
    internal static FailureReason FromException(Exception exception) =>
        exception switch {
            JsonException jsonException =>
                BuildFailure(
                    code: ErrorCode.PayloadMalformed,
                    message: jsonException.Message,
                    fallback: "Invalid JSON envelope."),
            TimeoutException timeoutException =>
                BuildFailure(
                    code: ErrorCode.TransientIo,
                    message: timeoutException.Message,
                    fallback: "Operation timed out."),
            FormatException formatException =>
                BuildFailure(
                    code: ErrorCode.PayloadMalformed,
                    message: formatException.Message,
                    fallback: "Invalid formatted payload value."),
            ArgumentException argumentException =>
                BuildFailure(
                    code: ErrorCode.PayloadMalformed,
                    message: argumentException.Message,
                    fallback: "Invalid argument in protocol envelope."),
            InvalidOperationException invalidOperationException =>
                BuildFailure(
                    code: ErrorCode.PayloadMalformed,
                    message: invalidOperationException.Message,
                    fallback: "Invalid protocol operation."),
            _ =>
                BuildFailure(
                    code: ErrorCode.UnexpectedRuntime,
                    message: exception.Message,
                    fallback: "Unhandled transport/runtime exception."),
        };
    internal static Error ToError(FailureReason reason) =>
        Error.New(message: $"{reason.Code.Key}:{reason.FailureClass}:{reason.Message}");
    // --- [INTERNAL] ----------------------------------------------------------
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
            .Match(
                Some: static trimmed => trimmed,
                None: () => fallback);
}
