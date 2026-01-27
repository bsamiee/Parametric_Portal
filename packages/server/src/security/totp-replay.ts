/**
 * Guard against TOTP replay and brute-force attacks.
 * Uses @effect/experimental RateLimiterStore (shared with rate-limit.ts) for replay detection.
 * Lockout state kept in-memory via STM TMap (per-worker, acceptable for brute-force protection).
 */
import { RateLimiterStore } from '@effect/experimental/RateLimiter';
import { Clock, Duration, Effect, Option, Schedule, STM, TMap } from 'effect';
import { HttpError } from '../errors.ts';

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
		const store = yield* RateLimiterStore;
		const lockoutMap = yield* TMap.empty<string, { readonly count: number; readonly lockedUntil: number }>().pipe(STM.commit);
		yield* Clock.currentTimeMillis.pipe(
			Effect.tap((now) => TMap.retainIf(lockoutMap, (_, s) => s.lockedUntil === 0 || now <= s.lockedUntil + _config.lockout.maxMs).pipe(STM.commit)),
			Effect.repeat(Schedule.spaced(_config.cleanup.interval)),
			Effect.forkScoped,
		);
		yield* Effect.logInfo('ReplayGuardService initialized');
		return {
			checkAndMark: (userId: string, timeStep: number, code: string) =>
				store.fixedWindow({ key: `${_config.keyPrefix}${userId}:${timeStep}:${code}`, limit: 1, refillRate: _config.ttl, tokens: 1 }).pipe(
					Effect.map(([count, _ttl]) => ({ alreadyUsed: count > 1, backend: 'store' as const })),
					Effect.catchAll((err) => Effect.logWarning('TOTP replay check failed (fail-open)', { error: String(err) }).pipe(
						Effect.as({ alreadyUsed: false, backend: 'fallback' as const }),
					)),
				),
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
				Clock.currentTimeMillis.pipe(
					Effect.flatMap((now) =>
						TMap.get(lockoutMap, userId).pipe(
							STM.flatMap((opt) => {
								const prev = Option.getOrElse(opt, () => ({ count: 0, lockedUntil: 0 }));
								const count = prev.count + 1;
								const lockedUntil = count >= _config.lockout.maxAttempts
									? now + Math.min(_config.lockout.baseMs * (2 ** (count - _config.lockout.maxAttempts)), _config.lockout.maxMs)
									: 0;
								return TMap.set(lockoutMap, userId, { count, lockedUntil });
							}),
							STM.commit,
						),
					),
				),
			recordSuccess: (userId: string) => TMap.remove(lockoutMap, userId).pipe(STM.commit),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ReplayGuardService };
