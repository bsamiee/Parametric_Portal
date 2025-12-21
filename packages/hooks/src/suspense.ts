/**
 * Bridge React 19 use() with Effect execution for Suspense integration.
 */

import { Cause, type Effect, Exit, type ManagedRuntime } from 'effect';
import { use, useRef } from 'react';
import type { RuntimeApi } from './runtime';

// --- [TYPES] -----------------------------------------------------------------

type ResourceStatus = 'idle' | 'pending' | 'resolved' | 'rejected';

type EffectResource<A, _E> = {
    readonly preload: () => void;
    readonly read: () => A;
    readonly status: () => ResourceStatus;
};

type SuspenseHooksApi<R> = {
    readonly useEffectResource: <A, E>(effect: Effect.Effect<A, E, R>) => EffectResource<A, E>;
    readonly useEffectSuspense: <A, E>(effect: Effect.Effect<A, E, R>) => A;
};

type SuspenseHooksConfig = Record<string, never>;

type CacheEntry<A, E> = {
    error?: E;
    promise?: Promise<A>;
    status: ResourceStatus;
    value?: A;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    status: {
        idle: 'idle' as const,
        pending: 'pending' as const,
        rejected: 'rejected' as const,
        resolved: 'resolved' as const,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createCacheEntry = <A, E>(): CacheEntry<A, E> => ({
    status: B.status.idle,
});

const createPromiseFromEffect = <A, E, R, RuntimeE>(
    effect: Effect.Effect<A, E, R>,
    runtime: ManagedRuntime.ManagedRuntime<R, RuntimeE>,
    entry: CacheEntry<A, E>,
): Promise<A> => {
    entry.status = B.status.pending;
    entry.promise = runtime.runPromiseExit(effect).then((exit) =>
        Exit.match(exit, {
            onFailure: (cause) => {
                entry.status = B.status.rejected;
                entry.error = Cause.squash(cause) as E;
                throw entry.error;
            },
            onSuccess: (value) => {
                entry.status = B.status.resolved;
                entry.value = value;
                return value;
            },
        }),
    );
    return entry.promise;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const createSuspenseHooks = <R, E>(
    runtimeApi: RuntimeApi<R, E>,
    _config: SuspenseHooksConfig = {},
): SuspenseHooksApi<R> => {
    const { useRuntime } = runtimeApi;

    const useEffectResource = <A, Err>(effect: Effect.Effect<A, Err, R>): EffectResource<A, Err> => {
        const runtime = useRuntime();
        const cacheRef = useRef<CacheEntry<A, Err>>(createCacheEntry<A, Err>());
        const cache = cacheRef.current;

        const preload = (): void => {
            cache.status === B.status.idle && void createPromiseFromEffect(effect, runtime, cache);
        };

        const read = (): A => {
            const statusHandlers = {
                idle: () => {
                    throw createPromiseFromEffect(effect, runtime, cache);
                },
                pending: () => {
                    throw cache.promise;
                },
                rejected: () => {
                    throw cache.error;
                },
                resolved: () => cache.value as A,
            } as const;

            return statusHandlers[cache.status]();
        };

        const status = (): ResourceStatus => cache.status;

        return Object.freeze({ preload, read, status });
    };

    const useEffectSuspense = <A, Err>(effect: Effect.Effect<A, Err, R>): A => {
        const runtime = useRuntime();
        const cacheRef = useRef<CacheEntry<A, Err> | null>(null);

        // Nullish coalescing preserves cache identity across renders
        cacheRef.current ??= createCacheEntry<A, Err>();
        const cache = cacheRef.current;

        const getOrCreatePromise = (): Promise<A> => cache.promise ?? createPromiseFromEffect(effect, runtime, cache);

        const throwIfRejected = (): void => {
            cache.status === B.status.rejected &&
                (() => {
                    throw cache.error;
                })();
        };

        throwIfRejected();

        return cache.status === B.status.resolved ? (cache.value as A) : use(getOrCreatePromise());
    };

    return Object.freeze({
        useEffectResource,
        useEffectSuspense,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { EffectResource, ResourceStatus, SuspenseHooksApi, SuspenseHooksConfig };
export { B as SUSPENSE_HOOKS_TUNING, createSuspenseHooks };
