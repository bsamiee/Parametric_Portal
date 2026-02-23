// Channel-based event observation pipeline: subscribes to 15 RhinoDoc events + Command.UndoRedo,
// aggregates into batched summaries via 200ms debounce timer, and flushes through caller-provided callback.
// Lifecycle is Start/Stop/Dispose — managed by KargadanPlugin.OnLoad/OnShutdown.
using System;
using System.Collections.Generic;
using System.Threading.Channels;
using LanguageExt;
using NodaTime;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using Rhino.DocObjects.Tables;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.observation;

// --- [TYPES] -----------------------------------------------------------------

internal delegate void EventBatchFlushed(EventBatchSummary batch, Instant flushedAt);

// --- [CONSTANTS] -------------------------------------------------------------

// why: CA1812 false positive -- instantiated by KargadanPlugin.OnLoad in boundary layer
#pragma warning disable CA1812
internal sealed class ObservationPipeline : IDisposable {
#pragma warning restore CA1812
    private const int ChannelCapacity = 256;
    private const int DebounceWindowMs = 200;
    private static readonly BoundedChannelOptions ChannelOptions = new(ChannelCapacity) {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleWriter = false,
        SingleReader = true,
    };

    // --- [STATE] -------------------------------------------------------------
    private readonly Channel<RawDocEvent> _channel = Channel.CreateBounded<RawDocEvent>(ChannelOptions);
    private readonly System.Timers.Timer _debounceTimer = new(interval: DebounceWindowMs) { AutoReset = true };
    private readonly EventBatchFlushed _onBatchFlushed;
    private readonly TimeProvider _timeProvider;
    private bool _disposed;

    // --- [LIFECYCLE] ---------------------------------------------------------
    internal ObservationPipeline(EventBatchFlushed onBatchFlushed, TimeProvider timeProvider) {
        _onBatchFlushed = onBatchFlushed;
        _timeProvider = timeProvider;
    }
    internal void Start() {
        Subscribe();
        Command.UndoRedo += OnUndoRedo;
        _debounceTimer.Elapsed += OnDebounceTimerElapsed;
        _debounceTimer.Start();
    }
    internal void Stop() {
        _debounceTimer.Stop();
        _debounceTimer.Elapsed -= OnDebounceTimerElapsed;
        Command.UndoRedo -= OnUndoRedo;
        Unsubscribe();
        _ = _channel.Writer.TryComplete();
    }
    public void Dispose() {
        _ = _disposed switch {
            true => unit,
            false => DisposeCore(),
        };
    }
    private Unit DisposeCore() {
        _disposed = true;
        Stop();
        _debounceTimer.Dispose();
        return unit;
    }

    // --- [SUBSCRIPTION] ------------------------------------------------------

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void Subscribe() {
        // Object events (5)
        RhinoDoc.AddRhinoObject += OnAddObject;
        RhinoDoc.DeleteRhinoObject += OnDeleteObject;
        RhinoDoc.UndeleteRhinoObject += OnUndeleteObject;
        RhinoDoc.ReplaceRhinoObject += OnReplaceObject;
        RhinoDoc.ModifyObjectAttributes += OnModifyAttributes;
        // Selection events (3)
        RhinoDoc.SelectObjects += OnSelectObjects;
        RhinoDoc.DeselectObjects += OnDeselectObjects;
        RhinoDoc.DeselectAllObjects += OnDeselectAll;
        // Table events (6)
        RhinoDoc.LayerTableEvent += OnLayerTable;
        RhinoDoc.MaterialTableEvent += OnMaterialTable;
        RhinoDoc.DimensionStyleTableEvent += OnDimensionStyleTable;
        RhinoDoc.InstanceDefinitionTableEvent += OnInstanceDefinitionTable;
        RhinoDoc.LightTableEvent += OnLightTable;
        RhinoDoc.GroupTableEvent += OnGroupTable;
        // Document events (1)
        RhinoDoc.DocumentPropertiesChanged += OnDocPropertiesChanged;
    }

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void Unsubscribe() {
        RhinoDoc.AddRhinoObject -= OnAddObject;
        RhinoDoc.DeleteRhinoObject -= OnDeleteObject;
        RhinoDoc.UndeleteRhinoObject -= OnUndeleteObject;
        RhinoDoc.ReplaceRhinoObject -= OnReplaceObject;
        RhinoDoc.ModifyObjectAttributes -= OnModifyAttributes;
        RhinoDoc.SelectObjects -= OnSelectObjects;
        RhinoDoc.DeselectObjects -= OnDeselectObjects;
        RhinoDoc.DeselectAllObjects -= OnDeselectAll;
        RhinoDoc.LayerTableEvent -= OnLayerTable;
        RhinoDoc.MaterialTableEvent -= OnMaterialTable;
        RhinoDoc.DimensionStyleTableEvent -= OnDimensionStyleTable;
        RhinoDoc.InstanceDefinitionTableEvent -= OnInstanceDefinitionTable;
        RhinoDoc.LightTableEvent -= OnLightTable;
        RhinoDoc.GroupTableEvent -= OnGroupTable;
        RhinoDoc.DocumentPropertiesChanged -= OnDocPropertiesChanged;
    }

    // --- Event handlers: fast channel writes, no blocking on UI thread -------

    // why: RhinoObjectEventArgs does not expose Document property -- use RhinoDoc.ActiveDoc for UndoActive/RedoActive
    private static bool IsUndoRedoActive() =>
        RhinoDoc.ActiveDoc is { } doc && (doc.UndoActive || doc.RedoActive);

    private void OnAddObject(object? sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            Subtype: EventSubtype.Added,
            ObjectId: Some(e.ObjectId),
            OldObjectId: None,
            ObjectType: Some(e.TheObject.ObjectType.ToString()),
            IsUndoRedo: IsUndoRedoActive()));

    private void OnDeleteObject(object? sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            Subtype: EventSubtype.Deleted,
            ObjectId: Some(e.ObjectId),
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: IsUndoRedoActive()));

    private void OnUndeleteObject(object? sender, RhinoObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            Subtype: EventSubtype.Undeleted,
            ObjectId: Some(e.ObjectId),
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: IsUndoRedoActive()));

    private void OnReplaceObject(object? sender, RhinoReplaceObjectEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            Subtype: EventSubtype.Replaced,
            ObjectId: Some(e.ObjectId),
            OldObjectId: Some(e.OldRhinoObject.Id),
            ObjectType: None,
            IsUndoRedo: e.Document is { } doc && (doc.UndoActive || doc.RedoActive)));

    private void OnModifyAttributes(object? sender, RhinoModifyObjectAttributesEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.ObjectsChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: Some(e.RhinoObject.Id),
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: e.Document is { } doc && (doc.UndoActive || doc.RedoActive)));

    private void OnSelectObjects(object? sender, RhinoObjectSelectionEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.SelectionChanged,
            Subtype: EventSubtype.Selected,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnDeselectObjects(object? sender, RhinoObjectSelectionEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.SelectionChanged,
            Subtype: EventSubtype.Deselected,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnDeselectAll(object? sender, RhinoDeselectAllObjectsEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.SelectionChanged,
            Subtype: EventSubtype.DeselectAll,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnLayerTable(object? sender, LayerTableEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.LayersChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnMaterialTable(object? sender, MaterialTableEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.MaterialChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnDimensionStyleTable(object? sender, EventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.TablesChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnInstanceDefinitionTable(object? sender, InstanceDefinitionTableEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.TablesChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnLightTable(object? sender, LightTableEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.TablesChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnGroupTable(object? sender, GroupTableEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.TablesChanged,
            Subtype: EventSubtype.Modified,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    private void OnDocPropertiesChanged(object? sender, DocumentEventArgs e) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: EventType.PropertiesChanged,
            Subtype: EventSubtype.PropertiesChanged,
            ObjectId: None,
            OldObjectId: None,
            ObjectType: None,
            IsUndoRedo: false));

    // --- [AGGREGATION] -------------------------------------------------------

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void OnDebounceTimerElapsed(object? sender, System.Timers.ElapsedEventArgs e) {
        Seq<RawDocEvent> pending = DrainChannel();
        _ = (pending.Count > 0) switch {
            false => unit,
            true => FlushBatch(pending: pending),
        };
    }

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private Seq<RawDocEvent> DrainChannel() {
        Seq<RawDocEvent> events = Seq<RawDocEvent>();
        while (_channel.Reader.TryRead(out RawDocEvent raw)) {
            events = events.Add(raw);
        }
        return events;
    }

    private Unit FlushBatch(Seq<RawDocEvent> pending) {
        Seq<CategoryCount> categories = toSeq(
            pending
                .GroupBy(static raw => raw.Type.Key, StringComparer.Ordinal)
                .Select(static group => {
                    Seq<SubtypeCount> subtypes = toSeq(
                        group
                            .GroupBy(static raw => raw.Subtype.Key, StringComparer.Ordinal)
                            .Select(static sub => new SubtypeCount(
                                Subtype: EventSubtype.Get(sub.Key),
                                Count: sub.Count())));
                    return new CategoryCount(
                        Category: EventType.Get(group.Key),
                        Count: group.Count(),
                        Subtypes: subtypes);
                }));
        EventBatchSummary batch = new(
            TotalCount: pending.Count,
            Categories: categories,
            ContainsUndoRedo: pending.Any(static raw => raw.IsUndoRedo),
            BatchWindowMs: DebounceWindowMs);
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _onBatchFlushed(batch: batch, flushedAt: now);
        return unit;
    }

    // --- [UNDO] --------------------------------------------------------------

    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void OnUndoRedo(object? sender, UndoRedoEventArgs e) =>
        _ = (e.IsEndUndo, e.IsEndRedo) switch {
            (true, _) => _channel.Writer.TryWrite(new RawDocEvent(
                Type: EventType.UndoRedo,
                Subtype: EventSubtype.Modified,
                ObjectId: None,
                OldObjectId: None,
                ObjectType: Some("undo"),
                IsUndoRedo: true)),
            (_, true) => _channel.Writer.TryWrite(new RawDocEvent(
                Type: EventType.UndoRedo,
                Subtype: EventSubtype.Modified,
                ObjectId: None,
                OldObjectId: None,
                ObjectType: Some("redo"),
                IsUndoRedo: true)),
            _ => true,
        };
}
