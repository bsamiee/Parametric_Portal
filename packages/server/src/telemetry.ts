/**
 * OpenTelemetry integration via @effect/opentelemetry NodeSdk.
 * Context.Tag + static layer pattern following crypto.ts gold standard.
 */
import { NodeSdk } from '@effect/opentelemetry';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Config, Context, Effect, Layer, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type TelemetryConfig = {
    readonly endpoint: string;
    readonly environment: string;
    readonly serviceName: string;
    readonly serviceVersion: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        endpoint: 'http://alloy.monitoring.svc.cluster.local:4317',
        environment: 'development',
        serviceName: 'api',
        serviceVersion: '0.0.0',
    },
    namespace: 'parametric-portal',
} as const);

// --- [CONFIG] ----------------------------------------------------------------

const TelemetryConfigSchema = Config.all({
    endpoint: pipe(Config.string('OTEL_EXPORTER_OTLP_ENDPOINT'), Config.withDefault(B.defaults.endpoint)),
    environment: pipe(Config.string('NODE_ENV'), Config.withDefault(B.defaults.environment)),
    serviceName: pipe(Config.string('OTEL_SERVICE_NAME'), Config.withDefault(B.defaults.serviceName)),
    serviceVersion: pipe(Config.string('npm_package_version'), Config.withDefault(B.defaults.serviceVersion)),
});

// --- [SERVICE] ---------------------------------------------------------------

class TelemetryService extends Context.Tag('server/TelemetryService')<TelemetryService, TelemetryConfig>() {
    static readonly layer = Layer.unwrapEffect(
        Effect.map(TelemetryConfigSchema, (config) =>
            Layer.merge(
                Layer.succeed(TelemetryService, config),
                NodeSdk.layer(() => ({
                    resource: {
                        'deployment.environment': config.environment,
                        'service.namespace': B.namespace,
                        serviceName: config.serviceName,
                        serviceVersion: config.serviceVersion,
                    },
                    spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter({ url: config.endpoint })),
                })),
            ),
        ),
    );
}

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryService };
export type { TelemetryConfig };
