/** ReplayGuard tests: TOTP replay detection, lockout escalation, brute-force protection. */
import { it } from '@effect/vitest';
import { CacheService } from '@parametric-portal/server/platform/cache';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { ReplayGuardService } from '@parametric-portal/server/security/totp-replay';
import { Clock, Effect, Option } from 'effect';
import { expect, vi } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _state = vi.hoisted(() => ({
    deleted:  [] as string[],
    lockouts: new Map<string, { count: number; lastFailure: number; lockedUntil: number }>(),
    marks:    new Set<string>(),
    sets:     [] as Array<{ key: string; value: string }>,
}));
const _cache = {
    _redis: {
        set: (key: string, value: string, _mode: string, _ttlMs: number, _nx: string) => {
            _state.sets.push({ key, value });
            const alreadyMarked = _state.marks.has(key);
            _state.marks.add(key);
            return Promise.resolve(alreadyMarked ? null : 'OK');
        },
    },
    kv: {
        del: (key: string) => Effect.sync(() => { _state.deleted.push(key); _state.lockouts.delete(key); }),
        get: (key: string, _schema: unknown) => Effect.sync(() => Option.fromNullable(_state.lockouts.get(key))),
        set: (key: string, value: { count: number; lastFailure: number; lockedUntil: number }, _ttl: unknown) => Effect.sync(() => { _state.lockouts.set(key, value); }),
    },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _reset = () => { _state.deleted.length = 0; _state.sets.length = 0; _state.marks.clear(); _state.lockouts.clear(); };
const _provide = <A, E>(effect: Effect.Effect<A, E, unknown>) => effect.pipe(
    Effect.provide(ReplayGuardService.Default),
    Effect.provideService(CacheService, _cache as never),
) as Effect.Effect<A, E, never>;
const _provideWithMetrics = <A, E>(effect: Effect.Effect<A, E, unknown>) => effect.pipe(
    Effect.provide(ReplayGuardService.Default),
    Effect.provide(MetricsService.Default),
    Effect.provideService(CacheService, _cache as never),
) as Effect.Effect<A, E, never>;

// --- [MOCKS] -----------------------------------------------------------------

vi.mock('@parametric-portal/server/observe/telemetry', async () => {
    const { identity } = await import('effect/Function');
    return { Telemetry: { span: (_name: string, _opts: unknown) => identity } };
});
vi.mock('@parametric-portal/server/observe/metrics', async () => {
    const { Context, Effect, HashSet, Layer, Metric } = await import('effect');
    const _counter = Metric.counter('test_mfa_verifications_total');
    class MetricsService extends Context.Tag('server/Metrics')<MetricsService, { readonly mfa: { readonly verifications: typeof _counter } }>() {
        static readonly Default = Layer.succeed(MetricsService, { mfa: { verifications: _counter } });
        static readonly inc = (_counter: unknown, _labels: unknown, _value?: number) => Effect.void;
        static readonly label = (_pairs: Record<string, string | undefined>) => HashSet.empty();
    }
    return { MetricsService };
});

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('P1: checkAndMark idempotent — first marks, second detects replay', () =>
    Effect.gen(function* () {
        _reset();
        const replay = yield* ReplayGuardService;
        const [first, second] = yield* Effect.all([replay.checkAndMark('u-1', 10, '123456'), replay.checkAndMark('u-1', 10, '123456')]);
        expect(first).toEqual({ alreadyUsed: false, backend: 'redis' });
        expect(second).toEqual({ alreadyUsed: true, backend: 'redis' });
        expect(_state.sets[0]).toEqual({ key: 'totp:u-1:10:123456', value: '1' });
        expect(_state.marks.has('totp:u-1:10:123456')).toBe(true);
    }).pipe(_provide));
it.effect('P2: lockout escalation + checkLockout blocks + recordSuccess resets', () =>
    Effect.gen(function* () {
        _reset();
        const replay = yield* ReplayGuardService;
        yield* replay.recordFailure('u-2');
        expect(_state.lockouts.get('totp:lockout:u-2')?.lockedUntil).toBe(0);
        yield* Effect.forEach([2, 3, 4, 5], () => replay.recordFailure('u-2'), { discard: true });
        const lock = _state.lockouts.get('totp:lockout:u-2');
        expect(lock?.count).toBe(5);
        expect((lock?.lockedUntil ?? 0) > (lock?.lastFailure ?? 0)).toBe(true);
        const rateLimit = yield* Effect.flip(replay.checkLockout('u-2'));
        expect(rateLimit._tag).toBe('RateLimit');
        expect(rateLimit.recoveryAction).toBe('email-verify');
        expect(rateLimit.retryAfterMs).toBeGreaterThan(0);
        expect(rateLimit.retryAfterMs).toBeLessThanOrEqual(900_000);
        yield* replay.recordSuccess('u-2');
        const afterReset = yield* Effect.exit(replay.checkLockout('u-2'));
        expect(String(afterReset)).toContain('Success');
    }).pipe(_provide));
it.effect('P3: existing lockout increments + caps window at max', () =>
    Effect.gen(function* () {
        _reset();
        _state.lockouts.set('totp:lockout:u-3', { count: 32, lastFailure: 1, lockedUntil: 2 });
        const replay = yield* ReplayGuardService;
        const now = yield* Clock.currentTimeMillis;
        yield* replay.recordFailure('u-3');
        const state = _state.lockouts.get('totp:lockout:u-3');
        const delta = (state?.lockedUntil ?? 0) - (state?.lastFailure ?? 0);
        expect(state?.count).toBe(33);
        expect(delta).toBeLessThanOrEqual(900_000);
        expect(delta).toBeGreaterThan(0);
        _state.lockouts.set('totp:lockout:u-4', { count: 1, lastFailure: now, lockedUntil: now });
        yield* replay.checkLockout('u-4');
    }).pipe(_provide));
it.effect('P4: metrics integration — incMfa fires with MetricsService provided', () =>
    Effect.gen(function* () {
        _reset();
        const replay = yield* ReplayGuardService;
        const result = yield* replay.checkAndMark('u-m1', 42, '999999');
        expect(result).toEqual({ alreadyUsed: false, backend: 'redis' });
        yield* replay.recordFailure('u-m1');
        yield* replay.recordSuccess('u-m1');
        expect(_state.deleted).toContain('totp:lockout:u-m1');
    }).pipe(_provideWithMetrics));
