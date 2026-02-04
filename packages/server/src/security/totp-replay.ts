/**
 * Guard against TOTP replay and brute-force attacks.
 * Uses CacheService.redis for replay detection via SET NX and lockout persistence.
 */
import { Clock, Duration, Effect, Option, pipe, Schema as S } from 'effect';
import { HttpError } from '../errors.ts';
import { CacheService } from '../platform/cache.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _CONFIG = {
	keyPrefix: 'totp:',
	lockout: { baseMs: 30_000, maxAttempts: 5, maxMs: 900_000 },
	lockoutKey: (userId: string) => `totp:lockout:${userId}`,
	lockoutSchema: S.Struct({ count: S.Number, lastFailure: S.Number, lockedUntil: S.Number }),
	ttl: Duration.millis(150_000),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class ReplayGuardService extends Effect.Service<ReplayGuardService>()('server/ReplayGuardService', {
	scoped: Effect.gen(function* () {
		const _readLockout = (userId: string) =>
			Effect.gen(function* () {
				const redis = yield* CacheService.redis;
				const raw = yield* Effect.tryPromise(() => redis.get(_CONFIG.lockoutKey(userId)));
				return pipe(
					Option.fromNullable(raw),
					Option.flatMap((r) => Option.getRight(S.decodeUnknownEither(_CONFIG.lockoutSchema)(JSON.parse(r)))),
				);
			});
		yield* Effect.logInfo('ReplayGuardService initialized');
		return {
			checkAndMark: (userId: string, timeStep: number, code: string) => {
				const key = `${_CONFIG.keyPrefix}${userId}:${timeStep}:${code}`;
				return CacheService.setNX(key, '1', _CONFIG.ttl).pipe(Effect.map((result) => ({ alreadyUsed: result.alreadyExists, backend: 'redis' as const })),);
			},
			checkLockout: (userId: string) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const lockout = yield* _readLockout(userId);
					yield* pipe(
						lockout,
						Option.filter((state) => state.lockedUntil > now),
						Option.match({
							onNone: () => Effect.void,
							onSome: (state) => Effect.fail(HttpError.RateLimit.of(state.lockedUntil - now, { recoveryAction: 'email-verify' })),
						}),
					);
				}),
			recordFailure: (userId: string) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const option = yield* _readLockout(userId);
					const prev = Option.getOrElse(option, () => ({ count: 0, lastFailure: now, lockedUntil: 0 }));
					const count = prev.count + 1;
					const delta = count - _CONFIG.lockout.maxAttempts;
					const lockedUntil = pipe(
						Option.liftPredicate((d: number) => d >= 0)(delta),
						Option.map((d) => now + Math.min(_CONFIG.lockout.baseMs * (2 ** d), _CONFIG.lockout.maxMs)),
						Option.getOrElse(() => 0),
					);
					const redis = yield* CacheService.redis;
					yield* Effect.tryPromise(() => redis.set(_CONFIG.lockoutKey(userId), JSON.stringify({ count, lastFailure: now, lockedUntil }), 'PX', _CONFIG.lockout.maxMs)).pipe(Effect.ignore);
				}),
			recordSuccess: (userId: string) =>
				Effect.gen(function* () {
					const redis = yield* CacheService.redis;
					yield* Effect.tryPromise(() => redis.del(_CONFIG.lockoutKey(userId))).pipe(Effect.ignore);
				}),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ReplayGuardService };
