/**
 * React hook for devtools access via session context.
 * Provides log access, overlay control, and React 19 owner stack capture.
 */
import { Option, pipe } from 'effect';
import { captureOwnerStack, useCallback, useContext, useMemo } from 'react';
import { SessionContext } from './session';
import type { LogEntry } from './types';

// --- [TYPES] -----------------------------------------------------------------

type DevSessionHook = {
    readonly enabled: boolean;
    readonly logs: ReadonlyArray<LogEntry>;
    readonly overlay: {
        readonly hide: () => void;
        readonly show: (error: Error, context?: Readonly<Record<string, unknown>>) => void;
    };
    readonly ownerStack: () => string | null;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    errors: {
        missingProvider: 'useDevSession requires DevSession.SessionProvider in component tree',
    },
    noop: {
        hide: () => {},
        show: () => {},
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getOwnerStack = (): string | null =>
    pipe(
        Option.fromNullable(captureOwnerStack),
        Option.flatMap((fn) => Option.fromNullable(typeof fn === 'function' ? fn() : null)),
        Option.getOrNull,
    );

// --- [ENTRY_POINT] -----------------------------------------------------------

const useDevSession = (): DevSessionHook => {
    const session = useContext(SessionContext);
    const enabled = session !== null;
    const logs = useMemo<ReadonlyArray<LogEntry>>(() => session?.logs ?? [], [session]);
    const show = useCallback(
        (error: Error, context?: Readonly<Record<string, unknown>>): void => {
            session?.renderDebug(error, context);
        },
        [session],
    );
    const hide = useCallback((): void => {}, []); // Overlay is replaced by re-render; no explicit hide needed
    const overlay = useMemo(() => (enabled ? { hide, show } : B.noop), [enabled, hide, show]);
    const ownerStack = useCallback(getOwnerStack, []);
    return Object.freeze({
        enabled,
        logs,
        overlay,
        ownerStack,
    });
};
const enhanceError = (error: Error): Error =>
    pipe(
        Option.fromNullable(getOwnerStack()),
        Option.match({
            onNone: () => error,
            onSome: (stack) =>
                Object.assign(error, { cause: { ownerStack: stack, ...(error.cause as object | undefined) } }),
        }),
    );

// --- [EXPORT] ----------------------------------------------------------------

export type { DevSessionHook };
export { B as DEVTOOLS_HOOK_TUNING, enhanceError, useDevSession };
