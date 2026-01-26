/**
 * Guard against TOTP replay and brute-force attacks.
 * Redis primary (atomic SET NX EX), memory fallback; exponential lockout.
 */
import { Clock, Config, Duration, Effect, HashMap, Match, Option, Redacted, Ref, Schedule } from 'effect';
import Redis from 'ioredis';
import { HttpError } from '../errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	cleanup: { interval: Duration.minutes(1), threshold: 1000 },
	keyPrefix: 'totp:replay:',
	lockout: { baseMs: 30_000, maxAttempts: 5, maxMs: 900_000 },
	redis: { connectTimeout: 5000, enableOfflineQueue: false, lazyConnect: true, maxRetriesPerRequest: 1 } satisfies import('ioredis').RedisOptions,
	ttl: { ms: 150_000, sec: 150 },
} as const;

// --- [SERVICES] --------------------------------------------------------------

class ReplayGuardService extends Effect.Service<ReplayGuardService>()('server/ReplayGuardService', {
	scoped: Effect.gen(function* () {
		const replayRef = yield* Ref.make(HashMap.empty<string, number>());
		const lockoutRef = yield* Ref.make(HashMap.empty<string, { readonly count: number; readonly lockedUntil: number }>());
		const redis = yield* Config.all({
			host: Config.string('REDIS_HOST').pipe(Config.withDefault('localhost')),
			password: Config.option(Config.redacted('REDIS_PASSWORD')),
			port: Config.integer('REDIS_PORT').pipe(Config.withDefault(6379)),
			url: Config.option(Config.redacted('REDIS_URL')),
		}).pipe(Effect.map(({ host, password, port, url }) =>
			Match.value({ hasUrl: Option.isSome(url), needsRedis: host !== 'localhost' || Option.isSome(password) }).pipe(
				Match.when({ hasUrl: true }, () => Option.some(new Redis(Redacted.value(Option.getOrThrow(url)), { ..._config.redis, keyPrefix: _config.keyPrefix }))),
				Match.when({ needsRedis: true }, () => Option.some(new Redis({ ..._config.redis, host, keyPrefix: _config.keyPrefix, password: Option.getOrUndefined(Option.map(password, Redacted.value)), port }))),
				Match.orElse(() => Option.none()),
			),
		));
		const memCheck = (key: string) =>
			Effect.all([Clock.currentTimeMillis, Ref.get(replayRef)]).pipe(
				Effect.flatMap(([now, m]) => {
					const expiry = HashMap.get(m, key);
					const used = Option.isSome(expiry) && now <= expiry.value;
					return Ref.set(replayRef, used ? m : HashMap.set(m, key, now + _config.ttl.ms)).pipe(
						Effect.as({ alreadyUsed: used, backend: 'memory' as const }),
					);
				}),
			);
		const redisCheck = (r: Redis, key: string) => Effect.tryPromise(() => r.set(key, '1', 'EX', _config.ttl.sec, 'NX')).pipe(
			Effect.map((res): { readonly alreadyUsed: boolean; readonly backend: 'memory' | 'redis' } => ({ alreadyUsed: res === null, backend: 'redis' })),
			Effect.catchAll(() => memCheck(key)),
		);
		yield* Clock.currentTimeMillis.pipe(
			Effect.tap((now) => Effect.all([
				Ref.update(replayRef, (m) => HashMap.size(m) > _config.cleanup.threshold ? HashMap.filter(m, (exp) => now <= exp) : m),
				Ref.update(lockoutRef, (m) => HashMap.filter(m, (s) => s.lockedUntil === 0 || now <= s.lockedUntil + _config.lockout.maxMs)),
			], { discard: true })),
			Effect.repeat(Schedule.spaced(_config.cleanup.interval)),
			Effect.forkScoped,
		);
		yield* Option.match(redis, {
			onNone: () => Effect.void,
			onSome: (r) => Effect.addFinalizer(() => Effect.promise(() => r.quit()).pipe(Effect.timeout(Duration.seconds(5)), Effect.ignore)),
		});
		yield* Effect.logInfo('ReplayGuardService initialized', { backend: Option.isSome(redis) ? 'redis' : 'memory' });
		return {
			checkAndMark: (userId: string, timeStep: number, code: string) => {
				const key = `${userId}:${timeStep}:${code}`;
				return Option.match(redis, { onNone: () => memCheck(key), onSome: (r) => redisCheck(r, key) });
			},
			checkLockout: (userId: string) => Effect.all([Clock.currentTimeMillis, Ref.get(lockoutRef)]).pipe(
				Effect.flatMap(([now, m]) => HashMap.get(m, userId).pipe(
					Option.filter((s) => s.lockedUntil > now),
					Option.match({
						onNone: () => Effect.void,
						onSome: (s) => Effect.fail(HttpError.RateLimit.of(s.lockedUntil - now, { recoveryAction: 'email-verify' })),
					}),
				)),
			),
			recordFailure: (userId: string) =>
				Effect.all([Clock.currentTimeMillis, Ref.get(lockoutRef)]).pipe(
					Effect.flatMap(([now, m]) => {
						const prev = Option.getOrElse(HashMap.get(m, userId), () => ({ count: 0, lockedUntil: 0 }));
						const count = prev.count + 1;
						const lockedUntil = count >= _config.lockout.maxAttempts
							? now + Math.min(_config.lockout.baseMs * (2 ** (count - _config.lockout.maxAttempts)), _config.lockout.maxMs)
							: 0;
						return Ref.set(lockoutRef, HashMap.set(m, userId, { count, lockedUntil }));
					}),
				),
			recordSuccess: (userId: string) => Ref.update(lockoutRef, HashMap.remove(userId)),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ReplayGuardService };
