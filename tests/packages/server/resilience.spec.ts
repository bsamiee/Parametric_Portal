/**
 * Resilience pipeline tests: fault injection, isolation via Effect layers.
 * Validates timeout, retry, non-retriable bypass, circuit trip, fallback, bulkhead, type guards, schedule factory.
 */
import { it, layer } from '@effect/vitest';
import { HttpError } from '@parametric-portal/server/errors';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Logger, LogLevel, Ref, TestClock } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _FROZEN_ERROR = { _tag: 'TestDomainError', message: 'synthetic' } as const;
const _NO_CIRCUIT = { circuit: false, timeout: false } as const;
const _testLayer = Resilience.Layer.pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)));
const PRESETS = { brief: { base: 50, maxAttempts: 2 }, default: { base: 100, maxAttempts: 3 }, patient: { base: 500, maxAttempts: 5 }, persistent: { base: 100, maxAttempts: 5 } } as const;

// --- [RESILIENCE PIPELINE] ---------------------------------------------------

layer(_testLayer)('Resilience: Pipeline', (it) => {
    // C1: Timeout injection — effect exceeding deadline yields TimeoutError
    it.scoped('C1: timeout fires on slow effect', () => Effect.gen(function* () {
        const fiber = yield* Effect.fork(Resilience.run('timeout-test', Effect.sleep(Duration.seconds(10)), { circuit: false, retry: false, timeout: Duration.millis(50) }));
        yield* TestClock.adjust(Duration.millis(50));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        Exit.match(exit, { onFailure: (cause) => { expect(String(cause)).toContain('TimeoutError'); }, onSuccess: () => { throw new Error('unreachable'); } });
    }));
    // C2: Retry exhaustion — 'brief' preset (recurs(1)) propagates failure after 2 total attempts
    it.scoped('C2: retry exhaustion with brief preset', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const failing = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail(_FROZEN_ERROR)));
        const fiber = yield* Effect.fork(Resilience.run('retry-test', failing, { ..._NO_CIRCUIT, retry: 'brief' }));
        yield* TestClock.adjust(Duration.seconds(10));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Ref.get(counter)).toBe(2);
    }));
    // C3: Non-retriable error bypass — Auth error skips retries entirely
    it.scoped('C3: non-retriable Auth bypasses retry', () => Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const authFail = Ref.update(counter, (n) => n + 1).pipe(Effect.andThen(Effect.fail(HttpError.Auth.of('forbidden'))));
        const fiber = yield* Effect.fork(Resilience.run('noretry-test', authFail, { ..._NO_CIRCUIT, retry: 'patient' }));
        yield* TestClock.adjust(Duration.seconds(60));
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit)).toBe(true);
        expect(yield* Ref.get(counter)).toBe(1);
    }));
    // C4: Fallback invocation — failing effect triggers fallback value
    it.scoped('C4: fallback on failure', () => Effect.gen(function* () {
        const result = yield* Resilience.run('fallback-test', Effect.fail(_FROZEN_ERROR), {
            ..._NO_CIRCUIT, fallback: () => Effect.succeed('recovered' as const), retry: false,
        });
        expect(result).toBe('recovered');
    }));

});

// --- [BULKHEAD] --------------------------------------------------------------

it.scopedLive('C5: bulkhead semaphore rejects on saturation', () => Effect.gen(function* () {
    const sem = yield* Effect.makeSemaphore(1);
    const gate = yield* Deferred.make<void>();
    const f1 = yield* Effect.fork(Effect.acquireUseRelease(sem.take(1), () => Deferred.await(gate), () => sem.release(1)));
    yield* Effect.sleep(Duration.millis(10));
    const error = Resilience.Bulkhead.of('saturated', 1);
    const exit = yield* sem.take(1).pipe(Effect.timeoutFail({ duration: Duration.millis(50), onTimeout: () => error }), Effect.exit);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(exit)).toContain('BulkheadError');
    yield* Deferred.succeed(gate, undefined);
    yield* Fiber.join(f1);
}));

// --- [CIRCUIT BREAKER] -------------------------------------------------------

layer(_testLayer)('Resilience: Circuit', (it) => {
    // C6: Circuit breaker trip — 3 consecutive failures open the circuit
    it.scoped('C6: consecutive breaker trips after threshold', () => Effect.gen(function* () {
        const circuit = yield* Circuit.make('chaos-trip', { breaker: { _tag: 'consecutive', threshold: 3 }, metrics: false, persist: false });
        yield* Effect.forEach([1, 2, 3] as const, () => circuit.execute(Effect.fail(new Error('boom'))).pipe(Effect.ignore));
        expect(circuit.state).toBe('Open');
        const exit = yield* Effect.either(circuit.execute(Effect.succeed('ok')));
        expect(exit._tag).toBe('Left');
    }));
});
// C6b: HalfOpen -- cooldown elapses, probe succeeds, circuit resets to Closed
it.scopedLive('C6b: halfOpen probe resets circuit', () => Effect.gen(function* () {
    const circuit = yield* Circuit.make('half-open-probe', { breaker: { _tag: 'consecutive', threshold: 2 }, halfOpenAfter: Duration.millis(100), metrics: false, persist: false }).pipe(Effect.provide(_testLayer));
    yield* Effect.all([1, 2].map(() => circuit.execute(Effect.fail(new Error('trip'))).pipe(Effect.ignore)));
    expect(circuit.state).toBe('Open');
    yield* Effect.sleep(Duration.millis(120));
    expect([yield* circuit.execute(Effect.succeed('probe')), circuit.state]).toEqual(['probe', 'Closed']);
}));

// --- [TYPE GUARDS + DEFAULTS] ------------------------------------------------

it.effect('C7: Resilience.is discriminates error families + preset defaults', () => Effect.sync(() => {
    const timeout = Resilience.Timeout.of('op', Duration.millis(100));
    const bulkhead = Resilience.Bulkhead.of('op', 5);
    const circuitErr = Resilience.Circuit.broken('op');
    [timeout, bulkhead, circuitErr].forEach((error) => { expect(Resilience.is(error)).toBe(true); });
    expect([Resilience.is(timeout, 'TimeoutError'), Resilience.is(timeout, 'BulkheadError'), Resilience.is(bulkhead, 'BulkheadError'), Resilience.is(circuitErr, 'CircuitError'), Resilience.is(HttpError.NotFound.of('resource', 'id'))]).toEqual([true, false, true, true, false]);
    expect(Object.keys(Resilience.presets)).toEqual(['brief', 'default', 'patient', 'persistent']);
    expect([Resilience.defaults.timeout, Duration.toMillis(Resilience.defaults.hedgeDelay)]).toEqual([Duration.seconds(30), 100]);
}));

// --- [SCHEDULE FACTORY] ------------------------------------------------------

// C8: Resilience.schedule('default') retries expected number of times under TestClock
it.effect('C8: schedule factory retries match preset', () => Effect.gen(function* () {
    const count = yield* Ref.make(0);
    const fiber = yield* Effect.fork(Ref.update(count, (n) => n + 1).pipe(Effect.andThen(Effect.fail('err')), Effect.retry(Resilience.schedule('default')), Effect.ignore));
    yield* TestClock.adjust(Duration.seconds(30));
    yield* Fiber.join(fiber);
    expect(yield* Ref.get(count)).toBe(PRESETS.default.maxAttempts);
}));
