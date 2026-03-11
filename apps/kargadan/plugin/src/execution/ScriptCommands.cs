using System;
using System.Linq;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.CSharp.Analyzers.Contracts;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.Commands;
using Rhino.DocObjects;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal static class ScriptCommands {
    private static readonly Error ScriptNotExecuted =
        CommandParsers.CommandError(code: ErrorCode.UnexpectedRuntime, message: "Rhino did not execute the script.");
    internal static Fin<JsonElement> ExecuteScriptOperation(
        RhinoDoc doc,
        CommandEnvelope envelope) {
        JsonElement payload = envelope.Payload;
        string script = payload.TryGetProperty(JsonFields.Script, out JsonElement scriptElement) switch {
            true when scriptElement.ValueKind == JsonValueKind.String =>
                (scriptElement.GetString() ?? string.Empty).Trim(),
            _ => string.Empty,
        };
        return script.Length switch {
            0 => FinFail<JsonElement>(
                Error.New(message: $"Payload '{JsonFields.Script}' property must be a non-empty string.")),
            _ => ExecuteScript(
                doc: doc,
                commandScript: script,
                echo: true)
                .Map((ScriptResult scriptResult) =>
                    JsonSerializer.SerializeToElement(value: scriptResult, options: CommandExecutor.CamelCaseOptions)),
        };
    }
    [BoundaryImperativeExemption(
        ruleId: "CSP0001",
        reason: BoundaryImperativeReason.ProtocolRequired,
        ticket: "EXEC-01",
        expiresOnUtc: "2026-08-22")]
    internal static Fin<ScriptResult> ExecuteScript(
        RhinoDoc doc,
        string commandScript,
        bool echo) {
        Option<CommandEventArgs> captured = None;
        void OnEndCommand(object? sender, CommandEventArgs args) =>
            captured = Some(args);
        Command.EndCommand += OnEndCommand;
        uint serialBefore = RhinoObject.NextRuntimeSerialNumber;
        int sceneCountBefore = doc.Objects.Count;
        System.Collections.Generic.HashSet<Guid> selectionBefore =
            [..doc.Objects.GetSelectedObjects(includeLights: false, includeGrips: false)
                .Select(static (RhinoObject rhinoObject) => rhinoObject.Id)];
        bool ran;
        try {
            ran = RhinoApp.RunScript(script: commandScript, echo: echo);
        } finally {
            Command.EndCommand -= OnEndCommand;
        }
        RhinoObject[]? objectsSince = doc.Objects.AllObjectsSince(runtimeSerialNumber: serialBefore);
        int objectsCreatedCount = objectsSince?.Length ?? 0;
        Seq<CreatedObject> objectsCreated = toSeq(objectsSince ?? [])
            .Map(static (RhinoObject rhinoObject) => new CreatedObject(
                ObjectId: rhinoObject.Id,
                ObjectType: rhinoObject.ObjectType.ToString()));
        int sceneCountAfter = doc.Objects.Count;
        System.Collections.Generic.HashSet<Guid> selectionAfter =
            [..doc.Objects.GetSelectedObjects(includeLights: false, includeGrips: false)
                .Select(static (RhinoObject rhinoObject) => rhinoObject.Id)];
        bool selectionChanged = !selectionBefore.SetEquals(other: selectionAfter);
        return ran switch {
            false => FinFail<ScriptResult>(ScriptNotExecuted),
            true => captured
                .ToFin(Error.New(message: "RunScript completed without Command.EndCommand result."))
                .Bind((CommandEventArgs commandArgs) =>
                    commandArgs.CommandResult switch {
                        Result.Success => SceneObjectDelta.Create(
                            before: sceneCountBefore,
                            after: sceneCountAfter).Match(
                                Succ: (SceneObjectDelta delta) => ScriptResult.Create(
                                    commandName: commandArgs.CommandEnglishName,
                                    commandResult: (int)commandArgs.CommandResult,
                                    objectsCreatedCount: objectsCreatedCount,
                                    objectsCreated: objectsCreated,
                                    sceneObjectDelta: delta,
                                    selectionChanged: selectionChanged).Match(
                                        Succ: FinSucc,
                                        Fail: static (Seq<Error> errors) => FinFail<ScriptResult>(
                                            errors.HeadOrNone().IfNone(
                                                Error.New(message: "Script result validation failed.")))),
                                Fail: static (Seq<Error> errors) => FinFail<ScriptResult>(
                                    errors.HeadOrNone().IfNone(
                                        Error.New(message: "Scene object delta validation failed.")))),
                        Result.Cancel => FinFail<ScriptResult>(
                            CommandParsers.CommandError(code: ErrorCode.TransientIo, message: $"Command '{commandArgs.CommandEnglishName}' was cancelled.")),
                        _ => FinFail<ScriptResult>(
                            Error.New(message: $"Command '{commandArgs.CommandEnglishName}' failed: {commandArgs.CommandResult}")),
                    }),
        };
    }
}
