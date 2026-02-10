/**
 * Guard against TOTP replay and brute-force attacks.
 * Uses CacheService.setNX for replay detection, CacheService.kv for lockout persistence.
 */
import { Clock, Duration, Effect, Option, pipe, Schema as S } from 'effect';
import { HttpError } from '../errors.ts';
import { CacheService } from '../platform/cache.ts';
import { MetricsService } from '../observe/metrics.ts';
import { Telemetry } from '../observe/telemetry.ts';

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
		yield* Effect.logInfo('ReplayGuardService initialized');
		const incMfa = pipe(yield* Effect.serviceOption(MetricsService), Option.match({ onNone: () => () => Effect.void, onSome: (service) => (outcome: string) => MetricsService.inc(service.mfa.verifications, MetricsService.label({ outcome })) }));
		return {
			checkAndMark: (userId: string, timeStep: number, code: string) =>
				CacheService.setNX(`${_CONFIG.keyPrefix}${userId}:${timeStep}:${code}`, '1', _CONFIG.ttl).pipe(
					Effect.flatMap((result) => incMfa(result.alreadyExists ? 'replay_reject' : 'replay_mark').pipe(Effect.as({ alreadyUsed: result.alreadyExists, backend: 'redis' as const }),)),
					Telemetry.span('totp.checkAndMark', { metrics: false }),
				),
			checkLockout: (userId: string) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const lockout = yield* CacheService.kv.get(_CONFIG.lockoutKey(userId), _CONFIG.lockoutSchema);
					yield* pipe(lockout, Option.filter((state) => state.lockedUntil > now), Option.match({
						onNone: () => Effect.void,
						onSome: (state) => incMfa('lockout_block').pipe(
							Effect.andThen(Effect.fail(HttpError.RateLimit.of(state.lockedUntil - now, { recoveryAction: 'email-verify' }))),
						),
					}));
				}).pipe(Telemetry.span('totp.checkLockout', { metrics: false })),
			recordFailure: (userId: string) =>
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis;
					const prev = Option.getOrElse(yield* CacheService.kv.get(_CONFIG.lockoutKey(userId), _CONFIG.lockoutSchema), () => ({ count: 0, lastFailure: now, lockedUntil: 0 }));
					const count = prev.count + 1;
					const lockedUntil = pipe(
						Option.liftPredicate((delta: number) => delta >= 0)(count - _CONFIG.lockout.maxAttempts),
						Option.map((delta) => now + Math.min(_CONFIG.lockout.baseMs * (2 ** delta), _CONFIG.lockout.maxMs)),
						Option.getOrElse(() => 0),
					);
					yield* CacheService.kv.set(_CONFIG.lockoutKey(userId), { count, lastFailure: now, lockedUntil }, Duration.millis(_CONFIG.lockout.maxMs));
					yield* Effect.when(incMfa('lockout_triggered'), () => lockedUntil > 0 && prev.lockedUntil <= now);
				}).pipe(Telemetry.span('totp.recordFailure', { metrics: false })),
			recordSuccess: (userId: string) => CacheService.kv.del(_CONFIG.lockoutKey(userId)).pipe(
				Effect.andThen(incMfa('verification_success')),
				Telemetry.span('totp.recordSuccess', { metrics: false }),
			),
		};
	}),
}) {}

// --- [EXPORT] ----------------------------------------------------------------

export { ReplayGuardService };
