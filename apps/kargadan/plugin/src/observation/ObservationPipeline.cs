using System;
using System.Collections.Generic;
using System.Linq;
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

internal delegate void EventBatchFlushed(EventBatchSummary batch, Instant flushedAt);
public sealed class ObservationPipeline : IDisposable {
    private const int ChannelCapacity = 256;
    private const int DebounceWindowMs = 200;
    private readonly record struct RhinoSubscription(
        Action<ObservationPipeline> Attach,
        Action<ObservationPipeline> Detach);
    private static readonly BoundedChannelOptions ChannelOptions = new(ChannelCapacity) {
        FullMode = BoundedChannelFullMode.DropOldest,
        SingleWriter = false,
        SingleReader = true,
    };
    private static readonly Seq<RhinoSubscription> RhinoSubscriptions = Seq<RhinoSubscription>(
        new(
            Attach: static pipeline => RhinoDoc.AddRhinoObject += pipeline.OnAddObject,
            Detach: static pipeline => RhinoDoc.AddRhinoObject -= pipeline.OnAddObject),
        new(
            Attach: static pipeline => RhinoDoc.DeleteRhinoObject += pipeline.OnDeleteObject,
            Detach: static pipeline => RhinoDoc.DeleteRhinoObject -= pipeline.OnDeleteObject),
        new(
            Attach: static pipeline => RhinoDoc.UndeleteRhinoObject += pipeline.OnUndeleteObject,
            Detach: static pipeline => RhinoDoc.UndeleteRhinoObject -= pipeline.OnUndeleteObject),
        new(
            Attach: static pipeline => RhinoDoc.ReplaceRhinoObject += pipeline.OnReplaceObject,
            Detach: static pipeline => RhinoDoc.ReplaceRhinoObject -= pipeline.OnReplaceObject),
        new(
            Attach: static pipeline => RhinoDoc.ModifyObjectAttributes += pipeline.OnModifyAttributes,
            Detach: static pipeline => RhinoDoc.ModifyObjectAttributes -= pipeline.OnModifyAttributes),
        new(
            Attach: static pipeline => RhinoDoc.SelectObjects += pipeline.OnSelectObjects,
            Detach: static pipeline => RhinoDoc.SelectObjects -= pipeline.OnSelectObjects),
        new(
            Attach: static pipeline => RhinoDoc.DeselectObjects += pipeline.OnDeselectObjects,
            Detach: static pipeline => RhinoDoc.DeselectObjects -= pipeline.OnDeselectObjects),
        new(
            Attach: static pipeline => RhinoDoc.DeselectAllObjects += pipeline.OnDeselectAll,
            Detach: static pipeline => RhinoDoc.DeselectAllObjects -= pipeline.OnDeselectAll),
        new(
            Attach: static pipeline => RhinoDoc.LayerTableEvent += pipeline.OnLayerTable,
            Detach: static pipeline => RhinoDoc.LayerTableEvent -= pipeline.OnLayerTable),
        new(
            Attach: static pipeline => RhinoDoc.MaterialTableEvent += pipeline.OnMaterialTable,
            Detach: static pipeline => RhinoDoc.MaterialTableEvent -= pipeline.OnMaterialTable),
        new(
            Attach: static pipeline => RhinoDoc.DimensionStyleTableEvent += pipeline.OnDimensionStyleTable,
            Detach: static pipeline => RhinoDoc.DimensionStyleTableEvent -= pipeline.OnDimensionStyleTable),
        new(
            Attach: static pipeline => RhinoDoc.InstanceDefinitionTableEvent += pipeline.OnInstanceDefinitionTable,
            Detach: static pipeline => RhinoDoc.InstanceDefinitionTableEvent -= pipeline.OnInstanceDefinitionTable),
        new(
            Attach: static pipeline => RhinoDoc.LightTableEvent += pipeline.OnLightTable,
            Detach: static pipeline => RhinoDoc.LightTableEvent -= pipeline.OnLightTable),
        new(
            Attach: static pipeline => RhinoDoc.GroupTableEvent += pipeline.OnGroupTable,
            Detach: static pipeline => RhinoDoc.GroupTableEvent -= pipeline.OnGroupTable),
        new(
            Attach: static pipeline => RhinoDoc.DocumentPropertiesChanged += pipeline.OnDocPropertiesChanged,
            Detach: static pipeline => RhinoDoc.DocumentPropertiesChanged -= pipeline.OnDocPropertiesChanged));
    private readonly Channel<RawDocEvent> _channel = Channel.CreateBounded<RawDocEvent>(ChannelOptions);
    private readonly System.Timers.Timer _debounceTimer = new(interval: DebounceWindowMs) { AutoReset = false };
    private readonly EventBatchFlushed _onBatchFlushed;
    private readonly TimeProvider _timeProvider;
    private bool _disposed;
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
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void Subscribe() =>
        RhinoSubscriptions.Iter(subscription => subscription.Attach(this));
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void Unsubscribe() =>
        RhinoSubscriptions.Iter(subscription => subscription.Detach(this));
    private static bool IsUndoRedoActive() =>
        IsUndoRedoActive(RhinoDoc.ActiveDoc);
    private static bool IsUndoRedoActive(RhinoDoc? doc) =>
        doc is { } current && (current.UndoActive || current.RedoActive);
    private void Emit(
        EventType type,
        EventSubtype subtype,
        Option<Guid> objectId,
        Option<Guid> oldObjectId,
        Option<string> objectType,
        bool isUndoRedo) =>
        _ = _channel.Writer.TryWrite(new RawDocEvent(
            Type: type,
            Subtype: subtype,
            ObjectId: objectId,
            OldObjectId: oldObjectId,
            ObjectType: objectType,
            IsUndoRedo: isUndoRedo));
    private void EmitObjectChange(
        EventSubtype subtype,
        Guid objectId,
        Option<Guid> oldObjectId,
        Option<string> objectType,
        bool isUndoRedo) =>
        Emit(
            type: EventType.ObjectsChanged,
            subtype: subtype,
            objectId: Some(objectId),
            oldObjectId: oldObjectId,
            objectType: objectType,
            isUndoRedo: isUndoRedo);
    private void EmitSimple(
        EventType type,
        EventSubtype subtype) =>
        Emit(
            type: type,
            subtype: subtype,
            objectId: None,
            oldObjectId: None,
            objectType: None,
            isUndoRedo: false);
    private Unit EmitUndoRedoMarker(string marker) {
        Emit(
            type: EventType.UndoRedo,
            subtype: EventSubtype.Modified,
            objectId: None,
            oldObjectId: None,
            objectType: Some(marker),
            isUndoRedo: true);
        return unit;
    }
    private void OnAddObject(object? sender, RhinoObjectEventArgs e) => EmitObjectChange(subtype: EventSubtype.Added, objectId: e.ObjectId, oldObjectId: None, objectType: Some(e.TheObject.ObjectType.ToString()), isUndoRedo: IsUndoRedoActive());
    private void OnDeleteObject(object? sender, RhinoObjectEventArgs e) => EmitObjectChange(subtype: EventSubtype.Deleted, objectId: e.ObjectId, oldObjectId: None, objectType: None, isUndoRedo: IsUndoRedoActive());
    private void OnUndeleteObject(object? sender, RhinoObjectEventArgs e) => EmitObjectChange(subtype: EventSubtype.Undeleted, objectId: e.ObjectId, oldObjectId: None, objectType: None, isUndoRedo: IsUndoRedoActive());
    private void OnReplaceObject(object? sender, RhinoReplaceObjectEventArgs e) => EmitObjectChange(subtype: EventSubtype.Replaced, objectId: e.ObjectId, oldObjectId: Some(e.OldRhinoObject.Id), objectType: None, isUndoRedo: IsUndoRedoActive(e.Document));
    private void OnModifyAttributes(object? sender, RhinoModifyObjectAttributesEventArgs e) => EmitObjectChange(subtype: EventSubtype.Modified, objectId: e.RhinoObject.Id, oldObjectId: None, objectType: None, isUndoRedo: IsUndoRedoActive(e.Document));
    private void OnSelectObjects(object? sender, RhinoObjectSelectionEventArgs e) => EmitSimple(type: EventType.SelectionChanged, subtype: EventSubtype.Selected);
    private void OnDeselectObjects(object? sender, RhinoObjectSelectionEventArgs e) => EmitSimple(type: EventType.SelectionChanged, subtype: EventSubtype.Deselected);
    private void OnDeselectAll(object? sender, RhinoDeselectAllObjectsEventArgs e) => EmitSimple(type: EventType.SelectionChanged, subtype: EventSubtype.DeselectAll);
    private void OnLayerTable(object? sender, LayerTableEventArgs e) => EmitSimple(type: EventType.LayersChanged, subtype: EventSubtype.Modified);
    private void OnMaterialTable(object? sender, MaterialTableEventArgs e) => EmitSimple(type: EventType.MaterialChanged, subtype: EventSubtype.Modified);
    private void OnDimensionStyleTable(object? sender, EventArgs e) => EmitSimple(type: EventType.TablesChanged, subtype: EventSubtype.Modified);
    private void OnInstanceDefinitionTable(object? sender, InstanceDefinitionTableEventArgs e) => EmitSimple(type: EventType.TablesChanged, subtype: EventSubtype.Modified);
    private void OnLightTable(object? sender, LightTableEventArgs e) => EmitSimple(type: EventType.TablesChanged, subtype: EventSubtype.Modified);
    private void OnGroupTable(object? sender, GroupTableEventArgs e) => EmitSimple(type: EventType.TablesChanged, subtype: EventSubtype.Modified);
    private void OnDocPropertiesChanged(object? sender, DocumentEventArgs e) => EmitSimple(type: EventType.PropertiesChanged, subtype: EventSubtype.PropertiesChanged);
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void OnDebounceTimerElapsed(object? sender, System.Timers.ElapsedEventArgs e) {
        Dictionary<string, Dictionary<string, int>> categorySubtypeCounts = [];
        int totalCount = 0;
        bool containsUndoRedo = false;
        while (_channel.Reader.TryRead(out RawDocEvent raw)) {
            totalCount += 1;
            containsUndoRedo = containsUndoRedo || raw.IsUndoRedo;
            _ = categorySubtypeCounts.TryGetValue(raw.Type.Key, out Dictionary<string, int>? subtypeCounts);
            subtypeCounts ??= [];
            _ = categorySubtypeCounts.TryAdd(raw.Type.Key, subtypeCounts);
            int nextCount = subtypeCounts.TryGetValue(raw.Subtype.Key, out int count) switch {
                true => count + 1,
                _ => 1,
            };
            subtypeCounts[raw.Subtype.Key] = nextCount;
        }
        _ = totalCount switch {
            0 => unit,
            _ => FlushBatch(categorySubtypeCounts, totalCount, containsUndoRedo),
        };
        _debounceTimer.Start();
    }
    private Unit FlushBatch(
        Dictionary<string, Dictionary<string, int>> categorySubtypeCounts,
        int totalCount,
        bool containsUndoRedo) {
        Instant now = Instant.FromDateTimeOffset(_timeProvider.GetUtcNow());
        _onBatchFlushed(new EventBatchSummary(
                TotalCount: totalCount,
                Categories: toSeq(categorySubtypeCounts.Select(category => new CategoryCount(
                    Category: EventType.Get(category.Key),
                    Count: category.Value.Values.Sum(),
                    Subtypes: toSeq(category.Value.Select(subtype => new SubtypeCount(
                        Subtype: EventSubtype.Get(subtype.Key),
                        Count: subtype.Value)))))),
                ContainsUndoRedo: containsUndoRedo,
                BatchWindowMs: DebounceWindowMs),
            now);
        return unit;
    }
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-03",
        expiresOnUtc: "2026-08-22")]
    private void OnUndoRedo(object? sender, UndoRedoEventArgs e) =>
        _ = (e.IsEndUndo, e.IsEndRedo) switch {
            (true, _) => EmitUndoRedoMarker(marker: "undo"),
            (_, true) => EmitUndoRedoMarker(marker: "redo"),
            _ => unit,
        };
}
