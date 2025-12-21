/**
 * Integrate React ErrorBoundary with Effect logging for React 19 root error handling.
 */
import { Effect, type Layer, pipe } from 'effect';
import type { ReactNode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { toError } from './types.ts';

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

const B = Object.freeze({
    fallback: { text: 'Something went wrong' },
    messages: {
        boundaryCaught: 'Error boundary caught',
        reactCaught: 'React caught error',
        reactRecoverable: 'React recoverable error',
        reactUncaught: 'React uncaught error',
    },
    phases: {
        boundary: 'error-boundary',
        caught: 'react-caught',
        recoverable: 'react-recoverable',
        uncaught: 'react-uncaught',
    },
} as const);

// --- [ENTRY_POINT] -----------------------------------------------------------

const createRootErrorOptions = (config: RootErrorConfig): RootOptions => ({
    onCaughtError: (error, errorInfo) => {
        // Non-blocking: fork Effect to prevent async fiber issues with devtools layer
        Effect.runFork(
            pipe(
                Effect.logError(B.messages.reactCaught, { error: toError(error), errorInfo }),
                Effect.provide(config.loggerLayer),
            ),
        );
    },
    onRecoverableError: (error, errorInfo) => {
        // Non-blocking: fork Effect to prevent async fiber issues with devtools layer
        Effect.runFork(
            pipe(
                Effect.logWarning(B.messages.reactRecoverable, { error: toError(error), errorInfo }),
                Effect.provide(config.loggerLayer),
            ),
        );
    },
    onUncaughtError: (error, errorInfo) => {
        // Non-blocking: fork Effect to prevent async fiber issues with devtools layer
        Effect.runFork(
            pipe(
                Effect.logFatal(B.messages.reactUncaught, { error: toError(error), errorInfo }),
                Effect.provide(config.loggerLayer),
            ),
        );
        config.onError(toError(error), { errorInfo, phase: B.phases.uncaught });
    },
});

const EffectErrorBoundary = ({ children, fallback, loggerLayer, onError }: EffectErrorBoundaryProps): ReactNode => (
    <ErrorBoundary
        fallback={fallback ?? <div>{B.fallback.text}</div>}
        onError={(error, info) => {
            // Non-blocking: fork Effect instead of runSync to prevent main thread blocking
            Effect.runFork(
                pipe(Effect.logError(B.messages.boundaryCaught, { error, info }), Effect.provide(loggerLayer)),
            );
            onError(error, { info, phase: B.phases.boundary });
        }}
    >
        {children}
    </ErrorBoundary>
);

// --- [EXPORT] ----------------------------------------------------------------

export type { EffectErrorBoundaryProps, ErrorCallback, RootErrorConfig, RootOptions };
export { B as BOUNDARY_TUNING, createRootErrorOptions, EffectErrorBoundary };
