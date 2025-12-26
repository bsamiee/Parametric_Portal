// --- [TYPES] -----------------------------------------------------------------

import { Data, Duration, Effect, Layer, Schema } from 'effect';

// --- [SCHEMA] ----------------------------------------------------------------

const ServiceName = Schema.String.pipe(Schema.minLength(1), Schema.brand('ServiceName'));
const OtelEndpoint = Schema.String.pipe(Schema.pattern(/^https?:\/\//), Schema.brand('OtelEndpoint'));

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    endpoint: Schema.decodeUnknownSync(OtelEndpoint)(
        process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://alloy.monitoring.svc.cluster.local:4317',
    ),
    initTimeoutMs: 5000,
    serviceName: Schema.decodeUnknownSync(ServiceName)(process.env['OTEL_SERVICE_NAME'] ?? 'api'),
} as const);

// --- [ERRORS] ----------------------------------------------------------------

class TelemetryInitError extends Data.TaggedError('TelemetryInitError')<{
    readonly cause: unknown;
}> {}

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryLive = Layer.effectDiscard(
    Effect.gen(function* () {
        yield* Effect.tryPromise({
            catch: (e) => new TelemetryInitError({ cause: e }),
            try: async () => {
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
            },
        }).pipe(
            Effect.timeout(Duration.millis(B.initTimeoutMs)),
            Effect.catchAll((e) =>
                Effect.logWarning(`Telemetry initialization skipped: ${String(e)}`).pipe(Effect.as(undefined)),
            ),
        );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryLive };
