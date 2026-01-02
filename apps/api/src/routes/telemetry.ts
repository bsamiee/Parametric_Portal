/**
 * OTLP trace proxy for browser telemetry.
 * Browser POSTs to /api/v1/traces, API forwards to collector.
 * Config-driven: defers env reading to Layer build time.
 */
import { HttpApiBuilder, HttpServerResponse } from '@effect/platform';
import { InternalError, Validation } from '@parametric-portal/server/domain-errors';
import { Config, Effect, pipe, Schema as S } from 'effect';
import { ParametricApi } from '@parametric-portal/server/api';

// --- [SCHEMA] ----------------------------------------------------------------

const OtlpTracePayload = S.Struct({
    resourceSpans: S.Array(S.Unknown),
});

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        collectorEndpoint: 'http://alloy.monitoring.svc.cluster.local:4318',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const handleIngestTraces = Effect.fn('telemetry.ingest')((collectorEndpoint: string, body: unknown) =>
    Effect.gen(function* () {
        const payload = yield* S.decodeUnknown(OtlpTracePayload)(body).pipe(
            Effect.mapError(() => new Validation({ field: 'body', message: 'Invalid OTLP payload' })),
        );
        yield* Effect.tryPromise({
            catch: (e) => new InternalError({ message: `Collector unreachable: ${String(e)}` }),
            try: () =>
                fetch(`${collectorEndpoint}/v1/traces`, {
                    body: JSON.stringify(payload),
                    headers: { 'Content-Type': 'application/json' },
                    method: 'POST',
                }),
        });
        return HttpServerResponse.empty({ status: 202 });
    }).pipe(
        Effect.catchAll((error) =>
            Effect.gen(function* () {
                yield* Effect.logWarning('Telemetry ingestion failed', { error: String(error) });
                return HttpServerResponse.empty({ status: 202 });
            }),
        ),
    ),
);

// --- [EFFECT_PIPELINE] -------------------------------------------------------

const TelemetryRouteLive = HttpApiBuilder.group(ParametricApi, 'telemetry', (handlers) =>
    Effect.gen(function* () {
        const collectorEndpoint = yield* pipe(
            Config.string('OTEL_EXPORTER_OTLP_ENDPOINT'),
            Config.withDefault(B.defaults.collectorEndpoint),
            Config.map((url) => url.replace(':4317', ':4318')),
        );
        return handlers.handle('ingestTraces', ({ request }) =>
            request.json.pipe(
                Effect.flatMap((body) => handleIngestTraces(collectorEndpoint, body)),
                Effect.catchAll((error) =>
                    Effect.gen(function* () {
                        yield* Effect.logWarning('Telemetry request parse failed', { error: String(error) });
                        return HttpServerResponse.empty({ status: 202 });
                    }),
                ),
            ),
        );
    }),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryRouteLive };
