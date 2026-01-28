/**
 * Screen reader announcements via @react-aria/live-announcer singleton.
 * AsyncAnnouncer auto-announces state transitions. VisuallyHidden hides content visually.
 */
import { announce } from '@react-aria/live-announcer';
import { AsyncState } from '@parametric-portal/types/async';
import { Option, pipe } from 'effect';
import type { FC, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { VisuallyHidden as RACVisuallyHidden } from 'react-aria-components';

// --- [TYPES] -----------------------------------------------------------------

type Assertiveness = 'assertive' | 'polite';
type AsyncAnnounceConfig = {
    readonly assertiveness?: Assertiveness;
    readonly failure?: string;
    readonly loading?: string;
    readonly success?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const _B = {
    defaults: {
        assertiveness: 'polite' as Assertiveness,
        failure: 'Operation failed',
        loading: 'Loading',
        success: 'Operation completed',
    },
} as const;

// --- [HOOKS] -----------------------------------------------------------------

const useAsyncAnnounce = (
    asyncState: AsyncState<unknown, unknown> | undefined,
    config: AsyncAnnounceConfig = {}, ): void => {
    const prevTagRef = useRef<string | undefined>(undefined);
    useEffect(() => {
        const prevTag = prevTagRef.current;
        prevTagRef.current = asyncState?._tag;
        pipe(
            Option.fromNullable(asyncState),
            Option.filter((state) => prevTag !== state._tag),
            Option.map((state) => AsyncState.$match(state, {
                Failure: () => config.failure ?? _B.defaults.failure,
                Idle: () => null,
                Loading: () => config.loading ?? _B.defaults.loading,
                Success: () => config.success ?? _B.defaults.success,
            })),
            Option.flatMap(Option.fromNullable),
            Option.map((message) => announce(message, config.assertiveness ?? _B.defaults.assertiveness)),
        );
    }, [asyncState, config.assertiveness, config.failure, config.loading, config.success]);
};

// --- [COMPONENTS] ------------------------------------------------------------

const AsyncAnnouncer: FC<{
    readonly asyncState: AsyncState<unknown, unknown> | undefined;
    readonly config?: AsyncAnnounceConfig; }> = ({ asyncState, config }) => {
    useAsyncAnnounce(asyncState, config);
    return null;
};
const VisuallyHidden: FC<{ readonly children: ReactNode }> = ({ children }) => (
    <RACVisuallyHidden>{children}</RACVisuallyHidden>
);

// --- [EXPORT] ----------------------------------------------------------------

export { AsyncAnnouncer, useAsyncAnnounce, VisuallyHidden };
export type { Assertiveness, AsyncAnnounceConfig };
