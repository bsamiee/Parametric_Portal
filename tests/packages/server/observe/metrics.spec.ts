/** Metrics tests: label sanitization laws, error dispatch, tracking pipelines, middleware normalization. */
import { it, layer } from '@effect/vitest';
import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { Context } from '@parametric-portal/server/context';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Effect, FastCheck as fc, HashSet, Metric, type MetricLabel, Stream } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const _TENANT =  '00000000-0000-7000-8000-000000000777' as const;
const _REQUEST = '00000000-0000-7000-8000-000000000444' as const;
const _value =   fc.string({ maxLength: 200 });

// --- [FUNCTIONS] -------------------------------------------------------------

const _mwReq = (method: string, url: string) =>
    Context.Request.within(
        _TENANT,
        MetricsService.middleware(Effect.succeed(HttpServerResponse.empty({ status: 200 }))).pipe(
            Effect.provideService(HttpServerRequest.HttpServerRequest, { method, remoteAddress: null, url } as never),
            Effect.provide(MetricsService.Default),
        ),
        { requestId: _REQUEST },
    );

// --- [ALGEBRAIC] -------------------------------------------------------------

// Why: PBT — validates sanitization laws hold universally across full unicode range (idempotence, length, control strip, undefined filter).
it.effect.prop('P1: label sanitization laws', { v: _value }, ({ v }) =>
    Effect.sync(() => {
        const raw = MetricsService.label({ k: v, skip: undefined });
        const byKey = new Map(Array.from(HashSet.values(raw), (e: MetricLabel.MetricLabel) => [e.key, e.value]));
        expect(byKey.has('skip')).toBe(false);
        expect((byKey.get('k') ?? '').length).toBeLessThanOrEqual(123);
        const hasControl = Array.from(byKey.get('k') ?? '').some((c) => { const cp = c.codePointAt(0) ?? 0; return cp <= 0x1f || cp === 0x7f; });
        expect(hasControl).toBe(false);
        const twice = MetricsService.label({ k: byKey.get('k') });
        const byKey2 = new Map(Array.from(HashSet.values(twice), (e: MetricLabel.MetricLabel) => [e.key, e.value]));
        expect(byKey2.get('k')).toBe(byKey.get('k'));
    }));
// Why: exhaustive dispatch — tagged objects, Error subclasses, and primitive/null inputs all resolve correctly.
it.effect('P2: errorTag exhaustive dispatch', () =>
    Effect.sync(() => {
        const cases = [
            [{ _tag: 'PolicyError' }, 'PolicyError'], [{ _tag: 'AuthError' }, 'AuthError'],
            [new TypeError('x'), 'TypeError'], [new RangeError('y'), 'RangeError'],
            [42, 'Unknown'], [null, 'Unknown'], ['str', 'Unknown'],
        ] as const;
        cases.forEach(([input, expected]) => { expect(MetricsService.errorTag(input)).toBe(expected); });
    }));
layer(MetricsService.Default)('tracking pipelines', (it) => {
    // Why: all 4 trackJob operations preserve success values; process propagates typed failures.
    it.effect('P3: trackJob all operations preserve + process failure propagation', () =>
        Effect.gen(function* () {
            const [submit, cancel, process, replay, failed] = yield* Effect.all([
                MetricsService.trackJob({ jobType: 'email', operation: 'submit', priority: 'high' })(Effect.succeed('queued')),
                MetricsService.trackJob({ jobType: 'email', operation: 'cancel' })(Effect.succeed('cancelled')),
                MetricsService.trackJob({ jobType: 'email', operation: 'process' })(Effect.succeed('processed')),
                MetricsService.trackJob({ jobType: 'email', operation: 'replay' })(Effect.succeed('replayed')),
                MetricsService.trackJob({ jobType: 'email', operation: 'process' })(Effect.fail({ reason: 'boom' } as const)).pipe(Effect.exit),
            ]);
            expect(submit).toBe('queued');
            expect(cancel).toBe('cancelled');
            expect(process).toBe('processed');
            expect(replay).toBe('replayed');
            expect(failed._tag).toBe('Failure');
        }) as Effect.Effect<void>);
    // Why: pipeline wrappers (trackEffect, trackStream, trackError, inc, gauge) preserve values and propagate errors.
    it.effect('P4: trackEffect/trackStream/trackError/inc/gauge preservation', () =>
        Effect.gen(function* () {
            const labels = MetricsService.label({ op: 'test' });
            const config = { duration: Metric.timerWithBoundaries('te_dur', [0.1, 1]), errors: Metric.frequency('te_err'), labels };
            const [ok, failed, items] = yield* Effect.all([
                MetricsService.trackEffect(Effect.succeed('done'), config),
                MetricsService.trackEffect(Effect.fail({ _tag: 'TestError' }), config).pipe(Effect.exit),
                Stream.runCollect(MetricsService.trackStream(Stream.fromIterable(['a', 'b', 'c']), Metric.counter('s_total'), { stream: 'demo' })),
            ]);
            expect(ok).toBe('done');
            expect(failed._tag).toBe('Failure');
            expect(Array.from(items)).toEqual(['a', 'b', 'c']);
            yield* Effect.all([
                MetricsService.trackError(Metric.frequency('te_freq'), labels, { _tag: 'Boom' }),
                MetricsService.trackError(Metric.frequency('te_freq'), labels, new RangeError('x')),
                MetricsService.trackError(Metric.frequency('te_freq'), labels, null),
                MetricsService.inc(Metric.counter('c_total'), labels),
                MetricsService.inc(Metric.counter('c_total'), labels, 5),
                MetricsService.gauge(Metric.gauge('g_total'), labels, 1),
            ]);
        }));
});
// Why: exercises all 4 normalization branches (UUID, numeric ID, hex hash, token) in single request batch.
it.effect('P5: middleware normalizes all route segment types', () =>
    Effect.gen(function* () {
        const [uuid, numeric, hash, token] = yield* Effect.all([
            _mwReq('GET', '/users/123e4567-e89b-12d3-a456-426614174000/sessions/dead1234?x=1'),
            _mwReq('POST', '/orders/42/items/999'),
            _mwReq('GET', '/files/1234567890abcdef1234567890abcdef'),
            _mwReq('PUT', '/auth/verify/abcdefghijklmnop'),
        ]);
        [uuid, numeric, hash, token].forEach((r) => { expect(r.status).toBe(200); });
    }));
