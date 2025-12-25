/**
 * Install global error/rejection handlers with Effect logging and cleanup.
 */
import { Effect, type Layer, pipe } from 'effect';
import { DEVTOOLS_TUNING, toError } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ErrorCallback = (error: Error, context: Readonly<Record<string, unknown>>) => void;
type HandlersConfig = {
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly onError: ErrorCallback;
};
type HandlersResult = {
    readonly uninstall: () => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING.handlers;

// --- [ENTRY_POINT] -----------------------------------------------------------

const installGlobalHandlers = (config: HandlersConfig): HandlersResult => {
    const originalOnError = globalThis.onerror;
    const originalOnUnhandled = globalThis.onunhandledrejection;
    globalThis.onerror = (message, source, lineno, colno, error): boolean => {
        Effect.runFork(
            pipe(
                Effect.logError(`${T.messages.globalError}: ${String(message)}`, { colno, lineno, source }),
                Effect.provide(config.loggerLayer),
            ),
        );
        error && config.onError(error, { colno, lineno, phase: T.phases.global, source });
        return false;
    };
    globalThis.onunhandledrejection = (event: PromiseRejectionEvent): void => {
        const reason = toError(event.reason);
        Effect.runFork(
            pipe(
                Effect.logError(`${T.messages.unhandledRejection}: ${reason.message}`, { reason }),
                Effect.provide(config.loggerLayer),
            ),
        );
        config.onError(reason, { phase: T.phases.rejection });
    };
    return Object.freeze({
        uninstall: (): void => {
            globalThis.onerror = originalOnError;
            globalThis.onunhandledrejection = originalOnUnhandled;
        },
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ErrorCallback, HandlersConfig, HandlersResult };
export { installGlobalHandlers };
