/**
 * TOTP Replay Guard: Prevents code reuse within validity window.
 * Supports pluggable backends: Redis for multi-instance, in-memory fallback.
 * Key pattern: userId:timeStep:code with TTL covering full TOTP window.
 */
import type { UserId } from '@parametric-portal/types/schema';
import { Config, Duration, Effect, MutableHashMap, Option, pipe, Redacted, Schedule } from 'effect';
import Redis from 'ioredis';

// --- [TYPES] -----------------------------------------------------------------

type CacheEntry = { readonly expiresAt: number };
type ReplayCache = MutableHashMap.MutableHashMap<string, CacheEntry>;
type CheckResult = { readonly alreadyUsed: boolean; readonly backend: 'memory' | 'redis' };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    cleanup: { interval: Duration.minutes(1), threshold: 1000 },
    keyDelimiter: ':',
    keyPrefix: 'totp:replay:',
    redis: { connectTimeout: 5000, enableOfflineQueue: false, maxRetriesPerRequest: 1 },
    totp: { periodSec: 30, windowFuture: 2, windowPast: 2 },
} as const);
const ttlWindows = B.totp.windowPast + B.totp.windowFuture + 1;
const ttlMs = B.totp.periodSec * ttlWindows * 1000;
const ttlSeconds = Math.ceil(ttlMs / 1000);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const makeKey = (userId: UserId, timeStep: number, code: string): string => [userId, timeStep, code].join(B.keyDelimiter);
const makeRedisKey = (userId: UserId, timeStep: number, code: string): string => `${B.keyPrefix}${makeKey(userId, timeStep, code)}`;
const isExpired = (entry: CacheEntry): boolean => Date.now() > entry.expiresAt;
const cleanupExpired = (cache: ReplayCache): void => MutableHashMap.forEach(cache, (entry, key) => {isExpired(entry) && MutableHashMap.remove(cache, key);});

// --- [BACKENDS] --------------------------------------------------------------

const createMemoryBackend = () => {
    const cache: ReplayCache = MutableHashMap.empty();
    return {
        cache,
        checkAndMark: (userId: UserId, timeStep: number, code: string): CheckResult => {
            const key = makeKey(userId, timeStep, code);
            const existing = MutableHashMap.get(cache, key);
            const alreadyUsed = existing._tag === 'Some' && !isExpired(existing.value);
            alreadyUsed || MutableHashMap.set(cache, key, { expiresAt: Date.now() + ttlMs });
            return { alreadyUsed, backend: 'memory' as const };
        },
        cleanup: Effect.sync(() => { MutableHashMap.size(cache) > B.cleanup.threshold && cleanupExpired(cache); }),
    };
};
const createRedisBackend = (redis: Redis) => ({
    checkAndMark: (userId: UserId, timeStep: number, code: string) =>
        Effect.tryPromise({
            catch: () => 'redis_error' as const,
            try: async () => {
                const key = makeRedisKey(userId, timeStep, code);
                // biome-ignore lint/nursery/useAwaitThenable: ioredis set() returns Promise<"OK" | null>
                const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
                return { alreadyUsed: result === null, backend: 'redis' as const };
            },
        }),
    quit: Effect.promise(() => redis.quit()).pipe(Effect.catchAll(() => Effect.void)),
});

// --- [SERVICES] --------------------------------------------------------------

class TotpReplayGuard extends Effect.Service<TotpReplayGuard>()('server/TotpReplayGuard', {
    scoped: Effect.gen(function* () {
        const redisUrlOpt = yield* Config.option(Config.redacted('REDIS_URL'));
        const memoryBackend = createMemoryBackend();
        const redisBackend = Option.isSome(redisUrlOpt)
            ? yield* Effect.try({
                  catch: () => null,
                  try: () => {
                      const redis = new Redis(Redacted.value(redisUrlOpt.value), {
                          connectTimeout: B.redis.connectTimeout,
                          enableOfflineQueue: B.redis.enableOfflineQueue,
                          maxRetriesPerRequest: B.redis.maxRetriesPerRequest,
                      });
                      return createRedisBackend(redis);
                  },
              })
            : null;
        yield* pipe(memoryBackend.cleanup, Effect.repeat(Schedule.spaced(B.cleanup.interval)), Effect.forkScoped);
        // Redis cleanup on scope close
        yield* redisBackend
            ? Effect.addFinalizer(() => redisBackend.quit.pipe(Effect.tap(() => Effect.logInfo('TotpReplayGuard Redis connection closed'))))
            : Effect.void;
        yield* Effect.logInfo('TotpReplayGuard initialized', { backend: redisBackend ? 'redis' : 'memory' });
        const checkAndMark = (userId: UserId, timeStep: number, code: string): Effect.Effect<CheckResult> =>
            redisBackend
                ? redisBackend.checkAndMark(userId, timeStep, code).pipe(
                      Effect.catchAll(() => Effect.sync(() => memoryBackend.checkAndMark(userId, timeStep, code))),
                  )
                : Effect.sync(() => memoryBackend.checkAndMark(userId, timeStep, code));
        return { checkAndMark };
    }),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { TotpReplayGuard };
export type { CheckResult };
