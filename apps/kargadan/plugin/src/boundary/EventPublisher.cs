// In-process lock-gated queue for EventEnvelope emission; Drain atomically snapshots and clears pending events.
// Lifetime is managed by KargadanPlugin.OnLoad/OnShutdown — queue reference is never exposed outside the boundary adapter.
using LanguageExt;
using NodaTime;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.boundary;

// --- [TYPES] -----------------------------------------------------------------

public readonly record struct PublishedEvent(EventEnvelope Envelope, Instant PublishedAt);

// --- [ADAPTER] ---------------------------------------------------------------

public sealed class EventPublisher {
    // --- [STATE] -------------------------------------------------------------
    private readonly Ref<Seq<PublishedEvent>> _queue = Ref(Seq<PublishedEvent>());
    // --- [INTERFACE] ---------------------------------------------------------
    public Fin<Unit> Publish(EventEnvelope envelope, Instant publishedAt) {
        _ = _queue.Swap(queue => queue.Add(
            new PublishedEvent(Envelope: envelope, PublishedAt: publishedAt)));
        return Fin.Succ(unit);
    }
    public Seq<PublishedEvent> Drain() =>
        atomic(() => {
            Seq<PublishedEvent> snapshot = _queue.Value;
            _ = _queue.Swap(static _ => Seq<PublishedEvent>());
            return snapshot;
        });
}
