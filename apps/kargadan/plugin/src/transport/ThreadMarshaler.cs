// Dispatches operations to Rhino's UI thread via RhinoApp.InvokeOnUiThread; bridges async WebSocket receive loop to main thread via TaskCompletionSource.
// macOS AppKit enforces main-thread-only access to RhinoDoc — calling from background thread causes NSInternalInconsistencyException.
using System;
using System.Threading.Tasks;
using LanguageExt;
using Rhino;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [FUNCTIONS] -------------------------------------------------------------

internal static class ThreadMarshaler {
    internal static Task<Fin<T>> RunOnUiThreadAsync<T>(Func<Fin<T>> operation) {
        TaskCompletionSource<Fin<T>> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        RhinoApp.InvokeOnUiThread(new Action(() => {
            Fin<T> result = operation();
            _ = tcs.TrySetResult(result);
        }));
        return tcs.Task;
    }
}
