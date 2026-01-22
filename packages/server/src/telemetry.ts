/**
 * Export OpenTelemetry traces, metrics, logs via unified Otlp.layer.
 * Config-driven intervals; annotates spans with RequestContext for app segmentation.
 */
import { Otlp } from '@effect/opentelemetry';
import { FetchHttpClient } from '@effect/platform';
import { Config, Duration, Effect, Layer, Option } from 'effect';
import { Circuit } from './circuit.ts';
import { RequestContext } from './context.ts';

// --- [TYPES] -----------------------------------------------------------------

type Environment = 'production' | 'development';

// --- [CONSTANTS] -------------------------------------------------------------

const TELEMETRY_TUNING = {
    defaults: {
        endpointHttp: 'https://alloy.monitoring.svc.cluster.local:4318',
        environment: 'development' as Environment,
        namespace: 'parametric-portal',
        serviceName: 'api',
        serviceVersion: '0.0.0',
    },
    exporters: {
        development: { batchSize: 64, interval: Duration.seconds(2), shutdownTimeout: Duration.seconds(5) },
        production: { batchSize: 512, interval: Duration.seconds(10), shutdownTimeout: Duration.seconds(30) },
    },
    sdk: { language: 'nodejs', name: 'opentelemetry' },
} as const;
const TelemetryConfig = Config.all({
    endpointHttp: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(TELEMETRY_TUNING.defaults.endpointHttp), Config.map((url) => (url.includes(':4317') ? url.replace(':4317', ':4318') : url))),
    environment: Config.string('NODE_ENV').pipe(Config.withDefault(TELEMETRY_TUNING.defaults.environment), Config.map((env): Environment => (env === 'production' ? 'production' : 'development'))),
    instanceId: Config.string('HOSTNAME').pipe(Config.withDefault(crypto.randomUUID())),
    k8sNamespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('')),
    k8sPodName: Config.string('K8S_POD_NAME').pipe(Config.withDefault('')),
    serviceName: Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault(TELEMETRY_TUNING.defaults.serviceName)),
    serviceVersion: Config.string('npm_package_version').pipe(Config.withDefault(TELEMETRY_TUNING.defaults.serviceVersion)),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createResource = (config: Config.Config.Success<typeof TelemetryConfig>) => ({
    attributes: {
        'deployment.environment.name': config.environment,
        ...(config.k8sNamespace && { 'k8s.namespace.name': config.k8sNamespace }),
        ...(config.k8sPodName && { 'k8s.pod.name': config.k8sPodName }),
        'service.instance.id': config.instanceId,
        'service.namespace': TELEMETRY_TUNING.defaults.namespace,
        'telemetry.sdk.language': TELEMETRY_TUNING.sdk.language,
        'telemetry.sdk.name': TELEMETRY_TUNING.sdk.name,
    },
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
});

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryLive = Layer.unwrapEffect(
    Effect.map(TelemetryConfig, (config) => {
        const exporterConfig = TELEMETRY_TUNING.exporters[config.environment];
        return Otlp.layer({
            baseUrl: config.endpointHttp,
            loggerExcludeLogSpans: true,
            loggerExportInterval: exporterConfig.interval,
            maxBatchSize: exporterConfig.batchSize,
            metricsExportInterval: exporterConfig.interval,
            resource: createResource(config),
            shutdownTimeout: exporterConfig.shutdownTimeout,
            tracerExportInterval: Duration.millis(500),
        });
    }),
).pipe(Layer.provide(FetchHttpClient.layer));

// --- [UTILITIES] -------------------------------------------------------------

const annotateSpanWithApp: Effect.Effect<void, never, never> = Effect.gen(function* () {
    const { app, circuit } = yield* Effect.all({ app: Effect.serviceOption(RequestContext), circuit: Circuit.current });
    yield* Option.match(app, { onNone: () => Effect.void, onSome: (ctx) => Effect.annotateCurrentSpan('app.id', ctx.appId) });
    yield* Option.match(circuit, {
        onNone: () => Effect.void,
        onSome: (ctx) => Effect.all([
            Effect.annotateCurrentSpan('circuit.name', ctx.name),
            Effect.annotateCurrentSpan('circuit.state', Circuit.State[ctx.state]),
        ], { discard: true }),
    });
});
const withAppSpan = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
        const { app, circuit } = yield* Effect.all({ app: Effect.serviceOption(RequestContext), circuit: Circuit.current });
        const appAttrs = Option.match(app, { onNone: () => ({}), onSome: (ctx) => ({ 'app.id': ctx.appId }) });
        const circuitAttrs = Option.match(circuit, { onNone: () => ({}), onSome: (ctx) => ({ 'circuit.name': ctx.name, 'circuit.state': Circuit.State[ctx.state] }) });
        return yield* Effect.withSpan(effect, name, { attributes: { ...appAttrs, ...circuitAttrs } });
    });

// --- [EXPORT] ----------------------------------------------------------------

export { annotateSpanWithApp, TELEMETRY_TUNING, TelemetryLive, withAppSpan };
