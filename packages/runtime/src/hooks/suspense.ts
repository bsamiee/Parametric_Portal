/**
 * Bridge React 19 use() with Effect execution for Suspense integration.
 * Supports optional Effect.cachedWithTTL for result memoization.
 */
import { DurationMs, Timestamp } from '@parametric-portal/types/types';
import { Cause, Duration, type Effect, Exit, type ManagedRuntime } from 'effect';
import { use, useRef } from 'react';
import { useRuntime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type ResourceStatus = 'idle' | 'pending' | 'rejected' | 'resolved';
type CacheOptions = { readonly ttl?: Duration.DurationInput };
type EffectResource<A, _E> = {
    readonly preload: () => void;
    readonly read: () => A;
    readonly status: () => ResourceStatus;
};
type CacheEntry<A, E> = {
    error?: E | undefined;
    expiresAt?: Timestamp | undefined;
    promise?: Promise<A> | undefined;
    status: ResourceStatus;
    value?: A | undefined;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: { ttl: Duration.infinity },
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
const isExpired = <A, E>(entry: CacheEntry<A, E>): boolean =>
    entry.expiresAt !== undefined && Timestamp.nowSync() > entry.expiresAt;
const resetIfExpired = <A, E>(entry: CacheEntry<A, E>): CacheEntry<A, E> =>
    isExpired(entry) ? createCacheEntry<A, E>() : entry;
const createPromiseFromEffect = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    runtime: ManagedRuntime.ManagedRuntime<R, never>,
    entry: CacheEntry<A, E>,
    ttl: Duration.DurationInput = B.defaults.ttl,
): Promise<A> => {
    const ttlMs = Duration.toMillis(Duration.decode(ttl));
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
                // biome-ignore lint/style/noParameterAssign: React Suspense cache pattern requires mutable entry for promise identity preservation
                entry.expiresAt =
                    ttlMs === Number.POSITIVE_INFINITY
                        ? undefined
                        : Timestamp.addDuration(Timestamp.nowSync(), DurationMs.fromMillis(ttlMs));
                return value;
            },
        }),
    );
    return entry.promise;
};

// --- [DISPATCH_TABLES] -------------------------------------------------------

const statusHandlers = <A, E, R>(
    cache: CacheEntry<A, E>,
    effect: Effect.Effect<A, E, R>,
    runtime: ManagedRuntime.ManagedRuntime<R, never>,
    ttl?: Duration.DurationInput,
) =>
    ({
        idle: () => {
            throw createPromiseFromEffect(effect, runtime, cache, ttl);
        },
        pending: () => {
            throw cache.promise;
        },
        rejected: () => {
            throw cache.error;
        },
        resolved: () => cache.value as A,
    }) as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

const useEffectResource = <A, E, R>(effect: Effect.Effect<A, E, R>, options?: CacheOptions): EffectResource<A, E> => {
    const runtime = useRuntime<R, never>();
    const cacheRef = useRef<CacheEntry<A, E>>(createCacheEntry<A, E>());
    const getCache = (): CacheEntry<A, E> => {
        cacheRef.current = resetIfExpired(cacheRef.current);
        return cacheRef.current;
    };
    const preload = (): void => {
        const cache = getCache();
        cache.status === B.status.idle && void createPromiseFromEffect(effect, runtime, cache, options?.ttl);
    };
    const read = (): A => {
        const cache = getCache();
        return statusHandlers(cache, effect, runtime, options?.ttl)[cache.status]();
    };
    const status = (): ResourceStatus => getCache().status;
    return Object.freeze({ preload, read, status });
};
const useEffectSuspense = <A, E, R>(effect: Effect.Effect<A, E, R>, options?: CacheOptions): A => {
    const runtime = useRuntime<R, never>();
    const cacheRef = useRef<CacheEntry<A, E> | null>(null);
    const getCache = (): CacheEntry<A, E> => {
        cacheRef.current ??= createCacheEntry<A, E>();
        cacheRef.current = resetIfExpired(cacheRef.current);
        return cacheRef.current;
    };
    const cache = getCache();
    const getOrCreatePromise = (): Promise<A> =>
        cache.promise ?? createPromiseFromEffect(effect, runtime, cache, options?.ttl);
    cache.status === B.status.rejected &&
        ((): never => {
            throw cache.error;
        })();
    return cache.status === B.status.resolved ? (cache.value as A) : use(getOrCreatePromise());
};

// --- [EXPORT] ----------------------------------------------------------------

export type { CacheEntry, CacheOptions, EffectResource, ResourceStatus };
export { B as SUSPENSE_TUNING, useEffectResource, useEffectSuspense };
