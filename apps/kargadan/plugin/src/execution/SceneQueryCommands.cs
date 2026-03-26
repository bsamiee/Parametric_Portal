using System;
using System.Collections.Generic;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Text.Json;
using LanguageExt;
using LanguageExt.Common;
using ParametricPortal.Kargadan.Plugin.src.contracts;
using Rhino;
using Rhino.DocObjects;
using Rhino.Geometry;
using static LanguageExt.Prelude;

namespace ParametricPortal.Kargadan.Plugin.src.execution;

internal static class SceneQueryCommands {
    internal static Fin<JsonElement> ReadSceneSummary(
        RhinoDoc doc,
        CommandEnvelope _) {
        Layer? activeLayer = doc.Layers.CurrentLayer;
        BoundingBox worldBox = doc.Objects.BoundingBox;
        int annotationCount = checked(
            doc.Objects.GetObjectList(ObjectType.Annotation).Count()
            + doc.Objects.GetObjectList(ObjectType.TextDot).Count());
        return FinSucc(JsonSerializer.SerializeToElement(new {
            activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
            layerCount = doc.Layers.Count,
            objectCount = doc.Objects.Count,
            objectCountsByType = new Dictionary<string, int>(StringComparer.Ordinal) {
                [SceneObjectType.Point.Key] = doc.Objects.GetObjectList(ObjectType.Point).Count(),
                [SceneObjectType.Brep.Key] = doc.Objects.GetObjectList(ObjectType.Brep).Count(),
                [SceneObjectType.Mesh.Key] = doc.Objects.GetObjectList(ObjectType.Mesh).Count(),
                [SceneObjectType.Curve.Key] = doc.Objects.GetObjectList(ObjectType.Curve).Count(),
                [SceneObjectType.Surface.Key] = doc.Objects.GetObjectList(ObjectType.Surface).Count(),
                [SceneObjectType.Annotation.Key] = annotationCount,
                [SceneObjectType.Instance.Key] = doc.Objects.GetObjectList(ObjectType.InstanceReference).Count(),
                [SceneObjectType.LayoutDetail.Key] = doc.Objects.GetObjectList(ObjectType.Detail).Count(),
            },
            activeLayer = new {
                index = activeLayer?.Index ?? -1,
                name = activeLayer?.Name ?? string.Empty,
            },
            tolerances = new {
                unitSystem = doc.ModelUnitSystem.ToString(),
                absoluteTolerance = doc.ModelAbsoluteTolerance,
                angleToleranceRadians = doc.ModelAngleToleranceRadians,
            },
            worldBoundingBox = new {
                min = CommandExecutor.ProjectPointOrZero(worldBox, static b => b.Min),
                max = CommandExecutor.ProjectPointOrZero(worldBox, static b => b.Max),
            },
        }));
    }
    internal static Fin<JsonElement> ReadLayerState(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseListReadOptions(payload: envelope.Args).Map((ListReadOptions options) =>
            JsonSerializer.SerializeToElement(new {
                layers = doc.Layers
                    .Where(layer => options.IncludeHidden || layer.IsVisible)
                    .Take(options.Limit.IfNone(int.MaxValue))
                    .Select(static layer => new {
                        index = layer.Index,
                        isVisible = layer.IsVisible,
                        name = layer.Name,
                    })
                    .ToArray(),
            }));
    internal static Fin<JsonElement> ReadViewState(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseListReadOptions(payload: envelope.Args).Map((ListReadOptions options) =>
            JsonSerializer.SerializeToElement(new {
                activeView = doc.Views.ActiveView?.ActiveViewport.Name ?? string.Empty,
                viewports = doc.Views
                    .GetViewList(options.IncludeHidden switch {
                        true => (Rhino.Display.ViewTypeFilter)3,
                        _ => Rhino.Display.ViewTypeFilter.Model,
                    })
                    .Take(options.Limit.IfNone(int.MaxValue))
                    .Select(static view => view.ActiveViewport.Name)
                    .ToArray(),
            }));
    internal static Fin<JsonElement> ReadToleranceUnits(
        RhinoDoc doc,
        CommandEnvelope _) =>
        FinSucc(JsonSerializer.SerializeToElement(new {
            absoluteTolerance = doc.ModelAbsoluteTolerance,
            angleToleranceRadians = doc.ModelAngleToleranceRadians,
            unitSystem = doc.ModelUnitSystem.ToString(),
        }));
    internal static Fin<JsonElement> ReadViewCapture(
        RhinoDoc doc,
        CommandEnvelope envelope) =>
        CommandParsers.ParseViewCaptureOptions(payload: envelope.Args).Bind((ViewCaptureOptions options) =>
            Optional(doc.Views.ActiveView)
                .ToFin(Error.New(message: "No active view available for capture."))
                .Bind((Rhino.Display.RhinoView activeView) => {
                    Rhino.Display.ViewCapture capture = new() {
                        DrawAxes = false,
                        DrawGrid = false,
                        DrawGridAxes = false,
                        Height = options.Height,
                        RealtimeRenderPasses = options.RealtimePasses,
                        TransparentBackground = options.TransparentBackground,
                        Width = options.Width,
                    };
                    using System.Drawing.Bitmap? bitmap = capture.CaptureToBitmap(activeView);
                    return bitmap switch {
                        null => FinFail<JsonElement>(CommandParsers.CommandError(code: ErrorCode.UnexpectedRuntime, message: "Direct API operation 'ViewCapture.CaptureToBitmap' failed.")),
                        _ => FinSucc(SerializeCaptureBitmap(bitmap: bitmap, activeView: activeView, options: options)),
                    };
                }));
    private static JsonElement SerializeCaptureBitmap(
        System.Drawing.Bitmap bitmap,
        Rhino.Display.RhinoView activeView,
        ViewCaptureOptions options) {
        bitmap.SetResolution(xDpi: (float)options.Dpi, yDpi: (float)options.Dpi);
        using MemoryStream stream = new();
        bitmap.Save(stream: stream, format: ImageFormat.Png);
        byte[] pngBytes = stream.ToArray();
        return JsonSerializer.SerializeToElement(new {
            activeView = activeView.ActiveViewport.Name,
            byteLength = pngBytes.Length,
            dpi = options.Dpi,
            height = options.Height,
            imageBase64 = Convert.ToBase64String(pngBytes),
            mimeType = "image/png",
            realtimePasses = options.RealtimePasses,
            transparentBackground = options.TransparentBackground,
            width = options.Width,
        });
    }
}
