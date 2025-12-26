// --- [TYPES] -----------------------------------------------------------------

import { Effect, Layer, Schema } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ServiceName = Schema.String.pipe(Schema.minLength(1), Schema.brand('ServiceName'));
const OtelEndpoint = Schema.String.pipe(Schema.pattern(/^https?:\/\//), Schema.brand('OtelEndpoint'));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    endpoint: Schema.decodeUnknownSync(OtelEndpoint)(process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://alloy:4317'),
    serviceName: Schema.decodeUnknownSync(ServiceName)(process.env['OTEL_SERVICE_NAME'] ?? 'api'),
} as const);

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryLive = Layer.effectDiscard(
    Effect.promise(async () => {
        const { NodeSDK } = await import('@opentelemetry/sdk-node');
        const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
        const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-grpc');
        const { resourceFromAttributes } = await import('@opentelemetry/resources');
        const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');
        const sdk = new NodeSDK({
            instrumentations: [getNodeAutoInstrumentations()],
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: B.serviceName,
                [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
            }),
            traceExporter: new OTLPTraceExporter({ url: B.endpoint }),
        });
        sdk.start();
        process.on('SIGTERM', () =>
            Effect.runPromise(
                Effect.tryPromise({
                    catch: (e) => new Error(`Telemetry shutdown failed: ${String(e)}`),
                    try: () => sdk.shutdown(),
                }),
            ).catch(console.error),
        );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryLive };
