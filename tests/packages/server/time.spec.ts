/**
 * Time-dependent behavior tests: TestClock, Fiber fork/join, Schedule, Duration.
 * Validates patterns used by resilience.ts, polling.ts, and websocket.ts.
 */
import { it } from '@effect/vitest';
import { Clock, Deferred, Duration, Effect, Exit, Fiber, Ref, Schedule, TestClock } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const STALE_CONFIG = { minIntervalMs: Duration.toMillis(Duration.seconds(15)), multiplier: 2 } as const;
const WS_DURATIONS = { metaTtlMs: Duration.toMillis(Duration.hours(2)), pingMs: 30_000, pongTimeoutMs: 90_000, reaperMs: 15_000, roomTtlMs: Duration.toMillis(Duration.minutes(10)) } as const;

// --- [ALGEBRAIC: TESTCLOCK + FIBER] ------------------------------------------

// P1: TestClock starts at 0, adjust advances deterministically
it.effect('P1: clock zero + adjust', () => Effect.gen(function* () {
    const t0 = yield* Clock.currentTimeMillis;
    yield* TestClock.adjust(Duration.seconds(42));
    const t1 = yield* Clock.currentTimeMillis;
    expect(t0).toBe(0);
    expect(t1).toBe(Duration.toMillis(Duration.seconds(42)));
}));

// P2: Fiber fork/join completes after TestClock.adjust
it.effect('P2: fiber sleep resolves on adjust', () => Effect.gen(function* () {
    const fiber = yield* Effect.fork(Effect.sleep(Duration.hours(1)).pipe(Effect.as('done')));
    yield* TestClock.adjust(Duration.hours(1));
    expect(yield* Fiber.join(fiber)).toBe('done');
}));

// P3: Timeout fires under TestClock when duration elapses
it.effect('P3: timeout under TestClock', () => Effect.gen(function* () {
    const fiber = yield* Effect.fork(Effect.sleep(Duration.minutes(5)).pipe(
        Effect.timeoutFail({ duration: Duration.seconds(30), onTimeout: () => 'TIMED_OUT' as const }),
    ));
    yield* TestClock.adjust(Duration.seconds(30));
    const exit = yield* Fiber.await(fiber);
    expect(Exit.isFailure(exit)).toBe(true);
    Exit.match(exit, { onFailure: (cause) => { expect(String(cause)).toContain('TIMED_OUT'); }, onSuccess: () => { throw new Error('unreachable'); } });
}));

// P4: Multiple fibers resolve at correct virtual times
it.effect('P4: concurrent fiber ordering', () => Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<string>>([]);
    const push = (label: string) => Ref.update(log, (entries) => [...entries, label]);
    const f1 = yield* Effect.fork(Effect.sleep(Duration.seconds(10)).pipe(Effect.andThen(push('A'))));
    const f2 = yield* Effect.fork(Effect.sleep(Duration.seconds(5)).pipe(Effect.andThen(push('B'))));
    const f3 = yield* Effect.fork(Effect.sleep(Duration.seconds(15)).pipe(Effect.andThen(push('C'))));
    yield* TestClock.adjust(Duration.seconds(15));
    yield* Fiber.join(Fiber.zip(f1, Fiber.zip(f2, f3)));
    expect(yield* Ref.get(log)).toEqual(['B', 'A', 'C']);
}));

// P5: Schedule.exponential doubles delays under TestClock (no jitter)
it.effect('P5: exponential backoff progression', () => Effect.gen(function* () {
    const attempts = yield* Ref.make(0);
    const fiber = yield* Effect.fork(
        Ref.update(attempts, (n) => n + 1).pipe(
            Effect.andThen(Effect.fail('retry')),
            Effect.retry(Schedule.exponential(Duration.millis(100), 2).pipe(Schedule.intersect(Schedule.recurs(3)))),
            Effect.ignore,
        ),
    );
    yield* TestClock.adjust(Duration.millis(100));
    yield* TestClock.adjust(Duration.millis(200));
    yield* TestClock.adjust(Duration.millis(400));
    yield* Fiber.join(fiber);
    expect(yield* Ref.get(attempts)).toBe(4);
}));

// P6: Schedule.spaced fires at regular intervals (ping/reaper pattern)
it.effect('P6: spaced schedule fires N times', () => Effect.gen(function* () {
    const count = yield* Ref.make(0);
    const fiber = yield* Effect.fork(Effect.repeat(Ref.update(count, (n) => n + 1), Schedule.spaced(Duration.millis(WS_DURATIONS.pingMs)).pipe(Schedule.intersect(Schedule.recurs(2)))));
    yield* TestClock.adjust(Duration.millis(WS_DURATIONS.pingMs));
    yield* TestClock.adjust(Duration.millis(WS_DURATIONS.pingMs));
    yield* Fiber.join(fiber);
    expect(yield* Ref.get(count)).toBe(3);
}));

// --- [EDGE_CASES: DURATION + STALENESS] --------------------------------------

// P7: Duration arithmetic matches polling.ts staleness logic
it.effect('P7: staleness threshold', () => Effect.gen(function* () {
    const staleThresholdMs = STALE_CONFIG.minIntervalMs * STALE_CONFIG.multiplier;
    expect(staleThresholdMs).toBe(30_000);
    yield* TestClock.adjust(Duration.millis(staleThresholdMs - 1));
    expect((yield* Clock.currentTimeMillis) < staleThresholdMs).toBe(true);
    yield* TestClock.adjust(Duration.millis(1));
    expect((yield* Clock.currentTimeMillis) >= staleThresholdMs).toBe(true);
}));

// P9: Deferred + TestClock -- completes only after time passes
it.effect('P9: deferred gate with clock', () => Effect.gen(function* () {
    const gate = yield* Deferred.make<string>();
    const fiber = yield* Effect.fork(Effect.sleep(Duration.seconds(5)).pipe(Effect.andThen(Deferred.succeed(gate, 'opened'))));
    expect(yield* Deferred.isDone(gate)).toBe(false);
    yield* TestClock.adjust(Duration.seconds(5));
    yield* Fiber.join(fiber);
    expect(yield* Deferred.await(gate)).toBe('opened');
}));
