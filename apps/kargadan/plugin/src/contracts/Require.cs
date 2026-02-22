using System;
using System.Buffers;
using LanguageExt;
using LanguageExt.Common;
using Thinktecture;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [VALIDATION] ------------------------------------------------------------

internal static class Require {
    // --- [SCALAR_RULES] -------------------------------------------------------
    internal static ValidationError? NonEmptyGuid(Guid value, string typeName) =>
        (value == Guid.Empty) switch {
            true => new ValidationError($"{typeName} must not be empty."),
            false => null
        };
    // --- [STRING_RULES] -------------------------------------------------------
    internal static ValidationError? TrimmedNonEmpty(ref string value, string typeName) {
        value = value.Trim();
        return value.Length switch {
            0 => new ValidationError($"{typeName} must not be empty."),
            _ => null
        };
    }
    internal static ValidationError? TrimmedMatching(ref string value, string typeName, CharSetPattern pattern) {
        value = value.Trim();
        ReadOnlySpan<char> candidate = value.AsSpan();
        // Why uint cast: if candidate.Length < MinLength the subtraction underflows to a large
        // uint, exceeding (MaxLength - MinLength) and failing the single comparison — tests
        // both lower and upper bounds without a second branch.
        bool hasValidLength =
            (uint)(candidate.Length - pattern.MinLength) <= (uint)(pattern.MaxLength - pattern.MinLength);
        bool hasOnlyAllowedChars = !candidate.ContainsAnyExcept(pattern.AllowedChars);
        return (hasValidLength, hasOnlyAllowedChars) switch {
            (true, true) => null,
            _ => new ValidationError($"{typeName} has invalid format.")
        };
    }
    // --- [NUMERIC_RULES] ------------------------------------------------------
    internal static Validation<Error, int> NonNegative(int value, string field) =>
        (value >= 0) switch {
            true => Success<Error, int>(value),
            false => Fail<Error, int>(Error.New(message: $"{field} must be non-negative."))
        };
    // --- [PATTERNS] -----------------------------------------------------------
    internal static class Patterns {
        internal static readonly CharSetPattern TelemetryHex = new(
            AllowedChars: SearchValues.Create("0123456789abcdefABCDEF".AsSpan()),
            MinLength: 8,
            MaxLength: 64);
        internal static readonly CharSetPattern IdempotencyKey = new(
            AllowedChars: SearchValues.Create("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:_-".AsSpan()),
            MinLength: 8,
            MaxLength: 128);
        internal static readonly CharSetPattern PayloadHash = new(
            AllowedChars: SearchValues.Create("0123456789abcdef".AsSpan()),
            MinLength: 64,
            MaxLength: 64);
    }
}

// --- [TYPES] -----------------------------------------------------------------

internal readonly record struct CharSetPattern(SearchValues<char> AllowedChars, int MinLength, int MaxLength);
