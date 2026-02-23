// Dispatches operations to Rhino's UI thread via RhinoApp.InvokeOnUiThread; bridges async WebSocket receive loop to main thread via TaskCompletionSource.
// macOS AppKit enforces main-thread-only access to RhinoDoc — calling from background thread causes NSInternalInconsistencyException.
using System;
using System.Threading;
using System.Threading.Tasks;
using LanguageExt;
using ParametricPortal.CSharp.Analyzers.Contracts;
using Rhino;

namespace ParametricPortal.Kargadan.Plugin.src.transport;

// --- [ADAPTER] ---------------------------------------------------------------

[BoundaryAdapter]
internal static class ThreadMarshaler {
    // --- [FUNCTIONS] ---------------------------------------------------------
    internal static Task<Fin<T>> RunOnUiThreadAsync<T>(Func<Fin<T>> operation) {
        TaskCompletionSource<Fin<T>> tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        RhinoApp.InvokeOnUiThread(new Action(() => {
            Task<Fin<T>> operationTask = new(operation);
            operationTask.RunSynchronously();
            _ = operationTask.Status switch {
                TaskStatus.RanToCompletion => tcs.TrySetResult(operationTask.Result),
                TaskStatus.Faulted when operationTask.Exception is not null =>
                    tcs.TrySetException(operationTask.Exception.InnerExceptions),
                TaskStatus.Canceled => tcs.TrySetCanceled(CancellationToken.None),
                _ => tcs.TrySetCanceled(CancellationToken.None),
            };
        }));
        return tcs.Task;
    }
}
