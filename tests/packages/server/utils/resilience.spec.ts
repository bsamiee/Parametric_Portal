/**
 * Resilience tests: timeout, retry, non-retriable bypass, circuit, fallback,
 * bulkhead, hedge, onExhaustion, type guards, defaults, schedule factory.
 */
import { it, layer } from '@effect/vitest';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Array as A, Cause, Duration, Effect, Exit, FastCheck as fc, Fiber, Layer, Logger, LogLevel, Ref, Schedule, TestClock } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _FROZEN_ERROR = { _tag: 'TestDomainError', message: 'synthetic' } as const;
const _NO_CIRCUIT =   { circuit: false, timeout: false } as const;

// --- [LAYER] -----------------------------------------------------------------

const _testLayer = Resilience.Layer.pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)));

// --- [ALGEBRAIC] -------------------------------------------------------------

// P1: Non-retriable tags bypass retry — exactly 1 attempt regardless of config
it.effect.prop('P1: non-retriable tags bypass retry',
    { tag: fc.constantFrom('Auth', 'Conflict', 'Forbidden', 'Gone', 'NotFound', 'RateLimit', 'Validation') },
    ({ tag }) => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail({ _tag: tag, message: `${tag} error` })));
        const fiber = yield* Effect.fork(Resilience.run(`noretry-${tag}`, failing, { ..._NO_CIRCUIT, retry: 'patient' }));
        yield* TestClock.adjust(Duration.seconds(60));
        yield* Fiber.await(fiber);
        expect(yield* Ref.get(counter)).toBe(1);
    }).pipe(Effect.provide(_testLayer)), { fastCheck: { numRuns: 7 } });
// P2: Type guard determinism — resilience errors partition into exactly 3 families
it.effect('P2: type guards partition error families', () => Effect.sync(() => {
    const timeout = Resilience.Timeout.of('op', Duration.millis(100));
    const bulkhead = Resilience.Bulkhead.of('op', 5);
    const circuitErr = Resilience.Circuit.broken('op');
    const nonResilience = { _tag: 'NotFound', message: 'nope' };
    expect([Resilience.is(timeout), Resilience.is(bulkhead), Resilience.is(circuitErr), Resilience.is(nonResilience)]).toEqual([true, true, true, false]);
    expect([Resilience.is(timeout, 'TimeoutError'), Resilience.is(timeout, 'BulkheadError'), Resilience.is(timeout, 'CircuitError')]).toEqual([true, false, false]);
    expect([Resilience.is(bulkhead, 'BulkheadError'), Resilience.is(circuitErr, 'CircuitError')]).toEqual([true, true]);
}));
// P3-P10: Pipeline behaviors via Resilience.run
layer(_testLayer)('Resilience: Pipeline', (it) => {
    it.scoped('P3: annihilation — all features disabled yields identity', () => Effect.gen(function* () {
        expect(yield* Resilience.run('identity', Effect.succeed(42), { bulkhead: false, circuit: false, hedge: false, retry: false, timeout: false })).toBe(42);
    }));
    it.scoped('P4: timeout fires on slow effect', () => Effect.gen(function* () {
        const fiber = yield* Effect.fork(Resilience.run('timeout-test', Effect.sleep(Duration.seconds(10)), { circuit: false, retry: false, timeout: Duration.millis(50) }));
        yield* TestClock.adjust(Duration.millis(50));
        expect(Exit.match(yield* Fiber.await(fiber), { onFailure: (cause) => Cause.pretty(cause), onSuccess: () => '' })).toContain('TimeoutError');
    }));
    it.scoped('P5: retry exhaustion with brief preset', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail(_FROZEN_ERROR)));
        const fiber = yield* Effect.fork(Resilience.run('retry-test', failing, { ..._NO_CIRCUIT, retry: 'brief' }));
        yield* TestClock.adjust(Duration.seconds(10));
        expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
        expect(yield* Ref.get(counter)).toBe(2);
    }));
    it.scoped('P6: fallback substitution', () => Effect.gen(function* () {
        expect(yield* Resilience.run('fallback-test', Effect.fail(_FROZEN_ERROR), { ..._NO_CIRCUIT, fallback: () => Effect.succeed('recovered' as const), retry: false })).toBe('recovered');
    }));
    it.scoped('P7: onExhaustion fires before fallback', () => Effect.gen(function* () {
        const exhaustionRef = yield* Ref.make<string>('none');
        const result = yield* Resilience.run('exhaust-test', Effect.fail(_FROZEN_ERROR), {
            ..._NO_CIRCUIT,
            fallback: () => Effect.succeed('fell-back' as const),
            onExhaustion: (error, operation) => Ref.set(exhaustionRef, `${operation}:${(error as { _tag?: string })._tag}`),
            retry: false,
        });
        expect([result, yield* Ref.get(exhaustionRef)]).toEqual(['fell-back', 'exhaust-test:TestDomainError']);
    }));
    it.scoped('P8: circuit trips via Resilience.run', () => Effect.gen(function* () {
        yield* Effect.forEach(A.range(1, 5), () => Resilience.run('circuit-run', Effect.fail(_FROZEN_ERROR), { circuit: 'circuit-run', retry: false, threshold: 3, timeout: false }).pipe(Effect.ignore));
        expect(Exit.isFailure(yield* Resilience.run('circuit-run', Effect.succeed('ok'), { circuit: 'circuit-run', retry: false, timeout: false }).pipe(Effect.exit))).toBe(true);
    }));
    it.scoped('P9: hedge races concurrent attempts', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const slow = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.sleep(Duration.seconds(5))), Effect.andThen(Effect.succeed('hedged')));
        const fiber = yield* Effect.fork(Resilience.run('hedge-test', slow, { ..._NO_CIRCUIT, hedge: 3, retry: false }));
        yield* TestClock.adjust(Duration.seconds(10));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isSuccess(exit)).toBe(true);
        expect(yield* Ref.get(counter)).toBeGreaterThanOrEqual(1);
    }));
    it.scoped('P10: hedge with config object + retry true', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const slow = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.sleep(Duration.seconds(1))), Effect.andThen(Effect.succeed('ok')));
        const fiber = yield* Effect.fork(Resilience.run('hedge-cfg', slow, {..._NO_CIRCUIT, hedge: { attempts: 2, delay: Duration.millis(50) }, retry: true,}));
        yield* TestClock.adjust(Duration.seconds(10));
        expect(Exit.isSuccess(yield* Fiber.await(fiber))).toBe(true);
    }));
});

// --- [EDGE_CASES] ------------------------------------------------------------

// E1: Bulkhead with and without timeout — exercises bulkhead Match branches
layer(_testLayer)('Resilience: Bulkhead', (it) => {
    it.scoped('E1: bulkhead without timeout succeeds sequentially', () => Effect.gen(function* () {
        const config = { bulkhead: 1, circuit: false, retry: false, timeout: false } as const;
        const [a, b] = yield* Effect.all([
            Resilience.run('bh-seq', Effect.succeed('first'), config),
            Resilience.run('bh-seq', Effect.succeed('second'), config),
        ]);
        expect([a, b]).toEqual(['first', 'second']);
    }));
    it.scoped('E2: bulkhead with timeout succeeds when permits available', () => Effect.gen(function* () {
        const config = { bulkhead: 2, bulkheadTimeout: Duration.millis(500), circuit: false, retry: false, timeout: false } as const;
        expect(yield* Resilience.run('bh-ok', Effect.succeed('passed'), config)).toBe('passed');
    }));
});
// E3: Error messages + schedule (preset and config overloads)
it.effect('E3: error messages + schedule overloads', () => Effect.gen(function* () {
    expect(Resilience.Bulkhead.of('op', 3).message).toContain('op');
    expect(Resilience.Timeout.of('op', Duration.millis(500)).message).toContain('500');
    const count = yield* Ref.make(0);
    const bump = Ref.update(count, (n) => n + 1).pipe(Effect.andThen(Effect.fail('err')));
    const f1 = yield* Effect.fork(bump.pipe(Effect.retry(Resilience.schedule('brief')), Effect.ignore));
    const f2 = yield* Effect.fork(bump.pipe(Effect.retry(Resilience.schedule({ base: Duration.millis(50), factor: 3, maxAttempts: 2 })), Effect.ignore));
    yield* TestClock.adjust(Duration.seconds(10));
    yield* Effect.all([Fiber.join(f1), Fiber.join(f2)]);
    expect(yield* Ref.get(count)).toBe(4);
}));
// E4: halfOpen probe resets circuit
it.scopedLive('E4: halfOpen probe resets circuit', () => Effect.gen(function* () {
    const circuit = yield* Circuit.make('half-open-probe', { breaker: { _tag: 'consecutive', threshold: 2 }, halfOpenAfter: Duration.millis(100), metrics: false, persist: false }).pipe(Effect.provide(_testLayer));
    yield* Effect.forEach(A.range(1, 2), () => circuit.execute(Effect.fail(new Error('trip'))).pipe(Effect.ignore));
    expect(circuit.state).toBe('Open');
    yield* Effect.sleep(Duration.millis(120));
    expect([yield* circuit.execute(Effect.succeed('probe')), circuit.state]).toEqual(['probe', 'Closed']);
}));
// E6-E8: Circuit error propagation + custom schedule + default config
layer(_testLayer)('Resilience: Circuit propagation', (it) => {
    it.scoped('E6: circuit error bypasses fallback and onExhaustion', () => Effect.gen(function* () {
        const exhausted = yield* Ref.make(false);
        const fellBack = yield* Ref.make(false);
        const tripConfig = { circuit: 'circ-prop', retry: false, threshold: 2, timeout: false } as const;
        yield* Effect.forEach(A.range(1, 3), () => Resilience.run('circ-prop', Effect.fail(_FROZEN_ERROR), tripConfig).pipe(Effect.ignore));
        const exit = yield* Resilience.run('circ-prop', Effect.succeed('ok'), {
            ...tripConfig,
            fallback: () => Ref.set(fellBack, true).pipe(Effect.andThen(Effect.succeed('fb'))),
            onExhaustion: () => Ref.set(exhausted, true),
        }).pipe(Effect.exit);
        expect([Exit.isFailure(exit), yield* Ref.get(exhausted), yield* Ref.get(fellBack)]).toEqual([true, false, false]);
    }));
    it.scoped('E7: retry with custom schedule object', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const customSchedule = Schedule.recurs(1).pipe(Schedule.intersect(Schedule.exponential(Duration.millis(10))));
        const failing = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail(_FROZEN_ERROR)));
        const fiber = yield* Effect.fork(Resilience.run('custom-sched', failing, { ..._NO_CIRCUIT, retry: customSchedule }));
        yield* TestClock.adjust(Duration.seconds(5));
        yield* Fiber.await(fiber);
        expect(yield* Ref.get(counter)).toBe(2);
    }));
    it.scoped('E8: default config uses timeout + retry + circuit', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail(_FROZEN_ERROR)));
        const fiber = yield* Effect.fork(Resilience.run('defaults-test', failing));
        yield* TestClock.adjust(Duration.minutes(2));
        yield* Fiber.await(fiber);
        expect(yield* Ref.get(counter)).toBeGreaterThan(1);
    }));
});
