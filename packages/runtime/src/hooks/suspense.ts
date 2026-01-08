/**
 * Bridge React 19 Suspense with Effect execution via stable client-side caching.
 * Provides direct suspension with use() hook and resource pattern with preload/read/status APIs.
 *
 * Note: Status type ('idle'|'pending'|'resolved'|'rejected') is intentionally distinct from AsyncState.
 * - AsyncState: React hook state management with timestamps, monadic ops, ROP bridges
 * - Status: Suspense promise cache state for React's use() hook and throw-promise semantics
 * These patterns are complementary: AsyncState for UI state, Status for Suspense coordination.
 */
import { Timestamp } from '@parametric-portal/types/types';
import { Duration, type Effect } from 'effect';
import { use, useRef } from 'react';
import { Runtime } from '../runtime';

// --- [TYPES] -----------------------------------------------------------------

type Status = 'idle' | 'pending' | 'resolved' | 'rejected';
type CacheOptions = { readonly ttl?: Duration.DurationInput };
type EffectResource<A> = {
    readonly preload: () => void;
    readonly read: () => A;
    readonly status: () => Status;
};
type Cache<A, E> = {
    error?: E;
    expiresAt?: Timestamp;
    promise?: Promise<A>;
    status: Status;
    value?: A;
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const useEffectSuspense = <A, E, R>(effect: Effect.Effect<A, E, R>, options?: CacheOptions): A => {
    const runtime = Runtime.use<R, never>();
    const ttl = Duration.decode(options?.ttl ?? Duration.infinity);
    const ttlMs = Duration.toMillis(ttl);
    const cache = useRef<Cache<A, E>>({ status: 'idle' });
    cache.current =
        cache.current.expiresAt && Timestamp.nowSync() > cache.current.expiresAt ? { status: 'idle' } : cache.current;
    const c = cache.current;
    if (c.status === 'resolved') return c.value as A;
    if (c.status === 'rejected') throw c.error;
    if (c.status === 'idle') {
        c.status = 'pending';
        c.promise = runtime.runPromise(effect).then(
            (value) => {
                Object.assign(c, {
                    expiresAt: Duration.isFinite(ttl) ? ((Timestamp.nowSync() + ttlMs) as Timestamp) : undefined,
                    status: 'resolved',
                    value,
                });
                return value;
            },
            (error) => {
                Object.assign(c, { error, status: 'rejected' });
                throw error;
            },
        );
    }
    return use(c.promise as Promise<A>);
};
const useEffectResource = <A, E, R>(effect: Effect.Effect<A, E, R>, options?: CacheOptions): EffectResource<A> => {
    const runtime = Runtime.use<R, never>();
    const ttl = Duration.decode(options?.ttl ?? Duration.infinity);
    const ttlMs = Duration.toMillis(ttl);
    const cache = useRef<Cache<A, E>>({ status: 'idle' });
    const getCache = (): Cache<A, E> => {
        cache.current =
            cache.current.expiresAt && Timestamp.nowSync() > cache.current.expiresAt
                ? { status: 'idle' }
                : cache.current;
        return cache.current;
    };
    const startIfIdle = (): void => {
        const c = getCache();
        if (c.status !== 'idle') return;
        c.status = 'pending';
        c.promise = runtime.runPromise(effect).then(
            (value) => {
                Object.assign(c, {
                    expiresAt: Duration.isFinite(ttl) ? ((Timestamp.nowSync() + ttlMs) as Timestamp) : undefined,
                    status: 'resolved',
                    value,
                });
                return value;
            },
            (error) => {
                Object.assign(c, { error, status: 'rejected' });
                throw error;
            },
        );
    };
    return Object.freeze({
        preload: startIfIdle,
        read: (): A => {
            startIfIdle();
            const c = getCache();
            if (c.status === 'pending') throw c.promise;
            if (c.status === 'rejected') throw c.error;
            return c.value as A;
        },
        status: () => getCache().status,
    });
};

// --- [EXPORT] ----------------------------------------------------------------

export type { CacheOptions, EffectResource };
export { useEffectResource, useEffectSuspense };
