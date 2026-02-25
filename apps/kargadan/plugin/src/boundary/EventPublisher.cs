// In-process lock-gated queue for EventEnvelope emission; Drain atomically snapshots and clears pending events.
// Lifetime is managed by KargadanPlugin.OnLoad/OnShutdown — queue reference is never exposed outside the boundary adapter.
using LanguageExt;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using static LanguageExt.Prelude;
namespace ParametricPortal.Kargadan.Plugin.src.boundary;

[BoundaryAdapter]
internal sealed class EventPublisher {
    private readonly Ref<Seq<EventEnvelope>> _queue = Ref(Seq<EventEnvelope>());
    public Unit Publish(EventEnvelope envelope) {
        _ = _queue.Swap(queue => queue.Add(envelope));
        return unit;
    }
    public Seq<EventEnvelope> Drain() =>
        atomic(() => {
            Seq<EventEnvelope> snapshot = _queue.Value;
            _ = _queue.Swap(static _ => Seq<EventEnvelope>());
            return snapshot;
        });
    public Unit Requeue(Seq<EventEnvelope> envelopes) {
        _ = _queue.Swap(queue => envelopes + queue);
        return unit;
    }
}
