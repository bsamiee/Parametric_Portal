/**
 * Chaos/fault injection tests: Resilience pipeline isolation via Effect layers.
 * Validates timeout, retry, non-retriable bypass, circuit trip, fallback, bulkhead, type guards.
 */
import { it, layer } from '@effect/vitest';
import { HttpError } from '@parametric-portal/server/errors';
import { Resilience } from '@parametric-portal/server/utils/resilience';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Logger, LogLevel, Ref, TestClock } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _FROZEN_ERROR = Object.freeze({ _tag: 'TestDomainError', message: 'synthetic' }) as const;
const _NO_CIRCUIT = { circuit: false, timeout: false } as const;
const _testLayer = Resilience.Layer.pipe(Layer.provide(Logger.minimumLogLevel(LogLevel.Warning)));

// --- [CHAOS: RESILIENCE PIPELINE] --------------------------------------------

layer(_testLayer)('Chaos: Resilience', (it) => {
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

// --- [CHAOS: BULKHEAD] -------------------------------------------------------

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

// --- [CHAOS: CIRCUIT BREAKER] ------------------------------------------------

layer(_testLayer)('Chaos: Circuit', (it) => {
    // C6: Circuit breaker trip — 3 consecutive failures open the circuit
    it.scoped('C6: consecutive breaker trips after threshold', () => Effect.gen(function* () {
        const circuit = yield* Circuit.make('chaos-trip', { breaker: { _tag: 'consecutive', threshold: 3 }, metrics: false, persist: false });
        yield* Effect.forEach([1, 2, 3] as const, () => circuit.execute(Effect.fail(new Error('boom'))).pipe(Effect.ignore));
        expect(circuit.state).toBe('Open');
        const exit = yield* Effect.either(circuit.execute(Effect.succeed('ok')));
        expect(exit._tag).toBe('Left');
    }));
});

// --- [CHAOS: TYPE GUARDS] ----------------------------------------------------

it.effect('C7: Resilience.is discriminates error families', () => Effect.sync(() => {
    const timeout = Resilience.Timeout.of('op', Duration.millis(100));
    const bulkhead = Resilience.Bulkhead.of('op', 5);
    const circuitErr = Resilience.Circuit.broken('op');
    const domainErr = HttpError.NotFound.of('resource', 'id');
    [timeout, bulkhead, circuitErr].forEach((error) => { expect(Resilience.is(error)).toBe(true); });
    expect(Resilience.is(timeout, 'TimeoutError')).toBe(true);
    expect(Resilience.is(timeout, 'BulkheadError')).toBe(false);
    expect(Resilience.is(bulkhead, 'BulkheadError')).toBe(true);
    expect(Resilience.is(circuitErr, 'CircuitError')).toBe(true);
    expect(Resilience.is(domainErr)).toBe(false);
}));
