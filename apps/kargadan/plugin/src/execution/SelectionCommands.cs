using System;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.DocObjects;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal static class SelectionCommands {
    internal static Fin<JsonElement> HandleSelection(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseSelectionAction(envelope.Args).Bind((string action) =>
            action switch {
                "clear" => ApplySelection(doc: doc, objectIds: Seq<Guid>(), clearFirst: true, status: TextValues.SelectionCleared),
                "set" => CommandParsers.ParseGuidArray(envelope.Args, JsonFields.ObjectIds).Bind((Seq<Guid> ids) =>
                    ApplySelection(doc: doc, objectIds: ids, clearFirst: true, status: TextValues.SelectionSet)),
                "add" => CommandParsers.ParseGuidArray(envelope.Args, JsonFields.ObjectIds).Bind((Seq<Guid> ids) =>
                    ApplySelection(doc: doc, objectIds: ids, clearFirst: false, status: TextValues.SelectionAdded)),
                _ => FinFail<JsonElement>(Error.New($"{JsonFields.Action} must be: set|add|clear.")),
            });
    private static Fin<JsonElement> ApplySelection(
        RhinoDoc doc,
        Seq<Guid> objectIds,
        bool clearFirst,
        string status) {
        int cleared = clearFirst ? doc.Objects.UnselectAll() : 0;
        int selected = objectIds.Fold(0, (int count, Guid id) =>
            Optional(doc.Objects.FindId(id))
                .Match(
                    Some: (RhinoObject found) => count + (found.Select(on: true) > 0 ? 1 : 0),
                    None: () => count));
        doc.Views.Redraw();
        return FinSucc(JsonSerializer.SerializeToElement(new { status, selected, cleared }));
    }
}
