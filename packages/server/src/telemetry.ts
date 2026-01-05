/**
 * OpenTelemetry: Traces, Metrics, Logs via unified Otlp.layer.
 * Config-driven with environment-aware intervals and semantic convention compliant attributes.
 */
import { Otlp } from '@effect/opentelemetry';
import { FetchHttpClient } from '@effect/platform';
import { Config, Duration, Effect, Layer } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TelemetryConfigType = Config.Config.Success<typeof TelemetryConfig>;
type Environment = 'production' | 'development';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        endpointHttp: 'http://alloy.monitoring.svc.cluster.local:4318',
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
} as const);

// --- [CONFIG] ----------------------------------------------------------------

const TelemetryConfig = Config.all({
    endpointHttp: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(B.defaults.endpointHttp), Config.map((url) => (url.includes(':4317') ? url.replace(':4317', ':4318') : url))),
    environment: Config.string('NODE_ENV').pipe(Config.withDefault(B.defaults.environment), Config.map((env): Environment => (env === 'production' ? 'production' : 'development'))),
    instanceId: Config.string('HOSTNAME').pipe(Config.withDefault(crypto.randomUUID())),
    k8sNamespace: Config.string('K8S_NAMESPACE').pipe(Config.withDefault('')),
    k8sPodName: Config.string('K8S_POD_NAME').pipe(Config.withDefault('')),
    serviceName: Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault(B.defaults.serviceName)),
    serviceVersion: Config.string('npm_package_version').pipe(Config.withDefault(B.defaults.serviceVersion)),
});

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const createResource = (config: TelemetryConfigType) => ({
    attributes: {
        'deployment.environment.name': config.environment,
        ...(config.k8sNamespace && { 'k8s.namespace.name': config.k8sNamespace }),
        ...(config.k8sPodName && { 'k8s.pod.name': config.k8sPodName }),
        'service.instance.id': config.instanceId,
        'service.namespace': B.defaults.namespace,
        'telemetry.sdk.language': B.sdk.language,
        'telemetry.sdk.name': B.sdk.name,
    },
    serviceName: config.serviceName,
    serviceVersion: config.serviceVersion,
});

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryLive = Layer.unwrapEffect(
    Effect.map(TelemetryConfig, (config) => {
        const exporterConfig = B.exporters[config.environment];
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

// --- [EXPORT] ----------------------------------------------------------------

export { B as TELEMETRY_TUNING, TelemetryLive };
