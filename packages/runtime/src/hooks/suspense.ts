/**
 * Bridge React 19 use() with Effect execution for Suspense integration.
 */
import { Cause, type Effect, Exit, type ManagedRuntime } from 'effect';
import { use, useRef } from 'react';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type ResourceStatus = 'idle' | 'pending' | 'rejected' | 'resolved';
type EffectResource<A, _E> = {
    readonly preload: () => void;
    readonly read: () => A;
    readonly status: () => ResourceStatus;
};
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
const createPromiseFromEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    runtime: ManagedRuntime.ManagedRuntime<R, never>,
    entry: CacheEntry<A, E>,
): Promise<A> => {
    // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
    entry.status = B.status.pending;
    // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
    entry.promise = runtime.runPromiseExit(effect).then((exit) =>
        Exit.match(exit, {
            onFailure: (cause) => {
                // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
                entry.status = B.status.rejected;
                // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
                entry.error = Cause.squash(cause) as E;
                throw entry.error;
            },
            onSuccess: (value) => {
                // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
                entry.status = B.status.resolved;
                // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
                entry.value = value;
                return value;
            },
        }),
    );
    return entry.promise;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useEffectResource = <A, E, R>(effect: Effect.Effect<A, E, R>): EffectResource<A, E> => {
    const runtime = useRuntime<R, never>();
    const cacheRef = useRef<CacheEntry<A, E>>(createCacheEntry<A, E>());
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
const useEffectSuspense = <A, E, R>(effect: Effect.Effect<A, E, R>): A => {
    const runtime = useRuntime<R, never>();
    const cacheRef = useRef<CacheEntry<A, E> | null>(null);
    cacheRef.current ??= createCacheEntry<A, E>();
    const cache = cacheRef.current;
    const getOrCreatePromise = (): Promise<A> => cache.promise ?? createPromiseFromEffect(effect, runtime, cache);
    cache.status === B.status.rejected &&
        ((): never => {
            throw cache.error;
        })();
    return cache.status === B.status.resolved ? (cache.value as A) : use(getOrCreatePromise());
};

// --- [EXPORT] ----------------------------------------------------------------

export type { CacheEntry, EffectResource, ResourceStatus };
export { B as SUSPENSE_TUNING, useEffectResource, useEffectSuspense };
