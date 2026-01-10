/**
 * Screen reader announcements for async state transitions.
 * Uses @react-aria/live-announcer singleton for stable live regions.
 * Safari-safe: announcer handles 100ms timing quirk internally.
 */
import { announce } from '@react-aria/live-announcer';
import { AsyncState } from '@parametric-portal/types/async';
import type { FC } from 'react';
import { useEffect, useRef } from 'react';

// --- [TYPES] -----------------------------------------------------------------

type Assertiveness = 'assertive' | 'polite';
type AsyncAnnounceConfig = {
    readonly assertiveness?: Assertiveness;
    readonly failure?: string;
    readonly loading?: string;
    readonly success?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: Object.freeze({
        assertiveness: 'polite' as Assertiveness,
        failure: 'Operation failed',
        loading: 'Loading',
        success: 'Operation completed',
    }),
});

// --- [HOOKS] -----------------------------------------------------------------

const useAsyncAnnounce = (
    asyncState: AsyncState<unknown, unknown> | undefined,
    config: AsyncAnnounceConfig = {},
): void => {
    const prevTagRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const currentTag = asyncState?._tag;
        const prevTag = prevTagRef.current;
        prevTagRef.current = currentTag;
        prevTag !== currentTag && asyncState !== undefined && (() => {
            const message = AsyncState.$match(asyncState, {
                Failure: () => config.failure ?? B.defaults.failure,
                Idle: () => null,
                Loading: () => config.loading ?? B.defaults.loading,
                Success: () => config.success ?? B.defaults.success,
            });
            message && announce(message, config.assertiveness ?? B.defaults.assertiveness);
        })();
    }, [asyncState, config.assertiveness, config.failure, config.loading, config.success]);
};

// --- [COMPONENTS] ------------------------------------------------------------

const AsyncAnnouncer: FC<{
    readonly asyncState: AsyncState<unknown, unknown> | undefined;
    readonly config?: AsyncAnnounceConfig;
}> = ({ asyncState, config }) => {
    useAsyncAnnounce(asyncState, config);
    return null;
};

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncAnnouncer, useAsyncAnnounce };
export type { Assertiveness, AsyncAnnounceConfig };
