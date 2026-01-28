/**
 * Guard against TOTP replay and brute-force attacks.
 * Uses CacheService.redis for replay detection via SET NX.
 * Lockout state kept in-memory via STM TMap (per-worker, acceptable for brute-force protection).
 */
import { Clock, Duration, Effect, Option, Schedule, STM, TMap } from 'effect';
import { HttpError } from '../errors.ts';
import { CacheService } from '../platform/cache.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _config = {
	cleanup: { interval: Duration.minutes(1) },
	keyPrefix: 'totp:',
	lockout: { baseMs: 30_000, maxAttempts: 5, maxMs: 900_000 },
	ttl: Duration.millis(150_000),
} as const;

// --- [SERVICES] --------------------------------------------------------------

class ReplayGuardService extends Effect.Service<ReplayGuardService>()('server/ReplayGuardService', {
	scoped: Effect.gen(function* () {
		const lockoutMap = yield* TMap.empty<string, { readonly count: number; readonly lockedUntil: number }>().pipe(STM.commit);
		yield* Clock.currentTimeMillis.pipe(
			Effect.tap((now) => TMap.retainIf(lockoutMap, (_, s) => s.lockedUntil === 0 || now <= s.lockedUntil + _config.lockout.maxMs).pipe(STM.commit)),
			Effect.repeat(Schedule.spaced(_config.cleanup.interval)),
			Effect.forkScoped,
		);
		yield* Effect.logInfo('ReplayGuardService initialized');
		return {
			checkAndMark: (userId: string, timeStep: number, code: string) => {
				const key = `${_config.keyPrefix}${userId}:${timeStep}:${code}`;
				return CacheService.setNX(key, '1', _config.ttl).pipe(
					Effect.map((result) => ({ alreadyUsed: result.alreadyExists, backend: 'redis' as const })),
				);
			},
			checkLockout: (userId: string) =>
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((now) =>
						TMap.get(lockoutMap, userId).pipe(
							STM.commit,
							Effect.flatMap(
								Option.match({
									onNone: () => Effect.void,
									onSome: (s) => s.lockedUntil > now ? Effect.fail(HttpError.RateLimit.of(s.lockedUntil - now, { recoveryAction: 'email-verify' })) : Effect.void,
								}),
							),
						),
					),
				),
			recordFailure: (userId: string) =>
				Effect.all([Clock.currentTimeMillis, TMap.get(lockoutMap, userId).pipe(STM.commit)]).pipe(
					Effect.flatMap(([now, opt]) => {
						const prev = Option.getOrElse(opt, () => ({ count: 0, lockedUntil: 0 }));
						const count = prev.count + 1;
						const lockedUntil = count >= _config.lockout.maxAttempts
							? now + Math.min(_config.lockout.baseMs * (2 ** (count - _config.lockout.maxAttempts)), _config.lockout.maxMs)
							: 0;
						return TMap.set(lockoutMap, userId, { count, lockedUntil }).pipe(STM.commit);
					}),
				),
			recordSuccess: (userId: string) => TMap.remove(lockoutMap, userId).pipe(STM.commit),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ReplayGuardService };
