/**
 * OTLP proxy for browser telemetry (CORS bypass).
 * Browser POSTs to /api/v1/traces, API forwards to collector.
 */
import { HttpApiBuilder, HttpServerRequest, HttpServerResponse } from '@effect/platform';
import { ParametricApi } from '@parametric-portal/server/api';
import { TELEMETRY_TUNING } from '@parametric-portal/server/telemetry';
import { Config, Effect, Schema as S } from 'effect';

// --- [CONSTANTS] -------------------------------------------------------------

const CollectorEndpoint = Config.string('OTEL_EXPORTER_OTLP_ENDPOINT').pipe(
    Config.withDefault(TELEMETRY_TUNING.defaults.endpointHttp),
    Config.map((url) => url.replace(':4317', ':4318')),
);

// --- [SCHEMA] ----------------------------------------------------------------

const OtlpPayload = S.Struct({ resourceSpans: S.Array(S.Unknown) });

// --- [DISPATCH_TABLES] -------------------------------------------------------

const handleIngestTraces = Effect.fn('telemetry.ingest')((request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
        const endpoint = yield* CollectorEndpoint;
        const json = yield* request.json;
        const payload = yield* S.decodeUnknown(OtlpPayload)(json);
        yield* Effect.tryPromise(() =>
            fetch(`${endpoint}/v1/traces`, {
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'application/json' },
                method: 'POST',
            }),
        );
        return HttpServerResponse.empty({ status: 202 });
    }).pipe(
        Effect.tapError((e) => Effect.logWarning('Telemetry proxy failed', { error: String(e) })),
        Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 202 })),
    ),
);

// --- [LAYERS] ----------------------------------------------------------------

const TelemetryRouteLive = HttpApiBuilder.group(ParametricApi, 'telemetry', (handlers) =>
    handlers.handle('ingestTraces', ({ request }) => handleIngestTraces(request)),
);

// --- [EXPORT] ----------------------------------------------------------------

export { TelemetryRouteLive };
