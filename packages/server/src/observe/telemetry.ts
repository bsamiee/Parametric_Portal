/**
 * Expose unified telemetry: OTLP export, intelligent span wrapper, auto-captured context.
 * Zero-ceremony observability with auto-inferred SpanKind, error tracking, metrics integration.
 */
import { OtlpLogger, OtlpMetrics, OtlpSerialization, OtlpTracer } from '@effect/opentelemetry';
import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Array as A, Cause, Clock, Duration, Effect, FiberId, HashSet, Layer, Logger, LogLevel, Match, Option, Record, pipe, type Tracer } from 'effect';
import { dual } from 'effect/Function';
import { Context } from '../context.ts';
import { Env } from '../env.ts';
import { MetricsService } from './metrics.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _SPAN_KIND_PREFIXES = [
    ['consumer',    ['jobs.process', 'jobs.poll']],
    ['internal',    ['cache.', 'cron.', 'crypto.']],
    ['producer',    ['email.send', 'eventbus.', 'job.', 'jobs.enqueue', 'jobs.submit']],
    ['server',      ['admin.', 'audit.', 'auth.', 'health.', 'jobs.subscribe', 'notification.', 'rpc.', 'search.', 'storage.', 'telemetry.', 'transfer.', 'users.', 'websocket.']],
    ['client',      ['webhook.', 'webhooks.']],
] as const satisfies ReadonlyArray<readonly [Tracer.SpanKind, ReadonlyArray<string>]>;
const _REDACT_KEYS = ['client.address', 'session.id', 'session_id', 'user.id', 'user_id'] as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const _resolveEndpoint = (base: string, path: string, override: Option.Option<string>): string => Option.match(override, { onNone: () => `${base.replace(/\/$/, '')}${path}`, onSome: (endpoint) => endpoint.replace(/\/$/, '') });
const _annotateError = Effect.tapErrorCause((cause: Cause.Cause<unknown>) => {
    const pretty = A.head(Cause.prettyErrors(cause));
    const msg = Option.match(pretty, { onNone: () => Cause.pretty(cause), onSome: (entry) => entry.message });
    const stack = pipe(pretty, Option.flatMapNullable((entry) => entry.stack), Option.getOrUndefined);
    const base = { 'exception.message': msg, 'exception.stacktrace': stack };
    const attrs = Cause.match(cause, {
        onDie: (defect) => { const errorType = defect instanceof Error ? defect.constructor.name : 'Defect'; return { ...base, 'error': true, 'error.type': errorType, 'exception.type': errorType }; },
        onEmpty: {} as Record.ReadonlyRecord<string, unknown>,
        onFail: (error) => { const errorType = MetricsService.errorTag(error); return { ...base, 'error': true, 'error.type': errorType, 'exception.type': errorType }; },
        onInterrupt: (fiberId) => ({ 'error': true, 'error.type': 'FiberInterrupted', 'exception.message': `Interrupted by ${FiberId.threadName(fiberId)}`, 'exception.type': 'FiberInterrupted' }),
        onParallel: (left, right) => ({ ...left, ...right, 'error.parallel': HashSet.size(Cause.linearize(cause)) }),
        onSequential: (left, right) => ({ ...left, ...right, 'error.sequential': true }),
    });
    return Effect.gen(function* () {
        const { nowNs, span } = yield* Effect.all({ nowNs: Clock.currentTimeNanos, span: Effect.optionFromOptional(Effect.currentSpan) });
        yield* Option.match(span, {
            onNone: () => Effect.void,
            onSome: (currentSpan) => Effect.when(
                Effect.sync(() => currentSpan.event('exception', nowNs, { 'exception.message': attrs['exception.message'], 'exception.stacktrace': attrs['exception.stacktrace'], 'exception.type': attrs['exception.type'] })),
                () => attrs['error'] === true,
            ),
        });
        yield* Effect.annotateCurrentSpan(attrs);
    });
});
const _span: {
    (name: string, opts?: Telemetry.SpanOpts): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
    <A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R>;
} = dual(
    (args) => Effect.isEffect(args[0]),
    <A, E, R>(self: Effect.Effect<A, E, R>, name: string, opts?: Telemetry.SpanOpts): Effect.Effect<A, E, R> => {
        const { captureStackTrace, kind, metrics, ...restAttrs } = opts ?? {};
        const effect = Effect.gen(function* () {
            const { ctx, fiberId } = yield* Effect.all({ ctx: Context.Request.current, fiberId: Effect.fiberId }, { concurrency: 'unbounded' });
            const requestAttrs = Context.Request.toAttrs(ctx, fiberId);
            const spanAttrs = A.reduce(_REDACT_KEYS, { ...requestAttrs, ...restAttrs } as Record.ReadonlyRecord<string, unknown>, (acc, key) => Record.remove(acc, key));
            const prefixKind = pipe(_SPAN_KIND_PREFIXES, A.findFirst(([, prefixes]) => A.some(prefixes, (p) => name.startsWith(p))), Option.map(([k]) => k));
            const spanKind = kind ?? pipe(ctx.circuit, Option.as('client' as Tracer.SpanKind), Option.orElse(() => prefixKind), Option.getOrElse((): Tracer.SpanKind => 'internal'));
            const coreSpan = self.pipe(Effect.withSpan(name, { attributes: spanAttrs, captureStackTrace: captureStackTrace !== false, kind: spanKind }), _annotateError, Effect.withLogSpan(name), Effect.annotateLogs(requestAttrs));
            return yield* Effect.serviceOption(MetricsService).pipe(
                Effect.when(() => metrics !== false && spanKind !== 'server'),
                Effect.map(Option.flatten),
                Effect.flatMap(Option.match({
                    onNone: () => coreSpan,
                    onSome: (ms) => MetricsService.trackEffect(coreSpan, { duration: ms.rpc.duration, errors: ms.rpc.errors, labels: MetricsService.label({ operation: name, tenant: ctx.tenantId }) }),
                })),
            );
        });
        return effect as Effect.Effect<A, E, R>;
    },
);

// --- [LAYERS] ----------------------------------------------------------------

const _telemetryConfig = Env.Service.pipe(Effect.map((env) => {
    const headers = pipe(
        env.telemetry.headers.split(','),
        A.filterMap((segment) => {
            const [key = '', value = ''] = segment.split('=', 2).map((part) => part.trim());
            return key !== '' && value !== '' ? Option.some([key, value] as const) : Option.none();
        }),
        Record.fromEntries,
    );
    const logsExporter = Match.value(env.telemetry.logsExporter.toLowerCase().replaceAll(' ', '')).pipe(
        Match.when('none', () => ({ console: false, otlp: false })),
        Match.when('otlp', () => ({ console: false, otlp: true })),
        Match.when('console', () => ({ console: true, otlp: false })),
        Match.when('console,otlp', () => ({ console: true, otlp: true })),
        Match.when('otlp,console', () => ({ console: true, otlp: true })),
        Match.orElse(() => ({ console: false, otlp: true })),
    );
    const environment = env.app.nodeEnv === 'production' ? 'production' : 'development';
    const logLevel = Option.getOrElse(env.app.logLevel, () => LogLevel.Info);
    return {
        baseEndpoint: env.telemetry.baseEndpoint,
        environment,
        headers,
        instanceId: Option.getOrElse(env.app.hostname, () => crypto.randomUUID()),
        k8sContainerName: env.telemetry.k8sContainerName,
        k8sDeploymentName: env.telemetry.k8sDeploymentName,
        k8sNamespace: env.telemetry.k8sNamespace,
        k8sNodeName: env.telemetry.k8sNodeName,
        k8sPodName: env.telemetry.k8sPodName,
        logLevel,
        logsEndpoint: env.telemetry.logsEndpoint,
        logsExporter,
        metricsEndpoint: env.telemetry.metricsEndpoint,
        metricsExporter: env.telemetry.metricsExporter,
        protocol: env.telemetry.protocol,
        serviceName: env.telemetry.serviceName,
        serviceVersion: env.telemetry.serviceVersion,
        tracesEndpoint: env.telemetry.tracesEndpoint,
        tracesExporter: env.telemetry.tracesExporter,
    } as const;
}));
const _collectorEndpoints = (cfg: Effect.Effect.Success<typeof _telemetryConfig>) => {
    const baseEndpoint = Option.getOrElse(cfg.baseEndpoint, () => cfg.environment === 'production' ? 'https://alloy.monitoring.svc.cluster.local:4318' : 'http://127.0.0.1:4318');
    return {
        logs:           _resolveEndpoint(baseEndpoint, '/v1/logs', cfg.logsEndpoint),
        metrics:        _resolveEndpoint(baseEndpoint, '/v1/metrics', cfg.metricsEndpoint),
        traces:         _resolveEndpoint(baseEndpoint, '/v1/traces', cfg.tracesEndpoint),
    } as const;
};
const _Default = Layer.unwrapEffect(
    _telemetryConfig.pipe(Effect.map((cfg) => {
        const exp = {
            development: { batchSize: 64, interval: Duration.seconds(2), loggerExcludeLogSpans: false, shutdownTimeout: Duration.seconds(5), tracerInterval: Duration.millis(500) },
            production: { batchSize: 512, interval: Duration.seconds(10), loggerExcludeLogSpans: true, shutdownTimeout: Duration.seconds(30), tracerInterval: Duration.seconds(1) }
        }[cfg.environment];
        const endpoints = _collectorEndpoints(cfg);
        const resource = {
            attributes: {
                'deployment.environment.name': cfg.environment,
                ...(cfg.k8sContainerName && { 'k8s.container.name': cfg.k8sContainerName }), ...(cfg.k8sDeploymentName && { 'k8s.deployment.name': cfg.k8sDeploymentName }),
                ...(cfg.k8sNamespace && { 'k8s.namespace.name': cfg.k8sNamespace }), ...(cfg.k8sNodeName && { 'k8s.node.name': cfg.k8sNodeName }), ...(cfg.k8sPodName && { 'k8s.pod.name': cfg.k8sPodName }),
                'process.pid': process.pid, 'process.runtime.name': 'node', 'process.runtime.version': process.versions.node,
                'service.instance.id': cfg.instanceId, 'service.namespace': 'parametric-portal',
                'telemetry.sdk.language': 'nodejs', 'telemetry.sdk.name': 'opentelemetry',
            },
            serviceName: cfg.serviceName, serviceVersion: cfg.serviceVersion,
        } as const;
        const envLogger = cfg.environment === 'production' ? Logger.jsonLogger : Logger.prettyLogger({ colors: 'auto', mode: 'auto' });
        const logsLayer = cfg.logsExporter.otlp
            ? OtlpLogger.layer({ excludeLogSpans: exp.loggerExcludeLogSpans, exportInterval: exp.interval, headers: cfg.headers, maxBatchSize: exp.batchSize, replaceLogger: cfg.logsExporter.console ? undefined : Logger.defaultLogger, resource, shutdownTimeout: exp.shutdownTimeout, url: endpoints.logs })
            : Layer.empty;
        const metricsLayer = cfg.metricsExporter === 'otlp'
            ? OtlpMetrics.layer({ exportInterval: exp.interval, headers: cfg.headers, resource, shutdownTimeout: exp.shutdownTimeout, url: endpoints.metrics })
            : Layer.empty;
        const tracesLayer = cfg.tracesExporter === 'otlp'
            ? OtlpTracer.layer({ exportInterval: exp.tracerInterval, headers: cfg.headers, maxBatchSize: exp.batchSize, resource, shutdownTimeout: exp.shutdownTimeout, url: endpoints.traces })
            : Layer.empty;
        const otlpLayer = Layer.mergeAll(logsLayer, metricsLayer, tracesLayer).pipe(Layer.provide({ 'http/json': OtlpSerialization.layerJson, 'http/protobuf': OtlpSerialization.layerProtobuf }[cfg.protocol]));
        return Layer.mergeAll(
            !cfg.logsExporter.console && !cfg.logsExporter.otlp ? Logger.replace(Logger.defaultLogger, Logger.none) : Layer.empty,
            otlpLayer,
            cfg.logsExporter.console ? Logger.replace(Logger.defaultLogger, Logger.withSpanAnnotations(envLogger)) : Layer.empty,
            Logger.minimumLogLevel(cfg.logLevel),
        );
    })),
).pipe(Layer.provide(Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, HttpClient.withTracerPropagation(false)))), Layer.provide(FetchHttpClient.layer));

// --- [ENTRY] -----------------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge pattern
const Telemetry = {
    collectorConfig:    _telemetryConfig.pipe(Effect.map((cfg) => ({
        endpoints:      _collectorEndpoints(cfg),
        headers:        cfg.headers,
        protocol:       cfg.protocol,
    }))),
    Default: _Default,
    span: _span,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Telemetry {
    export type Config = Effect.Effect.Success<typeof _telemetryConfig>;
    export type SpanOpts = Tracer.SpanOptions['attributes'] & { readonly captureStackTrace?: false; readonly kind?: Tracer.SpanKind; readonly metrics?: false };
}

// --- [EXPORT] ----------------------------------------------------------------

export { Telemetry };
