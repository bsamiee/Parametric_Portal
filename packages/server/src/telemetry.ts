/**
 * OpenTelemetry: Traces via NodeSdk, Metrics + Logs via native Effect OTLP.
 * Single B constant, Config-driven, Layer composition.
 */
import { NodeSdk, OtlpLogger, OtlpMetrics } from '@effect/opentelemetry';
import { FetchHttpClient } from '@effect/platform';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Config, Duration, Effect, Layer } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        endpoint: 'http://alloy.monitoring.svc.cluster.local:4317',
        endpointHttp: 'http://alloy.monitoring.svc.cluster.local:4318',
        environment: 'development',
        namespace: 'parametric-portal',
        serviceName: 'api',
        serviceVersion: '0.0.0',
    },
    exporters: {
        batchSize: 512,
        exportInterval: Duration.seconds(5),
        scheduleDelay: Duration.seconds(5),
        shutdownTimeout: Duration.seconds(3),
        timeout: Duration.seconds(30),
    },
} as const);

// --- [CONFIG] ----------------------------------------------------------------

const TelemetryConfig = Config.all({
    endpoint: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(Config.withDefault(B.defaults.endpoint)),
    endpointHttp: Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
        Config.withDefault(B.defaults.endpointHttp),
        Config.map((url) => url.replace(':4317', ':4318')),
    ),
    environment: Config.string('NODE_ENV').pipe(Config.withDefault(B.defaults.environment)),
    serviceName: Config.string('OTEL_SERVICE_NAME').pipe(Config.withDefault(B.defaults.serviceName)),
    serviceVersion: Config.string('npm_package_version').pipe(Config.withDefault(B.defaults.serviceVersion)),
});

// --- [LAYERS] ----------------------------------------------------------------

const TracesLive = Layer.unwrapEffect(
    Effect.map(TelemetryConfig, (config) =>
        NodeSdk.layer(() => ({
            resource: {
                attributes: { 'deployment.environment': config.environment, 'service.namespace': B.defaults.namespace },
                serviceName: config.serviceName,
                serviceVersion: config.serviceVersion,
            },
            spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({ url: config.endpoint }), {
                exportTimeoutMillis: Duration.toMillis(B.exporters.timeout),
                maxExportBatchSize: B.exporters.batchSize,
                scheduledDelayMillis: Duration.toMillis(B.exporters.scheduleDelay),
            }),
        })),
    ),
);
const MetricsLive = Layer.unwrapEffect(
    Effect.map(TelemetryConfig, (config) =>
        OtlpMetrics.layer({
            exportInterval: B.exporters.exportInterval,
            resource: {
                attributes: { 'deployment.environment': config.environment, 'service.namespace': B.defaults.namespace },
                serviceName: config.serviceName,
                serviceVersion: config.serviceVersion,
            },
            shutdownTimeout: B.exporters.shutdownTimeout,
            url: `${config.endpointHttp}/v1/metrics`,
        }),
    ),
);
const LogsLive = Layer.unwrapEffect(
    Effect.map(TelemetryConfig, (config) =>
        OtlpLogger.layer({
            exportInterval: B.exporters.exportInterval,
            resource: {
                attributes: { 'deployment.environment': config.environment, 'service.namespace': B.defaults.namespace },
                serviceName: config.serviceName,
                serviceVersion: config.serviceVersion,
            },
            shutdownTimeout: B.exporters.shutdownTimeout,
            url: `${config.endpointHttp}/v1/logs`,
        }),
    ),
);

const TelemetryLive = Layer.mergeAll(TracesLive, MetricsLive, LogsLive).pipe(Layer.provide(FetchHttpClient.layer));

// --- [EXPORT] ----------------------------------------------------------------

export { B as TELEMETRY_TUNING, TelemetryLive };
