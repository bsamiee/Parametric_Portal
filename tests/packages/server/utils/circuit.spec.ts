/**
 * Circuit breaker tests: FSM laws, registry lifecycle, error discrimination.
 */
import { it } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Circuit } from '@parametric-portal/server/utils/circuit';
import { Duration, Effect, FastCheck as fc, Layer, Option } from 'effect';
import { expect } from 'vitest';

// --- [FUNCTIONS] -------------------------------------------------------------

const _provide = <A, E, R>(eff: Effect.Effect<A, E, R>) => eff.pipe(Effect.provide(Circuit.Layer));
const _fail = () => Effect.fail(new Error('x'));
const _trip = (cb: Circuit.Instance, n: number) => Effect.forEach(Array.from({ length: n }, (_, i) => i), () => cb.execute(_fail()).pipe(Effect.flip));

// --- [ALGEBRAIC] -------------------------------------------------------------

// P1: Monotonicity — consecutive breaker opens at exactly threshold N, not before
it.effect.prop('P1: monotonicity — trip at threshold N', { threshold: fc.integer({ max: 5, min: 1 }) }, ({ threshold }) =>
    _provide(Effect.gen(function* () {
        const cb = yield* Circuit.make(`p1-${threshold}`, { breaker: { _tag: 'consecutive', threshold }, persist: false });
        yield* _trip(cb, threshold - 1);
        expect(cb.state).toBe('Closed');
        yield* cb.execute(_fail()).pipe(Effect.flip);
        expect(cb.state).toBe('Open');
    })),
);
// P2: Determinism + Inverse + Annihilation + Idempotent — packed algebraic laws
it.effect('P2: determinism + inverse + annihilation + idempotent', () =>
    _provide(Effect.gen(function* () {
        const a = yield* Circuit.make('p2-det');
        expect(yield* Circuit.make('p2-det')).toBe(a);
        const inv = yield* Circuit.make('p2-inv', { persist: false });
        const handle = inv.isolate();
        expect((yield* inv.execute(Effect.succeed('x')).pipe(Effect.flip))).toEqual(expect.objectContaining({ _tag: 'CircuitError', reason: 'Isolated' }));
        handle.dispose();
        expect(yield* inv.execute(Effect.succeed('ok'))).toBe('ok');
        expect(yield* Circuit.gc()).toEqual({ removed: 0 });
        yield* Circuit.clear();
        yield* Circuit.clear();
        expect(yield* Circuit.stats()).toEqual([]);
    })));
// P3: Full FSM — Closed → Open → HalfOpen → Closed + BrokenCircuit rejection
it.effect('P3: FSM cycle + broken circuit rejection', () =>
    _provide(Effect.gen(function* () {
        const cb = yield* Circuit.make('p3-fsm', { breaker: { _tag: 'consecutive', threshold: 1 }, halfOpenAfter: Duration.millis(0), persist: false });
        expect(cb.state).toBe('Closed');
        yield* cb.execute(_fail()).pipe(Effect.flip);
        expect(cb.state).toBe('Open');
        expect(yield* cb.execute(Effect.succeed('probe'))).toBe('probe');
        expect(cb.state).toBe('Closed');
        const brk = yield* Circuit.make('p3-brk', { breaker: { _tag: 'consecutive', threshold: 2 }, persist: false });
        yield* _trip(brk, 2);
        expect(yield* brk.execute(Effect.succeed('blocked')).pipe(Effect.flip)).toEqual(expect.objectContaining({ _tag: 'CircuitError', reason: 'BrokenCircuit' }));
    })));
// P4: All breaker variants — count + sampling defaults + onStateChange callback
it.effect('P4: breaker variants + onStateChange callback', () =>
    _provide(Effect.gen(function* () {
        const changes: Array<string> = [];
        const [count, sampling, countCb] = yield* Effect.all([
            Circuit.make('p4-count', { breaker: { _tag: 'count', minimumNumberOfCalls: 2, size: 2, threshold: 0.5 }, persist: false }),
            Circuit.make('p4-samp', { breaker: { _tag: 'sampling' }, persist: false }),
            Circuit.make('p4-cb', { breaker: { _tag: 'count' }, metrics: false, onStateChange: (c) => Effect.sync(() => { changes.push(`${c.previous}->${c.state}`); }), persist: false }),
        ]);
        yield* _trip(count, 2);
        expect(count.state).toBe('Open');
        yield* sampling.execute(_fail()).pipe(Effect.flip);
        expect(sampling.state).toBe('Open');
        yield* _trip(countCb, 100);
        expect(countCb.state).toBe('Open');
        expect(changes).toContain('Closed->Open');
    })));
// P5: Error factories + type guard exhaustive discrimination
it.effect('P5: error algebra + type guards', () =>
    Effect.sync(() => {
        const errors = [Circuit.Error.broken('svc'), Circuit.Error.isolated('svc'), Circuit.Error.execution('svc', new Error('boom'))] as const;
        expect(errors.map((e) => [e._tag, e.reason, e.circuit])).toEqual([['CircuitError', 'BrokenCircuit', 'svc'], ['CircuitError', 'Isolated', 'svc'], ['CircuitError', 'ExecutionFailed', 'svc'],]);
        expect(errors[2].message).toContain('ExecutionFailed');
        const broken = Circuit.Error.broken('g');
        expect([Circuit.is(broken), Circuit.is(broken, 'BrokenCircuit'), Circuit.is(broken, 'Isolated')]).toEqual([true, true, false]);
        expect([Circuit.is({ _tag: 'CircuitError', reason: 'BrokenCircuit' }), Circuit.is({ unrelated: true }), Circuit.is(null)]).toEqual([true, false, false]);
    }));

// --- [EDGE_CASES] ------------------------------------------------------------

// E1: Registry lifecycle — get, stats, toJSON, context propagation, default breaker threshold
it.effect('E1: registry lifecycle + context + default breaker', () =>
    _provide(Effect.gen(function* () {
        const alpha = yield* Circuit.make('e1-a');
        yield* Circuit.make('e1-b');
        expect(yield* Circuit.get('e1-a')).toEqual(Option.some(alpha));
        expect((yield* Circuit.stats()).map((e) => e.name).sort((a, b) => a.localeCompare(b))).toEqual(['e1-a', 'e1-b']);
        expect(alpha.toJSON()).toEqual({ name: 'e1-a', state: 'Closed' });
        yield* Circuit.clear();
        expect(yield* Circuit.stats()).toEqual([]);
        yield* Context.Request.update({ circuit: Option.some({ name: 'e1-ctx', state: 'Open' }) });
        expect(yield* Circuit.current).toEqual(Option.some({ name: 'e1-ctx', state: 'Open' }));
        const def = yield* Circuit.make('e1-def', { persist: false });
        yield* _trip(def, 5);
        expect(def.state).toBe('Open');
    })));
// E2: GC eviction + dispose removal (live — real timers for staleness window)
it.live('E2: gc eviction + dispose removal', () =>
    _provide(Effect.gen(function* () {
        yield* Circuit.make('e2-stale');
        yield* Circuit.make('e2-fresh');
        yield* Effect.sleep(Duration.millis(50));
        yield* Circuit.make('e2-fresh');
        expect(yield* Circuit.gc(25 as never)).toEqual({ removed: 1 });
        expect(yield* Circuit.get('e2-stale')).toEqual(Option.none());
        expect(Option.isSome(yield* Circuit.get('e2-fresh'))).toBe(true);
        const disp = yield* Circuit.make('e2-disp');
        disp.dispose();
        yield* Effect.sleep(Duration.millis(50));
        expect(yield* Circuit.get('e2-disp')).toEqual(Option.none());
    })));
// E3: Metrics layer integration — state change fires with MetricsService provided
it.effect('E3: metrics layer integration', () =>
    Effect.gen(function* () {
        const cb = yield* Circuit.make('e3-met', { breaker: { _tag: 'consecutive', threshold: 1 }, persist: false });
        yield* cb.execute(_fail()).pipe(Effect.flip);
        expect(cb.state).toBe('Open');
    }).pipe(Effect.provide(Layer.merge(Circuit.Layer, MetricsService.Default))));
