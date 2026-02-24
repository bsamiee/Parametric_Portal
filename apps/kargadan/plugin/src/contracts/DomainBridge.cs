using LanguageExt;
using LanguageExt.Common;
using Thinktecture;

namespace ParametricPortal.Kargadan.Plugin.src.contracts;

// --- [BRIDGE] ----------------------------------------------------------------

internal interface ITryCreateFactory<TValueObject, in TKey>
    where TValueObject : ITryCreateFactory<TValueObject, TKey> {
    public static abstract bool TryCreate(
        TKey value,
        out TValueObject obj,
        out ValidationError? validationError);
}

internal static class DomainBridge {
    // --- [VALUE_OBJECTS] ------------------------------------------------------
    internal static Fin<TValueObject> ParseValueObject<TValueObject, TKey>(TKey candidate)
        where TValueObject : ITryCreateFactory<TValueObject, TKey>
        where TKey : notnull =>
        TValueObject.TryCreate(candidate, out TValueObject item, out ValidationError? validationError) switch {
            true => FinSucc(item),
            false when validationError is { Message: { } message } => FinFail<TValueObject>(Error.New(message)),
            _ => FinFail<TValueObject>(
                Error.New($"{typeof(TValueObject).Name} validation failed for '{candidate}'."))
        };
    // --- [SMART_ENUMS] --------------------------------------------------------
    internal static Fin<TEnum> ParseSmartEnum<TEnum, TKey>(TKey candidate)
        where TEnum : class, ISmartEnum<TKey, TEnum, ValidationError>
        where TKey : notnull =>
        TEnum.TryGet(candidate, out TEnum? item) switch {
            true when item is { } value => FinSucc(value),
            _ => FinFail<TEnum>(Error.New($"Unknown {typeof(TEnum).Name} '{candidate}'."))
        };
}
