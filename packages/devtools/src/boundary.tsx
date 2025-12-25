/**
 * Integrate React ErrorBoundary with Effect logging for React 19 root error handling.
 */
import { Effect, type Layer, pipe } from 'effect';
import type { ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { DEVTOOLS_TUNING, toError } from './types.ts';

// --- [TYPES] -----------------------------------------------------------------

type ErrorCallback = (error: Error, context: Readonly<Record<string, unknown>>) => void;
type RootErrorConfig = {
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly onError: ErrorCallback;
};
type RootOptions = {
    readonly onCaughtError: (error: unknown, errorInfo: unknown) => void;
    readonly onRecoverableError: (error: unknown, errorInfo: unknown) => void;
    readonly onUncaughtError: (error: unknown, errorInfo: unknown) => void;
};
type EffectErrorBoundaryProps = {
    readonly children: ReactNode;
    readonly fallback?: ReactNode;
    readonly loggerLayer: Layer.Layer<never, never, never>;
    readonly onError: ErrorCallback;
};

// --- [CONSTANTS] -------------------------------------------------------------

const T = DEVTOOLS_TUNING.boundary;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

type LogMethod = 'logError' | 'logFatal' | 'logInfo' | 'logWarning';
const dispatchLog = (method: LogMethod, msg: string, ctx: Record<string, unknown>, layer: Layer.Layer<never>): void => {
    Effect.runFork(pipe(Effect[method](msg, ctx), Effect.provide(layer)));
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createRootErrorOptions = (config: RootErrorConfig): RootOptions => ({
    onCaughtError: (error, errorInfo) =>
        dispatchLog('logError', T.messages.reactCaught, { error: toError(error), errorInfo }, config.loggerLayer),
    onRecoverableError: (error, errorInfo) =>
        dispatchLog(
            'logWarning',
            T.messages.reactRecoverable,
            { error: toError(error), errorInfo },
            config.loggerLayer,
        ),
    onUncaughtError: (error, errorInfo) => {
        dispatchLog('logFatal', T.messages.reactUncaught, { error: toError(error), errorInfo }, config.loggerLayer);
        config.onError(toError(error), { errorInfo, phase: T.phases.uncaught });
    },
});
const EffectErrorBoundary = ({ children, fallback, loggerLayer, onError }: EffectErrorBoundaryProps): ReactNode => (
    <ErrorBoundary
        fallback={fallback ?? <div>{T.fallbackText}</div>}
        onError={(error, info) => {
            dispatchLog('logError', T.messages.boundaryCaught, { error, info }, loggerLayer);
            onError(error, { info, phase: T.phases.boundary });
        }}
    >
        {children}
    </ErrorBoundary>
);

// --- [EXPORT] ----------------------------------------------------------------

export type { EffectErrorBoundaryProps, ErrorCallback, RootErrorConfig, RootOptions };
export { createRootErrorOptions, EffectErrorBoundary };
