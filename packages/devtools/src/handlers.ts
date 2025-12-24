/**
 * Install global error/rejection handlers with Effect logging and cleanup.
 */
import { Effect, type Layer, pipe } from 'effect';
import { toError } from './types.ts';

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

const B = Object.freeze({
    messages: {
        globalError: 'Global error',
        unhandledRejection: 'Unhandled rejection',
    },
    phases: {
        global: 'global',
        rejection: 'unhandled-rejection',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const installGlobalHandlers = (config: HandlersConfig): HandlersResult => {
    const originalOnError = globalThis.onerror;
    const originalOnUnhandled = globalThis.onunhandledrejection;
    globalThis.onerror = (message, source, lineno, colno, error): boolean => {
        // Non-blocking: fork Effect instead of runSync to prevent main thread blocking
        Effect.runFork(
            pipe(
                Effect.logError(`${B.messages.globalError}: ${String(message)}`, { colno, lineno, source }),
                Effect.provide(config.loggerLayer),
            ),
        );
        error && config.onError(error, { colno, lineno, phase: B.phases.global, source });
        return false;
    };
    globalThis.onunhandledrejection = (event: PromiseRejectionEvent): void => {
        const reason = toError(event.reason);
        // Non-blocking: fork Effect instead of runSync to prevent main thread blocking
        Effect.runFork(
            pipe(
                Effect.logError(`${B.messages.unhandledRejection}: ${reason.message}`, { reason }),
                Effect.provide(config.loggerLayer),
            ),
        );
        config.onError(reason, { phase: B.phases.rejection });
    };
    return {
        uninstall: (): void => {
            globalThis.onerror = originalOnError;
            globalThis.onunhandledrejection = originalOnUnhandled;
        },
    };
};

// --- [EXPORT] ----------------------------------------------------------------

export type { ErrorCallback, HandlersConfig, HandlersResult };
export { B as HANDLERS_TUNING, installGlobalHandlers };
