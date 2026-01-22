/**
 * Guard against TOTP replay and brute-force attacks.
 * Redis primary (atomic SET NX EX), memory fallback; exponential lockout on failures.
 */
import { Config, Duration, Effect, MutableHashMap, Option, Redacted, Schedule } from 'effect';
import Redis from 'ioredis';
import { HttpError } from './http-errors.ts';

// --- [TYPES] -----------------------------------------------------------------

type _CheckResult = { readonly alreadyUsed: boolean; readonly backend: 'memory' | 'redis' };

// --- [CONSTANTS] -------------------------------------------------------------

const config = {
	cleanup: { interval: Duration.minutes(1), threshold: 1000 },
	keyPrefix: 'totp:replay:',
	lockout: { baseMs: 30_000, maxAttempts: 5, maxMs: 900_000 },
	redis: { connectTimeout: 5000, enableOfflineQueue: false, lazyConnect: true, maxRetriesPerRequest: 1 },
	ttl: { ms: 150_000, sec: 150 },
} as const;

// --- [SERVICES] --------------------------------------------------------------

class TotpReplayGuard extends Effect.Service<TotpReplayGuard>()('server/TotpReplayGuard', {
	scoped: Effect.gen(function* () {
		const replayCache = MutableHashMap.empty<string, number>();
		const lockoutCache = MutableHashMap.empty<string, { readonly count: number; readonly lockedUntil: number }>();
		const redisOpt = yield* Config.option(Config.redacted('REDIS_URL')).pipe(
			Effect.map(Option.map((url) => new Redis(Redacted.value(url), { ...config.redis, keyPrefix: config.keyPrefix }))),
		);
		const memReplayCheck = (key: string): _CheckResult => {
			const now = Date.now();
			const alreadyUsed = Option.exists(MutableHashMap.get(replayCache, key), (expiry) => now <= expiry);
			!alreadyUsed && MutableHashMap.set(replayCache, key, now + config.ttl.ms);
			return { alreadyUsed, backend: 'memory' };
		};
		const redisReplayCheck = (redis: Redis, key: string) =>
			Effect.tryPromise({ catch: () => null, try: () => redis.set(key, '1', 'EX', config.ttl.sec, 'NX') }).pipe(
				Effect.map((result): _CheckResult => ({ alreadyUsed: result === null, backend: 'redis' })),
				Effect.catchAll(() => Effect.succeed(memReplayCheck(key))),
			);
		yield* Effect.repeat(Effect.sync(() => {
			const now = Date.now();
			MutableHashMap.size(replayCache) > config.cleanup.threshold && MutableHashMap.forEach(replayCache, (expiry, cacheKey) => { now > expiry && MutableHashMap.remove(replayCache, cacheKey); });
			MutableHashMap.forEach(lockoutCache, (state, key) => { state.lockedUntil > 0 && now > state.lockedUntil + config.lockout.maxMs && MutableHashMap.remove(lockoutCache, key); });
		}), Schedule.spaced(config.cleanup.interval)).pipe(Effect.forkScoped);
		yield* Option.match(redisOpt, {
			onNone: () => Effect.void,
			onSome: (redis) => Effect.addFinalizer(() => Effect.promise(() => redis.quit()).pipe(Effect.ignore, Effect.andThen(Effect.logInfo('TotpReplayGuard Redis closed')))),
		});
		yield* Effect.logInfo('TotpReplayGuard initialized', { backend: Option.isSome(redisOpt) ? 'redis' : 'memory' });
		return {
			checkAndMark: (userId: string, timeStep: number, code: string): Effect.Effect<_CheckResult> => {
				const key = `${userId}:${timeStep}:${code}`;
				return Option.match(redisOpt, { onNone: () => Effect.succeed(memReplayCheck(key)), onSome: (redis) => redisReplayCheck(redis, key) });
			},
			checkLockout: (userId: string): Effect.Effect<void, HttpError.RateLimit> =>
				Effect.suspend(() => Option.match(Option.flatMap(MutableHashMap.get(lockoutCache, userId), (state) => Option.liftPredicate(state.lockedUntil - Date.now(), (remaining) => remaining > 0)), {
					onNone: () => Effect.void,
					onSome: (remainingMs) => Effect.fail(HttpError.rateLimit(remainingMs, { recoveryAction: 'email-verify' })),
				})),
			recordFailure: (userId: string): Effect.Effect<void> => Effect.sync(() => {
				const now = Date.now();
				const { count } = Option.getOrElse(MutableHashMap.get(lockoutCache, userId), () => ({ count: 0, lockedUntil: 0 }));
				const newCount = count + 1;
				const lockedUntil = newCount >= config.lockout.maxAttempts ? now + Math.min(config.lockout.baseMs * (2 ** (newCount - config.lockout.maxAttempts)), config.lockout.maxMs) : 0;
				MutableHashMap.set(lockoutCache, userId, { count: newCount, lockedUntil });
			}),
			recordSuccess: (userId: string): Effect.Effect<void> => Effect.sync(() => MutableHashMap.remove(lockoutCache, userId)),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { TotpReplayGuard };
