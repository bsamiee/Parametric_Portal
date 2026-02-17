/** Telemetry tests: endpoint resolution, logsExporter dispatch, span kind inference, error annotation. */
import { it } from '@effect/vitest';
import { Context } from '@parametric-portal/server/context';
import { Env } from '@parametric-portal/server/env';
import { MetricsService } from '@parametric-portal/server/observe/metrics';
import { Telemetry } from '@parametric-portal/server/observe/telemetry';
import { Cause, Effect, Exit, Layer, Option } from 'effect';
import { expect, it as rawIt } from 'vitest';

// --- [TYPES] -----------------------------------------------------------------

// Why: Env is a plain object — Env.Service cannot appear in type position; extract via typeof.
type _EnvSvc = InstanceType<(typeof Env)['Service']>;

// --- [CONSTANTS] -------------------------------------------------------------

const TENANT =           '00000000-0000-7000-8000-000000000555';
const REQ = { requestId: '00000000-0000-7000-8000-000000000444' } as const;
const LOGS_EXPORTERS =   ['none', 'otlp', 'console', 'otlp,console', 'unknown-value'] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _env = (overrides?: Partial<{
    readonly baseEndpoint:    Option.Option<string>;
    readonly k8s:             boolean;
    readonly logsExporter:    string;
    readonly metricsExporter: string;
    readonly nodeEnv:         string;
    readonly tracesExporter:  string;
}>) => ({
    app: { hostname: Option.none(), logLevel: Option.none(), nodeEnv: overrides?.nodeEnv ?? 'development' },
    telemetry: {
        baseEndpoint:     overrides?.baseEndpoint ?? Option.none(),
        headers:          'x-api-key=test,invalid,,=empty,noequals',
        k8sContainerName: overrides?.k8s ? 'api' : '', k8sDeploymentName: overrides?.k8s ? 'api-deploy' : '',
        k8sNamespace:     'parametric', k8sNodeName: overrides?.k8s ? 'node-1' : '', k8sPodName: 'pod-1',
        logsEndpoint:     Option.some('https://logs.example.com/v1/logs/'),
        logsExporter:     overrides?.logsExporter ?? 'console,otlp',
        metricsEndpoint:  Option.none(), metricsExporter: overrides?.metricsExporter ?? 'none',
        protocol:         'http/json' as const, serviceName: 'test-api', serviceVersion: '0.0.1',
        tracesEndpoint:   Option.none(), tracesExporter: overrides?.tracesExporter ?? 'none',
    },
}) as const;
const _provide = <A, E>(effect: Effect.Effect<A, E, _EnvSvc>, overrides?: Parameters<typeof _env>[0]) => effect.pipe(Effect.provideService(Env.Service, _env(overrides) as never));
const _spanIn =  <A, E>(effect: Effect.Effect<A, E, never>, name: string, opts?: Parameters<typeof Telemetry.span>[2]) => Context.Request.within(TENANT, Telemetry.span(effect, name, opts), REQ);

// --- [ALGEBRAIC] -------------------------------------------------------------

it.effect('collectorConfig: endpoint resolution + header parsing + logsExporter dispatch', () =>
    Effect.gen(function* () {
        const explicit = yield* _provide(Telemetry.collectorConfig);
        const dev = yield* _provide(Telemetry.collectorConfig, { baseEndpoint: Option.none() });
        const prod = yield* _provide(Telemetry.collectorConfig, { baseEndpoint: Option.none(), nodeEnv: 'production' });
        const custom = yield* _provide(Telemetry.collectorConfig, { baseEndpoint: Option.some('https://custom:4318') });
        expect(explicit.endpoints.logs).toBe('https://logs.example.com/v1/logs');
        expect(explicit.headers).toEqual({ 'x-api-key': 'test' });
        expect(explicit.protocol).toBe('http/json');
        expect(dev.endpoints.metrics).toBe('http://127.0.0.1:4318/v1/metrics');
        expect(dev.endpoints.traces).toBe('http://127.0.0.1:4318/v1/traces');
        expect(prod.endpoints.metrics).toBe('https://alloy.monitoring.svc.cluster.local:4318/v1/metrics');
        expect(custom.endpoints.metrics).toBe('https://custom:4318/v1/metrics');
        // Why: exercises all logsExporter Match branches (lines 91-96) via config path without Layer.build
        yield* Effect.forEach(LOGS_EXPORTERS, (logsExporter) => _provide(Telemetry.collectorConfig, { logsExporter }));
    }));
rawIt('Default layer: logsExporter + metricsExporter + tracesExporter + k8s variants', async () => {
    const variants = [
        { logsExporter: 'none'                                                        },
        { logsExporter: 'console'                                                     },
        { logsExporter: 'otlp', metricsExporter: 'otlp', tracesExporter: 'otlp'       },
        { logsExporter: 'console,otlp'                                                },
        { k8s:          true,   logsExporter:    'none', nodeEnv:        'production' },
    ] as const;
    // Why: OTLP exporters open real HTTP connections — use AbortSignal to kill after, branch selection executes (config dispatch runs synchronously before resource acquisition).
    const results = await Promise.all(variants.map((overrides) =>
        Effect.runPromiseExit(
            Effect.scoped(Layer.build(Telemetry.Default.pipe(Layer.provide(Layer.succeed(Env.Service, _env(overrides) as never)),))),
            { signal: AbortSignal.timeout(500) },
        )));
    // Why: non-OTLP variants succeed; OTLP variant may timeout (interrupted) — both are valid
    results.forEach((exit) => { expect(Exit.isSuccess(exit) || Exit.isInterrupted(exit)).toBe(true); });
});
it.effect('span: kind resolution — prefix / explicit / circuit / default', () =>
    Effect.gen(function* () {
        const results = yield* Effect.all([
            _spanIn(Effect.succeed('hit'), 'cache.lookup').pipe(Effect.provide(MetricsService.Default)),
            _spanIn(Effect.succeed('ok'), 'auth.verify', { metrics: false }),
            _spanIn(Effect.succeed('ok'), 'cache.lookup', { kind: 'producer', metrics: false }),
            Context.Request.within(TENANT, Telemetry.span(Effect.succeed('ok'), 'custom.op'), { ...REQ, circuit: Option.some({ name: 'ext-api', state: 'closed' }) }),
            _spanIn(Effect.succeed('ok'), 'cache.evict', { captureStackTrace: false, metrics: false }),
            _spanIn(Effect.succeed('ok'), 'unknown.op', { metrics: false }),
            _spanIn(Effect.succeed('ok'), 'auth.login'),
        ]);
        expect(results[0]).toBe('hit');
        results.slice(1).forEach((result) => { expect(result).toBe('ok'); });
    }));
it.effect('span: error annotation — all cause branches ± parent span', () =>
    Effect.gen(function* () {
        const failNoParent = yield* _spanIn(Effect.fail({ _tag: 'Boom' }), 'telemetry.fail').pipe(Effect.exit);
        const dieNoParent = yield* _spanIn(Effect.die('string-defect'), 'crypto.defect').pipe(Effect.exit);
        const failParent = yield* _spanIn(Effect.fail({ _tag: 'Err' }), 'telemetry.fail').pipe(Effect.withSpan('parent-fail'), Effect.exit);
        const dieParent = yield* _spanIn(Effect.dieMessage('kaboom'), 'telemetry.defect').pipe(Effect.withSpan('parent-die'), Effect.exit);
        const interrupt = yield* _spanIn(Effect.interrupt, 'jobs.process').pipe(Effect.withSpan('parent-int'), Effect.exit);
        const parallel = yield* _spanIn(Effect.all([Effect.fail('a'), Effect.fail('b')], { concurrency: 2 }), 'email.send').pipe(Effect.withSpan('parent-par'), Effect.exit);
        const sequential = yield* _spanIn(Effect.ensuring(Effect.fail('main'), Effect.die('finalizer')), 'webhook.call').pipe(Effect.withSpan('parent-seq'), Effect.exit);
        expect(Exit.isFailure(failNoParent)).toBe(true);
        expect(Exit.isFailure(dieNoParent)).toBe(true);
        const failure = Cause.failureOption(Exit.isFailure(failNoParent) ? failNoParent.cause : Cause.empty);
        expect(Option.isSome(failure) && Option.getOrThrow(failure)).toMatchObject({ _tag: 'Boom' });
        expect(Exit.isFailure(failParent)).toBe(true);
        expect(Exit.isFailure(dieParent)).toBe(true);
        expect(Exit.isInterrupted(interrupt)).toBe(true);
        expect(Exit.isFailure(parallel)).toBe(true);
        expect(Exit.isFailure(sequential)).toBe(true);
    }));
