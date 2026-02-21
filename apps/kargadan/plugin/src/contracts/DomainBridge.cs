using LanguageExt;
using LanguageExt.Common;
using Thinktecture;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [BRIDGE] ----------------------------------------------------------------

public static class DomainBridge {
    // --- [VALUE_OBJECTS] ------------------------------------------------------

    public static Fin<T> ParseValueObject<T, TKey>(TKey candidate)
        where T : IObjectFactory<T, TKey, ValidationError>
        where TKey : notnull =>
        T.Validate(candidate, provider: null, out T? item) switch {
            null when item is { } value => Fin.Succ(value),
            { Message: { } message } => Fin.Fail<T>(Error.New(message)),
            _ => Fin.Fail<T>(Error.New($"{typeof(T).Name} validation failed for '{candidate}'."))
        };
    public static Fin<T> TryCreateValueObjectFromGuidString<T>(string raw, string failureMessage)
        where T : IObjectFactory<T, Guid, ValidationError> =>
        Guid.TryParse(raw, out Guid parsed) switch {
            true => ParseValueObject<T, Guid>(parsed),
            _ => Fin.Fail<T>(Error.New(message: failureMessage)),
        };

    // --- [SMART_ENUMS] --------------------------------------------------------

    public static Fin<T> ParseSmartEnum<T, TKey>(TKey candidate)
        where T : class, ISmartEnum<TKey, T, ValidationError>
        where TKey : notnull =>
        T.TryGet(candidate, out T? item) switch {
            true when item is not null => Fin.Succ(item),
            _ => Fin.Fail<T>(Error.New($"Unknown {typeof(T).Name} '{candidate}'."))
        };
}
