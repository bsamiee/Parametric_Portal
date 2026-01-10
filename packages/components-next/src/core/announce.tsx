/**
 * Visually hidden announce utility for screen reader notifications.
 * Announces async state transitions without visual disruption.
 */
import { Root as VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { readCssMs } from '@parametric-portal/runtime/runtime';
import { AsyncState } from '@parametric-portal/types/async';
import type { FC } from 'react';
import { useEffect, useRef, useState } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type Urgency = 'assertive' | 'polite';
type AsyncAnnounceConfig = {
    readonly failure?: string;
    readonly loading?: string;
    readonly success?: string;
    readonly urgency?: Urgency;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cssVars: Object.freeze({
        duration: '--announce-duration',
    }),
    defaults: {
        duration: 1000,
        failure: 'Operation failed',
        loading: 'Loading',
        success: 'Operation completed',
        urgency: 'polite' as Urgency,
    } as const,
});

// --- [HOOKS] -----------------------------------------------------------------

const useAsyncAnnounce = (
    asyncState: AsyncState<unknown, unknown> | undefined,
    config: AsyncAnnounceConfig = {}, ): string | null => {
    const [announcement, setAnnouncement] = useState<string | null>(null);
    const prevStateRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const currentStatus = AsyncState.toAttr(asyncState);
        const prevStatus = prevStateRef.current;
        prevStateRef.current = currentStatus;
        const shouldAnnounce = prevStatus !== currentStatus && currentStatus && asyncState;
        const message = shouldAnnounce
            ? AsyncState.$match(asyncState, {
                  Failure: () => config.failure ?? B.defaults.failure,
                  Idle: () => null,
                  Loading: () => config.loading ?? B.defaults.loading,
                  Success: () => config.success ?? B.defaults.success,
              })
            : null;
        setAnnouncement(message);
        const duration = message ? (readCssMs(B.cssVars.duration) || B.defaults.duration) : 0;
        const t = message ? setTimeout(() => setAnnouncement(null), duration) : undefined;
        return () => t && clearTimeout(t);
    }, [asyncState, config.failure, config.loading, config.success]);
    return announcement;
};

// --- [COMPONENTS] ------------------------------------------------------------

const AsyncAnnouncer: FC<{
    readonly asyncState: AsyncState<unknown, unknown> | undefined;
    readonly config?: AsyncAnnounceConfig; }> = ({ asyncState, config }) => {
    const announcement = useAsyncAnnounce(asyncState, config);
    const urgency = config?.urgency ?? B.defaults.urgency;
    return announcement ? (
        <VisuallyHidden aria-atomic="true" aria-live={urgency}> {announcement} </VisuallyHidden>
    ) : null;
};

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncAnnouncer, useAsyncAnnounce };
export type { AsyncAnnounceConfig, Urgency };
